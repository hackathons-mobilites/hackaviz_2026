// Suivi en direct, façon Waze : carte du trajet avec la position, passage en temps réel à la prochaine montée, perturbations sur les lignes du trajet, ascenseurs en panne et signalements des autres voyageurs (avec vote).
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client.js'
import Icon from '../../components/Icon.jsx'
import { useAnnouncer } from '../../context/AnnouncerContext.jsx'
import { useLiveStream } from '../../hooks/useLiveStream.js'
import { legLabel } from '../../features/network.js'
import { STOP_BADGE } from '../AroundMap.jsx'
import { useI18n } from '../../i18n/index.jsx'

const MapView = lazy(() => import('../../components/MapView.jsx'))
const POLL_MS = 60_000
export const REPORT_KINDS = [
  { kind: 'delay', icon: 'clock' }, { kind: 'crowded', icon: 'account' }, { kind: 'hot', icon: 'heat' },
  { kind: 'elevator', icon: 'elevator' }, { kind: 'not_served', icon: 'alert' }, { kind: 'works', icon: 'alert' },
  { kind: 'obstacle', icon: 'walk' },
]
const ICON = Object.fromEntries(REPORT_KINDS.map((k) => [k.kind, k.icon]))
const MODE_COLOR = { WALK: '#4A5A70', BICYCLE: '#2E7D4F' }

// Tracé : pour chaque étape, départ, arrêts intermédiaires et arrivée
function routeLines(trip) {
  return trip.legs.map((l) => ({
    // Tracé réel (lignes : shapes IDFM ; marche : chemin IGN), sinon d'arrêt en arrêt
    coords: l.geometry?.length > 1 ? l.geometry : [l.from, ...(l.stops || []), l.to].map((p) => [p.lon, p.lat]),
    color: MODE_COLOR[l.mode] || (l.color ? `#${l.color}` : '#1A5C96'),
    dashed: l.mode === 'WALK',
  }))
}

