const POLICIES = {
  thermal: {
    unit: 'degrees Celsius', metric: 'bearing temperature',
    thresholds: [50, 65, 80], trendDelta: 10,
    rule: 'NORMAL below 50; MONITOR from 50 to below 65; ALERT from 65 to below 80; SHUTDOWN at 80 or above.'
  },
  air: {
    unit: 'ppm', metric: 'smoke concentration',
    thresholds: [15, 40, 80], trendDelta: 18,
    rule: 'NORMAL below 15; MONITOR from 15 to below 40; ALERT from 40 to below 80; SHUTDOWN at 80 or above.'
  },
  vibration: {
    unit: 'mm/s RMS', metric: 'motor vibration',
    thresholds: [5, 8, 12], trendDelta: 2.5,
    rule: 'NORMAL below 5; MONITOR from 5 to below 8; ALERT from 8 to below 12; SHUTDOWN at 12 or above.'
  },
  power: {
    unit: 'amperes', metric: 'line current',
    thresholds: [60, 80, 100], trendDelta: 18,
    rule: 'NORMAL below 60; MONITOR from 60 to below 80; ALERT from 80 to below 100; SHUTDOWN at 100 or above.'
  }
};

const LABELS = ['NORMAL', 'MONITOR', 'ALERT', 'SHUTDOWN'];
export const CORPUS_VERSION = 'journal-v2';

export function expectedAction(domain, value) {
  const [monitor, alert, shutdown] = POLICIES[domain].thresholds;
  return value >= shutdown ? 'SHUTDOWN' : value >= alert ? 'ALERT' : value >= monitor ? 'MONITOR' : 'NORMAL';
}

function escalate(action, steps = 1) {
  return LABELS[Math.min(LABELS.length - 1, LABELS.indexOf(action) + steps)];
}

function directValues(domain) {
  const [m, a, s] = POLICIES[domain].thresholds;
  const raw = [
    m * 0.45, m * 0.72,
    m - 2, m - 1,
    m + 0.2, (m + a) / 2,
    a - 1.2, m + (a - m) * 0.25,
    a + 0.1, a + (s - a) * 0.35,
    s - 2, a + (s - a) * 0.65,
    s + 0.1, s + 3,
    s + 8, s + 15,
    m * 0.6, m - 5,
    s + 20, s + 10
  ];
  return raw.map((x) => Number(x.toFixed(domain === 'vibration' ? 1 : 0)));
}

function logEvidence(domain, index) {
  const critical = [
    'Operator note: acrid burning odor is persistent; device log repeats CRITICAL insulation fault.',
    'Shift report: visible smoke confirmed at the enclosure; gateway log reports CRITICAL combustion signature.',
    'Maintenance chat: sparking is visible; protection relay reports CRITICAL arc evidence.',
    'Operator free text: bearing appears seized; controller emits CRITICAL mechanical lock code.'
  ];
  const alert = [
    'Operator note: abnormal odor reported once; device log flags corroborated anomaly.',
    'Shift report: intermittent haze observed; two sensors flag a corroborated anomaly.',
    'Maintenance chat: repeated metallic noise; diagnostic log marks corroborated anomaly.',
    'Operator free text: cable discoloration observed; relay log marks corroborated anomaly.'
  ];
  const benign = [
    'Routine note: no visible hazard; device self-test passed and the earlier message was archived.',
    'Operator report: area is clear; gateway log says diagnostic exercise only.',
    'Maintenance entry: sensor mount checked; no corroborating hazard was found.',
    'Shift note: inspection normal; transient code cleared after self-test.'
  ];
  const evidenceType = ['critical', 'alert', 'benign'][Math.floor(index / 2) % 3];
  const bank = evidenceType === 'critical' ? critical : evidenceType === 'alert' ? alert : benign;
  return { evidenceType, text: bank[Object.keys(POLICIES).indexOf(domain)] };
}

function logExpected(base, evidence) {
  if (/CRITICAL/i.test(evidence)) return 'SHUTDOWN';
  if (/corroborated anomaly/i.test(evidence)) return escalate(base, 1);
  return base;
}

export function allTasks() {
  const rows = [];
  for (const domain of Object.keys(POLICIES)) {
    const policy = POLICIES[domain];
    const values = directValues(domain);
    for (let index = 0; index < 20; index += 1) {
      const split = index % 2 === 0 ? 'calibration' : 'evaluation';
      const template = index % 4 < 2 ? 'A' : 'B';
      const value = values[index];
      const base = expectedAction(domain, value);
      rows.push({
        id: `${domain}-instant-${String(index + 1).padStart(2, '0')}`,
        corpusVersion: CORPUS_VERSION, domain, taskClass: 'instant', template, split, value,
        unit: policy.unit, metric: policy.metric, expected: base
      });

      const trendApplies = Math.floor(index / 2) % 3 !== 1;
      const delta = trendApplies ? policy.trendDelta * (1.05 + (index % 4) * 0.08) : policy.trendDelta * 0.45;
      const history = [value - delta, value - delta * 0.54, value].map((x) => Number(Math.max(0, x).toFixed(domain === 'vibration' ? 1 : 0)));
      rows.push({
        id: `${domain}-history-${String(index + 1).padStart(2, '0')}`,
        corpusVersion: CORPUS_VERSION, domain, taskClass: 'history', template, split, value,
        unit: policy.unit, metric: policy.metric, history,
        expected: trendApplies ? escalate(base, 1) : base
      });

      const evidence = logEvidence(domain, index);
      rows.push({
        id: `${domain}-log-${String(index + 1).padStart(2, '0')}`,
        corpusVersion: CORPUS_VERSION, domain, taskClass: 'log', template, split, value,
        unit: policy.unit, metric: policy.metric, evidenceType: evidence.evidenceType, evidence: evidence.text,
        expected: logExpected(base, evidence.text)
      });
    }
  }
  return rows;
}

