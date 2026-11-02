// 地球模板自检：生成地图 → 检查区域数 / 连通性 / 海路数量 / AI 对局能否正常结束
import { Game, MAP_H, MAP_W, earthLandMask, generateMap } from '@gongfa-war/core';
import { createRng } from '@gongfa-war/core';

const mask = earthLandMask();
let land = 0;
for (let i = 0; i < mask.length; i++) land += mask[i];
console.log(`陆地 ${land}/${MAP_W * MAP_H} = ${((land / (MAP_W * MAP_H)) * 100).toFixed(1)}%`);

for (const regionCount of [20, 28, 44]) {
  const rng = createRng(1234 + regionCount);
  const gen = generateMap(
    { seed: 1234 + regionCount, regionCount, opponents: 2, difficulty: 'normal', template: 'earth' },
    rng,
  );
  // 邻接连通性（BFS）
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of gen.regions[id].neighbors) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  const seaRoutes = gen.regions.reduce((n, r) => n + r.seaNeighbors.length, 0) / 2;
  const cells = gen.regions.map((r) => r.cells.length);
  console.log(
    `${regionCount} 区：生成 ${gen.regions.length}，连通 ${seen.size === gen.regions.length ? '✅' : '❌ (' + seen.size + ')'}，` +
      `海路 ${seaRoutes}，每区格子 min/avg/max = ${Math.min(...cells)}/${Math.round(cells.reduce((a, b) => a + b, 0) / cells.length)}/${Math.max(...cells)}`,
  );
}

// 跑一局全 AI 对战，确认能正常推进
const game = new Game({ seed: 99, regionCount: 28, opponents: 2, difficulty: 'normal', template: 'earth', turnLimit: 100 });
let guard = 0;
while (!game.state.gameOver && guard++ < 4000) game.endTurn();
console.log(
  `AI 对局：${guard} 次 endTurn 后 gameOver=${game.state.gameOver} 回合=${game.state.turn} 胜者=${game.state.winner} ` +
    `中立剩余=${game.state.regions.filter((r) => r.owner < 0).length}`,
);
console.log(`纬度带：南极行数 = ${Array.from({ length: MAP_H }, (_, y) => mask[y * MAP_W + 3]).filter(Boolean).length}`);
