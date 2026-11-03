import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PausableClock } from './clock.ts';
import { BrowserSpeaker } from './speech.ts';

type Mode = 'normal' | 'blocked' | 'no-onend' | 'not-allowed';

class FakeSynth {
  spoken: string[] = [];
  cancels = 0;
  mode: Mode = 'normal';
  voices = [
    { name: 'Eddy', lang: 'en-US', localService: false },
    { name: 'Samantha', lang: 'en-US', localService: true },
  ];
  current: FakeUtterance | null = null;

  getVoices() {
    return this.voices;
  }
  addEventListener() {}
  speak(utterance: FakeUtterance) {
    this.spoken.push(utterance.text);
    this.current = utterance;
    if (this.mode === 'blocked') return;
    if (this.mode === 'not-allowed') {
      setTimeout(() => utterance.onerror?.({ error: 'not-allowed' }), 0);
      return;
    }
    setTimeout(() => utterance.onstart?.(), 0);
    if (this.mode === 'normal') setTimeout(() => this.current === utterance && utterance.onend?.(), 200);
  }
  cancel() {
    this.cancels += 1;
    const utterance = this.current;
    this.current = null;
    utterance?.onerror?.({ error: 'interrupted' });
  }
}

class FakeUtterance {
  text: string;
  voice: unknown = null;
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

describe('BrowserSpeaker', () => {
  let synth: FakeSynth;
  let captions: string[];
  let speaker: BrowserSpeaker;
  let clock: PausableClock;
  let abort: AbortController;

  beforeEach(() => {
    vi.useFakeTimers();
    synth = new FakeSynth();
    captions = [];
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    clock = new PausableClock(1);
    speaker = new BrowserSpeaker(clock, (caption) => captions.push(caption));
    abort = new AbortController();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('speaks sentence by sentence with a caption for each', async () => {
    const done = speaker.speak('First line. Second line.', abort.signal);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(synth.spoken).toEqual(['First line.', 'Second line.']);
    expect(captions).toEqual(['First line.', 'Second line.']);
  });

  it('prefers a local English voice', async () => {
    const done = speaker.speak('Hi.', abort.signal);
    expect(synth.current?.voice).toMatchObject({ name: 'Samantha' });
    await vi.advanceTimersByTimeAsync(1000);
    await done;
  });

  it('re-speaks the current sentence after pause, without repeating earlier ones', async () => {
    let finished = false;
    const done = speaker.speak('First line. Second line.', abort.signal).then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(300);
    expect(synth.spoken).toEqual(['First line.', 'Second line.']);

    speaker.pause();
    clock.paused = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(finished).toBe(false);
    expect(synth.spoken).toHaveLength(2);

    clock.paused = false;
    speaker.resume();
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(synth.spoken).toEqual(['First line.', 'Second line.', 'Second line.']);
  });

  it('skip ends the whole narration immediately', async () => {
    const done = speaker.speak('First line. Second line.', abort.signal);
    await vi.advanceTimersByTimeAsync(50);
    speaker.skip();
    await done;
    expect(synth.spoken).toEqual(['First line.']);
  });

  it('abort rejects and leaves nothing speaking', async () => {
    const done = speaker.speak('First line. Second line.', abort.signal);
    done.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(50);
    abort.abort();
    speaker.cancel();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(synth.cancels).toBeGreaterThan(0);
    expect(captions.at(-1)).toBe('');
  });

  it('falls back to captions when speech never starts', async () => {
    synth.mode = 'blocked';
    const done = speaker.speak('Blocked line here.', abort.signal);
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(captions).toEqual(['Blocked line here.']);
  });

  it('falls back to captions when speech is not allowed', async () => {
    synth.mode = 'not-allowed';
    const done = speaker.speak('Denied line here.', abort.signal);
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(captions).toEqual(['Denied line here.']);
  });

  it('does not hang when Chrome never fires onend', async () => {
    synth.mode = 'no-onend';
    const done = speaker.speak('Stuck line here.', abort.signal);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(done).resolves.toBeUndefined();
  });
});
