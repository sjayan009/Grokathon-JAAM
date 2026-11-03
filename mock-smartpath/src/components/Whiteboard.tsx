import type { WhiteboardStep } from '@smartpath/tutor-core';
import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ALPHA, iterations } from '../demo/gradientDescentLesson';

export interface WhiteboardHandle {
  drawStep(step: WhiteboardStep): Promise<void>;
  setPaused(paused: boolean): void;
  cancel(): void;
  reset(): void;
  currentStep(): WhiteboardStep | null;
}

const LAST_STEP = 3;

const toX = (w: number) => 70 + ((w + 0.6) / 7.2) * 380;
const toY = (loss: number) => 380 - loss * 25.4;
const loss = (w: number) => (w - 3) ** 2;

const CURVE = Array.from({ length: 121 }, (_, i) => {
  const w = -0.6 + (i / 120) * 7.2;
  return `${i === 0 ? 'M' : 'L'} ${toX(w).toFixed(1)} ${toY(loss(w)).toFixed(1)}`;
}).join(' ');

const hopPath = (from: number, to: number) => {
  const a = { x: toX(from), y: toY(loss(from)) };
  const b = { x: toX(to), y: toY(loss(to)) };
  const lift = Math.max(10, Math.abs(b.x - a.x) * 0.22);
  const control = { x: (a.x + b.x) / 2 + lift * 0.4, y: (a.y + b.y) / 2 - lift };
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
};

const formatLoss = (value: number) => String(value);

/** Web Animations give us pause, cancel and a finished promise for free. */
class Timeline {
  paused = false;
  private running = new Set<Animation>();
  private speed: number;

  constructor(speed: number) {
    this.speed = speed;
  }

  async play(el: Element, keyframes: Keyframe[], ms: number, easing = 'ease-in-out') {
    const animation = el.animate(keyframes, { duration: ms / this.speed, easing, fill: 'forwards' });
    this.running.add(animation);
    if (this.paused) animation.pause();
    await animation.finished;
    this.running.delete(animation);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    for (const animation of this.running) {
      if (paused) animation.pause();
      else animation.play();
    }
  }

  cancelRunning() {
    for (const animation of this.running) animation.cancel();
    this.running.clear();
  }
}

