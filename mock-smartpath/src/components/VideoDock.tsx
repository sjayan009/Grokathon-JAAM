import type { LessonFixture, VideoState } from '@smartpath/tutor-core';
import { useEffect, useRef, useState } from 'react';

const READY_TIMEOUT_MS = 8000;

interface YtPlayerEvent {
  data: number;
}

interface YtApi {
  Player: new (
    el: HTMLIFrameElement,
    options: {
      events: {
        onReady(): void;
        onStateChange(event: YtPlayerEvent): void;
        onError(): void;
      };
    },
  ) => unknown;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
}

declare global {
  interface Window {
    YT?: YtApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoad: Promise<YtApi> | null = null;

function loadYouTubeApi(): Promise<YtApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiLoad ??= new Promise<YtApi>((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => (window.YT ? resolve(window.YT) : reject(new Error('YouTube API missing')));
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      apiLoad = null;
      reject(new Error('YouTube API blocked'));
    };
    document.head.append(script);
  });
  return apiLoad;
}

interface Props {
  lesson: LessonFixture;
  height: number;
  onState(state: VideoState): void;
  onClose(): void;
}

export function VideoDock({ lesson, height, onState, onClose }: Props) {
  const [state, setState] = useState<VideoState>('idle');
  const [posterFailed, setPosterFailed] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const started = state !== 'idle' && state !== 'error';
  const watchUrl = `https://www.youtube.com/watch?v=${lesson.videoId}`;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${lesson.videoId}?enablejsapi=1&autoplay=1&rel=0&origin=${encodeURIComponent(location.origin)}`;

  const update = (next: VideoState) => {
    setState(next);
    onState(next);
  };

  useEffect(() => {
    if (state !== 'loading') return;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      update('error');
    };
    const timer = window.setTimeout(fail, READY_TIMEOUT_MS);

    loadYouTubeApi()
      .then((YT) => {
        if (!frame.current) return;
        new YT.Player(frame.current, {
          events: {
            onReady() {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              update('ready');
            },
            onStateChange({ data }) {
              if (data === YT.PlayerState.PLAYING) update('playing');
              else if (data === YT.PlayerState.PAUSED) update('paused');
              else if (data === YT.PlayerState.ENDED) update('ended');
            },
            onError() {
              window.clearTimeout(timer);
              settled = false;
              fail();
            },
          },
        });
      })
      .catch(() => {
        window.clearTimeout(timer);
        fail();
      });

    return () => window.clearTimeout(timer);
    // `update` only calls stable setters and the latest onState prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <section className="flex shrink-0 flex-col border-t border-line bg-surface" style={{ height }} data-target-id="video-dock" aria-label="Supporting video">
      <header className="flex h-11 shrink-0 items-center gap-2 px-3 text-[13px]">
        <span className="truncate font-medium text-ink" title={lesson.videoTitle}>
          {lesson.videoTitle}
        </span>
        <span className="shrink-0 text-ink-soft">{lesson.videoSource}</span>
        <a className="ml-auto shrink-0 text-brand hover:underline" href={watchUrl} target="_blank" rel="noreferrer" data-testid="video-external-link">
          Open on YouTube
        </a>
        <button type="button" aria-label="Close video" className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-soft hover:bg-canvas" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="relative min-h-0 flex-1 bg-ink">
        {started && (
          <iframe
            ref={frame}
            title={lesson.videoTitle}
            src={embedUrl}
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}

        {state === 'idle' && (
          <button type="button" data-testid="video-play" className="group absolute inset-0 grid place-items-center overflow-hidden" onClick={() => update('loading')} aria-label={`Play ${lesson.videoTitle}`}>
            {!posterFailed && (
              <img
                src={`https://i.ytimg.com/vi/${lesson.videoId}/hqdefault.jpg`}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-80"
                onError={() => setPosterFailed(true)}
              />
            )}
            <span className="relative flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-ink shadow-lg transition group-hover:scale-105">
              <span aria-hidden className="text-brand">▶</span> Play
            </span>
          </button>
        )}

        {state === 'error' && (
          <div data-testid="video-error" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white">
            <p>
              This video won't play here.
              <br />
              <a className="mt-1 inline-block font-semibold underline" href={watchUrl} target="_blank" rel="noreferrer">
                Watch it on YouTube instead
              </a>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
