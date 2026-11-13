// Capture d'écran d'une page (vérification visuelle, illustrations du dossier).
import { writeFileSync } from 'node:fs'
import { launch, sleep } from './cdp.mjs'

const [, , path = '/', out = 'capture.png', w = '390', h = '844'] = process.argv
const b = await launch({ width: Number(w), height: Number(h) })
await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: process.env.THEME === 'dark' ? 'dark' : 'light' }] })
await b.open(path, { prefs: process.env.HIGH ? { high_contrast: true } : undefined })
for (const step of (process.env.STEPS || '').split(';').filter(Boolean)) {
  const [kind, ...rest] = step.split(':'); const arg = rest.join(':')
  if (kind === 'wait') await sleep(Number(arg))
  if (kind === 'click') await b.evaluate(`document.querySelector(${JSON.stringify(arg)})?.click()`)
  if (kind === 'eval') await b.evaluate(arg)
}
const full = process.env.FULL === '1'
const height = full ? await b.evaluate('document.documentElement.scrollHeight') : Number(h)
const shot = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, clip: { x: 0, y: 0, width: Number(w), height, scale: 1 } })
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log(out, height, process.env.PROBE ? await b.evaluate(process.env.PROBE) : '')
b.close()
