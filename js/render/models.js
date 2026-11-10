import * as THREE from 'three';
import { Kit, MAT, seeded, shade } from './kit.js';
import { scannedProp } from './props3d.js';
import { factoryFacade, recessedWalls } from './architecture.js';
import { cargoLorry, staffCar, dispatchBike, fieldCar } from './coachwork.js';
import { coastalShip, cargoBarge, holdHatch, harbourLaunch, navalShip } from './marine.js';

// Model library: buildings, props, vehicles and barriers, built from textured parts.
// One tile = one metre-ish world unit; a person is about 1.4 units tall.

const FLOOR_H = 1.9;
const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];

const PLASTER_TINTS = {
  europe: ['#f4ecdc', '#efe2c4', '#e6dccd', '#f2e6cf', '#e0d4bc', '#ece8e0'],
  nordic: ['#a83a2c', '#b4452e', '#f0e6d2', '#e8e0cc'],
  desert: ['#e8d4a8', '#e0c898', '#efdcb4'],
  tropic: ['#c8b088', '#bca47c'],
  russia: ['#d8c8a8', '#ccbca0'],
  asia: ['#d8d0c0', '#c8c0b0'],
  urban: ['#e8dcc4', '#dccfb8', '#d4c8b4', '#efe6d4', '#c8bca8'],
};
const ROOF = {
  europe: [['roof_tiles', '#ffffff'], ['roof_tiles', '#d8b8a8'], ['roof_slate', '#ffffff'], ['roof_tiles', '#c8a898']],
  nordic: [['roof_slate', '#ffffff'], ['roof_tiles', '#8a7a70']],
  russia: [['roof_metal', '#a8b0a0'], ['wood_wall', '#8a7a68'], ['roof_thatch', '#c8b898']],
  urban: [['roof_slate', '#ffffff'], ['roof_tiles', '#e0c0b0']],
  desert: [['concrete', '#e8d8b8']],
  tropic: [['roof_thatch', '#ffffff']],
  asia: [['roof_tiles', '#707880'], ['roof_slate', '#ffffff']],
};

// ---------- building parts ----------
function windowAt(k, glow, x, y, z, axis, sign, r, o = {}) {
  const ww = o.ww || 0.62, wh = o.wh || 0.95, lit = r() < (o.litChance ?? 0.25);
  const frameTint = o.frame || '#e8e2d4';
  const inset = 0.05;
  const recessed=k.detailed&&k.insetWindows;
  if(recessed)(k.windowOpenings ||= []).push({axis,sign,off:axis==='x'?z:x,along:axis==='x'?x:z,y,w:ww+.035,h:wh+.025});
  if (axis === 'x') {
    k.box(ww + 0.14, 0.09, 0.12, x, y - wh / 2 - 0.05, z + sign * 0.06, '#fff', { mat: 'stone_wall', tint: '#d8d0c0' });  // sill
    k.box(ww + 0.12, 0.08, 0.06, x, y + wh / 2 + 0.04, z + sign * 0.03, '#fff', { mat: 'wood', tint: frameTint });       // lintel/frame
    k.box(0.06, wh, 0.06, x - ww / 2 - 0.03, y, z + sign * 0.03, '#fff', { mat: 'wood', tint: frameTint });
    k.box(0.06, wh, 0.06, x + ww / 2 + 0.03, y, z + sign * 0.03, '#fff', { mat: 'wood', tint: frameTint });
    k.box(ww, 0.04, 0.05, x, y + wh * 0.15, z + sign * 0.035, '#fff', { mat: 'wood', tint: frameTint });                // transom
    k.box(0.04, wh, 0.05, x, y, z + sign * 0.035, '#fff', { mat: 'wood', tint: frameTint });                            // mullion
    if(recessed) {
      k.box(ww,wh,.02,x,y,z-sign*.13,'#fff',{mat:'glass'});
      if(lit)glow.box(ww,wh,.012,x,y,z-sign*.118,'#ffd28a',{mat:'glow'});
    } else (lit ? glow : k).box(ww, wh, 0.02, x, y, z + sign * (0.01 - inset * 0.2), lit ? '#ffd28a' : '#fff', { mat: lit ? 'glow' : 'glass' });
    if (o.shutters) for (const s of [-1, 1]) k.box(ww / 2 + 0.02, wh + 0.04, 0.04, x + s * (ww * 0.75 + 0.06), y, z + sign * 0.04, '#fff', { mat: 'wood', tint: o.shutters });
  } else {
    k.box(0.12, 0.09, ww + 0.14, x + sign * 0.06, y - wh / 2 - 0.05, z, '#fff', { mat: 'stone_wall', tint: '#d8d0c0' });
    k.box(0.06, 0.08, ww + 0.12, x + sign * 0.03, y + wh / 2 + 0.04, z, '#fff', { mat: 'wood', tint: frameTint });
    k.box(0.06, wh, 0.06, x + sign * 0.03, y, z - ww / 2 - 0.03, '#fff', { mat: 'wood', tint: frameTint });
    k.box(0.06, wh, 0.06, x + sign * 0.03, y, z + ww / 2 + 0.03, '#fff', { mat: 'wood', tint: frameTint });
    k.box(0.05, 0.04, ww, x + sign * 0.035, y + wh * 0.15, z, '#fff', { mat: 'wood', tint: frameTint });
    k.box(0.05, wh, 0.04, x + sign * 0.035, y, z, '#fff', { mat: 'wood', tint: frameTint });
    if(recessed) {
      k.box(.02,wh,ww,x-sign*.13,y,z,'#fff',{mat:'glass'});
      if(lit)glow.box(.012,wh,ww,x-sign*.118,y,z,'#ffd28a',{mat:'glow'});
    } else (lit ? glow : k).box(0.02, wh, ww, x + sign * 0.01, y, z, lit ? '#ffd28a' : '#fff', { mat: lit ? 'glow' : 'glass' });
    if (o.shutters) for (const s of [-1, 1]) k.box(0.04, wh + 0.04, ww / 2 + 0.02, x + sign * 0.04, y, z + s * (ww * 0.75 + 0.06), '#fff', { mat: 'wood', tint: o.shutters });
  }
}

function facadeWindows(k, glow, t, w, d, floors, r, o = {}) {
  const side = t.side || 's';
  const doorAlong = (t.door[(side === 'n' || side === 's') ? 0 : 1] + 0.5) - ((side === 'n' || side === 's') ? t.x + w / 2 : t.y + d / 2);
  const spacing = o.spacing || 1.6;
  const faces = [['x', d / 2, 1, w, 's'], ['x', -d / 2, -1, w, 'n'], ['z', w / 2, 1, d, 'e'], ['z', -w / 2, -1, d, 'w']];
  for (const [axis, off, sign, len, name] of faces) {
    const n = Math.max(1, Math.floor((len - 0.8) / spacing));
    const start = -((n - 1) * spacing) / 2;
    for (let f = 0; f < floors; f++) {
      const y = (o.base || 0) + f * FLOOR_H + 1.2;
      for (let i = 0; i < n; i++) {
        const p = start + i * spacing;
        if (f === 0 && name === side && Math.abs(p - doorAlong) < 0.9) continue;
        if (axis === 'x') windowAt(k, glow, p, y, off, 'x', sign, r, o);
        else windowAt(k, glow, off, y, p, 'z', sign, r, o);
      }
    }
  }
  return doorAlong;
}

function door(k, t, w, d, along, o = {}) {
  const side = t.side || 's';
  const wood = o.tint || '#a08060', frame = o.frame || '#e8e2d4';
  const H = 1.45, W = 0.8;
  const place = (fn) => {
    if (side === 's') fn(along, d / 2, 'x', 1);
    if (side === 'n') fn(along, -d / 2, 'x', -1);
    if (side === 'e') fn(w / 2, along, 'z', 1);
    if (side === 'w') fn(-w / 2, along, 'z', -1);
  };
  place((x, z, axis, s) => {
    if (axis === 'x') {
      k.box(W, H, 0.06, x, H / 2 + (o.base || 0), z + s * 0.02, '#fff', { mat: 'wood', tint: wood });
      k.box(W + 0.16, 0.1, 0.1, x, H + 0.05 + (o.base || 0), z + s * 0.04, '#fff', { mat: 'wood', tint: frame });
      k.box(W + 0.4, 0.12, 0.4, x, 0.06, z + s * 0.2, '#fff', { mat: 'stone_wall', tint: '#c8c0b0' });
    } else {
      k.box(0.06, H, W, x + s * 0.02, H / 2 + (o.base || 0), z, '#fff', { mat: 'wood', tint: wood });
      k.box(0.1, 0.1, W + 0.16, x + s * 0.04, H + 0.05 + (o.base || 0), z, '#fff', { mat: 'wood', tint: frame });
      k.box(0.4, 0.12, W + 0.4, x + s * 0.2, 0.06, z, '#fff', { mat: 'stone_wall', tint: '#c8c0b0' });
    }
  });
}

function chimney(k, x, y, z, h) {
  k.box(0.42, h, 0.42, x, y + h / 2, z, '#fff', { mat: 'brick', tint: '#c8a090' });
  k.box(0.52, 0.1, 0.52, x, y + h + 0.05, z, '#fff', { mat: 'concrete', tint: '#a8a098' });
}

