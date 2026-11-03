import type { LessonIntent } from './protocol.ts';

export const UNKNOWN_REPLY = 'I can teach gradient descent from this PDF, explain a selection, or save a note.';

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

const near = (token: string | undefined, word: string) => !!token && editDistance(token, word) <= 2;

/** Tolerates typos and spoken mishears such as "gradiant decent". */
function mentionsGradientDescent(tokens: string[]): boolean {
  return tokens.some((token, i) => {
    const next = tokens[i + 1];
    return (token === 'grad' && near(next, 'descent')) || (near(token, 'gradient') && near(next, 'descent'));
  });
}

const PAUSE = /^(please )?(pause|hold on|hang on|wait)( (the )?(lesson|it|this|narration))?( please)?$/;
const RESUME = /^(please )?(resume|continue|keep going|go on|carry on|unpause)( (the )?(lesson|it|this))?( please)?$/;
const STOP = /^(please )?(stop|cancel|quit|abort|end)( (the )?(lesson|it|this|narration))?( please)?$/;
const SAVE = /\b(save|bookmark|remember|keep)\b.*\b(this|that|it|explanation|note|answer)\b|\badd (this |that |it )?(as |to )?(a )?note/;
const EXPLAIN_SELECTION =
  /\b(explain|simplify|clarify|break down|what does|what do|meaning of|help me understand|what's)\b.*\b(this|that|these|selection|selected|highlighted|passage|sentence|phrase|line)\b|^explain$/;
const TEACH_VERB =
  /\b(teach|walk|explain|show|learn|understand|help|go through|go over|lesson|tutorial|demo|introduce|intro|cover|how does|how do|what is|what's|whats|start)\b/;
const NOT_TEACHING = /^(why|when|where|which|who|should|does|do|is|are|if)\b/;
const QUESTION = /^(how|why|what|what's|when|where|which|who|does|do|is|are|can|could|should|would|if)\b/;

export interface RouteContext {
  /** True when the text strongly matches an authored follow-up answer. */
  isKnownFollowUp(text: string): boolean;
}

export function routeIntent(text: string, context: RouteContext): LessonIntent {
  const n = normalize(text);
  if (!n) return 'UNKNOWN';

  if (PAUSE.test(n)) return 'PAUSE';
  if (RESUME.test(n)) return 'RESUME';
  if (STOP.test(n)) return 'STOP';
  if (SAVE.test(n)) return 'SAVE_NOTE';

  const tokens = n.split(' ');
  const concept = mentionsGradientDescent(tokens);

  if (!concept && EXPLAIN_SELECTION.test(n)) return 'EXPLAIN_SELECTION';
  if (context.isKnownFollowUp(text)) return 'ASK_QUESTION';

  if (concept) {
    if (NOT_TEACHING.test(n) && !/^(what is|what's)\b/.test(n)) return 'ASK_QUESTION';
    const bare = tokens.length <= 3;
    return TEACH_VERB.test(n) || bare ? 'TEACH_GRADIENT_DESCENT' : 'ASK_QUESTION';
  }

  if (/\?\s*$/.test(text) || QUESTION.test(n)) return 'ASK_QUESTION';
  return 'UNKNOWN';
}
