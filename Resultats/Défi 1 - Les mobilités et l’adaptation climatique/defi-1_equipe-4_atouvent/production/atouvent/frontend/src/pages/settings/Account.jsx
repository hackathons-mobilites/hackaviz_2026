// 08 · Mon compte et mes données : alertes, réglages, profil, mot de passe, droits RGPD (export, suppression)
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api/client.js'
import Icon from '../../components/Icon.jsx'
import { isAdmin, useAuth } from '../../context/AuthContext.jsx'
import { usePrefs } from '../../context/PrefsContext.jsx'
import { LANGUAGES, useI18n } from '../../i18n/index.jsx'
import { HAZARDS } from './Alerts.jsx'

export default function Account() {
  const { t, lang, err } = useI18n()
  const { user, update, logout, removePlace } = useAuth()
  const { prefs, set } = usePrefs()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const name = user.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  const toggleAlert = (h) => {
    const next = user.alerts.includes(h) ? user.alerts.filter((x) => x !== h) : [...user.alerts, h]
    update({ alerts: next }).catch((x) => setError(err(x.code)))
  }

  // Téléchargement de toutes les données du compte (droit d'accès)
  const exportData = async () => {
    try {
      const data = await api.me.export()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      Object.assign(document.createElement('a'), { href: url, download: 'atouvent-mes-donnees.json' }).click()
      URL.revokeObjectURL(url)
    } catch (x) { setError(err(x.code)) }
  }

  const removeProfile = () => update({ profile: [], profile_consent: false }).catch((x) => setError(err(x.code)))

  const removeAccount = async () => {
    if (!window.confirm(t('account.delete_confirm'))) return
    try {
      await api.me.remove()
      logout()
      navigate('/', { replace: true })
    } catch (x) { setError(err(x.code)) }
  }

  return (
    <>
      <header className="page-head">
        <div className="page-head__inner">
          <div className="page-head__row">
            <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label={t('app.back')}>
              <Icon name="back" size={20} strokeWidth={2.5} />
            </button>
            <span className="avatar" aria-hidden="true">{name[0]}</span>
            <div className="account-id">
              <h1>{name}</h1>
              <span>{user.email}</span>
            </div>
          </div>
        </div>
      </header>
      <main id="contenu" className="app-main account-main">
        {error && <p className="field__error" role="alert">{error}</p>}

        <section className="card" aria-labelledby="t-places">
          <h2 id="t-places">{t('places.title')}</h2>
          {user.places?.length ? (
            <ul className="list">
              {user.places.map((p) => (
                <li key={p.id} className="place-row">
                  <Link className="link-row" to={`/itineraires?${new URLSearchParams({ vers: p.label || p.name, lat: p.lat, lon: p.lon })}`}>
                    <span><strong>{p.name}</strong><small>{t('places.see_routes', { name: p.label || p.name })}</small></span>
                    <Icon name="chevron" size={18} />
                  </Link>
                  <button type="button" className="btn btn--ghost btn--small" aria-label={t('places.remove', { name: p.name })}
                    onClick={() => removePlace(p.id).catch((x) => setError(err(x.code)))}>{t('places.remove_short')}</button>
                </li>
              ))}
            </ul>
          ) : <p className="card__meta">{t('places.empty')}</p>}
          <Link className="btn btn--ghost btn--block" to="/itineraires"><Icon name="pin" /> {t('places.add')}</Link>
        </section>

        <section className="card" aria-labelledby="t-alerts">
          <h2 id="t-alerts">{t('account.alerts_title')}</h2>
          <p className="card__meta">{t('account.alerts_hint')} · <Link to="/alertes">{t('account.see_alerts')}</Link></p>
          {HAZARDS.map((h) => (
            <label key={h} className="check-row">
              <span>{t(`hazard.${h}`)}</span>
              <input type="checkbox" checked={user.alerts.includes(h)} onChange={() => toggleAlert(h)} />
            </label>
          ))}
        </section>

        <section className="card" aria-labelledby="t-settings">
          <h2 id="t-settings">{t('account.settings')}</h2>
          <Link className="link-row" to="/accessibilite">
            <span><strong>{t('account.a11y_profile')}</strong>
              <small>{user.profile.length ? user.profile.map((p) => t(`profile.${p}`)).join(' · ') : t('account.none')}</small></span>
            <Icon name="chevron" size={18} />
          </Link>
          <div className="check-row">
            <span>{t('a11y.text_size')}</span>
            <div className="text-sizes" role="group" aria-label={t('a11y.text_size')}>
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" aria-pressed={prefs.text_size === n} onClick={() => set({ text_size: n })}
                  aria-label={t(['a11y.small', 'a11y.medium', 'a11y.large'][n - 1])} style={{ fontSize: `${0.875 + n * 0.125}rem` }}>A</button>
              ))}
            </div>
          </div>
          <label className="check-row">
            <span>{t('account.contrast')}</span>
            <input type="checkbox" checked={prefs.high_contrast} onChange={(e) => set({ high_contrast: e.target.checked })} />
          </label>
          <label className="check-row">
            <span>{t('account.avoid_noac')}</span>
            <input type="checkbox" checked={prefs.avoid_noac} onChange={(e) => set({ avoid_noac: e.target.checked })} />
          </label>
          <Link className="link-row" to="/bienvenue" state={{ from: '/compte' }}>
            <span><strong>{t('account.language')}</strong>
              <small>{LANGUAGES.map((l) => <span key={l.code} lang={l.code} className={l.code === lang ? 'current' : undefined}>{l.name}</span>)}</small></span>
            <Icon name="chevron" size={18} />
          </Link>
          <label className="check-row">
            <span><strong>{t('account.offline')}</strong><small>{t('account.offline_hint')}</small></span>
            <input type="checkbox" checked={user.offline} onChange={(e) => update({ offline: e.target.checked }).catch(() => {})} />
          </label>
        </section>

        {user.profile.length > 0 && (
          <section className="card" aria-labelledby="profile-title">
            <h2 id="profile-title">{t('account.profile')}</h2>
            <ul className="list">{user.profile.map((p) => <li key={p}>{t(`profile.${p}`)}</li>)}</ul>
            <button type="button" className="btn btn--ghost" onClick={removeProfile}>{t('account.delete')} · {t('account.profile')}</button>
          </section>
        )}

        <details className="card">
          <summary className="details-title">{t('account.password_title')}</summary>
          <PasswordForm />
        </details>

        <section className="card" aria-labelledby="t-data">
          <h2 id="t-data">{t('account.data')}</h2>
          <ul className="data-list">
            {['account.data_kept', 'account.data_profile', 'account.data_gps'].map((k) => (
              <li key={k}><Icon name="check" size={18} strokeWidth={2.5} />{t(k)}</li>
            ))}
          </ul>
          <button type="button" className="btn btn--ghost btn--block" onClick={exportData}>{t('account.export')}</button>
          <button type="button" className="btn btn--danger btn--block" onClick={removeAccount}>{t('account.delete')}</button>
        </section>

        {isAdmin(user) && <Link className="btn btn--ghost btn--block" to="/admin">{t('account.admin')}</Link>}
        {isAdmin(user) && <Link className="btn btn--ghost btn--block" to="/donnees"><Icon name="chart" /> {t('data.title')}</Link>}
        <button type="button" className="btn btn--dark btn--block" onClick={() => { logout(); navigate('/') }}>{t('account.logout')}</button>
        <p className="footnote">
          <a href="/declaration-accessibilite.html">{t('a11y.level')}</a> · <a href="/confidentialite.html">{t('privacy.link')}</a> · <a href="/confidentialite.html#cookies">{t('privacy.cookies')}</a> · <a href="/mentions-legales.html">{t('legal.link')}</a>
        </p>
      </main>
    </>
  )
}

