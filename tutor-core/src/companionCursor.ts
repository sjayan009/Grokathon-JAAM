import { abortError } from './clock.ts';
import type { CursorPort } from './lessonRunner.ts';
import type { Rect } from './protocol.ts';

const OFFSET = { x: 22, y: 18 };
const FOLLOW_EASE = 0.14;

const STATUS_LABEL = { follow: 'Following', working: 'Working', paused: 'Paused' } as const;

const STYLE = `
  :host { all: initial; }
  .root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; overflow: hidden; }
  .cursor { position: absolute; left: 0; top: 0; width: 0; height: 0; will-change: transform; }
  .arrow { position: absolute; left: -3px; top: -2px; filter: drop-shadow(0 2px 3px rgb(0 0 0 / .35)) drop-shadow(0 0 10px rgb(255 90 54 / .75)); }
  .bubble { position: absolute; left: 24px; top: 24px; padding: 3px 9px; border-radius: 999px; background: #1b1f33;
    color: #fff; font: 600 11px/1.4 system-ui, sans-serif; white-space: nowrap; opacity: .92; }
  .bubble::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%;
    background: #ff5a36; vertical-align: 1px; }
  .cursor[data-status='paused'] .bubble::before { background: #ffc53d; }
  .cursor[data-status='working'] .bubble::before { animation: pulse 1s ease-in-out infinite; }
  .ripple { position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border-radius: 50%;
    border: 3px solid #ff5a36; opacity: 0; }
  .ripple.on { animation: ripple 420ms ease-out; }
  @keyframes ripple { from { transform: scale(.2); opacity: 1; } to { transform: scale(1.1); opacity: 0; } }
  @keyframes pulse { 50% { opacity: .3; } }
`;

const ARROW = `<svg class="arrow" width="30" height="32" viewBox="0 0 30 32" aria-hidden="true">
  <path d="M4 3l21 12.5-9.2 2.3-4.4 8.7z" fill="#ff5a36" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg>`;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Tween {
  from: { x: number; y: number };
  to: { x: number; y: number };
  control: { x: number; y: number };
  duration: number;
  elapsed: number;
  ease: (t: number) => number;
  done(): void;
}

/** A page overlay only. It never touches the real pointer or takes its clicks. */
export class CompanionCursor implements CursorPort {
  private host = document.createElement('div');
  private cursorEl!: HTMLDivElement;
  private bubble!: HTMLDivElement;
  private ripple!: HTMLDivElement;
  private position = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.4 };
  private pointer: { x: number; y: number } | null = null;
  private tween: Tween | null = null;
  private held = false;
  private paused = false;
  private frame = 0;
  private lastTime = performance.now();
  private speed: number;

  constructor(speed: number) {
    this.speed = speed;
    this.host.id = 'smartpath-companion-cursor';
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${STYLE}</style><div class="root"><div class="cursor" data-status="follow">
      ${ARROW}<div class="ripple"></div><div class="bubble">${STATUS_LABEL.follow}</div></div></div>`;
    this.cursorEl = shadow.querySelector<HTMLDivElement>('.cursor')!;
    this.bubble = shadow.querySelector<HTMLDivElement>('.bubble')!;
    this.ripple = shadow.querySelector<HTMLDivElement>('.ripple')!;
    document.documentElement.append(this.host);

    window.addEventListener('pointermove', this.onPointer, { passive: true, capture: true });
    this.frame = requestAnimationFrame(this.tick);
  }

  setStatus(status: 'follow' | 'working' | 'paused') {
    this.cursorEl.dataset.status = status;
    this.bubble.textContent = STATUS_LABEL[status];
    if (status === 'working') this.held = true;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  release() {
    this.held = false;
    this.cancelTween();
  }

  setVisible(visible: boolean) {
    this.host.style.display = visible ? '' : 'none';
  }

  moveTo(x: number, y: number, signal: AbortSignal): Promise<void> {
    const distance = Math.hypot(x - this.position.x, y - this.position.y);
    const duration = Math.min(1100, Math.max(420, distance * 1.15)) / this.speed;
    // A slight arc reads as a hand moving, not a straight-line tween.
    const bend = Math.min(90, distance * 0.14);
    const angle = Math.atan2(y - this.position.y, x - this.position.x) - Math.PI / 2;
    const control = {
      x: (this.position.x + x) / 2 + Math.cos(angle) * bend,
      y: (this.position.y + y) / 2 + Math.sin(angle) * bend,
    };
    return this.animate({ x, y }, control, duration, easeInOut, signal);
  }

  async sweep(rects: Rect[], signal: AbortSignal) {
    for (const [i, rect] of rects.entries()) {
      const base = rect.y + rect.height;
      if (i > 0) await this.moveDirect(rect.x, base, 140 / this.speed, signal);
      const duration = Math.min(760, Math.max(280, rect.width * 1.1)) / this.speed;
      await this.moveDirect(rect.x + rect.width, base, duration, signal);
    }
  }

  async click(signal: AbortSignal) {
    this.ripple.classList.remove('on');
    void this.ripple.offsetWidth;
    this.ripple.classList.add('on');
    await this.wait(240 / this.speed, signal);
  }

  /** Keeps the cursor on a target that moved, e.g. after the user scrolled. */
  nudgeTo(x: number, y: number) {
    if (this.tween || !this.held) return;
    this.position = { x, y };
    this.render();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('pointermove', this.onPointer, { capture: true });
    this.host.remove();
  }

  private moveDirect(x: number, y: number, duration: number, signal: AbortSignal) {
    const control = { x: (this.position.x + x) / 2, y: (this.position.y + y) / 2 };
    return this.animate({ x, y }, control, duration, (t) => t, signal);
  }

  private animate(
    to: { x: number; y: number },
    control: { x: number; y: number },
    duration: number,
    ease: (t: number) => number,
    signal: AbortSignal,
  ): Promise<void> {
    this.cancelTween();
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        this.tween = null;
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.tween = {
        from: { ...this.position },
        to,
        control,
        duration: Math.max(1, duration),
        elapsed: 0,
        ease,
        done() {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
      };
    });
  }

  private wait(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(abortError());
        },
        { once: true },
      );
    });
  }

  private cancelTween() {
    this.tween?.done();
    this.tween = null;
  }

  private onPointer = (event: PointerEvent) => {
    this.pointer = { x: event.clientX, y: event.clientY };
  };

  private tick = (now: number) => {
    const dt = Math.min(64, now - this.lastTime);
    this.lastTime = now;

    if (this.tween) {
      if (!this.paused) {
        const tween = this.tween;
        tween.elapsed += dt;
        const raw = Math.min(1, tween.elapsed / tween.duration);
        const t = tween.ease(raw);
        const u = 1 - t;
        this.position = {
          x: u * u * tween.from.x + 2 * u * t * tween.control.x + t * t * tween.to.x,
          y: u * u * tween.from.y + 2 * u * t * tween.control.y + t * t * tween.to.y,
        };
        if (raw >= 1) {
          this.tween = null;
          tween.done();
        }
      }
    } else if (!this.held && this.pointer) {
      const target = { x: this.pointer.x + OFFSET.x, y: this.pointer.y + OFFSET.y };
      this.position.x += (target.x - this.position.x) * FOLLOW_EASE;
      this.position.y += (target.y - this.position.y) * FOLLOW_EASE;
    }

    this.render();
    this.frame = requestAnimationFrame(this.tick);
  };

  private render() {
    this.cursorEl.style.transform = `translate3d(${this.position.x.toFixed(1)}px, ${this.position.y.toFixed(1)}px, 0)`;
  }
}
