const MODULES = [
  { id: 'l6', title: 'Lecture 6: Search', done: true },
  { id: 'l7', title: 'Lecture 7: Probability', done: true },
  { id: 'l8', title: 'Lecture 8: Optimization', done: false },
  { id: 'l9', title: 'Lecture 9: Neural Networks', done: false },
];

const CONCEPTS = [
  { label: 'Loss', x: 30, y: 22 },
  { label: 'Gradient', x: 116, y: 22 },
  { label: 'Learning rate', x: 74, y: 76 },
];

function Logo() {
  return (
    <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand text-white">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 14c3 0 3-5 6-5s3-5 6-5" />
        <circle cx="3" cy="14" r="1.2" fill="currentColor" />
        <circle cx="15" cy="4" r="1.2" fill="currentColor" />
      </svg>
    </span>
  );
}

export function CourseSidebar({ collapsed, lessonComplete }: { collapsed: boolean; lessonComplete: boolean }) {
  if (collapsed) {
    return (
      <nav className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-line bg-surface py-3" aria-label="Course">
        <Logo />
        <span className="mt-1 rounded-md bg-brand/10 px-1.5 py-1 text-[11px] font-semibold text-brand" title="Lecture 8: Optimization">
          L8
        </span>
      </nav>
    );
  }

  return (
    <nav className="flex w-60 shrink-0 flex-col gap-5 overflow-auto border-r border-line bg-surface p-3" aria-label="Course">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight">Smart Path</span>
      </div>

      <div>
        <p className="text-xs font-medium text-ink-soft">Course</p>
        <p className="mt-0.5 text-[15px] font-semibold leading-snug">CS 3600 — Intro to AI</p>
      </div>

      <ul className="flex flex-col gap-0.5 text-[13px]">
        {MODULES.map((module) => {
          const current = module.id === 'l8';
          const done = module.done || (current && lessonComplete);
          return (
            <li key={module.id}>
              <span className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${current ? 'bg-brand/10 font-medium text-brand' : 'text-ink-soft'}`}>
                <span aria-hidden className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${done ? 'bg-good text-white' : 'border border-line'}`}>
                  {done ? '✓' : ''}
                </span>
                {module.title}
              </span>
              {current && (
                <ul className="ml-8 mt-1 text-ink">
                  <li className="truncate rounded px-2 py-1 font-medium">Gradient Descent Notes</li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-auto rounded-lg border border-line p-2.5">
        <p className="text-xs font-medium text-ink-soft">Concept map</p>
        <svg viewBox="0 0 196 100" className="mt-1 w-full" role="img" aria-label="Loss, gradient and learning rate connect to gradient descent">
          <g stroke="var(--color-line)" strokeWidth="1.5">
            <line x1="52" y1="28" x2="98" y2="54" />
            <line x1="138" y1="28" x2="98" y2="54" />
            <line x1="98" y1="54" x2="98" y2="78" />
          </g>
          {CONCEPTS.map((concept) => (
            <g key={concept.label}>
              <rect x={concept.x - 26} y={concept.y - 12} width={concept.label.length * 6.2 + 16} height="22" rx="11" fill="var(--color-canvas)" stroke="var(--color-line)" />
              <text x={concept.x - 18} y={concept.y + 3} fontSize="10.5" fill="var(--color-ink)">
                {concept.label}
              </text>
            </g>
          ))}
          <circle cx="98" cy="54" r="5" fill="var(--color-brand)" />
        </svg>
      </div>
    </nav>
  );
}
