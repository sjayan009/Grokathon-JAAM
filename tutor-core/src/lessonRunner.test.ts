import { describe, expect, it, vi } from 'vitest';
import { lesson } from '../../mock-smartpath/src/demo/gradientDescentLesson.ts';
import type { SendOptions, Transport } from './bridge.ts';
import { PausableClock, abortError } from './clock.ts';
import { LessonRunner, type CursorPort, type SpeakerPort } from './lessonRunner.ts';
import type { AckPayload, StudyAction } from './protocol.ts';

const SPEED = 100;
const nap = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeCursor(): CursorPort {
  return {
    setStatus: vi.fn(),
    moveTo: vi.fn(async () => undefined),
    sweep: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    release: vi.fn(),
    setPaused: vi.fn(),
  };
}

function makeSpeaker(): SpeakerPort & { spoken: string[]; skips: number } {
  return {
    spoken: [],
    skips: 0,
    async speak(text: string, signal: AbortSignal) {
      this.spoken.push(text);
      if (signal.aborted) throw abortError();
    },
    pause: vi.fn(),
    resume: vi.fn(),
    skip() {
      this.skips += 1;
    },
    cancel: vi.fn(),
  };
}

class FakeTransport implements Transport {
  sent: StudyAction[] = [];
  /** Optionally hold an action back to simulate a slow workspace. */
  gate: ((action: StudyAction) => Promise<void> | undefined) | null = null;
  failing: StudyAction['type'] | null = null;
  fallback: StudyAction['type'] | null = null;

  async send(action: StudyAction, options: SendOptions = {}): Promise<AckPayload> {
    this.sent.push(action);
    await this.gate?.(action);
    if (options.signal?.aborted) throw abortError();
    if (this.failing === action.type) throw new Error('boom');
    if (this.fallback === action.type) return { fallback: 'callout', bounds: rect };
    return action.type === 'HIGHLIGHT_QUOTE' ? { bounds: rect, rects: [rect] } : { bounds: rect };
  }

  types() {
    return this.sent.map((action) => action.type);
  }
}

const rect = { x: 10, y: 10, width: 100, height: 20 };

function setup() {
  const transport = new FakeTransport();
  const cursor = makeCursor();
  const speaker = makeSpeaker();
  const clock = new PausableClock(SPEED);
  const runner = new LessonRunner({ lesson, transport, cursor, speaker, clock });
  return { transport, cursor, speaker, clock, runner };
}

/** Answers the quiz as soon as the runner reaches it. */
function autoAnswer(s: ReturnType<typeof setup>, choiceId = 'overshoot') {
  const unsubscribe = s.runner.subscribe(() => {
    const { feed } = s.runner.getSnapshot();
    if (feed.at(-1)?.text === 'Waiting for your answer') {
      unsubscribe();
      setTimeout(() => s.runner.answerQuiz(choiceId), 0);
    }
  });
}

