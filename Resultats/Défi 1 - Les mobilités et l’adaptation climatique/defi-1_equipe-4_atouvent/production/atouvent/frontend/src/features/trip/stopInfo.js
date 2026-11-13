// Équipements des arrêts d'un trajet (abri, banc, annonces, accessibilité, toilettes, fontaine, chaleur), lus dans leg.from.info / leg.to.info (backend/app/router/amenities.py), et ce qu'ils changent pour l'usager.

const RIDES = new Set(['BUS', 'TRAM', 'SUBWAY', 'RAIL'])
const HEAT = 'chaleur'
const WET = ['orages_pluie', 'neige_verglas', 'grand_froid', 'vent_fort']

// Pictogrammes affichés sous chaque montée (dans l'ordre), avec la clé de texte
export function amenityChips(info = {}, mode) {
  if (!info) return []
  const out = []
  const surface = mode === 'BUS' || mode === 'TRAM'
  if (surface && info.shelter != null) out.push({ key: info.shelter ? 'stop.shelter' : 'stop.no_shelter', icon: 'shelter', ok: Boolean(info.shelter) })
  if (surface && info.bench === 1) out.push({ key: 'stop.bench', icon: 'check', ok: true })
  if (info.board === 'realtime') out.push({ key: 'stop.board', icon: 'clock', ok: true })
  if (surface && info.lit != null) out.push({ key: info.lit ? 'stop.lit' : 'stop.not_lit', icon: 'sun', ok: Boolean(info.lit) })
  if (info.tactile === 1) out.push({ key: 'stop.tactile', icon: 'walk', ok: true })
  if (info.audio != null) out.push({ key: info.audio ? 'stop.audio' : 'stop.no_audio', icon: 'sound', ok: info.audio > 0 })
  if (info.visual != null) out.push({ key: info.visual ? 'stop.visual' : 'stop.no_visual', icon: 'bell', ok: info.visual > 0 })
  if (info.access != null) out.push({ key: info.access ? 'stop.access' : 'stop.no_access', icon: 'a11y', ok: info.access > 0 })
  else if (!surface && (info.station_access || info.entrances)) out.push({ key: 'stop.access_unknown', icon: 'a11y', ok: false })
  if (info.station_access && info.station_access !== 'non') out.push({ key: `stop.station_${info.station_access}`, icon: 'a11y', ok: true })
  // Air du quai (Airparif) : toujours écrit en toutes lettres ; seul le niveau « élevé » est mis en alerte
  if (info.air) out.push({ key: `stop.air_${info.air}`, icon: 'wind', ok: info.air !== 'high' })
  if (info.toilets) out.push({ key: 'stop.toilets', icon: 'check', ok: true })
  if (info.fountain) out.push({ key: 'stop.fountain', icon: 'drop', ok: true })
  return out
}

