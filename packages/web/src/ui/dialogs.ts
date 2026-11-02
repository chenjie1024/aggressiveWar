import { REGION_NAMES, type AttackPreview, type GameEvent, type GameState } from '@gongfa-war/core';

/**
 * 轻提示：同屏最多 3 条；同类的连续提示（占领 / 失去）自动合并成计数，
 * 否则一次结束回合能连出 5~6 条，在手机上盖住下方 40% 的屏幕。
 */
const TOAST_MAX = 3;
const TOAST_MS = 4200;
interface ToastEntry {
  el: HTMLElement;
  kind: string;
  count: number;
  last: string;
  hideTimer: number;
}
const toastEntries: ToastEntry[] = [];

const TOAST_MERGE: { kind: string; re: RegExp; fmt: (n: number, last: string) => string }[] = [
  { kind: 'capture', re: /^🎉 占领了(.+?)！$/, fmt: (n, last) => (n === 1 ? `🎉 占领了${last}！` : `🎉 占领 ${n} 处（最新：${last}）`) },
  { kind: 'lost', re: /^⚠️ 失去了(.+?)！$/, fmt: (n, last) => (n === 1 ? `⚠️ 失去了${last}！` : `⚠️ 失去 ${n} 处（最新：${last}）`) },
];

export function toast(text: string): void {
  const container = document.getElementById('toasts');
  if (!container) return;
  const now = Date.now();

  // 同类合并（只合并最近 3 秒内的）
  for (const m of TOAST_MERGE) {
    const match = text.match(m.re);
    if (!match) continue;
    const hit = toastEntries.find((e) => e.kind === m.kind && now - (e.el.dataset.at ? Number(e.el.dataset.at) : 0) < 3000);
    if (hit) {
      hit.count += 1;
      hit.last = match[1];
      hit.el.textContent = m.fmt(hit.count, hit.last);
      hit.el.dataset.at = String(now);
      window.clearTimeout(hit.hideTimer);
      hit.hideTimer = window.setTimeout(() => removeToast(hit), TOAST_MS);
      return;
    }
    break;
  }

  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  el.dataset.at = String(now);
  container.appendChild(el);
  const entry: ToastEntry = { el, kind: TOAST_MERGE.find((m) => m.re.test(text))?.kind ?? '', count: 1, last: text, hideTimer: 0 };
  entry.hideTimer = window.setTimeout(() => removeToast(entry), TOAST_MS);
  toastEntries.push(entry);

  // 超出上限就挤掉最旧的
  while (toastEntries.length > TOAST_MAX) {
    const oldest = toastEntries[0];
    if (!oldest) break;
    removeToast(oldest);
  }
}

function removeToast(entry: ToastEntry): void {
  window.clearTimeout(entry.hideTimer);
  entry.el.remove();
  const i = toastEntries.indexOf(entry);
  if (i >= 0) toastEntries.splice(i, 1);
}

export function showEvents(events: GameEvent[], state: GameState, humanId: number): void {
  for (const ev of events) {
    if (ev.type === 'regionCaptured') {
      const r = state.regions[ev.regionId];
      const name = r ? REGION_NAMES[r.type] : '区域';
      if (ev.playerId === humanId) toast(`🎉 占领了${name}！`);
      else if (ev.from === humanId) toast(`⚠️ 失去了${name}！`);
    } else if (ev.type === 'eliminated') {
      if (ev.playerId === humanId) toast('💀 你被消灭了');
      else toast(`💀 ${state.players[ev.playerId]?.name ?? '对手'}被消灭了`);
    } else if (ev.type === 'turn') {
      if (ev.playerId === humanId) toast('👉 轮到你了');
    } else if (ev.type === 'card') {
      if (ev.playerId === humanId) toast(`${ev.icon} 事件卡 · ${ev.name}：${ev.desc}`);
      else if (!ev.good) toast(`${ev.icon} ${state.players[ev.playerId]?.name ?? '对手'} 遭遇 ${ev.name}`);
    }
  }
}

