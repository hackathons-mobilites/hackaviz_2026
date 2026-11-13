// Tableau de données des écrans décideurs : une définition de colonnes, toujours le même rendu accessible (en-têtes de colonne et de ligne, nombres alignés à droite, défilement horizontal sur petit écran).
export default function DataTable({ columns, rows, caption, empty }) {
  if (!rows?.length) return <p className="dash-note">{empty}</p>
  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.num ? 'num' : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {columns.map((c) => {
                const v = c.format ? c.format(r[c.key], r) : r[c.key] ?? '—'
                return c.row
                  ? <th key={c.key} scope="row">{v}</th>
                  : <td key={c.key} className={c.num ? 'num mono' : undefined}>{v}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
