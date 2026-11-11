import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readJsonl } from '../controller/lib/stats.mjs';
import { CORPUS_VERSION } from '../datasets/tasks.mjs';

const plans = [
  { model: 'qwen2.5:3b', split: 'calibration', mode: 'both', expected: 2160 },
  { model: 'qwen2.5:3b', split: 'evaluation', mode: 'both', expected: 2160 },
  { model: 'qwen2.5:1.5b', split: 'calibration', mode: 'gpu', expected: 1080 },
  { model: 'qwen2.5:1.5b', split: 'evaluation', mode: 'gpu', expected: 1080 },
  { model: 'qwen2.5:7b', split: 'calibration', mode: 'gpu', expected: 1080 },
  { model: 'qwen2.5:7b', split: 'evaluation', mode: 'gpu', expected: 1080 },
  { model: 'llama3.1:8b', split: 'calibration', mode: 'gpu', expected: 1080 },
  { model: 'llama3.1:8b', split: 'evaluation', mode: 'gpu', expected: 1080 }
];

function complete(plan) {
  const dir = path.join('experiments', 'model_profiles');
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).some((name) => {
    const rows = readJsonl(path.join(dir, name));
    return rows.length >= plan.expected && rows[0]?.corpusVersion === CORPUS_VERSION && rows[0]?.model === plan.model && rows[0]?.split === plan.split;
  });
}

function run(plan) {
  return new Promise((resolve, reject) => {
    const args = ['subscribers/profile_llm.mjs', '--mode', plan.mode, '--split', plan.split, '--model', plan.model];
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Profile failed with exit code ${code}`)));
  });
}

for (const plan of plans) {
  if (complete(plan)) {
    process.stdout.write(`Skipping complete profile: ${JSON.stringify(plan)}\n`);
    continue;
  }
  process.stdout.write(`\n=== Profiling ${JSON.stringify(plan)} ===\n`);
  await run(plan);
}
