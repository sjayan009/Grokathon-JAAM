import { afterEach, describe, expect, it, vi } from 'vitest';
import { lesson } from '../mock-smartpath/src/demo/gradientDescentLesson.ts';
import { findInSegments, mergeLines } from '../mock-smartpath/src/pdf/quoteLocator.ts';
import { BridgeClient } from '../tutor-core/src/bridge.ts';
import { PausableClock } from '../tutor-core/src/clock.ts';
import { routeIntent } from '../tutor-core/src/intentRouter.ts';
import { ALLOWED_ORIGIN, CHANNEL, validateStudyAction } from '../tutor-core/src/protocol.ts';
import { answerLive, answerOffline, explainOffline, relevantSnippets, strongMatch, type LiveAi } from '../tutor-core/src/qa.ts';

const route = (text: string) =>
  routeIntent(text, { isKnownFollowUp: (t) => strongMatch(lesson, t) !== null });

describe('routeIntent', () => {
  it.each([
    'Teach me gradient descent',
    'teach me gradient descent',
    'walk me through gradient descent in these notes',
    'Could you walk me through gradient descent using my lecture notes?',
    'explain gradient descent',
    'show me how gradient descent works',
    'help me understand gradient descent',
    'What is gradient descent?',
    'gradient descent',
    'teach me gradiant decent',
    'can you go over grad descent',
  ])('teaches for %s', (text) => {
    expect(route(text)).toBe('TEACH_GRADIENT_DESCENT');
  });

  it.each([
    'Why subtract the gradient?',
    'What if the learning rate is too big?',
    'why does gradient descent subtract the slope',
    'when do we stop?',
    'What is the capital of France?',
  ])('treats %s as a question', (text) => {
    expect(route(text)).toBe('ASK_QUESTION');
  });

  it.each(['Explain this', 'explain', 'what does this mean?', 'explain the selected passage'])(
    'treats %s as a selection request',
    (text) => {
      expect(route(text)).toBe('EXPLAIN_SELECTION');
    },
  );

  it.each([
    ['pause', 'PAUSE'],
    ['Hold on', 'PAUSE'],
    ['resume', 'RESUME'],
    ['keep going', 'RESUME'],
    ['stop', 'STOP'],
    ['stop the lesson', 'STOP'],
    ['Save this explanation', 'SAVE_NOTE'],
    ['save that as a note', 'SAVE_NOTE'],
    ['purple monkey dishwasher', 'UNKNOWN'],
    ['', 'UNKNOWN'],
  ])('routes %s to %s', (text, intent) => {
    expect(route(text)).toBe(intent);
  });
});

describe('validateStudyAction', () => {
  it('accepts allowlisted shapes', () => {
    expect(validateStudyAction({ type: 'NAVIGATE_PDF', page: 2 })).toEqual({ type: 'NAVIGATE_PDF', page: 2 });
    expect(validateStudyAction({ type: 'OPEN_VIDEO', videoId: 'IHZwWFHWa-w' })).toBeTruthy();
    expect(validateStudyAction({ type: 'GET_BOUNDS', targetId: 'quiz' })).toBeTruthy();
  });

  it.each([
    [null],
    ['NAVIGATE_PDF'],
    [{ type: 'EVAL', code: 'alert(1)' }],
    [{ type: 'NAVIGATE_PDF', page: 4 }],
    [{ type: 'NAVIGATE_PDF', page: '1' }],
    [{ type: 'OPEN_VIDEO', videoId: 'dQw4w9WgXcQ' }],
    [{ type: 'DRAW_WHITEBOARD_STEP', step: 9 }],
    [{ type: 'HIGHLIGHT_QUOTE', id: '"]<script>' }],
    [{ type: 'GET_BOUNDS', targetId: 'body' }],
    [{ type: 'GET_BOUNDS', targetId: 'quiz', quoteId: 'a"] b' }],
    [{ type: 'SAVE_NOTE', page: 1, quote: 'x', note: 'y'.repeat(5000) }],
  ])('rejects %j', (value) => {
    expect(validateStudyAction(value)).toBeNull();
  });

  it('drops fields that are not part of the shape', () => {
    expect(validateStudyAction({ type: 'SHOW_QUIZ', extra: 'x' })).toEqual({ type: 'SHOW_QUIZ' });
  });
});

describe('findInSegments', () => {
  it('finds quotes split across spans and line wraps', () => {
    const found = findInSegments(['Gradient descent minimizes a', 'loss function by moving'], 'minimizes a loss function');
    expect(found?.start).toEqual({ segment: 0, offset: 17 });
    expect(found?.end).toEqual({ segment: 1, offset: 12 });
  });

  it('returns null for missing or empty quotes', () => {
    expect(findInSegments(['hello'], 'world')).toBeNull();
    expect(findInSegments(['hello'], '   ')).toBeNull();
  });
});

