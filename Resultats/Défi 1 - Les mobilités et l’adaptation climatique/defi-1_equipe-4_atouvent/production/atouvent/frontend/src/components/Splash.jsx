// Écran d'ouverture : le logo AtouVent se construit élément par élément (carré, trois traits de vent, point corail), puis le nom apparaît lettre par lettre.
import { useEffect, useState } from 'react'

const NAME = [...'Atou'].map((c) => ({ c, accent: false })).concat([...'Vent'].map((c) => ({ c, accent: true })))
const TOTAL_MS = 2800
const REDUCED_MS = 900

export default function Splash() {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [phase, setPhase] = useState('show')  // show → leave → gone

  useEffect(() => {
    const total = reduced ? REDUCED_MS : TOTAL_MS
    const leave = setTimeout(() => setPhase('leave'), total - 400)
    const gone = setTimeout(() => setPhase('gone'), total)
    const skip = () => setPhase('gone')
    window.addEventListener('keydown', skip, { once: true })
    return () => { clearTimeout(leave); clearTimeout(gone); window.removeEventListener('keydown', skip) }
  }, [reduced])

  if (phase === 'gone') return null
  return (
    <div className={`splash${phase === 'leave' ? ' splash--leave' : ''}${reduced ? ' splash--still' : ''}`} aria-hidden="true"
      onClick={() => setPhase('gone')}>
      <div className="splash__logo">
        <svg viewBox="0 0 64 64" width="96" height="96" focusable="false">
          <rect className="splash__part splash__box" width="64" height="64" rx="16" fill="#FFFFFF" />
          <path className="splash__part splash__stroke splash__stroke--1" pathLength="1" d="M13 22.5 H37 a6.5 6.5 0 1 0 -6.5 -6.5"
            fill="none" stroke="#0F1B2D" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
          <path className="splash__part splash__stroke splash__stroke--2" pathLength="1" d="M9 33 H42"
            fill="none" stroke="#0F1B2D" strokeWidth="4.6" strokeLinecap="round" />
          <circle className="splash__part splash__dot" cx="48.5" cy="33" r="5.6" fill="#F28B5B" stroke="#FFFFFF" strokeWidth="2" />
          <path className="splash__part splash__stroke splash__stroke--3" pathLength="1" d="M17 43.5 H33 a6 6 0 1 1 -6 6"
            fill="none" stroke="#0F1B2D" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="splash__name">
          {NAME.map(({ c, accent }, i) => (
            <span key={i} className={`splash__letter${accent ? ' splash__letter--accent' : ''}`} style={{ '--i': i }}>{c}</span>
          ))}
        </p>
      </div>
    </div>
  )
}
