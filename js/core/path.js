import { F } from './constants.js';
import { CAP } from './grid.js';
import { hasClearance, WALK_RADIUS } from './clearance.js';

// A* over the tile grid with 8-way movement. Diagonals may not cut wall corners.
// Returns a list of tile-centre waypoints [[x, y], ...] (world coords) after string-pulling,
// or null when the goal is unreachable.

class Heap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const it = this.items, pr = this.prio;
    it.push(item); pr.push(p);
    let i = it.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (pr[j] <= pr[i]) break;
      [it[i], it[j]] = [it[j], it[i]]; [pr[i], pr[j]] = [pr[j], pr[i]];
      i = j;
    }
  }
  pop() {
    const it = this.items, pr = this.prio;
    const top = it[0];
    const lastI = it.pop(), lastP = pr.pop();
    if (it.length) {
      it[0] = lastI; pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < it.length && pr[l] < pr[m]) m = l;
        if (r < it.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [it[i], it[m]] = [it[m], it[i]]; [pr[i], pr[m]] = [pr[m], pr[i]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

let scratch = null;
function buffers(n) {
  if (!scratch || scratch.g.length < n) {
    scratch = { g: new Float32Array(n), from: new Int32Array(n), seen: new Uint32Array(n), closed: new Uint32Array(n), stamp: 0 };
  }
  scratch.stamp++;
  if (scratch.stamp === 0xffffffff) { scratch.seen.fill(0); scratch.closed.fill(0); scratch.stamp = 1; }
  return scratch;
}

// Extra per-tile cost: shallow water and bushes are slower; avoid them unless they're shorter.
// Land vehicles keep to the roads: open ground costs them more than double.
function tileCost(grid, x, y, caps = 0) {
  const f = grid.get(x, y);
  let c = 0;
  if (caps & CAP.VEHICLE) return (f & F.ROAD) ? 0 : 1.4;
  if (f & F.WATER) c += 1.5;
  if (f & F.BUSH) c += 0.4;
  if (f & F.SNOW) c += 0.2;
  return c;
}

// How many searches ran and how many nodes they expanded (tests watch for per-tick A* storms).
export const pathStats = { searches: 0, expanded: 0, failed: 0 };

export function findPath(grid, sx, sy, gx, gy, caps = 0, maxNodes = 40000) {
  let tx = Math.floor(gx), ty = Math.floor(gy);
  // A unit pushed off the map (a script, a boat bumping the edge) searches from the nearest tile on it.
  if (!grid.inside(Math.floor(sx), Math.floor(sy))) {
    sx = Math.max(0.5, Math.min(grid.w - 0.5, sx)); sy = Math.max(0.5, Math.min(grid.h - 0.5, sy));
  }
  const ox = Math.floor(sx), oy = Math.floor(sy);
  if (!grid.inside(tx, ty)) return null;
  pathStats.searches++;
  if (!grid.walkable(tx, ty, caps)) {
    const near = nearestWalkable(grid, tx, ty, caps, 3);
    if (!near) return null;
    [tx, ty] = near; gx = tx + 0.5; gy = ty + 0.5;
  }
  // A tap beside a solid edge must not put half the soldier inside it. Preserve
  // precise open-ground taps; move only unsafe endpoints inward within their tile.
  if (grid.preciseMovement && !hasClearance(grid, gx, gy, gx, gy, caps)) {
    gx = Math.max(tx + WALK_RADIUS + 0.001, Math.min(tx + 1 - WALK_RADIUS - 0.001, gx));
    gy = Math.max(ty + WALK_RADIUS + 0.001, Math.min(ty + 1 - WALK_RADIUS - 0.001, gy));
  }
  if (ox === tx && oy === ty) {
    // Even within one open tile, a short diagonal can graze the rounded corner
    // of a neighbouring obstacle. Step inward before approaching the new point.
    if (grid.preciseMovement && !hasClearance(grid,sx,sy,gx,gy,caps)) return [[tx+.5,ty+.5],[gx,gy]];
    return [[gx, gy]];
  }
  const W = grid.w, n = grid.w * grid.h;
  const b = buffers(n);
  const { g, from, seen, closed, stamp } = b;
  const start = oy * W + ox, goal = ty * W + tx;
  const h = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); };
  const open = new Heap();
  g[start] = 0; from[start] = -1; seen[start] = stamp;
  open.push(start, h(ox, oy));
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur] === stamp) continue;
    closed[cur] = stamp;
    if (cur === goal) break;
    if (++expanded > maxNodes) { pathStats.expanded += expanded; pathStats.failed++; return null; }
    const cx = cur % W, cy = (cur - cx) / W;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!grid.inside(nx, ny) || !grid.walkable(nx, ny, caps)) continue;
      if (dx && dy && (!grid.walkable(cx + dx, cy, caps) || !grid.walkable(cx, cy + dy, caps))) continue;
      const ni = ny * W + nx;
      if (closed[ni] === stamp) continue;
      const ng = g[cur] + cost + tileCost(grid, nx, ny, caps);
      if (seen[ni] !== stamp || ng < g[ni]) {
        seen[ni] = stamp; g[ni] = ng; from[ni] = cur;
        open.push(ni, ng + h(nx, ny));
      }
    }
  }
  pathStats.expanded += expanded;
  if (closed[goal] !== stamp) { pathStats.failed++; return null; }
  const tiles = [];
  for (let c = goal; c !== -1; c = from[c]) tiles.push(c);
  tiles.reverse();
  const pts = tiles.map((c) => [(c % W) + 0.5, Math.floor(c / W) + 0.5]);
  pts[pts.length - 1] = [gx, gy];
  return smooth(grid, [sx, sy], pts, caps);
}

