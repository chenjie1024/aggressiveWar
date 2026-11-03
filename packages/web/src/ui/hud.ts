import {
  ACHIEVEMENTS,
  ACTIONS_PER_TURN,
  BUILD_SPECIAL_COST,
  INTEL_STALE_TURNS,
  REGION_DEFENSE,
  REGION_ICONS,
  REGION_NAMES,
  REGION_PRODUCTION,
  SCOUT_COST,
  SEASONS,
  SPECIAL_BONUS,
  SPECIAL_ICONS,
  SPECIAL_ORDER,
  WEATHERS,
  nationEmoji,
  policiesFor,
  regionCount,
  territoryBonusFor,
  underdogBonusFor,
  type GameState,
  type Season,
  type Weather,
} from '@gongfa-war/core';
import { ownerColor } from '../render/mapRenderer';
import { escapeHtml } from '../escape';

export interface HudHandlers {
  onEndTurn(): void;
  onSave(): void;
  onLoad(): void;
  onMenu(): void;
  onBuild(regionId: number, kind: 'barracks' | 'fortress' | 'treasury'): void;
  /** 切换背景音乐，返回切换后的静音状态 */
  onToggleMusic(): boolean;
  /** 取消当前选中（手机端右侧面板的 ✕） */
  onClearSelection(): void;
  /** 打开操作说明 */
  onHelp(): void;
  /** 缩放到全图 */
  onFitMap(): void;
  /** 回到首都 */
  onHome(): void;
}

/** 战争迷雾视图（on=false 表示未开启，visible/known 为全图） */
export interface FogView {
  on: boolean;
  visible: Set<number>;
  known: Set<number>;
}

export class Hud {
  private handlers: HudHandlers;
  private selKey = '';
  private forcesSig = '';
  private logSig = '';
  private achvSig = '\u0000init'; // 不能用 ''（空成就集合的签名也是 ''，会被误判为"没变化"）
  /** 成就列表（左栏 / 手机抽屉共用） */
  renderAchievements(unlocked: Set<string>): void {
    const list = document.getElementById('achv-list');
    const count = document.getElementById('achv-count');
    if (!list || !count) return;
    const sig = [...unlocked].sort().join(',');
    if (sig === this.achvSig) return;
    this.achvSig = sig;
    count.textContent = `${unlocked.size}/${ACHIEVEMENTS.length}`;
    list.innerHTML = ACHIEVEMENTS.map((a) => {
      const on = unlocked.has(a.id);
      return `<div class="achv ${on ? 'on' : ''}">
        <span class="achv-icon">${on ? a.icon : '🔒'}</span>
        <div class="achv-main">
          <div class="achv-name">${a.name}</div>
          <div class="muted">${a.desc}</div>
        </div>
      </div>`;
    }).join('');
  }

  /** 手机端抽屉（战况 / 势力 / 战报 / 存档入口） */
  private drawer: HTMLElement | null = null;
  private drawerBackdrop: HTMLElement | null = null;
  drawerOpen = false;
  /** 战争迷雾：当前可见 / 已探索区域（人类视角），on=false 时表示未开启 */
  private fog: FogView = { on: false, visible: new Set(), known: new Set() };
  /** 战斗记录是否展开全部回合（默认只显示最近 3 个回合） */
  private logAll = (() => {
    try {
      return localStorage.getItem('gongfa-war.logAll') === '1';
    } catch {
      return false;
    }
  })();
  /** 最近一次渲染用的状态（折叠开关需要它来重绘） */
  private lastState: GameState | null = null;
  /** 我方席位（联机时可能不是 0） */
  private mySeat = 0;

  constructor(handlers: HudHandlers) {
    this.handlers = handlers;
    this.build();
  }

