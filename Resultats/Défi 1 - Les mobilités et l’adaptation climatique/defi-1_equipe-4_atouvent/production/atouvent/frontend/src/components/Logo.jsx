// Symbole AtouVent (vent et point corail), décoratif : le nom est toujours écrit à côté
export default function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="#FFFFFF" />
      <path d="M13 22.5 H37 a6.5 6.5 0 1 0 -6.5 -6.5" fill="none" stroke="#0F1B2D" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 33 H42" fill="none" stroke="#0F1B2D" strokeWidth="4.6" strokeLinecap="round" />
      <circle cx="48.5" cy="33" r="5.6" fill="#F28B5B" stroke="#FFFFFF" strokeWidth="2" />
      <path d="M17 43.5 H33 a6 6 0 1 1 -6 6" fill="none" stroke="#0F1B2D" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Logo + nom « AtouVent », pour les en-têtes sombres
export function Brand({ size = 40, fontSize = 26 }) {
  return (
    <span className="brand-mark" style={{ fontSize }}>
      <Logo size={size} />
      <span>Atou<b>Vent</b></span>
    </span>
  )
}
