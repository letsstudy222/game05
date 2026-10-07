// Geographic reference corridor, not a surveyed road centreline.
// Longitudes/latitudes are deliberately kept separate from the compressed game world.
export const ROUTE = [
  [109.196,12.245],[109.199,12.235],[109.207,12.220],[109.210,12.209],
  [109.195,12.202],[109.186,12.194],[109.192,12.185],[109.202,12.166],
  [109.210,12.146],[109.212,12.130],[109.201,12.120],[109.201,12.108],
  [109.199,12.090],[109.210,12.067],[109.215,12.050],[109.215,12.026],
  [109.208,12.000],[109.201,11.970],[109.181,11.948],[109.158,11.925]
];
export const LANDMARKS = [
  {name:'Trần Phú · Nha Trang',lat:12.238,lon:109.198,kind:'town',description:'Đại lộ, hàng dừa và bãi biển thành phố'},
  {name:'Cầu Bình Tân',lat:12.195,lon:109.187,kind:'village',description:'Cửa sông, thuyền cá và khu dân cư'},
  {name:'Đèo Cù Hin',lat:12.137,lon:109.211,kind:'rocky',description:'Đường uốn lượn giữa sườn núi và biển'},
  {name:'Bãi Dài',lat:12.075,lon:109.206,kind:'resort',description:'Cát sáng, sóng vỗ và những quán ven đường'},
  {name:'Bán đảo Cam Ranh',lat:12.012,lon:109.212,kind:'open',description:'Dải biển rộng và khu nghỉ dưỡng'},
  {name:'Cam Ranh',lat:11.932,lon:109.164,kind:'village',description:'Chặng cuối về phía vịnh Cam Ranh'}
];
export const latToZ = lat => (lat-12.085)*20000;
export const zToLat = z => 12.085+z/20000;
export const lonToX = lon => (109.210-lon)*12000;
export const xToLon = x => 109.210-x/12000;
export function coordinateAt(z) {
  const lat=zToLat(z);
  for(let i=0;i<ROUTE.length-1;i++) {
    const a=ROUTE[i],b=ROUTE[i+1];
    if(lat<=a[1] && lat>=b[1]) {
      const t=(a[1]-lat)/(a[1]-b[1]);
      return [a[0]+(b[0]-a[0])*t,lat];
    }
  }
  return [...ROUTE[lat>ROUTE[0][1]?0:ROUTE.length-1]];
}
// Smooth interpolation avoids visible corners at reference points.
export function routeX(z) {
  const lat=zToLat(z);
  for(let i=0;i<ROUTE.length-1;i++) {
    const a=ROUTE[i],b=ROUTE[i+1];
    if(lat<=a[1] && lat>=b[1]) {
      const t=(a[1]-lat)/(a[1]-b[1]), s=t*t*(3-2*t);
      return lonToX(a[0]+(b[0]-a[0])*s);
    }
  }
  return lonToX(ROUTE[lat>ROUTE[0][1]?0:ROUTE.length-1][0]);
}
export const STAGES = LANDMARKS.map((p,i) => ({...p,
  z0:i===LANDMARKS.length-1?-3200:latToZ((p.lat+LANDMARKS[i+1].lat)/2),
  z1:i===0?3200:latToZ((LANDMARKS[i-1].lat+p.lat)/2),
  z:latToZ(p.lat),id:i
})).reverse();
function distance(a,b) {
  const rad=Math.PI/180,dl=(b[1]-a[1])*rad,do_= (b[0]-a[0])*rad;
  const h=Math.sin(dl/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(do_/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export const ROUTE_KM=ROUTE.slice(1).reduce((sum,p,i)=>sum+distance(ROUTE[i],p),0);
