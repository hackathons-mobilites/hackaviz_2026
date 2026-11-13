// Audit automatique des écrans (une partie du RGAA, le reste se vérifie à la main) : erreurs JavaScript, requêtes en échec, débordement horizontal, nom accessible des boutons et liens (RGAA 6.1, 11.1), images sans alternative (RGAA 1.1), zones tactiles < 24 px (WCAG 2.5.8) et < 44 px (conseil), titre h1 (RGAA 9.1), langue de la page (RGAA 8.3), identifiants en double, zone principale <main>, graphiques et cartes sans titre (RGAA 1.1).
import { launch, pages } from './cdp.mjs'

const CHECK = `(() => {
  const out = []
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[aria-hidden="true"],.sr-only') }
  const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || el.textContent || el.title || el.querySelector('img[alt]')?.alt || (el.labels && [...el.labels].map((l) => l.textContent).join(' ')) || el.placeholder || '').trim()
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('débordement horizontal : ' + document.documentElement.scrollWidth + ' px')
  document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]').forEach((el) => {
    if (!visible(el)) return
    if (!nameOf(el)) out.push('sans nom accessible : <' + el.tagName.toLowerCase() + ' class="' + el.className + '">')
    const r = el.getBoundingClientRect()
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline'
    if (!inline && (r.width < 24 || r.height < 24)) out.push('cible < 24 px : ' + Math.round(r.width) + '×' + Math.round(r.height) + ' « ' + nameOf(el).slice(0, 30) + ' »')
    else if (!inline && (r.width < 44 || r.height < 44)) out.push('cible < 44 px (conseil) : ' + Math.round(r.width) + '×' + Math.round(r.height) + ' « ' + nameOf(el).slice(0, 30) + ' »')
  })
  document.querySelectorAll('img').forEach((img) => { if (!img.hasAttribute('alt')) out.push('image sans alt : ' + img.src.slice(-40)) })
  document.querySelectorAll('svg[role=img]').forEach((s) => { if (!s.getAttribute('aria-label') && !s.querySelector('title')) out.push('graphique sans titre') })
  document.querySelectorAll('.maplibregl-canvas').forEach((c) => { if (!c.closest('[aria-label],[aria-labelledby]') && !c.getAttribute('aria-label')) out.push('carte sans titre') })
  if (!document.querySelector('h1')) out.push('pas de titre h1')
  if (!document.documentElement.lang) out.push('langue de la page absente')
  if (!document.querySelector('main')) out.push('pas de zone main')
  const ids = {}; document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1 })
  Object.entries(ids).filter(([, n]) => n > 1).forEach(([k]) => out.push('id en double : ' + k))
  return out
})()`

const list = pages(['/', '/itineraires', '/trajet', '/alertes', '/accessibilite', '/compte', '/connexion', '/inscription',
  '/inscription/profil', '/mot-de-passe-oublie', '/bienvenue', '/page-inexistante'])
const b = await launch({ width: Number(process.env.W || 390) })
let events = []
b.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') events.push('erreur JS : ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0])
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') events.push('console : ' + m.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 160))
  if (m.method === 'Network.loadingFailed' && !m.params.canceled) events.push('réseau : ' + m.params.errorText)
})
let total = 0
for (const path of list) {
  events = []
  await b.open(path)
  const found = [...new Set([...((await b.evaluate(CHECK)) || []), ...events])]
  const blocking = found.filter((f) => !f.includes('(conseil)'))
  total += blocking.length
  console.log(`\n${path} : ${found.length ? '' : 'RAS'}`)
  const counts = {}
  found.forEach((f) => { const k = f.split(' : ')[0]; counts[k] = (counts[k] || 0) + 1; if (counts[k] <= 4) console.log('  - ' + f) })
  Object.entries(counts).filter(([, n]) => n > 4).forEach(([k, n]) => console.log(`  … ${n} × ${k}`))
}
console.log(`\nProblèmes à corriger : ${total}`)
b.close()
process.exitCode = total ? 1 : 0
