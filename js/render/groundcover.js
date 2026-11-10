import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { T } from '../core/constants.js';
export { groundCoverSpots } from './groundcover-layout.js';
import { groundCoverSpots } from './groundcover-layout.js';

// Decorative short grass, not tactical cover. Keep the whole tuft off hard surfaces,
// entrances and water. Existing BUSH/TALL objects alone determine concealment.
function tuftGeometry() {
  const parts = [];
  // Four separately cropped specimens from the existing atlas. Curved segmented cards
  // have different lean/azimuths; they no longer make a single six-pointed billboard star.
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(.34, .36, 1, 3);
    const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
    const color = [];
    for (let v = 0; v < p.count; v++) {
      const h = uv.getY(v);
      p.setXYZ(v, p.getX(v), h * .36, .055 * h*h);
      uv.setX(v, (i + .015 + uv.getX(v) * .97) / 4);
      // Upward-biased normals give fine leaves soft skylight instead of black backs.
      n.setXYZ(v, 0, .92, .39);
      const c = .95 + .45*h; color.push(c,c,c);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    const a = i * 2.39996;
    g.rotateY(a); g.translate(Math.sin(a)*.065, 0, Math.cos(a)*.065);
    parts.push(g);
  }
  const geo = mergeGeometries(parts, false); parts.forEach(g=>g.dispose());
  geo.computeBoundingBox(); geo.computeBoundingSphere(); return geo;
}

export function buildGroundCover(grid, heightAt, material, opts) {
  const spots = groundCoverSpots(grid, opts.density, opts.snowy);
  if (!spots.length) return null;
  const group = new THREE.Group(); group.name = 'short-ground-cover';
  group.userData.decorative = true; group.userData.instances = spots.length;
  const chunks = new Map();
  for (const s of spots) {
    const key = `${Math.floor(s.x/16)}:${Math.floor(s.z/16)}`;
    if (!chunks.has(key)) chunks.set(key, []); chunks.get(key).push(s);
  }
  const geo = tuftGeometry(), m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3(), up = new THREE.Vector3(0,1,0), c = new THREE.Color();
  for (const list of chunks.values()) {
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((s,i)=>{
      p.set(s.x, heightAt(s.x,s.z)-.008, s.z); q.setFromAxisAngle(up,s.angle);
      // Low enough not to imply concealment where none exists in the simulation.
      scale.set(s.scale*1.25, s.scale*(s.terrain===T.FIELD ? .95 : .9), s.scale*1.25);
      m.compose(p,q,scale); mesh.setMatrixAt(i,m);
      const dry = s.terrain===T.FIELD || opts.snowy ? .65 : s.dry*.18;
      c.setRGB(s.tone*(1+dry*.35),s.tone,s.tone*(1-dry*.28)); mesh.setColorAt(i,c);
    });
    mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.computeBoundingSphere(); mesh.boundingSphere.radius += .1; // wind envelope
    mesh.userData.groundCover = true; group.add(mesh);
  }
  return group;
}
