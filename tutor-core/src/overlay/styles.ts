/** A TS string so Vite and esbuild can both inject it into the shadow root. */
export const PANEL_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .companion-root { height: 100%; }
  .panel {
    --ink: #141a2e; --soft: #5c6478; --line: #dfe2ea; --wash: #f5f6f9; --ai: #e8431f; --ai-wash: #fff0ec;
    --good: #16845b; --warn: #a86a00; --danger: #c23a3a;
    display: flex; flex-direction: column; height: 100%; background: #fff; color: var(--ink);
    font: 400 14px/1.45 'Inter Variable', Inter, system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  h2 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; }
  p { margin: 0; }
  ul, ol { margin: 0; padding: 0; list-style: none; }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:disabled { cursor: default; opacity: .45; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ai); outline-offset: 1px; }

  .head { padding: 12px 14px 10px; border-bottom: 1px solid var(--line); }
  .title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--wash); color: var(--soft); white-space: nowrap; }
  .badge--live { background: rgb(22 132 91 / .12); color: var(--good); }
  .status { display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: 13px; color: var(--soft); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #b7bcc9; }
  .status[data-status='running'] .dot { background: var(--ai); animation: pulse 1s ease-in-out infinite; }
  .status[data-status='paused'] .dot { background: #ffc53d; }
  .status[data-status='complete'] .dot { background: var(--good); }
  .sim-label { margin-top: 6px; padding: 3px 8px; border-radius: 6px; background: #fff6e0; color: var(--warn); font-size: 12px; font-weight: 500; }
  .error-line { margin-top: 6px; font-size: 13px; color: var(--danger); }
  @keyframes pulse { 50% { opacity: .35; } }

  .progress { padding: 10px 14px; border-bottom: 1px solid var(--line); }
  .progress-row { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
  .step-title { font-weight: 600; }
  .step-count { color: var(--soft); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bar { height: 4px; margin: 7px 0 8px; border-radius: 2px; background: var(--wash); overflow: hidden; }
  .bar span { display: block; height: 100%; border-radius: 2px; background: var(--ai); transition: width .4s ease; }
  .plan { display: flex; gap: 4px; font-size: 12px; color: var(--soft); }
  .plan li { flex: 1; padding: 2px 0; border-radius: 5px; text-align: center; background: var(--wash); }
  .plan li[data-state='current'] { background: var(--ai-wash); color: var(--ai); font-weight: 600; }
  .plan li[data-state='done'] { background: rgb(22 132 91 / .1); color: var(--good); }

  .caption { min-height: 76px; padding: 12px 14px; font-size: 16px; line-height: 1.4; font-weight: 500; border-bottom: 1px solid var(--line); }
  .caption-empty { color: var(--soft); font-size: 14px; font-weight: 400; }

  .controls { display: flex; gap: 6px; padding: 10px 14px; }
  .controls button { flex: 1; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: #fff; font-size: 13px; font-weight: 550; }
  .controls button:not(:disabled):hover { background: var(--wash); }
  .controls .primary { border-color: var(--ai); background: var(--ai); color: #fff; }
  .controls .primary:not(:disabled):hover { background: #cf3814; }
  .controls .danger { color: var(--danger); }

  .tabs { display: flex; gap: 14px; padding: 0 14px; border-bottom: 1px solid var(--line); }
  .tabs button { padding: 6px 0; border: 0; border-bottom: 2px solid transparent; background: none; font-size: 13px; color: var(--soft); }
  .tabs button[aria-selected='true'] { border-bottom-color: var(--ink); color: var(--ink); font-weight: 600; }

  .scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 14px; }
  .messages { display: flex; flex-direction: column; gap: 8px; }
  .message { max-width: 94%; padding: 7px 10px; border-radius: 10px; background: var(--wash); }
  .message--thinking { color: var(--soft); animation: pulse 1.2s ease-in-out infinite; }
  .message--user { align-self: flex-end; background: var(--ink); color: #fff; }
  .message-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
  .message-actions button { padding: 2px 8px; border: 1px solid var(--line); border-radius: 6px; background: #fff; font-size: 12px; font-weight: 500; }
  .message-actions button:hover { border-color: var(--ai); color: var(--ai); }
  .source { font-size: 11px; color: var(--soft); }

  .feed { display: flex; flex-direction: column; gap: 5px; font-size: 13px; }
  .feed li { position: relative; padding-left: 16px; }
  .feed li:not(.feed-empty)::before { content: ''; position: absolute; left: 2px; top: 7px; width: 7px; height: 7px; border-radius: 50%; background: #b7bcc9; }
  .feed li[data-state='active']::before { background: var(--ai); }
  .feed li[data-state='done']::before { background: var(--good); }
  .feed li[data-state='error'] { color: var(--danger); }
  .feed li[data-state='error']::before { background: var(--danger); }
  .feed li[data-state='cancelled'] { color: var(--soft); text-decoration: line-through; }
  .feed-empty { padding-left: 0 !important; color: var(--soft); }

  .prompt { padding: 10px 14px 12px; border-top: 1px solid var(--line); }
  .suggestion { display: block; width: 100%; margin-bottom: 8px; padding: 7px 10px; border: 1px dashed #f0a48f; border-radius: 8px; background: var(--ai-wash); color: var(--ai); font-size: 13px; font-weight: 550; text-align: left; }
  .prompt-row { display: flex; gap: 6px; }
  input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font: inherit; color: inherit; background: #fff; }
  .icon { display: grid; place-items: center; width: 36px; flex: none; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--soft); }
  .icon[aria-pressed='true'] { border-color: var(--ai); background: var(--ai-wash); color: var(--ai); }
  .send { flex: none; padding: 0 12px; border: 0; border-radius: 8px; background: var(--ink); color: #fff; font-size: 13px; font-weight: 600; }
`;
