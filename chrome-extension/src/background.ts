import { TOGGLE_COMPANION, type RuntimeRequest, type RuntimeResponse } from './messages.ts';

const PROXY_URL = 'http://localhost:8787';

async function postJson(path: string, body: unknown) {
  const response = await fetch(`${PROXY_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Proxy returned ${response.status}`);
  return response.json();
}

async function handle(message: RuntimeRequest): Promise<RuntimeResponse> {
  switch (message.kind) {
    case 'health': {
      const response = await fetch(`${PROXY_URL}/health`);
      if (!response.ok) return { ok: true, live: false };
      const { live } = (await response.json()) as { live?: boolean };
      return { ok: true, live: live === true };
    }
    case 'ask':
      return { ok: true, ...(await postJson('/ask', message.request)) };
    case 'classify':
      return { ok: true, ...(await postJson('/classify', { text: message.text })) };
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(message)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: String(error) } satisfies RuntimeResponse));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void chrome.tabs.sendMessage(tab.id, { type: TOGGLE_COMPANION }).catch(() => undefined);
});
