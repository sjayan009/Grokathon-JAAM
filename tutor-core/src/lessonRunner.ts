import type { SendOptions, Transport } from './bridge.ts';
import { isAbort, type PausableClock } from './clock.ts';
import type { Beat, LessonFixture, LessonStep } from './lessonTypes.ts';
import type { AckPayload, Rect, StudyAction, TargetId } from './protocol.ts';

export interface CursorPort {
  setStatus(status: 'follow' | 'working' | 'paused'): void;
  moveTo(x: number, y: number, signal: AbortSignal): Promise<void>;
  sweep(rects: Rect[], signal: AbortSignal): Promise<void>;
  click(signal: AbortSignal): Promise<void>;
  release(): void;
  setPaused(paused: boolean): void;
}

export interface SpeakerPort {
  speak(text: string, signal: AbortSignal): Promise<void>;
  pause(): void;
  resume(): void;
  skip(): void;
  cancel(): void;
}

export type RunnerStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'complete';
export type PauseReason = 'user' | 'video' | 'hidden' | 'question';

export interface FeedEntry {
  id: number;
  text: string;
  state: 'active' | 'done' | 'error' | 'cancelled';
}

export interface RunnerSnapshot {
  status: RunnerStatus;
  stepIndex: number;
  pauseReasons: PauseReason[];
  feed: FeedEntry[];
}

const STEP_GAP_MS = 350;

function describe(beat: Beat, lesson: LessonFixture): string | null {
  if (beat.kind === 'cursor') return null;
  const action = beat.kind === 'click' || beat.kind === 'action' ? beat.action : null;
  if (beat.kind === 'wait-quiz') return 'Waiting for your answer';
  if (!action) return null;
  switch (action.type) {
    case 'NAVIGATE_PDF':
      return `Going to page ${action.page}`;
    case 'HIGHLIGHT_QUOTE': {
      const quote = lesson.highlights.find((h) => h.id === action.id)?.quote ?? action.id;
      return `Highlighting “${quote.length > 44 ? `${quote.slice(0, 44)}…` : quote}”`;
    }
    case 'OPEN_WHITEBOARD':
      return 'Opening the whiteboard';
    case 'DRAW_WHITEBOARD_STEP':
      return ['Drawing the axes', 'Drawing the loss curve', 'Writing the equations', 'Animating the updates'][action.step];
    case 'SHOW_ANNOTATION':
      return `Adding a note on page ${action.page}`;
    case 'OPEN_VIDEO':
      return `Opening “${lesson.videoTitle}”`;
    case 'SHOW_QUIZ':
      return 'Showing the check question';
    default:
      return null;
  }
}

/** Drives a scripted lesson. Every visual beat waits for its acknowledgement. */
export class LessonRunner {
  private lesson: LessonFixture;
  private transport: Transport;
  private cursor: CursorPort;
  private speaker: SpeakerPort;
  private clock: PausableClock;
  private onNarration: ((text: string) => void) | undefined;

  private status: RunnerStatus = 'idle';
  private stepIndex = -1;
  private pauseReasons = new Set<PauseReason>();
  private feed: FeedEntry[] = [];
  private feedId = 0;
  private abort: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private resumed: PromiseWithResolvers<void> | null = null;
  private quizAnswer: PromiseWithResolvers<string> | null = null;
  private feedbackText = '';
  private listeners = new Set<() => void>();
  private snapshot: RunnerSnapshot;

  /** Most recent thing the cursor was parked on, so it can track scrolling. */
  anchor: { target: TargetId; quoteId?: string } | null = null;

