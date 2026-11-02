import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const coreSrc = fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url));
const serverAppSrc = fileURLToPath(new URL('./packages/server/src/app.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@gongfa-war/core': coreSrc,
      '@gongfa-war/server': serverAppSrc,
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
