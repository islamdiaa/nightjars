import { F, SPEED, ENEMY_TYPES } from './constants.js';
import { hasLOS, angleDiff } from './los.js';
import { turnToward } from './world.js';
import { inBeam, nextTrack, readTrail, trackLife } from './env.js';

// Enemy behaviour.
//
// Modes: post (stand guard, optional sweep) · patrol (walk a route) · investigate (check a
// noise or glimpse, then return) · checkBody · alert (target in sight: shoot / chase) ·
// search (look around a last-known position) · return (back to post/route) ·
// distracted (talking to a disguised agent) · leave (reinforcements going home) · ko · dead.

const LINES = {
  de: { notice: ['Hm?', 'Wer da?', 'Was war das?'], alert: ['Halt! Stehen bleiben!', 'Da drüben!', 'Feind!'], alarm: ['Alarm! Alarm!'], body: ['Mein Gott… Alarm!'], lost: ['Wo ist er hin?'], calm: ['Nichts. Weiter.', 'Nur der Wind.'], distract: ['Ja, Fräulein?', 'Papiere? Natürlich…'] },
  it: { notice: ['Chi va là?', 'Cos\'era?'], alert: ['Alto là!', 'Nemico!'], alarm: ['Allarme!'], body: ['Madonna… Allarme!'], lost: ['Dov\'è andato?'], calm: ['Niente.'], distract: ['Sì, signorina?'] },
  ja: { notice: ['Dare da?', 'Nanda?'], alert: ['Tomare!', 'Teki da!'], alarm: ['Keihō!'], body: ['Teki da! Keihō!'], lost: ['Doko da?'], calm: ['Ki no sei ka.'], distract: ['Hai?'] },
  fr: { notice: ['Qui va là ?', 'Hein ?'], alert: ['Halte !', 'Là-bas !'], alarm: ['Alerte !'], body: ['Mon Dieu… Alerte !'], lost: ['Où est-il passé ?'], calm: ['Rien.'], distract: ['Oui, madame ?'] },
  ru: { notice: ['Kto idyot?', 'Chto eto?'], alert: ['Stoy!', 'Vrag!'], alarm: ['Trevoga!'], body: ['Trevoga!'], lost: ['Gde on?'], calm: ['Nichego.'], distract: ['Da?'] },
  es: { notice: ['¿Quién anda ahí?', '¿Qué fue eso?'], alert: ['¡Alto!', '¡Policía!'], alarm: ['¡Socorro! ¡Policía!'], body: ['¡Dios mío!'], lost: ['¿Dónde está?'], calm: ['Nada.'], distract: ['¿Sí, señora?'] },
  nl: { notice: ['Wie is daar?', 'Wat was dat?'], alert: ['Halt! Politie!', 'Staan blijven!'], alarm: ['Alarm! Politie!'], body: ['Godallemachtig… Alarm!'], lost: ['Waar is hij gebleven?'], calm: ['Niks.', 'Alleen de wind.'], distract: ['Ja, mevrouw?', 'Papieren? Natuurlijk…'] },
};
const LANG = { wehrmacht: 'de', kriegsmarine: 'de', luftwaffe: 'de', ss: 'de', italian: 'it', japanese: 'ja', vichy: 'fr', soviet: 'ru', neutral: 'es', civilian: 'es', allied: 'de', dutch: 'nl' };

function speak(world, e, kind, force = false) {
  const lang = LINES[e.lang || LANG[e.faction] || 'de'];
  if (!lang || !lang[kind]) return;
  if (!force && world.s.t - (e.ai.lastSpoke || -99) < 3) return;
  e.ai.lastSpoke = world.s.t;
  world.say(e.id, world.rng.pick(lang[kind]), 2.2);
}

const WEAPON_RANGE = { rifle: 13, pistol: 8, mg: 12.5, bite: 1.3 };

// ---------------- perception ----------------

// Is this point lit well enough that a guard sees it at his full range (a lamp's pool, a
// searchlight beam, a flare, a carried lantern)? The cone overlay draws exactly this.
export function litAt(world, x, y) {
  if (world.grid.get(Math.floor(x), Math.floor(y)) & F.LIT) return true;
  if (world.searchlights.length && inBeam(world, x, y)) return true;
  if (world.s.flares && world.s.flares.length && world.litByFlare(x, y)) return true;
  if (world.lanterns && world.litByLantern(x, y)) return true;
  return false;
}

const TOD_LIGHT = { night: 0.55, dusk: 0.85, dawn: 0.85, morning: 1, day: 1 };
const WEATHER_LIGHT = { fog: 0.72, smoke: 0.72, rain: 0.88, snow: 0.88, blizzard: 0.7, storm: 0.7 };

