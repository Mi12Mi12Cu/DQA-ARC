import fs from 'node:fs';
import path from 'node:path';
import { ci95, exactMcNemar, exactSignFlipTest, groupBy, mean, quantile, readJsonl, wilson95, writeCsv, writeJson } from '../controller/lib/stats.mjs';
import { CORPUS_VERSION } from '../datasets/tasks.mjs';

const analysisDir = path.join('analysis', 'results');
fs.mkdirSync(analysisDir, { recursive: true });

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

function latestBy(items, keyFn) {
  const selected = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const old = selected.get(key);
    if (!old || new Date(item.data.metadata.finishedAt) > new Date(old.data.metadata.finishedAt)) selected.set(key, item);
  }
  return [...selected.values()];
}

const summaries = walk(path.join('experiments', 'live_runs'), 'summary.json').flatMap((file) => {
  try { return [{ file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }]; } catch { return []; }
}).filter((x) => x.data.metadata?.config?.campaign?.startsWith('journal-'));

const canonicalCampaigns = new Set([
  'journal-main', 'journal-allocator-balanced', 'journal-sweep', 'journal-drift',
  'journal-standard-main', 'journal-standard-drift'
]);
const selected = latestBy(summaries, ({ data }) => {
  const c = data.metadata.config;
  return [c.campaign, c.traffic, c.policy, c.allocator, c.fixedDeadline, c.driftModel || '', c.seed].join('|');
}).filter(({ data }) => canonicalCampaigns.has(data.metadata.config.campaign));

function core(item) {
  const { data, file } = item;
  const c = data.metadata.config;
  const events = readJsonl(path.join(path.dirname(file), 'events.jsonl'));
  const completed = events.filter((x) => x.type === 'completed');
  const overhead = completed.map((x) => x.endToEndSeconds - (x.subscriberWallSeconds ?? 0) - (x.queueAgeSeconds ?? 0)).filter((x) => Number.isFinite(x) && x >= 0);
  return {
    campaign: c.campaign, traffic: c.traffic, policy: c.policy, allocator: c.allocator,
    fixedDeadline: c.fixedDeadline, driftModel: c.driftModel || '', seed: c.seed,
    occupancyThreshold: c.occupancyThreshold ?? '', reservedCpuSlots: c.reservedCpuSlots ?? '',
    durationSeconds: c.durationSeconds, published: data.counts.published, blocked: data.counts.blocked,
    admitted: data.counts.admitted, expired: data.counts.expired, correct: data.counts.correctOnTime,
    blocking: data.metrics.applicationBlocking, expiry: data.metrics.expiryAmongAdmitted,
    completion: data.metrics.onTimeCompletionAmongAdmitted, accuracy: data.metrics.onTimeAccuracy,
    goodput: data.metrics.qualityAdjustedGoodput, rerouted: data.counts.rerouted ?? 0,
    e2eP95Seconds: quantile(completed.map((x) => x.endToEndSeconds).filter(Number.isFinite), 0.95),
    messagingOverheadP99Seconds: quantile(overhead, 0.99),
    idleGpuPowerWatts: data.metrics.idleGpuPowerWatts,
    gpuDynamicEnergyJoules: data.metrics.gpuDynamicEnergyJoules,
    gpuDynamicJoulesPerCorrectGpuResult: data.metrics.gpuDynamicJoulesPerCorrectGpuResult,
    mmppTransitions: data.metadata.trafficStateCoverage?.transitions ?? null,
    mmppVisitedBoth: data.metadata.trafficStateCoverage?.visitedLow && data.metadata.trafficStateCoverage?.visitedHigh ? 1 : 0,
    runDir: path.dirname(file)
  };
}

const liveRows = selected.map(core).sort((a, b) => a.campaign.localeCompare(b.campaign) || a.traffic.localeCompare(b.traffic) || a.policy.localeCompare(b.policy) || a.allocator.localeCompare(b.allocator) || a.fixedDeadline - b.fixedDeadline || a.seed - b.seed);
const allocatorCampaign = liveRows.some((x) => x.campaign === 'journal-allocator-balanced')
  ? 'journal-allocator-balanced'
  : 'journal-allocator';
writeCsv(path.join(analysisDir, 'journal_live_runs.csv'), liveRows);