export default function LivePanel({ trip, progress, gps, online, onReplan }) {
  const { t, time } = useI18n()
  const { announce } = useAnnouncer()
  const [live, setLive] = useState(null)
  const [reporting, setReporting] = useState(false)
  const [sent, setSent] = useState('')
  const [voted, setVoted] = useState({})
  const seen = useRef(new Set())
  const nextLeg = progress?.legIndex ?? 0

  useEffect(() => {
    if (!online) return undefined
    let stop = false
    const load = () => api.trips.live(trip, nextLeg).then((r) => {
      if (stop) return
      setLive(r)
      // Annonce une seule fois chaque nouvelle perturbation ou nouveau signalement
      const fresh = [...r.disruptions.map((d) => d.id || d.title), ...r.reports.map((x) => x.id)].filter((k) => !seen.current.has(k))
      if (seen.current.size && fresh.length) announce(t('live.new_info'))
      fresh.forEach((k) => seen.current.add(k))
    }).catch(() => {})
    load()
    const id = setInterval(load, POLL_MS)
    return () => { stop = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, nextLeg, trip])

  const lines = useMemo(() => routeLines(trip), [trip])
  // En direct : le serveur pousse les perturbations des lignes du trajet, les signalements et les pannes d'ascenseur
  const routeIds = useMemo(() => [...new Set(trip.legs.map((l) => (l.route_id || '').replace('IDFM:', '')).filter(Boolean))], [trip])
  const tripStations = useMemo(() => new Set(trip.legs.filter((l) => l.mode !== 'WALK').flatMap((l) => [l.from.name, l.to.name])), [trip])
  const streamAt = trip.legs[Math.min(nextLeg, trip.legs.length - 1)].from
  useLiveStream({ lat: streamAt.lat, lon: streamAt.lon, lines: routeIds }, {
    traffic: (d) => setLive((l) => (l ? { ...l, disruptions: d.items } : l)),
    reports: (d) => setLive((l) => (l ? { ...l, reports: d.items } : l)),
    elevators: (d) => setLive((l) => (l ? { ...l, elevators_out: d.down.filter((e) => tripStations.has(e.station)).map((e) => ({ station: e.station })) } : l)),
  }, online)
  const here = gps.status === 'ok' && gps.coords ? gps.coords : null
  const center = here || trip.legs[Math.min(nextLeg, trip.legs.length - 1)].from
  const markers = useMemo(() => [
    { lat: trip.legs.at(-1).to.lat, lon: trip.legs.at(-1).to.lon, kind: 'dest' },
    // Montées et descentes : pictogramme du mode (M, RER, T, BUS)
    ...trip.legs.filter((l) => !['WALK', 'BICYCLE'].includes(l.mode)).flatMap((l) => {
      const kind = l.from.info?.kind || { BUS: 'bus', TRAM: 'tram', SUBWAY: 'metro', RAIL: 'rail' }[l.mode] || 'bus'
      return [l.from, l.to].map((p) => ({ lat: p.lat, lon: p.lon, kind: `tone-${kind}`, text: STOP_BADGE[kind] }))
    }),
    ...(live?.reports || []).map((r) => ({ lat: r.lat, lon: r.lon, kind: 'report' })),
  ], [here, trip, live])

  const dep = live?.departure
  const depLeg = dep ? trip.legs[dep.leg] : null
  const blocking = live?.disruptions.some((d) => d.severity === 'BLOQUANTE' || (d.tags || []).includes('travaux') && /non desservi|interrompu/i.test(d.title || ''))
  const bigDelay = dep && dep.delay_min >= 10

  const report = async (kind) => {
    const leg = trip.legs[nextLeg] || trip.legs[0]
    const p = here || leg.from
    try {
      const r = await api.reports.add({ kind, lat: p.lat, lon: p.lon, line: leg.mode === 'WALK' ? null : leg.line, stop: leg.from.name })
      setLive((l) => (l ? { ...l, reports: [r, ...l.reports] } : l))
      seen.current.add(r.id)
      setSent(t('live.thanks'))
    } catch { setSent(t('live.report_failed')) }
    setReporting(false)
  }
  const vote = async (id, still) => {
    setVoted((v) => ({ ...v, [id]: still ? 'up' : 'down' }))
    const r = await api.reports.vote(id, still).catch(() => null)
    if (r?.removed) setLive((l) => ({ ...l, reports: l.reports.filter((x) => x.id !== id) }))
  }

  return (
    <section className="live" aria-labelledby="live-title">
      <div className="live__head">
        <h2 id="live-title">{t('live.title')}</h2>
        <span className={`live__chip${online ? '' : ' live__chip--off'}`}>
          {online ? <><span className="status-dot" aria-hidden="true" /> {live ? t('live.updated', { time: time(live.at) }) : t('app.loading')}</> : t('live.offline')}
        </span>
      </div>

      <Suspense fallback={<div className="map map--trip" />}>
        <div className="map--trip">
          <MapView center={center} markers={markers} lines={lines} zoom={15} label={t('live.map')} fit={!here} me={here} meLabel={t('map.center_me')} />
        </div>
      </Suspense>

      {/* Prochain passage en temps réel */}
      {dep && depLeg && (
        <p className={`live-dep${dep.delay_min >= 3 ? ' live-dep--late' : ''}`}>
          <Icon name={depLeg.mode === 'BUS' ? 'bus' : depLeg.mode === 'TRAM' ? 'tram' : 'train'} size={20} />
          <span>
            <strong>{t('live.departure', { line: legLabel(depLeg), stop: depLeg.from.name, time: time(dep.expected) })}</strong>
            <small>{!dep.realtime ? t('live.scheduled') : dep.delay_min >= 1 ? t('live.late', { n: dep.delay_min })
              : dep.delay_min <= -1 ? t('live.early', { n: -dep.delay_min }) : t('live.on_time')}</small>
          </span>
        </p>
      )}

      {/* Toute la ligne en temps réel (PRIM) */}
      {live?.line && trip.legs[live.line.leg] && (
        <p className={`live-dep${live.line.late ? ' live-dep--late' : ''}`}>
          <Icon name="clock" size={20} />
          <span>
            <strong>{t('live.line_state', { line: legLabel(trip.legs[live.line.leg]), n: live.line.journeys })}</strong>
            <small>{live.line.late ? t('live.line_late', { n: live.line.late, max: live.line.max_delay_min }) : t('live.line_ok')}</small>
          </span>
        </p>
      )}

      {/* Perturbations sur les lignes du trajet */}
      {/* Une même perturbation peut arriver deux fois (une par ligne ou par source) : une seule carte */}
      {live?.disruptions.filter((d, i, all) => all.findIndex((x) => x.title === d.title && x.message === d.message) === i).map((d) => (
        <article key={d.id || d.title} className={`live-alert${d.severity === 'BLOQUANTE' ? ' live-alert--block' : ''}`}>
          <Icon name="alert" size={20} />
          {/* Gravité écrite en toutes lettres : la couleur seule ne suffit pas */}
          <div><span className="live-alert__sev">{t(d.severity === 'BLOQUANTE' ? 'live.sev_block' : 'live.sev_minor')}</span><strong>{d.title}</strong>{d.message && <p>{d.message}</p>}</div>
        </article>
      ))}
      {live?.elevators_out.map((e) => (
        <p key={e.station} className="live-alert"><Icon name="elevator" size={20} /> {t('it.elevator_out', { station: e.station })}</p>
      ))}
      {(blocking || bigDelay) && (
        <button type="button" className="btn btn--warm btn--block" onClick={onReplan}>
          <Icon name="trip" /> {t('live.alternative')}
        </button>
      )}

      {/* Signalements des voyageurs */}
      {live?.reports.length > 0 && (
        <ul className="reports" aria-label={t('live.reports')}>
          {live.reports.map((r) => (
            <li key={r.id} className="report">
              <Icon name={ICON[r.kind] || 'alert'} size={20} />
              <span className="report__text">
                <strong>{t(`report.${r.kind}`)}</strong>
                <small>{[r.line && t('live.on_line', { line: r.line }), r.stop, t('live.ago', { time: time(r.at) })].filter(Boolean).join(' · ')}</small>
              </span>
              {voted[r.id] ? <small className="report__voted">{t('live.voted')}</small> : (
                <span className="report__vote">
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => vote(r.id, true)}>{t('live.still')}</button>
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => vote(r.id, false)}>{t('live.gone')}</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {live && !live.disruptions.length && !live.reports.length && !live.elevators_out.length && (
        <p className="banner banner--ok"><Icon name="check" /> {t('live.all_clear')}</p>
      )}

      {/* Signaler, comme dans Waze */}
      {online && (reporting ? (
        <div className="report-sheet" role="group" aria-label={t('live.report')}>
          {REPORT_KINDS.map((k) => (
            <button key={k.kind} type="button" className="report-kind" onClick={() => report(k.kind)}>
              <Icon name={k.icon} size={24} /> {t(`report.${k.kind}`)}
            </button>
          ))}
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setReporting(false)}>{t('live.cancel')}</button>
        </div>
      ) : (
        <button type="button" className="btn btn--outline btn--block" onClick={() => { setSent(''); setReporting(true) }}>
          <Icon name="bell" /> {t('live.report')}
        </button>
      ))}
      {sent && <p className="card__meta" role="status">{sent}</p>}
    </section>
  )
}
