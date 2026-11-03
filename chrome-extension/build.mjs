// Bundles the extension into dist/. MV3 content scripts can't be ES modules, so
// content.js is an IIFE with React and the lesson fixture inlined.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, 'dist');
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(here, 'manifest.json'), resolve(dist, 'manifest.json'));
cpSync(resolve(here, 'public/icons'), resolve(dist, 'icons'), { recursive: true });

const options = {
  entryPoints: { content: resolve(here, 'src/content.ts'), background: resolve(here, 'src/background.ts') },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
