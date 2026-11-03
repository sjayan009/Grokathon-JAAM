import {
  fetchLiveAi,
  getSpeed,
  mountCompanion,
  type AckPayload,
  type CompanionClient,
  type PageNumber,
  type Rect,
  type Selection,
  type StudyAction,
  type VideoState,
  type WorkspaceContext,
} from '@smartpath/tutor-core';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { emitAppEvent, startBridge } from './bridge/studyActionBridge';
import { CourseSidebar } from './components/CourseSidebar';
import { NotesPanel, useNotes } from './components/NotesPanel';
import { PdfStudyViewer, type PdfHandle } from './components/PdfStudyViewer';
import { QuizPanel } from './components/QuizPanel';
import { VideoDock } from './components/VideoDock';
import { Whiteboard, type WhiteboardHandle } from './components/Whiteboard';
import { lesson } from './demo/gradientDescentLesson';

const HANDSHAKE_WAIT_MS = 1500;
const speed = getSpeed();

type CompanionStatus = 'detecting' | 'missing' | CompanionClient;

function boundsOf(selector: string): Rect {
  const r = document.querySelector(selector)?.getBoundingClientRect();
  if (!r || r.width === 0) throw new Error(`${selector} is not on screen`);
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function App() {
  const pdf = useRef<PdfHandle>(null);
  const board = useRef<WhiteboardHandle>(null);
  const slot = useRef<HTMLDivElement>(null);
  const selection = useRef<Selection | null>(null);
  const layoutQueued = useRef(false);
  const unmountEmbedded = useRef<(() => void) | null>(null);

  const [companion, setCompanion] = useState<CompanionStatus>('detecting');
  const [lessonActive, setLessonActive] = useState(false);
  const [lessonComplete, setLessonComplete] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [sideWidth, setSideWidth] = useState(0.5);
  const [videoHeight, setVideoHeight] = useState(300);
  const { notes, addNote, removeNote } = useNotes();
  const stage = useRef<HTMLDivElement>(null);

  const emitLayout = useCallback(() => {
    if (layoutQueued.current) return;
    layoutQueued.current = true;
    requestAnimationFrame(() => {
      layoutQueued.current = false;
      emitAppEvent({ type: 'LAYOUT_CHANGED' });
    });
  }, []);

  const resetWorkspace = useCallback(() => {
    pdf.current?.clear();
    board.current?.reset();
    flushSync(() => {
      setBoardOpen(false);
      setVideoOpen(false);
      setQuizOpen(false);
      setLessonComplete(false);
    });
  }, []);

  const handleAction = useCallback(
    async (action: StudyAction): Promise<AckPayload | void> => {
      switch (action.type) {
        case 'NAVIGATE_PDF':
          return pdf.current?.navigate(action.page);
        case 'HIGHLIGHT_QUOTE':
          return pdf.current?.highlight(action.id);
        case 'SHOW_ANNOTATION':
          return pdf.current?.annotate(action.page, action.text);
        case 'OPEN_WHITEBOARD':
          flushSync(() => setBoardOpen(true));
          await nextFrame();
          return { bounds: boundsOf('[data-target-id="whiteboard"]') };
        case 'DRAW_WHITEBOARD_STEP':
          flushSync(() => setBoardOpen(true));
          await board.current?.drawStep(action.step);
          return { bounds: boundsOf('[data-target-id="whiteboard"]') };
        case 'OPEN_VIDEO':
          flushSync(() => setVideoOpen(true));
          await nextFrame();
          return { bounds: boundsOf('[data-target-id="video-dock"]') };
        case 'SHOW_QUIZ':
          flushSync(() => setQuizOpen(true));
          await nextFrame();
          return { bounds: boundsOf('[data-target-id="quiz"]') };
        case 'SAVE_NOTE':
          flushSync(() => {
            addNote({ page: action.page, quote: action.quote, note: action.note });
            setNotesOpen(true);
          });
          return;
        case 'GET_BOUNDS':
          if (action.quoteId) return { bounds: boundsOf(`[data-highlight-id="${action.quoteId}"]`) };
          return { bounds: boundsOf(`[data-target-id="${action.targetId}"]`) };
        case 'GET_CONTEXT': {
          const context: WorkspaceContext = {
            page: pdf.current?.currentPage() ?? 1,
            whiteboardStep: board.current?.currentStep() ?? null,
            selection: selection.current,
          };
          return { context };
        }
        case 'RESET_WORKSPACE':
          resetWorkspace();
          return;
        case 'SET_LESSON_MODE':
          flushSync(() => {
            setLessonActive(action.active);
            if (action.complete) setLessonComplete(true);
          });
          return;
        case 'SET_PLAYBACK':
          board.current?.setPaused(action.paused);
          return;
        case 'CANCEL_ALL':
          board.current?.cancel();
          flushSync(() => setLessonActive(false));
          return;
      }
    },
    [addNote, resetWorkspace],
  );

  const handlerRef = useRef(handleAction);
  handlerRef.current = handleAction;

  useEffect(
    () =>
      startBridge({
        documentId: lesson.documentId,
        handle: (action) => handlerRef.current(action),
        onHello: (client) => setCompanion(client),
      }),
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCompanion((current) => (current === 'detecting' ? 'missing' : current));
    }, HANDSHAKE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => unmountEmbedded.current?.(), []);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(emitLayout);
    observer.observe(el);
    return () => observer.disconnect();
  }, [emitLayout]);

  const startEmbedded = () => {
    if (!slot.current || unmountEmbedded.current) return;
    setCompanion('embedded');
    const handle = mountCompanion({ slot: slot.current, lesson, client: 'embedded', ai: fetchLiveAi('/api') });
    unmountEmbedded.current = handle.destroy;
  };

  const onSelection = useCallback((picked: Selection | null) => {
    if (picked) selection.current = picked;
    emitAppEvent({ type: 'SELECTION_CHANGED', selection: picked });
  }, []);

  const onExplain = useCallback((picked: Selection) => {
    selection.current = picked;
    emitAppEvent({ type: 'EXPLAIN_REQUEST', selection: picked });
  }, []);

  const onSaveSelection = useCallback(
    (picked: Selection) => {
      addNote({ page: picked.page, quote: picked.quote, note: 'Saved passage' });
      setNotesOpen(true);
    },
    [addNote],
  );

  const onVideoState = useCallback((state: VideoState) => emitAppEvent({ type: 'VIDEO_STATE', state }), []);

  const onPageChange = useCallback((_: PageNumber) => undefined, []);

  const dragSplit = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      setSideWidth(Math.min(0.68, Math.max(0.3, (box.right - e.clientX) / box.width)));
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
  };

  const dragVideo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    const startY = event.clientY;
    const startHeight = videoHeight;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setVideoHeight(Math.min(560, Math.max(180, startHeight + startY - e.clientY)));
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
  };

  const showSide = boardOpen || videoOpen;

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
      <CourseSidebar collapsed={lessonActive} lessonComplete={lessonComplete} />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <div className="min-w-0">
            <p className="truncate text-xs text-ink-soft">CS 3600 — Intro to AI</p>
            <h1 className="truncate text-[15px] font-semibold leading-tight">Lecture 8: Optimization</h1>
          </div>
          {lessonComplete && (
            <span data-testid="lesson-complete" className="rounded-full bg-good/10 px-2.5 py-1 text-xs font-medium text-good">
              Lesson complete
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="toolbar-button" onClick={() => setNotesOpen((open) => !open)}>
              Notes{notes.length > 0 && <span data-testid="notes-count" className="ml-1.5 rounded-full bg-brand px-1.5 text-[11px] text-white">{notes.length}</span>}
            </button>
            <button type="button" data-target-id="open-whiteboard" data-testid="open-whiteboard" className="toolbar-button" onClick={() => setBoardOpen(true)}>
              Open Whiteboard
            </button>
          </div>
        </header>

        <div ref={stage} className="relative flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <PdfStudyViewer
              ref={pdf}
              lesson={lesson}
              notes={notes}
              speed={speed}
              onPageChange={onPageChange}
              onSelection={onSelection}
              onExplain={onExplain}
              onSaveSelection={onSaveSelection}
              onNoteClick={() => setNotesOpen(true)}
              onLayoutChange={emitLayout}
            />
            {quizOpen && <QuizPanel quiz={lesson.quiz} onAnswer={(choiceId) => emitAppEvent({ type: 'QUIZ_ANSWERED', choiceId })} />}
          </div>

          {showSide && (
            <>
              <div role="separator" aria-orientation="vertical" aria-label="Resize panels" className="split-handle" onPointerDown={dragSplit} />
              <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${sideWidth * 100}%` }}>
                {boardOpen && <Whiteboard ref={board} speed={speed} onClose={() => setBoardOpen(false)} />}
                {videoOpen && (
                  <>
                    {boardOpen && <div role="separator" aria-orientation="horizontal" aria-label="Resize video" className="split-handle split-handle--row" onPointerDown={dragVideo} />}
                    <VideoDock lesson={lesson} height={boardOpen ? videoHeight : 420} onState={onVideoState} onClose={() => setVideoOpen(false)} />
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {notesOpen && (
          <NotesPanel
            notes={notes}
            onJump={(page) => void pdf.current?.navigate(page as PageNumber)}
            onRemove={removeNote}
            onClose={() => setNotesOpen(false)}
          />
        )}
      </main>

      <div className="relative w-90 shrink-0 border-l border-line bg-surface">
        <div ref={slot} data-companion-slot className="h-full" />
        {companion === 'detecting' && <p className="absolute inset-x-0 top-6 text-center text-[13px] text-ink-soft">Looking for the companion…</p>}
        {companion === 'missing' && (
          <div data-testid="companion-missing" className="absolute inset-x-4 top-6 rounded-xl border border-line bg-canvas p-4 text-[13px] text-ink-soft">
            <p className="font-medium text-ink">Study Companion extension not detected</p>
            <p className="mt-1">Load chrome-extension/dist as an unpacked extension, then reload. Or run the same lesson as a simulation inside this page.</p>
            <button
              type="button"
              data-testid="run-embedded"
              className="mt-3 rounded-lg bg-brand px-3 py-2 font-medium text-white hover:bg-brand-deep"
              onClick={startEmbedded}
            >
              Run embedded simulation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
