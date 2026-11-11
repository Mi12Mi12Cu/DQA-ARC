import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import mqtt from 'mqtt';
import { once } from 'node:events';
import { allTasks, buildPrompt, CORPUS_VERSION, INFERENCE_CONFIGS, parseAction } from '../datasets/tasks.mjs';
import { invertErlangB, invertTruncatedMean } from './lib/erlang.mjs';
import { generateArrivalScheduleDetailed, countDispersion } from '../workloads/traffic.mjs';
import { groupBy, mean, mulberry32, quantile, readJsonl, timestampTag, writeCsv, writeJson, writeJsonl } from './lib/stats.mjs';
import { admissionDecision, STANDARD_ADMISSION_POLICIES } from './lib/admission.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const cfg = {
  policy: arg('policy', 'adaptive'),
  allocator: arg('allocator', 'quality-aware'),
  traffic: arg('traffic', 'poisson'),
  durationSeconds: Number(arg('duration', '30')),
  meanRate: Number(arg('rate', '5')),
  capacity: Number(arg('capacity', '8')),
  alpha: Number(arg('alpha', '0.05')),
  fixedDeadline: Number(arg('fixed-deadline', '3')),
  minDeadline: Number(arg('min-deadline', '0.25')),
  maxDeadline: Number(arg('max-deadline', '8')),
  epochSeconds: Number(arg('epoch', '5')),
  cpuFraction: Number(arg('cpu-fraction', '0.25')),
  seed: Number(arg('seed', '1')),
  model: arg('model', 'qwen2.5:3b'),
  driftModel: arg('drift-model', ''),
  driftAtSeconds: Number(arg('drift-at', '60')),
  controllerGain: Number(arg('controller-gain', '1.5')),
  messagingReserveSeconds: Number(arg('messaging-reserve', '0.05')),
  campaign: arg('campaign', 'journal'),
  sampleGpuEnergy: arg('gpu-energy', 'false') === 'true',
  profileFile: arg('profile', ''),
  brokerPort: Number(arg('broker-port', '18884')),
  mosquittoPath: arg('mosquitto', 'C:\\Program Files\\mosquitto\\mosquitto.exe')
};
cfg.occupancyThreshold = Number(arg('occupancy-threshold', String(Math.ceil(0.75 * cfg.capacity))));
cfg.reservedCpuSlots = Number(arg('reserved-cpu-slots', String(Math.ceil(cfg.cpuFraction * cfg.capacity))));

