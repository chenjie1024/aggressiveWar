// 生成 PWA 图标（纯 Node，无依赖）：深蓝底 + 金色环 + 中央红块
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawIcon, encodePng } from './lib/png.mjs';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/web/public');
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const file = resolve(outDir, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log('wrote', file);
}
