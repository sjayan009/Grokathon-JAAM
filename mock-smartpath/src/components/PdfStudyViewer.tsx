import type { AckPayload, LessonFixture, PageNumber, Rect, Selection } from '@smartpath/tutor-core';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { locateQuote, mergeLines, toRect, unionRects } from '../pdf/quoteLocator';
import type { Note } from './NotesPanel';

GlobalWorkerOptions.workerSrc = workerUrl;

const PDF_URL = `${import.meta.env.BASE_URL}demo/gradient-descent-notes.pdf`;
const PAGE_GUTTER = 24;
const PAGES: PageNumber[] = [1, 2, 3];

export interface PdfHandle {
  navigate(page: PageNumber): Promise<AckPayload>;
  highlight(id: string): Promise<AckPayload>;
  annotate(page: PageNumber, text: string): Promise<AckPayload>;
  clear(): void;
  currentPage(): PageNumber;
}

interface Props {
  ref: Ref<PdfHandle>;
  lesson: LessonFixture;
  notes: Note[];
  speed: number;
  onPageChange(page: PageNumber): void;
  onSelection(selection: Selection | null): void;
  onExplain(selection: Selection): void;
  onSaveSelection(selection: Selection): void;
  onNoteClick(): void;
  onLayoutChange(): void;
}

/** Position within a page, as fractions, so it survives zoom and resize. */
interface PageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Mark {
  id: string;
  page: PageNumber;
  boxes: PageBox[];
}

interface Sidecar {
  page: PageNumber;
  text: string;
  top: number;
  kind: 'annotation' | 'callout';
}

