import type { LessonFixture, LessonStep, PageNumber } from '@smartpath/tutor-core';
import { ALPHA, notesPages, pageText } from './notesContent.ts';

export { ALPHA };

/** Worked-example iterations, recomputed against the formula in tests. */
export const iterations = [
  { k: 0, w: 0, gradient: -6, loss: 9 },
  { k: 1, w: 2.4, gradient: -1.2, loss: 0.36 },
  { k: 2, w: 2.88, gradient: -0.24, loss: 0.0144 },
  { k: 3, w: 2.976, gradient: -0.048, loss: 0.000576 },
] as const;

export const SIDECAR_ANNOTATION = 'Bigger learning rates may overshoot; smaller rates converge more slowly.';

const lessonSteps: LessonStep[] = [
  {
    id: 'recognize',
    title: 'Plan the lesson',
    group: 'Plan',
    beats: [{ kind: 'action', action: { type: 'SET_LESSON_MODE', active: true } }],
  },
  {
    id: 'find_concept',
    title: 'Find the concept',
    group: 'Notes',
    beats: [
      { kind: 'cursor', target: 'pdf-viewer' },
      { kind: 'action', action: { type: 'NAVIGATE_PDF', page: 1 }, follow: true },
      { kind: 'narrate' },
      { kind: 'action', action: { type: 'HIGHLIGHT_QUOTE', id: 'definition' }, follow: true },
    ],
  },
  {
    id: 'show_rule',
    title: 'Show the update rule',
    group: 'Notes',
    beats: [
      { kind: 'action', action: { type: 'NAVIGATE_PDF', page: 2 }, follow: true },
      { kind: 'narrate' },
      { kind: 'action', action: { type: 'HIGHLIGHT_QUOTE', id: 'update_rule' }, follow: true },
      { kind: 'action', action: { type: 'HIGHLIGHT_QUOTE', id: 'learning_rate' }, follow: true },
    ],
  },
  {
    id: 'open_whiteboard',
    title: 'Open the whiteboard',
    group: 'Whiteboard',
    beats: [
      { kind: 'click', target: 'open-whiteboard', action: { type: 'OPEN_WHITEBOARD' } },
      { kind: 'narrate' },
      { kind: 'action', action: { type: 'DRAW_WHITEBOARD_STEP', step: 0 }, timeoutMs: 15000 },
      { kind: 'action', action: { type: 'DRAW_WHITEBOARD_STEP', step: 1 }, timeoutMs: 15000 },
    ],
  },
  {
    id: 'work_example',
    title: 'Work the example',
    group: 'Whiteboard',
    beats: [
      { kind: 'cursor', target: 'whiteboard' },
      { kind: 'action', action: { type: 'DRAW_WHITEBOARD_STEP', step: 2 }, timeoutMs: 15000 },
    ],
  },
  {
    id: 'animate_updates',
    title: 'Animate the updates',
    group: 'Whiteboard',
    beats: [{ kind: 'action', action: { type: 'DRAW_WHITEBOARD_STEP', step: 3 }, timeoutMs: 20000 }],
  },
  {
    id: 'tie_to_notes',
    title: 'Tie back to the notes',
    group: 'Notes',
    beats: [
      { kind: 'action', action: { type: 'NAVIGATE_PDF', page: 3 }, follow: true },
      { kind: 'narrate' },
      { kind: 'action', action: { type: 'HIGHLIGHT_QUOTE', id: 'worked_paragraph' }, follow: true },
      { kind: 'action', action: { type: 'SHOW_ANNOTATION', page: 3, text: SIDECAR_ANNOTATION }, follow: true },
    ],
  },
  {
    id: 'open_video',
    title: 'Open a supporting video',
    group: 'Video',
    beats: [
      { kind: 'action', action: { type: 'OPEN_VIDEO', videoId: 'IHZwWFHWa-w' } },
      { kind: 'cursor', target: 'video-dock' },
    ],
  },
  {
    id: 'check_understanding',
    title: 'Check understanding',
    group: 'Check',
    beats: [
      { kind: 'action', action: { type: 'SHOW_QUIZ' } },
      { kind: 'narrate' },
      { kind: 'cursor', target: 'quiz' },
      { kind: 'wait-quiz' },
      { kind: 'narrate', text: 'quiz-feedback' },
      { kind: 'action', action: { type: 'NAVIGATE_PDF', page: 2 } },
      { kind: 'action', action: { type: 'HIGHLIGHT_QUOTE', id: 'lr_tradeoff' }, follow: true },
    ],
  },
];

