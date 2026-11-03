import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: 'localhost',
    port: 5173,
    // The extension's origin allowlist depends on this exact port.
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: { host: 'localhost', port: 5173, strictPort: true },
});
