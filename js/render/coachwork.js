import * as THREE from 'three';

// Original period-inspired coachwork, not a scan or a replica of a branded vehicle.
// Curved surfaces, open wheel arches and fitted glazing replace stacked primitives.
// Geometry is merged by Kit into a few material batches; +Z is forward, as before.
const paint=c=>({mat:'vehicle_paint',tint:c,shade:.1});
const trim={mat:'vehicle_trim',tint:'#a5a79c',shade:.1};
const rubber={mat:'vehicle_rubber',tint:'#343630',shade:.25};
const dark={mat:'metal',tint:'#383c35',shade:.15};
const cloth={mat:'canvas',tint:'#77725a',shade:.22};
function mesh(k,positions,indices,o){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();k.add(g,'#fff',0,0,0,o);
}
function quad(k,pts,o){mesh(k,pts.flat(),[0,1,2,0,2,3],o);}
function rod(k,a,b,r,o){
 const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),v=vb.clone().sub(va);
 const m=new THREE.Matrix4().compose(va.add(vb).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize()),new THREE.Vector3(1,1,1));
 k.add(new THREE.CylinderGeometry(r,r,v.length(),8),'#fff',0,0,0,{...o,post:m});
}
// Elliptical sections with adjustable squareness. Smooth authored longitudinal profiles.
function shell(k,sections,o,square=.55){
 const p=[],ix=[],N=24;
 for(const [z,y,rx,ry] of sections)for(let n=0;n<N;n++){
  const a=n/N*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
  p.push(rx*Math.sign(c)*Math.pow(Math.abs(c),square),y+ry*Math.sign(s)*Math.pow(Math.abs(s),square),z);
 }
 for(let j=0;j<sections.length-1;j++)for(let n=0;n<N;n++){
  const a=j*N+n,b=j*N+(n+1)%N,c=a+N,d=b+N;ix.push(a,b,c,b,d,c);
 }
 for(const end of [0,sections.length-1]){const [z,y]=sections[end],center=p.length/3;p.push(0,y,z);for(let n=0;n<N;n++){const a=end*N+n,b=end*N+(n+1)%N;ix.push(...(end?[center,a,b]:[center,b,a]));}}
 mesh(k,p,ix,o);
}
function tire(k,x,y,z,r=.34,w=.22){
 k.activeWheel=[x,y,z,z>0?r:-r];
 // Round sidewalls around a recessed steel hub. Tread is real shallow geometry.
 k.add(new THREE.TorusGeometry(r*.73,r*.27,8,32),'#fff',x,y,z,{...rubber,ry:Math.PI/2,sz:w/(r*.54)});
 k.cyl(r*.47,r*.47,w*.8,x,y,z,'#fff',{...dark,rz:Math.PI/2,segs:24});
 for(const side of [-1,1]){
  k.cyl(r*.23,r*.28,.045,x+side*w*.43,y,z,'#fff',{...trim,rz:Math.PI/2,segs:16});
  for(let n=0;n<6;n++){
   const a=n/6*Math.PI*2;k.cyl(.017,.017,.024,x+side*w*.46,y+Math.cos(a)*r*.35,z+Math.sin(a)*r*.35,'#fff',{...trim,rz:Math.PI/2,segs:6});
  }
 }
 for(let n=0;n<32;n++){
  const a=n/32*Math.PI*2;
  k.box(w*.83,.025,.055,x,y+Math.cos(a)*(r-.006),z+Math.sin(a)*(r-.006),'#fff',{...rubber,rx:a});
 }
 k.activeWheel=null;
}
function fender(k,x,y,z,r,width,c){
 const p=[],ix=[],N=24;
 for(let i=0;i<=N;i++){
  const a=-.18+(Math.PI+.36)*i/N;
  for(const across of [-1,1])p.push(x+across*width/2,y+Math.sin(a)*r,z+Math.cos(a)*r);
 }
 for(let i=0;i<N;i++){const a=i*2;ix.push(a,a+1,a+2,a+1,a+3,a+2);}
 mesh(k,p,ix,{...paint(c),mat:'vehicle_paint_double'});
 // Rolled outer lip, not a solid slab over the tire.
 for(const side of [-1,1])for(let i=0;i<N;i++){
  const a=-.18+(Math.PI+.36)*i/N,b=-.18+(Math.PI+.36)*(i+1)/N;
  rod(k,[x+side*width/2,y+Math.sin(a)*r,z+Math.cos(a)*r],[x+side*width/2,y+Math.sin(b)*r,z+Math.cos(b)*r],.012,paint(c));
 }
}
function lamps(k,x,y,z,r=.105){
 for(const s of [-1,1]){
  k.cyl(r*1.15,r*1.08,.12,s*x,y,z-.035,'#fff',{...dark,rx:Math.PI/2,segs:20});
  k.cyl(r,r,.012,s*x,y,z+.03,'#fff',{mat:'vehicle_lens',tint:'#d8d5be',rx:Math.PI/2,segs:20});
 }
}
function grille(k,width,height,y,z,c){
 k.box(width,height,.025,0,y,z,'#fff',dark);
 for(let x=-width/2+.03;x<width/2;x+=.062)k.box(.018,height-.04,.028,x,y,z+.022,'#fff',paint(c));
}
function chassis(k,zs,halfWidth,c,r=.34){
 for(const z of zs){rod(k,[-halfWidth,r,z],[halfWidth,r,z],.055,dark);for(const x of [-halfWidth,halfWidth])tire(k,x,r,z,r);}
 for(const x of [-.42,.42])k.box(.075,.1,zs[1]-zs[0]+.5,x,.38,(zs[0]+zs[1])/2,'#fff',dark);
 for(const x of [-halfWidth,halfWidth])k.box(.26,.075,zs[1]-zs[0]-.55,x,.36,(zs[0]+zs[1])/2,'#fff',paint(c));
}
function pane(k,pts){quad(k,pts,{mat:'vehicle_glass',shade:0});}

