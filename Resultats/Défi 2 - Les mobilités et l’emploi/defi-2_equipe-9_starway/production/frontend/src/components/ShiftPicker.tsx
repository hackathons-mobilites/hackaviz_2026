import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { formatClock } from '../data/proof';
import { changeShift, endsNextDay, formatShift, isValidNightShift, isValidShift, setNightShift, shiftLengthText, type Shift, type ShiftBounds } from '../data/od/shift';
import { InfoTip } from './InfoTip';
import './shiftPicker.css';

export interface ShiftPickerProps {
  /** Bornes lues dans od/index.json (`shiftBounds`) */
  bounds: ShiftBounds;
  value: Shift;
  /** `adjusted` : l'autre borne a été poussée pour garder la fin après le début */
  onChange: (next: Shift, adjusted: 'start' | 'end' | null) => void;
  /** Horaires de la journée-type affichée : retrouvés en décochant « Poste de nuit » */
  dayShift?: Shift | null;
  disabled?: boolean;
  /** Début d'un glisser (souris, doigt) sur l'une des deux jauges : l'appelant limite les mises à jour du ciel */
  onScrubStart?: () => void;
  /** id du premier champ (focus à l'ouverture d'un panneau) */
  firstId?: string;
}

/** Minutes par heure : PageUp / PageDown déplacent d'une heure (unité d'horloge, pas une donnée). */
const HOUR = 60;

function fraction(v: number, min: number, max: number): number {
  return max > min ? (v - min) / (max - min) : 0;
}

/**
 * Choix libre de l'heure de début et de fin du poste (D-019) : monté dans la barre par ShiftControl.
 *
 * Deux jauges natives (input range), bornes et pas lus dans od/index.json : clavier natif (flèches =
 * un pas de la grille, Début / Fin = bornes), PageUp / PageDown = une heure. La fin reste toujours
 * après le début : si un choix casse la règle, l'autre borne est poussée d'un pas et c'est annoncé
 * (texte visible et région live polie).
 *
 * Case « Poste de nuit » (si la table le permet, `bounds.night`) : la fin est le lendemain matin. Les
 * deux jauges prennent alors les bornes de nuit (début à 21h ou après, fin à 7h au plus tard) ; le
 * retour du matin est lu dans les horaires du même mardi type, et le texte du champ le dit.
 */
export function ShiftPicker({ bounds, value, onChange, dayShift = null, disabled = false, onScrubStart, firstId }: ShiftPickerProps) {
  const autoId = useId();
  const id = firstId ?? autoId;
  const [notice, setNotice] = useState('');
  const night = endsNextDay(value) && !!bounds.night;

  const apply = (change: { start: number } | { end: number }) => {
    const r = changeShift(bounds, value, change);
    if (r.shift.start === value.start && r.shift.end === value.end) return;
    setNotice(
      r.adjusted === 'end'
        ? `Fin du poste déplacée à ${formatClock(r.shift.end)} pour rester après le début.`
        : r.adjusted === 'start'
          ? `Début du poste déplacé à ${formatClock(r.shift.start)} pour rester avant la fin.`
          : '',
    );
    onChange(r.shift, r.adjusted);
  };

  const toggleNight = (on: boolean) => {
    const next = setNightShift(bounds, value, on, dayShift);
    if (!next) return;
    setNotice(
      on
        ? `Poste de nuit : début ${formatClock(next.start)}, fin ${formatClock(next.end)} le lendemain matin. Le retour est lu dans les horaires du même mardi type.`
        : `Poste du jour : ${formatShift(next)}.`,
    );
    onChange(next, null);
  };

  const pageKeys = (which: 'start' | 'end') => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
    e.preventDefault();
    const delta = e.key === 'PageUp' ? HOUR : -HOUR;
    apply(which === 'start' ? { start: value.start + delta } : { end: value.end + delta });
  };

  const rows = [
    {
      which: 'start' as const,
      label: 'Début du poste',
      hint: 'L’aller arrive avant cette heure.',
      v: value.start,
      min: night ? bounds.night!.startMin : bounds.startMin,
      max: night ? bounds.night!.startMax : bounds.startMax,
      valueText: `${formatClock(value.start)}, l’aller arrive avant cette heure`,
    },
    {
      which: 'end' as const,
      label: night ? 'Fin du poste, le lendemain' : 'Fin du poste',
      hint: night ? 'Le retour est compté à partir de cette heure, le lendemain matin, attente comprise (horaires du même mardi type).' : 'Le retour est compté à partir de cette heure, attente comprise.',
      v: value.end,
      min: night ? bounds.night!.endMin : bounds.endMin,
      max: night ? bounds.night!.endMax : bounds.endMax,
      valueText: night
        ? `${formatClock(value.end)}, le lendemain matin, le retour est compté à partir de cette heure`
        : `${formatClock(value.end)}, le retour est compté à partir de cette heure`,
    },
  ];

  return (
    <fieldset className="shift-picker" disabled={disabled}>
      <legend className="shift-legend">
        Horaires du poste <span className="shift-summary">{formatShift(value)}</span>{' '}
        <span className="shift-length">({shiftLengthText(value)}{night ? ', fin le lendemain matin' : ''})</span>
      </legend>
      {bounds.night && (
        <div className="shift-night-line">
          <label className="shift-night">
            <input type="checkbox" checked={night} onChange={(e) => toggleNight(e.target.checked)} aria-describedby={`${id}-night-hint`} />
            <span>Poste de nuit</span>
          </label>
          {/* Demande de Nicolas (10/11) : libellé court, l'explication et ses exemples au « i » ; le lecteur d'écran lit les bornes avec la case */}
          <InfoTip label="Que veut dire « Poste de nuit » ?" placement="top" className="shift-night-info">
            <NightHelp bounds={bounds} />
          </InfoTip>
          <span id={`${id}-night-hint`} className="sr-only">
            Fin le lendemain matin. Début à partir de {formatClock(bounds.night.startMin)}, fin au plus tard à {formatClock(bounds.night.endMax)}.
          </span>
        </div>
      )}
      {rows.map((r) => (
        <div className="shift-row" key={r.which}>
          <label className="shift-label" htmlFor={`${id}-${r.which}`}>
            {r.label}
          </label>
          <div className="shift-range" style={{ '--p': fraction(r.v, r.min, r.max) } as CSSProperties}>
            <input
              id={`${id}-${r.which}`}
              type="range"
              min={r.min}
              max={r.max}
              step={bounds.step}
              value={r.v}
              aria-valuetext={r.valueText}
              aria-describedby={`${id}-${r.which}-hint`}
              onPointerDown={onScrubStart}
              onChange={(e) => apply(r.which === 'start' ? { start: Number(e.target.value) } : { end: Number(e.target.value) })}
              onKeyDown={pageKeys(r.which)}
            />
          </div>
          <output className="shift-value" htmlFor={`${id}-${r.which}`} aria-hidden="true">
            {formatClock(r.v)}
          </output>
          <span id={`${id}-${r.which}-hint`} className="shift-hint">
            {r.hint}
          </span>
        </div>
      ))}
      <p className="shift-notice" role="status" aria-live="polite">
        {notice}
      </p>
    </fieldset>
  );
}

