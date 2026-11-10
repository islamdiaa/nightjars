import { T, F } from '../../core/constants.js';

// M2 · The Kuty Bridge · night of 17 September 1939 · Kuty on the Czeremosz, Polish-Romanian border.
// Second tutorial: escorting. Wrona alone finds three Cipher Bureau civilians hiding in the town
// (the Armenian church, the inn on the market, the water mill), burns the worksheets they left in
// an abandoned car, and walks them across the wooden bridge into Romania before first light.
// The Red Army crossed the frontier that morning; a Soviet reconnaissance party that has ridden far
// ahead of it, and a local red militia that has been firing on Polish convoys, hold the market and
// have closed the bridge (invented: the real Red Army reached the border here days later).
//
// Escort rules layered on the engine by this file (see escortTick). The engine itself takes the
// gentlemen who follow Wrona into any building with him and out again.
//   - a specialist is found by entering the building he hides in; he then follows Wrona;
//   - a specialist told to wait beside a door slips inside; waiting in the open he can be seen.
// Night lamps: anyone in a lamp's pool is seen at full range. Three lanterns can be blown out (the
// churchyard gate, the jam on Bridge Street, the bridge road); a few seconds later their keeper notices
// the dark and walks over to light it again, a lure if he lives, a dark corner for good if he does not.
// Design brief: design/m02.md.

const DAWN = { easy: 4500, normal: 3300, hard: 2400 };   // seconds of play until first light (05:10)
const SPEC = {
  spectacles: { name: 'Spectacles', home: 'church' },
  overcoat: { name: 'Overcoat', home: 'inn' },
  pipe: { name: 'Pipe', home: 'mill' },
};
// Lanterns that can be blown out, and the man who will come to light them again.
const LANTERNS = { gateLamp: 'gate', jamLamp: 'looter', bridgeLamp: 'barrierwatch' };
const LAMP_SPOT = { gateLamp: [47.5, 17.5], jamLamp: [65.5, 42.5], bridgeLamp: [74.5, 61.5] };   // where he stands to light it

const dawnAt = (api) => DAWN[api.difficulty] || DAWN.normal;
const setProgress = (api, id, text) => { const o = api.world.s.objectives.find((x) => x.id === id); if (o) o.progress = text; };
const inside = (u) => (u && u.hidden && u.hidden.startsWith('b:') ? u.hidden.slice(2) : null);
const doorPos = (t) => ({ x: t.door[0] + 0.5, y: t.door[1] + 0.5 });
const alive = (e) => e && e.state === 'ok';
const calm = (e) => alive(e) && ['post', 'patrol', 'return'].includes(e.ai.mode);
const near = (api, tag, r) => {
  const e = api.ent(tag), h = api.hero('wrona');
  return e && e.state === 'ok' && h && h.state === 'ok' && Math.hypot(e.x - h.x, e.y - h.y) < r;
};
const heroNear = (api, x, y, r) => { const h = api.hero('wrona'); return h && h.state === 'ok' && !inside(h) && Math.hypot(h.x - x, h.y - y) < r; };
const fired = (api, id) => !!api.world.s.fired[id];
const followers = (api, h) => api.tagged('spec').filter((n) => n.state === 'ok' && n.follow === h.id);

function found(api, n) {
  if (api.flag('found:' + n.sid)) return;
  api.flag('found:' + n.sid, true);
  const count = (api.flag('foundN') || 0) + 1;
  api.flag('foundN', count);
  setProgress(api, 'find', `${count}/3`);
  const lines = {
    spectacles: [
      { who: 'Spectacles', line: 'The major sent you? Thank God. I have been up in that tower all evening counting stars. There are fewer than you would think.' },
      { who: 'wrona', line: 'Count my steps instead. Walk where I walk.' },
    ],
    overcoat: [
      { who: 'Overcoat', line: 'Lieutenant. The innkeeper hid me behind his beer barrels and would not take a grosz. Remember his name, would you? Somebody should.' },
      { who: 'wrona', line: 'I will. Now, quietly.' },
    ],
    pipe: [
      { who: 'Pipe', line: 'The miller\'s wife says they came at dusk asking for "Polish lords". I told them I teach arithmetic. It is very nearly true.' },
      { who: 'wrona', line: 'Put the pipe away, Professor. They can smell it in Moscow.' },
    ],
  }[n.sid] || [];
  if (count === 1) {
    lines.push({ who: n.name, line: 'Our worksheets. A brown case, in the major\'s car. It is stuck in the jam on the road to the bridge. We could not run with it. It must not be found.' });
    lines.push({ who: 'wrona', line: 'Then it burns.' });
  }
  if (count === 3) lines.push({ who: 'wrona', line: 'Three. Now the bridge, gentlemen, and not a word.' });
  api.dialogue(lines);
  if (count === 1) {
    api.objective('notes', 'active');
    api.at(2.5, 'hintEscort');
    api.at(16, 'hintNotes');
  }
  if (count === 2) api.at(3, 'hintWait');
}

