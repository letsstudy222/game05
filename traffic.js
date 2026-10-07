import * as THREE from 'three';
import { createCar } from './vehicle.js?v=nt-city-02';
import { CITY } from './city.js?v=nt-city-02';

// Ambient cars follow lanes and yield near the city's timed traffic lights.
export function createTraffic(scene,world,roadCenterX,roadY) {
  const group=new THREE.Group();group.name='city-traffic';scene.add(group);
  const cars=[],palette=['#bd5750','#467c8a','#d3c9a5','#525e6a','#799a7f'];
  const corners=[];
  const point=(offset,z)=>corners.push(new THREE.Vector3(CITY.originX+offset,roadY(z),z));
  for(let off=90;off<=230;off+=20)point(off,2570);
  point(240,2580);for(let z=2600;z<=2990;z+=20)point(240,z);point(240,3010);
  for(let off=230;off>=90;off-=20)point(off,3020);
  point(80,3010);for(let z=2990;z>=2600;z-=20)point(80,z);point(80,2580);
  const cityLoop=new THREE.CatmullRomCurve3(corners,true,'centripetal');
  const coastPoints=[];
  for(let z=3100;z>=-3000;z-=100)coastPoints.push(new THREE.Vector3(roadCenterX(z)+2.1,roadY(z),z));
  const coast=new THREE.CatmullRomCurve3(coastPoints,false,'centripetal');
  for(let i=0;i<12;i++) {
    const model=createCar();model.group.children[0].material=model.group.children[0].material.clone();model.group.children[0].material.color.set(palette[i%palette.length]);
    model.group.traverse(o=>{if(o.isMesh)o.castShadow=true;});group.add(model.group);
    cars.push({model,path:i<7?cityLoop:coast,phase:i<7?i/7:(i-7)/5,speed:i<7?7:10,direction:i%2?-1:1,last:null});
  }
  let time=0,night=false;
  function update(t,driver) {
    const dt=Math.min(Math.max(t-time,0),.15);time=t;
    for(let i=0;i<cars.length;i++) {
      const c=cars[i],p=c.path.getPointAt(c.phase),tangent=c.path.getTangentAt(c.phase).multiplyScalar(c.direction);
      const inCity=c.path===cityLoop;
      const nearest=CITY.crossings.reduce((best,z)=>Math.abs(p.z-z)<Math.abs(p.z-best)?z:best,CITY.crossings[0]);
      const signalRed=(Math.floor(t/9)+CITY.crossings.indexOf(nearest)%2)%2===0;
      const approaching=signalRed&&Math.abs(p.z-nearest)>8&&Math.abs(p.z-nearest)<17&&((nearest-p.z)*tangent.z>0);
      const ahead=new THREE.Vector3(p.x+tangent.x*9,0,p.z+tangent.z*9);
      const yieldToPlayer=Math.hypot(ahead.x-driver.x,ahead.z-driver.z)<5;
      const moving=!(inCity&&approaching)&&!yieldToPlayer;
      if(moving)c.phase=(c.phase+c.direction*c.speed*dt/c.path.getLength()+1)%1;
      const pos=c.path.getPointAt(c.phase);
      if(inCity){pos.x-=tangent.z*1.8;pos.z+=tangent.x*1.8;}
      else if(c.direction<0){pos.x-=4.2;}
      c.model.group.position.set(pos.x,roadY(pos.z)+.015,pos.z);
      c.model.group.rotation.y=Math.atan2(tangent.x,tangent.z);
      c.model.group.visible=Math.hypot(pos.x-driver.x,pos.z-driver.z)<850;
      c.model.brakeMat.emissiveIntensity=moving?.15:2;
      c.model.wheels.forEach(w=>{if(moving)w.rotation.x+=c.speed*dt/.37;});
      for(const beam of c.model.beams){beam.visible=night&&i<2&&Math.hypot(pos.x-driver.x,pos.z-driver.z)<130;beam.intensity=beam.visible?380:0;}
      c.model.glows.forEach(g=>g.visible=night);
      // Soft collision response instead of passing through moving vehicles.
      if(!driver.teleported&&driver.kmh>1&&Math.hypot(pos.x-driver.x,pos.z-driver.z)<2.8) {
        driver.speed*=Math.exp(-dt*12);
        const dx=driver.x-pos.x,dz=driver.z-pos.z,len=Math.hypot(dx,dz)||1;
        driver.x+=dx/len*dt*2;driver.z+=dz/len*dt*2;
      }
    }
  }
  return {group,cars,update,setNight:value=>{night=value;}};
}
