import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Small detailed roadside sets, batched in 400 m sections; animated sets are culled separately.
export function buildCoastalDetails(w) {
  const {heightAt,sidePoint,coastX,roadCenterX,districtAt,WORLD,rng,colliders}=w;
  const group=new THREE.Group(); group.name='coastal-details';
  const batches=new Map(), labels=[], boats=[];
  const color=new THREE.Color();
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.78,side:THREE.DoubleSide});
  function tint(g,c) {
    if(g.index){const source=g;g=g.toNonIndexed();source.dispose();}
    color.set(c); const a=new Float32Array(g.attributes.position.count*3);
    for(let i=0;i<a.length;i+=3){a[i]=color.r;a[i+1]=color.g;a[i+2]=color.b;}
    g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;
  }
  const box=(x,y,z,c,px=0,py=0,pz=0)=>{const g=tint(new THREE.BoxGeometry(x,y,z),c);g.translate(px,py,pz);return g;};
  const cylinder=(r,h,c,px=0,py=0,pz=0)=>{const g=tint(new THREE.CylinderGeometry(r,r,h,12),c);g.translate(px,py,pz);return g;};
  function place(parts,x,z,yaw=0,y=heightAt(x,z)) {
    const g=mergeGeometries(parts,false); for(const p of parts)p.dispose();
    g.rotateY(yaw);g.translate(x,y,z);
    const key=Math.floor(z/WORLD.chunk);
    if(!batches.has(key))batches.set(key,[]);batches.get(key).push(g);
  }
  function sign(text,x,y,z,yaw,width=5) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
    const c=canvas.getContext('2d');c.fillStyle='#174b50';c.fillRect(0,0,512,128);
    c.strokeStyle='#eadab1';c.lineWidth=6;c.strokeRect(8,8,496,112);
    c.fillStyle='#fff3d8';c.font='bold 38px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(text,256,64,470);
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(width,width/4),new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}));
    m.position.set(x,y,z);m.rotation.y=yaw;group.add(m);labels.push(m);
  }
  // Café counters, corrugated awnings, stools, iceboxes and hanging signs.
  const names=['CÀ PHÊ BIỂN','HẢI SẢN TƯƠI','DỪA XIÊM','QUÁN GIÓ BIỂN'];
  for(let z=-2800,i=0;z<3000;z+=280,i++) {
    const kind=districtAt(z).kind;
    if(kind==='rocky' && i%2)continue;
    const p=sidePoint(z,kind==='town'?22:17),parts=[];
    parts.push(box(7,3.6,5.2,'#ede0c6',0,1.8,1.2));
    parts.push(box(5.8,2.4,0.12,'#364e50',0,1.4,-1.5));
    const awning=box(8,0.14,4.6,i%2?'#bf6447':'#3c8c83',0,3.3,-1.8);awning.rotateX(0.05);parts.push(awning);
    for(let k=-3.5;k<=3.5;k+=7)parts.push(cylinder(0.07,3.2,'#e5ddd1',k,1.6,-3.5));
    for(let k=-3;k<=3;k+=0.75)parts.push(box(0.055,0.09,5.6,'#819394',k,3.67,1.3));
    parts.push(box(5.4,1.0,0.8,'#aa7955',0,0.5,-2.0));
    for(let k=-2;k<=2;k+=2) {
      parts.push(cylinder(0.55,0.1,'#bd915b',k,0.9,-5.2));
      parts.push(cylinder(0.065,0.9,'#4b514a',k,0.45,-5.2));
      for(const s of [-1,1])parts.push(box(0.55,0.5,0.55,'#bc4d3c',k+s*0.8,0.25,-5.2));
    }
    parts.push(box(0.9,0.8,0.7,'#377aa4',3.8,0.4,-2));
    const y=heightAt(p.x,p.z);place(parts,p.x,p.z,p.yaw,y);
    const face=new THREE.Vector3(0,3.0,-1.6).applyAxisAngle(new THREE.Vector3(0,1,0),p.yaw);
    sign(names[i%names.length],p.x+face.x,y+face.y,p.z+face.z,p.yaw+Math.PI);
    colliders.push({x:p.x,z:p.z,r:3.6});
  }
  // Bình Tân estuary: a short bridge with railings and piers above the water.
  const riverZ=2200,riverX=roadCenterX(riverZ);
  const river=new THREE.Mesh(new THREE.PlaneGeometry(650,64),new THREE.MeshStandardMaterial({color:'#418d98',roughness:.2,metalness:.15}));
  river.rotation.x=-Math.PI/2;river.position.set(riverX-135,.18,riverZ);river.name='binh-tan-estuary';group.add(river);
  const bridgeParts=[];
  for(let z=2176;z<=2224;z+=4) {
    for(const side of [-1,1]) {
      const p=sidePoint(z,side*5.8);
      place([box(.18,1.15,.18,'#d4d5c8',0,.57,0),box(.17,.13,4.4,'#e8e7d9',0,1.05,0)],p.x,p.z,p.roadYaw,w.roadY(z));
    }
    if(z%12===4)bridgeParts.push(box(1.0,5.5,1.3,'#a9b8b2',0,-2.8,z-riverZ));
  }
  place(bridgeParts,riverX,riverZ,0,w.roadY(riverZ));
  // Beach umbrellas, loungers, towels, driftwood and little boulders.
  for(let z=-3000;z<3100;z+=52) {
    const coast=coastX(z),town=districtAt(z).kind==='town';
    if(rng()>0.68)continue;
    const x=coast+19+rng()*8;
    const parts=[cylinder(0.055,2.6,'#a38d67',0,1.3,0)];
    const canopy=tint(new THREE.ConeGeometry(2.1,0.6,16,1,true),town?'#e9c885':rng()>0.5?'#d66d50':'#72b3ac');canopy.translate(0,2.6,0);parts.push(canopy);
    for(const off of [-1.2,1.2]) {
      const seat=box(0.7,0.13,1.9,'#faf1d9',off,0.38,2.1);seat.rotateX(-0.08);parts.push(seat);
      for(const l of [-0.5,0.5])parts.push(box(0.65,0.35,0.08,'#826647',off,0.18,2.1+l));
    }
    place(parts,x,z,rng()*0.4);
  }
  for(let z=-3100;z<3150;z+=19) {
    if(rng()>0.5)continue;
    const x=coastX(z)+6+rng()*10;
    const rock=tint(new THREE.IcosahedronGeometry(0.3+rng()*0.5,1),'#b2aa91');rock.scale(1.5,0.7,1);
    place([rock],x,z,rng()*6.28);
  }
  // A promenade with benches and crossings in the city stretch.
  for(let z=2460;z<3150;z+=55) {
    const p=sidePoint(z,-9);
    const parts=[box(2.8,0.12,0.65,'#9a7049',0,0.5,0),box(2.8,0.7,0.1,'#9a7049',0,0.95,-0.3)];
    for(const x of [-1,1])parts.push(box(0.1,0.5,0.6,'#414c4e',x,0.25,0));
    place(parts,p.x,p.z,p.roadYaw);
  }
  for(const z of [2650,2920]) {
    const p=sidePoint(z,0),parts=[];
    for(let i=-4;i<=4;i++)parts.push(box(0.55,0.015,3.4,'#eeeadf',i,0.09,0));
    place(parts,p.x,p.z,p.roadYaw);
  }
  // Long hulls with cabins, masts, outriggers and pennants, bobbing in the swell.
  for(let i=0;i<15;i++) {
    const z=i<7?2000+i*60:-2200+(i-7)*560;
    const x=coastX(z)-30-rng()*130,parts=[];
    const hull=tint(new THREE.SphereGeometry(1,20,10),'#267f99');hull.scale(2.2,0.9,6.8);parts.push(hull);
    parts.push(box(3.6,0.22,10,'#c9ad71',0,0.8,0));
    parts.push(box(2.7,2.1,2.9,'#f3e7cd',0,1.7,-1.6));
    parts.push(box(2.9,0.15,3.1,'#c45638',0,2.85,-1.6));
    parts.push(box(2.3,0.65,0.1,'#28434f',0,2.15,-0.1));
    parts.push(cylinder(0.07,6,'#786f56',0,3.6,2));
    parts.push(box(0.1,0.12,7,'#bcb391',3.2,0.7,0),box(0.1,0.12,7,'#bcb391',-3.2,0.7,0));
    for(const k of [-2,2])parts.push(box(7,0.1,0.12,'#bcb391',0,1.2,k));
    const mesh=new THREE.Mesh(mergeGeometries(parts,false),material);for(const p of parts)p.dispose();
    const boat=new THREE.Group();boat.add(mesh);boat.position.set(x,0.2,z);boat.rotation.y=rng()*6.28;
    const flag=new THREE.Mesh(new THREE.PlaneGeometry(1.1,0.7,5,2),new THREE.MeshBasicMaterial({color:'#d84435',side:THREE.DoubleSide}));flag.position.set(0.55,6.25,2);boat.add(flag);
    const star=new THREE.Mesh(new THREE.CircleGeometry(0.16,5),new THREE.MeshBasicMaterial({color:'#ffdc56',side:THREE.DoubleSide}));star.position.set(0.55,6.25,2.01);boat.add(star);
    boat.userData.yaw=boat.rotation.y;boat.userData.z=z;group.add(boat);boats.push(boat);
  }
  // Rocky headlands beyond the drivable corridor give the bay a distant silhouette.
  for(const z of [-2200,400,1900]) {
    const x=coastX(z)-550;
    const rock=tint(new THREE.IcosahedronGeometry(1,2),'#5d7d67');rock.scale(150,70,270);
    place([rock],x,z,0,-18);
  }
  const chunks=[];
  for(const [key,geos] of batches) {
    const mesh=new THREE.Mesh(mergeGeometries(geos,false),material);for(const g of geos)g.dispose();
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.z=key*WORLD.chunk+WORLD.chunk/2;
    mesh.name='beach-section-'+key;group.add(mesh);chunks.push(mesh);
  }
  return {group,
    update(t,camZ=0) {
      river.visible=Math.abs(riverZ-camZ)<1300;
      for(const mesh of chunks)mesh.visible=Math.abs(mesh.userData.z-camZ)<1500;
      for(const label of labels)label.visible=Math.abs(label.position.z-camZ)<420;
      for(let i=0;i<boats.length;i++) {
        const b=boats[i];b.visible=Math.abs(b.userData.z-camZ)<1300;
        if(!b.visible)continue;
        b.position.y=0.25+Math.sin(t*0.9+i)*0.22;
        b.rotation.set(Math.sin(t*0.7+i)*0.025,b.userData.yaw,Math.sin(t*1.1+i)*0.035);
        const a=b.children[1].geometry.attributes.position;
        for(let k=0;k<a.count;k++)a.setZ(k,Math.sin(a.getX(k)*5-t*3)*0.08);a.needsUpdate=true;
      }
    },
    setNight(n){material.emissive.set(n?'#091419':'#000000');}
  };
}