// How far guards see by daylight alone (1 = full range), from the time of day (blended while
// api.time is changing it) and the weather. The cone overlay draws with the same number.
export function ambientLight(world) {
  const tod = world.time || world.def.time;
  let m = TOD_LIGHT[tod] ?? 1;
  const b = world.s.todBlend;
  if (b) { const k = Math.min(1, Math.max(0, (world.s.t - b.t0) / b.dur)); m = (TOD_LIGHT[b.from] ?? 1) * (1 - k) + (TOD_LIGHT[b.to] ?? 1) * k; }
  return m * (WEATHER_LIGHT[world.weather || world.def.weather] ?? 1);
}

function lightMul(world, x, y) {
  if (litAt(world, x, y)) return 1;
  const f = world.grid.get(Math.floor(x), Math.floor(y));
  return ambientLight(world) * (f & F.DARK ? 0.8 : 1);
}

export function visionRange(world, e) {
  const a = world.s.alarm;
  return e.ai.range * world.diff.vision * (a.on ? 1.1 : 1) * (1 + (e.ai.edge || 0) * 0.05);
}

// 0 = not seen, 1 = seen in the far zone, 2 = seen in the near zone.
export function canSee(world, e, u) {
  if (u.state === 'dead') return 0;
  if (u.hidden && (u.hidden.startsWith('b:') || u.hidden === 'water')) return 0;
  const dx = u.x - e.x, dy = u.y - e.y;
  const d = Math.hypot(dx, dy);
  const et = ENEMY_TYPES[e.etype];
  // Dogs smell anyone close, whatever they are wearing.
  if (et.nose && d <= et.nose && !u.swimming) return 2;
  if (d < 0.9) return 2;
  let range = visionRange(world, e) * lightMul(world, u.x, u.y);
  // A white smock on snow is hard to pick out at a distance.
  if (u.snow && (world.grid.get(Math.floor(u.x), Math.floor(u.y)) & F.SNOW)) range *= 0.8;
  if (d > range) return 0;
  // In a crowd (three or more townsfolk within two paces) a hero who is not running is lost to
  // anyone more than three tiles off.
  if (u.kind === 'hero' && !u.run && d > 3 && inCrowd(world, u)) return 0;
  const fov = (e.ai.mode === 'search' || e.ai.mode === 'alert') ? e.ai.fov * 1.25 : e.ai.fov;
  if (Math.abs(angleDiff(e.a, Math.atan2(dy, dx))) > fov / 2) return 0;
  const near = d <= range * e.ai.near;
  // A man at work (cutting wire, planting a charge, picking a lock) rises to it: he is no longer
  // flat, so the far zone sees him. Crawling itself stays low, and so does talk (distract).
  const acting = atWork(world, u);
  const low = (u.stance === 'prone' && !acting) || u.state !== 'ok' || u.swimming;
  // A searchlight shows a man lying flat as clearly as one standing.
  if (low && !near && !(world.searchlights.length && inBeam(world, u.x, u.y))) return 0;
  if (u.hidden === 'bush' && d > 1.5) return 0;
  if (u.camo && u.stance === 'prone' && (u.still || 0) > 0.8 && d > 1.5) return 0;
  if (!hasLOS(world.grid, e.x, e.y, u.x, u.y, low)) return 0;
  return near ? 2 : 1;
}

// Actions that are just talk: a disguised agent striking up a conversation is not "doing
// something" in the eyes of the man she is talking to (or anyone watching).
const TALK = new Set(['distract']);
// Is this unit visibly busy? Talk, and interactions marked `quiet: true` (a phone call, laying
// flowers), are not.
function atWork(world, u) {
  const a = u.act;
  if (!a || TALK.has(a.ab)) return false;
  if (a.ab === 'interact') { const t = world.thingById.get(a.thing); if (t && t.interact && t.interact.quiet) return false; }
  return true;
}

const CROWD_LOOKS = new Set(['civilian', 'woman', 'child', 'scientist', 'sailor', 'prisoner', 'partisan']);
function inCrowd(world, u) {
  let n = 0;
  for (const c of world.ents) {
    if (c.kind !== 'npc' || c.state !== 'ok' || c.follow || (c.hidden && c.hidden.startsWith('b:'))) continue;
    if (!CROWD_LOOKS.has(c.look) && c.role !== 'civilian') continue;
    if (Math.abs(c.x - u.x) < 2 && Math.abs(c.y - u.y) < 2 && ++n >= 3) return true;
  }
  return false;
}

