// Position GPS. Statuts : searching, ok, lost (plus de signal, ex. sous terre), denied, unsupported.
import { useEffect, useRef, useState } from 'react'

const LOST_AFTER_MS = 30_000

// enabled = false : l'usager a refusé l'usage de sa position dans l'application (statut « denied »)
export function useGeolocation({ watch = false, enabled = true } = {}) {
  const [state, setState] = useState({ status: !enabled ? 'denied' : 'navigator' in globalThis && navigator.geolocation ? 'searching' : 'unsupported', coords: null, at: null })
  const last = useRef(null)

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return undefined
    const ok = (p) => {
      last.current = Date.now()
      setState({ status: 'ok', coords: { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }, at: p.timestamp })
    }
    const fail = (e) => setState((s) => ({ ...s, status: e.code === 1 ? 'denied' : s.coords ? 'lost' : 'searching' }))
    const opts = { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }

    if (!watch) {
      navigator.geolocation.getCurrentPosition(ok, fail, opts)
      return undefined
    }
    const id = navigator.geolocation.watchPosition(ok, fail, opts)
    // Aucun point depuis 30 s : signal perdu (on garde la dernière position connue)
    const timer = setInterval(() => {
      if (last.current && Date.now() - last.current > LOST_AFTER_MS) setState((s) => (s.status === 'ok' ? { ...s, status: 'lost' } : s))
    }, 5_000)
    return () => {
      navigator.geolocation.clearWatch(id)
      clearInterval(timer)
    }
  }, [watch, enabled])

  return state
}
