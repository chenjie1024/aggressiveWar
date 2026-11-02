import { MAP_TEMPLATES, NATIONS, SCENARIOS, type Difficulty, type MapTemplate } from '@gongfa-war/core';
import { api } from '../net/apiClient';

export interface StartConfig {
  regionCount: number;
  opponents: number;
  difficulty: Difficulty;
  nationId: string;
  template: MapTemplate;
  scenario: string;
  /** 战争迷雾（仅影响人类视野与情报显示，AI 始终全知） */
  fog: boolean;
}

/** 菜单里的音频设置回调（背景音乐 + 音效/震动，可选） */
export interface MenuAudio {
  muted: boolean;
  volume: number;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  sfxEnabled: boolean;
  vibrate: boolean;
  setSfxEnabled(on: boolean): void;
  setVibrate(on: boolean): void;
}

/** 局域网联机的菜单回调 */
export interface MenuLanHost {
  onCreate(config: StartConfig, mode: LanMode): void;
  onJoin(code: string, mode: LanMode): void;
  onStartRoom(): void;
}

/** 联机方式：phone = 手机自己开房（App 内置中继）；lockstep = 中继转发（电脑/手机都可当服务器）；authoritative = 电脑服务器跑规则 */
export type LanMode = 'phone' | 'lockstep' | 'authoritative';

/** 菜单控制器：联机时由外部更新房间信息 */
export interface MenuController {
  close(): void;
  /** 更新房间信息（房间码 / 玩家列表）；canStart=true 时显示「开始对局」 */
  setRoomInfo(html: string, canStart: boolean): void;
}