// Does this viewer treat what it sees as hostile? Disguises fool ordinary soldiers.
function suspicious(world, e, u, zone) {
  if (u.kind === 'npc' && u.role === 'civilian') return false;
  // A boat or car passing as a local's (vehicle `disguise: true`, a fishing boat) draws no
  // attention unless it comes right up to him.
  if (u.kind === 'vehicle' && u.disguise) return zone === 2 && Math.hypot(u.x - e.x, u.y - e.y) < 4;
  // Who sees through a disguise up close: officers and dogs, unless the mission says otherwise
  // for this man (enemy def `seesDisguise: true | false`).
  const sees = e.seesDisguise ?? ENEMY_TYPES[e.etype].seesDisguise;
  const busy = atWork(world, u);
  const doingSomething = u.carrying || busy || u.stance === 'prone' || (u.run && Math.hypot(u.x - e.x, u.y - e.y) < 4);
  // The guard she is chatting with sees a comrade (or a market girl), not an intruder, unless she
  // does something; officers and dogs still see through a uniform up close.
  if ((u.disguised || u.civilian) && e.ai.mode === 'distracted' && e.ai.distractBy === u.id && !doingSomething && !sees) return false;
  if (u.disguised) {
    if (doingSomething) return true;
    if (sees && zone === 2) return true;
    return world.mission.inRestricted(u) && zone === 2;
  }
  if (u.civilian) {
    if (doingSomething) return true;
    if (sees && Math.hypot(u.x - e.x, u.y - e.y) < 2.5) return true;
    return world.mission.inRestricted(u);
  }
  return true;
}

// A dozing guard (pose: 'sleep') sees nothing until a noise, the alarm or a comrade wakes him.
export function wake(world, e) {
  if (!e.ai.asleep) return;
  e.ai.asleep = false; e.pose = null;
  world.emit({ type: 'wake', id: e.id, from: 'sleep' });
}

