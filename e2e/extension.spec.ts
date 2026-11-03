import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { createProxy } from '../optional-ai-proxy/handler.ts';

const EXTENSION = resolve('chrome-extension/dist');
const FAST = '/?tutorSpeed=4';
const WALKTHROUGH = 'Could you walk me through gradient descent using my lecture notes?';

const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    await use(await context.newPage());
  },
});

async function open(page: Page, path = FAST) {
  await page.goto(path);
  await expect(page.getByTestId('companion-panel')).toBeVisible();
  await expect(page.getByTestId('start')).toBeEnabled();
  await expect(page.locator('[data-pdf-page="3"] .textLayer span').first()).toBeAttached();
}

async function ask(page: Page, text: string) {
  await page.getByTestId('prompt').fill(text);
  await page.getByTestId('send').click();
}

const status = (page: Page) => page.getByTestId('companion-status');
const stepCount = (page: Page) => page.getByTestId('step-count');

const lastAnswer = (page: Page) => page.getByTestId('assistant-message').last();

function cursorPosition(page: Page) {
  return page.evaluate(() => {
    const el = document.getElementById('smartpath-companion-cursor')?.shadowRoot?.querySelector<HTMLElement>('.cursor');
    const match = el?.style.transform.match(/translate3d\(([\d.-]+)px, ([\d.-]+)px/);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
  });
}

/** Selects the text-layer span containing a phrase, as a user's drag would. */
async function selectPhrase(page: Page, phrase: string) {
  await page.evaluate((text) => {
    const spans = Array.from(document.querySelectorAll('.textLayer span'));
    const span = spans.find((item) => item.textContent?.includes(text));
    if (!span?.firstChild) throw new Error(`No span contains "${text}"`);
    span.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, phrase);
}

test('connects through the extension with no key, server or login', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('companion-missing')).toHaveCount(0);
  await expect(page.getByText('Embedded simulation')).toHaveCount(0);
  await expect(page.getByTestId('ai-badge')).toHaveText('AI: scripted');
  await expect(page.locator('[data-pdf-page="1"] canvas')).toBeVisible();
  await expect(page.getByTestId('page-indicator')).toHaveText('Page 1 of 3');
});