function preferredClassRows(item) {
  const { data, file } = item;
  const c = data.metadata.config;
  const events = readJsonl(path.join(path.dirname(file), 'events.jsonl'));
  const admitted = events.filter((x) => x.type === 'admitted');
  const preferredById = new Map(admitted.map((x) => [x.id, x.preferredHardware ?? x.hardware]));
  const preferred = (event) => event.preferredHardware ?? preferredById.get(event.id) ?? event.hardware;
  return ['gpu', 'cpu'].map((hardware) => {
    const admittedClass = admitted.filter((x) => preferred(x) === hardware);
    const blockedClass = events.filter((x) => x.type === 'blocked' && preferred(x) === hardware);
    const expiredClass = events.filter((x) => x.type === 'expired' && preferred(x) === hardware);
    const completedClass = events.filter((x) => x.type === 'completed' && preferred(x) === hardware);
    const correctClass = completedClass.filter((x) => x.correct);
    const published = admittedClass.length + blockedClass.length;
    return {
      campaign: c.campaign, traffic: c.traffic, policy: c.policy, allocator: c.allocator,
      fixedDeadline: c.fixedDeadline, driftModel: c.driftModel || '', seed: c.seed,
      preferredClass: hardware, published, blocked: blockedClass.length, admitted: admittedClass.length,
      expired: expiredClass.length, completed: completedClass.length, correct: correctClass.length,
      blocking: published ? blockedClass.length / published : 0,
      expiry: admittedClass.length ? expiredClass.length / admittedClass.length : 0,
      completion: admittedClass.length ? completedClass.length / admittedClass.length : 0,
      accuracy: completedClass.length ? correctClass.length / completedClass.length : 0,
      goodput: correctClass.length / c.durationSeconds,
      runDir: path.dirname(file)
    };
  });
}

const liveClassRows = selected.flatMap(preferredClassRows).sort((a, b) => a.campaign.localeCompare(b.campaign) || a.traffic.localeCompare(b.traffic) || a.policy.localeCompare(b.policy) || a.preferredClass.localeCompare(b.preferredClass) || a.seed - b.seed);
writeCsv(path.join(analysisDir, 'journal_live_class_runs.csv'), liveClassRows);

const liveClassAggregateRows = [];
for (const [key, rows] of groupBy(liveClassRows, (r) => [r.campaign, r.traffic, r.policy, r.allocator, r.fixedDeadline, r.driftModel, r.preferredClass].join('|'))) {
  const [campaign, traffic, policy, allocator, fixedDeadline, driftModel, preferredClass] = key.split('|');
  const record = { campaign, traffic, policy, allocator, fixedDeadline: Number(fixedDeadline), driftModel, preferredClass, n: rows.length };
  for (const field of ['blocking', 'expiry', 'completion', 'accuracy', 'goodput']) {
    const interval = ci95(rows.map((x) => x[field]).filter(Number.isFinite));
    record[`${field}Mean`] = interval.mean;
    record[`${field}Ci95`] = interval.halfWidth;
  }
  liveClassAggregateRows.push(record);
}
writeCsv(path.join(analysisDir, 'journal_live_class_aggregate.csv'), liveClassAggregateRows);

const aggregateRows = [];
for (const [key, rows] of groupBy(liveRows, (r) => [r.campaign, r.traffic, r.policy, r.allocator, r.fixedDeadline, r.driftModel].join('|'))) {
  const [campaign, traffic, policy, allocator, fixedDeadline, driftModel] = key.split('|');
  const record = { campaign, traffic, policy, allocator, fixedDeadline: Number(fixedDeadline), driftModel, n: rows.length };
  for (const field of ['blocking', 'expiry', 'completion', 'accuracy', 'goodput', 'rerouted', 'e2eP95Seconds', 'messagingOverheadP99Seconds', 'gpuDynamicEnergyJoules', 'gpuDynamicJoulesPerCorrectGpuResult', 'mmppTransitions', 'mmppVisitedBoth']) {
    const interval = ci95(rows.map((x) => x[field]).filter(Number.isFinite));
    record[`${field}Mean`] = interval.mean;
    record[`${field}Ci95`] = interval.halfWidth;
  }
  aggregateRows.push(record);
}
writeCsv(path.join(analysisDir, 'journal_live_aggregate.csv'), aggregateRows);

function pairedComparison(name, left, right) {
  const pairs = [];
  for (const l of left) {
    const r = right.find((x) => x.seed === l.seed);
    if (r) pairs.push({ l, r });
  }
  const record = { comparison: name, n: pairs.length };
  for (const field of ['blocking', 'expiry', 'completion', 'accuracy', 'goodput', 'gpuDynamicJoulesPerCorrectGpuResult']) {
    const differences = pairs.map(({ l, r }) => l[field] - r[field]).filter(Number.isFinite);
    const interval = ci95(differences);
    const exact = exactSignFlipTest(differences);
    record[`${field}Difference`] = interval.mean;
    record[`${field}DifferenceCi95`] = interval.halfWidth;
    record[`${field}ExactP`] = exact.pValue;
  }
  return record;
}

