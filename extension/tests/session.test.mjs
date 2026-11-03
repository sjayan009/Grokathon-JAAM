import test from 'node:test';
import assert from 'node:assert/strict';
import { aimPoint, distance } from '../lib/cursor.js';
import { createSession } from '../lib/session.js';

function harness({ reducedMotion = true, visible = true } = {}) {
  const clock = { now: 1000 };
  const posts = [];
  const clicks = [];
  const speech = [];
  const samples = [];
  let revealGate = null;
  const rect = { left: 300, top: 120, width: 80, height: 16, right: 380, bottom: 136 };
  const session = createSession({
    now: () => clock.now,
    sleep: async (ms) => { clock.now += ms; },
    reducedMotion: () => reducedMotion,
    cancelSpeech() { speech.push(clock.now); },
    postToPage(message) { posts.push(message); },
    resolveTarget(step) {
      return { ok: true, target: { id: step.targetId, kind: step.kind } };
    },
    measure() { return rect; },
    isVisible() { return visible; },
    reveal() {
      return new Promise((resolve) => { revealGate = resolve; });
    },
    click(target) { clicks.push(target.id); },
    verify() { return true; },
    paint(frame) { samples.push({ x: frame.cursor.x, y: frame.cursor.y, visual: frame.visual, phase: frame.phase }); },
    onState() {},
  });
  return { session, clock, posts, clicks, speech, samples, rect, gate: () => revealGate };
}

const highlight = {
  type: 'action_request',
  requestId: 'req-1',
  step: { kind: 'highlight_pdf', targetId: 'ldr_instruction' },
};

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 30 && !predicate(); attempt += 1) await Promise.resolve();
  assert.equal(Boolean(predicate()), true);
}

test('cursor moves onto the measured target and clicks once', async () => {
  const { session, clicks, samples, rect } = harness();
  session.handleAppMessage({ type: 'lesson_started', runId: 'run-1', planId: 'ldr' });
  const result = await session.handleAppMessage(highlight);
  const aim = aimPoint(rect);
  assert.equal(result.ok, true);
  assert.deepEqual(clicks, ['ldr_instruction']);
  assert.ok(distance(session.snapshot().cursor, aim) <= 2);
  assert.ok(samples.some((sample) => sample.visual === 'acting'));
});

test('smooth glide passes through intermediate points before the click', async () => {
  const { session, clicks, samples, rect } = harness({ reducedMotion: false });
  session.handleAppMessage({ type: 'lesson_started', runId: 'run-1' });
  const before = session.snapshot().cursor.x;
  const aim = aimPoint(rect);
  const result = await session.handleAppMessage(highlight);
  assert.equal(result.ok, true);
  assert.equal(clicks.length, 1);
  assert.ok(samples.some((sample) => sample.x > before + 5 && sample.x < aim.x - 5));
  assert.ok(distance({ x: samples.at(-1).x, y: samples.at(-1).y }, aim) <= 2);
});

test('stop cancels speech immediately and drops the in-flight click plus a late request', async () => {
  const { session, clicks, posts, speech, gate } = harness({ visible: false });
  session.handleAppMessage({ type: 'app_ready', documentId: 'demo-lc3', origin: 'http://localhost:5173' });
  const pending = session.handleAppMessage(highlight);
  await waitFor(() => gate());
  const stoppedAt = speech.length;
  session.handleControl({ type: 'control', command: 'stop' });
  assert.ok(speech.length > stoppedAt);
  assert.equal(posts.some((message) => message.type === 'command' && message.command === 'stop'), true);
  gate()(false);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /cancelled or paused/i);
  assert.deepEqual(clicks, []);
  const late = await session.handleAppMessage({ ...highlight, requestId: 'late' });
  assert.equal(late.ok, false);
  assert.deepEqual(clicks, []);
  assert.equal(session.snapshot().phase, 'cancelled');
});