  private build(): void {
    const app = document.getElementById('app')!;

    const hud = document.createElement('div');
    hud.id = 'hud';
    // 桌面：完整信息芯片 + 全部按钮；手机：只留 行动/回合 芯片 + ☰ + 🔊 + 结束回合（其余进抽屉）
    hud.innerHTML = `
      <button id="btn-drawer" class="mob-only" aria-label="战况面板">☰</button>
      <div class="res mob-only" id="hud-chip">🚩 <span class="js-move">10/10</span> · 🔄 <span class="js-turn">1</span> · <span class="js-env"></span></div>
      <div class="res mob-only" id="hud-now">当前：<span class="js-current">-</span></div>
      <div class="res desk-only">🔄 回合 <span class="js-turn">1</span></div>
      <div class="res desk-only">当前：<span class="js-current">-</span></div>
      <div class="res desk-only">🚩 行动 <span class="js-move">10/10</span></div>
      <div class="res desk-only js-env"></div>
      <div class="res desk-only js-policy"></div>
      <div class="spacer"></div>
      <button id="btn-music" title="背景音乐开关">🔊</button>
      <button class="primary" id="btn-end">结束回合</button>
      <button class="desk-only" id="btn-save">保存</button>
      <button class="desk-only" id="btn-load">读档</button>
      <button class="desk-only" id="btn-menu">菜单</button>`;
    app.appendChild(hud);

    // 小地图 + 视图控制（全图 / 回首都）；手机上可整体收起，省下竖向空间给地图
    const mapctl = document.createElement('div');
    mapctl.id = 'mapctl';
    mapctl.innerHTML = `
      <div class="maprow">
        <button class="small" id="btn-fit" title="缩放到全图">🗺️ 全图</button>
        <button class="small" id="btn-home" title="回到首都">🏰 首都</button>
        <button class="small mob-only" id="btn-maptoggle" title="收起 / 展开小地图">▾</button>
      </div>
      <canvas id="minimap" width="72" height="40"></canvas>`;
    app.appendChild(mapctl);

    const backdrop = document.createElement('div');
    backdrop.id = 'drawer-backdrop';
    backdrop.className = 'hidden';
    app.appendChild(backdrop);
    this.drawerBackdrop = backdrop;

    const left = document.createElement('div');
    left.id = 'leftpanel';
    // 三段式：固定头部（战况/关闭） + 可滚动主体（三块面板） + 固定底部（存档/菜单）
    // 这样按钮永远待在原处，不会随面板内容增减上下跳。
    left.innerHTML = `
      <div class="drawer-head mob-only">
        <b>战况</b>
        <span class="muted js-policy" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        <button class="small" id="btn-drawer-close" aria-label="关闭">✕</button>
      </div>
      <div class="drawer-body">
        <div class="panelbox pb-forces" data-panel="forces">
          <h3><span class="fold">▾</span> 势力详情</h3>
          <div id="forces"></div>
        </div>
        <div class="panelbox pb-log" data-panel="log">
          <h3><span class="fold">▾</span> 战斗记录 <span id="log-count" class="muted"></span>
            <button class="small log-toggle" id="log-toggle" style="display:none;margin-left:auto"></button>
          </h3>
          <div id="log-list"></div>
        </div>
        <div class="panelbox pb-achv" data-panel="achv">
          <h3><span class="fold">▾</span> 🏆 成就 <span id="achv-count" class="muted"></span></h3>
          <div id="achv-list"></div>
        </div>
      </div>
      <div class="drawer-actions mob-only">
        <button id="btn-save-m">💾 保存</button>
        <button id="btn-load-m">📂 读档</button>
        <button id="btn-menu-m">☰ 主菜单</button>
        <button id="btn-help-m">❔ 操作说明</button>
      </div>`;
    app.appendChild(left);
    this.drawer = left;

    // 面板折叠：点标题即可收起/展开（手机上比"层层嵌套滚动"好用得多）
    left.querySelectorAll<HTMLElement>('.panelbox > h3').forEach((h) => {
      h.addEventListener('click', () => {
        const box = h.parentElement;
        if (!box) return;
        const folded = box.classList.toggle('folded');
        const arrow = h.querySelector('.fold');
        if (arrow) arrow.textContent = folded ? '▸' : '▾';
      });
    });

    const side = document.createElement('div');
    side.id = 'sidepanel';
    app.appendChild(side);

    const hint = document.createElement('div');
    hint.id = 'rotate-hint';
    hint.innerHTML = '<span>📱 竖屏视野较窄，横过来更好操作</span><button class="small" id="btn-hint-close">知道了</button>';
    app.appendChild(hint);
    hint.querySelector('#btn-hint-close')!.addEventListener('click', () => hint.classList.add('hidden'));

    hud.querySelector('#btn-end')!.addEventListener('click', () => this.handlers.onEndTurn());
    hud.querySelector('#btn-music')!.addEventListener('click', (e) => {
      const muted = this.handlers.onToggleMusic();
      (e.currentTarget as HTMLButtonElement).textContent = muted ? '🔇' : '🔊';
    });
    hud.querySelector('#btn-save')!.addEventListener('click', () => this.handlers.onSave());
    hud.querySelector('#btn-load')!.addEventListener('click', () => this.handlers.onLoad());
    hud.querySelector('#btn-menu')!.addEventListener('click', () => this.handlers.onMenu());
    hud.querySelector('#btn-drawer')!.addEventListener('click', () => this.setDrawer(!this.drawerOpen));
    mapctl.querySelector('#btn-fit')!.addEventListener('click', () => this.handlers.onFitMap());
    mapctl.querySelector('#btn-home')!.addEventListener('click', () => this.handlers.onHome());
    mapctl.querySelector('#btn-maptoggle')!.addEventListener('click', () => this.toggleMinimap());
    left.querySelector('#btn-drawer-close')!.addEventListener('click', () => this.setDrawer(false));
    left.querySelector('#btn-save-m')!.addEventListener('click', () => this.handlers.onSave());
    left.querySelector('#btn-load-m')!.addEventListener('click', () => this.handlers.onLoad());
    left.querySelector('#btn-menu-m')!.addEventListener('click', () => this.handlers.onMenu());
    left.querySelector('#btn-help-m')!.addEventListener('click', () => this.handlers.onHelp());
    backdrop.addEventListener('click', () => this.setDrawer(false));
  }

