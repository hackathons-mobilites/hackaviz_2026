// 05 / 05b · Suivi du trajet : GPS en surface, estimation par les horaires sous terre ou hors ligne
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import PageHead from '../../components/PageHead.jsx'
import { useAnnouncer } from '../../context/AnnouncerContext.jsx'
import { usePrefs } from '../../context/PrefsContext.jsx'
import { legDirection, legLabel as lineLabel, lineIndex, loadNetwork } from '../../features/network.js'
import { MIN } from '../../features/trip/estimate.js'
import { clearTrip, loadTrip } from '../../features/trip/tripStore.js'
import { useTripTracker } from '../../features/trip/useTripTracker.js'
import LivePanel from './LivePanel.jsx'
import { useI18n } from '../../i18n/index.jsx'

export default function Trip() {
  const { t } = useI18n()
  const [bundle, setBundle] = useState(undefined)

  useEffect(() => { loadTrip().then(setBundle) }, [])

  if (bundle === undefined) return <p className="loading" role="status">{t('app.loading')}</p>
  if (!bundle) {
    return (
      <>
        <PageHead title={t('nav.trip')} />
        <main id="contenu" className="app-main">
          <p className="empty">{t('trip.none')}</p>
          <Link className="btn btn--primary btn--block btn--lg" to="/itineraires">{t('trip.plan')}</Link>
        </main>
      </>
    )
  }
  return <TripTracking bundle={bundle} onEnd={() => setBundle(null)} />
}

function TripTracking({ bundle, onEnd }) {
  const { t, time } = useI18n()
  const navigate = useNavigate()
  const { prefs, set } = usePrefs()
  const { announce } = useAnnouncer()
  const { progress, gps, online, source, offRoute, delayMs, motion, arrivedAt, waiting, start } = useTripTracker(bundle)
  const [line, setLine] = useState(() => () => ({ ac: 'unknown' }))
  useEffect(() => { loadNetwork().then((g) => setLine(() => lineIndex(g))) }, [])
  const { trip } = bundle
  const dest = trip.legs[trip.legs.length - 1].to
  const place = dest.name.split(',')[0]
  const estimated = !online || source === 'schedule'
  const late = Math.round(delayMs / MIN)

  const end = async () => {
    await clearTrip()
    onEnd()
  }

  const share = () => {
    const text = `${t('trip.title', { place: dest.name })} · ${t('trip.eta')} ${time(progress.eta)}`
    if (navigator.share) navigator.share({ title: 'AtouVent', text }).catch(() => {})
    else navigator.clipboard?.writeText(text).then(() => announce(t('trip.copied'))).catch(() => {})
  }

  return (
    <>
      <header className="page-head trip-head">
        <div className="page-head__inner">
          <div className="page-head__row">
            <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label={t('app.back')}>
              <Icon name="back" size={20} strokeWidth={2.5} />
            </button>
            <h1 className="trip-head__title">{t('trip.title', { place })}</h1>
            <GpsChip gps={gps} online={online} />
          </div>
          <div className="eta" role="timer" aria-live="off">
            <div>
              <div className="eta__label">{estimated ? t('trip.eta_estimated') : t('trip.eta')}</div>
              <div className="eta__time">{time(progress.eta)}</div>
            </div>
            <div className="eta__right">
              <div className="eta__left">{t('trip.in', { n: progress.minutesLeft })}</div>
              <div className="eta__label">{estimated ? t('trip.by_schedule') : late >= 2 ? t('trip.late_by', { n: late }) : t('trip.on_time')}</div>
            </div>
          </div>
          <div className="progress" role="progressbar" aria-label={t('trip.progress')}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.progress * 100)}>
            <span style={{ width: `${progress.progress * 100}%` }} />
          </div>
        </div>
      </header>

      <main id="contenu" className="app-main trip-main">
        <NextStep progress={progress} legs={trip.legs} />

        {/* Arrivée détectée par le GPS, sans attendre que l'usager appuie sur « Je suis arrivé » */}
        {arrivedAt && (
          <section className="banner banner--ok" role="status">
            <Icon name="check" size={24} />
            <p><strong>{t('trip.arrived_auto', { place, time: time(arrivedAt) })}</strong> {t('trip.arrived_auto_detail')}</p>
          </section>
        )}
        {/* Le trajet ne démarre qu'une fois l'usager en route (GPS), ou quand il le dit */}
        {waiting && (
          <section className="banner banner--info trip-wait" role="status">
            <Icon name="walk" size={24} />
            <div>
              <p><strong>{t('trip.wait_title')}</strong> {t('trip.wait_detail')}</p>
              <button type="button" className="btn btn--primary" onClick={() => start()}>{t('trip.start_now')}</button>
            </div>
          </section>
        )}
        {!waiting && !arrivedAt && gps.status === 'ok' && <MotionStatus motion={motion} />}

        {offRoute && (
          <section className="alert-card" role="alert">
            <Icon name="alert" size={26} />
            <div>
              <p><strong>{t('say.off_route')}</strong></p>
              <button type="button" className="btn btn--warm" onClick={() => navigate(`/itineraires?${new URLSearchParams({ vers: dest.name, lat: dest.lat, lon: dest.lon })}`)}>
                {t('trip.replan')}
              </button>
            </div>
          </section>
        )}

        {(!online || gps.status === 'lost') && (
          <section className="banner banner--offline" role="status">
            <Icon name="download" size={24} />
            <p>
              <strong>{!online ? t('trip.offline_title') : t('trip.gps_lost')}</strong>
              {t('trip.offline_detail', { time: time(bundle.generated_at) })}
            </p>
          </section>
        )}

        <LivePanel trip={trip} progress={progress} gps={gps} online={online}
          onReplan={() => navigate(`/itineraires?${new URLSearchParams({ vers: dest.name, lat: dest.lat, lon: dest.lon })}`)} />
        <Warnings bundle={bundle} />
        <Steps trip={trip} progress={progress} line={line} estimated={estimated} />

        <div className="trip-actions">
          <button type="button" className="btn btn--outline" aria-pressed={prefs.warn_before} onClick={() => set({ warn_before: !prefs.warn_before })}>
            {t('trip.warn_before')}
          </button>
          <button type="button" className="btn btn--outline" onClick={share}>{t('trip.share')}</button>
        </div>
        <p className="footnote">{t('trip.footer')}</p>
        <button type="button" className="btn btn--danger btn--block" onClick={end}>
          {progress.phase === 'arrived' ? t('trip.arrived_btn') : t('trip.stop')}
        </button>
      </main>
    </>
  )
}

