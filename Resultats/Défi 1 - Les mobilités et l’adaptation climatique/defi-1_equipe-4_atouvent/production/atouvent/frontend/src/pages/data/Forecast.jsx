// 11 · Prévision et risques : 7 jours, fréquentation attendue demain, lignes à surveiller (maquette 11), puis la chaleur à venir (années types +2,7 °C et +4 °C) gare par gare
import { readableOn } from '../../features/network.js'
import { useEffect, useState } from 'react'
import { api } from '../../api/client.js'
import Icon, { HAZARD_ICON, weatherIcon } from '../../components/Icon.jsx'
import { useI18n } from '../../i18n/index.jsx'
import { DataHeader } from './DataLayout.jsx'
import FutureHeat from './FutureHeat.jsx'
import { day, downloadCsv, num, pct } from './format.js'
import { expectedChange } from './model.js'
import { useText } from './texts.js'

const PARIS = { lat: 48.8566, lon: 2.3522 }
const MODE = { Metro: 'M', RapidTransit: 'RER', LocalTrain: '', Tramway: '' }

export default function Forecast() {
  const { tx, list, locale } = useText()
  const { t, time } = useI18n()
  const [weather, setWeather] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.weather(PARIS.lat, PARIS.lon).then(setWeather).catch(() => setError(tx('error')))
    api.admin.analysis().then(setData).catch(() => setError(tx('error')))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Jours réellement prévus par le modèle (Météo-France : environ 4 jours ; au-delà, pas de valeur)
  const days = weather?.days?.slice(1, 8).filter((d) => d.tx != null && d.tn != null) || []
  const tomorrow = days[0]
  const rail = expectedChange(data, tomorrow?.tx, 'rail')
  const bike = expectedChange(data, tomorrow?.tx, 'bike')
  const watch = (data?.lines || []).filter((l) => l.ac !== 'true' && ['Metro', 'RapidTransit', 'LocalTrain'].includes(l.mode)).slice(0, 8)
  const heatKey = String(data?.default_threshold || 33)
  const hot = tomorrow && tomorrow.tx >= 30
  const deg = (v) => `${Math.round(v)}°`
  const bars = [[tx('rail'), rail], [tx('bike'), bike]]
  const max = Math.max(1, ...bars.map(([, v]) => Math.abs(v || 0)))

  const exportLines = () => downloadCsv('atouvent-lignes-a-surveiller.csv', [
    [tx('fc_col_line'), tx('fc_col_ac'), tx('fc_col_ref'), `${tx('fc_col_heat')} (≥ ${heatKey} °C)`],
    ...watch.map((l) => [`${MODE[l.mode] ?? ''} ${l.line}`.trim(), l.ac, l.ref, l.change[heatKey]]),
  ])

  return (
    <>
      <DataHeader subtitle={tx('fc_sub')} aside={weather && <span className="dash-head__note">{tx('fc_at', { time: time(weather.fetched_at) })}</span>} />
      <main id="contenu" className="dash-main">
        {error && <p className="field__error" role="alert">{error}</p>}
        {tomorrow && data && (
          <section>
            <p className="dash-eyebrow">{tx('fc_eyebrow', { date: day(tomorrow.date, locale, { weekday: 'long', day: 'numeric', month: 'long' }) })}</p>
            <h1 className="dash-title">
              {hot ? tx('fc_title_hot', { tx: `${Math.round(tomorrow.tx)} °C`, rail: pct(rail, locale), n: watch.length })
                : tx('fc_title_calm', { tx: `${Math.round(tomorrow.tx)} °C` })}
            </h1>
          </section>
        )}

        <section className="fc-days" aria-label="7 jours">
          {days.map((d, i) => (
            <article key={d.date} className={`fc-day${i === 0 ? ' fc-day--first' : ''}${d.aleas.length ? ' fc-day--hazard' : ''}`}>
              <h2>{i === 0 ? tx('fc_tomorrow') : day(d.date, locale, { weekday: 'short', day: 'numeric' })}</h2>
              <Icon name={weatherIcon(d.code)} size={34} className="fc-day__sky" />
              <p className="fc-day__temp">{deg(d.tx)} / {deg(d.tn)}</p>
              {/* Chaque aléa avec son pictogramme et son nom (jamais l'icône seule) */}
              <ul className="fc-day__hazards">
                {d.aleas.length ? d.aleas.map((h) => (
                  <li key={h}><Icon name={HAZARD_ICON[h] || 'alert'} size={16} /> {t(`hazard.${h}`)}
                    {d.vigilance?.[h] && <span className={`vigilance-tag vigilance-tag--${d.vigilance[h].color}`}>{t(`flood.${d.vigilance[h].color}`)}</span>}</li>
                )) : <li><Icon name="check" size={16} /> {tx('fc_no_hazard')}</li>}
              </ul>
              {d.air && <p className="fc-day__air"><Icon name="wind" size={14} /> {t('air.title', { level: t(`air.level_${d.air.level}`) })}{d.air.uv_high ? ` · UV ${Math.round(d.air.uv)}` : ''}</p>}
            </article>
          ))}
        </section>

        {data && (
          <section className="dash-row">
            <div className="dash-card dash-card--half">
              <h2><Icon name="train" size={20} /> {tx('fc_freq')}</h2>
              <p className="dash-sub">{tx('fc_freq_sub')}</p>
              <ul className="hbars">
                {bars.map(([label, v]) => (
                  <li key={label} className="hbars__row hbars__row--hl">
                    <span className="hbars__label">{label}</span>
                    <span className="hbars__track" aria-hidden="true"><span className="hbars__bar" style={{ width: `${(Math.abs(v || 0) / max) * 100}%` }} /></span>
                    <span className="hbars__value">{pct(v, locale)}</span>
                  </li>
                ))}
              </ul>
              <p className="dash-note">{tx('fc_model')}</p>
            </div>

            <div className="dash-card dash-card--half">
              <div className="dash-card__head">
                <h2><Icon name="heat" size={20} /> {tx('fc_lines')}</h2>
                <button type="button" className="dash-link" onClick={exportLines}>{tx('export')}</button>
              </div>
              <p className="dash-sub">{tx('fc_lines_sub')}</p>
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr><th scope="col">{tx('fc_col_line')}</th><th scope="col">{tx('fc_col_ac')}</th><th scope="col" className="num">{tx('fc_col_ref')}</th>
                    <th scope="col" className="num">{tx('fc_col_heat')}</th><th scope="col">{tx('fc_col_action')}</th></tr></thead>
                  <tbody>
                    {watch.map((l) => (
                      <tr key={l.id}>
                        <th scope="row"><span className="line-chip" style={{ '--line': l.color || 'var(--ardoise)', color: readableOn(l.color) }}>{`${MODE[l.mode] ?? ''} ${l.line}`.trim()}</span></th>
                        <td><span className={`tag ${l.ac === 'false' ? 'tag--warm' : 'tag--moyenne'}`}>{tx(l.ac === 'false' ? 'l_not_equipped' : 'l_partial')}</span></td>
                        <td className="num mono">{num(l.ref, locale)}</td>
                        <td className="num mono">{pct(l.change[heatKey], locale)}</td>
                        <td>{tx(`act_${l.ac === 'false' ? 'false' : 'partial'}`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {data && (
          <section className="dash-kpis">
            <div className="kpi-card">
              <span className="kpi-card__label"><Icon name="heat" size={18} /> {tx('fc_heat')}</span>
              <span className="kpi-card__value kpi-card__value--warm">{pct(data.kpis['38'].rail, locale)}</span>
              <span className="kpi-card__sub">{tx('fc_heat_sub', { t33: pct(data.kpis['33'].rail, locale) })}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-card__label"><Icon name="rain" size={18} /> {tx('fc_bike')}</span>
              <span className="kpi-card__value">{pct(data.hazards.find((h) => h.hazard === 'orages_pluie')?.bike, locale)}</span>
              <span className="kpi-card__sub">{tx('fc_bike_sub', { n: data.hazards.find((h) => h.hazard === 'orages_pluie')?.days })}</span>
            </div>
            <div className="kpi-card kpi-card--dark fc-limits">
              <span className="kpi-card__label fc-limits__title">{tx('fc_limits')}</span>
              <ul>{list('fc_limits_list').map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </section>
        )}
        {/* Au-delà des 7 jours : la chaleur des prochaines décennies (TRACC) */}
        <FutureHeat projections={data?.projections} />
        <p className="dash-note">{weather?.source}</p>
      </main>
    </>
  )
}
