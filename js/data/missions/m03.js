import { T, F } from '../../core/constants.js';
import { canSee } from '../../core/ai.js';

// M3 · Montevideo Whispers · dusk, 15 December 1939 · the port of Montevideo, neutral Uruguay.
// Kit's first mission, alone and unarmed. Admiral Graf Spee lies against the German pier with
// half the city on the quays to look at her. Kit photographs the shell damage from three
// vantage points, slips a forged "intercept" into the briefcase that goes aboard each evening,
// lets Hauptmann Vahl look straight at her, and walks along the Rambla to dinner at the Mercado.
// Nobody may be killed; Vahl must never see her at work.
//
// Teaches: the tourist's cover (public vs restricted ground), crowds as cover, chloroform and
// tying up, taking a uniform, Distract, and rigged accidents that make guards look the other way.
// Design brief: design/m03.md.

const SHOTS = {
  ph1: 'Click. The bow: a shell hole forward of the anchor as big as a door, the plating peeled back like a sardine tin.',
  ph2: 'Click. The upperworks: splinter scars up the tower mast, a searchlight platform gone, the plant behind the funnel blackened.',
  ph3: 'Click. The waterline: fresh grey paint over welded plates, and a stage slung over the side. Somebody has been busy.',
};
const LAUNCH = [[52, 0, 6, 0], [84, 0, 6, 180]];                 // the navy launch's beat across the basin mouth
const CASE_CLOCK = { easy: 45, normal: 30, hard: 22 };   // seconds from the plant until Vahl comes for the case

const rigBlocked = (api) => (api.t < (api.flag('rigReady') || 0) ? 'Not again so soon; wait a little' : null);
const plantBlocked = (api) => (api.flag('planted') ? 'The signal is already in the case' : null);
const photoBlocked = (api, h) => (h.disguised ? 'A sailor with a camera? Change back first (Disguise)' : null);
const readyToLeave = (api) => api.done('photos') && api.done('plant') && api.flag('vahlAboard');

function plant(api, how) {
  if (api.flag('planted')) return;
  api.flag('planted', true);
  const d = api.ent('driver'), k = api.hero('kit');
  if (how === 'chat') {
    const police = k && k.disguiseFaction === 'neutral';
    if (d) api.say(d, police ? 'Feuer? Sí, sí… natürlich, señor.' : 'Feuer? Aber natürlich, Kamerad.', 2.5);
    api.msg('While Brandt cups the match, Kit leans on the car and slips the flimsy into the attaché\'s briefcase on the back seat.', 'good');
  } else {
    api.msg('Kit eases the car door, opens the briefcase, and slides the flimsy between two dull reports on fuel oil.', 'good');
  }
  api.at(2.5, 'sayPlanted');
  api.countdown('vahlCase', CASE_CLOCK[api.difficulty] ?? 30, 'Vahl comes for the case in');
}

// Knots of townsfolk who stroll together. Every member is sent to the next stop (shifted by his
// offset) at the same moment by the 'stroll' event, so the knot stays in step however long the
// evening runs. Three of them within two paces hide Kit from anyone more than three tiles off.
const STROLLS = {
  // A family walks out along the central pier to look at the bow, and back: Kit starts among them.
  fam: { name: 'A family on an outing', looks: ['civilian', 'woman', 'child', 'child'], off: [[0, 0], [1, 0], [2, 0], [1, 1]],
    stops: [[44, 41, 24], [48, 32, 0], [49, 5, 24], [48, 32, 0]] },
  // Dock hands' wives and sweethearts drift between the Rambla gap, the rail at the head of the basin
  // (where they make room at the bollard) and the German gate.
  wives: { name: 'Onlooker', looks: ['woman', 'civilian', 'woman', 'scientist'], off: [[0, 0], [1, 0], [3, 0], [1, 1]],
    stops: [[48, 57, 12], [48, 40, 0], [52, 35, 28], [58, 39, 12], [48, 40, 0]] },
};

