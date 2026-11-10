import * as THREE from 'three';

// Original procedural low crawl, over the existing rig's idle pose. Analytic two-bone
// reaches preserve limb lengths across different character proportions. This is a visual
// overlay only: no root motion, simulation position, collision or movement speed changes.
export class CrawlPose {
  constructor(model, root) {
    this.root = root; this.pose = model.parent; this.bones = new Map(); this.phase = 0; this.motion = 0;
    model.traverse(o=>{if(o.isBone)this.bones.set(o.name.replace(/^mixamorig[:]?/,''),o);});
    this.enabled = ['Hips','Head','Neck','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot'].every(n=>this.bones.has(n));
    this.inverse = new THREE.Matrix4();
    this.saved = new Map();
  }
  restore() {
    for (const [bone,q] of this.saved) bone.quaternion.copy(q);
    this.saved.clear();
  }
  point(name) {
    return this.bones.get(name).getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverse);
  }
  aim(name, child, target) {
    const bone = this.bones.get(name);
    const from = this.point(child).sub(this.point(name)).normalize();
    const to = target.clone().sub(this.point(name)).normalize();
    if (!from.lengthSq() || !to.lengthSq()) return;
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    from.applyQuaternion(rootQ); to.applyQuaternion(rootQ);
    const delta = new THREE.Quaternion().setFromUnitVectors(from,to);
    const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(world)); bone.updateWorldMatrix(false,true);
  }
  limb(upper, lower, end, target, pole) {
    const a = this.point(upper), b = this.point(lower), c = this.point(end);
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    const dir = target.clone().sub(a);
    const d = THREE.MathUtils.clamp(dir.length(), Math.abs(l1-l2)+.001, l1+l2-.001);
    dir.normalize();
    const bend = pole.clone().sub(a); bend.addScaledVector(dir,-bend.dot(dir)).normalize();
    const along = (l1*l1-l2*l2+d*d)/(2*d);
    const joint = a.clone().addScaledVector(dir,along).addScaledVector(bend,Math.sqrt(Math.max(0,l1*l1-along*along)));
    this.aim(upper,lower,joint);
    this.aim(lower,end,a.addScaledVector(dir,d));
  }
  update(dt, speed) {
    if (!this.enabled) return;
    for (const name of ['Neck','LeftArm','LeftForeArm','RightArm','RightForeArm','LeftUpLeg','LeftLeg','RightUpLeg','RightLeg','LeftFoot','RightFoot']) {
      const b=this.bones.get(name); this.saved.set(b,b.quaternion.clone());
    }
    this.phase = (this.phase + Math.max(0,speed)*dt*5.8) % (Math.PI*2);
    this.motion += ((speed>.05 ? 1 : 0)-this.motion)*(1-Math.exp(-dt*12));
    this.root.updateWorldMatrix(true,true); this.inverse.copy(this.root.matrixWorld).invert();
    // Shared idle clips contain a small lateral root offset. Keep a prone soldier's
    // hips centred on the same tactical position, regardless of the model's proportions.
    this.pose.position.x -= this.point('Hips').x;
    this.root.updateWorldMatrix(false,true);
    const hips = this.point('Hips');
    // Head lifted to look along the route, chest still low. Idle breathing remains in the
    // underlying clip. Opposite arm/leg advance together; no upright walking cycle.
    const neck = this.point('Neck');
    this.aim('Neck','Head',neck.clone().add(new THREE.Vector3(0,.08,.04)));
    for (const [side,sign] of [['Left',1],['Right',-1]]) {
      const arm = this.point(side+'Arm'), hip = this.point(side+'UpLeg');
      const wave = Math.sin(this.phase + (sign<0 ? Math.PI : 0));
      const reach = wave*this.motion;
      const hand = new THREE.Vector3(arm.x*.85,.075,arm.z+.22+reach*.12);
      this.limb(side+'Arm',side+'ForeArm',side+'Hand',hand,new THREE.Vector3(arm.x+sign*.32,.015,arm.z-.1));
      const legLength = hip.distanceTo(this.point(side+'Leg')) + this.point(side+'Leg').distanceTo(this.point(side+'Foot'));
      const foot = new THREE.Vector3(hip.x+sign*(.07+Math.max(0,-reach)*.09),.09,hip.z-legLength*(.86+reach*.09));
      this.limb(side+'UpLeg',side+'Leg',side+'Foot',foot,new THREE.Vector3(hip.x+sign*.45,.015,hips.z-.32));
      if(this.bones.has(side+'ToeBase')) {
        // Extend the boot behind the ankle instead of leaving the upright idle foot
        // pointing into the ground after the torso has been rotated horizontal.
        this.aim(side+'Foot',side+'ToeBase',this.point(side+'Foot').add(new THREE.Vector3(0,-.03,-.16)));
      }
    }
  }
}
