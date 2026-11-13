// 10 · Données collectées par AtouVent et jeux ouverts complémentaires, pour les décideurs : perturbations par ligne, fiabilité des ascenseurs, signalements des voyageurs, assistance PMR SNCF, vélo à Paris.
import { useEffect, useState } from 'react'
import { api } from '../../api/client.js'
import Icon from '../../components/Icon.jsx'
import DataTable from '../../components/data/DataTable.jsx'
import Sparkline from '../../components/data/Sparkline.jsx'
import { useAutoRefresh } from '../../hooks/useAutoRefresh.js'
import { day, num, pct } from './format.js'

const TOPICS = ['traffic', 'elevators', 'reports', 'pmr', 'bike']

export default function Insights({ tx, t, locale }) {
  const [data, setData] = useState({})
  const [health, setHealth] = useState(null)
  const loadHealth = () => api.admin.dataHealth().then(setHealth).catch(() => setHealth(null))
  useEffect(() => { loadHealth() }, [])
  useAutoRefresh(loadHealth, 5 * 60_000)
  // Âge lisible : « 4 min », « 3 h », « 12 j »
  const age = (m) => (m == null ? '—' : m < 90 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} j`)
  const load = () => TOPICS.forEach((k) => api.admin.insight(k).then((r) => setData((d) => ({ ...d, [k]: r }))).catch(() => setData((d) => ({ ...d, [k]: d[k] || null }))))
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps
  useAutoRefresh(load, 10 * 60_000)
  const share = (v) => (v == null ? '—' : pct(100 * v, locale, 0).replace('+', ''))
  const { traffic, elevators, reports, pmr, bike } = data

  return (
    <>
      {health && (
        <section className="dash-card">
          <h2><Icon name={health.status === 'ok' ? 'check' : 'alert'} size={20} /> {tx('dh_title')}
            <span className={`tag dh-tag dh-tag--${health.status}`}>{tx(`dh_${health.status}`)}</span></h2>
          <p className="dash-sub">{tx('dh_sub')}</p>
          <DataTable caption={tx('dh_title')} rows={[...health.sources].sort((a, b) => ['ko', 'warn', 'ok'].indexOf(a.status) - ['ko', 'warn', 'ok'].indexOf(b.status))}
            columns={[
              { key: 'label', label: tx('dh_source'), row: true },
              { key: 'status', label: tx('dh_state'), format: (v) => <span className={`tag dh-tag dh-tag--${v}`}>{tx(`dh_${v}`)}</span> },
              { key: 'age_min', label: tx('dh_age'), num: true, format: age },
              { key: 'detail', label: tx('dh_detail') },
            ]} />
        </section>
      )}
      <section className="dash-row">
        <Card icon="alert" title={tx('in_traffic')} sub={traffic?.since ? tx('in_traffic_sub', { date: day(traffic.since, locale) }) : ''}>
          <DataTable empty={tx('in_none')} caption={tx('in_traffic')} rows={traffic?.lines.slice(0, 10)} columns={[
            { key: 'line', label: tx('fc_col_line'), row: true, format: (v, r) => `${r.mode === 'Metro' ? 'M ' : r.mode === 'RapidTransit' ? 'RER ' : ''}${v}` },
            { key: 'incidents', label: tx('in_incidents'), num: true },
            { key: 'hours', label: tx('in_hours'), num: true, format: (v) => `${v.toLocaleString(locale)} h` },
            { key: 'tags', label: tx('in_causes'), format: (v) => Object.entries(v).map(([k, n]) => `${tx(`tag_${k === 'autre' ? 'other' : k}`)} ${n}`).join(' · ') },
          ]} />
        </Card>
        <Card icon="elevator" title={tx('in_elev')} sub={elevators?.since ? tx('in_elev_sub', { date: day(elevators.since, locale) }) : ''}>
          <DataTable empty={tx('in_none')} caption={tx('in_elev')} rows={elevators?.stations.slice(0, 10)} columns={[
            { key: 'station', label: tx('col_station'), row: true },
            { key: 'share', label: tx('in_down_recent'), num: true, format: share },
            { key: 'breakdowns', label: tx('in_breakdowns'), num: true },
            { key: 'historic_share', label: tx('in_down_hist'), num: true, format: share },
          ]} />
        </Card>
      </section>
      <section className="dash-row">
        <Card icon="bell" title={tx('in_reports')} sub={tx('in_reports_sub', { n: num(reports?.total ?? 0, locale), d: reports?.days ?? 7 })}>
          <DataTable empty={tx('in_reports_none')} caption={tx('in_reports')} rows={reports?.by_kind.map(([k, n]) => ({ id: k, k, n }))} columns={[
            { key: 'k', label: tx('in_kind'), row: true, format: (v) => t(`report.${v}`) },
            { key: 'n', label: tx('in_count'), num: true },
          ]} />
          {reports?.by_line.length > 0 && <p className="dash-note">{tx('in_reports_lines', { lines: reports.by_line.map(([l, n]) => `${l} (${n})`).join(', ') })}</p>}
        </Card>
        <Card icon="a11y" title={tx('in_pmr')} sub={pmr ? tx('in_pmr_sub', { from: pmr.from, to: pmr.to, n: num(pmr.total, locale) }) : ''}>
          <DataTable empty={tx('in_none')} caption={tx('in_pmr')} rows={pmr?.stations.slice(0, 8)} columns={[
            { key: 'gare', label: tx('col_station'), row: true },
            { key: 'total', label: tx('in_requests'), num: true, format: (v) => num(v, locale) },
            { key: 'fauteuil', label: tx('in_wheelchair'), num: true, format: (v) => num(v, locale) },
          ]} />
        </Card>
      </section>
      {bike?.last && (
        <section className="dash-card">
          <h2><Icon name="bike" size={20} /> {tx('in_bike')}</h2>
          <p className="dash-sub">{tx('in_bike_sub', { date: day(bike.last.day, locale, { weekday: 'long', day: 'numeric', month: 'long' }),
            n: num(bike.last.n, locale), change: pct(bike.change, locale) })}</p>
          <Sparkline days={bike.days.map((d) => d.day)} values={bike.days.map((d) => d.n)} hot={new Set()} reference={bike.reference} label={tx('in_bike')} />
        </section>
      )}
    </>
  )
}

function Card({ icon, title, sub, children }) {
  return (
    <div className="dash-card dash-card--half">
      <h2><Icon name={icon} size={20} /> {title}</h2>
      {sub && <p className="dash-sub">{sub}</p>}
      {children}
    </div>
  )
}
