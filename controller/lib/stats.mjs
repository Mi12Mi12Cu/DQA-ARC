import fs from 'node:fs';
import path from 'node:path';

export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

export function sampleStd(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1));
}

export function quantile(values, q) {
  if (!values.length) return NaN;
  const a = [...values].sort((x, y) => x - y);
  const p = Math.max(0, Math.min(1, q)) * (a.length - 1);
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (p - lo);
}

export function ci95(values) {
  if (!values.length) return { mean: NaN, low: NaN, high: NaN, halfWidth: NaN };
  const m = mean(values);
  // Two-sided Student-t critical values for 95% confidence. The live study has
  // only three replications, for which a normal multiplier understates uncertainty.
  const t95 = [
    NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
    2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093,
    2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045,
    2.042
  ];
  const df = values.length - 1;
  const critical = df <= 30 ? t95[df] : 1.96;
  const hw = values.length > 1 ? critical * sampleStd(values) / Math.sqrt(values.length) : 0;
  return { mean: m, low: m - hw, high: m + hw, halfWidth: hw };
}

export function wilson95(successes, total) {
  if (!total) return { proportion: NaN, low: NaN, high: NaN, halfWidth: NaN };
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const halfWidth = z * Math.sqrt((p * (1 - p) / total) + (z * z) / (4 * total * total)) / denominator;
  return { proportion: p, low: center - halfWidth, high: center + halfWidth, halfWidth };
}

// Two-sided paired randomization test under exchangeability of the signs.
// With ten replications this enumerates all 2^10 sign assignments exactly.
export function exactSignFlipTest(differences) {
  const values = differences.filter((x) => Number.isFinite(x) && x !== 0);
  if (!values.length) return { n: 0, statistic: 0, pValue: 1, permutations: 1 };
  const observed = Math.abs(mean(values));
  if (values.length <= 20) {
    const permutations = 2 ** values.length;
    let extreme = 0;
    for (let mask = 0; mask < permutations; mask += 1) {
      let sum = 0;
      for (let i = 0; i < values.length; i += 1) sum += ((mask >>> i) & 1 ? 1 : -1) * Math.abs(values[i]);
      if (Math.abs(sum / values.length) >= observed - 1e-12) extreme += 1;
    }
    return { n: values.length, statistic: mean(values), pValue: extreme / permutations, permutations };
  }
  throw new Error('Exact sign-flip enumeration is limited to 20 non-zero pairs.');
}

function binomialCoefficient(n, k) {
  const j = Math.min(k, n - k);
  let value = 1;
  for (let i = 1; i <= j; i += 1) value = value * (n - j + i) / i;
  return value;
}

// Exact paired binary comparison (two-sided McNemar/binomial test).
export function exactMcNemar(a, b) {
  if (a.length !== b.length) throw new Error('Paired binary vectors must have equal length.');
  let aOnly = 0;
  let bOnly = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (Boolean(a[i]) && !Boolean(b[i])) aOnly += 1;
    if (!Boolean(a[i]) && Boolean(b[i])) bOnly += 1;
  }
  const discordant = aOnly + bOnly;
  if (!discordant) return { n: a.length, aOnly, bOnly, discordant, pValue: 1 };
  const tail = Math.min(aOnly, bOnly);
  let probability = 0;
  for (let k = 0; k <= tail; k += 1) probability += binomialCoefficient(discordant, k) * (0.5 ** discordant);
  return { n: a.length, aOnly, bOnly, discordant, pValue: Math.min(1, 2 * probability) };
}

export function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function exponential(random, ratePerSecond) {
  const u = Math.max(Number.EPSILON, 1 - random());
  return -Math.log(u) / ratePerSecond;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeJsonl(file, rows) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function csvCell(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function writeCsv(file, rows, columns = null) {
  ensureDir(path.dirname(file));
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.map(csvCell).join(',')];
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

export function timestampTag() {
  return new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replace(/\.\d{3}Z$/, 'Z');
}
