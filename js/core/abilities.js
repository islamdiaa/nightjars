import { F } from './constants.js';
import { hasLOS } from './los.js';
import { thingCenter } from './world.js';
import { speak } from './ai.js';

// Hero abilities. Each entry describes targeting and range; `check` returns a reason string
// when the ability cannot be used on that target, and `use` applies the effect.
//
// target: 'none'   – instant on self (toggles, whistle)
//         'enemy'  – a live enemy unit
//         'body'   – a knocked-out or dead enemy
//         'ground' – a point on the map
//         'thing'  – a map object (charges, fences, ships)
//         'hero'   – another hero (revive)

const live = (w, t) => { const e = t && t.ent && w.ent(t.ent); return e && e.kind === 'enemy' && e.state === 'ok' ? e : null; };
const body = (w, t) => { const e = t && t.ent && w.ent(t.ent); return e && e.kind === 'enemy' && e.state !== 'ok' && !e.carriedBy ? e : null; };
const ammo = (h, k) => (h.ammo[k] === undefined ? Infinity : h.ammo[k]);
const spend = (h, k) => { if (h.ammo[k] !== undefined && h.ammo[k] !== Infinity) h.ammo[k]--; };

function needAmmo(h, k) { return ammo(h, k) <= 0 ? 'Out of ammunition' : null; }
function behindOrUnaware(w, h, e) {
  // Melee only works if the target is not facing and fighting the attacker.
  return e.ai.mode === 'alert' && e.ai.target === h.id && w.rng.next() < 0.5 ? 'They saw you coming' : null;
}

function shoot(w, h, e, { dmg, noise, kind }) {
  const d = Math.hypot(e.x - h.x, e.y - h.y);
  const p = d < 5 ? 0.92 : d < 9 ? 0.8 : 0.68;
  const hit = w.rng.chance(kind === 'rifle' || kind === 'silentrifle' ? Math.min(0.97, p + 0.15) : p);
  w.s.stats.shots++;
  w.emit({ type: 'shot', from: h.id, to: e.id, hit, weapon: kind });
  if (noise > 0) w.noise(h.x, h.y, noise, noise > 6 ? 'shot' : 'steps', h.id);
  if (hit) {
    e.hp -= dmg;
    if (e.hp <= 0) w.kill(e, h, kind);
    else if (e.state === 'ok') { e.ai.susp[h.id] = 1; e.ai.mode = 'alert'; e.ai.target = h.id; e.ai.last = { x: h.x, y: h.y }; w.queueAlarm(e.id, 3, h.x, h.y); }
  }
}