  /** 抽屉（手机端的战况 / 势力 / 战报 / 存档入口） */
  setDrawer(open: boolean): void {
    if (!this.drawer) return;
    this.drawerOpen = open;
    this.drawer.classList.toggle('open', open);
    this.drawerBackdrop?.classList.toggle('hidden', !open);
    // 抽屉打开时收起右侧详情面板：否则左右夹击，地图只剩一条缝
    document.body.classList.toggle('drawer-open', open);
  }

  /** 小地图收起 / 展开（手机端省竖向空间），状态记在本地 */
  setMinimapCollapsed(collapsed: boolean): void {
    const ctl = document.getElementById('mapctl');
    ctl?.classList.toggle('collapsed', collapsed);
    const btn = document.getElementById('btn-maptoggle');
    if (btn) btn.textContent = collapsed ? '▴' : '▾';
    try {
      localStorage.setItem('gongfa-war.minimap', collapsed ? '0' : '1');
    } catch {
      /* 隐私模式 */
    }
  }

  toggleMinimap(): void {
    const ctl = document.getElementById('mapctl');
    this.setMinimapCollapsed(!ctl?.classList.contains('collapsed'));
  }

  /** 本回合行动上限（含后勤政策） */
  private actionLimit(state: GameState, playerId: number): number {
    const pol = policiesFor(regionCount(state, playerId));
    return ACTIONS_PER_TURN + (pol.some((p) => p.id === 'logistics') ? 3 : 0);
  }

  /** 一次遍历聚合各势力数据（避免 玩家×区域 的重复扫描）；fog 下只统计已探索区域 */
  private aggregate(
    state: GameState,
    fog: boolean,
  ): Map<number, { count: number; army: number; cities: number; specials: number }> {
    const map = new Map<number, { count: number; army: number; cities: number; specials: number }>();
    for (const r of state.regions) {
      if (r.owner < 0) continue;
      if (fog && r.owner !== 0 && !this.fog.known.has(r.id)) continue;
      let a = map.get(r.owner);
      if (!a) {
        a = { count: 0, army: 0, cities: 0, specials: 0 };
        map.set(r.owner, a);
      }
      a.count += 1;
      a.army += r.army;
      if (r.type === 'city') a.cities += 1;
      if (r.specials?.length) a.specials += r.specials.length;
    }
    return map;
  }

