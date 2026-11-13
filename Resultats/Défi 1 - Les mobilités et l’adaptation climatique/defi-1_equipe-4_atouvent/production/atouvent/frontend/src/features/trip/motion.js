// Mouvement de l'usager le long de son trajet, d'après le GPS : avance, à l'arrêt, recule, et arrivée détectée.

const R = 6_371_000
const rad = (d) => (d * Math.PI) / 180

export const WINDOW_MS = 45_000         // fenêtre d'observation du mouvement
export const MIN_SPAN_MS = 20_000       // il faut au moins 20 s de positions pour conclure
export const MOVE_M = 15                // progression minimale (en plus du bruit GPS) pour « avance » ou « recule »
export const POOR_ACCURACY_M = 80       // au-delà, la position est trop imprécise pour juger du mouvement
export const ARRIVED_NEAR_M = 50        // arrivé : à moins de 50 m de la destination
export const ARRIVED_STOPPED_M = 120    // ou à moins de 120 m et arrêté (entrée d'immeuble, quai, place…)
export const DEPART_M = 40              // départ : à plus de 40 m (en plus du bruit GPS) de la première position

/** Tracé du trajet en points { lat, lon, along } (mètres cumulés depuis le départ). */
export function routeLine(trip) {
  const pts = []
  trip.legs.forEach((leg) => {
    const geo = leg.geometry?.length > 1 ? leg.geometry.map(([lon, lat]) => ({ lat, lon }))
      : [leg.from, ...(leg.stops || []), leg.to].map((p) => ({ lat: p.lat, lon: p.lon }))
    geo.forEach((p) => pts.push(p))
  })
  let along = 0
  return pts.map((p, i) => {
    if (i > 0) along += metres(pts[i - 1], p)
    return { ...p, along }
  })
}

/** Distance en mètres (approximation plane, précise à l'échelle d'une ville). */
export function metres(a, b) {
  const x = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2))
  const y = rad(b.lat - a.lat)
  return Math.hypot(x, y) * R
}

/** Projection d'une position sur le tracé : mètres parcourus le long du tracé et écart au tracé. */
export function project(line, p) {
  let best = { along: 0, offset: Infinity }
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const seg = b.along - a.along
    // Coordonnées locales en mètres autour de a
    const kx = Math.cos(rad(a.lat)) * R * Math.PI / 180
    const ky = R * Math.PI / 180
    const bx = (b.lon - a.lon) * kx
    const by = (b.lat - a.lat) * ky
    const px = (p.lon - a.lon) * kx
    const py = (p.lat - a.lat) * ky
    const len2 = bx * bx + by * by
    const k = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0
    const offset = Math.hypot(px - k * bx, py - k * by)
    if (offset < best.offset) best = { along: a.along + k * seg, offset }
  }
  return best
}

/** État du mouvement sur la fenêtre récente. */
export function motionState(history, now = Date.now()) {
  const recent = history.filter((h) => now - h.t <= WINDOW_MS)
  if (recent.length < 2) return { state: 'uncertain', metres: 0 }
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (last.t - first.t < MIN_SPAN_MS) return { state: 'uncertain', metres: 0 }
  const noise = Math.max(first.accuracy || 0, last.accuracy || 0)
  if (noise > POOR_ACCURACY_M) return { state: 'uncertain', metres: 0 }
  const progress = last.along - first.along
  const moved = metres(first, last)
  const threshold = MOVE_M + noise / 2
  if (moved < threshold && Math.abs(progress) < threshold) {
    // Depuis quand l'usager ne bouge plus (premier point de la série immobile)
    let since = last.t
    for (let i = history.length - 1; i >= 0 && metres(history[i], last) < threshold; i--) since = history[i].t
    return { state: 'stopped', metres: Math.round(moved), sinceMs: now - since }
  }
  if (progress <= -threshold) return { state: 'moving_backward', metres: Math.round(-progress) }
  if (progress >= threshold) return { state: 'moving_forward', metres: Math.round(progress) }
  return { state: 'uncertain', metres: Math.round(moved) }  // se déplace, mais en travers du tracé
}

/** Départ détecté : les deux dernières positions sont nettement éloignées du point où l'usager attendait (un GPS qui saute une fois ne suffit pas). */
export function departureDetected(anchor, history) {
  const last2 = history.slice(-2)
  if (!anchor || last2.length < 2) return false
  return last2.every((h) => (h.accuracy || 0) <= POOR_ACCURACY_M
    && metres(anchor, h) >= DEPART_M + Math.max(anchor.accuracy || 0, h.accuracy || 0) / 2)
}

/** Arrivée détectée sans attendre que l'usager appuie sur « Je suis arrivé » : deux positions de suite à moins de 50 m de la destination, ou à moins de 120 m et à l'arrêt. */
export function arrivalDetected(history, dest, motion) {
  const last2 = history.slice(-2)
  if (last2.length < 2) return false
  const near = (m) => last2.every((h) => metres(h, dest) <= m + Math.min(h.accuracy || 0, 40))
  return near(ARRIVED_NEAR_M) || (near(ARRIVED_STOPPED_M) && motion.state === 'stopped')
}