export const lesson: LessonFixture = {
  lessonId: 'gradient_descent_walkthrough',
  documentId: 'gradient-descent-notes',
  courseId: 'cs-3600',
  pageCount: 3,
  title: 'Gradient descent walkthrough',
  pages: notesPages.map((blocks, i) => ({ number: (i + 1) as PageNumber, text: pageText(blocks) })),
  highlights: [
    {
      id: 'definition',
      page: 1,
      quote: 'Gradient descent minimizes a loss function by moving opposite the slope.',
    },
    { id: 'update_rule', page: 2, quote: 'w_next = w_current - alpha * gradient' },
    { id: 'learning_rate', page: 2, quote: 'alpha is the learning rate' },
    { id: 'lr_tradeoff', page: 2, quote: 'tradeoff between slow convergence and overshooting' },
    {
      id: 'worked_paragraph',
      page: 3,
      quote:
        'The loss falls from 9 to 0.36, then 0.0144, then 0.000576. Each update shrinks the distance to the minimum by the same factor, so the steps get smaller as the slope flattens.',
    },
  ],
  lessonSteps,
  narration: {
    recognize: "I found gradient descent in your lecture notes. Let's build the intuition, then work through an example.",
    find_concept: "First, we need a loss function—it's a score telling us how wrong our model is.",
    show_rule: 'The gradient tells us the uphill direction. We subtract it to move downhill. Alpha controls step size.',
    open_whiteboard: 'Think of this curve as a hill-shaped bowl. We want to reach the lowest point.',
    work_example: 'We start at zero. Our derivative is negative six, so subtracting the gradient moves us right.',
    animate_updates: 'Each update reduces the loss. The steps naturally get smaller near the minimum.',
    tie_to_notes: 'This is the same calculation your notes describe. The learning rate is the key tradeoff.',
    open_video: "Here's a visual explanation of how the same idea trains neural networks. Play it when you're ready.",
    check_understanding: 'Quick check: if alpha is too large, what can happen?',
  },
  qaFallbacks: [
    {
      id: 'why_subtract',
      phrases: ['why subtract', 'why do we subtract', 'why minus', 'why negative', 'why opposite', 'why not add'],
      keywords: ['subtract', 'gradient'],
      answer:
        'The gradient points uphill, in the direction of steepest increase. We want the loss to go down, so page 2 subtracts it: w_next = w_current - alpha * gradient.',
      boardAddendum: {
        minStep: 2,
        text: 'On the whiteboard, the derivative at w = 0 is -6, so subtracting it moves the dot right, toward the minimum at w = 3.',
      },
      cite: { page: 2, highlightId: 'update_rule' },
    },
    {
      id: 'lr_too_big',
      phrases: [
        'learning rate is too big',
        'learning rate too big',
        'learning rate is too large',
        'learning rate too large',
        'learning rate is too high',
        'alpha is too large',
        'alpha too large',
        'alpha is too big',
        'alpha too big',
        'overshoot',
      ],
      keywords: ['learning', 'rate', 'big'],
      answer:
        'Updates jump past the minimum. Page 2 warns that a large alpha can overshoot it, or even diverge, so the loss bounces around instead of settling.',
      boardAddendum: {
        minStep: 3,
        text: 'With this curve, any alpha above 1 would make the dot land farther from w = 3 on every step.',
      },
      cite: { page: 2, highlightId: 'lr_tradeoff' },
    },
    {
      id: 'lr_too_small',
      phrases: ['learning rate is too small', 'learning rate too small', 'alpha is too small', 'alpha too small'],
      keywords: ['learning', 'rate', 'small'],
      answer:
        'Training still heads downhill, but each update is tiny, so it takes many more steps to get there. Page 2 calls this the slow-convergence side of the tradeoff.',
      cite: { page: 2, highlightId: 'lr_tradeoff' },
    },
    {
      id: 'steps_smaller',
      phrases: ['steps get smaller', 'why smaller', 'why do the steps', 'slow down near'],
      keywords: ['steps', 'smaller'],
      answer:
        'Each step is alpha times the gradient, and the gradient shrinks as the curve flattens near the minimum. Page 3 shows this: the step sizes go 2.4, 0.48, 0.096.',
      cite: { page: 3, highlightId: 'worked_paragraph' },
    },
    {
      id: 'what_is_loss',
      phrases: ['what is a loss', 'what is the loss', "what's a loss", 'what is loss', 'loss function mean'],
      keywords: ['loss', 'function'],
      answer:
        'A loss function is a single score for how wrong the model is, and lower is better. Page 1 introduces it as the thing gradient descent minimizes.',
      cite: { page: 1, highlightId: 'definition' },
    },
    {
      id: 'what_is_gradient',
      phrases: ['what is a gradient', 'what is the gradient', "what's a gradient", 'what does the gradient'],
      keywords: ['what', 'gradient'],
      answer:
        'The gradient is the local slope of the loss. On page 2 it points in the direction of steepest increase, and its size says how steep the slope is.',
      cite: { page: 2, highlightId: 'update_rule' },
    },
    {
      id: 'when_stop',
      phrases: ['when do we stop', 'when to stop', 'when does it stop', 'how do we know when'],
      keywords: ['when', 'stop'],
      answer: 'Page 2 says to stop when the gradient is close to zero or when the loss stops improving.',
      cite: { page: 2 },
    },
  ],
  selectionExplanations: [
    {
      page: 1,
      passage: 'Gradient descent minimizes a loss function by moving opposite the slope.',
      explanation:
        'This is the whole method in one line. Measure which way the loss rises at your current position, then step the other way so it falls.',
      highlightId: 'definition',
    },
    {
      page: 1,
      passage: 'Picture the loss landscape as a valley. You never need a map of the whole valley, only the local slope.',
      explanation:
        'The valley is an analogy for the loss curve. The method only ever looks at the slope where you are standing, which keeps each step cheap.',
    },
    {
      page: 2,
      passage: 'w_next = w_current - alpha * gradient',
      explanation:
        'Take your current weight and subtract a scaled copy of the gradient. The gradient gives the uphill direction, and alpha decides how far to move the other way.',
      highlightId: 'update_rule',
    },
    {
      page: 2,
      passage: 'Here alpha is the learning rate. It scales every update, which sets how far each step travels.',
      explanation:
        'Alpha is a setting you choose, not something the model learns. Doubling it doubles the length of every step.',
      highlightId: 'learning_rate',
    },
    {
      page: 2,
      passage: 'Choosing alpha is a tradeoff between slow convergence and overshooting',
      explanation:
        'Small alpha is safe but slow. Large alpha moves quickly but can jump past the minimum. A good value sits between the two.',
      highlightId: 'lr_tradeoff',
    },
    {
      page: 3,
      passage: 'L(w) = (w - 3)^2 gradient = 2(w - 3) alpha = 0.4, starting at w = 0',
      explanation:
        'This is the setup for the example: a bowl-shaped loss with its minimum at w = 3, its derivative, and the step size. Starting at w = 0 gives a gradient of -6.',
    },
    {
      page: 3,
      passage: 'The first update gives w_next = 0 - 0.4 * (-6) = 2.4.',
      explanation:
        'Plug into the update rule: 0 minus 0.4 times -6. Subtracting a negative moves right, landing at 2.4, close to the minimum at 3.',
    },
    {
      page: 3,
      passage:
        'The loss falls from 9 to 0.36, then 0.0144, then 0.000576. Each update shrinks the distance to the minimum by the same factor, so the steps get smaller as the slope flattens.',
      explanation:
        'Each update leaves one fifth of the remaining distance to w = 3: 3, 0.6, 0.12, 0.024. The loss is that distance squared, so it falls even faster.',
      highlightId: 'worked_paragraph',
    },
  ],
  pageExplanations: {
    1: 'Page 1 sets up the intuition: a loss function scores how wrong the model is, and gradient descent walks downhill on that score using only the local slope.',
    2: 'Page 2 gives the algorithm: compute the gradient, subtract alpha times it from the weight, and repeat. Alpha trades slow convergence against overshooting.',
    3: 'Page 3 works an example on L(w) = (w - 3)^2 with alpha = 0.4, where w moves from 0 to 2.4, 2.88 and 2.976 as the loss falls toward zero.',
  },
  quiz: {
    question: 'If α is too large, what can happen?',
    choices: [
      {
        id: 'overshoot',
        label: 'Overshoot the minimum',
        correct: true,
        explanation:
          "That's right. Too large a step jumps past the minimum, and page 2 warns it can even diverge. Lesson complete, so ask me anything about these notes.",
      },
      {
        id: 'faster',
        label: 'Always converge faster',
        correct: false,
        explanation:
          'Not quite. Bigger steps only help up to a point. Page 2 warns that too large a step overshoots the minimum and can even diverge. Lesson complete, so ask me anything about these notes.',
      },
      {
        id: 'zero',
        label: 'Gradient becomes zero immediately',
        correct: false,
        explanation:
          'Not quite. The gradient depends on where you are, not on alpha. Page 2 warns that too large a step overshoots the minimum instead. Lesson complete, so ask me anything about these notes.',
      },
    ],
  },
  videoId: 'IHZwWFHWa-w',
  videoTitle: 'Gradient descent, how neural networks learn',
  videoSource: '3Blue1Brown',
};