export function perceive(world, e, dt) {
  const ai = e.ai;
  if (ai.mode === 'ko' || ai.mode === 'dead' || ai.oblivious) return;    // a courier who sees nothing but his road
  if (ai.asleep) {
    // Asleep: only the alarm, a noise or someone right beside him (1.5 tiles) wakes him.
    const bump = world.ents.some((u) => (u.kind === 'hero' || (u.kind === 'npc' && u.follow)) && u.state === 'ok' && !(u.hidden && u.hidden.startsWith('b:')) && Math.hypot(u.x - e.x, u.y - e.y) < 1.5);
    const L = world.s.alarm.last;
    const earshot = world.s.alarm.on && (!L || Math.hypot(L.x - e.x, L.y - e.y) <= (world.def.alarmEarshot ?? 24));
    if (earshot || bump) wake(world, e); else return;
  }
  const diff = world.diff;
  let best = null, bestS = 0;
  for (const u of world.ents) {
    // NPCs only draw attention while escaping with the squad (or when a mission exposes them).
    // Vehicles draw fire when someone is aboard, or when they move (a scripted convoy has no
    // passengers but certainly has drivers), or are marked `crew: true`; never their own side's.
    // ...but never an empty armoured hulk standing still (a parked tank), or one marked `ignore`.
    if (u.kind !== 'hero' && !(u.kind === 'npc' && (u.follow || u.exposed || u.fighter)) && !(u.kind === 'vehicle' && u.state === 'ok' && !u.ignore && u.side !== e.side && (u.passengers.length || u.moving || u.crew) && !(u.armour >= 0.75 && !u.passengers.length && !u.moving))) continue;
    if (u.inVehicle) continue;
    if (u.state === 'dead') continue;
    if (u.state === 'down') {
      // A fallen intruder is news, once: the guard shouts, the alarm is queued and he goes to
      // look. He does not re-alert on the body every tick.
      if ((!ai.sawDown || !ai.sawDown[u.id]) && canSee(world, e, u)) {
        (ai.sawDown || (ai.sawDown = {}))[u.id] = 1;
        speak(world, e, 'alert', true);
        world.emit({ type: 'notice', id: e.id, level: 2 });
        world.queueAlarm(e.id, 3.2, u.x, u.y);
        if (ai.mode !== 'alert' && !ai.holdPost) { ai.mode = 'search'; ai.goal = { x: u.x, y: u.y }; e.path = null; ai.searchT = 6; }
      }
      continue;
    }
    const zone = canSee(world, e, u);
    let s = ai.susp[u.id] || 0;
    if (zone && suspicious(world, e, u, zone)) {
      const d = Math.hypot(u.x - e.x, u.y - e.y);
      const range = visionRange(world, e);
      let rate = 1.9 * diff.detect * (1 + (ai.edge || 0) * 0.15);
      rate *= zone === 2 ? 1.7 : 1;
      rate *= 1 + 1.6 * Math.max(0, 1 - d / range);
      if (u.run) rate *= 1.4;
      if (u.carrying || atWork(world, u)) rate *= 1.8;
      if (world.s.alarm.on) rate *= 1.5;
      if (ai.mode === 'search' || ai.mode === 'investigate' || ai.mode === 'checkBody') rate *= 1.4;
      if (u.state === 'down') rate *= 1.5;
      s += rate * dt;
      if (d < 1.6 || u.carrying && d < 3.5) s = 1;
      ai.susp[u.id] = Math.min(1.2, s);
      ai.glimpse = { x: u.x, y: u.y, t: world.s.t };
      if (s > bestS) { bestS = s; best = u; }
    } else if (s > 0) {
      s = Math.max(0, s - 0.3 * dt);
      if (s === 0) delete ai.susp[u.id]; else ai.susp[u.id] = s;
    }
  }

  if (ai.mode === 'alert') {
    const tgt = world.ent(ai.target);
    if (best && bestS >= 1 && (!tgt || tgt.state !== 'ok' || !canSee(world, e, tgt))) ai.target = best.id;
    return;
  }
  if (best && bestS >= 1) return becomeAlert(world, e, best);
  if (best && bestS >= 0.3 && ai.mode !== 'distracted') {
    // Something moved over there: stop and stare.
    if (!ai.notice) { speak(world, e, 'notice'); world.emit({ type: 'notice', id: e.id }); }
    ai.notice = { x: best.x, y: best.y, t: 1.8 };
  }

  // Bodies of comrades in plain view.
  if (ai.mode !== 'checkBody' && ai.mode !== 'distracted') {
    for (const b of world.ents) {
      if (b.kind !== 'enemy' || b.state === 'ok' || b.carriedBy || b.hidden || b.discovered) continue;
      if (b.side !== e.side) continue;
      const d = Math.hypot(b.x - e.x, b.y - e.y);
      if (d > visionRange(world, e) * lightMul(world, b.x, b.y)) continue;
      if (Math.abs(angleDiff(e.a, Math.atan2(b.y - e.y, b.x - e.x))) > ai.fov / 2) continue;
      if (!hasLOS(world.grid, e.x, e.y, b.x, b.y, true)) continue;
      ai.mode = 'checkBody'; ai.body = b.id; ai.goal = { x: b.x, y: b.y }; e.path = null; ai.examT = 1.6;
      b.discovered = true;
      speak(world, e, 'notice', true);
      world.emit({ type: 'notice', id: e.id, level: 2 });
      break;
    }
  }

  // Fresh footprints in the snow: a guard on his round follows them.
  if ((ai.mode === 'post' || ai.mode === 'patrol' || ai.mode === 'return') && world.s.tracks && world.s.tracks.length) {
    const tr = spotTrack(world, e);
    if (tr) {
      readTrail(world, tr);
      if (ai.holdPost) { ai.notice = { x: tr.x, y: tr.y, t: 3 }; speak(world, e, 'notice'); }
      else {
        ai.mode = 'investigate'; ai.goal = { x: tr.x, y: tr.y }; ai.trail = tr.n; ai.trailN = 0;
        e.path = null; ai.lookT = 3.5; ai.hurry = false;
        speak(world, e, 'notice');
        world.emit({ type: 'notice', id: e.id, tracks: true });
      }
    }
  }
}

// Prints are small: they are read at about 60 % of the range a man is seen at.
function spotTrack(world, e) {
  const list = world.s.tracks, ai = e.ai, now = world.s.t, life = trackLife(world);
  const range = visionRange(world, e) * 0.6;
  let checks = 0;
  for (let i = list.length - 1; i >= 0 && checks < 4; i--) {
    const tr = list[i];
    if (tr.seen || now - tr.t > life || now - tr.t < 1.5) continue;
    const dx = tr.x - e.x, dy = tr.y - e.y, d = Math.hypot(dx, dy);
    if (d < 1 || d > range * lightMul(world, tr.x, tr.y)) continue;
    if (Math.abs(angleDiff(e.a, Math.atan2(dy, dx))) > ai.fov / 2) continue;
    checks++;
    if (hasLOS(world.grid, e.x, e.y, tr.x, tr.y, true)) return tr;
  }
  return null;
}