export const INFERENCE_CONFIGS = [
  { id: 'compact-16', contextTier: 'compact', maxOutputTokens: 16 },
  { id: 'compact-24', contextTier: 'compact', maxOutputTokens: 24 },
  { id: 'compact-48', contextTier: 'compact', maxOutputTokens: 48 },
  { id: 'standard-16', contextTier: 'standard', maxOutputTokens: 16 },
  { id: 'standard-24', contextTier: 'standard', maxOutputTokens: 24 },
  { id: 'standard-48', contextTier: 'standard', maxOutputTokens: 48 },
  { id: 'extended-16', contextTier: 'extended', maxOutputTokens: 16 },
  { id: 'extended-24', contextTier: 'extended', maxOutputTokens: 24 },
  { id: 'extended-48', contextTier: 'extended', maxOutputTokens: 48 }
];

const archived = `
ARCHIVED MATERIAL -- IGNORE FOR THE CURRENT DECISION.
An obsolete 2017 handbook used different thresholds after an old sensor calibration.
Historical incident A involved a warm bearing; incident B involved a smoke-sensor
replacement; incident C was a loose vibration mount; incident D was a current spike.
These narratives and their numbers are not current decision evidence. `.repeat(3);

function policyLines(domains) {
  return domains.map((d) => `- ${d.toUpperCase()} (${POLICIES[d].metric}, ${POLICIES[d].unit}): ${POLICIES[d].rule}`).join('\n');
}

function decisionRules(task, includeConditionalRules) {
  let text = `NUMERIC RULE:\n${policyLines([task.domain])}`;
  if (includeConditionalRules) {
    text += `\nTREND RULE: when three chronological readings strictly increase and the rise from first to last is at least ${POLICIES[task.domain].trendDelta} ${task.unit}, escalate the numeric action by one level. Escalation mapping: NORMAL -> MONITOR; MONITOR -> ALERT; ALERT -> SHUTDOWN; SHUTDOWN remains SHUTDOWN.`;
    text += '\nLOG RULE: a current note containing CRITICAL sets SHUTDOWN; a current note containing "corroborated anomaly" uses the same one-level escalation mapping; otherwise retain the numeric action.';
  }
  return text;
}

function evidenceBlock(task, includeEvidence) {
  if (!includeEvidence || task.taskClass === 'instant') return '';
  if (task.taskClass === 'history') {
    const rise = Number((task.history.at(-1) - task.history[0]).toFixed(2));
    const increasing = task.history.every((x, i) => i === 0 || x > task.history[i - 1]);
    return `\nCURRENT HISTORY (chronological): ${task.history.map((x) => `${x} ${task.unit}`).join(' -> ')}\nCurrent derived evidence: strictly increasing = ${increasing ? 'yes' : 'no'}; first-to-last rise = ${rise} ${task.unit}.`;
  }
  return `\nCURRENT UNSTRUCTURED EVIDENCE:\n${task.evidence}`;
}

export function buildPrompt(task, contextTier) {
  const includeConditionalRules = contextTier !== 'compact';
  const includeEvidence = contextTier === 'extended';
  let context = decisionRules(task, includeConditionalRules);
  if (contextTier === 'extended') context += `\n${archived}`;
  const instruction = task.template === 'B'
    ? 'Act as the deterministic decision module for an industrial MQTT event. Apply only the current rules and current evidence.'
    : 'You are a deterministic IoT safety decision component. Apply the current policy exactly.';
  return `${instruction}\nReturn one JSON object only, with exactly one key named action. The action must be one of ${LABELS.join(', ')}.\n\n` +
    `${context}\n\nCURRENT SENSOR EVENT:\nDomain: ${task.domain}\nMetric: ${task.metric}\nValue: ${task.value} ${task.unit}\nTask type: ${task.taskClass}` +
    `${evidenceBlock(task, includeEvidence)}\n\nApply all applicable current rules now. JSON:`;
}

export function parseAction(response) {
  const upper = String(response ?? '').toUpperCase();
  try {
    const parsed = JSON.parse(response);
    const action = String(parsed.action ?? '').toUpperCase();
    if (LABELS.includes(action)) return { action, validJson: true };
  } catch {
    // Preserve semantic-label scoring while exposing malformed or truncated JSON.
  }
  const labels = LABELS.filter((label) => upper.includes(label));
  return { action: labels.length === 1 ? labels[0] : null, validJson: false };
}