const TOPICS = {
  requests: 'arc/requests',
  completions: 'arc/completions',
  jobs: (hardware) => `arc/jobs/${hardware}`,
  replies: 'arc/replies'
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newestProfile(model) {
  const dir = path.resolve('experiments', 'model_profiles');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl') && name.includes('calibration'))
    .map((name) => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const file of files) {
    const first = readJsonl(file)[0];
    if (first?.model === model && first?.corpusVersion === CORPUS_VERSION) return file;
  }
  return null;
}

function buildProfile(rows) {
  const table = {};
  const tableByClass = {};
  const rawSamples = {};
  const rawSamplesByClass = {};
  for (const [key, items] of groupBy(rows.filter((r) => !r.error), (r) => `${r.mode}|${r.configId}`)) {
    const [mode, configId] = key.split('|');
    table[mode] ??= {};
    rawSamples[mode] ??= {};
    const latencies = items.map((r) => r.wallSeconds);
    table[mode][configId] = {
      accuracy: mean(items.map((r) => Number(r.correct && r.validJson))),
      jsonValidity: mean(items.map((r) => Number(r.validJson))),
      meanSeconds: mean(latencies),
      p95Seconds: quantile(latencies, 0.95),
      meanPromptTokens: mean(items.map((r) => r.promptTokens).filter(Number.isFinite)),
      maxOutputTokens: items[0].maxOutputTokens,
      contextTier: items[0].contextTier
    };
    rawSamples[mode][configId] = latencies;
  }
  for (const [key, items] of groupBy(rows.filter((r) => !r.error), (r) => `${r.mode}|${r.taskClass ?? 'instant'}|${r.configId}`)) {
    const [mode, taskClass, configId] = key.split('|');
    tableByClass[mode] ??= {};
    tableByClass[mode][taskClass] ??= {};
    rawSamplesByClass[mode] ??= {};
    rawSamplesByClass[mode][taskClass] ??= {};
    const latencies = items.map((r) => r.wallSeconds);
    tableByClass[mode][taskClass][configId] = {
      accuracy: mean(items.map((r) => Number(r.correct && r.validJson))),
      jsonValidity: mean(items.map((r) => Number(r.validJson))),
      meanSeconds: mean(latencies),
      p95Seconds: quantile(latencies, 0.95),
      meanPromptTokens: mean(items.map((r) => r.promptTokens).filter(Number.isFinite)),
      maxOutputTokens: items[0].maxOutputTokens,
      contextTier: items[0].contextTier
    };
    rawSamplesByClass[mode][taskClass][configId] = latencies;
  }
  return { table, tableByClass, rawSamples, rawSamplesByClass };
}

function chooseConfig(profile, hardware, deadlineSeconds, allocator, taskClass = 'instant') {
  if (allocator === 'static-compact') return INFERENCE_CONFIGS.find((x) => x.id === 'compact-24');
  if (allocator === 'static-max') return INFERENCE_CONFIGS.find((x) => x.id === 'extended-48');
  const source = profile.tableByClass[hardware]?.[taskClass] ?? profile.table[hardware] ?? {};
  const rows = INFERENCE_CONFIGS.map((config) => ({ config, ...(source[config.id] ?? {}) }))
    .filter((x) => Number.isFinite(x.p95Seconds));
  if (!rows.length) return INFERENCE_CONFIGS.find((x) => x.id === 'compact-24');
  const feasible = rows.filter((x) => x.p95Seconds <= Math.max(0.05, deadlineSeconds - 0.05));
  const candidates = feasible.length ? feasible : rows;
  if (allocator === 'token-max') {
    candidates.sort((a, b) => ((b.meanPromptTokens ?? 0) + b.config.maxOutputTokens) - ((a.meanPromptTokens ?? 0) + a.config.maxOutputTokens) || a.p95Seconds - b.p95Seconds);
  } else {
    candidates.sort((a, b) => (b.accuracy - a.accuracy) || (b.jsonValidity - a.jsonValidity) || (a.p95Seconds - b.p95Seconds) || (a.meanPromptTokens - b.meanPromptTokens));
  }
  return candidates[0].config;
}

async function connectClient(clientId, port) {
  const client = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
    clientId,
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 5000
  });
  await once(client, 'connect');
  return client;
}

async function waitPort(port, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    });
    if (ok) return;
    await sleep(200);
  }
  throw new Error(`Broker port ${port} did not open`);
}

function tasklistRssBytes(pid) {
  try {
    const output = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const match = output.match(/"([\d,]+) K"\s*$/m);
    return match ? Number(match[1].replaceAll(',', '')) * 1024 : null;
  } catch {
    return null;
  }
}

