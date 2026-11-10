import * as THREE from 'three';
import { Kit, MAT, shade } from './kit.js';
import { FACTIONS } from '../core/constants.js';

// Procedural people. A figure is six meshes (body, two arms, two legs, weapon) in a small
// hierarchy so it can be posed every frame without skinning. ~1.4 units tall.

const HIP = 0.62;
const SHOULDER = 0.4;     // above the hip pivot
const GEO_CACHE = new Map();

// What each hero wears.
export const HERO_LOOK = {
  wrona:    { hat: 'rogatywka', hatColor: '#4f5440', uniform: '#5a5e45', trousers: '#4a4e3a', weapon: 'pistol', pack: false, scarf: '#a33a3a' },
  kit:      { hat: 'beret', hatColor: '#2a2a33', uniform: '#5a4f48', trousers: '#3b3a40', weapon: 'none', coat: true, hair: '#6b3e22' },
  haugland: { hat: 'knit', hatColor: '#c9c3b5', uniform: '#4a5560', trousers: '#3b434b', weapon: 'sten', pack: true },
  prys:     { hat: 'brodie', hatColor: '#5a5a40', uniform: '#6b5b3e', trousers: '#5a4d36', weapon: 'rifle', pack: true },
  ndiaye:   { hat: 'chechia', hatColor: '#b0302a', uniform: '#7a6a45', trousers: '#6a5c3c', weapon: 'bren', pack: true, skin: '#5a3a24' },
  kealoha:  { hat: 'none', hatColor: '#222', uniform: '#3d5a6b', trousers: '#33495a', weapon: 'pistol', skin: '#a8754a', hair: '#1b1410' },
  lena:     { hat: 'pilotka', hatColor: '#6b6f4a', uniform: '#6b6f4a', trousers: '#5a5e3e', weapon: 'rifle', hood: true },
  limei:    { hat: 'cap', hatColor: '#3f4a5a', uniform: '#3f4a5a', trousers: '#33404e', weapon: 'none', skin: '#d6b07e', hair: '#151010' },
  bhim:     { hat: 'slouch', hatColor: '#5a5a3a', uniform: '#4f5a3a', trousers: '#46503a', weapon: 'rifle', pack: true, skin: '#b8865a' },
  jack:     { hat: 'slouch', hatColor: '#7a6a48', uniform: '#7a7350', trousers: '#6a6446', weapon: 'rifle', pack: true },
  rosa:     { hat: 'salakot', hatColor: '#c8b078', uniform: '#e2d6b6', trousers: '#6a4a3a', weapon: 'none', skin: '#b88a5e', hair: '#151010', dress: true },
  zofia:    { hat: 'beret', hatColor: '#3a3a3a', uniform: '#5b4b3b', trousers: '#4a3e32', weapon: 'none', hair: '#c9a060', armband: true },
};

const ENEMY_WEAPON = { soldier: 'rifle', sentry: 'rifle', officer: 'pistol', gunner: 'mg', sniper: 'rifle', tower: 'rifle', sailor: 'rifle', police: 'pistol' };

