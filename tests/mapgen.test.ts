import { describe, expect, it } from 'vitest';
import { Game, MAP_H, MAP_W, buildLandMask } from '@gongfa-war/core';

describe('mapgen 世界地图模板', () => {
  it('区域数量与玩家数量正确，且每名玩家有领地', () => {
    const game = new Game({ seed: 123, regionCount: 28, opponents: 2, difficulty: 'normal', turnLimit: 60 });
    const s = game.state;
    expect(s.regions).toHaveLength(28);
    expect(s.players).toHaveLength(3);
    for (const p of s.players) {
      expect(s.regions.filter((r) => r.owner === p.id).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('每个区域有单元/中心/邻接，且邻接关系对称', () => {
    const game = new Game({ seed: 456, regionCount: 24, opponents: 1, difficulty: 'normal', turnLimit: 60 });
    const s = game.state;
    for (const r of s.regions) {
      expect(r.cells.length).toBeGreaterThan(0);
      expect(r.neighbors.length).toBeGreaterThan(0);
      for (const n of r.neighbors) {
        expect(s.regions[n].neighbors).toContain(r.id);
      }
      for (const c of r.cells) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(MAP_W);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeLessThan(MAP_H);
      }
      // 中心必须落在该区域自己的格子上（否则徽标会漂到海面上）
      expect(r.cells.some((c) => c.x + 0.5 === r.center.x && c.y + 0.5 === r.center.y)).toBe(true);
    }
  });

  it('陆地单元都被区域覆盖（海洋不属于任何区域）', () => {
    const game = new Game({ seed: 789, regionCount: 20, opponents: 1, difficulty: 'normal', turnLimit: 60 });
    const land = buildLandMask();
    const landCount = land.reduce((sum: number, v) => sum + v, 0);
    const covered = game.state.regions.reduce((sum, r) => sum + r.cells.length, 0);
    expect(covered).toBe(landCount);
    expect(landCount).toBeLessThan(MAP_W * MAP_H); // 确有海洋
  });

  it('区域邻接图连通（跨大陆有海路）', () => {
    const game = new Game({ seed: 555, regionCount: 28, opponents: 2, difficulty: 'normal', turnLimit: 60 });
    const regions = game.state.regions;
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length) {
      const id = queue.shift()!;
      for (const n of regions[id].neighbors) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(regions.length);
  });

  it('起始领地公平：每人一座首都且领地数一致', () => {
    const game = new Game({ seed: 321, regionCount: 28, opponents: 1, difficulty: 'normal', turnLimit: 60 });
    const s = game.state;
    for (const p of s.players) {
      expect(s.regions.filter((r) => r.owner === p.id && r.type === 'city')).toHaveLength(1);
    }
    const counts = s.players.map((p) => s.regions.filter((r) => r.owner === p.id).length);
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBeGreaterThanOrEqual(3);
  });

  it('多组种子下起始领地都公平', () => {
    for (const seed of [1, 7, 42, 123, 2024, 90210]) {
      const game = new Game({ seed, regionCount: 28, opponents: 2, difficulty: 'normal', turnLimit: 60 });
      const s = game.state;
      const counts = s.players.map((p) => s.regions.filter((r) => r.owner === p.id).length);
      expect(new Set(counts).size, `seed ${seed} 起始领地不一致: ${counts.join(',')}`).toBe(1);
      expect(counts[0]).toBeGreaterThanOrEqual(3);
    }
  });

  it('生成特殊区域（兵营/要塞/宝库）', () => {
    const game = new Game({ seed: 654, regionCount: 28, opponents: 1, difficulty: 'normal', turnLimit: 60 });
    const withFacilities = game.state.regions.filter((r) => r.specials.length > 0);
    expect(withFacilities.length).toBeGreaterThan(0);
    for (const r of withFacilities) {
      // 开局每个区域只带一种，且必须是合法类型
      expect(r.specials.length).toBe(1);
      expect(['barracks', 'fortress', 'treasury']).toContain(r.specials[0]);
    }
  });

  it('存档向后兼容：旧版 single special 字段迁移成数组', () => {
    const game = new Game({ seed: 655, regionCount: 20, opponents: 1, difficulty: 'normal', turnLimit: 60 });
    const raw = JSON.parse(game.serialize()) as {
      regions: Record<string, unknown>[];
    };
    // 模拟 v7 存档：删掉 specials，塞回旧的 special
    for (const r of raw.regions) {
      const list = r.specials as string[] | undefined;
      delete r.specials;
      if (list && list.length) r.special = list[0];
    }
    const reloaded = Game.deserialize(JSON.stringify(raw));
    const migrated = reloaded.state.regions.filter((r) => r.specials.length > 0);
    expect(migrated.length).toBe(game.state.regions.filter((r) => r.specials.length > 0).length);
    expect(reloaded.state.regions.every((r) => Array.isArray(r.specials))).toBe(true);
  });

  it('玩家国家与所选一致，各国不重复', () => {
    const game = new Game({
      seed: 111,
      regionCount: 24,
      opponents: 3,
      difficulty: 'normal',
      turnLimit: 60,
      nationId: 'rome',
    });
    const s = game.state;
    expect(s.players[0].nationId).toBe('rome');
    expect(s.players[0].name).toBe('罗马');
    const ids = s.players.map((p) => p.nationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