const pairedRows = [];
for (const traffic of ['poisson', 'mmpp']) {
  const main = liveRows.filter((x) => x.campaign === 'journal-main' && x.traffic === traffic);
  const fixed = main.filter((x) => x.policy === 'fixed');
  for (const policy of ['analytical', 'calibrated', 'adaptive', 'guarded']) pairedRows.push(pairedComparison(`main/${traffic}/${policy}-minus-fixed`, main.filter((x) => x.policy === policy), fixed));

  const allocator = liveRows.filter((x) => x.campaign === allocatorCampaign && x.traffic === traffic);
  const quality = allocator.filter((x) => x.allocator === 'quality-aware');
  for (const baseline of ['static-compact', 'static-max', 'token-max']) pairedRows.push(pairedComparison(`allocator/${traffic}/quality-minus-${baseline}`, quality, allocator.filter((x) => x.allocator === baseline)));
}
for (const traffic of ['poisson', 'rate-step']) {
  const sweep = liveRows.filter((x) => x.campaign === 'journal-sweep' && x.traffic === traffic);
  const guarded = sweep.filter((x) => x.policy === 'guarded');
  for (const deadline of [1, 2, 3, 5, 8]) pairedRows.push(pairedComparison(`sweep/${traffic}/guarded-minus-fixed-${deadline}s`, guarded, sweep.filter((x) => x.policy === 'fixed' && x.fixedDeadline === deadline)));
  const drift = liveRows.filter((x) => x.campaign === 'journal-drift' && x.traffic === traffic);
  pairedRows.push(pairedComparison(`drift/${traffic}/guarded-minus-fixed`, drift.filter((x) => x.policy === 'guarded'), drift.filter((x) => x.policy === 'fixed')));
}
writeCsv(path.join(analysisDir, 'journal_live_paired_exact.csv'), pairedRows);

function standardScenarioRows(rows) {
  return [
    ...rows.filter((x) => x.campaign === 'journal-main' && x.policy === 'guarded' && ['poisson', 'mmpp'].includes(x.traffic))
      .map((x) => ({ ...x, scenario: x.traffic, method: 'dqa-arc' })),
    ...rows.filter((x) => x.campaign === 'journal-drift' && x.policy === 'guarded' && x.traffic === 'rate-step')
      .map((x) => ({ ...x, scenario: 'drift', method: 'dqa-arc' })),
    ...rows.filter((x) => x.campaign === 'journal-standard-main' && ['poisson', 'mmpp'].includes(x.traffic))
      .map((x) => ({ ...x, scenario: x.traffic, method: x.policy })),
    ...rows.filter((x) => x.campaign === 'journal-standard-drift' && x.traffic === 'rate-step')
      .map((x) => ({ ...x, scenario: 'drift', method: x.policy }))
  ];
}

const standardRows = standardScenarioRows(liveRows).sort((a, b) => a.scenario.localeCompare(b.scenario) || a.method.localeCompare(b.method) || a.seed - b.seed);
writeCsv(path.join(analysisDir, 'standard_baseline_runs.csv'), standardRows);

const standardAggregateRows = [];
for (const [key, rows] of groupBy(standardRows, (r) => `${r.scenario}|${r.method}`)) {
  const [scenario, method] = key.split('|');
  const record = { scenario, method, n: rows.length };
  for (const field of ['blocking', 'expiry', 'completion', 'accuracy', 'goodput', 'rerouted']) {
    const interval = ci95(rows.map((x) => x[field]).filter(Number.isFinite));
    record[`${field}Mean`] = interval.mean;
    record[`${field}Ci95`] = interval.halfWidth;
  }
  standardAggregateRows.push(record);
}
writeCsv(path.join(analysisDir, 'standard_baseline_aggregate.csv'), standardAggregateRows);

const standardClassRows = standardScenarioRows(liveClassRows).sort((a, b) => a.scenario.localeCompare(b.scenario) || a.method.localeCompare(b.method) || a.preferredClass.localeCompare(b.preferredClass) || a.seed - b.seed);
writeCsv(path.join(analysisDir, 'standard_baseline_class_runs.csv'), standardClassRows);

