import path from 'node:path';
import { allTasks, buildPrompt, INFERENCE_CONFIGS, parseAction } from '../datasets/tasks.mjs';
import { groupBy, mean, quantile, timestampTag, writeCsv, writeJson, writeJsonl } from '../controller/lib/stats.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const modeArg = arg('mode', 'gpu');
const split = arg('split', 'calibration');
const limit = Number(arg('limit', '0'));
const model = arg('model', 'qwen2.5:1.5b');
const configFilter = new Set(arg('configs', '').split(',').filter(Boolean));
const classFilter = new Set(arg('classes', '').split(',').filter(Boolean));
const modes = modeArg === 'both' ? ['gpu', 'cpu'] : [modeArg];
const endpoints = { gpu: 'http://127.0.0.1:11434', cpu: 'http://127.0.0.1:11435' };
const tasks = allTasks()
  .filter((t) => t.split === split && (!classFilter.size || classFilter.has(t.taskClass)))
  .slice(0, limit || undefined);
const configurations = INFERENCE_CONFIGS.filter((c) => !configFilter.size || configFilter.has(c.id));
if (!tasks.length) throw new Error('The task filter selected no tasks.');
if (!configurations.length) throw new Error('The configuration filter selected no configurations.');
const started = new Date().toISOString();
const rows = [];

async function generate(baseUrl, prompt, maxOutputTokens, seed) {
  const body = {
    model,
    prompt,
    stream: false,
    format: 'json',
    keep_alive: '30m',
    options: {
      temperature: 0,
      seed,
      num_predict: maxOutputTokens,
      num_ctx: 4096
    }
  };
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000)
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error ?? `Ollama HTTP ${response.status}`);
  return result;
}

for (const mode of modes) {
  const baseUrl = endpoints[mode];
  process.stdout.write(`Profiling ${mode} endpoint ${baseUrl} with ${tasks.length} tasks and ${configurations.length} configurations.\n`);
  await generate(baseUrl, 'Return {"action":"NORMAL"}.', 16, 1);
  let completed = 0;
  for (const config of configurations) {
    if (tasks.length) await generate(baseUrl, buildPrompt(tasks[0], config.contextTier), config.maxOutputTokens, 500 + completed);
    for (const task of tasks) {
      const prompt = buildPrompt(task, config.contextTier);
      const t0 = performance.now();
      let result;
      let error = null;
      try {
        result = await generate(baseUrl, prompt, config.maxOutputTokens, 1000 + completed);
      } catch (e) {
        error = String(e?.message ?? e);
      }
      const wallSeconds = (performance.now() - t0) / 1000;
      const parsed = parseAction(result?.response);
      rows.push({
        timestamp: new Date().toISOString(),
        model,
        corpusVersion: task.corpusVersion,
        mode,
        split,
        taskId: task.id,
        domain: task.domain,
        taskClass: task.taskClass,
        template: task.template,
        value: task.value,
        expected: task.expected,
        configId: config.id,
        contextTier: config.contextTier,
        maxOutputTokens: config.maxOutputTokens,
        action: parsed.action,
        semanticCorrect: parsed.action === task.expected,
        correct: parsed.action === task.expected && parsed.validJson,
        validJson: parsed.validJson,
        response: result?.response ?? null,
        wallSeconds,
        totalSeconds: result?.total_duration != null ? result.total_duration / 1e9 : null,
        loadSeconds: result?.load_duration != null ? result.load_duration / 1e9 : null,
        promptTokens: result?.prompt_eval_count ?? null,
        promptSeconds: result?.prompt_eval_duration != null ? result.prompt_eval_duration / 1e9 : null,
        outputTokens: result?.eval_count ?? null,
        outputSeconds: result?.eval_duration != null ? result.eval_duration / 1e9 : null,
        error
      });
      completed += 1;
      if (completed % 30 === 0) process.stdout.write(`  ${mode}: ${completed}/${tasks.length * configurations.length}\n`);
    }
  }
}

const tag = timestampTag();
const stem = `profile_${modeArg}_${split}_${tag}`;
const rawFile = path.join('experiments', 'model_profiles', `${stem}.jsonl`);
const summaryRows = [];
for (const [key, items] of groupBy(rows, (r) => `${r.mode}|${r.configId}|${r.taskClass}`)) {
  const [mode, configId, taskClass] = key.split('|');
  const latencies = items.filter((r) => !r.error).map((r) => r.wallSeconds);
  summaryRows.push({
    mode,
    configId,
    taskClass,
    n: items.length,
    errors: items.filter((r) => r.error).length,
    accuracy: mean(items.map((r) => Number(r.correct))),
    semanticAccuracy: mean(items.map((r) => Number(r.semanticCorrect ?? r.correct))),
    jsonValidity: mean(items.map((r) => Number(r.validJson))),
    meanSeconds: mean(latencies),
    p50Seconds: quantile(latencies, 0.5),
    p95Seconds: quantile(latencies, 0.95),
    meanPromptTokens: mean(items.map((r) => r.promptTokens).filter(Number.isFinite)),
    meanOutputTokens: mean(items.map((r) => r.outputTokens).filter(Number.isFinite))
  });
}
summaryRows.sort((a, b) => a.mode.localeCompare(b.mode) || a.configId.localeCompare(b.configId) || a.taskClass.localeCompare(b.taskClass));
writeJsonl(rawFile, rows);
writeCsv(path.join('experiments', 'model_profiles', `${stem}_summary.csv`), summaryRows);
writeJson(path.join('experiments', 'model_profiles', `${stem}_summary.json`), {
  metadata: { started, finished: new Date().toISOString(), corpusVersion: tasks[0].corpusVersion, model, mode: modeArg, split, tasks: tasks.length, taskClasses: [...new Set(tasks.map((x) => x.taskClass))], configurations: configurations.map((x) => x.id) },
  configurations: summaryRows,
  rawFile
});
process.stdout.write(`${JSON.stringify(summaryRows, null, 2)}\nRaw results: ${rawFile}\n`);
