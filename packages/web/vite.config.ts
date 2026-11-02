import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // 相对路径：既能挂在网站根目录，也能被 Android WebView 以 file:/// 加载
  base: './',
  build: {
    // WebView 与桌面浏览器都支持，避免多余的兼容降级
    target: 'es2020',
    assetsDir: 'assets',
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@gongfa-war/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5272,
    host: '127.0.0.1',
    watch: {
      // Windows 下避免 EBUSY 文件监听崩溃
      usePolling: true,
      interval: 500,
    },
  },
});
