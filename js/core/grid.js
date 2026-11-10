import { F, T } from './constants.js';

// The tile map. Tile (x, y) covers world space [x, x+1) x [y, y+1); a unit standing at
// world (px, py) is on tile (floor(px), floor(py)).
//
// `base` holds the flags painted by the mission builder; `flags` is base plus the effect
// of dynamic objects (cut fences, opened gates, placed ropes). Rebuilding `flags` from
// `base` + object state keeps saves small and deterministic.
export class Grid {
  constructor(w, h, fill = T.GRASS) {
    this.w = w; this.h = h;
    this.terrain = new Uint8Array(w * h).fill(fill);
    this.base = new Uint32Array(w * h);
    this.flags = new Uint32Array(w * h);
    this.height = new Float32Array(w * h); // visual elevation (cliff tops, platforms)
    this.owner = new Int32Array(w * h).fill(-1); // static object index occupying the tile, for picking
  }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  idx(x, y) { return y * this.w + x; }
  get(x, y) { return this.inside(x, y) ? this.flags[y * this.w + x] : F.BLOCK | F.SIGHT; }
  has(x, y, f) { return (this.get(x, y) & f) !== 0; }
  ter(x, y) { return this.inside(x, y) ? this.terrain[y * this.w + x] : T.ROCK; }

  setTerrain(x, y, t) { if (this.inside(x, y)) this.terrain[this.idx(x, y)] = t; }
  addBase(x, y, f) { if (this.inside(x, y)) this.base[this.idx(x, y)] |= f; }
  clearBase(x, y, f) { if (this.inside(x, y)) this.base[this.idx(x, y)] &= ~f; }

  resetFlags() { this.flags.set(this.base); }
  addFlag(x, y, f) { if (this.inside(x, y)) this.flags[this.idx(x, y)] |= f; }
  clearFlag(x, y, f) { if (this.inside(x, y)) this.flags[this.idx(x, y)] &= ~f; }

  // Can a unit with the given capabilities stand on this tile?
  walkable(x, y, caps = 0) {
    const f = this.get(x, y);
    if (caps & CAP.BOAT) return (f & (F.WATER | F.DEEP)) !== 0 && (f & F.BLOCK) === 0;
    if (caps & CAP.VEHICLE) return (f & (F.BLOCK | F.DEEP | F.CLIMB)) === 0;
    if (f & F.BLOCK) return false;                      // a hull in the water is a wall to a swimmer too
    if (f & F.DEEP) return (caps & CAP.SWIM) !== 0;
    if (f & F.CLIMB) return (caps & CAP.CLIMB) !== 0 || (f & ROPE) !== 0;
    return true;
  }
}

// Unit capabilities for pathfinding.
export const CAP = { SWIM: 1, CLIMB: 2, VEHICLE: 4, ENEMY: 8, BOAT: 16 };
// A rope placed on a CLIMB tile lets everyone pass. Only dynamic object state sets this bit.
export const ROPE = 32768;
