import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts', 'tutor-core/src/**/*.test.ts'] },
});