function gpuPowerWatts() {
  if (!cfg.sampleGpuEnergy) return null;
  try {
    const output = execFileSync('nvidia-smi.exe', ['--query-gpu=power.draw', '--format=csv,noheader,nounits'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000
    });
    const value = Number(String(output).trim().split(/\r?\n/)[0]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const profileFile = cfg.profileFile ? path.resolve(cfg.profileFile) : newestProfile(cfg.model);
if (!profileFile) throw new Error(`No calibration profile found for ${cfg.model}. Run subscribers/profile_llm.mjs first.`);
const profileRows = readJsonl(profileFile).filter((r) => r.model === cfg.model && r.corpusVersion === CORPUS_VERSION && r.split === 'calibration');
const profile = buildProfile(profileRows);
if (!profile.table.gpu || !profile.table.cpu) throw new Error('Calibration profile must contain both gpu and cpu rows.');

const brokerLog = [];
const broker = spawn(cfg.mosquittoPath, ['-c', path.resolve('config', 'mosquitto-experiment.conf'), '-v'], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});
broker.stdout.on('data', (b) => brokerLog.push(String(b)));
broker.stderr.on('data', (b) => brokerLog.push(String(b)));
await waitPort(cfg.brokerPort);

const events = [];
const epochs = [];
const resourceSamples = [];
const records = new Map();
const tombstones = new Map();
const subscribersByHardware = {};
const serviceSamples = {
  gpu: Object.fromEntries(INFERENCE_CONFIGS.map((x) => [x.id, [...(profile.rawSamples.gpu[x.id] ?? [])]])),
  cpu: Object.fromEntries(INFERENCE_CONFIGS.map((x) => [x.id, [...(profile.rawSamples.cpu[x.id] ?? [])]]))
};
const taskClasses = ['instant', 'history', 'log'];
const mixedServiceSamples = Object.fromEntries(['gpu', 'cpu'].map((hardware) => {
  const samples = taskClasses.flatMap((taskClass) => {
    const selected = chooseConfig(profile, hardware, cfg.fixedDeadline, cfg.allocator, taskClass);
    return profile.rawSamplesByClass[hardware]?.[taskClass]?.[selected.id] ?? profile.rawSamples[hardware][selected.id] ?? [];
  });
  return [hardware, [...samples]];
}));
const counts = { published: 0, admitted: 0, blocked: 0, expired: 0, completed: 0, completedOnTime: 0, correctOnTime: 0, correctOnTimeGpu: 0, correctOnTimeCpu: 0, late: 0, rerouted: 0, errors: 0 };
const classOutcomeCounts = Object.fromEntries(['gpu', 'cpu'].map((hardware) => [hardware, {
  published: 0, admitted: 0, blocked: 0, expired: 0, completedOnTime: 0, correctOnTime: 0, late: 0
}]));
let maxOccupancy = 0;
const offeredLoadTarget = invertErlangB(cfg.capacity, cfg.alpha);
const initialLambdaUpper = cfg.meanRate + 1.645 * Math.sqrt(Math.max(cfg.meanRate, 0.01) / cfg.epochSeconds);
const initialMeanTarget = offeredLoadTarget / initialLambdaUpper;
let deadlineSeconds;
if (cfg.policy === 'fixed' || STANDARD_ADMISSION_POLICIES.has(cfg.policy)) {
  deadlineSeconds = cfg.fixedDeadline;
} else if (cfg.policy === 'analytical') {
  deadlineSeconds = Math.max(cfg.minDeadline, Math.min(cfg.maxDeadline, initialMeanTarget));
} else {
  deadlineSeconds = invertTruncatedMean(
    mixedServiceSamples,
    { gpu: 1 - cfg.cpuFraction, cpu: cfg.cpuFraction },
    initialMeanTarget,
    cfg.minDeadline,
    cfg.maxDeadline
  );
}
let lambdaHat = cfg.meanRate;
let smoothedBlocking = cfg.alpha;
let epochArrivals = 0;
let epochBlocked = 0;
let epochCompletions = 0;
let epochCorrect = 0;
let classCounts = { gpu: 0, cpu: 0 };

const controller = await connectClient(`controller-${cfg.seed}`, cfg.brokerPort);
await controller.subscribeAsync([TOPICS.requests, TOPICS.completions], { qos: 1 });

function logEvent(type, data = {}) {
  events.push({ wallTime: new Date().toISOString(), elapsedSeconds: (performance.now() - experimentStart) / 1000, type, ...data });
}

function qualityDeadlineFloor(hardware, config, outstandingAhead = 0, taskClass = 'instant') {
  const row = profile.tableByClass[hardware]?.[taskClass]?.[config.id] ?? profile.table[hardware]?.[config.id];
  const p95 = row?.p95Seconds ?? cfg.minDeadline;
  const meanService = row?.meanSeconds ?? p95;
  return Math.max(cfg.minDeadline, p95 + outstandingAhead * meanService + cfg.messagingReserveSeconds);
}

function routeGuarded(preferredHardware, taskClass) {
  const candidates = ['gpu', 'cpu'].map((hardware) => {
    const config = chooseConfig(profile, hardware, Math.max(deadlineSeconds, cfg.fixedDeadline), cfg.allocator, taskClass);
    const row = profile.tableByClass[hardware]?.[taskClass]?.[config.id] ?? profile.table[hardware]?.[config.id];
    const meanService = row?.meanSeconds ?? 1;
    const subscriber = subscribersByHardware[hardware];
    const outstanding = subscriber ? subscriber.queue.length + Number(subscriber.busy) : 0;
    const predictedSeconds = (outstanding + 1) * meanService;
    const floorSeconds = qualityDeadlineFloor(hardware, config, outstanding, taskClass);
    return { hardware, config, predictedSeconds, floorSeconds, feasible: floorSeconds <= cfg.maxDeadline };
  });
  const preferred = candidates.find((x) => x.hardware === preferredHardware);
  if (preferred?.feasible) return preferred;
  const feasible = candidates.filter((x) => x.feasible)
    .sort((a, b) => (a.predictedSeconds / a.floorSeconds) - (b.predictedSeconds / b.floorSeconds));
  if (feasible.length) return feasible[0];
  return candidates.sort((a, b) => a.predictedSeconds - b.predictedSeconds)[0];
}

async function publishReply(value, correlationData) {
  await controller.publishAsync(TOPICS.replies, JSON.stringify(value), { qos: 1, properties: { correlationData } });
}

controller.on('message', async (topic, payload, packet) => {
  try {
    const message = JSON.parse(payload.toString('utf8'));
    if (topic === TOPICS.requests) {
      epochArrivals += 1;
      const preferredHardware = message.hardware;
      const decision = admissionDecision({
        policy: cfg.policy,
        preferredHardware,
        occupancy: records.size,
        capacity: cfg.capacity,
        occupancyThreshold: cfg.occupancyThreshold,
        reservedCpuSlots: cfg.reservedCpuSlots
      });
      if (!decision.accepted) {
        counts.blocked += 1;
        classOutcomeCounts[preferredHardware].blocked += 1;
        epochBlocked += 1;
        logEvent('blocked', { id: message.id, taskClass: message.task.taskClass, occupancy: records.size, preferredHardware, hardware: preferredHardware, admissionLimit: decision.limit, admissionPolicy: cfg.policy });
        await publishReply({ id: message.id, status: 'blocked' }, packet.properties?.correlationData);
        return;
      }
      const route = cfg.policy === 'guarded'
        ? routeGuarded(preferredHardware, message.task.taskClass)
        : {
            hardware: preferredHardware,
            config: chooseConfig(profile, preferredHardware, deadlineSeconds, cfg.allocator, message.task.taskClass),
            floorSeconds: cfg.minDeadline,
            predictedSeconds: null
          };
      const hardware = route.hardware;
      const config = route.config;
      if (hardware !== preferredHardware) counts.rerouted += 1;
      classCounts[hardware] = (classCounts[hardware] ?? 0) + 1;
      const recordDeadlineSeconds = cfg.policy === 'guarded'
        ? Math.min(cfg.maxDeadline, Math.max(deadlineSeconds, route.floorSeconds))
        : deadlineSeconds;
      const admittedAt = performance.now();
      const expiresAt = admittedAt + recordDeadlineSeconds * 1000;
      const timer = setTimeout(async () => {
        const record = records.get(message.id);
        if (!record) return;
        records.delete(message.id);
        tombstones.set(message.id, record);
        counts.expired += 1;
        classOutcomeCounts[record.preferredHardware].expired += 1;
        logEvent('expired', { id: message.id, preferredHardware: record.preferredHardware, hardware: record.hardware, retentionSeconds: (performance.now() - record.admittedAt) / 1000, deadlineSeconds: record.deadlineSeconds, occupancy: records.size });
        await publishReply({ id: message.id, status: 'expired' }, Buffer.from(message.id));
      }, recordDeadlineSeconds * 1000);
      const record = { ...message, preferredHardware, hardware, admittedAt, expiresAt, deadlineSeconds: recordDeadlineSeconds, config, timer };
      records.set(message.id, record);
      counts.admitted += 1;
      classOutcomeCounts[preferredHardware].admitted += 1;
      maxOccupancy = Math.max(maxOccupancy, records.size);
      logEvent('admitted', { id: message.id, taskClass: message.task.taskClass, occupancy: records.size, preferredHardware, hardware, rerouted: hardware !== preferredHardware, predictedSeconds: route.predictedSeconds, floorSeconds: route.floorSeconds, deadlineSeconds: recordDeadlineSeconds, configId: config.id });
      const job = { ...message, preferredHardware, hardware, deadlineSeconds: recordDeadlineSeconds, config, admittedWallTime: new Date().toISOString() };
      await controller.publishAsync(TOPICS.jobs(hardware), JSON.stringify(job), {
        qos: 1,
        properties: {
          responseTopic: TOPICS.completions,
          correlationData: Buffer.from(message.id),
          messageExpiryInterval: Math.max(1, Math.ceil(recordDeadlineSeconds)),
          userProperties: { 'app-deadline-ms': String(Math.round(recordDeadlineSeconds * 1000)), 'inference-config': config.id, 'subscriber-class': hardware }
        }
      });
    } else if (topic === TOPICS.completions) {
      const record = records.get(message.id) ?? tombstones.get(message.id);
      if (!record) return;
      const endToEndSeconds = (performance.now() - record.admittedAt) / 1000;
      serviceSamples[record.hardware][record.config.id].push(endToEndSeconds);
      if (serviceSamples[record.hardware][record.config.id].length > 200) serviceSamples[record.hardware][record.config.id].shift();
      mixedServiceSamples[record.hardware].push(endToEndSeconds);
      if (mixedServiceSamples[record.hardware].length > 600) mixedServiceSamples[record.hardware].shift();
      if (records.has(message.id)) {
        clearTimeout(record.timer);
        records.delete(message.id);
        counts.completed += 1;
        counts.completedOnTime += 1;
        classOutcomeCounts[record.preferredHardware].completedOnTime += 1;
        epochCompletions += 1;
        if (message.correct) {
          counts.correctOnTime += 1;
          counts[record.hardware === 'gpu' ? 'correctOnTimeGpu' : 'correctOnTimeCpu'] += 1;
          classOutcomeCounts[record.preferredHardware].correctOnTime += 1;
          epochCorrect += 1;
        }
        logEvent('completed', { ...message, endToEndSeconds, occupancy: records.size, deadlineSeconds: record.deadlineSeconds });
        await publishReply({ id: message.id, status: 'completed', action: message.action, correct: message.correct }, Buffer.from(message.id));
      } else {
        tombstones.delete(message.id);
        counts.late += 1;
        classOutcomeCounts[record.preferredHardware].late += 1;
        logEvent('late-completion', { ...message, endToEndSeconds, deadlineSeconds: record.deadlineSeconds });
      }
    }
  } catch (error) {
    counts.errors += 1;
    logEvent('controller-error', { error: String(error?.stack ?? error) });
  }
});

class Subscriber {
  constructor(hardware, endpoint) {
    this.hardware = hardware;
    this.endpoint = endpoint;
    this.queue = [];
    this.busy = false;
    this.client = null;
  }

  async start() {
    this.client = await connectClient(`subscriber-${this.hardware}-${cfg.seed}`, cfg.brokerPort);
    await this.client.subscribeAsync(TOPICS.jobs(this.hardware), { qos: 1 });
    this.client.on('message', (_topic, payload) => {
      this.queue.push(JSON.parse(payload.toString('utf8')));
      this.pump();
    });
  }

  async pump() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const job = this.queue.shift();
    const startedAt = performance.now();
    let completion;
    try {
      const queueAgeSeconds = (Date.now() - Date.parse(job.admittedWallTime)) / 1000;
      if (queueAgeSeconds >= job.deadlineSeconds) {
        completion = {
          id: job.id,
          hardware: this.hardware,
          configId: job.config.id,
          action: null,
          semanticCorrect: false,
          correct: false,
          validJson: false,
          subscriberWallSeconds: 0,
          queueAgeSeconds,
          skippedExpired: true,
          error: null
        };
      } else {
      const prompt = buildPrompt(job.task, job.config.contextTier);
      const elapsed = (performance.now() - experimentStart) / 1000;
      const modelUsed = cfg.driftModel && elapsed >= cfg.driftAtSeconds ? cfg.driftModel : cfg.model;
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: modelUsed,
          prompt,
          stream: false,
          format: 'json',
          keep_alive: '30m',
          options: { temperature: 0, seed: cfg.seed + job.sequence, num_predict: job.config.maxOutputTokens, num_ctx: 4096 }
        }),
        signal: AbortSignal.timeout(180_000)
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error ?? `Ollama HTTP ${response.status}`);
      const parsed = parseAction(result.response);
      completion = {
        id: job.id,
        hardware: this.hardware,
        configId: job.config.id,
        action: parsed.action,
        semanticCorrect: parsed.action === job.task.expected,
        correct: parsed.action === job.task.expected && parsed.validJson,
        validJson: parsed.validJson,
        subscriberWallSeconds: (performance.now() - startedAt) / 1000,
        queueAgeSeconds,
        ollamaSeconds: result.total_duration / 1e9,
        promptTokens: result.prompt_eval_count,
        outputTokens: result.eval_count,
        modelUsed,
        error: null
      };
      }
    } catch (error) {
      completion = { id: job.id, hardware: this.hardware, configId: job.config.id, action: null, correct: false, validJson: false, subscriberWallSeconds: (performance.now() - startedAt) / 1000, error: String(error?.message ?? error) };
    }
    await this.client.publishAsync(TOPICS.completions, JSON.stringify(completion), { qos: 1, properties: { correlationData: Buffer.from(job.id) } });
    this.busy = false;
    setImmediate(() => this.pump());
  }

  idle() { return !this.busy && this.queue.length === 0; }
  async stop() { if (this.client) await this.client.endAsync(); }
}

