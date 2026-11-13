// 03 · Autour de moi : vigilance, recherche, gares proches (lignes climatisées ou non), fontaine, lieu frais, Vélib'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import ClimateNow from '../components/ClimateNow.jsx'
import AroundMap from './AroundMap.jsx'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'
import { useLiveStream } from '../hooks/useLiveStream.js'
import Icon from '../components/Icon.jsx'
import { Brand } from '../components/Logo.jsx'
import { isAdmin, useAuth } from '../context/AuthContext.jsx'
import { usePrefs } from '../context/PrefsContext.jsx'
import { distance } from '../features/trip/estimate.js'
import { inIdf, loadNetwork, nearestStations, usablePosition, readableOn } from '../features/network.js'
import { loadTrip } from '../features/trip/tripStore.js'
import { useGeolocation } from '../hooks/useGeolocation.js'
import { useI18n } from '../i18n/index.jsx'

const RAIL_MODES = new Set(['Metro', 'RapidTransit', 'LocalTrain', 'regionalRail', 'Tramway', 'RailShuttle'])

const RELOAD_M = 100  // déplacement au-delà duquel arrêts, Vélib' et météo sont rechargés

export default function Around() {
  const { user } = useAuth()
  const { t, time } = useI18n()
  const { prefs } = usePrefs()
  const navigate = useNavigate()
  // Position suivie en direct (watch) : le repère de la carte bouge avec l'appareil
  const geo = useGeolocation({ watch: true, enabled: prefs.use_location })
  const [query, setQuery] = useState('')
  const [weather, setWeather] = useState(null)
  const [flood, setFlood] = useState(null)
  const [stations, setStations] = useState(null)
  const [cool, setCool] = useState(null)
  const [velib, setVelib] = useState(null)
  const [hasTrip, setHasTrip] = useState(false)
  const [reports, setReports] = useState([])
  const [stops, setStops] = useState(null)
  const [velibs, setVelibs] = useState(null)
  const [mapTab, setMapTab] = useState('stops')
  const lastPos = useRef('')
  // Pour charger les données : on ne bouge cette position qu'après 100 m de déplacement (le repère de la carte, lui, suit chaque point GPS)
  const live = usablePosition(geo.coords)
  const [pos, setPos] = useState(() => ({ lat: live.lat, lon: live.lon }))
  useEffect(() => {
    if (distance(pos, live) > RELOAD_M) setPos({ lat: live.lat, lon: live.lon })
  }, [live.lat, live.lon]) // eslint-disable-line react-hooks/exhaustive-deps
  const me = geo.status === 'ok' && inIdf(geo.coords) ? geo.coords : null
  const outside = Boolean(geo.coords) && !inIdf(geo.coords)

  useEffect(() => { loadTrip().then((b) => setHasTrip(Boolean(b))) }, [])
  useEffect(() => { api.flood().then(setFlood).catch(() => setFlood(null)) }, [])

  // Données qui bougent : rechargées toutes les minutes sans recharger la page
  const refresh = () => {
    const key = `${pos.lat},${pos.lon}`
    api.velibNear(pos.lat, pos.lon, 800, 8).then((v) => {
      if (lastPos.current && lastPos.current !== key) return
      setVelib(v[0] || null)
      setVelibs(v.map((s) => ({ station_id: s.station_id, name: s.name, lat: s.location.coordinates[1], lon: s.location.coordinates[0], bikes: s.status?.bikes,
        ebike: s.status?.ebike, docks: s.status?.docks, trend: s.trend, distance_m: Math.round(distance(pos, { lat: s.location.coordinates[1], lon: s.location.coordinates[0] })) })))
    }).catch(() => { setVelib(null); setVelibs([]) })
    api.reports.near(pos.lat, pos.lon).then(setReports).catch(() => {})
  }
  useAutoRefresh(refresh, 60_000, [pos.lat, pos.lon])
  // En direct : le serveur pousse les changements (climat officiel, crue, Vélib', signalements) en quelques secondes
  useLiveStream({ lat: pos.lat, lon: pos.lon }, {
    climate: (d) => {
      if (d.flood) setFlood(d.flood)
      setWeather((w) => (w ? { ...w, days: w.days.map((x, i) => (i < 2 ? { ...x, vigilance: d.vigilance?.[i === 0 ? 'J' : 'J1'] || null } : x)) } : w))
    },
    velib: (d) => setVelibs((list) => (list ? list.map((v) => {
      const n = d.stations.find((x) => x.station_id === v.station_id)
      return n ? { ...v, bikes: n.bikes, ebike: n.ebike, docks: n.docks } : v
    }) : list)),
    reports: (d) => setReports(d.items),
  })
  useAutoRefresh(() => api.weather(pos.lat, pos.lon).then(setWeather).catch(() => {}), 10 * 60_000, [pos.lat, pos.lon])
  useAutoRefresh(() => api.flood().then(setFlood).catch(() => {}), 30 * 60_000)

  useEffect(() => {
    // Une réponse arrivée en retard (ancienne position) ne remplace pas la plus récente
    const key = `${pos.lat},${pos.lon}`
    lastPos.current = key
    api.stopsNear(pos.lat, pos.lon).then((r) => { if (lastPos.current === key) setStops(r) }).catch(() => setStops([]))
    api.weather(pos.lat, pos.lon).then((r) => { if (lastPos.current === key) setWeather(r) }).catch(() => setWeather(null))
    loadNetwork().then((gares) => setStations(nearestStations(gares.filter((g) => g.lines.some((l) => RAIL_MODES.has(l.mode))), pos)))
    api.coolNear(pos.lat, pos.lon).then((r) => { if (lastPos.current === key) setCool(r) }).catch(() => setCool({}))
    refresh()
  }, [pos.lat, pos.lon])

  const today = weather?.days?.[0]
  // Tuiles Fontaine, Lieu frais, Vélib' : ouvrent l'onglet correspondant de la carte
  const openMap = (tab) => {
    setMapTab(tab)
    document.getElementById('t-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const search = (e) => {
    e.preventDefault()
    navigate(`/itineraires?vers=${encodeURIComponent(query)}`)
  }

  return (
    <>
      <header className="page-head around-head">
        <div className="page-head__inner">
          <div className="page-head__row">
            <Link to="/" className="brand-link"><Brand size={32} fontSize={20} /></Link>
            <span className="position-chip">
              <Icon name="locate" size={18} />
              {geo.coords ? t('around.position', { m: Math.round(geo.coords.accuracy) }) : t('around.no_position')}
            </span>
          </div>
          {outside && <p className="banner banner--info" role="status"><Icon name="locate" /> {t('around.outside')}</p>}
          <form role="search" onSubmit={search} className="around-search">
            <label htmlFor="dest">{t('around.where')}</label>
            <input id="dest" className="input around-search__input" type="search" placeholder={t('around.placeholder')}
              autoComplete="street-address" value={query} onChange={(e) => setQuery(e.target.value)} />
          </form>
          <Link to="/itineraires" className="around-head__link">{t('around.see_routes')}</Link>
        </div>
      </header>

      <main id="contenu" className="app-main around-main">
        {/* Le climat d'abord : conditions, aléas à venir, vigilance, crue, air */}
        <ClimateNow weather={weather} flood={flood} />
        <div className="section-title">
          <h1 className="section-title__h1">{t('around.title')}</h1>
        </div>

        {stations === null && <div className="stations-loading"><p className="loading" role="status">{t('app.loading')}</p></div>}
        {stations?.length === 0 && <p className="card__meta">{t('around.no_station')}</p>}
        {stations?.map((s) => <StationCard key={s.id} station={s} />)}

        {reports.length > 0 && (
          <section className="card" aria-labelledby="t-reports">
            <h2 id="t-reports"><Icon name="bell" size={20} /> {t('live.reports')}</h2>
            <ul className="list">
              {reports.slice(0, 5).map((r) => (
                <li key={r.id} className="card__meta">
                  <strong>{t(`report.${r.kind}`)}</strong> · {[r.line && t('live.on_line', { line: r.line }), r.stop, t('live.ago', { time: time(r.at) })].filter(Boolean).join(' · ')}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="tiles" aria-label={t('around.nearby')}>
          <Tile icon="drop" label={t('around.fountain')} value={cool?.fountain && t('around.meters', { m: cool.fountain.distance_m })} onClick={() => openMap('fountain')} />
          <Tile icon="tree" label={t('around.cool')} value={cool?.cool && t('around.meters', { m: cool.cool.distance_m })} tone="vert" onClick={() => openMap('cool')} />
          <Tile icon="bike" label={t('around.velib_short', { n: velib?.status?.bikes ?? '' }).trim()} tone="ardoise"
            value={velib && t('around.meters', { m: Math.round(distance(pos, { lat: velib.location.coordinates[1], lon: velib.location.coordinates[0] })) })}
            onClick={() => openMap('velib')} />
        </section>

        <AroundMap pos={pos} stops={stops} velibs={velibs} tab={mapTab} setTab={setMapTab} me={me} />

        {hasTrip && (
          <Link className="btn btn--dark btn--block btn--lg" to="/trajet"><Icon name="pin" /> {t('around.resume')}</Link>
        )}
        <p className="around-links">
          <Link to="/alertes">{t('alerts.title')}</Link>
          {isAdmin(user) && <> · <Link to="/donnees">{t('data.title')}</Link></>}
        </p>
      </main>
    </>
  )
}

function Tile({ icon, label, value, tone = 'bleu', onClick }) {
  const body = (
    <>
      <Icon name={icon} size={22} className={`tile__icon tile__icon--${tone}`} />
      <strong>{label}</strong>
      <span>{value || '—'}</span>
    </>
  )
  // Tuile Vélib' : un bouton qui ouvre la carte des stations
  return onClick ? <button type="button" className="tile tile--button" onClick={onClick}>{body}</button> : <div className="tile">{body}</div>
}

// Carte d'une gare proche : lignes, climatisation de chacune, prochains passages si disponibles
function StationCard({ station }) {
  const { t } = useI18n()
  const [deps, setDeps] = useState(null)
  const loadDeps = () => api.departures(station.id).then(setDeps).catch(() => setDeps((d) => d || { departures: [], stale: true }))
  useEffect(() => { loadDeps() }, [station.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useAutoRefresh(loadDeps, 30_000, [station.id])

  const lines = station.lines.filter((l) => RAIL_MODES.has(l.mode))
  const byLine = (l) => (deps?.departures || []).filter((d) => d.line?.includes(l.id))
  const minutes = (d) => Math.max(0, Math.round((Date.parse(d.expected || d.aimed) - Date.now()) / 60000))
  const live = deps && deps.departures?.length > 0

  return (
    <section className="card station" aria-label={`${station.name}, ${t('around.walk', { m: station.m, min: station.walkMin })}`}>
      <div className="station__head">
        <div>
          <h2 className="station__name">{station.name}</h2>
          <p className="card__meta">{t('around.walk', { m: station.m, min: station.walkMin })}</p>
        </div>
        {station.accessible && <span className="badge badge--ok"><Icon name="check" size={16} strokeWidth={2.5} />{t('around.accessible')}</span>}
      </div>
      <ul className="station__lines">
        {lines.map((l) => {
          const next = byLine(l)
          return (
            <li key={l.id} className="station__line">
              <LineChip line={l} />
              <div className="station__line-body">
                <span className="station__dest">{next[0]?.destination ? t('around.towards', { dest: next[0].destination }) : t(`mode.${modeKey(l.mode)}`)}</span>
                <span className={`station__ac station__ac--${l.ac}`}>{t(`around.ac_${l.ac}`)}</span>
              </div>
              {/* Colonne des passages toujours présente : la ligne ne se resserre pas quand les horaires arrivent */}
              <div className="station__time">
                {next[0] && <strong>{t('around.min', { n: minutes(next[0]) })}</strong>}
                {next[1] && <small>{t('around.then', { n: minutes(next[1]) })}</small>}
              </div>
            </li>
          )
        })}
      </ul>
      {deps && !live && <p className="card__meta station__nolive">{t('around.no_live')}</p>}
    </section>
  )
}

const modeKey = (mode) => ({ Metro: 'SUBWAY', Tramway: 'TRAM' }[mode] || 'RAIL')

// Pastille aux couleurs officielles de la ligne (texte toujours lisible, jamais la couleur seule)
export function LineChip({ line }) {
  const prefix = { Metro: 'M', Tramway: '', RapidTransit: 'RER' }[line.mode] ?? ''
  const style = line.color ? { background: line.color, color: readableOn(line.color) } : undefined
  return <span className="line" style={style}>{`${prefix} ${line.line}`.trim()}</span>
}
