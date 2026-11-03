/**
 * The authored lecture notes. scripts/generate-pdf.mjs draws these blocks into
 * the PDF, and gradientDescentLesson.ts derives pages[].text from them, so the
 * PDF and the fixture cannot drift apart. PDF standard fonts are WinAnsi only,
 * so keep this ASCII (plus the em dash).
 */

export const DOCUMENT_TITLE = 'Gradient Descent — Lecture Notes';
export const COURSE_LINE = 'CS 3600 — Intro to AI  |  Lecture 8: Optimization';

export const ALPHA = 0.4;

export type NotesBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'key'; text: string }
  | { kind: 'formula'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'figure'; caption: string };

export const notesPages: NotesBlock[][] = [
  [
    { kind: 'heading', text: '1. Intuition' },
    {
      kind: 'paragraph',
      text: 'Training a model means finding the parameters that make its predictions less wrong. A loss function turns that wrongness into a single score, and lower is better.',
    },
    { kind: 'key', text: 'Gradient descent minimizes a loss function by moving opposite the slope.' },
    {
      kind: 'paragraph',
      text: 'Picture the loss landscape as a valley. Standing anywhere on its surface, you can feel which way the ground tilts. The slope at your feet points uphill, so you step the other way and repeat. You never need a map of the whole valley, only the local slope.',
    },
    { kind: 'figure', caption: 'Figure 1. A one-parameter loss curve. The minimum is where the slope is zero.' },
  ],
  [
    { kind: 'heading', text: '2. The Algorithm' },
    {
      kind: 'paragraph',
      text: 'Start from an initial guess for the weight w. At each iteration, compute the gradient of the loss at the current weight, then update the weight:',
    },
    { kind: 'formula', text: 'w_next = w_current - alpha * gradient' },
    {
      kind: 'paragraph',
      text: 'The gradient points in the direction of steepest increase, so subtracting it moves the weight downhill. Here alpha is the learning rate. It scales every update, which sets how far each step travels.',
    },
    { kind: 'paragraph', text: 'Choosing alpha is a tradeoff between slow convergence and overshooting:' },
    { kind: 'bullet', text: 'Too small: updates are tiny, so training converges slowly.' },
    { kind: 'bullet', text: 'Too large: updates jump past the minimum and can overshoot it, or even diverge.' },
    { kind: 'paragraph', text: 'Stop when the gradient is close to zero or when the loss stops improving.' },
  ],
  [
    { kind: 'heading', text: '3. Worked Example' },
    { kind: 'paragraph', text: 'Take a loss whose minimum sits at w = 3:' },
    { kind: 'formula', text: 'L(w) = (w - 3)^2' },
    { kind: 'formula', text: 'gradient = 2(w - 3)' },
    { kind: 'formula', text: 'alpha = 0.4, starting at w = 0' },
    {
      kind: 'paragraph',
      text: 'The first update gives w_next = 0 - 0.4 * (-6) = 2.4. Repeating the rule produces:',
    },
    {
      kind: 'table',
      header: ['Iteration', 'w', 'gradient', 'L(w)'],
      rows: [
        ['0', '0', '-6', '9'],
        ['1', '2.4', '-1.2', '0.36'],
        ['2', '2.88', '-0.24', '0.0144'],
        ['3', '2.976', '-0.048', '0.000576'],
      ],
    },
    {
      kind: 'paragraph',
      text: 'The loss falls from 9 to 0.36, then 0.0144, then 0.000576. Each update shrinks the distance to the minimum by the same factor, so the steps get smaller as the slope flattens.',
    },
  ],
];

/** Plain text of one page, in reading order. */
export function pageText(blocks: NotesBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === 'table') return [block.header, ...block.rows].map((row) => row.join(' ')).join(' ');
      if (block.kind === 'figure') return block.caption;
      return block.text;
    })
    .join('\n');
}
