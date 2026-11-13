// 03 · Carte « Autour de moi » : arrêts, Vélib', parkings vélo, fontaines, lieux frais, toilettes, parcs relais, chantiers.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import Icon from '../components/Icon.jsx'
import { chipsOf, KIND, kindOf, MAP_TABS, PLACE_GROUPS, subtitleOf } from '../features/places.js'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'
import { useI18n } from '../i18n/index.jsx'

const MapView = lazy(() => import('../components/MapView.jsx'))
export const STOP_BADGE = Object.fromEntries(['metro', 'rail', 'tram', 'bus'].map((k) => [k, KIND[k].badge]))
const SOURCE = { stops: 'it.stops_source', velib: 'map.velib_source', bike_parking: 'map.idfm_source', park_ride: 'map.idfm_source',
  toilets: 'map.toilets_source', works: 'map.paris_source', fountain: 'map.cool_source', cool: 'map.cool_source' }

const goTo = (p) => `/itineraires?${new URLSearchParams({ vers: p.name, lat: p.lat, lon: p.lon })}`

export default function AroundMap({ pos, stops, velibs, tab, setTab, me }) {
  const { t, locale } = useI18n()
  const date = (d) => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const [picked, setPicked] = useState(null)
  const [places, setPlaces] = useState({})  // groupe → liste (chargée à l'ouverture de l'onglet)

  const loadGroup = (group) => api.places(group, pos.lat, pos.lon)
    .then((r) => setPlaces((p) => ({ ...p, [group]: r }))).catch(() => setPlaces((p) => ({ ...p, [group]: p[group] || [] })))
  useEffect(() => { setPlaces({}) }, [pos.lat, pos.lon])
  useEffect(() => { if (PLACE_GROUPS.has(tab) && !places[tab]) loadGroup(tab) }, [tab, places]) // eslint-disable-line react-hooks/exhaustive-deps
  // Chantiers et toilettes peuvent changer dans la journée : rafraîchis toutes les 10 min
  useAutoRefresh(() => { if (PLACE_GROUPS.has(tab)) loadGroup(tab) }, 10 * 60_000, [tab, pos.lat, pos.lon])

  const list = tab === 'stops' ? stops : tab === 'velib' ? velibs : places[tab] ?? null
  const markers = useMemo(() => [
    ...(list || []).map((x, i) => {
      const k = KIND[kindOf(x, tab)] || KIND.indoor
      return { lat: x.lat, lon: x.lon, kind: tab === 'velib' && !(x.bikes > 0) ? 'tone-empty' : `tone-${k.tone}`,
        text: tab === 'velib' ? String(x.bikes ?? '?') : k.badge, selected: picked === i, onClick: () => setPicked(i) }
    }),
  ], [pos, list, tab, picked])
  const center = picked != null && list?.[picked] ? list[picked] : pos

  return (
    <section className="card around-map" aria-labelledby="t-map">
      <div className="around-map__head">
        <h2 id="t-map">{t('map.title')}</h2>
        <div className="map-tabs" role="group" aria-label={t('map.title')}>
          {MAP_TABS.map(({ key, icon }) => (
            <button key={key} type="button" className="mode-chip" aria-pressed={tab === key} onClick={() => { setTab(key); setPicked(null) }}>
              <Icon name={icon} size={16} /> {t(`map.tab_${key}`)}</button>
          ))}
        </div>
      </div>
      <Suspense fallback={<div className="map" />}>
        <MapView center={center} markers={markers} zoom={16} label={t('map.aria')} fit={picked == null} me={me} meLabel={t('map.center_me')} />
      </Suspense>
      <ul className="around-list">
        {list === null && <li className="loading" role="status">{t('app.loading')}</li>}
        {list?.length === 0 && <li className="card__meta">{t(`map.no_${tab}`)}</li>}
        {list?.map((x, i) => (
          <PlaceRow key={`${x.name}${i}`} place={x} tab={tab} on={picked === i} onPick={() => setPicked(i)} t={t} date={date} />
        ))}
      </ul>
      <p className="footnote">{t(SOURCE[tab])}</p>
    </section>
  )
}

// Une ligne de la liste, identique pour tous les types de lieux
function PlaceRow({ place, tab, on, onPick, t, date }) {
  const k = KIND[kindOf(place, tab)] || KIND.indoor
  const chips = chipsOf(place, tab)
  return (
    <li className={`around-item${on ? ' around-item--on' : ''}`}>
      <button type="button" className="around-item__main" aria-pressed={on} onClick={onPick}>
        <span className={`stop-badge stop-badge--${k.tone}`} aria-hidden="true">{k.badge && tab !== 'velib' ? k.badge : <Icon name={k.icon} size={18} />}</span>
        <span className="around-item__text">
          <strong>{place.name}</strong>
          <small>{subtitleOf(place, tab, t, date)}</small>
          {chips.length > 0 && (
            <span className="stop-chips">
              {chips.map((c) => <span key={c.key} className={`stop-chip${c.ok ? '' : ' stop-chip--no'}`}><Icon name={c.icon} size={14} /> {t(c.key, c.params)}</span>)}
            </span>
          )}
        </span>
      </button>
      {tab !== 'works' && <Link className="btn btn--small btn--outline" to={goTo(place)} aria-label={t('map.go_to', { name: place.name })}>{t('map.go')}</Link>}
    </li>
  )
}
