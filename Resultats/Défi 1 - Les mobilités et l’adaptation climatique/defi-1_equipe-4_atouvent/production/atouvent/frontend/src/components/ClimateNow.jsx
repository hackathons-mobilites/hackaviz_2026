// Climat maintenant (accueil) : la première information de l'application, claire et chiffrée.
import { climateItems } from '../features/climate.js'
import { useI18n } from '../i18n/index.jsx'
import Icon, { HAZARD_ICON, weatherIcon } from './Icon.jsx'

export default function ClimateNow({ weather, flood }) {
  const { t, time } = useI18n()
  if (!weather) return <section className="climate-now climate-now--loading" aria-busy="true"><p className="loading">{t('app.loading')}</p></section>
  const now = weather.now || {}
  const today = weather.days?.[0] || {}
  const items = climateItems(weather, t, 3)
  const air = today.air
  const alert = items.length > 0 || (flood?.level >= 2)
  return (
    <section className={`climate-now${alert ? ' climate-now--alert' : ''}`} aria-labelledby="climate-title">
      <div className="climate-now__head">
        <h2 id="climate-title">{t('climate.now_title')}</h2>
        <small>{t(weather.stale ? 'data.stale' : 'app.updated', { time: time(weather.fetched_at) })}</small>
      </div>

      {/* Conditions de l'heure, en chiffres */}
      <div className="climate-now__main">
        <Icon name={weatherIcon(now.code, new Date().getHours() >= 21 || new Date().getHours() < 7)} size={44} />
        <p className="climate-now__temp">{now.temperature != null ? `${Math.round(now.temperature)} °C` : '—'}</p>
        <ul className="climate-now__facts">
          {now.ressenti != null && <li>{t('climate.felt', { v: Math.round(now.ressenti) })}</li>}
          <li>{t('climate.rain_now', { v: (now.pluie_mm ?? 0).toLocaleString() })}</li>
          {now.rafales_kmh != null && <li>{t('climate.gusts_now', { v: Math.round(now.rafales_kmh) })}</li>}
          {today.tx != null && <li>{t('climate.minmax', { min: Math.round(today.tn), max: Math.round(today.tx) })}</li>}
        </ul>
      </div>

      {/* Aléas : quoi, quand, et la vigilance officielle */}
      {items.length ? (
        <ul className="climate-now__hazards">
          {items.map(({ hazard, when, felt, official }) => (
            <li key={hazard}>
              <Icon name={HAZARD_ICON[hazard] || 'alert'} size={22} />
              <span>
                <strong>{t(`climate.${hazard}`, { when })}{felt != null ? ` (${t('climate.felt', { v: felt })})` : ''}</strong>
                {official && <span className={`vigilance-tag vigilance-tag--${official.color}`}>{t('vigilance.official', { color: t(`flood.${official.color}`) })}</span>}
                <small>{t(`advice.${hazard}`)}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="climate-now__ok"><Icon name="check" size={20} /> {t('climate.none_today')}</p>}

      <ul className="climate-now__lines">
        <li><Icon name="alert" size={16} /> {weather.vigilance_available ? t('climate.vigilance_line', {
          color: t(`flood.${Object.values(today.vigilance || {}).sort((a, b) => b.level - a.level)[0]?.color || 'vert'}`) }) : t('climate.vigilance_off')}</li>
        {flood && <li><Icon name="flood" size={16} /> {flood.level >= 2 ? t('climate.flood_on', { color: t(`flood.${flood.color}`), rivers: flood.watch.map((w) => w.name).join(', ') })
          : t('climate.flood_off')}</li>}
        {air && <li><Icon name="wind" size={16} /> {t('air.title', { level: t(`air.level_${now.air?.level || air.level}`) })}
          {[air.pollution && air.pm2_5 != null && t('air.pm25', { v: Math.round(air.pm2_5) }), air.uv_high && t('air.uv', { v: Math.round(air.uv) }),
            air.pollen_high && t('air.pollen')].filter(Boolean).map((x) => ` · ${x}`)}</li>}
      </ul>
    </section>
  )
}
