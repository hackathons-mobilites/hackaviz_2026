export function createToolPreview(data, motion) {
  const container = document.getElementById('tool-preview-map');
  const status = document.getElementById('preview-status');
  let map, frame, lastTime, ready = false, visible = false, starting = false;
  const stop = () => { cancelAnimationFrame(frame); frame = null; lastTime = null; };
  const tick = time => {
    frame = null;
    if (!ready || !visible || document.hidden || motion.reduced()) return;
    if (lastTime != null) map.setBearing(map.getBearing() + Math.min(80,time-lastTime)*.004);
    lastTime = time;
    frame = requestAnimationFrame(tick);
  };
  const resume = () => { stop(); if (ready && visible && !document.hidden && !motion.reduced()) frame = requestAnimationFrame(tick); };
  async function start() {
    if (starting) return;
    starting = true;
    try {
      const [mapModule, { default: workerUrl }, response] = await Promise.all([
        import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'), fetch('./data/story-preview.json'), import('maplibre-gl/dist/maplibre-gl.css')
      ]);
      const maplibregl = mapModule.default || mapModule;
      if (!response.ok) throw new Error('Aperçu indisponible');
      const preview = await response.json();
      const example = data.examples.find(e=>e.id==='republique');
      const route = example.comparisons.find(c=>c.season==='ete' && c.hour===16);
      const collection = features => ({type:'FeatureCollection',features});
      maplibregl.setWorkerUrl(workerUrl);
      map = new maplibregl.Map({
        container, interactive: false, attributionControl: false,
        center: [2.3597,48.8661], zoom: 16.65, pitch: 58, bearing: -24,
        style: {
          version: 8,
          light: { anchor: 'map', position: [1.5,235.8,35.6], intensity: .45, color: '#fff8e8' },
          sources: {
            buildings: {type:'geojson', data: preview.buildings},
            shadows: {type:'geojson', data: preview.shadows},
            streets: {type:'geojson', data: collection(route.streets.map(s=>({type:'Feature',properties:{s:s.shade},geometry:{type:'LineString',coordinates:s.path}})))},
            route: {type:'geojson', data: {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:route.preferred.path}}},
          },
          layers: [
            {id:'ground',type:'background',paint:{'background-color':'#eceeeb'}},
            {id:'streets',type:'line',source:'streets',paint:{'line-width':5,'line-color':['interpolate',['linear'],['get','s'],0,'#f4d27a',.5,'#5ba3d9',1,'#0055a4']},layout:{'line-cap':'round'}},
            {id:'shadows',type:'fill',source:'shadows',paint:{'fill-color':'#2a313c','fill-opacity':.32}},
            {id:'building-volumes',type:'fill-extrusion',source:'buildings',paint:{'fill-extrusion-color':'#e4d5c0','fill-extrusion-height':['get','h'],'fill-extrusion-opacity':1,'fill-extrusion-base':0}},
            {id:'route-halo',type:'line',source:'route',paint:{'line-color':'#fffaf2','line-width':11},layout:{'line-cap':'round','line-join':'round'}},
            {id:'route',type:'line',source:'route',paint:{'line-color':'#142b44','line-width':5},layout:{'line-cap':'round','line-join':'round'}},
          ],
        },
      });
      map.on('load', () => {
        ready = true;
        container.dataset.ready = 'true';
        container.dataset.buildings = preview.buildings.features.length;
        container.dataset.shadows = preview.shadows.features.length;
        status.textContent = '25 juin, 16 h — bâtiments IGN';
        resume();
      });
      new ResizeObserver(()=>map.resize()).observe(container);
    } catch (error) {
      status.textContent = 'Ouvrez la carte pour explorer le quartier.';
      container.dataset.error = error.message;
    }
  }
  new IntersectionObserver(entries=>{
    visible = entries[0].isIntersecting;
    if (visible) { start(); resume(); } else stop();
  }, {threshold:.15}).observe(container);
  document.addEventListener('visibilitychange',resume);
  motion.onChange(resume);
  window.addEventListener('pagehide',()=>{stop();map?.remove();});
}