export function buildBuilding(t, style = 'europe', lib = null) {
  const r = seeded(t.id);
  const w = t.w, d = t.h;
  const kind = t.kind || 'house';
  const k = new Kit(), glow = new Kit();
  k.insetWindows=kind!=='hut';
  const S = PLASTER_TINTS[style] ? style : 'europe';
  const wallTint = t.color || pick(PLASTER_TINTS[S], r);
  const [roofMat, roofTint] = t.roofMat ? [t.roofMat, t.roofColor || '#ffffff'] : pick(ROOF[S] || ROOF.europe, r);
  let floors = t.floors || 1;
  let H = floors * FLOOR_H + 0.3;
  let importedFacade = null;
  const wallShells=[];
  const alongX = w >= d;
  const span = alongX ? d : w, len = alongX ? w : d, ry = alongX ? 0 : Math.PI / 2;

  const plinth = (h = 0.45) => k.box(w + 0.08, h, d + 0.08, 0, h / 2, 0, '#fff', { mat: 'stone_wall', tint: '#cfc6b6', shade: 0.3 });
  const walls = (mat, tint, h = H, base = 0) => k.detailed ? wallShells.push({mat,tint,h,base}) : k.box(w, h - base, d, 0, base + (h - base) / 2, 0, '#fff', { mat, tint, shade: 0.22 });
  const gable = (pitch, mat = roofMat, tint = roofTint, wallMat = 'plaster', wTint = wallTint) => {
    const rise = span * pitch;
    k.roof(len, span, rise, 0, H, 0, { ry, mat, tint, wallMat, wallTint: wTint, over: 0.32 });
    return rise;
  };
  const flat = (mat = 'concrete', tint = '#d0c8b8', parapet = 0.35) => {
    k.box(w + 0.12, parapet, 0.14, 0, H + parapet / 2, d / 2 - 0.02, '#fff', { mat: 'plaster', tint });
    k.box(w + 0.12, parapet, 0.14, 0, H + parapet / 2, -d / 2 + 0.02, '#fff', { mat: 'plaster', tint });
    k.box(0.14, parapet, d, w / 2 - 0.02, H + parapet / 2, 0, '#fff', { mat: 'plaster', tint });
    k.box(0.14, parapet, d, -w / 2 + 0.02, H + parapet / 2, 0, '#fff', { mat: 'plaster', tint });
    k.box(w - 0.1, 0.06, d - 0.1, 0, H + 0.03, 0, '#fff', { mat, tint: shade(tint, -0.1) });
  };

  switch (kind) {
    case 'barn': {
      H = 2.8;
      const wood = t.color || (S === 'nordic' ? '#8e3a2c' : '#7a5c42');
      k.box(w + 0.06, 0.3, d + 0.06, 0, 0.15, 0, '#fff', { mat: 'stone_wall', tint: '#b8b0a0' });
      walls('wood_wall', wood, H, 0.3);
      for (const s of [-1, 1]) for (const e of [-1, 1]) k.box(0.18, H, 0.18, s * (w / 2 - 0.05), H / 2, e * (d / 2 - 0.05), '#fff', { mat: 'wood', tint: '#e8e0d0' });
      const rise = gable(0.62, t.roofMat || 'roof_slate', t.roofColor || '#ffffff', 'wood_wall', wood);
      const along = (t.door[(t.side === 'n' || t.side === 's') ? 0 : 1] + 0.5) - ((t.side === 'n' || t.side === 's') ? t.x + w / 2 : t.y + d / 2);
      door(k, t, w, d, along, { tint: shade(wood, -0.15) });
      k.box(alongX ? 0.1 : 0.06, 0.6, alongX ? 0.06 : 0.1, 0, H + rise * 0.45, 0, '#fff', { mat: 'wood', tint: '#e8e0d0' });
      break;
    }
    case 'izba': {
      H = 2.3;
      const logT = t.color || '#c8b090';
      walls('logs', logT, H);
      for (let y = 0.15; y < H; y += 0.3) for (const s of [-1, 1]) for (const e of [-1, 1]) k.cyl(0.14, 0.14, 0.5, s * (w / 2 + 0.05), y, e * (d / 2 + 0.05), '#fff', { mat: 'logs', tint: logT, rx: Math.PI / 2, ry: s > 0 ? 0.3 : -0.3, segs: 8 });
      facadeWindows(k, glow, t, w, d, 1, r, { frame: '#e8e0c8', shutters: '#5a8aa0', litChance: 0.45, spacing: 1.8 });
      gable(0.8, t.roofMat || roofMat, roofTint, 'logs', logT);
      door(k, t, w, d, 0, { tint: '#8a6a4a' });
      chimney(k, alongX ? w * 0.2 : 0, H + span * 0.4, alongX ? 0 : d * 0.2, 1.2);
      break;
    }
    case 'barracks': {
      H = 2.2;
      k.box(w + 0.06, 0.35, d + 0.06, 0, 0.17, 0, '#fff', { mat: 'concrete', tint: '#b0a898' });
      walls('wood_wall', t.color || '#6e6654', H, 0.35);
      facadeWindows(k, glow, t, w, d, 1, r, { spacing: 1.9, litChance: 0.5, frame: '#d8d0c0', base: -0.1 });
      gable(0.3, t.roofMat || 'roof_slate', t.roofColor || '#9a9a98', 'wood_wall', t.color || '#6e6654');
      door(k, t, w, d, (t.door[(t.side === 'n' || t.side === 's') ? 0 : 1] + 0.5) - ((t.side === 'n' || t.side === 's') ? t.x + w / 2 : t.y + d / 2), { tint: '#7a6a5a' });
      for (let i = -w / 2 + 1; i < w / 2; i += 3) k.box(0.12, 0.6, 0.12, i, H + 0.1, 0, '#fff', { mat: 'metal', tint: '#606060' });
      break;
    }
    case 'church': {
      H = 4.4;
      plinth(0.6);
      walls('plaster', t.color || '#efe8da', H, 0.6);
      gable(0.75, 'roof_slate', '#ffffff', 'plaster', t.color || '#efe8da');
      const tw = Math.min(w, d) * 0.5;
      const tx = alongX ? -w / 2 + tw / 2 : 0, tz = alongX ? 0 : -d / 2 + tw / 2;
      k.box(tw, 8.2, tw, tx, 4.1, tz, '#fff', { mat: 'plaster', tint: t.color || '#efe8da', shade: 0.2 });
      k.box(tw + 0.12, 0.2, tw + 0.12, tx, 8.2, tz, '#fff', { mat: 'stone_wall', tint: '#d0c8b8' });
      k.pyramid(tw * 1.08, 4, tw * 1.08, tx, 8.3, tz, '#fff', { mat: 'roof_slate', tint: '#8aa098' });
      k.box(0.06, 0.9, 0.06, tx, 12.7, tz, '#c9b26a'); k.box(0.45, 0.06, 0.06, tx, 12.9, tz, '#c9b26a');
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
        const along = -len / 2 + (i + 1.4) * len / 4.4;
        const lit = r() < 0.3;
        if (alongX) (lit ? glow : k).box(0.55, 1.6, 0.04, along, 2.4, s * (d / 2 + 0.01), lit ? '#ffcf7a' : '#fff', { mat: lit ? 'glow' : 'glass' });
        else (lit ? glow : k).box(0.04, 1.6, 0.55, s * (w / 2 + 0.01), 2.4, along, lit ? '#ffcf7a' : '#fff', { mat: lit ? 'glow' : 'glass' });
      }
      door(k, t, w, d, 0, { tint: '#6a4a30' });
      break;
    }
    case 'warehouse': case 'factory': case 'station': {
      floors = t.floors || 2; H = floors * FLOOR_H + 0.4;
      const brick = t.color || '#f0e0d8';
      importedFacade = lib?.detailed ? factoryFacade(t,floors,H) : null;
      if(importedFacade) k.box(w-.5,H,d-.5,0,H/2,0,'#262622');
      else walls('brick', brick, H);
      k.box(w + 0.1, 0.25, d + 0.1, 0, H - 0.12, 0, '#fff', { mat: 'stone_wall', tint: '#d8d0c0' });
      if(!importedFacade) facadeWindows(k, glow, t, w, d, floors, r, { spacing: 1.9, ww: 1.1, wh: 1.15, litChance: 0.15, frame: '#5a6058' });
      if (kind === 'factory') {
        flat('concrete', '#c8c0b0');
        const n = 1 + Math.floor(r() * 2);
        for (let i = 0; i < n; i++) k.cyl(0.38, 0.5, 7, -w / 4 + i * w / 2.5, H + 3.5, -d / 4, '#fff', { mat: 'brick', tint: '#e0c8c0', segs: 12 });
      } else gable(0.28, t.roofMat || 'roof_slate', '#ffffff', 'brick', brick);
      if(!importedFacade) door(k, t, w, d, (t.door[(t.side === 'n' || t.side === 's') ? 0 : 1] + 0.5) - ((t.side === 'n' || t.side === 's') ? t.x + w / 2 : t.y + d / 2), { tint: '#6a6a60' });
      if (kind === 'station') k.box(w + 0.6, 0.08, 1.4, 0, 2.3, d / 2 + 0.65, '#fff', { mat: 'roof_metal', tint: '#888' });
      break;
    }
    case 'bunker': {
      H = 1.7;
      walls('concrete_wall', t.color || '#ffffff', H);
      k.box(w + 0.5, 0.45, d + 0.5, 0, H + 0.22, 0, '#fff', { mat: 'concrete_wall', tint: '#e8e8e8' });
      for (const s of [-1, 1]) k.box(w * 0.6, 0.16, 0.12, 0, 1.2, s * (d / 2 + 0.02), '#0e0f10');
      door(k, t, w, d, 0, { tint: '#5a5e58' });
      break;
    }
    case 'hangar': {
      const rad = Math.min(w, d) / 2;
      const g = new THREE.CylinderGeometry(rad, rad, alongX ? w : d, 18, 1, true, 0, Math.PI);
      k.add(g, '#fff', 0, 0, 0, { mat: 'roof_metal', tint: t.color || '#c8c8c0', rz: alongX ? Math.PI / 2 : 0, rx: alongX ? 0 : Math.PI / 2, shade: 0.25 });
      H = rad;
      break;
    }
    case 'hut': {
      const stilt = 0.8;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) k.cyl(0.08, 0.09, stilt, sx * (w / 2 - 0.2), stilt / 2, sz * (d / 2 - 0.2), '#fff', { mat: 'wood', tint: '#c0a888' });
      k.box(w + 0.3, 0.12, d + 0.3, 0, stilt, 0, '#fff', { mat: 'planks', tint: '#d0b890' });
      H = stilt + 1.7;
      k.box(w - 0.2, 1.7, d - 0.2, 0, stilt + 0.85, 0, '#fff', { mat: 'wood_wall', tint: t.color || '#e0c898', shade: 0.15 });
      facadeWindows(k, glow, t, w - 0.2, d - 0.2, 1, r, { base: stilt - 0.1, ww: 0.5, wh: 0.5, frame: '#8a7050', litChance: 0.35, spacing: 1.7 });
      k.roof(len + 0.4, span + 0.2, span * 0.7, 0, H, 0, { ry, mat: 'roof_thatch', over: 0.55, wallMat: 'wood_wall', wallTint: '#d0b888' });
      door(k, t, w - 0.2, d - 0.2, 0, { tint: '#8a6a4a', base: stilt });
      break;
    }
    case 'adobe': {
      H = floors * 2.1 + 0.2;
      walls('plaster_old', t.color || pick(PLASTER_TINTS.desert, r), H);
      flat('plaster', t.color || '#e8d4a8', 0.4);
      facadeWindows(k, glow, t, w, d, floors, r, { ww: 0.45, wh: 0.6, frame: '#7a5a3a', litChance: 0.25, spacing: 2 });
      for (let i = -w / 2 + 0.6; i < w / 2; i += 0.9) k.cyl(0.07, 0.07, 0.5, i, H - 0.3, d / 2 + 0.2, '#fff', { mat: 'wood', tint: '#a08060', rx: Math.PI / 2 });
      door(k, t, w, d, 0, { tint: '#6a4a2a' });
      break;
    }
    case 'apartment': {
      floors = t.floors || 3 + Math.floor(r() * 2); H = floors * FLOOR_H + 0.4;
      k.box(w + 0.06, 0.8, d + 0.06, 0, 0.4, 0, '#fff', { mat: 'stone_wall', tint: '#c8c0b0' });
      walls('plaster', wallTint, H, 0.8);
      for (let f = 1; f < floors; f++) k.box(w + 0.1, 0.1, d + 0.1, 0, f * FLOOR_H + 0.25, 0, '#fff', { mat: 'plaster', tint: shade(wallTint, 0.04) });
      k.box(w + 0.3, 0.3, d + 0.3, 0, H + 0.15, 0, '#fff', { mat: 'stone_wall', tint: '#d0c8b8' });
      facadeWindows(k, glow, t, w, d, floors, r, { spacing: 1.4, shutters: r() < 0.5 ? '#8aa088' : null, litChance: 0.3 });
      if (t.roof !== 'flat') k.pyramid(w + 0.3, 1.3, d + 0.3, 0, H + 0.3, 0, '#fff', { mat: 'roof_slate', tint: '#ffffff' });
      door(k, t, w, d, 0, { tint: '#6a4a30' });
      break;
    }
    case 'castle': {
      H = (t.floors || 3) * FLOOR_H;
      walls('stone_wall', t.color || '#ffffff', H);
      for (let i = -w / 2 + 0.3; i < w / 2; i += 0.8) for (const s of [-1, 1]) k.box(0.42, 0.55, 0.42, i, H + 0.27, s * (d / 2 - 0.2), '#fff', { mat: 'stone_wall' });
      for (let i = -d / 2 + 0.3; i < d / 2; i += 0.8) for (const s of [-1, 1]) k.box(0.42, 0.55, 0.42, s * (w / 2 - 0.2), H + 0.27, i, '#fff', { mat: 'stone_wall' });
      facadeWindows(k, glow, t, w, d, t.floors || 3, r, { ww: 0.36, wh: 0.8, spacing: 2.2, litChance: 0.4, frame: '#8a8478' });
      k.cyl(1.3, 1.4, H + 3, w / 2 - 0.9, (H + 3) / 2, -d / 2 + 0.9, '#fff', { mat: 'stone_wall', segs: 14 });
      k.cone(1.6, 2.6, w / 2 - 0.9, H + 4.3, -d / 2 + 0.9, '#fff', { mat: 'roof_slate', segs: 14 });
      door(k, t, w, d, 0, { tint: '#5a4028' });
      break;
    }
    case 'ruin': {
      const segs = [[w, 0.35, 0, -d / 2 + 0.17], [w, 0.35, 0, d / 2 - 0.17], [0.35, d, -w / 2 + 0.17, 0], [0.35, d, w / 2 - 0.17, 0]];
      const mat = t.color ? 'plaster_old' : 'brick';
      for (const [sw, sd, sx, sz] of segs) {
        const n = Math.max(2, Math.round(Math.max(sw, sd) / 0.8));
        for (let i = 0; i < n; i++) {
          const hh = 0.5 + r() * FLOOR_H * (t.floors || 2) * (r() < 0.35 ? 0.25 : 1);
          const along = -Math.max(sw, sd) / 2 + (i + 0.5) * Math.max(sw, sd) / n;
          if (sw > sd) k.box(sw / n + 0.01, hh, sd, sx + along, hh / 2, sz, '#fff', { mat, tint: t.color, shade: 0.35 });
          else k.box(sw, hh, sd / n + 0.01, sx, hh / 2, sz + along, '#fff', { mat, tint: t.color, shade: 0.35 });
        }
      }
      for (let i = 0; i < 14; i++) k.boulder(0.18 + r() * 0.3, (r() - 0.5) * w, 0.08, (r() - 0.5) * d, { mat: 'brick', tint: '#c8b0a8', seed: i, flat: 0.5 });
      for (let i = 0; i < 3; i++) k.box(0.12, 0.12, 2 + r() * 2, (r() - 0.5) * w * 0.6, 0.2 + r() * 0.5, (r() - 0.5) * d * 0.6, '#fff', { mat: 'wood', tint: '#3a3028', rx: r(), ry: r() * 3 });
      H = 1;
      break;
    }
    case 'shed': {
      H = 1.9;
      walls('wood_wall', t.color || '#7a6248', H);
      k.box(w + 0.4, 0.08, d + 0.5, 0, H + 0.15, 0, '#fff', { mat: 'roof_metal', tint: '#c0b8a8', rx: 0.08 });
      door(k, t, w, d, 0, { tint: '#8a7050' });
      break;
    }
    case 'lighthouse': {
      const rr = Math.min(w, d) * 0.4;
      k.cyl(rr * 0.8, rr, 9, 0, 4.5, 0, '#fff', { mat: 'plaster', tint: '#f4f0e8', segs: 16 });
      k.cyl(rr * 0.75, rr * 0.75, 1, 0, 9.5, 0, '#ffe8a0', { mat: 'glow' });
      k.cone(rr * 0.95, 1.1, 0, 10.6, 0, '#fff', { mat: 'roof_metal', tint: '#a04030', segs: 16 });
      H = 11;
      break;
    }
    case 'hq': case 'house': default: {
      const timber = S === 'europe' && kind === 'house' && r() < 0.35;
      plinth();
      walls(r() < 0.3 ? 'plaster_old' : 'plaster', wallTint, H, 0.45);
      if (timber) {
        const beam = '#7a5a40';
        const nb = Math.max(2, Math.round(w / 1.4));
        for (let i = 0; i <= nb; i++) for (const s of [-1, 1]) k.box(0.12, H - 0.45, 0.05, -w / 2 + i * w / nb, 0.45 + (H - 0.45) / 2, s * (d / 2 + 0.02), '#fff', { mat: 'wood', tint: beam });
        for (let f = 0; f <= floors; f++) for (const s of [-1, 1]) k.box(w + 0.04, 0.12, 0.05, 0, 0.5 + f * FLOOR_H * 0.98, s * (d / 2 + 0.025), '#fff', { mat: 'wood', tint: beam });
      }
      const doorAlong = facadeWindows(k, glow, t, w, d, floors, r, { shutters: r() < 0.6 ? pick(['#6a8a5a', '#5a7a9a', '#8a4a3a', '#7a7a70'], r) : null, litChance: kind === 'hq' ? 0.6 : 0.3 });
      if (t.roof === 'flat') flat();
      else if (t.roof === 'hip' || kind === 'hq') k.pyramid(w + 0.6, Math.min(w, d) * 0.45, d + 0.6, 0, H, 0, '#fff', { mat: roofMat, tint: roofTint });
      else {
        const rise = gable(S === 'nordic' ? 0.68 : 0.58);
        if (r() < 0.75) chimney(k, alongX ? w * 0.25 : 0, H + rise * 0.35, alongX ? 0 : d * 0.25, rise * 0.75 + 0.5);
      }
      door(k, t, w, d, doorAlong, { tint: pick(['#8a5a3a', '#5a6a4a', '#6a4a3a', '#4a5a6a'], r) });
      break;
    }
  }
  const grp = new THREE.Group();
  for(const shell of wallShells)recessedWalls(k,w,d,shell.base,shell.h,shell.mat,shell.tint);
  if(lib?.detailed && !['ruin','hut','hangar','castle','church','bunker','adobe'].includes(kind)) {
    // Roof drainage, flashing and wall anchors give the clean masses human scale.
    // All pieces hug the authored building; no new obstacle is added to a lane.
    for(const side of [-1,1]) {
      if(alongX) k.cyl(.055,.055,w+.38,0,H-.02,side*(d/2+.22),'#fff',{mat:'metal',tint:'#64685f',rz:Math.PI/2,segs:8});
      else k.cyl(.055,.055,d+.38,side*(w/2+.22),H-.02,0,'#fff',{mat:'metal',tint:'#64685f',rx:Math.PI/2,segs:8});
      const px=side*(w/2-.16),pz=side*(d/2+.045);
      k.cyl(.045,.045,H-.25,px,H/2+.05,pz,'#fff',{mat:'metal',tint:'#666a60',segs:8});
      for(let y=.5;y<H;y+=1.1) k.box(.14,.045,.07,px,y,pz,'#fff',{mat:'metal',tint:'#4a4d48'});
    }
  }
  grp.add(k.mesh(lib));
  if(importedFacade)grp.add(importedFacade);
  if (glow.parts.length) { const gm = glow.mesh(lib, () => MAT.glow); gm.castShadow = false; gm.userData.windows = true; grp.add(gm); }
  grp.userData.height = H;
  return grp;
}