export function cargoLorry(k,t){
 const c=t.color||'#626856';chassis(k,[-1.3,1.08],.78,c,.35);
 for(const s of [-1,1]){fender(k,s*.78,.35,1.08,.43,.37,c);fender(k,s*.78,.35,-1.3,.43,.31,c);}
 shell(k,[[.9,.91,.63,.25],[1.02,.96,.63,.28],[1.6,.94,.49,.25],[1.86,.91,.43,.23]],paint(c),.65);
 grille(k,.72,.46,.96,1.87,c);lamps(k,.64,.96,1.72,.105);
 k.box(1.82,.1,.13,0,.53,1.96,'#fff',dark);
 // Cab: lower body, curved roof, sloping split windscreen and separately fitted side panes.
 shell(k,[[-.1,1.05,.69,.35],[.08,1.05,.75,.36],[.69,1.05,.74,.34],[.86,1.05,.64,.3]],paint(c),.38);
 shell(k,[[-.13,1.77,.61,.07],[-.04,1.79,.73,.1],[.55,1.79,.71,.1],[.73,1.75,.6,.065]],paint(c),.6);
 pane(k,[[-.64,1.38,.86],[.64,1.38,.86],[.58,1.73,.69],[-.58,1.73,.69]]);
 rod(k,[0,1.38,.88],[0,1.74,.7],.018,paint(c));
 for(const s of [-1,1]){
  pane(k,[[s*.752,1.38,.61],[s*.752,1.38,.02],[s*.685,1.73,.02],[s*.685,1.73,.55]]);
  for(const z of [-.045,.66])rod(k,[s*.75,1.34,z],[s*.7,1.75,z*.86],.026,paint(c));
  rod(k,[s*.66,1.37,.86],[s*.6,1.75,.7],.025,paint(c));
  k.box(.018,.025,.14,s*.766,1.25,.09,'#fff',trim);
  rod(k,[s*.72,1.63,.58],[s*.98,1.62,.56],.012,dark);
  k.box(.06,.14,.11,s*.99,1.65,.56,'#fff',dark);
  for(let n=0;n<5;n++)k.box(.012,.13,.018,s*(.59-n*.018),1.02,1.13+n*.105,'#fff',dark);
 }
 k.box(1.73,.12,2.15,0,.77,-.94,'#fff',{mat:'wood',tint:'#97866b'});
 for(const s of [-1,1])for(let y=.9;y<1.25;y+=.15)k.box(.065,.125,2.12,s*.84,y,-.94,'#fff',{mat:'wood',tint:'#8d826c'});
 // Canvas hoops and sagging cloth: a continuous vaulted surface with real wrinkles.
 const p=[],ix=[],U=32,V=32;
 for(let j=0;j<=V;j++)for(let i=0;i<=U;i++){
  const a=i/U*Math.PI,z=-2.02+j/V*2.14;
  const fold=Math.pow(Math.sin(j/V*Math.PI*4),2)*Math.sin(a)*.045;
  const ripple=Math.sin(a*22+j*.4)*.013*Math.sin(a);
  p.push(-Math.cos(a)*.865,1.23+Math.sin(a)*.76-fold+ripple,z);
 }
 for(let j=0;j<V;j++)for(let i=0;i<U;i++){const a=j*(U+1)+i,b=a+U+1;ix.push(a,b,a+1,a+1,b,b+1);}
 mesh(k,p,ix,cloth);
 // Rear is open beneath a rolled flap, with a dark cargo compartment.
 k.box(1.58,.6,.03,0,1.42,-1.91,'#fff',dark);
 k.cyl(.07,.07,1.65,0,1.85,-2.02,'#fff',{...cloth,rz:Math.PI/2,segs:16});
 for(const s of [-1,1])for(let j=0;j<6;j++){
  const z=-1.92+j*.39;rod(k,[s*.87,1.3,z],[s*.86,.91,z-.06],.014,{...cloth,tint:'#b6aa89'});
 }
 for(const x of [-.65,.65])k.box(.1,.07,.03,x,.79,-2.04,'#fff',{mat:'vehicle_lens',tint:'#842d21'});
}