const gpuSubscriber = new Subscriber('gpu', 'http://127.0.0.1:11434');
const cpuSubscriber = new Subscriber('cpu', 'http://127.0.0.1:11435');
subscribersByHardware.gpu = gpuSubscriber;
subscribersByHardware.cpu = cpuSubscriber;
await gpuSubscriber.start();
await cpuSubscriber.start();

const publisher = await connectClient(`publisher-${cfg.seed}`, cfg.brokerPort);
const protocolAcks = [];
const idleGpuPowerSamples = [];
if (cfg.sampleGpuEnergy) {
  for (let i = 0; i < 5; i += 1) {
    const power = gpuPowerWatts();
    if (Number.isFinite(power)) idleGpuPowerSamples.push(power);
    await sleep(150);
  }
}
const idleGpuPowerWatts = quantile(idleGpuPowerSamples, 0.5);
const experimentStart = performance.now();
const schedule = generateArrivalScheduleDetailed({ type: cfg.traffic, durationSeconds: cfg.durationSeconds, meanRate: cfg.meanRate, seed: cfg.seed });
const schedules = schedule.arrivals;
const dispersion = countDispersion(schedules, cfg.durationSeconds, 1);
const random = mulberry32(cfg.seed * 7919);
const tasks = allTasks().filter((t) => t.split === 'evaluation');