// Remove waypoints that can be skipped in a straight, walkable line (string pulling).
function smooth(grid, startPt, pts, caps) {
  const out = [];
  let anchor = startPt;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !walkLine(grid, anchor[0], anchor[1], pts[j][0], pts[j][1], caps)) j--;
    out.push(pts[j]);
    anchor = pts[j];
    i = j + 1;
  }
  return out;
}

// Is the straight segment walkable for a unit of ~0.3 tile radius?
export function walkLine(grid, x0, y0, x1, y1, caps = 0) {
  if (grid.preciseMovement && !hasClearance(grid, x0, y0, x1, y1, caps)) return false;
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.ceil(len / 0.2);
  const nx = len ? -dy / len * 0.28 : 0, ny = len ? dx / len * 0.28 : 0;
  // A vehicle on a road stays on it: no straight cuts across the fields between two bends.
  const keepRoad = (caps & CAP.VEHICLE) && (grid.get(Math.floor(x0), Math.floor(y0)) & F.ROAD) && (grid.get(Math.floor(x1), Math.floor(y1)) & F.ROAD);
  for (let s = 0; s <= steps; s++) {
    const t = steps ? s / steps : 0;
    const px = x0 + dx * t, py = y0 + dy * t;
    if (!grid.walkable(Math.floor(px), Math.floor(py), caps)) return false;
    if (keepRoad && !(grid.get(Math.floor(px), Math.floor(py)) & F.ROAD)) return false;
    if (!grid.preciseMovement && (!grid.walkable(Math.floor(px + nx), Math.floor(py + ny), caps) || !grid.walkable(Math.floor(px - nx), Math.floor(py - ny), caps))) return false;
    // Never let a straight run step through a tile that the tile path would treat as more costly (water).
    if ((grid.get(Math.floor(px), Math.floor(py)) & F.WATER) && !(grid.get(Math.floor(x0), Math.floor(y0)) & F.WATER)
        && !(grid.get(Math.floor(x1), Math.floor(y1)) & F.WATER)) return false;
  }
  return true;
}

export function nearestWalkable(grid, x, y, caps = 0, maxR = 6) {
  if (grid.walkable(x, y, caps)) return [x, y];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (grid.walkable(x + dx, y + dy, caps)) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [x + dx, y + dy]; } }
    }
    if (best) return best;
  }
  return null;
}

export function pathLength(start, pts) {
  let L = 0, p = start;
  for (const q of pts) { L += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; }
  return L;
}
