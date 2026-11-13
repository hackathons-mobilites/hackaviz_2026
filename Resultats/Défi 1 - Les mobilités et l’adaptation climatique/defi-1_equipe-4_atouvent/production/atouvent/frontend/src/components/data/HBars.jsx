// Barres horizontales d'une seule série (une couleur), valeur écrite au bout de chaque barre
export default function HBars({ rows, format, highlight }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value ?? 0)), 1)
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.label} className={`hbars__row${r.label === highlight ? ' hbars__row--hl' : ''}`}>
          <span className="hbars__label">{r.label}</span>
          <span className="hbars__track" aria-hidden="true">
            <span className="hbars__bar" style={{ width: `${(Math.abs(r.value ?? 0) / max) * 100}%` }} />
          </span>
          <span className="hbars__value">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  )
}
