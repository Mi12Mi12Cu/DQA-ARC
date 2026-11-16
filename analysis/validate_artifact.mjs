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

const summaries = walk(path.join('experiments', 'live_runs'), 'summary.json').map((file) => ({
  file,
  data: JSON.parse(fs.readFileSync(file, 'utf8'))
}));
assert.equal(summaries.length, 522, 'Merged artifact must contain all 522 executed run directories');
assert.equal(summaries.reduce((sum, { data }) => sum + Number(data.counts.errors ?? 0), 0), 0);

const audit = csvRows(path.join('analysis', 'results', 'run_inclusion_audit.csv'));
assert.equal(audit.length, 522);
const selected = audit.filter((row) => Number(row.selected) === 1);
const excluded = audit.filter((row) => Number(row.selected) === 0);
assert.equal(selected.length, 430);
assert.equal(excluded.length, 92);
assert.ok(excluded.every((row) => ['exploratory-noncanonical', 'pre-design-noncounterbalanced', 'pilot-smoke'].includes(row.exclusionReason)));

const expectedSelectedCampaigns = {
  'journal-main': 100,
  'journal-allocator-balanced': 40,
  'journal-sweep': 60,
  'journal-drift': 20,
  'journal-standard-main': 140,
  'journal-standard-drift': 70
};
const selectedByCampaign = Object.fromEntries(Object.keys(expectedSelectedCampaigns).map((campaign) => [
  campaign,
  selected.filter((row) => row.campaign === campaign).length
]));
assert.deepEqual(selectedByCampaign, expectedSelectedCampaigns);

const standardAggregate = csvRows(path.join('analysis', 'results', 'standard_baseline_aggregate.csv'));
const standardPaired = csvRows(path.join('analysis', 'results', 'standard_baseline_paired_exact.csv'));
const thresholdAggregate = csvRows(path.join('analysis', 'results', 'b1_threshold_sweep_aggregate.csv'));
const thresholdPaired = csvRows(path.join('analysis', 'results', 'b1_threshold_sweep_paired_exact.csv'));
assert.equal(standardAggregate.length, 15);
assert.equal(standardPaired.length, 12);
assert.equal(thresholdAggregate.length, 12);
assert.equal(thresholdPaired.length, 12);
assert.ok(standardAggregate.every((row) => Number(row.n) === 10));
assert.ok(standardPaired.every((row) => Number(row.n) === 10));
assert.ok(thresholdAggregate.every((row) => Number(row.n) === 10));
assert.ok(thresholdPaired.every((row) => Number(row.n) === 10));

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
  executedLiveRuns: summaries.length,
  selectedLiveRuns: selected.length,
  excludedLiveRuns: excluded.length,
  selectedByCampaign,
  standardAggregateCells: standardAggregate.length,
  standardPairedComparisons: standardPaired.length,
  thresholdAggregateCells: thresholdAggregate.length,
  thresholdPairedComparisons: thresholdPaired.length,
  repositoryFiles: repositoryFiles.length,
  largestFile: largestFile.file,
  largestFileMiB: Number((largestFile.bytes / 1024 / 1024).toFixed(2)),
  longestRelativePathCharacters: longestPath.length,
  status: 'validated'
}, null, 2)}\n`);
