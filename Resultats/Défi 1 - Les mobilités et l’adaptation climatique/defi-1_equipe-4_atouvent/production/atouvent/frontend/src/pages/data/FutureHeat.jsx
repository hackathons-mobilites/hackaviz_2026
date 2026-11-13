// 11 · Prévision : la chaleur à venir.
import Icon from '../../components/Icon.jsx'
import DataTable from '../../components/data/DataTable.jsx'
import ScenarioBars from '../../components/data/ScenarioBars.jsx'
import { deg, downloadCsv, num, pct } from './format.js'
import { useText } from './texts.js'

const THRESHOLDS = ['30', '33', '35', '38']

export default function FutureHeat({ projections: p }) {
  const { tx, locale } = useText()
  if (!p) return null
  const [today, mid, high] = p.scenarios
  const names = { [today]: tx('fh_today'), [mid]: tx('fh_mid'), [high]: tx('fh_high') }
  const s = p.summaries
  const groups = THRESHOLDS.map((t) => ({
    label: tx('fh_days_above', { t }),
    rows: p.scenarios.map((k) => ({ label: names[k], value: s[k].days[t] })),
  }))
  const days = (v) => tx('fh_n_days', { n: num(v, locale) })
  const columns = [
    { key: 'name', label: tx('fh_col_station'), row: true },
    { key: 'lines', label: tx('fh_col_lines'), format: (v) => v.join(', ') },
    { key: 'change', label: tx('fh_col_drop'), num: true, format: (v) => pct(v, locale) },
    ...p.scenarios.map((k) => ({ key: k, label: tx('fh_col_lost', { s: names[k] }), num: true, format: (_, r) => num(r.lost[k], locale) })),
  ]
  const rows = p.stations.slice(0, 15)
  const exportCsv = () => downloadCsv('atouvent-chaleur-a-venir-par-gare.csv', [
    columns.map((c) => c.label),
    ...p.stations.map((r) => [r.name, r.lines.join(' '), r.change, ...p.scenarios.map((k) => r.lost[k])]),
  ])

  return (
    <section className="future-heat" aria-labelledby="fh-title">
      <p className="dash-eyebrow">{tx('fh_eyebrow')}</p>
      <h2 id="fh-title" className="dash-title dash-title--section">
        {tx('fh_title', { today: s[today].days['33'], mid: s[mid].days['33'], high: s[high].days['33'] })}
      </h2>

      <div className="dash-kpis">
        {p.scenarios.map((k) => (
          <div key={k} className="kpi-card">
            <span className="kpi-card__label"><Icon name="heat" size={18} /> {names[k]}</span>
            <span className="kpi-card__value kpi-card__value--warm">{days(s[k].days['33'])}</span>
            <span className="kpi-card__sub">{tx('fh_kpi_sub', { nights: s[k].tropical_nights, max: deg(s[k].tx_max, locale), run: s[k].longest_33 })}</span>
          </div>
        ))}
      </div>

      <div className="dash-row">
        <div className="dash-card dash-card--half">
          <ScenarioBars title={tx('fh_chart_title')} groups={groups} format={days} />
          <p className="dash-note">{tx('fh_paris_note', { n: s['Paris-Montsouris 2025-2026']?.days['33'] })}</p>
          {/* Alternative textuelle du graphique : le même contenu en tableau */}
          <details className="dash-details">
            <summary>{tx('fh_chart_table')}</summary>
            <DataTable caption={tx('fh_chart_title')} rows={THRESHOLDS.map((t) => ({ id: t, t, ...Object.fromEntries(p.scenarios.map((k) => [k, s[k].days[t]])) }))}
              columns={[{ key: 't', label: tx('fh_col_threshold'), row: true, format: (v) => `≥ ${v} °C` },
                ...p.scenarios.map((k) => ({ key: k, label: names[k], num: true }))]} />
          </details>
        </div>

        <div className="dash-card dash-card--half">
          <div className="dash-card__head">
            <h2><Icon name="train" size={20} /> {tx('fh_stations')}</h2>
            <button type="button" className="dash-link" onClick={exportCsv}>{tx('export')}</button>
          </div>
          <p className="dash-sub">{tx('fh_stations_sub', { n: num(p.stations_total, locale), mid: num(p.lost_total[mid], locale), high: num(p.lost_total[high], locale), today: num(p.lost_total[today], locale) })}</p>
          <DataTable caption={tx('fh_stations')} columns={columns} rows={rows} />
          {p.excluded?.length > 0 && <p className="dash-note">{tx('fh_excluded', { n: p.excluded.length, names: p.excluded.join(', ') })}</p>}
        </div>
      </div>
      <p className="dash-note">{tx('fh_method')}</p>
    </section>
  )
}
