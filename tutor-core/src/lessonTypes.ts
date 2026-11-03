import type { PageNumber, StudyAction, TargetId } from './protocol.ts';

export type Beat =
  /** Glide the cursor to a named target. */
  | { kind: 'cursor'; target: TargetId }
  /** Glide to a target, show a click ripple, then run an action. */
  | { kind: 'click'; target: TargetId; action: StudyAction }
  /** Run an action; `follow` sends the cursor to the bounds in its ack. */
  | { kind: 'action'; action: StudyAction; follow?: boolean; timeoutMs?: number }
  /** Start narration here. Steps without one start narrating immediately. */
  | { kind: 'narrate'; text?: 'quiz-feedback' }
  /** Hold until the student answers the quiz. */
  | { kind: 'wait-quiz' };

export interface LessonStep {
  id: string;
  title: string;
  group: 'Plan' | 'Notes' | 'Whiteboard' | 'Video' | 'Check';
  beats: Beat[];
}

export interface PageFixture {
  number: PageNumber;
  text: string;
}

export interface HighlightFixture {
  id: string;
  page: PageNumber;
  quote: string;
}

export interface Citation {
  page: PageNumber;
  highlightId?: string;
}

export interface QaFallback {
  id: string;
  /** Any whole phrase matching is a strong hit. */
  phrases: string[];
  /** Every keyword present is a weaker hit. */
  keywords: string[];
  answer: string;
  /** Added once the whiteboard has reached `minStep`. */
  boardAddendum?: { minStep: number; text: string };
  cite: Citation;
}

export interface SelectionExplanation {
  page: PageNumber;
  /** Text this explanation applies to, matched by word overlap. */
  passage: string;
  explanation: string;
  highlightId?: string;
}

export interface QuizChoice {
  id: string;
  label: string;
  correct: boolean;
  explanation: string;
}

export interface LessonFixture {
  lessonId: string;
  documentId: string;
  courseId: string;
  pageCount: number;
  title: string;
  pages: PageFixture[];
  highlights: HighlightFixture[];
  lessonSteps: LessonStep[];
  /** Keyed by step id, deliberately apart from the visual beats. */
  narration: Record<string, string>;
  qaFallbacks: QaFallback[];
  selectionExplanations: SelectionExplanation[];
  pageExplanations: Record<PageNumber, string>;
  quiz: { question: string; choices: QuizChoice[] };
  videoId: string;
  videoTitle: string;
  videoSource: string;
}
