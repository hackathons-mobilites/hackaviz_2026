// 01 · Connexion
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import BrandHead from '../../components/BrandHead.jsx'
import PasswordField from '../../components/PasswordField.jsx'
import ResendVerification from '../../components/ResendVerification.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useI18n } from '../../i18n/index.jsx'

export default function Login() {
  const { t, err: errText } = useI18n()
  const { login } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [unverified, setUnverified] = useState(false)  // bon mot de passe, adresse e-mail pas encore confirmée
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setUnverified(false)
    try {
      await login(form)
      navigate(state?.from || '/', { replace: true })
    } catch (err) {
      setUnverified(err.code === 'email_not_verified')
      setError(errText(err.code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <BrandHead langLink title={t('auth.welcome_back')} subtitle={t('auth.welcome_back_sub')} />
      <main id="contenu" className="app-main">
        <form className="form" onSubmit={submit} noValidate>
          {error && <p className="field__error" role="alert">{error}</p>}
          <div className="field">
            <label htmlFor="email">{t('auth.email')}</label>
            <input id="email" className="input" type="email" autoComplete="email" required placeholder="prenom@exemple.fr"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <PasswordField id="password" label={t('auth.password')} autoComplete="current-password"
              value={form.password} onChange={(password) => setForm({ ...form, password })} />
            <Link className="form__link" to="/mot-de-passe-oublie">{t('auth.forgot')}</Link>
          </div>
          <button className="btn btn--primary btn--block btn--lg" disabled={busy}>{t('auth.login')}</button>
        </form>
        {unverified && <ResendVerification email={form.email} />}
        <div className="form__bottom">
          <span>{t('auth.no_account')}</span>
          <Link to="/inscription">{t('auth.register')}</Link>
          <Link to="/">{t('auth.guest')}</Link>
        </div>
      </main>
    </>
  )
}
