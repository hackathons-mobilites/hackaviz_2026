// Carte MapLibre sur fond IGN Plan v2 (Géoplateforme, sans clé). Chargée seulement si affichée.
import { useEffect, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { loadMaplibre } from '../features/maplibre.js'

const IGN = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'
  + '&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'

export const STYLE = {
  version: 8,
  sources: { ign: { type: 'raster', tiles: [IGN], tileSize: 256, attribution: '© IGN Géoplateforme' } },
  layers: [{ id: 'ign', type: 'raster', source: 'ign' }],
}

/** Cercle de précision du GPS (polygone de 48 côtés, rayon en mètres) */
function accuracyCircle({ lat, lon, accuracy }) {
  const r = Math.max(accuracy || 0, 5)
  const dLat = r / 111_320
  const dLon = r / (111_320 * Math.cos((lat * Math.PI) / 180))
  const ring = Array.from({ length: 49 }, (_, i) => {
    const a = (i / 48) * 2 * Math.PI
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]
  })
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/** markers : [{ lat, lon, label, kind }] · kind = velib | stop | report | dest… me : position en direct de l'appareil { lat, lon, accuracy } (repère qui se déplace et cercle de précision) lines : [{ coords: [[lon, lat], …], color, dashed }] (tracé du trajet, une ligne par étape) */
export default function MapView({ center, markers = [], label, zoom = 15, lines = null, follow = true, fit = false, me = null, meLabel = '' }) {
  const box = useRef(null)
  const map = useRef(null)
  const pins = useRef([])
  const mePin = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadMaplibre().then((maplibregl) => {
      if (cancelled || !box.current) return
      map.current = new maplibregl.Map({ container: box.current, style: STYLE, center: [center.lon, center.lat], zoom, attributionControl: { compact: true } })
      map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
      map.current.maplibregl = maplibregl
      map.current.on('load', () => {
        map.current.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.current.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#FFFFFF', 'line-width': 9 } })
        map.current.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-dasharray': ['case', ['get', 'dashed'], ['literal', [1, 1.5]], ['literal', [1, 0]]] } })
        // Précision du GPS : disque bleu léger autour de la position
        map.current.addSource('me-accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.current.addLayer({ id: 'me-accuracy', type: 'fill', source: 'me-accuracy', paint: { 'fill-color': '#1A5C96', 'fill-opacity': 0.12 } })
        map.current.addLayer({ id: 'me-accuracy-line', type: 'line', source: 'me-accuracy', paint: { 'line-color': '#1A5C96', 'line-width': 1.5 } })
        setReady(true)
      })
    })
    return () => {
      cancelled = true
      map.current?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recentrage et marqueurs
  useEffect(() => {
    const m = map.current
    if (!ready) return
    // fit : cadrage sur tous les marqueurs (et le tracé), sinon centrage sur la position
    const pts = fit ? [...markers.map((mk) => [mk.lon, mk.lat]), ...(lines || []).flatMap((l) => l.coords)] : []
    if (pts.length > 1) {
      const lons = pts.map((p) => p[0])
      const lats = pts.map((p) => p[1])
      m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 36, maxZoom: 17, duration: 400 })
    } else if (follow) m.easeTo({ center: [center.lon, center.lat] })
    pins.current.forEach((p) => p.remove())
    pins.current = markers.map((mk) => {
      const el = document.createElement('div')
      el.className = `map-pin map-pin--${mk.kind}${mk.text ? ' map-pin--label' : ''}${mk.selected ? ' map-pin--on' : ''}`
      el.setAttribute('aria-hidden', 'true')
      if (mk.text) el.textContent = mk.text
      // Le marqueur se touche (la liste sous la carte fait la même chose au clavier)
      if (mk.onClick) { el.style.cursor = 'pointer'; el.addEventListener('click', mk.onClick) }
      return new m.maplibregl.Marker({ element: el }).setLngLat([mk.lon, mk.lat]).addTo(m)
    })
  }, [ready, center.lat, center.lon, markers, follow, fit])

  // Position en direct : on déplace le repère existant (pas de recréation, pas de recentrage forcé)
  useEffect(() => {
    const m = map.current
    if (!ready) return
    if (!me) {
      mePin.current?.remove()
      mePin.current = null
      m.getSource('me-accuracy').setData({ type: 'FeatureCollection', features: [] })
      return
    }
    if (!mePin.current) {
      const el = document.createElement('div')
      el.className = 'map-me'
      el.setAttribute('aria-hidden', 'true')
      mePin.current = new m.maplibregl.Marker({ element: el }).setLngLat([me.lon, me.lat]).addTo(m)
    } else mePin.current.setLngLat([me.lon, me.lat])
    m.getSource('me-accuracy').setData(accuracyCircle(me))
  }, [ready, me?.lat, me?.lon, me?.accuracy]) // eslint-disable-line react-hooks/exhaustive-deps

  const centerOnMe = () => me && map.current?.easeTo({ center: [me.lon, me.lat], zoom: Math.max(map.current.getZoom(), 16) })

  // Tracé du trajet
  useEffect(() => {
    if (!ready || !lines) return
    map.current.getSource('route').setData({ type: 'FeatureCollection', features: lines.map((l) => ({
      type: 'Feature', properties: { color: l.color || '#1A5C96', dashed: Boolean(l.dashed) },
      geometry: { type: 'LineString', coordinates: l.coords } })) })
  }, [ready, lines])

  // La carte est un complément : la même information existe en liste juste en dessous « region » et non « img » : les boutons de zoom restent atteignables au clavier et au lecteur d'écran
  return (
    <div className="map-wrap">
      <div ref={box} className="map" role="region" aria-label={label} />
      {/* Recentrer sur sa position : bouton texte, utilisable au clavier */}
      {me && <button type="button" className="map-locate" onClick={centerOnMe}>{meLabel}</button>}
    </div>
  )
}