export const ABILITIES = {
  knife: {
    name: 'Knife', desc: 'Silent kill at arm\'s length.', target: 'enemy', range: 1.15, dur: 0.6, hitT: 0.3,
    check: (w, h, t) => (!live(w, t) ? 'No target' : null),
    use: (w, h, t) => { const e = live(w, t); if (e) { w.kill(e, h, 'knife'); } },
  },
  kukri: {
    name: 'Kukri', desc: 'Fast, silent and final.', target: 'enemy', range: 1.25, dur: 0.45, hitT: 0.2,
    check: (w, h, t) => (!live(w, t) ? 'No target' : null),
    use: (w, h, t) => { const e = live(w, t); if (e) w.kill(e, h, 'kukri'); },
  },
  bolo: {
    name: 'Bolo', desc: 'A farmer\'s blade, silent.', target: 'enemy', range: 1.15, dur: 0.55, hitT: 0.28,
    check: (w, h, t) => (!live(w, t) ? 'No target' : null),
    use: (w, h, t) => { const e = live(w, t); if (e) w.kill(e, h, 'bolo'); },
  },
  punch: {
    name: 'Knock out', desc: 'Stun a guard for 40 seconds. Tie them to keep them down.', target: 'enemy', range: 1.15, dur: 0.6, hitT: 0.3,
    check: (w, h, t) => { const e = live(w, t); if (!e) return 'No target'; return behindOrUnaware(w, h, e); },
    use: (w, h, t) => { const e = live(w, t); if (e) w.knockout(e, h, 'punch', 40); },
  },
  chloroform: {
    name: 'Chloroform', desc: 'Silent, non-lethal. They sleep for a minute unless tied.', target: 'enemy', range: 1.1, dur: 1.0, hitT: 0.5,
    check: (w, h, t) => { const e = live(w, t); if (!e) return 'No target'; return behindOrUnaware(w, h, e); },
    use: (w, h, t) => { const e = live(w, t); if (e) w.knockout(e, h, 'chloroform', 60); },
  },
  tie: {
    name: 'Tie up', desc: 'Bind and gag an unconscious enemy for good.', target: 'body', range: 1.2, dur: 1.6, hitT: 1.5, hidden: true,
    check: (w, h, t) => { const e = body(w, t); if (!e) return 'Nobody to tie'; if (e.state !== 'ko') return 'Already dead'; if (e.tied) return 'Already tied'; return null; },
    use: (w, h, t) => { const e = body(w, t); if (e) { e.tied = true; w.emit({ type: 'tied', id: e.id }); } },
  },
  surrender: {
    name: 'Hands up!', desc: 'Get the drop on an unsuspecting guard: he drops his weapon and is your prisoner.', target: 'enemy', range: 3, needsLos: true, dur: 0.8, hitT: 0.6,
    check: (w, h, t) => {
      const e = live(w, t);
      if (!e) return 'No target';
      if (e.etype === 'dog') return 'Not a dog';
      if (e.etype === 'officer' && !e.surrenders) return 'An officer will not give in';
      if (!e.surrenders && (e.ai.mode === 'alert' || (e.ai.susp[h.id] || 0) > 0.6)) return 'He has seen you coming';
      return null;
    },
    use: (w, h, t) => { const e = live(w, t); if (!e) return; w.emit({ type: 'surrender', id: e.id, by: h.id }); e.state = 'ko'; w.capture(e, h); },
  },
  capture: {
    name: 'Take prisoner', desc: 'Bring round an unconscious enemy as a prisoner who walks with you.', target: 'body', range: 1.2, dur: 1.4, hitT: 1.3,
    check: (w, h, t) => { const e = body(w, t); if (!e) return 'Nobody to take'; if (e.state !== 'ko') return 'He is dead'; if (e.etype === 'dog') return 'Not a dog'; return null; },
    use: (w, h, t) => { const e = body(w, t); if (e) w.capture(e, h); },
  },
  carry: {
    name: 'Carry body', desc: 'Lift a body and hide it in bushes, buildings or water.', target: 'body', range: 1.15, dur: 0.6, hitT: 0.5,
    targetFor: (w, h) => (h.carrying ? 'none' : 'body'),
    check: (w, h, t) => { if (h.carrying) return null; if (!body(w, t)) return 'Nothing to carry'; return null; },
    use: (w, h, t) => {
      if (h.carrying) return dropBody(w, h);
      const e = body(w, t); if (!e) return;
      if (h.stance === 'prone') h.stance = 'stand';
      h.carrying = e.id; e.carriedBy = h.id; e.hidden = null; e.discovered = false;
      w.emit({ type: 'pickup', id: h.id, body: e.id });
    },
  },
  stone: {
    name: 'Throw stone', desc: 'A clatter that draws a guard to look.', target: 'ground', range: 8.5, cooldown: 1.2,
    check: (w, h) => (h.cd.stone > 0 ? 'Wait a moment' : null),
    use: (w, h, t) => { w.throwProjectile('stone', h, t.x, t.y); h.cd.stone = 1.2; },
  },
  firecracker: {
    name: 'Firecrackers', desc: 'A loud string of bangs where they land.', target: 'ground', range: 9.5, ammo: 4,
    check: (w, h) => needAmmo(h, 'firecracker'),
    use: (w, h, t) => { spend(h, 'firecracker'); w.throwProjectile('firecracker', h, t.x, t.y); },
  },
  whistle: {
    name: 'Whistle', desc: 'Lure nearby guards to your position.', target: 'none', cooldown: 3,
    check: (w, h) => (h.cd.whistle > 0 ? 'Wait a moment' : null),
    use: (w, h) => { h.cd.whistle = 3; w.noise(h.x, h.y, 7, 'whistle', h.id); w.emit({ type: 'whistle', id: h.id }); },
  },
  pistol: {
    name: 'Pistol', desc: 'Loud. Use when stealth has failed.', target: 'enemy', range: 8, needsLos: true, dur: 0.35, hitT: 0.15, ammo: 8,
    check: (w, h, t) => (!live(w, t) ? 'No target' : needAmmo(h, 'pistol')),
    use: (w, h, t) => { const e = live(w, t); if (!e) return; spend(h, 'pistol'); shoot(w, h, e, { dmg: 1, noise: 16, kind: 'pistol' }); },
  },
  welrod: {
    name: 'Welrod', desc: 'SOE\'s silenced pistol. Quiet, short-ranged.', target: 'enemy', range: 6, needsLos: true, dur: 0.45, hitT: 0.2, ammo: 6,
    check: (w, h, t) => (!live(w, t) ? 'No target' : needAmmo(h, 'welrod')),
    use: (w, h, t) => { const e = live(w, t); if (!e) return; spend(h, 'welrod'); shoot(w, h, e, { dmg: 2, noise: 2.5, kind: 'welrod' }); },
  },
  rifle: {
    name: 'Rifle', desc: 'One shot, one kill, heard across the map.', target: 'enemy', range: 15, needsLos: true, dur: 0.9, hitT: 0.7, ammo: 6,
    check: (w, h, t) => (!live(w, t) ? 'No target' : needAmmo(h, 'rifle')),
    use: (w, h, t) => { const e = live(w, t); if (!e) return; spend(h, 'rifle'); shoot(w, h, e, { dmg: 2, noise: 20, kind: 'rifle' }); },
  },
  silentrifle: {
    name: 'Suppressed rifle', desc: 'A Mosin with a Bramit silencer. Quiet and deadly.', target: 'enemy', range: 14, needsLos: true, dur: 1.0, hitT: 0.8, ammo: 8,
    check: (w, h, t) => (!live(w, t) ? 'No target' : needAmmo(h, 'silentrifle')),
    use: (w, h, t) => { const e = live(w, t); if (!e) return; spend(h, 'silentrifle'); shoot(w, h, e, { dmg: 2, noise: 3.5, kind: 'silentrifle' }); },
  },
  bren: {
    name: 'Bren burst', desc: 'Sweeps a cone with fire. Very loud.', target: 'ground', range: 12, dur: 0.9, hitT: 0.25, ammo: 6,
    check: (w, h) => needAmmo(h, 'bren'),
    use: (w, h, t) => {
      spend(h, 'bren');
      const a = Math.atan2(t.y - h.y, t.x - h.x);
      w.emit({ type: 'burst', from: h.id, x: t.x, y: t.y });
      for (const e of w.liveEnemies()) {
        const d = Math.hypot(e.x - h.x, e.y - h.y);
        if (d > 12) continue;
        const da = Math.abs(Math.atan2(Math.sin(Math.atan2(e.y - h.y, e.x - h.x) - a), Math.cos(Math.atan2(e.y - h.y, e.x - h.x) - a)));
        if (da < 0.16 + 0.6 / Math.max(d, 1) && hasLOS(w.grid, h.x, h.y, e.x, e.y)) w.kill(e, h, 'bren');
      }
      w.noise(h.x, h.y, 26, 'shot', h.id);
      w.s.stats.shots++;
    },
  },
  grenade: {
    name: 'Grenade', desc: 'Kills everything within two paces. Raises the alarm.', target: 'ground', range: 7.5, ammo: 2,
    check: (w, h) => needAmmo(h, 'grenade'),
    use: (w, h, t) => { spend(h, 'grenade'); w.throwProjectile('grenade', h, t.x, t.y); },
  },
  charge: {
    name: 'Explosive charge', desc: 'Place a charge, detonate it later from anywhere.', target: 'thing', alsoGround: true, range: 1.4, dur: 1.4, hitT: 1.3, ammo: 3,
    check: (w, h, t) => needAmmo(h, 'charge'),
    use: (w, h, t) => {
      spend(h, 'charge');
      const p = t.thing ? thingCenter(w.thingById.get(t.thing)) : t;
      w.placeCharge(h, p.x, p.y, 'remote', t.thing || null);
    },
  },
  detonate: {
    name: 'Detonate', desc: 'Fire every charge you have placed.', target: 'none', hidden: true,
    check: (w, h) => (w.charges(h.id).length ? null : 'No charges placed'),
    use: (w, h) => { for (const [id] of w.charges(h.id)) w.detonate(id); },
  },
  timer: {
    name: 'Time pencil', desc: 'A charge on a ten-second fuse.', target: 'thing', alsoGround: true, range: 1.4, dur: 1.4, hitT: 1.3, ammo: 2,
    check: (w, h) => needAmmo(h, 'timer'),
    use: (w, h, t) => {
      spend(h, 'timer');
      const p = t.thing ? thingCenter(w.thingById.get(t.thing)) : t;
      w.placeCharge(h, p.x, p.y, 'timed', t.thing || null, 10);
    },
  },
  limpet: {
    name: 'Limpet mine', desc: 'Fix it below the waterline. Long fuse.', target: 'thing', range: 1.6, dur: 2.2, hitT: 2.0, ammo: 4,
    check: (w, h, t) => {
      const th = t && t.thing && w.thingById.get(t.thing);
      if (!th || !th.limpet) return 'Limpets go on hulls';
      if (w.thingState(th.id).limpet) return 'Already mined';
      return needAmmo(h, 'limpet');
    },
    use: (w, h, t) => {
      spend(h, 'limpet');
      const th = w.thingById.get(t.thing);
      w.thingState(th.id).limpet = true;
      const c = thingCenter(th);
      const id = w.placeCharge(h, c.x, c.y, th.limpetFuse ? 'timed' : 'remote', th.id, th.limpetFuse || 0);
      w.s.objs[id].quiet = true;
      w.emit({ type: 'limpet', thing: th.id });
      w.mission.hook('onLimpet', th, h);
    },
  },
  cutters: {
    name: 'Wire cutters', desc: 'Cut a gap in a wire fence.', target: 'thing', range: 1.4, dur: 2.0, hitT: 1.9,
    check: (w, h, t) => {
      const th = t && t.thing && w.thingById.get(t.thing);
      if (!th || th.type !== 'fence' || !th.cuttable) return 'Only wire can be cut';
      return w.thingState(th.id).cut ? 'Already cut' : null;
    },
    use: (w, h, t) => { w.thingState(t.thing).cut = true; w.rebuildFlags(); w.emit({ type: 'cut', thing: t.thing }); w.noise(h.x, h.y, 1.5, 'steps', h.id); },
  },
  disguise: {
    name: 'Disguise', desc: 'Wear an enemy uniform. Officers and dogs see through it up close.', target: 'none',
    targetFor: (w, h) => (h.uniform ? 'none' : 'body'), range: 1.15, dur: 0,
    check: (w, h, t) => {
      if (h.uniform) return h.carrying ? 'Put the body down first' : null;
      const e = body(w, t);
      if (!e) return 'Take a uniform from an unconscious or dead soldier';
      if (e.etype === 'dog') return 'Not that one';
      return null;
    },
    use: (w, h, t) => {
      if (!h.uniform) {
        // The uniform is whatever the man was wearing: a sailor's, a policeman's, a Wehrmacht tunic.
        const e = body(w, t);
        h.uniform = true; h.disguised = true;
        h.disguiseFaction = (e && e.faction) || h.disguiseFaction || 'wehrmacht';
        if (e) { h.disguiseType = e.etype; h.disguiseLook = e.look === 'plain' ? 'plain' : null; }
        w.emit({ type: 'disguise', id: h.id, on: true }); w.message(`${h.name} changes into the uniform.`); return;
      }
      h.disguised = !h.disguised;
      if (h.disguised) h.stance = 'stand';
      w.emit({ type: 'disguise', id: h.id, on: h.disguised });
    },
  },
  distract: {
    name: 'Distract', desc: 'Engage a guard in conversation; he will face you while you stay close.', target: 'enemy', range: 1.6, dur: 0.4, hitT: 0.3,
    check: (w, h, t) => {
      const e = live(w, t);
      if (!e) return 'No target';
      if (!h.disguised) return 'Only in disguise';
      if (e.ai.mode === 'alert') return 'Too late for small talk';
      if (e.etype === 'dog') return 'Dogs don\'t chat';
      return null;
    },
    use: (w, h, t) => {
      const e = live(w, t); if (!e) return;
      e.ai.mode = 'distracted'; e.ai.distractBy = h.id; e.ai.distractT = 25; e.path = null;
      speak(w, e, 'distract', true);
      w.emit({ type: 'distract', id: e.id, by: h.id });
    },
  },
  binoculars: {
    name: 'Binoculars', desc: 'Watch an area: reveals every guard\'s view cone there for a while.', target: 'ground', range: 999, cooldown: 1,
    use: (w, h, t) => { h.a = Math.atan2(t.y - h.y, t.x - h.x); w.emit({ type: 'reveal', x: t.x, y: t.y, r: 11, dur: 9 }); },
  },
  scout: {
    name: 'Scout', desc: 'Li Mei reads the land: shows every patrol route nearby.', target: 'none', cooldown: 15,
    check: (w, h) => (h.cd.scout > 0 ? 'Not yet' : null),
    use: (w, h) => { h.cd.scout = 15; w.emit({ type: 'routes', x: h.x, y: h.y, r: 18, dur: 12 }); },
  },
  camouflage: {
    name: 'Camouflage', desc: 'Lie still under the cloak: invisible beyond two paces.', target: 'none',
    use: (w, h) => { h.camo = !h.camo; if (h.camo) { h.stance = 'prone'; h.path = null; h.moving = false; } w.emit({ type: 'camo', id: h.id, on: h.camo }); },
  },
  civilian: {
    name: 'Blend in', desc: 'Pass as a market girl. Officers and restricted areas are dangerous.', target: 'none',
    check: (w, h) => (h.carrying ? 'Not while carrying' : null),
    use: (w, h) => { h.civilian = !h.civilian; if (h.civilian) h.stance = 'stand'; w.emit({ type: 'disguise', id: h.id, on: h.civilian }); },
  },
  search: {
    name: 'Search', desc: 'Go through a body\'s pockets.', target: 'body', range: 1.2, dur: 1.0, hitT: 0.9, hidden: true,
    check: (w, h, t) => (body(w, t) ? null : 'Nobody to search'),
    use: (w, h, t) => { const e = body(w, t); if (e && !e.item) w.emit({ type: 'deny', id: h.id, text: 'Nothing on him' }); },
  },
  disembark: {
    name: 'Get out', desc: 'Leave the vehicle or boat.', target: 'none', hidden: true,
    check: (w, h) => (h.inVehicle ? null : 'Not aboard anything'),
    use: (w, h) => w.disembark(h),
  },
  revive: {
    name: 'First aid', desc: 'Get a fallen comrade back on their feet.', target: 'hero', range: 1.2, dur: 3, hitT: 2.9, hidden: true,
    check: (w, h, t) => { const o = t && t.ent && w.ent(t.ent); return o && o.state === 'down' ? null : 'Nobody to help'; },
    use: (w, h, t) => { const o = w.ent(t.ent); if (o && o.state === 'down') { o.state = 'ok'; o.hp = 1; o.downT = 0; w.emit({ type: 'revived', id: o.id }); } },
  },
};

