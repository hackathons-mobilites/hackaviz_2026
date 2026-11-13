// Types de lieux affichés sur la carte « Autour de moi » : une seule configuration pour la pastille de la carte, le pictogramme de la liste, le libellé et les informations utiles (chips).

// Onglets : arrêts et Vélib' ont leurs propres sources ; les autres viennent de /places/near?group=…
export const MAP_TABS = [
  { key: 'stops', icon: 'bus' }, { key: 'velib', icon: 'bike' }, { key: 'bike_parking', icon: 'bike' },
  { key: 'fountain', icon: 'drop' }, { key: 'cool', icon: 'tree' }, { key: 'toilets', icon: 'toilets' },
  { key: 'park_ride', icon: 'car' }, { key: 'works', icon: 'alert' },
]
export const PLACE_GROUPS = new Set(['bike_parking', 'fountain', 'cool', 'toilets', 'park_ride', 'works'])

// Catégorie d'un lieu → pictogramme, texte de la pastille, couleur (classe CSS)
export const KIND = {
  metro: { icon: 'train', badge: 'M', tone: 'metro' }, rail: { icon: 'train', badge: 'RER', tone: 'rail' },
  tram: { icon: 'tram', badge: 'T', tone: 'tram' }, bus: { icon: 'bus', badge: 'BUS', tone: 'bus' },
  velib: { icon: 'bike', badge: null, tone: 'velib' },
  fountain: { icon: 'drop', badge: 'EAU', tone: 'water' }, pool: { icon: 'drop', badge: 'EAU', tone: 'water' },
  mist: { icon: 'drop', badge: 'BRUME', tone: 'water' }, green: { icon: 'tree', badge: 'PARC', tone: 'green' },
  museum: { icon: 'heat', badge: 'MUSÉE', tone: 'green' }, library: { icon: 'heat', badge: 'BIBLI', tone: 'green' },
  shade: { icon: 'shelter', badge: 'OMBRE', tone: 'green' }, indoor: { icon: 'shelter', badge: 'FRAIS', tone: 'green' },
  toilets: { icon: 'toilets', badge: 'WC', tone: 'water' }, bike_parking: { icon: 'bike', badge: 'P', tone: 'bus' },
  park_ride: { icon: 'car', badge: 'P+R', tone: 'metro' }, works: { icon: 'alert', badge: '!', tone: 'works' },
}
export const kindOf = (place, tab) => (tab === 'stops' ? place.kind : tab === 'velib' ? 'velib' : place.kind) || 'indoor'

// Informations à afficher sous le nom : [{ key (texte), params, icon, ok }] ; ok = false s'affiche en alerte
export function chipsOf(p, tab) {
  const c = []
  const add = (cond, key, icon, ok = true, params) => { if (cond) c.push({ key, icon, ok, params }) }
  if (tab === 'stops') {
    const i = p.info || {}
    add(i.shelter != null && (p.kind === 'bus' || p.kind === 'tram'), i.shelter ? 'stop.shelter' : 'stop.no_shelter', 'shelter', Boolean(i.shelter))
    add(i.access != null, i.access ? 'stop.access' : 'stop.no_access', 'a11y', Boolean(i.access))
    // Gare ou station sans donnée d'accessibilité : on le dit plutôt que de laisser croire qu'elle est accessible
    add(i.access == null && p.kind !== 'bus', 'stop.access_unknown', 'a11y', false)
    add(i.audio === 1, 'stop.audio', 'sound')
    add(Boolean(i.air), `stop.air_${i.air}`, 'wind', i.air !== 'high')
    add(i.fountain === 1, 'stop.fountain', 'drop')
    return c
  }
  if (tab === 'velib') {
    const tr = p.trend
    add(tr?.emptying, 'map.velib_emptying', 'clock', false)
    add(tr?.filling, 'map.velib_filling', 'clock', false, { n: tr?.docks_30min })
    add(tr && !tr.emptying && !tr.filling, 'map.velib_soon', 'clock', true, { n: tr?.bikes_30min })
    return c
  }
  add(p.pmr, 'map.pmr', 'a11y')
  add(p.open24h, 'map.open24h', 'clock')
  add(p.heatwave, 'map.heatwave', 'heat')
  add(p.night, 'map.night', 'clock')
  add(p.paid === false && p.kind !== 'toilets', 'map.free', 'check')
  add(p.paid === true, 'map.paid', 'alert', false)
  add(p.kind === 'toilets' && p.paid === false, 'map.free', 'check')
  add(p.baby, 'map.baby', 'check')
  add(p.inside, 'map.inside_gates', 'alert', false)
  add(p.secure, 'map.secure', 'check')
  add(p.capacity != null && (p.kind === 'bike_parking' || p.kind === 'park_ride'), 'map.capacity', 'check', true, { n: p.capacity })
  add(p.electric > 0, 'map.electric', 'check', true, { n: p.electric })
  add(p.cargo > 0, 'map.cargo', 'bike', true, { n: p.cargo })
  add(p.repair, 'map.repair', 'check')
  add(p.sidewalk, 'map.sidewalk_closed', 'walk', false)
  return c
}

// Seconde ligne : type de lieu, détail et distance
export function subtitleOf(p, tab, t, date = (d) => d) {
  const m = t('around.meters', { m: p.distance_m })
  if (tab === 'stops') return `${t(`map.kind_${p.kind}`)} ${p.lines.slice(0, 6).join(' · ')} · ${m}`
  if (tab === 'velib') return t('map.velib_state', { bikes: p.bikes ?? '—', ebike: p.ebike ?? 0, docks: p.docks ?? '—', m: p.distance_m })
  const parts = {
    fountain: [t('map.fountain_kind')], toilets: [p.type, p.hours], bike_parking: [p.type, p.price_navigo && p.price_navigo !== 'NC' && t('map.navigo_price', { v: p.price_navigo })],
    park_ride: [p.station && t('map.station', { name: p.station })], works: [p.type, p.detail, p.until && t('map.until', { date: date(p.until) })],
  }[p.kind] || [p.type || t(`map.cool_${p.kind}`), p.city, p.area_ha && t('map.area', { v: p.area_ha.toLocaleString() })]
  return [...parts.filter(Boolean), m].join(' · ')
}