// ---------- props & vehicles ----------
const wheel = (k, x, y, z, r = 0.34, w = 0.22) => {
  k.cyl(r, r, w, x, y, z, '#1e1e1e', { rz: Math.PI / 2, segs: 14 });
  k.cyl(r * 0.5, r * 0.5, w + 0.02, x, y, z, '#fff', { mat: 'metal', tint: '#6a6e60', rz: Math.PI / 2, segs: 10 });
};
const VEH = { field: '#6a6e58', grey: '#5c6268', sand: '#b8a678', olive: '#5e6440', dark: '#46483f' };

const PROP_BUILDERS = {
  crate(k) { k.box(0.8, 0.7, 0.8, 0, 0.35, 0, '#fff', { mat: 'wood', tint: '#d8c098', shade: 0.3 }); for (const s of [-1, 1]) k.box(0.84, 0.08, 0.84, 0, 0.35 + s * 0.28, 0, '#fff', { mat: 'wood', tint: '#a88a60' }); },
  crates(k) { PROP_BUILDERS.crate(k); k.box(0.8, 0.7, 0.8, 0.9, 0.35, 0.05, '#fff', { mat: 'wood', tint: '#c8b088', ry: 0.1 }); k.box(0.75, 0.6, 0.75, 0.45, 1.0, 0, '#fff', { mat: 'wood', tint: '#e0c8a0', ry: -0.2 }); },
  barrel(k) { k.cyl(0.3, 0.3, 0.85, 0, 0.42, 0, '#fff', { mat: 'metal', tint: VEH.olive, segs: 14 }); for (const y of [0.15, 0.7]) k.cyl(0.31, 0.31, 0.04, 0, y, 0, '#fff', { mat: 'metal', tint: '#606458', segs: 14 }); },
  fuel(k) { for (let i = 0; i < 6; i++) k.cyl(0.28, 0.28, 0.85, -0.6 + (i % 3) * 0.6, 0.42, -0.35 + Math.floor(i / 3) * 0.7, '#fff', { mat: 'metal', tint: i % 2 ? '#a08860' : '#9a9a70', segs: 14 }); k.cyl(0.28, 0.28, 0.85, 0, 1.25, 0, '#fff', { mat: 'metal', tint: '#a08860', segs: 14, rz: Math.PI / 2 }); },
  fueltank(k) { k.cyl(1.35, 1.35, 2.2, 0, 1.1, 0, '#fff', { mat: 'metal', tint: '#c8c8c0', segs: 24 }); k.cyl(1.38, 1.3, 0.3, 0, 2.35, 0, '#fff', { mat: 'metal', tint: '#a8a8a0', segs: 24 }); for (let i = 0; i < 8; i++) k.box(0.05, 2.2, 0.05, Math.cos(i) * 1.37, 1.1, Math.sin(i) * 1.37, '#5a5a52'); },
  ammo(k) { for (let i = 0; i < 4; i++) k.box(0.45, 0.3, 0.8, -0.6 + i * 0.4, 0.15 + (i % 2) * 0.3, 0, '#fff', { mat: 'wood', tint: '#9aa070' }); },
  truck(k, t) {
    if(k.detailed)return cargoLorry(k,t);
    const c = t.color || VEH.field;
    for (const [x, z] of [[-0.78, -1.3], [0.78, -1.3], [-0.78, 1.05], [0.78, 1.05]]) wheel(k, x, 0.36, z);
    k.box(1.6, 0.25, 3.8, 0, 0.62, 0, '#2a2a26');
    k.box(1.5, 0.7, 0.95, 0, 1.08, 1.45, '#fff', { mat: 'metal', tint: c });
    k.box(1.72, 0.95, 0.95, 0, 1.45, 0.72, '#fff', { mat: 'metal', tint: c });
    k.box(1.5, 0.36, 0.04, 0, 1.68, 1.2, '#fff', { mat: 'glass' });
    for (const s of [-1, 1]) k.box(0.32, 0.12, 0.85, s * 0.82, 0.9, 1.4, '#fff', { mat: 'metal', tint: shade(c, -0.1), rz: s * 0.15 });
    k.box(1.8, 0.45, 2.3, 0, 0.97, -0.85, '#fff', { mat: 'wood', tint: '#b0a080' });
    k.box(1.8, 0.85, 2.3, 0, 1.62, -0.85, '#fff', { mat: 'canvas', tint: '#7e7a5c' });
    k.cyl(0.9, 0.9, 2.3, 0, 2.02, -0.85, '#fff', { mat: 'canvas', tint: '#7e7a5c', rx: Math.PI / 2, segs: 14, sy: 1, sz: 0.38 });
    for (const s of [-0.38, 0.38]) k.box(0.18, 0.12, 0.04, s, 1.0, 1.93, '#d8d0b0');
    if(!k.detailed) return;
    // Period cargo-lorry details: recessed radiator, slats, bumpers, split windscreen,
    // side glazing, running boards, bonnet vents and tie-downs. Same footprint.
    k.box(1.02,.5,.045,0,1.08,1.94,'#252922');
    for(let i=-4;i<=4;i++) k.box(.035,.48,.035,i*.105,1.08,1.975,'#fff',{mat:'metal',tint:shade(c,-.1)});
    k.box(1.85,.12,.15,0,.66,2.02,'#fff',{mat:'metal',tint:shade(c,-.1)});
    k.box(.055,.4,.05,0,1.69,1.23,'#fff',{mat:'metal',tint:c});
    for(const s of [-1,1]) {
      k.box(.035,.34,.58,s*.869,1.69,.72,'#fff',{mat:'glass'});
      k.box(.28,.09,1.02,s*.87,.64,.55,'#fff',{mat:'metal',tint:shade(c,-.12)});
      k.box(.035,.035,.18,s*.88,1.35,.55,'#fff',{mat:'metal',tint:'#8c9089'});
      for(let j=0;j<5;j++) k.box(.025,.16,.025,s*.76,1.22,1.25+j*.11,'#30382c');
      for(let j=0;j<5;j++) k.box(.025,.6,.025,s*.915,1.37,-1.8+j*.44,'#fff',{mat:'canvas',tint:'#4e5142'});
    }
  },
  car(k, t) {
    if(k.detailed)return staffCar(k,t);
    const c = t.color || '#22262a';
    for (const [x, z] of [[-0.72, -0.95], [0.72, -0.95], [-0.72, 0.95], [0.72, 0.95]]) wheel(k, x, 0.32, z, 0.32, 0.2);
    k.box(1.42, 0.45, 2.8, 0, 0.62, 0, '#fff', { mat: 'metal', tint: c });
    k.capsule(0.62, 0.9, 0, 1.0, -0.2, '#fff', { mat: 'metal', tint: c, rx: Math.PI / 2, sx: 1.05, sy: 1, sz: 0.62 });
    k.box(1.3, 0.3, 1.0, 0, 1.12, -0.2, '#fff', { mat: 'glass' });
    for (const s of [-1, 1]) k.capsule(0.22, 0.7, s * 0.75, 0.6, 1.0, '#fff', { mat: 'metal', tint: c, rx: Math.PI / 2 });
    for (const s of [-0.45, 0.45]) k.cyl(0.12, 0.12, 0.06, s, 0.75, 1.42, '#e8e0b0', { rx: Math.PI / 2 });
    if(!k.detailed) return;
    k.box(.55,.38,.035,0,.69,1.43,'#1a1c1b');
    for(let i=-3;i<=3;i++) k.box(.022,.35,.025,i*.072,.69,1.46,'#fff',{mat:'metal',tint:'#9b9e98'});
    for(const z of [-1.45,1.48]) k.box(1.5,.075,.1,0,.43,z,'#fff',{mat:'metal',tint:'#8a8f87'});
    for(const s of [-1,1]) {
      k.box(.035,.33,.055,s*.66,1.12,-.18,'#fff',{mat:'metal',tint:c});
      k.box(.025,.035,.15,s*.71,.92,-.05,'#fff',{mat:'metal',tint:'#a0a39c'});
      k.box(.17,.07,1.18,s*.76,.38,-.04,'#fff',{mat:'metal',tint:'#353b35'});
    }
  },
  wreck(k) { PROP_BUILDERS.car(k, { color: '#3a3430' }); for (let i = 0; i < 4; i++) k.boulder(0.2, -0.6 + i * 0.4, 0.1, 1.5, { mat: 'dirt', seed: i }); },
  kubel(k, t) {
    if(k.detailed)return fieldCar(k,t);
    const c = t.color || VEH.field;
    for (const [x, z] of [[-0.7, -0.9], [0.7, -0.9], [-0.7, 0.9], [0.7, 0.9]]) wheel(k, x, 0.32, z, 0.32, 0.2);
    k.box(1.42, 0.55, 2.7, 0, 0.76, 0, '#fff', { mat: 'metal', tint: c });
    k.box(1.3, 0.05, 0.05, 0, 1.3, 0.42, '#30332c'); k.box(1.3, 0.42, 0.03, 0, 1.08, 0.44, '#fff', { mat: 'glass' });
    k.cyl(0.3, 0.3, 0.16, 0, 1.12, 1.15, '#1e1e1e', { rx: 0.3 });
    k.box(1.2, 0.3, 0.6, 0, 1.05, -0.3, '#fff', { mat: 'canvas', tint: '#8a8070' }); k.box(1.2, 0.3, 0.5, 0, 1.05, -0.95, '#fff', { mat: 'canvas', tint: '#8a8070' });
  },
  motorcycle(k) { if(k.detailed)return dispatchBike(k); wheel(k, 0, 0.3, 0.6, 0.3, 0.1); wheel(k, 0, 0.3, -0.6, 0.3, 0.1); k.box(0.3, 0.35, 1.0, 0, 0.65, 0, '#fff', { mat: 'metal', tint: VEH.field }); k.capsule(0.32, 0.5, 0.55, 0.55, -0.1, '#fff', { mat: 'metal', tint: VEH.field, rx: Math.PI / 2 }); wheel(k, 0.75, 0.26, -0.1, 0.26, 0.1); },
  tank(k, t) {
    const c = t.color || VEH.grey;
    for (const sx of [-1.2, 1.2]) {
      k.box(0.55, 0.8, 3.9, sx, 0.45, 0, '#fff', { mat: 'metal', tint: '#504e48' });
      for (let i = 0; i < 6; i++) k.cyl(0.25, 0.25, 0.58, sx, 0.32, -1.6 + i * 0.64, '#fff', { mat: 'metal', tint: '#6a6a60', rz: Math.PI / 2, segs: 12 });
    }
    k.box(1.95, 0.7, 3.6, 0, 1.0, 0, '#fff', { mat: 'metal', tint: c });
    k.box(1.95, 0.4, 0.8, 0, 1.0, 1.95, '#fff', { mat: 'metal', tint: c, rx: 0.5 });
    k.box(2.65, 0.06, 3.8, 0, 0.9, 0, '#fff', { mat: 'metal', tint: shade(c, -0.08) });
    k.box(1.5, 0.65, 1.7, 0, 1.68, -0.2, '#fff', { mat: 'metal', tint: c });
    k.cyl(0.08, 0.11, 2.1, 0, 1.72, 1.65, '#fff', { mat: 'metal', tint: '#5a5c54', rx: Math.PI / 2, segs: 10 });
    k.cyl(0.26, 0.29, 0.32, -0.35, 2.12, -0.6, '#fff', { mat: 'metal', tint: c, segs: 12 });
  },
  dummytank(k) { PROP_BUILDERS.tank(k, { color: '#c8c098' }); },
  halftrack(k, t) {
    const c = t.color || VEH.grey;
    wheel(k, -0.75, 0.36, 1.25, 0.36, 0.2); wheel(k, 0.75, 0.36, 1.25, 0.36, 0.2);
    for (const sx of [-0.8, 0.8]) k.box(0.4, 0.65, 2.2, sx, 0.4, -0.7, '#fff', { mat: 'metal', tint: '#504e48' });
    k.box(1.8, 0.9, 3.6, 0, 1.15, -0.1, '#fff', { mat: 'metal', tint: c });
    k.box(1.5, 0.5, 1.0, 0, 1.0, 1.6, '#fff', { mat: 'metal', tint: c, rx: -0.35 });
    k.box(1.6, 0.62, 2.4, 0, 1.42, -0.6, '#2e302a');
  },
  gun(k) {
    wheel(k, -0.7, 0.42, 0, 0.42, 0.14); wheel(k, 0.7, 0.42, 0, 0.42, 0.14);
    k.box(1.6, 0.9, 0.06, 0, 0.9, 0.25, '#fff', { mat: 'metal', tint: VEH.field, rx: -0.1 });
    k.cyl(0.07, 0.09, 2.2, 0, 0.9, 1.1, '#fff', { mat: 'metal', tint: '#5a5c54', rx: Math.PI / 2 });
    k.box(0.15, 0.12, 1.6, -0.3, 0.25, -0.9, '#fff', { mat: 'metal', tint: VEH.field, ry: 0.2 }); k.box(0.15, 0.12, 1.6, 0.3, 0.25, -0.9, '#fff', { mat: 'metal', tint: VEH.field, ry: -0.2 });
  },
  coastgun(k) {
    k.cyl(1.5, 1.65, 0.9, 0, 0.45, 0, '#fff', { mat: 'concrete_wall', segs: 20 });
    k.cyl(0.6, 0.7, 0.8, 0, 1.2, 0, '#fff', { mat: 'metal', tint: VEH.grey, segs: 14 });
    k.box(1.15, 0.75, 1.35, 0, 1.6, 0, '#fff', { mat: 'metal', tint: VEH.grey });
    k.cyl(0.14, 0.19, 3.1, 0, 1.75, 1.95, '#fff', { mat: 'metal', tint: '#6a6c64', rx: Math.PI / 2 - 0.12, segs: 12 });
  },
  aagun(k) {
    k.box(2.0, 0.12, 0.3, 0, 0.15, 0, '#fff', { mat: 'metal', tint: VEH.grey }); k.box(0.3, 0.12, 2.0, 0, 0.15, 0, '#fff', { mat: 'metal', tint: VEH.grey });
    k.cyl(0.3, 0.35, 0.6, 0, 0.5, 0, '#fff', { mat: 'metal', tint: VEH.grey });
    k.box(0.8, 0.6, 0.06, 0, 1.0, 0.25, '#fff', { mat: 'metal', tint: VEH.grey });
    k.cyl(0.04, 0.05, 1.6, 0, 1.4, 0.7, '#3a3c34', { rx: Math.PI / 2 - 0.7 });
  },
  mgnest(k) {
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 1.6 + 2.3;
      for (let row = 0; row < 3; row++) k.capsule(0.15, 0.32, Math.cos(a + row * 0.1) * 0.9, 0.15 + row * 0.24, Math.sin(a + row * 0.1) * 0.9, '#fff', { mat: 'burlap', tint: row % 2 ? '#a89a7c' : '#9a8c70', rz: Math.PI / 2, ry: -a, sz: 0.7, sx: 0.62 });
    }
    k.cyl(0.03, 0.03, 1.0, 0, 0.65, 0.6, '#2a2a28', { rx: Math.PI / 2 });
  },
  tent(k, t) {
    k.roof(2.8, 1.9, 1.5, 0, 0, 0, { mat: 'canvas', tint: t.color || '#8f8a68', over: 0.05, thick: 0.02, wallMat: 'canvas', wallTint: shade(t.color || '#8f8a68', -0.06) });
    k.box(0.04, 0.9, 0.5, 1.42, 0.45, 0, '#2a2822');
    for (const s of [-1, 1]) k.cyl(0.03, 0.03, 1.6, s * 1.45, 0.8, 0, '#fff', { mat: 'wood' });
  },
  tower(k) {
    const legH = 2.6;
    for (const [x, z] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]) k.box(0.13, legH + 1.1, 0.13, x, (legH + 1.1) / 2, z, '#fff', { mat: 'wood', tint: '#c0a888', rx: z * 0.03, rz: -x * 0.03 });
    for (const y of [0.9, 1.9]) { k.box(1.5, 0.08, 0.06, 0, y, 0.76, '#fff', { mat: 'wood', rz: 0.6 }); k.box(1.5, 0.08, 0.06, 0, y, -0.76, '#fff', { mat: 'wood', rz: -0.6 }); }
    k.box(1.9, 0.12, 1.9, 0, legH, 0, '#fff', { mat: 'planks' });
    for (const s of [-1, 1]) { k.box(1.9, 0.62, 0.06, 0, legH + 0.36, s * 0.93, '#fff', { mat: 'wood_wall' }); k.box(0.06, 0.62, 1.9, s * 0.93, legH + 0.36, 0, '#fff', { mat: 'wood_wall' }); }
    k.pyramid(2.35, 0.72, 2.35, 0, legH + 1.62, 0, '#fff', { mat: 'roof_metal', tint: '#b0a898' });
    k.box(0.08, 2.5, 0.08, 0.95, 1.25, 0.3, '#fff', { mat: 'wood', rz: 0.35 });
  },
  lamppost(k) { k.cyl(0.05, 0.08, 2.7, 0, 1.35, 0, '#2a2a2a'); k.cyl(0.18, 0.12, 0.3, 0, 2.75, 0, '#2a2a2a'); k.sphere(0.1, 0, 2.62, 0, '#ffe0a0', { mat: 'glow' }); },
  campfire(k) { for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28; k.cyl(0.05, 0.06, 0.7, Math.cos(a) * 0.15, 0.12, Math.sin(a) * 0.15, '#fff', { mat: 'bark_oak', rx: Math.sin(a) * 1.2, rz: -Math.cos(a) * 1.2 }); } for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; k.boulder(0.12, Math.cos(a) * 0.48, 0.06, Math.sin(a) * 0.48, { seed: i, mat: 'rock' }); } },
  // Pedestal, yoke and drum; the lens faces +z (the renderer turns the whole lamp with its beam).
  searchlight(k) {
    const M = { mat: 'metal', tint: '#4e5358' }, tilt = Math.PI / 2 + 0.12;
    k.cyl(0.3, 0.38, 0.16, 0, 0.08, 0, '#fff', { ...M, segs: 12 });
    k.cyl(0.07, 0.09, 0.62, 0, 0.47, 0, '#fff', M);
    k.box(0.74, 0.06, 0.12, 0, 0.8, 0, '#fff', M);
    for (const s of [-1, 1]) k.box(0.06, 0.4, 0.12, s * 0.37, 0.98, 0, '#fff', M);
    k.cyl(0.3, 0.3, 0.62, 0, 1.12, 0, '#fff', { mat: 'metal', tint: VEH.grey, rx: tilt, segs: 18 });
    k.cyl(0.18, 0.26, 0.14, 0, 1.16, -0.36, '#fff', { ...M, rx: tilt, segs: 14 });
    k.cyl(0.34, 0.34, 0.08, 0, 1.08, 0.31, '#fff', { mat: 'metal', tint: '#3a3e42', rx: tilt, segs: 18 });
    k.cyl(0.28, 0.28, 0.02, 0, 1.075, 0.35, '#ffffff', { mat: 'glow', rx: tilt, segs: 18 });
  },
  haystack(k) { k.sphere(1.0, 0, 0.78, 0, '#fff', { mat: 'roof_thatch', tint: '#e8d8a0', sy: 1.1 }); k.cone(0.72, 0.65, 0, 1.78, 0, '#fff', { mat: 'roof_thatch', tint: '#d8c890' }); },
  cart(k) { for (const x of [-0.5, 0.5]) k.torus(0.38, 0.05, x, 0.4, 0, '#fff', { mat: 'wood', ry: Math.PI / 2, segs: 16 }); k.box(0.9, 0.3, 1.6, 0, 0.72, 0, '#fff', { mat: 'planks' }); for (const x of [-0.3, 0.3]) k.box(0.06, 0.06, 1.2, x, 0.6, 1.2, '#fff', { mat: 'wood' }); },
  well(k) { k.cyl(0.48, 0.52, 0.72, 0, 0.36, 0, '#fff', { mat: 'stone_wall', segs: 14 }); for (const x of [-0.42, 0.42]) k.box(0.09, 1.25, 0.09, x, 1.0, 0, '#fff', { mat: 'wood' }); k.roof(1.1, 0.9, 0.4, 0, 1.6, 0, { mat: 'roof_tiles', over: 0.08, thick: 0.03 }); },
  rocks(k, t) { const r = seeded(t.id || 'r'); k.boulder(0.95, -0.2, 0.45, 0, { seed: r() * 9 }); k.boulder(0.6, 0.65, 0.3, 0.45, { seed: r() * 9 }); k.boulder(0.5, 0.3, 0.25, -0.65, { seed: r() * 9 }); },
  rock(k, t) { k.boulder(0.48, 0, 0.22, 0, { seed: seeded(t.id || 'r')() * 9 }); },
  log(k) { k.cyl(0.21, 0.24, 2.8, 0, 0.22, 0, '#fff', { mat: 'bark_pine', rz: Math.PI / 2, segs: 12 }); for (const s of [-1, 1]) k.cyl(0.2, 0.2, 0.02, s * 1.4, 0.22, 0, '#c8a878', { rz: Math.PI / 2, segs: 12 }); },
  woodpile(k) { for (let i = 0; i < 9; i++) k.cyl(0.13, 0.13, 1.6, 0, 0.13 + Math.floor(i / 4) * 0.22, -0.4 + (i % 4) * 0.27 + (Math.floor(i / 4) % 2) * 0.13, '#fff', { mat: 'bark_oak', rz: Math.PI / 2, segs: 8 }); },
  stump(k) { k.cyl(0.26, 0.32, 0.42, 0, 0.21, 0, '#fff', { mat: 'bark_oak', segs: 12 }); k.cyl(0.25, 0.25, 0.02, 0, 0.43, 0, '#c8a878', { segs: 12 }); },
  plane(k, t) {
    const c = t.color || '#8a9478';
    k.capsule(0.36, 3.6, 0, 1.0, 0, '#fff', { mat: 'metal', tint: c, rx: Math.PI / 2, segs: 12 });
    k.box(4.8, 0.08, 1.0, 0, 0.85, 0.5, '#fff', { mat: 'metal', tint: c });
    k.box(1.6, 0.06, 0.55, 0, 1.05, -1.95, '#fff', { mat: 'metal', tint: c });
    k.box(0.06, 0.7, 0.62, 0, 1.38, -1.95, '#fff', { mat: 'metal', tint: c });
    k.capsule(0.22, 0.5, 0, 1.38, 0.35, '#fff', { mat: 'glass', rx: Math.PI / 2 });
    k.box(0.06, 1.0, 0.1, 0, 1.0, 2.45, '#2a2a28');
    wheel(k, -0.6, 0.25, 1.0, 0.22, 0.1); wheel(k, 0.6, 0.25, 1.0, 0.22, 0.1);
  },
  bomber(k, t) {
    const c = t.color || '#8a9478';
    k.capsule(0.58, 5.6, 0, 1.3, 0, '#fff', { mat: 'metal', tint: c, rx: Math.PI / 2, segs: 12 });
    k.box(9, 0.12, 1.5, 0, 1.15, 0.6, '#fff', { mat: 'metal', tint: c });
    for (const x of [-2.4, 2.4]) { k.capsule(0.3, 0.9, x, 1.1, 1.0, '#fff', { mat: 'metal', tint: shade(c, -0.08), rx: Math.PI / 2 }); k.box(0.05, 1.3, 0.08, x, 1.1, 1.75, '#2a2a28'); }
    k.box(2.8, 0.08, 0.8, 0, 1.5, -2.9, '#fff', { mat: 'metal', tint: c }); k.box(0.08, 1.1, 0.9, 0, 2.0, -2.9, '#fff', { mat: 'metal', tint: c });
    k.capsule(0.3, 0.6, 0, 1.75, 2.2, '#fff', { mat: 'glass', rx: Math.PI / 2 });
    wheel(k, -1.4, 0.36, 0.9, 0.36, 0.14); wheel(k, 1.4, 0.36, 0.9, 0.36, 0.14);
  },
  boat(k, t) {
    if(k.detailed)return harbourLaunch(k,t);
    const c = t.color || '#8a8e90';
    k.extrude([[-0.8, -1.8], [0.8, -1.8], [0.8, 1.2], [0, 2.0], [-0.8, 1.2]], 0.7, -0.2, '#fff', { mat: 'metal', tint: c });
    k.box(1.4, 0.05, 3.2, 0, 0.52, -0.1, '#fff', { mat: 'planks' });
    k.box(0.9, 0.6, 1.0, 0, 0.82, -0.5, '#fff', { mat: 'wood_wall', tint: '#e0e0d8' });
  },
  jeep(k, t) {
    // An SAS-style raiding jeep: open body, twin Vickers guns, sand channels and jerrycans.
    const c = t.color || '#b8a678';
    for (const [x, z] of [[-0.68, -0.85], [0.68, -0.85], [-0.68, 0.85], [0.68, 0.85]]) wheel(k, x, 0.32, z, 0.32, 0.2);
    k.box(1.36, 0.45, 2.6, 0, 0.7, 0, '#fff', { mat: 'metal', tint: c });
    k.box(1.2, 0.3, 0.9, 0, 0.95, 0.85, '#fff', { mat: 'metal', tint: c, rx: -0.12 });
    k.box(1.3, 0.04, 0.04, 0, 1.35, 0.35, '#2a2a28'); k.box(1.24, 0.4, 0.03, 0, 1.12, 0.37, '#fff', { mat: 'glass' });
    for (const x of [-0.3, 0.3]) { k.box(0.06, 0.08, 0.7, x, 1.2, 0.7, '#2a2a28'); k.cyl(0.07, 0.07, 0.06, x, 1.28, 0.55, '#2a2a28'); }
    k.box(0.08, 0.1, 0.8, 0.25, 1.25, -0.9, '#2a2a28');
    for (const x of [-0.45, 0.45]) k.box(0.36, 0.42, 0.14, x, 1.0, -1.25, '#fff', { mat: 'metal', tint: '#5a6040' });
    k.box(0.3, 0.06, 1.6, -0.75, 0.75, 0, '#fff', { mat: 'metal', tint: '#6a6458', rz: 0.4 });
  },
  canoe(k) {
    // A two-man folding canoe (folbot): rubberised canvas hull, cockpit, paddles.
    k.capsule(0.32, 4.0, 0, 0.12, 0, '#fff', { mat: 'canvas', tint: '#4a4c3c', rx: Math.PI / 2, sx: 1, sy: 0.55, sz: 1 });
    k.box(0.5, 0.06, 2.0, 0, 0.3, 0, '#2a2a24');
    for (const z of [-0.55, 0.55]) k.box(0.05, 0.05, 2.1, 0, 0.42, z, '#fff', { mat: 'wood', rx: 0.2, ry: 1.2 });
  },
  fishingboat(k, t) {
    // A Danish wooden fishing cutter: deep hull, wheelhouse, mast.
    const c = t.color || '#e8e2d4';
    k.extrude([[-1.3, -3.2], [1.3, -3.2], [1.4, 1.6], [0, 3.6], [-1.4, 1.6]], 1.4, -0.6, '#fff', { mat: 'wood_wall', tint: c });
    k.box(2.4, 0.08, 5.6, 0, 0.82, 0, '#fff', { mat: 'planks' });
    k.box(1.1, 1.0, 1.2, 0, 1.35, -1.6, '#fff', { mat: 'wood_wall', tint: '#8a3a2c' });
    k.box(1.3, 0.1, 1.4, 0, 1.9, -1.6, '#fff', { mat: 'roof_metal', tint: '#6a6a66' });
    k.cyl(0.07, 0.09, 4.5, 0, 3.0, 0.8, '#fff', { mat: 'wood' });
    k.box(0.04, 0.04, 2.2, 0, 3.6, 0.2, '#fff', { mat: 'wood', rx: 0.5 });
    for (const z of [-0.4, 0.6]) k.box(0.7, 0.35, 0.5, 0.55, 1.0, z, '#fff', { mat: 'wood', tint: '#8a7050' });
  },
  rubberboat(k) { k.torus(0.9, 0.22, 0, 0.2, 0, '#2f332e', { rx: Math.PI / 2, sx: 0.75, sy: 1.3 }); k.box(1.0, 0.05, 1.8, 0, 0.1, 0, '#3a3e38'); },
  barge(k,t) {
    if(k.detailed)return t.interact?.kind==='hatch'?holdHatch(k,t):cargoBarge(k,t);
    k.box(2.8, 1.0, 6.8, 0, 0.3, 0, '#fff', { mat: 'metal', tint: '#8a8680' });
    k.box(2.4, 0.1, 6.0, 0, 0.82, 0, '#fff', { mat: 'planks', tint: '#8a8070' });
    k.box(2.8, 1.4, 0.3, 0, 0.6, 3.3, '#fff', { mat: 'metal', tint: '#8a8680', rx: 0.5 });
  },
  // Hull lengths follow the footprint: along z (north-south) unrotated; with rot 1 or 3 the
  // footprint is wide, and the scene turns the model a quarter, so length comes from w.
  ship(k, t) {
    if(k.detailed)return coastalShip(k,t);
    const c = t.color || '#8a9094';
    const side = (t.rot || 0) % 2 === 1;
    const L = (side ? t.w : t.h) || 22, B = (side ? t.h : t.w) || 6;
    k.extrude([[-B / 2, -L / 2], [B / 2, -L / 2], [B / 2, L / 2 - 4], [0, L / 2], [-B / 2, L / 2 - 4]], 2.6, -1.2, '#fff', { mat: 'metal', tint: c });
    k.box(B - 0.2, 0.1, L - 4, 0, 1.42, -1.5, '#fff', { mat: 'planks', tint: '#b0a088' });
    k.box(B * 0.7, 2.2, 4.5, 0, 2.5, -L * 0.12, '#fff', { mat: 'metal', tint: shade(c, 0.12) });
    k.box(B * 0.55, 1.2, 3.2, 0, 4.2, -L * 0.12, '#fff', { mat: 'metal', tint: shade(c, 0.18) });
    k.cyl(0.62, 0.72, 2.6, 0, 5.2, -L * 0.25, '#fff', { mat: 'metal', tint: '#4a4a4a', segs: 14 });
    k.cyl(0.1, 0.14, 7, 0, 4.9, L * 0.25, '#fff', { mat: 'wood' }); k.cyl(0.1, 0.14, 6, 0, 4.4, -L * 0.38, '#fff', { mat: 'wood' });
    for (let i = 0; i < 3; i++) k.box(B * 0.6, 0.15, 1.6, 0, 1.55, L * 0.08 + i * 2.4 - 1, '#fff', { mat: 'canvas', tint: '#7a7868' });
  },
  // A heap of coal (or, with a color, ore, gravel or sand): a lumpy mound of tinted boulders.
  coal(k, t) {
    const r = seeded(t.id || 'coal'), W = (t.w || 3) / 2, D = (t.h || 3) / 2, tint = t.color || '#2a2826';
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r());
      const x = Math.cos(a) * d * W * 0.85, z = Math.sin(a) * d * D * 0.85, hgt = (1 - d * d) * 1.3;
      k.boulder(0.45 + r() * 0.35, x, hgt * 0.8, z, { mat: 'rock', tint, seed: i + 1, flat: 0.6 });
    }
  },
  // Straight track: sleepers and two rails along z (rot 1|3 for east-west); length from footprint.
  railtrack(k, t) {
    const side = (t.rot || 0) % 2 === 1, L = (side ? t.w : t.h) || 4;
    for (let z = -L / 2 + 0.3; z < L / 2; z += 0.6) k.box(1.5, 0.1, 0.22, 0, 0.05, z, '#fff', { mat: 'wood', tint: '#4a3a2c' });
    for (const x of [-0.45, 0.45]) k.box(0.07, 0.1, L, x, 0.15, 0, '#fff', { mat: 'metal', tint: '#6a6560' });
  },
  // A steel lattice pylon carrying power lines: four splayed legs, cross-bracing, arms.
  pylon(k) {
    const M = { mat: 'metal', tint: '#7a7c78' }, H = 9;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.08, H, 0.08, sx * 0.45, H / 2, sz * 0.45, '#fff', { ...M, rx: -sz * 0.07, rz: sx * 0.07 });
    for (let y = 1; y < H - 0.5; y += 1.4) {
      const w = 0.9 + 1.2 * (1 - y / H) * 0.6;
      for (const s of [-1, 1]) { k.box(w, 0.05, 0.05, 0, y, s * w / 2, '#fff', M); k.box(0.05, 0.05, w, s * w / 2, y, 0, '#fff', M); k.box(0.04, 1.6, 0.04, 0, y + 0.7, s * w / 2, '#fff', { ...M, rz: 0.7 }); }
    }
    for (const y of [H - 2.2, H - 0.8]) k.box(4.2, 0.12, 0.12, 0, y, 0, '#fff', M);
    for (const x of [-2, 2]) for (const y of [H - 2.5, H - 1.1]) k.cyl(0.05, 0.05, 0.35, x, y, 0, '#fff', { mat: 'plain', tint: '#d8d4c8' });
  },
  // A capital ship (the Graf Spee, a cruiser): grey hull with a flared bow and a dark boot-top,
  // triple turrets fore and aft, a tower mast, one funnel, an aft mast and secondary guns.
  // Sized from its footprint like the ship; bow towards +z before rotation.
  warship(k, t) {
    const c = t.color || '#7b8187';
    const side = (t.rot || 0) % 2 === 1;
    const L = (side ? t.w : t.h) || 34, B = (side ? t.h : t.w) || 8;
    const M = { mat: 'metal', tint: c }, D = { mat: 'metal', tint: shade(c, -0.12) }, Lt = { mat: 'metal', tint: shade(c, 0.08) };
    const hb = B / 2;
    const outline = (sx, sz) => [
      [-hb * 0.78 * sx, -L / 2 * sz], [hb * 0.78 * sx, -L / 2 * sz], [hb * 0.97 * sx, (-L / 2 + L * 0.1) * sz], [hb * sx, (-L / 2 + L * 0.2) * sz],
      [hb * sx, (L / 2 - L * 0.3) * sz], [hb * 0.88 * sx, (L / 2 - L * 0.17) * sz], [hb * 0.56 * sx, (L / 2 - L * 0.07) * sz], [0, L / 2 * sz],
      [-hb * 0.56 * sx, (L / 2 - L * 0.07) * sz], [-hb * 0.88 * sx, (L / 2 - L * 0.17) * sz], [-hb * sx, (L / 2 - L * 0.3) * sz],
      [-hb * sx, (-L / 2 + L * 0.2) * sz], [-hb * 0.97 * sx, (-L / 2 + L * 0.1) * sz],
    ];
    const deckY = 1.7;
    k.extrude(outline(1, 1), 3.1, -1.4, '#fff', M);                                   // hull
    k.extrude(outline(1.012, 1.004), 0.32, -0.28, '#26292c', { mat: 'metal', tint: '#2e3134' }); // boot-topping at the waterline
    k.extrude(outline(0.95, 0.97), 0.06, deckY - 0.02, '#fff', { mat: 'planks', tint: '#a0978a' });
    // Main turrets: barbette, armoured house, three long guns.
    const turret = (z, dir) => {
      k.cyl(B * 0.17, B * 0.18, 0.5, 0, deckY + 0.25, z, '#fff', { ...D, segs: 18 });
      k.box(B * 0.32, 0.95, B * 0.36, 0, deckY + 0.95, z, '#fff', M);
      k.box(B * 0.26, 0.2, B * 0.3, 0, deckY + 1.48, z - dir * 0.15, '#fff', Lt);
      for (const x of [-0.42, 0, 0.42]) k.cyl(0.09, 0.11, 3.4, x * B / 8, deckY + 1.0, z + dir * (B * 0.18 + 1.7), '#fff', { ...D, rx: Math.PI / 2, segs: 8 });
    };
    turret(L * 0.27, 1);
    turret(-L * 0.29, -1);
    // Forward superstructure and the tower mast with its fighting tops and rangefinder.
    k.box(B * 0.56, 1.5, L * 0.17, 0, deckY + 0.75, L * 0.09, '#fff', M);
    k.box(B * 0.42, 1.1, L * 0.1, 0, deckY + 2.0, L * 0.1, '#fff', Lt);
    k.box(1.3, 4.6, 1.5, 0, deckY + 4.3, L * 0.1, '#fff', M);
    for (const [y, w] of [[deckY + 3.4, 2.6], [deckY + 5.2, 2.2], [deckY + 6.5, 1.8]]) k.box(w, 0.18, w * 0.8, 0, y, L * 0.1, '#fff', D);
    k.box(2.8, 0.32, 0.5, 0, deckY + 6.85, L * 0.1, '#fff', D);
    k.cyl(0.06, 0.08, 2.6, 0, deckY + 8.2, L * 0.1, '#fff', D);
    // Funnel with its cap, then the aft superstructure and mainmast.
    k.cyl(0.95, 1.05, 3.4, 0, deckY + 2.6, -L * 0.02, '#fff', { ...M, segs: 16, sx: 0.8 });
    k.cyl(1.0, 0.95, 0.35, 0, deckY + 4.45, -L * 0.02, '#fff', { mat: 'metal', tint: '#2e3134', segs: 16, sx: 0.8 });
    k.box(B * 0.5, 1.3, L * 0.12, 0, deckY + 0.65, -L * 0.13, '#fff', M);
    k.box(B * 0.3, 0.9, L * 0.06, 0, deckY + 1.75, -L * 0.13, '#fff', Lt);
    k.cyl(0.07, 0.11, 6.5, 0, deckY + 3.6, -L * 0.15, '#fff', D);
    k.box(2.0, 0.08, 0.08, 0, deckY + 5.6, -L * 0.15, '#fff', D);
    // Secondary guns in shields along both beams, and the ship's boats.
    for (const sx of [-1, 1]) {
      for (const z of [L * 0.06, -L * 0.04, -L * 0.13]) {
        k.box(1.0, 0.6, 1.1, sx * hb * 0.66, deckY + 0.3, z, '#fff', Lt);
        k.cyl(0.05, 0.06, 1.5, sx * (hb * 0.66 + 0.9), deckY + 0.42, z, '#fff', { ...D, rz: Math.PI / 2, segs: 6 });
      }
      k.capsule(0.32, 1.6, sx * hb * 0.5, deckY + 1.75, -L * 0.055, '#fff', { mat: 'wood', tint: '#d8d0c0', rx: Math.PI / 2, segs: 8 });
    }
  },
  uboat(k) {
    k.capsule(1.1, 15, 0, 0.2, 0, '#fff', { mat: 'metal', tint: '#9a9ea0', rx: Math.PI / 2, segs: 14 });
    k.box(1.8, 0.1, 15, 0, 1.15, 0, '#fff', { mat: 'planks', tint: '#7a7470' });
    k.box(1.2, 1.8, 3.2, 0, 2.0, 0.8, '#fff', { mat: 'metal', tint: '#a0a4a6' });
    k.cyl(0.07, 0.07, 1.6, 0, 3.4, 0.8, '#2a2a2a');
    k.cyl(0.08, 0.1, 1.8, 0, 1.6, 3.6, '#fff', { mat: 'metal', tint: '#6a6c6e', rx: Math.PI / 2 });
  },
  crane(k) {
    k.box(2.6, 0.5, 2.6, 0, 0.25, 0, '#fff', { mat: 'concrete_wall' });
    k.box(0.6, 7, 0.6, 0, 3.7, 0, '#fff', { mat: 'metal', tint: '#c8a060' });
    k.box(0.4, 0.4, 7.5, 0, 7.2, 2.2, '#fff', { mat: 'metal', tint: '#c8a060' });
    k.box(1.2, 1.0, 1.4, 0, 7.4, -1.6, '#fff', { mat: 'metal', tint: '#8a8a86' });
    k.cyl(0.02, 0.02, 4, 0, 5.2, 5.6, '#222');
  },
  radar(k) {
    k.box(1.6, 0.9, 1.6, 0, 0.45, 0, '#fff', { mat: 'metal', tint: VEH.grey });
    k.cyl(0.18, 0.22, 1.2, 0, 1.4, 0, '#fff', { mat: 'metal', tint: VEH.grey });
    k.add(new THREE.SphereGeometry(1.5, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), '#fff', 0, 2.3, 0.35, { mat: 'metal', tint: '#c8ccc4', rx: -Math.PI / 2 + 0.35, shade: 0.4 });
    k.cyl(0.04, 0.04, 1.3, 0, 2.4, 0.9, '#2a2a2a', { rx: Math.PI / 2 - 0.35 });
  },
  radiomast(k) { k.cyl(0.06, 0.12, 9, 0, 4.5, 0, '#fff', { mat: 'metal', tint: '#9a9a96' }); for (const a of [0, 2.1, 4.2]) k.cyl(0.01, 0.01, 6.5, Math.cos(a) * 2.2, 3, Math.sin(a) * 2.2, '#2a2a2a', { rx: Math.sin(a) * 0.36, rz: -Math.cos(a) * 0.36 }); },
  telegraph(k) { k.cyl(0.07, 0.09, 3.6, 0, 1.8, 0, '#fff', { mat: 'bark_pine' }); k.box(0.9, 0.08, 0.08, 0, 3.3, 0, '#fff', { mat: 'wood' }); },
  pillbox(k) {
    k.cyl(1.4, 1.55, 1.5, 0, 0.75, 0, '#fff', { mat: 'concrete_wall', segs: 6 });
    k.cyl(1.55, 1.6, 0.3, 0, 1.6, 0, '#fff', { mat: 'concrete_wall', segs: 6 });
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.5; k.box(0.6, 0.15, 0.1, Math.cos(a) * 1.47, 1.1, Math.sin(a) * 1.47, '#0e0f10', { ry: -a + Math.PI / 2 }); }
  },
  bunker(k) { k.box(3.8, 1.6, 2.8, 0, 0.8, 0, '#fff', { mat: 'concrete_wall' }); k.box(4.2, 0.4, 3.2, 0, 1.8, 0, '#fff', { mat: 'concrete_wall' }); k.box(2.2, 0.15, 0.1, 0, 1.2, 1.42, '#0e0f10'); },
  wagon(k, t) {
    for (const z of [-1.7, -1.1, 1.1, 1.7]) wheel(k, 0, 0.32, z, 0.32, 1.5);
    k.box(1.9, 2.0, 4.8, 0, 1.6, 0, '#fff', { mat: 'wood_wall', tint: t.color || '#b06050' });
    k.cyl(1.0, 1.0, 4.8, 0, 2.3, 0, '#fff', { mat: 'roof_metal', tint: '#8a8a86', rx: Math.PI / 2, segs: 14, sz: 0.25 });
  },
  locomotive(k) {
    for (const z of [-2.0, -1.0, 0, 1.0]) wheel(k, 0, 0.46, z, 0.46, 1.5);
    k.cyl(0.75, 0.75, 4.2, 0, 1.6, 0.5, '#fff', { mat: 'metal', tint: '#4a4c4e', rx: Math.PI / 2, segs: 16 });
    k.cyl(0.25, 0.3, 0.8, 0, 2.7, 2.0, '#fff', { mat: 'metal', tint: '#3a3a3a' });
    k.box(1.9, 2.2, 1.6, 0, 1.9, -2.2, '#fff', { mat: 'metal', tint: '#4a4c4e' });
    k.box(2.1, 0.15, 1.8, 0, 3.05, -2.2, '#1e1e1e');
    k.box(1.8, 0.2, 5.8, 0, 0.78, 0, '#fff', { mat: 'metal', tint: '#7a3a30' });
  },
  watertower(k) { for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) k.box(0.15, 4, 0.15, x, 2, z, '#fff', { mat: 'wood' }); k.cyl(1.0, 1.0, 1.8, 0, 4.9, 0, '#fff', { mat: 'wood_wall', segs: 16 }); k.cone(1.1, 0.6, 0, 6.1, 0, '#fff', { mat: 'roof_metal', segs: 16 }); },
  table(k) { k.box(1.8, 0.08, 0.8, 0, 0.75, 0, '#fff', { mat: 'wood' }); for (const [x, z] of [[-0.8, -0.3], [0.8, -0.3], [-0.8, 0.3], [0.8, 0.3]]) k.box(0.07, 0.75, 0.07, x, 0.37, z, '#fff', { mat: 'wood' }); },
  bench(k) { k.box(1.8, 0.07, 0.4, 0, 0.45, 0, '#fff', { mat: 'wood' }); k.box(0.1, 0.45, 0.35, -0.75, 0.22, 0, '#fff', { mat: 'wood' }); k.box(0.1, 0.45, 0.35, 0.75, 0.22, 0, '#fff', { mat: 'wood' }); },
  sign(k) { k.box(0.07, 1.6, 0.07, 0, 0.8, 0, '#fff', { mat: 'wood' }); k.box(0.9, 0.35, 0.04, 0.25, 1.4, 0, '#fff', { mat: 'wood', tint: '#f0e8d8' }); },
  // Gates follow their footprint (across x when wide, across z when deep). An open gate is
  // swung a quarter turn by the scene. Solid gates (flags include SIGHT) are planked doors.
  gate(k, t) {
    const along = Math.max(t.w || 1, t.h || 1), post = gatePost(t);
    if (t.flags & 2) {
      for (const sx of [-1, 1]) k.box(0.16, 2.0, 0.16, sx * along / 2, 1.0, 0, '#fff', { mat: 'wood', tint: '#6a5038', post });
      for (const sx of [-1, 1]) {
        k.box(along / 2 - 0.12, 1.7, 0.08, sx * (along / 4), 0.95, 0, '#fff', { mat: 'planks', tint: '#8a7050', post });
        k.box(0.08, 1.9, 0.1, sx * (along / 2 - 0.2), 0.95, 0.05, '#fff', { mat: 'wood', tint: '#5a4430', rz: sx * 0.62, post });
      }
    } else if (along <= 2 && t.kind !== 'barrier') {
      // A garden or field gate: a picket leaf between two posts.
      for (const sx of [-1, 1]) k.box(0.14, 1.25, 0.14, sx * along / 2, 0.62, 0, '#fff', { mat: 'wood', tint: '#5a4430', post });
      for (const y of [0.3, 0.85]) k.box(along - 0.1, 0.08, 0.05, 0, y, 0, '#fff', { mat: 'wood', tint: '#8a7056', post });
      const n = Math.max(3, Math.round(along / 0.18));
      for (let i = 0; i < n; i++) k.box(0.07, 1.05, 0.04, -along / 2 + (i + 0.5) * along / n, 0.55, 0.03, '#fff', { mat: 'wood', tint: '#9a8066', post });
      k.box(0.06, 1.0, 0.04, 0, 0.58, 0.05, '#fff', { mat: 'wood', tint: '#7a6048', rz: Math.atan2(0.55, along) * 1.6, post });
    } else {
      for (const sx of [-1, 1]) k.box(0.18, 1.1, 0.18, sx * along / 2, 0.55, 0, '#fff', { mat: 'wood', tint: '#6a5038', post });
      const n = Math.max(2, Math.round(along / 0.5));
      for (let i = 0; i < n; i++) k.box(along / n, 0.12, 0.12, -along / 2 + (i + 0.5) * along / n, 0.9, 0, i % 2 ? '#e8e2d8' : '#a8322a', { post });
      k.box(along, 0.06, 0.06, 0, 0.45, 0, '#fff', { mat: 'wood', post });
    }
  },
  barrier(k, t) { PROP_BUILDERS.gate(k, { ...t, flags: 0 }); },
  // A ship's or bunker's steel hatch: a frame with a heavy riveted door and a locking wheel.
  hatch(k, t) {
    const along = Math.max(t.w || 1, t.h || 1), post = gatePost(t), M = { mat: 'metal', tint: '#5c6064', post };
    k.box(along + 0.2, 0.14, 0.24, 0, 1.75, 0, '#fff', M);
    for (const sx of [-1, 1]) k.box(0.14, 1.75, 0.24, sx * (along / 2 + 0.03), 0.88, 0, '#fff', M);
    k.box(along - 0.12, 1.55, 0.1, 0, 0.86, 0, '#fff', { mat: 'metal', tint: '#6c7074', post });
    k.torus(0.18, 0.025, 0, 0.95, 0.09, '#fff', { mat: 'metal', tint: '#3a3c3e', segs: 14, post });
    for (const y of [0.25, 1.45]) for (const sx of [-1, 1]) k.box(0.12, 0.06, 0.06, sx * (along / 2 - 0.12), y, 0.08, '#fff', { mat: 'metal', tint: '#3a3c3e', post });
  },
  // An ordinary door in a wall or doorway: planks on a frame.
  door(k, t) {
    const along = Math.max(t.w || 1, t.h || 1), post = gatePost(t);
    k.box(along + 0.16, 0.12, 0.2, 0, 2.0, 0, '#fff', { mat: 'wood', tint: '#5a4430', post });
    for (const sx of [-1, 1]) k.box(0.1, 2.0, 0.2, sx * (along / 2 + 0.03), 1.0, 0, '#fff', { mat: 'wood', tint: '#5a4430', post });
    k.box(along - 0.06, 1.9, 0.07, 0, 0.97, 0, '#fff', { mat: 'planks', tint: '#7a5e42', post });
    k.sphere(0.04, along / 2 - 0.2, 1.0, 0.07, '#fff', { mat: 'metal', tint: '#c8b070', post });
  },
  // A bridge span (footprint along its length). Destroyed, the scene drops it into the gap.
  bridge(k, t) {
    const side = (t.w || 3) > (t.h || 8), L = side ? t.w : t.h, B = side ? t.h : t.w;
    const post = side ? new THREE.Matrix4().makeRotationY(Math.PI / 2) : null;
    const W = { mat: t.color ? 'metal' : 'planks', tint: t.color || '#8a7660', post };
    k.box(B, 0.25, L, 0, 0.2, 0, '#fff', W);
    for (const sx of [-1, 1]) {
      k.box(0.18, 0.5, L, sx * (B / 2 - 0.09), -0.15, 0, '#fff', { mat: 'metal', tint: '#4e5052', post });
      for (let z = -L / 2 + 0.5; z <= L / 2 - 0.4; z += 1.5) k.box(0.08, 0.85, 0.08, sx * (B / 2 - 0.05), 0.75, z, '#fff', { mat: 'wood', tint: '#5a4632', post });
      k.box(0.06, 0.08, L, sx * (B / 2 - 0.05), 1.15, 0, '#fff', { mat: 'wood', tint: '#5a4632', post });
    }
  },
  roadblock(k) {
    for (const x of [-1.2, 1.2]) { k.box(0.08, 0.9, 0.5, x, 0.45, 0, '#fff', { mat: 'wood', rx: 0.3 }); k.box(0.08, 0.9, 0.5, x, 0.45, 0, '#fff', { mat: 'wood', rx: -0.3 }); }
    for (let i = 0; i < 6; i++) k.box(0.5, 0.12, 0.12, -1.25 + i * 0.5, 0.85, 0, i % 2 ? '#e8e2d8' : '#a8322a');
  },
  horse(k) {
    k.capsule(0.28, 0.9, 0, 1.2, 0, '#5a3e2a', { rx: Math.PI / 2 });
    k.capsule(0.13, 0.5, 0, 1.62, 0.78, '#5a3e2a', { rx: -0.6 }); k.capsule(0.12, 0.35, 0, 1.92, 1.06, '#4e3624', { rx: Math.PI / 2.4 });
    for (const [x, z] of [[-0.17, -0.5], [0.17, -0.5], [-0.17, 0.5], [0.17, 0.5]]) k.capsule(0.06, 0.8, x, 0.5, z, '#4e3624');
    k.box(0.06, 0.5, 0.06, 0, 1.25, -0.72, '#2a1e14', { rx: 0.4 });
  },
  hedgehog(k) { for (const [rx, rz, ry] of [[0.6, 0, 0], [-0.6, 0, 0], [0, 0.95, 1.57]]) k.box(0.1, 1.5, 0.1, 0, 0.55, 0, '#fff', { mat: 'metal', tint: '#6a5a50', rx, rz, ry }); },
  statue(k) { k.box(1.4, 1.2, 1.4, 0, 0.6, 0, '#fff', { mat: 'stone_wall', tint: '#e0dcd0' }); k.capsule(0.28, 1.2, 0, 2.0, 0, '#fff', { mat: 'metal', tint: '#8a9a80' }); k.sphere(0.2, 0, 3.0, 0, '#fff', { mat: 'metal', tint: '#8a9a80' }); },
  fountain(k) { k.cyl(1.4, 1.5, 0.5, 0, 0.25, 0, '#fff', { mat: 'stone_wall', segs: 20 }); k.cyl(1.2, 1.2, 0.08, 0, 0.45, 0, '#4d7774', { segs: 20 }); k.cyl(0.2, 0.3, 1.4, 0, 0.7, 0, '#fff', { mat: 'stone_wall' }); k.cyl(0.6, 0.3, 0.2, 0, 1.4, 0, '#fff', { mat: 'stone_wall' }); },
  pier(k) { k.box(1.02, 0.12, 1.02, 0, 0.1, 0, '#fff', { mat: 'planks' }); k.cyl(0.08, 0.08, 1.2, -0.42, -0.4, -0.42, '#fff', { mat: 'bark_pine' }); },
  bollard(k) { k.cyl(0.18, 0.22, 0.5, 0, 0.25, 0, '#fff', { mat: 'metal', tint: '#5a5a5a' }); },
  satchel(k) { k.box(0.45, 0.12, 0.32, 0, 0.06, 0, '#fff', { mat: 'fabric', tint: '#a07040' }); k.box(0.47, 0.04, 0.05, 0, 0.13, 0, '#3a2a1a'); },
  documents(k) { k.box(0.4, 0.06, 0.3, 0, 0.03, 0, '#e8e2d0'); k.box(0.38, 0.02, 0.28, 0.02, 0.07, 0.01, '#d8d0b8', { ry: 0.2 }); },
  briefcase(k) { k.box(0.5, 0.35, 0.12, 0, 0.18, 0, '#fff', { mat: 'fabric', tint: '#6a4030' }); k.box(0.16, 0.05, 0.04, 0, 0.38, 0, '#2a2a2a'); },
  radioset(k) { k.box(0.6, 0.45, 0.4, 0, 0.23, 0, '#fff', { mat: 'metal', tint: VEH.olive }); k.cyl(0.01, 0.01, 1.2, 0.22, 1.0, 0, '#222'); },
  enigma(k) { k.box(0.5, 0.25, 0.4, 0, 0.13, 0, '#fff', { mat: 'wood', tint: '#5a4030' }); k.box(0.42, 0.02, 0.3, 0, 0.27, 0.02, '#c8c0a8'); },
  cans(k) { for (let i = 0; i < 6; i++) k.cyl(0.13, 0.13, 0.42, -0.3 + (i % 3) * 0.3, 0.21, -0.15 + Math.floor(i / 3) * 0.3, '#fff', { mat: 'metal', tint: '#c0c0b8', segs: 10 }); },
  case(k) { k.box(0.55, 0.3, 0.38, 0, 0.15, 0, '#fff', { mat: 'fabric', tint: '#7a4a30' }); k.box(0.57, 0.04, 0.4, 0, 0.3, 0, '#c9b26a'); },
  flag(k) { k.cyl(0.03, 0.03, 3, 0, 1.5, 0, '#ddd'); k.box(0.02, 0.6, 0.9, 0, 2.6, 0.46, '#fff', { mat: 'fabric', tint: '#c03a30' }); },
  rubble(k, t) { const r = seeded(t.id || 'rb'); for (let i = 0; i < 7; i++) k.boulder(0.16 + r() * 0.16, Math.cos(i * 2.1) * 0.45, 0.06, Math.sin(i * 2.1) * 0.45, { mat: i % 2 ? 'brick' : 'stone_wall', seed: i, flat: 0.5 }); },
  crater(k, t) {
    const r = seeded((t && t.id) || 'cr');
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28 + r() * 0.4; k.boulder(0.32 + r() * 0.12, Math.cos(a) * 0.95, 0.02, Math.sin(a) * 0.95, { mat: 'dirt', tint: '#e8dcc8', seed: i + 3, flat: 0.35 }); }
    const g = new THREE.CircleGeometry(0.85, 20); g.rotateX(-Math.PI / 2);
    k.add(g, '#fff', 0, 0.015, 0, { mat: 'ash', tint: '#8a8070', shade: 0 });
  },
};