const epochTimer = setInterval(() => {
  const observedRate = epochArrivals / cfg.epochSeconds;
  lambdaHat = 0.5 * lambdaHat + 0.5 * observedRate;
  const lambdaUpper = Math.max(0.01, lambdaHat + 1.645 * Math.sqrt(Math.max(lambdaHat, 0.01) / cfg.epochSeconds));
  const observedBlocking = epochArrivals ? epochBlocked / epochArrivals : 0;
  smoothedBlocking = 0.7 * smoothedBlocking + 0.3 * observedBlocking;
  const meanTarget = offeredLoadTarget / lambdaUpper;
  let feedforward = Math.max(cfg.minDeadline, Math.min(cfg.maxDeadline, meanTarget));
  if (cfg.policy === 'calibrated' || cfg.policy === 'adaptive' || cfg.policy === 'guarded') {
    const totalClass = classCounts.gpu + classCounts.cpu;
    const weights = totalClass ? { gpu: classCounts.gpu / totalClass, cpu: classCounts.cpu / totalClass } : { gpu: 1 - cfg.cpuFraction, cpu: cfg.cpuFraction };
    feedforward = invertTruncatedMean(
      mixedServiceSamples,
      weights,
      meanTarget,
      cfg.minDeadline,
      cfg.maxDeadline
    );
  }
  let candidate = (cfg.policy === 'fixed' || STANDARD_ADMISSION_POLICIES.has(cfg.policy)) ? cfg.fixedDeadline : feedforward;
  let feedback = deadlineSeconds;
  if (cfg.policy === 'adaptive' || cfg.policy === 'guarded') {
    feedback = Math.max(cfg.minDeadline, Math.min(cfg.maxDeadline, deadlineSeconds * Math.exp(cfg.controllerGain * (cfg.alpha - smoothedBlocking))));
    candidate = Math.min(feedforward, feedback);
  }
  const lower = deadlineSeconds * 0.7;
  const upper = deadlineSeconds * 1.3;
  const next = Math.max(cfg.minDeadline, Math.min(cfg.maxDeadline, Math.max(lower, Math.min(upper, candidate))));
  epochs.push({
    elapsedSeconds: (performance.now() - experimentStart) / 1000,
    observedRate,
    lambdaHat,
    lambdaUpper,
    observedBlocking,
    smoothedBlocking,
    occupancy: records.size,
    deadlineSeconds,
    meanTarget,
    feedforwardSeconds: feedforward,
    feedbackSeconds: feedback,
    nextDeadlineSeconds: next,
    arrivals: epochArrivals,
    blocked: epochBlocked,
    completions: epochCompletions,
    correct: epochCorrect
  });
  deadlineSeconds = next;
  epochArrivals = 0;
  epochBlocked = 0;
  epochCompletions = 0;
  epochCorrect = 0;
}, cfg.epochSeconds * 1000);