const standardClassAggregateRows = [];
for (const [key, rows] of groupBy(standardClassRows, (r) => `${r.scenario}|${r.method}|${r.preferredClass}`)) {
  const [scenario, method, preferredClass] = key.split('|');
  const record = { scenario, method, preferredClass, n: rows.length };
  for (const field of ['blocking', 'expiry', 'completion', 'accuracy', 'goodput']) {
    const interval = ci95(rows.map((x) => x[field]).filter(Number.isFinite));
    record[`${field}Mean`] = interval.mean;
    record[`${field}Ci95`] = interval.halfWidth;
  }
  standardClassAggregateRows.push(record);
}
writeCsv(path.join(analysisDir, 'standard_baseline_class_aggregate.csv'), standardClassAggregateRows);

const standardPairedRows = [];
for (const scenario of ['poisson', 'mmpp', 'drift']) {
  const dqa = standardRows.filter((x) => x.scenario === scenario && x.method === 'dqa-arc');
  for (const baseline of ['occupancy-threshold', 'static-reservation', 'threshold-reservation']) {
    const comparison = pairedComparison(`standard/${scenario}/dqa-minus-${baseline}`, dqa, standardRows.filter((x) => x.scenario === scenario && x.method === baseline));
    for (const preferredClass of ['gpu', 'cpu']) {
      const left = standardClassRows.filter((x) => x.scenario === scenario && x.method === 'dqa-arc' && x.preferredClass === preferredClass);
      const right = standardClassRows.filter((x) => x.scenario === scenario && x.method === baseline && x.preferredClass === preferredClass);
      const pairs = left.flatMap((l) => {
        const r = right.find((x) => x.seed === l.seed);
        return r ? [{ l, r }] : [];
      });
      for (const field of ['blocking', 'expiry', 'accuracy', 'goodput']) {
        const differences = pairs.map(({ l, r }) => l[field] - r[field]).filter(Number.isFinite);
        const interval = ci95(differences);
        comparison[`${preferredClass}${field[0].toUpperCase()}${field.slice(1)}Difference`] = interval.mean;
        comparison[`${preferredClass}${field[0].toUpperCase()}${field.slice(1)}DifferenceCi95`] = interval.halfWidth;
        comparison[`${preferredClass}${field[0].toUpperCase()}${field.slice(1)}ExactP`] = exactSignFlipTest(differences).pValue;
      }
    }
    standardPairedRows.push(comparison);
  }
}
writeCsv(path.join(analysisDir, 'standard_baseline_paired_exact.csv'), standardPairedRows);

const profileFiles = fs.readdirSync(path.join('experiments', 'model_profiles'))
  .filter((x) => x.endsWith('.jsonl')).map((x) => path.join('experiments', 'model_profiles', x));

function newestFullProfile(model, split, mode) {
  return profileFiles.map((file) => ({ file, rows: readJsonl(file) }))
    .filter(({ rows }) => rows[0]?.corpusVersion === CORPUS_VERSION && rows[0]?.model === model && rows[0]?.split === split && rows.filter((x) => x.mode === mode).length >= 120 * 9)
    .sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs)[0];
}

function profileSelector(calibrationRows, mode) {
  const selectedConfig = {};
  for (const taskClass of ['instant', 'history', 'log']) {
    const candidates = [];
    for (const [configId, rows] of groupBy(calibrationRows.filter((x) => x.mode === mode && x.taskClass === taskClass), (x) => x.configId)) {
      candidates.push({
        configId,
        accuracy: mean(rows.map((x) => Number(Boolean(x.correct && x.validJson)))),
        validity: mean(rows.map((x) => Number(Boolean(x.validJson)))),
        latency: quantile(rows.map((x) => x.wallSeconds), 0.95),
        promptTokens: mean(rows.map((x) => x.promptTokens).filter(Number.isFinite)),
        outputBudget: rows[0].maxOutputTokens
      });
    }
    candidates.sort((a, b) => b.accuracy - a.accuracy || b.validity - a.validity || a.latency - b.latency || (a.promptTokens + a.outputBudget) - (b.promptTokens + b.outputBudget));
    selectedConfig[taskClass] = candidates[0]?.configId;
  }
  return selectedConfig;
}

