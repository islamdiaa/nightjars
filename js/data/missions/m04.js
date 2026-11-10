import { T, F } from '../../core/constants.js';

// M4 · The Navy's Here · night of 16 February 1940 · Jøssingfjord, Norway.
// Wrona and Kit, on their first job together, cross the ice from the inner shore, board the German
// supply tanker Altmark over her grounded stern, take her bridge before anyone can scuttle her, open
// her three holds and lead the British merchant seamen inside across the ice to HMS Cossack.
// Teaches Shadow Mode: the ice watch at the fire (safe lesson) and the bridge lookouts (the test)
// are mutually watching pairs. Grey ice is silent and keeps no prints; white ice creaks and does.
// The fjord runs north (inner end, start) to south (the mouth, Cossack and the Norwegian boats).

const W = 80, H = 96;
const HULL = [[30, 14], [43, 14], [43, 62], [36.5, 71], [30, 62]];          // Altmark, bow to the south
const WEST = [[0, 0], [12, 0], [13, 6], [12, 14], [13, 24], [12, 34], [13, 46], [12, 58], [11, 68], [9, 74], [7, 84], [6, 96], [0, 96]];
const EAST = [[64, 0], [80, 0], [80, 96], [71, 96], [70, 84], [68, 74], [64, 66], [63, 54], [64, 42], [62, 30], [63, 18], [64, 8]];
const SEA = { easy: 300, normal: 200, hard: 140 };          // seconds from an early alarm to the sea-cocks
const NEED = { easy: 6, normal: 8, hard: 9 };                // prisoner groups that must reach Cossack
const BELOW = { easy: 2, normal: 3, hard: 4 };               // the watch below that turns out
const KM = { faction: 'kriegsmarine' };

// The men in the holds: each figure leads a file of a few dozen.
const HOLDS = {
  hatch3: { label: 'No. 3 hold', spots: [[34, 21], [36, 21], [38, 21]], men: [
    ['Able Seaman, SS Doric Star', false], ['Fireman, SS Tairoa', true], ['Deck boy, SS Streonshalh', false]] },
  hatch2: { label: 'No. 2 hold', spots: [[34, 36], [36, 36], [38, 36]], men: [
    ['Serang, SS Huntsman', false], ['Khalasi, SS Huntsman', true], ['Greaser, SS Ashlea', true]] },
  hatch1: { label: 'No. 1 hold', spots: [[34, 54], [37, 54], [39, 54]], men: [
    ['Bosun, SS Trevanion', false], ['Steward, SS Newton Beech', true], ['Carpenter, SS Tairoa', true]] },
};

const setProgress = (api, id, text) => { const o = api.world.s.objectives.find((q) => q.id === id); if (o) o.progress = text; };
const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const okHeroes = (api) => api.heroes().filter((h) => h.state === 'ok');
const heroNear = (api, x, y, r) => okHeroes(api).some((h) => !(h.hidden && h.hidden.startsWith('b:')) && Math.hypot(h.x - x, h.y - y) < r);
const pows = (api) => api.world.ents.filter((e) => e.kind === 'npc' && e.tag === 'pow');
const need = (api) => NEED[api.difficulty] ?? 8;
const holdsOpen = (api) => ['hatch1', 'hatch2', 'hatch3'].filter((id) => api.flag('open:' + id)).length;
const bridgeWatchDown = (api) => api.tagged('bridge').every((e) => e.state !== 'ok');
const arrived = (api, e) => {
  if (e.state !== 'ok' || e.delivered || !e.follow) return false;
  if (api.inZone('gangway', e)) return true;
  const l = api.world.ent(e.follow);
  return !!l && l.state === 'ok' && api.inZone('gangway', l) && Math.hypot(e.x - 28.5, e.y - 72) < 11;
};

const HATCH = (id, opts = {}) => ({
  kind: 'hatch', verb: opts.verb || `Pick the padlocks on ${HOLDS[id].label}`, dur: 3, need: 'lockpick', anyoneSlow: opts.anyoneSlow !== false,
  needText: opts.needText || 'Padlocked. Kit could pick it.', after: 'bridge',
  afterText: 'Take the bridge first, or they will open the sea-cocks on the men below', handler: 'openHold',
});