// Helmet and headgear profiles. Lathe outlines (radius, height) give the real silhouettes:
// the flared M35 Stahlhelm, the shallow Brodie, the crested Adrian, the Soviet SSh-40.
const LATHE = {
  stahlhelm: [[0.205, -0.075], [0.19, -0.05], [0.162, -0.045], [0.158, 0.0], [0.152, 0.05], [0.13, 0.1], [0.09, 0.132], [0.0, 0.145]],
  brodie: [[0.25, -0.005], [0.235, 0.0], [0.15, 0.03], [0.135, 0.07], [0.105, 0.105], [0.055, 0.125], [0.0, 0.13]],
  adrian: [[0.19, -0.035], [0.175, -0.03], [0.14, -0.02], [0.14, 0.04], [0.125, 0.095], [0.08, 0.13], [0.0, 0.14]],
  type90: [[0.16, -0.03], [0.155, 0.02], [0.14, 0.08], [0.105, 0.12], [0.05, 0.142], [0.0, 0.148]],
  ssh: [[0.172, -0.045], [0.16, -0.035], [0.155, 0.02], [0.142, 0.075], [0.11, 0.115], [0.06, 0.138], [0.0, 0.145]],
  m1: [[0.19, -0.06], [0.185, -0.05], [0.172, 0.0], [0.16, 0.06], [0.13, 0.11], [0.075, 0.14], [0.0, 0.15]],
};
// US Army, 1944: olive-drab field jacket, M1 helmet (allied fighters; Greif men once unmasked).
const AMERICAN = { hat: 'm1', hatColor: '#4f5236', uniform: '#6a6446', trousers: '#5a5640', weapon: 'rifle', pack: true, boots: '#3a2e22' };
function hatGeo(k, hat, col, y) {
  const F = { mat: 'fabric', tint: col };
  if (LATHE[hat]) {
    k.lathe(LATHE[hat], 0, y - 0.01, 0, col, { mat: 'metal', tint: col, segs: 16 });
    if (hat === 'adrian') k.box(0.02, 0.05, 0.22, 0, y + 0.14, 0, col, { mat: 'metal', tint: col });
    if (hat === 'type90') k.box(0.24, 0.1, 0.03, 0, y - 0.08, -0.12, '#8a7b4e', F);
    return;
  }
  switch (hat) {
    case 'cap': k.cyl(0.13, 0.13, 0.09, 0, y + 0.02, 0, col, { ...F, segs: 14 }); k.box(0.16, 0.02, 0.1, 0, y - 0.02, 0.15, shade(col, -0.1), F); break;
    case 'peaked': k.cyl(0.155, 0.122, 0.08, 0, y + 0.06, 0.01, col, { ...F, segs: 16 }); k.cyl(0.125, 0.13, 0.05, 0, y, 0, '#2a2a2a', { ...F, tint: '#3a3a3a', segs: 16 }); k.box(0.17, 0.015, 0.09, 0, y - 0.02, 0.14, '#111', F); break;
    case 'rogatywka': k.box(0.21, 0.09, 0.21, 0, y + 0.07, 0, col, { ...F, ry: Math.PI / 4 }); k.cyl(0.13, 0.13, 0.06, 0, y, 0, shade(col, -0.05), { ...F, segs: 14 }); k.box(0.16, 0.015, 0.08, 0, y - 0.02, 0.14, '#1a1a1a', F); break;
    case 'beret': k.sphere(0.14, 0.03, y + 0.05, 0, col, { ...F, sy: 0.38 }); break;
    case 'knit': k.sphere(0.132, 0, y + 0.02, 0, col, { ...F, sy: 0.85 }); k.sphere(0.04, 0, y + 0.14, 0, shade(col, -0.1), F); break;
    case 'chechia': k.cyl(0.1, 0.12, 0.14, 0, y + 0.06, 0, col, { ...F, segs: 14 }); k.cyl(0.005, 0.005, 0.14, 0.06, y + 0.06, -0.06, '#111', { ...F, rz: 0.6 }); break;
    case 'slouch': k.cyl(0.12, 0.13, 0.11, 0, y + 0.06, 0, col, { ...F, segs: 14 }); k.cyl(0.25, 0.25, 0.02, 0, y, 0, col, { ...F, segs: 18, rz: 0.12 }); break;
    case 'pilotka': k.capsule(0.05, 0.16, 0, y + 0.05, 0, col, { ...F, rx: Math.PI / 2, sx: 1.3 }); break;
    case 'salakot': k.cone(0.27, 0.15, 0, y + 0.07, 0, col, { mat: 'roof_thatch', tint: '#ffffff', segs: 16 }); break;
    case 'fedora': k.cyl(0.12, 0.13, 0.12, 0, y + 0.07, 0, col, { ...F, segs: 14 }); k.cyl(0.21, 0.21, 0.02, 0, y + 0.01, 0, col, { ...F, segs: 18 }); break;
    case 'navycap': k.cyl(0.13, 0.13, 0.07, 0, y + 0.03, 0, col, { ...F, segs: 14 }); k.cyl(0.155, 0.13, 0.03, 0, y + 0.07, 0, '#f0f0f0', { ...F, tint: '#f0f0f0', segs: 14 }); break;
    case 'none': default: break;
  }
}

// Plain clothes for heroes passing as locals (the `civilian` toggle): a coat and a headscarf or a
// cap instead of battledress, and no weapon in sight.
export const CIVILIAN_LOOK = {
  kit: { hat: 'none', uniform: '#5c4a52', trousers: '#3a3436', coat: true, dress: true, weapon: 'none', scarf: '#8a6a3a', hair: '#6b3e22' },
  rosa: { hat: 'salakot', hatColor: '#c8b078', uniform: '#e2d6b6', trousers: '#6a4a3a', dress: true, weapon: 'none', hair: '#151010' },
  woman: { hat: 'none', uniform: '#6a4a4a', trousers: '#4a3a3a', dress: true, coat: true, weapon: 'none' },
  man: { hat: 'cap', hatColor: '#3a3430', uniform: '#5a4e44', trousers: '#3e3832', coat: true, weapon: 'none', pack: false },
};
const WOMEN = new Set(['kit', 'lena', 'limei', 'rosa', 'zofia']);

