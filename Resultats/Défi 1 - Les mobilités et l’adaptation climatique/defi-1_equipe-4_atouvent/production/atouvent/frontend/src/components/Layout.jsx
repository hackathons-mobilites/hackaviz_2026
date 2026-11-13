// Cadre commun : lien d'évitement, bandeau hors connexion, contenu, navigation
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { setupNative } from '../native.js'
import { useOnline } from '../hooks/useOnline.js'
import { useI18n } from '../i18n/index.jsx'
import BottomNav from './BottomNav.jsx'

// Écrans en plein écran dans la maquette (pas de navigation basse) ; ceux du compte ont un fond blanc
const PLAIN = ['/connexion', '/inscription', '/mot-de-passe', '/confirmer-email']
const FULL = [...PLAIN, '/itineraires', '/trajet']
const starts = (list, path) => list.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}-`))

export default function Layout() {
  const { t, chosen } = useI18n()
  const online = useOnline()
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  // Application Android : bouton Retour et autorisation de localisation (sans effet dans le navigateur)
  useEffect(() => { setupNative(navigate) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Première ouverture : choix de la langue avant tout (le fragment # est gardé : il porte le jeton du lien « nouveau mot de passe »)
  if (!chosen) return <Navigate to="/bienvenue" replace state={{ from: pathname + search + hash }} />

  const full = starts(FULL, pathname)
  return (
    <div className={`app${full ? ' app--full' : ''}${starts(PLAIN, pathname) ? ' app--plain' : ''}`}>
      <a className="skip-link" href="#contenu">{t('app.skip')}</a>
      {!online && <p className="offline-strip" role="status">{t('app.offline')}</p>}
      <Outlet />
      {!full && <BottomNav />}
    </div>
  )
}
