// Texte lisible sur la couleur officielle d'une ligne et libellés des étapes
import { describe, expect, it } from 'vitest'
import { legLabel, readableOn } from './network.js'

const lum = (hex) => {
  const v = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

describe('readableOn', () => {
  // Quelques couleurs officielles IDFM (métro 1 jaune, RER A rouge, bus 86 rouge vif, métro 14 violet, T3a orange)
  it.each(['#FFCD00', '#EB2132', '#FF1400', '#640082', '#F28E42', '#6ECA97', '#000000', '#FFFFFF'])('contraste ≥ 4,5:1 sur %s', (bg) => {
    expect(ratio(bg, readableOn(bg))).toBeGreaterThanOrEqual(4.5)
  })
  it('renvoie du blanc si la couleur est absente ou invalide', () => {
    expect(readableOn(null)).toBe('#FFFFFF')
    expect(readableOn('rouge')).toBe('#FFFFFF')
  })
})

describe('legLabel', () => {
  it('nomme chaque mode comme sur le réseau', () => {
    expect(legLabel({ mode: 'SUBWAY', line: '14' })).toBe('M 14')
    expect(legLabel({ mode: 'RAIL', line: 'A' })).toBe('RER A')
    expect(legLabel({ mode: 'RAIL', line: 'L' })).toBe('L')
    expect(legLabel({ mode: 'TRAM', line: '3a' })).toBe('T3a')
    expect(legLabel({ mode: 'BUS', line: '86' })).toBe('Bus 86')
  })
})