describe('mergeLines', () => {
  it('combines spans on a line and keeps separate lines', () => {
    const merged = mergeLines([
      { x: 0, y: 0, width: 50, height: 10 },
      { x: 60, y: 1, width: 50, height: 10 },
      { x: 0, y: 20, width: 40, height: 10 },
      { x: 5, y: 40, width: 0, height: 10 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].width).toBe(110);
  });
});

describe('offline answers', () => {
  const context = { page: 1 as const, whiteboardStep: null, selection: null };

  it('points back to the exact page', () => {
    const answer = answerOffline(lesson, 'Why subtract the gradient?', context);
    expect(answer?.cite).toEqual({ page: 2, highlightId: 'update_rule' });
    expect(answerOffline(lesson, 'What if the learning rate is too big?', context)?.cite?.page).toBe(2);
  });

  it('uses the whiteboard only once it has been drawn', () => {
    const before = answerOffline(lesson, 'Why subtract the gradient?', context);
    const after = answerOffline(lesson, 'Why subtract the gradient?', { ...context, whiteboardStep: 2 });
    expect(before?.text).not.toContain('whiteboard');
    expect(after?.text).toContain('On the whiteboard');
  });

  it('declines rather than making something up', () => {
    expect(answerOffline(lesson, 'What is the capital of France?', context)).toBeNull();
  });

  it.each([1, 2, 3] as const)('explains known and unknown passages on page %i', (page) => {
    const known = lesson.selectionExplanations.find((item) => item.page === page);
    const answer = explainOffline(lesson, { page, quote: known!.passage });
    expect(answer.text).toBe(known!.explanation);

    const other = explainOffline(lesson, { page, quote: 'zebra quantum tuesday' });
    expect(other.text).toContain(lesson.pageExplanations[page]);
    expect(other.cite?.page).toBe(page);
  });

  it('explains a partial selection of a known passage', () => {
    const answer = explainOffline(lesson, { page: 2, quote: 'alpha is the learning rate' });
    expect(answer.cite?.highlightId).toBe('learning_rate');
  });
});

describe('live answers', () => {
  const context = { page: 2 as const, whiteboardStep: null, selection: null };
  const ai = (ask: LiveAi['ask']): LiveAi => ({
    health: async () => true,
    classify: async () => 'UNKNOWN',
    ask,
  });

  it('sends only a couple of relevant pages', () => {
    const snippets = relevantSnippets(lesson, 'worked example iterations loss', 2);
    expect(snippets).toHaveLength(2);
    expect(snippets[0].page).toBe(2);
  });

  it('drops citations to pages that do not exist', async () => {
    const answer = await answerLive(ai(async () => ({ answer: 'x', citedPage: 9 })), lesson, 'q', context);
    expect(answer?.text).toBe('x');
    expect(answer?.cite).toBeUndefined();
  });

  it('keeps valid citations', async () => {
    const answer = await answerLive(ai(async () => ({ answer: 'x', citedPage: 3 })), lesson, 'q', context);
    expect(answer?.cite).toEqual({ page: 3 });
  });

  it('returns null on failure so the caller can fall back', async () => {
    const failing = ai(async () => {
      throw new Error('down');
    });
    expect(await answerLive(failing, lesson, 'q', context)).toBeNull();
  });
});

describe('BridgeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeWindow() {
    const listeners = new Set<(event: MessageEvent) => void>();
    const posted: Record<string, unknown>[] = [];
    const win = {
      addEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
      postMessage: (message: Record<string, unknown>) => posted.push(message),
    };
    vi.stubGlobal('window', win);
    const deliver = (data: unknown, origin = ALLOWED_ORIGIN, source: unknown = win) => {
      for (const fn of listeners) fn({ data, origin, source } as unknown as MessageEvent);
    };
    return { posted, deliver };
  }

  const ack = (requestId: unknown, extra = {}) => ({ channel: CHANNEL, kind: 'ack', requestId, ok: true, ...extra });

  it('resolves on the matching ack and passes bounds through', async () => {
    const { posted, deliver } = fakeWindow();
    const client = new BridgeClient('embedded', new PausableClock());
    const sent = client.send({ type: 'SHOW_QUIZ' });
    const bounds = { x: 1, y: 2, width: 3, height: 4 };
    deliver(ack(posted[0].requestId, { bounds }));
    await expect(sent).resolves.toMatchObject({ bounds });
    client.destroy();
  });

  it('ignores other origins, frames and channels', async () => {
    const { posted, deliver } = fakeWindow();
    const client = new BridgeClient('embedded', new PausableClock(100));
    const sent = client.send({ type: 'SHOW_QUIZ' }, { timeoutMs: 1000 });
    const id = posted[0].requestId;
    deliver(ack(id), 'http://evil.example');
    deliver(ack(id), ALLOWED_ORIGIN, {});
    deliver({ ...ack(id), channel: 'other' });
    await expect(sent).rejects.toThrow('timed out');
    client.destroy();
  });

  it('rejects when the workspace reports failure', async () => {
    const { posted, deliver } = fakeWindow();
    const client = new BridgeClient('embedded', new PausableClock());
    const sent = client.send({ type: 'SHOW_QUIZ' });
    deliver(ack(posted[0].requestId, { ok: false, error: 'nope' }));
    await expect(sent).rejects.toThrow('nope');
    client.destroy();
  });

  it('rejects on abort and drops the late ack', async () => {
    const { posted, deliver } = fakeWindow();
    const client = new BridgeClient('embedded', new PausableClock());
    const abort = new AbortController();
    const sent = client.send({ type: 'SHOW_QUIZ' }, { signal: abort.signal });
    abort.abort();
    await expect(sent).rejects.toMatchObject({ name: 'AbortError' });
    expect(() => deliver(ack(posted[0].requestId))).not.toThrow();
    client.destroy();
  });

  it('does not time out while the clock is paused', async () => {
    const { posted, deliver } = fakeWindow();
    const clock = new PausableClock(100);
    const client = new BridgeClient('embedded', clock);
    clock.paused = true;
    const sent = client.send({ type: 'SHOW_QUIZ' }, { timeoutMs: 500 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    clock.paused = false;
    deliver(ack(posted[0].requestId));
    await expect(sent).resolves.toBeTruthy();
    client.destroy();
  });
});
