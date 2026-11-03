import { ALLOWED_ORIGIN, mountCompanion, type CompanionHandle, type LiveAi } from '@smartpath/tutor-core';
import { lesson } from '../../mock-smartpath/src/demo/gradientDescentLesson.ts';
import { TOGGLE_COMPANION, type RuntimeRequest, type RuntimeResponse } from './messages.ts';

const SLOT_WAIT_MS = 5000;
const HIDDEN_KEY = 'companionHidden';

async function call(request: RuntimeRequest) {
  const response = (await chrome.runtime.sendMessage(request)) as RuntimeResponse;
  if (!response.ok) throw new Error(response.error);
  return response;
}

const liveAi: LiveAi = {
  health: async () => (await call({ kind: 'health' })).live === true,
  async ask(request) {
    const { answer, citedPage } = await call({ kind: 'ask', request });
    return { answer: answer ?? '', citedPage: citedPage ?? null };
  },
  classify: async (text) => (await call({ kind: 'classify', text })).intent ?? 'UNKNOWN',
};

function waitForSlot(): Promise<HTMLElement | null> {
  const find = () => document.querySelector<HTMLElement>('[data-companion-slot]');
  return new Promise((resolve) => {
    const slot = find();
    if (slot) {
      resolve(slot);
      return;
    }
    const finish = (found: HTMLElement | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(found);
    };
    const observer = new MutationObserver(() => {
      const found = find();
      if (found) finish(found);
    });
    const timer = setTimeout(() => finish(null), SLOT_WAIT_MS);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function main() {
  if (location.origin !== ALLOWED_ORIGIN) return;
  const slot = await waitForSlot();
  if (!slot) return;

  const handle: CompanionHandle = mountCompanion({ slot, lesson, client: 'extension', ai: liveAi });

  const stored = await chrome.storage.local.get(HIDDEN_KEY);
  let hidden = stored[HIDDEN_KEY] === true;
  if (hidden) handle.setVisible(false);

  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message.type !== TOGGLE_COMPANION) return;
    hidden = !hidden;
    handle.setVisible(!hidden);
    void chrome.storage.local.set({ [HIDDEN_KEY]: hidden });
  });
}

void main();