// Passive capabilities (no button).
export const PASSIVE = new Set(['swim', 'climb', 'lockpick', 'drive', 'radio', 'guide', 'boat']);

// Contextual actions that come with a hero's kit: whoever places remote charges or limpets can
// fire them, and every hero with a blade or a knockout can tie up a man they have put down.
// (Missions that still list them under `extra` keep working: nothing is added twice.)
export const IMPLIED = {
  detonate: ['charge', 'timer', 'limpet'],
  tie: ['knife', 'kukri', 'bolo', 'punch', 'chloroform'],
};

export function heroAbilities(h) {
  const base = h.abilities || [];
  let out = base;
  for (const ab in IMPLIED) {
    if (base.includes(ab) || !IMPLIED[ab].some((a) => base.includes(a))) continue;
    if (out === base) out = [...base];
    out.push(ab);
  }
  return out;
}

// An unconscious enemy, not yet bound (or any body, for dragging), close enough to offer the action.
function tieable(w, h, any = false) {
  for (const e of w.ents) {
    if (e.kind !== 'enemy' || e.state === 'ok' || (!any && (e.state !== 'ko' || e.tied)) || e.carriedBy || (e.hidden && e.hidden.startsWith('b:'))) continue;
    if (Math.hypot(e.x - h.x, e.y - h.y) < 6) return true;
  }
  return false;
}