function lookFor(e) {
  if (e.kind === 'hero') {
    const L = { ...(HERO_LOOK[e.hid] || HERO_LOOK.wrona) };
    if (e.disguised && e.hid !== 'rosa' && e.disguiseLook === 'plain') {
      // Clothes taken from a plain-clothes man (Gestapo, SD): his long coat and hat.
      return { ...L, uniform: '#3a3632', trousers: '#2c2a28', hat: 'fedora', hatColor: '#24221f', coat: true, dress: false, weapon: 'pistol', pack: false, scarf: null, hood: false, armband: false, boots: '#141414' };
    }
    if (e.disguised && e.hid !== 'rosa') {
      // The uniform taken from the body: its faction's colours and a sailor's or an officer's cap.
      const fac = e.disguiseFaction || 'wehrmacht', f = FACTIONS[fac] || FACTIONS.wehrmacht;
      const navy = fac === 'kriegsmarine' || e.disguiseType === 'sailor';
      return { ...L, uniform: hex(f.uniform), trousers: shade(hex(f.uniform), -0.08), hat: navy ? 'navycap' : 'peaked', hatColor: hex(f.helmetColor), coat: false, dress: false, weapon: 'pistol', pack: false, scarf: null, hood: false, armband: false };
    }
    if (e.civilian) {
      const C = CIVILIAN_LOOK[e.hid] || (WOMEN.has(e.hid) ? CIVILIAN_LOOK.woman : CIVILIAN_LOOK.man);
      return { ...L, scarf: null, hood: false, armband: false, pack: false, ...C, hair: C.hair || L.hair };
    }
    if (e.snow) return { ...L, uniform: '#dfe3e6', trousers: '#cfd4d8', hatColor: L.hat === 'none' ? L.hatColor : '#e8ecee' };
    return L;
  }
  if (e.kind === 'npc' && e.look === 'captive') {
    // A prisoner in his own uniform, bareheaded and unarmed.
    const f = FACTIONS[e.faction] || FACTIONS.wehrmacht;
    return { hat: 'none', uniform: hex(f.uniform), trousers: shade(hex(f.uniform), -0.12), weapon: 'none', skin: hex(f.skin), hair: '#4a3a2a', boots: '#2a2420' };
  }
  if (e.kind === 'npc') {
    const looks = {
      prisoner: { hat: 'none', uniform: '#6b6450', trousers: '#5a5444', weapon: 'none', hair: '#4a3a2a' },
      civilian: { hat: 'fedora', hatColor: '#3a3430', uniform: '#5a4e44', trousers: '#3e3832', weapon: 'none', coat: true },
      scientist: { hat: 'fedora', hatColor: '#2e2e30', uniform: '#3e3e44', trousers: '#2e2e32', weapon: 'none', coat: true },
      sailor: { hat: 'navycap', hatColor: '#222', uniform: '#2a3448', trousers: '#2a3448', weapon: 'none' },
      woman: { hat: 'none', uniform: '#6a4a4a', trousers: '#4a3a3a', weapon: 'none', dress: true, hair: '#5a3a22' },
      child: { hat: 'none', uniform: '#5a6a7a', trousers: '#3a4048', weapon: 'none', hair: '#6a4a2a', child: true },
      ally: { hat: 'brodie', hatColor: '#5a5a40', uniform: '#6b6345', trousers: '#5a5438', weapon: 'rifle', pack: true },
      american: AMERICAN,
      partisan: { hat: 'cap', hatColor: '#3a3a30', uniform: '#5a5040', trousers: '#4a4436', weapon: 'rifle' },
      wounded: { hat: 'none', uniform: '#6b6345', trousers: '#5a5438', weapon: 'none', bandage: true },
    };
    return looks[e.look] || looks.prisoner;
  }
  const f = FACTIONS[e.faction] || FACTIONS.wehrmacht;
  const et = e.etype;
  if (e.look === 'american') return { ...AMERICAN, skin: hex(f.skin) };
  // Plain clothes (Gestapo, Sicherheitsdienst, informers): a long coat and a hat, pistol in hand.
  if (e.look === 'plain') return { hat: 'fedora', hatColor: '#24221f', uniform: '#3a3632', trousers: '#2c2a28', weapon: 'pistol', coat: true, skin: hex(f.skin), boots: '#141414' };
  const hat = et === 'officer' ? 'peaked' : et === 'sailor' ? 'navycap' : e.faction === 'dutch' ? 'peaked' : et === 'police' ? 'fedora' : f.helmet;
  return {
    hat, hatColor: hex(et === 'officer' ? shade(hex(f.uniform), -0.15) : f.helmetColor), uniform: hex(f.uniform),
    trousers: shade(hex(f.uniform), -0.12), weapon: ENEMY_WEAPON[et] || 'rifle', pack: false, skin: hex(f.skin),
    german: ['wehrmacht', 'ss', 'luftwaffe'].includes(e.faction) && et !== 'officer',
    coat: et === 'officer', boots: et === 'officer' ? '#141414' : '#2a2420',
  };
}

