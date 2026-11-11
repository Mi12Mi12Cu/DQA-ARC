import fs from 'node:fs';
import path from 'node:path';

const inputDir = path.join('analysis', 'results');
const outDir = 'figures';
fs.mkdirSync(outDir, { recursive: true });

function parseCsv(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing analysis file: ${file}`);
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => cells[i] !== '' && Number.isFinite(Number(cells[i])) ? [h, Number(cells[i])] : [h, cells[i] ?? '']));
  });
}

const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const palette = {
  fixed: '#555555', analytical: '#E69F00', calibrated: '#0072B2', adaptive: '#CC79A7', guarded: '#009E73',
  quality: '#0072B2', compact: '#E69F00', maximum: '#D55E00', token: '#CC79A7', burst: '#56B4E9',
  occupancy: '#E69F00', reservation: '#0072B2', combined: '#CC79A7'
};

function frame(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="white"/>
<style>text{font-family:Arial,sans-serif;fill:#222}.axis{stroke:#222;stroke-width:1.5}.grid{stroke:#ddd;stroke-width:1}.label{font-size:15px}.tick{font-size:13px}.legend{font-size:13px}.ci{stroke:#222;stroke-width:1.4}</style>
${body}</svg>`;
}

function write(name, body, width = 920, height = 470) {
  fs.writeFileSync(path.join(outDir, name), frame(width, height, body), 'utf8');
}

