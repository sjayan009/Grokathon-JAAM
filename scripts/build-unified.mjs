// Builds the Cursor Tutor into the unified app: workspace -> mock-app/tutor/, companion -> extension/tutor-content.js.
// Both outputs are committed, so the unified app runs with just `python server/p2_server.py` (no npm needed).
import { execSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  root: resolve(root, 'mock-smartpath'),
  configFile: resolve(root, 'mock-smartpath/vite.config.ts'),
  base: '/tutor/',
  build: { outDir: resolve(root, 'mock-app/tutor'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
execSync('npm run build -w chrome-extension', { cwd: root, stdio: 'inherit' });
copyFileSync(resolve(root, 'chrome-extension/dist/content.js'), resolve(root, 'extension/tutor-content.js'));
console.log('Unified build done: mock-app/tutor/ + extension/tutor-content.js');