// Runs six times a second: who hides where, who follows, who can be seen.
function escortTick(api) {
  const w = api.world, h = api.hero('wrona');
  if (!h) return;
  const inB = h.state === 'ok' ? inside(h) : null;
  for (const n of api.tagged('spec')) {
    if (n.state !== 'ok') continue;
    const nb = inside(n);
    if (nb) {
      if (inB === nb && n.follow !== h.id) {
        // Wrona has come in: whoever hides here joins him.
        n.follow = h.id; n.slot = followers(api, h).length;
        found(api, n);
      } else if (n.follow === h.id && inB !== nb) {
        // Left behind indoors (Wrona went out by another way): out he comes after him.
        w.exitBuilding(n, { x: h.x, y: h.y });
      }
    } else if (!n.follow && api.flag('found:' + n.sid)) {
      // Told to wait: right beside a door, he slips inside and keeps his head down.
      let best = null, bd = 2.2;
      for (const t of w.things) {
        if (t.type !== 'building' || !t.interact || t.interact.kind !== 'door') continue;
        const p = doorPos(t), d = Math.hypot(p.x - n.x, p.y - n.y);
        if (d < bd) { bd = d; best = t; }
      }
      if (best) { n.path = null; n.moving = false; w.enterBuilding(n, best); }
      else if (!api.flag('hintOpen')) { api.flag('hintOpen', true); api.at(0.5, 'hintOpen'); }
    }
    if (n.follow) found(api, n);
    n.exposed = !n.follow && !inside(n);
  }
}

// A lantern blown out: its keeper notices the dark and comes to light it again.
function lanternOut(api, id) {
  api.light(id, false);
  api.flag('out:' + id, api.t);
  api.at({ easy: 14, normal: 10, hard: 7 }[api.difficulty] ?? 10, 'lampNoticed', id);
}

// A kerosene lantern that can be blown out (see lanternOut).
function lantern(M, x, y, r, id, label) {
  M.lamp(x, y, r, { id });
  const t = M.things.find((q) => q.id === id);
  t.label = label;
  t.interact = { kind: 'lamp', verb: 'Blow out the lantern', dur: 1.2, handler: 'douse', repeat: true,
    blocked: (api) => (api.thingState(id).lightOff ? 'Already out' : null) };
}

const burnBlocked = (api) => (api.flag('burning') ? 'The notes are already burning' : !api.flag('item:notes') ? 'Nothing to burn yet. The case is in the major\'s car.' : null);

