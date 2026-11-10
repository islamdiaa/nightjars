import { T, F } from '../../core/constants.js';

// M5 · Gold Run · night of 9 April 1940 · the road north from Oslo.
// Germany invades Norway. Norway's gold is on the road to Lillehammer in borrowed lorries. A patrol of
// German paratroopers has put a roadblock on a timber bridge over a river gorge, ahead of the last
// section of the convoy. Haugland (a reservist sapper who has attached himself to the Section),
// Wrona and Kit must clear the roadblock before the lorries pile up behind it, keep every lorry
// moving, and blow the bridge behind the last one as the pursuit comes up the road.
// Teaches Haugland's charges and remote detonation (two log-crib piers under the bridge) and
// scripted lorries that arrive on a schedule. Remixes Shadow Mode (the barrier pair).
// The road runs south (the lorries come in) to north (Lillehammer); the gorge crosses at y 43–55.

const W = 84, H = 90;
const ROAD_S = [[46.5, 90], [46.5, 82.5], [44.5, 76.5], [42.5, 68.5], [41.5, 61.5], [41.5, 56.5]];
const ROAD_N = [[41.5, 42.5], [41.5, 38.5], [39.5, 30.5], [36.5, 20.5], [35.5, 10.5], [37.5, 0]];
const SLOTS = [[44, 77], [45, 80], [46, 83], [46, 86], [46, 89]];     // where the lorries wait, out of sight
const EXIT = [37.5, 0.5];
const LORRIES = { easy: 3, normal: 4, hard: 5 };
const FIRST = { easy: 420, normal: 300, hard: 240 };    // seconds until the first lorry pulls up behind
const GAP = 22;                                            // seconds between lorries
const DEADLINE = { easy: 1800, normal: 1200, hard: 960 }; // the pursuit comes, whatever happens
const PURSUERS = { easy: 4, normal: 6, hard: 8 };
const RADIO_CALL = 240;                                    // how much sooner they come if the radio gets a call out
const COLORS = ['#5a4a3a', '#3e4a58', '#6a5a3a', '#4a5648', '#5e3e34'];
const CLERKS = ['Bank clerk Brekke', 'Bank clerk Nilsen', 'Driver Aas (a removal man)', 'Bank clerk Strand', 'Bank messenger Holm'];
const LW = { faction: 'luftwaffe' };

const setProgress = (api, id, text) => { const o = api.world.s.objectives.find((q) => q.id === id); if (o) o.progress = text; };
const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const okHeroes = (api) => api.heroes().filter((h) => h.state === 'ok');
const heroNear = (api, x, y, r) => okHeroes(api).some((h) => !(h.hidden && h.hidden.startsWith('b:')) && Math.hypot(h.x - x, h.y - y) < r);
const hauglandNear = (api, x, y, r) => { const h = api.hero('haugland'); return h && h.state === 'ok' && Math.hypot(h.x - x, h.y - y) < r; };
const lorries = (api) => LORRIES[api.difficulty] ?? 4;
const lorry = (api, n) => api.world.ents.find((e) => e.kind === 'vehicle' && e.tag === 'gold' + n);
const blockLeft = (api) => api.tagged('block').filter((e) => e.state === 'ok').length;
const roadClear = (api) => !!api.thingState('barrier').open && !!api.thingState('wire').cut && blockLeft(api) === 0;

