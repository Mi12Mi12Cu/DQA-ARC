import path from 'node:path';
import { allTasks } from './tasks.mjs';
import { groupBy, writeCsv, writeJson } from '../controller/lib/stats.mjs';

const tasks = allTasks();
const expectedTotal = 240;
if (tasks.length !== expectedTotal) throw new Error(`Expected ${expectedTotal} tasks; found ${tasks.length}.`);
if (new Set(tasks.map((x) => x.id)).size !== tasks.length) throw new Error('Task identifiers are not unique.');

const cells = [];
for (const [key, rows] of groupBy(tasks, (x) => `${x.split}|${x.domain}|${x.taskClass}|${x.template}`)) {
  const [split, domain, taskClass, template] = key.split('|');
  cells.push({ split, domain, taskClass, template, n: rows.length });
}
for (const row of cells) {
  if (row.n !== 5) throw new Error(`Unbalanced corpus cell: ${JSON.stringify(row)}`);
}

const outputRows = tasks.map((x) => ({
  id: x.id, corpusVersion: x.corpusVersion, split: x.split, domain: x.domain, taskClass: x.taskClass, template: x.template,
  metric: x.metric, value: x.value, unit: x.unit, expected: x.expected,
  history: x.history?.join('|') ?? '', evidenceType: x.evidenceType ?? '', evidence: x.evidence ?? ''
}));
writeCsv(path.join('datasets', 'journal_task_corpus.csv'), outputRows);
writeJson(path.join('datasets', 'journal_task_corpus_metadata.json'), {
  generatedAt: new Date().toISOString(), tasks: tasks.length,
  calibration: tasks.filter((x) => x.split === 'calibration').length,
  evaluation: tasks.filter((x) => x.split === 'evaluation').length,
  balanceCells: cells.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
});
process.stdout.write(`Validated and exported ${tasks.length} tasks.\n`);
