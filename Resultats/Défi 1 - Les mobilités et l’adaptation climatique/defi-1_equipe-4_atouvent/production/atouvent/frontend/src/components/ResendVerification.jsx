// Renvoi du lien de confirmation de l'adresse e-mail (réponse identique que le compte existe ou non)
import { useState } from 'react'
import { api } from '../api/client.js'
import { useI18n } from '../i18n/index.jsx'

export default function ResendVerification({ email: known = '' }) {
  const { t, err: errText } = useI18n()
  const [email, setEmail] = useState(known)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await api.auth.resendVerification(email)
      setStatus(t('auth.verify_resent'))
    } catch (x) {
      setError(errText(x.code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={send} noValidate>
      {!known && (
        <div className="field">
          <label htmlFor="resend-email">{t('auth.email')}</label>
          <input id="resend-email" className="input" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      )}
      {error && <p className="field__error" role="alert">{error}</p>}
      <p role="status" className={status ? 'banner banner--ok' : undefined}>{status}</p>
      <button className="btn btn--ghost btn--block" disabled={busy || !email}>{t('auth.verify_resend')}</button>
    </form>
  )
}
