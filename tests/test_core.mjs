import assert from 'node:assert/strict';
import { allTasks, INFERENCE_CONFIGS } from '../datasets/tasks.mjs';
import { erlangB, invertErlangB } from '../controller/lib/erlang.mjs';
import { exactMcNemar, exactSignFlipTest } from '../controller/lib/stats.mjs';
import { generateArrivalScheduleDetailed } from '../workloads/traffic.mjs';
import { admissionDecision, admissionLimit } from '../controller/lib/admission.mjs';

const tasks = allTasks();
assert.equal(tasks.length, 240);
assert.equal(tasks.filter((x) => x.split === 'calibration').length, 120);
assert.equal(tasks.filter((x) => x.split === 'evaluation').length, 120);
assert.deepEqual(INFERENCE_CONFIGS.map((x) => x.maxOutputTokens), [16, 24, 48, 16, 24, 48, 16, 24, 48]);
for (const domain of ['thermal', 'air', 'vibration', 'power']) {
  for (const taskClass of ['instant', 'history', 'log']) {
    const counts = (split) => Object.fromEntries(['NORMAL', 'MONITOR', 'ALERT', 'SHUTDOWN'].map((label) => [label, tasks.filter((x) => x.domain === domain && x.taskClass === taskClass && x.split === split && x.expected === label).length]));
    assert.deepEqual(counts('calibration'), counts('evaluation'), `${domain}/${taskClass} label distribution differs by split`);
  }
}

for (const capacity of [4, 8, 12]) {
  const offered = invertErlangB(capacity, 0.05);
  assert.ok(Math.abs(erlangB(capacity, offered) - 0.05) < 1e-8);
}

assert.equal(exactSignFlipTest([1, 1, 1, 1]).pValue, 0.125);
assert.equal(exactSignFlipTest([0, 0]).pValue, 1);
assert.equal(exactMcNemar([1, 1, 1, 0], [0, 0, 0, 0]).pValue, 0.25);

for (let seed = 601; seed <= 610; seed += 1) {
  const first = generateArrivalScheduleDetailed({ type: 'mmpp', durationSeconds: 120, meanRate: 4, seed });
  const second = generateArrivalScheduleDetailed({ type: 'mmpp', durationSeconds: 120, meanRate: 4, seed });
  assert.deepEqual(first, second);
  assert.ok(first.metadata.visitedLow && first.metadata.visitedHigh, `MMPP seed ${seed} misses a state`);
}

const admissionParameters = { capacity: 8, occupancyThreshold: 6, reservedCpuSlots: 2 };
assert.equal(admissionLimit({ policy: 'occupancy-threshold', preferredHardware: 'gpu', ...admissionParameters }), 6);
assert.equal(admissionLimit({ policy: 'occupancy-threshold', preferredHardware: 'cpu', ...admissionParameters }), 6);
assert.equal(admissionLimit({ policy: 'static-reservation', preferredHardware: 'gpu', ...admissionParameters }), 6);
assert.equal(admissionLimit({ policy: 'static-reservation', preferredHardware: 'cpu', ...admissionParameters }), 8);
assert.equal(admissionLimit({ policy: 'threshold-reservation', preferredHardware: 'gpu', ...admissionParameters }), 4);
assert.equal(admissionLimit({ policy: 'threshold-reservation', preferredHardware: 'cpu', ...admissionParameters }), 6);
assert.equal(admissionLimit({ policy: 'fifo', preferredHardware: 'gpu', ...admissionParameters }), 8);
assert.equal(admissionLimit({ policy: 'fifo', preferredHardware: 'cpu', ...admissionParameters }), 8);
assert.equal(admissionDecision({ policy: 'threshold-reservation', preferredHardware: 'gpu', occupancy: 4, ...admissionParameters }).accepted, false);
assert.equal(admissionDecision({ policy: 'threshold-reservation', preferredHardware: 'cpu', occupancy: 4, ...admissionParameters }).accepted, true);
assert.equal(admissionDecision({ policy: 'fifo', preferredHardware: 'gpu', occupancy: 7, ...admissionParameters }).accepted, true);
assert.equal(admissionDecision({ policy: 'fifo', preferredHardware: 'gpu', occupancy: 8, ...admissionParameters }).accepted, false);

process.stdout.write('Core task, statistics, queueing, and traffic tests passed.\n');