export default {
  id: 'm03', size: [104, 80], seed: 1215, time: 'dusk', weather: 'clear', biome: 'harbour-city', style: 'urban',
  enemyFaction: 'kriegsmarine',
  noLethal: true,
  heroes: [{ hid: 'kit', x: 46, y: 42, a: -80, civilian: true }],
  cameraStart: [53, 37, 17],

  build(M) {
    const W = 104;
    M.fill(T.CONCRETE);
    // The harbour: the basin, three piers and the coal wharf.
    M.water({ x: 0, y: 0, w: W, h: 34 });
    for (const [x, y, w, h] of [[10, 10, 8, 24], [44, 3, 8, 31], [64, 1, 8, 33], [86, 24, 18, 10]]) {
      M.unflag({ x, y, w, h }, F.WATER | F.DEEP);
      M.rect(x, y, w, h, T.CONCRETE);
    }
    M.rect(10, 10, 1, 24, T.DOCK); M.rect(17, 10, 1, 24, T.DOCK);          // timber fenders on the promenade pier
    M.rect(44, 3, 8, 2, T.DOCK);
    M.rect(64, 1, 8, 2, T.DOCK);
    M.scatter({ x: 0, y: 34, w: W, h: 27 }, T.COBBLE, 0.7, 0.15);
    M.paint({ x: 0, y: 44, w: W, h: 2 }, T.GRAVEL);                         // the quay railway
    M.rect(86, 24, 18, 22, T.ASH);                                          // coal dust
    M.scatter({ x: 86, y: 24, w: 18, h: 22 }, T.GRAVEL, 0.6, 0.2);

    // ---------- the ships ----------
    // Admiral Graf Spee alongside the German pier, bow to the north: hull x 55-62, y 4-31. Open water
    // beyond her bow lets Vahl's binoculars reach the head of the central pier.
    M.prop('warship', 55, 4, { id: 'grafspee', w: 8, h: 28, rot: 2, color: '#7b8086', label: 'Admiral Graf Spee' });
    // Her brow: a plank from the after deck to the pier, where the attaché's case goes aboard.
    M.unflag({ x: 63, y: 27, w: 1, h: 1 }, F.WATER | F.DEEP); M.rect(63, 27, 1, 1, T.DOCK);
    M.prop('ship', 73, 6, { id: 'tacoma', w: 6, h: 21, rot: 2, color: '#3d3833', label: 'the freighter Tacoma' });
    M.prop('boat', 20, 15, { color: '#7a5a3a' }); M.prop('boat', 21, 25);
    M.prop('barge', 82, 24, { label: 'a coal lighter' });
    // A rowing-club skiff tied up at the water steps of the central pier: anyone can scull it. In the
    // slot between Graf Spee and the German pier a painters' stage hangs at her waterline (wadeable).
    for (const a of [{ x: 43, y: 30, w: 1, h: 1 }, { x: 63, y: 11, w: 1, h: 3 }]) { M.unflag(a, F.DEEP); M.water(a, false); }
    M.vehicle({ vtype: 'canoe', x: 43, y: 30, a: -90, tag: 'skiff', color: '#8a5a32', disguise: true });

    // ---------- the quays ----------
    for (let x = 1; x < W; x += 4) {
      if ((x >= 10 && x <= 17) || (x >= 44 && x <= 55) || (x >= 62 && x <= 81) || x >= 86) continue;
      M.prop('bollard', x, 34);
    }
    for (const y of [12, 18, 24, 33]) { M.prop('bollard', 10, y); M.prop('bollard', 17, y); }
    for (const y of [15, 21, 27, 33]) M.prop('bollard', 44, y);
    // The promenade pier: benches, lamps and half of Montevideo.
    for (const y of [14, 20, 26]) { M.prop('bench', 12, y); M.prop('bench', 14, y + 3); }
    M.lamp(13.5, 12.5, 3); M.lamp(13.5, 24.5, 3); M.lamp(13.5, 32.5, 3);
    // The central pier: cranes, cargo, a crane whose brake can be slipped.
    M.prop('crane', 45, 9, { id: 'crane1', label: 'the crane',
      interact: { kind: 'rig', verb: 'Slip the brake on', dur: 1.2, handler: 'rig', repeat: true, blocked: rigBlocked } }).noiseAt = [48.5, 12.5, 8, 3];
    M.prop('crane', 48, 22); M.prop('crane', 45, 29);
    M.prop('crates', 49, 15); M.prop('crate', 46, 17); M.prop('crates', 48, 26); M.prop('barrel', 50, 28); M.prop('ammo', 46, 32, { label: 'cargo' });
    M.lamp(47.5, 4.5, 3); M.lamp(50.5, 31.5, 2.5);
    M.prop('bollard', 51, 4, { id: 'ph1', label: 'the bow',
      interact: { kind: 'photo', verb: 'Photograph the damage to', at: [50, 4], reach: 1.0, dur: 3, handler: 'photo', blocked: photoBlocked } });
    // The apron.
    M.prop('crane', 24, 35); M.prop('crane', 36, 35); M.prop('crane', 82, 35);
    M.prop('crates', 28, 40); M.prop('crate', 30, 41); M.prop('barrel', 33, 39); M.prop('crates', 40, 41); M.prop('barrel', 42, 38);
    M.prop('wagon', 5, 44, { rot: 1 }); M.prop('wagon', 26, 44, { rot: 1 }); M.prop('wagon', 31, 44, { rot: 1 }); M.prop('wagon', 76, 44, { rot: 1 });
    M.prop('truck', 36, 39, { color: '#6a5e4a' }); M.prop('cart', 8, 39); M.prop('horse', 8, 41);
    M.lamp(20.5, 38.5, 3); M.lamp(40.5, 36.5, 3); M.lamp(53.5, 37.5, 3);
    // The head of the basin: the stern and the upperworks across the water.
    M.prop('bollard', 54, 34, { id: 'ph2', label: 'the stern and upperworks',
      interact: { kind: 'photo', verb: 'Photograph the damage to', at: [54, 35], reach: 1.0, dur: 3, handler: 'photo', blocked: photoBlocked } });
    M.prop('crates', 55, 43, { id: 'stack', label: 'the crate stack',
      interact: { kind: 'rig', verb: 'Loosen the lashing on', dur: 1.2, handler: 'rig', repeat: true, blocked: rigBlocked } }).noiseAt = [55.5, 43.5, 8, 3];
    M.prop('crate', 58, 44); M.prop('barrel', 59, 43);

    // ---------- the German pier ----------
    // A fence and a sentry gate close the root of the pier; a padlocked side gate lets onto the Tacoma's berth.
    M.fence([[62, 34], [62, 37], [81, 37], [81, 34]], { kind: 'wood', gaps: [[66, 37], [67, 37], [68, 37], [80, 37]] });
    M.gate(80, 37, 1, 1, { id: 'sidegate', solid: false, interact: { verb: 'Pick the padlock on', dur: 2.5, need: 'lockpick', needText: 'It is padlocked' } }).label = 'the side gate';
    M.lamp(65.5, 39.5, 3); M.lamp(70.5, 39.5, 3);
    M.lamp(67.5, 2.5, 3); M.lamp(68.5, 18.5, 2.5);
    M.prop('crates', 69, 34); M.prop('barrel', 63, 35); M.prop('crates', 75, 35); M.prop('ammo', 77, 34, { label: 'provisions' });
    for (const y of [6, 14, 22, 30]) M.prop('bollard', 71, y);
    M.prop('bollard', 64, 9); M.prop('bollard', 64, 23); M.prop('bollard', 64, 31);
    M.prop('bollard', 64, 16, { id: 'ph3', label: 'the waterline',
      interact: { kind: 'photo', verb: 'Photograph the damage to', at: [65, 16], reach: 1.0, dur: 3, handler: 'photo', blocked: photoBlocked } });
    M.prop('table', 66, 4); M.prop('crate', 70, 3);
    // The attaché's car, the case on its back seat, and a barrow by the fence.
    M.prop('car', 62, 40, { id: 'staffcar', rot: 1, color: '#1c1c20', label: 'the attaché\'s car',
      interact: { kind: 'plant', verb: 'Slip the signal into the briefcase in', at: [63, 39], reach: 1.0, dur: 3, need: 'lockpick', needText: 'The car is locked', handler: 'stealthPlant', blocked: plantBlocked } });
    M.prop('cart', 71, 42, { id: 'barrow', label: 'the fishmonger\'s barrow',
      interact: { kind: 'rig', verb: 'Knock the wedge out of', dur: 1.2, handler: 'rig', repeat: true, blocked: rigBlocked } }).noiseAt = [71.5, 43.5, 8, 4];

    // ---------- the coal wharf ----------
    M.prop('coal', 88, 26); M.prop('coal', 92, 27); M.prop('coal', 98, 25); M.prop('coal', 89, 37); M.prop('coal', 98, 39);
    M.prop('crane', 95, 31); M.prop('wagon', 86, 42, { rot: 1 }); M.prop('wagon', 97, 44, { rot: 1 });
    M.lamp(101.5, 30.5, 3);

    // ---------- warehouses and the dock railings ----------
    M.building(1, 47, 14, 8, { id: 'w1', kind: 'warehouse', door: 'n', doorAt: 6, label: 'a bonded warehouse' });
    M.building(23, 47, 12, 8, { id: 'w2', kind: 'warehouse', door: 'n', doorAt: 5, label: 'a bonded warehouse' });
    M.building(38, 47, 8, 8, { id: 'w3', kind: 'warehouse', door: 'w', doorAt: 5, label: 'the cold store' });
    M.building(54, 47, 7, 8, { id: 'w4', kind: 'warehouse', door: 'e', doorAt: 3, label: 'the ship chandler\'s' });
    M.building(64, 47, 13, 8, { id: 'w5', kind: 'warehouse', door: 'w', doorAt: 5, label: 'the German consignee\'s warehouse' });
    M.building(80, 47, 11, 8, { id: 'w6', kind: 'warehouse', door: 'n', doorAt: 5, label: 'a bonded warehouse' });
    M.building(97, 47, 7, 8, { id: 'w7', kind: 'warehouse', door: 'w', doorAt: 4, label: 'a bonded warehouse' });
    M.building(25, 57, 5, 3, { id: 'cshed', kind: 'shed', door: 'n', doorAt: 2, label: 'the customs shed' });
    M.building(39, 57, 6, 3, { id: 'harbourmaster', door: 'w', doorAt: 1, label: 'the harbour master\'s office' });
    M.building(66, 57, 5, 3, { id: 'gshed', kind: 'shed', door: 'n', doorAt: 2, label: 'a tool shed' });
    M.building(82, 57, 6, 3, { id: 'eshed', kind: 'shed', door: 'n', doorAt: 3, label: 'a tool shed' });
    for (const [x, y] of [[4, 57], [12, 58], [33, 58], [49, 56], [58, 58], [74, 58], [89, 58], [100, 57]]) M.prop(y % 2 ? 'crates' : 'crate', x, y);
    for (const [x, y] of [[20, 56], [36, 56], [62, 56], [78, 56], [93, 56]]) M.prop('barrel', x, y);
    M.fence([[0, 61], [103, 61]], { kind: 'wood', gaps: [16, 17, 18, 19, 20, 21, 47, 48, 49, 50, 51, 52, 61, 62, 63, 92, 93, 94, 95].map((x) => [x, 61]) });
    M.lamp(19.5, 60.5, 2.5); M.lamp(50.5, 59.5, 3); M.lamp(94.5, 60.5, 2.5);
    // Archive finds, off the main routes, behind the railings.
    M.prop('bench', 35, 59);
    M.item('register', 37, 58, { kind: 'documents', label: 'the harbour master\'s landing register', verb: 'Read' });
    M.item('docket', 62, 52, { kind: 'documents', label: 'a chandler\'s docket', verb: 'Read' });

    // ---------- the Rambla and the city ----------
    M.road([[0, 64], [W, 64]], 4, T.ROAD);
    M.road([[19, 61], [19, 46]], 5, T.COBBLE); M.road([[49.5, 61], [49.5, 38]], 5, T.COBBLE); M.road([[93.5, 61], [93.5, 46]], 4, T.COBBLE);
    M.building(2, 68, 16, 10, { id: 'mercado', kind: 'station', door: 'n', doorAt: 7, label: 'the Mercado del Puerto', color: '#e8d8c8' });
    M.building(20, 68, 7, 6, { id: 'cafe', floors: 2, roof: 'flat', door: 'n', doorAt: 3, label: 'a café' });
    M.building(29, 68, 9, 8, { id: 'apts1', kind: 'apartment', floors: 3, door: 'n', doorAt: 4, label: 'apartments' });
    M.building(40, 68, 17, 10, { id: 'aduana', kind: 'apartment', floors: 3, roof: 'flat', door: 'n', doorAt: 8, label: 'the Customs House', color: '#e6dccb' });
    M.building(73, 68, 9, 8, { id: 'apts2', kind: 'apartment', floors: 3, door: 'n', doorAt: 4, label: 'apartments' });
    M.building(84, 68, 9, 9, { id: 'apts3', kind: 'apartment', floors: 4, door: 'n', doorAt: 4, label: 'apartments' });
    M.building(95, 68, 9, 8, { id: 'apts4', kind: 'apartment', floors: 3, door: 'n', doorAt: 4, label: 'apartments' });
    M.rect(58, 67, 14, 13, T.COBBLE);
    M.prop('fountain', 63, 71); M.prop('statue', 59, 75);
    // The plaza's plane trees and palms (harbour maps grow no woods past the edge).
    M.tree(58, 68, 'oak', 1.1); M.tree(70, 68, 'oak', 1.0); M.tree(58, 78, 'palm', 1.0); M.tree(70, 77, 'palm', 1.1);
    for (const [x, y] of [[62, 69], [67, 69], [66, 76], [19, 78], [28, 78], [38, 78]]) M.bush(x, y);
    M.hedge([[72, 70], [72, 76]]); M.hedge([[57, 70], [57, 73]]);
    M.building(60, 67, 2, 2, { id: 'kiosk', kind: 'shed', enter: false, label: 'a newspaper kiosk', color: '#3e5a48' });
    M.prop('table', 21, 75); M.prop('table', 24, 75); M.prop('bench', 66, 78); M.prop('bench', 60, 78);
    for (const x of [14, 28, 39, 57, 70, 82, 94]) M.lamp(x + 0.5, 66.5, 3);

    // ---------- the crowd (Uruguayans do not miss a show) ----------
    // Static knots: the promenade pier, the café tables, the plaza, the coal-wharf corner.
    const knots = [
      [[12, 13, 'civilian'], [13, 13, 'woman'], [12, 15, 'child'], [15, 21, 'civilian'], [16, 22, 'woman'], [15, 22, 'civilian'], [12, 29, 'scientist'], [13, 30, 'woman']],
      [[21, 74, 'woman'], [22, 74, 'scientist'], [24, 74, 'civilian'], [25, 76, 'woman']],
      [[64, 68, 'civilian'], [65, 69, 'woman'], [61, 72, 'child']],
      [[84, 46, 'civilian'], [85, 46, 'woman']],
    ];
    for (const knot of knots) for (const [x, y, look] of knot) { const n = M.npc({ x, y, name: 'Onlooker', look, role: 'civilian', a: 270 }); n.locked = true; }
    for (const [g, S] of Object.entries(STROLLS)) S.off.forEach(([dx, dy], k) => {
      const n = M.npc({ x: S.stops[0][0] + dx, y: S.stops[0][1] + dy, name: S.name, look: S.looks[k], role: 'civilian', tag: g + k, a: 270 });
      n.locked = true;
    });

    // ---------- zones ----------
    M.zone('dockA', 0, 46, 16, 15, { restricted: true });
    M.zone('dockB', 22, 46, 25, 15, { restricted: true });
    M.zone('dockC', 53, 46, 39, 15, { restricted: true });
    M.zone('dockD', 96, 46, 8, 15, { restricted: true });
    M.zone('germanpier', 62, 0, 20, 39, { restricted: true });
    M.zone('coalwharf', 82, 20, 22, 26, { restricted: true });
    M.zone('centralpier', 44, 3, 8, 14, { recon: false });

    // ---------- police (neutral: they will not shoot a lady) ----------
    const pol = (d) => { const e = M.enemy({ type: 'police', faction: 'neutral', name: 'Policeman', ...d }); if (e) e.ai.shootT = 1e9; return e; };
    pol({ x: 14, y: 32, route: [[14, 32, 3, 90], [14, 11, 5, 270]] });
    pol({ x: 3, y: 63, route: [[3, 63, 3, 0], [44, 63, 4, 0]] });
    pol({ x: 54, y: 64, route: [[54, 64, 3, 180], [101, 64, 4, 0]], min: 'normal' });
    pol({ x: 47, y: 60, a: 270, sweep: [270, 315, 225] });
    pol({ x: 16, y: 60, a: 270, sweep: [270, 200, 330], min: 'normal' });
    pol({ tag: 'pierCop', x: 47, y: 32, route: [[47, 32, 3, 90], [47, 7, 4, 270]] });
    // Keystone of the central pier: his sweep covers the bow, the crane and the water round the head.
    pol({ tag: 'watchman', name: 'Port watchman', x: 45, y: 6, a: 0, sweep: [0, 300, 60, 90] });
    pol({ x: 22, y: 40, route: [[22, 40, 3, 0], [56, 40, 4, 0]] });
    pol({ name: 'Night watchman', x: 36, y: 47, route: [[36, 47, 2, 90], [36, 59, 3, 90], [24, 59, 2, 180], [36, 59, 1, 0]] });
    pol({ name: 'Night watchman', x: 78, y: 47, route: [[78, 47, 2, 90], [78, 59, 3, 90], [90, 59, 2, 0], [78, 59, 1, 180]], min: 'normal' });
    // The head of the basin: the comisario walks the rail; a marine stands by the German fence.
    pol({ tag: 'comisario', type: 'officer', name: 'Comisario Ferreira', x: 51, y: 37, route: [[51, 37, 6, 270], [59, 37, 6, 270]] });
    pol({ tag: 'marine', type: 'sentry', name: 'Uruguayan marine', x: 61, y: 36, a: 180, sweep: [180, 220, 150], hold: true });
    pol({ x: 86, y: 40, route: [[86, 40, 3, 180], [100, 36, 3, 270]], min: 'normal' });
    pol({ x: 49, y: 30, route: [[49, 30, 2, 270], [49, 12, 3, 0]], min: 'hard' });
    pol({ x: 49, y: 39, a: 270, sweep: [270, 320, 220], min: 'hard' });          // Nightjar: a second man at the basin head
    // A Uruguayan navy launch beats up and down the basin mouth, minding the neutrality: the skiff's lock.
    // (Its round is set just after the start: sim.mjs checks patrol routes with a soldier's legs, not a boat's.)
    pol({ tag: 'launch', type: 'sentry', name: 'Uruguayan navy launch', boat: 'boat', x: 52, y: 0, a: 0 });

    // ---------- Kriegsmarine ----------
    const km = 'Matrose';
    M.enemy({ tag: 'gateA', name: 'Gate sentry', type: 'sentry', x: 66, y: 38, a: 90, hold: true });
    M.enemy({ name: 'Gate sentry', type: 'sentry', x: 69, y: 38, a: 90, sweep: [90, 45, 120], hold: true, min: 'normal' });
    // Keystone of the pier root: faces the gate, the brow and the pier by turns, never the Tacoma's berth.
    M.enemy({ tag: 'kptlt', name: 'Kapitänleutnant', type: 'officer', x: 66, y: 30, a: 90, sweep: [90, 180, 270] });
    M.enemy({ name: km, type: 'sailor', x: 65, y: 34, route: [[65, 34, 3, 270], [65, 6, 3, 90]] });
    M.enemy({ name: km, type: 'sailor', x: 70, y: 7, route: [[70, 7, 3, 90], [70, 33, 3, 270]], min: 'normal' });
    // Deck watch on Graf Spee: two lookouts at her starboard rail over the pier (the forward one right
    // abeam the patched plates), one to port over the basin. The hull hides all but what lies abeam.
    M.enemy({ tag: 'lookFwd', name: 'Lookout', type: 'sailor', x: 62, y: 16, a: 0, sweep: [0, 300, 300, 0, 60, 60], hold: true });
    M.enemy({ name: 'Lookout', type: 'sailor', x: 62, y: 24, a: 0, sweep: [0, 45, 315], hold: true });
    M.enemy({ name: 'Lookout', type: 'sailor', x: 55, y: 28, a: 180, sweep: [180, 135, 225], hold: true, min: 'normal' });
    // Hauptmann Vahl: binoculars (twice a sentry's reach, a narrow field). From the pier head he looks
    // out to sea, then west at the central pier; at mid-pier at the hull; at the root through the gate,
    // then west along the head of the basin.
    const vahl = M.enemy({ tag: 'vahl', name: 'Hauptmann Vahl', type: 'officer', faction: 'wehrmacht', rangeMul: 2, x: 65, y: 2,
      route: [[65, 2, 9, 270], [65, 2, 7, 178], [66, 9, 0], [66, 17, 5, 195], [67, 35, 0], [67, 36, 8, 110], [66, 36, 7, 190], [66, 17, 0], [65, 3, 0]] });
    vahl.ai.fov = 50 * Math.PI / 180; vahl.ai.near = 0.35;
    // Brandt minds the car with the case on its back seat; now and then he cadges a light at the gate.
    M.enemy({ tag: 'driver', name: 'Matrose Brandt (driver)', type: 'sailor', x: 61, y: 40,
      route: [[61, 40, 30, 0], [61, 40, 22, 340], [65, 39, 7, 0], [61, 40, 1, 0]] });
    M.enemy({ tag: 'liberty', name: 'Sailor on shore leave', type: 'sailor', x: 63, y: 42,
      route: [[63, 42, 3, 90], [62, 48, 0], [62, 58, 0], [62, 65, 14, 90], [62, 58, 0], [62, 53, 7, 0], [62, 48, 0], [63, 42, 4, 270]] });
    M.enemy({ tag: 'cafe', name: 'Sailor on shore leave', type: 'sailor', x: 24, y: 65,
      route: [[24, 65, 14, 90], [19, 59, 0], [32, 59, 10, 0], [19, 59, 0]] });
    M.enemy({ name: 'Tacoma\'s watch', type: 'sailor', x: 71, y: 18, a: 0, sweep: [0, 300, 60] });
    M.enemy({ name: km, type: 'sailor', x: 96, y: 30, a: 270, sweep: [270, 240, 300] });
    M.enemy({ name: km, type: 'sailor', x: 88, y: 31, route: [[88, 31, 3, 0], [101, 29, 3, 270]], min: 'hard' });
    // Nightjar: a sentry on the Tacoma's berth inside the side gate (the easy way in), a second hand at the brow.
    M.enemy({ name: 'Sentry', type: 'sentry', x: 73, y: 35, a: 0, sweep: [0, 330, 30], min: 'hard' });
    M.enemy({ name: km, type: 'sailor', x: 64, y: 28, a: 0, sweep: [0, 90, 270], hold: true, min: 'hard' });
    M.spawn(49, 63, { type: 'police', faction: 'neutral', name: 'Policeman' });
    M.spawn(68, 35, { type: 'sailor', faction: 'kriegsmarine', name: km });
  },

  objectives: [
    { id: 'photos', text: 'Photograph the shell damage to the Graf Spee from the quay', type: 'destroy', things: ['ph1', 'ph2', 'ph3'] },
    { id: 'plant', text: 'Plant the false fleet signal in the German naval attache\'s briefcase', type: 'flag', flag: 'planted' },
    { id: 'leave', text: 'Leave the harbour without harming anyone - Uruguay is neutral', type: 'flag', flag: 'dined', hidden: true, marker: [9.5, 67.5] },
    { id: 'gentle', text: 'Optional: put nobody to sleep', type: 'check', optional: true, check: (api) => !!api.flag('dined') && !api.flag('kos') },
    { id: 'quiet', text: 'Optional: no police whistles all evening', type: 'check', optional: true, check: (api) => !!api.flag('dined') && api.world.s.stats.alarms === 0 },
    { id: 'registerFind', text: 'Find: the harbour master\'s landing register', type: 'item', item: 'register', optional: true, hidden: true },
    { id: 'docketFind', text: 'Find: a ship chandler\'s docket', type: 'item', item: 'docket', optional: true, hidden: true },
  ],

  script: {
    onStart(api) {
      api.revoke('kit', 'welrod');          // no weapons tonight: the Welrod stays at the legation
      api.at(1.5, 'hintStart');
      api.at(28, 'hintRules');
      for (const [g, S] of Object.entries(STROLLS)) api.at(S.stops[0][2], 'stroll', { g, i: 1 });
      api.at(0.1, 'launchOut');
    },
    onKo(api, e) {
      api.flag('kos', (api.flag('kos') || 0) + 1);
      if (e.tag === 'vahl') { api.fail('Hauptmann Vahl wakes on the quay knowing he was touched. Nothing in his briefcase will be believed now.'); return; }
      if (e.tag === 'driver' && !api.flag('planted')) {
        api.fail('Brandt will wake with a headache and a story, and nothing in that car will be trusted again. The driver was the one man Kit could not touch.');
        return;
      }
      if (!api.flag('hintKo')) {
        api.flag('hintKo', true);
        api.hint('He will sleep for a minute, then wake and shout. Tap him to <b>tie and gag</b> him for good. Kit cannot carry a grown man, but she can <b>drag</b> him, slowly, out of sight: if one of his own walks past and sees him, the whistles go. If he wore a uniform, it is yours: <b>Disguise</b> (<kbd>Z</kbd>) on the sleeping man.');
      }
    },
    onSpotted(api, e, u) {
      if (e.tag === 'vahl' && u.kind === 'hero') {
        api.fail('Hauptmann Vahl lowered his binoculars and looked straight at you, and saw what you were doing. Nothing that reaches his ship from this quay will be believed now.');
        return;
      }
      if (e.faction === 'neutral' && !api.flag('hintPolice')) {
        api.flag('hintPolice', true);
        api.hint('The Uruguayan police will not shoot a lady, but they will blow their whistles, and the Germans will come running and they will shoot. Get out of sight: slip into a building, round a corner or into a crowd, until they give up.');
      }
    },
    onAlarm(api) {
      if (!api.flag('hintAlarm')) {
        api.flag('hintAlarm', true);
        api.hint('Whistles! Police and sailors are searching the quay. Duck into a doorway or lose yourself in a crowd and wait for it to die down. Save often (<kbd>F5</kbd>).');
      }
      // Whistles on the quay make the Germans careful with the car: a second man minds it from now on.
      if (!api.flag('planted') && !api.flag('carGuard')) {
        api.flag('carGuard', true);
        api.spawnEnemy({ tag: 'carGuard', type: 'sailor', faction: 'kriegsmarine', name: 'Matrose', x: 64, y: 42, a: -Math.PI / 2, hold: true });
        api.msg('A second sailor comes out of the gate and plants himself by the attaché\'s car.', 'danger');
      }
    },
    onObjective(api, id) {
      if ((id === 'photos' || id === 'plant') && readyToLeave(api)) api.at(0.5, 'openLeave');
    },
    onEnterBuilding(api, u, t) {
      if (t.id !== 'mercado' || u.kind !== 'hero') return;
      if (readyToLeave(api)) {
        api.flag('dined', true);
        api.msg('A table by the window of the Mercado, a waiter, a glass of tannat, and not a bruise on anyone.', 'good');
      } else if (!api.flag('hintTooSoon')) {
        api.flag('hintTooSoon', true);
        api.say('kit', 'Not yet. Dinner is for afterwards.', 2.5);
      }
    },
  },

  events: {
    hintStart(api) {
      api.hint('Montevideo, dusk. Half the city has come to look at the ship. Kit is a <b>tourist</b>: she may walk anywhere the public may (the Rambla, the quays, the piers). The police only look twice if she runs, crawls, or is seen <b>doing something with her hands</b>. Behind the dock railings and on the German pier the ground is <b>restricted</b>: there, anyone who sees her is suspicious. <b>Crowds</b> are cover: among three or more townsfolk she is lost to anyone more than three paces off, even with the camera up. The family beside her is about to walk out along the pier.');
    },
    hintRules(api) {
      api.hint('No weapons tonight: killing anyone fails the mission. <b>Chloroform</b> (from behind) puts a man to sleep. Three shots of the damage are wanted: the bow from the head of the central pier, the stern from the rail at the head of the basin, the waterline from the German pier itself. Hold <kbd>Tab</kbd> to see every cone, and watch where the tall officer with the binoculars is looking.');
    },
    sayPlanted(api) {
      api.say('kit', 'There. Ark Royal and Renown, waiting in the estuary. Sleep well, gentlemen.', 3);
      api.hint('Done. When the clock runs out <b>Hauptmann Vahl</b> comes for the case, and he will look round the quay before he goes aboard. Be somewhere innocent when he does: on public ground, out of uniform, and not too close.');
    },
    launchOut(api) {
      const l = api.ent('launch');
      if (l) { l.ai.route = LAUNCH.map(([x, y, w, look]) => ({ x: x + 0.5, y: y + 0.5, wait: w, look })); l.ai.ri = 0; l.ai.waitT = 0; l.ai.mode = 'patrol'; }
    },
    stroll(api, { g, i }) {
      const S = STROLLS[g], N = S.stops.length;
      const [x, y, wait] = S.stops[i], [px, py] = S.stops[(i + N - 1) % N];
      S.off.forEach(([dx, dy], k) => { const n = api.ent(g + k); if (n && n.state === 'ok') api.world.routeTo(n, x + dx + 0.5, y + dy + 0.5); });
      api.at(Math.hypot(x - px, y - py) / 2.3 * 1.25 + 1 + wait, 'stroll', { g, i: (i + 1) % N });
    },
    clatter(api, id) {
      const t = api.thing(id);
      if (!t || !t.noiseAt) return;
      const [x, y, r] = t.noiseAt;
      api.world.noise(x, y, r, 'clatter');
      api.sound('fall', x, y);
      api.sound('stone', x + 0.6, y);
    },
    // The countdown runs out: Vahl walks to the car for the case, then turns and sweeps the quay.
    vahlCase(api) {
      const v = api.ent('vahl');
      if (!v || v.state !== 'ok') { api.at(0, 'vahlGone'); return; }
      v.ai.route = [{ x: 64.5, y: 38.5, wait: 600, look: 150 }];
      v.ai.ri = 0; v.ai.waitT = 0; v.path = null;
      if (v.ai.mode === 'post' || v.ai.mode === 'patrol' || v.ai.mode === 'return') v.ai.mode = 'patrol';
      api.flag('vahlFetch', true);
    },
    vahlStare(api) {
      const v = api.ent('vahl'), k = api.hero('kit');
      if (!v || v.state !== 'ok') return;
      if (k && k.state === 'ok' && !(k.hidden && k.hidden.startsWith('b:'))) {
        v.ai.route = [{ x: v.x, y: v.y, wait: 600, look: Math.atan2(k.y - v.y, k.x - v.x) * 180 / Math.PI }];
        v.ai.ri = 0; v.ai.waitT = 0;
      }
      api.at(3.5, 'vahlJudges');
    },
    vahlJudges(api) {
      const v = api.ent('vahl'), k = api.hero('kit');
      if (!v || v.state !== 'ok') return;
      const sees = k && k.state === 'ok' && canSee(api.world, v, k) > 0;
      if (sees && (k.disguised || api.world.mission.inRestricted(k) || Math.hypot(k.x - v.x, k.y - v.y) < 2.5)) {
        api.fail(k.disguised
          ? 'Hauptmann Vahl looks a long time at the sailor by the fence: at the cap, at the hands, at the ankles. Then he takes the forged signal out of the case and reads it twice.'
          : 'Hauptmann Vahl finds the Englishwoman where no tourist should be standing, and his binoculars stay on her. The forged signal goes over the side unread.');
        return;
      }
      if (sees) {
        api.flag('looked', true);
        api.say('vahl', 'Hm. Interessant.', 2.5);
        api.say('kit', 'He\'s looking at me. Smile, Margaret. You\'re a tourist.', 3);
      } else api.say('vahl', 'Nichts. Nur Möwen.', 2);
      v.ai.route = [{ x: 64.5, y: 27.5, wait: 600, look: 180 }];
      v.ai.ri = 0; v.ai.waitT = 0; v.path = null;
      api.flag('vahlBoarding', true);
    },
    vahlGone(api) {
      if (api.flag('vahlAboard')) return;
      api.flag('vahlAboard', true);
      const v = api.ent('vahl');
      if (v) api.world.removeEnt(v.id);
      api.msg('Hauptmann Vahl goes aboard with the attaché\'s briefcase under his arm.', 'good');
      api.at(4, 'legationMen');
      if (readyToLeave(api)) api.at(0.5, 'openLeave');
    },
    legationMen(api) {
      for (const [x, route] of [[66, [[60, 43, 3, 180], [20, 42, 6, 180], [60, 43, 3, 0]]], [67, [[50, 50, 0], [50, 63, 4, 180], [12, 64, 8, 90], [50, 63, 3, 0], [50, 50, 0], [60, 42, 4, 0]]]]) {
        api.spawnEnemy({ tag: 'legation', type: 'officer', faction: 'wehrmacht', look: 'plain', name: 'A man from the German legation', x, y: 39, route });
      }
      api.msg('Two men in long coats come out through the gate and walk the quay, looking at faces.', 'danger');
      if (!api.flag('hintLegation')) { api.flag('hintLegation', true); api.hint('<b>Plain clothes.</b> The legation\'s men are no fools: like officers, they see through a tourist who comes within a couple of paces. Keep your distance, or keep a crowd between you.'); }
    },
    openLeave(api) {
      if (api.flag('leaveOpen')) return;
      api.flag('leaveOpen', true);
      api.objective('leave', 'active');
      api.say('kit', 'That will do. Dinner, Margaret. Somewhere with a tablecloth.', 3);
      api.hint('Now walk out: west along the Rambla to the <b>Mercado del Puerto</b> for dinner. Strolling, not running.');
    },
  },

  handlers: {
    photo(api, hero, thing) {
      api.flag('destroyed:' + thing.id, true);
      api.thingState(thing.id).limpet = true;          // drops the objective marker
      api.msg(SHOTS[thing.id] || 'Click.', 'good');
      const n = ['ph1', 'ph2', 'ph3'].filter((id) => api.flag('destroyed:' + id)).length;
      if (n < 3) api.say('kit', n === 1 ? 'One. Smile for the Admiralty.' : 'Two. One more for the album.', 2.5);
      else api.say('kit', api.flag('planted') ? 'Three. They will be up all night in London over these.' : 'Three. They will be up all night in London over these. Now the briefcase.', 3);
    },
    rig(api, hero, thing) {
      api.flag('rigReady', api.t + 15);
      api.at(thing.noiseAt ? thing.noiseAt[3] : 3, 'clatter', thing.id);
      if (!api.flag('hintRigged')) { api.flag('hintRigged', true); api.say('kit', 'And now I wasn\'t here.', 2); }
    },
    stealthPlant(api) { plant(api, 'stealth'); },
  },

  triggers: [
    // No engine flag makes a guard unarmed: keep any policeman (reinforcements too) from drawing on a tourist.
    { id: 'policeHolster', once: false, when: (api) => {
      if (api.world.s.tick % 30 === 0) for (const e of api.world.enemies()) if (e.faction === 'neutral' && e.ai.shootT < 1e8) e.ai.shootT = 1e9;
      return false;
    }, do() {} },
    // Kit in uniform keeps the driver talking long enough to reach the back seat.
    { id: 'chat', once: false, when: (api) => {
      const d = api.ent('driver'), k = api.hero('kit');
      if (api.flag('planted') || !d || !k) return false;
      const c = api.center('staffcar');
      const chatting = d.state === 'ok' && d.ai.mode === 'distracted' && d.ai.distractBy === k.id && Math.hypot(d.x - c.x, d.y - c.y) < 3.5;
      if (!chatting) { if (api.flag('chatAt')) api.flag('chatAt', 0); return false; }
      if (!api.flag('chatAt')) { api.flag('chatAt', api.t); api.say('kit', k.disguiseFaction === 'neutral' ? '¿Tiene fuego, marinero?' : 'Haben Sie Feuer, Kamerad?', 2); return false; }
      return api.t - api.flag('chatAt') >= 5;
    }, do: (api) => plant(api, 'chat') },
    // Vahl at the car: he takes the case, turns, and raises his binoculars to the quay.
    { id: 'vahlAtCar', when: (api) => {
      const v = api.ent('vahl');
      return api.flag('vahlFetch') && v && v.state === 'ok' && Math.hypot(v.x - 64.5, v.y - 38.5) < 0.8;
    }, do: (api) => {
      api.msg('Hauptmann Vahl takes the briefcase from the back seat, tucks it under his arm, and turns to look at the quay.', 'info');
      api.at(1.5, 'vahlStare');
    } },
    { id: 'vahlAboard', when: (api) => {
      const v = api.ent('vahl');
      return api.flag('vahlBoarding') && (!v || v.state !== 'ok' || Math.hypot(v.x - 64.5, v.y - 27.5) < 1.2);
    }, do: (api) => api.at(0, 'vahlGone') },
    { id: 'vahlLooks', when: (api) => {
      const v = api.ent('vahl'), k = api.hero('kit');
      return !api.flag('planted') && v && k && v.state === 'ok' && k.state === 'ok' && canSee(api.world, v, k) > 0;
    }, do: (api) => {
      api.say('kit', 'There he is. The tall one, watching the quay instead of the ship.', 3);
      api.hint('<b>Hauptmann Vahl.</b> His binoculars reach twice as far as any sentry\'s, and he is an officer: up close he sees through any cover. If he ever sees you at work, the whole deception is blown. Watch where he is looking before you lift a finger; a crowd hides you from him too.');
    } },
    { id: 'hPier', zone: 'centralpier', who: 'kit', do: (api) => api.hint('The bow is best from the head of this pier. Photographing takes three seconds with the camera up, and that is exactly what a watchman notices: do it among the family, or while he looks the other way. The crane\'s brake can be slipped (from out of sight) to make a racket. And mind the far pier: someone out there has binoculars.') },
    { id: 'hRig', when: (api) => { const k = api.hero('kit'); return k && Math.hypot(k.x - 56, k.y - 43.5) < 7; }, do: (api) => api.hint('<b>Rigged accidents.</b> Kit can loosen a lashing or knock out a wedge, then walk away: a few seconds later there is a crash. Patrols and sentries who may leave their post walk over to look; men who must hold their post just turn and stare. Rig it unseen.') },
    { id: 'hCar', when: (api) => { const k = api.hero('kit'); return k && Math.hypot(k.x - 63, k.y - 40) < 7; }, do: (api) => api.hint('<b>The attaché\'s car.</b> Brandt, the driver, watches the door with the case behind it; now and then he strolls to the gate to cadge a light. Kit can pick the car door while his back is turned, or draw him off with a crash. <b>Do not chloroform him</b>: a sleeping driver beside an open case tells its own story.') },
    { id: 'hUniform', when: (api) => { const k = api.hero('kit'); return k && k.uniform; }, do: (api) => api.hint('<b>In uniform.</b> On restricted ground a sailor (or a policeman) is only suspicious to someone close enough for a good look, and officers see through it close up. Toggle <b>Disguise</b> to be a tourist again, and change back before you raise the camera. In uniform Kit can also <b>Distract</b> (<kbd>X</kbd>) a man: ask Brandt for a light by the car, keep him talking five seconds, and her hands are free.') },
    { id: 'hLiberty', when: (api) => { const e = api.ent('liberty'), k = api.hero('kit'); return e && k && e.state === 'ok' && Math.hypot(e.x - k.x, e.y - k.y) < 7; }, do: (api) => api.hint('A sailor on shore leave, off to the kiosk on the Rambla by the alley behind the warehouses. On the way back he stops halfway up the alley to light a cigarette, and nobody else walks that alley much. His uniform would get you onto the German pier, or into a chat with the driver.') },
    { id: 'hGate', when: (api) => { const k = api.hero('kit'), e = api.ent('gateA'); return k && e && Math.hypot(e.x - k.x, e.y - k.y) < 8; }, do: (api) => api.hint('The German gate. The sentries watch the crowd, not the pier behind them, and they never leave the gate: a crash off to one side makes them turn and stare for a few seconds. Further along the fence a <b>padlocked side gate</b> lets onto the Tacoma\'s berth. And a rowing-club <b>skiff</b> is tied up on the far side of the central pier, if you would rather come by water.') },
    { id: 'hSkiff', when: (api) => { const k = api.hero('kit'); return k && k.inVehicle; }, do: (api) => api.hint('<b>The skiff.</b> A lady sculling about the harbour at dusk is nothing remarkable, until she comes within a few paces of a man on watch. Round the head of the central pier, under the Graf Spee\'s bow, and the dark slot between her hull and the German pier runs straight to the waterline.') },
    { id: 'registerRead', when: (api) => !!api.flag('item:register'), do: (api) => {
      api.objective('registerFind', 'active');
      api.say('kit', 'Sixty-two British seamen, landed from the Graf Spee yesterday. The rest of her prisoners are still on her supply ship, somewhere at sea.', 4.5);
    } },
    { id: 'docketRead', when: (api) => !!api.flag('item:docket'), do: (api) => {
      api.objective('docketFind', 'active');
      api.say('kit', 'Filters and separators for a fuel-oil purifier, urgent, for the German warship. Her fuel plant is wrecked. London will like that more than my snaps.', 4.5);
    } },
  ],
};