export function becomeAlert(world, e, u) {
  const ai = e.ai;
  // A runner (`report: [x, y]`, a radio hut or the guardroom) does not shout or shoot: he runs to
  // report, and the alarm sounds only if he gets there. A man told to `flee` runs for cover first.
  if ((ai.report || ai.flee) && !world.s.alarm.on && ai.mode !== 'report' && ai.mode !== 'flee' && ai.mode !== 'cower') {
    world.s.stats.seen++;
    ai.last = { x: u.x, y: u.y }; ai.target = u.id; ai.notice = null; e.path = null;
    if (ai.report) { ai.mode = 'report'; ai.goal = { x: ai.report[0] + 0.5, y: ai.report[1] + 0.5 }; }
    else { ai.mode = 'flee'; ai.goal = fleeGoal(world, e, u); }
    speak(world, e, 'alert', true);
    world.emit({ type: 'spotted', id: e.id, target: u.id, runner: true });
    world.mission.hook('onSpotted', e, u);
    return;
  }
  if (ai.mode === 'report' || ai.mode === 'flee') return;
  const first = ai.mode !== 'alert';
  ai.mode = 'alert'; ai.target = u.id; ai.last = { x: u.x, y: u.y }; ai.lostT = 0; ai.notice = null;
  ai.shootT = Math.max(ai.shootT, 0.55);
  e.path = null;
  if (first) {
    world.s.stats.seen++;
    speak(world, e, 'alert', true);
    world.emit({ type: 'spotted', id: e.id, target: u.id });
    world.noise(e.x, e.y, 9, 'shout', e.id);
    world.queueAlarm(e.id, 3.2, u.x, u.y);
    world.mission.hook('onSpotted', e, u);
  }
}

export function onNoise(world, e, x, y, kind, src) {
  const ai = e.ai;
  if (ai.mode === 'alert' || ai.mode === 'ko' || ai.mode === 'dead' || ai.mode === 'report' || ai.mode === 'flee' || ai.mode === 'cower' || ai.deaf || ai.oblivious) return;
  if (ai.asleep) {
    // Soft sounds don't wake a sleeper unless they are right beside him.
    const loudish = ['shot', 'explosion', 'shout', 'scream', 'firecracker', 'whistle', 'engine', 'stone', 'clatter'].includes(kind);
    if (!loudish && Math.hypot(x - e.x, y - e.y) > 2.5) return;
    wake(world, e);
  }
  const loud = kind === 'shot' || kind === 'explosion' || kind === 'shout' || kind === 'scream';
  if (ai.mode === 'distracted' && !loud) return;
  ai.heard = { x, y, t: world.s.t };
  world.emit({ type: 'notice', id: e.id });
  if (loud) {
    speak(world, e, kind === 'shout' ? 'notice' : 'alert');
    if (kind === 'shot') world.queueAlarm(e.id, 4.5, x, y);
    // A man told to hold his post turns, stares and shouts, but stays where he is.
    if (ai.holdPost) {
      if (ai.mode === 'distracted') { ai.distractBy = null; ai.mode = ai.route ? 'patrol' : 'post'; }
      ai.notice = { x, y, t: 4 };
      return;
    }
    ai.mode = 'search'; ai.goal = { x, y }; e.path = null; ai.searchT = 8; ai.hurry = true;
    return;
  }
  if (ai.holdPost) { ai.notice = { x, y, t: 3.5 }; speak(world, e, 'notice'); return; }
  if (ai.mode === 'search' || ai.mode === 'checkBody') return;
  speak(world, e, 'notice');
  ai.mode = 'investigate'; ai.goal = { x, y }; e.path = null; ai.lookT = 4.5; ai.hurry = false;
}

// ---------------- behaviour ----------------

// Cover for a fleeing man: the nearest door away from the threat, else open ground 12 tiles off.
function fleeGoal(world, e, u) {
  let best = null, bd = 1e9;
  for (const t of world.things) {
    if (t.type !== 'building' || !t.door) continue;
    const dx = t.door[0] + 0.5, dy = t.door[1] + 0.5, d = Math.hypot(dx - e.x, dy - e.y);
    if (d > 20 || Math.hypot(dx - u.x, dy - u.y) < d) continue;           // not towards the threat
    if (d < bd) { bd = d; best = { x: dx, y: dy }; }
  }
  if (best) return best;
  const a = Math.atan2(e.y - u.y, e.x - u.x);
  return { x: e.x + Math.cos(a) * 12, y: e.y + Math.sin(a) * 12 };
}

function goTo(world, e, goal, speed, dt) {
  if (!e.path) {
    if (!world.routeTo(e, goal.x, goal.y)) { e.path = null; return 'fail'; }
  }
  return world.advance(e, speed, dt) ? 'arrived' : 'moving';
}

