// Estimation de la fréquentation selon la température maximale, à partir de la canicule de juin 2026 (chaleur.json) Palier le plus haut atteint : 30, 33, 35 ou 38 °C ; en dessous de 30 °C, jour ordinaire (0 %).
export function expectedChange(data, tx, field = 'rail') {
  if (tx == null || !data) return null
  const step = [...data.thresholds].reverse().find((t) => tx >= t)
  return step ? data.kpis[String(step)][field] : 0
}