const resourceTimer = setInterval(() => {
  resourceSamples.push({
    elapsedSeconds: (performance.now() - experimentStart) / 1000,
    brokerRssBytes: tasklistRssBytes(broker.pid),
    nodeRssBytes: process.memoryUsage().rss,
    occupancy: records.size,
    gpuQueue: gpuSubscriber.queue.length + Number(gpuSubscriber.busy),
    cpuQueue: cpuSubscriber.queue.length + Number(cpuSubscriber.busy)
    ,gpuPowerWatts: gpuPowerWatts()
  });
}, 1000);

let sequence = 0;
for (const scheduledSeconds of schedules) {
  const wait = scheduledSeconds * 1000 - (performance.now() - experimentStart);
  if (wait > 0) await sleep(wait);
  const task = tasks[sequence % tasks.length];
  const hardware = random() < cfg.cpuFraction ? 'cpu' : 'gpu';
  const id = `s${cfg.seed}-${String(sequence).padStart(5, '0')}`;
  const request = { id, sequence, hardware, task, sentWallTime: new Date().toISOString() };
  const ackStart = performance.now();
  await publisher.publishAsync(TOPICS.requests, JSON.stringify(request), {
    qos: 1,
    properties: { responseTopic: TOPICS.replies, correlationData: Buffer.from(id), userProperties: { 'request-class': task.taskClass, 'preferred-hardware': hardware } }
  });
  protocolAcks.push((performance.now() - ackStart) / 1000);
  counts.published += 1;
  classOutcomeCounts[hardware].published += 1;
  sequence += 1;
}