// Buttons shown on the ability bar for a hero, in order, with contextual extras.
export function abilityBar(w, h) {
  const abs = heroAbilities(h);
  const list = abs.filter((a) => ABILITIES[a] && !ABILITIES[a].hidden);
  if (w.charges(h.id).length) list.push('detonate');
  if (abs.includes('tie') && !h.inVehicle && tieable(w, h)) list.push('tie');
  // Without `carry` a hero can still drag a body, slowly: offered when one is near (or held).
  if (!abs.includes('carry') && !h.inVehicle && (h.carrying || tieable(w, h, true))) list.push('carry');
  if (h.inVehicle) { const keep = list.filter((a) => ['bren', 'rifle', 'pistol', 'welrod', 'silentrifle', 'grenade', 'binoculars', 'whistle', 'firecracker', 'stone'].includes(a)); keep.push('disembark'); return keep; }
  return list;
}

export function targetKind(w, h, abId) {
  const ab = ABILITIES[abId];
  return ab.targetFor ? ab.targetFor(w, h) : ab.target;
}

export function dropBody(w, h) {
  const e = w.ent(h.carrying);
  h.carrying = null;
  if (!e) return;
  e.carriedBy = null;
  e.x = h.x + Math.cos(h.a) * 0.4; e.y = h.y + Math.sin(h.a) * 0.4;
  // At the water's edge the body goes in: the nearest water tile within reach (unless he stands
  // in a bush, where it is hidden anyway).
  if (!(w.grid.get(Math.floor(h.x), Math.floor(h.y)) & (F.BUSH | F.TALL)) && !(w.grid.get(Math.floor(e.x), Math.floor(e.y)) & (F.WATER | F.DEEP))) {
    let best = null, bd = 1.6;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = Math.floor(h.x) + dx, y = Math.floor(h.y) + dy;
      if (!(w.grid.get(x, y) & (F.WATER | F.DEEP)) || (w.grid.get(x, y) & F.BLOCK)) continue;
      const d = Math.hypot(x + 0.5 - h.x, y + 0.5 - h.y);
      if (d < bd) { bd = d; best = [x + 0.5, y + 0.5]; }
    }
    if (best) { e.x = best[0]; e.y = best[1]; }
  }
  const f = w.grid.get(Math.floor(e.x), Math.floor(e.y));
  if (f & (F.BUSH | F.TALL)) e.hidden = 'bush';
  else if (f & F.DEEP || f & F.WATER) e.hidden = 'water';
  else e.hidden = null;
  w.emit({ type: 'drop', id: h.id, body: e.id, hidden: e.hidden });
}
