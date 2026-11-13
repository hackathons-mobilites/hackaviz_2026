// Après l'inscription : l'adresse e-mail doit être confirmée avant la première connexion
import { Link, useLocation } from 'react-router-dom'
import BrandHead from '../../components/BrandHead.jsx'
import ResendVerification from '../../components/ResendVerification.jsx'
import { useI18n } from '../../i18n/index.jsx'

export default function VerifyEmail() {
  const { t } = useI18n()
  const email = useLocation().state?.email || ''

  return (
    <>
      <BrandHead small title={t('auth.verify_title')} subtitle={t('auth.verify_sub')} />
      <main id="contenu" className="app-main">
        <p className="banner banner--ok" role="status">
          {email ? t('auth.verify_sent', { email }) : t('auth.verify_sent_noemail')}
        </p>
        <p>{t('auth.verify_spam')}</p>
        <ResendVerification email={email} />
        <p className="form__alt"><Link to="/connexion">{t('auth.login')}</Link></p>
      </main>
    </>
  )
}
