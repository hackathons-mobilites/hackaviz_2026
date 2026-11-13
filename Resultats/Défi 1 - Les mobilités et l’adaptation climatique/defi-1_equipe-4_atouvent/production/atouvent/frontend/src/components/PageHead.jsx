// En-tête sombre d'un écran : retour, titre, contenu complémentaire
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import Icon from './Icon.jsx'

export default function PageHead({ title, back = true, wide = false, compact = false, aside, children }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  // Arrivé par un lien direct (pas d'historique dans l'application) : retour à l'accueil plutôt que hors de l'application
  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/'))
  return (
    <header className={`page-head${wide ? ' page-head--wide' : ''}`}>
      <div className="page-head__inner">
        <div className="page-head__row">
          {back && (
            <button type="button" className="icon-btn" onClick={goBack} aria-label={t('app.back')}>
              <Icon name="back" size={20} strokeWidth={2.5} />
            </button>
          )}
          <h1 className={compact ? 'page-head__title--compact' : undefined}>{title}</h1>
          {aside}
        </div>
        {children}
      </div>
    </header>
  )
}
