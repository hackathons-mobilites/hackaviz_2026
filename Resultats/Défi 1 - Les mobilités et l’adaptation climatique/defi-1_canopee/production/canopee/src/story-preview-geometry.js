import { shadowOffset } from './sun.js';

// The same convex envelope used by the tool for its ground-shadow display.
function hull(points) {
  const sorted = points.slice().sort((a,b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o,a,b) => (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const half = points => {
    const out = [];
    for (const p of points) {
      while (out.length >= 2 && cross(out.at(-2),out.at(-1),p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const ring = [...half(sorted).slice(0,-1), ...half(sorted.reverse()).slice(0,-1)];
  return ring.length >= 3 ? [...ring,ring[0]] : null;
}
export function groundShadows(buildings, sun) {
  if (!sun?.up || sun.altitude <= .5) return { type: 'FeatureCollection', features: [] };
  const features = [];
  for (const building of buildings.features) {
    const h = building.properties.h;
    const ring = building.geometry.type === 'Polygon' ? building.geometry.coordinates[0] : building.geometry.coordinates[0][0];
    const offset = shadowOffset(sun.altitude*Math.PI/180, sun.azimuth*Math.PI/180,h,180);
    if (!offset || !ring || ring.length < 4) continue;
    const dx = offset.east/(111320*Math.cos(ring[0][1]*Math.PI/180));
    const dy = offset.north/110540;
    const outline = hull(ring.slice(0,-1).flatMap(p => [p,[p[0]+dx,p[1]+dy]]));
    if (outline) features.push({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[outline]}});
  }
  return {type:'FeatureCollection',features};
}