test('pause from the pointer and resume does not click until the step is requested again', async () => {
  const clock = { now: 1000 };
  const clicks = [];
  const speech = [];
  let session;
  let brokeAway = false;
  session = createSession({
    now: () => clock.now,
    sleep: async (ms) => { clock.now += ms; },
    reducedMotion: () => false,
    cancelSpeech() { speech.push('cancel'); },
    postToPage() {},
    resolveTarget(step) { return { ok: true, target: { id: step.targetId } }; },
    measure() { return { left: 300, top: 80, width: 40, height: 16, right: 340, bottom: 96 }; },
    isVisible() { return true; },
    reveal: async () => true,
    click(target) { clicks.push(target.id); },
    verify() { return true; },
    paint(frame) {
      if (frame.visual === 'acting' && !brokeAway) {
        brokeAway = true;
        session.notePointer(4, 4, { trusted: true, movement: 40 });
      }
    },
    onState() {},
  });
  session.handleAppMessage({ type: 'lesson_started', runId: 'run-9' });
  const result = await session.handleAppMessage(highlight);
  assert.equal(result.ok, false);
  assert.match(result.error, /cancelled or paused/i);
  assert.deepEqual(clicks, []);
  assert.ok(speech.length >= 1);
  assert.equal(session.snapshot().phase, 'paused');
  session.handleControl({ type: 'control', command: 'resume' });
  assert.equal(session.snapshot().phase, 'teaching');
  const again = await session.handleAppMessage({ ...highlight, requestId: 'req-2' });
  assert.equal(again.ok, true);
  assert.deepEqual(clicks, ['ldr_instruction']);
});

test('user scroll interrupt does not reveal the target after pause', async () => {
  const { session, clicks, gate } = harness({ visible: false });
  session.handleAppMessage({ type: 'lesson_started', runId: 'run-3' });
  const pending = session.handleAppMessage(highlight);
  await waitFor(() => gate());
  session.userInterrupt();
  gate()(true);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.deepEqual(clicks, []);
  assert.equal(session.snapshot().phase, 'paused');
});

test('CURSOR_MOVE_TO acknowledges an extension measurement and rejects a foreign rectangle', async () => {
  const { session, rect } = harness();
  session.handleAppMessage({ type: 'lesson_started', runId: 'run-7' });
  const foreign = await session.cursorMoveTo({
    type: 'CURSOR_MOVE_TO',
    runId: 'run-7',
    viewportRect: { left: 1, top: 1, width: 20, height: 8 },
    measuredBy: 'grok',
  });
  assert.equal(foreign.ok, false);
  const moved = await session.cursorMoveTo({
    type: 'CURSOR_MOVE_TO',
    runId: 'run-7',
    measuredBy: 'extension',
    viewportRect: rect,
  });
  assert.equal(moved.ok, true);
  assert.equal(moved.runId, 'run-7');
  assert.ok(moved.sequence >= 1);
  assert.ok(moved.errorPx <= 2);
  assert.ok(distance({ x: moved.x, y: moved.y }, aimPoint(rect)) <= 2);
  const wrongRun = await session.cursorMoveTo({
    type: 'CURSOR_MOVE_TO',
    runId: 'other-run',
    anchorId: 'ldr_instruction',
  });
  assert.equal(wrongRun.ok, false);
});

test('follower catches the real pointer while observing', () => {
  const { session, clock } = harness();
  session.detect({ documentId: 'demo-lc3', origin: 'http://localhost:5173' });
  session.notePointer(140, 90);
  let cursor = session.snapshot().cursor;
  const startX = cursor.x;
  for (let step = 0; step < 30; step += 1) {
    clock.now += 16;
    cursor = session.tick(clock.now).cursor;
  }
  assert.ok(cursor.x > startX);
  assert.ok(distance(cursor, { x: 140 + 18, y: 90 + 12 }) < 1.5);
  assert.equal(session.snapshot().documentId, 'demo-lc3');
  assert.equal(session.snapshot().phase, 'observing');
});