// Changement de mot de passe : les autres appareils sont déconnectés
function PasswordForm() {
  const { t, err } = useI18n()
  const { changePassword } = useAuth()
  const [form, setForm] = useState({ current_password: '', password: '' })
  const [msg, setMsg] = useState({ ok: '', error: '' })
  const [busy, setBusy] = useState(false)
  const tooShort = form.password.length > 0 && form.password.length < 12

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg({ ok: '', error: '' })
    try {
      await changePassword(form)
      setForm({ current_password: '', password: '' })
      setMsg({ ok: t('account.password_saved'), error: '' })
    } catch (x) {
      setMsg({ ok: '', error: err(x.code) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" aria-labelledby="pw-title">
      <h2 id="pw-title">{t('account.password_title')}</h2>
      <form className="form" onSubmit={submit} noValidate>
        {msg.error && <p className="field__error" role="alert">{msg.error}</p>}
        {msg.ok && <p className="banner banner--ok" role="status">{msg.ok}</p>}
        <div className="field">
          <label htmlFor="current-pw">{t('account.current_password')}</label>
          <input id="current-pw" className="input" type="password" autoComplete="current-password" required
            value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="new-pw">{t('auth.new_password')}</label>
          <input id="new-pw" className="input" type="password" autoComplete="new-password" required minLength={12}
            aria-describedby="new-pw-hint" aria-invalid={tooShort}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <span id="new-pw-hint" className={tooShort ? 'field__error' : 'field__hint'}>{t('auth.password_hint')}</span>
        </div>
        <button className="btn btn--primary btn--block" disabled={busy || !form.current_password || form.password.length < 12}>
          {t('account.password_title')}
        </button>
      </form>
    </section>
  )
}
