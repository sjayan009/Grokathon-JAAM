/* Generated from extension/content.js and extension/lib. Do not edit by hand. */
(() => {
  // extension/lib/bridge.js
  var APP_SOURCE = "smartpath-mock-app";
  var EXT_SOURCE = "smartpath-live-extension";
  var CONTROL_COMMANDS = Object.freeze(["teach", "pause", "resume", "stop", "quiz", "ask"]);
  var PAGE_EVENT_TYPES = /* @__PURE__ */ new Set([
    "app_ready",
    "action_request",
    "lesson_started",
    "step_started",
    "step_verified",
    "lesson_paused",
    "lesson_resumed",
    "lesson_stopped",
    "lesson_completed",
    "lesson_error",
    "source_selected",
    "concept_focused",
    "quiz_opened",
    "quiz_answered"
  ]);
  var TARGET_ID = /^[a-z0-9_-]{1,70}$/;
  var STEP_KINDS = /* @__PURE__ */ new Set(["highlight_pdf", "focus_graph", "ask_question"]);
  function isStudyOrigin(origin) {
    return origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173";
  }
  function isStudyUrl(url) {
    try {
      const parsed = new URL(url);
      if (!isStudyOrigin(parsed.origin)) return false;
      return parsed.pathname === "/" || parsed.pathname === "/index.html";
    } catch {
      return false;
    }
  }
  function parseAppMessage(data, origin, expectedOrigin) {
    if (!data || typeof data !== "object") return null;
    if (data.source !== APP_SOURCE) return null;
    if (origin !== expectedOrigin || !isStudyOrigin(origin)) return null;
    if (!PAGE_EVENT_TYPES.has(data.type)) return null;
    return data;
  }
  function validateStep(step) {
    if (!step || typeof step !== "object") return { ok: false, error: "Missing step" };
    if (!STEP_KINDS.has(step.kind)) return { ok: false, error: "Unknown action type" };
    if (!TARGET_ID.test(String(step.targetId || ""))) return { ok: false, error: "Invalid target ID" };
    return { ok: true, step: { kind: step.kind, targetId: String(step.targetId) } };
  }
  function selectorFor(step) {
    const check = validateStep(step);
    if (!check.ok) throw new Error(check.error);
    if (step.kind === "highlight_pdf") return `[data-anchor-id="${check.step.targetId}"]`;
    if (step.kind === "focus_graph") return `[data-concept-id="${check.step.targetId}"]`;
    if (step.kind === "ask_question") return "#top-quiz";
    throw new Error("Unknown action type");
  }
  function isMeasuredRect(rect) {
    if (!rect || typeof rect !== "object") return false;
    return ["left", "top", "width", "height"].every((key) => typeof rect[key] === "number" && Number.isFinite(rect[key]));
  }
  function parseCursorMoveTo(message) {
    if (!message || message.type !== "CURSOR_MOVE_TO") {
      return { ok: false, error: "Not a CURSOR_MOVE_TO request" };
    }
    if (message.viewportRect && message.measuredBy !== "extension") {
      return { ok: false, error: "Arbitrary coordinates are not accepted" };
    }
    if (message.runId == null || String(message.runId).length === 0 || String(message.runId).length > 80) {
      return { ok: false, error: "CURSOR_MOVE_TO requires runId" };
    }
    const anchorId = typeof message.anchorId === "string" && TARGET_ID.test(message.anchorId) ? message.anchorId : null;
    const conceptId = typeof message.conceptId === "string" && TARGET_ID.test(message.conceptId) ? message.conceptId : null;
    const viewportRect = message.measuredBy === "extension" && isMeasuredRect(message.viewportRect) ? { left: message.viewportRect.left, top: message.viewportRect.top, width: message.viewportRect.width, height: message.viewportRect.height } : null;
    if (!anchorId && !conceptId && !viewportRect) {
      return { ok: false, error: "CURSOR_MOVE_TO needs an anchorId, conceptId, or extension-measured viewportRect" };
    }
    return {
      ok: true,
      move: { runId: String(message.runId), anchorId, conceptId, viewportRect }
    };
  }

  // extension/lib/cursor.js
  var FOLLOW_OFFSET = Object.freeze({ x: 18, y: 12 });
  var AIM_MARGIN_PX = 8;
  function followPoint(pointer, offset = FOLLOW_OFFSET) {
    return { x: pointer.x + offset.x, y: pointer.y + offset.y };
  }
  function aimPoint(rect, margin = AIM_MARGIN_PX) {
    const height = Number.isFinite(rect?.height) ? rect.height : 0;
    return {
      x: rect.left - margin,
      y: rect.top + height / 2
    };
  }
  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function lerp(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  function easeOutCubic(t) {
    const clamped = Math.min(1, Math.max(0, t));
    const u = 1 - clamped;
    return 1 - u * u * u;
  }
  function glideDurationMs(from, to, {
    reducedMotion = false,
    min = 180,
    max = 640,
    pxPerMs = 1.15
  } = {}) {
    if (reducedMotion) return 0;
    const px = distance(from, to);
    return Math.round(Math.max(min, Math.min(max, px / pxPerMs)));
  }
  function glidePosition(from, to, elapsedMs, durationMs) {
    if (!(durationMs > 0)) return { x: to.x, y: to.y, done: true };
    const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
    const point = lerp(from, to, easeOutCubic(t));
    return { x: point.x, y: point.y, done: t >= 1 };
  }
  function followStep(current, desired, dtMs, tauMs = 70) {
    if (!(dtMs > 0)) return { x: current.x, y: current.y };
    const alpha = 1 - Math.exp(-dtMs / tauMs);
    return lerp(current, desired, alpha);
  }

  // extension/lib/state-machine.js
  var PHASE = Object.freeze({
    IDLE: "idle",
    OBSERVING: "observing",
    PLANNING: "planning",
    TEACHING: "teaching",
    EXPLAINING: "explaining",
    AWAITING: "awaiting_student",
    PAUSED: "paused",
    CANCELLED: "cancelled",
    ERROR: "error",
    COMPLETED: "completed"
  });
  var CURSOR_VISUAL = Object.freeze({
    FOLLOWING: "following",
    LISTENING: "listening",
    THINKING: "thinking",
    PLANNING: "planning",
    ACTING: "acting",
    AWAITING: "awaiting_student",
    PAUSED: "paused",
    DONE: "done",
    ERROR: "error"
  });
  var ACTIVE = /* @__PURE__ */ new Set([PHASE.TEACHING, PHASE.EXPLAINING, PHASE.PLANNING, PHASE.AWAITING]);
  function createRun() {
    return {
      phase: PHASE.IDLE,
      runId: null,
      documentId: null,
      origin: null,
      sequence: 0,
      epoch: 0,
      planId: null,
      stepId: null,
      lastError: null
    };
  }
  function next(state, patch) {
    return { ...state, ...patch };
  }
  function cursorVisual(phase, { acting = false, listening = false } = {}) {
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
  function cursorLabel(visual) {
    switch (visual) {
      case CURSOR_VISUAL.FOLLOWING:
        return "SmartPath";
      case CURSOR_VISUAL.LISTENING:
        return "Listening";
      case CURSOR_VISUAL.THINKING:
        return "Thinking";
      case CURSOR_VISUAL.PLANNING:
        return "Planning";
      case CURSOR_VISUAL.ACTING:
        return "AI is pointing";
      case CURSOR_VISUAL.AWAITING:
        return "Your turn";
      case CURSOR_VISUAL.PAUSED:
        return "Paused";
      case CURSOR_VISUAL.DONE:
        return "Done";
      case CURSOR_VISUAL.ERROR:
        return "Needs attention";
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
  function reduce(state, event) {
    switch (event?.type) {
      case "tab_detected": {
        const identity = {
          documentId: event.documentId ?? state.documentId,
          origin: event.origin ?? state.origin
        };
        if (ACTIVE.has(state.phase) || state.phase === PHASE.PAUSED) return next(state, identity);
        return next(state, { ...identity, phase: PHASE.OBSERVING, lastError: null });
      }
      case "teach_requested":
        if (state.phase === PHASE.TEACHING || state.phase === PHASE.PAUSED || state.phase === PHASE.EXPLAINING) {
          return state;
        }
        return next(state, { phase: PHASE.PLANNING, lastError: null });
      case "lesson_started":
        return next(state, {
          phase: PHASE.TEACHING,
          runId: String(event.runId),
          documentId: event.documentId ?? state.documentId,
          planId: event.planId ?? null,
          sequence: 0,
          epoch: state.epoch + 1,
          stepId: null,
          lastError: null
        });
      case "step_started":
        if (!sameRun(state, event)) return state;
        if (state.phase === PHASE.CANCELLED || state.phase === PHASE.PAUSED || state.phase === PHASE.ERROR) return state;
        return next(state, {
          phase: PHASE.TEACHING,
          sequence: state.sequence + 1,
          stepId: event.stepId ?? state.stepId
        });
      case "step_verified":
        if (!sameRun(state, event)) return state;
        if (state.phase !== PHASE.TEACHING && state.phase !== PHASE.EXPLAINING) return state;
        return next(state, { sequence: state.sequence + 1, stepId: event.stepId ?? state.stepId });
      case "pause":
      case "user_intervention":
        if (!ACTIVE.has(state.phase)) return state;
        return next(state, { phase: PHASE.PAUSED, epoch: state.epoch + 1 });
      case "resume":
        if (state.phase !== PHASE.PAUSED) return state;
        return next(state, { phase: PHASE.TEACHING });
      case "stop":
        return next(state, {
          phase: PHASE.CANCELLED,
          epoch: state.epoch + 1,
          stepId: null,
          lastError: null
        });
      case "lesson_completed":
        if (!sameRun(state, event)) return state;
        if (state.phase === PHASE.CANCELLED || state.phase === PHASE.ERROR) return state;
        return next(state, { phase: PHASE.COMPLETED, stepId: null, sequence: state.sequence + 1 });
      case "lesson_error":
        if (state.phase === PHASE.CANCELLED) return state;
        if (!sameRun(state, event)) return state;
        return next(state, {
          phase: PHASE.ERROR,
          epoch: state.epoch + 1,
          lastError: event.error || "error"
        });
      case "await_student":
        if (state.phase !== PHASE.TEACHING && state.phase !== PHASE.EXPLAINING) return state;
        return next(state, { phase: PHASE.AWAITING });
      default:
        return state;
    }
  }
  function shouldPerform(state, capturedEpoch) {
    if (!state || capturedEpoch !== state.epoch) return false;
    if (state.phase === PHASE.CANCELLED || state.phase === PHASE.PAUSED || state.phase === PHASE.ERROR) return false;
    return state.phase === PHASE.TEACHING || state.phase === PHASE.EXPLAINING || state.phase === PHASE.PLANNING || state.phase === PHASE.OBSERVING || state.phase === PHASE.IDLE;
  }
  function easesTowardPointer(phase, acting) {
    if (acting) return false;
    return phase !== PHASE.PAUSED && phase !== PHASE.ERROR;
  }

  // extension/lib/session.js
  var CANCELLED_ERROR = "Action cancelled or paused";
  function noop() {
  }
  function createSession(deps) {
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
        listening
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
        sequence: run.sequence
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
        if (deps.now() > started + 5e3) return false;
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
      run = reduce(run, { type: "stop" });
      acting = false;
      glide = null;
      listening = false;
      deps.cancelSpeech("stop");
      if (notifyPage) post({ source: EXT_SOURCE, type: "command", command: "stop", prompt: "" });
      emit();
      return snapshot();
    }
    function requestPause({ notifyPage }) {
      const before = run.epoch;
      run = reduce(run, { type: "pause" });
      if (run.epoch === before) return snapshot();
      acting = false;
      glide = null;
      listening = false;
      deps.cancelSpeech("pause");
      if (notifyPage) post({ source: EXT_SOURCE, type: "command", command: "pause", prompt: "" });
      emit();
      return snapshot();
    }
    function requestResume({ notifyPage }) {
      run = reduce(run, { type: "resume" });
      if (notifyPage) post({ source: EXT_SOURCE, type: "command", command: "resume", prompt: "" });
      emit();
      return snapshot();
    }
    function detect({ documentId, origin }) {
      run = reduce(run, { type: "tab_detected", documentId, origin });
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
        type: "action_result",
        requestId,
        ok,
        runId: run.runId,
        sequence
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
          type: "lesson_started",
          runId: run.runId || `adopted-${data.requestId || "step"}`,
          documentId: run.documentId,
          planId: run.planId
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
        if (!found?.ok || !found.target) throw new Error(found?.error || "Target is not available");
        let rect = deps.measure(found.target);
        if (!deps.isVisible(rect)) {
          const revealed = await deps.reveal(found.target, () => run.epoch === epoch);
          if (!revealed || run.epoch !== epoch) throw new Error(CANCELLED_ERROR);
          rect = deps.measure(found.target);
        }
        if (!deps.isVisible(rect)) throw new Error("Target is not visible in the viewport");
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
        if (!deps.verify(check.step, found.target)) throw new Error("Real UI transition did not verify");
        if (run.epoch !== epoch) throw new Error(CANCELLED_ERROR);
        acting = false;
        return reply(data.requestId, true);
      } catch (error) {
        acting = false;
        glide = null;
        if (run.phase !== PHASE.PAUSED && run.phase !== PHASE.CANCELLED && !/cancelled or paused/i.test(String(error?.message || error))) {
          run = reduce(run, { type: "lesson_error", error: String(error?.message || error), runId: run.runId });
        }
        return reply(data.requestId, false, String(error?.message || error));
      }
    }
    function handleAppMessage(data) {
      switch (data.type) {
        case "app_ready":
          return detect({ documentId: data.documentId, origin: data.origin || run.origin });
        case "lesson_started":
          run = reduce(run, { type: "lesson_started", runId: data.runId, planId: data.planId, documentId: data.documentId || run.documentId });
          emit();
          return snapshot();
        case "step_started":
          run = reduce(run, { type: "step_started", runId: data.runId, stepId: data.stepId });
          emit();
          return snapshot();
        case "step_verified":
          run = reduce(run, { type: "step_verified", runId: data.runId, stepId: data.stepId });
          emit();
          return snapshot();
        case "lesson_paused":
          return requestPause({ notifyPage: false });
        case "lesson_resumed":
          return requestResume({ notifyPage: false });
        case "lesson_stopped":
          return requestStop({ notifyPage: false });
        case "lesson_completed":
          if (run.phase !== PHASE.CANCELLED) {
            run = reduce(run, { type: "lesson_completed", runId: data.runId });
            acting = false;
            glide = null;
            emit();
          }
          return snapshot();
        case "lesson_error":
          run = reduce(run, { type: "lesson_error", runId: data.runId, error: data.error });
          acting = false;
          glide = null;
          emit();
          return snapshot();
        case "quiz_opened":
          run = reduce(run, { type: "await_student" });
          emit();
          return snapshot();
        case "action_request":
          return runAction(data);
        case "source_selected":
        case "concept_focused":
        case "quiz_answered":
          return snapshot();
        default:
          return snapshot();
      }
    }
    function handleControl(message) {
      if (!message || message.type !== "control" || !CONTROL_COMMANDS.includes(message.command)) {
        return { ok: false, error: "Unsupported command", ...snapshot() };
      }
      const prompt = typeof message.prompt === "string" ? message.prompt.slice(0, 1e3) : "";
      if (message.command === "stop") requestStop({ notifyPage: true });
      else if (message.command === "pause") requestPause({ notifyPage: true });
      else if (message.command === "resume") requestResume({ notifyPage: true });
      else {
        if (message.command === "teach") run = reduce(run, { type: "teach_requested" });
        if (message.command === "ask") listening = false;
        post({ source: EXT_SOURCE, type: "command", command: message.command, prompt });
        emit();
      }
      const state = snapshot();
      return { ok: true, status: state.visual, studyTab: true, ...state };
    }
    async function cursorMoveTo(message) {
      const parsed = parseCursorMoveTo(message);
      if (!parsed.ok) {
        return { ok: false, type: "CURSOR_MOVE_TO_ACK", error: parsed.error, runId: message?.runId ?? null };
      }
      if (!run.runId || parsed.move.runId !== String(run.runId)) {
        return { ok: false, type: "CURSOR_MOVE_TO_ACK", error: "runId does not match the active run", runId: parsed.move.runId };
      }
      if (run.phase === PHASE.CANCELLED || run.phase === PHASE.PAUSED || run.phase === PHASE.ERROR) {
        return { ok: false, type: "CURSOR_MOVE_TO_ACK", error: "Run is not accepting movement", runId: run.runId };
      }
      let rect = parsed.move.viewportRect;
      if (!rect) {
        const step = parsed.move.anchorId ? { kind: "highlight_pdf", targetId: parsed.move.anchorId } : { kind: "focus_graph", targetId: parsed.move.conceptId };
        const found = deps.resolveTarget(step);
        if (!found?.ok || !found.target) {
          return { ok: false, type: "CURSOR_MOVE_TO_ACK", error: found?.error || "Target is not available", runId: run.runId };
        }
        rect = deps.measure(found.target);
      }
      const epoch = run.epoch;
      const dest = aimPoint(rect);
      const arrived = await glideTo(dest, epoch);
      if (!arrived) {
        return { ok: false, type: "CURSOR_MOVE_TO_ACK", error: CANCELLED_ERROR, runId: run.runId };
      }
      const errorPx = distance(cursor, dest);
      const sequence = run.sequence + 1;
      run = { ...run, sequence };
      acting = false;
      emit();
      return {
        ok: errorPx <= 2,
        type: "CURSOR_MOVE_TO_ACK",
        runId: run.runId,
        sequence,
        x: cursor.x,
        y: cursor.y,
        errorPx
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
      }
    };
  }

  // extension/content.js
  if (!globalThis.__smartpathLiveInstalled && shouldAttach()) {
    globalThis.__smartpathLiveInstalled = true;
    attach();
  }
  function shouldAttach() {
    if (!isStudyOrigin(location.origin)) return false;
    if (isStudyUrl(location.href)) return true;
    return Boolean(document.getElementById("pdf-viewport") && document.getElementById("graph-nodes") && document.getElementById("top-quiz"));
  }
  function attach() {
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = reducedQuery.matches;
    reducedQuery.addEventListener("change", (event) => {
      reduced = event.matches;
    });
    const host = document.createElement("div");
    host.setAttribute("data-smartpath-extension-root", "true");
    host.setAttribute("aria-hidden", "true");
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; overflow: visible; }
    .cursor, .trail { position: fixed; top: 0; left: 0; width: 0; height: 0; pointer-events: none; }
    .cursor { z-index: 2; filter: drop-shadow(0 4px 8px rgba(15, 118, 110, .35)); }
    .pointer { position: absolute; left: -26px; top: -14px; display: block; }
    .tag {
      position: absolute; left: -12px; top: -8px; transform: translate(-100%, -100%);
      background: #0f2c3a; color: #d8fff6; font: 700 10px ui-sans-serif, system-ui, sans-serif;
      padding: 4px 7px; border-radius: 7px; border: 1px solid rgba(67, 210, 190, .7);
      white-space: nowrap; box-shadow: 0 7px 15px rgba(15, 23, 42, .2);
    }
    .trail { width: 7px; height: 7px; margin: -3px 0 0 -3px; border-radius: 999px; background: rgba(20, 184, 166, .45); z-index: 1; }
    .acting .tag { background: #0f766e; }
    .paused .tag { background: #7c2d12; }
    .error .tag { background: #9f1239; }
    .done .tag { background: #155e75; }
    @media (prefers-reduced-motion: reduce) {
      .trail { display: none; }
    }
  </style>
  <div class="layer">
    <i class="trail" id="t0"></i><i class="trail" id="t1"></i><i class="trail" id="t2"></i>
    <div class="cursor following" id="cursor">
      <svg class="pointer" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
        <polygon points="26,14 5,4 10,14 5,24" fill="#14b8a6" stroke="#ccfbf1" stroke-width="1"></polygon>
      </svg>
      <span class="tag" id="tag">SmartPath</span>
    </div>
  </div>`;
    document.documentElement.append(host);
    const cursorEl = shadow.getElementById("cursor");
    const tag = shadow.getElementById("tag");
    const trails = [shadow.getElementById("t0"), shadow.getElementById("t1"), shadow.getElementById("t2")];
    const trail = [];
    let ignoreScrollUntil = 0;
    let ownTabId = null;
    let reportTimer = 0;
    let latestState = null;
    const session = createSession({
      now: () => performance.now(),
      sleep: (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
      reducedMotion: () => reduced,
      cancelSpeech(reason) {
        try {
          speechSynthesis.cancel();
        } catch {
        }
        document.dispatchEvent(new CustomEvent("smartpath-cancel-speech", { detail: { reason: reason || "stop" } }));
      },
      postToPage(message) {
        window.postMessage(message, location.origin);
      },
      resolveTarget(step) {
        let selector;
        try {
          selector = selectorFor(step);
        } catch (error) {
          return { ok: false, error: error.message };
        }
        const matching = document.querySelectorAll(selector);
        if (matching.length !== 1) return { ok: false, error: `Expected exactly one target; found ${matching.length}` };
        return { ok: true, target: matching[0] };
      },
      measure(target) {
        const rect = target.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
      },
      isVisible(rect) {
        return Boolean(rect) && rect.width >= 2 && rect.height >= 2 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      },
      async reveal(target, stillActive) {
        if (!stillActive()) return false;
        const scroller = target.closest("#pdf-viewport, #graph-canvas") || document.getElementById("pdf-viewport");
        const previous = scroller?.style.scrollBehavior;
        if (scroller) scroller.style.scrollBehavior = "auto";
        ignoreScrollUntil = performance.now() + 400;
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        if (scroller) {
          const rect = target.getBoundingClientRect();
          const box = scroller.getBoundingClientRect();
          if (rect.top < box.top || rect.bottom > box.bottom) {
            scroller.scrollTop += rect.top - (box.top + box.height / 2) + rect.height / 2;
          }
        }
        await new Promise((resolve) => {
          requestAnimationFrame(resolve);
        });
        await new Promise((resolve) => {
          requestAnimationFrame(resolve);
        });
        if (scroller) scroller.style.scrollBehavior = previous || "";
        return stillActive();
      },
      click(target) {
        target.click();
      },
      verify(step, target) {
        if (step.kind === "ask_question") return document.getElementById("quiz-backdrop")?.hidden === false;
        return target.getAttribute("aria-pressed") === "true" && target.dataset.active === "true";
      },
      paint(frame2) {
        cursorEl.style.transform = `translate3d(${frame2.cursor.x}px, ${frame2.cursor.y}px, 0)`;
        cursorEl.className = `cursor ${frame2.visual}`;
        tag.textContent = frame2.label;
        host.dataset.cursorState = frame2.visual;
        host.dataset.cursorX = frame2.cursor.x.toFixed(1);
        host.dataset.cursorY = frame2.cursor.y.toFixed(1);
        host.dataset.runPhase = frame2.phase;
        host.dataset.runId = frame2.runId || "";
        host.dataset.documentId = frame2.documentId || "";
        host.dataset.sequence = String(frame2.sequence);
        if (reduced) return;
        trail.push({ x: frame2.cursor.x, y: frame2.cursor.y });
        if (trail.length > 6) trail.shift();
        trails.forEach((dot, index) => {
          const sample = trail[trail.length - 2 - index];
          if (!sample) {
            dot.style.opacity = "0";
            return;
          }
          dot.style.opacity = String(Math.max(0.12, 0.4 - index * 0.12));
          dot.style.transform = `translate3d(${sample.x}px, ${sample.y}px, 0)`;
        });
      },
      onState(state) {
        latestState = state;
        if (reportTimer) return;
        reportTimer = setTimeout(() => {
          reportTimer = 0;
          const current = latestState;
          if (!current) return;
          chrome.runtime.sendMessage({
            type: "smartpath_status",
            href: location.href,
            state: {
              phase: current.phase,
              visual: current.visual,
              documentId: current.documentId,
              origin: location.origin,
              runId: current.runId,
              sequence: current.sequence,
              studyTab: true,
              href: location.href
            }
          }).catch(() => {
          });
        }, 40);
      }
    });
    function frame(now) {
      session.tick(now);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    function announceReady() {
      window.postMessage({ source: EXT_SOURCE, type: "extension_ready" }, location.origin);
    }
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = parseAppMessage(event.data, event.origin, location.origin);
      if (!data) return;
      if (data.type === "app_ready") {
        session.handleAppMessage({ ...data, origin: location.origin });
        announceReady();
        return;
      }
      session.handleAppMessage(data);
    });
    document.addEventListener("mousemove", (event) => {
      session.notePointer(event.clientX, event.clientY, {
        trusted: event.isTrusted,
        movement: Math.hypot(event.movementX || 0, event.movementY || 0)
      });
    }, { passive: true });
    let userScrollIntentAt = 0;
    document.addEventListener("pointerdown", (event) => {
      if (event.isTrusted) userScrollIntentAt = performance.now();
    }, { capture: true, passive: true });
    document.addEventListener("wheel", (event) => {
      if (!event.isTrusted) return;
      userScrollIntentAt = performance.now();
      session.userInterrupt();
    }, { passive: true, capture: true });
    document.addEventListener("scroll", (event) => {
      if (performance.now() < ignoreScrollUntil) return;
      if (event.isTrusted === false) return;
      if (performance.now() - userScrollIntentAt > 500) return;
      session.userInterrupt();
    }, { passive: true, capture: true });
    document.addEventListener("keydown", (event) => {
      if (!event.isTrusted) return;
      const phase = session.snapshot().phase;
      const editable = event.target && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA" || event.target.isContentEditable);
      if (event.key === "Escape" && !editable && ["teaching", "paused", "planning", "explaining", "awaiting_student"].includes(phase)) {
        session.handleControl({ type: "control", command: "stop" });
        return;
      }
      if (editable) {
        session.userInterrupt();
        return;
      }
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
        userScrollIntentAt = performance.now();
        session.userInterrupt();
      }
    }, true);
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return void 0;
      if (!isStudyOrigin(location.origin)) {
        sendResponse({ ok: false, error: "origin rejected" });
        return void 0;
      }
      if (message?.type === "get_status") {
        sendResponse(session.status());
        return void 0;
      }
      if (message?.type === "control") {
        if (message.tabId && ownTabId && message.tabId !== ownTabId) {
          sendResponse({ ok: false, error: "tab mismatch" });
          return void 0;
        }
        sendResponse(session.handleControl(message));
        return void 0;
      }
      if (message?.type === "CURSOR_MOVE_TO") {
        const safe = { ...message };
        delete safe.viewportRect;
        delete safe.measuredBy;
        session.cursorMoveTo(safe).then(sendResponse);
        return true;
      }
      return void 0;
    });
    window.addEventListener("pagehide", () => {
      session.requestStop({ notifyPage: false });
    });
    chrome.runtime.sendMessage({
      type: "content_hello",
      origin: location.origin,
      href: location.href
    }).then((response) => {
      ownTabId = response?.tabId ?? null;
    }).catch(() => {
    });
    announceReady();
  }
})();