test('runs the flagship lesson end to end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await open(page);
  await ask(page, WALKTHROUGH);

  // The cursor must actually reach the highlight, not merely be near the page.
  const definition = page.locator('[data-highlight-id="definition"]').first();
  await expect(definition).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => {
      const box = await definition.boundingBox();
      const cursor = await cursorPosition(page);
      return box && cursor && Math.abs(cursor.y - (box.y + box.height)) < 80;
    })
    .toBe(true);

  await expect(page.locator('[data-highlight-id="update_rule"]').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-highlight-id="learning_rate"]').first()).toBeVisible({ timeout: 15_000 });

  await expect(page.locator('[data-target-id="whiteboard"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('whiteboard-svg')).toHaveAttribute('data-step', '3', { timeout: 30_000 });
  const rows = [
    ['0', '0', '9'],
    ['1', '2.4', '0.36'],
    ['2', '2.88', '0.0144'],
    ['3', '2.976', '0.000576'],
  ];
  for (const [i, cells] of rows.entries()) {
    const row = page.getByTestId(`wb-row-${i}`);
    await expect(row).toHaveAttribute('data-drawn', 'true');
    await expect(row).toHaveText(cells.join(''));
  }

  const note = page.locator('[data-target-id="annotation"]');
  await expect(note).toContainText('Bigger learning rates may overshoot; smaller rates converge more slowly.', { timeout: 15_000 });
  await expect(note).toHaveAttribute('data-sidecar-kind', 'annotation');
  await expect(page.locator('[data-pdf-page="3"] [data-highlight-id="worked_paragraph"]').first()).toBeVisible();

  await expect(page.locator('[data-target-id="video-dock"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('video-external-link')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=IHZwWFHWa-w');
  await expect(page.getByTestId('video-play')).toBeVisible();
  // The PDF and whiteboard must survive the video opening.
  await expect(page.locator('[data-target-id="pdf-viewer"]')).toBeVisible();
  await expect(page.locator('[data-target-id="whiteboard"]')).toBeVisible();

  await expect(stepCount(page)).toHaveText('8 of 8', { timeout: 15_000 });
  await page.getByTestId('quiz-faster').click();
  await expect(page.getByTestId('quiz-explanation')).toContainText('Not quite');
  await expect(page.getByTestId('lesson-complete')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('page-indicator')).toHaveText('Page 2 of 3');
  await expect(status(page)).toHaveAttribute('data-status', 'complete');

  await page.getByTestId('actions-tab').click();
  await expect(page.getByTestId('action-feed').locator('[data-state="error"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('highlights leave the notes readable', async ({ page }) => {
  await open(page);
  await ask(page, 'teach me gradient descent');
  const highlight = page.locator('[data-highlight-id="definition"]').first();
  await expect(highlight).toBeVisible({ timeout: 15_000 });
  const blend = await highlight.evaluate((el) => getComputedStyle(el.parentElement!).mixBlendMode);
  expect(blend).toBe('multiply');
});

test('the real pointer stays usable during a lesson', async ({ page }) => {
  await open(page);
  await ask(page, WALKTHROUGH);
  await expect(stepCount(page)).toHaveText('1 of 8', { timeout: 15_000 });

  const cursor = await cursorPosition(page);
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, cursor!);
  expect(hit).not.toBe('smartpath-companion-cursor');

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('115%');
  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
});

test('the idle cursor follows the pointer at an offset', async ({ page }) => {
  await open(page);
  await page.mouse.move(420, 300);
  await expect
    .poll(async () => {
      const cursor = await cursorPosition(page);
      return cursor && Math.hypot(cursor.x - 442, cursor.y - 318) < 6;
    })
    .toBe(true);
});

test('Stop cancels mid-sequence and the lesson can restart', async ({ page }) => {
  await open(page);
  await ask(page, WALKTHROUGH);
  await expect(page.getByTestId('whiteboard-svg')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('stop').click();
  await expect(status(page)).toHaveAttribute('data-status', 'stopped');
  await expect(page.getByTestId('caption')).toHaveText('Subtitles appear here during a lesson.');

  const drawn = await page.getByTestId('whiteboard-svg').getAttribute('data-step');
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('whiteboard-svg')).toHaveAttribute('data-step', drawn!);
  await expect(page.locator('[data-target-id="video-dock"]')).toHaveCount(0);

  await page.getByTestId('start').click();
  await expect(stepCount(page)).toHaveText('1 of 8', { timeout: 15_000 });
  await expect(page.locator('[data-target-id="whiteboard"]')).toHaveCount(0);
  await expect(stepCount(page)).toHaveText('8 of 8', { timeout: 45_000 });
  await page.getByTestId('quiz-overshoot').click();
  await expect(page.getByTestId('lesson-complete')).toBeVisible({ timeout: 20_000 });
});

test('Pause freezes the lesson and the whiteboard, Resume continues', async ({ page }) => {
  await open(page);
  await ask(page, WALKTHROUGH);
  await expect(stepCount(page)).toHaveText('5 of 8', { timeout: 30_000 });

  await page.getByTestId('pause').click();
  await expect(status(page)).toHaveAttribute('data-status', 'paused');
  await expect(status(page)).toHaveText('Paused');

  const running = () =>
    page.evaluate(() =>
      document
        .querySelector('[data-testid="whiteboard-svg"]')!
        .getAnimations({ subtree: true })
        .filter((animation) => animation.playState === 'running').length,
    );
  const before = await cursorPosition(page);
  await page.waitForTimeout(1500);
  await expect(stepCount(page)).toHaveText('5 of 8');
  expect(await running()).toBe(0);
  expect(await cursorPosition(page)).toEqual(before);

  await page.getByTestId('pause').click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await expect(stepCount(page)).toHaveText('6 of 8', { timeout: 20_000 });
});

test('Skip line ends narration without skipping the visuals', async ({ page }) => {
  await open(page);
  await ask(page, WALKTHROUGH);
  await expect(stepCount(page)).toHaveText('1 of 8', { timeout: 15_000 });
  await page.getByTestId('skip').click();
  await expect(page.locator('[data-highlight-id="definition"]').first()).toBeVisible({ timeout: 15_000 });
  await expect(stepCount(page)).toHaveText('2 of 8', { timeout: 15_000 });
});

test('a question mid-lesson pauses, answers and offers Resume', async ({ page }) => {
  await open(page);
  await ask(page, WALKTHROUGH);
  await expect(stepCount(page)).toHaveText('2 of 8', { timeout: 15_000 });

  await ask(page, 'Why subtract the gradient?');
  await expect(status(page)).toHaveText('Paused for your question');
  await expect(lastAnswer(page)).toContainText('The gradient points uphill');
  await expect(lastAnswer(page).getByTestId('citation')).toHaveText('Page 2');

  await page.getByTestId('pause').click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await expect(stepCount(page)).toHaveText('3 of 8', { timeout: 20_000 });
});

test('explain this: selection, chip and typed request', async ({ page }) => {
  await open(page);

  await selectPhrase(page, 'Stop when the gradient');
  await page.getByTestId('explain-chip').click();
  await expect(lastAnswer(page)).toContainText('Page 2 gives the algorithm');
  await expect(lastAnswer(page).getByTestId('citation')).toHaveText('Page 2');

  await selectPhrase(page, 'The first update gives');
  await ask(page, 'Explain this');
  await expect(lastAnswer(page)).toContainText('Plug into the update rule');
  await expect(lastAnswer(page).getByTestId('citation')).toHaveText('Page 3');
});

test('asking to explain with no selection says what to do', async ({ page }) => {
  await open(page);
  await ask(page, 'Explain this');
  await expect(lastAnswer(page)).toContainText('Select a passage in the PDF first');
});

test('saved notes persist after refresh and mark the passage', async ({ page }) => {
  await open(page);
  await selectPhrase(page, 'Gradient descent minimizes');
  await page.getByTestId('explain-chip').click();
  await expect(lastAnswer(page)).toContainText('whole method in one line');
  await ask(page, 'Save this explanation');

  await expect(page.getByTestId('note-item')).toHaveCount(1);
  await expect(page.getByTestId('note-item')).toContainText('whole method in one line');

  await page.reload();
  await expect(page.getByTestId('notes-count')).toHaveText('1');
  await expect(page.getByTestId('note-marker')).toHaveCount(1);
  await expect(page.locator('[data-pdf-page="1"] [data-testid="note-marker"]')).toBeAttached();
});

test('follow-ups point back to the exact page', async ({ page }) => {
  await open(page);
  await ask(page, 'Why subtract the gradient?');
  await expect(lastAnswer(page)).toContainText('The gradient points uphill');
  await expect(page.locator('[data-pdf-page="2"] [data-highlight-id="update_rule"]').first()).toBeVisible();
  await expect(page.getByTestId('page-indicator')).toHaveText('Page 2 of 3');

  await ask(page, 'What if the learning rate is too big?');
  await expect(lastAnswer(page)).toContainText('jump past the minimum');
  await expect(lastAnswer(page).getByTestId('citation')).toHaveText('Page 2');
});

test('unknown requests get the honest capability message', async ({ page }) => {
  await open(page);
  await ask(page, 'purple monkey dishwasher');
  await expect(lastAnswer(page)).toHaveText('I can teach gradient descent from this PDF, explain a selection, or save a note.');
  await ask(page, 'What is the capital of France?');
  await expect(lastAnswer(page)).toHaveText('I can teach gradient descent from this PDF, explain a selection, or save a note.');
});

test('the lesson survives a blocked YouTube embed', async ({ page, context }) => {
  await context.route(/youtube|ytimg/, (route) => route.abort());
  await open(page);
  await ask(page, WALKTHROUGH);

  await expect(page.getByTestId('video-play')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('video-play').click();
  await expect(page.getByTestId('video-error')).toContainText('Watch it on YouTube instead', { timeout: 12_000 });
  await expect(page.getByTestId('video-external-link')).toBeVisible();

  await expect(stepCount(page)).toHaveText('8 of 8', { timeout: 20_000 });
  await page.getByTestId('quiz-overshoot').click();
  await expect(page.getByTestId('lesson-complete')).toBeVisible({ timeout: 20_000 });
});

test('narration pauses while the video plays and resumes after', async ({ page }) => {
  await open(page);
  await ask(page, WALKTHROUGH);
  await expect(stepCount(page)).toHaveText('2 of 8', { timeout: 15_000 });

  const videoState = (state: string) =>
    page.evaluate((value) => {
      window.postMessage({ channel: 'smartpath-tutor/v1', kind: 'event', event: { type: 'VIDEO_STATE', state: value } }, location.origin);
    }, state);

  await videoState('playing');
  await expect(status(page)).toHaveText('Paused while the video plays');
  await videoState('paused');
  await expect(status(page)).toHaveAttribute('data-status', 'running');
});

test('explaining an unmapped passage keeps the student in place', async ({ page }) => {
  await open(page);
  await selectPhrase(page, 'Stop when the gradient');
  const scrolled = () => page.getByTestId('pdf-scroller').evaluate((el) => el.scrollTop);
  const before = await scrolled();
  await page.getByTestId('explain-chip').click();
  await expect(lastAnswer(page)).toContainText('Page 2 gives the algorithm');
  await page.waitForTimeout(600);
  expect(await scrolled()).toBe(before);
});

test('captions carry the lesson at real speed when speech is unavailable', async ({ page }) => {
  await open(page, '/');
  await ask(page, WALKTHROUGH);
  await expect(page.getByTestId('caption')).toContainText('I found gradient descent', { timeout: 6000 });
  await expect(stepCount(page)).toHaveText('1 of 8', { timeout: 15_000 });
  await expect(page.getByTestId('caption')).toContainText('First, we need a loss function', { timeout: 15_000 });
  await expect(stepCount(page)).toHaveText('2 of 8', { timeout: 25_000 });
});

test('an unresolved highlight shows a callout instead of claiming success', async ({ page }) => {
  await open(page);
  const ack = await page.evaluate(async () => {
    document.querySelector('[data-pdf-page="2"] .textLayer')!.replaceChildren();
    const requestId = 'test-callout';
    const reply = new Promise<Record<string, unknown>>((done) => {
      window.addEventListener('message', (event) => {
        if (event.data?.kind === 'ack' && event.data.requestId === requestId) done(event.data);
      });
    });
    window.postMessage(
      { channel: 'smartpath-tutor/v1', kind: 'command', requestId, action: { type: 'HIGHLIGHT_QUOTE', id: 'update_rule' } },
      location.origin,
    );
    return reply;
  });
  expect(ack.ok).toBe(true);
  expect(ack.fallback).toBe('callout');
  await expect(page.locator('[data-sidecar-kind="callout"]')).toContainText("couldn't find the exact passage");
  await expect(page.locator('[data-highlight-id="update_rule"]')).toHaveCount(0);
});

test('the bridge rejects actions outside the allowlist', async ({ page }) => {
  await open(page);
  const ack = await page.evaluate(async () => {
    const requestId = 'test-reject';
    const reply = new Promise<Record<string, unknown>>((done) => {
      window.addEventListener('message', (event) => {
        if (event.data?.kind === 'ack' && event.data.requestId === requestId) done(event.data);
      });
    });
    window.postMessage(
      { channel: 'smartpath-tutor/v1', kind: 'command', requestId, action: { type: 'EVAL', code: 'alert(1)' } },
      location.origin,
    );
    return reply;
  });
  expect(ack.ok).toBe(false);
  expect(ack.error).toContain('allowlist');
});

test('the toolbar action hides and restores the companion', async ({ page, context }) => {
  await open(page);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const toggle = () =>
    worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://localhost:5173/*' });
      await chrome.tabs.sendMessage(tab.id!, { type: 'TOGGLE_COMPANION' });
    });

  await toggle();
  await expect(page.getByTestId('companion-panel')).toBeHidden();
  await toggle();
  await expect(page.getByTestId('companion-panel')).toBeVisible();
});

test.describe('with the AI proxy running', () => {
  let upstream: Server;
  let proxy: Server;

  test.beforeAll(async () => {
    upstream = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        const content = JSON.stringify({ answer: 'Live: momentum is not covered in these notes.', citedPage: 9 });
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    await new Promise<void>((done) => upstream.listen(8788, '127.0.0.1', done));
    proxy = createProxy({ apiKey: 'test-key', model: 'test-model', baseUrl: 'http://127.0.0.1:8788' });
    await new Promise<void>((done) => proxy.listen(8787, '127.0.0.1', done));
  });

  test.afterAll(() => {
    proxy.close();
    upstream.close();
  });

  test('routes questions through the service worker and validates citations', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('ai-badge')).toHaveText('AI: live');
    await ask(page, 'Does momentum help here?');
    await expect(lastAnswer(page)).toContainText('Live: momentum is not covered');
    await expect(lastAnswer(page)).toContainText('Generated from your notes');
    // The model cited page 9, which doesn't exist, so no citation is shown.
    await expect(lastAnswer(page).getByTestId('citation')).toHaveCount(0);
  });
});
