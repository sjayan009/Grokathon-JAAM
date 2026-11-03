import { createProxy, loadConfig } from './handler.ts';

const PORT = 8787;
const config = loadConfig();

createProxy(config).listen(PORT, '127.0.0.1', () => {
  console.log(`AI proxy on http://localhost:${PORT} (${config.apiKey ? 'live' : 'no OPENAI_API_KEY, reporting scripted mode'})`);
});
