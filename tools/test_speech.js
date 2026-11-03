#!/usr/bin/env node
'use strict';
/* Cancel-hook tests. No browser and no network. */
const assert = require('assert');
const path = require('path');

class SpeechSynthesisUtterance {
  constructor(text) {
    this.text = text;
    this.lang = '';
    this.rate = 1;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
  }
}

const spoken = [];
const listeners = {};
global.document = {
  addEventListener(name, fn) { listeners[name] = fn; }
};
const fakeSynth = {
  cancel() {
    spoken.push({type: 'cancel'});
    const current = this.current;
    this.current = null;
    if (current && typeof current.onerror === 'function') current.onerror({error: 'interrupted'});
  },
  speak(utterance) {
    this.current = utterance;
    spoken.push({type: 'speak', text: utterance.text});
    if (typeof utterance.onstart === 'function') utterance.onstart();
  },
  current: null
};

global.SpeechSynthesisUtterance = SpeechSynthesisUtterance;
global.speechSynthesis = fakeSynth;
delete require.cache[require.resolve(path.join(__dirname, '..', 'mock-app', 'speech.js'))];
const speech = require(path.join(__dirname, '..', 'mock-app', 'speech.js'));

speech.allow('test');
const started = speech.speak('Page 3. LDR uses the address in R2.');
assert.strictEqual(started.spoken, true, 'speak should start when speech is allowed');
assert.strictEqual(spoken.filter(entry => entry.type === 'speak').length, 1);
const generationAtSpeak = speech.generation;
const utterance = fakeSynth.current;
const cancelled = speech.cancel('stop');
assert.strictEqual(cancelled.stopped, true);
assert.ok(cancelled.generation > generationAtSpeak);
assert.strictEqual(speech.isSpeaking(), false);
assert.strictEqual(speech.isStopped(), true);
if (utterance && typeof utterance.onend === 'function') utterance.onend();
assert.strictEqual(speech.isSpeaking(), false, 'a late onend must not mark speech active');

const blocked = speech.speak('This must not play after Stop.');
assert.strictEqual(blocked.spoken, false);
assert.strictEqual(blocked.reason, 'stopped');
assert.strictEqual(spoken.filter(entry => entry.type === 'speak').length, 1, 'latched Stop must not call speak');

speech.allow('user-again');
const again = speech.speak('A new question may speak.');
assert.strictEqual(again.spoken, true);
assert.strictEqual(speech.isStopped(), false);

const beforePause = speech.generation;
speech.cancel('pause');
assert.strictEqual(speech.isStopped(), false, 'pause must not latch later speech');
assert.ok(speech.generation > beforePause);
const afterPause = speech.speak('Resume may speak the next step.');
assert.strictEqual(afterPause.spoken, true);

speech.setEnabled(false);
const muted = speech.speak('Muted narration still keeps captions elsewhere.');
assert.strictEqual(muted.spoken, false);
assert.strictEqual(muted.reason, 'muted');
speech.setEnabled(true);
assert.strictEqual(speech.isEnabled(), true);

speech.allow('event');
speech.speak('Cancel me from the content script.');
assert.strictEqual(typeof listeners['smartpath-cancel-speech'], 'function');
listeners['smartpath-cancel-speech']({detail: {reason: 'stop'}});
assert.strictEqual(speech.isStopped(), true, 'DOM event smartpath-cancel-speech must latch');
const afterEvent = speech.speak('Must stay quiet after the extension event.');
assert.strictEqual(afterEvent.reason, 'stopped');
speech.allow('after-event');

const missing = {};
global.speechSynthesis = null;
const unavailable = speech.speak('No engine in this environment.');
assert.strictEqual(unavailable.spoken, false);
assert.strictEqual(unavailable.reason, 'unavailable');
global.speechSynthesis = fakeSynth;

console.log('PASS: speech cancel latch, pause, mute, and missing speechSynthesis');
