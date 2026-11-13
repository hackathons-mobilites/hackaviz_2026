import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { budgetFraction, budgetPage, type BudgetScale } from '../state/budget';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { CometHandle } from './CometHandle';
import { InfoTip } from './InfoTip';

/** « 30, 45 et 60 » */
function frenchList(values: readonly number[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} et ${values.at(-1)}`;
}

/**
 * Jauge du temps de trajet par sens (D-018, libellé D-025) : input range natif, pas et bornes lus dans meta.json
 * (`outbound_step_min`, `max_trip_min`), repères = budgets des découvertes (`meta.budgets`).
 *
 * Clavier natif : flèches = un pas, Début / Fin = bornes ; PageUp / PageDown = plus petit écart
 * entre deux repères. Chaque touche joue la transition complète du ciel.
 *
 * Glisser (souris, doigt) : la valeur affichée suit en direct ; le ciel reçoit au plus une mise à
 * jour par `motion.scrubThrottle` en fondu court (`budgetScrub`), sans silence ni écriture d'URL ;
 * la transition complète (silence des pôles perdus depuis le début du geste, puce de variation,
 * URL) joue au relâchement. Un simple clic sur la piste joue directement la transition complète.
 */
export function BudgetRange({ scale, value, labelId }: { scale: BudgetScale; value: number; labelId: string }) {
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const setBudgetScrub = useSkyStore((s) => s.setBudgetScrub);
  const [draft, setDraft] = useState<number | null>(null);
  /** Glisser en cours (souris, doigt) : comète étirée et bulle de valeur (L-05) */
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  /** La valeur a changé depuis le début du geste */
  const moved = useRef(false);
  const pending = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const shown = draft ?? value;

  const commit = useCallback(
    (v: number) => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      pending.current = null;
      dragging.current = false;
      moved.current = false;
      setDrag(false);
      const gen = ++generation.current;
      setDraft(v);
      setBudgetScrub(false);
      void applyScenario({ budget: v }).then(() => {
        if (gen === generation.current && !dragging.current) setDraft(null);
      });
    },
    [applyScenario, setBudgetScrub],
  );

  /** Fin du geste, quel que soit l'événement qui la signale (relâché hors de la jauge compris). */
  const release = useCallback(() => {
    if (!dragging.current) return;
    if (!moved.current) {
      // geste sans changement de valeur (appui, défilement de la feuille) : rien à appliquer
      dragging.current = false;
      setDrag(false);
      return;
    }
    const el = inputRef.current;
    commit(el ? Number(el.value) : value);
  }, [commit, value]);

  // `change` natif (React n'expose que `input`) et relâchement hors de la jauge
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.addEventListener('change', release);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      el.removeEventListener('change', release);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [release]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (useSkyStore.getState().budgetScrub) useSkyStore.getState().setBudgetScrub(false);
    },
    [],
  );

  const flush = () => {
    timer.current = undefined;
    const v = pending.current;
    pending.current = null;
    if (v == null || !dragging.current) return;
    setBudgetScrub(true);
    void applyScenario({ budget: v });
  };

  const onInput = (v: number) => {
    setDraft(v);
    if (!dragging.current) {
      // clavier, technologie d'assistance : un cran = une transition complète
      commit(v);
      return;
    }
    moved.current = true;
    pending.current = v;
    // première mise à jour après un intervalle : un clic bref sur la piste reste une transition complète
    if (timer.current === undefined) timer.current = window.setTimeout(flush, motion.scrubThrottle);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key !== 'PageUp' && e.key !== 'PageDown') || scale.bigStep == null) return;
    e.preventDefault();
    const next = budgetPage(shown, e.key === 'PageUp' ? 1 : -1, scale);
    if (next !== shown) commit(next);
  };

  const p = budgetFraction(shown, scale);
  const grads: number[] = [];
  if (scale.bigStep) {
    for (let g = Math.ceil(scale.min / scale.bigStep) * scale.bigStep; g <= scale.max; g += scale.bigStep) {
      if (!scale.marks.includes(g)) grads.push(g);
    }
  }
  const marksText = budgetMarksText(scale);

  return (
    <div className="budget-control">
      <div className="budget-range" style={{ '--p': p } as CSSProperties}>
        {/* Graduations fines tous les `bigStep` (écart entre repères, dérivé de meta.budgets) : décor de lecture */}
        {grads.length > 0 && (
          <div className="budget-grads" aria-hidden="true">
            {grads.map((g) => (
              <span key={g} style={{ '--t': budgetFraction(g, scale) } as CSSProperties} />
            ))}
          </div>
        )}
        {/* avant l'input : le curseur passe au-dessus des repères */}
        {scale.marks.length > 0 && (
          <div className="budget-ticks" aria-hidden="true">
            {scale.marks.map((b) => (
              <span
                key={b}
                className={b === shown ? 'is-on' : ''}
                style={{ '--t': budgetFraction(b, scale) } as CSSProperties}
              >
                {b}
              </span>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          id="budget-range"
          type="range"
          min={scale.min}
          max={scale.max}
          step={scale.step}
          value={shown}
          aria-labelledby={labelId}
          aria-valuetext={`${shown} minutes ou moins à l’aller, et ${shown} ou moins au retour`}
          aria-describedby={marksText ? 'budget-marks' : undefined}
          onPointerDown={() => {
            dragging.current = true;
            moved.current = false;
            setDrag(true);
          }}
          onChange={(e) => onInput(Number(e.target.value))}
          onKeyDown={onKeyDown}
          onBlur={release}
        />
        <CometHandle value={shown} p={p} dragging={drag} />
      </div>
      <span className="budget-value" aria-hidden="true">
        <b style={{ minWidth: `${String(scale.max).length}ch` }}>{shown}</b> min
      </span>
      {/* Les repères (30, 45, 60) sont sur cette jauge : leur explication est au « i » juste à côté */}
      <BudgetMarksTip scale={scale} />
      {marksText && (
        // lu par le lecteur d'écran avec la jauge ; le même texte est visible au bouton « i » juste au-dessus
        <span id="budget-marks" className="sr-only">
          {marksText}
        </span>
      )}
    </div>
  );
}

/** Texte des repères de la jauge (budgets des découvertes, `meta.budgets`) ; vide sans repère. */
function budgetMarksText(scale: BudgetScale): string {
  return scale.marks.length
    ? `Repère${scale.marks.length > 1 ? 's' : ''} à ${frenchList(scale.marks)} min : temps pour lesquels les découvertes sont calculées.`
    : '';
}

/** Explication des repères de la jauge, au bouton « i » placé à côté de sa valeur (la rubrique « Repères » du tiroir ne portait que ce bouton). */
function BudgetMarksTip({ scale }: { scale: BudgetScale }) {
  const marksText = budgetMarksText(scale);
  if (!marksText) return null;
  return (
    <InfoTip label="Que signifient les repères de la jauge ?" placement="top" className="budget-info">
      {marksText} La jauge va de {scale.min} à {scale.max} min par sens, par pas de {scale.step} min (pas de la grille des départs du calcul).
    </InfoTip>
  );
}
