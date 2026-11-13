// Contrastes (RGAA 3.2 et 3.3, WCAG 1.4.3 et 1.4.11), dans les trois thèmes : clair, sombre, contraste renforcé.
import { launch, pages } from './cdp.mjs'

const CHECK = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const mix = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 })
  const ratioOf = (x, y) => { const L1 = lum(x), L2 = lum(y); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) }
  // Fond réel : on remonte les parents en composant les fonds semi-transparents ; image de fond = non mesurable
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('linear')) return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break } } let out = { r: 255, g: 255, b: 255, a: 1 }; for (const c of stack.reverse()) out = mix(c, out); return out }
  const bad = []
  const seen = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const n = walker.currentNode; const el = n.parentElement
    if (!el || !n.textContent.trim() || seen.has(el)) continue
    seen.add(el)
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('.sr-only,.maplibregl-ctrl,.maplibregl-ctrl-attrib') || (el.closest('[aria-hidden="true"]') && !el.classList.contains('map-pin'))) continue
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
    const fg = parse(cs.color); const bg = bgOf(el); if (!fg || !bg) continue
    const ratio = ratioOf(mix({ ...fg, a: fg.a * Number(cs.opacity) }, bg), bg)
    const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5
    if (ratio < need) bad.push({ text: n.textContent.trim().slice(0, 40), cls: el.className?.toString().slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, fg: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round) + ')' })
  }
  document.querySelectorAll('button, a.btn, input:not([type=hidden]):not([type=range]), select, .mode-chip, .chip, .tile--button').forEach((el) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    if (!r.width || cs.visibility === 'hidden' || el.closest('.sr-only,.maplibregl-ctrl') || el.disabled) return
    const around = bgOf(el.parentElement) || { r: 255, g: 255, b: 255, a: 1 }
    const fill = parse(cs.backgroundColor); const border = parseFloat(cs.borderTopWidth) > 0 ? parse(cs.borderTopColor) : null
    if ((!fill || fill.a === 0) && !border) return  // bouton « texte seul » : c'est son texte qui est contrôlé
    const vs = (c) => (!c || c.a === 0 ? 1 : ratioOf(mix(c, around), around))
    const best = Math.max(vs(fill), vs(border))
    if (best < 3) bad.push({ text: '[contour] ' + (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.tagName).trim().slice(0, 30), cls: el.className?.toString().slice(0, 40), ratio: Math.round(best * 100) / 100, need: 3, fg: border ? cs.borderTopColor : cs.backgroundColor, bg: 'rgb(' + [around.r, around.g, around.b].map(Math.round) + ')' })
  })
  return bad
})()`

const list = pages(['/', '/itineraires', '/compte', '/alertes', '/accessibilite', '/connexion', '/inscription', '/trajet'])
const modes = (process.env.MODES || 'light,dark,high').split(',')
const b = await launch()
let total = 0
for (const mode of modes) {
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode === 'dark' ? 'dark' : 'light' }] })
  for (const path of list) {
    await b.open(path, { prefs: { text_size: 2, high_contrast: mode === 'high' } })
    const found = (await b.evaluate(CHECK)) || []
    total += found.length
    console.log(`\n[${mode}] ${path} : ${found.length || 'aucun'} défaut${found.length > 1 ? 's' : ''}`)
    const uniq = [...new Map(found.map((x) => [`${x.cls}|${x.fg}|${x.bg}`, x])).values()]
    uniq.slice(0, 15).forEach((x) => console.log(`  ${x.ratio}:1 (≥ ${x.need}) « ${x.text} » .${x.cls} ${x.fg} sur ${x.bg}`))
  }
}
console.log(`\nTotal : ${total}`)
b.close()
process.exitCode = total ? 1 : 0
