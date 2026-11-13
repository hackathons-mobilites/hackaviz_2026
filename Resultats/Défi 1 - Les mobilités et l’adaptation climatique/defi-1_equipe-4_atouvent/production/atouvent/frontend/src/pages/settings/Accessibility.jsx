// 06 · Trajet accessible : réglages d'affichage en un geste, profil de déplacement, trajet vérifié gare par gare.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { useAnnouncer } from '../../context/AnnouncerContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePrefs } from '../../context/PrefsContext.jsx'
import { legLabel as lineLabel, lineIndex, loadNetwork } from '../../features/network.js'
import { loadTrip } from '../../features/trip/tripStore.js'
import { useI18n } from '../../i18n/index.jsx'
import { chooseVoice, chosenVoice, speak, voicesFor } from '../../utils/voice.js'

// Profil → réglages activés (mêmes règles que le serveur, voir core/security.py)
const NEEDS = {
  fauteuil: { step_free: true },
  malvoyant: { high_contrast: true, voice: true, text_size: 3 },
  malentendant: { vibrate: true, visual_alerts: true },
  climat: { avoid_noac: true },
}
const FROM_PROFILE = { fauteuil: 'fauteuil', marche_difficile: 'fauteuil', malvoyant: 'malvoyant', malentendant: 'malentendant', sensible_climat: 'climat' }

