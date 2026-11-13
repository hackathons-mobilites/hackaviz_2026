// Types de lieux de la carte : chaque onglet a une pastille, un pictogramme et des informations cohérentes
import { describe, expect, it } from 'vitest'
import { chipsOf, KIND, kindOf, MAP_TABS, PLACE_GROUPS, subtitleOf } from './places.js'

const t = (k, p = {}) => `${k}${Object.values(p).join('|')}`

describe('features/places', () => {
  it('chaque onglet de lieux a un groupe serveur, chaque catégorie une pastille', () => {
    MAP_TABS.filter((x) => !['stops', 'velib'].includes(x.key)).forEach((x) => expect(PLACE_GROUPS.has(x.key)).toBe(true))
    Object.values(KIND).forEach((k) => expect(k.icon && k.tone).toBeTruthy())
  })
  it('toilettes : accès fauteuil, gratuité, table à langer ; jamais « payant » inventé', () => {
    const p = { kind: 'toilets', name: 'X', pmr: true, paid: false, baby: true, distance_m: 120, type: 'Sanisette', hours: '24/24h' }
    expect(chipsOf(p, 'toilets').map((c) => c.key)).toEqual(['map.pmr', 'map.free', 'map.baby'])
    expect(subtitleOf(p, 'toilets', t)).toBe('Sanisette · 24/24h · around.meters120')
  })
  it('chantier qui ferme un trottoir : signalé en alerte', () => {
    expect(chipsOf({ kind: 'works', sidewalk: true }, 'works')).toEqual([{ key: 'map.sidewalk_closed', icon: 'walk', ok: false, params: undefined }])
  })
  it('Vélib’ qui se vide : alerte ; sinon estimation à 30 min', () => {
    expect(chipsOf({ trend: { emptying: true } }, 'velib')[0].ok).toBe(false)
    expect(chipsOf({ trend: { bikes_30min: 4 } }, 'velib')[0]).toMatchObject({ key: 'map.velib_soon', params: { n: 4 } })
    expect(kindOf({}, 'velib')).toBe('velib')
  })
})