export function staffCar(k,t){
 const c=t.color||'#303a35';chassis(k,[-.95,.95],.72,c,.32);
 for(const x of [-.72,.72])for(const z of [-.95,.95])fender(k,x,.32,z,.4,.33,c);
 shell(k,[[-1.39,.62,.44,.16],[-1.23,.67,.56,.24],[-.75,.68,.64,.26],[.5,.68,.64,.24],[1.1,.69,.48,.27],[1.38,.65,.32,.21]],paint(c),.65);
 shell(k,[[-.85,1.26,.38,.04],[-.62,1.38,.5,.08],[-.2,1.42,.55,.1],[.22,1.36,.5,.06],[.36,1.26,.42,.035]],paint(c),.9);
 pane(k,[[-.6,.92,.64],[.6,.92,.64],[.48,1.34,.24],[-.48,1.34,.24]]);
 pane(k,[[.57,.93,-1],[-.57,.93,-1],[-.4,1.28,-.79],[.4,1.28,-.79]]);
 for(const s of [-1,1]){
  pane(k,[[s*.64,.93,.5],[s*.64,.93,-.85],[s*.48,1.33,-.59],[s*.5,1.34,.2]]);
  for(const [bottom,top] of [[.53,.24],[-.15,-.15],[-.88,-.62]])rod(k,[s*.647,.9,bottom],[s*.51,1.36,top],.024,paint(c));
  rod(k,[s*.59,.92,.65],[s*.49,1.35,.23],.022,trim);
  rod(k,[s*.64,.91,-.82],[s*.64,.91,.49],.012,trim);
  for(const z of [-.57,.2])k.box(.025,.025,.13,s*.65,.84,z,'#fff',trim);
 }
 rod(k,[0,.93,.65],[0,1.35,.25],.013,trim);
 grille(k,.47,.4,.66,1.4,'#a3a69c');lamps(k,.53,.69,1.29);
 for(const z of [-1.46,1.46])rod(k,[-.76,.39,z],[.76,.39,z],.035,trim);
 for(const s of [-1,1])k.box(.09,.075,.03,s*.46,.65,-1.4,'#fff',{mat:'vehicle_lens',tint:'#852e22'});
 // Civilian enamel catches broad highlights; military vehicles retain matte paint.
 for(const slot of ['vehicle_paint','vehicle_paint_double'])if(k.groups.has(slot)){
  k.groups.set(slot.replace('vehicle_paint','vehicle_paint_gloss'),k.groups.get(slot));k.groups.delete(slot);
 }
}

