// Réseau francilien vu par l'application : gares, lignes et climatisation (référentiel IDFM).
import { distance } from './trip/estimate.js'

let cache = null

// Zone couverte par AtouVent (mêmes bornes que l'API, schemas.py) et position par défaut
export const PARIS = { lat: 48.8566, lon: 2.3522, name: 'Paris' }
export const inIdf = (p) => Boolean(p) && p.lat >= 48 && p.lat <= 49.5 && p.lon >= 1.4 && p.lon <= 3.6
// Position utilisée par l'application : celle de l'usager s'il est en Île-de-France, Paris sinon
export const usablePosition = (coords) => (inIdf(coords) ? coords : PARIS)

export function loadNetwork() {
  cache ||= fetch('/data/gares.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])
  return cache
}

// Famille de mode commune au référentiel IDFM et aux itinéraires (OTP)
const FAMILY = { Metro: 'metro', RapidTransit: 'rail', LocalTrain: 'rail', regionalRail: 'rail', RailShuttle: 'rail', Tramway: 'tram',
  SUBWAY: 'metro', RAIL: 'rail', TRAM: 'tram', BUS: 'bus' }
export const family = (mode) => FAMILY[mode] || 'other'

// Ligne du référentiel (climatisation « true », « partial », « false » ou « unknown », couleurs officielles)
export function lineIndex(gares) {
  const out = {}
  gares.forEach((g) => g.lines.forEach((l) => { out[`${family(l.mode)}:${l.line}`] = l }))
  return (mode, line) => out[`${family(mode)}:${line}`] || { line, mode, ac: 'unknown' }
}

// Gares les plus proches, avec distance et minutes à pied (4,5 km/h)
export function nearestStations(gares, pos, { count = 2, maxM = 1200 } = {}) {
  return gares
    .map((g) => ({ ...g, m: Math.round(distance(pos, g)) }))
    .filter((g) => g.m <= maxM)
    .sort((a, b) => a.m - b.m)
    .slice(0, count)
    .map((g) => ({ ...g, walkMin: Math.max(1, Math.round(g.m / 75)) }))
}

// Libellé court d'une étape : « M 14 », « RER A », « T3a », « L » (Transilien), « Bus 38 »
const RER = new Set(['A', 'B', 'C', 'D', 'E'])
// Direction lisible : terminus de la course ; le code de mission RER (4 majuscules, ex. ROPO) n'est pas montré
export const legDirection = (leg) => leg.direction || (leg.headsign && !/^[A-Z]{4}$/.test(leg.headsign) ? leg.headsign : null)

export function legLabel(leg) {
  const line = leg.line || ''
  if (leg.mode === 'SUBWAY') return `M ${line}`
  if (leg.mode === 'RAIL') return RER.has(line) ? `RER ${line}` : line
  if (leg.mode === 'TRAM') return line.startsWith('T') ? line : `T${line}`
  if (leg.mode === 'BUS') return `Bus ${line}`
  if (leg.mode === 'BICYCLE') return line || '🚲'
  return line
}

// Texte lisible sur la couleur officielle d'une ligne : noir ou blanc, celui qui contraste le plus (WCAG ≥ 4,5:1 visé)
const lum = (hex) => {
  const v = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}
export function readableOn(bg) {
  if (!/^#?[0-9a-f]{6}$/i.test(bg || '')) return '#FFFFFF'
  const L = lum(bg)
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#FFFFFF' : '#000000'
}
