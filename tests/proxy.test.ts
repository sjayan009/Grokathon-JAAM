import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProxy } from '../optional-ai-proxy/handler.ts';

const listen = (server: Server) =>
  new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });

const askBody = {
  question: 'Why subtract?',
  page: 2,
  whiteboardStep: null,
  selection: null,
  snippets: [{ page: 2, text: 'notes' }],
};

describe('AI proxy', () => {
  let upstream: Server;
  let upstreamUrl: string;
  let proxy: Server;
  let proxyUrl: string;
  let seen: { auth?: string; body?: { model: string; messages: { content: string }[] } } = {};
  let reply = JSON.stringify({ answer: 'Because of the slope.', citedPage: 2 });

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    upstream = createServer((request, response) => {
      seen.auth = request.headers.authorization;
      if (request.url === '/models') {
        response.end(
          JSON.stringify({
            data: [
              { id: 'gpt-old-mini', created: 1 },
              { id: 'gpt-4o-mini', created: 5 },
              { id: 'gpt-9.1-mini', created: 9 },
              { id: 'gpt-9.1', created: 10 },
              { id: 'o1-mini', created: 11 },
            ],
          }),
        );
        return;
      }
      let raw = '';
      request.on('data', (chunk) => (raw += chunk));
      request.on('end', () => {
        seen.body = JSON.parse(raw);
        response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
      });
    });
    upstreamUrl = await listen(upstream);
    proxy = createProxy({ apiKey: 'test-key', model: undefined, baseUrl: upstreamUrl });
    proxyUrl = await listen(proxy);
  });

  afterAll(() => {
    upstream.close();
    proxy.close();
    vi.restoreAllMocks();
  });

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${proxyUrl}${path}`, { method: 'POST', body: JSON.stringify(body), headers });

  it('reports live when a key is set', async () => {
    expect(await (await fetch(`${proxyUrl}/health`)).json()).toEqual({ live: true });
  });

  it('answers through the upstream and picks the newest mini model', async () => {
    const response = await post('/ask', askBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: 'Because of the slope.', citedPage: 2 });
    expect(seen.auth).toBe('Bearer test-key');
    expect(seen.body?.model).toBe('gpt-9.1-mini');
    expect(seen.body?.messages[1].content).toContain('[Page 2]');
  });

  it('validates classification against the intent enum', async () => {
    reply = JSON.stringify({ intent: 'DELETE_EVERYTHING' });
    expect(await (await post('/classify', { text: 'hello' })).json()).toEqual({ intent: 'UNKNOWN' });
    reply = JSON.stringify({ intent: 'PAUSE' });
    expect(await (await post('/classify', { text: 'hold it' })).json()).toEqual({ intent: 'PAUSE' });
  });

  it('rejects websites that try to spend the key', async () => {
    const response = await post('/ask', askBody, { Origin: 'https://evil.example' });
    expect(response.status).toBe(403);
  });

  it('allows the extension and the workspace', async () => {
    reply = JSON.stringify({ answer: 'ok', citedPage: null });
    expect((await post('/ask', askBody, { Origin: 'chrome-extension://abc' })).status).toBe(200);
    expect((await post('/ask', askBody, { Origin: 'http://localhost:5173' })).status).toBe(200);
  });

  it.each([
    [{ ...askBody, question: '' }],
    [{ ...askBody, question: 'x'.repeat(3000) }],
    [{ ...askBody, snippets: [] }],
    [{ ...askBody, snippets: [{ page: 'one', text: 1 }] }],
  ])('rejects a malformed request', async (body) => {
    expect((await post('/ask', body)).status).toBe(400);
  });

  it('reports not live and refuses to call upstream without a key', async () => {
    const keyless = createProxy({ apiKey: undefined, model: 'm', baseUrl: upstreamUrl });
    const url = await listen(keyless);
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ live: false });
    const response = await fetch(`${url}/ask`, { method: 'POST', body: JSON.stringify(askBody) });
    expect(response.status).toBe(503);
    keyless.close();
  });
});
