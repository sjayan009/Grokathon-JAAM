import { abortError, type PausableClock } from './clock.ts';
import type { SpeakerPort } from './lessonRunner.ts';

const START_GRACE_MS = 1200;

const splitSentences = (text: string) => text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g)?.map((s) => s.trim()) ?? [text];

/** How long a person takes to read the line. Captions never depend on speech. */
const readingMs = (sentence: string) => Math.max(1200, sentence.split(/\s+/).length * 340);

type Outcome = 'done' | 'interrupted' | 'skipped';

/**
 * Narration with captions. speechSynthesis.pause() is unreliable in Chrome, so
 * Pause cancels the utterance and Resume re-speaks the current sentence.
 */
export class BrowserSpeaker implements SpeakerPort {
  private clock: PausableClock;
  private onCaption: (text: string) => void;
  private voice: SpeechSynthesisVoice | null = null;
  private paused = false;
  private resumed: PromiseWithResolvers<void> | null = null;
  private settle: ((outcome: Outcome) => void) | null = null;

  constructor(clock: PausableClock, onCaption: (text: string) => void) {
    this.clock = clock;
    this.onCaption = onCaption;
    const synth = this.synth;
    if (synth) {
      this.pickVoice();
      synth.addEventListener('voiceschanged', this.pickVoice);
    }
  }

  private get synth(): SpeechSynthesis | null {
    // Speed-ups exist for automated runs, where audio would only slow things.
    return this.clock.speed === 1 && 'speechSynthesis' in window ? window.speechSynthesis : null;
  }

  private pickVoice = () => {
    const voices = this.synth?.getVoices() ?? [];
    const english = voices.filter((voice) => voice.lang.startsWith('en') && voice.localService);
    this.voice =
      english.find((voice) => /samantha|ava|allison|daniel/i.test(voice.name)) ?? english[0] ?? voices[0] ?? null;
  };

  async speak(text: string, signal: AbortSignal) {
    for (const sentence of splitSentences(text)) {
      this.onCaption(sentence);
      for (;;) {
        if (this.paused) await this.resumed?.promise;
        if (signal.aborted) throw abortError();
        const outcome = await this.playSentence(sentence, signal);
        if (signal.aborted) throw abortError();
        if (outcome === 'skipped') return;
        if (outcome === 'done') break;
      }
    }
  }

  pause() {
    this.paused = true;
    this.resumed = Promise.withResolvers<void>();
    this.synth?.cancel();
    this.settle?.('interrupted');
  }

  resume() {
    this.paused = false;
    this.resumed?.resolve();
    this.resumed = null;
  }

  skip() {
    this.synth?.cancel();
    this.settle?.('skipped');
  }

  cancel() {
    this.synth?.cancel();
    this.settle?.('interrupted');
    this.resume();
    this.onCaption('');
  }

  private playSentence(sentence: string, signal: AbortSignal): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      const timers = new AbortController();
      let finished = false;
      const finish = (outcome: Outcome) => {
        if (finished) return;
        finished = true;
        timers.abort();
        this.settle = null;
        resolve(outcome);
      };
      this.settle = finish;
      signal.addEventListener('abort', () => finish('interrupted'), { once: true });

      const reading = readingMs(sentence);
      const readAlong = (ms: number) => {
        this.clock.sleep(ms, timers.signal).then(() => finish('done'), () => undefined);
      };

      const synth = this.synth;
      if (!synth) {
        readAlong(reading);
        return;
      }

      let started = false;
      const utterance = new SpeechSynthesisUtterance(sentence);
      if (this.voice) utterance.voice = this.voice;
      utterance.rate = 1.03;
      utterance.onstart = () => {
        started = true;
      };
      utterance.onend = () => finish('done');
      utterance.onerror = (event) => {
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        readAlong(reading);
      };
      synth.speak(utterance);

      // Speech can be silently blocked. Captions then carry the narration.
      this.clock.sleep(START_GRACE_MS, timers.signal).then(
        () => {
          if (!started) {
            synth.cancel();
            readAlong(Math.max(0, reading - START_GRACE_MS));
          }
        },
        () => undefined,
      );
      // Chrome occasionally never fires onend, so this bound always applies.
      this.clock.sleep(reading * 2.5 + 2000, timers.signal).then(() => finish('done'), () => undefined);
    });
  }
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function recognitionConstructor(): (new () => RecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechRecognitionSupported = () => recognitionConstructor() !== null;

/** Push-to-talk only: listens for one phrase, started by a user click. */
export function listenOnce(handlers: {
  onText(text: string): void;
  onError(message: string): void;
  onEnd(): void;
}): () => void {
  const Recognition = recognitionConstructor();
  if (!Recognition) {
    handlers.onError('Voice input is not supported in this browser. Type your request instead.');
    handlers.onEnd();
    return () => undefined;
  }
  const recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.onresult = (event) => handlers.onText(event.results[0][0].transcript);
  recognition.onerror = (event) => {
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    handlers.onError(
      event.error === 'not-allowed'
        ? 'Microphone access was denied. Type your request instead.'
        : `Voice input failed (${event.error}). Type your request instead.`,
    );
  };
  recognition.onend = handlers.onEnd;
  recognition.start();
  return () => recognition.stop();
}