function resumeDuty(e) {
  const ai = e.ai;
  ai.mode = 'return'; e.path = null; ai.notice = null; ai.hurry = false;
}

export function updateEnemy(world, e, dt) {
  const ai = e.ai;
  if (e.state === 'dead') return;
  if (e.state === 'ko') {
    if (e.tied || e.carriedBy) return;
    if ((e.koT -= dt) <= 0) {
      e.state = 'ok'; ai.mode = 'search'; ai.goal = { x: e.x, y: e.y }; ai.searchT = 8; e.path = null; e.discovered = false;
      speak(world, e, 'alarm', true);
      world.queueAlarm(e.id, 2.5, e.x, e.y);
      world.emit({ type: 'wake', id: e.id });
    }
    return;
  }
  ai.shootT = Math.max(0, ai.shootT - dt);
  const alarmOn = world.s.alarm.on;
  if (e.pose && ai.mode !== 'post') { e.pose = null; ai.asleep = false; }   // up on his feet

  // A brief stare at something half-seen overrides routine movement.
  if (ai.notice && (ai.mode === 'post' || ai.mode === 'patrol' || ai.mode === 'return' || ai.mode === 'investigate')) {
    e.a = turnToward(e.a, Math.atan2(ai.notice.y - e.y, ai.notice.x - e.x), 5 * dt);
    ai.notice.t -= dt;
    if (ai.notice.t <= 0) {
      const g = ai.notice; ai.notice = null;
      if (!ai.holdPost && !g.scripted) { ai.mode = 'investigate'; ai.goal = { x: g.x, y: g.y }; e.path = null; ai.lookT = 4; }
    }
    return;
  }

  switch (ai.mode) {
    case 'post': {
      const h = ai.home;
      if (ai.asleep) return;                                     // dozing where he sits
      if (Math.hypot(h.x - e.x, h.y - e.y) > 0.3) { e.pose = null; if (goTo(world, e, h, SPEED.patrol, dt) !== 'moving') e.path = null; return; }
      if (ai.seat && !(ai.sweep && ai.sweep.length)) { e.pose = 'sit'; e.a = turnToward(e.a, h.a, 2 * dt); return; }   // back on his crate
      if (ai.seat) e.pose = 'sit';                                                     // seated, but his eyes still sweep
      if (ai.sweep && ai.sweep.length) {
        ai.sweepT -= dt;
        if (ai.sweepT <= 0) { ai.si = (ai.si + 1) % ai.sweep.length; ai.sweepT = alarmOn ? 2 : 3.5; }
        e.a = turnToward(e.a, ai.sweep[ai.si] * Math.PI / 180, 1.4 * dt);
      } else e.a = turnToward(e.a, h.a, 2 * dt);
      return;
    }
    case 'patrol': {
      const wp = ai.route[ai.ri];
      if (ai.waitT > 0) {
        ai.waitT -= dt;
        if (wp.look !== undefined) e.a = turnToward(e.a, wp.look * Math.PI / 180, 2 * dt);
        if (ai.waitT <= 0) { ai.ri = (ai.ri + 1) % ai.route.length; e.path = null; }
        return;
      }
      const r = goTo(world, e, wp, alarmOn ? SPEED.patrol * 1.3 : SPEED.patrol, dt);
      if (r === 'arrived') { e.path = null; ai.waitT = wp.wait || 0.01; }
      else if (r === 'fail') { ai.ri = (ai.ri + 1) % ai.route.length; }
      return;
    }
    case 'investigate': {
      const r = goTo(world, e, ai.goal, ai.hurry ? SPEED.search : SPEED.patrol * 1.1, dt);
      if (r === 'moving') return;
      e.path = null;
      if (ai.trail != null) {
        // Following prints: on to the next stretch of the trail while it lasts.
        const nx = r === 'arrived' && ai.trailN < 60 ? nextTrack(world, ai.trail, ai.goal) : null;
        if (nx) { nx.seen = true; ai.trail = nx.n; ai.trailN++; ai.goal = { x: nx.x, y: nx.y }; return; }
        ai.trail = null;
      }
      ai.lookT -= dt;
      e.a += Math.sin(world.s.t * 1.7) * 1.6 * dt;
      if (ai.lookT <= 0) { speak(world, e, 'calm'); resumeDuty(e); }
      return;
    }
    case 'checkBody': {
      const b = world.ent(ai.body);
      if (!b || b.carriedBy || b.hidden) { ai.mode = 'search'; ai.goal = ai.goal || { x: e.x, y: e.y }; ai.searchT = 6; e.path = null; return; }
      // A man ordered to hold his post studies the body from where he stands, then shouts.
      if (ai.holdPost) e.a = turnToward(e.a, Math.atan2(b.y - e.y, b.x - e.x), 3 * dt);
      else {
        const r = goTo(world, e, { x: b.x, y: b.y }, SPEED.search, dt);
        if (r === 'moving' && Math.hypot(b.x - e.x, b.y - e.y) > 1.2) return;
      }
      e.path = null;
      ai.examT -= dt;
      if (ai.examT <= 0) {
        speak(world, e, 'body', true);
        world.raiseAlarm(b.x, b.y);
        if (ai.holdPost) resumeDuty(e);                          // shout, then back to his post or his advance
        else { ai.mode = 'search'; ai.goal = { x: b.x, y: b.y }; ai.searchT = 10; }
      }
      return;
    }
    case 'alert': return updateAlert(world, e, dt);
    case 'search': {
      const r = goTo(world, e, ai.goal, alarmOn || ai.hurry ? SPEED.alert * 0.8 : SPEED.search, dt);
      if (r === 'moving') return;
      e.path = null;
      e.a += 1.5 * dt;
      ai.searchT -= dt;
      if (ai.searchT <= 0) {
        if (alarmOn && world.s.alarm.last && !ai.holdPost) {
          const L = world.s.alarm.last;
          ai.goal = { x: L.x + world.rng.range(-6, 6), y: L.y + world.rng.range(-6, 6) }; ai.searchT = 4;
        } else { speak(world, e, 'lost'); resumeDuty(e); }
      }
      return;
    }
    case 'return': {
      let goal = ai.home;
      if (ai.route) {
        // Rejoin the route at its nearest waypoint.
        let bi = 0, bd = 1e9;
        ai.route.forEach((p, i) => { const d = Math.hypot(p.x - e.x, p.y - e.y); if (d < bd) { bd = d; bi = i; } });
        ai.ri = bi; goal = ai.route[bi];
      }
      const r = goTo(world, e, goal, SPEED.patrol, dt);
      if (r !== 'moving') { e.path = null; ai.mode = ai.route ? 'patrol' : 'post'; ai.waitT = 0; }
      return;
    }
    case 'distracted': {
      const k = world.ent(ai.distractBy);
      ai.distractT -= dt;
      if (!k || k.state !== 'ok' || Math.hypot(k.x - e.x, k.y - e.y) > 2.4 || ai.distractT <= 0 || !k.disguised) { ai.distractBy = null; resumeDuty(e); return; }
      e.a = turnToward(e.a, Math.atan2(k.y - e.y, k.x - e.x), 4 * dt);
      return;
    }
    case 'report': {
      // Running to raise the alarm in person.
      const r = goTo(world, e, ai.goal, SPEED.alert, dt);
      if (r === 'moving') return;
      e.path = null;
      speak(world, e, 'alarm', true);
      world.raiseAlarm(ai.last ? ai.last.x : e.x, ai.last ? ai.last.y : e.y);
      ai.mode = 'search'; ai.goal = ai.last || { x: e.x, y: e.y }; ai.searchT = 8;
      return;
    }
    case 'flee': {
      const r = goTo(world, e, ai.goal, SPEED.alert, dt);
      if (r === 'moving') return;
      e.path = null;
      world.queueAlarm(e.id, 4, ai.last ? ai.last.x : e.x, ai.last ? ai.last.y : e.y);
      ai.mode = 'cower'; ai.lookT = 30;
      return;
    }
    case 'cower': {
      // In cover, head down, until the danger has passed.
      if ((ai.lookT -= dt) <= 0) resumeDuty(e);
      return;
    }
    case 'leave': {
      const r = goTo(world, e, e.reinf, SPEED.patrol * 1.2, dt);
      if (r !== 'moving') world.removeEnt(e.id);
      return;
    }
    default: return;
  }
}

