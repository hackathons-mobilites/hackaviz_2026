import { describe, expect, it } from 'vitest'
import { MIN, dueAnnouncements, estimateProgress, localWarnings, recalibrate } from './estimate.js'

// Trajet type : 5 min à pied, RER A (3 arrêts) de +8 à +17, 7 min à pied
const T0 = Date.parse('2026-07-01T10:00:00Z')
const at = (m) => new Date(T0 + m * MIN).toISOString()
const P = {
  home: { name: 'Maison', lat: 48.8478, lon: 2.3721 },
  gdl: { name: 'Gare de Lyon', lat: 48.8443, lon: 2.374 },
  chat: { name: 'Châtelet', lat: 48.8619, lon: 2.347 },
  aub: { name: 'Auber', lat: 48.8722, lon: 2.3296 },
  cdg: { name: 'Étoile', lat: 48.8738, lon: 2.295 },
  work: { name: 'Travail', lat: 48.8774, lon: 2.2985 },
}
const trip = {
  start: at(0), end: at(24),
  legs: [
    { mode: 'WALK', start: at(0), end: at(5), from: P.home, to: P.gdl, stops: [] },
    { mode: 'RAIL', line: 'A', start: at(8), end: at(17), from: P.gdl, to: P.cdg, underground: true,
      stops: [{ ...P.chat, time: at(11) }, { ...P.aub, time: at(14) }] },
    { mode: 'WALK', start: at(17), end: at(24), from: P.cdg, to: P.work, stops: [] },
  ],
}

describe('estimateProgress', () => {
  it('suit les phases du trajet', () => {
    expect(estimateProgress(trip, T0 + 2 * MIN).phase).toBe('walking')
    expect(estimateProgress(trip, T0 + 6 * MIN).phase).toBe('waiting')
    const p = estimateProgress(trip, T0 + 12 * MIN)
    expect(p.phase).toBe('riding')
    expect(p.current.name).toBe('Châtelet')
    expect(p.next.name).toBe('Auber')
    expect(p.stopsLeft).toBe(2)
    expect(estimateProgress(trip, T0 + 30 * MIN).phase).toBe('arrived')
  })

  it('décale l’arrivée quand on est en retard', () => {
    const p = estimateProgress(trip, T0 + 12 * MIN, 4 * MIN)
    expect(p.current.name).toBe('Gare de Lyon')
    expect(p.eta).toBe(Date.parse(trip.end) + 4 * MIN)
  })
})

describe('recalibrate', () => {
  it('reste sur l’horaire si la position correspond', () => {
    expect(recalibrate(trip, T0 + 11 * MIN, P.chat).offRoute).toBe(false)
  })
  it('mesure le retard au retour du GPS', () => {
    const r = recalibrate(trip, T0 + 17 * MIN, P.aub)
    expect(r.delayMs).toBe(3 * MIN)
  })
  it('détecte l’arrivée et la sortie du trajet', () => {
    expect(recalibrate(trip, T0 + 20 * MIN, P.work).arrived).toBe(true)
    expect(recalibrate(trip, T0 + 12 * MIN, { lat: 48.8, lon: 2.5 }).offRoute).toBe(true)
  })
})

describe('dueAnnouncements', () => {
  const bundle = { trip, warnings: [...localWarnings(trip), { code: 'elevator_out', station: 'Étoile', priority: 'high' }] }

  it('prévient de l’ascenseur dès le départ et du passage sous terre 3 min avant', () => {
    const done = new Set()
    const first = dueAnnouncements(bundle, estimateProgress(trip, T0), T0, done)
    expect(first.map((a) => a.key)).toEqual(['say.saved', 'say.elevator_out'])
    first.forEach((a) => done.add(a.id))
    const before = dueAnnouncements(bundle, estimateProgress(trip, T0 + 5 * MIN), T0 + 5 * MIN, done)
    expect(before.map((a) => a.key)).toEqual(['say.underground', 'say.board'])
  })

  it('annonce un arrêt avant la descente, une seule fois', () => {
    const done = new Set(['saved', 'elev-1', 'under-1'])
    const now = T0 + 15 * MIN
    const a = dueAnnouncements(bundle, estimateProgress(trip, now), now, done)
    expect(a).toHaveLength(1)
    expect(a[0].params.stop).toBe('Étoile')
    done.add(a[0].id)
    expect(dueAnnouncements(bundle, estimateProgress(trip, now), now, done)).toHaveLength(0)
  })
})

describe('annonce de montée', () => {
  const bundle = { trip, warnings: [] }
  it('annonce le train à prendre 2 min avant d\'arriver sur le quai, une seule fois', () => {
    const done = new Set()
    const now = T0 + 3.5 * MIN  // fin de la marche vers Gare de Lyon
    const a = dueAnnouncements(bundle, estimateProgress(trip, now), now, done).find((x) => x.key === 'say.board')
    expect(a).toMatchObject({ id: 'board-1', params: { board: 1, eta: Date.parse(at(8)) } })
    done.add(a.id)
    const later = T0 + 6 * MIN  // sur le quai
    expect(dueAnnouncements(bundle, estimateProgress(trip, later), later, done).some((x) => x.key === 'say.board')).toBe(false)
  })
  it('ne l\'annonce pas en début de marche', () => {
    expect(dueAnnouncements(bundle, estimateProgress(trip, T0), T0, new Set()).some((x) => x.key === 'say.board')).toBe(false)
  })
})
