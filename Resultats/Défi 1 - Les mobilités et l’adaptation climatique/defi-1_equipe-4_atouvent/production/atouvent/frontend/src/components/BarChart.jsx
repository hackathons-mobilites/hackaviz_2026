// Histogramme simple (une série), accessible : infobulle au survol et au clavier, tableau équivalent.
import { useState } from 'react'

const W = 640
const H = 220
const PAD = { top: 16, right: 8, bottom: 40, left: 40 }

/** data : [{ key, label, value, flag }] · flag = texte court affiché sous la barre (ex. aléa du jour) */
export default function BarChart({ data, title, format = (v) => v, valueLabel, tableLabel, unknownLabel }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(...data.map((d) => d.value ?? 0), 0.0001)
  const iw = W - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  const step = iw / Math.max(data.length, 1)
  const bw = Math.max(2, step - 2) // 2 px d'écart entre les barres
  const ticks = [0, max / 2, max]

  return (
    <figure className="chart">
      <figcaption className="chart__title">{title}</figcaption>
      <div className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
          {ticks.map((v) => {
            const y = PAD.top + ih - (v / max) * ih
            return (
              <g key={v} className="chart__grid">
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
                <text x={PAD.left - 6} y={y + 4} textAnchor="end">{format(v)}</text>
              </g>
            )
          })}
          {data.map((d, i) => {
            const x = PAD.left + i * step + 1
            const h = d.value == null ? 0 : Math.max(2, (d.value / max) * ih)
            const y = PAD.top + ih - h
            return (
              <g key={d.key} tabIndex={0} className="chart__bar" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                aria-label={`${d.label} : ${d.value == null ? unknownLabel : format(d.value)}${d.flag ? `, ${d.flag}` : ''}`}>
                {/* zone de survol plus grande que la barre */}
                <rect x={x - 1} y={PAD.top} width={step} height={ih} fill="transparent" />
                {d.value != null && <path d={roundedTop(x, y, bw, h)} className={d.flag ? 'chart__mark chart__mark--flag' : 'chart__mark'} />}
                {d.flag && <text x={x + bw / 2} y={H - PAD.bottom + 16} textAnchor="middle" className="chart__flag">▲</text>}
              </g>
            )
          })}
          <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + ih} y2={PAD.top + ih} className="chart__axis" />
          {data.length > 0 && [0, data.length - 1].map((i) => (
            <text key={i} x={PAD.left + i * step + bw / 2} y={H - 6} textAnchor={i ? 'end' : 'start'} className="chart__tick">{data[i].label}</text>
          ))}
        </svg>
        {hover != null && (
          <div className="chart__tip" style={{ left: `${((PAD.left + hover * step + bw / 2) / W) * 100}%` }} aria-hidden="true">
            <strong>{data[hover].label}</strong>
            <span>{valueLabel} : {data[hover].value == null ? unknownLabel : format(data[hover].value)}</span>
            {data[hover].flag && <span>▲ {data[hover].flag}</span>}
          </div>
        )}
      </div>
      <details className="chart__table">
        <summary>{tableLabel}</summary>
        <table>
          <thead><tr><th scope="col">Date</th><th scope="col">{valueLabel}</th><th scope="col">▲</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}><th scope="row">{d.label}</th><td>{d.value == null ? unknownLabel : format(d.value)}</td><td>{d.flag || ''}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

// Barre à sommet arrondi (4 px), posée sur l'axe
function roundedTop(x, y, w, h) {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}
