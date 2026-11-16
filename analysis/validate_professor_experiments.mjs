import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, name) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, name) : entry.name === name ? [full] : [];
  });
}

function newestByKey(items, key) {
  const selected = new Map();
  for (const item of items) {
    const id = key(item);
    const previous = selected.get(id);
    if (!previous || new Date(item.data.metadata.finishedAt) > new Date(previous.data.metadata.finishedAt)) selected.set(id, item);
  }
  return [...selected.values()];
}

const all = walk(path.join('experiments', 'live_runs'), 'summary.json').map((file) => ({
  file,
  data: JSON.parse(fs.readFileSync(file, 'utf8'))
}));
const candidates = all.filter(({ data }) => ['journal-standard-main', 'journal-standard-drift'].includes(data.metadata?.config?.campaign));
const selected = newestByKey(candidates, ({ data }) => {
  const c = data.metadata.config;
  return [c.campaign, c.traffic, c.policy, c.allocator, c.fixedDeadline, c.driftModel || '', c.seed,
    c.occupancyThreshold ?? '', c.reservedCpuSlots ?? ''].join('|');
});

const professorRuns = selected.filter(({ data }) => data.metadata.config.policy === 'fifo' ||
  (data.metadata.config.policy === 'occupancy-threshold' && [4, 5, 6, 7].includes(data.metadata.config.occupancyThreshold)));
const cells = new Map();
for (const item of professorRuns) {
  const c = item.data.metadata.config;
  const scenario = c.traffic === 'rate-step' ? 'drift' : c.traffic;
  const method = c.policy === 'fifo' ? 'fifo' : `theta-${c.occupancyThreshold}`;
  const key = `${scenario}|${method}`;
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(item);
}

const expected = [];
for (const scenario of ['poisson', 'mmpp', 'drift']) {
  for (const theta of [4, 5, 6, 7]) expected.push(`${scenario}|theta-${theta}`);
  expected.push(`${scenario}|fifo`);
}
for (const key of expected) {
  const rows = cells.get(key) ?? [];
  assert.equal(rows.length, 10, `${key} must contain ten paired runs`);
  assert.deepEqual(rows.map(({ data }) => data.metadata.config.seed).sort((a, b) => a - b),
    key.startsWith('drift|') ? [701, 702, 703, 704, 705, 706, 707, 708, 709, 710] : [601, 602, 603, 604, 605, 606, 607, 608, 609, 610], key);
  for (const { file, data } of rows) {
    const c = data.metadata.config;
    assert.equal(c.durationSeconds, key.startsWith('drift|') ? 60 : 120, file);
    assert.equal(c.fixedDeadline, 8, file);
    assert.equal(c.capacity, 8, file);
    assert.equal(data.counts.errors, 0, file);
    if (key.startsWith('mmpp|')) assert.ok(data.metadata.trafficStateCoverage.visitedLow && data.metadata.trafficStateCoverage.visitedHigh, file);
  }
}

process.stdout.write(`${JSON.stringify({
  expectedCells: expected.length,
  validatedRuns: expected.length * 10,
  b1ThresholdRuns: professorRuns.filter(({ data }) => data.metadata.config.policy === 'occupancy-threshold').length,
  fifoRuns: professorRuns.filter(({ data }) => data.metadata.config.policy === 'fifo').length,
  status: 'validated'
}, null, 2)}\n`);
