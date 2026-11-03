/** Run controller shared by the content script. DOM and Chrome I/O stay in the caller. */

import { aimPoint, distance, followPoint, followStep, glideDurationMs, glidePosition } from './cursor.js';
import {
  APP_SOURCE,
  EXT_SOURCE,
  CONTROL_COMMANDS,
  parseCursorMoveTo,
  validateStep,
} from './bridge.js';
import {
  PHASE,
  createRun,
  cursorLabel,
  cursorVisual,
  easesTowardPointer,
  reduce,
  shouldPerform,
} from './state-machine.js';

const CANCELLED_ERROR = 'Action cancelled or paused';

function noop() {}

export function createSession(deps) {
  const paint = deps.paint || noop;
  const onState = deps.onState || noop;
  let run = createRun();
  let pointer = { x: 80, y: 80 };
  let cursor = { x: 48, y: 64 };
  let lastNow = null;
  let glide = null;
  let acting = false;
  let listening = false;

  function visual() {
    return cursorVisual(run.phase, { acting, listening });
  }

  function snapshot() {
    return {
      phase: run.phase,
      visual: visual(),
      runId: run.runId,
      documentId: run.documentId,
      origin: run.origin,
      sequence: run.sequence,
      epoch: run.epoch,
      stepId: run.stepId,
      cursor: { x: cursor.x, y: cursor.y },
      acting,
      listening,
    };
  }

  function emit() {
    paint({
      cursor: { x: cursor.x, y: cursor.y },
      visual: visual(),
      label: cursorLabel(visual()),
      phase: run.phase,
      runId: run.runId,
      documentId: run.documentId,
      sequence: run.sequence,
    });
    onState(snapshot());
  }

  function tick(now) {
    const dt = lastNow == null ? 16 : Math.min(50, Math.max(0, now - lastNow));
    lastNow = now;
    if (glide) {
      if (glide.epoch !== run.epoch) {
        glide = null;
        acting = false;
      } else {
        const pos = glidePosition(glide.from, glide.to, now - glide.start, glide.duration);
        cursor = { x: pos.x, y: pos.y };
        if (pos.done) {
          cursor = { x: glide.to.x, y: glide.to.y };
          glide = null;
        }
      }
    } else if (easesTowardPointer(run.phase, acting)) {
      cursor = followStep(cursor, followPoint(pointer), dt);
    }
    emit();
    return snapshot();
  }

  function startGlide(to, epoch) {
    const from = { x: cursor.x, y: cursor.y };
    const duration = glideDurationMs(from, to, { reducedMotion: Boolean(deps.reducedMotion && deps.reducedMotion()) });
    glide = { from, to: { x: to.x, y: to.y }, start: deps.now(), duration, epoch };
    acting = true;
    emit();
  }

  async function waitGlide(epoch) {
    const started = deps.now();
    tick(deps.now());
    while (glide && run.epoch === epoch) {
      if (deps.now() > started + 5000) return false;
      await deps.sleep(16);
      tick(deps.now());
    }
    return run.epoch === epoch && !glide;
  }

  async function glideTo(to, epoch) {
    if (run.epoch !== epoch) return false;
    startGlide(to, epoch);
    return waitGlide(epoch);
  }

  function post(message) {
    deps.postToPage(message);
  }

  function requestStop({ notifyPage }) {
    run = reduce(run, { type: 'stop' });
    acting = false;
    glide = null;
    listening = false;
    deps.cancelSpeech('stop');
    if (notifyPage) post({ source: EXT_SOURCE, type: 'command', command: 'stop', prompt: '' });
    emit();
    return snapshot();
  }

  function requestPause({ notifyPage }) {
    const before = run.epoch;
    run = reduce(run, { type: 'pause' });
    if (run.epoch === before) return snapshot();
    acting = false;
    glide = null;
    listening = false;
    deps.cancelSpeech('pause');
    if (notifyPage) post({ source: EXT_SOURCE, type: 'command', command: 'pause', prompt: '' });
    emit();
    return snapshot();
  }

  function requestResume({ notifyPage }) {
    run = reduce(run, { type: 'resume' });
    if (notifyPage) post({ source: EXT_SOURCE, type: 'command', command: 'resume', prompt: '' });
    emit();
    return snapshot();
  }

  function detect({ documentId, origin }) {
    run = reduce(run, { type: 'tab_detected', documentId, origin });
    emit();
    return snapshot();
  }

  function notePointer(x, y, { trusted = false, movement = 0 } = {}) {
    pointer = { x, y };
    if (trusted && acting && movement > 18 && (run.phase === PHASE.TEACHING || run.phase === PHASE.EXPLAINING || run.phase === PHASE.PLANNING)) {
      requestPause({ notifyPage: true });
    }
  }

  function userInterrupt() {
    if (run.phase === PHASE.TEACHING || run.phase === PHASE.EXPLAINING || run.phase === PHASE.PLANNING) {
      requestPause({ notifyPage: true });
    }
  }

  function reply(requestId, ok, error) {
    const sequence = run.sequence + 1;
    run = { ...run, sequence };
    const message = {
      source: EXT_SOURCE,
      type: 'action_result',
      requestId,
      ok,
      runId: run.runId,
      sequence,
    };
    if (!ok) message.error = error || CANCELLED_ERROR;
    post(message);
    emit();
    return message;
  }

  async function runAction(data) {
    if (run.phase === PHASE.CANCELLED || run.phase === PHASE.PAUSED || run.phase === PHASE.ERROR) {
      return reply(data.requestId, false, CANCELLED_ERROR);
    }
    if (run.phase === PHASE.IDLE || run.phase === PHASE.OBSERVING || run.phase === PHASE.PLANNING || run.phase === PHASE.COMPLETED) {
      run = reduce(run, {
        type: 'lesson_started',
        runId: run.runId || `adopted-${data.requestId || 'step'}`,
        documentId: run.documentId,
        planId: run.planId,
      });
    }
    const epoch = run.epoch;
    if (!shouldPerform(run, epoch)) return reply(data.requestId, false, CANCELLED_ERROR);
    try {
      const check = validateStep(data.step);
      if (!check.ok) throw new Error(check.error);
      await deps.sleep(0);
      if (run.epoch !== epoch) throw new Error(CANCELLED_ERROR);
      const found = deps.resolveTarget(check.step);
      if (!found?.ok || !found.target) throw new Error(found?.error || 'Target is not available');
      let rect = deps.measure(found.target);
      if (!deps.isVisible(rect)) {
        const revealed = await deps.reveal(found.target, () => run.epoch === epoch);
        if (!revealed || run.epoch !== epoch) throw new Error(CANCELLED_ERROR);
        rect = deps.measure(found.target);
      }
      if (!deps.isVisible(rect)) throw new Error('Target is not visible in the viewport');
      const arrived = await glideTo(aimPoint(rect), epoch);
      if (!arrived) throw new Error(CANCELLED_ERROR);
      const corrected = deps.measure(found.target);
      const nextAim = aimPoint(corrected);
      if (distance(cursor, nextAim) > 8) {
        const again = await glideTo(nextAim, epoch);
        if (!again) throw new Error(CANCELLED_ERROR);
      }
      if (run.epoch !== epoch) throw new Error(CANCELLED_ERROR);
      deps.click(found.target);
      if (run.epoch !== epoch) throw new Error(CANCELLED_ERROR);
      if (!deps.verify(check.step, found.target)) throw new Error('Real UI transition did not verify');
      if (run.epoch !== epoch) throw new Error(CANCELLED_ERROR);
      acting = false;
      return reply(data.requestId, true);
    } catch (error) {
      acting = false;
      glide = null;
      if (run.phase !== PHASE.PAUSED && run.phase !== PHASE.CANCELLED && !/cancelled or paused/i.test(String(error?.message || error))) {
        run = reduce(run, { type: 'lesson_error', error: String(error?.message || error), runId: run.runId });
      }
      return reply(data.requestId, false, String(error?.message || error));
    }
  }

  function handleAppMessage(data) {
    switch (data.type) {
      case 'app_ready':
        return detect({ documentId: data.documentId, origin: data.origin || run.origin });
      case 'lesson_started':
        run = reduce(run, { type: 'lesson_started', runId: data.runId, planId: data.planId, documentId: data.documentId || run.documentId });
        emit();
        return snapshot();
      case 'step_started':
        run = reduce(run, { type: 'step_started', runId: data.runId, stepId: data.stepId });
        emit();
        return snapshot();
      case 'step_verified':
        run = reduce(run, { type: 'step_verified', runId: data.runId, stepId: data.stepId });
        emit();
        return snapshot();
      case 'lesson_paused':
        return requestPause({ notifyPage: false });
      case 'lesson_resumed':
        return requestResume({ notifyPage: false });
      case 'lesson_stopped':
        return requestStop({ notifyPage: false });
      case 'lesson_completed':
        if (run.phase !== PHASE.CANCELLED) {
          run = reduce(run, { type: 'lesson_completed', runId: data.runId });
          acting = false;
          glide = null;
          emit();
        }
        return snapshot();
      case 'lesson_error':
        run = reduce(run, { type: 'lesson_error', runId: data.runId, error: data.error });
        acting = false;
        glide = null;
        emit();
        return snapshot();
      case 'quiz_opened':
        run = reduce(run, { type: 'await_student' });
        emit();
        return snapshot();
      case 'action_request':
        return runAction(data);
      case 'source_selected':
      case 'concept_focused':
      case 'quiz_answered':
        return snapshot();
      default:
        return snapshot();
    }
  }

  function handleControl(message) {
    if (!message || message.type !== 'control' || !CONTROL_COMMANDS.includes(message.command)) {
      return { ok: false, error: 'Unsupported command', ...snapshot() };
    }
    const prompt = typeof message.prompt === 'string' ? message.prompt.slice(0, 1000) : '';
    if (message.command === 'stop') requestStop({ notifyPage: true });
    else if (message.command === 'pause') requestPause({ notifyPage: true });
    else if (message.command === 'resume') requestResume({ notifyPage: true });
    else {
      if (message.command === 'teach') run = reduce(run, { type: 'teach_requested' });
      if (message.command === 'ask') listening = false;
      post({ source: EXT_SOURCE, type: 'command', command: message.command, prompt });
      emit();
    }
    const state = snapshot();
    return { ok: true, status: state.visual, studyTab: true, ...state };
  }

  async function cursorMoveTo(message) {
    const parsed = parseCursorMoveTo(message);
    if (!parsed.ok) {
      return { ok: false, type: 'CURSOR_MOVE_TO_ACK', error: parsed.error, runId: message?.runId ?? null };
    }
    if (!run.runId || parsed.move.runId !== String(run.runId)) {
      return { ok: false, type: 'CURSOR_MOVE_TO_ACK', error: 'runId does not match the active run', runId: parsed.move.runId };
    }
    if (run.phase === PHASE.CANCELLED || run.phase === PHASE.PAUSED || run.phase === PHASE.ERROR) {
      return { ok: false, type: 'CURSOR_MOVE_TO_ACK', error: 'Run is not accepting movement', runId: run.runId };
    }
    let rect = parsed.move.viewportRect;
    if (!rect) {
      const step = parsed.move.anchorId
        ? { kind: 'highlight_pdf', targetId: parsed.move.anchorId }
        : { kind: 'focus_graph', targetId: parsed.move.conceptId };
      const found = deps.resolveTarget(step);
      if (!found?.ok || !found.target) {
        return { ok: false, type: 'CURSOR_MOVE_TO_ACK', error: found?.error || 'Target is not available', runId: run.runId };
      }
      rect = deps.measure(found.target);
    }
    const epoch = run.epoch;
    const dest = aimPoint(rect);
    const arrived = await glideTo(dest, epoch);
    if (!arrived) {
      return { ok: false, type: 'CURSOR_MOVE_TO_ACK', error: CANCELLED_ERROR, runId: run.runId };
    }
    const errorPx = distance(cursor, dest);
    const sequence = run.sequence + 1;
    run = { ...run, sequence };
    acting = false;
    emit();
    return {
      ok: errorPx <= 2,
      type: 'CURSOR_MOVE_TO_ACK',
      runId: run.runId,
      sequence,
      x: cursor.x,
      y: cursor.y,
      errorPx,
    };
  }

  function status() {
    const state = snapshot();
    return { ok: true, status: state.visual, studyTab: true, ...state };
  }

  emit();

  return {
    tick,
    detect,
    notePointer,
    userInterrupt,
    handleAppMessage,
    handleControl,
    cursorMoveTo,
    requestStop,
    requestPause,
    requestResume,
    status,
    snapshot,
    setListening(nextListening) {
      listening = Boolean(nextListening);
      emit();
    },
  };
}

export { APP_SOURCE, CANCELLED_ERROR };
