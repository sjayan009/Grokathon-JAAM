import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { createProxy } from '../optional-ai-proxy/handler.ts';

const WIDTHS = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '1920', viewport: { width: 1920, height: 1080 } },
];

for (const { name, viewport } of WIDTHS) {
  test(`full lesson, embedded simulation, ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      // The optional proxy isn't running here, so /api/health returning 502 is expected.
      if (message.type() === 'error' && !message.text().includes('502')) errors.push(message.text());
    });

    await page.setViewportSize(viewport);
    await page.goto('/?tutorSpeed=3');
    await expect(page.getByTestId('page-indicator')).toHaveText('Page 1 of 3');
    await page.getByTestId('run-embedded').click();
    await page.screenshot({ path: `e2e/screenshots/${name}-0-start.png` });

    await page.getByTestId('prompt').fill('Could you walk me through gradient descent using my lecture notes?');
    await page.getByTestId('send').click();

    const steps = page.getByTestId('step-count');
    for (let step = 1; step <= 8; step += 1) {
      await expect(steps).toHaveText(`${step} of 8`, { timeout: 30_000 });
      await page.waitForTimeout(step === 8 ? 900 : 700);
      await page.screenshot({ path: `e2e/screenshots/${name}-${step}.png` });
    }

    await expect(page.locator('[data-highlight-id="definition"]').first()).toBeVisible();
    await expect(page.locator('[data-highlight-id="update_rule"]').first()).toBeVisible();
    await expect(page.locator('[data-highlight-id="learning_rate"]').first()).toBeVisible();

    await page.getByTestId('quiz-overshoot').click();
    await expect(page.getByTestId('quiz-explanation')).toContainText("That's right");
    await expect(page.getByTestId('lesson-complete')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `e2e/screenshots/${name}-9-done.png` });
    expect(errors).toEqual([]);
  });
}

test('the embedded simulation reaches the proxy through Vite', async ({ page }) => {
  const upstream = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      const content = JSON.stringify({ answer: 'Live answer from the proxy.', citedPage: 2 });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  const proxy = createProxy({ apiKey: 'test-key', model: 'test-model', baseUrl: 'http://127.0.0.1:8788' });
  await new Promise<void>((done) => upstream.listen(8788, '127.0.0.1', done));
  await new Promise<void>((done) => proxy.listen(8787, '127.0.0.1', done));

  try {
    await page.goto('/?tutorSpeed=4');
    await page.getByTestId('run-embedded').click();
    await expect(page.getByTestId('ai-badge')).toHaveText('AI: live');
    await page.getByTestId('prompt').fill('Does momentum help here?');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('assistant-message').last()).toContainText('Live answer from the proxy.');
    await expect(page.getByTestId('assistant-message').last().getByTestId('citation')).toHaveText('Page 2');
  } finally {
    proxy.close();
    upstream.close();
  }
});
