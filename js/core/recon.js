// Read-only tactical reconnaissance. Uses the same pathfinder/visibility rules as play;
// observations describe the CURRENT watch, never predict patrols or promise a safe route.
import { F } from './constants.js';
import { CAP } from './grid.js';
import { findPath, pathLength } from './path.js';
import { canSee, litAt } from './ai.js';

export function inspectRoute(world, hero, x, y, run = false) {
  const fail = reason => ({ ok: false, reason, x, y, samples: [] });
  if (!hero || hero.state !== 'ok') return fail('Select an able hero.');
  if (hero.hidden?.startsWith('b:')) return fail('Leave the building before plotting a route.');
  const mover = hero.inVehicle ? world.ent(hero.inVehicle) : hero;
  if (!mover || (hero.inVehicle && mover.driver !== hero.id)) return fail('Select the vehicle’s driver to plot its route.');
  const g = world.grid, caps = world.caps(mover), tx = Math.floor(x), ty = Math.floor(y);
  if (!g.inside(tx, ty)) return fail('That point is beyond the operation area.');
  if (!g.walkable(tx, ty, caps)) {
    const f = g.get(tx, ty);
    return fail(f & F.DEEP && !(caps & (CAP.SWIM | CAP.BOAT)) ? 'Deep water — find a bridge, ford or boat.'
      : f & F.FENCE ? 'Wire blocks this point. Cut an opening first.'
      : f & F.CLIMB ? 'This crossing needs a climber or a secured rope.'
      : 'Solid obstacle — choose open ground beside it.');
  }
  const path = findPath(g, mover.x, mover.y, x, y, caps);
  if (!path) return fail('No connected route. Open a crossing or choose another approach.');
  const guards = world.ents.filter(e => e.kind === 'enemy' && e.state === 'ok' && !e.ai.asleep && !e.ai.oblivious);
  const samples = [], hazards = new Set(), watchers = new Set();
  const probe = { ...mover, act: null, still: 0, moving: true, run: !!run && !hero.carrying && hero.stance === 'stand' };
  let prev = [mover.x, mover.y];
  const length = pathLength(prev, path), spacing = Math.max(.45, length / 480);
  for (const end of path) {
    const n = Math.max(1, Math.ceil(Math.hypot(end[0]-prev[0], end[1]-prev[1]) / spacing));
    for (let i = 1; i <= n; i++) {
      probe.x = prev[0] + (end[0]-prev[0])*i/n; probe.y = prev[1] + (end[1]-prev[1])*i/n;
      const f = g.get(Math.floor(probe.x), Math.floor(probe.y));
      probe.hidden = !hero.inVehicle && ((f & F.TALL) || ((f & F.BUSH) && hero.stance === 'prone')) ? 'bush' : null;
      probe.swimming = !hero.inVehicle && !!(f & F.DEEP);
      let seen = false;
      for (const guard of guards) if (canSee(world, guard, probe)) { seen = true; watchers.add(guard.id); }
      if (f & F.WATER && !(caps & CAP.BOAT)) hazards.add('Wading: slower, audible');
      if (f & F.NOISY) hazards.add('Noisy ground');
      if (f & F.SNOW) hazards.add('Snow: footprints can be followed');
      if (f & F.CLIMB) hazards.add('Climbing point');
      if (litAt(world, probe.x, probe.y)) hazards.add('Crosses artificial light');
      samples.push({ x: probe.x, y: probe.y, seen });
    }
    prev = end;
  }
  return { ok: true, hero: hero.id, mover: mover.id, x, y, run: probe.run, path, samples, length,
    watchers: [...watchers], hazards: [...hazards], stance: hero.inVehicle ? 'Driving / paddling' : hero.stance === 'prone' ? 'Crawling' : probe.run ? 'Running' : 'Walking' };
}

export function fieldStatus(world, hero) {
  if (!hero) return { label: 'Select a hero', suspicion: 0 };
  let suspicion = 0;
  for (const e of world.ents) if (e.kind === 'enemy' && e.state === 'ok') suspicion = Math.max(suspicion, e.ai.susp?.[hero.id] || 0);
  const f = world.grid.get(Math.floor(hero.x), Math.floor(hero.y));
  const label = hero.state !== 'ok' ? hero.state === 'down' ? 'Needs revival' : 'Killed in action'
    : suspicion >= .3 ? 'Being investigated' : suspicion > 0 ? 'Drawing attention'
    : hero.hidden?.startsWith('b:') ? 'Inside cover' : hero.hidden === 'bush' ? 'Concealed in vegetation'
    : hero.inVehicle ? 'Aboard vehicle' : hero.disguised ? 'In disguise — officers may see through it'
    : hero.swimming ? 'Swimming' : f & F.WATER ? 'Wading — slow and audible'
    : f & F.NOISY ? 'Noisy footing' : litAt(world, hero.x, hero.y) ? 'In artificial light'
    : hero.stance === 'prone' ? 'Low profile — near cones still see you' : 'Standing — watch the far cones';
  return { label, suspicion: Math.min(1, suspicion) };
}
