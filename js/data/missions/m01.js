import { T, F } from '../../core/constants.js';

// M1 · First Light · 1 September 1939 · Tuchola Forest, Pomerania.
// Tutorial. Wrona alone, at dawn, in ground mist: west edge of the forest -> the courier's wrecked
// car -> east over the stream to the Polish lines, through a German forward post bivouacked round a
// forester's lodge. Design brief: design/m01.md.
//
// One lesson at a time, each with a safe place to try it:
//   the picket on the deer path       cones (near and far), crawling, the knife
//   his relief, down from the road    carrying and hiding a body
//   the wreck and its watcher         the thrown stone
//   the forward post and its bridge   everything together, once the mist has lifted
// The static layout is painted (assets/painted/m01/dawn): only units, lights with ids, items,
// triggers and objectives may change. Keep the build order of the static part as it is.

const LESSON_GAP = 9;   // seconds a field note stays up before the next one may replace it

const alive = (e) => e && e.state === 'ok';
const wrona = (api) => api.hero('wrona');
const near = (api, tag, r) => {
  const e = api.ent(tag), h = wrona(api);
  return alive(e) && h && h.state === 'ok' && Math.hypot(e.x - h.x, e.y - h.y) < r;
};
const heroNear = (api, x, y, r) => { const h = wrona(api); return h && h.state === 'ok' && Math.hypot(h.x - x, h.y - y) < r; };
// Is Wrona behind this guard (well outside his field of view, within r tiles)?
const behind = (api, tag, r) => {
  const e = api.ent(tag), h = wrona(api);
  if (!alive(e) || !h || h.state !== 'ok') return false;
  if (Math.hypot(h.x - e.x, h.y - e.y) > r) return false;
  let da = Math.atan2(h.y - e.y, h.x - e.x) - e.a;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  return Math.abs(da) > Math.PI * 0.6;
};
// Field notes are spaced so that a new one never wipes the last before it could be read.
const ready = (api, gap = LESSON_GAP) => api.flag('noteT') !== undefined && api.t - api.flag('noteT') >= gap;
const note = (api, text) => { api.flag('noteT', api.t); api.hint(text); };
const fired = (api, id) => !!api.world.s.fired[id];
const hasSatchel = (api) => !!api.flag('item:satchel');