  update(state: GameState, selection: number | null, fog?: FogView, mySeat = 0): void {
    if (fog) this.fog = fog;
    this.mySeat = mySeat;
    this.lastState = state;
    const fogOn = this.fog.on;
    const cur = state.players[state.currentPlayer];

    const agg = this.aggregate(state, fogOn);
    const limit = cur ? this.actionLimit(state, cur.id) : ACTIONS_PER_TURN;
    // 顶栏文本按 class 更新（同一份数据可能在桌面芯片 / 手机芯片 / 抽屉里各有一份）
    const setText = (cls: string, text: string): void => {
      document.querySelectorAll(`.${cls}`).forEach((el) => {
        el.textContent = text;
      });
    };
    setText('js-turn', `${state.turn}/${state.config.turnLimit}`);
    setText('js-move', `${state.actionsLeft}/${limit}`);
    setText('js-current', cur ? `${nationEmoji(cur.nationId)} ${cur.name}${cur.isHuman ? '（你）' : ''}` : '-');

    // 季节 / 天气芯片（手机紧凑芯片与桌面芯片共用 .js-env）
    const season: Season = state.season ?? 'spring';
    const weather: Weather = state.weather ?? 'clear';
    const sd = SEASONS[season] ?? SEASONS.spring;
    const wd = WEATHERS[weather] ?? WEATHERS.clear;
    const envText = `${sd.icon}${sd.name}${wd.id === 'clear' ? '' : ` ${wd.icon}${wd.name}`}`;
    const envTitle = `第 ${state.round ?? 1} 个大回合 · ${sd.desc}${wd.id === 'clear' ? '' : ` · ${wd.name}：${wd.desc}`}`;
    document.querySelectorAll('.js-env').forEach((el) => {
      el.textContent = envText;
      el.setAttribute('title', envTitle);
    });

    const myPolicies = policiesFor(agg.get(this.mySeat)?.count ?? 0);
    const polHtml = myPolicies.length
      ? `🏅 ${myPolicies.map((p) => p.icon + p.name).join(' ')}`
      : '<span class="muted">🏅 科技：靠占区解锁</span>';
    document.querySelectorAll('.js-policy').forEach((el) => {
      el.innerHTML = polHtml;
    });

    const endBtn = document.getElementById('btn-end') as HTMLButtonElement;
    endBtn.disabled = state.gameOver || !cur?.isHuman;

    const forcesSig =
      state.players
        .map((p) => {
          const a = agg.get(p.id);
          return `${p.id}:${a?.count ?? 0}:${a?.army ?? 0}:${p.alive}`;
        })
        .join('|') + `|${state.turn}|${state.currentPlayer}|${this.fog.known.size}`;
    if (forcesSig !== this.forcesSig) {
      this.forcesSig = forcesSig;
      this.renderForces(state, agg, fogOn);
    }

    const last = state.log[state.log.length - 1];
    const logSig = `${state.log.length}:${last?.turn ?? 0}:${last?.text ?? ''}`;
    if (logSig !== this.logSig) {
      this.logSig = logSig;
      this.renderLog(state);
    }

    const key =
      selection == null
        ? ''
        : `${selection}:${this.fog.visible.has(selection) ? 1 : 0}${this.fog.known.has(selection) ? 1 : 0}`;
    if (key !== this.selKey) {
      this.selKey = key;
      this.renderSide(state, selection);
    }
  }

