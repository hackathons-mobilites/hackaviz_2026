// Suivi du trajet : GPS quand il y en a, horaires enregistrés sinon, recalage au retour du signal.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAnnouncer } from '../../context/AnnouncerContext.jsx'
import { usePrefs } from '../../context/PrefsContext.jsx'
import { useGeolocation } from '../../hooks/useGeolocation.js'
import { useOnline } from '../../hooks/useOnline.js'
import { useI18n } from '../../i18n/index.jsx'
import { inIdf, legDirection, legLabel } from '../network.js'
import { MIN, dueAnnouncements, estimateProgress, recalibrate } from './estimate.js'
import { arrivalDetected, departureDetected, metres, motionState, project, routeLine } from './motion.js'
import { patchTrip } from './tripStore.js'

const TICK_MS = 15_000
const HISTORY_MS = 3 * 60_000  // positions gardées pour juger du mouvement
const BACKWARD_ALERT_M = 40   // recul annoncé au-delà de 40 m (pas pour un pas de côté)

export function useTripTracker(bundle) {
  const { t, time } = useI18n()
  const { announce } = useAnnouncer()
  const { prefs } = usePrefs()
  const online = useOnline()
  const gps = useGeolocation({ watch: Boolean(bundle), enabled: prefs.use_location })

  const [now, setNow] = useState(() => Date.now())
  const [delayMs, setDelay] = useState(bundle?.delayMs || 0)
  const [offRoute, setOffRoute] = useState(false)
  const done = useRef(new Set(bundle?.announced || []))
  const prevGps = useRef(gps.status)
  const history = useRef([])
  const line = useMemo(() => (bundle ? routeLine(bundle.trip) : []), [bundle])
  const [motion, setMotion] = useState({ state: 'uncertain', metres: 0 })
  const [arrivedAt, setArrivedAt] = useState(bundle?.arrivedAt || null)
  const [startedAt, setStartedAt] = useState(bundle?.startedAt || null)
  const anchor = useRef(null)  // où l'usager attendait avant de partir
  const backwardSaid = useRef(false)

  // On attend que l'usager bouge, partout en Île-de-France ; GPS refusé, absent ou hors région : on suit les horaires.
  // Un signal perdu un instant (téléphone immobile, hoquet du GPS) ne lance pas le trajet.
  const gpsUsable = ['searching', 'lost'].includes(gps.status) || (gps.status === 'ok' && inIdf(gps.coords))
  const waiting = Boolean(bundle) && !startedAt && gpsUsable
  const tripStart = bundle ? Date.parse(bundle.trip.start) : 0

  const start = (at = Date.now()) => {
    if (startedAt || !bundle) return
    // Parti plus tard que prévu : le retard est repris dans l'estimation
    const late = Math.max(0, at - tripStart)
    setStartedAt(at)
    setDelay(late)
    patchTrip({ startedAt: at, delayMs: late })
    announce(t('say.trip_started'))
  }


  // Horloge : l'estimation avance même sans réseau
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Arrivée détectée : le trajet reste « arrivé » (l'horloge ne le fait pas revenir en arrière)
  const progress = useMemo(() => {
    if (!bundle) return null
    // Pas encore parti : le trajet reste au départ et l'arrivée recule avec l'attente
    if (waiting) return { ...estimateProgress(bundle.trip, now, Math.max(0, now - tripStart)), waitingDeparture: true }
    const end = Date.parse(bundle.trip.end) + delayMs + 1
    return estimateProgress(bundle.trip, arrivedAt ? Math.max(now, end) : now, delayMs)
  }, [bundle, now, delayMs, arrivedAt, waiting, tripStart])

  // Recalage à chaque position GPS reçue
  useEffect(() => {
    // Position hors Île-de-France (démonstration à distance) : on suit les horaires, sans recalage
    if (!bundle || gps.status !== 'ok' || !inIdf(gps.coords)) return
    const at = Date.now()
    const fix = { t: at, lat: gps.coords.lat, lon: gps.coords.lon, accuracy: gps.coords.accuracy || 0 }
    // Avant le départ : on note où l'usager attend, et on ne démarre que quand il s'en éloigne
    if (!startedAt) {
      // Point d'attente : affiné tant que la nouvelle position, plus précise, reste dans le cercle d'incertitude
      if (!anchor.current || (fix.accuracy < anchor.current.accuracy && metres(anchor.current, fix) <= anchor.current.accuracy)) anchor.current = fix
      history.current = [...history.current.filter((h) => at - h.t <= HISTORY_MS), { ...fix, along: project(line, fix).along }]
      if (departureDetected(anchor.current, history.current)) start(at)
      return
    }
    const r = recalibrate(bundle.trip, Date.now(), gps.coords, delayMs)
    const back = prevGps.current === 'lost'
    if (back) announce(t('say.gps_back'))
    if (r.delayMs !== delayMs) {
      setDelay(r.delayMs)
      patchTrip({ delayMs: r.delayMs })
      if (back && r.delayMs >= 3 * MIN) announce(t('say.late', { n: Math.round(r.delayMs / MIN) }))
    }
    if (r.offRoute && !offRoute) announce(t('say.off_route'), { urgent: true })
    setOffRoute(r.offRoute)

    // Mouvement le long du tracé : on garde 3 minutes de positions
    history.current = [...history.current.filter((h) => at - h.t <= HISTORY_MS), { ...fix, along: project(line, fix).along }]
    const m = motionState(history.current, at)
    setMotion(m)
    // Demi-tour franc : prévenu une fois par épisode (pas pour un pas de côté ni un GPS qui saute)
    if (m.state === 'moving_backward' && m.metres >= BACKWARD_ALERT_M && !backwardSaid.current) {
      backwardSaid.current = true
      announce(t('say.backward'), { urgent: true })
    }
    if (m.state === 'moving_forward') backwardSaid.current = false
    // Arrivée : détectée sans attendre que l'usager appuie sur « Je suis arrivé »
    if (!arrivedAt && arrivalDetected(history.current, bundle.trip.legs[bundle.trip.legs.length - 1].to, m)) {
      setArrivedAt(at)
      patchTrip({ arrivedAt: at })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.coords, gps.status, startedAt])

  useEffect(() => { prevGps.current = gps.status }, [gps.status])

  // Annonces faites avant chaque moment clé
  useEffect(() => {
    if (!bundle || !progress) return
    const due = dueAnnouncements(bundle, progress, now, done.current, { warnBefore: prefs.warn_before })
    if (!due.length) return
    // Une seule annonce groupée, pour ne pas couper la voix entre deux messages
    const text = due.map((a) => {
      const params = { ...a.params }
      if (params.eta) params.time = time(params.eta)
      if (params.hazard) params.hazard = t(`hazard.${params.hazard}`)
      done.current.add(a.id)
      // Montée : ligne, direction (terminus) et arrêt, pour savoir quel train prendre sans regarder l'écran
      if (params.board != null) {
        const leg = bundle.trip.legs[params.board]
        const dir = legDirection(leg)
        return t(dir ? 'say.board_dir' : 'say.board', { ...params, line: legLabel(leg), dir, stop: leg.from.name })
      }
      return t(a.key, params)
    }).join(' ')
    announce(text, { urgent: due.some((a) => a.urgent) })
    patchTrip({ announced: [...done.current] })
  }, [bundle, progress, now, prefs.warn_before, announce, t, time])

  // Source de la position affichée
  const walking = progress?.phase === 'walking'
  const source = gps.status === 'ok' && inIdf(gps.coords) && walking ? 'gps' : 'schedule'

  return { progress, gps, online, source, delayMs, offRoute, motion, arrivedAt, waiting, start }
}
