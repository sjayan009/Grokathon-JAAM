import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE,
  createRun,
  cursorVisual,
  reduce,
  shouldPerform,
} from '../lib/state-machine.js';

test('study tab detection moves idle to observing without dropping an active lesson', () => {
  let run = reduce(createRun(), { type: 'tab_detected', documentId: 'demo-lc3', origin: 'http://localhost:5173' });
  assert.equal(run.phase, PHASE.OBSERVING);
  assert.equal(run.documentId, 'demo-lc3');
  run = reduce(run, { type: 'lesson_started', runId: 4, planId: 'plan-ldr' });
  run = reduce(run, { type: 'tab_detected', documentId: 'demo-lc3', origin: 'http://127.0.0.1:5173' });
  assert.equal(run.phase, PHASE.TEACHING);
  assert.equal(run.runId, '4');
  assert.equal(run.origin, 'http://127.0.0.1:5173');
});

test('stop cancels the run, bumps epoch, and ignores a late step', () => {
  let run = reduce(createRun(), { type: 'lesson_started', runId: 'run-a' });
  const epoch = run.epoch;
  run = reduce(run, { type: 'step_started', runId: 'run-a', stepId: 's1' });
  run = reduce(run, { type: 'stop' });
  assert.equal(run.phase, PHASE.CANCELLED);
  assert.ok(run.epoch > epoch);
  assert.equal(shouldPerform(run, run.epoch), false);
  const afterLate = reduce(run, { type: 'step_verified', runId: 'run-a', stepId: 's1' });
  assert.equal(afterLate.phase, PHASE.CANCELLED);
  assert.equal(cursorVisual(afterLate.phase), 'following');
});

test('pause holds the run and resume continues the same run id', () => {
  let run = reduce(createRun(), { type: 'lesson_started', runId: 'run-b' });
  run = reduce(run, { type: 'user_intervention' });
  assert.equal(run.phase, PHASE.PAUSED);
  assert.equal(shouldPerform(run, run.epoch), false);
  const pausedEpoch = run.epoch;
  run = reduce(run, { type: 'resume' });
  assert.equal(run.phase, PHASE.TEACHING);
  assert.equal(run.runId, 'run-b');
  assert.equal(run.epoch, pausedEpoch);
  assert.equal(shouldPerform(run, pausedEpoch), true);
});

test('a stale run id cannot complete or fail the active lesson', () => {
  let run = reduce(createRun(), { type: 'lesson_started', runId: 'current' });
  const ignored = reduce(run, { type: 'lesson_completed', runId: 'previous' });
  assert.equal(ignored.phase, PHASE.TEACHING);
  const failed = reduce(run, { type: 'lesson_error', runId: 'previous', error: 'nope' });
  assert.equal(failed.phase, PHASE.TEACHING);
  run = reduce(run, { type: 'stop' });
  const completedAfterStop = reduce(run, { type: 'lesson_completed', runId: 'current' });
  assert.equal(completedAfterStop.phase, PHASE.CANCELLED);
});
