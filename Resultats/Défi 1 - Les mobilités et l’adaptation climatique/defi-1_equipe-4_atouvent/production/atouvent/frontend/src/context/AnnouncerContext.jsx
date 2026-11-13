// Annonces : texte lu par les lecteurs d'écran, voix naturelle (option), vibration (option) et bandeau visuel bien visible (profil malentendant, ou annonce urgente).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useI18n } from '../i18n/index.jsx'
import { speak } from '../utils/voice.js'
import { usePrefs } from './PrefsContext.jsx'

const AnnouncerContext = createContext(null)

export function AnnouncerProvider({ children }) {
  const { locale, t } = useI18n()
  const { prefs } = usePrefs()
  const [message, setMessage] = useState({ text: '', urgent: false, id: 0 })
  const [toast, setToast] = useState(null)

  const announce = useCallback((text, { urgent = false } = {}) => {
    setMessage((m) => ({ text, urgent, id: m.id + 1 }))
    if (prefs.voice) speak(text, locale, { urgent })
    if (prefs.vibrate && navigator.vibrate) navigator.vibrate(urgent ? [200, 100, 200, 100, 200] : [200, 100, 200])
    // Alerte visuelle : pour les personnes sourdes ou malentendantes, et pour toute annonce urgente
    if (prefs.visual_alerts || urgent) setToast({ text, urgent, id: Date.now() })
  }, [locale, prefs.voice, prefs.vibrate, prefs.visual_alerts])

  // Le bandeau reste 8 s (urgent : jusqu'à fermeture)
  useEffect(() => {
    if (!toast || toast.urgent) return undefined
    const id = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(id)
  }, [toast])

  const value = useMemo(() => ({ announce, message }), [announce, message])
  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      {toast && (
        <div key={toast.id} className={`toast${toast.urgent ? ' toast--urgent' : ''}${prefs.visual_alerts ? ' toast--flash' : ''}`} aria-hidden="true">
          <Icon name={toast.urgent ? 'alert' : 'bell'} size={26} />
          <p>{toast.text}</p>
          <button type="button" className="icon-btn" onClick={() => setToast(null)} aria-label={t('app.close')}>×</button>
        </div>
      )}
      {/* Zones lues par les lecteurs d'écran */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{!message.urgent && message.text}</div>
      <div className="sr-only" role="alert" aria-atomic="true">{message.urgent && message.text}</div>
    </AnnouncerContext.Provider>
  )
}

export const useAnnouncer = () => useContext(AnnouncerContext)
