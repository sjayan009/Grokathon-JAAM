/** Lesson run state. Stop and pause bump `epoch` so in-flight motion cannot click. */

export const PHASE = Object.freeze({
  IDLE: 'idle',
  OBSERVING: 'observing',
  PLANNING: 'planning',
  TEACHING: 'teaching',
  EXPLAINING: 'explaining',
  AWAITING: 'awaiting_student',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  ERROR: 'error',
  COMPLETED: 'completed',
});

export const CURSOR_VISUAL = Object.freeze({
  FOLLOWING: 'following',
  LISTENING: 'listening',
  THINKING: 'thinking',
  PLANNING: 'planning',
  ACTING: 'acting',
  AWAITING: 'awaiting_student',
  PAUSED: 'paused',
  DONE: 'done',
  ERROR: 'error',
});

const ACTIVE = new Set([PHASE.TEACHING, PHASE.EXPLAINING, PHASE.PLANNING, PHASE.AWAITING]);

export function createRun() {
  return {
    phase: PHASE.IDLE,
    runId: null,
    documentId: null,
    origin: null,
    sequence: 0,
    epoch: 0,
    planId: null,
    stepId: null,
    lastError: null,
  };
}

function next(state, patch) {
  return { ...state, ...patch };
}

export function cursorVisual(phase, { acting = false, listening = false } = {}) {
  if (listening) return CURSOR_VISUAL.LISTENING;
  switch (phase) {
    case PHASE.IDLE:
    case PHASE.OBSERVING:
    case PHASE.CANCELLED:
      return CURSOR_VISUAL.FOLLOWING;
    case PHASE.PLANNING:
      return CURSOR_VISUAL.PLANNING;
    case PHASE.TEACHING:
    case PHASE.EXPLAINING:
      return acting ? CURSOR_VISUAL.ACTING : CURSOR_VISUAL.THINKING;
    case PHASE.AWAITING:
      return CURSOR_VISUAL.AWAITING;
    case PHASE.PAUSED:
      return CURSOR_VISUAL.PAUSED;
    case PHASE.COMPLETED:
      return CURSOR_VISUAL.DONE;
    case PHASE.ERROR:
      return CURSOR_VISUAL.ERROR;
    default: {
      const unknown = phase;
      throw new Error(`Unknown cursor phase: ${unknown}`);
    }
  }
}

export function cursorLabel(visual) {
  switch (visual) {
    case CURSOR_VISUAL.FOLLOWING:
      return 'SmartPath';
    case CURSOR_VISUAL.LISTENING:
      return 'Listening';
    case CURSOR_VISUAL.THINKING:
      return 'Thinking';
    case CURSOR_VISUAL.PLANNING:
      return 'Planning';
    case CURSOR_VISUAL.ACTING:
      return 'AI is pointing';
    case CURSOR_VISUAL.AWAITING:
      return 'Your turn';
    case CURSOR_VISUAL.PAUSED:
      return 'Paused';
    case CURSOR_VISUAL.DONE:
      return 'Done';
    case CURSOR_VISUAL.ERROR:
      return 'Needs attention';
    default: {
      const unknown = visual;
      throw new Error(`Unknown cursor visual: ${unknown}`);
    }
  }
}

function sameRun(state, event) {
  if (event.runId == null || state.runId == null) return true;
  return String(event.runId) === String(state.runId);
}

export function reduce(state, event) {
  switch (event?.type) {
    case 'tab_detected': {
      const identity = {
        documentId: event.documentId ?? state.documentId,
        origin: event.origin ?? state.origin,
      };
      if (ACTIVE.has(state.phase) || state.phase === PHASE.PAUSED) return next(state, identity);
      return next(state, { ...identity, phase: PHASE.OBSERVING, lastError: null });
    }
    case 'teach_requested':
      if (state.phase === PHASE.TEACHING || state.phase === PHASE.PAUSED || state.phase === PHASE.EXPLAINING) {
        return state;
      }
      return next(state, { phase: PHASE.PLANNING, lastError: null });
    case 'lesson_started':
      return next(state, {
        phase: PHASE.TEACHING,
        runId: String(event.runId),
        documentId: event.documentId ?? state.documentId,
        planId: event.planId ?? null,
        sequence: 0,
        epoch: state.epoch + 1,
        stepId: null,
        lastError: null,
      });
    case 'step_started':
      if (!sameRun(state, event)) return state;
      if (state.phase === PHASE.CANCELLED || state.phase === PHASE.PAUSED || state.phase === PHASE.ERROR) return state;
      return next(state, {
        phase: PHASE.TEACHING,
        sequence: state.sequence + 1,
        stepId: event.stepId ?? state.stepId,
      });
    case 'step_verified':
      if (!sameRun(state, event)) return state;
      if (state.phase !== PHASE.TEACHING && state.phase !== PHASE.EXPLAINING) return state;
      return next(state, { sequence: state.sequence + 1, stepId: event.stepId ?? state.stepId });
    case 'pause':
    case 'user_intervention':
      if (!ACTIVE.has(state.phase)) return state;
      return next(state, { phase: PHASE.PAUSED, epoch: state.epoch + 1 });
    case 'resume':
      if (state.phase !== PHASE.PAUSED) return state;
      return next(state, { phase: PHASE.TEACHING });
    case 'stop':
      return next(state, {
        phase: PHASE.CANCELLED,
        epoch: state.epoch + 1,
        stepId: null,
        lastError: null,
      });
    case 'lesson_completed':
      if (!sameRun(state, event)) return state;
      if (state.phase === PHASE.CANCELLED || state.phase === PHASE.ERROR) return state;
      return next(state, { phase: PHASE.COMPLETED, stepId: null, sequence: state.sequence + 1 });
    case 'lesson_error':
      if (state.phase === PHASE.CANCELLED) return state;
      if (!sameRun(state, event)) return state;
      return next(state, {
        phase: PHASE.ERROR,
        epoch: state.epoch + 1,
        lastError: event.error || 'error',
      });
    case 'await_student':
      if (state.phase !== PHASE.TEACHING && state.phase !== PHASE.EXPLAINING) return state;
      return next(state, { phase: PHASE.AWAITING });
    default:
      return state;
  }
}

export function shouldPerform(state, capturedEpoch) {
  if (!state || capturedEpoch !== state.epoch) return false;
  if (state.phase === PHASE.CANCELLED || state.phase === PHASE.PAUSED || state.phase === PHASE.ERROR) return false;
  return state.phase === PHASE.TEACHING
    || state.phase === PHASE.EXPLAINING
    || state.phase === PHASE.PLANNING
    || state.phase === PHASE.OBSERVING
    || state.phase === PHASE.IDLE;
}

/** Between actions the tip eases back toward the user pointer. Paused and error hold still. */
export function easesTowardPointer(phase, acting) {
  if (acting) return false;
  return phase !== PHASE.PAUSED && phase !== PHASE.ERROR;
}