function hex(n) { return typeof n === 'string' ? n : '#' + n.toString(16).padStart(6, '0'); }

function buildGeos(L) {
  const key = JSON.stringify(L);
  if (GEO_CACHE.has(key)) return GEO_CACHE.get(key);
  const skin = L.skin || '#d9b38c';
  const sc = L.child ? 0.78 : 1;
  const U = (c) => ({ mat: 'fabric', tint: c });
  const S = { mat: 'plain' };
  // Body: torso rises from the hip pivot; head and headgear on top.
  const b = new Kit();
  if (L.dress) b.cyl(0.16, 0.27, 0.62, 0, -0.1, 0, L.uniform, { ...U(L.uniform), segs: 14 });
  // Torso turned on a lathe: narrow waist, full chest, square shoulders, flattened front-to-back.
  b.lathe([[0.13, 0.02], [0.15, 0.12], [0.175, 0.26], [0.19, 0.36], [0.185, 0.42], [0.14, 0.47], [0.07, 0.5]], 0, 0, 0, L.uniform, { ...U(L.uniform), sz: 0.66, segs: 14 });
  b.capsule(0.13, 0.06, 0, 0.07, 0, L.trousers, { ...U(L.trousers), sx: 1.35, sz: 0.85, segs: 12 }); // hips
  if (L.coat) b.cyl(0.21, 0.26, 0.5, 0, -0.02, 0, L.uniform, { ...U(shade(L.uniform, -0.05)), segs: 14, sz: 0.75 });
  b.cyl(0.2, 0.2, 0.06, 0, 0.1, 0, '#2a241e', { ...U('#1e1a16'), segs: 14, sz: 0.72 });              // belt
  b.box(0.05, 0.045, 0.02, 0, 0.1, 0.145, '#8a8270', U('#9a9280'));                                  // buckle
  for (const s of [-1, 1]) b.box(0.08, 0.09, 0.06, s * 0.1, 0.16, 0.13, '#3a3026', U('#4a3e30'));  // ammo pouches
  b.box(0.035, 0.42, 0.02, 0.09, 0.3, 0.135, '#3a3026', { ...U('#4a3e30'), rz: 0.25 });            // webbing strap
  if (L.scarf) b.cyl(0.12, 0.13, 0.07, 0, 0.47, 0, L.scarf, { ...U(L.scarf), segs: 12 });
  if (L.armband) b.cyl(0.07, 0.07, 0.06, 0.27, 0.32, 0, '#e8e2d8', { ...U('#f0e8e0'), segs: 10 });
  if (L.pack) { b.box(0.28, 0.28, 0.13, 0, 0.3, -0.16, '#4a4632', U('#7a7458')); b.cyl(0.055, 0.055, 0.3, 0, 0.46, -0.15, '#5a5440', { ...U('#6a6450'), rz: Math.PI / 2 }); }
  if (L.german) {
    // Fluted gas-mask canister, canteen, bread bag and Y-straps: the silhouette of 1939.
    b.cyl(0.055, 0.055, 0.26, 0.05, 0.12, -0.15, '#5a5e50', { ...U('#6e7466'), rx: 0.15, rz: 0.25, segs: 12 });
    b.capsule(0.045, 0.06, 0.17, 0.03, -0.06, '#4a4030', U('#5c5040'));
    b.box(0.13, 0.12, 0.06, -0.15, 0.04, -0.08, '#6a6248', U('#8a8268'));
    for (const s of [-1, 1]) b.box(0.03, 0.4, 0.015, s * 0.07, 0.3, 0.128, '#1e1a16', { ...U('#2a2620'), rz: s * 0.18 });
    b.box(0.03, 0.4, 0.015, 0, 0.3, -0.125, '#1e1a16', U('#2a2620'));
  }
  if (L.hood) b.box(0.42, 0.36, 0.06, 0, 0.28, -0.15, shade(L.uniform, 0.05), U(shade(L.uniform, 0.05)));
  // Tunic details: collar, breast pockets, shoulder straps, button line.
  b.cyl(0.085, 0.1, 0.06, 0, 0.475, 0, L.uniform, { ...U(shade(L.uniform, -0.08)), segs: 12 });
  for (const s of [-1, 1]) { b.box(0.09, 0.08, 0.02, s * 0.085, 0.35, 0.128, L.uniform, U(shade(L.uniform, -0.05))); b.box(0.05, 0.02, 0.16, s * 0.17, 0.45, 0, L.uniform, U(shade(L.uniform, 0.06))); }
  b.box(0.015, 0.3, 0.012, 0, 0.27, 0.135, '#222', U(shade(L.uniform, -0.18)));
  b.cyl(0.05, 0.055, 0.07, 0, 0.51, 0, skin, S);                                                      // neck
  const headY = 0.63;
  b.sphere(0.102, 0, headY, 0.005, skin, { ...S, sy: 1.14, sz: 1.04 });
  b.sphere(0.022, 0, headY - 0.005, 0.11, skin, S);                                                   // nose
  for (const s of [-1, 1]) { b.sphere(0.018, s * 0.042, headY + 0.018, 0.098, '#1a1410', S); b.sphere(0.025, s * 0.112, headY, 0, skin, { ...S, sx: 0.5 }); }
  if (L.hair) b.sphere(0.118, 0, headY + 0.035, -0.02, L.hair, { ...U(L.hair), sy: 0.82 });
  if (L.bandage) b.cyl(0.118, 0.118, 0.05, 0, headY + 0.06, 0, '#e8e4dc', { ...U('#f4f0e8'), segs: 14 });
  hatGeo(b, L.hat, L.hatColor || '#444', headY + 0.09);
  // Limbs hang from their pivots (hip, shoulder).
  const leg = new Kit();
  leg.capsule(0.078, 0.24, 0, -0.17, 0.0, L.trousers, { ...U(L.trousers), segs: 10 });
  leg.capsule(0.066, 0.24, 0, -0.43, -0.01, L.trousers, { ...U(L.trousers), segs: 10 });
  leg.box(0.13, 0.11, 0.27, 0, -0.575, 0.045, L.boots || '#2a2420', { ...U(L.boots || '#241e18'), shade: 0.2 });
  leg.cyl(0.07, 0.075, 0.2, 0, -0.48, 0, L.boots || '#2a2420', { ...U(L.boots || '#241e18'), segs: 10 });
  const arm = new Kit();
  arm.capsule(0.058, 0.2, 0, -0.13, 0, L.uniform, { ...U(L.uniform), segs: 10 });
  arm.capsule(0.05, 0.19, 0, -0.36, 0.02, L.coat ? shade(L.uniform, -0.05) : L.uniform, { ...U(L.coat ? shade(L.uniform, -0.05) : L.uniform), segs: 10, rx: -0.12 });
  arm.sphere(0.052, 0, -0.52, 0.04, skin, { ...S, sy: 1.2 });
  const wpn = new Kit();
  const wood = { mat: 'wood', tint: '#c09060' }, steel = { mat: 'metal', tint: '#606468' };
  switch (L.weapon) {
    case 'rifle':
      wpn.box(0.05, 0.08, 0.34, 0, -0.02, 0.0, '#fff', wood); wpn.box(0.045, 0.05, 0.55, 0, 0.0, 0.42, '#fff', wood);
      wpn.cyl(0.013, 0.013, 0.72, 0, 0.03, 0.55, '#fff', { ...steel, rx: Math.PI / 2, segs: 8 }); wpn.box(0.03, 0.04, 0.12, 0, 0.04, 0.2, '#fff', steel);
      break;
    case 'mg':
      wpn.box(0.07, 0.09, 0.3, 0, -0.01, 0.0, '#fff', steel); wpn.cyl(0.03, 0.03, 0.62, 0, 0.02, 0.45, '#fff', { ...steel, rx: Math.PI / 2, segs: 10 });
      wpn.cyl(0.006, 0.006, 0.3, 0.06, -0.12, 0.62, '#2a2a2a', { rx: 0.4 }); wpn.cyl(0.006, 0.006, 0.3, -0.06, -0.12, 0.62, '#2a2a2a', { rx: 0.4 });
      break;
    case 'bren':
      wpn.box(0.06, 0.09, 0.62, 0, 0, 0.25, '#fff', steel); wpn.box(0.04, 0.2, 0.06, 0, 0.13, 0.28, '#fff', { ...steel, rx: -0.3 });
      wpn.box(0.05, 0.08, 0.26, 0, -0.03, -0.12, '#fff', wood); wpn.cyl(0.015, 0.015, 0.3, 0, 0.0, 0.66, '#fff', { ...steel, rx: Math.PI / 2 });
      break;
    case 'sten': wpn.cyl(0.025, 0.025, 0.5, 0, 0, 0.2, '#fff', { ...steel, rx: Math.PI / 2 }); wpn.box(0.16, 0.03, 0.04, 0.08, 0, 0.18, '#fff', steel); wpn.box(0.02, 0.1, 0.22, 0, -0.04, -0.1, '#fff', steel); break;
    case 'pistol': wpn.box(0.035, 0.085, 0.15, 0, -0.02, 0.06, '#fff', steel); break;
    default: break;
  }
  const g = { body: b.build(), leg: leg.build(), arm: arm.build(), weapon: wpn.parts.length ? wpn.build() : null, scale: sc };
  GEO_CACHE.set(key, g);
  return g;
}

