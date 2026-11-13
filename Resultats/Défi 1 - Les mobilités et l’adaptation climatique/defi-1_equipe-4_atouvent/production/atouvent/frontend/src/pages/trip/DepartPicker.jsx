// « Quand partir ? » : maintenant, ou à une date et une heure choisies (trajet à venir, jusqu'à 30 jours).
import Icon, { weatherIcon } from '../../components/Icon.jsx'

const MAX_DAYS = 30
const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Heure par défaut d'un départ « plus tard » : dans une heure, arrondie au quart d'heure. */
function soon() {
  const d = new Date(Date.now() + 60 * 60_000)
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
  return d
}

export default function DepartPicker({ value, onChange, planned, t }) {
  const at = value ? new Date(value) : null
  const today = new Date()
  const max = new Date(Date.now() + MAX_DAYS * 86_400_000)
  const set = (date, time) => {
    const d = new Date(`${date}T${time}`)
    if (!Number.isNaN(d.getTime())) onChange(d.toISOString())
  }
  return (
    <fieldset className="depart">
      <legend className="depart__legend">{t('depart.title')}</legend>
      <div className="segmented" role="group" aria-label={t('depart.title')}>
        <button type="button" aria-pressed={!at} onClick={() => onChange(null)}>{t('depart.now')}</button>
        <button type="button" aria-pressed={Boolean(at)} onClick={() => !at && onChange(soon().toISOString())}>{t('depart.later')}</button>
      </div>
      {at && (
        <>
          <div className="depart__fields">
            <label className="field">
              <span>{t('depart.date')}</span>
              <input className="input" type="date" value={localDate(at)} min={localDate(today)} max={localDate(max)}
                onChange={(e) => set(e.target.value, localTime(at))} />
            </label>
            <label className="field">
              <span>{t('depart.time')}</span>
              <input className="input" type="time" step="300" value={localTime(at)} onChange={(e) => set(localDate(at), e.target.value)} />
            </label>
          </div>
          {/* Météo prévue au départ, toujours en texte (le pictogramme accompagne, il ne remplace pas) */}
          <p className="depart__weather" role="status">
            {planned === undefined ? t('app.loading')
              : planned ? (
                <>
                  <Icon name={weatherIcon(planned.code, at.getHours() >= 21 || at.getHours() < 7)} size={22} />
                  <span>{t('depart.weather', {
                    t: Math.round(planned.temperature), felt: Math.round(planned.ressenti),
                    rain: (planned.pluie_mm ?? 0).toLocaleString(), gust: Math.round(planned.rafales_kmh ?? 0),
                  })}</span>
                </>
              ) : <span>{t('depart.no_forecast')}</span>}
          </p>
        </>
      )}
    </fieldset>
  )
}