/**
 * Exemples du « i » de la case « Poste de nuit » : des horaires d'illustration (pas des données), chacun affiché seulement
 * si les jauges le proposent vraiment (`isValidNightShift`, `isValidShift` sur les bornes lues dans od/index.json).
 */
const NIGHT_EXAMPLE: Shift = { start: 22 * HOUR, end: 6 * HOUR };
const SAME_DAY_EXAMPLES: Shift[] = [
  { start: 14 * HOUR, end: 22 * HOUR },
  { start: 15 * HOUR, end: 23 * HOUR },
];
const EARLY_EXAMPLE: Shift = { start: 5 * HOUR, end: 13 * HOUR };

/** Contenu du « i » : la règle (isNightShape, bornes de nuit publiées, Code du travail L3122-2), un cas à cocher, un cas à ne pas cocher. */
function NightHelp({ bounds }: { bounds: ShiftBounds }) {
  const n = bounds.night!;
  const sameDay = SAME_DAY_EXAMPLES.filter((s) => isValidShift(bounds, s)).map(formatShift);
  const early = isValidShift(bounds, EARLY_EXAMPLE) ? formatShift(EARLY_EXAMPLE) : null;
  const notCases = [
    sameDay.length ? `vous finissez le jour même, par exemple ${sameDay.join(' ou ')}` : null,
    early ? `vous commencez tôt le matin, par exemple ${early}` : null,
  ].filter((x): x is string => !!x);
  return (
    <>
      <span className="shift-tip-line">
        Cochée, la case dit que le poste finit le lendemain matin : début à partir de {formatClock(n.startMin)}, fin au plus tard à{' '}
        {formatClock(n.endMax)}, dans la fenêtre légale du travail de nuit (Code du travail, article L3122-2).
      </span>
      {isValidNightShift(bounds, NIGHT_EXAMPLE) && (
        <span className="shift-tip-line">
          À cocher : vous commencez à {formatClock(NIGHT_EXAMPLE.start)} et finissez à {formatClock(NIGHT_EXAMPLE.end)} le lendemain matin.
        </span>
      )}
      {notCases.length > 0 && <span className="shift-tip-line">À ne pas cocher : {notCases.join(', ou ')}.</span>}
      <span className="shift-tip-line">Le retour du matin est lu dans les horaires du même mardi type.</span>
    </>
  );
}
