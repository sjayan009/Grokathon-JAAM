/** `?tutorSpeed=N` shortens timers for automated runs. Defaults to real time. */
export function getSpeed(): number {
  const value = Number(new URLSearchParams(globalThis.location?.search ?? '').get('tutorSpeed'));
  return value >= 1 && value <= 100 ? value : 1;
}

export function abortError() {
  return new DOMException('Cancelled', 'AbortError');
}

export function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Every lesson timer runs on this clock, so Pause freezes timeouts, narration
 * fallbacks and beats together instead of letting them expire underneath it.
 */
export class PausableClock {
  paused = false;
  readonly speed: number;

  constructor(speed = 1) {
    this.speed = speed;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      let remaining = ms / this.speed;
      let last = performance.now();
      let timer: ReturnType<typeof setTimeout>;

      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      const tick = () => {
        const now = performance.now();
        if (!this.paused) remaining -= now - last;
        last = now;
        if (remaining <= 0) {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        } else {
          timer = setTimeout(tick, Math.min(40, remaining));
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(tick, Math.min(40, remaining));
    });
  }
}
