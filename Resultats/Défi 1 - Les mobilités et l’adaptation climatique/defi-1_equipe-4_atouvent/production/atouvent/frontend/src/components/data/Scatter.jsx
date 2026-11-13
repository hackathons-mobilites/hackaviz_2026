// Nuage de points : écart de fréquentation (%) selon la température maximale du jour.
import { useState } from 'react'

const W = 560
const H = 280
const P = { l: 48, r: 14, t: 14, b: 34 }
const X = [10, 42]

export default function Scatter({ points, threshold, labels, format, title }) {
  const [hover, setHover] = useState(null)
  const values = points.flatMap((p) => [p.rail, p.bike]).filter((v) => v != null)
  const lo = Math.min(-20, Math.floor(Math.min(...values) / 10) * 10)
  const hi = Math.max(10, Math.ceil(Math.max(...values) / 10) * 10)
  const x = (v) => P.l + ((v - X[0]) / (X[1] - X[0])) * (W - P.l - P.r)
  const y = (v) => P.t + ((hi - v) / (hi - lo)) * (H - P.t - P.b)
  const yTicks = []
  for (let v = lo; v <= hi; v += 10) yTicks.push(v)

  return (
    <figure className="dchart">
      <div className="dchart__plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
          <rect className="dchart__band" x={x(threshold)} y={P.t} width={x(X[1]) - x(threshold)} height={H - P.t - P.b} />
          <text className="dchart__band-label" x={x(threshold) + 8} y={P.t + 16}>≥ {threshold} °C</text>
          {yTicks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'dchart__zero' : 'dchart__grid'} x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} />
              <text className="dchart__tick" x={P.l - 8} y={y(v) + 4} textAnchor="end">{v > 0 ? `+${v}` : v === 0 ? '0' : `−${-v}`} %</text>
            </g>
          ))}
          {[10, 20, 30, 40].map((v) => (
            <text key={v} className="dchart__tick" x={x(v)} y={H - 10} textAnchor="middle">{v} °C</text>
          ))}
          {points.map((p, i) => p.bike != null && (
            <rect key={`b${p.date}`} className="dchart__mark dchart__mark--2" x={x(p.tx) - 4.5} y={y(p.bike) - 4.5} width="9" height="9" rx="1.5"
              onMouseEnter={() => setHover(i)} />
          ))}
          {points.map((p, i) => p.rail != null && (
            <circle key={`r${p.date}`} className="dchart__mark dchart__mark--1" cx={x(p.tx)} cy={y(p.rail)} r="5"
              onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hover != null && (
          <div className="dchart__tip" style={{ left: `${(x(points[hover].tx) / W) * 100}%`, top: `${(Math.min(y(points[hover].rail ?? 0), y(points[hover].bike ?? 0)) / H) * 100}%` }}
            aria-hidden="true">
            <strong>{format.date(points[hover].date)} · {format.deg(points[hover].tx)}</strong>
            <span><i className="dchart__key dchart__key--1" />{labels.rail} : {format.pct(points[hover].rail)}</span>
            <span><i className="dchart__key dchart__key--2" />{labels.bike} : {format.pct(points[hover].bike)}</span>
          </div>
        )}
      </div>
      <figcaption className="dchart__legend">
        <span><i className="dchart__key dchart__key--1" />{labels.rail}</span>
        <span><i className="dchart__key dchart__key--2 dchart__key--square" />{labels.bike}</span>
      </figcaption>
      <details className="dchart__table">
        <summary>{labels.table}</summary>
        <table>
          <thead><tr><th scope="col">{labels.date}</th><th scope="col">{labels.tmax}</th><th scope="col">{labels.rail}</th><th scope="col">{labels.bike}</th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}><th scope="row">{format.date(p.date)}</th><td>{format.deg(p.tx)}</td><td>{format.pct(p.rail)}</td><td>{format.pct(p.bike)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
