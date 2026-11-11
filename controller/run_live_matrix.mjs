import { spawn } from 'node:child_process';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const policies = arg('policies', 'fixed,analytical,calibrated,adaptive,guarded').split(',').filter(Boolean);
const traffics = arg('traffics', 'poisson,mmpp').split(',').filter(Boolean);
const seeds = arg('seeds', '601,602,603,604,605,606,607,608,609,610').split(',').map(Number);
const common = {
  duration: arg('duration', '120'),
  rate: arg('rate', '4'),
  capacity: arg('capacity', '8'),
  alpha: arg('alpha', '0.05'),
  fixedDeadline: arg('fixed-deadline', '3'),
  minDeadline: arg('min-deadline', '0.25'),
  maxDeadline: arg('max-deadline', '8'),
  epoch: arg('epoch', '4'),
  cpuFraction: arg('cpu-fraction', '0.2'),
  allocator: arg('allocator', 'quality-aware'),
  model: arg('model', 'qwen2.5:3b'),
  driftModel: arg('drift-model', ''),
  driftAt: arg('drift-at', '60'),
  controllerGain: arg('controller-gain', '1.5'),
  messagingReserve: arg('messaging-reserve', '0.05'),
  campaign: arg('campaign', 'journal-main'),
  gpuEnergy: arg('gpu-energy', 'false'),
  profile: arg('profile', '')
};

function runOne(policy, traffic, seed) {
  const args = [
    'controller/run_live_experiment.mjs',
    '--policy', policy,
    '--allocator', common.allocator,
    '--traffic', traffic,
    '--duration', common.duration,
    '--rate', common.rate,
    '--capacity', common.capacity,
    '--alpha', common.alpha,
    '--fixed-deadline', common.fixedDeadline,
    '--min-deadline', common.minDeadline,
    '--max-deadline', common.maxDeadline,
    '--epoch', common.epoch,
    '--cpu-fraction', common.cpuFraction,
    '--seed', String(seed),
    '--model', common.model
    ,'--drift-model', common.driftModel
    ,'--drift-at', common.driftAt
    ,'--controller-gain', common.controllerGain
    ,'--messaging-reserve', common.messagingReserve
    ,'--campaign', common.campaign
    ,'--gpu-energy', common.gpuEnergy
  ];
  if (common.profile) args.push('--profile', common.profile);
  return new Promise((resolve, reject) => {
    process.stdout.write(`\n=== live run policy=${policy} traffic=${traffic} seed=${seed} ===\n`);
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Run failed with exit code ${code}`)));
  });
}

let completed = 0;
const total = policies.length * traffics.length * seeds.length;
for (const traffic of traffics) {
  for (const policy of policies) {
    for (const seed of seeds) {
      await runOne(policy, traffic, seed);
      completed += 1;
      process.stdout.write(`Completed ${completed}/${total}.\n`);
    }
  }
}
