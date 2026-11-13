// Climat : une seule lecture des aléas pour toute l'application (accueil, itinéraires, suivi).

const hour = (iso) => Number(iso.slice(11, 13))

/** [{ hazard, when, felt, official }] : ce qui arrive, quand, ressenti, et couleur officielle Météo-France si elle existe. */
export function climateItems(weather, t, max = 3, at = null) {
  if (!weather) return []
  const now = at ? new Date(at).getTime() : Date.now()
  const today = new Date().toLocaleDateString('sv-SE')
  const episodes = (weather.hours || []).slice(0, max)
  const vig = weather.days?.[0]?.vigilance || {}
  const daily = (weather.days?.[0]?.aleas || []).filter((h) => !episodes.some((e) => e.hazard === h))
  const when = (e) => {
    if (new Date(e.start).getTime() <= now) return t('climate.until', { h: hour(e.end) + 1 })
    const day = e.start.slice(0, 10)
    if (day === today) return t('climate.at', { h: hour(e.start) })
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('sv-SE')
    if (day === tomorrow) return t('climate.tomorrow_at', { h: hour(e.start) })
    const label = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    return t('climate.on_at', { day: label, h: hour(e.start) })
  }
  return [
    ...episodes.map((e) => ({ hazard: e.hazard, when: when(e), felt: e.felt, official: vig[e.hazard] })),
    ...daily.map((h) => ({ hazard: h, official: vig[h],
      when: vig[h]?.start ? t('climate.from_official', { h: new Date(vig[h].start).getHours() }) : t(at ? 'climate.that_day' : 'climate.today') })),
  ].slice(0, max)
}
