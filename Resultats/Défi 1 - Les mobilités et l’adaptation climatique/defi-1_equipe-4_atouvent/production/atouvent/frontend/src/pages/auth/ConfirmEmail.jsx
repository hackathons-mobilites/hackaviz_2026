// Lien reçu par e-mail (/confirmer-email#jeton) : confirme l'adresse et ouvre le compte
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BrandHead from '../../components/BrandHead.jsx'
import ResendVerification from '../../components/ResendVerification.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useI18n } from '../../i18n/index.jsx'

function takeToken() {
  const token = window.location.hash.slice(1)
  // Retire le jeton de la barre d'adresse et de l'historique
  if (token) window.history.replaceState(window.history.state, '', window.location.pathname)
  return token
}

export default function ConfirmEmail() {
  const { t, err: errText } = useI18n()
  const { verifyEmail } = useAuth()
  const navigate = useNavigate()
  const [token] = useState(takeToken)
  const [error, setError] = useState(token ? '' : t('auth.verify_missing'))
  const done = useRef(false)

  useEffect(() => {
    if (!token || done.current) return
    done.current = true  // une seule tentative (le mode strict de React lance les effets deux fois)
    verifyEmail(token)
      .then(() => navigate('/inscription/profil', { replace: true }))
      .catch((x) => setError(errText(x.code)))
  }, [token, verifyEmail, navigate, errText])

  return (
    <>
      <BrandHead small title={t('auth.verify_confirm_title')} />
      <main id="contenu" className="app-main">
        {error ? (
          <>
            <p className="field__error" role="alert">{error}</p>
            <ResendVerification />
          </>
        ) : (
          <p className="loading" role="status">{t('auth.verify_checking')}</p>
        )}
        <p className="form__alt"><Link to="/connexion">{t('auth.login')}</Link></p>
      </main>
    </>
  )
}