// Mouvement de l'usager d'après le GPS : avance, à l'arrêt, revient en arrière (texte + pictogramme, jamais la couleur seule)
function MotionStatus({ motion }) {
  const { t } = useI18n()
  if (motion.state === 'uncertain') return null
  const minutes = Math.floor((motion.sinceMs || 0) / 60_000)
  const view = {
    moving_forward: { icon: 'walk', text: t('motion.forward') },
    stopped: { icon: 'clock', text: minutes >= 1 ? t('motion.stopped_for', { n: minutes }) : t('motion.stopped') },
    moving_backward: { icon: 'alert', text: t('motion.backward', { m: motion.metres }), alert: true },
  }[motion.state]
  return (
    <p className={`motion${view.alert ? ' motion--alert' : ''}`} role="status">
      <Icon name={view.icon} size={20} /> {view.text}
    </p>
  )
}

// État du GPS et du réseau, toujours en texte
function GpsChip({ gps, online }) {
  const { t } = useI18n()
  if (!online) return <span className="status-chip status-chip--warn"><Icon name="offline" size={16} />{t('trip.offline').split(' :')[0]}</span>
  if (gps.status === 'ok') return <span className="status-chip"><span className="status-dot" aria-hidden="true" />{t('trip.active')}</span>
  // Libellé court dans l'en-tête ; le détail (GPS perdu sous terre) est dans le bandeau plus bas
  const label = gps.status === 'searching' ? 'trip.chip_searching' : 'trip.chip_schedule'
  return <span className="status-chip status-chip--warn"><Icon name="locate" size={16} />{t(label)}</span>
}

// Carte « prochaine étape », la plus visible de l'écran
function NextStep({ progress, legs }) {
  const { t } = useI18n()
  const { phase, leg } = progress
  let title
  let detail = ''
  if (phase === 'arrived') {
    title = t('say.arrived')
  } else if (phase === 'riding' && leg.mode !== 'BICYCLE') {
    title = t('trip.alight_at', { stop: leg.to.name })
    // Dernière descente : la sortie à prendre, pour ne pas chercher sur le quai
    const after = legs[progress.legIndex + 1]
    const exit = after?.mode === 'WALK' && progress.legIndex + 1 === legs.length - 1 && after.entrance
    detail = [progress.stopsLeft > 1
      ? t('trip.stops_left', { n: progress.stopsLeft, min: progress.minutesToLegEnd })
      : t('trip.one_stop_left', { min: progress.minutesToLegEnd }), exit && t('it.exit_by', { name: exit })].filter(Boolean).join(' · ')
  } else if (leg.mode === 'BICYCLE') {
    title = t('trip.bike_to', { place: leg.to.name })
    detail = progress.minutesToLegEnd != null ? t('it.minutes', { n: progress.minutesToLegEnd }) : ''
  } else if (leg.mode === 'WALK') {
    title = t('trip.walk_to', { place: leg.to.name })
    // Entrée de gare conseillée au départ, sortie à l'arrivée
    const door = leg.entrance && t(progress.legIndex === 0 ? 'it.enter_by' : 'it.exit_by', { name: leg.entrance })
    detail = [progress.minutesToLegEnd != null && t('it.minutes', { n: progress.minutesToLegEnd }), door].filter(Boolean).join(' · ')
  } else {
    const dir = legDirection(leg)
    title = dir ? t('trip.wait_at_dir', { line: lineLabel(leg), dir, stop: leg.from.name }) : t('trip.wait_at', { line: lineLabel(leg), stop: leg.from.name })
  }
  return (
    <section className="next-step" aria-labelledby="next-title">
      <span className="next-step__label">{t('trip.next')}</span>
      <h2 id="next-title" className="next-step__title">{title}</h2>
      {detail && <p>{detail}</p>}
    </section>
  )
}