function updateAlert(world, e, dt) {
  const ai = e.ai;
  let tgt = world.ent(ai.target);
  if (!tgt || tgt.state !== 'ok' || (tgt.hidden && tgt.hidden.startsWith('b:'))) {
    ai.mode = 'search'; ai.goal = ai.last || { x: e.x, y: e.y }; ai.searchT = 8; e.path = null; ai.target = null;
    return;
  }
  const et = ENEMY_TYPES[e.etype];
  const range = WEAPON_RANGE[et.weapon] || 10;
  const seen = canSee(world, e, tgt) > 0 || (Math.hypot(tgt.x - e.x, tgt.y - e.y) < 6 && hasLOS(world.grid, e.x, e.y, tgt.x, tgt.y, tgt.stance === 'prone'));
  const d = Math.hypot(tgt.x - e.x, tgt.y - e.y);
  // Grenadiers (`grenades: n`) lob one at a target in cover, lying flat or holding still.
  ai.grenadeT = Math.max(0, (ai.grenadeT ?? 1.2) - dt);
  if (e.grenades > 0 && ai.grenadeT <= 0 && ai.last) {
    const gd = Math.hypot(ai.last.x - e.x, ai.last.y - e.y);
    if (gd >= 3.5 && gd <= 9 && (!seen || tgt.stance === 'prone' || !tgt.moving)) {
      e.grenades--; ai.grenadeT = 8;
      const sp = Math.min(1.5, gd * 0.12);
      world.throwProjectile('grenade', e, ai.last.x + world.rng.range(-sp, sp), ai.last.y + world.rng.range(-sp, sp));
      speak(world, e, 'alert', true);
    }
  }
  if (seen) {
    ai.last = { x: tgt.x, y: tgt.y }; ai.lostT = 0;
    world.s.alarm.last = { x: tgt.x, y: tgt.y };
    e.a = turnToward(e.a, Math.atan2(tgt.y - e.y, tgt.x - e.x), 8 * dt);
    // An empty armoured hulk (a parked tank) is not worth a fight: after a few seconds he gives up.
    if (tgt.kind === 'vehicle' && !tgt.passengers.length && !tgt.moving && (tgt.armour >= 0.75 || tgt.ignore)) {
      ai.vehT = (ai.vehT || 0) + dt;
      if (ai.vehT > 4) { ai.vehT = 0; ai.target = null; ai.susp[tgt.id] = 0; resumeDuty(e); return; }
    }
    if (d <= range) {
      e.path = null;
      if (ai.shootT <= 0 && !e.holdFire) fire(world, e, tgt, d, et.weapon);
    } else if (!ai.holdPost) {
      if (!e.path || (world.s.tick % 15 === 0)) world.routeTo(e, tgt.x, tgt.y);
      world.advance(e, SPEED.alert, dt);
    }
  } else {
    ai.lostT += dt;
    if (ai.lostT > 1.5) {
      ai.mode = 'search'; ai.goal = ai.last; ai.searchT = 8; e.path = null; ai.hurry = true;
      speak(world, e, 'lost');
      return;
    }
    if (!ai.holdPost && ai.last) { if (!e.path) world.routeTo(e, ai.last.x, ai.last.y); world.advance(e, SPEED.alert, dt); }
  }
}

