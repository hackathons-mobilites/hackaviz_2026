import { describe, expect, it } from 'vitest'
import fr from './locales/fr.js'
import en from './locales/en.js'
import es from './locales/es.js'
import itl from './locales/it.js'
import zh from './locales/zh.js'

// Chaque langue doit avoir exactement les mêmes clés et les mêmes paramètres {x} que le français
const params = (s) => (s.match(/\{\w+\}/g) || []).sort().join()

describe.each([['en', en], ['es', es], ['it', itl], ['zh', zh]])('%s', (_, dict) => {
  it('a toutes les clés', () => expect(Object.keys(dict).sort()).toEqual(Object.keys(fr).sort()))
  it('garde les paramètres', () => Object.keys(fr).forEach((k) => expect([k, params(dict[k] || '')]).toEqual([k, params(fr[k])])))
})
