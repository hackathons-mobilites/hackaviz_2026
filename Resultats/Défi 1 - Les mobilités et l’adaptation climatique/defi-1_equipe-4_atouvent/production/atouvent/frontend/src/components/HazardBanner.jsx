// Bandeau d'aléa : pictogramme + nom + conseil (jamais la couleur seule)
import { useI18n } from '../i18n/index.jsx'
import Icon, { HAZARD_ICON } from './Icon.jsx'

export default function HazardBanner({ hazard, when, official }) {
  const { t } = useI18n()
  return (
    <div className="banner banner--alert" role="status">
      <Icon name={HAZARD_ICON[hazard] || 'alert'} size={26} />
      <p>
        <strong>{t(`hazard.${hazard}`)}{when ? ` · ${when}` : ''}</strong>
        {official && <span className={`vigilance-tag vigilance-tag--${official.color}`}>{t('vigilance.official', { color: t(`flood.${official.color}`) })}</span>}
        {t(`advice.${hazard}`)}
      </p>
    </div>
  )
}
