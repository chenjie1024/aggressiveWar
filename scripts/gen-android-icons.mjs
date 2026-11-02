// 生成 Android 启动图标（普通 mipmap + 自适应图标前景层），纯 Node 无依赖
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawIcon, encodePng } from './lib/png.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resDir = resolve(root, 'android/app/src/main/res');

/** 各密度下 launcher 图标边长（48dp 基准） */
const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];

/** 自适应图标前景层：108dp，图案缩到安全区（约 66%） */
const FOREGROUND_DENSITIES = [
  ['mdpi', 108],
  ['hdpi', 162],
  ['xhdpi', 216],
  ['xxhdpi', 324],
  ['xxxhdpi', 432],
];

for (const [density, size] of DENSITIES) {
  const dir = resolve(resDir, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, 'ic_launcher.png');
  writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log('wrote', file);
}

for (const [density, size] of FOREGROUND_DENSITIES) {
  const dir = resolve(resDir, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, 'ic_launcher_foreground.png');
  writeFileSync(file, encodePng(size, drawIcon(size, true, 0.68)));
  console.log('wrote', file);
}

const anydpi = resolve(resDir, 'mipmap-anydpi-v26');
mkdirSync(anydpi, { recursive: true });
const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  writeFileSync(resolve(anydpi, name), xml);
  console.log('wrote', resolve(anydpi, name));
}
