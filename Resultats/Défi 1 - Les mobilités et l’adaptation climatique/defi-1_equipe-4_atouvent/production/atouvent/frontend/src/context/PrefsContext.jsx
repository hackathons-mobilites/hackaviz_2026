// Préférences d'affichage et d'annonces : appliquées tout de suite, gardées sur l'appareil, et envoyées au compte si l'usager est connecté.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { storage } from '../utils/storage.js'
import { useAuth } from './AuthContext.jsx'

const KEY = 'atv.prefs'
// use_location : position utilisée (choix de l'inscription) · avoid_noac : éviter les lignes non climatisées
const DEFAULTS = { text_size: 2, high_contrast: false, voice: false, vibrate: true, step_free: false, warn_before: true,
  use_location: true, avoid_noac: false, needs: null, visual_alerts: false, simple: false }

const PrefsContext = createContext(null)

export function PrefsProvider({ children }) {
  const { user, ready, update } = useAuth()
  const [prefs, setPrefs] = useState(() => ({ ...DEFAULTS, ...storage.getJSON(KEY, {}) }))

  // Le compte fait foi quand il est chargé.
  useEffect(() => {
    if (!ready) return
    if (!user) {
      setPrefs((p) => ({ ...p, step_free: false, needs: null, visual_alerts: false, simple: false }))
      return
    }
    setPrefs((p) => ({
      ...p, text_size: user.text_size, high_contrast: user.high_contrast, voice: user.voice, vibrate: user.vibrate,
      step_free: Boolean(user.settings?.sans_marche), needs: null,
      // Malentendant : alertes visuelles · lecture difficile : affichage simplifié · sensible au climat : éviter les lignes sans clim
      visual_alerts: Boolean(user.settings?.alertes_visuelles), simple: Boolean(user.settings?.mode_simplifie),
      avoid_noac: p.avoid_noac || Boolean(user.settings?.alertes_meteo_renforcees),
    }))
  }, [user, ready])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.text = String(prefs.text_size)
    root.dataset.contrast = prefs.high_contrast ? 'high' : 'normal'
    storage.setJSON(KEY, prefs)
  }, [prefs])

  const set = useCallback((patch) => {
    setPrefs((p) => ({ ...p, ...patch }))
    const synced = Object.fromEntries(Object.entries(patch).filter(([k]) => k in { text_size: 1, high_contrast: 1, voice: 1, vibrate: 1 }))
    if (user && Object.keys(synced).length) update(synced).catch(() => { /* resynchronisé à la prochaine connexion */ })
  }, [user, update])

  const value = useMemo(() => ({ prefs, set }), [prefs, set])
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export const usePrefs = () => useContext(PrefsContext)
