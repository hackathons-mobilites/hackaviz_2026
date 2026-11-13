// 07 · Mes alertes : aléas prévus sur 3 jours près de vous et problèmes sur le trajet enregistré ; choix des alertes
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api/client.js'
import Icon, { HAZARD_ICON } from '../../components/Icon.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePrefs } from '../../context/PrefsContext.jsx'
import { usablePosition } from '../../features/network.js'
import { loadTrip } from '../../features/trip/tripStore.js'
import { useGeolocation } from '../../hooks/useGeolocation.js'
import { useI18n } from '../../i18n/index.jsx'
import { storage } from '../../utils/storage.js'

export const HAZARDS = ['chaleur', 'grand_froid', 'neige_verglas', 'orages_pluie', 'vent_fort', 'crue', 'ascenseur', 'pollution']
// Valeur à afficher dans le titre de l'alerte, selon l'aléa
const VALUE = { chaleur: (d) => Math.round(d.tx), grand_froid: (d) => Math.round(d.tn), orages_pluie: (d) => Math.round(d.rr),
  vent_fort: (d) => Math.round(d.rafales_kmh), neige_verglas: () => '', pollution: (d) => Math.round(d.air?.aqi ?? 0) }

export default function Alerts() {
  const { t, date } = useI18n()
  const { user, update } = useAuth()
  const { prefs } = usePrefs()
  const navigate = useNavigate()
  const geo = useGeolocation({ enabled: prefs.use_location })
  const [alerts, setAlerts] = useState(() => user?.alerts || storage.getJSON('atv.alerts', HAZARDS.slice(0, 7)))
  const [days, setDays] = useState(null)
  const [bulletin, setBulletin] = useState([])
  const [trip, setTrip] = useState(null)
  const [tab, setTab] = useState('now')
  const [saved, setSaved] = useState(false)
  const [flood, setFlood] = useState(null)

  useEffect(() => {
    const p = usablePosition(geo.coords)
    api.weather(p.lat, p.lon).then((w) => { setDays(w.days); setBulletin(w.bulletin || []) }).catch(() => setDays([]))
  }, [geo.coords])
  useEffect(() => { loadTrip().then(setTrip) }, [])
  useEffect(() => { api.flood().then(setFlood).catch(() => setFlood(null)) }, [])

  const toggle = async (h) => {
    const next = alerts.includes(h) ? alerts.filter((x) => x !== h) : [...alerts, h]
    setAlerts(next)
    storage.setJSON('atv.alerts', next)
    if (user) await update({ alerts: next }).catch(() => {})
    setSaved(true)
  }

  const when = (i, d) => (i === 0 ? t('alerts.today') : i === 1 ? t('alerts.tomorrow') : date(d))
  const weatherCards = (days || []).flatMap((d, i) => d.aleas.filter((h) => alerts.includes(h)).map((h) => ({ h, d, i })))
  const elevatorCards = alerts.includes('ascenseur') ? (trip?.warnings || []).filter((w) => w.code === 'elevator_out') : []
  // Vigilance crue officielle (Vigicrues) : seulement à partir du jaune
  const floodCard = alerts.includes('crue') && flood?.level >= 2 ? flood : null
  const count = weatherCards.length + elevatorCards.length + (floodCard ? 1 : 0)

  return (
    <>
      <header className="page-head">
        <div className="page-head__inner">
          <div className="page-head__row">
            <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label={t('app.back')}>
              <Icon name="back" size={20} strokeWidth={2.5} />
            </button>
            <h1>{t('alerts.title')}</h1>
            <button type="button" className="head-link" onClick={() => setTab('settings')}>{t('alerts.settings_link')}</button>
          </div>
          <div className="segmented segmented--dark" role="group" aria-label={t('alerts.title')}>
            <button type="button" aria-pressed={tab === 'now'} onClick={() => setTab('now')}>{t('alerts.tab_now', { n: days ? count : '…' })}</button>
            <button type="button" aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}>{t('alerts.tab_settings')}</button>
          </div>
        </div>
      </header>

      <main id="contenu" className="app-main alerts-main">
        {tab === 'now' && (
          <>
            {days === null && <p className="loading" role="status">{t('app.loading')}</p>}
            {days && count === 0 && <p className="banner banner--ok"><Icon name="check" /> {t('around.no_hazard')}</p>}
            {floodCard && (
              <article className="alert alert--crue">
                <Icon name={HAZARD_ICON.crue} size={28} />
                <div>
                  <span className="alert__label">{t('hazard.crue')} · {t('alerts.today')}</span>
                  <strong>{t('alerts.t_crue', { color: t(`flood.${floodCard.color}`), rivers: floodCard.watch.map((w) => w.name).join(', ') })}</strong>
                  <span className="alert__text">{t('advice.crue')}</span>
                  <a href="https://www.vigicrues.gouv.fr/" target="_blank" rel="noreferrer">Vigicrues</a>
                </div>
              </article>
            )}
            {elevatorCards.map((w) => (
              <article key={w.station} className="alert alert--ascenseur">
                <Icon name="elevator" size={28} />
                <div>
                  <span className="alert__label">{t('alerts.on_trip')}</span>
                  <strong>{t('it.elevator_out', { station: w.station })}</strong>
                  <Link to="/accessibilite">{t('a11y.trip_title')}</Link>
                </div>
              </article>
            ))}
            {bulletin.length > 0 && (
              <article className="alert alert--bulletin">
                <Icon name="bell" size={28} />
                <div>
                  <span className="alert__label">{t('alerts.bulletin')}</span>
                  {bulletin.slice(0, 4).map((x) => <p key={x} className="alert__text">{x}</p>)}
                </div>
              </article>
            )}
            {weatherCards.map(({ h, d, i }) => (
              <article key={`${h}${d.date}`} className={`alert alert--${h}`}>
                <Icon name={HAZARD_ICON[h] || 'alert'} size={28} />
                <div>
                  <span className="alert__label">{t(`hazard.${h}`)} · {when(i, d.date)}</span>
                  <strong>{h === 'neige_verglas' && d.neige_cm >= 1 ? t('alerts.t_snow_cm', { v: Math.round(d.neige_cm) }) : VALUE[h] ? t(`alerts.t_${h}`, { v: VALUE[h](d) }) : t(`hazard.${h}`)}</strong>
                  <span className="alert__text">{t(`advice.${h}`)}</span>
                  <Link to="/itineraires">{t('alerts.see_route')}</Link>
                </div>
              </article>
            ))}
            <p className="footnote">{t('alerts.source')}</p>
          </>
        )}

        {tab === 'settings' && (
          <fieldset className="card">
            <legend className="card__legend">{t('alerts.hint')}</legend>
            {HAZARDS.map((h) => (
              <label key={h} className="check-row">
                <span>{t(`hazard.${h}`)}</span>
                <input type="checkbox" checked={alerts.includes(h)} onChange={() => toggle(h)} />
              </label>
            ))}
          </fieldset>
        )}
        <p className="sr-only" role="status">{saved ? t('alerts.saved') : ''}</p>
      </main>
    </>
  )
}
