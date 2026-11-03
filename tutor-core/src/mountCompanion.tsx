import { createRoot } from 'react-dom/client';
import { BridgeClient } from './bridge.ts';
import { getSpeed, PausableClock } from './clock.ts';
import { CompanionController } from './companion.ts';
import { CompanionCursor } from './companionCursor.ts';
import type { LessonFixture } from './lessonTypes.ts';
import { LessonRunner } from './lessonRunner.ts';
import { AssistantPanel } from './overlay/AssistantPanel.tsx';
import { PANEL_STYLES } from './overlay/styles.ts';
import type { CompanionClient } from './protocol.ts';
import type { LiveAi } from './qa.ts';
import { BrowserSpeaker } from './speech.ts';

export interface CompanionHandle {
  destroy(): void;
  setVisible(visible: boolean): void;
}

/** The single entry point for both the extension and the embedded simulation. */
export function mountCompanion(options: {
  slot: HTMLElement;
  lesson: LessonFixture;
  client: CompanionClient;
  ai?: LiveAi;
}): CompanionHandle {
  const { slot, lesson, client, ai } = options;
  if (slot.dataset.companionMounted) {
    return { destroy: () => undefined, setVisible: () => undefined };
  }
  slot.dataset.companionMounted = client;

  const speed = getSpeed();
  const clock = new PausableClock(speed);
  const bridge = new BridgeClient(client, clock);
  const cursor = new CompanionCursor(speed);
  let controller: CompanionController | null = null;
  const speaker = new BrowserSpeaker(clock, (caption) => controller?.setCaption(caption));
  const runner = new LessonRunner({
    lesson,
    transport: bridge,
    cursor,
    speaker,
    clock,
    onNarration: (text) => controller?.addNarration(text),
  });
  controller = new CompanionController({ lesson, client, bridge, runner, cursor, ai });

  const host = document.createElement('div');
  host.id = 'smartpath-companion-panel';
  host.style.height = '100%';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_STYLES;
  const container = document.createElement('div');
  container.className = 'companion-root';
  shadow.append(style, container);
  slot.append(host);

  const root = createRoot(container);
  root.render(<AssistantPanel controller={controller} steps={lesson.lessonSteps} />);

  const onPageHide = () => speaker.cancel();
  window.addEventListener('pagehide', onPageHide);

  return {
    destroy() {
      window.removeEventListener('pagehide', onPageHide);
      controller?.destroy();
      bridge.destroy();
      cursor.destroy();
      root.unmount();
      host.remove();
      delete slot.dataset.companionMounted;
    },
    setVisible(visible) {
      host.style.display = visible ? '' : 'none';
      cursor.setVisible(visible);
      if (!visible) controller?.stop();
    },
  };
}
