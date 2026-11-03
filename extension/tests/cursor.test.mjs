import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOW_OFFSET,
  aimPoint,
  bodyCoversPassage,
  distance,
  followOffsetDistance,
  followPoint,
  followStep,
  glideDurationMs,
  glidePosition,
} from '../lib/cursor.js';

test('follower offset stays in the 18–24px band', () => {
  const gap = followOffsetDistance(FOLLOW_OFFSET);
  assert.ok(gap >= 18 && gap <= 24, `offset ${gap}`);
  const parked = followPoint({ x: 40, y: 50 });
  assert.equal(parked.x, 40 + FOLLOW_OFFSET.x);
  assert.equal(parked.y, 50 + FOLLOW_OFFSET.y);
});

test('follower eases toward the pointer instead of snapping', () => {
  const desired = followPoint({ x: 200, y: 120 });
  let cursor = { x: 0, y: 0 };
  const samples = [cursor.x];
  for (let step = 0; step < 40; step += 1) {
    cursor = followStep(cursor, desired, 16);
    samples.push(cursor.x);
  }
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] > samples[index - 1]);
  }
  assert.ok(distance(cursor, desired) < 1);
  assert.ok(samples[1] < desired.x - 20);
});

test('glide lands on the target and moves smoothly between endpoints', () => {
  const from = { x: 10, y: 10 };
  const to = { x: 250, y: 90 };
  assert.equal(glideDurationMs(from, to, { reducedMotion: true }), 0);
  const snapped = glidePosition(from, to, 0, 0);
  assert.deepEqual({ x: snapped.x, y: snapped.y }, to);
  const duration = glideDurationMs(from, to, { reducedMotion: false });
  assert.ok(duration >= 180 && duration <= 640);
  const mid = glidePosition(from, to, duration / 2, duration);
  assert.ok(mid.x > from.x && mid.x < to.x);
  assert.equal(mid.done, false);
  const end = glidePosition(from, to, duration, duration);
  assert.equal(end.done, true);
  assert.ok(distance(end, to) < 0.001);
});

test('aim point touches the passage from outside and does not cover it', () => {
  const rect = { left: 180, top: 90, width: 70, height: 18 };
  const tip = aimPoint(rect);
  assert.ok(tip.x < rect.left);
  assert.equal(tip.y, rect.top + rect.height / 2);
  assert.equal(bodyCoversPassage(tip, rect), false);
});