clearInterval(epochTimer);

const drainDeadline = performance.now() + (cfg.maxDeadline + 60) * 1000;
while (performance.now() < drainDeadline && (records.size || !gpuSubscriber.idle() || !cpuSubscriber.idle())) await sleep(200);
clearInterval(resourceTimer);
for (const record of records.values()) clearTimeout(record.timer);

const finishedAt = new Date().toISOString();
const powerRows = resourceSamples.filter((x) => Number.isFinite(x.gpuPowerWatts));
let gpuBoardEnergyJoules = 0;
let gpuDynamicEnergyJoules = 0;
for (let i = 1; i < powerRows.length; i += 1) {
  const seconds = powerRows[i].elapsedSeconds - powerRows[i - 1].elapsedSeconds;
  const averagePower = (powerRows[i].gpuPowerWatts + powerRows[i - 1].gpuPowerWatts) / 2;
  gpuBoardEnergyJoules += averagePower * seconds;
  if (Number.isFinite(idleGpuPowerWatts)) gpuDynamicEnergyJoules += Math.max(0, averagePower - idleGpuPowerWatts) * seconds;
}
const summary = {
  metadata: {
    startedAt: new Date(Date.now() - (performance.now() - experimentStart)).toISOString(),
    finishedAt,
    mosquittoVersion: '2.1.2',
    ollamaVersion: '0.40.14',
    model: cfg.model,
    brokerPid: broker.pid,
    profileFile,
    config: cfg,
    offeredLoadTarget,
    generatedArrivals: schedules.length,
    realizedMeanRate: schedules.length / cfg.durationSeconds,
    oneSecondCountDispersion: dispersion
    ,trafficStateCoverage: schedule.metadata
  },
  counts,
  classCounts: classOutcomeCounts,
  metrics: {
    applicationBlocking: counts.published ? counts.blocked / counts.published : 0,
    expiryAmongAdmitted: counts.admitted ? counts.expired / counts.admitted : 0,
    onTimeCompletionAmongAdmitted: counts.admitted ? counts.completedOnTime / counts.admitted : 0,
    qualityAdjustedGoodput: counts.correctOnTime / cfg.durationSeconds,
    onTimeAccuracy: counts.completedOnTime ? counts.correctOnTime / counts.completedOnTime : 0,
    protocolAckMeanMs: mean(protocolAcks) * 1000,
    protocolAckP95Ms: quantile(protocolAcks, 0.95) * 1000,
    maxOccupancy,
    meanOccupancy: mean(resourceSamples.map((x) => x.occupancy)),
    brokerPeakRssMiB: Math.max(...resourceSamples.map((x) => x.brokerRssBytes ?? 0)) / 1048576,
    nodePeakRssMiB: Math.max(...resourceSamples.map((x) => x.nodeRssBytes ?? 0)) / 1048576
    ,idleGpuPowerWatts
    ,gpuBoardEnergyJoules
    ,gpuDynamicEnergyJoules
    ,gpuDynamicJoulesPerCorrectGpuResult: counts.correctOnTimeGpu ? gpuDynamicEnergyJoules / counts.correctOnTimeGpu : null
    ,byPreferredClass: Object.fromEntries(Object.entries(classOutcomeCounts).map(([hardware, c]) => [hardware, {
      applicationBlocking: c.published ? c.blocked / c.published : 0,
      expiryAmongAdmitted: c.admitted ? c.expired / c.admitted : 0,
      onTimeCompletionAmongAdmitted: c.admitted ? c.completedOnTime / c.admitted : 0,
      onTimeAccuracy: c.completedOnTime ? c.correctOnTime / c.completedOnTime : 0,
      qualityAdjustedGoodput: c.correctOnTime / cfg.durationSeconds
    }]))
  }
};

const tag = timestampTag();
const runName = `${cfg.campaign}_${cfg.policy}_${cfg.allocator}_${cfg.traffic}_r${cfg.meanRate}_s${cfg.seed}_${tag}`;
const runDir = path.join('experiments', 'live_runs', runName);
writeJson(path.join(runDir, 'summary.json'), summary);
writeJsonl(path.join(runDir, 'events.jsonl'), events);
writeCsv(path.join(runDir, 'epochs.csv'), epochs);
writeCsv(path.join(runDir, 'resources.csv'), resourceSamples);
writeJson(path.join(runDir, 'broker-log.json'), { lines: brokerLog.join('').split(/\r?\n/).filter(Boolean) });

await publisher.endAsync();
await gpuSubscriber.stop();
await cpuSubscriber.stop();
await controller.endAsync();
const brokerExit = once(broker, 'exit').catch(() => []);
broker.kill();
await Promise.race([brokerExit, sleep(2000)]);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\nResults: ${runDir}\n`);
