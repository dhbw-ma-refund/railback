import { defineConfig } from 'vitest/config.js';

export default defineConfig({
  test: {
    globals: true,
    include: ['**/test/**/*.spec.ts', '**/tests/**/*.spec.ts'],
  },
});
