import { F } from './constants.js';

// Line of sight on the tile grid using a DDA walk between tile centres (or arbitrary points).
// `prone` targets are also hidden by LOW cover (low walls, sandbags, hedges) unless the
// viewer stands right next to that cover.
export function hasLOS(grid, x0, y0, x1, y1, prone = false) {
  let tx = Math.floor(x0), ty = Math.floor(y0);
  const ex = Math.floor(x1), ey = Math.floor(y1);
  const dx = x1 - x0, dy = y1 - y0;
  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMX = dx !== 0 ? (stepX > 0 ? (tx + 1 - x0) : (x0 - tx)) * tDX : Infinity;
  let tMY = dy !== 0 ? (stepY > 0 ? (ty + 1 - y0) : (y0 - ty)) * tDY : Infinity;
  let guard = 0;
  while (tx !== ex || ty !== ey) {
    if (tMX < tMY) { tMX += tDX; tx += stepX; } else { tMY += tDY; ty += stepY; }
    if (tx === ex && ty === ey) break;
    const f = grid.get(tx, ty);
    if (f & F.SIGHT) return false;
    if (prone && (f & (F.LOW | F.TALL))) {
      // Low cover hides a prone target unless the cover is adjacent to the viewer.
      if (Math.abs(tx + 0.5 - x0) > 1.6 || Math.abs(ty + 0.5 - y0) > 1.6) return false;
    }
    if (++guard > 512) return false;
  }
  return true;
}

// Distance a ray travels from (x0, y0) along angle `a` before hitting sight-blocking tiles,
// capped at `range`. Used to build vision-cone polygons.
export function castRay(grid, x0, y0, a, range, prone = false) {
  const step = 0.25;
  const cx = Math.cos(a) * step, cy = Math.sin(a) * step;
  let x = x0, y = y0, d = 0;
  const sx = Math.floor(x0), sy = Math.floor(y0);
  while (d < range) {
    x += cx; y += cy; d += step;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx === sx && ty === sy) continue;
    const f = grid.get(tx, ty);
    if (f & F.SIGHT) return Math.max(0, d - step * 0.5);
    if (prone && (f & (F.LOW | F.TALL)) && d > 1.6) return d;
  }
  return range;
}

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
