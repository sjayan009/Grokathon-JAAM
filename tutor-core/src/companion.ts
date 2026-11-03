import type { BridgeClient } from './bridge.ts';
import type { CompanionCursor } from './companionCursor.ts';
import { UNKNOWN_REPLY, routeIntent } from './intentRouter.ts';
import type { Citation, LessonFixture } from './lessonTypes.ts';
import type { LessonRunner, RunnerSnapshot } from './lessonRunner.ts';
import type { AppEvent, CompanionClient, LessonIntent, PageNumber, Selection, WorkspaceContext } from './protocol.ts';
import { LESSON_INTENTS } from './protocol.ts';
import { answerLive, answerOffline, explainOffline, strongMatch, type Answer, type LiveAi } from './qa.ts';
import { listenOnce, speechRecognitionSupported } from './speech.ts';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  cite?: Citation;
  /** Set on explanations, which can be saved as notes. */
  savable?: { page: number; quote: string };
  source?: Answer['source'];
}

export interface CompanionState {
  client: CompanionClient;
  connection: 'connecting' | 'connected' | 'failed';
  ai: 'checking' | 'live' | 'scripted';
  caption: string;
  messages: ChatMessage[];
  listening: boolean;
  micSupported: boolean;
  thinking: boolean;
  runner: RunnerSnapshot;
}

const GREETING = `Hi! ${UNKNOWN_REPLY}`;

/** Connects the panel, the runner and the workspace. Holds no DOM of its own. */
export class CompanionController {
  private lesson: LessonFixture;
  private bridge: BridgeClient;
  private runner: LessonRunner;
  private cursor: CompanionCursor;
  private ai: LiveAi | undefined;
  private listeners = new Set<() => void>();
  private state: CompanionState;
  private nextMessageId = 1;
  private lastSelection: Selection | null = null;
  private lastExplanation: { page: number; quote: string; text: string } | null = null;
  private stopListening: (() => void) | null = null;
  private detach: (() => void)[] = [];
  private returnToPage: PageNumber | null = null;

