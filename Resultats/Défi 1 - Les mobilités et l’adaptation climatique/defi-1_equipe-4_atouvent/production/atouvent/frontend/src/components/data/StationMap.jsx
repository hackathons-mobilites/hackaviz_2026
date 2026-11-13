// Carte des gares : couleur = climatisation des lignes, taille = baisse de fréquentation les jours de chaleur.
import { useEffect, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { loadMaplibre } from '../../features/maplibre.js'
import { STYLE } from '../MapView.jsx'
import { cssVar } from '../../pages/data/format.js'

const CENTER = [2.37, 48.86]

function geojson(stations, threshold) {
  return {
    type: 'FeatureCollection',
    features: stations.map((s) => ({
      type: 'Feature', id: Number(s.id),
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id, name: s.name, ac: s.ac, drop: Math.max(0, -(s.change[threshold] ?? 0)), vuln: s.vuln_day ?? -1, poor: s.poor ?? -1 },
    })),
  }
}

// Style des points selon la vue : baisse de fréquentation (climatisation), îlots de chaleur ou ménages modestes
function paint(view) {
  const ramp = (field, lo, hi, a, b) => ['case', ['<', ['get', field], 0], cssVar('--serie-neutre'),
    ['interpolate', ['linear'], ['get', field], a, cssVar(lo), b, cssVar(hi)]]
  if (view === 'heat') return { color: ramp('vuln', '--seq-heat-lo', '--seq-heat-hi', 3, 8), radius: 6 }
  if (view === 'poor') return { color: ramp('poor', '--seq-poor-lo', '--seq-poor-hi', 5, 40), radius: 6 }
  return null
}

export default function StationMap({ stations, threshold, selected, onSelect, label, tooltip, view = 'drop' }) {
  const box = useRef(null)
  const map = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadMaplibre().then((maplibregl) => {
      if (cancelled || !box.current) return
      const m = new maplibregl.Map({ container: box.current, style: STYLE, center: CENTER, zoom: 10.2, attributionControl: { compact: true } })
      map.current = m
      // Le cadre prend sa taille définitive après le premier rendu : on redimensionne la carte avec lui
      const ro = new ResizeObserver(() => m.resize())
      ro.observe(box.current)
      m.once('remove', () => ro.disconnect())
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'dash-popup' })
      m.on('load', () => {
        // Fond de carte en gris clair : seules les gares portent de la couleur
        m.setPaintProperty('ign', 'raster-saturation', -1)
        m.setPaintProperty('ign', 'raster-opacity', 0.55)
        const c1 = cssVar('--serie-1')
        const c2 = cssVar('--serie-2')
        const neutral = cssVar('--serie-neutre')
        m.addSource('gares', { type: 'geojson', data: geojson([], threshold) })
        m.addLayer({
          id: 'gares', type: 'circle', source: 'gares',
          paint: {
            // Rayon selon la baisse (0 % → 3 px, 30 % et plus → 20 px)
            'circle-radius': ['interpolate', ['linear'], ['get', 'drop'], 0, 3, 30, 20],
            'circle-color': ['match', ['get', 'ac'], 'equipee', c1, 'non', c2, '#FFFFFF'],
            'circle-opacity': ['match', ['get', 'ac'], 'partielle', 0.85, 0.55],
            'circle-stroke-color': ['match', ['get', 'ac'], 'equipee', c1, 'non', c2, neutral],
            'circle-stroke-width': ['match', ['get', 'ac'], 'partielle', 2, 1.5],
          },
        })
        m.addLayer({
          id: 'choisie', type: 'circle', source: 'gares', filter: ['==', ['get', 'id'], ''],
          paint: { 'circle-radius': ['+', ['interpolate', ['linear'], ['get', 'drop'], 0, 3, 30, 20], 6], 'circle-color': 'transparent',
            'circle-stroke-color': cssVar('--texte'), 'circle-stroke-width': 2.5 },
        })
        m.on('click', 'gares', (e) => onSelect(e.features[0].properties.id))
        m.on('mousemove', 'gares', (e) => {
          m.getCanvas().style.cursor = 'pointer'
          popup.setLngLat(e.features[0].geometry.coordinates).setText(tooltip(e.features[0].properties)).addTo(m)
        })
        m.on('mouseleave', 'gares', () => { m.getCanvas().style.cursor = ''; popup.remove() })
        setReady(true)
      })
    })
    return () => { cancelled = true; map.current?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (ready) map.current.getSource('gares').setData(geojson(stations, threshold))
  }, [ready, stations, threshold])

  // Changement de vue : couleur et taille des points
  useEffect(() => {
    if (!ready) return
    const m = map.current
    const p = paint(view)
    if (!m.base) m.base = { color: m.getPaintProperty('gares', 'circle-color'), radius: m.getPaintProperty('gares', 'circle-radius'),
      opacity: m.getPaintProperty('gares', 'circle-opacity'), stroke: m.getPaintProperty('gares', 'circle-stroke-color') }
    m.setPaintProperty('gares', 'circle-color', p ? p.color : m.base.color)
    m.setPaintProperty('gares', 'circle-radius', p ? p.radius : m.base.radius)
    m.setPaintProperty('gares', 'circle-opacity', p ? 0.9 : m.base.opacity)
    m.setPaintProperty('gares', 'circle-stroke-color', p ? cssVar('--surface') : m.base.stroke)
  }, [ready, view])

  useEffect(() => {
    if (!ready) return
    map.current.setFilter('choisie', ['==', ['get', 'id'], selected || ''])
    const s = stations.find((x) => x.id === selected)
    if (s) map.current.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.current.getZoom(), 11) })
  }, [ready, selected, stations])

  return <div ref={box} className="dash-map" role="region" aria-label={label} />
}
