// 02b · Votre profil (étape 2 sur 2) : une seule question, facultative.
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { firstScreenPath, useAuth } from '../../context/AuthContext.jsx'
import { useI18n } from '../../i18n/index.jsx'

export const PROFILES = ['fauteuil', 'marche_difficile', 'malvoyant', 'malentendant', 'lecture_difficile', 'sensible_climat']

export default function RegisterProfile() {
  const { t, err: errText } = useI18n()
  const { user, ready, update } = useAuth()
  const navigate = useNavigate()
  const [need, setNeed] = useState('')
  const [profile, setProfile] = useState([])
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Étape 2 : le compte est créé à l'étape 1
  if (!ready) return <p className="loading" role="status">{t('app.loading')}</p>
  if (!user) return <Navigate to="/inscription" replace />

  const toggle = (p) => setProfile((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (need !== 'yes' || !profile.length) {
      navigate('/', { replace: true })
      return
    }
    if (!consent) {
      setError(t('auth.consent_required'))
      return
    }
    setBusy(true)
    try {
      const u = await update({ profile, profile_consent: true })
      navigate(firstScreenPath(u), { replace: true })
    } catch (x) {
      setError(errText(x.code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="page-head page-head--plain">
        <div className="page-head__inner">
          <div className="page-head__row">
            <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label={t('app.back')}>
              <Icon name="back" size={20} strokeWidth={2.5} />
            </button>
            <span className="step-label">{t('auth.step', { n: 2, total: 2 })}</span>
          </div>
          <h1 className="brand-head__title">{t('auth.profile_h1')}</h1>
        </div>
      </header>
      <main id="contenu" className="app-main">
        <form className="form" onSubmit={submit} noValidate>
          {error && <p className="field__error" role="alert">{error}</p>}
          <fieldset className="need">
            <legend>{t('auth.need_q')}</legend>
            <label className="choice">
              <input type="radio" name="need" checked={need === 'no'} onChange={() => setNeed('no')} />{t('auth.need_no')}
            </label>
            <div className="need-yes">
              <label className="need-yes__head">
                <input type="radio" name="need" checked={need === 'yes'} onChange={() => setNeed('yes')} />{t('auth.need_yes')}
              </label>
              {need === 'yes' && (
                <>
                  <fieldset>
                    <legend>{t('auth.profile_hint')}</legend>
                    {PROFILES.map((p) => (
                      <label key={p} className="check">
                        <input type="checkbox" checked={profile.includes(p)} onChange={() => toggle(p)} />{t(`profile.${p}`)}
                      </label>
                    ))}
                  </fieldset>
                  {profile.length > 0 && (
                    <label className="check">
                      <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                      <span>{t('auth.consent')} <a href="/confidentialite.html">{t('privacy.link')}</a></span>
                    </label>
                  )}
                </>
              )}
            </div>
            <label className="choice">
              <input type="radio" name="need" checked={need === 'skip'} onChange={() => setNeed('skip')} />{t('auth.need_skip')}
            </label>
          </fieldset>
          <p className="field__hint">{t('auth.profile_note')}</p>
          <button className="btn btn--primary btn--block btn--lg" disabled={busy}>{t('lang.continue')}</button>
        </form>
      </main>
    </>
  )
}