export default {
  id: 'm05', size: [W, H], seed: 409, time: 'night', weather: 'snow', biome: 'snow-forest', style: 'nordic',
  enemyFaction: 'luftwaffe',
  heroes: [
    { hid: 'haugland', x: 34, y: 79, a: -60, skis: true, extra: ['detonate'] },
    { hid: 'wrona', x: 36, y: 80, a: -60 },
    { hid: 'kit', x: 35, y: 81, a: -60, extra: ['tie'] },
  ],
  inventory: { haugland: { charge: 3, timer: 2, grenade: 2, pistol: 6 }, wrona: { pistol: 6 }, kit: { welrod: 6 } },
  cameraStart: [40, 66, 19],

  build(M) {
    M.fill(T.SNOW);

    // ---------- the gorge: a river between two ridges whose faces only Wrona can climb ----------
    M.paint({ x: 0, y: 43, w: W, h: 13 }, T.ROCK);
    M.river([[0, 49.5], [20, 50], [41, 49.5], [62, 49], [84, 50]], 5, 2);
    M.unflag({ x: 21, y: 46, w: 3, h: 8 }, F.DEEP);                              // the ford upstream
    M.paint({ x: 21, y: 47, w: 3, h: 5 }, T.WATER);
    M.plateau([[0, 0], [W, 0], [W, 43], [0, 43]], 2.4, { cliffs: true, ramps: [[40, 42], [41, 42], [42, 42], [31, 42]] });
    M.plateau([[0, 56], [W, 56], [W, H], [0, H]], 2.4, { cliffs: true, ramps: [[40, 56], [41, 56], [42, 56], [33, 56]] });
    for (const [x, y] of [[31, 42], [33, 56]]) M.rect(x, y, 1, 1, T.ROCK);      // the fishermen's paths down

    // ---------- the road, and the timber bridge across the gorge ----------
    M.road(ROAD_S, 3); M.road(ROAD_N, 3);
    M.unflag({ x: 39, y: 43, w: 5, h: 13 }, F.WATER | F.DEEP | F.CLIMB);
    M.height({ x: 39, y: 43, w: 5, h: 13 }, 2.4);
    M.rect(40, 43, 3, 13, T.DOCK, F.ROAD);
    M.rect(39, 43, 1, 13, T.DOCK); M.rect(43, 43, 1, 13, T.DOCK);
    const railW = M.fence([[39, 43], [39, 55]], { kind: 'wood', id: 'railW' });
    const railE = M.fence([[43, 43], [43, 55]], { kind: 'wood', id: 'railE' });
    railW.label = railE.label = 'the bridge rail';
    M.lamp(41.5, 49.5, 2.2, { post: false, color: 0xffd090 });                   // a lantern hung at mid-span
    // The span itself: a 'gate' that stands open (passable) until the piers go; then it closes (impassable).
    const span = M.gate(40, 45, 3, 9, { id: 'span', kind: 'pier', open: true });
    span.interact = null; span.label = 'the bridge span';
    // The piers: log cribs filled with stone, at the water's edge on the west side.
    M.target('pierN', 'woodpile', 37, 47, { label: 'the north pier (a log crib)' });
    M.target('pierS', 'woodpile', 37, 51, { label: 'the south pier (a log crib)' });
    for (const [x, y] of [[34, 46], [34, 52], [45, 46], [45, 52]]) M.prop('log', x, y, { label: 'driftwood' });

    // ---------- the pines ----------
    const clearings = [
      { x: 28, y: 55, w: 27, h: 15 },   // south bridgehead
      { x: 26, y: 29, w: 30, h: 14 },   // north bridgehead camp
      { x: 51, y: 59, w: 22, h: 20 },   // the farm
      { x: 29, y: 74, w: 12, h: 10 },   // the start
      { x: 29, y: 15, w: 14, h: 11 },   // the north post
      { x: 10, y: 63, w: 13, h: 9 },    // the woodcutters' hut
      { x: 0, y: 40, w: W, h: 3 }, { x: 0, y: 56, w: W, h: 3 },   // the rims of the gorge
    ];
    M.track([[4, 90], [10, 80], [16, 70], [22, 62], [28, 58]], 1.6);           // the logging track
    M.track([[46, 74], [52, 70], [56, 67]], 1.6);                               // the farm lane
    const keep = [];
    for (const c of clearings) for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) keep.push([x, y]);
    M.forTiles({ x: 0, y: 0, w: W, h: H }, (x, y) => { if (M.grid.ter(x, y) === T.DIRT) keep.push([x, y]); });
    // The road's verges stay open so the lorries have room.
    M.forTiles({ x: 0, y: 0, w: W, h: H }, (x, y) => {
      for (let d = -1; d <= 1; d++) if (M.grid.base[M.grid.idx(Math.min(W - 1, Math.max(0, x + d)), y)] & F.ROAD) { keep.push([x, y]); return; }
    });
    M.forest({ x: 0, y: 0, w: W, h: 43 }, 0.2, ['pine', 'pine', 'pine', 'birch'], { clear: keep, floor: T.FOREST });
    M.forest({ x: 0, y: 56, w: W, h: 34 }, 0.2, ['pine', 'pine', 'pine', 'birch'], { clear: keep, floor: T.FOREST });

    // ---------- the farm: the family is kept indoors ----------
    M.building(56, 62, 6, 4, { id: 'farmhouse', kind: 'house', door: 'w', floors: 2, label: 'the farmhouse', color: '#9a3a2c', roofColor: '#3a3430' });
    M.building(62, 69, 7, 5, { id: 'barn', kind: 'barn', door: 'w', label: 'the barn', color: '#8a3424' });
    M.building(57, 71, 2, 2, { id: 'stabbur', kind: 'shed', door: 's', label: 'the stabbur', color: '#6a4a30' });
    M.lamp(55.5, 64.5, 1.4, { post: false, color: 0xffc070 });                 // a window they forgot to black out
    const farmer = M.npc({ x: 53, y: 67, name: 'The farmer, splitting wood under guard', look: 'civilian', role: 'civilian', a: 0, side: 'neutral' }); farmer.locked = true;
    M.prop('woodpile', 54, 67); M.prop('cart', 60, 75, { rot: 1 }); M.prop('haystack', 66, 76);
    M.fence([[52, 60], [72, 60]], { kind: 'wood', gaps: [[56, 60], [57, 60]] });

    // ---------- the west woods: the woodcutters' hut ----------
    M.building(14, 65, 4, 3, { id: 'hut', kind: 'hut', door: 'e', label: 'the woodcutters\' hut', color: '#6a5038' });
    M.prop('woodpile', 12, 69); M.prop('log', 17, 70); M.prop('stump', 20, 66); M.prop('stump', 11, 64);
    M.item('docket', 21, 77, { kind: 'documents', label: 'a paper in the snow', verb: 'Pick it up' });

    // ---------- the south bridgehead: barrier, wire, MG, the lit road ----------
    M.gate(40, 56, 3, 1, { id: 'barrier', kind: 'roadblock',
      interact: { verb: 'Pick the padlock and swing the barrier open', need: 'lockpick', anyoneSlow: true, needText: 'Chained and padlocked. Kit could pick it.', dur: 2.5 } }).label = 'the barrier';
    M.wire([[38, 57], [44, 57]], { id: 'wire' }).label = 'knife rests of barbed wire';
    M.prop('mgnest', 43, 61, { flags: F.LOW });
    M.lamp(35.5, 59.5, 3, { kind: 'fire' });
    const post = (id, px, py, cx, cy, r) => { M.prop('lamppost', px, py, { id, light: true, state: {} }); M.lamp(cx, cy, r, { id, post: false, color: 0xffd8a0 }); };
    post('barrierLamp', 46, 59, 45.5, 58.5, 2.0);
    post('roadLamp', 39, 65, 41.5, 65.5, 2.6);
    M.prop('kubel', 35, 61, { color: '#56606b' });
    M.prop('crates', 47, 61); M.prop('ammo', 32, 60);
    M.prop('sign', 38, 59, { label: 'a sign: HALT' });

    // ---------- the north bridgehead: the paratroopers' camp on the ridge ----------
    M.prop('tent', 32, 34, { id: 'tent', color: '#5f6b78', label: 'the officer\'s tent',
      interact: { kind: 'pickup', item: 'map', name: 'a German road map', verb: 'Search the tent', dur: 3, repeat: false } });
    M.prop('radioset', 36, 37, { id: 'radio', label: 'the paratroopers\' field radio',
      interact: { kind: 'sabotage', verb: 'Pull the valves out of the radio', dur: 2, repeat: false, flag: 'radioDead' } });
    M.lamp(40.5, 35.5, 2.8, { kind: 'fire' });
    M.prop('motorcycle', 46, 37); M.prop('motorcycle', 48, 37); M.prop('kubel', 49, 32, { color: '#56606b' });
    M.prop('crates', 30, 38); M.prop('woodpile', 44, 33);
    M.prop('roadblock', 35, 18, { label: 'a second barrier, facing north' });

    // ---------- zones ----------
    M.zone('bridgehead', 28, 55, 27, 14, { recon: false });
    M.zone('camp', 26, 29, 30, 14, { recon: false });
    M.zone('hold', 40, 74, 10, 16, { recon: false });

    // ---------- the garrison: a Fallschirmjäger patrol ----------
    const B = { ...LW, tag: 'block' };
    // south bridgehead
    M.enemy({ ...B, type: 'gunner', name: 'MG gunner', x: 44, y: 62, a: 100, sweep: [75, 100, 125], hold: true });
    M.enemy({ ...B, type: 'sentry', name: 'Barrier sentry', x: 37, y: 58, a: 0 });
    M.enemy({ ...B, type: 'sentry', name: 'Barrier sentry', x: 45, y: 58, a: 180 });
    M.enemy({ ...B, type: 'soldier', name: 'Listening post', x: 44, y: 67, a: 100, sweep: [70, 100, 130] });
    M.enemy({ ...B, type: 'soldier', name: 'Rim patrol', x: 28, y: 58, route: [[28, 58, 4, 270], [54, 58, 4, 270]] });
    M.enemy({ ...B, type: 'soldier', name: 'Listening post', x: 37, y: 68, a: 80, sweep: [50, 80, 110], min: 'normal' });
    M.enemy({ ...B, type: 'sentry', name: 'Wire sentry', x: 41, y: 59, a: 90, sweep: [60, 90, 120], min: 'hard' });
    // the bridge
    M.enemy({ ...B, type: 'sentry', name: 'Bridge sentry', x: 41, y: 44, route: [[41, 44, 4, 0], [41, 55, 4, 180]] });
    M.enemy({ ...B, type: 'soldier', name: 'Bridge sentry', x: 40, y: 42, a: 90, sweep: [60, 90, 120] });
    // north bridgehead
    M.enemy({ ...B, type: 'officer', tag: 'block', name: 'Oberleutnant', x: 42, y: 40, a: 90, sweep: [75, 90, 105] });
    M.enemy({ ...B, type: 'soldier', tag: 'block', name: 'Radio operator', x: 36, y: 38, a: 0, sweep: [330, 0, 30] });
    M.enemy({ ...B, type: 'soldier', name: 'Paratrooper', x: 38, y: 35, a: 0 });
    M.enemy({ ...B, type: 'soldier', name: 'Paratrooper', x: 43, y: 35, a: 180 });
    M.enemy({ ...B, type: 'soldier', name: 'Rim patrol', x: 26, y: 41, route: [[26, 41, 4, 90], [56, 41, 4, 90]] });
    M.enemy({ ...B, type: 'sentry', name: 'Motorcycle sentry', x: 47, y: 39, a: 150, sweep: [110, 150, 190], min: 'normal' });
    M.enemy({ ...B, type: 'soldier', name: 'Paratrooper', x: 34, y: 33, a: 270, sweep: [230, 270, 310], min: 'hard' });
    M.enemy({ ...B, type: 'sentry', name: 'Path sentry', x: 31, y: 41, a: 90, sweep: [60, 90, 120], min: 'normal' });
    M.enemy({ ...B, type: 'soldier', name: 'Runner', x: 39, y: 30, route: [[39, 30, 4, 90], [36, 23, 4, 270]] });
    // the north road
    M.enemy({ ...B, type: 'sentry', name: 'Road sentry', x: 34, y: 20, a: 270, sweep: [240, 270, 300] });
    M.enemy({ ...B, type: 'soldier', name: 'Road sentry', x: 38, y: 21, a: 280, sweep: [250, 290, 330] });
    M.enemy({ ...B, type: 'soldier', name: 'Road sentry', x: 36, y: 24, a: 180, sweep: [150, 180, 210], min: 'hard' });
    // the west woods (not part of the roadblock)
    M.enemy({ ...LW, type: 'soldier', tag: 'woods', name: 'Patrol', x: 10, y: 80, route: [[10, 80, 3, 270], [22, 62, 4, 0], [28, 58, 3, 0], [16, 70, 2, 180]] });
    M.enemy({ ...LW, type: 'soldier', tag: 'woods', name: 'Patrol', x: 11, y: 82, route: [[11, 82, 3, 270], [23, 63, 4, 0], [29, 59, 3, 0], [17, 71, 2, 180]] });
    M.enemy({ ...LW, type: 'sentry', tag: 'woods', name: 'Hut sentry', x: 19, y: 67, a: 0, sweep: [330, 0, 40], min: 'normal' });
    M.enemy({ ...LW, type: 'soldier', tag: 'woods', name: 'Patrol', x: 6, y: 50, route: [[6, 40, 3, 90], [20, 30, 4, 0], [6, 40, 3, 180]], min: 'hard' });
    M.enemy({ ...LW, type: 'sentry', tag: 'woods', name: 'Ford watch', x: 16, y: 57, a: 270, sweep: [240, 270, 300] });
    M.enemy({ ...LW, type: 'soldier', tag: 'woods', name: 'Ford watch', x: 18, y: 41, a: 90, sweep: [60, 90, 120], min: 'normal' });
    // the farm
    M.enemy({ ...LW, type: 'soldier', tag: 'farm', name: 'Farm guard', x: 55, y: 66, a: 180, sweep: [150, 180, 210] });
    M.enemy({ ...LW, type: 'soldier', tag: 'farm', name: 'Farm patrol', x: 61, y: 68, route: [[61, 68, 3, 180], [61, 77, 3, 90], [70, 77, 3, 0], [70, 67, 3, 270]] });
    M.enemy({ ...LW, type: 'soldier', tag: 'farm', name: 'Paratrooper', x: 63, y: 66, a: 270, sweep: [240, 270, 300], min: 'normal' });
    M.enemy({ ...LW, type: 'sentry', tag: 'farm', name: 'Farm sentry', x: 53, y: 73, a: 200, sweep: [170, 200, 230], min: 'normal' });
    M.enemy({ ...LW, type: 'soldier', tag: 'farm', name: 'Paratrooper', x: 67, y: 64, a: 0, sweep: [330, 0, 30], min: 'hard' });
    // the gorge bottom
    M.enemy({ ...LW, type: 'soldier', tag: 'gorge', name: 'Paratrooper, fishing', x: 32, y: 54, a: 270, sweep: [240, 270, 300], min: 'normal' });
    M.enemy({ ...LW, type: 'soldier', tag: 'gorge', name: 'Paratrooper', x: 33, y: 44, a: 90, sweep: [60, 90, 120], min: 'hard' });

    // Reinforcements come through the woods from the flanks, never up the lorries' road.
    M.spawn(1, 70); M.spawn(82, 66);

    // Snow keeps footprints out in the open; the floor of the pines, the road and the bridge do not.
    M.forTiles({ x: 0, y: 0, w: W, h: H }, (x, y) => { if (M.grid.ter(x, y) === T.SNOW && !(M.grid.base[M.grid.idx(x, y)] & (F.WATER | F.DEEP | F.ROAD))) M.grid.addBase(x, y, F.SNOW); });
  },

  objectives: [
    { id: 'clear', text: 'Clear the German roadblock at the bridge', type: 'check', check: (api) => roadClear(api) },
    { id: 'blow', text: 'Blow the bridge behind the last gold truck', type: 'flag', flag: 'bridgeBlown' },
    { id: 'keep', text: 'Keep every truck moving - none may be captured', type: 'check', check: (api) => (api.flag('exited') || 0) >= lorries(api) },
    { id: 'radio', text: 'Optional: silence the paratroopers\' radio before it can call for help', type: 'flag', flag: 'radioDead', optional: true },
    { id: 'clean', text: 'Optional: no lorry takes a bullet', type: 'check', optional: true, check: (api) => api.done('keep') && !api.flag('lorryHit') },
    { id: 'mapFind', text: 'Find: a German road map', type: 'flag', flag: 'item:map', optional: true, hidden: true },
    { id: 'docketFind', text: 'Find: a Norges Bank docket', type: 'item', item: 'docket', optional: true, hidden: true },
  ],

  triggers: [
    { id: 'hBridge', when: (api) => heroNear(api, 41, 64, 9), do: (api) => {
      api.say('haugland', 'Timber cribs under her. Good. They break where you tell them to.', 3.5);
      api.hint('<b>The roadblock.</b> A machine gun looks down the lit stretch of road; behind it two sentries face each other across the barrier, each lit, each the other\'s witness (Shadow Mode, <kbd>T</kbd>). The barrier is chained and padlocked: <b>Kit</b> picks it. The knife rests in front of it are wired: <b>Haugland</b> cuts them. Every German at the bridge, on it, in the camp beyond and at the post on the north road must be dealt with before the lorries can pass.');
    } },
    { id: 'hMG', when: (api) => heroNear(api, 44, 62, 7) && api.world.enemies().some((e) => e.etype === 'gunner' && e.state === 'ok'), do: (api) => api.hint('The MG gunner never leaves his nest and watches the road. His back is to the barrier, his left to the trees east of the road.') },
    { id: 'hGorge', when: (api) => heroNear(api, 33, 57, 6) || heroNear(api, 31, 41, 6), do: (api) => api.hint('A fishermen\'s path goes down into the gorge here. Along the mud banks under the bridge stand its two <b>piers</b>, log cribs at the water\'s edge, one on each bank of the river. A ford crosses the river upstream (west). <b>Wrona</b> can climb the gorge walls anywhere.') },
    { id: 'hPiers', when: (api) => hauglandNear(api, 38, 49, 6), do: (api) => {
      api.say('haugland', 'Here. Two cribs, two charges. Then we wait for the last lorry.', 3.5);
      api.hint('<b>Haugland\'s charges.</b> Choose <b>Explosive charge</b> (<kbd>Z</kbd>) and tap a pier: he sets it in a second or two. Once a charge is set, a <b>Detonate</b> button appears: it fires every charge he has placed, from anywhere on the map. A <b>Time pencil</b> goes off by itself ten seconds after it is set. Set one on each pier now; fire them only when the last lorry is over the bridge.');
    } },
    { id: 'hCamp', when: (api) => heroNear(api, 40, 37, 10), do: (api) => api.hint('The paratroopers\' camp. The <b>Oberleutnant</b> stands at the end of the bridge and watches the lantern-lit span. Their <b>field radio</b> is by the tent: if the alarm goes while it works, they will call the pursuit up the road early. Silence the operator, then pull the valves.') },
    { id: 'hNorth', when: (api) => heroNear(api, 36, 22, 8), do: (api) => api.hint('A second barrier faces north: the patrol is watching for Norwegians coming down the road. They are part of the roadblock too, and the lorries must pass them.') },
    { id: 'docketReveal', when: (api) => !!api.flag('item:docket'), do: (api) => {
      api.objective('docketFind', 'active');
      api.say(api.flag('item:docket'), 'A Norges Bank docket. "Lorry 17: forty crates." Somebody\'s hand was shaking when they signed it.', 4.5);
    } },
    { id: 'mapReveal', when: (api) => !!api.flag('item:map'), do: (api) => {
      api.objective('mapFind', 'active');
      api.say(api.flag('item:map'), 'Their map. The Lillehammer road is marked in pencil, and a question mark beside it. They know.', 4.5);
    } },
    { id: 'wireCut', when: (api) => !!api.thingState('wire').cut, do: (api) => api.say('haugland', 'My father strung wire like this round the sheep. The sheep were cleverer.', 3.5) },
    { id: 'clearDone', when: (api) => api.done('clear'), do: (api) => {
      api.dialogue([{ who: 'kit', line: 'The road is ours. Somebody tell the bank.' }, { who: 'haugland', line: 'Then let the bank through.' }]);
    } },
  ],

  script: {
    onStart(api) {
      api.flag('exited', 0); api.flag('over', 0);
      api.flag('pursuitAt', DEADLINE[api.difficulty] ?? 1200);
      api.at(2.5, 'hintStart');
      api.at(1, 'convoy');
    },
    onAlarm(api) {
      if (!api.flag('hintAlarm')) { api.flag('hintAlarm', true); api.hint('Alarm! More paratroopers come through the woods from the flanks. Break their line of sight: the farm buildings, the hut, the gorge, the pines (out in the open snow your prints give you away). Save often (<kbd>F5</kbd>).'); }
      const op = api.tagged('block').find((e) => e.name === 'Radio operator');
      if (!api.flag('radioDead') && op && op.state === 'ok' && !api.flag('radioCalled') && !api.flag('pursuitSpawned')) {
        api.flag('radioCalled', true);
        api.flag('pursuitAt', Math.max(api.t + 90, api.flag('pursuitAt') - RADIO_CALL));
        api.msg('The radio operator is shouting into his set: the pursuit has been called up the road, early.', 'alarm');
        api.objective('radio', 'failed');
      }
    },
    onKill(api, e, by) {
      if (!api.flag('hintBody') && by && by.kind === 'hero') {
        api.flag('hintBody', true);
        api.hint('Bodies in the snow are seen from far off. Wrona can carry one into the pines, a building, or the river.');
      }
    },
    onInteract(api, h, t) {
      if (t.id === 'radio') { api.say(h.hid, 'That set will not call anyone tonight.', 2.5); api.objective('radio', 'done'); }
      if (t.id === 'barrier' && api.thingState('barrier').open && !api.flag('saidBarrier')) { api.flag('saidBarrier', true); api.say(h.hid, h.hid === 'kit' ? 'A padlock from Woolworths. Insulting.' : 'Open.', 2.5); }
    },
    onDestroyed(api, t) {
      if (t.id === 'wire') api.say('haugland', 'There went the wire. The hard way.', 2.5);
      if (t.id === 'pierN' || t.id === 'pierS') api.at(0.3, 'piers');
    },
    onNpcDeath(api, n) {
      if (n.tag && n.tag.startsWith('clerk')) api.msg(`${n.name} is hit. The man beside him takes the wheel.`, 'danger');
    },
  },

  handlers: {},

  events: {
    hintStart(api) {
      api.hint(`Norway's gold is on this road tonight. The last section of lorries is <b>${mmss(FIRST[api.difficulty] ?? 300)}</b> behind you; they will wait in the bend south of here, out of sight, until the bridge is clear, but the Germans' pursuit is coming up behind them. Clear the roadblock, let the lorries through, and blow the bridge behind the last one. <b>Haugland</b> is on skis: deep snow does not slow him. Out in the open, snow keeps your footprints and the Germans follow them; under the pines it does not.`);
    },
    piers(api) {
      const both = api.thingState('pierN').destroyed && api.thingState('pierS').destroyed;
      if (!both) { if (!api.flag('saidOnePier')) { api.flag('saidOnePier', true); api.msg('One pier is gone. The span sags but holds. The other pier must go too.', 'warn'); } return; }
      if (api.flag('bridgeBlown')) return;
      api.flag('bridgeBlown', true);
      api.at(0.5, 'collapse');
      const left = lorries(api) - (api.flag('over') || 0);
      if (left > 0) api.fail(`The bridge is down with ${left === 1 ? 'a lorry' : left + ' lorries'} of gold still on the wrong side.`);
    },
    collapse(api) {
      api.thingState('span').open = false; api.world.rebuildFlags();
      for (const [x, y] of [[41.5, 47], [41.5, 51]]) api.explode(x, y, 2.4);
      api.destroy('railW'); api.destroy('railE');
      api.msg('The span folds in the middle and goes into the river.', 'good');
      api.say('haugland', 'There. Now they swim.', 3);
    },
    // The convoy controller: once a second, spawn, hold, release and count the lorries.
    convoy(api) {
      if (api.world.s.result) return;
      api.at(1, 'convoy');
      const t = api.t, N = lorries(api), first = FIRST[api.difficulty] ?? 300;
      const clear = api.done('clear');
      let held = 0;
      for (let n = 1; n <= N; n++) {
        const st = api.flag('tk' + n) || 0;
        if (st === 0 && t >= first + (n - 1) * GAP - 3) {
          const v = api.spawnVehicle({ vtype: 'truck', x: 46.5, y: 88.5, a: -Math.PI / 2, tag: 'gold' + n, color: COLORS[(n - 1) % COLORS.length], seats: 1 });
          const c = api.spawnNpc({ x: 46, y: 88, name: CLERKS[(n - 1) % CLERKS.length], look: 'civilian', tag: 'clerk' + n });
          c.locked = true;
          api.world.board(c, v);
          api.moveVehicle('gold' + n, SLOTS[n - 1][0] + 0.5, SLOTS[n - 1][1] + 0.5);
          api.flag('tk' + n, 1);
          if (n === 1) {
            api.msg('Engines in the dark behind you: the first lorry of gold pulls into the bend and waits.', 'info');
            api.dialogue([{ who: CLERKS[0], line: 'Are we the bank or the army now?' }, { who: 'haugland', line: 'Tonight, both. Wait here. Lights off.' }]);
          }
          continue;
        }
        const v = lorry(api, n);
        if (st >= 1 && st <= 3 && (!v || v.state !== 'ok')) { api.fail('A lorry of gold has been wrecked on the road.'); return; }
        if (!v) continue;
        // Captured: Germans standing over a lorry that is not moving.
        const near = api.world.liveEnemies().some((e) => Math.hypot(e.x - v.x, e.y - v.y) < 3);
        if (near && !v.moving) {
          const k = (api.flag('cap' + n) || 0) + 1; api.flag('cap' + n, k);
          if (k >= 3) { api.fail('The paratroopers have stopped a lorry and the gold is in German hands.'); return; }
        } else if (api.flag('cap' + n)) api.flag('cap' + n, 0);
        if (st === 1 && !v.moving) api.flag('tk' + n, 2);
        if (st <= 2) held++;
        // Release in order once the road is clear.
        if (st >= 1 && st <= 2 && clear) {
          const prev = n > 1 ? lorry(api, n - 1) : null;
          const prevSt = n > 1 ? api.flag('tk' + (n - 1)) : 4;
          if (prevSt >= 4 || (prevSt === 3 && (!prev || prev.y < SLOTS[n - 1][1] - 10))) {
            api.moveVehicle('gold' + n, EXIT[0], EXIT[1]);
            if (v.path) { api.flag('tk' + n, 3); if (n === 1) api.msg('The lorries roll. Hooded headlights, engines low, the clerks gripping the wheels.', 'good'); }
          }
        }
        if (st === 3) {
          if (!v.path && v.y > 3) api.moveVehicle('gold' + n, EXIT[0], EXIT[1]);   // a closed barrier stopped it: try again
          if (v.y < 42 && !api.flag('over' + n)) {
            api.flag('over' + n, true);
            const over = (api.flag('over') || 0) + 1; api.flag('over', over);
            api.say(v.passengers.length ? api.world.ent(v.passengers[0]) : 'haugland', ['Tusen takk!', 'For the King!', 'See you in Lillehammer!', 'God bless!', 'Hold on to your hats.'][n % 5], 2.5);
            if (over >= N) {
              api.msg('The last lorry is over the bridge.', 'good');
              api.say('wrona', 'That is the last of them. Now the bridge.', 3);
              if (!api.flag('pursuitSpawned')) api.flag('pursuitAt', Math.min(api.flag('pursuitAt'), t + 25));
              api.hint('The last lorry is across. The pursuit will be on the road behind any moment: blow the bridge (<b>Detonate</b>) when they come for it, before any of them reach the north bank.');
            }
          }
          if (v.y < 2.5) {
            if (v.hp < v.maxHp) api.flag('lorryHit', true);
            for (const id of [...v.passengers]) { const p = api.world.ent(id); if (!p) continue; if (p.kind === 'hero') api.world.disembark(p); else api.world.removeEnt(id); }
            api.world.removeEnt(v.id);
            api.flag('tk' + n, 4);
            api.flag('exited', (api.flag('exited') || 0) + 1);
          }
        }
      }
      // The pursuit.
      const pAt = api.flag('pursuitAt');
      if (!api.flag('pursuitSpawned')) {
        if (pAt - t <= 60 && !api.flag('warn60')) { api.flag('warn60', true); api.msg('Far down the road behind you, engines. A minute, perhaps less.', 'danger'); }
        if (pAt - t <= 15 && !api.flag('warn15')) { api.flag('warn15', true); api.msg('Headlights on the road south! The pursuit is coming!', 'alarm'); api.say('haugland', 'Now.', 2); }
        if (t >= pAt) api.at(0.1, 'pursuit');
      } else if (!api.flag('bridgeBlown')) {
        if (api.tagged('pursuit').some((e) => e.state === 'ok' && e.y < 41)) { api.fail('The pursuit is over the river and after the gold.'); return; }
      }
      // What the player sees under the objective.
      if (!api.done('keep')) {
        let text;
        if (t < first) text = `first lorry in ${mmss(first - t)}`;
        else if (!clear) text = `${held} waiting · pursuit in ${mmss(pAt - t)}`;
        else text = `${api.flag('over') || 0}/${N} across`;
        setProgress(api, 'keep', text);
      }
      if (!api.done('clear')) setProgress(api, 'clear', blockLeft(api) ? `${blockLeft(api)} Germans left` : (!api.thingState('wire').cut ? 'cut the wire' : 'open the barrier'));
    },
    pursuit(api) {
      if (api.flag('pursuitSpawned')) return;
      api.flag('pursuitSpawned', true);
      const n = PURSUERS[api.difficulty] ?? 6;
      for (let i = 0; i < n; i++) {
        const e = api.spawnEnemy({ type: i === 0 ? 'officer' : 'soldier', faction: 'luftwaffe', tag: 'pursuit', name: 'Paratrooper (pursuit)', x: 45.5 + (i % 3) * 0.8, y: 88.5 - Math.floor(i / 3) * 0.9, a: -Math.PI / 2 });
        e.ai.mode = 'search'; e.ai.goal = { x: 41.5, y: 30 + (i % 3) }; e.ai.hurry = true; e.ai.searchT = 40; e.path = null;
      }
      api.msg('The pursuit: a lorry-load of paratroopers jumps down on the road and runs for the bridge.', 'alarm');
    },
  },
};
