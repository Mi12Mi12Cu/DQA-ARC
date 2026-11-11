import fs from 'node:fs';
import path from 'node:path';
import { CORPUS_VERSION } from '../datasets/tasks.mjs';
import { invertErlangB, invertTruncatedMean } from '../controller/lib/erlang.mjs';
import { generateArrivalSchedule, countDispersion } from './traffic.mjs';
import { ci95, groupBy, mean, mulberry32, quantile, readJsonl, writeCsv, writeJson } from '../controller/lib/stats.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const replayModel = arg('model', 'qwen2.5:3b');

function tokenBucketShape(times, rate, bucketCapacity, maxDelaySeconds) {
  let tokens = bucketCapacity;
  let bucketTime = 0;
  let dropped = 0;
  const shaped = [];
  for (const sourceTime of times) {
    const current = Math.max(sourceTime, bucketTime);
    tokens = Math.min(bucketCapacity, tokens + rate * Math.max(0, current - bucketTime));
    bucketTime = current;
    let scheduled = current;
    if (tokens < 1) scheduled += (1 - tokens) / rate;
    if (scheduled - sourceTime > maxDelaySeconds) {
      dropped += 1;
      continue;
    }
    tokens = Math.max(0, tokens - 1 + rate * Math.max(0, scheduled - bucketTime));
    bucketTime = scheduled;
    shaped.push({ time: scheduled, sourceTime, shapingDelay: scheduled - sourceTime });
  }
  return { shaped, dropped };
}

class MinHeap {
  constructor() { this.a = []; }
  push(x) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].time < x.time || (a[p].time === x.time && a[p].seq <= x.seq)) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = x;
  }
  pop() {
    if (!this.a.length) return null;
    const root = this.a[0];
    const x = this.a.pop();
    if (this.a.length) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= this.a.length) break;
        if (c + 1 < this.a.length && (this.a[c + 1].time < this.a[c].time || (this.a[c + 1].time === this.a[c].time && this.a[c + 1].seq < this.a[c].seq))) c += 1;
        if (this.a[c].time > x.time || (this.a[c].time === x.time && this.a[c].seq >= x.seq)) break;
        this.a[i] = this.a[c];
        i = c;
      }
      this.a[i] = x;
    }
    return root;
  }
  get length() { return this.a.length; }
}