export function dispatchBike(k){
 const c='#616953';for(const z of [-.62,.65])tire(k,0,.29,z,.29,.115);
 for(const s of [-1,1]){
  rod(k,[s*.07,.31,.64],[s*.07,.89,.4],.025,trim);
  rod(k,[s*.1,.38,-.6],[s*.12,.72,-.1],.025,paint(c));
  rod(k,[s*.12,.72,-.1],[s*.07,.88,.4],.025,paint(c));
  k.cyl(.115,.115,.15,s*.16,.46,.02,'#fff',{...dark,rz:Math.PI/2,segs:14});
  rod(k,[s*.18,.45,.08],[s*.25,.25,-.55],.035,trim);
 }
 shell(k,[[-.2,.76,.11,.08],[0,.79,.17,.12],[.24,.77,.13,.1]],paint(c),.8);
 k.capsule(.12,.2,0,.73,-.34,'#fff',{...rubber,rx:Math.PI/2,sz:.4});
 rod(k,[-.28,.98,.35],[.28,.98,.35],.02,trim);lamps(k,0,.82,.57,.08);
 // Sidecar chassis and tapered shell, with an open upholstered passenger well.
 rod(k,[0,.25,-.4],[.77,.25,-.2],.04,dark);tire(k,.83,.26,-.18,.26,.12);
 shell(k,[[-.74,.46,.14,.11],[-.56,.5,.25,.19],[.2,.5,.25,.18],[.55,.48,.12,.12]],paint(c),.8);
 // Shift only the sidecar shell parts just added, preserving material batching.
 const last=k.groups.get('vehicle_paint').at(-1);last.translate(.56,0,0);
 k.box(.34,.05,.42,.56,.68,-.23,'#fff',rubber);
 k.box(.35,.22,.06,.56,.72,-.48,'#fff',rubber);
 fender(k,.83,.26,-.18,.32,.18,c);
}

export function fieldCar(k,t){
 const c=t.color||'#72785e';chassis(k,[-.9,.9],.7,c,.31);
 for(const x of [-.7,.7])for(const z of [-.9,.9])fender(k,x,.31,z,.38,.26,c);
 shell(k,[[-1.32,.55,.49,.14],[-1.05,.54,.6,.18],[.65,.55,.6,.18],[1.28,.61,.43,.12]],paint(c),.4);
 // Open four-seat passenger tub, with stamped side panels and separate doors.
 for(const s of [-1,1]){
  quad(k,[[s*.6,.56,-1.12],[s*.6,.56,.45],[s*.68,.9,.4],[s*.66,.91,-1.04]],{...paint(c),mat:'vehicle_paint_double'});
  rod(k,[s*.66,.92,-1.04],[s*.68,.91,.4],.022,paint(c));
  for(const z of [-.66,.07]){
   rod(k,[s*.63,.62,z],[s*.665,.88,z],.012,dark);
   k.box(.028,.025,.11,s*.68,.85,z-.13,'#fff',trim);
  }
  for(let z=-.94;z<.4;z+=.13)rod(k,[s*.64,.62,z],[s*.66,.81,z+.035],.014,paint(c));
 }
 k.box(1.12,.04,1.39,0,.63,-.31,'#fff',dark);
 for(const z of [-.75,.05]){
  k.box(1.06,.12,.4,0,.73,z,'#fff',{mat:'canvas',tint:'#666450'});
  k.box(1.07,.31,.09,0,.88,z-.22,'#fff',{mat:'canvas',tint:'#64634f',rx:-.12});
 }
 k.box(1.15,.24,.12,0,.91,.46,'#fff',paint(c));
 pane(k,[[-.61,1.0,.52],[.61,1.0,.52],[.58,1.38,.35],[-.58,1.38,.35]]);
 for(const s of [-1,1])rod(k,[s*.63,.98,.53],[s*.6,1.4,.35],.026,paint(c));
 rod(k,[-.6,1.4,.35],[.6,1.4,.35],.025,paint(c));
 rod(k,[0,1.0,.54],[0,1.4,.36],.015,paint(c));
 k.torus(.14,.015,-.28,1.01,.23,'#fff',{...rubber,rx:-.6,segs:24});
 shell(k,[[.53,.78,.6,.06],[.9,.77,.54,.06],[1.28,.7,.43,.05]],paint(c),.7);
 // Flat spare wheel on the bonnet, plus engine-deck cooling slots at the rear.
 k.add(new THREE.TorusGeometry(.22,.075,8,28),'#fff',0,.93,.92,{...rubber,rx:-Math.PI/2+.12});
 k.cyl(.15,.15,.075,0,.93,.92,'#fff',{...paint(c),segs:20});
 k.box(1.12,.28,.09,0,.78,-1.13,'#fff',paint(c));
 for(let n=0;n<9;n++)k.box(.025,.025,.19,-.42+n*.105,.91,-1.12,'#fff',dark);
 lamps(k,.61,.73,1.08,.085);
 for(const z of [-1.37,1.37])rod(k,[-.71,.43,z],[.71,.43,z],.035,dark);
}