/** Conséquences pour cet usager : avertissements, points forts et pénalité (minutes « ressenties ») pour le classement. */
export function stopNotes(it, { needs = [], hazards = [], flood = false } = {}) {
  const bad = []
  const good = []
  let penalty = 0
  const hot = hazards.includes(HEAT)
  const wet = hazards.some((h) => WET.includes(h))
  const sensitive = needs.includes('sensible_climat')
  const rides = it.legs.filter((l) => RIDES.has(l.mode))
  rides.forEach((l) => {
    const a = l.from.info || {}
    const b = l.to.info || {}
    const surface = l.mode === 'BUS' || l.mode === 'TRAM'
    // Attente avant de monter : écart entre la fin de l'étape précédente et le départ
    const prev = it.legs[it.legs.indexOf(l) - 1]
    const wait = prev ? Math.max(0, Math.round((Date.parse(l.start) - Date.parse(prev.end)) / 60_000)) : 0
    if (surface && a.shelter === 0 && (hot || wet)) {
      bad.push(wait >= 3 ? { key: 'stop.wait_no_shelter', params: { n: wait, stop: l.from.name } } : { key: 'stop.warn_no_shelter', params: { stop: l.from.name } })
      penalty += (sensitive ? 2 : 1) * Math.max(5, wait)
    }
    if (needs.includes('fauteuil') && (a.access === 0 || b.access === 0)) {
      bad.push({ key: 'stop.warn_no_access', params: { stop: a.access === 0 ? l.from.name : l.to.name } })
      penalty += 60
    }
    if (needs.includes('malvoyant') && (a.audio === 0 || b.audio === 0)) {
      bad.push({ key: 'stop.warn_no_audio', params: { stop: a.audio === 0 ? l.from.name : l.to.name } })
      penalty += 8
    }
    // Malvoyant : pas de bande podotactile au bord du quai ou du trottoir
    if (needs.includes('malvoyant') && surface && a.tactile === 0) {
      bad.push({ key: 'stop.warn_no_tactile', params: { stop: l.from.name } })
      penalty += 5
    }
    // De nuit (avant 7 h ou après 21 h) : arrêt de bus ou de tram non éclairé
    const hour = new Date(l.start).getHours()
    if (surface && a.lit === 0 && (hour >= 21 || hour < 7)) {
      bad.push({ key: 'stop.warn_dark', params: { stop: l.from.name } })
      penalty += 4
    }
    if (needs.includes('malentendant') && (a.visual === 0 || b.visual === 0)) {
      bad.push({ key: 'stop.warn_no_visual', params: { stop: a.visual === 0 ? l.from.name : l.to.name } })
      penalty += 8
    }
    // Quai très pollué aux particules : à signaler aux personnes sensibles au climat (souvent aussi à la pollution) et les jours de pollution annoncée ; on conseille de ne pas attendre longtemps sur le quai
    if ((sensitive || hazards.includes('pollution')) && (a.air === 'high' || b.air === 'high')) {
      bad.push({ key: 'stop.warn_air_high', params: { stop: a.air === 'high' ? l.from.name : l.to.name } })
      penalty += 6
    }
    if (hot && (a.platform_hot || b.platform_hot)) {
      const p = a.platform_hot ? l.from : l.to
      bad.push({ key: 'stop.warn_hot_platform', params: { stop: p.name, t: Math.round(p.info.platform_hot) } })
      penalty += 4
    }
  })
  // Marche au soleil dans un quartier très exposé (îlot de chaleur, note ≥ 6 sur 9)
  if (hot) {
    const walkHot = it.legs.some((l) => l.mode === 'WALK' && ((l.to.info?.heat_area ?? 0) >= 6 || (l.from.info?.heat_area ?? 0) >= 6))
    if (walkHot) {
      bad.push({ key: 'stop.warn_heat_island' })
      penalty += sensitive ? 8 : 3
    }
    const water = rides.find((l) => l.from.info?.fountain || l.to.info?.fountain)
    if (water) good.push({ key: 'stop.good_fountain', params: { stop: water.from.info?.fountain ? water.from.name : water.to.name } })
  }
  if (rides.length && rides.every((l) => l.mode === 'SUBWAY' || l.mode === 'RAIL' || l.from.info?.shelter === 1) && (hot || wet)) {
    good.push({ key: 'stop.good_sheltered' })
  }
  if (needs.includes('malvoyant') && rides.length && rides.every((l) => l.from.info?.audio === 1 && l.to.info?.audio === 1)) {
    good.push({ key: 'stop.good_audio' })
  }
  // Marche : ombre des arbres (Paris) les jours chauds, chantiers qui ferment un trottoir
  const walks = it.legs.filter((l) => l.mode === 'WALK' && l.shade != null && Date.parse(l.end) - Date.parse(l.start) >= 4 * 60_000)
  if (hot && walks.length) {
    const shade = walks.reduce((s, l) => s + l.shade, 0) / walks.length
    if (shade >= 0.5) good.push({ key: 'walk.good_shade' })
    else if (shade < 0.2) { bad.push({ key: 'walk.warn_no_shade' }); penalty += sensitive ? 8 : 3 }
  }
  const reduced = needs.some((n) => ['fauteuil', 'marche_difficile', 'malvoyant'].includes(n))
  ;(it.works || []).filter((w) => w.sidewalk || reduced).forEach((w) => {
    bad.push({ key: w.sidewalk ? 'walk.warn_sidewalk' : 'walk.warn_works', params: { street: w.name } })
    penalty += reduced ? 20 : 2
  })
  // Points noirs (accidents de piétons ou de cyclistes 2021-2024) sur la marche ou le vélo
  ;(it.hotspots || []).forEach((h) => {
    bad.push({ key: h.mode === 'bike' ? 'walk.hotspot_bike' : 'walk.hotspot_walk', params: { n: h.accidents } })
    penalty += h.mode === 'bike' ? 6 : 3
  })
  // Ascenseurs souvent en panne (historique) : important pour un fauteuil ou une marche difficile
  if (needs.some((n) => ['fauteuil', 'marche_difficile'].includes(n))) {
    (it.lifts_unreliable || []).forEach((l) => {
      bad.push({ key: 'stop.lifts_unreliable', params: { stop: l.station, v: Math.round(l.share * 100) } })
      penalty += 15
    })
  }
  // Perturbations en cours sur les lignes du trajet (PRIM) : bloquante = trajet presque écarté
  ;(it.disruptions || []).forEach((d) => {
    bad.push({ key: d.severity === 'BLOQUANTE' ? 'trip.disruption_block' : 'trip.disruption', params: { title: d.title } })
    penalty += d.severity === 'BLOQUANTE' ? 60 : 8
  })
  // Signalements récents des voyageurs sur le parcours (retard, bondé, chaleur…)
  if (it.reports?.length) {
    bad.push({ key: 'trip.reports', params: { n: it.reports.length, kinds: [...new Set(it.reports.map((r) => r.kind))] } })
    penalty += Math.min(10, 2 * it.reports.length)
  }
  // Crue : gares fermées lors de la dernière grande crue, signalées seulement en vigilance crue (jaune ou plus)
  if (flood) (it.flood_stations || []).forEach((s) => { bad.push({ key: 'stop.flood_closed', params: { stop: s } }); penalty += 30 })
  // Pluie, orage, neige, vent : 100 % souterrain d'abord ; marche dehors comptée plus lourd
  if (wet) {
    if (rides.length && rides.every((l) => l.underground)) penalty -= 3
    penalty += 0.5 * it.legs.filter((l) => l.mode === 'WALK').reduce((m, l) => m + (Date.parse(l.end) - Date.parse(l.start)) / 60_000, 0)
  }
  return { bad, good, penalty }
}

/** Accessibilité en fauteuil, toujours vérifiée par le serveur (arrêts, gares, véhicule, ascenseurs) : it.access. */
export function accessNotes(it) {
  const a = it.access
  if (!a) return { ok: false, issues: [] }
  return { ok: a.status === 'ok', status: a.status, issues: a.issues.filter((i) => i.reason !== 'elevator') }
}
