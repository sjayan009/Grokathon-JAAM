import type { AskRequest, LessonIntent } from '@smartpath/tutor-core';

/** Content script to service worker. Only the worker may reach the proxy. */
export type RuntimeRequest =
  | { kind: 'health' }
  | { kind: 'ask'; request: AskRequest }
  | { kind: 'classify'; text: string };

export type RuntimeResponse =
  | { ok: true; live?: boolean; answer?: string; citedPage?: number | null; intent?: LessonIntent }
  | { ok: false; error: string };

export const TOGGLE_COMPANION = 'TOGGLE_COMPANION';