function buildDogGeos() {
  if (GEO_CACHE.has('dog')) return GEO_CACHE.get('dog');
  const fur = { mat: 'fabric', tint: '#6a5038' };
  const b = new Kit();
  b.capsule(0.13, 0.42, 0, 0, 0, '#4a3a2a', { ...fur, rx: Math.PI / 2, sx: 0.9 });
  b.capsule(0.09, 0.12, 0, 0.12, 0.38, '#3e3022', { ...fur, rx: 0.6 });
  b.capsule(0.055, 0.12, 0, 0.12, 0.55, '#2e241a', { ...fur, tint: '#3a2a1e', rx: Math.PI / 2 });
  for (const s of [-1, 1]) b.cone(0.035, 0.09, s * 0.06, 0.27, 0.36, '#2e241a', { ...fur, tint: '#3a2a1e' });
  b.capsule(0.025, 0.25, 0, 0.08, -0.4, '#3e3022', { ...fur, rx: -0.9 });
  const leg = new Kit(); leg.capsule(0.035, 0.26, 0, -0.16, 0, '#3e3022', fur);
  const g = { body: b.build(), leg: leg.build() };
  GEO_CACHE.set('dog', g);
  return g;
}

let LIB = null;
export function setFigureLib(lib) { LIB = lib; }
function partMesh(built) {
  const mats = built.slots.map((s) => (s === 'plain' || !LIB ? MAT.smooth : LIB.material(s, { normal: 0.5, albedo: false })));
  return new THREE.Mesh(built.geometry, mats.length === 1 ? mats[0] : mats);
}

