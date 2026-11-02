export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 缩放范围：下限要能装下整张 72×40 的地图（手机矮屏约需 0.4） */
export const MIN_SCALE = 0.28;
export const MAX_SCALE = 3;

/** 平滑相机：拖拽即时跟随，缩放/定位用指数插值缓动 */
export class Camera {
  offsetX = 0;
  offsetY = 0;
  scale = 1;

  private targetX = 0;
  private targetY = 0;
  private targetScale = 1;

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.scale + this.offsetX, y: wy * this.scale + this.offsetY };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.offsetX) / this.scale, y: (sy - this.offsetY) / this.scale };
  }

  /** 拖拽：位置立即变化（手感直接） */
  pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.targetX = this.offsetX;
    this.targetY = this.offsetY;
  }

  /** 以屏幕点为中心缩放：写入目标值，由 update() 缓动逼近 */
  zoomAt(sx: number, sy: number, factor: number): void {
    const bx = (sx - this.targetX) / this.targetScale;
    const by = (sy - this.targetY) / this.targetScale;
    this.targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.targetScale * factor));
    const ax = (sx - this.targetX) / this.targetScale;
    const ay = (sy - this.targetY) / this.targetScale;
    this.targetX += (ax - bx) * this.targetScale;
    this.targetY += (ay - by) * this.targetScale;
  }

  /** 定位到某点；scale 缺省为 1（开局用更大的 1.25 让区域看得更清楚） */
  centerOn(wx: number, wy: number, viewW: number, viewH: number, scale = 1): void {
    this.scale = scale;
    this.targetScale = scale;
    this.offsetX = viewW / 2 - wx * this.scale;
    this.offsetY = viewH / 2 - wy * this.scale;
    this.targetX = this.offsetX;
    this.targetY = this.offsetY;
  }

  /** 保持当前缩放，把某个世界坐标移到视口中心（点小地图用） */
  centerOnKeepScale(wx: number, wy: number, viewW: number, viewH: number): void {
    this.offsetX = viewW / 2 - wx * this.scale;
    this.offsetY = viewH / 2 - wy * this.scale;
    this.targetX = this.offsetX;
    this.targetY = this.offsetY;
  }

  /** 缩放到刚好容纳整张地图（「全图」按钮） */
  fit(worldW: number, worldH: number, viewW: number, viewH: number, padding = 0.94): void {
    const s = Math.min((viewW / worldW) * padding, (viewH / worldH) * padding);
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    this.scale = scale;
    this.targetScale = scale;
    this.offsetX = viewW / 2 - (worldW / 2) * scale;
    this.offsetY = viewH / 2 - (worldH / 2) * scale;
    this.targetX = this.offsetX;
    this.targetY = this.offsetY;
  }

  /** 视口尺寸变化时保持中心不变 */
  shiftViewport(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.targetX += dx;
    this.targetY += dy;
  }

  /** 平滑逼近目标值（dt 秒） */
  update(dt: number): void {
    const k = 1 - Math.pow(0.0005, Math.min(Math.max(dt, 0), 0.05));
    this.scale += (this.targetScale - this.scale) * k;
    this.offsetX += (this.targetX - this.offsetX) * k;
    this.offsetY += (this.targetY - this.offsetY) * k;
  }
}