export function showMenu(
  onStart: (config: StartConfig) => void,
  audio?: MenuAudio,
  lan?: MenuLanHost,
  /** App 内置中继是否可用（手机当房主）；浏览器里为 false */
  canHostOnPhone = false,
): MenuController {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'menu-overlay';
  overlay.innerHTML = `
    <div class="card menu-card" style="max-height:92vh;overflow:auto">
      <h1>攻伐战争</h1>
      <div class="subtitle">区域征服 · 回合制 · 数字兵力</div>
      <div class="field">
        <label>剧本</label>
        <select id="sel-scenario">
          ${SCENARIOS.map((s) => `<option value="${s.id}">${s.name}（${s.desc}）</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>地图模板</label>
        <select id="sel-template">
          ${MAP_TEMPLATES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>选择国家</label>
        <select id="sel-nation"></select>
      </div>
      <div class="field">
        <label>地图区域数</label>
        <select id="sel-regions">
          <option value="20">小 (20 区)</option>
          <option value="28" selected>中 (28 区)</option>
          <option value="36">大 (36 区)</option>
          <option value="44">超大 (44 区)</option>
          <option value="52">巨型 (52 区 · 长局)</option>
        </select>
      </div>
      <div class="field">
        <label>AI 对手数量</label>
        <select id="sel-opponents">
          <option value="1" selected>1 个（1v1）</option>
          <option value="2">2 个</option>
          <option value="3">3 个</option>
          <option value="4">4 个</option>
          <option value="5">5 个</option>
        </select>
      </div>
      <div class="field">
        <label>难度</label>
        <select id="sel-difficulty">
          <option value="easy">简单</option>
          <option value="normal" selected>普通</option>
          <option value="hard">困难</option>
        </select>
      </div>
      <div class="field">
        <label>战争迷雾 <input type="checkbox" id="chk-fog" checked style="vertical-align:middle;margin-left:6px" /></label>
        <div class="muted">开启后只能看到己方领土与相邻一圈；远处区域显示为阴影，兵力以「?」代替</div>
      </div>
      <div class="field">
        <label>背景音乐 <input type="checkbox" id="chk-music" checked style="vertical-align:middle;margin-left:6px" /></label>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <span class="muted">音量</span>
          <input type="range" id="rng-volume" min="0" max="100" value="55" style="flex:1" />
          <span class="muted" id="lbl-volume" style="min-width:34px;text-align:right">55%</span>
        </div>
        <div class="muted">实时合成的像素风配乐（无音频素材）：菜单 / 对局 / 局势紧张时自动换段</div>
      </div>
      <div class="field">
        <label>音效 <input type="checkbox" id="chk-sfx" checked style="vertical-align:middle;margin-left:6px" /></label>
        <label>震动 <input type="checkbox" id="chk-vibrate" checked style="vertical-align:middle;margin-left:6px" /></label>
        <div class="muted">进攻鼓点 / 占领音 / 失败低沉音；手机端附带轻震动</div>
      </div>
      <button class="primary" id="btn-start" style="width:100%;margin-top:12px">开始游戏</button>
      <div class="field field--wide" style="margin-top:14px;border:1px solid #2a3340;border-radius:8px;padding:10px">
        <label>🌐 局域网联机（同一 WiFi / 热点）</label>
        <select id="sel-netmode" style="margin-top:6px">
          ${canHostOnPhone ? '<option value="phone" selected>📱 本机开房 · 手机当服务器（热点直连）</option>' : ''}
          <option value="lockstep"${canHostOnPhone ? '' : ' selected'}>直连房间 · 转发式（需电脑或另一台已开房的手机）</option>
          <option value="authoritative">电脑服务器 · 规则在服务端跑（更防作弊）</option>
        </select>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="small" id="btn-lan-create">创建房间</button>
          <input id="inp-lan-code" placeholder="房间码" maxlength="4" style="width:90px;text-transform:uppercase" />
          <button class="small" id="btn-lan-join">加入房间</button>
        </div>
        <div id="lan-box" class="muted" style="margin-top:8px">直连房间：房主的设备负责转发，各手机本地跑规则</div>
      </div>
      <div class="muted menu-hint" style="margin-top:10px">左键选己方区域 → 点相邻区域（敌方=进攻 / 己方=调兵）；2 格内敌方=派侦查兵；右键取消；空格结束回合；Esc 取消选中</div>
      <h3 style="margin:14px 0 4px;text-align:left">排行榜（中型图 · 普通）</h3>
      <div id="leaderboard-box" class="muted">加载中…</div>
    </div>`;
  document.getElementById('app')!.appendChild(overlay);

  const scenarioSel = overlay.querySelector('#sel-scenario') as HTMLSelectElement;
  const templateSel = overlay.querySelector('#sel-template') as HTMLSelectElement;
  const nationSel = overlay.querySelector('#sel-nation') as HTMLSelectElement;

  // 背景音乐设置：初始化 + 即时生效
  const musicChk = overlay.querySelector('#chk-music') as HTMLInputElement;
  const volumeRng = overlay.querySelector('#rng-volume') as HTMLInputElement;
  const volumeLbl = overlay.querySelector('#lbl-volume') as HTMLElement;
  if (audio) {
    musicChk.checked = !audio.muted;
    volumeRng.value = String(Math.round(audio.volume * 100));
    volumeLbl.textContent = `${volumeRng.value}%`;
  }
  musicChk.addEventListener('change', () => audio?.setMuted(!musicChk.checked));
  volumeRng.addEventListener('input', () => {
    const v = Number(volumeRng.value) / 100;
    volumeLbl.textContent = `${volumeRng.value}%`;
    audio?.setVolume(v);
  });

  // 音效 / 震动开关
  const sfxChk = overlay.querySelector('#chk-sfx') as HTMLInputElement;
  const vibChk = overlay.querySelector('#chk-vibrate') as HTMLInputElement;
  if (audio) {
    sfxChk.checked = audio.sfxEnabled;
    vibChk.checked = audio.vibrate;
  }
  sfxChk.addEventListener('change', () => audio?.setSfxEnabled(sfxChk.checked));
  vibChk.addEventListener('change', () => audio?.setVibrate(vibChk.checked));

  const refreshNations = (): void => {
    const sc = SCENARIOS.find((s) => s.id === scenarioSel.value) ?? SCENARIOS[0];
    const pool = sc.nationIds
      .map((id) => NATIONS.find((n) => n.id === id))
      .filter((n): n is NonNullable<typeof n> => !!n);
    nationSel.innerHTML = pool.map((n) => `<option value="${n.id}">${n.emoji} ${n.name}</option>`).join('');
    templateSel.value = sc.template;
  };
  scenarioSel.addEventListener('change', refreshNations);
  refreshNations();

  const refreshLeaderboard = async () => {
    const box = overlay.querySelector('#leaderboard-box')!;
    try {
      const data = await api.leaderboard(28, 'normal', 10);
      const entries = data.entries ?? [];
      if (entries.length === 0) {
        box.textContent = '暂无战绩，快去征战吧！';
        return;
      }
      box.innerHTML =
        '<table id="leaderboard"><tr><th>#</th><th>玩家</th><th>积分</th></tr>' +
        entries
          .map((e: any, i: number) => `<tr><td>${i + 1}</td><td>${e.displayName ?? '匿名'}</td><td>${e.score}</td></tr>`)
          .join('') +
        '</table>';
    } catch {
      box.textContent = '离线模式：排行榜不可用';
    }
  };
  void refreshLeaderboard();

  const readConfig = (): StartConfig => ({
    regionCount: Number((overlay.querySelector('#sel-regions') as HTMLSelectElement).value),
    opponents: Number((overlay.querySelector('#sel-opponents') as HTMLSelectElement).value),
    difficulty: (overlay.querySelector('#sel-difficulty') as HTMLSelectElement).value as Difficulty,
    nationId: nationSel.value || NATIONS[0].id,
    template: templateSel.value as MapTemplate,
    scenario: scenarioSel.value,
    fog: (overlay.querySelector('#chk-fog') as HTMLInputElement | null)?.checked ?? true,
  });

  overlay.querySelector('#btn-start')!.addEventListener('click', () => {
    const config = readConfig();
    overlay.remove();
    onStart(config);
  });

  // ===== 局域网联机 =====
  const lanBox = overlay.querySelector('#lan-box') as HTMLElement;
  const lanStartBtn = document.createElement('button');
  lanStartBtn.className = 'primary';
  lanStartBtn.id = 'btn-lan-start';
  lanStartBtn.style.cssText = 'width:100%;margin-top:8px;display:none';
  lanStartBtn.textContent = '开始对局（房主）';
  lanBox.after(lanStartBtn);
  lanStartBtn.addEventListener('click', () => lan?.onStartRoom());
  overlay.querySelector('#btn-lan-create')?.addEventListener('click', () => {
    const mode = (overlay.querySelector('#sel-netmode') as HTMLSelectElement).value as LanMode;
    lanBox.innerHTML = '正在创建房间…';
    lan?.onCreate(readConfig(), mode);
  });
  overlay.querySelector('#btn-lan-join')?.addEventListener('click', () => {
    const mode = (overlay.querySelector('#sel-netmode') as HTMLSelectElement).value as LanMode;
    const code = (overlay.querySelector('#inp-lan-code') as HTMLInputElement).value.trim().toUpperCase();
    if (code.length < 4) {
      lanBox.innerHTML = '请输入 4 位房间码';
      return;
    }
    lanBox.innerHTML = `正在加入 ${code}…`;
    lan?.onJoin(code, mode);
  });

  return {
    close: () => overlay.remove(),
    setRoomInfo: (html: string, canStart: boolean) => {
      lanBox.innerHTML = html;
      lanStartBtn.style.display = canStart ? 'block' : 'none';
    },
  };
}