export default {
  id: 'm04', size: [W, H], seed: 1602, time: 'night', weather: 'snow', biome: 'fjord-ship', style: 'nordic',
  enemyFaction: 'kriegsmarine',
  heroes: [
    { hid: 'wrona', x: 57, y: 3, a: 200 },
    { hid: 'kit', x: 59, y: 4, a: 200, extra: ['tie'] },
  ],
  inventory: { wrona: { pistol: 6 }, kit: { welrod: 6 } },
  cameraStart: [49, 10, 20],

  build(M) {
    M.fill(T.SNOW);

    // ---------- the fjord: deep water between the cliffs, frozen over as far as the ice edge ----------
    M.water([[11, 8], [65, 8], [63, 18], [62, 30], [64, 42], [63, 54], [64, 66], [68, 74], [70, 84], [71, 96], [6, 96], [7, 84], [9, 74], [11, 68], [12, 58], [13, 46], [12, 34], [13, 24], [12, 14]]);
    for (const poly of [WEST, EAST]) { M.unflag(poly, F.WATER | F.DEEP); M.paint(poly, T.SNOW); }
    const iceEdge = (x) => (x >= 33 && x <= 39 ? 71 : x < 33 ? 73 : 72) + (M.noise(x * 0.4, 3.7) > 0.62 ? 1 : 0);
    M.forTiles({ x: 0, y: 0, w: W, h: H }, (x, y) => {
      const i = M.grid.idx(x, y);
      if (!(M.grid.base[i] & F.DEEP) || y > iceEdge(x)) return;
      M.grid.clearBase(x, y, F.WATER | F.DEEP);
      M.grid.setTerrain(x, y, T.SNOW);
      M.grid.addBase(x, y, F.SNOW | F.NOISY);           // white ice: it creaks, and it keeps footprints
    });
    // Grey ice: scoured by the wind, broken and refrozen along the hull. Silent, and it keeps no prints.
    const grey = (area) => M.forTiles(area, (x, y) => {
      const f = M.grid.base[M.grid.idx(x, y)];
      if (f & (F.DEEP | F.WATER | F.BLOCK)) return;
      if (M.grid.ter(x, y) !== T.SNOW || !(f & F.NOISY)) return;
      M.grid.setTerrain(x, y, T.ASH); M.grid.clearBase(x, y, F.SNOW | F.NOISY);
    });
    grey({ x: 27, y: 11, w: 3, h: 61 }); grey({ x: 43, y: 11, w: 3, h: 61 }); grey({ x: 27, y: 11, w: 19, h: 3 });   // the hull margin
    grey([[38, 9], [51, 8], [51, 14], [38, 14]]);                                                              // quay end to the stern
    M.forTiles({ x: 13, y: 8, w: 52, h: 66 }, (x, y) => { if (M.noise(x * 0.16 + 11, y * 0.16 + 4) > 0.66) grey({ x, y, w: 1, h: 1 }); });
    // Leads of black water: the ship's broken track, and cracks the cold has opened.
    const lead = (pts, w) => M.line(pts, w, T.DEEP, F.DEEP | F.WATER, 0.6);
    lead([[45, 46.5], [52, 47], [58, 46.5], [61.5, 47.5]], 1.7);   // port side, abeam the bridge
    lead([[14.5, 26.5], [19, 27], [26, 26.5]], 1.7);              // starboard side, abeam the after house
    M.circle(49.5, 23.5, 1.7, T.DEEP, F.DEEP | F.WATER);       // a pool astern, where the screw turned
    lead([[51.5, 12.5], [54, 13], [57, 13.5]], 1.2);            // ice broken round the quay end
    M.rect(33, 72, 7, 2, T.DEEP, F.DEEP | F.WATER);            // the wake channel off the bow
    // Snow bridges over the leads (white ice: crossable, noisy).
    for (const [x0, x1, y0, y1] of [[51, 52, 45, 49], [20, 21, 25, 28]]) {
      M.forTiles({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, (x, y) => {
        if (!(M.grid.base[M.grid.idx(x, y)] & F.DEEP)) return;
        M.grid.clearBase(x, y, F.DEEP | F.WATER); M.grid.setTerrain(x, y, T.SNOW); M.grid.addBase(x, y, F.SNOW | F.NOISY);
      });
    }
    // Water never keeps snow flags.
    M.forTiles({ x: 0, y: 0, w: W, h: H }, (x, y) => { if (M.grid.base[M.grid.idx(x, y)] & (F.DEEP | F.WATER)) M.grid.clearBase(x, y, F.SNOW | F.NOISY); });

    // ---------- the cliffs: Wrona can climb them; pines on top ----------
    M.plateau(WEST, 3.2, { cliffs: true });
    M.plateau(EAST, 3.2, { cliffs: true });
    M.forest({ x: 0, y: 0, w: 11, h: 96 }, 0.16, ['pine', 'pine', 'birch'], { floor: T.SNOW });
    M.forest({ x: 66, y: 0, w: 14, h: 96 }, 0.16, ['pine', 'pine', 'birch'], { floor: T.SNOW });

    // ---------- the inner shore: Helleren, the boathouse, the Titania ore quay ----------
    M.scatter({ x: 13, y: 0, w: 51, h: 8 }, T.ROCK, 0.66, 0.3);
    M.building(14, 1, 5, 4, { id: 'helleren1', kind: 'house', door: 's', label: 'Helleren', color: '#b8b0a0', roofColor: '#4a4038', enter: false });
    M.building(20, 1, 4, 4, { id: 'helleren2', kind: 'house', door: 's', label: 'Helleren', color: '#9a3a2c', roofColor: '#4a4038', enter: false });
    M.building(27, 2, 3, 3, { id: 'boathouse', kind: 'shed', door: 's', label: 'the boathouse', color: '#8a3a2c' });
    M.lamp(17.5, 5.5, 1.6, { post: false, color: 0xffc070 });             // a lit window the Germans told them to cover
    const fisher = M.npc({ x: 21, y: 5, name: 'A Norwegian fisherman', look: 'civilian', role: 'civilian', a: 90, side: 'neutral' }); fisher.locked = true;
    M.unflag({ x: 47, y: 2, w: 3, h: 11 }, F.WATER | F.DEEP | F.SNOW | F.NOISY);
    M.rect(47, 2, 3, 11, T.DOCK);                                            // the Titania company's ore quay
    M.prop('woodpile', 51, 3, { label: 'pit props for the mine' });
    M.prop('wagon', 41, 1, { rot: 1, color: '#6a4a3a', label: 'an ore wagon' });
    M.prop('wagon', 34, 1, { rot: 1, color: '#6a4a3a', label: 'an ore wagon' });
    for (const [x, y] of [[55, 1], [61, 2], [53, 6], [60, 6], [31, 6], [24, 7], [40, 6]]) M.prop('rocks', x, y, { label: 'a boulder' });
    for (const [x, y] of [[57, 0], [62, 0], [50, 0], [44, 3], [37, 4], [25, 0]]) M.tree(x, y, 'birch', 0.9);
    M.bushes({ x: 13, y: 0, w: 51, h: 7 }, 0.08, 'scrub');
    // Skerries frozen into the ice: cover on the open ice.
    for (const [x, y] of [[54, 11], [58, 17], [22, 12], [17, 19], [56, 31], [58, 40], [18, 44], [16, 36], [52, 58], [57, 63], [21, 64], [47, 66]]) M.prop('rocks', x, y, { label: 'a skerry in the ice' });
    for (const [x, y] of [[15, 52], [24, 40], [50, 36], [55, 52]]) M.prop('rock', x, y, { label: 'rafted ice' });

    // ---------- Altmark: a raised deck inside a steel bulwark ----------
    M.unflag(HULL, F.WATER | F.DEEP | F.SNOW | F.NOISY);
    M.plateau(HULL, 1.6, { cliffs: true, ramps: [[42, 36], [30, 52]] });
    const edge = [];
    M.forTiles(HULL, (x, y) => {
      const f = M.grid.base[M.grid.idx(x, y)];
      if (f & F.CLIMB) edge.push([x, y]);
      else M.grid.setTerrain(x, y, T.CONCRETE);
    });
    const climbable = (x, y) => (y === 14 && x >= 35 && x <= 37) || y >= 68;   // the stern counter, the anchor cable
    for (const [x, y] of edge) { M.grid.setTerrain(x, y, T.ASH); if (!climbable(x, y)) M.grid.clearBase(x, y, F.CLIMB); }
    M.addThing({ type: 'barrier', kind: 'wood', x: edge[0][0], y: edge[0][1], w: 1, h: 1, tiles: edge, flags: F.BLOCK | F.LOW, pts: [] });
    // A climbable rail is capability-gated, not a solid wall. Keep every other hull edge blocked.
    for (const [x, y] of edge) if (climbable(x, y)) M.grid.clearBase(x, y, F.BLOCK);
    const deck = (area, t) => M.forTiles(area, (x, y) => { const i = M.grid.idx(x, y); if (M.grid.base[i] & F.BLOCK || M.grid.ter(x, y) !== T.CONCRETE) return; M.grid.setTerrain(x, y, t); });
    deck({ x: 31, y: 15, w: 11, h: 6 }, T.DOCK); deck({ x: 31, y: 58, w: 11, h: 12 }, T.DOCK); deck({ x: 31, y: 45, w: 11, h: 3 }, T.DOCK);   // wooden decks: poop, fo'c'sle, bridge
    M.rect(42, 36, 1, 1, T.DOCK); M.rect(30, 52, 1, 1, T.DOCK);
    M.addThing({ id: 'sternLadder', type: 'cliff', x: 35, y: 14, w: 3, h: 1, tiles: [[35, 14], [36, 14], [37, 14]], render: false, state: {}, label: 'Altmark\'s stern',
      interact: { kind: 'rope', verb: 'Climb the stern and drop a rope ladder', at: [36, 13], reach: 1.3, dur: 3, who: ['wrona'], whoText: 'Only Wrona can climb the stern', flag: 'ladderDown' } });
    M.prop('pier', 42, 36, { label: 'the accommodation ladder' });
    M.prop('pier', 30, 52, { label: 'the pilots\' ladder' });

    // The poop: searchlight, capstan, No. 3 hatch.
    M.searchlight(40.5, 16.5, { id: 'sternLight', sweep: [345, 430], period: 18, range: 18, width: 12, crew: 'poopLight' });
    M.prop('barrel', 31, 15, { label: 'the capstan' }); M.prop('bollard', 31, 19); M.prop('bollard', 41, 19);
    M.prop('barge', 33, 18, { id: 'hatch3', rot: 1, destructible: false, label: 'No. 3 hold, the after hatch', color: '#5a5048', interact: HATCH('hatch3') });
    // The after house: crew quarters and galley. A place to hide, and to hide bodies.
    M.building(32, 22, 9, 7, { id: 'afterhouse', kind: 'bunker', door: 's', doorAt: 4, label: 'the after house', color: '#e8e6e0' });
    // The after well deck: No. 2 hatch under the cargo light, the port gangway.
    M.prop('barge', 33, 33, { id: 'hatch2', rot: 1, destructible: false, label: 'No. 2 hold', color: '#5a5048',
      interact: HATCH('hatch2', { verb: 'Pick the padlocks on the wire lashings of No. 2 hold', anyoneSlow: false, needText: 'Wire lashings, padlocked. Only Kit can open these.' }) });
    // Cargo lights hang from the masts over each hatch: the post is the switch, the pool is round the hatch.
    const cargoLight = (id, px, py, cx, cy, r) => { M.prop('lamppost', px, py, { id, light: true, state: {} }); M.lamp(cx, cy, r, { id, post: false, color: 0xffe0b0 }); };
    cargoLight('lampAft', 36, 32, 36.5, 34.5, 4.2);
    // The bridge: bridge house (chart room), the open bridge front, the wings.
    M.building(33, 39, 7, 6, { id: 'bridgehouse', kind: 'hq', door: 's', doorAt: 3, floors: 3, roof: 'flat', label: 'the bridge house', color: '#e8e4da',
      interact: { kind: 'pickup', item: 'roll', name: 'the Altmark\'s prisoner roll', verb: 'Search the chart room', dur: 4, repeat: false } });
    M.prop('radioset', 34, 46, { id: 'telegraph', label: 'the wheel and engine telegraph',
      interact: { kind: 'bridge', verb: 'Ring down "Finished with engines" and take the wheel', dur: 2, handler: 'takeBridge',
        blocked: (api) => (!bridgeWatchDown(api) ? 'The bridge watch is still at their posts' : null) } });
    M.lamp(32.5, 46.5, 1.6, { post: false, color: 0xffd8a0 });
    M.lamp(40.5, 46.5, 1.6, { post: false, color: 0xffd8a0 });
    M.searchlight(39.5, 44.5, { id: 'bridgeLight', sweep: [-20, 110], period: 20, range: 20, width: 12 });
    M.things.find((t) => t.id === 'bridgeLight').state = { lightOff: true };    // it snaps on at the alarm
    // The forward well deck: the bosun's store, No. 1 hatch, the foremast.
    M.fence([[32, 48], [40, 48]], { kind: 'wood' });                       // the bridge-front rail: hides what lies behind it
    M.building(40, 56, 2, 2, { id: 'store', kind: 'shed', door: 'w', doorAt: 1, label: 'the bosun\'s store', color: '#c8c4b8' });
    M.prop('barge', 33, 51, { id: 'hatch1', rot: 1, destructible: false, label: 'No. 1 hold', color: '#5a5048', interact: HATCH('hatch1') });
    cargoLight('lampFwd', 36, 50, 36.5, 52.5, 3.8);
    M.prop('radiomast', 36, 55, { label: 'the foremast' });
    // The forecastle: a 20 mm the Norwegian inspectors were told was stowed, the windlass, a locker.
    M.prop('aagun', 34, 61, { label: 'a 20 mm gun under a tarpaulin', destructible: false });
    M.prop('crates', 35, 65, { label: 'the anchor windlass' });
    M.building(38, 62, 2, 2, { id: 'locker', kind: 'shed', door: 'w', doorAt: 1, label: 'the lamp locker', color: '#c8c4b8' });
    for (const [lamp, verb] of [['lampAft', 'the cargo light on the mainmast'], ['lampFwd', 'the cargo light on the foremast']]) {
      Object.assign(M.things.find((t) => t.id === lamp), { label: verb,
        interact: { kind: 'switch', verb: 'Pull the fuse', dur: 1.5, repeat: true, handler: 'lampSwitch' } });
    }

    // ---------- the mouth: Cossack at the ice edge, the Norwegian torpedo boats ----------
    M.prop('ship', 26, 75, { id: 'cossack', w: 5, h: 21, rot: 2, label: 'HMS Cossack', color: '#7a8288', destructible: false });
    M.unflag({ x: 27, y: 74, w: 3, h: 1 }, F.WATER | F.DEEP); M.rect(27, 74, 3, 1, T.DOCK);       // her gangway, down on the ice
    cargoLight('cossackLamp', 29, 74, 28.5, 72.5, 3.4);
    M.things.find((t) => t.id === 'cossackLamp').state = { lightOff: true };
    M.things.find((t) => t.id === 'cossackLamp').label = 'Cossack\'s gangway light';
    M.prop('ship', 11, 79, { id: 'kjell', w: 3, h: 12, rot: 2, label: 'the Norwegian torpedo boat Kjell', color: '#a4aaae', destructible: false });
    M.prop('ship', 50, 80, { id: 'skarv', w: 3, h: 12, rot: 2, label: 'the Norwegian torpedo boat Skarv', color: '#a4aaae', destructible: false });
    M.searchlight(12.5, 78.5, { id: 'kjellLight', sweep: [285, 345], period: 18, range: 26, width: 12 });
    M.searchlight(51.5, 79.5, { id: 'skarvLight', sweep: [195, 250], period: 22, range: 26, width: 12, phase: 0.45 });
    for (const [x, y, a] of [[25, 72, 270], [31, 72, 270]]) { const n = M.npc({ x, y, name: 'Able Seaman, HMS Cossack', look: 'sailor', a }); n.locked = true; }

    // ---------- zones ----------
    M.zone('deck', 31, 15, 11, 55, { restricted: true });
    M.zone('bridge', 31, 45, 11, 3);
    M.zone('gangway', 22, 68, 13, 7, { recon: false });

    // ---------- the garrison: Altmark's crew, on edge, watching Cossack ----------
    const S = { ...KM, type: 'sailor' }, SEN = { ...KM, type: 'sentry' };
    // the shore
    M.enemy({ ...S, tag: 'shore', name: 'Sailor sent ashore', x: 18, y: 7, route: [[18, 7, 5, 90], [33, 7, 3, 0], [43, 6, 4, 0], [33, 7, 2, 180]] });
    M.enemy({ ...S, tag: 'helleren', x: 25, y: 6, a: 90, sweep: [60, 110, 160], min: 'normal' });
    M.enemy({ ...S, tag: 'quayRoot', x: 38, y: 6, a: 180, sweep: [160, 190, 220], min: 'normal' });
    // the ice watch at the fire: a pair that watches each other
    M.lamp(46.5, 10.5, 3.2, { kind: 'fire' });
    M.enemy({ ...S, tag: 'icewatch', name: 'Ice watch', x: 43, y: 11, a: 0 });
    M.enemy({ ...S, tag: 'icewatch', name: 'Ice watch', x: 49, y: 11, a: 180 });
    M.enemy({ ...S, tag: 'stbdQuarter', x: 26, y: 15, a: 270, sweep: [230, 270, 320], min: 'normal' });
    // the ice along her sides
    M.enemy({ ...S, tag: 'portIce', x: 44, y: 20, route: [[44, 20, 3, 0], [44, 33, 4, 90]] });
    M.lamp(44.5, 38.5, 2.4, { post: false, color: 0xffc070 });                     // the gangway lantern
    M.enemy({ ...SEN, tag: 'gangFoot', name: 'Gangway sentry', x: 44, y: 37, a: 0, sweep: [330, 0, 40, 0] });
    M.enemy({ ...S, tag: 'gangFoot2', x: 47, y: 37, a: 180, min: 'hard' });
    M.enemy({ ...S, tag: 'stbdIce', x: 28, y: 18, route: [[28, 18, 4, 180], [28, 61, 5, 180]] });
    M.enemy({ ...S, tag: 'portBowIce', x: 44, y: 51, route: [[44, 51, 4, 0], [44, 66, 4, 90]] });
    M.enemy({ ...SEN, tag: 'stbdBow', x: 25, y: 66, a: 90, sweep: [60, 110, 160], min: 'normal' });
    // the poop and the after house
    M.enemy({ ...S, tag: 'poopLight', name: 'Searchlight crew', x: 41, y: 17, a: 330, hold: true });
    M.enemy({ ...SEN, tag: 'sternLook', name: 'Stern lookout', x: 33, y: 16, a: 270, sweep: [230, 270, 310] });
    M.enemy({ ...SEN, tag: 'sternLook2', x: 38, y: 15, a: 270, sweep: [250, 290, 330], min: 'hard' });
    M.enemy({ ...S, tag: 'aftAlley', x: 41, y: 22, route: [[41, 22, 3, 270], [41, 28, 3, 90]], min: 'normal' });
    // the after well deck: the bosun is the keystone
    M.enemy({ ...KM, type: 'officer', tag: 'bosun', name: 'Bosun', x: 32, y: 30, a: 60, sweep: [50, 60, 70] });
    M.enemy({ ...S, tag: 'aftPatrol', x: 40, y: 31, route: [[40, 31, 3, 90], [40, 37, 2, 180], [33, 37, 3, 270], [40, 37, 2, 0]] });
    M.enemy({ ...S, tag: 'gangHead', name: 'Gangway watch', x: 41, y: 36, a: 0, sweep: [330, 10, 50] });
    M.enemy({ ...S, tag: 'messenger', name: 'Bridge messenger', x: 41, y: 39, a: 90, sweep: [70, 90, 110], min: 'normal' });
    M.enemy({ ...SEN, tag: 'hatch2Guard', x: 36, y: 37, a: 270, sweep: [240, 270, 300], min: 'hard' });
    // the bridge: two lookouts who watch each other, and the officer of the watch
    M.enemy({ ...SEN, tag: 'bridge', name: 'Starboard lookout', x: 32, y: 46, a: 0 });
    M.enemy({ ...SEN, tag: 'bridge', name: 'Port lookout', x: 40, y: 46, a: 180 });
    M.enemy({ ...KM, type: 'officer', tag: 'bridge', name: 'Officer of the watch', x: 36, y: 47, route: [[36, 47, 7, 90], [31, 47, 0], [31, 39, 6, 270], [31, 47, 0]] });
    // the forward well deck and the forecastle
    M.enemy({ ...S, tag: 'fwdPatrol', x: 32, y: 50, route: [[32, 50, 3, 270], [32, 55, 2, 90], [38, 55, 3, 0], [40, 50, 2, 270]] });
    M.enemy({ ...SEN, tag: 'hold1', x: 40, y: 53, a: 180, sweep: [150, 180, 220], min: 'normal' });
    M.enemy({ ...S, tag: 'pilotHead', x: 31, y: 53, a: 180, sweep: [150, 180, 210], min: 'hard' });
    M.enemy({ ...KM, type: 'soldier', tag: 'po', name: 'Petty officer', x: 32, y: 59, route: [[32, 59, 4, 90], [40, 59, 4, 90]] });
    M.enemy({ ...KM, type: 'gunner', tag: 'gunner', name: '20 mm gunner', x: 36, y: 62, a: 90, sweep: [70, 90, 110], hold: true });
    M.enemy({ ...SEN, tag: 'bowLook', name: 'Bow lookout', x: 36, y: 68, a: 90, sweep: [55, 90, 125] });
    M.enemy({ ...S, tag: 'bowPort', x: 38, y: 65, a: 60, sweep: [20, 60, 100], min: 'normal' });
    M.enemy({ ...S, tag: 'fcsle2', x: 33, y: 66, a: 120, sweep: [100, 140, 180], min: 'hard' });

    M.spawn(36, 30, { ...KM, type: 'sailor' });
    M.spawn(36, 58, { ...KM, type: 'sailor' });

    // Finds.
    M.item('tin', 21, 58, { kind: 'cans', label: 'a tobacco tin on the ice', verb: 'Pick up the tobacco tin' });
  },

  objectives: [
    { id: 'board', text: 'Board the Altmark from the ice', type: 'reach', zone: 'deck', who: 'hero' },
    { id: 'bridge', text: 'Take the bridge', type: 'flag', flag: 'bridgeTaken' },
    { id: 'holds', text: 'Open the three cargo holds', type: 'check', check: (api) => holdsOpen(api) >= 3, after: 'bridge' },
    { id: 'lead', text: 'Lead the prisoners to the Cossack\'s gangway', type: 'check', check: (api) => (api.flag('delivered') || 0) >= need(api), after: 'holds' },
    { id: 'all', text: 'Optional: bring out every one of the nine groups', type: 'check', optional: true, check: (api) => (api.flag('delivered') || 0) >= 9 },
    { id: 'quiet', text: 'Optional: let no alarm sound all night', type: 'check', optional: true, check: (api) => api.done('lead') && api.world.s.stats.alarms === 0 },
    { id: 'roll', text: 'Find: the Altmark\'s prisoner roll', type: 'flag', flag: 'item:roll', optional: true, hidden: true },
    { id: 'tinFind', text: 'Find: a tobacco tin on the ice', type: 'item', item: 'tin', optional: true, hidden: true },
  ],

  triggers: [
    { id: 'hFire', when: (api) => heroNear(api, 46, 11, 11), do: (api) => {
      api.dialogue([{ who: 'wrona', line: 'Two of them at the fire. Each watches the other.' }, { who: 'kit', line: 'Then we shall have to be terribly sociable.' }]);
      api.hint('<b>Shadow Mode.</b> These two face each other across the fire. Kill one and the other sees him fall. Crawl (<kbd>P</kbd>) round behind each of them in the dark, one hero to each man: in the firelight a standing man is seen from far off. Then press <kbd>T</kbd> (or the Shadow button): the game pauses. Give Wrona one action (<b>Knife</b> the nearer man) and Kit one (<b>Chloroform</b> the other), then <b>EXECUTE</b> (<kbd>Enter</kbd>): both strike at once. Tie the sleeper, then let Wrona carry them off: the black water of a lead hides a body.');
    } },
    { id: 'hStern', when: (api) => heroNear(api, 36, 12, 5), do: (api) => api.hint('The stern counter, run aground where the ice has piled up. <b>Wrona</b> can climb it and drop a rope ladder for Kit (tap the stern). The stern lookout sweeps astern and the searchlight crew turns his beam over the ice to the east: climb while the lookout looks west, and crawl over the rail.') },
    { id: 'hGangway', when: (api) => heroNear(api, 44, 37, 9), do: (api) => api.hint('The accommodation ladder, let down for the Norwegian inspectors. The man at its foot stands in his own lantern light, and the watch at its head looks down over his back: drop the foot sentry and the head sees the body. Take the head first from the deck, or both at once.') },
    { id: 'hPilot', when: (api) => heroNear(api, 29, 52, 6), do: (api) => api.hint('The Norwegian pilots\' ladder still hangs over the starboard side. Anyone can climb it. A patrol walks this side of the ship slowly, end to end.') },
    { id: 'hBosun', when: (api) => heroNear(api, 33, 30, 9) && api.ent('bosun') && api.ent('bosun').state === 'ok', do: (api) => api.hint('The <b>bosun</b> stands at the starboard corner of the after house and watches the whole lit well deck: No. 2 hatch, the gangway head, the far alley. He is the keystone of the after deck. His back is to the dark starboard alley. Or pull the fuse on the cargo light (the post by the hatch): in the dark he sees little, and he will come to see why it went out.') },
    { id: 'hBridge', when: (api) => heroNear(api, 36, 45, 9) && !bridgeWatchDown(api), do: (api) => {
      api.hint('<b>The bridge watch.</b> Two lookouts stand on the lit wings facing each other: each is the other\'s witness. The <b>officer of the watch</b> stands at the front for a few seconds, then walks aft along the starboard side and looks out over the well deck: that is your window. Either take the officer first, from behind, while he stands in the dark alley looking aft, or get a hero behind each lookout (crawl in their light), Shadow Mode, strike together, and catch the officer as he comes back. All three must be down before you can take the wheel.');
      api.say('kit', 'Three on the bridge. One each, and one for whoever is quicker.', 3.5);
    } },
    { id: 'hLamp', when: (api) => heroNear(api, 36.5, 32.5, 5) || heroNear(api, 36.5, 50.5, 5), do: (api) => api.hint('A cargo light. Pull its fuse (tap the lamp) and the deck around it goes dark, but whoever is nearest will come to see why.') },
    { id: 'hBow', when: (api) => api.done('holds') && heroNear(api, 36, 64, 12), do: (api) => api.hint('The forecastle watch looks straight at Cossack. The Norwegian searchlights sweep the last stretch of ice: anyone in a beam is seen as if by day. The 20 mm gunner is a big man: the Welrod will not drop him, the knife or chloroform will.') },
    { id: 'tinReveal', when: (api) => !!api.flag('item:tin'), do: (api) => {
      api.objective('tinFind', 'active');
      api.say(api.flag('item:tin'), 'A note inside, in pencil: "300 BRITISH PRISONERS BELOW. TELL THE NAVY." Pushed out of a scupper while the Norwegians searched.', 5);
    } },
    { id: 'rollReveal', when: (api) => !!api.flag('item:roll'), do: (api) => {
      api.objective('roll', 'active');
      api.say(api.flag('item:roll'), 'Their list. Two hundred and ninety-nine names. Somebody ought to read every one.', 4.5);
    } },
    // A prisoner brought to the gangway is taken aboard Cossack.
    // A file whose leader stands at the gangway walks the last yards on its own.
    { id: 'deliver', once: false, when: (api) => pows(api).some((e) => arrived(api, e)), do: (api) => {
      for (const e of pows(api)) {
        if (!arrived(api, e)) continue;
        e.delivered = true; e.follow = null; e.locked = true; e.stance = 'stand';
        api.world.routeTo(e, 28.5, 74.5);
        const n = (api.flag('delivered') || 0) + 1;
        api.flag('delivered', n);
        setProgress(api, 'lead', n >= need(api) ? `${n} of 9 saved` : `${n}/${need(api)}`);
        api.msg(`${e.name} goes up Cossack's gangway. (${n} of 9)`, 'good');
        api.say(e, ['Is it really the Navy? Is it?', 'Two months in the dark. Two months.', 'Mind the ice, lads, it\'s grey you want.', 'God bless you, miss. God bless you, sir.', 'Somebody give that Norwegian a medal.'][n % 5], 3);
      }
    } },
    { id: 'aboard', once: false, when: (api) => pows(api).some((e) => e.delivered && e.state === 'ok' && e.y > 74), do: (api) => {
      for (const e of pows(api)) if (e.delivered && e.state === 'ok' && e.y > 74) api.world.removeEnt(e.id);
    } },
    // Once the ladder is down the stern stops being a button (re-derived from the flag after a reload; never fires).
    { id: 'ropeTidy', once: false, when: (api) => { if (api.flag('ladderDown') && api.thing('sternLadder').interact) api.thing('sternLadder').interact = null; return false; }, do: () => {} },
  ],

  script: {
    onStart(api) {
      api.flag('delivered', 0);
      api.at(2.5, 'hintStart');
      api.at(20, 'amb');
    },
    onObjective(api, id) {
      if (id === 'board') {
        api.say('kit', 'A German warship in neutral waters. Thorne will be thrilled.', 3.5);
        api.hint('Aboard. The bridge is amidships: the house with the open bridge in front of it. Take it before anything goes wrong, or they will open the sea-cocks. The after house, the bridge house and the bosun\'s store hide a man or a body.');
      }
      if (id === 'bridge') {
        api.dialogue([
          { who: 'kit', line: 'Bridge is ours. Signalling Cossack: three long, one short.' },
          { who: 'wrona', line: 'Now the men below.' },
        ]);
        api.thingState('cossackLamp').lightOff = false; api.world.rebuildFlags();
        api.msg('Cossack switches on her gangway lights at the ice edge. Her boarding party is coming across.', 'good');
        api.hint('Three hatches: No. 3 on the poop, No. 2 amidships (its wire lashings are padlocked: <b>Kit only</b>), No. 1 forward. Kit picks a padlock in three seconds; Wrona can force one, slowly and noisily. The men inside will follow whoever opens their hatch. They are weak: move at the pace of the slowest.');
        setProgress(api, 'bridge', null);
      }
      if (id === 'holds') {
        api.hint(`Everyone is out. Lead them down the port gangway or the pilots\' ladder and across the ice to Cossack\'s gangway, the lit patch at the ice edge (bottom left). ${need(api)} of the nine groups must reach her. Prisoners copy you: crawl and they crawl. A German who sees them will shoot.`);
        setProgress(api, 'lead', `${api.flag('delivered') || 0}/${need(api)}`);
      }
    },
    onAlarm(api) {
      if (!api.flag('hintAlarm')) { api.flag('hintAlarm', true); api.hint('Alarm! Sailors pour out of the after house and the forecastle, and the bridge searchlight snaps on. Break their line of sight: duck into the after house or the bosun\'s store, or crawl behind the bulwark on the grey ice. Save often (<kbd>F5</kbd>).'); }
      api.thingState('bridgeLight').lightOff = false;
      if (!api.done('bridge') && !api.flag('scuttleAt')) {
        const s = SEA[api.difficulty] ?? 200;
        api.flag('scuttleAt', api.t + s);
        api.msg('On the bridge a telephone rings: the scuttling party is ordered to the engine room!', 'alarm');
        api.dialogue([{ who: 'wrona', line: 'They will open the sea-cocks. The bridge. Now.' }]);
        api.at(1, 'clock');
      }
    },
    onKill(api, e, by) {
      if (!api.flag('hintBody') && by && by.kind === 'hero') {
        api.flag('hintBody', true);
        api.hint('Bodies are found. Wrona can carry one (tap it) into the black water of a lead, the boathouse, the after house or the bosun\'s store. Kit cannot carry a grown man, but she can tie one she has put to sleep.');
      }
    },
    onNpcDeath(api, e) {
      if (e.tag !== 'pow') return;
      const alive = pows(api).filter((p) => p.state === 'ok' && !p.delivered).length + 3 * (3 - holdsOpen(api));
      if (alive + (api.flag('delivered') || 0) < need(api)) api.objective('lead', 'failed');
      else api.msg(`${e.name} is dead, on the ice, a hundred yards from home.`, 'danger');
    },
    onInteract(api, h, t) {
      if (t.id === 'sternLadder') api.say('wrona', 'Ladder is down. Do not look at the water.', 3);
    },
  },

  handlers: {
    takeBridge(api, h) {
      if (api.flag('bridgeTaken')) return;
      api.flag('bridgeTaken', true);
      api.flag('scuttleAt', null);
      api.sound('bell', 34.5, 46.5);
      api.msg(`${h.name} rings down "Finished with engines". Altmark\'s bridge is taken.`, 'good');
    },
    openHold(api, h, t) {
      if (api.flag('open:' + t.id)) return;
      api.flag('open:' + t.id, true);
      const def = HOLDS[t.id];
      if (h.hid !== 'kit') {
        api.world.noise(h.x, h.y, 6, 'noise', h.id);
        api.msg(`${h.name} forces the padlocks with a marlinspike. It rings like a bell.`, 'warn');
      }
      const n = holdsOpen(api);
      setProgress(api, 'holds', `${n}/3`);
      const lead = api.world.ents.filter((e) => e.kind === 'npc' && e.follow === h.id).length;
      def.men.forEach(([name, slow], i) => {
        const [x, y] = def.spots[i];
        const p = api.spawnNpc({ x, y, name, look: 'prisoner', tag: 'pow', slow, a: -Math.PI / 2 });
        p.follow = h.id; p.slot = lead + i + 1;
      });
      // Cossack's boarding party comes over the side to hand the men up.
      const [bx, by] = def.spots[1];
      const b = api.spawnNpc({ x: bx + (t.id === 'hatch3' ? 0 : 1), y: by + (t.id === 'hatch3' ? 0 : 1), name: 'Boarding party, HMS Cossack', look: 'sailor', tag: 'boarder', a: -Math.PI / 2 });
      b.locked = true;
      if (n === 1) {
        api.dialogue([
          { who: 'Cossack\'s boarding party', line: 'Any Englishmen down there?' },
          { who: 'Voices in the hold', line: 'Yes! We\'re all British!' },
          { who: 'Cossack\'s boarding party', line: 'Come on up, then. The Navy\'s here!' },
        ]);
        api.at(100 * (api.difficulty === 'easy' ? 1.4 : 1), 'watchBelow');
      } else if (t.id === 'hatch2') {
        api.dialogue([{ who: 'Serang, SS Huntsman', line: 'Forty-one of us down here. Forty-one. Count us as we come.' }]);
      } else {
        api.dialogue([{ who: 'Voices in the hold', line: 'Is it Cossack? Somebody said Cossack!' }, { who: 'kit', line: 'Cossack it is. Quietly now, gentlemen.' }]);
      }
    },
    lampSwitch(api, h, t) {
      const st = api.thingState(t.id);
      st.lightOff = !st.lightOff;
      api.world.rebuildFlags();
      if (st.lightOff) {
        api.world.noise(t.x + 0.5, t.y + 0.5, 6, 'noise', h.id);
        api.msg('The cargo light goes out. Somebody will come to see why.', 'info');
      }
    },
  },

  events: {
    hintStart(api) {
      api.hint('Jøssingfjord, a little before ten. Cossack waits dark at the ice edge (south); the Norwegian torpedo boats will not let her near without a fight. <b>Board the Altmark</b> from the ice, <b>take her bridge</b>, <b>open her three holds</b> and bring the prisoners across to Cossack. <b>Grey ice</b> is silent and keeps no footprints. <b>White ice</b> creaks under a walking man and keeps his prints, and the Germans follow prints. The quay\'s planks are quiet too.');
    },
    clock(api) {
      if (api.world.s.result || api.done('bridge') || !api.flag('scuttleAt')) return;
      api.at(1, 'clock');
      const left = api.flag('scuttleAt') - api.t;
      setProgress(api, 'bridge', `sea-cocks in ${mmss(left)}`);
      for (const [s, text] of [[90, 'The scuttling party is in the engine room.'], [30, 'You can hear the valves turning below!']]) {
        if (left <= s && !api.flag('warn' + s)) { api.flag('warn' + s, true); api.msg(text, 'danger'); }
      }
      if (left <= 0) api.fail('The sea-cocks are open. Altmark settles into the fjord with three hundred men battened down below.');
    },
    watchBelow(api) {
      const n = BELOW[api.difficulty] ?? 3;
      const routes = [
        [[41, 30, 2], [41, 47, 3, 90], [41, 39, 3, 270]],
        [[36, 30, 2], [42, 36, 0], [44, 40, 3, 90], [44, 56, 4, 90], [44, 40, 2, 270], [42, 36, 0], [37, 31, 3, 270]],
        [[31, 30, 2], [31, 47, 2], [32, 56, 3, 90], [40, 56, 3, 0], [31, 47, 2], [31, 30, 3, 270]],
        [[36, 30, 2], [31, 21, 3, 180], [41, 21, 3, 0], [36, 30, 3, 90]],
      ];
      for (let i = 0; i < n; i++) api.spawnEnemy({ type: 'sailor', faction: 'kriegsmarine', name: 'The watch below', x: 35.5 + (i % 3), y: 30.5, a: Math.PI / 2, route: routes[i] });
      api.msg('Boots on the companionway: the watch below is turning out of the after house.', 'danger');
      api.say('wrona', 'More of them. Move the men.', 3);
    },
    amb(api) {
      api.at(25 + api.rng() * 25, 'amb');
      const r = api.rng();
      if (r < 0.6) api.sound('bell', [12, 28, 51][Math.floor(api.rng() * 3)], 84);
    },
  },
};
