// Mise en forme des nombres des écrans décideurs (signe typographique « − », virgule décimale)
const nf = (locale, opts) => new Intl.NumberFormat(locale, opts)

// Le signe moins typographique « − » (U+2212) se lit mieux qu'un trait d'union
const minus = (s) => s.replace(/^-/, '−')

export const pct = (v, locale = 'fr-FR', digits = 1) => (v == null ? '—'
  : `${minus(nf(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: 'exceptZero' }).format(v))} %`)

export const num = (v, locale = 'fr-FR') => (v == null ? '—' : nf(locale, { maximumFractionDigits: 0 }).format(v))

export const deg = (v, locale = 'fr-FR') => (v == null ? '—' : `${nf(locale, { maximumFractionDigits: 1 }).format(v)} °C`)

export const day = (iso, locale = 'fr-FR', opts = { day: 'numeric', month: 'long' }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale, opts)

// Couleur d'une série, lue dans les variables CSS (suit le thème clair ou sombre)
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

// Téléchargement d'un tableau en CSV (séparateur « ; » pour Excel en français)
export function downloadCsv(filename, rows) {
  const esc = (v) => (/[;"\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))
  const blob = new Blob([`﻿${rows.map((r) => r.map(esc).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: filename }).click()
  URL.revokeObjectURL(url)
}
