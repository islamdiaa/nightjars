// A soldier occupies a disc, not a point. Test the whole swept disc against blocked
// tiles analytically: sampling only three parallel lines can miss wall/tree corners.
export const WALK_RADIUS = 0.28;

function intersectsBox(ax, ay, dx, dy, x0, y0, x1, y1) {
  let lo = 0, hi = 1;
  for (const [p, d, min, max] of [[ax, dx, x0, x1], [ay, dy, y0, y1]]) {
    if (Math.abs(d) < 1e-12) { if (p < min || p > max) return false; }
    else {
      const a = (min - p) / d, b = (max - p) / d;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      if (lo > hi) return false;
    }
  }
  return true;
}

function hitsTile(ax, ay, bx, by, x, y, r) {
  const dx = bx - ax, dy = by - ay, rr = r * r - 1e-10;
  // The rounded rectangle is two strips plus four circular corners.
  if (!intersectsBox(ax, ay, dx, dy, x-r, y-r, x+1+r, y+1+r)) return false;
  if (intersectsBox(ax, ay, dx, dy, x-r+1e-9, y, x+1+r-1e-9, y+1) ||
      intersectsBox(ax, ay, dx, dy, x, y-r+1e-9, x+1, y+1+r-1e-9)) return true;
  const len2 = dx*dx + dy*dy;
  for (const [cx, cy] of [[x,y], [x+1,y], [x,y+1], [x+1,y+1]]) {
    const t = len2 ? Math.max(0, Math.min(1, ((cx-ax)*dx+(cy-ay)*dy)/len2)) : 0;
    if ((ax+t*dx-cx)**2 + (ay+t*dy-cy)**2 < rr) return true;
  }
  return false;
}

export function hasClearance(grid, ax, ay, bx, by, caps = 0) {
  if (![ax, ay, bx, by].every(Number.isFinite)) return false;
  // DDA visits every centre-line tile. Its eight neighbours contain all possible
  // contacts for radius < 1; memoise only the blocked candidates, not the map.
  let x = Math.floor(ax), y = Math.floor(ay);
  const ex = Math.floor(bx), ey = Math.floor(by), dx = bx-ax, dy = by-ay;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const stepX = dx ? Math.abs(1/dx) : Infinity, stepY = dy ? Math.abs(1/dy) : Infinity;
  let nextX = dx ? ((sx > 0 ? x+1 : x)-ax)/dx : Infinity;
  let nextY = dy ? ((sy > 0 ? y+1 : y)-ay)/dy : Infinity;
  const checked = new Set();
  for (let n = 0, max = Math.abs(ex-x)+Math.abs(ey-y)+2; n < max; n++) {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = x+ox, cy = y+oy;
      if (grid.walkable(cx, cy, caps)) continue;
      const key = `${cx},${cy}`;
      if (checked.has(key)) continue;
      checked.add(key);
      if (hitsTile(ax, ay, bx, by, cx, cy, WALK_RADIUS)) return false;
    }
    if (x === ex && y === ey) return true;
    if (nextX < nextY) { x += sx; nextX += stepX; }
    else if (nextY < nextX) { y += sy; nextY += stepY; }
    else { x += sx; y += sy; nextX += stepX; nextY += stepY; }
  }
  return false;
}
