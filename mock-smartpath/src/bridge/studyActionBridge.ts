import {
  ALLOWED_ORIGIN,
  CHANNEL,
  isTrustedEvent,
  validateStudyAction,
  type AckPayload,
  type AppEvent,
  type CompanionClient,
  type StudyAction,
  type WireMessage,
} from '@smartpath/tutor-core';

export type ActionHandler = (action: StudyAction) => Promise<AckPayload | void>;

function post(message: WireMessage) {
  window.postMessage(message, ALLOWED_ORIGIN);
}

export function emitAppEvent(event: AppEvent) {
  post({ channel: CHANNEL, kind: 'event', event });
}

/** App side of the bridge: validates every command and always acks it. */
export function startBridge(options: {
  documentId: string;
  handle: ActionHandler;
  onHello: (client: CompanionClient) => void;
}): () => void {
  const listener = (event: MessageEvent) => {
    if (!isTrustedEvent(event)) return;
    const message = event.data as WireMessage;

    if (message.kind === 'hello') {
      options.onHello(message.client);
      post({ channel: CHANNEL, kind: 'ready', documentId: options.documentId });
      return;
    }
    if (message.kind !== 'command') return;

    const { requestId } = message;
    const action = validateStudyAction(message.action);
    if (!action) {
      post({ channel: CHANNEL, kind: 'ack', requestId, ok: false, error: 'Action rejected by allowlist' });
      return;
    }
    options
      .handle(action)
      .then((payload) => post({ channel: CHANNEL, kind: 'ack', requestId, ok: true, ...payload }))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        post({ channel: CHANNEL, kind: 'ack', requestId, ok: false, error: text });
      });
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
