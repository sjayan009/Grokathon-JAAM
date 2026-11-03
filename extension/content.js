/* SmartPath Live content script. Study-tab only. The second cursor is an overlay;
 * clicks go to the real anchor, graph node, or quiz control. */

import { parseAppMessage, selectorFor, isStudyOrigin, isStudyUrl, EXT_SOURCE } from './lib/bridge.js';
import { createSession } from './lib/session.js';

if (!globalThis.__smartpathLiveInstalled && shouldAttach()) {
  globalThis.__smartpathLiveInstalled = true;
  attach();
}

function shouldAttach() {
  if (!isStudyOrigin(location.origin)) return false;
  if (isStudyUrl(location.href)) return true;
  return Boolean(document.getElementById('pdf-viewport') && document.getElementById('graph-nodes') && document.getElementById('top-quiz'));
}

function attach() {
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;
  reducedQuery.addEventListener('change', (event) => {
    reduced = event.matches;
  });

  const host = document.createElement('div');
  host.setAttribute('data-smartpath-extension-root', 'true');
  host.setAttribute('aria-hidden', 'true');
  const shadow = host.attachShadow({ mode: 'closed' });
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
  const cursorEl = shadow.getElementById('cursor');
  const tag = shadow.getElementById('tag');
  const trails = [shadow.getElementById('t0'), shadow.getElementById('t1'), shadow.getElementById('t2')];
  const trail = [];
  let ignoreScrollUntil = 0;
  let ownTabId = null;
  let reportTimer = 0;
  let latestState = null;
  let cdpBusy = false; // P2: our own CDP mouse events are trusted but are not the student taking over

  const session = createSession({
    now: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    reducedMotion: () => reduced,
    cancelSpeech(reason) {
      try { speechSynthesis.cancel(); } catch { /* synthesis is optional */ }
      document.dispatchEvent(new CustomEvent('smartpath-cancel-speech', { detail: { reason: reason || 'stop' } }));
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
      const scroller = target.closest('#pdf-viewport, #graph-canvas') || document.getElementById('pdf-viewport');
      const previous = scroller?.style.scrollBehavior;
      if (scroller) scroller.style.scrollBehavior = 'auto';
      ignoreScrollUntil = performance.now() + 400;
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      if (scroller) {
        const rect = target.getBoundingClientRect();
        const box = scroller.getBoundingClientRect();
        if (rect.top < box.top || rect.bottom > box.bottom) {
          scroller.scrollTop += rect.top - (box.top + box.height / 2) + rect.height / 2;
        }
      }
      await new Promise((resolve) => { requestAnimationFrame(resolve); });
      await new Promise((resolve) => { requestAnimationFrame(resolve); });
      if (scroller) scroller.style.scrollBehavior = previous || '';
      return stillActive();
    },
    click(target) { target.click(); },
    verify(step, target) {
      if (step.kind === 'ask_question') return document.getElementById('quiz-backdrop')?.hidden === false;
      return target.getAttribute('aria-pressed') === 'true' && target.dataset.active === 'true';
    },
    paint(frame) {
      cursorEl.style.transform = `translate3d(${frame.cursor.x}px, ${frame.cursor.y}px, 0)`;
      cursorEl.className = `cursor ${frame.visual}`;
      tag.textContent = frame.label;
      host.dataset.cursorState = frame.visual;
      host.dataset.cursorX = frame.cursor.x.toFixed(1);
      host.dataset.cursorY = frame.cursor.y.toFixed(1);
      host.dataset.runPhase = frame.phase;
      host.dataset.runId = frame.runId || '';
      host.dataset.documentId = frame.documentId || '';
      host.dataset.sequence = String(frame.sequence);
      if (reduced) return;
      trail.push({ x: frame.cursor.x, y: frame.cursor.y });
      if (trail.length > 6) trail.shift();
      trails.forEach((dot, index) => {
        const sample = trail[trail.length - 2 - index];
        if (!sample) {
          dot.style.opacity = '0';
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
          type: 'smartpath_status',
          href: location.href,
          state: {
            phase: current.phase,
            visual: current.visual,
            documentId: current.documentId,
            origin: location.origin,
            runId: current.runId,
            sequence: current.sequence,
            studyTab: true,
            href: location.href,
          },
        }).catch(() => {});
      }, 40);
    },
  });

  function frame(now) {
    session.tick(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function announceReady() {
    window.postMessage({ source: EXT_SOURCE, type: 'extension_ready' }, location.origin);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = parseAppMessage(event.data, event.origin, location.origin);
    if (!data) return;
    if (data.type === 'app_ready') {
      session.handleAppMessage({ ...data, origin: location.origin });
      announceReady();
      return;
    }
    session.handleAppMessage(data);
  });

  document.addEventListener('mousemove', (event) => {
    session.notePointer(event.clientX, event.clientY, {
      trusted: event.isTrusted && !cdpBusy,
      movement: Math.hypot(event.movementX || 0, event.movementY || 0),
    });
  }, { passive: true });

  let userScrollIntentAt = 0;
  document.addEventListener('pointerdown', (event) => {
    if (event.isTrusted) userScrollIntentAt = performance.now();
  }, { capture: true, passive: true });

  document.addEventListener('wheel', (event) => {
    if (!event.isTrusted) return;
    userScrollIntentAt = performance.now();
    session.userInterrupt();
  }, { passive: true, capture: true });

  // Scroll events also fire for the page's own scrollIntoView. Only a recent
  // pointer or wheel counts as the student taking the viewport back.
  document.addEventListener('scroll', (event) => {
    if (performance.now() < ignoreScrollUntil) return;
    if (event.isTrusted === false) return;
    if (performance.now() - userScrollIntentAt > 500) return;
    session.userInterrupt();
  }, { passive: true, capture: true });

  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    const phase = session.snapshot().phase;
    const editable = event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable);
    if (event.key === 'Escape' && !editable && ['teaching', 'paused', 'planning', 'explaining', 'awaiting_student'].includes(phase)) {
      session.handleControl({ type: 'control', command: 'stop' });
      return;
    }
    if (editable) {
      session.userInterrupt();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) {
      userScrollIntentAt = performance.now();
      session.userInterrupt();
    }
  }, true);

  // ---- P2 F17 agent control: allowlisted mock controls only; each run is user-approved in the side panel.
  // Real CDP click, then real UI-state verification. Stop/pause bump the session epoch and cancel it.
  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const txt = (id) => document.getElementById(id)?.textContent;
  const AGENT = {
    quiz: { sel: '#top-quiz', pre: () => 0, ok: () => document.getElementById('quiz-backdrop')?.hidden === false },
    close_quiz: { sel: '#close-quiz', pre: () => 0, ok: () => document.getElementById('quiz-backdrop')?.hidden === true },
    reset: { sel: '#reset-graph', pre: () => 0, ok: () => txt('focused-concept') === 'Your learning map' },
    zoom_in: { sel: '#zoom-in', pre: () => txt('zoom-label'), ok: (before) => txt('zoom-label') !== before },
    zoom_out: { sel: '#zoom-out', pre: () => txt('zoom-label'), ok: (before) => txt('zoom-label') !== before },
  };
  let agentBusy = false;
  async function agentAct(id) {
    if (!Object.hasOwn(AGENT, id)) throw new Error('Action is not in the allowlist');
    if (agentBusy) throw new Error('Another action is running');
    const a = AGENT[id];
    const epoch = session.snapshot().epoch;
    const cancelled = () => session.snapshot().epoch !== epoch;
    agentBusy = true;
    try {
      const found = document.querySelectorAll(a.sel);
      if (found.length !== 1) throw new Error(`Expected exactly one target; found ${found.length}`);
      found[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      await sleep(400);
      const rect = found[0].getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || rect.top >= innerHeight || rect.bottom <= 0 || rect.left >= innerWidth || rect.right <= 0) {
        throw new Error('Target is not visible in the viewport');
      }
      if (cancelled()) throw new Error('Action cancelled');
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (!(await session.glideToPoint({ x, y })) || cancelled()) throw new Error('Action cancelled');
      const before = a.pre();
      cdpBusy = true;
      let res;
      try { res = await chrome.runtime.sendMessage({ type: 'cdp_click', x, y }); } finally { cdpBusy = false; }
      if (!res?.ok) throw new Error(res?.error || 'CDP click failed');
      await sleep(150);
      if (!a.ok(before)) throw new Error('Real UI transition did not verify (control may be at its limit)');
    } finally { agentBusy = false; }
  }

  // ---- P2 F09 import: payload queued until the page says app_ready (timer covers app_ready firing before this script loaded).
  let queued = null;
  let importing = null;
  let appReady = false;
  const report = (result) => {
    clearTimeout(importing?.timer);
    const name = importing?.name;
    importing = null;
    chrome.runtime.sendMessage({ type: 'import_result', name, ...result }).catch(() => {});
  };
  function flush() {
    if (!queued || !appReady || importing) return;
    const q = queued;
    queued = null;
    importing = { name: q.name, timer: setTimeout(() => report({ ok: false, error: 'The workspace did not respond to the import (timed out)' }), 30000) };
    window.postMessage({ source: EXT_SOURCE, type: 'import_pdf', name: q.name, sourceUrl: q.sourceUrl, bytesBase64: q.bytesBase64 }, location.origin);
  }
  setTimeout(() => { appReady = true; flush(); }, 2000);
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || !event.data || event.data.source !== 'smartpath-mock-app') return;
    const d = event.data;
    if (d.type === 'app_ready') { appReady = true; flush(); }
    else if (d.type === 'import_result' && importing) {
      report({
        ok: Boolean(d.ok),
        error: typeof d.error === 'string' ? d.error.slice(0, 200) : undefined,
        pageCount: Number.isFinite(d.pageCount) ? d.pageCount : undefined,
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return undefined;
    if (!isStudyOrigin(location.origin)) {
      sendResponse({ ok: false, error: 'origin rejected' });
      return undefined;
    }
    if (message?.type === 'get_status') {
      sendResponse(session.status());
      return undefined;
    }
    if (message?.type === 'control') {
      if (message.command === 'stop') queued = null; // P2: drop a not-yet-delivered import
      if (message.tabId && ownTabId && message.tabId !== ownTabId) {
        sendResponse({ ok: false, error: 'tab mismatch' });
        return undefined;
      }
      sendResponse(session.handleControl(message));
      return undefined;
    }
    if (message?.type === 'agent_action') {
      agentAct(String(message.action)).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;
    }
    if (message?.type === 'import_pdf') {
      const b = message.bytesBase64;
      if (typeof b !== 'string' || b.length > 34 * 1024 * 1024) sendResponse({ ok: false, error: 'Invalid or oversized PDF payload' });
      else if (queued || importing) sendResponse({ ok: false, error: 'An import is already running' });
      else {
        queued = { name: String(message.name || 'document.pdf').slice(0, 120), sourceUrl: String(message.sourceUrl || '').slice(0, 2000), bytesBase64: b };
        sendResponse({ ok: true });
        flush();
      }
      return undefined;
    }
    if (message?.type === 'CURSOR_MOVE_TO') {
      const safe = { ...message };
      delete safe.viewportRect;
      delete safe.measuredBy;
      session.cursorMoveTo(safe).then(sendResponse);
      return true;
    }
    return undefined;
  });

  window.addEventListener('pagehide', () => {
    session.requestStop({ notifyPage: false });
  });

  chrome.runtime.sendMessage({
    type: 'content_hello',
    origin: location.origin,
    href: location.href,
  }).then((response) => {
    ownTabId = response?.tabId ?? null;
  }).catch(() => {});

  announceReady();
}
