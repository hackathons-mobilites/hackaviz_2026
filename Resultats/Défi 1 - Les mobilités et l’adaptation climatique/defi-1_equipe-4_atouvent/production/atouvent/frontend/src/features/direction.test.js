import { describe, expect, it } from 'vitest'
import { legDirection } from './network.js'

describe('direction affichée', () => {
  it('donne le terminus de la course', () => {
    expect(legDirection({ direction: 'Corbeil-Essonnes', headsign: 'ROPO' })).toBe('Corbeil-Essonnes')
  })
  it('ne montre jamais un code de mission RER', () => {
    expect(legDirection({ headsign: 'ROPO' })).toBe(null)
  })
  it('garde une direction écrite en clair quand le terminus manque', () => {
    expect(legDirection({ headsign: 'La Courneuve - 8 Mai 1945' })).toBe('La Courneuve - 8 Mai 1945')
  })
})
