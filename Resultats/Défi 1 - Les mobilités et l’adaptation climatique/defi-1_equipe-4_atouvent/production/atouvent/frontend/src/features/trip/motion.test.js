import { describe, expect, it } from 'vitest'
import { arrivalDetected, departureDetected, motionState, project, routeLine } from './motion.js'

// Trajet à pied tout droit vers l'est, sur environ 1 km (Nation → Porte de Vincennes)
const trip = { legs: [{ mode: 'WALK', from: { lat: 48.8484, lon: 2.3959 }, to: { lat: 48.8484, lon: 2.4095 }, stops: [] }] }
const line = routeLine(trip)
const at = (lon, t, accuracy = 10) => {
  const p = { lat: 48.8484, lon, t, accuracy }
  return { ...p, along: project(line, p).along }
}

describe('mouvement le long du trajet', () => {
  it('projette une position sur le tracé', () => {
    const p = project(line, { lat: 48.8486, lon: 2.4027 })
    expect(Math.round(p.along / 10) * 10).toBe(500)
    expect(p.offset).toBeLessThan(30)
  })

  it('avance, s\'arrête ou recule', () => {
    const fwd = [at(2.3990, 0), at(2.4000, 15_000), at(2.4010, 30_000)]
    expect(motionState(fwd, 30_000).state).toBe('moving_forward')
    const still = [at(2.4010, 0), at(2.40102, 15_000), at(2.40099, 30_000)]
    expect(motionState(still, 30_000).state).toBe('stopped')
    const back = [at(2.4010, 0), at(2.4000, 15_000), at(2.3990, 30_000)]
    expect(motionState(back, 30_000).state).toBe('moving_backward')
  })

  it('ne conclut pas sur une position imprécise ou trop récente', () => {
    expect(motionState([at(2.3990, 0, 200), at(2.4010, 30_000, 200)], 30_000).state).toBe('uncertain')
    expect(motionState([at(2.3990, 0), at(2.4010, 5_000)], 5_000).state).toBe('uncertain')
  })

  it('détecte l\'arrivée sans attendre l\'usager, mais pas en passant à 100 m', () => {
    const dest = trip.legs[0].to
    expect(arrivalDetected([at(2.40925, 0), at(2.40935, 10_000)], dest, { state: 'moving_forward' })).toBe(true)
    // À environ 100 m, en marchant : pas encore arrivé ; à l'arrêt à cette distance : arrivé
    const passing = [at(2.4081, 0), at(2.4082, 10_000)]
    expect(arrivalDetected(passing, dest, { state: 'moving_forward' })).toBe(false)
    expect(arrivalDetected(passing, dest, { state: 'stopped' })).toBe(true)
  })
})

// Le trajet ne démarre que quand l'usager s'éloigne de l'endroit où il attendait (0,001° de longitude ≈ 73 m ici)
describe('départ détecté', () => {
  const home = at(2.3959, 0)
  it('ne démarre pas tant que l\'usager reste sur place (GPS qui flotte de quelques mètres)', () => {
    expect(departureDetected(home, [at(2.3960, 10_000), at(2.3958, 20_000)])).toBe(false)
  })
  it('ignore un saut isolé du GPS', () => {
    expect(departureDetected(home, [at(2.3990, 10_000), at(2.3959, 20_000)])).toBe(false)
  })
  it('démarre quand deux positions de suite sont à plus de 40 m', () => {
    expect(departureDetected(home, [at(2.3968, 10_000), at(2.3972, 20_000)])).toBe(true)
  })
  it('attend si la position est trop imprécise', () => {
    expect(departureDetected(home, [at(2.3968, 10_000, 150), at(2.3972, 20_000, 150)])).toBe(false)
  })
  it('vaut partout en Île-de-France (Melun)', () => {
    const melun = { lat: 48.5421, lon: 2.6554, accuracy: 10 }
    const away = (dLon, t) => ({ lat: 48.5421, lon: 2.6554 + dLon, t, accuracy: 10 })
    expect(departureDetected(melun, [away(0.0002, 10_000), away(0.0001, 20_000)])).toBe(false)
    expect(departureDetected(melun, [away(0.0009, 10_000), away(0.0012, 20_000)])).toBe(true)
  })
})
