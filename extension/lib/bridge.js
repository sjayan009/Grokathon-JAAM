/** Message allowlists for the mock bridge. Coordinates from the page or a model are rejected. */

export const APP_SOURCE = 'smartpath-mock-app';
export const EXT_SOURCE = 'smartpath-live-extension';

export const CONTROL_COMMANDS = Object.freeze(['teach', 'pause', 'resume', 'stop', 'quiz', 'ask']);

export const PAGE_EVENT_TYPES = new Set([
  'app_ready',
  'action_request',
  'lesson_started',
  'step_started',
  'step_verified',
  'lesson_paused',
  'lesson_resumed',
  'lesson_stopped',
  'lesson_completed',
  'lesson_error',
  'source_selected',
  'concept_focused',
  'quiz_opened',
  'quiz_answered',
]);

const TARGET_ID = /^[a-z0-9_-]{1,70}$/;
const STEP_KINDS = new Set(['highlight_pdf', 'focus_graph', 'ask_question']);

export function isStudyOrigin(origin) {
  return origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173';
}

export function isStudyUrl(url) {
  try {
    const parsed = new URL(url);
    if (!isStudyOrigin(parsed.origin)) return false;
    return parsed.pathname === '/' || parsed.pathname === '/index.html';
  } catch {
    return false;
  }
}

export function parseAppMessage(data, origin, expectedOrigin) {
  if (!data || typeof data !== 'object') return null;
  if (data.source !== APP_SOURCE) return null;
  if (origin !== expectedOrigin || !isStudyOrigin(origin)) return null;
  if (!PAGE_EVENT_TYPES.has(data.type)) return null;
  return data;
}

export function validateStep(step) {
  if (!step || typeof step !== 'object') return { ok: false, error: 'Missing step' };
  if (!STEP_KINDS.has(step.kind)) return { ok: false, error: 'Unknown action type' };
  if (!TARGET_ID.test(String(step.targetId || ''))) return { ok: false, error: 'Invalid target ID' };
  return { ok: true, step: { kind: step.kind, targetId: String(step.targetId) } };
}

export function selectorFor(step) {
  const check = validateStep(step);
  if (!check.ok) throw new Error(check.error);
  if (step.kind === 'highlight_pdf') return `[data-anchor-id="${check.step.targetId}"]`;
  if (step.kind === 'focus_graph') return `[data-concept-id="${check.step.targetId}"]`;
  if (step.kind === 'ask_question') return '#top-quiz';
  throw new Error('Unknown action type');
}

function isMeasuredRect(rect) {
  if (!rect || typeof rect !== 'object') return false;
  return ['left', 'top', 'width', 'height'].every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]));
}

/**
 * CURSOR_MOVE_TO({runId, anchorId|conceptId|viewportRect}).
 * viewportRect is accepted only when this extension measured it.
 * Grok, the page, and other senders cannot supply coordinates.
 */
export function parseCursorMoveTo(message) {
  if (!message || message.type !== 'CURSOR_MOVE_TO') {
    return { ok: false, error: 'Not a CURSOR_MOVE_TO request' };
  }
  if (message.viewportRect && message.measuredBy !== 'extension') {
    return { ok: false, error: 'Arbitrary coordinates are not accepted' };
  }
  if (message.runId == null || String(message.runId).length === 0 || String(message.runId).length > 80) {
    return { ok: false, error: 'CURSOR_MOVE_TO requires runId' };
  }
  const anchorId = typeof message.anchorId === 'string' && TARGET_ID.test(message.anchorId) ? message.anchorId : null;
  const conceptId = typeof message.conceptId === 'string' && TARGET_ID.test(message.conceptId) ? message.conceptId : null;
  const viewportRect = message.measuredBy === 'extension' && isMeasuredRect(message.viewportRect)
    ? { left: message.viewportRect.left, top: message.viewportRect.top, width: message.viewportRect.width, height: message.viewportRect.height }
    : null;
  if (!anchorId && !conceptId && !viewportRect) {
    return { ok: false, error: 'CURSOR_MOVE_TO needs an anchorId, conceptId, or extension-measured viewportRect' };
  }
  return {
    ok: true,
    move: { runId: String(message.runId), anchorId, conceptId, viewportRect },
  };
}