function newestProfile(model, split) {
  const dir = path.join('experiments', 'model_profiles');
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(dir, name))
    .filter((file) => {
      const rows = readJsonl(file);
      return rows.length >= 200 && rows[0]?.corpusVersion === CORPUS_VERSION && rows[0]?.model === model && rows[0]?.split === split;
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

const calibrationFile = newestProfile(replayModel, 'calibration');
const evaluationFile = newestProfile(replayModel, 'evaluation');
if (!calibrationFile || !evaluationFile) throw new Error(`Full ${replayModel} profiles are required.`);
const calibration = readJsonl(calibrationFile);
const evaluation = readJsonl(evaluationFile);
const empirical = {};
for (const mode of ['gpu', 'cpu']) {
  const byClass = {};
  for (const taskClass of ['instant', 'history', 'log']) {
    const candidates = [];
    for (const [configId, rows] of groupBy(calibration.filter((x) => x.mode === mode && x.taskClass === taskClass), (x) => x.configId)) {
      candidates.push({
        configId,
        accuracy: mean(rows.map((x) => Number(Boolean(x.correct && x.validJson)))),
        validity: mean(rows.map((x) => Number(Boolean(x.validJson)))),
        p95: quantile(rows.map((x) => x.wallSeconds), 0.95),
        tokens: mean(rows.map((x) => x.promptTokens).filter(Number.isFinite)) + rows[0].maxOutputTokens
      });
    }
    candidates.sort((a, b) => b.accuracy - a.accuracy || b.validity - a.validity || a.p95 - b.p95 || a.tokens - b.tokens);
    const selectedConfig = candidates[0]?.configId;
    const cal = calibration.filter((x) => x.mode === mode && x.taskClass === taskClass && x.configId === selectedConfig);
    const evalRows = evaluation.filter((x) => x.mode === mode && x.taskClass === taskClass && x.configId === selectedConfig);
    byClass[taskClass] = {
      selectedConfig,
      service: cal.map((x) => x.wallSeconds),
      quality: evalRows.map((x) => Boolean(x.correct && x.validJson))
    };
  }
  const service = Object.values(byClass).flatMap((x) => x.service);
  const quality = Object.values(byClass).flatMap((x) => x.quality);
  empirical[mode] = {
    byClass, service, quality,
    mean: mean(service),
    p95: quantile(service, 0.95)
  };
}

function sample(random, values) {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

function simulate(config) {
  const random = mulberry32(config.seed * 2654435761);
  const offeredArrivals = generateArrivalSchedule({ type: config.traffic, durationSeconds: config.durationSeconds, meanRate: config.rate, seed: config.seed });
  const shapedResult = config.policy === 'burst-guarded'
    ? tokenBucketShape(offeredArrivals, config.bucketRate, config.bucketCapacity, config.maxShapingDelay)
    : { shaped: offeredArrivals.map((time) => ({ time, sourceTime: time, shapingDelay: 0 })), dropped: 0 };
  const arrivals = shapedResult.shaped;
  const dispersion = countDispersion(arrivals.map((x) => x.time), config.durationSeconds, 1).index;
  const heap = new MinHeap();
  let seq = 0;
  for (const arrival of arrivals) heap.push({ ...arrival, seq: seq += 1, type: 'arrival' });
  for (let t = config.epochSeconds; t <= config.durationSeconds; t += config.epochSeconds) heap.push({ time: t, seq: seq += 1, type: 'epoch' });

  const targetLoad = invertErlangB(config.capacity, config.alpha);
  const initialUpper = config.rate + 1.645 * Math.sqrt(config.rate / config.epochSeconds);
  const initialMeanTarget = targetLoad / initialUpper;
  const directSamples = { gpu: empirical.gpu.service, cpu: empirical.cpu.service };
  const weights = { gpu: 1 - config.cpuFraction, cpu: config.cpuFraction };
  let commonDeadline;
  if (config.policy === 'fixed') commonDeadline = config.fixedDeadline;
  else if (config.policy === 'analytical') commonDeadline = Math.max(config.minDeadline, Math.min(config.maxDeadline, initialMeanTarget));
  else commonDeadline = invertTruncatedMean(directSamples, weights, initialMeanTarget, config.minDeadline, config.maxDeadline);

  const records = new Map();
  const subscribers = { gpu: { queue: [], busy: false }, cpu: { queue: [], busy: false } };
  const counts = { offered: offeredArrivals.length, published: 0, shaperDropped: shapedResult.dropped, admitted: 0, blocked: 0, expired: 0, completed: 0, correct: 0, late: 0, rerouted: 0 };
  let shapingDelaySum = 0;
  let epochArrivals = 0;
  let epochBlocked = 0;
  let lambdaHat = config.rate;
  let smoothedBlocking = config.alpha;
  let classCounts = { gpu: 0, cpu: 0 };
  let occupancyArea = 0;
  let occupancyLastTime = 0;
  let occupancyLast = 0;
  let maxOccupancy = 0;

  function updateOccupancy(time) {
    const boundedTime = Math.min(time, config.durationSeconds);
    if (boundedTime > occupancyLastTime) occupancyArea += occupancyLast * (boundedTime - occupancyLastTime);
    occupancyLastTime = Math.max(occupancyLastTime, boundedTime);
    occupancyLast = records.size;
    maxOccupancy = Math.max(maxOccupancy, records.size);
  }

  function qualityFloor(mode) {
    const outstanding = subscribers[mode].queue.length + Number(subscribers[mode].busy);
    return Math.max(config.minDeadline, empirical[mode].p95 + outstanding * empirical[mode].mean + config.messagingReserveSeconds);
  }

  function predicted(mode) {
    return (subscribers[mode].queue.length + Number(subscribers[mode].busy) + 1) * empirical[mode].mean;
  }

  function route(preferred) {
    if (!['guarded', 'burst-guarded'].includes(config.policy)) return preferred;
    if (qualityFloor(preferred) <= config.maxDeadline) return preferred;
    const other = preferred === 'gpu' ? 'cpu' : 'gpu';
    if (qualityFloor(other) <= config.maxDeadline) return other;
    return predicted('gpu') <= predicted('cpu') ? 'gpu' : 'cpu';
  }

  function startNext(mode, now) {
    const subscriber = subscribers[mode];
    while (!subscriber.busy && subscriber.queue.length) {
      const job = subscriber.queue.shift();
      if (!records.has(job.id) || job.expiry <= now) continue;
      subscriber.busy = true;
      job.service = sample(random, empirical[mode].byClass[job.taskClass].service);
      heap.push({ time: now + job.service, seq: seq += 1, type: 'completion', job });
    }
  }

  let idCounter = 0;
  while (heap.length) {
    const event = heap.pop();
    const now = event.time;
    if (event.type === 'arrival') {
      counts.published += 1;
      shapingDelaySum += event.shapingDelay ?? 0;
      epochArrivals += 1;
      const preferred = random() < config.cpuFraction ? 'cpu' : 'gpu';
      const taskClass = ['instant', 'history', 'log'][(counts.published - 1) % 3];
      if (records.size >= config.capacity) {
        counts.blocked += 1;
        epochBlocked += 1;
        continue;
      }
      const mode = route(preferred);
      if (mode !== preferred) counts.rerouted += 1;
      classCounts[mode] += 1;
      const deadline = ['guarded', 'burst-guarded'].includes(config.policy) ? Math.min(config.maxDeadline, Math.max(commonDeadline, qualityFloor(mode))) : commonDeadline;
      const job = { id: idCounter += 1, mode, taskClass, admitted: now, expiry: now + deadline };
      updateOccupancy(now);
      records.set(job.id, job);
      updateOccupancy(now);
      counts.admitted += 1;
      heap.push({ time: job.expiry, seq: seq += 1, type: 'expiry', job });
      subscribers[mode].queue.push(job);
      startNext(mode, now);
    } else if (event.type === 'completion') {
      const { job } = event;
      subscribers[job.mode].busy = false;
      if (records.has(job.id)) {
        updateOccupancy(now);
        records.delete(job.id);
        updateOccupancy(now);
        counts.completed += 1;
        if (sample(random, empirical[job.mode].byClass[job.taskClass].quality)) counts.correct += 1;
      } else counts.late += 1;
      startNext(job.mode, now);
    } else if (event.type === 'expiry') {
      const { job } = event;
      if (records.has(job.id)) {
        updateOccupancy(now);
        records.delete(job.id);
        updateOccupancy(now);
        counts.expired += 1;
      }
    } else if (event.type === 'epoch') {
      const observedRate = epochArrivals / config.epochSeconds;
      lambdaHat = 0.5 * lambdaHat + 0.5 * observedRate;
      const upper = Math.max(0.01, lambdaHat + 1.645 * Math.sqrt(Math.max(lambdaHat, 0.01) / config.epochSeconds));
      const observedBlocking = epochArrivals ? epochBlocked / epochArrivals : 0;
      smoothedBlocking = 0.7 * smoothedBlocking + 0.3 * observedBlocking;
      const meanTarget = targetLoad / upper;
      let feedforward = Math.max(config.minDeadline, Math.min(config.maxDeadline, meanTarget));
      if (['calibrated', 'adaptive', 'guarded', 'burst-guarded'].includes(config.policy)) {
        const total = classCounts.gpu + classCounts.cpu;
        const currentWeights = total ? { gpu: classCounts.gpu / total, cpu: classCounts.cpu / total } : weights;
        feedforward = invertTruncatedMean(directSamples, currentWeights, meanTarget, config.minDeadline, config.maxDeadline);
      }
      if (config.policy === 'fixed') commonDeadline = config.fixedDeadline;
      else if (['adaptive', 'guarded', 'burst-guarded'].includes(config.policy)) {
        const feedback = Math.max(config.minDeadline, Math.min(config.maxDeadline, commonDeadline * Math.exp(config.controllerGain * (config.alpha - smoothedBlocking))));
        const candidate = Math.min(feedforward, feedback);
        commonDeadline = Math.max(config.minDeadline, Math.min(config.maxDeadline, Math.max(commonDeadline * 0.7, Math.min(commonDeadline * 1.3, candidate))));
      } else commonDeadline = feedforward;
      epochArrivals = 0;
      epochBlocked = 0;
    }
  }
  updateOccupancy(config.durationSeconds);
  return {
    policy: config.policy,
    traffic: config.traffic,
    capacity: config.capacity,
    rate: config.rate,
    cpuFraction: config.cpuFraction,
    seed: config.seed,
    arrivals: counts.published,
    offeredArrivals: counts.offered,
    realizedRate: counts.offered / config.durationSeconds,
    dispersion,
    ...counts,
    blocking: counts.published ? counts.blocked / counts.published : 0,
    shapingDrop: counts.offered ? counts.shaperDropped / counts.offered : 0,
    totalAdmissionLoss: counts.offered ? (counts.shaperDropped + counts.blocked) / counts.offered : 0,
    meanShapingDelay: counts.published ? shapingDelaySum / counts.published : 0,
    expiry: counts.admitted ? counts.expired / counts.admitted : 0,
    completion: counts.admitted ? counts.completed / counts.admitted : 0,
    goodput: counts.correct / config.durationSeconds,
    accuracy: counts.completed ? counts.correct / counts.completed : 0,
    meanOccupancy: occupancyArea / config.durationSeconds,
    maxOccupancy,
    finalDeadline: commonDeadline
  };
}

const base = { durationSeconds: 300, rate: 4, capacity: 4, alpha: 0.05, fixedDeadline: 3, minDeadline: 0.25, maxDeadline: 8, epochSeconds: 5, cpuFraction: 0.2, messagingReserveSeconds: 0.05, controllerGain: 1.5, bucketRate: 3.8, bucketCapacity: 4, maxShapingDelay: 2 };
const jobs = [];
for (const traffic of ['poisson', 'mmpp', 'synchronized']) {
  for (const policy of ['fixed', 'analytical', 'calibrated', 'adaptive', 'guarded', 'burst-guarded']) {
    for (const capacity of [4, 8, 12]) {
      for (let seed = 1; seed <= 100; seed += 1) jobs.push({ ...base, traffic, policy, capacity, seed });
    }
  }
}
for (const traffic of ['poisson', 'mmpp']) {
  for (const policy of ['fixed', 'calibrated', 'guarded', 'burst-guarded']) {
    for (const capacity of [4, 8]) {
      for (const cpuFraction of [0, 0.2, 0.5]) {
        for (let seed = 101; seed <= 150; seed += 1) jobs.push({ ...base, traffic, policy, capacity, cpuFraction, seed });
      }
    }
  }
}
for (const traffic of ['poisson', 'mmpp']) {
  for (const policy of ['fixed', 'analytical', 'calibrated', 'guarded', 'burst-guarded']) {
    for (const rate of [2, 4, 6, 8]) {
      for (let seed = 201; seed <= 250; seed += 1) jobs.push({ ...base, traffic, policy, capacity: 8, rate, seed });
    }
  }
}

process.stdout.write(`Running ${jobs.length} empirical-replay simulations.\n`);
const rows = [];
for (let i = 0; i < jobs.length; i += 1) {
  rows.push(simulate(jobs[i]));
  if ((i + 1) % 1000 === 0) process.stdout.write(`  ${i + 1}/${jobs.length}\n`);
}
writeCsv(path.join('experiments', 'replay_runs', 'empirical_replay_runs.csv'), rows);

const aggregate = [];
for (const [key, items] of groupBy(rows, (r) => `${r.traffic}|${r.policy}|${r.capacity}|${r.rate}|${r.cpuFraction}`)) {
  const [traffic, policy, capacity, rate, cpuFraction] = key.split('|');
  const out = { traffic, policy, capacity: Number(capacity), rate: Number(rate), cpuFraction: Number(cpuFraction), n: items.length };
  for (const field of ['blocking', 'shapingDrop', 'totalAdmissionLoss', 'meanShapingDelay', 'expiry', 'completion', 'goodput', 'accuracy', 'meanOccupancy', 'rerouted', 'dispersion', 'finalDeadline']) {
    const ci = ci95(items.map((x) => x[field]));
    out[`${field}Mean`] = ci.mean;
    out[`${field}Ci95`] = ci.halfWidth;
  }
  aggregate.push(out);
}
aggregate.sort((a, b) => a.traffic.localeCompare(b.traffic) || a.policy.localeCompare(b.policy) || a.capacity - b.capacity || a.rate - b.rate || a.cpuFraction - b.cpuFraction);
writeCsv(path.join('experiments', 'replay_runs', 'empirical_replay_aggregate.csv'), aggregate);
writeJson(path.join('experiments', 'replay_runs', 'empirical_replay_metadata.json'), {
  generatedAt: new Date().toISOString(),
  runs: rows.length,
  calibrationFile,
  evaluationFile,
  replayModel,
  empirical,
  base
});
process.stdout.write(`Completed ${rows.length} simulations.\n`);