export default {
  id: 'm02', size: [100, 84], seed: 1709, time: 'night', weather: 'clear', biome: 'river-town', style: 'russia',
  enemyFaction: 'soviet',
  heroes: [{ hid: 'wrona', x: 3, y: 7, a: 20 }],
  inventory: { wrona: { pistol: 6 } },
  cameraStart: [15, 14, 32],

  build(M) {
    const W = 100, H = 84;
    M.fill(T.GRASS);
    M.scatter({ x: 0, y: 0, w: W, h: 58 }, T.DIRT, 0.68, 0.18);
    M.scatter({ x: 0, y: 0, w: W, h: 58 }, T.MUD, 0.8, 0.3);
    // Stubble fields north-west and north-east of the town.
    M.rect(0, 0, 9, 17, T.FIELD); M.rect(70, 0, 30, 15, T.FIELD); M.rect(88, 32, 12, 14, T.FIELD);

    // The town stands on a river terrace; a low bluff drops to the gravel strand of the Czeremosz.
    M.plateau({ x: 0, y: 0, w: W, h: 58 }, 1.1, { cliffs: true, ramps: [
      [10, 57], [11, 57], [12, 57], [13, 57], [14, 57], [15, 57], [16, 57],      // millrace and mill lane
      [69, 57], [70, 57], [71, 57], [72, 57], [73, 57], [74, 57],                 // the bridge road
      [90, 57], [91, 57],                                                         // the orchard footpath
    ] });
    M.height({ x: 69, y: 55, w: 6, h: 1 }, 0.85); M.height({ x: 69, y: 56, w: 6, h: 1 }, 0.55); M.height({ x: 69, y: 57, w: 6, h: 1 }, 0.25);
    M.height({ x: 10, y: 56, w: 7, h: 1 }, 0.7); M.height({ x: 10, y: 57, w: 7, h: 1 }, 0.3);
    M.height({ x: 90, y: 57, w: 2, h: 1 }, 0.4);
    M.paint({ x: 0, y: 58, w: W, h: 9 }, T.GRAVEL, F.NOISY);
    M.river([[0, 68.5], [20, 67.5], [45, 68.5], [70, 69.5], [100, 71]], 9);
    M.rect(0, 75, W, 9, T.GRASS);
    M.scatter({ x: 0, y: 74, w: W, h: 10 }, T.DIRT, 0.6, 0.2);

    // The millrace: shallow, muddy, noisy to wade. A plank bridge carries the Kolomyja road.
    M.river([[11, 0], [11, 14], [10.5, 28], [11.5, 40], [12, 50], [13, 57], [13.5, 64]], 2);
    M.unflag({ x: 9, y: 18, w: 5, h: 4 }, F.WATER | F.DEEP);
    M.paint({ x: 9, y: 18, w: 5, h: 4 }, T.DOCK, F.ROAD);

    // Streets. The market is cobbled; everything else is Galician mud and dust.
    M.road([[0, 19.5], [9, 19.5], [16, 21], [26, 22.5], [33, 23.5], [37, 25.5]], 3, T.DIRT);
    M.rect(37, 25, 22, 16, T.COBBLE, F.ROAD);
    M.road([[46.5, 25], [46.5, 18]], 3, T.COBBLE);
    M.road([[58, 25.5], [66, 25], [80, 26], [100, 24]], 3, T.DIRT);
    M.road([[57, 40], [63, 44], [68, 48], [71.5, 52], [71.5, 62]], 4, T.DIRT);
    M.track([[36, 36], [30, 39], [24, 42], [19, 46], [16, 51], [14.5, 56], [14.5, 60]], 2);
    M.track([[30, 49.5], [44, 50], [56, 49.5], [58, 47], [62, 45.5]], 2);
    M.track([[82, 27], [86, 40], [90, 50], [90.5, 57], [90, 61]], 1.4);
    M.track([[22, 23], [24, 30], [27, 33]], 1.4);
    M.road([[71.5, 76], [72, 84]], 3, T.DIRT);

    // ---------- the Armenian church and its walled churchyard ----------
    M.building(42, 7, 9, 5, { id: 'church', kind: 'church', door: 's', doorAt: 4, label: 'the Armenian church', color: '#e8e0cc' });
    M.wall([[36, 3], [56, 3], [56, 18], [36, 18], [36, 3]], { kind: 'stone', gaps: [[46, 18], [47, 18], [36, 11], [36, 12]] });
    M.flags({ x: 43, y: 3, w: 3, h: 1 }, F.CLIMB);                  // a sagging stretch of wall Wrona can get over
    M.deco('rubble', 36.5, 11.5); M.deco('rubble', 35.5, 12.8, { scale: 0.7 });
    for (const [x, y] of [[38, 5], [40, 5], [38, 8], [40, 8], [38, 14], [40, 14], [38, 16], [53, 5], [53, 8], [53, 13], [53, 16], [51, 15], [41, 16]]) M.prop('rock', x, y);
    M.prop('statue', 39, 10);
    for (const [x, y, k] of [[37, 7, 'oak'], [54, 10, 'poplar'], [52, 4, 'oak'], [41, 4, 'poplar'], [55, 15, 'oak'], [37, 15, 'oak']]) M.tree(x, y, k, 0.9);
    M.bushes({ x: 37, y: 4, w: 4, h: 13 }, 0.35);
    M.bushes({ x: 51, y: 12, w: 5, h: 6 }, 0.35);
    lantern(M, 48.5, 17.5, 3, 'gateLamp', 'the lantern over the churchyard gate');
    M.lamp(44.5, 13.5, 2.2);                                        // and at the church door
    M.building(58, 6, 6, 5, { id: 'parish', floors: 2, door: 'w', doorAt: 2, label: 'the parish house' });
    M.fence([[58, 12], [64, 12]], { kind: 'wood' });

    // ---------- the market square ----------
    M.building(38, 21, 5, 3, { id: 'hA', door: 's', doorAt: 2, label: 'a house on the square' });
    M.building(49, 21, 5, 3, { id: 'hB', door: 's', doorAt: 2, label: 'a house on the square' });
    M.building(55, 21, 4, 3, { id: 'hC', kind: 'izba', door: 's', doorAt: 2, label: 'a cottage' });
    M.building(30, 26, 6, 6, { id: 'inn', floors: 2, door: 'w', doorAt: 3, label: 'the inn', color: '#e4d6b4' });
    M.building(31, 33, 5, 5, { id: 'hH', door: 'e', doorAt: 2, label: 'a house on the square' });
    M.building(38, 42, 5, 4, { id: 'hD', door: 'n', doorAt: 2, label: 'a house on the square' });
    M.building(44, 42, 6, 4, { id: 'pharmacy', floors: 2, door: 'n', doorAt: 3, label: 'the pharmacy' });
    M.building(51, 42, 4, 4, { id: 'hF', door: 'n', doorAt: 2, label: 'a house on the square' });
    M.building(59, 27, 7, 7, { id: 'hq', kind: 'hq', floors: 2, door: 'w', doorAt: 3, label: 'the town hall (Soviet post)' });
    M.prop('truck', 62, 34, { rot: 1, color: '#55583e' });
    M.prop('motorcycle', 66, 30, { color: '#55583e' });
    M.prop('well', 49, 28);
    M.prop('table', 40, 30); M.prop('table', 52, 36); M.prop('cart', 54, 30); M.prop('crates', 41, 37); M.prop('barrel', 50, 31);
    M.lamp(44.5, 34.5, 4.5, { kind: 'fire' });                     // the militia's fire in the square
    M.lamp(39.5, 38.5, 3); M.lamp(55.5, 26.5, 3);
    M.lamp(57.5, 32.5, 3);                                          // over the town-hall door
    M.prop('sign', 35, 21, { label: 'Kuty' });

    // The inn yard, the bakehouse and its bread oven.
    M.fence([[23, 24], [27, 24]], { kind: 'wood' });
    M.fence([[23, 25], [23, 31]], { kind: 'wood' });
    M.prop('woodpile', 25, 27); M.prop('cart', 26, 30); M.prop('barrel', 24, 25);
    M.building(23, 34, 4, 3, { id: 'bakehouse', door: 's', doorAt: 1, label: 'the bakehouse' });
    M.prop('well', 27, 35, { id: 'oven', label: 'the bread oven', destructible: true,
      interact: { kind: 'burn', verb: 'Burn the notes in', dur: 3, handler: 'burn', blocked: burnBlocked } });
    M.building(28, 43, 4, 3, { id: 'hI', kind: 'izba', door: 'n', doorAt: 1, label: 'a cottage' });
    M.building(32, 41, 4, 3, { id: 'hJ', kind: 'izba', door: 'n', doorAt: 2, label: 'a cottage' });

    // ---------- the water mill and the sawmill ----------
    M.building(13, 39, 5, 5, { id: 'mill', floors: 2, door: 'e', doorAt: 2, label: 'the water mill', color: '#d6c6a4' });
    M.prop('log', 10, 44, { rot: 1 }); M.prop('woodpile', 17, 45);
    M.lamp(19.5, 38.5, 2.5);
    M.building(20, 47, 6, 3, { id: 'sawmill', kind: 'shed', door: 'n', doorAt: 2, label: 'the sawmill' });
    M.prop('log', 19, 51); M.prop('log', 23, 52); M.prop('log', 20, 54); M.prop('woodpile', 26, 45); M.prop('woodpile', 27, 51);
    M.building(2, 26, 5, 4, { id: 'farm', kind: 'izba', door: 's', doorAt: 2, label: 'a Hutsul farmhouse' });
    M.building(1, 33, 6, 4, { id: 'farmbarn', kind: 'barn', door: 'e', doorAt: 1, label: 'a barn' });
    M.prop('haystack', 4, 2); M.prop('haystack', 2, 12); M.prop('haystack', 6, 14);
    M.fence([[0, 24], [8, 24]], { kind: 'wood' });

    // ---------- east: the synagogue, cottages, the road to Kosow ----------
    M.building(62, 14, 8, 6, { id: 'synagogue', floors: 2, roof: 'hip', door: 's', doorAt: 4, label: 'the synagogue', color: '#e6d8bc' });
    M.building(72, 19, 5, 4, { id: 'hK', kind: 'izba', door: 's', doorAt: 2, label: 'a cottage' });
    M.building(79, 18, 6, 4, { id: 'hL', door: 's', doorAt: 3, label: 'a house' });
    M.building(86, 9, 8, 5, { id: 'barnE', kind: 'barn', door: 's', doorAt: 4, label: 'a barn' });
    M.building(68, 29, 5, 4, { id: 'hM', kind: 'izba', door: 'n', doorAt: 2, label: 'a cottage' });
    M.building(76, 29, 6, 4, { id: 'hN', door: 'n', doorAt: 3, label: 'a house' });
    M.building(85, 29, 5, 4, { id: 'hO', kind: 'izba', door: 'n', doorAt: 2, label: 'a cottage' });
    M.prop('haystack', 76, 4); M.prop('haystack', 82, 7); M.prop('haystack', 95, 3);

    // ---------- Bridge Street and the abandoned convoy ----------
    M.building(65, 38, 5, 4, { id: 'hP', door: 's', doorAt: 2, label: 'a house' });
    M.building(60, 48, 6, 4, { id: 'police', door: 'e', doorAt: 2, label: 'the police station' });
    M.building(76, 50, 6, 5, { id: 'customs', floors: 2, door: 'w', doorAt: 2, label: 'the customs house' });
    M.building(77, 42, 5, 4, { id: 'smithy', kind: 'shed', door: 'w', doorAt: 2, label: 'the smithy' });
    M.lamp(75.5, 46.5, 3, { kind: 'fire', id: 'forge' });
    Object.assign(M.things.find((t) => t.id === 'forge'), { label: 'the smithy forge',
      interact: { kind: 'burn', verb: 'Burn the notes in', dur: 3, handler: 'burn', blocked: burnBlocked } });
    M.prop('rock', 74, 45); M.prop('woodpile', 79, 47); M.prop('barrel', 82, 45);
    M.fence([[73, 41], [82, 41]], { kind: 'wood' });
    M.building(57, 52, 5, 3, { id: 'hQ', kind: 'izba', door: 'n', doorAt: 2, label: 'a cottage' });
    M.building(62, 53, 4, 3, { id: 'hR', kind: 'izba', door: 'e', doorAt: 1, label: 'a cottage' });
    // The jam: everything that would not start, or ran out of petrol, or lost its horse.
    M.prop('truck', 60, 41, { color: '#5a6048' });
    M.prop('car', 64, 44, { color: '#2e3034', label: 'the major\'s car' });
    M.item('notes', 66, 44, { kind: 'case', label: 'the case of worksheets', verb: 'Take' });
    M.prop('cart', 68, 46); M.prop('horse', 62, 46); M.prop('crates', 63, 42);
    M.prop('wreck', 70, 51); M.prop('motorcycle', 73, 54, { color: '#5a6048' });
    lantern(M, 66.5, 42.5, 2.5, 'jamLamp', 'a hurricane lamp hung on the jam');

    // ---------- gardens, orchards, the gully ----------
    for (let x = 34; x <= 56; x += 3) for (const y of [47, 53, 55]) M.tree(x + (y % 2), y, 'oak', 0.7);
    for (let x = 81; x <= 98; x += 3) for (let y = 36; y <= 55; y += 4) M.tree(x + ((y / 4) % 2), y, 'oak', 0.72);
    M.bushes({ x: 33, y: 46, w: 24, h: 10 }, 0.22);
    M.bushes({ x: 80, y: 34, w: 20, h: 22 }, 0.18);
    M.hedge([[30, 46], [37, 46]]); M.hedge([[57, 46], [57, 50]]);
    M.fence([[34, 52], [42, 52]], { kind: 'wood' });
    M.prop('stump', 43, 56);
    M.addThing({ id: 'gully', type: 'cliff', x: 44, y: 56, w: 2, h: 2, tiles: [[44, 57], [45, 57]], render: false, state: {},
      label: 'the gully', interact: { kind: 'rope', verb: 'Fix a rope down', at: [44, 56], reach: 1.2, dur: 3, who: ['wrona'] } });
    // Woods and scrub on the edges.
    M.forest({ x: 0, y: 40, w: 9, h: 17 }, 0.2, ['oak', 'birch', 'poplar'], { floor: T.FOREST });
    M.forest({ x: 92, y: 0, w: 8, h: 30 }, 0.16, ['birch', 'oak'], { floor: T.FOREST });
    M.forest({ x: 17, y: 0, w: 17, h: 15 }, 0.15, ['oak', 'birch', 'poplar'], { floor: T.FOREST });
    M.bushes({ x: 0, y: 0, w: W, h: 57 }, 0.05);
    M.bushes({ x: 12, y: 24, w: 10, h: 14 }, 0.18);

    // ---------- the strand, the raftsmen, the checkpoint, the bridge ----------
    M.building(28, 58, 5, 3, { id: 'boathouse', kind: 'shed', door: 'e', doorAt: 1, label: 'the raftsmen\'s hut' });
    for (const [x, y] of [[18, 62], [37, 62], [52, 62], [58, 63], [84, 64], [92, 64]]) M.prop('log', x, y);
    for (const [x, y] of [[9, 59], [22, 59], [40, 59], [49, 60], [60, 59], [82, 59], [95, 61]]) M.tree(x, y, 'birch', 0.85);
    for (const [x0, x1] of [[0, 61], [79, W]]) {
      M.bushes({ x: x0, y: 61, w: x1 - x0, h: 4 }, 0.3, 'reeds');
      M.bushes({ x: x0, y: 58, w: x1 - x0, h: 3 }, 0.12);
    }
    M.bushes({ x: 61, y: 63, w: 8, h: 2 }, 0.35, 'reeds');
    M.lamp(66.5, 60.5, 4, { kind: 'fire' });
    M.prop('mgnest', 75, 58, { flags: F.LOW });
    M.sandbags([[62, 58], [64, 58]]);
    M.prop('tent', 77, 57, { color: '#5d6045' });
    // The wooden bridge (Polish Army engineers, 1930) and the scouts' barrier across its mouth.
    M.unflag({ x: 70, y: 61, w: 4, h: 16 }, F.WATER | F.DEEP);
    M.paint({ x: 70, y: 61, w: 4, h: 16 }, T.DOCK, F.ROAD);
    M.fence([[69, 62], [69, 76]], { kind: 'wood' });
    M.fence([[74, 62], [74, 76]], { kind: 'wood' });
    M.gate(70, 62, 4, 1, { id: 'barrier', interact: { verb: 'Lift the barrier', dur: 1.2 } });
    lantern(M, 75.5, 61.5, 2.5, 'bridgeLamp', 'the lamp on the bridge road');
    // Romania: the frontier post at Vijnita, willows, people who crossed earlier.
    M.building(76, 77, 4, 3, { id: 'roPost', kind: 'shed', label: 'the Romanian frontier post', enter: false, color: '#c8b48c' });
    M.lamp(74.5, 77.5, 3);
    M.prop('roadblock', 75, 81, { rot: 1 });
    M.forest({ x: 0, y: 76, w: 66, h: 8 }, 0.18, ['poplar', 'birch', 'oak']);
    M.forest({ x: 82, y: 76, w: 18, h: 8 }, 0.18, ['poplar', 'birch']);
    M.bushes({ x: 0, y: 74, w: W, h: 3 }, 0.3, 'reeds');
    for (const [x, y, name, look] of [[73, 79, 'Romanian frontier guard', 'partisan'], [70, 78, 'Romanian frontier guard', 'partisan'],
      [66, 80, 'Refugee', 'woman'], [67, 81, 'Refugee', 'child'], [68, 80, 'Refugee', 'civilian'], [78, 81, 'Polish officer', 'ally']]) {
      const n = M.npc({ x, y, name, look, role: 'civilian', a: 270 }); n.locked = true;
    }

    // An archive find, out of the way on the Kosow road: the government's cars passed here tonight.
    M.item('pennant', 94, 24, { kind: 'documents', label: 'a torn car pennant', verb: 'Pick it up', dur: 0.8 });

    // ---------- the three specialists, already hiding ----------
    const hidden = [['spectacles', 'church', 46, 12], ['overcoat', 'inn', 29, 29], ['pipe', 'mill', 18, 41]];
    for (const [sid, home, x, y] of hidden) {
      const n = M.npc({ x, y, name: SPEC[sid].name, look: 'civilian', role: 'specialist', tag: 'spec', slow: true, hp: 3 });
      n.sid = sid; n.hidden = 'b:' + home;
    }

    // ---------- zones ----------
    M.zone('bridgehead', 70, 63, 4, 5, { recon: false });
    M.zone('romania', 56, 75, 38, 9);
    M.zone('strand', 0, 58, W, 5, { recon: false });
    M.zone('midbridge', 70, 68, 4, 4, { recon: false });

    // ---------- garrison: Soviet scouts and red militia ----------
    const mil = 'Red militiaman', nkvd = 'Soviet scout';
    // West: the mill, the sawmill, the Kolomyja road.
    M.enemy({ tag: 'roadwatch', name: mil, type: 'sentry', x: 14, y: 22, a: 180, sweep: [180, 140, 220], min: 'normal' });
    M.enemy({ tag: 'roadpatrol', name: mil, x: 16, y: 21, route: [[16, 21, 3, 180], [31, 23, 4, 0]] });
    M.enemy({ tag: 'millwatch', name: mil, type: 'sentry', x: 21, y: 40, a: 180, sweep: [180, 130, 230] });
    M.enemy({ tag: 'sawpatrol', name: mil, x: 24, y: 43, route: [[24, 43, 3, 90], [17, 52, 4, 200], [26, 53, 2, 0]] });
    M.enemy({ tag: 'strandpatrol', name: nkvd, x: 16, y: 60, route: [[16, 60, 4, 180], [40, 60, 4, 0]] });
    M.enemy({ tag: 'raftwatch', name: mil, type: 'sentry', x: 35, y: 60, a: 0, sweep: [0, 300, 60], min: 'normal' });
    // The church.
    M.enemy({ tag: 'gate', name: nkvd, type: 'sentry', x: 47, y: 20, a: 90, sweep: [90, 30, 150] });
    M.enemy({ tag: 'yardpatrol', name: nkvd, x: 39, y: 14, route: [[39, 14, 3, 270], [54, 14, 3, 0], [54, 5, 2, 0], [39, 5, 3, 180]] });
    M.enemy({ tag: 'wallpatrol', name: nkvd, x: 34, y: 1, route: [[34, 1, 3, 180], [58, 1, 2, 0], [58, 19, 3, 90], [34, 19, 2, 180]] });
    M.enemy({ tag: 'parishofficer', name: 'Politruk', type: 'officer', x: 59, y: 13, a: 180, sweep: [180, 240, 120], min: 'normal' });
    M.enemy({ tag: 'westwall', name: nkvd, type: 'sentry', x: 33, y: 9, a: 0, sweep: [0, 60, 320], min: 'hard' });
    // The market square.
    M.enemy({ tag: 'fire1', name: mil, x: 42, y: 33, a: 200 });
    M.enemy({ tag: 'fire2', name: mil, x: 46, y: 33, a: 340 });
    M.enemy({ tag: 'fire3', name: mil, x: 44, y: 36, a: 90, min: 'normal' });
    M.enemy({ tag: 'commissar', name: 'Politruk', type: 'officer', x: 57, y: 31, a: 180, sweep: [180, 230, 130] });
    M.enemy({ tag: 'squareA', name: nkvd, x: 38, y: 27, route: [[38, 27, 2, 180], [57, 27, 3, 90], [57, 39, 2, 0], [38, 39, 3, 270]] });
    M.enemy({ tag: 'innpatrol', name: mil, x: 27, y: 25, route: [[27, 25, 3, 90], [28, 33, 2, 0], [21, 38, 3, 180]] });
    M.enemy({ tag: 'hallwatch', name: nkvd, type: 'sentry', x: 61, y: 37, a: 200, sweep: [200, 150, 250], min: 'normal' });
    M.enemy({ tag: 'squareB', name: nkvd, x: 57, y: 39, route: [[57, 39, 2, 270], [38, 39, 3, 180], [38, 27, 2, 90], [57, 27, 3, 0]], min: 'hard' });
    // Bridge Street and the convoy.
    M.enemy({ tag: 'looter', name: mil, x: 66, y: 46, a: 160, sweep: [160, 230, 100] });
    M.enemy({ tag: 'streetpatrol', name: nkvd, x: 58, y: 42, route: [[58, 42, 3, 200], [72, 54, 4, 90]] });
    M.enemy({ tag: 'smithwatch', name: mil, type: 'sentry', x: 74, y: 44, a: 180, sweep: [180, 120, 240] });
    M.enemy({ tag: 'kosowpatrol', name: nkvd, x: 66, y: 26, route: [[66, 26, 2, 180], [96, 24, 3, 0]], min: 'normal' });
    M.enemy({ tag: 'customswatch', name: nkvd, type: 'sentry', x: 74, y: 52, a: 270, sweep: [270, 200, 330], min: 'hard' });
    // The bridgehead checkpoint.
    M.enemy({ tag: 'gunner', name: 'Machine-gunner', type: 'gunner', x: 75.9, y: 58.9, a: 245, hold: true });
    M.enemy({ tag: 'barrierwatch', name: nkvd, type: 'sentry', x: 72, y: 59, a: 270, sweep: [270, 230, 310] });
    M.enemy({ tag: 'strandwatch', name: nkvd, type: 'sentry', x: 63, y: 61, a: 180, sweep: [180, 220, 140] });
    M.enemy({ tag: 'lieutenant', name: 'Scout lieutenant', type: 'officer', x: 68, y: 59, a: 0, sweep: [0, 90, 300], min: 'normal' });
    M.enemy({ tag: 'dog', name: 'Border-guard dog', type: 'dog', x: 77, y: 61, route: [[77, 61, 2], [86, 62, 2], [80, 60, 1]], min: 'normal' });
    M.enemy({ tag: 'deckwatch', name: nkvd, x: 71, y: 67, route: [[71, 66, 3, 270], [72, 74, 7, 90]], min: 'hard' });   // walks the planks; 7 s looking at Romania
    M.enemy({ tag: 'strandE', name: nkvd, x: 79, y: 62, route: [[79, 62, 2, 0], [96, 63, 3, 0]], min: 'hard' });
    M.enemy({ tag: 'orchardpatrol', name: mil, x: 84, y: 34, route: [[84, 34, 2, 90], [90, 52, 3, 180]], min: 'hard' });
    M.spawn(58, 35); M.spawn(61, 14);
  },

  objectives: [
    { id: 'find', text: 'Find the three cipher specialists hiding in the town', type: 'check', check: (api) => (api.flag('foundN') || 0) >= 3,
      marker: (api) => api.tagged('spec').filter((n) => !api.flag('found:' + n.sid)).map((n) => { const p = doorPos(api.thing(SPEC[n.sid].home)); return [p.x, p.y]; }) },
    { id: 'escort', text: 'Escort them past the patrols to the bridge', type: 'escort', zone: 'bridgehead', tag: 'spec', count: 3, after: 'find' },
    { id: 'notes', text: 'Destroy the cipher notes they cannot carry', type: 'flag', flag: 'notesBurnt', hidden: true,
      marker: (api) => (api.flag('burning') ? null : api.flag('item:notes') ? [[27.5, 35.5], [75.5, 46.5]] : [66.5, 44.5]) },
    { id: 'cross', text: 'Cross into Romania before dawn', type: 'check', marker: [74, 80], onExpire: 'dawn',
      check: (api) => api.done('escort') && api.done('notes') && api.zoneHas('romania', 'wrona')
        && api.tagged('spec').every((n) => n.state === 'ok' && api.inZone('romania', n)) },
    { id: 'quiet', text: 'Optional: let no alarm sound', type: 'check', optional: true,
      check: (api) => api.done('cross') && api.world.s.stats.alarms === 0 },
    { id: 'pennantFind', text: 'Find: a car pennant on the Kosów road', type: 'item', item: 'pennant', optional: true, hidden: true },
  ],

  script: {
    onStart(api) {
      setProgress(api, 'find', '0/3');
      api.countdown('cross', dawnAt(api), 'First light');
      api.at(dawnAt(api) - 600, 'dawnWarn', 10);
      api.at(dawnAt(api) - 180, 'dawnWarn', 3);
      api.at(1.5, 'hintStart');
    },
    onKill(api, e, by) {
      if (!api.flag('hintBody') && by && by.kind === 'hero') {
        api.flag('hintBody', true);
        api.hint('Hide him before someone walks past: carry the body (<kbd>X</kbd>) into a bush, a dark garden, or through a door. The gentlemen will not like it. Neither do I.');
      }
    },
    onAlarm(api) {
      if (!api.flag('hintAlarm')) {
        api.flag('hintAlarm', true);
        api.hint('Alarm! Soviet scouts turn out of the town hall and the parish house. Get everyone indoors: tap a door and the gentlemen follow you inside. Wait for the shouting to die away. Save often (<kbd>F5</kbd>).');
      }
    },
    onNpcDeath(api, n) {
      if (n.tag === 'spec') api.fail(`${n.name} has been killed. The major said they were worth more than both of us.`);
    },
    onInteract(api, hero, thing) {
      if (thing.id === 'pennant') {
        api.objective('pennantFind', 'active');
        api.dialogue([
          { who: 'wrona', line: 'A car pennant, red and white, torn off in the crush. The President\'s cars came this way tonight, to the bridge.' },
          { who: 'wrona', line: 'A government leaving by the back door. Someone has to hold it open.' },
        ]);
      }
      if (thing.id === 'gully') {
        api.msg('Wrona ties a rope off on the old stump. The gentlemen can climb down to the strand here now.', 'good');
        api.say('wrona', 'Hand over hand, Professor. Like a schoolboy.', 3);
      }
      if (thing.id === 'barrier') api.say('wrona', 'Easy. It squeals.', 2);
    },
    onObjective(api, id) {
      if (id === 'escort') {
        api.say('wrona', 'Keep walking. Do not look back. That is my job.', 3);
        if (!api.done('notes')) api.hint('The case of worksheets has not burned yet. Leave the gentlemen in a house near the bridge, go back for it, and watch it burn. Nothing they wrote stays on this side of the river.');
      }
      if (id === 'notes') api.say('wrona', 'Ash. Nothing in their hand stays on this side of the river.', 3);
    },
  },

  events: {
    hintStart(api) {
      api.hint('Kuty, 01:40. Three civilians are hiding somewhere in this town. The major\'s guess: <b>the Armenian church</b>, <b>the inn</b> on the market, and <b>the water mill</b>. To search a building, go inside: tap its door. First light comes at 05:10; the clock is under your objectives.');
    },
    hintEscort(api) {
      api.hint('<b>Escort.</b> He follows you now. The gentlemen are slow and copy you: crawl (<kbd>P</kbd>) and they crawl, run and they run. A guard who sees them will shout and shoot, so keep them in the dark. If a patrol comes, <b>slip into the nearest house</b>: everyone following you ducks inside too, and comes out with you.');
    },
    hintNotes(api) {
      api.hint('<b>The notes.</b> The case is in the major\'s car, in the jam on Bridge Street. Take it and burn it: in the <b>bread oven</b> behind the bakehouse, or in the <b>smithy forge</b> near the bridge (the forge glow lights you up). Then stay close and watch it burn. Leave the gentlemen somewhere safe while you go.');
    },
    hintWait(api) {
      api.hint('Tap a gentleman to make him wait; tap him again to call him. Out in the open, a man standing still is still seen. Leave him <b>right beside a door</b> and he slips inside and keeps his head down until you come back for him.');
    },
    hintOpen(api) {
      if (api.tagged('spec').some((n) => n.state === 'ok' && !n.follow && !(n.hidden && n.hidden.startsWith('b:')))) {
        api.hint('He is waiting in the open, where any passing patrol will see him. Park him right beside a door instead: he slips inside and stays hidden.');
      }
    },
    dawnWarn(api, mins) {
      api.msg(`First light in ${mins} minutes.`, 'danger');
      api.say('wrona', mins > 5 ? 'The sky is going grey over the Carpathians.' : 'Minutes now. Move.', 3);
    },
    lampNoticed(api, id) {
      if (!api.flag('out:' + id)) return;
      const k = api.ent(LANTERNS[id]);
      if (!alive(k)) { api.flag('out:' + id, null); return; }          // nobody left to mind it
      if (!calm(k)) { api.at(8, 'lampNoticed', id); return; }
      // He goes over to see to it (an investigation of the dark, like a noise; only he goes).
      const [x, y] = LAMP_SPOT[id];
      api.say(LANTERNS[id], 'Chto za chort? Fonar...', 2.5);
      k.ai.mode = 'investigate'; k.ai.goal = { x, y }; k.ai.lookT = 2.5; k.ai.hurry = false; k.path = null;
      api.at(25, 'lampNoticed', id);                                   // still dark later: he tries again
    },
    hintDoused(api) {
      api.hint('<b>The lantern is out.</b> Its pool of light is gone, and in the dark a sentry sees a standing man at only a few paces. But its keeper will notice in a moment and walk over to light it again: be gone by then, or be waiting for him with his back to you. Kill the keeper and the lamp stays dark.');
    },
    dawn(api) {
      if (api.done('cross')) return;
      api.fail('First light. The Romanians close the bridge, and the Soviets find three gentlemen without papers in Kuty.');
    },
  },

  handlers: {
    douse(api, hero, thing) {
      lanternOut(api, thing.id);
      if (!api.flag('hintDoused')) {
        api.flag('hintDoused', true);
        api.at(1, 'hintDoused');
      }
    },
    burn(api, hero, thing) {
      api.flag('burning', thing.id);
      api.flag('burnAt', api.t + 8);
      api.destroy(thing.id);
      api.say('wrona', 'Burn. All of it. I stay and watch.', 3);
    },
  },

  triggers: [
    { id: 'escortTick', once: false, when: (api) => { escortTick(api); return false; }, do() {} },
    // A blown-out lantern is lit again when its keeper reaches it.
    { id: 'relight', once: false, when: (api) => Object.entries(LANTERNS).some(([id, tag]) => {
      if (!api.flag('out:' + id)) return false;
      const k = api.ent(tag), [x, y] = LAMP_SPOT[id];
      return alive(k) && Math.hypot(k.x - x, k.y - y) < 0.9;
    }), do: (api) => {
      for (const [id, tag] of Object.entries(LANTERNS)) {
        const k = api.ent(tag), [x, y] = LAMP_SPOT[id];
        if (!api.flag('out:' + id) || !alive(k) || Math.hypot(k.x - x, k.y - y) >= 0.9) continue;
        api.flag('out:' + id, null);
        api.light(id, true);
        api.say(tag, 'Vot tak. Svet.', 2);
      }
    } },
    { id: 'burnt', when: (api) => {
      const b = api.flag('burning');
      if (!b || api.t < api.flag('burnAt')) return false;
      const h = api.hero('wrona'), c = api.center(b);
      return h && h.state === 'ok' && Math.hypot(h.x - c.x, h.y - c.y) < 10;
    }, do: (api) => api.flag('notesBurnt', true) },
    { id: 'burnLeft', when: (api) => {
      const b = api.flag('burning');
      if (!b || api.flag('notesBurnt') || api.t >= api.flag('burnAt')) return false;
      const h = api.hero('wrona'), c = api.center(b);
      return h && Math.hypot(h.x - c.x, h.y - c.y) > 10;
    }, do: (api) => api.say('wrona', 'Not yet. The major said watch it burn. I go back.', 3) },
    { id: 'hStrand', zone: 'strand', who: 'wrona', do: (api) => api.hint('The strand is gravel: walking on it crunches, and anyone close by will come to look. Crawl here and nobody hears you (the gentlemen crawl with you). The reeds at the water\'s edge hide anyone lying in them.') },
    { id: 'hGate', when: (api) => near(api, 'gate', 9), do: (api) => api.hint('<b>Lamps.</b> At night a sentry sees a standing man at a few paces, but anyone in a pool of lamplight is seen from as far as he can see. A lantern hangs over the churchyard gate and the sentry stands in its light. <b>Tap a lantern to blow it out</b> (from behind him). Wrona can also climb the sagging wall on the north side; the gentlemen cannot climb: for them there is the gate, or the gap in the west wall where it has slumped.') },
    { id: 'hFire', when: (api) => near(api, 'fire1', 10), do: (api) => api.hint('The militia sit round their fire in the middle of the square. Firelight works for them: in the dark they see only a few paces, but anyone who steps into the light is seen from far off. Go round the square, not across it.') },
    { id: 'hGunner', when: (api) => near(api, 'gunner', 13), do: (api) => api.hint('The Soviet scouts have closed the bridge: a barrier across its mouth, a machine-gunner who never leaves his nest, and sentries in the firelight. The road down is the short way and the bright one. Under the bluff the strand is dark. Wrona can climb the bluff anywhere; for the gentlemen, fix a rope at <b>the gully</b> behind the orchards.') },
    { id: 'hBridge', when: (api) => api.done('escort') && api.zoneHas('midbridge', 'wrona'), do: (api) => {
      api.say('wrona', 'I\'ll come back for you.', 4);
    } },
    { id: 'farEnd', when: (api) => api.done('escort') && api.done('notes') && fired(api, 'hBridge') && heroNear(api, 72, 74.5, 2.5), do: (api) => api.dialogue([
      { who: 'Polish officer', line: 'Lieutenant! Soldiers to the left: the Romanians are interning us. Civilians to the right, and there is a train to Bucharest at six. I said nothing.' },
      { who: 'Spectacles', line: 'Then we are civilians. We always were.' },
    ]) },
  ],
};