function axes({ width = 920, height = 470, left = 75, top = 35, right = 35, bottom = 70, yMax = 1, yTicks = 5, percent = false, yLabel = '', xLabel = '' }) {
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const body = [];
  for (let i = 0; i <= yTicks; i += 1) {
    const value = yMax * i / yTicks;
    const y = top + plotH * (1 - value / yMax);
    body.push(`<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" class="grid"/><text x="${left - 9}" y="${y + 5}" text-anchor="end" class="tick">${percent ? `${(100 * value).toFixed(0)}%` : value.toFixed(yMax <= 5 ? 1 : 0)}</text>`);
  }
  body.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" class="axis"/><line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" class="axis"/>`);
  if (yLabel) body.push(`<text transform="translate(18 ${top + plotH / 2}) rotate(-90)" text-anchor="middle" class="label">${esc(yLabel)}</text>`);
  if (xLabel) body.push(`<text x="${left + plotW / 2}" y="${height - 15}" text-anchor="middle" class="label">${esc(xLabel)}</text>`);
  return { body, left, top, plotW, plotH, width, height };
}

const quality = parseCsv(path.join(inputDir, 'heldout_quality_strategies.csv'));
{
  const chart = axes({ yMax: 1, percent: true, yLabel: 'Held-out strict accuracy' });
  const models = ['qwen2.5:1.5b', 'qwen2.5:3b', 'qwen2.5:7b', 'llama3.1:8b'];
  const labels = ['Qwen 1.5B', 'Qwen 3B', 'Qwen 7B', 'Llama 8B'];
  const strategies = [
    ['quality-aware', palette.quality, 'Class-conditioned'],
    ['static-compact', palette.compact, 'Static compact'],
    ['static-max', palette.maximum, 'Static maximum']
  ];
  models.forEach((model, mi) => {
    const center = chart.left + chart.plotW * (mi + 0.5) / models.length;
    strategies.forEach(([strategy, color], si) => {
      const row = quality.find((x) => x.model === model && x.strategy === strategy);
      if (!row) return;
      const x = center + (si - 1) * 47;
      const y = chart.top + chart.plotH * (1 - row.strictAccuracy);
      const lowY = chart.top + chart.plotH * (1 - row.strictAccuracyLow95);
      const highY = chart.top + chart.plotH * (1 - row.strictAccuracyHigh95);
      chart.body.push(`<rect x="${x - 18}" y="${y}" width="36" height="${chart.top + chart.plotH - y}" fill="${color}"/><line x1="${x}" y1="${highY}" x2="${x}" y2="${lowY}" class="ci"/><line x1="${x - 6}" y1="${highY}" x2="${x + 6}" y2="${highY}" class="ci"/><line x1="${x - 6}" y1="${lowY}" x2="${x + 6}" y2="${lowY}" class="ci"/>`);
    });
    chart.body.push(`<text x="${center}" y="${chart.top + chart.plotH + 25}" text-anchor="middle" class="tick">${labels[mi]}</text>`);
  });
  strategies.forEach(([, color, label], i) => chart.body.push(`<rect x="${520 + i * 128}" y="10" width="13" height="13" fill="${color}"/><text x="${539 + i * 128}" y="22" class="legend">${label}</text>`));
  write('fig_j1_quality_models.svg', chart.body.join('\n'));
}

const aggregate = parseCsv(path.join(inputDir, 'journal_live_aggregate.csv'));
{
  const width = 920; const height = 470; const left = 78; const top = 35; const plotW = 760; const plotH = 350;
  const xMax = Math.max(0.1, ...aggregate.filter((x) => x.campaign === 'journal-main').map((x) => x.blockingMean + x.blockingCi95));
  const yMax = Math.max(1, ...aggregate.filter((x) => x.campaign === 'journal-main').map((x) => x.goodputMean + x.goodputCi95)) * 1.1;
  const body = [];
  for (let i = 0; i <= 5; i += 1) {
    const xv = xMax * i / 5; const x = left + plotW * xv / xMax;
    const yv = yMax * i / 5; const y = top + plotH * (1 - yv / yMax);
    body.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotH}" class="grid"/><text x="${x}" y="${top + plotH + 22}" text-anchor="middle" class="tick">${(100 * xv).toFixed(0)}%</text>`);
    body.push(`<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" class="grid"/><text x="${left - 8}" y="${y + 5}" text-anchor="end" class="tick">${yv.toFixed(1)}</text>`);
  }
  body.push(`<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" class="axis"/><line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" class="axis"/>`);
  for (const row of aggregate.filter((x) => x.campaign === 'journal-main')) {
    const x = left + plotW * row.blockingMean / xMax;
    const y = top + plotH * (1 - row.goodputMean / yMax);
    const x1 = left + plotW * Math.max(0, row.blockingMean - row.blockingCi95) / xMax;
    const x2 = left + plotW * (row.blockingMean + row.blockingCi95) / xMax;
    const y1 = top + plotH * (1 - Math.min(yMax, row.goodputMean + row.goodputCi95) / yMax);
    const y2 = top + plotH * (1 - Math.max(0, row.goodputMean - row.goodputCi95) / yMax);
    body.push(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="ci"/><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" class="ci"/>`);
    body.push(row.traffic === 'poisson' ? `<circle cx="${x}" cy="${y}" r="7" fill="${palette[row.policy]}"/>` : `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" fill="${palette[row.policy]}"/>`);
  }
  const policies = ['fixed', 'analytical', 'calibrated', 'adaptive', 'guarded'];
  policies.forEach((policy, i) => body.push(`<rect x="${80 + i * 135}" y="8" width="13" height="13" fill="${palette[policy]}"/><text x="${99 + i * 135}" y="20" class="legend">${policy}</text>`));
  body.push(`<text x="${left + plotW / 2}" y="${height - 15}" text-anchor="middle" class="label">Application-state blocking</text><text transform="translate(18 ${top + plotH / 2}) rotate(-90)" text-anchor="middle" class="label">Correct on-time results/s</text>`);
  body.push(`<circle cx="765" cy="18" r="6" fill="#222"/><text x="777" y="23" class="legend">Poisson</text><rect x="842" y="12" width="12" height="12" fill="#222"/><text x="858" y="23" class="legend">MMPP</text>`);
  write('fig_j2_live_tradeoff.svg', body.join('\n'));
}

