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
