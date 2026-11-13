// Page refusée (compte sans le rôle demandé) : un titre, la raison, et le retour à l'accueil
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'

export default function Forbidden({ reason = 'err.forbidden' }) {
  const { t } = useI18n()
  return (
    <main id="contenu" className="app-main">
      <h1 className="section-title__h1">{t('err.forbidden_title')}</h1>
      <p className="field__error" role="alert">{t(reason)}</p>
      <Link className="btn btn--primary btn--block" to="/">{t('nav.around')}</Link>
    </main>
  )
}
