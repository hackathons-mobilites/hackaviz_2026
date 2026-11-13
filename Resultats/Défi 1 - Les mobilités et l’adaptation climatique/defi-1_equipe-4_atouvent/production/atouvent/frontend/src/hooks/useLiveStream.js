// Flux en direct (Server-Sent Events) : le serveur pousse chaque changement (climat, perturbations, ascenseurs, Vélib', signalements) en quelques secondes, sans que l'application ait à redemander.
import { useEffect, useRef } from 'react'
import { API_BASE } from '../api/client.js'

export function useLiveStream({ lat, lon, lines = [] }, handlers, enabled = true) {
  const h = useRef(handlers)
  h.current = handlers
  const key = `${lat?.toFixed?.(3)},${lon?.toFixed?.(3)},${[...lines].sort().join(',')}`
  useEffect(() => {
    if (!enabled || lat == null || lon == null || typeof EventSource === 'undefined') return undefined
    const url = new URL(`${API_BASE}/stream`, window.location.origin)
    url.searchParams.set('lat', lat)
    url.searchParams.set('lon', lon)
    if (lines.length) url.searchParams.set('lines', lines.join(','))
    const es = new EventSource(url)
    const kinds = ['climate', 'traffic', 'elevators', 'velib', 'reports']
    const listeners = kinds.map((k) => [k, (e) => {
      try { h.current[k]?.(JSON.parse(e.data)) } catch { /* message incomplet : ignoré */ }
    }])
    listeners.forEach(([k, fn]) => es.addEventListener(k, fn))
    return () => { listeners.forEach(([k, fn]) => es.removeEventListener(k, fn)); es.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
}
