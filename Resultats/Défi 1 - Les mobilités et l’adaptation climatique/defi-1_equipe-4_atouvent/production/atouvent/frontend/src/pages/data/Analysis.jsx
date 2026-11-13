// 09 · Analyse décideurs : qui subit la chaleur dans les transports franciliens ?
import { readableOn } from '../../features/network.js'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client.js'
import Icon, { HAZARD_ICON } from '../../components/Icon.jsx'
import HBars from '../../components/data/HBars.jsx'
import Scatter from '../../components/data/Scatter.jsx'
import Sparkline from '../../components/data/Sparkline.jsx'
import { DataHeader } from './DataLayout.jsx'
import { day, deg, downloadCsv, num, pct } from './format.js'
import { useText } from './texts.js'

const StationMap = lazy(() => import('../../components/data/StationMap.jsx'))
const AC_ORDER = ['equipee', 'partielle', 'non']
const CHECK_DROP = -35 // en dessous : probablement travaux ou fermeture, à vérifier

export default function Analysis() {
  const { tx, list, locale } = useText()
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [t, setT] = useState(33)
  const [selected, setSelected] = useState(null)
  const [mapView, setMapView] = useState('drop')
  const [hz, setHz] = useState('chaleur')

  useEffect(() => {
    api.admin.analysis()
      .then((d) => { setData(d); setT(d.default_threshold); setSelected(d.priority[0]) })
      .catch(() => setError(true))
  }, [])

  const f = useMemo(() => ({
    pct: (v) => pct(v, locale), num: (v) => num(v, locale), deg: (v) => deg(v, locale),
    date: (iso) => day(iso, locale, { weekday: 'short', day: 'numeric', month: 'short' }),
    ratio: (v) => (v == null ? '—' : `×${v.toLocaleString(locale, { minimumFractionDigits: 2 })}`),
  }), [locale])

  if (error) return <><DataHeader /><main id="contenu" className="dash-main"><p className="field__error" role="alert">{tx('error')}</p></main></>
  if (!data) return <><DataHeader /><main id="contenu" className="dash-main"><p className="loading" role="status">{tx('loading')}</p></main></>

  const key = String(t)
  const k = data.kpis[key]
  const titles = data.by_title[key]
  const find = (label) => titles.find((x) => x.title.startsWith(label))?.change
  const solid = find('Tarification')
  const reliable = data.stations.filter((s) => s.reliable)
  const byId = Object.fromEntries(data.stations.map((s) => [s.id, s]))
  const station = byId[selected]
  const hot = new Set(data.daily.filter((d) => d.tx >= t).map((d) => d.date))
  const tc = (v) => deg(v, locale).replace(',0', '')
  const tLabel = `${t} °C`

  // Part des trajets à vélo après 20 h, jour ordinaire → jour de chaleur (profil horaire au seuil 33 °C)
  const evening = (field) => data.bike.hourly.filter((h) => h.h >= 20).reduce((s, h) => s + h[field], 0)
  // Gares les plus exposées (indice calculé par analyse/prepare.py)
  const priority = data.priority.map((id) => byId[id]).slice(0, 10)

  const exportPriority = () => downloadCsv(`atouvent-gares-prioritaires-${t}C.csv`, [
    [tx('col_station'), tx('col_lines'), tx('col_ac'), tx('col_index'), tx('st_vuln'), tx('st_living'), '% ménages pauvres', tx('col_ref'), `${tx('col_change')} (≥ ${tLabel})`],
    ...priority.map((s) => [s.name, s.lines.map((l) => l.line).join(' '), s.ac, s.index, s.vuln_day, s.living, s.poor, s.ref, s.change[key]]),
  ])

  return (
    <>
      <DataHeader aside={(
        <dl className="dash-period">
          <div><dt>{tx('period')}</dt><dd>{tx('period_value')}</dd></div>
          <div><dt>{tx('compared')}</dt><dd>{tx('compared_value')}</dd></div>
        </dl>
      )} />
      <main id="contenu" className="dash-main">
        <div className="dash-chips" role="group" aria-label={tx('hazard_label')}>
          <span className="dash-chips__label">{tx('hazard_label')}</span>
          {data.hazards.map((h) => (
            <button key={h.hazard} type="button" className="chip chip--toggle chip--icon" aria-pressed={hz === h.hazard}
              disabled={!h.days} onClick={() => setHz(h.hazard)}>
              <Icon name={HAZARD_ICON[h.hazard]} size={18} />{tx(`hz_${h.hazard}`)}
              <span className="chip__count">{tx('n_days', { n: h.days })}</span>
            </button>
          ))}
          <span className="dash-chips__note">{tx('hazard_note')}</span>
        </div>

        {hz !== 'chaleur' ? (
          <HazardView key={hz} h={data.hazards.find((x) => x.hazard === hz)} data={data} tx={tx} f={f} locale={locale} />
        ) : (<>
        <section className="dash-intro">
          <div>
            <p className="dash-eyebrow">{tx('eyebrow', {
              start: day(data.episode.start, locale, { day: 'numeric' }), end: day(data.episode.end, locale),
              tmax: tc(data.episode.tmax), date: day(data.episode.tmax_date, locale),
            })}</p>
            <h1 className="dash-title">{tx('title')}</h1>
            <p className="dash-headline">{tx('headline', { t: tLabel, rail: f.pct(k.rail).replace('−', ''), solid: f.pct(solid) })}</p>
          </div>
          <div className="dash-threshold">
            <label htmlFor="seuil">{tx('threshold')}</label>
            <input id="seuil" type="range" min="0" max={data.thresholds.length - 1} step="1" value={data.thresholds.indexOf(t)}
              aria-valuetext={tLabel} onChange={(e) => setT(data.thresholds[Number(e.target.value)])} />
            <output htmlFor="seuil">{tLabel}</output>
            <small>{tx('heat_days', { n: k.heat_days, t: tLabel })}</small>
          </div>
        </section>

        <section className="dash-kpis" aria-label="Indicateurs clés" aria-live="polite">
          <Kpi label={tx('k_rail')} value={f.pct(k.rail)} sub={tx('k_rail_sub')} warm={k.rail > 0} />
          <Kpi label={tx('k_bike')} value={f.pct(k.bike)} sub={tx('k_bike_sub', {
            n: data.bike.counters, from: pct(evening('ordinary'), locale), to: pct(evening('heat'), locale),
          }).replace(/\+/g, '')} />
          <Kpi label={tx('k_road')} value={f.pct(k.road)} sub={tx('k_road_sub', { n: num(data.road.arcs, locale) })} warm={k.road > 0} />
          <Kpi label={tx('k_noac')} value={pct(data.no_ac_share, locale).replace('+', '')} sub={tx('k_noac_sub')} dark />
          <Kpi label={tx('k_solid')} value={f.pct(solid)} sub={tx('k_solid_sub')} />
          <Kpi label={tx('k_occ')} value={f.pct(find('Forfaits courts'))} sub={tx('k_occ_sub', { navigo: f.pct(find('Abonnés')) })} warm={find('Forfaits courts') > 0} />
        </section>

        <section className="dash-row">
          <div className="dash-card dash-card--grow">
            <div className="dash-card__head">
              <h2>{tx('map_title')}</h2>
              <div className="dash-chips" role="group" aria-label={tx('map_title')}>
                {['drop', 'heat', 'poor'].map((v) => (
                  <button key={v} type="button" className="chip chip--toggle" aria-pressed={mapView === v} onClick={() => setMapView(v)}>{tx(`map_view_${v}`)}</button>
                ))}
              </div>
            </div>
            <Suspense fallback={<div className="dash-map dash-map--placeholder" />}>
              <StationMap stations={reliable} threshold={key} selected={selected} onSelect={setSelected} label={tx('map_aria')} view={mapView}
                tooltip={(p) => `${p.name} · ${pct(-p.drop, locale)}`} />
            </Suspense>
            {mapView === 'drop' ? (
              <div className="dash-legend">
                <span><i className="dot dot--1" />{tx('leg_ac')}</span>
                <span><i className="dot dot--2" />{tx('leg_noac')}</span>
                <span><i className="dot dot--ring" />{tx('leg_mixed')}</span>
                <span>{tx('leg_size')}</span>
              </div>
            ) : (
              <div className="dash-legend">
                <span>{tx(mapView === 'heat' ? 'leg_heat' : 'leg_poor')}</span>
                <span className="ramp-legend">{tx('leg_low')}<i className={`ramp ramp--${mapView}`} />{tx('leg_high')}</span>
                <span><i className="dot dot--neutral" />{tx('na')}</span>
              </div>
            )}
          </div>

          <aside className="dash-card dash-station" aria-labelledby="gare-titre">
            <label className="dash-label" htmlFor="gare">{tx('pick_station')}</label>
            <select id="gare" className="dash-select" value={selected || ''} onChange={(e) => setSelected(e.target.value)}>
              {[...reliable].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {station && <StationPanel s={station} k={k} t={t} hot={hot} data={data} tx={tx} f={f} locale={locale} />}
          </aside>
        </section>

        <section className="dash-row">
          <div className="dash-card dash-card--half">
            <h2>{tx('scatter_title')}</h2>
            <p className="dash-sub">{tx('scatter_sub')}</p>
            <Scatter threshold={t} title={tx('scatter_aria')} format={f}
              points={data.daily.map((d) => ({ ...d, bike: data.bike.daily[d.date] ?? null }))}
              labels={{ rail: tx('rail'), bike: tx('bike'), table: tx('table'), date: tx('date'), tmax: tx('tmax') }} />
          </div>

          <div className="dash-card dash-card--half">
            <div className="dash-card__head">
              <h2>{tx('prio_title')}</h2>
              <button type="button" className="dash-link" onClick={exportPriority}>{tx('export')}</button>
            </div>
            <p className="dash-sub">{tx('prio_sub_index')}</p>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead><tr><th scope="col">#</th><th scope="col">{tx('col_station')}</th><th scope="col">{tx('col_lines')}</th>
                  <th scope="col">{tx('col_ac')}</th><th scope="col" className="num">{tx('col_ref')}</th><th scope="col" className="num">{tx('col_index')}</th></tr></thead>
                <tbody>
                  {priority.map((s, i) => (
                    <tr key={s.id} aria-selected={s.id === selected} onClick={() => setSelected(s.id)}>
                      <td className="mono">{String(i + 1).padStart(2, '0')}</td>
                      <th scope="row"><button type="button" className="dash-rowbtn" onClick={() => setSelected(s.id)}>{s.name}</button></th>
                      <td><Lines lines={s.lines} /></td>
                      <td><span className={`tag ${s.ac === 'non' ? 'tag--warm' : 'tag--cool'}`}>{tx(s.ac === 'non' ? 'no' : 'partial')}</span></td>
                      <td className="num mono">{f.num(s.ref)}</td>
                      <td className="num mono">{s.index.toLocaleString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="dash-row">
          <div className="dash-card dash-card--half">
            <h2>{tx('who_title')}</h2>
            <p className="dash-sub">{tx('who_sub', { t: tLabel })}</p>
            <HBars rows={titles.map((x) => ({ label: x.title, value: x.change }))} format={f.pct} highlight={titles.find((x) => x.title.startsWith('Tarification'))?.title} />
            <p className="dash-note">{tx('who_note')}</p>
          </div>
          <div className="dash-card dash-card--half">
            <h2>{tx('ac_title')}</h2>
            <p className="dash-sub">{tx('ac_sub')}</p>
            <table className="dash-table">
              <thead><tr><th scope="col">{tx('ac_group')}</th><th scope="col" className="num">{tx('ac_stations')}</th>
                <th scope="col" className="num">{tx('ac_share')}</th><th scope="col" className="num">{tx('ac_change')}</th></tr></thead>
              <tbody>
                {AC_ORDER.map((ac) => data.by_ac[key].find((x) => x.ac === ac)).filter(Boolean).map((x) => (
                  <tr key={x.ac}>
                    <th scope="row"><i className={`dot ${x.ac === 'equipee' ? 'dot--1' : x.ac === 'non' ? 'dot--2' : 'dot--ring'}`} /> {tx(`ac_${x.ac}`)}</th>
                    <td className="num mono">{f.num(x.stations)}</td>
                    <td className="num mono">{pct(x.share, locale).replace('+', '')}</td>
                    <td className="num mono">{f.pct(x.change)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="dash-card">
          <h2>{tx('inc_title')}</h2>
          <p className="dash-sub">{tx('inc_sub')}</p>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th scope="col">{tx('inc_q')}</th><th scope="col" className="num">{tx('ac_stations')}</th><th scope="col" className="num">{tx('inc_noac')}</th>
                <th scope="col" className="num">{tx('inc_vuln')}</th><th scope="col" className="num">{tx('inc_change')} (≥ {tLabel})</th></tr></thead>
              <tbody>
                {data.by_income[key].map((q) => (
                  <tr key={q.q}>
                    <th scope="row">{tx(`inc_q${q.q}`, { v: `${num(q.living_max, locale)} €` })}</th>
                    <td className="num mono">{q.stations}</td>
                    <td className="num mono">{pct(q.no_ac, locale).replace('+', '')}</td>
                    <td className="num mono">{tx('out_of_9', { v: q.vuln_day?.toLocaleString(locale) })}</td>
                    <td className="num mono">{f.pct(q.change)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dash-note">{tx('inc_note')}</p>
        </section>
        </>)}

        <section className="dash-card">
          <h2>{tx('hz_title')}</h2>
          <p className="dash-sub">{tx('hz_sub')}</p>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th scope="col">{tx('hz_hazard')}</th><th scope="col">{tx('hz_def')}</th><th scope="col" className="num">{tx('hz_days')}</th>
                <th scope="col" className="num">{tx('hz_rail')}</th><th scope="col" className="num">{tx('hz_bike')}</th>
                <th scope="col" className="num">{tx('hz_road')}</th><th scope="col" className="num">{tx('hz_acc')}</th><th scope="col">{tx('hz_rel')}</th></tr></thead>
              <tbody>
                {data.hazards.map((h) => (
                  <tr key={h.hazard} aria-selected={h.hazard === hz}>
                    <th scope="row">
                      {h.days ? <button type="button" className="dash-rowbtn" onClick={() => { setHz(h.hazard); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                        <Icon name={HAZARD_ICON[h.hazard]} size={16} /> {tx(`hz_${h.hazard}`)}</button>
                        : <><Icon name={HAZARD_ICON[h.hazard]} size={16} /> {tx(`hz_${h.hazard}`)}</>}
                    </th>
                    <td>{h.definition}</td><td className="num mono">{h.days}</td>
                    <td className="num mono">{f.pct(h.rail)}</td><td className="num mono">{f.pct(h.bike)}</td><td className="num mono">{f.pct(h.road)}</td>
                    <td className="num mono">{f.ratio(h.accidents)}</td>
                    <td><span className={`tag tag--${h.reliability}`}>{tx(`rel_${h.reliability}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dash-note">{tx('hz_note')}</p>
        </section>

        <section className="dash-row">
          <div className="dash-card dash-card--half">
            <h2><Icon name="car" size={20} /> {tx('acc_title')}</h2>
            <p className="dash-sub">{tx('acc_sub', { n: f.num(data.accidents.total), from: data.accidents.years[0], to: data.accidents.years.at(-1) })}</p>
            <HBars rows={data.accidents.hours.map((x) => ({ label: `${tx(`acc_${x.key}`)} · ${f.num(x.hours)} h`, value: x.ratio == null ? null : Math.round((x.ratio - 1) * 1000) / 10 }))}
              format={f.pct} highlight={`${tx('acc_pluie_forte')} · ${f.num(data.accidents.hours[0]?.hours)} h`} />
            <p className="dash-note">{tx('acc_note')}</p>
          </div>
          <div className="dash-card dash-card--half">
            <h2><Icon name="elevator" size={20} /> {tx('el_title')}</h2>
            <p className="dash-sub">{tx('el_sub', { n: f.num(data.elevators_heat.elevators), d: f.num(data.elevators_heat.days),
              from: data.elevators_heat.period[0].slice(0, 4), to: data.elevators_heat.period[1].slice(0, 4) })}</p>
            <HBars rows={data.elevators_heat.bins.map((b) => ({ label: b.label, value: b.share }))} highlight="≥ 33 °C"
              format={(v) => pct(v, locale).replace('+', '')} />
            <p className="dash-note">{tx('el_note', { v: f.pct(elevatorExcess(data.elevators_heat)) })}</p>
          </div>
        </section>

        <section className="dash-card">
          <h2><Icon name="heat" size={20} /> {tx('pf_title')}</h2>
          <p className="dash-sub">{tx('pf_sub', { oms: data.platforms.oms_pm10 })}</p>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th scope="col">{tx('pf_station')}</th><th scope="col" className="num">{tx('pf_hot')}</th>
                <th scope="col" className="num">{tx('pf_ordinary')}</th><th scope="col" className="num">{tx('pf_max')}</th>
                <th scope="col" className="num">{tx('pf_pm10')}</th><th scope="col" className="num">{tx('pf_oms')}</th></tr></thead>
              <tbody>
                {data.platforms.stations.filter((x) => x.quai_hot != null).map((x) => (
                  <tr key={x.station}>
                    <th scope="row">{x.station}</th>
                    <td className="num mono">{f.deg(x.quai_hot)}</td><td className="num mono">{f.deg(x.quai_ordinary)}</td>
                    <td className="num mono">{f.deg(x.quai_max)}</td><td className="num mono">{f.num(x.pm10)} µg/m³</td>
                    <td className="num mono">{pct(x.pm10_over_oms, locale, 0).replace('+', '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dash-note">{tx('pf_note', { missing: data.platforms.stations.filter((x) => x.quai_hot == null).map((x) => x.station.split(' (')[0]).join(', ') })}</p>
        </section>

        <footer className="dash-footer">
          <h2>{tx('method_title')}</h2>
          <ul>{[...list('method'), tx('index_method')].map((m) => <li key={m}>{m}</li>)}</ul>
          <p><strong>{tx('sources')} :</strong> {data.sources.join(' · ')}</p>
          <p>{tx('prepared', { date: day(data.generated_at.slice(0, 10), locale, { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>
        </footer>
      </main>
    </>
  )
}

function Kpi({ label, value, sub, dark = false, warm = false }) {
  return (
    <div className={`kpi-card${dark ? ' kpi-card--dark' : ''}`}>
      <span className="kpi-card__label">{label}</span>
      <span className={`kpi-card__value${warm ? ' kpi-card__value--warm' : ''}`}>{value}</span>
      <span className="kpi-card__sub">{sub}</span>
    </div>
  )
}

function Lines({ lines }) {
  return (
    <span className="dash-lines">
      {lines.map((l) => (
        <span key={`${l.mode}${l.line}`} className="line-chip" style={{ '--line': l.color || 'var(--ardoise)', color: readableOn(l.color) }}
          title={l.ac === 'true' ? 'climatisée' : l.ac === 'partial' ? 'en partie climatisée' : 'non climatisée'}>{l.line}</span>
      ))}
    </span>
  )
}

function StationPanel({ s, k, t, hot, data, tx, f, locale }) {
  const key = String(t)
  const change = s.change[key]
  const noAc = s.lines.filter((l) => l.ac === 'false').length
  const values = data.series.values[s.id] || []
  return (
    <>
      <div>
        <p className="dash-eyebrow dash-eyebrow--muted">{tx('selected')}</p>
        <h2 id="gare-titre" className="dash-station__name">{s.name}</h2>
        <Lines lines={s.lines} />
      </div>
      <p className={`dash-status dash-status--${s.ac}`}>
        {tx(`st_status_${s.ac}`)}{s.vuln_day != null && ` · ${tx(s.vuln_day >= 6 ? 'st_heat_high' : s.vuln_day >= 4.5 ? 'st_heat_mid' : 'st_heat_low')}`}
      </p>
      <dl className="dash-facts">
        <div><dt>{tx('st_index')}</dt><dd className="warm">{s.index == null ? '—' : tx('out_of_10', { v: s.index.toLocaleString(locale) })}</dd></div>
        <div><dt>{tx('st_change')}</dt><dd>{f.pct(change)}</dd></div>
        <div><dt>{tx('st_living')}</dt><dd>{s.living ? tx('per_year', { v: f.num(s.living) }) : '—'}</dd></div>
        <div><dt>{tx('st_vuln')}</dt><dd>{s.vuln_day == null ? '—' : tx('out_of_9', { v: s.vuln_day.toLocaleString(locale) })}</dd></div>
        <div><dt>{tx('st_ref')}</dt><dd>{f.num(s.ref)}</dd></div>
        <div><dt>{tx('st_lines_noac')}</dt><dd>{noAc} / {s.lines.length}</dd></div>
      </dl>
      {s.poor != null && <p className="dash-sub">{tx('st_poor', { v: s.poor.toLocaleString(locale) })} · {tx('st_seniors', { n: f.num(s.seniors) })}</p>}
      {change != null && change < CHECK_DROP && <p className="dash-note">{tx('st_check')}</p>}
      <div className="dash-station__series">
        <p className="dash-label">{tx('st_series')}</p>
        <Sparkline days={data.series.days} values={values} hot={hot} reference={s.ref} label={tx('st_series')} />
        <p className="dash-note">{tx('st_series_hint', { t: `${t} °C` })}</p>
      </div>
    </>
  )
}

// Pannes d'ascenseurs : écart des jours ≥ 33 °C par rapport aux jours de 20 à 25 °C
function elevatorExcess(e) {
  const get = (label) => e.bins.find((b) => b.label === label)?.share
  const base = get('20 à 25 °C')
  const hot = get('≥ 33 °C')
  return base && hot ? Math.round((hot / base - 1) * 1000) / 10 : null
}

// Vue d'un aléa autre que la chaleur : chiffres clés, carte des gares, jours concernés, types de titre
function HazardView({ h, data, tx, f, locale }) {
  const key = h.hazard
  // La carte lit s.change[seuil] : on lui donne l'écart de chaque gare pendant cet aléa
  const stations = useMemo(() => data.stations.filter((s) => s.reliable && s.hazard[key] != null)
    .map((s) => ({ ...s, change: { [key]: s.hazard[key] } })), [data, key])
  const [selected, setSelected] = useState(null)
  const station = stations.find((s) => s.id === selected)
  const worst = [...stations].sort((a, b) => a.change[key] - b.change[key]).slice(0, 8)
  return (
    <>
      <section className="dash-intro">
        <div>
          <p className="dash-eyebrow"><Icon name={HAZARD_ICON[key]} size={16} /> {tx('hzv_eyebrow', { def: h.definition, n: h.days })}</p>
          <h1 className="dash-title">{tx(`hzv_title_${key}`)}</h1>
          <p className="dash-headline">{tx(`hzv_headline_${key}`, { rail: f.pct(h.rail), bike: f.pct(h.bike), road: f.pct(h.road), acc: f.pct(h.accidents == null ? null : Math.round((h.accidents - 1) * 100)) })}</p>
        </div>
        <p className={`tag tag--${h.reliability} dash-reliability`}>{tx('hz_rel')} : {tx(`rel_${h.reliability}`)} · {tx('n_days', { n: h.days })}</p>
      </section>

      <section className="dash-kpis" aria-label={tx('hz_title')}>
        <Kpi label={tx('k_rail')} value={f.pct(h.rail)} sub={tx('k_rail_sub')} warm={h.rail > 0} />
        <Kpi label={tx('k_bike')} value={f.pct(h.bike)} sub={tx('hzv_bike_sub', { n: data.bike.counters })} />
        <Kpi label={tx('k_road')} value={f.pct(h.road)} sub={tx('k_road_sub', { n: num(data.road.arcs, locale) })} warm={h.road > 0} />
        <Kpi label={tx('hz_acc')} value={f.ratio(h.accidents)} sub={tx('hzv_acc_sub', { n: f.num(h.accident_hours) })} dark warm={h.accidents > 1} />
      </section>

      <section className="dash-row">
        <div className="dash-card dash-card--grow">
          <div className="dash-card__head"><h2>{tx('hzv_map', { hz: tx(`hz_${key}`).toLowerCase() })}</h2></div>
          <Suspense fallback={<div className="dash-map dash-map--placeholder" />}>
            <StationMap stations={stations} threshold={key} selected={selected} onSelect={setSelected} label={tx('map_aria')} view="drop"
              tooltip={(p) => `${p.name} · ${pct(-p.drop, locale)}`} />
          </Suspense>
          <div className="dash-legend">
            <span><i className="dot dot--1" />{tx('leg_ac')}</span>
            <span><i className="dot dot--2" />{tx('leg_noac')}</span>
            <span><i className="dot dot--ring" />{tx('leg_mixed')}</span>
            <span>{tx('leg_size')}</span>
          </div>
        </div>
        <aside className="dash-card dash-station">
          {station ? (
            <>
              <p className="dash-eyebrow dash-eyebrow--muted">{tx('selected')}</p>
              <h2 className="dash-station__name">{station.name}</h2>
              <Lines lines={station.lines} />
              <dl className="dash-facts">
                <div><dt>{tx('st_change')}</dt><dd>{f.pct(station.change[key])}</dd></div>
                <div><dt>{tx('st_ref')}</dt><dd>{f.num(station.ref)}</dd></div>
              </dl>
              <button type="button" className="dash-link" onClick={() => setSelected(null)}>{tx('hzv_back')}</button>
            </>
          ) : (
            <>
              <h2>{tx('hzv_worst')}</h2>
              <ol className="dash-rank">
                {worst.map((s) => (
                  <li key={s.id}><button type="button" className="dash-rowbtn" onClick={() => setSelected(s.id)}>{s.name}</button>
                    <span className="mono">{f.pct(s.change[key])}</span></li>
                ))}
              </ol>
              <p className="dash-note">{tx('st_check')}</p>
            </>
          )}
        </aside>
      </section>

      <section className="dash-row">
        <div className="dash-card dash-card--half">
          <h2>{tx('hzv_days')}</h2>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th scope="col">{tx('date')}</th><th scope="col" className="num">{tx('tmax')}</th><th scope="col" className="num">{tx('tmin')}</th>
                <th scope="col" className="num">{tx('rain')}</th><th scope="col" className="num">{tx('gust')}</th><th scope="col" className="num">{tx('rail')}</th></tr></thead>
              <tbody>
                {h.list.map((d) => (
                  <tr key={d.date}>
                    <th scope="row">{day(d.date, locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}{d.snow && ` · ${tx('snow')}`}</th>
                    <td className="num mono">{f.deg(d.tx)}</td><td className="num mono">{f.deg(d.tn)}</td>
                    <td className="num mono">{d.rr == null ? '—' : `${d.rr.toLocaleString(locale)} mm`}</td>
                    <td className="num mono">{d.fxi == null ? '—' : `${Math.round(d.fxi * 3.6)} km/h`}</td>
                    <td className="num mono">{f.pct(d.rail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="dash-card dash-card--half">
          <h2>{tx('who_title')}</h2>
          <p className="dash-sub">{tx('hzv_who_sub', { hz: tx(`hz_${key}`).toLowerCase() })}</p>
          {h.titles?.length ? <HBars rows={h.titles.map((x) => ({ label: x.title, value: x.change }))} format={f.pct} />
            : <p className="dash-note">{tx('na')}</p>}
          <p className="dash-note">{tx(`hzv_note_${key}`)}</p>
        </div>
      </section>
    </>
  )
}
