// Nouveau mot de passe, depuis le lien reçu par e-mail (/mot-de-passe/nouveau#jeton).
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHead from '../../components/PageHead.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useI18n } from '../../i18n/index.jsx'

function takeToken() {
  const token = window.location.hash.slice(1)
  // Retire le jeton de la barre d'adresse et de l'historique
  if (token) window.history.replaceState(window.history.state, '', window.location.pathname)
  return token
}

export default function ResetPassword() {
  const { t, err: errText } = useI18n()
  const { resetPassword } = useAuth()
  const navigate = useNavigate()
  const [token] = useState(takeToken)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const tooShort = password.length > 0 && password.length < 12

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await resetPassword(token, password)
      navigate('/', { replace: true })
    } catch (x) {
      setError(errText(x.code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead title={t('auth.reset_title')} />
      <main id="contenu" className="app-main">
        {!token ? (
          <p className="field__error" role="alert">{t('auth.reset_missing')}</p>
        ) : (
          <form className="form" onSubmit={submit} noValidate>
            {error && <p className="field__error" role="alert">{error}</p>}
            <div className="field">
              <label htmlFor="password">{t('auth.new_password')}</label>
              <input id="password" className="input" type="password" autoComplete="new-password" required minLength={12}
                aria-describedby="pw-hint" aria-invalid={tooShort}
                value={password} onChange={(e) => setPassword(e.target.value)} />
              <span id="pw-hint" className={tooShort ? 'field__error' : 'field__hint'}>{t('auth.password_hint')}</span>
            </div>
            <button className="btn btn--primary btn--block btn--lg" disabled={busy || password.length < 12}>{t('auth.reset_save')}</button>
          </form>
        )}
        <p className="form__alt"><Link to="/mot-de-passe-oublie">{t('auth.forgot')}</Link></p>
      </main>
    </>
  )
}
