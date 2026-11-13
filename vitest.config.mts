import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  // 87 files run in parallel and each opens its own database: under load a test can pass 5 s (the default) and
  // time out though it passes alone. 20 s leaves room without hiding a real hang.
  test: { environment: 'node', include: ['lib/**/*.test.ts'], testTimeout: 20_000, hookTimeout: 20_000 },
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') } },
});
