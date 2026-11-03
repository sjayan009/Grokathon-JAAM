const statusEl = document.getElementById('status');
const phaseEl = document.getElementById('phase');
const logEl = document.getElementById('log');
const promptEl = document.getElementById('prompt');

function showDetection(detection) {
  const tabs = detection?.studyTabs || [];
  const active = tabs.find((tab) => tab.active) || tabs[0];
  if (!active) {
    statusEl.textContent = 'Open http://localhost:5173 first';
    phaseEl.textContent = 'No study tab detected';
    return;
  }
  const documentId = active.run?.documentId;
  statusEl.textContent = documentId ? `Study tab detected · ${documentId}` : 'Study tab detected';
  const visual = active.run?.visual || 'following';
  const phase = active.run?.phase || 'observing';
  phaseEl.textContent = `Cursor ${visual} · ${phase}`;
}

function showResult(command, result) {
  if (!result?.ok) {
    statusEl.textContent = result?.error || 'Command not accepted';
    logEl.textContent = result?.error || '';
    return;
  }
  if (command === 'stop' || result.phase === 'cancelled') {
    statusEl.textContent = 'Stopped. No further actions or speech.';
    logEl.textContent = 'Queued pointer motion was cancelled.';
  } else {
    statusEl.textContent = `● ${command} sent to the study workspace`;
    logEl.textContent = '';
  }
  phaseEl.textContent = `Cursor ${result.status || result.visual || 'following'} · ${result.phase || command}`;
}

async function refresh() {
  try {
    const detection = await chrome.runtime.sendMessage({ type: 'get_detection' });
    showDetection(detection);
  } catch (error) {
    statusEl.textContent = 'Could not read study-tab status';
    logEl.textContent = String(error);
  }
}

async function send(command) {
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'control_from_panel',
      command,
      prompt: promptEl.value,
    });
    showResult(command, result);
  } catch (error) {
    statusEl.textContent = 'Could not connect to the study tab. Reload localhost:5173.';
    logEl.textContent = String(error);
  }
}

function bind(id, command) {
  document.getElementById(id).addEventListener('click', () => { send(command); });
}

bind('teach', 'teach');
bind('quiz', 'quiz');
bind('pause', 'pause');
bind('resume', 'resume');
bind('stop', 'stop');
bind('submit', 'ask');

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'smartpath_status' || !message.state) return;
  const state = message.state;
  if (state.phase === 'cancelled') {
    statusEl.textContent = 'Stopped. No further actions or speech.';
    logEl.textContent = 'Queued pointer motion was cancelled.';
  } else if (state.documentId) {
    statusEl.textContent = `Study tab detected · ${state.documentId}`;
  } else {
    statusEl.textContent = 'Study tab detected';
  }
  phaseEl.textContent = `Cursor ${state.visual || 'following'} · ${state.phase || 'observing'}`;
});

refresh();

// ---- P2 (F09 import, F16 status, F17 CDP). Stop is handled by the background's control path (forwardControl -> stopAll).
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'panel_status') statusEl.textContent = String(message.text || '').slice(0, 300);
});

const $ = (id) => document.getElementById(id);
const say = (text) => { statusEl.textContent = text; };
const allowed = (url) => /^http:\/\/(localhost|127\.0\.0\.1):5173\//.test(url || '');
const isPdf = (url) => {
  try {
    const x = new URL(url);
    return /^(https?|file):$/.test(x.protocol) && /\.pdf$/i.test(x.pathname);
  } catch { return false; }
};
let cur = null;
let cdpOn = false;
async function refreshTab() {
  [cur] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  $('imp').hidden = !isPdf(cur?.url);
  $('agent').hidden = !allowed(cur?.url) || !cdpOn;
}
// The permission request must run synchronously inside the click gesture.
$('import').addEventListener('click', () => {
  if (!isPdf(cur?.url)) return say('This tab is not a PDF.');
  const u = new URL(cur.url);
  if (u.protocol === 'file:') return say('Local PDFs: use the Import PDF button in the workspace (or enable "Allow access to file URLs" for this extension and try again).');
  chrome.permissions.request({ origins: [u.origin + '/*'] }).then((ok) => {
    if (!ok) { say('Permission denied. Nothing was fetched or opened.'); return undefined; }
    say('Starting import…');
    return chrome.runtime.sendMessage({ type: 'import_start', url: cur.url }).then((r) => { if (!r?.ok) say(r?.error || 'Import failed'); });
  }).catch((e) => say('Import failed: ' + (e.message || e)));
});
const cdpUi = () => {
  $('cdp').textContent = cdpOn ? 'Disable real-input mode (CDP)' : 'Enable real-input mode (CDP)';
  refreshTab();
};
chrome.storage.session.get('cdp').then((r) => { cdpOn = !!r.cdp; cdpUi(); }).catch(() => {});
$('cdp').addEventListener('click', () => {
  const want = !cdpOn;
  (want ? chrome.permissions.request({ permissions: ['debugger'] }) : Promise.resolve(true)).then((ok) => {
    if (!ok) { say('Debugger permission denied. Real-input mode stays off.'); return undefined; }
    return chrome.runtime.sendMessage({ type: 'cdp_set', enabled: want }).then((r) => {
      if (!r?.ok) { say(r?.error || 'Could not change mode'); return; }
      cdpOn = want; cdpUi(); say(want ? 'Real-input mode on (localhost mock only).' : 'Real-input mode off.');
      if (!want) chrome.permissions.remove({ permissions: ['debugger'] }).catch(() => {});
    });
  }).catch((e) => say('Could not change mode: ' + (e.message || e)));
});
$('actgo').addEventListener('click', () => {
  $('confirmtxt').textContent = `Click '${$('act').selectedOptions[0].text}' on localhost:5173 with a real browser click?`;
  $('confirm').hidden = false;
});
$('cancel').addEventListener('click', () => { $('confirm').hidden = true; say('Cancelled. Nothing was clicked.'); });
$('approve').addEventListener('click', async () => {
  $('confirm').hidden = true;
  try {
    await refreshTab();
    if (!allowed(cur?.url)) return say('Open the local SmartPath Live study tab first');
    say('Moving the AI cursor…');
    const r = await chrome.tabs.sendMessage(cur.id, { type: 'agent_action', action: $('act').value });
    say(r?.ok ? `● Done: ${$('act').selectedOptions[0].text} clicked and the UI change was verified` : 'Not done: ' + (r?.error || 'unknown error'));
  } catch (e) { say('Could not reach the workspace tab. Reload localhost:5173.'); logEl.textContent = String(e); }
});
chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((id, c) => { if (c.url || c.status === 'complete') refreshTab(); });
refreshTab();

// AI/voice status from the local server's health route (textContent only).
fetch('http://localhost:5173/api/live/v1/p2/health', { credentials: 'omit', signal: AbortSignal.timeout(3000) }).then((r) => r.json()).then((h) => {
  $('ai').textContent = (h.ai ? `AI: on (${h.model})` : 'AI: off — set the key in server/.env') + ' · ' + (h.voice ? `Voice: on (${h.voiceProvider})` : 'Voice: off');
}).catch(() => { $('ai').textContent = 'AI: server not running (python server/p2_server.py)'; });