export function Whiteboard({ ref, speed, onClose }: { ref: Ref<WhiteboardHandle>; speed: number; onClose(): void }) {
  const svg = useRef<SVGSVGElement>(null);
  const timeline = useRef(new Timeline(speed));
  const drawn = useRef<number>(-1);
  const [displayStep, setDisplayStep] = useState(-1);
  const [busy, setBusy] = useState(false);

  const part = useCallback((name: string) => {
    const el = svg.current?.querySelector(`[data-wb="${name}"]`);
    if (!el) throw new Error(`Whiteboard part "${name}" is missing`);
    return el;
  }, []);

  const stroke = useCallback(
    (name: string, ms: number) =>
      timeline.current.play(part(name), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], ms),
    [part],
  );

  const write = useCallback(
    async (name: string, ms: number) => {
      const el = part(name);
      await timeline.current.play(
        el,
        [{ clipPath: 'inset(-20% 100% -20% -5%)' }, { clipPath: 'inset(-20% -5% -20% -5%)' }],
        ms,
        'linear',
      );
      el.setAttribute('data-drawn', 'true');
    },
    [part],
  );

  const pop = useCallback(
    (name: string, x: number, y: number) =>
      timeline.current.play(
        part(name),
        [
          { opacity: 0, transform: `translate(${x}px, ${y}px) scale(0.2)` },
          { opacity: 1, transform: `translate(${x}px, ${y}px) scale(1)` },
        ],
        260,
        'ease-out',
      ),
    [part],
  );

  const runStep = useCallback(
    async (step: number) => {
      if (step === 0) {
        await stroke('axis-x', 650);
        await stroke('axis-y', 450);
        await write('label-w', 260);
        await write('label-loss', 300);
      } else if (step === 1) {
        await stroke('curve', 1500);
        await write('label-min', 420);
      } else if (step === 2) {
        await write('eq-loss', 720);
        await write('eq-grad', 720);
        await write('eq-alpha', 420);
        await pop('dot', toX(0), toY(loss(0)));
        await write('label-start', 300);
        await stroke('first-arrow', 480);
      } else {
        await write('table-head', 360);
        await write('row-0', 300);
        const dot = part('dot');
        for (let i = 1; i < iterations.length; i += 1) {
          const from = iterations[i - 1].w;
          const to = iterations[i].w;
          await pop(`ghost-${i - 1}`, toX(from), toY(loss(from)));
          await stroke(`hop-${i}`, 420);
          const frames: Keyframe[] = Array.from({ length: 25 }, (_, f) => {
            const w = from + ((to - from) * f) / 24;
            return { opacity: 1, transform: `translate(${toX(w)}px, ${toY(loss(w))}px)` };
          });
          await timeline.current.play(dot, frames, 760 - i * 90);
          await write(`row-${i}`, 300);
        }
      }
    },
    [part, pop, stroke, write],
  );

  const drawStep = useCallback(
    async (step: number) => {
      setBusy(true);
      try {
        for (let s = drawn.current + 1; s <= step; s += 1) {
          await runStep(s);
          drawn.current = s;
          setDisplayStep(s);
        }
      } finally {
        setBusy(false);
      }
    },
    [runStep],
  );

  const reset = useCallback(() => {
    timeline.current.cancelRunning();
    svg.current?.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    svg.current?.querySelectorAll('[data-drawn]').forEach((el) => el.removeAttribute('data-drawn'));
    drawn.current = -1;
    setDisplayStep(-1);
    setBusy(false);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      drawStep,
      reset,
      setPaused: (paused) => timeline.current.setPaused(paused),
      cancel: () => timeline.current.cancelRunning(),
      currentStep: () => (drawn.current < 0 ? null : (drawn.current as WhiteboardStep)),
    }),
    [drawStep, reset],
  );

  const replay = () => {
    const target = Math.max(drawn.current, 0);
    reset();
    void drawStep(target).catch(() => undefined);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface" data-target-id="whiteboard" aria-label="Whiteboard">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-[13px]">
        <span className="font-medium text-ink">Whiteboard</span>
        <span className="text-ink-soft">Worked example</span>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" className="rounded px-2 py-1 text-ink-soft hover:bg-canvas disabled:opacity-40" disabled={busy} onClick={replay}>
            Replay
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-ink-soft hover:bg-canvas disabled:opacity-40"
            disabled={busy || displayStep >= LAST_STEP}
            onClick={() => void drawStep(drawn.current + 1).catch(() => undefined)}
          >
            Next
          </button>
          <button type="button" aria-label="Close whiteboard" className="grid h-7 w-7 place-items-center rounded text-ink-soft hover:bg-canvas" onClick={onClose}>
            ×
          </button>
        </span>
      </header>
      <div className="whiteboard-surface min-h-0 flex-1 p-2">
        <svg ref={svg} viewBox="0 0 720 440" className="h-full w-full" role="img" aria-label="Gradient descent on the curve L of w" data-testid="whiteboard-svg" data-step={displayStep}>
          <path data-wb="axis-x" pathLength={1} className="wb-stroke wb-ink" d="M 50 380 L 462 380 m -12 -7 l 12 7 l -12 7" />
          <path data-wb="axis-y" pathLength={1} className="wb-stroke wb-ink" d="M 70 400 L 70 28 m -7 12 l 7 -12 l 7 12" />
          <text data-wb="label-w" x="452" y="408" className="wb-write wb-text wb-small">w</text>
          <text data-wb="label-loss" x="82" y="34" className="wb-write wb-text wb-small">L(w)</text>

          <path data-wb="curve" pathLength={1} className="wb-stroke wb-curve" d={CURVE} />
          <text data-wb="label-min" x={toX(3) - 38} y="406" className="wb-write wb-text wb-small">min, w = 3</text>

          <text data-wb="eq-loss" x="484" y="62" className="wb-write wb-text">L(w) = (w – 3)²</text>
          <text data-wb="eq-grad" x="484" y="102" className="wb-write wb-text">dL/dw = 2(w – 3)</text>
          <text data-wb="eq-alpha" x="484" y="142" className="wb-write wb-text">α = {ALPHA}</text>

          <text data-wb="label-start" x={toX(0) + 14} y={toY(9) - 8} className="wb-write wb-text wb-small wb-red">w = 0, slope = –6</text>
          <path
            data-wb="first-arrow"
            pathLength={1}
            className="wb-stroke wb-arrow"
            d={`M ${toX(0) + 12} ${toY(9) + 10} L ${toX(0) + 52} ${toY(9) + 52} m -13 -2 l 13 2 l -3 -13`}
          />

          {iterations.slice(0, -1).map((row, i) => (
            <circle key={row.k} data-wb={`ghost-${i}`} r="4.5" className="wb-ghost" />
          ))}
          {iterations.slice(1).map((row, i) => (
            <path key={row.k} data-wb={`hop-${row.k}`} pathLength={1} className="wb-stroke wb-hop" d={hopPath(iterations[i].w, row.w)} />
          ))}
          <circle data-wb="dot" r="8" className="wb-dot" />

          <g className="wb-table">
            <text data-wb="table-head" x="484" y="196" className="wb-write wb-text wb-small wb-muted">
              <tspan x="478">step</tspan>
              <tspan x="530">w</tspan>
              <tspan x="598">L(w)</tspan>
            </text>
            {iterations.map((row, i) => (
              <text key={row.k} data-wb={`row-${i}`} data-testid={`wb-row-${i}`} y={232 + i * 38} className="wb-write wb-text">
                <tspan x="486">{row.k}</tspan>
                <tspan x="530">{row.w}</tspan>
                <tspan x="598">{formatLoss(row.loss)}</tspan>
              </text>
            ))}
          </g>
        </svg>
      </div>
    </section>
  );
}
