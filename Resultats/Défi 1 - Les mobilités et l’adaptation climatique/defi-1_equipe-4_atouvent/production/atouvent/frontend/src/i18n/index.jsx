// Traductions : 5 langues proposées dès l'ouverture (FR, EN, ES, IT, ZH)
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import fr from './locales/fr.js'
import en from './locales/en.js'
import es from './locales/es.js'
import it from './locales/it.js'
import zh from './locales/zh.js'
import { storage } from '../utils/storage.js'

export const LANGUAGES = [
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'it', name: 'Italiano', locale: 'it-IT' },
  { code: 'zh', name: '简体中文', locale: 'zh-CN' },
]
const DICTS = { fr, en, es, it, zh }
const KEY = 'atv.lang'

// Langue du navigateur si elle fait partie des 5, sinon français
export function detectLanguage() {
  const nav = (navigator.language || 'fr').slice(0, 2)
  return DICTS[nav] ? nav : 'fr'
}

export function translate(lang, key, params = {}) {
  const s = DICTS[lang]?.[key] ?? fr[key] ?? key
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`))
}

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => storage.get(KEY) || detectLanguage())
  // Vrai dès que l'usager a validé une langue (même identique à celle détectée)
  const [chosen, setChosen] = useState(() => storage.get(KEY) !== null)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((code) => {
    storage.set(KEY, code)
    setLangState(code)
    setChosen(true)
  }, [])

  const value = useMemo(() => {
    const locale = LANGUAGES.find((l) => l.code === lang)?.locale || 'fr-FR'
    return {
      lang, locale, chosen, setLang,
      t: (key, params) => translate(lang, key, params),
      // Message d'erreur API traduit, message générique si le code est inconnu
      err: (code) => {
        const s = translate(lang, `err.${code}`)
        return s === `err.${code}` ? translate(lang, 'app.error') : s
      },
      time: (d) => (d ? new Date(d).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '--:--'),
      date: (d) => new Date(d).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }),
    }
  }, [lang, chosen, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)
