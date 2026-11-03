import { abortError, type PausableClock } from './clock.ts';
import {
  ALLOWED_ORIGIN,
  CHANNEL,
  isTrustedEvent,
  type AckPayload,
  type AppEvent,
  type CompanionClient,
  type StudyAction,
  type WireMessage,
} from './protocol.ts';

const DEFAULT_TIMEOUT_MS = 8000;
const HELLO_INTERVAL_MS = 250;
const HELLO_ATTEMPTS = 40;

export interface SendOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Transport {
  send(action: StudyAction, options?: SendOptions): Promise<AckPayload>;
}

interface Pending {
  resolve(payload: AckPayload): void;
  reject(error: Error): void;
}

/** Companion side of the bridge. Works the same in the extension and embedded. */
export class BridgeClient implements Transport {
  private pending = new Map<string, Pending>();
  private eventListeners = new Set<(event: AppEvent) => void>();
  private ready = false;
  private readyListeners = new Set<() => void>();
  private helloTimer: ReturnType<typeof setInterval> | undefined;
  private nextId = 0;
  private client: CompanionClient;
  private clock: PausableClock;

  constructor(client: CompanionClient, clock: PausableClock) {
    this.client = client;
    this.clock = clock;
    window.addEventListener('message', this.onMessage);
  }

  /** The content script can load before React, so keep saying hello. */
  connect(onGiveUp: () => void) {
    const hello = () => this.post({ channel: CHANNEL, kind: 'hello', client: this.client });
    let attempts = 0;
    hello();
    this.helloTimer = setInterval(() => {
      if (this.ready) {
        clearInterval(this.helloTimer);
        return;
      }
      attempts += 1;
      if (attempts >= HELLO_ATTEMPTS) {
        clearInterval(this.helloTimer);
        onGiveUp();
        return;
      }
      hello();
    }, HELLO_INTERVAL_MS);
  }

  onReady(listener: () => void) {
    if (this.ready) listener();
    else this.readyListeners.add(listener);
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  send(action: StudyAction, options: SendOptions = {}): Promise<AckPayload> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
    if (signal?.aborted) return Promise.reject(abortError());

    this.nextId += 1;
    const requestId = `${this.client}-${this.nextId}`;
    const stopTimer = new AbortController();

    return new Promise<AckPayload>((resolve, reject) => {
      const finish = () => {
        this.pending.delete(requestId);
        stopTimer.abort();
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        finish();
        reject(abortError());
      };

      this.pending.set(requestId, {
        resolve(payload) {
          finish();
          resolve(payload);
        },
        reject(error) {
          finish();
          reject(error);
        },
      });

      signal?.addEventListener('abort', onAbort, { once: true });
      this.clock
        .sleep(timeoutMs, stopTimer.signal)
        .then(() => {
          finish();
          reject(new Error(`${action.type} timed out`));
        })
        .catch(() => undefined);

      this.post({ channel: CHANNEL, kind: 'command', requestId, action });
    });
  }

  destroy() {
    clearInterval(this.helloTimer);
    window.removeEventListener('message', this.onMessage);
    for (const pending of this.pending.values()) pending.reject(abortError());
    this.pending.clear();
  }

  private post(message: WireMessage) {
    window.postMessage(message, ALLOWED_ORIGIN);
  }

  private onMessage = (event: MessageEvent) => {
    if (!isTrustedEvent(event)) return;
    const message = event.data as WireMessage;

    if (message.kind === 'ready') {
      this.ready = true;
      clearInterval(this.helloTimer);
      for (const listener of this.readyListeners) listener();
      this.readyListeners.clear();
    } else if (message.kind === 'ack') {
      // A late ack after Stop has no pending entry, so it is dropped here.
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      if (message.ok) {
        const { bounds, rects, fallback, context } = message;
        pending.resolve({ bounds, rects, fallback, context });
      } else {
        pending.reject(new Error(message.error ?? 'Action failed'));
      }
    } else if (message.kind === 'event') {
      for (const listener of this.eventListeners) listener(message.event);
    }
  };
}
