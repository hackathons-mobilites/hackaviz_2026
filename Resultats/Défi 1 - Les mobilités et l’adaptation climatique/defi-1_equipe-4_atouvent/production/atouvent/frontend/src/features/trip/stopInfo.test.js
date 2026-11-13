// Équipements des arrêts : ce qu'ils changent selon le profil et la météo
import { describe, expect, it } from 'vitest'
import { accessNotes, amenityChips, stopNotes } from './stopInfo.js'

const leg = (mode, from = {}, to = {}) => ({ mode, from: { name: 'Départ', info: from }, to: { name: 'Arrivée', info: to } })
const trip = (...legs) => ({ legs })

describe('stopNotes', () => {
  it('signale un arrêt de bus sans abri seulement sous la pluie ou la chaleur', () => {
    const it = trip(leg('BUS', { shelter: 0 }))
    expect(stopNotes(it, { hazards: [] }).bad).toEqual([])
    const wet = stopNotes(it, { hazards: ['orages_pluie'] })
    expect(wet.bad[0].key).toBe('stop.warn_no_shelter')
    expect(wet.penalty).toBeGreaterThan(0)
  })

  it('écarte presque un arrêt non accessible pour un fauteuil, pas pour un compte classique', () => {
    const it = trip(leg('BUS', { access: 0 }, { access: 1 }))
    expect(stopNotes(it, { needs: ['fauteuil'] }).penalty).toBeGreaterThanOrEqual(60)
    expect(stopNotes(it, { needs: [] }).penalty).toBe(0)
  })

  it('prévient une personne malvoyante en l’absence d’annonces sonores', () => {
    const notes = stopNotes(trip(leg('SUBWAY', { audio: 0 }, { audio: 1 })), { needs: ['malvoyant'] })
    expect(notes.bad.map((n) => n.key)).toContain('stop.warn_no_audio')
  })

  it('ne dit rien quand l’information manque (jamais de « non » inventé)', () => {
    expect(stopNotes(trip(leg('BUS')), { needs: ['fauteuil', 'malvoyant', 'malentendant'], hazards: ['chaleur'] }).bad).toEqual([])
  })
})

describe('amenityChips', () => {
  it('montre l’abri pour un bus mais pas pour un métro', () => {
    expect(amenityChips({ shelter: 1 }, 'BUS').map((c) => c.key)).toEqual(['stop.shelter'])
    expect(amenityChips({ shelter: 1 }, 'SUBWAY')).toEqual([])
  })
})

describe('marche : ombre et chantiers', () => {
  const walk = (shade) => ({ mode: 'WALK', shade, start: '2026-07-01T10:00:00Z', end: '2026-07-01T10:10:00Z', from: { name: 'A' }, to: { name: 'B' } })
  it('signale le manque d’ombre seulement par forte chaleur', () => {
    expect(stopNotes({ legs: [walk(0.05)] }, { hazards: ['chaleur'] }).bad[0].key).toBe('walk.warn_no_shade')
    expect(stopNotes({ legs: [walk(0.05)] }, { hazards: [] }).bad).toEqual([])
    expect(stopNotes({ legs: [walk(0.8)] }, { hazards: ['chaleur'] }).good[0].key).toBe('walk.good_shade')
  })
  it('chantier : trottoir fermé pour tous, simple chantier pour les profils à mobilité réduite', () => {
    const it = { legs: [walk(null)], works: [{ name: 'Rue A', sidewalk: true }, { name: 'Rue B', sidewalk: false }] }
    expect(stopNotes(it, {}).bad.map((n) => n.params.street)).toEqual(['Rue A'])
    const wheel = stopNotes(it, { needs: ['fauteuil'] })
    expect(wheel.bad.map((n) => n.params.street)).toEqual(['Rue A', 'Rue B'])
    expect(wheel.penalty).toBeGreaterThanOrEqual(40)
  })
})

