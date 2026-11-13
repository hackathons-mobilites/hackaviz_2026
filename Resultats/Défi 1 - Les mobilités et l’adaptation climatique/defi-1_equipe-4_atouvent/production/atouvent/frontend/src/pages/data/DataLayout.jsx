// Cadre des écrans décideurs (09 à 11) : grand écran, en-tête sombre avec onglets, sans navigation mobile.
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import Forbidden from '../../components/Forbidden.jsx'
import Logo from '../../components/Logo.jsx'
import { isAdmin, useAuth } from '../../context/AuthContext.jsx'
import { useOnline } from '../../hooks/useOnline.js'
import { useI18n } from '../../i18n/index.jsx'
import { useText } from './texts.js'

const TABS = [
  { to: '/donnees', label: 'tab_analysis' },
  { to: '/donnees/supervision', label: 'tab_live' },
  { to: '/donnees/prevision', label: 'tab_forecast' },
]

export function DataHeader({ subtitle, aside }) {
  const { tx } = useText()
  return (
    <header className="dash-head">
      <NavLink to="/" className="dash-brand">
        <Logo />
        <span>
          <span className="dash-brand__name">Atou<b>Vent</b></span>
          <span className="dash-brand__sub">{subtitle || tx('brand_sub')}</span>
        </span>
      </NavLink>
      <nav aria-label={tx('view')} className="dash-tabs dash-tabs--view">
        <span aria-current="page">{tx('view_deciders')}</span>
        <NavLink to="/">{tx('view_users')}</NavLink>
      </nav>
      <nav aria-label={tx('tabs')} className="dash-tabs">
        {TABS.map((tab) => <NavLink key={tab.to} to={tab.to} end>{tx(tab.label)}</NavLink>)}
      </nav>
      {aside && <div className="dash-head__aside">{aside}</div>}
    </header>
  )
}

export default function DataLayout() {
  const { t, chosen } = useI18n()
  const { lang } = useText()
  const online = useOnline()
  const { pathname } = useLocation()
  const { user, ready } = useAuth()
  if (!chosen) return <Navigate to="/bienvenue" replace state={{ from: pathname }} />
  if (!ready) return <p className="loading" role="status">{t('app.loading')}</p>
  if (!user) return <Navigate to="/connexion" replace state={{ from: pathname }} />
  if (!isAdmin(user)) {
    return (
      <>
        <a className="skip-link" href="#contenu">{t('app.skip')}</a>
        <Forbidden reason="err.deciders_only" />
      </>
    )
  }
  return (
    // Écrans en français ou en anglais seulement : lang le dit aux lecteurs d'écran
    <div className="dash" lang={lang}>
      <a className="skip-link" href="#contenu">{t('app.skip')}</a>
      {!online && <p className="offline-strip" role="status">{t('app.offline')}</p>}
      <Outlet />
    </div>
  )
}
