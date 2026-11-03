import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { ChatMessage, CompanionController } from '../companion.ts';
import type { LessonStep } from '../lessonTypes.ts';
import type { PauseReason, RunnerSnapshot } from '../lessonRunner.ts';

const PLAN_GROUPS: LessonStep['group'][] = ['Notes', 'Whiteboard', 'Video', 'Check'];

const PAUSE_TEXT: Record<PauseReason, string> = {
  user: 'Paused',
  video: 'Paused while the video plays',
  hidden: 'Paused while this tab is hidden',
  question: 'Paused for your question',
};

function statusLabel(runner: RunnerSnapshot) {
  if (runner.status === 'paused') return PAUSE_TEXT[runner.pauseReasons[0] ?? 'user'];
  if (runner.status === 'running') return 'Working';
  if (runner.status === 'complete') return 'Lesson complete';
  if (runner.status === 'stopped') return 'Stopped';
  return 'Following';
}

export function AssistantPanel({ controller, steps }: { controller: CompanionController; steps: LessonStep[] }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const { runner } = state;
  const active = runner.status === 'running' || runner.status === 'paused';
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<'chat' | 'actions'>('chat');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, state.thinking, runner.feed.length, tab]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void controller.submit(draft);
    setDraft('');
  };

  const total = steps.length - 1;
  const stepNumber = Math.max(runner.stepIndex, 0);
  const step = steps[stepNumber];
  const showProgress = runner.stepIndex >= 0 && runner.status !== 'idle';

  return (
    <div className="panel" data-testid="companion-panel">
      <header className="head">
        <div className="title-row">
          <h2>AI Study Companion</h2>
          <span className={`badge badge--${state.ai}`} data-testid="ai-badge">
            {state.ai === 'live' ? 'AI: live' : state.ai === 'checking' ? 'AI: checking' : 'AI: scripted'}
          </span>
        </div>
        <p className="status" data-testid="companion-status" data-status={runner.status}>
          <span className="dot" />
          {statusLabel(runner)}
        </p>
        {state.client === 'embedded' && <p className="sim-label">Embedded simulation, no extension running</p>}
        {state.connection === 'failed' && <p className="error-line">The study workspace isn't responding. Reload the page to reconnect.</p>}
      </header>

      {showProgress && (
        <section className="progress" aria-label="Lesson timeline">
          <div className="progress-row">
            <span className="step-title">{step.title}</span>
            {stepNumber > 0 && (
              <span className="step-count" data-testid="step-count">
                {stepNumber} of {total}
              </span>
            )}
          </div>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={stepNumber}>
            <span style={{ width: `${(runner.status === 'complete' ? 1 : stepNumber / total) * 100}%` }} />
          </div>
          <ol className="plan">
            {PLAN_GROUPS.map((group) => {
              const last = steps.findLastIndex((item) => item.group === group);
              const first = steps.findIndex((item) => item.group === group);
              const done = runner.status === 'complete' || stepNumber > last;
              const current = !done && stepNumber >= first;
              return (
                <li key={group} data-state={done ? 'done' : current ? 'current' : 'next'}>
                  {group}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="caption" aria-live="polite" aria-label="Live subtitles" data-testid="caption">
        {state.caption || <span className="caption-empty">{active ? ' ' : 'Subtitles appear here during a lesson.'}</span>}
      </section>

      <div className="controls">
        {!active ? (
          <button type="button" className="primary" data-testid="start" disabled={state.connection !== 'connected'} onClick={() => controller.startLesson()}>
            {runner.status === 'idle' ? 'Start lesson' : 'Restart lesson'}
          </button>
        ) : (
          <>
            <button type="button" data-testid="pause" onClick={() => controller.togglePause()}>
              {runner.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button type="button" data-testid="skip" disabled={runner.status === 'paused'} onClick={() => controller.skip()}>
              Skip line
            </button>
            <button type="button" className="danger" data-testid="stop" onClick={() => controller.stop()}>
              Stop
            </button>
          </>
        )}
      </div>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
          Conversation
        </button>
        <button type="button" role="tab" aria-selected={tab === 'actions'} data-testid="actions-tab" onClick={() => setTab('actions')}>
          Actions{runner.feed.length > 0 ? ` (${runner.feed.length})` : ''}
        </button>
      </div>

      <div className="scroll" ref={scroller}>
        {tab === 'chat' ? (
          <ul className="messages" data-testid="messages">
            {state.messages.map((message) => (
              <Message key={message.id} message={message} controller={controller} />
            ))}
            {state.thinking && <li className="message message--thinking">Thinking…</li>}
          </ul>
        ) : (
          <ul className="feed" data-testid="action-feed">
            {runner.feed.length === 0 && <li className="feed-empty">Everything I do on the page is listed here.</li>}
            {runner.feed.map((entry) => (
              <li key={entry.id} data-state={entry.state}>
                {entry.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="prompt" onSubmit={submit}>
        {runner.status === 'idle' && !draft && (
          <button type="button" className="suggestion" onClick={() => void controller.submit('Teach me gradient descent')}>
            Teach me gradient descent
          </button>
        )}
        <div className="prompt-row">
          <input
            data-testid="prompt"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about your notes…"
            aria-label="Message the study companion"
          />
          {state.micSupported && (
            <button type="button" className="icon" aria-pressed={state.listening} aria-label={state.listening ? 'Stop listening' : 'Push to talk'} onClick={() => controller.toggleMic()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
                <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
              </svg>
            </button>
          )}
          <button type="submit" className="send" data-testid="send" disabled={!draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function Message({ message, controller }: { message: ChatMessage; controller: CompanionController }) {
  const { cite, savable } = message;
  return (
    <li className={`message message--${message.role}`} data-testid={message.role === 'assistant' ? 'assistant-message' : undefined}>
      <p>{message.text}</p>
      {(cite || savable) && (
        <div className="message-actions">
          {cite && (
            <button type="button" data-testid="citation" onClick={() => void controller.pointAt(cite)}>
              Page {cite.page}
            </button>
          )}
          {savable && (
            <button type="button" data-testid="save-explanation" onClick={() => void controller.saveExplanation(message)}>
              Save this explanation
            </button>
          )}
          {message.source === 'live' && <span className="source">Generated from your notes</span>}
        </div>
      )}
    </li>
  );
}