// Avertissements préparés au départ (ascenseurs, météo)
function Warnings({ bundle }) {
  const { t } = useI18n()
  const items = bundle.warnings.filter((w) => w.code === 'elevator_out' || w.code === 'hazard')
  if (!items.length) return null
  return (
    <ul className="list">
      {items.map((w, i) => (
        <li key={i} className={`banner ${w.priority === 'high' ? 'banner--alert' : 'banner--info'}`}>
          <Icon name={w.code === 'hazard' ? 'storm' : 'elevator'} />
          <span>{w.code === 'hazard' ? t('say.hazard', { hazard: t(`hazard.${w.hazard}`) }) : t('it.elevator_out', { station: w.station })}</span>
        </li>
      ))}
    </ul>
  )
}

// Étapes : départ, chaque ligne prise, arrivée (maquette 05)
function Steps({ trip, progress, line, estimated }) {
  const { t, time } = useI18n()
  const legs = trip.legs
  const last = legs[legs.length - 1]
  const arrived = progress.phase === 'arrived'
  const state = (i) => (arrived || i < progress.legIndex ? 'done' : i === progress.legIndex ? 'current' : 'next')
  const acText = (leg) => {
    const ac = line(leg.mode, leg.line).ac
    return ac === 'true' ? t('trip.ac_line') : ac === 'false' ? t('trip.noac_line') : ''
  }
  const items = [{ key: 'start', state: progress.phase === 'before' ? 'current' : 'done', title: t('trip.departure', { place: legs[0].from.name }),
    meta: progress.phase === 'before' ? '' : t('trip.done'), time: legs[0].start }]
  legs.forEach((leg, i) => {
    if (leg.mode === 'WALK') return
    const s = state(i)
    const between = s === 'current' && progress.phase === 'riding' && progress.next
      ? t('trip.between', { a: progress.current.name, b: progress.next.name }) : `${leg.from.name} → ${leg.to.name}`
    items.push({
      key: i, state: s,
      title: s === 'current' && progress.phase === 'riding' ? t('trip.in_line', { line: lineLabel(leg) }) : (legDirection(leg) ? t('trip.connection_dir', { line: lineLabel(leg), dir: legDirection(leg), stop: leg.from.name }) : t('trip.connection', { line: lineLabel(leg), stop: leg.from.name })),
      meta: s === 'done' ? t('trip.done') : [between, acText(leg), leg.underground ? t('it.underground') : ''].filter(Boolean).join(' · '),
      time: s === 'current' ? null : leg.start,
    })
  })
  const walkEnd = last.mode === 'WALK' ? Math.round((Date.parse(last.end) - Date.parse(last.start)) / 60000) : null
  items.push({ key: 'end', state: arrived ? 'done' : last.mode === 'WALK' && progress.legIndex === legs.length - 1 ? 'current' : 'next', arrival: true,
    title: t('trip.arrival', { place: last.to.name }),
    meta: [walkEnd && t('trip.walk_min', { n: walkEnd }), last.mode === 'WALK' && last.entrance && t('it.exit_by', { name: last.entrance })].filter(Boolean).join(' · '), time: trip.end })

  return (
    <ol className="steps" aria-label={t('trip.steps')}>
      {items.map((s) => (
        <li key={s.key} className={`step step--${s.state}${s.arrival ? ' step--arrival' : ''}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="step__dot" aria-hidden="true">{s.state === 'done' && <Icon name="check" size={14} strokeWidth={3} />}</span>
          <div className="step__body">
            <div className="step__title">{s.title}</div>
            {s.meta && <div className="step__meta">{s.meta}</div>}
          </div>
          <span className="step__time">
            {s.state === 'current' && !s.time ? <span className="badge badge--estimate">{estimated ? t('trip.estimated') : t('trip.current')}</span> : time(s.time)}
          </span>
        </li>
      ))}
    </ol>
  )
}