  private renderForces(
    state: GameState,
    agg: Map<number, { count: number; army: number; cities: number; specials: number }>,
    fog: boolean,
  ): void {
    const alive = state.players.filter((p) => p.alive);
    const counts = alive.map((p) => agg.get(p.id)?.count ?? 0);
    const minCount = counts.length ? Math.min(...counts) : 0;
    const maxCount = counts.length ? Math.max(...counts) : 0;

    document.getElementById('forces')!.innerHTML = state.players
      .map((p) => {
        const a = agg.get(p.id) ?? { count: 0, army: 0, cities: 0, specials: 0 };
        const territory = territoryBonusFor(a.count);
        const sub = underdogBonusFor(a.count, minCount, maxCount);
        const underdog = sub > 0 ? ` · 补贴+${sub}` : '';
        const pol = policiesFor(a.count).length;
        const cur = p.id === state.currentPlayer ? '▶ ' : '';
        const approx = fog && p.id !== this.mySeat ? '≈' : '';
        // 两行式排版：第一行名称，第二行数据芯片（窄栏 / 手机抽屉里不再挤成一团）
        return `<div class="force-row ${p.alive ? '' : 'dead'}">
          <span class="dot" style="background:${ownerColor(state, p.id)}"></span>
          <div class="force-main">
            <div class="force-name">${cur}${nationEmoji(p.nationId)} ${escapeHtml(p.name)}${p.isHuman ? '（我）' : ''}</div>
            <div class="force-stats">
              <span>${approx}${a.count} 区</span>
              <span>${approx}${a.army} 兵</span>
              <span>${approx}${a.cities} 城</span>
              ${a.specials ? `<span>${a.specials} 特殊</span>` : ''}
              <span>领地 +${territory}</span>
              ${sub > 0 ? `<span class="good">补贴 +${sub}</span>` : ''}
              ${pol ? `<span>🏅 ${pol} 项科技</span>` : ''}
            </div>
          </div>
        </div>`;
      })
      .join('') + (fog ? '<div class="muted" style="margin-top:6px">≈ 仅统计已探索区域（战争迷雾）</div>' : '');
  }

  private renderLog(state: GameState): void {
    const list = document.getElementById('log-list');
    if (!list) return;

    // 按回合分组（log 本身是追加顺序）
    const groups: { turn: number; entries: GameState['log'] }[] = [];
    for (const e of state.log) {
      const g = groups[groups.length - 1];
      if (g && g.turn === e.turn) g.entries.push(e);
      else groups.push({ turn: e.turn, entries: [e] });
    }
    const RECENT = 3;
    const shown = this.logAll ? groups : groups.slice(-RECENT);
    const foldedRounds = groups.length - shown.length;

    // 正在往上翻旧账时不要抢滚动条（只有本来就在底部才自动跟到最新）
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 28;

    const html: string[] = [];
    if (foldedRounds > 0) {
      html.push(`<div class="log-more">⋯ 更早 ${foldedRounds} 个回合已折叠</div>`);
    }
    for (const g of shown) {
      html.push(`<div class="log-round">第 ${g.turn} 回合</div>`);
      for (const e of g.entries) {
        html.push(`<div class="log-entry log-${e.kind}">${e.text}</div>`);
      }
    }
    list.innerHTML = html.join('');

    // 展开/收起开关做成面板固定页脚（放在滚动列表里会滚不到、点不准）
    const toggle = document.getElementById('log-toggle') as HTMLButtonElement | null;
    if (toggle) {
      const canFold = groups.length > RECENT;
      toggle.style.display = canFold ? 'inline-block' : 'none';
      toggle.textContent = this.logAll ? `最近${RECENT}回合` : `全部 ${groups.length} 回合`;
      if (!toggle.dataset.bound) {
        toggle.dataset.bound = '1';
        toggle.addEventListener('click', (ev) => {
          ev.stopPropagation(); // 别把标题的折叠一起触发了
          this.logAll = !this.logAll;
          try {
            localStorage.setItem('gongfa-war.logAll', this.logAll ? '1' : '0');
          } catch {
            /* 隐私模式 */
          }
          const st = this.lastState;
          if (st) this.renderLog(st);
        });
      }
    }

    const count = document.getElementById('log-count');
    if (count) count.textContent = groups.length ? `${groups.length} 回合 / ${state.log.length} 条` : '';

    if (this.logAll || atBottom) list.scrollTop = list.scrollHeight;
  }

  /** 右侧详情面板（手机）/ 右侧栏（桌面）的表头 */
  private sheetHead(): string {
    return `<div class="sheet-head mob-only">
        <span class="grab"></span>
        <button class="small" id="side-clear" aria-label="取消选中">✕ 取消</button>
      </div>`;
  }

