// 10 · Supervision temps réel : météo, Seine, Vélib', collecte, prochains passages, sources (maquette 10)
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client.js'
import { loadNetwork, readableOn } from '../../features/network.js'
import { useI18n } from '../../i18n/index.jsx'
import { DataHeader } from './DataLayout.jsx'
import { day, num, pct } from './format.js'
import { expectedChange } from './model.js'
import Insights from './Insights.jsx'
import { useText } from './texts.js'

const REFRESH_MS = 60_000
const PARIS = { lat: 48.8566, lon: 2.3522 }
const RAIL = new Set(['Metro', 'RapidTransit', 'LocalTrain', 'regionalRail', 'Tramway', 'RailShuttle'])

export default function Supervision() {
  const { tx, list, locale } = useText()
  const { t, time } = useI18n()
  const [now, setNow] = useState(new Date())
  const [weather, setWeather] = useState(null)
  const [seine, setSeine] = useState(null)
  const [flood, setFlood] = useState(null)
  const [rivers, setRivers] = useState(null)
  const [velib, setVelib] = useState(null)
  const [collect, setCollect] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [elev, setElev] = useState(null)
  const [traffic, setTraffic] = useState(null)

  useEffect(() => {
    const load = () => {
      setNow(new Date())
      api.weather(PARIS.lat, PARIS.lon).then(setWeather).catch(() => {})
      api.seine().then(setSeine).catch(() => setSeine(null))
      api.flood().then(setFlood).catch(() => setFlood(null))
      api.rivers().then(setRivers).catch(() => setRivers([]))
      api.velibSummary().then(setVelib).catch(() => {})
      api.collectStatus().then(setCollect).catch(() => {})
      api.elevators.summary().then(setElev).catch(() => {})
      api.traffic().then(setTraffic).catch(() => setTraffic(null))
    }
    load()
    api.admin.analysis().then(setAnalysis).catch(() => {})
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const today = weather?.days?.[0]
  const tomorrow = weather?.days?.[1]
  const w = weather?.now
  const gaps = collect ? Object.values(collect).reduce((s, c) => s + c.gaps.length, 0) : null
  const elevKnown = elev?.total > 0

  return (
    <>
      <DataHeader subtitle={tx('live_sub')} aside={<span className="dash-live"><span className="status-dot" aria-hidden="true" />{tx('live_now', { time: time(now) })}</span>} />
      <main id="contenu" className="dash-main">
        <h1 className="sr-only">{tx('live_sub')}</h1>
        <section className="dash-kpis dash-kpis--5" aria-live="polite">
          <Kpi dark label={tx('l_temp')} value={w ? `${Math.round(w.temperature)} °C` : '—'}
            sub={w ? tx('l_temp_sub', { rr: w.pluie_mm, g: Math.round(w.rafales_kmh), time: time(w.time) }) : ''} />
          <Kpi label={tx('l_hazards')} value={today ? (today.aleas.length ? today.aleas.map((h) => t(`hazard.${h}`)).join(', ') : tx('l_hazards_none')) : '—'}
            small warm={today?.aleas.length > 0} sub={tx('l_hazards_sub')} />
          <Kpi label={tx('l_seine')} value={seine ? `${seine.level_m.toLocaleString(locale)} m` : '—'}
            sub={`${seine ? tx('l_seine_sub', { trend: tx(`trend_${seine.trend}`), time: time(seine.at) }) : ''}${flood ? ` · ${tx('l_flood', { color: tx(`flood_${flood.color}`), n: flood.watch.length })}` : ''}`} />
          {traffic
            ? <Kpi label={tx('l_traffic')} value={num(traffic.rail, locale)} warm={traffic.rail > 0}
                sub={`${tx('l_traffic_count', { n: num(traffic.rail, locale) })} ${tx('l_traffic_bus', { n: num(traffic.bus, locale) })}`} />
            : <Kpi label={tx('l_traffic')} value={tx('l_key_prim')} small muted />}
          {elevKnown
            ? <Kpi label={tx('l_elev')} value={num(elev.out, locale)} warm sub={`${tx('l_elev_count', { total: num(elev.total, locale), time: time(elev.at) })}${elev.night ? ` · ${tx('l_elev_night', { n: num(elev.night, locale) })}` : ''}`} />
            : <Kpi label={tx('l_elev')} value={tx('l_key_idfm')} small muted sub={tx('l_elev_sub')} />}
        </section>
        {rivers?.length > 0 && (
          <section className="dash-card">
            <h2>{tx('l_rivers')}</h2>
            <p className="dash-sub">{tx('l_rivers_sub')}{flood ? ` · ${tx('l_flood', { color: tx(`flood_${flood.color}`), n: flood.watch.length })}` : ''}</p>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead><tr><th scope="col">{tx('l_river_station')}</th><th scope="col" className="num">{tx('l_height')}</th><th scope="col">{tx('l_trend')}</th><th scope="col" className="num">{tx('l_at')}</th></tr></thead>
                <tbody>
                  {rivers.map((r) => (
                    <tr key={r.code}><th scope="row">{r.station}</th><td className="num mono">{r.level_m.toLocaleString(locale)} m</td>
                      <td><span className={`tag ${r.trend === 'hausse' ? 'tag--warm' : 'tag--cool'}`}>{tx(`trend_${r.trend}`)}</span></td>
                      <td className="num mono">{time(r.at)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <section className="dash-kpis dash-kpis--3">
          <Kpi label={tx('l_velib')} value={velib ? num(velib.bikes, locale) : '—'}
            sub={velib ? tx('l_velib_sub', { empty: num(velib.empty, locale), stations: num(velib.stations, locale) }) : ''} />
          <Kpi label={tx('l_collect')} value={gaps == null ? '—' : gaps > 1 ? tx('l_collect_gaps', { n: gaps }) : gaps === 1 ? tx('l_collect_gap1') : tx('l_collect_ok')} small warm={gaps > 0}
            sub={collect ? Object.entries(collect).map(([k, c]) => `${k === 'velib_status' ? 'Vélib’' : list('src_elev')[0]} : ${c.ok}/${c.runs}`).join(' · ') : ''} />
          <div className="kpi-card">
            <span className="kpi-card__label">{tx('l_tomorrow')}</span>
            <span className="kpi-card__value kpi-card__value--small">
              {tomorrow ? `${Math.round(tomorrow.tx)} °C · ${pct(expectedChange(analysis, tomorrow.tx), locale)}` : '—'}
            </span>
            <Link className="dash-cta" to="/donnees/prevision">{tx('l_tomorrow_link')}</Link>
          </div>
        </section>

        <section className="dash-row dash-row--top">
          {traffic ? <TrafficPanel data={traffic} tx={tx} time={time} /> : (
            <div className="dash-card dash-card--grow">
              <h2>{tx('l_info')}</h2>
              <p className="dash-sub">{tx('l_info_body')}</p>
            </div>
          )}
          <Departures tx={tx} />
        </section>

        <h2 className="dash-section-title">{tx('in_title')}</h2>
        <Insights tx={tx} t={t} locale={locale} />

        <section className="dash-card">
          <h2>{tx('l_sources')}</h2>
          <div className="src-grid">
            {[['src_weather', true], ['src_air', true], ['src_vigilance', Boolean(weather?.vigilance_available)], ['src_seine', true], ['src_velib', true], ['src_ac', true], ['src_prim', Boolean(traffic)], ['src_elev', elevKnown], ['src_gps', true]].map(([k, on]) => (
              <div key={k} className="src">
                <strong>{list(k)[0]}</strong>
                <span>{list(k)[1]}</span>
                <span className={`tag ${on ? 'tag--solide' : 'tag--warm'}`}>{on ? tx('on') : tx('key')}</span>
              </div>
            ))}
          </div>
        </section>
        <p className="dash-note">{day(now.toISOString().slice(0, 10), locale, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </main>
    </>
  )
}

// Info trafic en direct : perturbations ferrées, filtrables par motif (maquette 10)
function TrafficPanel({ data, tx, time }) {
  const [filter, setFilter] = useState('all')
  const [lines, setLines] = useState({})
  useEffect(() => {
    loadNetwork().then((g) => {
      const out = {}
      g.forEach((s) => s.lines.forEach((l) => { out[l.id] = l }))
      setLines(out)
    })
  }, [])
  const items = data.items.filter((x) => filter === 'all' || x.tags.includes(filter))
  return (
    <div className="dash-card dash-card--grow">
      <div className="dash-card__head">
        <h2>{tx('l_info')}</h2>
        <div className="dash-chips" role="group" aria-label={tx('l_info')}>
          {['all', 'meteo', 'acces', 'travaux'].map((f) => (
            <button key={f} type="button" className="chip chip--toggle" aria-pressed={filter === f} onClick={() => setFilter(f)}>{tx(`f_${f}`)}</button>
          ))}
        </div>
      </div>
      <ul className="traffic-list">
        {items.slice(0, 12).map((x) => {
          const l = lines[x.line_id]
          const tag = x.tags.find((t) => t !== 'travaux') || x.tags[0] || 'other'
          return (
            <li key={`${x.id}${x.line_id}`} className={`traffic-item${x.tags.includes('meteo') ? ' traffic-item--meteo' : ''}`}>
              <span className="line-chip" style={{ '--line': l?.color || 'var(--ardoise)', color: readableOn(l?.color) }}>{x.line}</span>
              <div>
                <strong>{x.title}</strong>
                <span>{x.since ? tx('since', { time: time(x.since) }) : ''}{x.message ? ` · ${x.message.slice(0, 140)}${x.message.length > 140 ? '…' : ''}` : ''}</span>
              </div>
              <span className="traffic-item__tag">{tx(`tag_${tag}`)}</span>
            </li>
          )
        })}
      </ul>
      {!items.length && <p className="dash-sub">{tx('none_filter')}</p>}
      <p className="dash-note">{tx('traffic_src')}</p>
    </div>
  )
}

function Kpi({ label, value, sub, dark = false, warm = false, small = false, muted = false }) {
  return (
    <div className={`kpi-card${dark ? ' kpi-card--dark' : ''}`}>
      <span className="kpi-card__label">{label}</span>
      <span className={`kpi-card__value${warm ? ' kpi-card__value--warm' : ''}${small ? ' kpi-card__value--small' : ''}${muted ? ' kpi-card__value--muted' : ''}`}>{value}</span>
      {sub && <span className="kpi-card__sub">{sub}</span>}
    </div>
  )
}

// Prochains passages d'une gare, avec la climatisation de chaque ligne
function Departures({ tx }) {
  const [gares, setGares] = useState([])
  const [id, setId] = useState('')
  const [deps, setDeps] = useState(null)
  useEffect(() => {
    loadNetwork().then((g) => {
      const rail = g.filter((x) => x.lines.some((l) => RAIL.has(l.mode))).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      setGares(rail)
      setId(rail.find((x) => x.name === 'Châtelet')?.id || rail[0]?.id || '')
    })
  }, [])
  useEffect(() => {
    if (!id) return
    setDeps(null)
    api.departures(id).then(setDeps).catch(() => setDeps({ departures: [] }))
  }, [id])
  const gare = useMemo(() => gares.find((g) => g.id === id), [gares, id])
  const acLabel = { true: 'l_equipped', false: 'l_not_equipped', partial: 'l_partial', unknown: 'l_unknown' }

  return (
    <aside className="dash-card dash-station" aria-labelledby="dep-title">
      <p id="dep-title" className="dash-eyebrow dash-eyebrow--muted">{tx('l_departures')}</p>
      <label className="dash-label" htmlFor="dep-gare">{tx('l_station')}</label>
      <select id="dep-gare" className="dash-select" value={id} onChange={(e) => setId(e.target.value)}>
        {gares.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      {gare && (
        <ul className="dep-list">
          {gare.lines.filter((l) => RAIL.has(l.mode)).map((l) => {
            const next = (deps?.departures || []).find((d) => d.line?.includes(l.id))
            return (
              <li key={l.id}>
                <span className="line-chip" style={{ '--line': l.color || 'var(--ardoise)', color: readableOn(l.color) }}>{l.line}</span>
                <span className="dep-list__dest">{next?.destination || l.mode.replace('RapidTransit', 'RER').replace('LocalTrain', 'Transilien').replace('Tramway', 'Tram').replace('Metro', 'Métro')}</span>
                <span className={`tag ${l.ac === 'true' ? 'tag--cool' : l.ac === 'false' ? 'tag--warm' : ''}`}>{tx(acLabel[l.ac] || 'l_unknown')}</span>
                {next && <strong>{Math.max(0, Math.round((Date.parse(next.expected || next.aimed) - Date.now()) / 60000))} min</strong>}
              </li>
            )
          })}
        </ul>
      )}
      {deps && !deps.departures?.length && <p className="dash-note">{tx('l_no_live')}</p>}
      {gare && gare.accessible != null && <p className="dash-status dash-status--equipee">{tx(gare.accessible ? 'l_accessible' : 'l_not_accessible')}</p>}
    </aside>
  )
}