function gatePost(t) { return (t.h || 1) > (t.w || 1) ? new THREE.Matrix4().makeRotationY(Math.PI / 2) : null; }

const PROP_CACHE = new Map();
export function buildProp(t, fallbackColor, lib = null) {
  const scan = scannedProp(t);
  if (scan) return scan;
  const builder = PROP_BUILDERS[t.kind];
  if (!builder) return null;
  const moving=!!lib?.detailed&&!!t.animated&&['truck','car','kubel','motorcycle'].includes(t.kind);
  const variant=t.kind==='ship'?navalShip(t):t.kind==='barge'&&t.interact?.kind==='hatch';
  const key = !!lib?.detailed + '|' + moving + '|' + variant + '|' + t.kind + '|' + (t.color || fallbackColor || '') + '|' + (t.w || '') + 'x' + (t.h || '') + '|' + ((t.flags || 0) & 2) + '|' + (t.rot || 0) % 2 + (['rocks', 'rock', 'rubble'].includes(t.kind) ? t.id : '');
  let cached = PROP_CACHE.get(key);
  if (!cached) {
    const k = new Kit();
    k.motionWheels=moving;
    builder(k, { ...t, color: t.color || fallbackColor });
    cached = k.build();
    PROP_CACHE.set(key, cached);
  }
  const mats = cached.slots.map((s) => (s === 'plain' ? MAT.smooth : s === 'glow' ? MAT.glow : s === 'glass' ? MAT.glass : lib ? lib.material(s) : MAT.smooth));
  const m = new THREE.Mesh(cached.geometry, mats.length === 1 ? mats[0] : mats);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---------- barriers ----------
export function buildBarrier(t, heightAt, lib = null) {
  const k = new Kit();
  const set = new Set(t.tiles.map(([x, y]) => x + ',' + y));
  const has = (x, y) => set.has(x + ',' + y);
  for (const [x, y] of t.tiles) {
    const cx = x + 0.5, cz = y + 0.5, gy = heightAt(cx, cz);
    const right = has(x + 1, y), down = has(x, y + 1);
    switch (t.kind) {
      case 'stone': case 'brick': case 'concrete': {
        const mat = t.kind === 'brick' ? 'brick' : t.kind === 'concrete' ? 'concrete_wall' : 'stone_wall';
        const hgt = t.height || ((t.flags & 4) ? 0.8 : 1.8);
        k.box(0.5, hgt, 0.5, cx, gy + hgt / 2, cz, '#fff', { mat, shade: 0.3 });
        if (right) k.box(1, hgt, 0.46, cx + 0.5, gy + hgt / 2, cz, '#fff', { mat, shade: 0.3 });
        if (down) k.box(0.46, hgt, 1, cx, gy + hgt / 2, cz + 0.5, '#fff', { mat, shade: 0.3 });
        k.box(0.58, 0.1, 0.58, cx, gy + hgt + 0.05, cz, '#fff', { mat: 'stone_wall', tint: '#d0c8b8' });
        break;
      }
      case 'sandbags': {
        for (let row = 0; row < 3; row++) {
          const y0 = gy + 0.13 + row * 0.24;
          k.capsule(0.13, 0.32, cx, y0, cz, '#fff', { mat: 'burlap', tint: row % 2 ? '#aa9c7e' : '#9c8e72', rz: Math.PI / 2, ry: (row % 2) * 0.2, sz: 0.75, sx: 0.62 });
          if (right) k.capsule(0.13, 0.32, cx + 0.5, y0, cz, '#fff', { mat: 'burlap', tint: '#a29476', rz: Math.PI / 2, sz: 0.75 });
          if (down) k.capsule(0.13, 0.32, cx, y0, cz + 0.5, '#fff', { mat: 'burlap', tint: '#a29476', rx: Math.PI / 2, sx: 0.75 });
        }
        break;
      }
      case 'wire': {
        k.box(0.07, 1.25, 0.07, cx, gy + 0.62, cz, '#fff', { mat: 'wood', tint: '#8a7050' });
        for (const hh of [0.3, 0.65, 1.0]) {
          if (right) k.box(1, 0.015, 0.015, cx + 0.5, gy + hh, cz, '#3a3a38');
          if (down) k.box(0.015, 0.015, 1, cx, gy + hh, cz + 0.5, '#3a3a38');
        }
        k.torus(0.3, 0.015, cx, gy + 0.3, cz, '#3a3a38', { ry: right ? 0 : Math.PI / 2, segs: 10 });
        break;
      }
      case 'picket': case 'wood': default: {
        k.box(0.1, 1.05, 0.1, cx, gy + 0.52, cz, '#fff', { mat: 'wood', tint: '#c0a888' });
        if (right) { k.box(1, 0.08, 0.04, cx + 0.5, gy + 0.78, cz, '#fff', { mat: 'wood' }); k.box(1, 0.08, 0.04, cx + 0.5, gy + 0.42, cz, '#fff', { mat: 'wood' }); }
        if (down) { k.box(0.04, 0.08, 1, cx, gy + 0.78, cz + 0.5, '#fff', { mat: 'wood' }); k.box(0.04, 0.08, 1, cx, gy + 0.42, cz + 0.5, '#fff', { mat: 'wood' }); }
        break;
      }
    }
  }
  return k.mesh(lib);
}

export const CHARRED_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 1 });