const qualityRows = [];
for (const model of ['qwen2.5:1.5b', 'qwen2.5:3b', 'qwen2.5:7b', 'llama3.1:8b']) {
  const cal = newestFullProfile(model, 'calibration', 'gpu');
  const evaluation = newestFullProfile(model, 'evaluation', 'gpu');
  if (!cal || !evaluation) continue;
  const selector = profileSelector(cal.rows, 'gpu');
  const evalRows = evaluation.rows.filter((x) => x.mode === 'gpu');
  const byTaskConfig = new Map(evalRows.map((x) => [`${x.taskId}|${x.configId}`, x]));
  const taskRows = [...new Map(evalRows.map((x) => [x.taskId, x])).values()];
  const strategies = {
    'quality-aware': (task) => selector[task.taskClass],
    'static-compact': () => 'compact-24',
    'static-max': () => 'extended-48',
    'token-max': () => 'extended-48'
  };
  const outcomes = {};
  for (const [strategy, choose] of Object.entries(strategies)) {
    const chosen = taskRows.map((task) => byTaskConfig.get(`${task.taskId}|${choose(task)}`)).filter(Boolean);
    outcomes[strategy] = chosen.map((x) => Boolean(x.correct && x.validJson));
    const interval = wilson95(outcomes[strategy].filter(Boolean).length, outcomes[strategy].length);
    qualityRows.push({
      model, strategy, n: outcomes[strategy].length, strictAccuracy: interval.proportion,
      strictAccuracyLow95: interval.low, strictAccuracyHigh95: interval.high,
      meanSeconds: mean(chosen.map((x) => x.wallSeconds)), p95Seconds: quantile(chosen.map((x) => x.wallSeconds), 0.95),
      meanPromptTokens: mean(chosen.map((x) => x.promptTokens).filter(Number.isFinite)),
      selectedInstant: selector.instant, selectedHistory: selector.history, selectedLog: selector.log,
      versusQualityExactP: strategy === 'quality-aware' ? 1 : exactMcNemar(outcomes['quality-aware'], outcomes[strategy]).pValue
    });
  }
}
writeCsv(path.join(analysisDir, 'heldout_quality_strategies.csv'), qualityRows);

function estimateBlockingSlope(traffic) {
  const points = aggregateRows.filter((x) => x.campaign === 'journal-sweep' && x.traffic === traffic && x.policy === 'fixed')
    .map((x) => ({ deadline: x.fixedDeadline, blocking: x.blockingMean }))
    .filter((x) => Number.isFinite(x.blocking)).sort((a, b) => a.deadline - b.deadline);
  if (points.length < 3) return { traffic, available: false };
  let center = 1;
  for (let i = 1; i < points.length - 1; i += 1) {
    if (Math.abs(points[i].blocking - 0.05) < Math.abs(points[center].blocking - 0.05)) center = i;
  }
  const lo = points[Math.max(0, center - 1)];
  const hi = points[Math.min(points.length - 1, center + 1)];
  const g = (hi.blocking - lo.blocking) / (Math.log(hi.deadline) - Math.log(lo.deadline));
  const eta = 1.5;
  const a = 0.7;
  return {
    traffic, available: true, lowerDeadline: lo.deadline, upperDeadline: hi.deadline,
    lowerBlocking: lo.blocking, upperBlocking: hi.blocking, localSlopeG: g,
    juryLeftSide: eta * (1 - a) * g, juryUpperBound: 2 * (1 + a),
    conditionSatisfied: g > 0 && eta * (1 - a) * g < 2 * (1 + a)
  };
}

const stabilityEstimates = ['poisson', 'rate-step'].map(estimateBlockingSlope);

const report = {
  generatedAt: new Date().toISOString(), selectedLiveRuns: liveRows.length,
  completedByCampaign: Object.fromEntries([...groupBy(liveRows, (x) => x.campaign)].map(([k, v]) => [k, v.length])),
  aggregateRows, pairedRows, qualityRows,
  standardAggregateRows, standardClassAggregateRows, standardPairedRows,
  mmppRunsWithoutBothStates: liveRows.filter((x) => x.traffic === 'mmpp' && x.mmppVisitedBoth !== 1).map((x) => ({ campaign: x.campaign, policy: x.policy, seed: x.seed })),
  measuredMessagingReserveP99Seconds: quantile(liveRows.map((x) => x.messagingOverheadP99Seconds).filter(Number.isFinite), 0.99),
  stabilityEstimates
};
writeJson(path.join(analysisDir, 'journal_analysis.json'), report);
process.stdout.write(`${JSON.stringify({ selectedLiveRuns: report.selectedLiveRuns, completedByCampaign: report.completedByCampaign, qualityRows: report.qualityRows, mmppRunsWithoutBothStates: report.mmppRunsWithoutBothStates }, null, 2)}\n`);