  private renderSide(state: GameState, selection: number | null): void {
    const side = document.getElementById('sidepanel')!;
    if (selection == null) {
      side.classList.remove('visible');
      side.innerHTML = '';
      return;
    }
    const r = state.regions[selection];
    if (!r) {
      side.classList.remove('visible');
      return;
    }
    side.classList.add('visible');
    const bindHead = (): void => {
      side.querySelector('#side-clear')?.addEventListener('click', () => this.handlers.onClearSelection());
    };

    // 战争迷雾：完全未探索 → 只给一块阴影面板
    if (this.fog.on && !this.fog.visible.has(selection) && !this.fog.known.has(selection)) {
      side.innerHTML = `
        ${this.sheetHead()}
        <h3 class="muted">🌫 未探索区域</h3>
        <div class="muted">这里还没有斥候到过。占领或相邻己方领土即可揭开迷雾。</div>`;
      bindHead();
      return;
    }
    const vis = !this.fog.on || this.fog.visible.has(selection);
    const owner = r.owner < 0 ? '中立' : state.players[r.owner]?.isHuman ? '你' : state.players[r.owner]?.name ?? '?';
    const facs = r.specials ?? [];
    const facBonus = {
      reinforce: facs.reduce((n, s) => n + SPECIAL_BONUS[s].reinforce, 0),
      defense: facs.reduce((n, s) => n + SPECIAL_BONUS[s].defense, 0),
      captureStock: facs.reduce((n, s) => n + SPECIAL_BONUS[s].captureStock, 0),
    };
    const avail = Math.max(0, r.army - 1);
    // 侦查情报（自己的快照；迷雾下用来替代「?」）
    const intelOf = (rid: number): { army: number; turn: number; stale: boolean } | null => {
      const entry = state.players[this.mySeat]?.intel?.[rid];
      if (!entry) return null;
      return { army: entry.army, turn: entry.turn, stale: state.turn - entry.turn >= INTEL_STALE_TURNS };
    };
    const intel = intelOf(selection);
    const neighbors = r.neighbors
      .map((nid) => {
        const n = state.regions[nid];
        const who = n.owner < 0 ? '中立' : n.owner === this.mySeat ? '我' : state.players[n.owner]?.name ?? '?';
        const sea = r.seaNeighbors.includes(nid) ? '🌊' : '';
        const nicon = `${REGION_ICONS[n.type]}${(n.specials ?? []).map((s) => SPECIAL_ICONS[s]).join('')}`;
        const visible = !this.fog.on || this.fog.visible.has(nid);
        const ni = visible ? null : intelOf(nid);
        const num = visible ? String(n.army) : ni ? `${ni.stale ? '~' : ''}${ni.army}🕵️` : '?';
        return `<div class="nb"><span class="dot" style="background:${ownerColor(state, n.owner)}"></span>
          <span>${nicon} ${n.name} ${who}${sea}</span><b>${num}</b></div>`;
      })
      .join('');

    // 手机端首屏只有 ~338px：把「要动手的」放最前（兵力 / 可调动 / 建造 / 侦查），
    // 相邻区域列表下沉且可折叠 —— 否则建造按钮要往下滚 1.5 屏才够得到。
    const canBuild = r.owner === this.mySeat && facs.length < 3;
    const buildSec = canBuild
      ? `<div class="muted" style="margin:8px 0 2px">🏗️ 建造设施（每种每区各一个，每个 1 行动 + ${BUILD_SPECIAL_COST} 兵）</div>
         <div class="build-list">
           ${SPECIAL_ORDER.filter((k) => !facs.includes(k))
             .map(
               (k) => `<div class="build-row">
                 <button class="small bd" data-k="${k}">${SPECIAL_ICONS[k]}${SPECIAL_BONUS[k].name}</button>
                 <span class="muted">${SPECIAL_BONUS[k].desc}</span>
               </div>`,
             )
             .join('')}
         </div>`
      : '';
    const scoutSec =
      r.owner === this.mySeat
        ? `<div class="muted" style="margin:8px 0 2px">🕵️ 侦查：点 <b>2 格内</b>的敌方/中立区域，派 ${SCOUT_COST} 兵 + 1 行动探明其与周边兵力${
            r.army >= SCOUT_COST + 1 ? '' : `（本区需 ≥ ${SCOUT_COST + 1} 兵）`
          }</div>`
        : '';

    side.innerHTML = `
      ${this.sheetHead()}
      <h3 style="color:${ownerColor(state, r.owner)}">${REGION_ICONS[r.type]}${facs.map((s) => SPECIAL_ICONS[s]).join('')} ${r.name}</h3>
      <div class="sheet-body">
      <div class="row"><span>归属</span><span>${owner}</span></div>
      <div class="row"><span>兵力</span><span>${
        vis
          ? r.army
          : intel
            ? `${intel.stale ? '~' : ''}${intel.army} <span class="muted">（第 ${intel.turn} 回合侦查${intel.stale ? ' · 已过时' : ''}）</span>`
            : '? <span class="muted">（已离开视野）</span>'
      }</span></div>
      ${vis ? `<div class="row"><span>可调动兵力</span><span>${avail}</span></div>` : ''}
      ${buildSec}
      ${scoutSec}
      <div class="row" style="margin-top:6px"><span>类型</span><span>${REGION_NAMES[r.type]}</span></div>
      ${
        facs.length
          ? `<div class="row"><span>设施</span><span style="color:#a06b00">${facs
              .map((s) => `${SPECIAL_ICONS[s]}${SPECIAL_BONUS[s].name}`)
              .join(' · ')}</span></div>`
          : ''
      }
      ${r.capital ? '<div class="row"><span>首都</span><span>👑 失守则全国产兵 -1</span></div>' : ''}
      ${
        r.siege > 0
          ? `<div class="row"><span>围城</span><span style="color:#ff8a80">🔥 ${r.siege}（产兵/防守各 -${r.siege}）</span></div>`
          : ''
      }
      ${
        !vis && intel
          ? `<div class="row"><span>🕵️ 情报</span><span class="muted">第 ${intel.turn} 回合 · ${intel.army} 兵</span></div>`
          : ''
      }
      <div class="row"><span>产兵/回合</span><span>+${REGION_PRODUCTION[r.type] + facBonus.reinforce}</span></div>
      <div class="row"><span>防守骰加成</span><span>+${REGION_DEFENSE[r.type] + facBonus.defense}</span></div>
      ${
        facs.length
          ? `<div class="row"><span>设施加成</span><span style="color:#a06b00">${facs.map((s) => SPECIAL_BONUS[s].desc).join('；')}</span></div>`
          : ''
      }
      ${r.pendingBonus ? `<div class="row"><span>待结算</span><span style="color:#a06b00">下回合 +${r.pendingBonus}</span></div>` : ''}
      <div class="nb-wrap" id="nb-wrap">
        <div class="muted side-fold" id="nb-fold">相邻区域 ${r.neighbors.length} 个（🌊 跨海 -1 骰） ▾</div>
        <div id="nb-list">${neighbors}</div>
      </div>
      </div>
      <div class="muted" style="margin-top:8px">选己方区域 → 点相邻敌方=进攻 / 相邻己方=调兵 / 2 格内敌方=侦查；点空白处或 ✕ 取消</div>`;

    bindHead();
    // 相邻区域可折叠
    const fold = side.querySelector('#nb-fold');
    fold?.addEventListener('click', () => {
      const wrap = side.querySelector('#nb-wrap');
      const folded = wrap?.classList.toggle('folded');
      if (fold) fold.textContent = `相邻区域 ${r.neighbors.length} 个（🌊 跨海 -1 骰）${folded ? ' ▸' : ' ▾'}`;
    });
    side.querySelectorAll('.bd').forEach((btn) =>
      btn.addEventListener('click', () =>
        this.handlers.onBuild(r.id, (btn as HTMLElement).dataset.k as 'barracks' | 'fortress' | 'treasury'),
      ),
    );
  }
}
