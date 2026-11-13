// Bandeau climat des itinéraires (maquette 04) : aléa prévu à l'heure près et ce que ça change dans le classement.
import Icon, { HAZARD_ICON } from '../../components/Icon.jsx'
import { climateItems } from '../../features/climate.js'
import { useI18n } from '../../i18n/index.jsx'

export default function ClimateBanner({ weather, at = null }) {
  const { t } = useI18n()
  const items = climateItems(weather, t, 2, at)
  if (!items.length) return null
  return (
    <div className="climate-banner" role="status">
      {items.map(({ hazard, when, felt, official }) => (
        <p key={hazard}>
          <Icon name={HAZARD_ICON[hazard] || 'alert'} size={22} />
          <span>
            <strong>{t(`climate.${hazard}`, { when })}{felt != null ? ` (${t('climate.felt', { v: felt })})` : ''}.</strong> {t(`climate.rank_${hazard}`)}
            {official && <span className={`vigilance-tag vigilance-tag--${official.color}`}>{t('vigilance.official', { color: t(`flood.${official.color}`) })}</span>}
          </span>
        </p>
      ))}
    </div>
  )
}
