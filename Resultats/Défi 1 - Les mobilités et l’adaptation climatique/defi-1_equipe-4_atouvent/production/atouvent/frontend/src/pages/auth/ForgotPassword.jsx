// Mot de passe oublié : envoi d'un lien par e-mail (réponse identique que le compte existe ou non)
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client.js'
import PageHead from '../../components/PageHead.jsx'
import { useI18n } from '../../i18n/index.jsx'

export default function ForgotPassword() {
  const { t, err: errText } = useI18n()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.auth.forgot(email)
      setSent(true)
    } catch (x) {
      setError(errText(x.code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead title={t('auth.forgot_title')} />
      <main id="contenu" className="app-main">
        {sent ? (
          <p className="banner banner--ok" role="status">{t('auth.forgot_sent')}</p>
        ) : (
          <form className="form" onSubmit={submit} noValidate>
            <p>{t('auth.forgot_hint')}</p>
            {error && <p className="field__error" role="alert">{error}</p>}
            <div className="field">
              <label htmlFor="email">{t('auth.email')}</label>
              <input id="email" className="input" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="btn btn--primary btn--block btn--lg" disabled={busy || !email}>{t('auth.forgot_send')}</button>
          </form>
        )}
        <p className="form__alt"><Link to="/connexion">{t('auth.login')}</Link></p>
      </main>
    </>
  )
}