{
  const chart = axes({ yMax: 0.5, percent: true, yLabel: 'Application-state blocking', xLabel: 'Fixed deadline (s)' });
  const deadlines = [1, 2, 3, 5, 8];
  const fixed = aggregate.filter((x) => x.campaign === 'journal-sweep' && x.policy === 'fixed' && x.traffic === 'poisson').sort((a, b) => a.fixedDeadline - b.fixedDeadline);
  const guarded = aggregate.find((x) => x.campaign === 'journal-sweep' && x.policy === 'guarded' && x.traffic === 'poisson');
  const points = [];
  deadlines.forEach((deadline, i) => {
    const x = chart.left + chart.plotW * i / (deadlines.length - 1);
    const row = fixed.find((r) => r.fixedDeadline === deadline);
    chart.body.push(`<text x="${x}" y="${chart.top + chart.plotH + 23}" text-anchor="middle" class="tick">${deadline}</text>`);
    if (row) {
      const y = chart.top + chart.plotH * (1 - Math.min(0.5, row.blockingMean) / 0.5);
      const highY = chart.top + chart.plotH * (1 - Math.min(0.5, row.blockingMean + row.blockingCi95) / 0.5);
      const lowY = chart.top + chart.plotH * (1 - Math.max(0, row.blockingMean - row.blockingCi95) / 0.5);
      points.push([x, y]);
      chart.body.push(`<line x1="${x}" y1="${highY}" x2="${x}" y2="${lowY}" class="ci"/><line x1="${x - 5}" y1="${highY}" x2="${x + 5}" y2="${highY}" class="ci"/><line x1="${x - 5}" y1="${lowY}" x2="${x + 5}" y2="${lowY}" class="ci"/>`);
    }
  });
  chart.body.push(`<polyline points="${points.map((x) => x.join(',')).join(' ')}" fill="none" stroke="${palette.fixed}" stroke-width="3"/>`);
  points.forEach(([x, y]) => chart.body.push(`<circle cx="${x}" cy="${y}" r="5" fill="${palette.fixed}"/>`));
  if (guarded) {
    const y = chart.top + chart.plotH * (1 - Math.min(0.5, guarded.blockingMean) / 0.5);
    const highY = chart.top + chart.plotH * (1 - Math.min(0.5, guarded.blockingMean + guarded.blockingCi95) / 0.5);
    const lowY = chart.top + chart.plotH * (1 - Math.max(0, guarded.blockingMean - guarded.blockingCi95) / 0.5);
    chart.body.push(`<rect x="${chart.left}" y="${highY}" width="${chart.plotW}" height="${Math.max(0, lowY - highY)}" fill="${palette.guarded}" opacity="0.10"/>`);
    chart.body.push(`<line x1="${chart.left}" y1="${y}" x2="${chart.left + chart.plotW}" y2="${y}" stroke="${palette.guarded}" stroke-width="3" stroke-dasharray="8 5"/>`);
  }
  chart.body.push(`<line x1="625" y1="16" x2="652" y2="16" stroke="${palette.fixed}" stroke-width="3"/><text x="660" y="21" class="legend">Fixed sweep</text><line x1="750" y1="16" x2="777" y2="16" stroke="${palette.guarded}" stroke-width="3" stroke-dasharray="8 5"/><text x="785" y="21" class="legend">Guarded</text>`);
  write('fig_j3_deadline_sweep.svg', chart.body.join('\n'));
}

