// 04 · Itinéraires : départ (position GPS proposée, ou adresse saisie), destination, modes (ferré, bus, vélo, marche), trajet recommandé selon le profil, la météo et le temps de chaque étape (marche, attente, trajet), enregistrement avant de partir
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client.js'
import Icon from '../../components/Icon.jsx'
import PageHead from '../../components/PageHead.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePrefs } from '../../context/PrefsContext.jsx'
import { inIdf, legDirection, legLabel as label, lineIndex, loadNetwork, PARIS, readableOn } from '../../features/network.js'
import { localWarnings } from '../../features/trip/estimate.js'
import { accessNotes, amenityChips, stopNotes } from '../../features/trip/stopInfo.js'
import ClimateBanner from './ClimateBanner.jsx'
import DepartPicker from './DepartPicker.jsx'
import { saveTrip } from '../../features/trip/tripStore.js'
import { useGeolocation } from '../../hooks/useGeolocation.js'
import { useI18n } from '../../i18n/index.jsx'
import { storage } from '../../utils/storage.js'
import { useAutoRefresh } from '../../hooks/useAutoRefresh.js'

// Grammes lisibles : « 35 g », « 1,2 kg »
const grams = (g) => (g >= 1000 ? `${(g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg` : `${g} g`)
const mins = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000))
const minutes = (it) => mins(it.start, it.end)
const rides = (it) => it.legs.filter((l) => l.mode !== 'WALK')
const MODES = ['rail', 'bus', 'bike', 'walk']
const MODE_ICON = { rail: 'train', bus: 'bus', bike: 'bike', walk: 'walk' }
const LEG_ICON = { WALK: 'walk', BICYCLE: 'bike', BUS: 'bus', TRAM: 'tram', SUBWAY: 'train', RAIL: 'train' }
// Profils pour lesquels la marche est plus lente et les trajets sans marche proposés d'abord
const SLOW = ['fauteuil', 'marche_difficile', 'malvoyant']
// Vélo ou marche seuls (pas de transport en commun)
const active = (it) => ['walk', 'bike', 'velib'].includes(it.source)
// Aléas qui rendent le vélo et la marche pénibles ou dangereux
const OUTDOOR_RISK = ['orages_pluie', 'vent_fort', 'neige_verglas', 'grand_froid']

// Temps de chaque étape : marche, attente (entre deux étapes) et trajet à bord
function breakdown(it) {
  let walk = 0
  let wait = 0
  let ride = 0
  it.legs.forEach((l, i) => {
    const d = mins(l.start, l.end)
    if (l.mode === 'WALK') walk += d
    else ride += d
    if (i > 0) wait += mins(it.legs[i - 1].end, l.start)
  })
  return { walk, wait, ride, changes: Math.max(0, rides(it).filter((l) => l.mode !== 'BICYCLE').length - 1) }
}

/** Trajet à venir : la météo « de maintenant » devient celle prévue au départ (null au-delà de l'horizon de prévision). */
function atDeparture(w, departAt) {
  if (!departAt) return { ...w, planned: null }
  if (!w.at) return { ...w, now: null, hours: [], days: [], planned: null }
  return { ...w, now: w.at, hours: w.at.hours, days: w.at.day ? [w.at.day] : [], planned: w.at }
}

