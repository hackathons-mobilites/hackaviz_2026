// Courbe des validations d'une gare, jour par jour, avec les jours de chaleur en bandes et la référence en pointillés
const W = 300
const H = 90

export default function Sparkline({ days, values, hot, reference, label }) {
  const known = values.filter((v) => v != null)
  if (!known.length) return null
  const lo = Math.min(...known, reference) * 0.9
  const hi = Math.max(...known, reference) * 1.05
  const step = W / Math.max(days.length - 1, 1)
  const y = (v) => H - ((v - lo) / (hi - lo)) * H
  // Trait interrompu là où la donnée manque (jamais relié par-dessus un trou)
  let d = ''
  values.forEach((v, i) => { if (v != null) d += `${d && values[i - 1] != null ? 'L' : 'M'}${(i * step).toFixed(1)} ${y(v).toFixed(1)}` })
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      {days.map((day, i) => hot.has(day) && <rect key={day} className="spark__hot" x={i * step - step / 2} y="0" width={step} height={H} />)}
      <line className="spark__ref" x1="0" x2={W} y1={y(reference)} y2={y(reference)} />
      <path className="spark__line" d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
