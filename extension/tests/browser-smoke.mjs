/**
 * Loads the unpacked MV3 extension against the mock study tab.
 * Run with puppeteer-core available, for example:
 *   NODE_PATH=/tmp/ext-browser/node_modules node extension/tests/browser-smoke.mjs
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extensionPath = path.join(root, 'extension');
const chromePath = process.env.CHROME_PATH || '/tmp/chromium/chromium/linux-1733507/chrome-linux/chrome';
const port = 5173;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/fixtures/demo.json`);
      if (response.ok) return;
    } catch { /* server still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('mock server did not start');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', path.join(root, 'mock-app')], {
  stdio: 'ignore',
});

try {
  await waitForServer();
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'smartpath-ext-'));
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    pipe: true,
    enableExtensions: [extensionPath],
    userDataDir,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('#extension-status')?.textContent?.includes('Chrome extension connected'), { timeout: 8000 });
    const detected = await page.evaluate(() => {
      const host = document.querySelector('[data-smartpath-extension-root]');
      return {
        documentId: host?.dataset.documentId || '',
        phase: host?.dataset.runPhase || '',
        connected: document.querySelector('#extension-status')?.textContent || '',
      };
    });
    if (detected.documentId !== 'demo-lc3') throw new Error(`expected demo-lc3, got ${JSON.stringify(detected)}`);
    if (detected.phase !== 'observing') throw new Error(`expected observing, got ${detected.phase}`);

    await page.mouse.move(220, 180);
    await delay(700);
    const follow = await page.evaluate(() => {
      const host = document.querySelector('[data-smartpath-extension-root]');
      return { x: Number(host.dataset.cursorX), y: Number(host.dataset.cursorY), state: host.dataset.cursorState };
    });
    const followError = Math.hypot(follow.x - (220 + 18), follow.y - (180 + 12));
    if (followError > 3) throw new Error(`follower missed the pointer by ${followError.toFixed(2)}px (${JSON.stringify(follow)})`);
    if (follow.state !== 'following') throw new Error(`expected following cursor, got ${follow.state}`);

    await page.evaluate(() => {
      window.__aimError = Infinity;
      const host = document.querySelector('[data-smartpath-extension-root]');
      window.__aimTimer = setInterval(() => {
        const anchor = document.querySelector('[data-anchor-id="ldr_instruction"]');
        if (!host || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const error = Math.hypot(Number(host.dataset.cursorX) - (rect.left - 8), Number(host.dataset.cursorY) - (rect.top + rect.height / 2));
        if (error < window.__aimError) window.__aimError = error;
      }, 16);
      const origin = location.origin;
      window.postMessage({ source: 'smartpath-mock-app', type: 'lesson_started', runId: 'browser-aim', planId: 'ldr' }, origin);
      window.postMessage({
        source: 'smartpath-mock-app',
        type: 'action_request',
        requestId: 'aim-1',
        step: { kind: 'highlight_pdf', targetId: 'ldr_instruction' },
      }, origin);
    });
    await page.waitForFunction(() => document.querySelector('[data-anchor-id="ldr_instruction"]')?.dataset.active === 'true', { timeout: 5000 });
    await delay(200);
    const aimError = await page.evaluate(() => {
      clearInterval(window.__aimTimer);
      return window.__aimError;
    });
    if (!(aimError <= 3)) throw new Error(`cursor did not land on ldr_instruction (min error ${aimError})`);

    await page.evaluate(() => {
      window.__results = [];
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (data?.source === 'smartpath-live-extension' && data.type === 'action_result') window.__results.push(data);
      });
      window.__cancels = 0;
      const original = speechSynthesis.cancel.bind(speechSynthesis);
      speechSynthesis.cancel = () => {
        window.__cancels += 1;
        return original();
      };
      speechSynthesis.speak(new SpeechSynthesisUtterance('stop me'));
      const origin = location.origin;
      window.postMessage({ source: 'smartpath-mock-app', type: 'lesson_started', runId: 'browser-stop', planId: 'ldr' }, origin);
      window.postMessage({
        source: 'smartpath-mock-app',
        type: 'action_request',
        requestId: 'stop-inflight',
        step: { kind: 'highlight_pdf', targetId: 'memory_definition' },
      }, origin);
    });
    await delay(40);
    const serviceWorkers = await browser.targets();
    const workerTarget = serviceWorkers.find((target) => target.type() === 'service_worker');
    if (!workerTarget) throw new Error('extension service worker was not found');
    const worker = await workerTarget.worker();
    const stopResult = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1:5173/*' });
      if (!tab?.id) return { ok: false, error: 'no tab' };
      return chrome.tabs.sendMessage(tab.id, { type: 'control', command: 'stop', tabId: tab.id });
    });
    if (!stopResult?.ok || stopResult.phase !== 'cancelled') throw new Error(`stop was not accepted: ${JSON.stringify(stopResult)}`);
    await delay(400);
    const stopped = await page.evaluate(() => ({
      memory: document.querySelector('[data-anchor-id="memory_definition"]')?.dataset.active,
      cancels: window.__cancels,
      results: window.__results,
      phase: document.querySelector('[data-smartpath-extension-root]')?.dataset.runPhase,
      caption: document.querySelector('#caption-title')?.textContent,
    }));
    if (stopped.memory === 'true') throw new Error('stop did not prevent the in-flight anchor click');
    if (stopped.phase !== 'cancelled') throw new Error(`phase after stop was ${stopped.phase}`);
    if (!(stopped.cancels >= 1)) throw new Error('speechSynthesis.cancel was not called on the page');
    await page.evaluate(() => {
      window.postMessage({
        source: 'smartpath-mock-app',
        type: 'action_request',
        requestId: 'after-stop',
        step: { kind: 'highlight_pdf', targetId: 'pointer_definition' },
      }, location.origin);
    });
    await delay(500);
    const late = await page.evaluate(() => ({
      pointer: document.querySelector('[data-anchor-id="pointer_definition"]')?.dataset.active,
      results: window.__results.filter((item) => item.requestId === 'after-stop' || item.requestId === 'stop-inflight'),
    }));
    if (late.pointer === 'true') throw new Error('a request after Stop still changed the page');
    const rejected = late.results.filter((item) => item.ok === false);
    if (rejected.length < 1) throw new Error(`expected a rejected action_result, got ${JSON.stringify(late.results)}`);
    if (pageErrors.length) throw new Error(pageErrors.join('\n'));
    console.log('PASS: extension detected demo-lc3, follower offset, aim error', aimError.toFixed(2), 'px, stop blocked late actions');
    console.log('stop result', JSON.stringify(stopResult));
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