export default function Accessibility() {
  const { t, locale } = useI18n()
  const [voices, setVoices] = useState(() => voicesFor(locale))
  const [voiceName, setVoiceName] = useState(() => chosenVoice() || '')
  // La liste des voix arrive parfois après le premier affichage
  useEffect(() => {
    const id = setTimeout(() => setVoices(voicesFor(locale)), 600)
    return () => clearTimeout(id)
  }, [locale])
  const { prefs, set } = usePrefs()
  const { user } = useAuth()
  const { announce } = useAnnouncer()
  const navigate = useNavigate()
  const [bundle, setBundle] = useState(undefined)
  const [line, setLine] = useState(() => () => ({ ac: 'unknown' }))
  const needs = prefs.needs || [...new Set((user?.profile || []).map((p) => FROM_PROFILE[p]).filter(Boolean))]

  useEffect(() => { loadTrip().then(setBundle) }, [])
  useEffect(() => { loadNetwork().then((g) => setLine(() => lineIndex(g))) }, [])

  const toggleNeed = (n) => {
    const on = !needs.includes(n)
    set({ needs: on ? [...needs, n] : needs.filter((x) => x !== n), ...(on ? NEEDS[n] : {}) })
  }

  const steps = bundle ? stationSteps(bundle, line, t) : []
  const minutes = bundle ? Math.round((Date.parse(bundle.trip.end) - Date.parse(bundle.trip.start)) / 60000) : 0

  // « Écouter » : lecture à voix haute du trajet, même si les annonces vocales sont coupées
  const listen = () => {
    const text = bundle ? [summary(bundle), ...steps.map((s) => `${s.title}. ${s.meta}`)].join('. ') : t('a11y.no_trip')
    speak(text, locale)
    announce(text)
  }
  const summary = (b) => `${b.trip.legs[0].from.name} → ${b.trip.legs[b.trip.legs.length - 1].to.name}`

  return (
    <>
      <header className="page-head a11y-head">
        <div className="page-head__inner">
          <div className="page-head__row">
            <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label={t('app.back')}>
              <Icon name="back" size={20} strokeWidth={2.5} />
            </button>
            <h1>{t('a11y.trip_title')}</h1>
          </div>
          <div className="a11y-toolbar" role="toolbar" aria-label={t('a11y.toolbar')}>
            <button type="button" aria-label={`${t('a11y.text_size')} : ${t(['a11y.small', 'a11y.medium', 'a11y.large'][prefs.text_size - 1])}`}
              onClick={() => set({ text_size: prefs.text_size === 3 ? 1 : prefs.text_size + 1 })}>{t('a11y.text_btn')}</button>
            <button type="button" aria-pressed={prefs.high_contrast} onClick={() => set({ high_contrast: !prefs.high_contrast })}>{t('a11y.contrast_btn')}</button>
            <button type="button" aria-pressed={prefs.voice} onClick={() => set({ voice: !prefs.voice })}><Icon name="sound" size={20} />{t('a11y.voice_btn')}</button>
          </div>
        </div>
      </header>

      <main id="contenu" className="app-main a11y-main">
        <fieldset>
          <legend className="a11y-legend">{t('a11y.profile_label')}</legend>
          <div className="pills">
            {Object.keys(NEEDS).map((n) => (
              <button key={n} type="button" className="pill" aria-pressed={needs.includes(n)} onClick={() => toggleNeed(n)}>
                {t(`a11y.chip_${n}`)}
              </button>
            ))}
          </div>
        </fieldset>

        {bundle === null && (
          <section className="a11y-trip">
            <p>{t('a11y.no_trip')}</p>
            <Link className="btn btn--primary btn--block btn--lg" to="/itineraires?sans-marche=1">{t('a11y.plan_step_free')}</Link>
          </section>
        )}
        {bundle && (
          <>
            <section className="a11y-trip" aria-label={summary(bundle)}>
              <div className="a11y-trip__row">
                <strong>{summary(bundle)}</strong>
                <span className="a11y-trip__min">{t('it.minutes', { n: minutes })}</span>
              </div>
              <span className="card__meta">
                {bundle.trip.accessible ? t('it.step_free') : bundle.trip.accessible_requested ? t('a11y.step_free_trip') : ''}
              </span>
            </section>
            <ol className="a11y-steps">
              {steps.map((s, i) => (
                <li key={i} className={`a11y-step a11y-step--${s.state}`}>
                  <span className="a11y-step__icon" aria-hidden="true">{s.state === 'ok' ? <Icon name="check" size={18} strokeWidth={3} /> : s.state === 'bad' ? '!' : '?'}</span>
                  <div><strong>{s.title}</strong><span>{s.meta}</span></div>
                </li>
              ))}
            </ol>
          </>
        )}

        <div className="a11y-actions">
          {bundle && <Link className="btn btn--primary btn--block btn--lg" to="/trajet"><Icon name="pin" /> {t('a11y.start')}</Link>}
          <div className="trip-actions">
            <button type="button" className="btn btn--outline" onClick={listen}>{t('a11y.listen')}</button>
            <Link className="btn btn--outline" to="/itineraires?sans-marche=1">{t('it.step_free')}</Link>
          </div>
        </div>

        <section className="card" aria-labelledby="a11y-settings">
          <h2 id="a11y-settings" className="card__legend">{t('a11y.settings')}</h2>
          <Switch label={t('a11y.vibrate')} hint={t('a11y.vibrate_hint')} checked={prefs.vibrate} onChange={(v) => set({ vibrate: v })} />
          <Switch label={t('a11y.step_free')} checked={prefs.step_free} onChange={(v) => set({ step_free: v })} />
          <Switch label={t('account.avoid_noac')} checked={prefs.avoid_noac} onChange={(v) => set({ avoid_noac: v })} />
          <Switch label={t('trip.warn_before')} checked={prefs.warn_before} onChange={(v) => set({ warn_before: v })} />
          <Switch label={t('a11y.visual_alerts')} hint={t('a11y.visual_alerts_hint')} checked={prefs.visual_alerts} onChange={(v) => set({ visual_alerts: v })} />
          <Switch label={t('a11y.simple')} hint={t('a11y.simple_hint')} checked={prefs.simple} onChange={(v) => set({ simple: v })} />
          {voices.length > 0 && (
            <div className="field">
              <label htmlFor="voice" className="field__label">{t('a11y.voice_choice')}</label>
              <select id="voice" className="input" value={voiceName} onChange={(e) => { setVoiceName(e.target.value); chooseVoice(e.target.value) }}>
                <option value="">{t('a11y.voice_auto', { name: voices[0].name })}</option>
                {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
              <button type="button" className="btn btn--ghost btn--block" onClick={() => speak(t('a11y.voice_sample'), locale)}>
                <Icon name="sound" size={18} /> {t('a11y.voice_test')}</button>
            </div>
          )}
          <button type="button" className="btn btn--ghost btn--block" onClick={() => announce(t('a11y.test_msg'))}>{t('a11y.test')}</button>
        </section>

        <footer className="a11y-footer">
          <p>{t('a11y.level')}</p>
          <a href="/declaration-accessibilite.html">{t('a11y.statement')}</a>
        </footer>
      </main>
    </>
  )
}

// Une ligne par gare du trajet : ascenseurs (si connus) et climatisation de la ligne
function stationSteps(bundle, line, t) {
  const out = []
  const elev = bundle.elevators || {}
  bundle.trip.legs.forEach((leg) => {
    if (leg.mode === 'WALK') return
    const ac = line(leg.mode, leg.line).ac
    const acText = ac === 'true' ? `${lineLabel(leg)} ${t('trip.ac_line')}` : ac === 'false' ? `${lineLabel(leg)} ${t('trip.noac_line')}` : lineLabel(leg)
    ;[leg.from.name, leg.to.name].forEach((station) => {
      if (out.some((s) => s.station === station)) return
      const list = elev[station] || []
      const down = list.filter((e) => e.status === 'hors_service').length
      out.push({
        station,
        state: down ? 'bad' : list.length ? 'ok' : 'unknown',
        title: down ? t('a11y.elev_out', { station }) : list.length ? `${station}` : t('a11y.elev_unknown', { station }),
        meta: acText,
      })
    })
  })
  const last = bundle.trip.legs[bundle.trip.legs.length - 1]
  out.push({ state: 'ok', title: t('trip.arrival', { place: last.to.name }), meta: '' })
  return out
}

// Interrupteur accessible (case à cocher avec rôle « switch »)
function Switch({ label, hint, checked, onChange }) {
  return (
    <label className="switch">
      <span>
        <strong>{label}</strong>
        {hint && <small className="field__hint switch__hint">{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
