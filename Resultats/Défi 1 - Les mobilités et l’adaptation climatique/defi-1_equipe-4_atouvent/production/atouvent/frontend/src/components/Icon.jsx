// Pictogrammes SVG (décoratifs : le sens est toujours donné par un texte à côté)
const PATHS = {
  around: <><circle cx="12" cy="10" r="3" /><path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z" /></>,
  trip: <><path d="M5 19c4-8 10-6 14-14" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /></>,
  account: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  a11y: <><circle cx="12" cy="4" r="2" /><path d="M12 7v6h5l2 6M12 13l-3 7M8 10h8" /></>,
  back: <path d="M15 6l-6 6 6 6" />,
  locate: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5m0 3h.01" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  offline: <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />,
  pin: <><path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  bike: <><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16l4-7h5l3 7M10 9l2 7" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  chart: <path d="M4 20V10m6 10V4m6 16v-8m6 8H2" />,
  storm: <><path d="M6 14a4 4 0 0 1 .6-7.95A5.5 5.5 0 0 1 17.3 7.5 3.5 3.5 0 0 1 17 14" /><path d="M12.5 12l-2 4h3l-2 4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></>,
  snow: <><path d="M6 14a4 4 0 0 1 .6-7.95A5.5 5.5 0 0 1 17.3 7.5 3.5 3.5 0 0 1 17 14" /><path d="M8 18h.01M12 20h.01M16 18h.01M10 22.5h.01M14 22.5h.01" /></>,
  wind: <><path d="M3 8h10a3 3 0 1 0-3-3" /><path d="M3 12h16" /><path d="M3 16h9a3 3 0 1 1-3 3" /></>,
  cold: <><path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17" /><path d="M9 3.5l3 2 3-2M9 20.5l3-2 3 2" /></>,
  elevator: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 9.5l3-3 3 3M9 14.5l3 3 3-3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  drop: <path d="M12 3s-6 6.5-6 11a6 6 0 0 0 12 0c0-4.5-6-11-6-11z" />,
  tree: <><path d="M12 22v-5" /><path d="M12 3l-6 8h3l-4 6h14l-4-6h3z" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  sound: <><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  shelter: <path d="M3 9l9-6 9 6M5 9v12M19 9v12" />,
  train: <><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4" /><path d="M9 14h.01M15 14h.01" /></>,
  bus: <><rect x="4" y="3" width="16" height="14" rx="2" /><path d="M4 10h16M7 21v-4M17 21v-4" /><path d="M8 14h.01M16 14h.01" /></>,
  tram: <><rect x="6" y="6" width="12" height="11" rx="2" /><path d="M9 2h6M12 2v4M6 12h12M8 21l1.5-4M16 21l-1.5-4" /></>,
  walk: <><circle cx="13" cy="4" r="2" /><path d="M10 21l2.5-6.5L15 17v4M9 11l3-3 3 2.5 3 1M12 8l-1 6.5" /></>,
  heat: <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />,
  rain: <><path d="M6 14a4 4 0 0 1 .6-7.95A5.5 5.5 0 0 1 17.3 7.5 3.5 3.5 0 0 1 17 14" /><path d="M8 17l-1 4M12 17l-1 4M16 17l-1 4" /></>,
  flood: <><path d="M2 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /><path d="M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0" /><path d="M12 3v6M9 6l3-3 3 3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  map: <><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></>,
  toilets: <><circle cx="7" cy="4" r="1.6" /><circle cx="17" cy="4" r="1.6" /><path d="M5 8h4v6H8v7H6v-7H5zM15 8h4l1.5 7h-2v6h-3v-6h-2z" /><path d="M12 3v18" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  cloud: <path d="M6 18a4 4 0 0 1 .6-7.95A5.5 5.5 0 0 1 17.3 11.5 3.5 3.5 0 0 1 17 18z" />,
  fog: <path d="M4 9h16M2 13h20M4 17h16M7 21h10" />,
  leaf: <><path d="M5 19c0-9 6-14 15-15-1 9-6 15-15 15z" /><path d="M5 19l7-7" /></>,
  car: <><path d="M5 17h14v-5l-2-5H7l-2 5z" /><circle cx="8" cy="17" r="2" /><circle cx="16" cy="17" r="2" /></>,
}

// Pictogrammes de la charte AtouVent (06_Figma/Charte_07_Pictogrammes) : un par aléa, toujours avec son nom Temps du jour (code WMO) → pictogramme
export const weatherIcon = (code, night = false) => (code == null ? 'cloud' : code <= 1 ? (night ? 'moon' : 'sun') : code <= 3 ? 'cloud' : code <= 48 ? 'fog'
  : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : code >= 95 ? 'storm' : 'rain')

export const HAZARD_ICON = { chaleur: 'heat', grand_froid: 'cold', neige_verglas: 'snow', orages_pluie: 'rain', orages: 'storm', vent_fort: 'wind', ascenseur: 'elevator', crue: 'flood', pollution: 'alert', accidents: 'car' }

export default function Icon({ name, size = 22, strokeWidth = 2.2, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {PATHS[name]}
    </svg>
  )
}