export default {
  id: 'm01', size: [76, 56], seed: 1939, time: 'dawn', weather: 'fog', biome: 'forest', style: 'europe',
  enemyFaction: 'wehrmacht',
  preciseMovement: true,
  heroes: [{ hid: 'wrona', x: 4, y: 49, a: -30 }],
  inventory: { wrona: { pistol: 6 } },
  cameraStart: [13, 42, 22],
  // Readability/QA metadata; footprints below stay unchanged (including the painted map).
  crossings: [
    { id: 'north-ford', kind: 'ford', label: 'North ford', x: 54, y: 7, w: 6, h: 4 },
    { id: 'bridge', kind: 'bridge', label: 'Guarded bridge', x: 54, y: 23, w: 7, h: 3 },
    { id: 'south-ford', kind: 'ford', label: 'South ford', x: 56, y: 43, w: 6, h: 4 },
  ],

  build(M) {
    M.fill(T.GRASS);
    M.scatter({ x: 0, y: 0, w: 76, h: 56 }, T.FOREST, 0.42, 0.08);
    M.scatter({ x: 0, y: 0, w: 76, h: 56 }, T.DIRT, 0.7, 0.2);
    // Sandy Pomeranian road west -> east, and a north-south forest track.
    M.road([[0, 30], [12, 31], [24, 31], [38, 28], [50, 26], [58, 24], [66, 23], [76, 22]], 3, T.SAND);
    M.track([[38, 0], [37, 12], [38, 28], [39, 40], [36, 56]], 2);
    M.track([[4, 50], [9, 46], [15, 40], [20, 34]], 1.4);   // deer path from the start towards the road
    // The clearing round the forester's lodge, with a field.
    M.paint([[30, 14], [52, 12], [54, 34], [30, 36]], T.GRASS);
    M.rect(44, 30, 9, 6, T.FIELD);
    // A stream with a plank bridge and two shallow fords.
    M.river([[57, 0], [56, 10], [58, 20], [57, 30], [59, 42], [58, 56]], 3);
    M.unflag({ x: 53, y: 7, w: 8, h: 4 }, F.DEEP);            // north ford
    M.unflag({ x: 55, y: 43, w: 8, h: 4 }, F.DEEP);           // south ford
    M.paint({ x: 54, y: 7, w: 6, h: 4 }, T.WATER);
    M.paint({ x: 56, y: 43, w: 6, h: 4 }, T.WATER);
    M.unflag({ x: 54, y: 23, w: 7, h: 3 }, F.WATER | F.DEEP);
    M.paint({ x: 54, y: 23, w: 7, h: 3 }, T.DOCK, F.ROAD);
    M.fence([[54, 22], [60, 22]], { kind: 'wood' });
    M.fence([[54, 26], [60, 26]], { kind: 'wood' });

    // Forest blocks (trees block sight and movement; bushes hide crawling men).
    const kinds = ['pine', 'pine', 'pine', 'birch'];
    const keep = [];
    for (let y = 44; y <= 53; y++) for (let x = 0; x <= 9; x++) keep.push([x, y]);         // start
    for (let y = 30; y <= 38; y++) for (let x = 19; x <= 29; x++) keep.push([x, y]);       // the wreck
    M.forest({ x: 0, y: 0, w: 30, h: 56 }, 0.2, kinds, { clear: keep, floor: T.FOREST });
    M.forest({ x: 30, y: 0, w: 24, h: 11 }, 0.2, kinds, { floor: T.FOREST });
    M.forest({ x: 30, y: 38, w: 24, h: 18 }, 0.2, kinds, { floor: T.FOREST });
    M.forest({ x: 61, y: 0, w: 9, h: 56 }, 0.14, ['pine', 'birch', 'birch'], { floor: T.FOREST });
    M.bushes({ x: 50, y: 0, w: 12, h: 56 }, 0.25);
    M.bushes({ x: 0, y: 0, w: 76, h: 56 }, 0.09);
    M.hedge([[30, 14], [30, 21]]);
    M.hedge([[52, 13], [52, 20]]);

    // The German forward post at the lodge.
    M.building(42, 19, 6, 5, { id: 'lodge', kind: 'house', door: 's', label: 'the forester\'s lodge', floors: 2 });
    M.building(43, 12, 7, 4, { id: 'barn', kind: 'barn', door: 's', label: 'the barn' });
    M.building(49, 20, 3, 3, { id: 'shed', kind: 'shed', door: 'w', label: 'the woodshed' });
    M.prop('tent', 32, 21, { color: '#5d6550' });
    M.prop('tent', 32, 24, { color: '#5d6550' });
    M.prop('truck', 36, 30, { color: '#4f5545' });
    M.prop('motorcycle', 40, 31);
    M.prop('kubel', 46, 27, { rot: 1 });
    M.prop('crates', 40, 22); M.prop('crate', 41, 24); M.prop('barrel', 39, 25); M.prop('fuel', 34, 32);
    M.prop('radiomast', 48, 18);
    M.prop('log', 31, 28);
    M.lamp(35, 27, 3.5, { kind: 'fire' });
    M.prop('mgnest', 54, 22, { flags: F.LOW });
    M.prop('roadblock', 62, 21);
    M.wire([[63, 18], [63, 20]], { cuttable: true });
    M.wire([[63, 25], [63, 28]], { cuttable: true });

    // The wreck: the courier's staff car nosed into the pines, and the courier. The satchel is
    // still chained to his wrist.
    M.prop('wreck', 22, 33, { rot: 1, label: 'the courier\'s car' });
    M.item('satchel', 22, 35, { kind: 'satchel', label: 'the dispatch satchel', verb: 'Free the satchel', dur: 2.5 });
    const courier = M.npc({ x: 21, y: 35, name: 'The courier', look: 'civilian', a: 120 });
    courier.state = 'dead';
    M.deco('crater', 17, 30); M.deco('crater', 33, 39, { scale: 1.3 }); M.deco('rubble', 25, 29);

    // A farm burning beyond the stream, and the Polish lines on the east edge.
    M.lamp(66, 41, 3, { kind: 'fire' });
    M.prop('haystack', 65, 38);
    M.prop('horse', 72, 19); M.prop('horse', 73, 27, { rot: 1 }); M.prop('horse', 71, 31);
    for (const [x, y] of [[71, 21], [72, 24], [70, 28]]) { const u = M.npc({ x, y, name: 'Uhlan', look: 'ally', a: 180 }); u.locked = true; }
    M.sandbags([[69, 17], [69, 33]], { gaps: [[69, 22], [69, 23], [69, 24]] });
    // ---------- end of the painted layout: nothing static below this line ----------

    // Archive find, off the north route: a Polish signals post overrun in the night.
    M.item('pigeons', 22, 12, { kind: 'case', label: 'a basket of carrier pigeons', verb: 'Open the basket', dur: 1.5 });

    M.zone('car', 19, 31, 9, 7);
    M.zone('exit', 70, 12, 6, 24);
    M.zone('bridge', 48, 18, 10, 12, { recon: false });
    M.zone('post', 30, 12, 24, 25, { recon: false });       // the clearing of the forward post
    M.zone('eastbank', 60, 0, 10, 56, { recon: false });    // over the stream, short of the Polish line

    // ---------- the garrison ----------
    // West forest, in the mist (Veteran: soldier 5.5 tiles, sentry 6): the teaching ground.
    M.enemy({ tag: 'picket', type: 'sentry', name: 'Picket', x: 15, y: 43, a: 200, sweep: [150, 205, 250, 205] });
    M.enemy({ tag: 'wreckguard', type: 'soldier', x: 25, y: 36, a: 200, sweep: [165, 215, 255, 215] });
    M.enemy({ tag: 'roadpatrol', type: 'soldier', x: 19, y: 31, route: [[18, 31, 4, 180], [31, 30, 4, 0]] });

    // North woods and the north ford.
    M.enemy({ tag: 'tracksentry', type: 'sentry', x: 37, y: 9, a: 200, sweep: [160, 210, 260, 210] });
    M.enemy({ tag: 'fordpatrol', type: 'soldier', x: 48, y: 7, route: [[47, 6, 3, 180], [61, 9, 4, 0]] });
    M.enemy({ tag: 'fordwatch', type: 'sentry', x: 53, y: 9, a: 0, min: 'hard' });

    // The forward post (once the mist lifts, Veteran: soldier 7.6 tiles, sentry and officer 8.5,
    // anyone in firelight seen at 9-10).
    M.enemy({ tag: 'fire1', type: 'soldier', name: 'Soldier (at the fire)', x: 34, y: 26, a: 15 });
    M.enemy({ tag: 'fire2', type: 'soldier', name: 'Soldier (at the fire)', x: 36, y: 28, a: 225 });
    M.enemy({ tag: 'trucksentry', type: 'sentry', x: 35, y: 34, a: 185, sweep: [145, 185, 230, 185] });
    M.enemy({ tag: 'tentwatch', type: 'soldier', x: 28, y: 20, a: 120, sweep: [70, 120, 170], min: 'normal' });
    M.enemy({ tag: 'officer', type: 'officer', name: 'Leutnant', x: 45, y: 26, a: 200, sweep: [150, 200, 245, 200] });
    M.enemy({ tag: 'loop', type: 'soldier', x: 40, y: 18, route: [[40, 18, 2, 270], [50, 18, 3, 0], [51, 28, 2, 90], [41, 29, 3, 180]] });
    M.enemy({ tag: 'runner', type: 'soldier', x: 40, y: 28, route: [[40, 28, 4, 180], [52, 25, 4, 0]] });
    M.enemy({ tag: 'barnguard', type: 'soldier', x: 46, y: 17, a: 180, sweep: [180, 135, 225], min: 'normal' });
    M.enemy({ tag: 'dog', type: 'dog', name: 'Guard dog', x: 41, y: 25, route: [[41, 25, 1], [48, 29, 1], [38, 33, 1]], min: 'hard' });
    // The bridge: the gunner covers the planks; the sentry south of him covers the yard and his back.
    M.enemy({ tag: 'gunner', type: 'gunner', x: 54.5, y: 23.4, a: 12, hold: true, rangeMul: 1.5 });
    M.enemy({ tag: 'bridgesentry', type: 'sentry', x: 53, y: 27, a: 200, sweep: [155, 205, 268, 205] });

    // South woods and the south ford.
    // (30,44) is a seeded tree. Start at the clear tile the old route snapped to.
    M.enemy({ tag: 'southpatrol', type: 'soldier', x: 30, y: 43, route: [[30, 43, 3, 180], [53, 45, 4, 0]] });
    M.enemy({ tag: 'edgepatrol', type: 'soldier', x: 38, y: 37, route: [[38, 37, 3, 180], [52, 37, 4, 0]], min: 'normal' });
    M.enemy({ tag: 'southford', type: 'sentry', x: 54, y: 44, a: 10, sweep: [330, 15, 60, 15], min: 'normal' });
    M.enemy({ tag: 'bankwatch', type: 'sentry', x: 53, y: 35, a: 200, sweep: [170, 220, 270, 220], min: 'hard' });
    M.spawn(34, 23);
  },

  objectives: [
    { id: 'car', text: 'Reach the courier\'s wrecked car in the forest', type: 'reach', zone: 'car' },
    { id: 'satchel', text: 'Recover the dispatch satchel', type: 'item', item: 'satchel', after: 'car' },
    { id: 'exit', text: 'Slip through the German advance to the Polish lines', type: 'extract', zone: 'exit', after: 'satchel' },
    { id: 'quiet', text: 'Optional: let no alarm sound', type: 'check', optional: true,
      check: (api) => api.done('exit') && api.world.s.stats.alarms === 0 },
    { id: 'marchFind', text: 'Find: a German march table', type: 'flag', flag: 'foundMarch', optional: true, hidden: true },
    { id: 'pigeonFind', text: 'Find: a basket of carrier pigeons', type: 'item', item: 'pigeons', optional: true, hidden: true },
  ],

  script: {
    onStart(api) {
      api.at(1.5, 'hintMove');
    },
    onKill(api, e, by) {
      if (!by || by.kind !== 'hero') return;
      if (e.tag === 'picket' && !api.flag('reliefSent')) {
        api.flag('reliefSent', true);
        api.at({ easy: 14, normal: 9, hard: 7 }[api.difficulty] ?? 9, 'relief');
        note(api, 'Bodies raise the alarm when they are found, and <b>his relief is coming down from the road</b>. Carry him (tap the body, or <kbd>X</kbd>) into a bush, the dark shrubs that hide whatever lies in them, and put him down (<kbd>X</kbd> again). Carrying is slow and easy to see: look before you lift.');
        return;
      }
      if (!api.flag('hintBody')) {
        api.flag('hintBody', true);
        if (ready(api, 4)) note(api, 'Hide him before someone walks past: a bush, the stream, or a building (carry him to its door). Bodies left in the open are found.');
      }
    },
    onSpotted(api, e, u) {
      if (u.kind !== 'hero' || api.flag('hintSeen')) return;
      api.flag('hintSeen', true);
      note(api, '<b>Seen!</b> He will shout for the others in a moment. Break his line of sight (trees, a building, a bush if you crawl) or silence him before the shout carries.');
    },
    onAlarm(api) {
      if (!api.flag('hintAlarm')) {
        api.flag('hintAlarm', true);
        note(api, '<b>Alarm!</b> Men turn out of the tents and come looking. Run until trees or a building break their line of sight (a man chasing you close behind will follow you into a bush), then crawl into cover or slip through a door, and wait. The alarm dies away; the guards stay a little sharper. Save often: <kbd>F5</kbd> or the disk button.');
      }
    },
    onEnterBuilding(api, unit, thing) {
      if (unit.kind === 'hero' && thing.id === 'lodge' && !api.flag('foundMarch')) api.at(2.5, 'searchLodge');
    },
    onInteract(api, hero, thing) {
      if (thing.id === 'pigeons') {
        api.objective('pigeonFind', 'active');
        api.dialogue([
          { who: 'wrona', line: 'A signals post, overrun in the night. Two birds still alive in the basket.' },
          { who: 'wrona', line: 'Go home, then. One of us should.' },
        ]);
      }
    },
    onObjective(api, id) {
      if (id === 'car') {
        api.say('wrona', 'The car. And its driver. God rest him.', 3);
        if (alive(api.ent('wreckguard'))) api.at(3.5, 'hintSatchel');
      }
      if (id === 'satchel') {
        api.dialogue([
          { who: 'wrona', line: 'Still sealed, still chained to him. Forgive me.' },
          { who: 'wrona', line: 'Now home. The long way.' },
        ]);
        api.at(5, 'hintHome');
        api.at(28, 'mist');
      }
      if (id === 'exit') api.say('wrona', 'I came the long way. As ordered.', 3);
    },
  },

  events: {
    hintMove(api) {
      note(api, 'Select Wrona (his portrait, or <kbd>1</kbd>), then tap the ground to walk. Double-tap to run, but running is loud. Drag to look around; pinch or scroll to zoom. <b>The car is ahead, past the sentry:</b> its place is marked on the ground, and your orders are top left.');
    },
    hintSatchel(api) {
      if (api.done('satchel') || !ready(api, 4)) return;
      note(api, 'The satchel is chained to the courier\'s wrist: freeing it takes a few seconds, and a man at work is easy to see. Make the watcher look the other way first.');
    },
    hintHome(api) {
      note(api, 'The satchel is yours. Now east to the Polish lines (marked). The road runs through a German post at the forester\'s lodge and over a guarded bridge: short and dangerous. There are fords to the north and south: quieter, longer. Save first (<kbd>F5</kbd>).');
    },
    mist(api) {
      if (api.world.weather !== 'fog') return;
      api.weather('clear');
      api.msg('The sun is over the pines. The mist is lifting.', 'danger');
      api.say('wrona', 'The mist is going. So is my luck.', 3);
      api.flag('mistGone', true);
      note(api, '<b>The mist is lifting.</b> From now on they see further: hold <kbd>Tab</kbd> (or the eye button) and watch every cone grow. Where you were safe a minute ago, you may not be now.');
    },
    relief(api) {
      if (api.ent('relief')) return;
      api.spawnEnemy({ type: 'soldier', tag: 'relief', name: 'Gefreiter (the relief)', x: 3, y: 30, a: 0,
        route: [[13, 31, 1, 0], [15, 41, 6, 210], [9, 31, 600, 180]] });   // then he keeps the road
      api.say('wrona', 'Boots on the road. Coming this way.', 2.5);
    },
    searchLodge(api) {
      const h = wrona(api);
      if (!h || h.hidden !== 'b:lodge' || api.flag('foundMarch')) return;
      api.flag('foundMarch', true);
      api.objective('marchFind', 'active');
      api.dialogue([
        { who: 'wrona', line: 'The forester\'s kitchen, made into an office. On the table, a march table: units, roads and hours, as far as the Brda.' },
        { who: 'wrona', line: 'The Rotmistrz will want this more than he wants me.' },
      ]);
    },
    guns(api, n) {
      // The column's guns open on the Polish positions: shells howl over and burst in the woods
      // behind the line. Visual and sound only, and never close to Wrona.
      if (n >= 16) return;
      const h = wrona(api);
      const spots = [[74, 6], [75, 44], [73, 50], [74, 13], [75, 38], [66, 3], [74, 52], [75, 9], [67, 52], [75, 41], [73, 3], [75, 47]];
      const [x, y] = spots[n % spots.length];
      const jx = x + api.rng() * 1.6 - 0.8, jy = y + api.rng() * 3 - 1.5;
      if (!h || Math.hypot(h.x - jx, h.y - jy) > 7) api.shell(jx, jy, 1.4 + api.rng() * 0.6);
      api.at(1.4 + api.rng() * 1.8, 'guns', n + 1);
    },
  },

  triggers: [
    // ---- the picket: cones, crawling, the knife ----
    { id: 'hCone', when: (api) => near(api, 'picket', 11.5) && ready(api), do: (api) => note(api, 'A German sentry. <b>Tap him to see his view cone.</b> In the pale outer part he sees a man standing; in the dark part close to him he sees even a man crawling. Outside the cone, or behind a tree, he sees nothing. The mist helps you: it keeps every cone short.') },
    { id: 'hCrawl', when: (api) => fired(api, 'hCone') && near(api, 'picket', 8.5) && ready(api), do: (api) => note(api, '<b>Crawl</b> (<kbd>P</kbd>, or the Crawl button) and the pale part of a cone cannot see you; only the dark part close to him can. Crawling is slow. Get round <b>behind</b> him, where he never looks.') },
    { id: 'hKnife', when: (api) => fired(api, 'hCone') && behind(api, 'picket', 4.5) && ready(api, 5), do: (api) => note(api, 'His back is to you. <b>Knife</b> (<kbd>Z</kbd>, then tap him): silent, at arm\'s length, and final. Do it before he turns.') },
    { id: 'reliefSaw', when: (api) => { const r = api.ent('relief'); return alive(r) && Math.hypot(r.x - 15.5, r.y - 41.5) < 1.5; }, do: (api) => {
      const body = api.ent('picket');
      if (body && body.state !== 'ok' && body.hidden) api.say('relief', 'Hans? ...Typisch. Rauchen gegangen.', 3);
    } },
    // ---- the wreck: the stone ----
    { id: 'hWreck', when: (api) => near(api, 'wreckguard', 9.5) && !(wrona(api) || {}).carrying && ready(api, api.flag('reliefSent') && !fired(api, 'reliefSaw') ? 14 : LESSON_GAP), do: (api) => note(api, 'One man watches the car; another walks the road behind it. <b>Throw a stone</b> (<kbd>C</kbd>, then tap a spot) past the watcher: he walks over to look, with his back to you. A stone carries about six paces, and it never raises the alarm.') },
    // ---- the forward post ----
    { id: 'hPost', when: (api) => hasSatchel(api) && api.flag('mistGone') && (api.zoneHas('post', 'wrona') || heroNear(api, 32, 30, 9) || heroNear(api, 40, 12, 8)) && ready(api, 6), do: (api) => note(api, '<b>The forward post.</b> Watch before you move. The two at the fire watch each other, and firelight carries: anyone in its glow is seen from far off. The Leutnant by his car sees the whole yard; one man walks round the lodge, another walks the road to the bridge. Find the gap, or make one, and hide what you leave behind: carry a body to a door and it goes inside with you.') },
    { id: 'hBridge', when: (api) => near(api, 'gunner', 11) && ready(api, 6), do: (api) => note(api, '<b>The bridge.</b> The machine-gunner never leaves his nest and looks down the planks to the far bank. The sentry south of him turns, now and then, to look at his back. Take that sentry first, from the bank behind him, or catch the gunner while he looks away. The stream hides a body as well as a bush does.') },
    { id: 'hFord', when: (api) => hasSatchel(api) && (heroNear(api, 53, 8.5, 5) || heroNear(api, 55, 44.5, 5)) && ready(api, 6), do: (api) => note(api, 'A ford. Shallow water is slow to wade and splashes: anyone close by will hear you. Wait until nobody is near, then cross.') },
    { id: 'uhlans', when: (api) => hasSatchel(api) && fired(api, 'guns') && heroNear(api, 71, 24, 6), do: (api) => api.dialogue([
      { who: 'Uhlan', line: 'Panie poruczniku! The Rotmistrz said you would come. He also said you would be late.' },
    ]) },
    // ---- the climax: over the stream, the guns open ----
    { id: 'guns', when: (api) => hasSatchel(api) && api.zoneHas('eastbank', 'wrona'), do: (api) => {
      api.msg('Behind you, the German guns open on the Polish positions.', 'danger');
      api.music('tension');
      api.dialogue([
        { who: 'wrona', line: 'Their guns. Firing blind into the mist, at whatever they think we are.' },
        { who: 'Uhlan', line: 'Lieutenant! Here! To the horses!' },
      ]);
      api.flyover({ from: [-12, 18], to: [90, 26], kind: 'plane', alt: 14, speed: 24 });
      api.at(0.6, 'guns', 0);
    } },
  ],
};