describe('climat et accessibilité', () => {
  const at = (m) => `2026-07-01T10:${String(m).padStart(2, '0')}:00Z`
  const bus = { mode: 'BUS', start: at(10), end: at(25), from: { name: 'Arrêt A', info: { shelter: 0 } }, to: { name: 'B', info: {} } }
  const walkTo = { mode: 'WALK', start: at(0), end: at(2), from: { name: 'Maison' }, to: { name: 'Arrêt A' } }
  it('annonce les minutes d’attente à un arrêt non abrité sous l’orage', () => {
    const n = stopNotes({ legs: [walkTo, bus] }, { hazards: ['orages_pluie'] })
    expect(n.bad[0]).toEqual({ key: 'stop.wait_no_shelter', params: { n: 8, stop: 'Arrêt A' } })
  })
  it('signale une gare fermée en cas de crue seulement en vigilance crue', () => {
    const it = { legs: [walkTo], flood_stations: ['Saint-Michel Notre-Dame'] }
    expect(stopNotes(it, { flood: false }).bad).toEqual([])
    expect(stopNotes(it, { flood: true }).bad[0].key).toBe('stop.flood_closed')
  })
  it('accessibilité : jamais « non vérifiée », toujours un statut et des raisons', () => {
    expect(accessNotes({ access: { status: 'ok', issues: [] } }).ok).toBe(true)
    const a = accessNotes({ access: { status: 'assisted', issues: [{ stop: 'Gare', reason: 'station_reservation' }, { stop: 'X', reason: 'elevator' }] } })
    expect(a.ok).toBe(false)
    expect(a.issues.map((i) => i.reason)).toEqual(['station_reservation']) // l'ascenseur est déjà affiché à part
  })
})

describe('points noirs et ascenseurs peu fiables', () => {
  it('signale un point noir piéton à tous, les ascenseurs peu fiables seulement aux profils concernés', () => {
    const it = { legs: [], hotspots: [{ mode: 'walk', accidents: 7 }], lifts_unreliable: [{ station: 'Pontoise', share: 0.79 }] }
    expect(stopNotes(it, {}).bad.map((n) => n.key)).toEqual(['walk.hotspot_walk'])
    expect(stopNotes(it, { needs: ['fauteuil'] }).bad.map((n) => n.key)).toEqual(['walk.hotspot_walk', 'stop.lifts_unreliable'])
  })
})

describe('avant le départ : perturbations, signalements, nuit, malvoyant', () => {
  const at = (h) => `2026-10-16T${String(h).padStart(2, '0')}:00:00`
  const bus = (h, info) => ({ mode: 'BUS', start: at(h), end: at(h), from: { name: 'Arrêt A', info }, to: { name: 'B', info: {} } })
  it('une perturbation bloquante écarte presque le trajet', () => {
    const n = stopNotes({ legs: [], disruptions: [{ title: 'RER B interrompu', severity: 'BLOQUANTE' }] })
    expect(n.bad[0].key).toBe('trip.disruption_block')
    expect(n.penalty).toBeGreaterThanOrEqual(60)
  })
  it('les signalements récents sont résumés', () => {
    expect(stopNotes({ legs: [], reports: [{ kind: 'hot' }, { kind: 'hot' }] }).bad[0]).toEqual({ key: 'trip.reports', params: { n: 2, kinds: ['hot'] } })
  })
  it('arrêt non éclairé : seulement la nuit ; bande podotactile : pour un profil malvoyant', () => {
    expect(stopNotes({ legs: [bus(14, { lit: 0 })] }).bad).toEqual([])
    expect(stopNotes({ legs: [bus(22, { lit: 0 })] }).bad[0].key).toBe('stop.warn_dark')
    expect(stopNotes({ legs: [bus(14, { tactile: 0 })] }, { needs: ['malvoyant'] }).bad[0].key).toBe('stop.warn_no_tactile')
  })
})