  constructor(deps: {
    lesson: LessonFixture;
    client: CompanionClient;
    bridge: BridgeClient;
    runner: LessonRunner;
    cursor: CompanionCursor;
    ai?: LiveAi;
  }) {
    this.lesson = deps.lesson;
    this.bridge = deps.bridge;
    this.runner = deps.runner;
    this.cursor = deps.cursor;
    this.ai = deps.ai;
    this.state = {
      client: deps.client,
      connection: 'connecting',
      ai: deps.ai ? 'checking' : 'scripted',
      caption: '',
      messages: [{ id: 0, role: 'assistant', text: GREETING }],
      listening: false,
      micSupported: speechRecognitionSupported(),
      thinking: false,
      runner: deps.runner.getSnapshot(),
    };

    this.detach.push(
      deps.runner.subscribe(() => this.patch({ runner: deps.runner.getSnapshot() })),
      deps.bridge.onEvent(this.onAppEvent) as () => void,
    );

    const onVisibility = () => {
      if (document.hidden) this.runner.pause('hidden');
      else this.runner.resume('hidden');
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.detach.push(() => document.removeEventListener('visibilitychange', onVisibility));

    deps.bridge.onReady(() => this.patch({ connection: 'connected' }));
    deps.bridge.connect(() => this.patch({ connection: 'failed' }));

    void deps.ai
      ?.health()
      .catch(() => false)
      .then((live) => this.patch({ ai: live ? 'live' : 'scripted' }));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  setCaption(caption: string) {
    this.patch({ caption });
  }

  /** Keeps a transcript alongside the live subtitles. */
  addNarration(text: string) {
    this.say(text);
  }

  startLesson() {
    this.say('Here is the plan: Notes \u2192 Whiteboard \u2192 Video \u2192 Check understanding.');
    void this.runner.start();
  }

  togglePause() {
    if (this.runner.getSnapshot().status === 'paused') this.resume();
    else this.runner.pause('user');
  }

  stop() {
    this.returnToPage = null;
    void this.runner.stop();
  }

  skip() {
    this.runner.skipNarration();
  }

  toggleMic() {
    if (this.stopListening) {
      this.stopListening();
      return;
    }
    this.patch({ listening: true });
    this.stopListening = listenOnce({
      onText: (text) => void this.submit(text),
      onError: (message) => this.say(message),
      onEnd: () => {
        this.stopListening = null;
        this.patch({ listening: false });
      },
    });
  }

  async submit(raw: string) {
    const text = raw.trim();
    if (!text) return;
    this.addMessage({ role: 'user', text });
    await this.route(text, await this.intentFor(text));
  }

  async explain(selection: Selection) {
    this.lastSelection = selection;
    await this.pauseForQuestion();
    const context = await this.context();
    const scripted = explainOffline(this.lesson, selection);
    const live = await this.liveAnswer(`Explain this passage from page ${selection.page}: "${selection.quote}"`, {
      ...context,
      selection,
    });
    const answer = live ?? scripted;
    this.lastExplanation = { page: selection.page, quote: selection.quote, text: answer.text };
    this.addMessage({
      role: 'assistant',
      text: answer.text,
      cite: answer.cite,
      source: answer.source,
      savable: { page: selection.page, quote: selection.quote },
    });
    // The student is already on this passage, so only move for a real highlight.
    if (answer.cite?.highlightId) void this.pointAt(answer.cite);
  }

  async saveExplanation(target?: ChatMessage) {
    const note = target?.savable
      ? { ...target.savable, text: target.text }
      : this.lastExplanation;
    if (!note) {
      this.say('Ask me to explain a passage first, then I can save it.');
      return;
    }
    try {
      await this.bridge.send({ type: 'SAVE_NOTE', page: note.page, quote: note.quote, note: note.text });
      this.say(`Saved to your notes on page ${note.page}.`);
    } catch {
      this.say("I couldn't save that note. Please try again.");
    }
  }

  async pointAt(cite?: Citation) {
    if (!cite) return;
    const abort = new AbortController();
    try {
      const ack = await this.bridge.send(
        cite.highlightId ? { type: 'HIGHLIGHT_QUOTE', id: cite.highlightId } : { type: 'NAVIGATE_PDF', page: cite.page },
      );
      // While a lesson is paused the cursor stays put; the highlight still shows.
      if (this.runner.isActive) return;
      const box = ack.rects?.[0] ?? ack.bounds;
      if (!box) return;
      this.cursor.setStatus('working');
      await this.cursor.moveTo(box.x + Math.min(box.width, 120), box.y + Math.min(box.height, 40), abort.signal);
      if (ack.rects) await this.cursor.sweep(ack.rects, abort.signal);
    } catch {
      this.say(`I couldn't jump there, but you can find this on page ${cite.page}.`);
    } finally {
      if (!this.runner.isActive) {
        this.cursor.setStatus('follow');
        this.cursor.release();
      }
    }
  }

  resume() {
    this.runner.resume();
    if (this.returnToPage) {
      void this.bridge.send({ type: 'NAVIGATE_PDF', page: this.returnToPage }).catch(() => undefined);
      this.returnToPage = null;
    }
  }

  destroy() {
    this.stopListening?.();
    for (const detach of this.detach) detach();
    void this.runner.stop();
  }

  private async intentFor(text: string): Promise<LessonIntent> {
    const intent = routeIntent(text, { isKnownFollowUp: (t) => strongMatch(this.lesson, t) !== null });
    if (intent !== 'UNKNOWN' || this.state.ai !== 'live' || !this.ai) return intent;
    try {
      const guess = await this.ai.classify(text);
      return LESSON_INTENTS.includes(guess) ? guess : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  private async route(text: string, intent: LessonIntent) {
    switch (intent) {
      case 'TEACH_GRADIENT_DESCENT':
        this.startLesson();
        return;
      case 'PAUSE':
        this.runner.pause('user');
        return;
      case 'RESUME':
        this.resume();
        return;
      case 'STOP':
        this.stop();
        return;
      case 'SAVE_NOTE':
        await this.saveExplanation();
        return;
      case 'EXPLAIN_SELECTION': {
        const context = await this.context();
        const selection = context.selection ?? this.lastSelection;
        if (selection) await this.explain(selection);
        else this.say('Select a passage in the PDF first, then ask me to explain it.');
        return;
      }
      case 'ASK_QUESTION':
        await this.answer(text);
        return;
      default:
        this.say(UNKNOWN_REPLY);
    }
  }

  private async answer(question: string) {
    await this.pauseForQuestion();
    const context = await this.context();
    const live = await this.liveAnswer(question, context);
    const answer = live ?? answerOffline(this.lesson, question, context);
    if (!answer) {
      this.say(UNKNOWN_REPLY);
      return;
    }
    const cited = answer.cite?.page ?? context.page;
    this.lastExplanation = { page: cited, quote: '', text: answer.text };
    this.addMessage({
      role: 'assistant',
      text: answer.text,
      cite: answer.cite,
      source: answer.source,
      savable: { page: cited, quote: '' },
    });
    void this.pointAt(answer.cite);
  }

  private async liveAnswer(question: string, context: WorkspaceContext) {
    if (this.state.ai !== 'live' || !this.ai) return null;
    this.patch({ thinking: true });
    try {
      return await answerLive(this.ai, this.lesson, question, context);
    } finally {
      this.patch({ thinking: false });
    }
  }

  /** Mid-lesson questions pause the lesson; Resume returns to the same page. */
  private async pauseForQuestion() {
    if (!this.runner.isActive) return;
    this.runner.pause('question');
    this.returnToPage ??= (await this.context()).page;
  }

  private async context(): Promise<WorkspaceContext> {
    try {
      const { context } = await this.bridge.send({ type: 'GET_CONTEXT' });
      if (context) return context;
    } catch {
      // Fall through to a safe default; the answer just loses page awareness.
    }
    return { page: 1, whiteboardStep: null, selection: this.lastSelection };
  }

  private onAppEvent = (event: AppEvent) => {
    switch (event.type) {
      case 'SELECTION_CHANGED':
        if (event.selection) this.lastSelection = event.selection;
        return;
      case 'EXPLAIN_REQUEST':
        void this.explain(event.selection);
        return;
      case 'QUIZ_ANSWERED':
        this.runner.answerQuiz(event.choiceId);
        return;
      case 'VIDEO_STATE':
        if (event.state === 'playing') this.runner.pause('video');
        else if (event.state === 'paused' || event.state === 'ended' || event.state === 'error') {
          this.runner.resume('video');
        }
        return;
      case 'LAYOUT_CHANGED':
        void this.trackAnchor();
        return;
    }
  };

  private async trackAnchor() {
    const anchor = this.runner.anchor;
    if (!anchor) return;
    try {
      const { bounds } = await this.bridge.send({ type: 'GET_BOUNDS', targetId: anchor.target, quoteId: anchor.quoteId });
      if (bounds) this.cursor.nudgeTo(bounds.x + bounds.width / 2, bounds.y + Math.min(bounds.height, 120));
    } catch {
      // The target left the screen; the cursor simply stays where it is.
    }
  }

  private say(text: string) {
    this.addMessage({ role: 'assistant', text });
  }

  private addMessage(message: Omit<ChatMessage, 'id'>) {
    this.nextMessageId += 1;
    this.patch({ messages: [...this.state.messages, { ...message, id: this.nextMessageId }] });
  }

  private patch(next: Partial<CompanionState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
}
