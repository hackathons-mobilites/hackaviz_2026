// Estimation du trajet sans réseau ni GPS : tout se calcule depuis les horaires enregistrés et l'heure du téléphone.

export const MIN = 60_000
const ms = (iso) => new Date(iso).getTime()
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))

// Points horodatés d'une étape : départ, arrêts intermédiaires, arrivée
export function legPoints(leg) {
  return [
    { ...leg.from, t: ms(leg.start) },
    ...(leg.stops || []).map((s) => ({ ...s, t: ms(s.time) })),
    { ...leg.to, t: ms(leg.end) },
  ]
}

// Tous les points du trajet, avec l'index de leur étape
export function timeline(trip) {
  return trip.legs.flatMap((leg, legIndex) => legPoints(leg).map((p) => ({ ...p, legIndex })))
}

/** Où en est l'usager ? */
export function estimateProgress(trip, now, delayMs = 0) {
  const t = now - delayMs
  const start = ms(trip.start)
  const end = ms(trip.end)
  const base = { eta: end + delayMs, minutesLeft: Math.max(0, Math.ceil((end - t) / MIN)), progress: clamp((t - start) / (end - start), 0, 1) }

  if (t >= end) return { ...base, phase: 'arrived', legIndex: trip.legs.length - 1 }
  const legIndex = Math.max(0, trip.legs.findIndex((l) => t < ms(l.end)))
  const leg = trip.legs[legIndex]
  const points = legPoints(leg)

  if (t < ms(leg.start)) {
    return { ...base, phase: t < start ? 'before' : 'waiting', legIndex, leg, current: points[0], next: points[1], stopsLeft: points.length - 1 }
  }
  let passed = 0
  points.forEach((p, i) => { if (p.t <= t) passed = i })
  return {
    ...base,
    phase: leg.mode === 'WALK' ? 'walking' : 'riding',
    legIndex, leg,
    current: points[passed],
    next: points[passed + 1],
    stopsLeft: points.length - 1 - passed,
    minutesToLegEnd: Math.max(0, Math.ceil((ms(leg.end) - t) / MIN)),
  }
}

// Distance en mètres entre deux points (formule de haversine)
export function distance(a, b) {
  const R = 6_371_000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Position attendue selon l'horaire (interpolation entre deux arrêts)
export function expectedPosition(trip, now, delayMs = 0) {
  const t = now - delayMs
  const pts = timeline(trip)
  if (t <= pts[0].t) return pts[0]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (t <= b.t) {
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)
      return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, legIndex: b.legIndex }
    }
  }
  return pts[pts.length - 1]
}

export const ARRIVED_M = 150
export const ON_TRACK_M = 400
export const OFF_ROUTE_M = 600

/** Recalage au retour du GPS : compare la position réelle à l'estimation. */
export function recalibrate(trip, now, coords, delayMs = 0) {
  const dest = trip.legs[trip.legs.length - 1].to
  if (distance(coords, dest) <= ARRIVED_M) return { arrived: true, offRoute: false, delayMs }
  if (distance(coords, expectedPosition(trip, now, delayMs)) <= ON_TRACK_M) return { arrived: false, offRoute: false, delayMs }

  const nearest = timeline(trip)
    .map((p) => ({ p, d: distance(coords, p) }))
    .sort((x, y) => x.d - y.d)[0]
  if (nearest.d > OFF_ROUTE_M) return { arrived: false, offRoute: true, delayMs }
  return { arrived: false, offRoute: false, delayMs: clamp(now - nearest.p.t, -10 * MIN, 60 * MIN) }
}

// Avertissements minimaux calculés sur le téléphone si le serveur est injoignable au départ
export function localWarnings(trip) {
  return trip.legs.flatMap((leg, i) => (leg.underground ? [{ code: 'underground', leg: i, station: leg.from.name, at: leg.start }] : []))
}

/** Annonces à faire maintenant. */
export function dueAnnouncements({ trip, warnings }, progress, now, done, { warnBefore = true } = {}) {
  const out = []
  const push = (id, key, params = {}, urgent = false) => { if (!done.has(id)) out.push({ id, key, params, urgent }) }

  // Dès le départ : trajet enregistré, ascenseurs en panne, météo à l'arrivée
  push('saved', 'say.saved', { eta: progress.eta })
  warnings.forEach((w, i) => {
    if (w.code === 'elevator_out') push(`elev-${i}`, 'say.elevator_out', { station: w.station }, w.priority === 'high')
    if (w.code === 'hazard') push(`hz-${w.hazard}`, 'say.hazard', { hazard: w.hazard })
    if (w.code === 'hot_arrival') push('hot', 'say.hot_arrival', { t: Math.round(w.temperature) })
  })

  // 3 minutes avant de descendre sous terre
  warnings.filter((w) => w.code === 'underground').forEach((w) => {
    const leg = trip.legs[w.leg]
    if (now >= ms(leg.start) - 3 * MIN && progress.legIndex <= w.leg && progress.phase !== 'arrived') {
      push(`under-${w.leg}`, 'say.underground', { station: w.station, eta: progress.eta })
    }
  })

  // Montée (départ et correspondances) : quelle ligne, quelle direction, à quelle heure ; sur le quai ou 2 min avant d'y arriver
  trip.legs.forEach((leg, i) => {
    if (['WALK', 'BICYCLE'].includes(leg.mode) || progress.phase === 'arrived') return
    const onPlatform = progress.legIndex === i && progress.phase === 'waiting'
    const almost = progress.legIndex === i - 1 && progress.phase === 'walking' && progress.minutesToLegEnd <= 2
    if (onPlatform || almost) push(`board-${i}`, 'say.board', { board: i, eta: ms(leg.start) })
  })

  // Un arrêt avant la descente
  if (warnBefore && progress.phase === 'riding' && progress.stopsLeft === 1) {
    push(`alight-${progress.legIndex}`, 'say.alight_next', { stop: progress.leg.to.name }, true)
  }
  if (progress.phase === 'arrived') push('arrived', 'say.arrived')
  return out
}
