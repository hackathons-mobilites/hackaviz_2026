// Pilotage de Chrome sans interface (protocole DevTools) pour les contrôles d'accessibilité d'AtouVent.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const BASE = process.env.BASE || 'http://localhost:5174'
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Ouvre Chrome (profil jetable) et renvoie { send, evaluate, open, close, on }. */
export async function launch({ width = 390, height = 844, port = 9300 + Math.floor(Math.random() * 500) } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'atouvent-a11y-'))
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
  let target
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250)
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page') } catch { /* Chrome démarre */ }
  }
  if (!target) throw new Error(`Chrome introuvable ou bloqué (${CHROME})`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  const listeners = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method) listeners.forEach((fn) => fn(m))
  })
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  // Limite de 60 s par évaluation : une page bloquée est signalée au lieu de figer tout le contrôle
  const evaluate = (expression) => {
    let timer
    const limit = new Promise((r) => { timer = setTimeout(() => { console.log('  ! page bloquée (60 s) : contrôle passé'); r(null) }, 60_000) })
    const run = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r.result?.result?.value)
    return Promise.race([run, limit]).finally(() => clearTimeout(timer))
  }
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 })
  const origin = new URL(BASE).origin
  await send('Browser.grantPermissions', { permissions: ['geolocation'], origin })
  await send('Emulation.setGeolocationOverride', { latitude: 48.8462, longitude: 2.4064, accuracy: 20 })

  /** Va sur une page de l'application, langue choisie, connecté si un jeton est fourni (TOKEN). */
  const open = async (path, { token = process.env.TOKEN, wait = Number(process.env.WAIT || 4000), prefs } = {}) => {
    await send('Page.navigate', { url: `${BASE}/bienvenue` })
    await sleep(800)
    await evaluate(`localStorage.setItem('atv.lang', 'fr');
      ${prefs ? `localStorage.setItem('atv.prefs', ${JSON.stringify(JSON.stringify(prefs))});` : ''}
      ${token ? "localStorage.setItem('atv.session', '1');" : "localStorage.removeItem('atv.session');"} 1`)
    // Session : cookie HttpOnly comme celui que pose l'API à la connexion
    if (token) await send('Network.setCookie', { name: 'atv_session', value: token, url: `${BASE}/api/`, path: '/api', httpOnly: true, sameSite: 'Strict' })
    else await send('Network.deleteCookies', { name: 'atv_session', url: `${BASE}/api/` })
    await send('Page.navigate', { url: `${BASE}${path}` })
    await sleep(wait)
    // Première ouverture : écran de langue, on le valide puis on revient à la page demandée
    if (await evaluate("location.pathname === '/bienvenue'")) {
      await evaluate("document.querySelector('.btn--primary')?.click()")
      await sleep(1500)
    }
    // L'écran de langue renvoie parfois à l'accueil : on revient à la page demandée
    if (await evaluate(`location.pathname !== ${JSON.stringify(new URL(path, BASE).pathname)}`)) {
      await send('Page.navigate', { url: `${BASE}${path}` })
      await sleep(wait)
    }
  }
  const close = () => { ws.close(); proc.kill() }
  return { send, evaluate, open, close, on: (fn) => listeners.push(fn) }
}

/** Pages à contrôler : PAGES="/,/itineraires" sinon la liste donnée. */
export const pages = (fallback) => (process.env.PAGES ? process.env.PAGES.split(',') : fallback)
