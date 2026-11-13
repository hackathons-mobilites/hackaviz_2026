// Mot de passe avec bouton « Afficher » (lisible pour les personnes qui tapent difficilement)
import { useState } from 'react'
import { useI18n } from '../i18n/index.jsx'

export default function PasswordField({ id, label, value, onChange, autoComplete, describedBy, invalid = false }) {
  const { t } = useI18n()
  const [shown, setShown] = useState(false)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input id={id} className="input" type={shown ? 'text' : 'password'} autoComplete={autoComplete} required
          aria-describedby={describedBy} aria-invalid={invalid} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="pw__toggle" aria-pressed={shown} aria-controls={id}
          aria-label={t('auth.show_pw')} onClick={() => setShown((v) => !v)}>
          {shown ? t('auth.hide') : t('auth.show')}
        </button>
      </div>
    </div>
  )
}
