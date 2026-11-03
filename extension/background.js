import { isStudyOrigin, isStudyUrl } from './lib/bridge.js';

const BADGE_COLOR = '#0f766e';

function enablePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(enablePanel);
chrome.runtime.onStartup.addListener(enablePanel);

async function remember(tabId, patch) {
  const stored = await chrome.storage.session.get('runs');
  const runs = { ...(stored.runs || {}) };
  const key = String(tabId);
  runs[key] = { ...(runs[key] || {}), ...patch, updatedAt: Date.now() };
  await chrome.storage.session.set({ runs });
  return runs[key];
}

async function forget(tabId) {
  const stored = await chrome.storage.session.get('runs');
  const runs = { ...(stored.runs || {}) };
  delete runs[String(tabId)];
  await chrome.storage.session.set({ runs });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  forget(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading' && tab.url && !isStudyUrl(tab.url)) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    forget(tabId).catch(() => {});
  }
});

async function forwardControl(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isStudyUrl(tab.url || '')) {
    return { ok: false, error: 'Open the local SmartPath study tab first' };
  }
  let status;
  try {
    status = await chrome.tabs.sendMessage(tab.id, { type: 'get_status' });
  } catch {
    return { ok: false, error: 'Could not connect to content script. Reload localhost:5173.' };
  }
  if (!status?.studyTab || !isStudyOrigin(status.origin)) {
    return { ok: false, error: 'This tab is not the SmartPath study workspace' };
  }
  const stored = await chrome.storage.session.get('runs');
  const known = stored.runs?.[String(tab.id)];
  if (message.command !== 'stop' && known?.documentId && status.documentId && known.documentId !== status.documentId) {
    return { ok: false, error: 'Document changed. Stop and start again.' };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'control',
      command: message.command,
      prompt: typeof message.prompt === 'string' ? message.prompt : '',
      tabId: tab.id,
    });
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'content_hello' || message?.type === 'smartpath_status') {
    const tabId = sender.tab?.id;
    const href = sender.tab?.url || message.href || message.state?.href || '';
    if (!tabId || !isStudyUrl(href)) {
      sendResponse({ ok: false, error: 'not a study tab' });
      return undefined;
    }
    const origin = message.origin || message.state?.origin || '';
    if (origin && !isStudyOrigin(origin)) {
      sendResponse({ ok: false, error: 'origin rejected' });
      return undefined;
    }
    const patch = message.type === 'content_hello'
      ? { origin: message.origin, href, studyTab: true, phase: 'observing' }
      : { ...(message.state || {}), href, studyTab: true };
    remember(tabId, patch).then(() => {
      chrome.action.setBadgeText({ text: 'ON', tabId }).catch(() => {});
      sendResponse({ ok: true, tabId });
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'get_detection') {
    Promise.all([chrome.tabs.query({}), chrome.storage.session.get('runs')]).then(([tabs, stored]) => {
      const runs = stored.runs || {};
      const studyTabs = tabs.filter((tab) => isStudyUrl(tab.url || '')).map((tab) => ({
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        windowId: tab.windowId,
        run: runs[String(tab.id)] || null,
      }));
      sendResponse({ ok: true, studyTabs });
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'control_from_panel') {
    forwardControl(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return undefined;
});

chrome.commands.onCommand.addListener((command) => {
  const mapped = command === 'stop-lesson' ? 'stop' : command === 'pause-lesson' ? 'pause' : null;
  if (!mapped) return;
  forwardControl({ command: mapped, prompt: '' }).catch(() => {});
});
