import * as THREE from 'three';
import { buildProp, CHARRED_MAT } from './models.js';
import { WheelMotion } from './wheel-motion.js';

// The view for a boardable vehicle or boat: the prop model, a gentle bob on water,
// and a charred hulk once destroyed. Same interface as Figure (root, update, xray).
export class VehicleView {
  constructor(e, lib) {
    this.root = new THREE.Group();
    this.xrayMeshes = [];
    const mesh = buildProp({ kind: e.model, color: e.color, id: e.id, animated:true }, e.color, lib);
    if (mesh) this.root.add(mesh);
    this.body = mesh;
    if(mesh?.geometry?.attributes.wheelPivot)this.wheels=new WheelMotion(mesh);
    this.phase = Math.random() * 6;
  }
  setXray() {}
  update(e, dt, speed) {
    this.wheels?.update(e,dt);
    this.phase += dt;
    if (this.body && e.boat) { this.body.rotation.z = Math.sin(this.phase * 1.3) * 0.03; this.body.rotation.x = Math.sin(this.phase * 0.9) * 0.02; }
    if (e.state !== 'ok' && !this.charred) {
      this.charred = true;
      this.root.traverse((c) => { if (c.isMesh) {
        if(c===this.body&&this.wheels)this.wheels.wreck(CHARRED_MAT);
        else c.material = CHARRED_MAT;
      } });
      this.root.rotation.z = 0.12;
    }
  }
  dispose(){this.wheels?.dispose();}
}