const XRAY = new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false });
const XRAY_ENEMY = new THREE.MeshBasicMaterial({ color: 0xff8a7a, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false });

export class Figure {
  constructor(e) {
    this.root = new THREE.Group();
    this.pose = new THREE.Group();
    this.root.add(this.pose);
    this.phase = Math.random() * 6;
    this.actT = 0;
    this.lastKey = null;
    this.isDog = e.etype === 'dog';
    this.xrayMeshes = [];
    this.rebuild(e);
  }

  appearanceKey(e) { return [e.disguised, e.disguised && e.disguiseFaction, e.disguiseType, e.disguiseLook, e.snow, e.look, e.civilian].join('|'); }

  rebuild(e) {
    this.lastKey = this.appearanceKey(e);
    this.ghost = null;
    while (this.pose.children.length) this.pose.remove(this.pose.children[0]);
    this.xrayMeshes = [];
    const mk = (built, parent, x = 0, y = 0, z = 0) => {
      const m = partMesh(built);
      const geo = built.geometry;
      m.castShadow = true; m.receiveShadow = false;
      m.position.set(x, y, z);
      parent.add(m);
      if (e.kind === 'hero' || e.kind === 'npc') {
        const xr = new THREE.Mesh(geo, XRAY); xr.renderOrder = 10; xr.visible = false; m.add(xr); this.xrayMeshes.push(xr);
      }
      return m;
    };
    if (this.isDog) {
      const g = buildDogGeos();
      this.hips = new THREE.Group(); this.hips.position.y = 0.42; this.pose.add(this.hips);
      this.body = mk(g.body, this.hips);
      this.legs = [[-0.09, 0.27], [0.09, 0.27], [-0.09, -0.27], [0.09, -0.27]].map(([x, z]) => { const p = new THREE.Group(); p.position.set(x, -0.08, z); this.hips.add(p); mk(g.leg, p); return p; });
      return;
    }
    const L = lookFor(e);
    const g = buildGeos(L);
    this.pose.scale.setScalar(g.scale);
    this.hips = new THREE.Group(); this.hips.position.y = HIP; this.pose.add(this.hips);
    this.torso = new THREE.Group(); this.hips.add(this.torso);
    this.body = mk(g.body, this.torso);
    this.armL = new THREE.Group(); this.armL.position.set(-0.235, SHOULDER, 0); this.torso.add(this.armL); mk(g.arm, this.armL);
    this.armR = new THREE.Group(); this.armR.position.set(0.235, SHOULDER, 0); this.torso.add(this.armR); mk(g.arm, this.armR);
    this.legL = new THREE.Group(); this.legL.position.set(-0.1, 0, 0); this.hips.add(this.legL); mk(g.leg, this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.1, 0, 0); this.hips.add(this.legR); mk(g.leg, this.legR);
    this.weapon = null;
    if (g.weapon) {
      this.weapon = mk(g.weapon, this.armR, 0, -0.46, 0.04);
      this.weaponKind = L.weapon;
    }
  }

