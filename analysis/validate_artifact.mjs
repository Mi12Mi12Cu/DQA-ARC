import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

function allFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ['.git', 'node_modules', 'preview'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

function csvRows(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, line.split(',')[index] ?? ''])));
}

const expectedCampaigns = {
  'journal-main': 100,
  'journal-allocator-balanced': 40,
  'journal-sweep': 60,
  'journal-drift': 20,
  'journal-standard-main': 60,
  'journal-standard-drift': 30
};

const summaries = walk(path.join('experiments', 'live_runs'), 'summary.json').map((file) => ({
  file,
  data: JSON.parse(fs.readFileSync(file, 'utf8'))
})).filter(({ data }) => Object.hasOwn(expectedCampaigns, data.metadata?.config?.campaign));

const byCampaign = Object.fromEntries(Object.keys(expectedCampaigns).map((campaign) => [
  campaign,
  summaries.filter(({ data }) => data.metadata.config.campaign === campaign).length
]));
assert.deepEqual(byCampaign, expectedCampaigns);
assert.equal(summaries.length, 310);
assert.equal(summaries.reduce((sum, { data }) => sum + Number(data.counts.errors ?? 0), 0), 0);

const standard = summaries.filter(({ data }) => data.metadata.config.campaign.startsWith('journal-standard-'));
assert.equal(standard.length, 90);
for (const { file, data } of standard) {
  assert.equal(data.metadata.config.occupancyThreshold, 6, file);
  assert.equal(data.metadata.config.reservedCpuSlots, 2, file);
  assert.equal(data.metadata.config.fixedDeadline, 8, file);
  assert.equal(data.classCounts.gpu.published + data.classCounts.cpu.published, data.counts.published, file);
  assert.equal(data.classCounts.gpu.blocked + data.classCounts.cpu.blocked, data.counts.blocked, file);
  if (data.metadata.config.traffic === 'mmpp') {
    assert.ok(data.metadata.trafficStateCoverage.visitedLow && data.metadata.trafficStateCoverage.visitedHigh, file);
  }
}

const aggregate = csvRows(path.join('analysis', 'results', 'standard_baseline_aggregate.csv'));
const paired = csvRows(path.join('analysis', 'results', 'standard_baseline_paired_exact.csv'));
assert.equal(aggregate.length, 12);
assert.equal(paired.length, 9);
assert.ok(aggregate.every((row) => Number(row.n) === 10));
assert.ok(paired.every((row) => Number(row.n) === 10));

const repositoryFiles = allFiles('.');
const largestFile = repositoryFiles.map((file) => ({
  file: file.split(path.sep).join('/').replace(/^\.\//, ''),
  bytes: fs.statSync(file).size
})).sort((left, right) => right.bytes - left.bytes)[0];
const longestPath = repositoryFiles.map((file) => file.split(path.sep).join('/').replace(/^\.\//, ''))
  .sort((left, right) => right.length - left.length)[0];
assert.ok(largestFile.bytes < 100 * 1024 * 1024, `${largestFile.file} exceeds GitHub's 100 MiB hard limit`);
assert.ok(longestPath.length < 240, `${longestPath} is too long for a portable Windows checkout`);

process.stdout.write(`${JSON.stringify({
  selectedLiveRuns: summaries.length,
  byCampaign,
  standardBaselineRuns: standard.length,
  aggregateCells: aggregate.length,
  pairedComparisons: paired.length,
  repositoryFiles: repositoryFiles.length,
  largestFile: largestFile.file,
  largestFileMiB: Number((largestFile.bytes / 1024 / 1024).toFixed(2)),
  longestRelativePathCharacters: longestPath.length,
  status: 'validated'
}, null, 2)}\n`);
