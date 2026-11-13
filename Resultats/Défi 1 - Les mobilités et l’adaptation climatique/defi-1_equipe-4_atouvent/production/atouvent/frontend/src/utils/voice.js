// Synthèse vocale : on choisit la voix la plus naturelle disponible sur l'appareil pour la langue (voix « neuronales » ou « naturelles » de Microsoft, Google, Apple), jamais la voix robotique par défaut si mieux existe.
import { storage } from './storage.js'

const KEY = 'atv.voice'
// Plus le score est haut, plus la voix est naturelle
const QUALITY = [
  [/natural|neural|online/i, 50], [/premium|enhanced|amélioré/i, 40], [/google/i, 30],
  [/siri|samantha|daniel|amélie|thomas|audrey|aurélie|marie|paulina|monica|alice|tingting/i, 20],
  [/microsoft/i, 10], [/espeak|robot|compact/i, -40],
]

let cache = []
function load() {
  if (!('speechSynthesis' in window)) return []
  cache = window.speechSynthesis.getVoices()
  return cache
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  load()
  window.speechSynthesis.addEventListener?.('voiceschanged', load)
}

const score = (v) => QUALITY.reduce((s, [re, pts]) => s + (re.test(v.name) ? pts : 0), 0) + (v.localService ? 0 : 5)

/** Voix disponibles pour une langue (« fr-FR » ou « fr »), de la plus naturelle à la moins naturelle. */
export function voicesFor(locale) {
  const lang = locale.slice(0, 2).toLowerCase()
  return (cache.length ? cache : load())
    .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang))
    .sort((a, b) => score(b) - score(a) || (b.lang === locale) - (a.lang === locale))
}

export const chosenVoice = () => storage.get(KEY)
export const chooseVoice = (name) => (name ? storage.set(KEY, name) : storage.remove(KEY))

/** Lit un texte avec la meilleure voix, à un débit un peu plus posé que celui par défaut. */
export function speak(text, locale, { urgent = false } = {}) {
  if (!('speechSynthesis' in window) || !text) return
  const list = voicesFor(locale)
  const voice = list.find((v) => v.name === chosenVoice()) || list[0]
  const u = new SpeechSynthesisUtterance(text)
  u.lang = voice?.lang || locale
  if (voice) u.voice = voice
  u.rate = urgent ? 1 : 0.95
  u.pitch = 1
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}