function groupedOutcomeFigure(name, rows, groups, metrics) {
  const width = 920; const height = 470; const body = [];
  metrics.forEach((metric, panel) => {
    const left = 55 + panel * 445; const top = 42; const plotW = 360; const plotH = 320;
    const yMax = metric.max;
    for (let i = 0; i <= 4; i += 1) {
      const value = yMax * i / 4; const y = top + plotH * (1 - value / yMax);
      body.push(`<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" class="grid"/><text x="${left - 7}" y="${y + 5}" text-anchor="end" class="tick">${metric.percent ? `${(100 * value).toFixed(0)}%` : value.toFixed(1)}</text>`);
    }
    body.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" class="axis"/><line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" class="axis"/><text x="${left + plotW / 2}" y="${height - 16}" text-anchor="middle" class="label">${esc(metric.label)}</text>`);
    groups.forEach((group, i) => {
      const row = rows.find(group.match);
      if (!row) return;
      const x = left + plotW * (i + 0.5) / groups.length;
      const value = row[metric.field]; const y = top + plotH * (1 - Math.min(yMax, value) / yMax);
      const ciField = metric.field.replace(/Mean$/, 'Ci95');
      const halfWidth = Number(row[ciField]) || 0;
      const highY = top + plotH * (1 - Math.min(yMax, value + halfWidth) / yMax);
      const lowY = top + plotH * (1 - Math.max(0, value - halfWidth) / yMax);
      body.push(`<rect x="${x - 23}" y="${y}" width="46" height="${top + plotH - y}" fill="${group.color}"/><line x1="${x}" y1="${highY}" x2="${x}" y2="${lowY}" class="ci"/><line x1="${x - 6}" y1="${highY}" x2="${x + 6}" y2="${highY}" class="ci"/><line x1="${x - 6}" y1="${lowY}" x2="${x + 6}" y2="${lowY}" class="ci"/><text x="${x}" y="${top + plotH + 22}" text-anchor="middle" class="tick">${esc(group.short)}</text>`);
    });
  });
  write(name, body.join('\n'), width, height);
}

const allocatorCampaign = aggregate.some((x) => x.campaign === 'journal-allocator-balanced')
  ? 'journal-allocator-balanced'
  : 'journal-allocator';
groupedOutcomeFigure('fig_j4_allocator.svg', aggregate.filter((x) => x.campaign === allocatorCampaign && x.traffic === 'poisson'), [
  { short: 'Comp.', color: palette.compact, match: (x) => x.allocator === 'static-compact' },
  { short: 'Max.', color: palette.maximum, match: (x) => x.allocator === 'static-max' },
  { short: 'Token', color: palette.token, match: (x) => x.allocator === 'token-max' },
  { short: 'DQA', color: palette.quality, match: (x) => x.allocator === 'quality-aware' }
], [
  { field: 'accuracyMean', max: 1, percent: true, label: 'On-time strict accuracy' },
  { field: 'goodputMean', max: 4.5, percent: false, label: 'Correct on-time results/s' }
]);

groupedOutcomeFigure('fig_j5_drift.svg', aggregate.filter((x) => x.campaign === 'journal-drift' && x.traffic === 'rate-step'), [
  { short: 'Fixed', color: palette.fixed, match: (x) => x.policy === 'fixed' },
  { short: 'DQA', color: palette.guarded, match: (x) => x.policy === 'guarded' }
], [
  { field: 'expiryMean', max: 0.6, percent: true, label: 'Expiry among admitted' },
  { field: 'goodputMean', max: 4.5, percent: false, label: 'Correct on-time results/s' }
]);

const standard = parseCsv(path.join(inputDir, 'standard_baseline_aggregate.csv'));
{
  const width = 1200; const height = 480; const body = [];
  const scenarios = [['poisson', 'Poisson'], ['mmpp', 'MMPP'], ['drift', 'Rate/model drift']];
  const methods = [
    ['dqa-arc', 'DQA-ARC', palette.guarded],
    ['occupancy-threshold', 'B1 occupancy', palette.occupancy],
    ['static-reservation', 'B2 reservation', palette.reservation],
    ['threshold-reservation', 'B3 combined', palette.combined]
  ];
  const panels = [
    { field: 'blockingMean', max: 0.8, percent: true, label: 'Blocking probability' },
    { field: 'expiryMean', max: 0.4, percent: true, label: 'Expiry among admitted' },
    { field: 'goodputMean', max: 3.0, percent: false, label: 'Correct on-time results/s' }
  ];
  panels.forEach((panel, pi) => {
    const left = 55 + pi * 395; const top = 48; const plotW = 330; const plotH = 315;
    for (let i = 0; i <= 4; i += 1) {
      const value = panel.max * i / 4; const y = top + plotH * (1 - value / panel.max);
      body.push(`<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" class="grid"/><text x="${left - 7}" y="${y + 5}" text-anchor="end" class="tick">${panel.percent ? `${(100 * value).toFixed(0)}%` : value.toFixed(1)}</text>`);
    }
    body.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" class="axis"/><line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" class="axis"/>`);
    scenarios.forEach(([scenario, label], si) => {
      const center = left + plotW * (si + 0.5) / scenarios.length;
      methods.forEach(([method, , color], mi) => {
        const row = standard.find((x) => x.scenario === scenario && x.method === method);
        if (!row) return;
        const x = center + (mi - 1.5) * 19; const value = row[panel.field];
        const halfWidth = Number(row[panel.field.replace(/Mean$/, 'Ci95')]) || 0;
        const y = top + plotH * (1 - Math.min(panel.max, value) / panel.max);
        const highY = top + plotH * (1 - Math.min(panel.max, value + halfWidth) / panel.max);
        const lowY = top + plotH * (1 - Math.max(0, value - halfWidth) / panel.max);
        body.push(`<rect x="${x - 8}" y="${y}" width="16" height="${top + plotH - y}" fill="${color}"/><line x1="${x}" y1="${highY}" x2="${x}" y2="${lowY}" class="ci"/><line x1="${x - 4}" y1="${highY}" x2="${x + 4}" y2="${highY}" class="ci"/><line x1="${x - 4}" y1="${lowY}" x2="${x + 4}" y2="${lowY}" class="ci"/>`);
      });
      body.push(`<text x="${center}" y="${top + plotH + 22}" text-anchor="middle" class="tick">${label}</text>`);
    });
    body.push(`<text x="${left + plotW / 2}" y="${height - 52}" text-anchor="middle" class="label">${panel.label}</text>`);
  });
  methods.forEach(([, label, color], i) => body.push(`<rect x="${270 + i * 170}" y="12" width="13" height="13" fill="${color}"/><text x="${289 + i * 170}" y="24" class="legend">${label}</text>`));
  write('fig_j7_standard_baselines.svg', body.join('\n'), width, height);
}

const replay = parseCsv(path.join('experiments', 'replay_runs', 'empirical_replay_aggregate.csv'));
{
  const chart = axes({ yMax: 0.6, percent: true, yLabel: 'Probability', xLabel: 'Application-state capacity (records)' });
  const capacities = [4, 8, 12];
  const groups = [
    { label: 'Guarded broker blocking', field: 'blockingMean', policy: 'guarded', color: palette.guarded, dash: '' },
    { label: 'Token bucket broker blocking', field: 'blockingMean', policy: 'burst-guarded', color: palette.burst, dash: '' },
    { label: 'Token bucket total admission loss', field: 'totalAdmissionLossMean', policy: 'burst-guarded', color: palette.maximum, dash: '8 5' }
  ];
  capacities.forEach((capacity, i) => chart.body.push(`<text x="${chart.left + chart.plotW * i / 2}" y="${chart.top + chart.plotH + 23}" text-anchor="middle" class="tick">${capacity}</text>`));
  groups.forEach((group, gi) => {
    const points = capacities.map((capacity, i) => {
      const row = replay.find((x) => x.traffic === 'mmpp' && x.policy === group.policy && x.capacity === capacity && x.rate === 4 && x.cpuFraction === 0.2);
      if (!row) return null;
      const value = row[group.field];
      const halfWidth = Number(row[group.field.replace(/Mean$/, 'Ci95')]) || 0;
      return [chart.left + chart.plotW * i / 2, chart.top + chart.plotH * (1 - Math.min(0.6, value) / 0.6), value, halfWidth];
    }).filter(Boolean);
    chart.body.push(`<polyline points="${points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="${group.color}" stroke-width="3" stroke-dasharray="${group.dash}"/>`);
    points.forEach(([x, y, value, halfWidth]) => {
      const highY = chart.top + chart.plotH * (1 - Math.min(0.6, value + halfWidth) / 0.6);
      const lowY = chart.top + chart.plotH * (1 - Math.max(0, value - halfWidth) / 0.6);
      chart.body.push(`<line x1="${x}" y1="${highY}" x2="${x}" y2="${lowY}" class="ci"/><line x1="${x - 5}" y1="${highY}" x2="${x + 5}" y2="${highY}" class="ci"/><line x1="${x - 5}" y1="${lowY}" x2="${x + 5}" y2="${lowY}" class="ci"/><circle cx="${x}" cy="${y}" r="5" fill="${group.color}"/>`);
    });
    const y = 12 + gi * 20;
    chart.body.push(`<line x1="530" y1="${y}" x2="557" y2="${y}" stroke="${group.color}" stroke-width="3" stroke-dasharray="${group.dash}"/><text x="565" y="${y + 5}" class="legend">${group.label}</text>`);
  });
  write('fig_j6_burst_guard.svg', chart.body.join('\n'));
}

process.stdout.write(`Journal SVG figures written to ${outDir}.\n`);
