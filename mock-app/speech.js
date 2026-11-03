/* Page-owned spoken output for SmartPath Live.
   Speech starts here. Lane A Stop must cancel it here too: a content-script
   speechSynthesis.cancel() does not stop utterances this page started. */
(function (root) {
  'use strict';

  const CANCEL_EVENT = 'smartpath-cancel-speech';
  const MAX_CHARS = 600;
  const state = {
    generation: 0,
    enabled: true,
    stopped: false,
    activeGeneration: null
  };

  function synth() {
    const candidate = root.speechSynthesis;
    if (!candidate || typeof candidate.speak !== 'function' || typeof candidate.cancel !== 'function') return null;
    return candidate;
  }

  function post(type, payload) {
    if (typeof root.postMessage !== 'function' || !root.location) return;
    root.postMessage(Object.assign({source: 'smartpath-mock-app', type: type}, payload), root.location.origin);
  }

  function snapshot(reason, spoken) {
    return {
      spoken: spoken,
      reason: reason,
      generation: state.generation,
      stopped: state.stopped,
      speaking: isSpeaking()
    };
  }

  function isSpeaking() {
    return state.activeGeneration !== null && state.activeGeneration === state.generation && !state.stopped;
  }

  function isStopped() {
    return state.stopped;
  }

  function isEnabled() {
    return state.enabled;
  }

  /* cancel(reason) is synchronous.
     'stop' (also the default) latches speech: later speak() calls return
     {spoken:false, reason:'stopped'} until allow() on the next user action.
     'pause', 'muted', and 'error' stop the current utterance and do not latch.
     Captions are left untouched. */
  function cancel(reason) {
    const why = reason || 'stop';
    state.generation += 1;
    state.activeGeneration = null;
    if (why === 'stop') state.stopped = true;
    const engine = synth();
    if (engine) {
      try { engine.cancel(); } catch (err) { /* host object may throw if already idle */ }
    }
    post('speech_stopped', {reason: why, generation: state.generation});
    return {ok: true, generation: state.generation, stopped: state.stopped, speaking: false, reason: why};
  }

  /* Clear the stop latch. Call at the start of a new user-initiated speak. */
  function allow(source) {
    state.stopped = false;
    return {stopped: false, source: source || 'user', generation: state.generation};
  }

  function setEnabled(next) {
    state.enabled = Boolean(next);
    if (!state.enabled) cancel('muted');
    return state.enabled;
  }

  function speak(text, options) {
    const spokenText = String(text == null ? '' : text).slice(0, MAX_CHARS);
    if (state.stopped) return snapshot('stopped', false);
    if (!state.enabled) return snapshot('muted', false);
    if (!spokenText.trim()) return snapshot('empty', false);
    const engine = synth();
    const Utterance = root.SpeechSynthesisUtterance;
    if (!engine || typeof Utterance !== 'function') return snapshot('unavailable', false);
    const generation = state.generation;
    try { engine.cancel(); } catch (err) { /* replace any previous utterance */ }
    const utterance = new Utterance(spokenText);
    utterance.lang = 'en-US';
    utterance.rate = options && options.rate ? options.rate : 1.04;
    const stale = function () { return generation !== state.generation; };
    utterance.onstart = function () {
      if (stale()) return;
      state.activeGeneration = generation;
      post('speech_started', {generation: generation});
    };
    utterance.onend = function () {
      if (stale()) return;
      if (state.activeGeneration === generation) state.activeGeneration = null;
    };
    utterance.onerror = function () {
      if (stale()) return;
      if (state.activeGeneration === generation) state.activeGeneration = null;
    };
    state.activeGeneration = generation;
    engine.speak(utterance);
    if (stale()) {
      state.activeGeneration = null;
      return snapshot('stopped', false);
    }
    return snapshot('speaking', true);
  }

  function onCancelEvent(event) {
    const detail = event && event.detail;
    const reason = detail && detail.reason === 'pause' ? 'pause' : 'stop';
    cancel(reason);
  }

  function onWindowMessage(event) {
    if (!event || event.source !== root) return;
    if (root.location && event.origin !== root.location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'smartpath-live-extension' || data.type !== 'command') return;
    if (data.command === 'stop') cancel('stop');
    else if (data.command === 'pause') cancel('pause');
  }

  if (root.document && typeof root.document.addEventListener === 'function') {
    root.document.addEventListener(CANCEL_EVENT, onCancelEvent, true);
  }
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('message', onWindowMessage);
  }

  const api = {
    CANCEL_EVENT: CANCEL_EVENT,
    cancel: cancel,
    allow: allow,
    speak: speak,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    isSpeaking: isSpeaking,
    isStopped: isStopped,
    get generation() { return state.generation; }
  };
  root.SmartPathSpeech = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
