// Protège une route : redirige vers la connexion puis revient à la page demandée
import { Navigate, useLocation } from 'react-router-dom'
import { isAdmin, useAuth } from '../context/AuthContext.jsx'
import { useI18n } from '../i18n/index.jsx'
import Forbidden from './Forbidden.jsx'

export default function RequireAuth({ children, admin = false }) {
  const { user, ready } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  if (!ready) return <p className="loading" role="status">{t('app.loading')}</p>
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />
  if (admin && !isAdmin(user)) return <Forbidden />
  return children
}