  constructor(deps: {
    lesson: LessonFixture;
    transport: Transport;
    cursor: CursorPort;
    speaker: SpeakerPort;
    clock: PausableClock;
    onNarration?: (text: string) => void;
  }) {
    this.onNarration = deps.onNarration;
    this.lesson = deps.lesson;
    this.transport = deps.transport;
    this.cursor = deps.cursor;
    this.speaker = deps.speaker;
    this.clock = deps.clock;
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  get isActive() {
    return this.status === 'running' || this.status === 'paused';
  }

  /** Starts from step 0, stopping any lesson already in progress. */
  async start() {
    if (this.isActive) await this.stop();
    await this.loop;

    const abort = new AbortController();
    this.abort = abort;
    this.pauseReasons.clear();
    this.clock.paused = false;
    this.feed = [];
    this.stepIndex = 0;
    this.status = 'running';
    this.cursor.setStatus('working');
    this.publish();

    this.loop = this.run(abort.signal).catch((error: unknown) => {
      if (!isAbort(error)) this.fail(error);
    });
    await this.loop;
  }

  async stop() {
    if (!this.isActive) return;
    this.status = 'stopped';
    this.abort?.abort();
    this.speaker.cancel();
    this.pauseReasons.clear();
    this.clock.paused = false;
    this.cursor.setPaused(false);
    this.resumed?.resolve();
    this.resumed = null;
    this.quizAnswer = null;
    this.anchor = null;
    for (const entry of this.feed) if (entry.state === 'active') entry.state = 'cancelled';
    this.cursor.setStatus('follow');
    this.cursor.release();
    this.publish();
    await this.quietly({ type: 'SET_PLAYBACK', paused: false });
    await this.quietly({ type: 'CANCEL_ALL' });
  }

  pause(reason: PauseReason) {
    if (!this.isActive) return;
    this.pauseReasons.add(reason);
    if (this.status === 'paused') {
      this.publish();
      return;
    }
    this.status = 'paused';
    this.clock.paused = true;
    this.resumed = Promise.withResolvers<void>();
    this.speaker.pause();
    this.cursor.setPaused(true);
    this.cursor.setStatus('paused');
    void this.quietly({ type: 'SET_PLAYBACK', paused: true });
    this.publish();
  }

  /** Clears one reason, or every reason when the user presses Resume. */
  resume(reason?: PauseReason) {
    if (this.status !== 'paused') return;
    if (reason) this.pauseReasons.delete(reason);
    else this.pauseReasons.clear();
    if (this.pauseReasons.size > 0) {
      this.publish();
      return;
    }
    this.status = 'running';
    this.clock.paused = false;
    this.speaker.resume();
    this.cursor.setPaused(false);
    this.cursor.setStatus('working');
    void this.quietly({ type: 'SET_PLAYBACK', paused: false });
    this.resumed?.resolve();
    this.resumed = null;
    this.publish();
  }

  skipNarration() {
    if (this.isActive) this.speaker.skip();
  }

  answerQuiz(choiceId: string) {
    this.quizAnswer?.resolve(choiceId);
  }

  private async run(signal: AbortSignal) {
    await this.perform({ type: 'RESET_WORKSPACE' }, signal);
    const steps = this.lesson.lessonSteps;
    for (let i = 0; i < steps.length; i += 1) {
      this.stepIndex = i;
      this.publish();
      await this.runStep(steps[i], signal);
      await this.clock.sleep(STEP_GAP_MS, signal);
    }
    await this.perform({ type: 'SET_LESSON_MODE', active: true, complete: true }, signal);
    this.status = 'complete';
    this.anchor = null;
    this.cursor.setStatus('follow');
    this.cursor.release();
    this.publish();
  }

  private async runStep(step: LessonStep, signal: AbortSignal) {
    // Chained, because the speaker plays one line at a time.
    let narration: Promise<void> = Promise.resolve();
    const narrate = (text: string) => {
      narration = narration.then(() => {
        this.onNarration?.(text);
        return this.speaker.speak(text, signal);
      });
      narration.catch(() => undefined);
    };

    if (!step.beats.some((beat) => beat.kind === 'narrate')) narrate(this.lesson.narration[step.id]);

    for (const beat of step.beats) {
      await this.whileRunning(signal);
      if (beat.kind === 'narrate') {
        narrate(beat.text === 'quiz-feedback' ? this.feedbackText : this.lesson.narration[step.id]);
        continue;
      }
      await this.runBeat(beat, signal);
    }

    await narration;
  }

  private async runBeat(beat: Exclude<Beat, { kind: 'narrate' }>, signal: AbortSignal) {
    const label = describe(beat, this.lesson);
    const entry = label ? this.addFeed(label) : null;
    try {
      const fallback = await this.executeBeat(beat, signal);
      if (entry) {
        entry.state = fallback ? 'error' : 'done';
        if (fallback) entry.text = fallback;
        this.publish();
      }
    } catch (error) {
      if (isAbort(error)) throw error;
      // A failed visual must not end the lesson, but it must not look done.
      const message = error instanceof Error ? error.message : String(error);
      if (entry) {
        entry.state = 'error';
        entry.text = `${entry.text}: ${message}`;
        this.publish();
      } else {
        this.addFeed(`Skipped a cursor move: ${message}`).state = 'error';
        this.publish();
      }
    }
  }

  /** Returns a replacement feed message when a weaker result was used. */
  private async executeBeat(beat: Exclude<Beat, { kind: 'narrate' }>, signal: AbortSignal): Promise<string | void> {
    switch (beat.kind) {
      case 'cursor': {
        const { bounds } = await this.perform({ type: 'GET_BOUNDS', targetId: beat.target }, signal);
        if (bounds) await this.glideTo(bounds, signal);
        this.anchor = { target: beat.target };
        return;
      }
      case 'click': {
        const { bounds } = await this.perform({ type: 'GET_BOUNDS', targetId: beat.target }, signal);
        if (bounds) await this.glideTo(bounds, signal);
        await this.cursor.click(signal);
        await this.perform(beat.action, signal);
        return;
      }
      case 'action': {
        const ack = await this.perform(beat.action, signal, { timeoutMs: beat.timeoutMs });
        if (beat.follow) await this.follow(beat.action, ack, signal);
        if (ack.fallback === 'callout') {
          return 'Could not find the exact passage, so I added a note on the page';
        }
        return;
      }
      case 'wait-quiz': {
        this.quizAnswer = Promise.withResolvers<string>();
        const pending = this.quizAnswer;
        const choiceId = await new Promise<string>((resolve, reject) => {
          pending.promise.then(resolve, reject);
          signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
        });
        this.quizAnswer = null;
        this.speaker.skip();
        const choice = this.lesson.quiz.choices.find((item) => item.id === choiceId);
        this.feedbackText = choice?.explanation ?? '';
        return;
      }
    }
  }

  private async follow(action: StudyAction, ack: AckPayload, signal: AbortSignal) {
    if (ack.rects?.length) {
      const [first] = ack.rects;
      await this.cursor.moveTo(first.x, first.y + first.height, signal);
      await this.cursor.sweep(ack.rects, signal);
    } else if (ack.bounds) {
      await this.glideTo(ack.bounds, signal);
    }
    if (action.type === 'HIGHLIGHT_QUOTE') this.anchor = { target: 'pdf-viewer', quoteId: action.id };
    else if (action.type === 'NAVIGATE_PDF') this.anchor = { target: `pdf-page-${action.page}` };
    else if (action.type === 'SHOW_ANNOTATION') this.anchor = { target: 'annotation' };
  }

  private glideTo(bounds: Rect, signal: AbortSignal) {
    const tall = bounds.height > 240;
    const y = bounds.y + (tall ? Math.min(bounds.height * 0.3, 160) : bounds.height / 2);
    return this.cursor.moveTo(bounds.x + bounds.width / 2, y, signal);
  }

  private async perform(action: StudyAction, signal: AbortSignal, options: SendOptions = {}) {
    await this.whileRunning(signal);
    return this.transport.send(action, { ...options, signal });
  }

  private async whileRunning(signal: AbortSignal) {
    while (this.status === 'paused') await this.resumed?.promise;
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  }

  /** For control messages that must not be blocked by the pause they apply. */
  private async quietly(action: StudyAction) {
    try {
      await this.transport.send(action);
    } catch {
      // The workspace may be gone, e.g. during page unload.
    }
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.addFeed(`The lesson stopped: ${message}`).state = 'error';
    this.status = 'stopped';
    this.cursor.setStatus('follow');
    this.cursor.release();
    this.publish();
  }

  private addFeed(text: string): FeedEntry {
    this.feedId += 1;
    const entry: FeedEntry = { id: this.feedId, text, state: 'active' };
    this.feed.push(entry);
    this.publish();
    return entry;
  }

  private buildSnapshot(): RunnerSnapshot {
    return {
      status: this.status,
      stepIndex: this.stepIndex,
      pauseReasons: [...this.pauseReasons],
      feed: this.feed.map((entry) => ({ ...entry })),
    };
  }

  private publish() {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
