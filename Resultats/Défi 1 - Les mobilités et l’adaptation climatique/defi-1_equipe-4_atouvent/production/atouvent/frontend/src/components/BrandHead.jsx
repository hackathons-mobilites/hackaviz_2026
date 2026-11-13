// En-tête sombre des écrans d'accueil (langue, connexion, inscription) : logo, titre, sous-titre
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import Icon from './Icon.jsx'
import { Brand } from './Logo.jsx'

export default function BrandHead({ title, subtitle, small = false, langLink = false, children }) {
  const { t, lang } = useI18n()
  return (
    <header className={`brand-head${small ? ' brand-head--small' : ''}`}>
      <div className="brand-head__row">
        <Brand size={small ? 32 : 48} fontSize={small ? 19 : 26} />
        {langLink && (
          <Link to="/bienvenue" className="lang-btn" aria-label={t('lang.change', { lang: lang.toUpperCase() })}>
            <Icon name="globe" size={18} /> {lang.toUpperCase()}
          </Link>
        )}
      </div>
      {title && <h1 className="brand-head__title">{title}</h1>}
      {subtitle && <p className="brand-head__sub">{subtitle}</p>}
      {children}
    </header>
  )
}
