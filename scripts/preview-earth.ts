// 把地球模板的陆地掩码打成 ASCII，检查是否认得出来（开发自检用）
import { MAP_H, MAP_W, earthLandMask } from '@gongfa-war/core';

const mask = earthLandMask();
let land = 0;
const lines: string[] = [];
for (let y = 0; y < MAP_H; y++) {
  let row = '';
  for (let x = 0; x < MAP_W; x++) {
    const on = mask[y * MAP_W + x] === 1;
    if (on) land++;
    row += on ? '#' : '.';
  }
  lines.push(row);
}
console.log(lines.join('\n'));
console.log(`\n陆地占比 ${((land / (MAP_W * MAP_H)) * 100).toFixed(1)}%  (${land}/${MAP_W * MAP_H})`);