  setXray(on, enemy = false) {
    for (const x of this.xrayMeshes) { x.visible = on; x.material = enemy ? XRAY_ENEMY : XRAY; }
  }

  // Pose the figure for this frame from the entity's state.
  update(e, dt, speed) {
    if (this.appearanceKey(e) !== this.lastKey) this.rebuild(e);
    if (this.isDog) return this.updateDog(e, dt, speed);
    const P = this.pose;
    // Reset
    P.rotation.set(0, 0, 0); P.position.set(0, 0, 0);
    this.hips.position.y = HIP; this.hips.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0.08); this.armR.rotation.set(0, 0, -0.08);
    this.legL.rotation.set(0, 0, 0); this.legR.rotation.set(0, 0, 0);
    if (this.weapon) { this.weapon.rotation.set(0, 0, 0); this.weapon.position.set(0, -0.46, 0.04); }

    const dead = e.state === 'dead', ko = e.state === 'ko', down = e.state === 'down';
    if (e.carriedBy) {
      // Slung over the carrier's shoulders.
      P.rotation.set(0, 0, Math.PI / 2); P.position.set(0.25, 1.25, -0.05);
      this.armL.rotation.x = 0.3; this.armR.rotation.x = 0.3; this.legL.rotation.x = 0.2;
      return;
    }
    if (dead || ko || down) {
      const seed = (e.id.charCodeAt(e.id.length - 1) % 5) / 5;
      P.rotation.x = dead && seed > 0.5 ? -Math.PI / 2 : Math.PI / 2;
      P.rotation.z = (seed - 0.5) * 0.6;
      P.position.y = 0.12;
      this.armL.rotation.z = 0.9 + seed; this.armR.rotation.z = -0.7 - seed * 0.5;
      this.legL.rotation.z = 0.15; this.legR.rotation.z = -0.25 * seed;
      if (down) { this.armR.rotation.x = Math.sin(performance.now() / 300) * 0.4 - 0.6; }
      if (ko && e.tied) { this.armL.rotation.set(0.3, 0, 0.2); this.armR.rotation.set(0.3, 0, -0.2); }
      return;
    }
    const moving = speed > 0.05;
    if ((e.pose === 'sit' || e.pose === 'sleep') && !moving) {
      // On a crate or a step: thighs forward, shins down; a sleeper slumps, chin on chest.
      this.hips.position.y = HIP - 0.3;
      this.legL.rotation.x = -1.35; this.legR.rotation.x = -1.25; this.legL.rotation.z = 0.08; this.legR.rotation.z = -0.08;
      this.armL.rotation.x = -0.55; this.armR.rotation.x = -0.6;
      if (e.pose === 'sleep') { this.torso.rotation.x = 0.42; this.armL.rotation.x = -0.25; this.armR.rotation.x = -0.3; }
      if (this.weapon && this.weaponKind !== 'pistol') { this.weapon.rotation.x = 1.0; this.weapon.position.set(0, -0.3, 0.1); }
      return;
    }
    if (e.swimming) {
      P.position.y = -0.95;
      this.phase += dt * 5;
      this.armL.rotation.x = -Math.PI + Math.sin(this.phase) * 1.2; this.armR.rotation.x = -Math.PI + Math.sin(this.phase + Math.PI) * 1.2;
      return;
    }
    if (e.stance === 'prone') {
      P.rotation.x = Math.PI / 2 - 0.02; P.position.y = 0.16; P.position.z = -0.35;
      this.phase += dt * speed * 5;
      const s = moving ? Math.sin(this.phase) : 0;
      this.armL.rotation.x = -2.6 + s * 0.5; this.armR.rotation.x = -2.6 - s * 0.5;
      this.legL.rotation.x = s * 0.3; this.legR.rotation.x = -s * 0.3;
      this.legL.rotation.z = 0.1 + Math.max(0, s) * 0.3; this.legR.rotation.z = -0.1 - Math.max(0, -s) * 0.3;
      if (this.weapon) this.weapon.rotation.x = 0.4;
      return;
    }
    // Upright.
    const run = speed > 3;
    this.phase += dt * (moving ? speed * (run ? 2.6 : 3.6) : 1.2);
    const amp = moving ? (run ? 0.85 : 0.5) : 0;
    const s = Math.sin(this.phase);
    this.legL.rotation.x = s * amp; this.legR.rotation.x = -s * amp;
    this.armL.rotation.x = -s * amp * 0.8;
    this.armR.rotation.x = s * amp * 0.8;
    this.hips.position.y = HIP + (moving ? Math.abs(Math.cos(this.phase)) * (run ? 0.06 : 0.03) : Math.sin(this.phase * 0.5) * 0.004);
    if (run) this.torso.rotation.x = 0.22;
    if (e.carrying) { this.armL.rotation.x = -2.6; this.armR.rotation.x = -2.6; this.torso.rotation.x = 0.15; }
    // Weapons at the ready when on alert.
    const alert = e.kind === 'enemy' && (e.ai.mode === 'alert' || e.ai.mode === 'search');
    if (this.weapon && (this.weaponKind === 'rifle' || this.weaponKind === 'mg' || this.weaponKind === 'bren' || this.weaponKind === 'sten')) {
      if (alert || (e.kind === 'enemy' && e.etype === 'gunner')) {
        this.armR.rotation.x = -1.35; this.armL.rotation.x = -1.2; this.armL.rotation.y = 0.6; this.weapon.rotation.x = 1.35;
      } else if (!e.carrying) {
        // Slung: rifle hangs from the shoulder.
        this.armR.rotation.x = Math.min(this.armR.rotation.x, 0.2) * 0.3 - 0.15;
        this.weapon.rotation.x = 1.25; this.weapon.position.set(0, -0.2, -0.12);
      }
    }
    if (e.kind === 'enemy' && e.ai.mode === 'distracted') { this.armL.rotation.x = -0.4; this.armL.rotation.z = 0.5; }
    // One-shot action animations.
    const act = e.act;
    if (act) {
      const k = Math.min(1, act.t / Math.max(0.01, act.dur));
      switch (act.ab) {
        case 'knife': case 'kukri': case 'bolo': case 'punch': case 'chloroform':
          this.armR.rotation.x = -0.6 - Math.sin(k * Math.PI) * 1.3; this.torso.rotation.x = 0.15 + Math.sin(k * Math.PI) * 0.15; break;
        case 'pistol': case 'welrod': case 'rifle': case 'silentrifle': case 'bren':
          this.armR.rotation.x = -1.45; this.armL.rotation.x = -1.3; this.armL.rotation.y = 0.5; if (this.weapon) this.weapon.rotation.x = 1.45; break;
        case 'charge': case 'timer': case 'cutters': case 'interact': case 'tie': case 'revive': case 'limpet': case 'carry':
          this.hips.position.y = HIP - 0.28; this.legL.rotation.x = -1.2; this.legR.rotation.x = 0.4; this.torso.rotation.x = 0.45;
          this.armR.rotation.x = -0.9 + Math.sin(performance.now() / 120) * 0.15; this.armL.rotation.x = -0.8; break;
        default: break;
      }
    }
    if (e._throwT && performance.now() - e._throwT < 400) { const k = (performance.now() - e._throwT) / 400; this.armR.rotation.x = -3 + k * 3.2; }
  }

  updateDog(e, dt, speed) {
    const dead = e.state !== 'ok';
    this.pose.rotation.set(0, 0, dead ? Math.PI / 2 : 0);
    this.pose.position.y = dead ? 0.1 : 0;
    this.phase += dt * (speed > 0.05 ? speed * 5 : 0);
    const s = speed > 0.05 ? Math.sin(this.phase) * 0.6 : 0;
    this.legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? s : -s); });
  }
}
