import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readJsonl } from './lib/stats.mjs';
import { generateArrivalScheduleDetailed } from '../workloads/traffic.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const phase = arg('phase', 'main');
const mainSeeds = '601,602,603,604,605,606,607,608,609,610';
const auxiliarySeeds = '701,702,703,704,705,706,707,708,709,710';
const seeds = arg('seeds', ['main', 'standard-main'].includes(phase) ? mainSeeds : auxiliarySeeds).split(',').map(Number);
const profile = arg('profile', '');
const duration = Number(arg('duration', '120'));
const fixedForDrift = Number(arg('best-fixed-deadline', '3'));

function walk(dir, name) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, name));
    else if (entry.name === name) out.push(full);
  }
  return out;
}

const existing = walk(path.join('experiments', 'live_runs'), 'summary.json').flatMap((file) => {
  try { return [{ file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }]; } catch { return []; }
});

function matches(job) {
  return existing.some(({ data }) => {
    const c = data.metadata?.config;
    return c && c.campaign === job.campaign && c.seed === job.seed && c.policy === job.policy &&
      c.allocator === job.allocator && c.traffic === job.traffic && c.durationSeconds === duration &&
      c.fixedDeadline === job.fixedDeadline && (c.driftModel || '') === (job.driftModel || '') &&
      (job.occupancyThreshold == null || c.occupancyThreshold === job.occupancyThreshold) &&
      (job.reservedCpuSlots == null || c.reservedCpuSlots === job.reservedCpuSlots);
  });
}

function buildJobs() {
  const jobs = [];
  if (phase === 'main') {
    const policies = ['fixed', 'analytical', 'calibrated', 'adaptive', 'guarded'];
    for (const traffic of ['poisson', 'mmpp']) for (const [seedIndex, seed] of seeds.entries()) {
      const balancedPolicies = policies.map((_, offset) => policies[(seedIndex + offset) % policies.length]);
      for (const policy of balancedPolicies)
        jobs.push({ campaign: 'journal-main', traffic, policy, allocator: 'quality-aware', seed, fixedDeadline: 3 });
    }
  } else if (phase === 'allocator') {
    const allocators = ['static-compact', 'static-max', 'token-max', 'quality-aware'];
    for (const [seedIndex, seed] of seeds.entries()) {
      const balancedAllocators = allocators.map((_, offset) => allocators[(seedIndex + offset) % allocators.length]);
      for (const allocator of balancedAllocators)
        jobs.push({ campaign: 'journal-allocator-balanced', traffic: 'poisson', policy: 'guarded', allocator, seed, fixedDeadline: 3 });
    }
  } else if (phase === 'sweep') {
    const variants = [
      ...[1, 2, 3, 5, 8].map((fixedDeadline) => ({ policy: 'fixed', fixedDeadline })),
      { policy: 'guarded', fixedDeadline: 3 }
    ];
    for (const [seedIndex, seed] of seeds.entries()) {
      const balancedVariants = variants.map((_, offset) => variants[(seedIndex + offset) % variants.length]);
      for (const variant of balancedVariants)
        jobs.push({ campaign: 'journal-sweep', traffic: 'poisson', allocator: 'quality-aware', seed, ...variant });
    }
  } else if (phase === 'drift') {
    const policies = ['fixed', 'guarded'];
    for (const [seedIndex, seed] of seeds.entries()) for (let offset = 0; offset < policies.length; offset += 1) {
      const policy = policies[(seedIndex + offset) % policies.length];
      jobs.push({ campaign: 'journal-drift', traffic: 'rate-step', policy, allocator: 'quality-aware', seed, fixedDeadline: fixedForDrift, driftModel: 'qwen2.5:7b' });
    }
  } else if (phase === 'standard-main') {
    const policies = ['occupancy-threshold', 'static-reservation', 'threshold-reservation'];
    for (const traffic of ['poisson', 'mmpp']) for (const [seedIndex, seed] of seeds.entries()) {
      const balancedPolicies = policies.map((_, offset) => policies[(seedIndex + offset) % policies.length]);
      for (const policy of balancedPolicies) jobs.push({
        campaign: 'journal-standard-main', traffic, policy, allocator: 'quality-aware', seed,
        fixedDeadline: 8, occupancyThreshold: 6, reservedCpuSlots: 2
      });
    }
  } else if (phase === 'standard-drift') {
    const policies = ['occupancy-threshold', 'static-reservation', 'threshold-reservation'];
    for (const [seedIndex, seed] of seeds.entries()) {
      const balancedPolicies = policies.map((_, offset) => policies[(seedIndex + offset) % policies.length]);
      for (const policy of balancedPolicies) jobs.push({
        campaign: 'journal-standard-drift', traffic: 'rate-step', policy, allocator: 'quality-aware', seed,
        fixedDeadline: 8, driftModel: 'qwen2.5:7b', occupancyThreshold: 6, reservedCpuSlots: 2
      });
    }
  } else throw new Error(`Unknown phase: ${phase}`);
  return jobs;
}

function run(job) {
  const args = [
    'controller/run_live_experiment.mjs', '--campaign', job.campaign,
    '--policy', job.policy, '--allocator', job.allocator, '--traffic', job.traffic,
    '--duration', String(duration), '--rate', '4', '--capacity', '8', '--alpha', '0.05',
    '--fixed-deadline', String(job.fixedDeadline), '--min-deadline', '0.25', '--max-deadline', '8',
    '--epoch', '4', '--cpu-fraction', '0.2', '--seed', String(job.seed),
    '--model', 'qwen2.5:3b', '--controller-gain', '1.5', '--messaging-reserve', '0.05', '--gpu-energy', 'false'
  ];
  if (job.occupancyThreshold != null) args.push('--occupancy-threshold', String(job.occupancyThreshold));
  if (job.reservedCpuSlots != null) args.push('--reserved-cpu-slots', String(job.reservedCpuSlots));
  if (profile) args.push('--profile', profile);
  if (job.driftModel) args.push('--drift-model', job.driftModel, '--drift-at', String(duration / 2));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Run failed with exit code ${code}`)));
  });
}

const jobs = buildJobs();
if (phase === 'main' || phase === 'standard-main') {
  for (const seed of seeds) {
    const coverage = generateArrivalScheduleDetailed({ type: 'mmpp', durationSeconds: duration, meanRate: 4, seed }).metadata;
    if (!(coverage.visitedLow && coverage.visitedHigh)) throw new Error(`MMPP seed ${seed} does not visit both states in ${duration} s.`);
  }
}
let complete = 0;
for (const job of jobs) {
  complete += 1;
  if (matches(job)) {
    process.stdout.write(`Skipping completed ${complete}/${jobs.length}: ${JSON.stringify(job)}\n`);
    continue;
  }
  process.stdout.write(`\n=== ${phase} ${complete}/${jobs.length}: ${JSON.stringify(job)} ===\n`);
  await run(job);
}
process.stdout.write(`Journal campaign phase '${phase}' complete (${jobs.length} planned runs).\n`);