interface PageRefs {
  wrap: HTMLDivElement | null;
  canvas: HTMLCanvasElement | null;
  text: HTMLDivElement | null;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function PdfStudyViewer(props: Props) {
  const { ref, lesson, notes, speed, onPageChange, onSelection, onExplain, onSaveSelection, onNoteClick, onLayoutChange } =
    props;

  const scroller = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, PageRefs>>({});
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const renderGeneration = useRef<Record<number, number>>({});
  const readyPages = useRef(new Map<number, PromiseWithResolvers<void>>());
  const currentPage = useRef<PageNumber>(1);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [aspect, setAspect] = useState(792 / 612);
  const [paneWidth, setPaneWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState<PageNumber>(1);
  const [renderTick, setRenderTick] = useState(0);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [noteDots, setNoteDots] = useState<{ id: string; page: PageNumber; top: number }[]>([]);
  const [sidecar, setSidecar] = useState<Sidecar | null>(null);
  const [chip, setChip] = useState<{ selection: Selection; x: number; y: number } | null>(null);

  const pageWidth = Math.max(240, (paneWidth - PAGE_GUTTER * 2) * zoom);

  const pageReady = useCallback((n: number) => {
    let deferred = readyPages.current.get(n);
    if (!deferred) {
      deferred = Promise.withResolvers<void>();
      readyPages.current.set(n, deferred);
    }
    return deferred;
  }, []);

  useEffect(() => {
    const task = getDocument({ url: PDF_URL });
    task.promise
      .then(async (doc) => {
        docRef.current = doc;
        const first = await doc.getPage(1);
        const base = first.getViewport({ scale: 1 });
        setAspect(base.height / base.width);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
    return () => {
      void task.destroy();
    };
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setPaneWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const renderPage = useCallback(
    async (n: PageNumber, width: number) => {
      const doc = docRef.current;
      const refs = pageRefs.current[n];
      if (!doc || !refs?.wrap || !refs.canvas || !refs.text) return;

      const generation = (renderGeneration.current[n] ?? 0) + 1;
      renderGeneration.current[n] = generation;
      const stale = () => renderGeneration.current[n] !== generation;

      const pdfPage = await doc.getPage(n);
      const scale = width / pdfPage.getViewport({ scale: 1 }).width;
      const viewport = pdfPage.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      // Draw offscreen and swap so the page never blanks during a resize.
      const buffer = document.createElement('canvas');
      const device = pdfPage.getViewport({ scale: scale * dpr });
      buffer.width = Math.ceil(device.width);
      buffer.height = Math.ceil(device.height);
      await pdfPage.render({ canvas: buffer, viewport: device }).promise;
      if (stale()) return;
      refs.canvas.width = buffer.width;
      refs.canvas.height = buffer.height;
      refs.canvas.getContext('2d')?.drawImage(buffer, 0, 0);

      const content = await pdfPage.getTextContent();
      if (stale()) return;
      const fresh = document.createElement('div');
      fresh.className = 'textLayer';
      refs.wrap.style.setProperty('--total-scale-factor', String(scale));
      await new TextLayer({ textContentSource: content, container: fresh, viewport }).render();
      if (stale()) return;
      refs.text.replaceChildren(...Array.from(fresh.childNodes));

      pageReady(n).resolve();
      setRenderTick((tick) => tick + 1);
    },
    [pageReady],
  );

  useEffect(() => {
    if (status !== 'ready' || paneWidth === 0) return;
    const timer = window.setTimeout(() => {
      for (const n of PAGES) void renderPage(n, pageWidth);
    }, 90);
    return () => window.clearTimeout(timer);
  }, [status, pageWidth, paneWidth, renderPage]);

  const toPageBoxes = useCallback((n: PageNumber, rects: Rect[]): PageBox[] => {
    const wrap = pageRefs.current[n]?.wrap?.getBoundingClientRect();
    if (!wrap) return [];
    return rects.map((r) => ({
      left: (r.x - wrap.left) / wrap.width,
      top: (r.y - wrap.top) / wrap.height,
      width: r.width / wrap.width,
      height: r.height / wrap.height,
    }));
  }, []);

  const quoteRects = useCallback((n: PageNumber, quote: string): Rect[] | null => {
    const layer = pageRefs.current[n]?.text;
    const range = layer ? locateQuote(layer, quote) : null;
    if (!range) return null;
    const rects = mergeLines(Array.from(range.getClientRects()).map(toRect));
    return rects.length ? rects : null;
  }, []);

  // Marks are recomputed from the live text layer after every re-render.
  useEffect(() => {
    const next: Mark[] = [];
    for (const id of activeIds) {
      const h = lesson.highlights.find((item) => item.id === id);
      const rects = h && quoteRects(h.page, h.quote);
      if (h && rects) next.push({ id, page: h.page, boxes: toPageBoxes(h.page, rects) });
    }
    setMarks(next);

    setNoteDots(
      notes.flatMap((note) => {
        const n = note.page as PageNumber;
        const rects = note.quote ? quoteRects(n, note.quote) : null;
        const box = rects ? toPageBoxes(n, rects)[0] : null;
        return [{ id: note.id, page: n, top: box ? box.top : 0.06 }];
      }),
    );
  }, [activeIds, lesson, notes, quoteRects, renderTick, toPageBoxes]);

  const scrollTo = useCallback(
    async (top: number) => {
      const el = scroller.current;
      if (!el) return;
      const target = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
      if (Math.abs(el.scrollTop - target) < 2) return;
      await new Promise<void>((resolve) => {
        const finish = () => {
          el.removeEventListener('scrollend', finish);
          window.clearTimeout(timer);
          resolve();
        };
        const timer = window.setTimeout(finish, 900 / speed);
        el.addEventListener('scrollend', finish);
        el.scrollTo({ top: target, behavior: speed > 1 ? 'auto' : 'smooth' });
      });
    },
    [speed],
  );

  const visibleBounds = useCallback((n: PageNumber): Rect => {
    const wrap = pageRefs.current[n]?.wrap?.getBoundingClientRect();
    const view = scroller.current?.getBoundingClientRect();
    if (!wrap || !view) throw new Error(`Page ${n} is not rendered`);
    const top = Math.max(wrap.top, view.top);
    const bottom = Math.min(wrap.bottom, view.bottom);
    return { x: wrap.left, y: top, width: wrap.width, height: Math.max(0, bottom - top) };
  }, []);

  const bringIntoView = useCallback(
    async (rect: Rect) => {
      const el = scroller.current;
      if (!el) return;
      const view = el.getBoundingClientRect();
      const centered = el.scrollTop + rect.y - view.top - (view.height - rect.height) / 2;
      await scrollTo(centered);
    },
    [scrollTo],
  );

  const navigate = useCallback(
    async (n: PageNumber): Promise<AckPayload> => {
      await pageReady(n).promise;
      const wrap = pageRefs.current[n]?.wrap;
      const el = scroller.current;
      if (!wrap || !el) throw new Error(`Page ${n} is not rendered`);
      const top = el.scrollTop + wrap.getBoundingClientRect().top - el.getBoundingClientRect().top - PAGE_GUTTER / 2;
      await scrollTo(top);
      currentPage.current = n;
      setPage(n);
      onPageChange(n);
      return { bounds: visibleBounds(n) };
    },
    [onPageChange, pageReady, scrollTo, visibleBounds],
  );

  /** Lowest body-text position, used to place notes in the page's free space. */
  const freeSpaceTop = useCallback((n: PageNumber) => {
    const layer = pageRefs.current[n]?.text;
    const wrap = pageRefs.current[n]?.wrap?.getBoundingClientRect();
    if (!layer || !wrap) return 0.8;
    let lowest = 0;
    layer.querySelectorAll('span').forEach((span) => {
      const r = span.getBoundingClientRect();
      const bottom = (r.bottom - wrap.top) / wrap.height;
      if (bottom < 0.94 && bottom > lowest) lowest = bottom;
    });
    return Math.min(lowest + 0.02, 0.8);
  }, []);

  const showSidecar = useCallback(
    async (next: Omit<Sidecar, 'top'>): Promise<AckPayload> => {
      setSidecar({ ...next, top: freeSpaceTop(next.page) });
      await nextFrame();
      await nextFrame();
      const el = document.querySelector('[data-target-id="annotation"]');
      if (!el) throw new Error('Annotation did not render');
      await bringIntoView(toRect(el.getBoundingClientRect()));
      return { bounds: toRect(el.getBoundingClientRect()) };
    },
    [bringIntoView, freeSpaceTop],
  );

  const highlight = useCallback(
    async (id: string): Promise<AckPayload> => {
      const h = lesson.highlights.find((item) => item.id === id);
      if (!h) throw new Error(`Unknown highlight "${id}"`);
      await pageReady(h.page).promise;

      const before = quoteRects(h.page, h.quote);
      if (!before) {
        await navigate(h.page);
        const payload = await showSidecar({
          page: h.page,
          kind: 'callout',
          text: `I couldn't find the exact passage here. It should be on page ${h.page}.`,
        });
        return { ...payload, fallback: 'callout' };
      }

      await bringIntoView(unionRects(before));
      currentPage.current = h.page;
      setPage(h.page);
      onPageChange(h.page);
      setActiveIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
      await nextFrame();

      const rects = quoteRects(h.page, h.quote) ?? before;
      return { bounds: unionRects(rects), rects };
    },
    [bringIntoView, lesson, navigate, onPageChange, pageReady, quoteRects, showSidecar],
  );

  const annotate = useCallback(
    (n: PageNumber, text: string) => showSidecar({ page: n, text, kind: 'annotation' }),
    [showSidecar],
  );

  useImperativeHandle(
    ref,
    () => ({
      navigate,
      highlight,
      annotate,
      clear() {
        setActiveIds([]);
        setSidecar(null);
      },
      currentPage: () => currentPage.current,
    }),
    [annotate, highlight, navigate],
  );

  const onScroll = () => {
    onLayoutChange();
    refreshChip();
    const view = scroller.current?.getBoundingClientRect();
    if (!view) return;
    let best: PageNumber = currentPage.current;
    let bestOverlap = 0;
    for (const n of PAGES) {
      const r = pageRefs.current[n]?.wrap?.getBoundingClientRect();
      if (!r) continue;
      const overlap = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = n;
      }
    }
    if (best !== currentPage.current) {
      currentPage.current = best;
      setPage(best);
      onPageChange(best);
    }
  };

  /** Reads the live selection, so the chip stays attached while scrolling. */
  const refreshChip = useCallback((): Selection | null => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setChip(null);
      return null;
    }
    const range = selection.getRangeAt(0);
    const anchor = range.commonAncestorContainer;
    const element = anchor instanceof Element ? anchor : anchor.parentElement;
    const pageEl = element?.closest<HTMLElement>('[data-pdf-page]');
    const quote = selection.toString().replace(/\s+/g, ' ').trim();
    if (!pageEl || quote.length < 3) {
      setChip(null);
      return null;
    }

    const picked: Selection = { page: Number(pageEl.dataset.pdfPage) as PageNumber, quote };
    const rect = range.getBoundingClientRect();
    const view = scroller.current?.getBoundingClientRect();
    const onScreen = view && rect.bottom > view.top && rect.top < view.bottom;
    setChip(onScreen ? { selection: picked, x: rect.left + rect.width / 2, y: Math.max(rect.top, view.top + 44) } : null);
    return picked;
  }, []);

  useEffect(() => {
    const onSelectionChange = () => {
      const picked = refreshChip();
      if (picked) onSelection(picked);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [onSelection, refreshChip]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas" data-target-id="pdf-viewer" aria-label="Lecture notes">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 text-[13px] text-ink-soft">
        <span className="min-w-0 truncate font-medium text-ink">Gradient Descent — Lecture Notes</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap">
          <ToolbarButton label="Previous page" disabled={page === 1} onClick={() => void navigate((page - 1) as PageNumber)}>
            ‹
          </ToolbarButton>
          <span data-testid="page-indicator" className="min-w-16 text-center tabular-nums">
            Page {page} of {lesson.pageCount}
          </span>
          <ToolbarButton label="Next page" disabled={page === 3} onClick={() => void navigate((page + 1) as PageNumber)}>
            ›
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-line" />
          <ToolbarButton label="Zoom out" disabled={zoom <= 0.7} onClick={() => setZoom((z) => +(z - 0.15).toFixed(2))}>
            −
          </ToolbarButton>
          <button type="button" className="min-w-11 rounded px-1 py-0.5 tabular-nums hover:bg-canvas" onClick={() => setZoom(1)} aria-label="Reset zoom">
            {Math.round(zoom * 100)}%
          </button>
          <ToolbarButton label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom((z) => +(z + 0.15).toFixed(2))}>
            +
          </ToolbarButton>
        </span>
      </div>

      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto" data-testid="pdf-scroller">
        {status === 'error' && (
          <p className="m-6 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            The lecture notes could not be loaded. Run npm run generate:pdf and reload.
          </p>
        )}
        {status === 'loading' && <p className="m-6 text-sm text-ink-soft">Loading lecture notes…</p>}

        <div className="mx-auto flex w-max flex-col items-center gap-5 px-6 py-3">
          {PAGES.map((n) => (
            <div
              key={n}
              data-pdf-page={n}
              data-target-id={`pdf-page-${n}`}
              ref={(el) => {
                pageRefs.current[n] = { ...pageRefs.current[n], wrap: el };
              }}
              className="relative bg-white shadow-page"
              style={{ width: pageWidth, height: pageWidth * aspect }}
            >
              <canvas
                ref={(el) => {
                  pageRefs.current[n] = { ...pageRefs.current[n], canvas: el };
                }}
                className="absolute inset-0 h-full w-full"
              />
              <div className="pointer-events-none absolute inset-0 z-[1] mix-blend-multiply">
                {marks
                  .filter((mark) => mark.page === n)
                  .flatMap((mark) =>
                    mark.boxes.map((box, i) => (
                      <div
                        key={`${mark.id}-${i}`}
                        data-highlight-id={mark.id}
                        className="pdf-highlight absolute"
                        style={{ ...percentBox(box), animationDelay: `${(i * 420) / speed}ms` }}
                      />
                    )),
                  )}
              </div>
              <div
                className="textLayer"
                ref={(el) => {
                  pageRefs.current[n] = { ...pageRefs.current[n], text: el };
                }}
              />
              {noteDots
                .filter((dot) => dot.page === n)
                .map((dot) => (
                  <button
                    key={dot.id}
                    type="button"
                    data-testid="note-marker"
                    aria-label="Open saved note"
                    onClick={onNoteClick}
                    className="absolute right-3 z-[3] grid h-6 w-6 place-items-center rounded-full bg-brand text-[11px] font-semibold text-white shadow"
                    style={{ top: `${dot.top * 100}%` }}
                  >
                    ✎
                  </button>
                ))}
              {sidecar?.page === n && (
                <aside
                  data-target-id="annotation"
                  data-sidecar-kind={sidecar.kind}
                  className="sidecar-note absolute z-[3]"
                  style={{ top: `${sidecar.top * 100}%`, left: '9%', right: '9%' }}
                >
                  <span className="sidecar-note__label">{sidecar.kind === 'callout' ? 'Could not highlight' : 'Tutor note'}</span>
                  {sidecar.text}
                </aside>
              )}
            </div>
          ))}
        </div>
      </div>

      {chip && (
        <div
          role="toolbar"
          aria-label="Selection actions"
          className="fixed z-40 flex -translate-x-1/2 -translate-y-full gap-px overflow-hidden rounded-lg bg-ink text-[13px] font-medium text-white shadow-lg"
          style={{ left: chip.x, top: chip.y - 8 }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" data-testid="explain-chip" className="px-3 py-1.5 hover:bg-white/15" onClick={() => onExplain(chip.selection)}>
            Explain
          </button>
          <button type="button" className="border-l border-white/20 px-3 py-1.5 hover:bg-white/15" onClick={() => onSaveSelection(chip.selection)}>
            Save
          </button>
        </div>
      )}
    </section>
  );
}

function percentBox(box: PageBox) {
  return {
    left: `${box.left * 100}%`,
    top: `${box.top * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
  };
}

function ToolbarButton(props: { label: string; disabled?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="grid h-7 w-7 place-items-center rounded text-base hover:bg-canvas disabled:opacity-35"
    >
      {props.children}
    </button>
  );
}
