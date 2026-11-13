// Navigation au clavier seul (RGAA 7.3 et 10.7, WCAG 2.1.1, 2.1.2, 2.4.3 et 2.4.7) : on appuie sur Tab de proche en proche et on vérifie que - chaque bouton, lien et champ visible de la page reçoit le focus (rien d'inaccessible sans souris) ; - le focus est toujours visible (contour ou ombre qui change) ; - le focus n'est jamais piégé (on finit par revenir au début de la page) ; - le lien d'évitement « Aller au contenu » est le premier élément atteint.
import { launch, pages } from './cdp.mjs'

const INTERACTIVE = `[...document.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
  .filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[inert],.maplibregl-ctrl-attrib')
    // Contenu d'un bloc repliable fermé : normalement hors du parcours (on ouvre d'abord le bloc, son titre est atteignable)
    && (!el.closest('details') || el.closest('details').open || el.closest('summary')) })`
const DESCRIBE = (el) => `(${el} ? (${el}.getAttribute('aria-label') || ${el}.textContent || ${el}.name || ${el}.tagName).trim().replace(/\\s+/g, ' ').slice(0, 40) : '')`

const list = pages(['/', '/itineraires', '/alertes', '/accessibilite', '/compte', '/connexion', '/inscription'])
const b = await launch()
let total = 0
for (const path of list) {
  await b.open(path)
  await b.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0); 1')
  const expected = await b.evaluate(`${INTERACTIVE}.length`)
  const reached = new Set()
  const problems = []
  let first = null
  for (let i = 0; i < expected + 40; i++) {
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    const info = await b.evaluate(`(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const all = ${INTERACTIVE}
      const outline = (n) => { const cs = getComputedStyle(n); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 }
      // Le contour peut entourer la carte entière (:has(:focus-visible)) : on regarde aussi le contour des deux parents
      const visibleFocus = outline(el) || getComputedStyle(el).boxShadow !== 'none'
        || [el.parentElement, el.parentElement?.parentElement].some((p) => p && outline(p))
      return { index: all.indexOf(el), name: ${DESCRIBE('el')}, skip: el.classList.contains('skip-link'), visibleFocus }
    })()`)
    if (!info) continue
    if (first === null) first = info
    if (info.index >= 0) {
      if (reached.has(info.index) && reached.size >= expected) break  // tour complet
      reached.add(info.index)
    }
    if (!info.visibleFocus) problems.push(`focus invisible sur « ${info.name} »`)
  }
  if (first && !first.skip) problems.push(`le premier élément atteint n'est pas le lien d'évitement (« ${first.name} »)`)
  // La page a pu finir de charger pendant le parcours : on compare à la liste finale
  const missing = await b.evaluate(`${INTERACTIVE}.map((el, i) => [i, ${DESCRIBE('el')}])`)
  const count = missing.length
  missing.filter(([i]) => !reached.has(i)).forEach(([, n]) => problems.push(`jamais atteint au clavier : « ${n} »`))
  const uniq = [...new Set(problems)]
  total += uniq.length
  console.log(`\n${path} : ${Math.min(reached.size, count)}/${count} éléments atteints au clavier${uniq.length ? '' : ', focus toujours visible'}`)
  uniq.slice(0, 10).forEach((p) => console.log('  - ' + p))
}
console.log(`\nProblèmes clavier : ${total}`)
b.close()
process.exitCode = total ? 1 : 0