function fire(world, e, tgt, d, weapon) {
  const diff = world.diff;
  if (tgt.kind === 'vehicle') {
    const shots = weapon === 'mg' ? 3 : 1;
    for (let i = 0; i < shots; i++) {
      const hit = world.rng.chance(diff.accuracy * 0.8);
      world.emit({ type: 'shot', from: e.id, to: tgt.id, hit, weapon, i });
      if (hit) world.damageVehicle(tgt, 1, e);
    }
    world.noise(e.x, e.y, 18, 'shot', e.id);
    e.ai.shootT = diff.fireDelay * world.rng.range(0.85, 1.2);
    return;
  }
  if (weapon === 'bite') {
    world.emit({ type: 'bite', from: e.id, to: tgt.id });
    if (tgt.kind === 'hero') world.damageHero(tgt); else world.killHero(tgt);
    e.ai.shootT = 1.2;
    return;
  }
  const shots = weapon === 'mg' ? 3 : 1;
  let p = diff.accuracy * Math.min(1, Math.max(0.25, 1.15 - d / 16));
  if (tgt.stance === 'prone') p *= 0.6;
  if (tgt.run && tgt.moving) p *= 0.75;
  if (weapon === 'mg') p *= 0.55;
  for (let i = 0; i < shots; i++) {
    const hit = world.rng.chance(p);
    world.emit({ type: 'shot', from: e.id, to: tgt.id, hit, weapon, i });
    if (hit) {
      if (tgt.kind === 'hero') world.damageHero(tgt, e);
      else if (tgt.kind === 'npc') { tgt.hp -= 1; if (tgt.hp <= 0) world.killHero(tgt); }
      if (tgt.state !== 'ok') break;
    }
  }
  world.noise(e.x, e.y, 18, 'shot', e.id);
  e.ai.shootT = diff.fireDelay * (weapon === 'pistol' ? 1.2 : weapon === 'mg' ? 1.5 : 1) * world.rng.range(0.85, 1.2);
}

export { speak };