/** 通用确认弹窗（可带“不再提醒”勾选） */
export function showConfirm(opts: {
  title: string;
  text: string;
  checkLabel?: string;
  onConfirm: (checked: boolean) => void;
}): void {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:360px">
      <h1 style="font-size:20px">${opts.title}</h1>
      <div class="subtitle">${opts.text}</div>
      ${
        opts.checkLabel
          ? `<label class="muted" style="display:flex;gap:6px;align-items:center;justify-content:center;margin-bottom:12px">
               <input type="checkbox" id="cf-check" /> ${opts.checkLabel}</label>`
          : ''
      }
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="primary" id="cf-ok">确定</button>
        <button id="cf-cancel">取消</button>
      </div>
    </div>`;
  document.getElementById('app')!.appendChild(overlay);
  const close = (): void => overlay.remove();
  overlay.querySelector('#cf-ok')!.addEventListener('click', () => {
    const checked = (overlay.querySelector('#cf-check') as HTMLInputElement | null)?.checked ?? false;
    close();
    opts.onConfirm(checked);
  });
  overlay.querySelector('#cf-cancel')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

/** 滑杆 + 【−1 / +1 / 全部】按钮 + 快捷比例按钮 + 滚轮微调；拖动时实时回调 */
function wireSlider(
  overlay: HTMLElement,
  onChange: (value: number) => void,
): HTMLInputElement {
  const range = overlay.querySelector('#sl-range') as HTMLInputElement;
  let last = Number(range.value);
  const emit = (v: number): void => {
    if (v === last) return;
    last = v;
    onChange(v);
  };
  const apply = (v: number): void => {
    const min = Number(range.min);
    const max = Number(range.max);
    const clamped = Math.max(min, Math.min(max, Math.round(v)));
    range.value = String(clamped);
    emit(clamped);
  };
  // 拖动滑杆 / 点轨道：实时刷新"投入兵力"和"胜率"（桌面鼠标拖动与手机触摸拖动都会连续触发 input）
  range.addEventListener('input', () => apply(Number(range.value)));
  range.addEventListener('change', () => apply(Number(range.value)));
  overlay.querySelector('#sl-minus')!.addEventListener('click', () => apply(Number(range.value) - 1));
  overlay.querySelector('#sl-plus')!.addEventListener('click', () => apply(Number(range.value) + 1));
  overlay.querySelector('#sl-all')!.addEventListener('click', () => apply(Number(range.max)));
  // 快捷比例（触屏友好；桌面也可用数字键 1~4）
  overlay.querySelectorAll('[data-q]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ratio = Number((btn as HTMLElement).dataset.q);
      apply(Math.max(1, Math.round(Number(range.max) * ratio)));
    });
  });
  overlay.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      apply(Number(range.value) + (e.deltaY < 0 ? 1 : -1));
    },
    { passive: false },
  );
  return range;
}

function sliderRow(max: number, value: number): string {
  return `<div style="display:flex;gap:6px;align-items:center;margin-top:8px">
    <button class="small" id="sl-minus">−1</button>
    <input id="sl-range" type="range" min="1" max="${max}" value="${value}" style="flex:1" />
    <button class="small" id="sl-plus">+1</button>
    <button class="small" id="sl-all">全部</button>
  </div>
  <div style="display:flex;gap:6px;margin-top:6px">
    <button class="small" data-q="0.25" style="flex:1">25%</button>
    <button class="small" data-q="0.5" style="flex:1">50%</button>
    <button class="small" data-q="0.75" style="flex:1">75%</button>
    <button class="small" data-q="1" style="flex:1">100%</button>
  </div>`;
}

/** 调兵 / 行军数量选择弹窗 */
export function showMoveDialog(opts: {
  fromLabel: string;
  toLabel: string;
  max: number;
  onConfirm: (amount: number) => void;
}): void {
  const max = Math.max(1, opts.max);
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:360px">
      <h1 style="font-size:20px">调兵 / 行军</h1>
      <div class="subtitle">${opts.fromLabel} → ${opts.toLabel}</div>
      <div class="field"><label>调动数量</label><span id="sl-val">${max}</span></div>
      ${sliderRow(max, max)}
      <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
        <button class="primary" id="sl-ok">确认</button>
        <button id="sl-cancel">取消</button>
      </div>
      <div class="muted" style="margin-top:8px">滑杆 / ± 微调 · 出击区至少保留 1 兵</div>
    </div>`;
  document.getElementById('app')!.appendChild(overlay);

  const val = overlay.querySelector('#sl-val')!;
  const range = wireSlider(overlay, (v) => {
    val.textContent = String(v);
  });

  const close = (): void => overlay.remove();
  overlay.querySelector('#sl-ok')!.addEventListener('click', () => {
    const n = Number(range.value);
    close();
    opts.onConfirm(n);
  });
  overlay.querySelector('#sl-cancel')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

/** 操作说明（手机 / 桌面通用，触屏优先） */
export function showHelp(): void {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:460px;text-align:left">
      <h1 style="font-size:20px;text-align:center">怎么玩</h1>
      <div style="font-size:13px;line-height:1.9">
        <div><b>① 选中</b>：点自己的区域（红/本国色）→ 底部弹出该区域详情。</div>
        <div><b>② 进攻</b>：再点相邻的敌方或灰色中立区域 → 弹窗里拉滑杆选投入兵力，看胜率后「确认进攻」。</div>
        <div><b>③ 调兵</b>：再点相邻的己方区域 → 弹窗选数量，把后方兵力送往前线（可跨多格行军，最多 3 跳）。</div>
        <div><b>④ 结束回合</b>：右上角「结束回合」，AI 依次行动。每回合 10 次行动，调兵/行军/进攻各算 1 次。</div>
        <div><b>⑤ 取消选中</b>：点空白海域、再点一次同一区域，或点底部面板的 ✕。</div>
        <div><b>视图</b>：单指拖拽平移、双指捏合缩放、滚轮缩放（桌面）；点 ☰ 看势力详情与战报。</div>
        <div><b>胜负</b>：占领对手全部区域即获胜；到回合上限按积分判定。</div>
      </div>
      <div style="display:flex;justify-content:center;margin-top:14px">
        <button class="primary" id="hp-ok">知道了</button>
      </div>
    </div>`;
  document.getElementById('app')!.appendChild(overlay);
  overlay.querySelector('#hp-ok')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

/** 进攻弹窗：滑杆选投入兵力（支持 −1/+1/全部、滚轮、数字键 1~4），胜率实时联动 */
export function showAttackDialog(opts: {
  targetName: string;
  maxCommit: number;
  initialCommit: number;
  preview: (commit: number) => AttackPreview | null;
  onConfirm: (commit: number) => void;
}): void {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:410px">
      <h1 style="font-size:20px">进攻 ${opts.targetName}</h1>
      <div class="field"><label>投入兵力</label><span id="sl-val">${opts.initialCommit} / ${opts.maxCommit}</span></div>
      ${sliderRow(opts.maxCommit, opts.initialCommit)}
      <div id="sl-info" style="margin-top:10px"></div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
        <button class="primary" id="sl-ok">确认进攻</button>
        <button id="sl-cancel">取消</button>
      </div>
      <div class="muted" style="margin-top:8px">滑杆 / ± 微调 · 快捷比例按钮 · 幸存者撤回</div>
    </div>`;
  document.getElementById('app')!.appendChild(overlay);

  const val = overlay.querySelector('#sl-val')!;
  const info = overlay.querySelector('#sl-info')!;

  const render = (commit: number): void => {
    val.textContent = `${commit} / ${opts.maxCommit}`;
    const p = opts.preview(commit);
    if (!p) {
      info.innerHTML = '<div class="muted">无法进攻</div>';
      return;
    }
    const pct = Math.round(p.winProb * 100);
    const color = pct >= 65 ? '#8ce99a' : pct >= 40 ? '#ffd34d' : '#ff6b6b';
    const sea = p.maxAttackDice < 3 ? ` · 进攻 ${p.maxAttackDice} 骰` : '';
    const mods =
      p.notes && p.notes.length ? `<div class="muted" style="margin-top:4px">天时：${p.notes.join(' · ')}</div>` : '';
    info.innerHTML = `
      <div style="font-size:30px;font-weight:bold;color:${color};text-shadow:0 2px 0 #05090f">胜率 ${pct}%</div>
      <div class="muted" style="margin-top:6px">敌方 ${p.defenderArmy}（防守骰 +${p.defenderBonus}${sea}）</div>
      <div class="muted">预计损失：我方 ${p.expectedAttackerLoss.toFixed(1)} · 敌方 ${p.expectedDefenderLoss.toFixed(1)}</div>
      ${mods}`;
  };
  const range = wireSlider(overlay, render);
  render(opts.initialCommit);

  const onKey = (e: KeyboardEvent): void => {
    const k = e.key;
    if (k === 'Enter') {
      e.preventDefault();
      confirm();
    } else if (k === 'Escape') {
      close();
    } else if (k === '1' || k === '2' || k === '3' || k === '4') {
      e.preventDefault();
      const ratio = Number(k) / 4;
      const v = Math.max(1, Math.round(opts.maxCommit * ratio));
      range.value = String(v);
      render(v);
    }
  };
  window.addEventListener('keydown', onKey);

  const confirm = (): void => {
    const commit = Number(range.value);
    close();
    opts.onConfirm(commit);
  };
  const close = (): void => {
    window.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  overlay.querySelector('#sl-ok')!.addEventListener('click', confirm);
  overlay.querySelector('#sl-cancel')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

export function showResult(opts: {
  title: string;
  subtitle: string;
  stats: string;
  onRestart: () => void;
  onMenu: () => void;
}): void {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="card">
      <h1>${opts.title}</h1>
      <div class="subtitle">${opts.subtitle}</div>
      <div class="muted" style="margin-bottom:14px">${opts.stats}</div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="primary" id="btn-restart">再来一局</button>
        <button id="btn-menu">返回主菜单</button>
      </div>
    </div>`;
  document.getElementById('app')!.appendChild(overlay);
  overlay.querySelector('#btn-restart')!.addEventListener('click', () => {
    overlay.remove();
    opts.onRestart();
  });
  overlay.querySelector('#btn-menu')!.addEventListener('click', () => {
    overlay.remove();
    opts.onMenu();
  });
}
