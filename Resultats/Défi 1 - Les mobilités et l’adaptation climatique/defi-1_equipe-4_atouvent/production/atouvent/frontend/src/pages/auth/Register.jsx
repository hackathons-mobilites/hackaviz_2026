// 02 · Créer un compte (étape 1 sur 2), puis 02b la question facultative sur le handicap
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BrandHead from '../../components/BrandHead.jsx'
import Icon from '../../components/Icon.jsx'
import PasswordField from '../../components/PasswordField.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePrefs } from '../../context/PrefsContext.jsx'
import { useI18n } from '../../i18n/index.jsx'

export default function Register() {
  const { t, lang, err: errText } = useI18n()
  const { register, update } = useAuth()
  const { prefs, set } = usePrefs()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [choices, setChoices] = useState({ location: prefs.use_location, alerts: true, terms: false })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const longEnough = form.password.length >= 12

  const submit = async (e) => {
    e.preventDefault()
    if (!choices.terms) {
      setError(t('auth.terms_required'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const r = await register({ ...form, language: lang, alerts_on: choices.alerts })
      set({ use_location: choices.location })
      // Adresse à confirmer : le compte s'ouvre avec le lien reçu par e-mail
      if (r?.verify) return navigate('/inscription/confirmation', { replace: true, state: { email: r.email } })
      if (!choices.alerts) await update({ alerts: [] }).catch(() => {})
      navigate('/inscription/profil', { replace: true })
    } catch (err) {
      setError(errText(err.code))
    } finally {
      setBusy(false)
    }
  }

  const check = (key) => ({ checked: choices[key], onChange: (e) => setChoices({ ...choices, [key]: e.target.checked }) })

  return (
    <>
      <BrandHead small title={t('auth.create_title')} subtitle={t('auth.create_sub')} />
      <main id="contenu" className="app-main">
        <form className="form" onSubmit={submit} noValidate>
          {error && <p className="field__error" role="alert">{error}</p>}
          <div className="field">
            <label htmlFor="email">{t('auth.email')}</label>
            <input id="email" className="input" type="email" autoComplete="email" required placeholder="prenom@exemple.fr"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <PasswordField id="password" label={t('auth.password')} autoComplete="new-password" describedBy="pw-hint"
              invalid={form.password.length > 0 && !longEnough}
              value={form.password} onChange={(password) => setForm({ ...form, password })} />
            <p id="pw-hint" className={longEnough ? 'hint-check' : form.password ? 'field__error' : 'hint-check'}>
              {longEnough && <Icon name="check" size={16} strokeWidth={3} />}{t('auth.password_hint')}
            </p>
          </div>
          <fieldset className="checks">
            <legend>{t('auth.choices')}</legend>
            <label className="check"><input type="checkbox" {...check('location')} />
              <span>{t('auth.choice_location')} <small>{t('auth.choice_location_hint')}</small></span></label>
            <label className="check"><input type="checkbox" {...check('alerts')} />
              <span>{t('auth.choice_alerts')} <small>{t('auth.choice_alerts_hint')}</small></span></label>
            <label className="check"><input type="checkbox" required {...check('terms')} />
              <span>{t('auth.choice_terms')} <a href="/confidentialite.html">{t('privacy.link')}</a>. <small>{t('auth.required')}</small></span></label>
          </fieldset>
          <button className="btn btn--primary btn--block btn--lg" disabled={busy || !longEnough || !form.email}>{t('auth.create_btn')}</button>
        </form>
        <div className="form__row-links">
          <Link to="/connexion">{t('auth.have_account')}</Link>
          <Link to="/">{t('auth.guest')}</Link>
        </div>
      </main>
    </>
  )
}