export default function Itineraries() {
  const { t, time, err } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { prefs } = usePrefs()
  const geo = useGeolocation({ enabled: prefs.use_location })
  const { user, addPlace } = useAuth()
  const profile = user?.profile || []
  const slow = profile.some((p) => SLOW.includes(p))

  const [query, setQuery] = useState(params.get('vers') || '')
  const [places, setPlaces] = useState(null)
  // Destination enregistrée ouverte depuis « Mon compte » : ?vers=…&lat=…&lon=…
  const [dest, setDest] = useState(() => (params.get('lat') && params.get('lon')
    ? { lat: Number(params.get('lat')), lon: Number(params.get('lon')), name: params.get('vers') || '' } : null))
  const [sort, setSort] = useState(params.get('sans-marche') || prefs.step_free ? 'step_free' : 'best')
  const [its, setIts] = useState(null)
  const [picked, setPicked] = useState(0)
  const [hazards, setHazards] = useState([])
  const [weather, setWeather] = useState(null)
  const [flood, setFlood] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [line, setLine] = useState(() => () => ({ ac: 'unknown' }))
  // Départ : position GPS proposée par défaut, ou adresse saisie par l'usager
  const [fromQuery, setFromQuery] = useState('')
  const [fromPlaces, setFromPlaces] = useState(null)
  const [from, setFrom] = useState(null)
  const [modes, setModes] = useState(() => storage.getJSON('atv.modes', MODES))
  // Heure de départ : null = maintenant (temps réel) ; sinon trajet à venir (ISO), calculé avec la météo prévue à cette heure
  const [departAt, setDepartAt] = useState(null)

  // Le profil du compte arrive après le premier affichage : « sans marche » suit le profil
  useEffect(() => { if (prefs.step_free) setSort('step_free') }, [prefs.step_free])

  const gps = inIdf(geo.coords) ? { lat: geo.coords.lat, lon: geo.coords.lon, name: t('it.my_position') } : null
  const origin = from || gps || PARIS
  // Le GPS répond souvent après le premier affichage : on recalcule dès que le départ bouge de plus de ~100 m (arrondi à 3 décimales, pour ne pas recalculer à chaque petit saut du GPS)
  const originKey = `${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}`
  const toggleMode = (m) => {
    const next = modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m]
    if (!next.length) return
    setModes(next)
    storage.setJSON('atv.modes', next)
  }
  // Recherches déjà faites gardées le temps de la page : retaper ou effacer une lettre ne relance rien
  const searches = useRef(new Map())
  const lookup = (q) => {
    const key = q.trim().toLowerCase()
    if (!searches.current.has(key)) searches.current.set(key, api.geoSearch(q).catch((x) => { searches.current.delete(key); throw x }))
    return searches.current.get(key)
  }
  const findOrigin = async () => {
    setError('')
    try { setFromPlaces(await lookup(fromQuery)) } catch (x) { setError(err(x.code)) }
  }
  const pickOrigin = (p) => {
    setFrom(p)
    setFromQuery(p ? p.name : '')
    setFromPlaces(null)
  }
  useEffect(() => { loadNetwork().then((g) => setLine(() => lineIndex(g))) }, [])

  // Climatisation de chaque ligne du trajet (référentiel IDFM)
  const acOf = (it) => rides(it).map((l) => ({ ...l, ref: line(l.mode, l.line) }))
  const noAc = (it) => acOf(it).filter((l) => l.ref.ac === 'false').length
  const outdoor = hazards.filter((h) => OUTDOOR_RISK.includes(h))

  // Note de chaque trajet (plus petit = meilleur), en minutes « ressenties » : durée + correspondances + marche et attente (pondérées selon le profil) + aléas du jour
  const score = (it) => {
    const b = breakdown(it)
    let s = minutes(it) + 4 * b.changes + b.walk * (slow ? 1.5 : 0.3) + b.wait * 0.5
    if (hazards.includes('chaleur') || prefs.avoid_noac) s += 8 * noAc(it)
    if (active(it)) s += outdoor.length ? 45 : 5  // à durée égale, les transports en commun d'abord
    // Ascenseur en panne : bloquant seulement pour un trajet sans marche (sinon simple information)
    if (it.elevators_out?.length && (sort === 'step_free' || slow)) s += 999
    if (sort === 'step_free' && !it.accessible) s += 60
    // Arrêts : abri sous la pluie ou la chaleur, accessibilité, annonces sonores ou visuelles selon le profil
    s += stopNotes(it, { needs: profile, hazards, flood }).penalty
    s += (it.carbon?.co2_g ?? 0) / 100  // l'écologie compte aussi dans la recommandation
    return s
  }
  // Écologique : le moins de CO2 d'abord, mais jamais au mépris du climat ou du profil (orage, canicule, fauteuil…) : les pénalités climat et profil du score restent ; 10 g de CO2 pèsent comme 1 min
  const ecoScore = (it) => (it.carbon?.co2_g ?? 0) / 10 + score(it) * 0.6
  const minCo2 = its?.length ? Math.min(...its.map((x) => x.carbon?.co2_g ?? Infinity)) : null
  const SORTS = {
    best: (a, b) => score(a) - score(b),
    fastest: (a, b) => minutes(a) - minutes(b),
    step_free: (a, b) => score(a) - score(b),
    eco: (a, b) => ecoScore(a) - ecoScore(b),
  }

  const findPlaces = async (e) => {
    e?.preventDefault()
    // Départ saisi mais pas encore choisi dans la liste : on cherche d'abord le départ
    if (fromQuery.trim().length >= 3 && (!from || from.name !== fromQuery)) return findOrigin()
    if (query.trim().length < 3) return
    setError('')
    setDest(null)
    setIts(null)
    try { setPlaces(await lookup(query)) } catch (x) { setError(err(x.code)) }
  }
  useEffect(() => { if (query && !dest) findPlaces() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Suggestions pendant la frappe (250 ms après la dernière lettre), sans avoir à valider
  useEffect(() => {
    if (dest && query === dest.name) return undefined
    if (query.trim().length < 3) { setPlaces(null); return undefined }
    let current = true
    const id = setTimeout(() => lookup(query).then((r) => current && setPlaces(r)).catch(() => {}), 250)
    return () => { current = false; clearTimeout(id) }
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (from && fromQuery === from.name) return undefined
    if (fromQuery.trim().length < 3) { setFromPlaces(null); return undefined }
    let current = true
    const id = setTimeout(() => lookup(fromQuery).then((r) => current && setFromPlaces(r)).catch(() => {}), 250)
    return () => { current = false; clearTimeout(id) }
  }, [fromQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  const savedPlace = dest && user?.places?.find((p) => Math.abs(p.lat - dest.lat) < 1e-5 && Math.abs(p.lon - dest.lon) < 1e-5)
  const savePlace = async () => {
    const name = window.prompt(t('places.name_prompt'), dest.name.split(',')[0])
    if (!name?.trim()) return
    try { await addPlace({ name: name.trim().slice(0, 80), label: dest.name.slice(0, 200), lat: dest.lat, lon: dest.lon }); setStatus(t('places.saved')) }
    catch (x) { setError(err(x.code)) }
  }

  useEffect(() => {
    if (!dest) return
    setIts(null)
    setPicked(0)
    setError('')
    setWeather(null)
    // Réponse d'une recherche dépassée (départ, destination ou modes changés entre-temps) : ignorée
    let current = true
    api.trips.plan({ origin, destination: dest, accessible: sort === 'step_free', modes, walk: slow ? 'slow' : 'normal', depart_at: departAt })
      .then((r) => current && setIts(r.itineraries))
      .catch((x) => current && setError(err(x.code)))
    api.weather(dest.lat, dest.lon, departAt).then((raw) => {
      if (!current) return
      const w = atDeparture(raw, departAt)
      setWeather(w)
      setHazards([...new Set([...(w.days?.[0]?.aleas || []), ...(w.hours || []).map((e) => e.hazard)])])
    }).catch(() => {})
    api.flood().then((f) => current && setFlood(f.level >= 2)).catch(() => {})
    return () => { current = false }
  }, [dest, sort, originKey, modes.join(), slow, departAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Horaires et temps réel : trajets recalculés toutes les 2 minutes, sans écran de chargement ni perte du choix
  useAutoRefresh(() => {
    if (!dest || status || departAt) return  // trajet à venir : horaires théoriques, pas de rafraîchissement
    api.trips.plan({ origin, destination: dest, accessible: sort === 'step_free', modes, walk: slow ? 'slow' : 'normal' })
      .then((r) => setIts(r.itineraries)).catch(() => {})
  }, 120_000, [dest, sort, originKey, modes.join(), slow, status, departAt])

  // Avant de partir : tout le trajet est enregistré sur le téléphone
  const follow = async (trip) => {
    setStatus(t('it.preparing'))
    let bundle
    try {
      bundle = await api.trips.bundle(trip)
    } catch {
      bundle = { trip, warnings: localWarnings(trip), generated_at: new Date().toISOString(), partial: true }
    }
    try {
      await saveTrip(bundle)
    } catch {
      setStatus('')
      setError(t('it.save_failed'))
      return
    }
    navigate('/trajet')
  }

  // Même trajet (mêmes lignes) à des heures différentes : une seule carte avec les départs suivants
  const sorted = its ? [...its].sort(SORTS[sort]).reduce((acc, it) => {
    const sig = rides(it).map((l) => `${l.mode}${l.line}${l.from.name}${l.to.name}`).join('|') || it.source
    const same = rides(it).length > 0 && acc.find((x) => x.sig === sig)
    if (same) same.next.push(it.start)
    else acc.push({ ...it, sig, next: [] })
    return acc
  }, []) : null
  // Pourquoi le premier trajet est recommandé
  const reasons = (it) => {
    if (!sorted || sorted.length < 2) return []
    const others = sorted.filter((x) => x !== it)
    const b = breakdown(it)
    return [
      others.every((x) => minutes(it) <= minutes(x)) && t('it.why_fastest'),
      it.carbon && others.every((x) => (it.carbon.co2_g ?? 0) <= (x.carbon?.co2_g ?? Infinity)) && t('it.why_eco'),
      !active(it) && others.every((x) => b.changes <= breakdown(x).changes) && b.changes <= 1 && t('it.why_changes'),
      (hazards.includes('chaleur') || prefs.avoid_noac) && rides(it).length > 0 && noAc(it) === 0 && t('it.why_ac'),
      outdoor.length > 0 && !active(it) && t('it.why_sheltered'),
      slow && others.every((x) => b.walk <= breakdown(x).walk) && t('it.why_walk'),
    ].filter(Boolean)
  }

  return (
    <>
      <PageHead title={t('it.title')}>
        <form className="route-form" onSubmit={findPlaces}>
          <label htmlFor="from" className="route-form__label">{t('it.from')}</label>
          <div className="route-form__search">
            <input id="from" className="input input--dark" type="search" value={fromQuery} autoComplete="street-address"
              placeholder={gps ? `${t('it.my_position')} (GPS)` : t('it.from_placeholder')}
              onChange={(e) => { setFromQuery(e.target.value); if (!e.target.value) pickOrigin(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && fromQuery.trim().length >= 3) { e.preventDefault(); findOrigin() } }} />
            {gps && (
              <button type="button" className="icon-btn" aria-label={t('it.use_my_position')} aria-pressed={!from} onClick={() => pickOrigin(null)}>
                <Icon name="locate" size={20} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <label htmlFor="to" className="route-form__label">{t('it.to')}</label>
          <div className="route-form__search">
            <input id="to" className="input input--dark" type="search" value={query} placeholder={t('around.placeholder')}
              onChange={(e) => { setQuery(e.target.value); if (dest) { setDest(null); setIts(null) } }} />
            <button className="icon-btn" aria-label={t('it.search')}><Icon name="chevron" size={20} strokeWidth={2.5} /></button>
          </div>
        </form>
        <ClimateBanner weather={weather} at={departAt} />
      </PageHead>

      <main id="contenu" className="app-main its">
        {/* Compte classique ou profil de déplacement (handicap) */}
        {user && profile.length > 0 ? (
          <Link to="/accessibilite" className="profile-strip profile-strip--a11y">
            <Icon name="a11y" size={20} />
            <span><strong>{t('it.profile_on', { profile: profile.map((p) => t(`profile.${p}`)).join(' · ') })}</strong>
              <small>{t(slow ? 'it.profile_slow' : 'it.profile_adapted')}</small></span>
          </Link>
        ) : (
          <p className="profile-strip">
            <Icon name="account" size={20} />
            <span><strong>{t('it.profile_classic')}</strong>
              <small>{user ? <Link to="/accessibilite">{t('it.profile_add')}</Link> : <Link to="/inscription">{t('it.profile_signup')}</Link>}</small></span>
          </p>
        )}

        {geo.coords && !inIdf(geo.coords) && <p className="banner banner--info" role="status"><Icon name="locate" /> {t('around.outside')}</p>}
        {error && <p className="field__error" role="alert">{error}</p>}
        {status && <p className="banner banner--info" role="status"><Icon name="download" /> {status}</p>}

        {!gps && !from && <p className="card__meta"><Icon name="locate" size={16} /> {t('it.no_gps')}</p>}
        {fromPlaces && (
          <section aria-label={t('it.pick_origin')}>
            <p className="card__meta">{fromPlaces.length ? t('it.pick_origin') : t('it.no_places')}</p>
            <ul className="list">
              {gps && (
                <li><button type="button" className="choice choice--button" onClick={() => pickOrigin(null)}>
                  <Icon name="locate" /> {t('it.use_my_position')}</button></li>
              )}
              {fromPlaces.map((p) => (
                <li key={`${p.lat},${p.lon}`}>
                  <button type="button" className="choice choice--button" onClick={() => pickOrigin({ lat: p.lat, lon: p.lon, name: p.name || p.label })}>
                    <Icon name="pin" /> {p.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {places && !dest && (
          <section aria-label={t('it.pick_destination')}>
            <p className="card__meta">{places.length ? t('it.pick_destination') : t('it.no_places')}</p>
            <ul className="list">
              {places.map((p) => (
                <li key={`${p.lat},${p.lon}`}>
                  <button type="button" className="choice choice--button" onClick={() => setDest({ lat: p.lat, lon: p.lon, name: p.name || p.label })}>
                    <Icon name="pin" /> {p.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {dest && (
          <>
            <DepartPicker value={departAt} onChange={setDepartAt} planned={weather ? weather.planned : undefined} t={t} />
            <div className="segmented segmented--sort" role="group" aria-label={t('it.title')}>
              {['best', 'fastest', 'eco', 'step_free'].map((k) => (
                <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>
                  {k === 'step_free' && <Icon name="a11y" size={16} />}{k === 'eco' && <Icon name="leaf" size={16} />}<span>{t(`it.${k === 'best' ? 'safest' : k}`)}</span>
                </button>
              ))}
            </div>
            {/* Écologique et climat : le vélo et la marche ne passent pas devant quand la météo les rend pénibles ou dangereux */}
            {sort === 'eco' && outdoor.length > 0 && (
              <p className="eco-note"><Icon name="leaf" size={16} /> {t('it.eco_climate', { hazard: outdoor.map((h) => t(`hazard.${h}`).toLowerCase()).join(', ') })}</p>
            )}
            <div className="mode-chips" role="group" aria-label={t('it.modes')}>
              {MODES.map((m) => (
                <button key={m} type="button" className="mode-chip" aria-pressed={modes.includes(m)} onClick={() => toggleMode(m)}>
                  <Icon name={MODE_ICON[m]} size={18} /> {t(`mode.${m}`)}
                </button>
              ))}
            </div>
            {sorted === null && !error && <p className="loading" role="status">{t('app.loading')}</p>}
            {sorted?.length === 0 && <p className="empty">{t('it.none', { from: origin.name, to: dest.name })}</p>}
            {(prefs.simple ? sorted?.slice(0, 2) : sorted)?.map((it, i) => (
              <ItineraryCard key={i} it={it} lines={acOf(it)} selected={i === picked} onPick={() => setPicked(i)}
                onFollow={() => follow(it)} later={Boolean(departAt)} busy={Boolean(status)} t={t} time={time} hazards={outdoor}
                notes={stopNotes(it, { needs: profile, hazards, flood })} simple={prefs.simple} showAccess={sort === 'step_free' || slow || profile.includes('fauteuil')}
                best={i === 0 && sort !== 'fastest' && sorted.length > 1 ? reasons(it) : null} lowest={it.carbon?.co2_g === minCo2} />
            ))}
            {user && (savedPlace
              ? <p className="card__meta"><Icon name="check" size={16} /> {t('places.already', { name: savedPlace.name })}</p>
              : <button type="button" className="btn btn--ghost btn--block" onClick={savePlace}><Icon name="pin" /> {t('places.save')}</button>)}
            <button type="button" className="btn btn--ghost btn--block" onClick={() => { setDest(null); setIts(null) }}>
              <Icon name="pin" /> {t('it.change_destination')}
            </button>
            <p className="footnote">{t('it.times_note')} {t('it.stops_source')} {t('it.co2_source')}</p>
          </>
        )}
      </main>
    </>
  )
}

function ItineraryCard({ it, lines, selected, onPick, onFollow, later, busy, t, time, hazards, best, notes, simple, showAccess, lowest }) {
  const access = accessNotes(it)
  const pt = lines.filter((l) => l.mode !== 'BICYCLE')
  const underground = pt.length > 0 && pt.every((l) => l.underground)
  const surface = pt.length > 0 && pt.every((l) => !l.underground)
  const allAc = pt.length > 0 && pt.every((l) => l.ref.ac === 'true')
  const missing = lines.filter((l) => l.ref.ac === 'false').map((l) => label(l))
  const b = breakdown(it)
  const good = [
    it.source === 'walk' && t('it.walk_only'),
    it.source === 'bike' && t('it.own_bike'),
    // Trajet de remplacement calculé pour éviter une gare dont l'ascenseur est en panne
    it.avoids?.length > 0 && t('it.avoids_lift', { stations: it.avoids.join(', ') }),
    it.velib && t('it.velib_live', { bikes: it.velib.bikes, docks: it.velib.docks }),
    underground && t('it.all_underground'),
    surface && t('it.all_surface'),
    allAc && t('it.ac_all'),
    access.ok && t('access.ok'),
    pt.length > 0 && it.elevators_ok > 0 && !(it.elevators_out || []).length && t('it.elevators_ok'),
    ...notes.good.map((n) => t(n.key, n.params)),
  ].filter(Boolean)
  const bad = [
    missing.length > 0 && t('it.ac_missing', { lines: missing.join(', ') }),
    // Ascenseur en panne, avec l'endroit concerné publié par l'exploitant pour un profil fauteuil
    ...(it.elevators_out || []).map((e) => t('it.elevator_out', { station: e.station }) + (showAccess && e.situations?.length ? ` (${e.situations[0]})` : '')),
    // Accessibilité vérifiée : détail des arrêts à connaître pour un profil fauteuil ou un trajet sans marche
    ...(showAccess ? access.issues.map((i) => t(`access.${i.reason}`, { stop: i.stop })) : []),
    active(it) && hazards.length > 0 && t(it.source === 'walk' ? 'it.walk_hazard' : 'it.bike_hazard', { hazard: hazards.map((h) => t(`hazard.${h}`)).join(', ') }),
    ...notes.bad.map((n) => t(n.key, n.key === 'trip.reports' ? { n: n.params.n, kinds: n.params.kinds.map((k) => t(`report.${k}`).toLowerCase()).join(', ') } : n.params)),
  ].filter(Boolean)

  const boardings = it.legs.filter((l) => !['WALK', 'BICYCLE'].includes(l.mode))
  const exit = it.legs.at(-1)?.mode === 'WALK' ? it.legs.at(-1).entrance : null

  return (
    <article className={`card it-card${selected ? ' card--selected' : ''}${best ? ' it-card--best' : ''}`}>
      {best && (
        <div className="it-best">
          <strong><Icon name="check" size={16} strokeWidth={2.5} /> {t('it.recommended')}</strong>
          {best.length > 0 && <span>{best.join(' · ')}</span>}
        </div>
      )}
      <button type="button" className="it-card__head" aria-pressed={selected} onClick={onPick}>
        <span className="it-card__min">{t('it.minutes', { n: minutes(it) })}</span>
        <span className="card__meta">{t('it.depart_arrive', { from: time(it.start), to: time(it.end) })}</span>
      </button>
      {/* Chaque étape avec son pictogramme et sa durée */}
      <ol className="it-legs" aria-label={t('trip.steps')}>
        {it.legs.map((l, j) => {
          const d = mins(l.start, l.end)
          if (l.mode === 'WALK' && d === 0) return null
          const ref = l.mode === 'WALK' ? null : lines.find((x) => x.start === l.start && x.line === l.line)?.ref
          const color = ref?.color || (l.color ? `#${l.color}` : null)
          return (
            <li key={j} className="it-leg">
              <Icon name={LEG_ICON[l.mode] || 'trip'} size={18} />
              {l.mode === 'WALK'
                ? <span className="it-leg__walk" title={l.shade != null ? t('walk.shade_score', { v: Math.round(l.shade * 100) }) : undefined}>{d}</span>
                : <span className="line" style={color ? { background: color, color: readableOn(color) } : undefined}>
                  {l.mode === 'BICYCLE' ? (l.line || t('mode.bike')) : label(l)}</span>}
              {l.mode !== 'WALK' && <span className="it-leg__min">{d}</span>}
            </li>
          )
        })}
      </ol>
      {/* Lignes avec leur direction, correspondances et sortie : de quoi partir sans ouvrir le détail */}
      {!active(it) && boardings.length > 0 && (
        <p className="it-dirs">
          {boardings.map((l, k) => {
            const dir = legDirection(l)
            const line = dir ? t('it.line_towards', { line: label(l), dir }) : label(l)
            return <span key={k}>{k === 0 ? line : t('it.then_at', { stop: l.from.name, what: line })}</span>
          })}
          {exit && <span>{t('it.exit_by', { name: exit })}</span>}
        </p>
      )}
      <p className="it-times">
        {[b.walk > 0 && t('it.time_walk', { n: b.walk }), b.wait > 0 && t('it.time_wait', { n: b.wait }),
          !active(it) && (b.changes ? t('it.time_changes', { n: b.changes }) : t('it.time_direct')),
          it.next?.length > 0 && t('it.next_departures', { times: it.next.map((x) => time(x)).join(', ') })].filter(Boolean).join(' · ')}
      </p>
      {/* Empreinte carbone (ADEME) et gain par rapport à la voiture */}
      {it.carbon && (
        <p className={`it-eco${lowest ? ' it-eco--best' : ''}`}>
          <Icon name="leaf" size={16} />
          <span>{t('it.co2', { g: grams(it.carbon.co2_g) })}{it.carbon.saved_g > 0 && ` · ${t('it.co2_saved', { g: grams(it.carbon.saved_g) })}`}
            {lowest && ` · ${t('it.co2_lowest')}`}</span>
        </p>
      )}
      {!simple && good.length > 0 && <ul className="it-tags">{good.map((g) => <li key={g}>✓ {g}</li>)}</ul>}
      {/* Un même point dangereux peut être croisé deux fois : une seule mention */}
      {[...new Set(bad)].map((x) => <p key={x} className="it-warn"><Icon name="alert" size={16} /> {x}</p>)}
      {selected && (
        <>
          {it.carbon?.saved_g > 0 && <p className="it-eco-year">{t('it.co2_year', { kg: Math.round((it.carbon.saved_g * 2 * 220) / 1000) })}</p>}
          <ol className="it-detail">
            {it.legs.filter((l) => !(l.mode === 'WALK' && l.start === l.end)).map((l, j) => (
              <li key={j}>
                <span className="mono">{time(l.start)}</span>
                <span>{l.mode === 'WALK' ? <>{t('it.step_walk', { place: l.to.name, n: mins(l.start, l.end) })}
                  {l.distance_m ? ` · ${t('it.meters_walk', { m: l.distance_m })}` : ''}
                  {l.entrance && <small className="it-entrance"><Icon name="pin" size={14} /> {t(j === 0 ? 'it.enter_by' : 'it.exit_by', { name: l.entrance })}</small>}</>
                  : l.mode === 'BICYCLE' ? t('it.step_bike', { from: l.from.name, place: l.to.name, n: mins(l.start, l.end) })
                    : (legDirection(l) ? t('it.step_ride', { line: label(l), from: l.from.name, place: l.to.name, dir: legDirection(l), n: mins(l.start, l.end) })
                      : t('it.step_ride_nodir', { line: label(l), from: l.from.name, place: l.to.name, n: mins(l.start, l.end) }))}
                  {/* Équipements de l'arrêt de montée */}
                  {amenityChips(l.from.info, l.mode).length > 0 && (
                    <span className="stop-chips">
                      {amenityChips(l.from.info, l.mode).map((c) => (
                        <span key={c.key} className={`stop-chip${c.ok ? '' : ' stop-chip--no'}`}><Icon name={c.icon} size={14} /> {t(c.key)}</span>
                      ))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn--primary btn--block" onClick={onFollow} disabled={busy}>{t(later ? 'it.follow_later' : 'it.follow')}</button>
        </>
      )}
    </article>
  )
}
