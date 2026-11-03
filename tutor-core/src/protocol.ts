/**
 * Message contract between the companion (extension content script or the
 * embedded simulation) and the study workspace. Everything crossing
 * window.postMessage is allowlisted here; model output never reaches the DOM.
 */

export const CHANNEL = 'smartpath-tutor/v1';
export const ALLOWED_ORIGIN = 'http://localhost:5173';

export type PageNumber = 1 | 2 | 3;
export type WhiteboardStep = 0 | 1 | 2 | 3;

export const VIDEO_ID = 'IHZwWFHWa-w';

export const TARGET_IDS = [
  'pdf-viewer',
  'pdf-page-1',
  'pdf-page-2',
  'pdf-page-3',
  'open-whiteboard',
  'whiteboard',
  'video-dock',
  'quiz',
  'annotation',
  'notes-panel',
] as const;
export type TargetId = (typeof TARGET_IDS)[number];

export type StudyAction =
  | { type: 'NAVIGATE_PDF'; page: PageNumber }
  | { type: 'HIGHLIGHT_QUOTE'; id: string }
  | { type: 'OPEN_WHITEBOARD' }
  | { type: 'DRAW_WHITEBOARD_STEP'; step: WhiteboardStep }
  | { type: 'SHOW_ANNOTATION'; page: PageNumber; text: string }
  | { type: 'OPEN_VIDEO'; videoId: typeof VIDEO_ID }
  | { type: 'SHOW_QUIZ' }
  | { type: 'SAVE_NOTE'; page: number; quote: string; note: string }
  // Additions to the spec's list: the verbs above can't express these.
  | { type: 'GET_BOUNDS'; targetId: TargetId; quoteId?: string }
  | { type: 'GET_CONTEXT' }
  | { type: 'RESET_WORKSPACE' }
  | { type: 'SET_LESSON_MODE'; active: boolean; complete?: boolean }
  | { type: 'SET_PLAYBACK'; paused: boolean }
  | { type: 'CANCEL_ALL' };

export type LessonIntent =
  | 'TEACH_GRADIENT_DESCENT'
  | 'EXPLAIN_SELECTION'
  | 'SAVE_NOTE'
  | 'ASK_QUESTION'
  | 'PAUSE'
  | 'RESUME'
  | 'STOP'
  | 'UNKNOWN';

export const LESSON_INTENTS: readonly LessonIntent[] = [
  'TEACH_GRADIENT_DESCENT',
  'EXPLAIN_SELECTION',
  'SAVE_NOTE',
  'ASK_QUESTION',
  'PAUSE',
  'RESUME',
  'STOP',
  'UNKNOWN',
];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkspaceContext {
  page: PageNumber;
  whiteboardStep: WhiteboardStep | null;
  selection: Selection | null;
}

export interface Selection {
  page: PageNumber;
  quote: string;
}

export interface AckPayload {
  /** Union of the target's rects, in viewport coordinates. */
  bounds?: Rect;
  /** Per-line rects for a highlighted quote. */
  rects?: Rect[];
  /** Set when the app used a weaker result and must not claim the exact one. */
  fallback?: 'callout';
  context?: WorkspaceContext;
}

export type VideoState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

export type AppEvent =
  | { type: 'SELECTION_CHANGED'; selection: Selection | null }
  | { type: 'EXPLAIN_REQUEST'; selection: Selection }
  | { type: 'QUIZ_ANSWERED'; choiceId: string }
  | { type: 'VIDEO_STATE'; state: VideoState }
  | { type: 'LAYOUT_CHANGED' };

export type CompanionClient = 'extension' | 'embedded';

export type WireMessage =
  | { channel: typeof CHANNEL; kind: 'hello'; client: CompanionClient }
  | { channel: typeof CHANNEL; kind: 'ready'; documentId: string }
  | { channel: typeof CHANNEL; kind: 'command'; requestId: string; action: StudyAction }
  | ({ channel: typeof CHANNEL; kind: 'ack'; requestId: string; ok: boolean; error?: string } & AckPayload)
  | { channel: typeof CHANNEL; kind: 'event'; event: AppEvent };

const MAX_TEXT = 4000;

const isPage = (v: unknown): v is PageNumber => v === 1 || v === 2 || v === 3;
const isQuoteId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_]{1,64}$/.test(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TEXT;

/** Returns the action only if its shape is exactly one we allow. */
export function validateStudyAction(value: unknown): StudyAction | null {
  if (typeof value !== 'object' || value === null) return null;
  const a = value as Record<string, unknown>;
  switch (a.type) {
    case 'NAVIGATE_PDF':
      return isPage(a.page) ? { type: a.type, page: a.page } : null;
    case 'HIGHLIGHT_QUOTE':
      return isQuoteId(a.id) ? { type: a.type, id: a.id } : null;
    case 'DRAW_WHITEBOARD_STEP':
      return a.step === 0 || a.step === 1 || a.step === 2 || a.step === 3 ? { type: a.type, step: a.step } : null;
    case 'SHOW_ANNOTATION':
      return isPage(a.page) && isText(a.text) ? { type: a.type, page: a.page, text: a.text } : null;
    case 'OPEN_VIDEO':
      return a.videoId === VIDEO_ID ? { type: a.type, videoId: VIDEO_ID } : null;
    case 'SAVE_NOTE':
      return isPage(a.page) && isText(a.quote) && isText(a.note)
        ? { type: a.type, page: a.page, quote: a.quote, note: a.note }
        : null;
    case 'GET_BOUNDS':
      if (a.quoteId !== undefined && !isQuoteId(a.quoteId)) return null;
      return TARGET_IDS.includes(a.targetId as TargetId)
        ? { type: a.type, targetId: a.targetId as TargetId, quoteId: a.quoteId }
        : null;
    case 'SET_LESSON_MODE':
      return typeof a.active === 'boolean'
        ? { type: a.type, active: a.active, complete: a.complete === true }
        : null;
    case 'SET_PLAYBACK':
      return typeof a.paused === 'boolean' ? { type: a.type, paused: a.paused } : null;
    case 'OPEN_WHITEBOARD':
    case 'SHOW_QUIZ':
    case 'GET_CONTEXT':
    case 'RESET_WORKSPACE':
    case 'CANCEL_ALL':
      return { type: a.type };
    default:
      return null;
  }
}

export function isWireMessage(data: unknown): data is WireMessage {
  return typeof data === 'object' && data !== null && (data as { channel?: unknown }).channel === CHANNEL;
}

/** Same-window, exact-origin, right channel. Used by both ends of the bridge. */
export function isTrustedEvent(event: MessageEvent, expectedOrigin: string = ALLOWED_ORIGIN): boolean {
  return event.source === window && event.origin === expectedOrigin && isWireMessage(event.data);
}
