import { normalize } from './intentRouter.ts';
import type { Citation, LessonFixture, QaFallback } from './lessonTypes.ts';
import type { LessonIntent, PageNumber, Selection, WorkspaceContext } from './protocol.ts';

export interface Answer {
  text: string;
  cite?: Citation;
  source: 'scripted' | 'live';
}

export interface AskRequest {
  question: string;
  page: PageNumber;
  whiteboardStep: number | null;
  selection: string | null;
  snippets: { page: number; text: string }[];
}

/** Optional LLM path. Absent or failing, the scripted answers carry the demo. */
export interface LiveAi {
  health(): Promise<boolean>;
  ask(request: AskRequest): Promise<{ answer: string; citedPage: number | null }>;
  classify(text: string): Promise<LessonIntent>;
}

const LIVE_TIMEOUT_MS = 6000;

const words = (text: string) => new Set(normalize(text).split(' ').filter((word) => word.length > 2));

function overlap(selection: Set<string>, passage: Set<string>) {
  if (selection.size === 0) return 0;
  let hits = 0;
  for (const word of selection) if (passage.has(word)) hits += 1;
  return hits / selection.size;
}

export function strongMatch(lesson: LessonFixture, text: string): QaFallback | null {
  const n = normalize(text);
  return lesson.qaFallbacks.find((qa) => qa.phrases.some((phrase) => n.includes(phrase))) ?? null;
}

function keywordMatch(lesson: LessonFixture, text: string): QaFallback | null {
  const n = normalize(text);
  return lesson.qaFallbacks.find((qa) => qa.keywords.every((keyword) => n.includes(keyword))) ?? null;
}

export function answerOffline(lesson: LessonFixture, question: string, context: WorkspaceContext): Answer | null {
  const qa = strongMatch(lesson, question) ?? keywordMatch(lesson, question);
  if (!qa) return null;
  const addendum = qa.boardAddendum;
  const useBoard = addendum && context.whiteboardStep !== null && context.whiteboardStep >= addendum.minStep;
  return {
    text: useBoard ? `${qa.answer} ${addendum.text}` : qa.answer,
    cite: qa.cite,
    source: 'scripted',
  };
}

export function explainOffline(lesson: LessonFixture, selection: Selection): Answer {
  const picked = words(selection.quote);
  let best: { score: number; item: LessonFixture['selectionExplanations'][number] } | null = null;
  for (const item of lesson.selectionExplanations) {
    if (item.page !== selection.page) continue;
    const score = overlap(picked, words(item.passage));
    if (score >= 0.5 && (!best || score > best.score)) best = { score, item };
  }
  if (best) {
    return {
      text: best.item.explanation,
      cite: { page: selection.page, highlightId: best.item.highlightId },
      source: 'scripted',
    };
  }
  return {
    text: `I don't have a specific note on that passage. Here's where it fits: ${lesson.pageExplanations[selection.page]}`,
    cite: { page: selection.page },
    source: 'scripted',
  };
}

/** Sends the model only the pages this question needs, never the whole app. */
export function relevantSnippets(lesson: LessonFixture, question: string, page: PageNumber) {
  const asked = words(question);
  const ranked = lesson.pages
    .map((item) => ({ item, score: item.number === page ? 1 : overlap(asked, words(item.text)) }))
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, 2).map(({ item }) => ({ page: item.number, text: item.text }));
}

export async function answerLive(
  ai: LiveAi,
  lesson: LessonFixture,
  question: string,
  context: WorkspaceContext,
): Promise<Answer | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LIVE_TIMEOUT_MS));
  const call = ai
    .ask({
      question,
      page: context.page,
      whiteboardStep: context.whiteboardStep,
      selection: context.selection?.quote ?? null,
      snippets: relevantSnippets(lesson, question, context.page),
    })
    .catch(() => null);

  const result = await Promise.race([call, timeout]);
  if (!result?.answer) return null;
  const cited = result.citedPage;
  const valid = cited === 1 || cited === 2 || cited === 3;
  return { text: result.answer, cite: valid ? { page: cited } : undefined, source: 'live' };
}

/** Plain HTTP client. Used by the embedded mode through the Vite /api proxy. */
export function fetchLiveAi(baseUrl: string): LiveAi {
  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Proxy returned ${response.status}`);
    return (await response.json()) as T;
  };
  return {
    async health() {
      try {
        const response = await fetch(`${baseUrl}/health`);
        if (!response.ok) return false;
        return ((await response.json()) as { live?: boolean }).live === true;
      } catch {
        return false;
      }
    },
    ask: (request) => post('/ask', request),
    classify: async (text) => (await post<{ intent: LessonIntent }>('/classify', { text })).intent,
  };
}