describe('LessonRunner', () => {
  it('runs all steps in order and completes', async () => {
    const s = setup();
    autoAnswer(s);
    await s.runner.start();

    expect(s.runner.getSnapshot().status).toBe('complete');
    const types = s.transport.types();
    expect(types[0]).toBe('RESET_WORKSPACE');
    expect(types.indexOf('OPEN_WHITEBOARD')).toBeLessThan(types.indexOf('DRAW_WHITEBOARD_STEP'));
    expect(types.indexOf('DRAW_WHITEBOARD_STEP')).toBeLessThan(types.indexOf('OPEN_VIDEO'));
    expect(types.indexOf('OPEN_VIDEO')).toBeLessThan(types.indexOf('SHOW_QUIZ'));
    expect(s.transport.sent.at(-1)).toEqual({ type: 'SET_LESSON_MODE', active: true, complete: true });
    for (const step of lesson.lessonSteps) expect(s.speaker.spoken).toContain(lesson.narration[step.id]);
  });

  it('speaks the feedback for the chosen quiz answer', async () => {
    const s = setup();
    autoAnswer(s, 'faster');
    await s.runner.start();
    const choice = lesson.quiz.choices.find((c) => c.id === 'faster');
    expect(s.speaker.spoken.at(-1)).toBe(choice?.explanation);
    expect(s.speaker.skips).toBe(1);
  });

  it('waits for an ack before the next beat', async () => {
    const s = setup();
    const release = Promise.withResolvers<void>();
    s.transport.gate = (action) =>
      action.type === 'NAVIGATE_PDF' ? release.promise : undefined;

    const running = s.runner.start();
    await nap(30);
    expect(s.transport.types()).not.toContain('HIGHLIGHT_QUOTE');

    s.transport.gate = null;
    release.resolve();
    await nap(30);
    expect(s.transport.types()).toContain('HIGHLIGHT_QUOTE');
    await s.runner.stop();
    await running;
  });

  it('stop aborts mid-sequence and cancels the workspace', async () => {
    const s = setup();
    const running = s.runner.start();
    await nap(20);
    await s.runner.stop();
    await running;

    const snapshot = s.runner.getSnapshot();
    expect(snapshot.status).toBe('stopped');
    expect(s.transport.types()).toContain('CANCEL_ALL');
    expect(s.speaker.cancel).toHaveBeenCalled();
    expect(s.cursor.release).toHaveBeenCalled();
    expect(snapshot.feed.some((entry) => entry.state === 'active')).toBe(false);

    const count = s.transport.sent.length;
    await nap(40);
    expect(s.transport.sent.length).toBe(count);
  });

  it('pause freezes progress and resume continues', async () => {
    const s = setup();
    autoAnswer(s);
    const running = s.runner.start();
    await nap(15);

    s.runner.pause('user');
    expect(s.runner.getSnapshot().status).toBe('paused');
    expect(s.transport.sent).toContainEqual({ type: 'SET_PLAYBACK', paused: true });
    expect(s.clock.paused).toBe(true);
    expect(s.speaker.pause).toHaveBeenCalled();

    // Control messages can land just after the pause; then nothing else may.
    await nap(10);
    const frozen = s.transport.sent.length;
    await nap(60);
    expect(s.transport.sent.length).toBe(frozen);

    s.runner.resume();
    await running;
    expect(s.runner.getSnapshot().status).toBe('complete');
  });

  it('keeps pausing until every reason has cleared', async () => {
    const s = setup();
    const running = s.runner.start();
    await nap(10);

    s.runner.pause('video');
    s.runner.pause('hidden');
    s.runner.resume('hidden');
    expect(s.runner.getSnapshot().status).toBe('paused');
    s.runner.resume('video');
    expect(s.runner.getSnapshot().status).toBe('running');

    await s.runner.stop();
    await running;
  });

  it('stop works while paused', async () => {
    const s = setup();
    const running = s.runner.start();
    await nap(10);
    s.runner.pause('user');
    await s.runner.stop();
    await running;
    expect(s.runner.getSnapshot().status).toBe('stopped');
    expect(s.clock.paused).toBe(false);
  });

  it('restarts cleanly from step 0', async () => {
    const s = setup();
    const first = s.runner.start();
    await nap(15);
    autoAnswer(s);
    await s.runner.start();
    await first;

    expect(s.runner.getSnapshot().status).toBe('complete');
    expect(s.transport.types().filter((type) => type === 'RESET_WORKSPACE')).toHaveLength(2);
  });

  it('skips narration without skipping visuals', async () => {
    const s = setup();
    const running = s.runner.start();
    await nap(10);
    s.runner.skipNarration();
    expect(s.speaker.skips).toBe(1);
    expect(s.runner.getSnapshot().status).toBe('running');
    await s.runner.stop();
    await running;
  });

  it('reports a failed visual honestly and keeps teaching', async () => {
    const s = setup();
    s.transport.failing = 'OPEN_VIDEO';
    autoAnswer(s);
    await s.runner.start();

    const snapshot = s.runner.getSnapshot();
    expect(snapshot.status).toBe('complete');
    const failed = snapshot.feed.filter((entry) => entry.state === 'error');
    expect(failed).toHaveLength(1);
    expect(failed[0].text).toContain('boom');
  });

  it('does not claim an exact highlight when it fell back to a callout', async () => {
    const s = setup();
    s.transport.fallback = 'HIGHLIGHT_QUOTE';
    autoAnswer(s);
    await s.runner.start();

    const { feed } = s.runner.getSnapshot();
    expect(feed.some((entry) => entry.text.startsWith('Highlighting') && entry.state === 'done')).toBe(false);
    expect(feed.some((entry) => entry.text.startsWith('Could not find the exact passage'))).toBe(true);
  });
});
