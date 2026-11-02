import { MAP_H, MAP_W } from '@gongfa-war/core';
import type { Camera } from './camera';
import { CELL } from './mapRenderer';

export interface InputHandlers {
  onRegionClick(regionId: number | null): void;
  onRegionRightClick(): void;
  onHover(regionId: number | null): void;
}

/** 手指抖动容差：小于它仍算「轻点」而不是拖拽 */
const TAP_SLOP = 14;

export class GameInput {
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  // 触摸状态
  private touchMode: 'none' | 'pan' | 'pinch' = 'none';
  private pinchDist = 0;
  private touchStartX = 0;
  private touchStartY = 0;
  private touchMoved = false;
  /** 最近一次触摸时间：用于屏蔽浏览器在触摸后补发的合成鼠标事件 */
  private lastTouchAt = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private handlers: InputHandlers,
    private getGrid: () => Int16Array,
  ) {
    canvas.addEventListener('mousedown', this.onDown);
    canvas.addEventListener('mousemove', this.onMove);
    canvas.addEventListener('mouseup', this.onUp);
    canvas.addEventListener('mouseleave', this.onLeave);
    canvas.addEventListener('contextmenu', this.onCtx);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd);
    canvas.addEventListener('touchcancel', this.onTouchEnd);
  }

  /**
   * 触摸后浏览器会补发一套 mousedown/mouseup/click（兼容旧网页）。
   * 如果不屏蔽，一次点按会被处理两次：先选中，再被当成「再次点击同一区域」取消选中 ——
   * 这正是手机上「点了没反应」的原因。这里统一忽略触摸后 700ms 内的鼠标事件。
   */
  private isGhostMouse(): boolean {
    return performance.now() - this.lastTouchAt < 700;
  }

  private regionAtPoint(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const w = this.camera.screenToWorld(clientX - rect.left, clientY - rect.top);
    const gx = Math.floor(w.x / CELL);
    const gy = Math.floor(w.y / CELL);
    if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return null;
    const id = this.getGrid()[gy * MAP_W + gx];
    return id >= 0 ? id : null;
  }

  private regionAt(e: MouseEvent): number | null {
    return this.regionAtPoint(e.clientX, e.clientY);
  }

  private onDown = (e: MouseEvent): void => {
    if (this.isGhostMouse()) return;
    if (e.button === 0) {
      this.moved = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private onMove = (e: MouseEvent): void => {
    if (this.isGhostMouse()) return;
    if (e.buttons & 1) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
      if (this.moved) {
        this.camera.pan(dx, dy);
        this.canvas.classList.add('panning');
      }
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    } else {
      this.handlers.onHover(this.regionAt(e));
    }
  };

  private onUp = (e: MouseEvent): void => {
    if (this.isGhostMouse()) return;
    if (e.button === 0) {
      this.canvas.classList.remove('panning');
      if (!this.moved) this.handlers.onRegionClick(this.regionAt(e));
      this.moved = false;
    }
  };

  private onLeave = (): void => {
    if (this.isGhostMouse()) return;
    this.handlers.onHover(null);
  };

  private onCtx = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.isGhostMouse()) return;
    this.handlers.onRegionRightClick();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.isGhostMouse()) return;
    const rect = this.canvas.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
  };

  // ===== 触摸：单指拖拽平移 / 双指捏合缩放 / 轻点选中 =====
  // 说明：不再用「长按取消选中」—— 手机上稍慢的点按会被误判成取消，导致「点了没反应」。
  // 取消选中改为：再点一次同一区域 / 点空白海域 / 底部信息面板的 ✕。
  private touchDist(a: Touch, b: Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  private onTouchStart = (e: TouchEvent): void => {
    this.lastTouchAt = performance.now();
    if (e.touches.length === 2) {
      this.touchMode = 'pinch';
      this.pinchDist = this.touchDist(e.touches[0], e.touches[1]);
      e.preventDefault();
      return;
    }
    if (e.touches.length === 1) {
      this.touchMode = 'pan';
      this.touchMoved = false;
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    this.lastTouchAt = performance.now();
    if (this.touchMode === 'pinch' && e.touches.length === 2) {
      const d = this.touchDist(e.touches[0], e.touches[1]);
      const rect = this.canvas.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      if (this.pinchDist > 0 && d > 0) this.camera.zoomAt(cx, cy, d / this.pinchDist);
      this.pinchDist = d;
      e.preventDefault();
      return;
    }
    if (this.touchMode === 'pan' && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - this.lastX;
      const dy = t.clientY - this.lastY;
      if (Math.abs(t.clientX - this.touchStartX) + Math.abs(t.clientY - this.touchStartY) > TAP_SLOP) {
        this.touchMoved = true;
      }
      if (this.touchMoved) this.camera.pan(dx, dy);
      this.lastX = t.clientX;
      this.lastY = t.clientY;
      e.preventDefault();
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    this.lastTouchAt = performance.now();
    // 轻点：单指、几乎没移动。顺便阻止浏览器补发合成鼠标事件（否则会重复触发一次）
    if (this.touchMode === 'pan' && !this.touchMoved && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      this.handlers.onRegionClick(this.regionAtPoint(t.clientX, t.clientY));
    }
    e.preventDefault();
    if (e.touches.length === 0) {
      this.touchMode = 'none';
      this.pinchDist = 0;
    }
  };
}
