import { F, T } from '../core/constants.js';

// Pure deterministic placement, independently testable against authored mission flags.
const EXCLUDE = F.BLOCK | F.ROAD | F.WATER | F.DEEP | F.INDOOR | F.DOOR | F.CLIMB;
const DENSITY = { [T.GRASS]: 7, [T.FIELD]: 5, [T.FOREST]: 3.5, [T.DIRT]: .4, [T.MUD]: .35, [T.PADDY]: 2.5, [T.SAND]: .12 };
export const GROUND_COVER_RADIUS = .32; // Includes maximum geometry extent and wind.

export function groundCoverSpots(grid, density = 1, snowy = false) {
  let seed = 1701;
  const rnd = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
  const spots = [];
  const accepts = (x, z) => {
    if (!grid.inside(x, z)) return false;
    const i = grid.idx(x, z);
    return !(grid.flags[i] & EXCLUDE) && !!DENSITY[grid.terrain[i]];
  };
  for (let z = 0; z < grid.h; z++) for (let x = 0; x < grid.w; x++) {
    if (!accepts(x, z)) continue;
    const terrain = grid.terrain[grid.idx(x, z)];
    const patch = .65 + .35 * Math.sin(x * .31 + Math.sin(z * .18)) * Math.cos(z * .27);
    let n = DENSITY[terrain] * density * patch * (snowy ? .12 : 1);
    while (n > 0) {
      const place = rnd() < n; n--;
      const px = x + rnd(), pz = z + rnd(), scale = .65 + rnd() * .35, angle = rnd() * Math.PI * 2;
      const dry = rnd(), tone = .88 + rnd() * .3;
      if (!place) continue;
      const radius = GROUND_COVER_RADIUS * scale;
      let clear = true;
      for (let iz = Math.floor(pz-radius); iz <= Math.floor(pz+radius); iz++)
        for (let ix = Math.floor(px-radius); ix <= Math.floor(px+radius); ix++) if (!accepts(ix, iz)) clear = false;
      if (clear) spots.push({x:px, z:pz, terrain, scale, angle, dry, tone});
    }
  }
  return spots;
}
