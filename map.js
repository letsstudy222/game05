import { ROUTE, LANDMARKS, ROUTE_KM, latToZ, xToLon, zToLat } from './route.js';

export async function createRouteMap({getCar,onOpen,onClose,travel}) {
  const dialog=document.getElementById('mapDialog'),canvas=document.getElementById('detailMap'),ctx=canvas.getContext('2d');
  const coast=await fetch('./data/coastline.geojson').then(r=>{if(!r.ok)throw new Error('Không tải được dữ liệu bờ biển');return r.json();});
  let zoom=1,center=[109.205,12.085],width=600,height=600,base=1300,selected=0;
  const pointers=new Map();let pinchDistance=0;
  const project=([lon,lat])=>[width/2+(lon-center[0])*base*zoom*Math.cos(12.085*Math.PI/180),height/2-(lat-center[1])*base*zoom];
  const unproject=([x,y])=>[center[0]+(x-width/2)/(base*zoom*Math.cos(12.085*Math.PI/180)),center[1]-(y-height/2)/(base*zoom)];
  function resize() {
    const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;
    width=r.width;height=r.height;base=Math.min(width/.38,height/.40);
    const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw();
  }
  function path(points) {ctx.beginPath();points.forEach((p,i)=>{const [x,y]=project(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});}
  function label(text,x,y,color='#294b4c',size=11) {
    ctx.font=`${size}px sans-serif`;ctx.lineWidth=3;ctx.strokeStyle='#f0efdf';ctx.strokeText(text,x,y);ctx.fillStyle=color;ctx.fillText(text,x,y);
  }
  function draw() {
    if(!dialog.open)return;
    ctx.clearRect(0,0,width,height);ctx.fillStyle='#87bdc5';ctx.fillRect(0,0,width,height);
    for(const f of coast.features) {
      const points=f.geometry.coordinates;path(points);
      if(points.length>45) {
        const end=project([108.8,points[points.length-1][1]]),start=project([108.8,points[0][1]]);
        ctx.lineTo(...end);ctx.lineTo(...start);
      }
      ctx.closePath();ctx.fillStyle='#e6e3ca';ctx.fill();
      path(points);ctx.strokeStyle='#f4eccc';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='#608f8b';ctx.lineWidth=1;ctx.stroke();
    }
    // Geographic graticule helps orientation without inventing secondary roads.
    ctx.strokeStyle='#284d4510';ctx.lineWidth=1;
    for(let lon=109.08;lon<109.4;lon+=.05){path([[lon,11.8],[lon,12.35]]);ctx.stroke();}
    for(let lat=11.85;lat<12.35;lat+=.05){path([[109.05,lat],[109.4,lat]]);ctx.stroke();}
    path(ROUTE);ctx.strokeStyle='#fff9e9';ctx.lineWidth=7;ctx.lineJoin='round';ctx.stroke();ctx.strokeStyle='#bf774b';ctx.lineWidth=3;ctx.setLineDash([7,3]);ctx.stroke();ctx.setLineDash([]);
    for(let i=0;i<LANDMARKS.length;i++) {
      const p=LANDMARKS[i],[x,y]=project([p.lon,p.lat]);
      ctx.beginPath();ctx.arc(x,y,i===selected?6:4,0,Math.PI*2);ctx.fillStyle=i===selected?'#173f48':'#bf774b';ctx.fill();ctx.strokeStyle='#fff8e6';ctx.lineWidth=2;ctx.stroke();
      label(p.name,x+11,y-8,'#244b4d',i===selected?12:10);
    }
    const car=getCar();if(car) {
      const pos=[xToLon(car.x),zToLat(car.z)],[x,y]=project(pos);
      ctx.beginPath();ctx.arc(x,y,17,0,Math.PI*2);ctx.fillStyle='#174e6025';ctx.fill();
      ctx.save();ctx.translate(x,y);ctx.rotate(-car.yaw);ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(7,8);ctx.lineTo(0,4);ctx.lineTo(-7,8);ctx.closePath();ctx.fillStyle='#174e60';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.restore();
      document.getElementById('mapPosition').textContent=`${pos[1].toFixed(4)}°N · ${pos[0].toFixed(4)}°E (tham chiếu)`;
    }
    const sea=project([109.31,12.075]);label('BIỂN ĐÔNG',sea[0],sea[1],'#3b7a89',13);
    ctx.fillStyle='#234f59';ctx.font='bold 12px sans-serif';ctx.fillText('N ↑',width-43,86);
    // An approximate latitude scale; lengths refer to the geographic overview.
    const px=base*zoom*.01;ctx.fillStyle='#264d52';ctx.fillRect(18,height-67,px,2);ctx.font='9px sans-serif';ctx.fillText('≈ 1.1 km',18,height-74);
  }
  function setZoom(value,anchor=[width/2,height/2]) {
    const before=unproject(anchor);zoom=Math.max(.7,Math.min(12,value));const after=unproject(anchor);
    center[0]+=before[0]-after[0];center[1]+=before[1]-after[1];draw();
  }
  document.getElementById('routeLength').textContent=`6 chặng khám phá · khoảng ${Math.round(ROUTE_KM)} km theo tuyến tham chiếu`;
  const list=document.getElementById('stageList');
  LANDMARKS.forEach((p,i)=> {
    const button=document.createElement('button');button.className='stage-button';button.dataset.stage=i;
    const n=document.createElement('span');n.className='number';n.textContent=String(i+1).padStart(2,'0');
    const text=document.createElement('span');text.textContent=p.name;
    const small=document.createElement('small');small.textContent=p.description;text.append(small);button.append(n,text);
    button.addEventListener('click',()=>{selected=i;center=[p.lon,p.lat];zoom=3;draw();updateSelection();});
    // Explicit second action avoids unexpected teleportation when merely inspecting the map.
    const go=document.createElement('button');go.className='stage-button';go.textContent=`Lái từ ${p.name}`;go.style.display='none';go.dataset.travel=i;
    go.addEventListener('click',()=>{travel(latToZ(p.lat));dialog.close();});list.append(button,go);
  });
  function updateSelection() {
    list.querySelectorAll('[data-stage]').forEach(b=>b.classList.toggle('active',Number(b.dataset.stage)===selected));
    list.querySelectorAll('[data-travel]').forEach(b=>b.style.display=Number(b.dataset.travel)===selected?'block':'none');
  }
  updateSelection();
  function open(){if(dialog.open)return;onOpen();dialog.showModal();resize();document.getElementById('mapClose').focus();}
  function close(){if(dialog.open)dialog.close();}
  for(const id of ['mapBox','mapOpen'])document.getElementById(id).addEventListener('click',open);
  document.getElementById('mapClose').addEventListener('click',close);
  dialog.addEventListener('close',()=>{pointers.clear();pinchDistance=0;onClose();});
  document.getElementById('zoomIn').addEventListener('click',()=>setZoom(zoom*1.4));
  document.getElementById('zoomOut').addEventListener('click',()=>setZoom(zoom/1.4));
  document.getElementById('mapCenter').addEventListener('click',()=>{const car=getCar();if(car)center=[xToLon(car.x),zToLat(car.z)];zoom=Math.max(zoom,3);draw();});
  document.getElementById('mapFit').addEventListener('click',()=>{center=[109.205,12.085];zoom=1;draw();});
  canvas.addEventListener('wheel',e=>{e.preventDefault();setZoom(zoom*Math.exp(-e.deltaY*.002),[e.offsetX,e.offsetY]);},{passive:false});
  canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);pinchDistance=0;});
  canvas.addEventListener('pointermove',e=>{
    const last=pointers.get(e.pointerId);if(!last)return;
    pointers.set(e.pointerId,[e.clientX,e.clientY]);
    if(pointers.size===2) {
      const [a,b]=[...pointers.values()],distance=Math.hypot(a[0]-b[0],a[1]-b[1]);
      const r=canvas.getBoundingClientRect(),anchor=[(a[0]+b[0])/2-r.left,(a[1]+b[1])/2-r.top];
      if(pinchDistance>0)setZoom(zoom*distance/pinchDistance,anchor);pinchDistance=distance;
    } else {
      center[0]-=(e.clientX-last[0])/(base*zoom*Math.cos(12.085*Math.PI/180));center[1]+=(e.clientY-last[1])/(base*zoom);draw();
    }
  });
  const release=e=>{pointers.delete(e.pointerId);pinchDistance=0;};
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  new ResizeObserver(resize).observe(canvas);
  return {open,close,get isOpen(){return dialog.open;},get zoom(){return zoom;},get center(){return [...center];},draw};
}
