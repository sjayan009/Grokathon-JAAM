import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStudyUrl,
  parseAppMessage,
  parseCursorMoveTo,
  selectorFor,
  validateStep,
} from '../lib/bridge.js';

test('study tab detection accepts only the local mock workspace', () => {
  assert.equal(isStudyUrl('http://localhost:5173/'), true);
  assert.equal(isStudyUrl('http://127.0.0.1:5173/index.html'), true);
  assert.equal(isStudyUrl('http://localhost:5173/fixtures/demo.json'), false);
  assert.equal(isStudyUrl('https://localhost:5173/'), false);
  assert.equal(isStudyUrl('http://example.com/'), false);
});

test('page messages must use the mock source and allowlisted type', () => {
  const origin = 'http://localhost:5173';
  assert.equal(parseAppMessage({ source: 'smartpath-mock-app', type: 'app_ready', documentId: 'demo-lc3' }, origin, origin)?.type, 'app_ready');
  assert.equal(parseAppMessage({ source: 'smartpath-mock-app', type: 'CURSOR_MOVE_TO', viewportRect: { left: 1, top: 1, width: 1, height: 1 } }, origin, origin), null);
  assert.equal(parseAppMessage({ source: 'grok', type: 'action_request' }, origin, origin), null);
  assert.equal(parseAppMessage({ source: 'smartpath-mock-app', type: 'action_request' }, 'https://evil.test', origin), null);
});

test('target ids are allowlisted before a selector is built', () => {
  assert.equal(selectorFor({ kind: 'highlight_pdf', targetId: 'ldr_instruction' }), '[data-anchor-id="ldr_instruction"]');
  assert.equal(selectorFor({ kind: 'focus_graph', targetId: 'pointers' }), '[data-concept-id="pointers"]');
  assert.equal(selectorFor({ kind: 'ask_question', targetId: 'quiz' }), '#top-quiz');
  assert.equal(validateStep({ kind: 'highlight_pdf', targetId: '"><img' }).ok, false);
  assert.throws(() => selectorFor({ kind: 'click_anything', targetId: 'ldr_instruction' }));
});

test('CURSOR_MOVE_TO rejects coordinates that the extension did not measure', () => {
  const rejected = parseCursorMoveTo({
    type: 'CURSOR_MOVE_TO',
    runId: 'run-1',
    viewportRect: { left: 12, top: 12, width: 40, height: 10 },
    measuredBy: 'grok',
  });
  assert.equal(rejected.ok, false);
  const missing = parseCursorMoveTo({ type: 'CURSOR_MOVE_TO', runId: 'run-1', anchorId: 'no spaces' });
  assert.equal(missing.ok, false);
  const accepted = parseCursorMoveTo({
    type: 'CURSOR_MOVE_TO',
    runId: 'run-1',
    anchorId: 'ldr_instruction',
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.move.viewportRect, null);
  const measured = parseCursorMoveTo({
    type: 'CURSOR_MOVE_TO',
    runId: 'run-1',
    measuredBy: 'extension',
    viewportRect: { left: 10, top: 20, width: 30, height: 12 },
  });
  assert.equal(measured.ok, true);
  assert.equal(measured.move.viewportRect.width, 30);
});
