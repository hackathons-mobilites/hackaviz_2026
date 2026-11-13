import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatInt } from '../data/format';
import { endsNextDay, formatShift, shiftFromDayType, type Shift } from '../data/od/shift';
import type { DayTypeId } from '../data/types';
import { InfoTip } from './InfoTip';
import { freeShiftState } from '../state/freeShift';
import type { SkyView } from '../state/skyView';
import { useOdStore } from '../store/useOdStore';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { ShiftPicker } from './ShiftPicker';
import { WorkTimeTip } from './territoire/WorkTime';

/**
 * Journées-types de la barre compacte (D-019, D-049) : le segment des raccourcis (6h-14h, 9h-17h, 14h-22h). Quand des horaires
 * libres sont choisis, ils ont leur pastille dans le segment (horloge, début-fin) : la barre dit toujours quels
 * horaires sont joués, sans seconde ligne. Les horaires libres se règlent dans le tiroir (`ShiftFree`).
 */
export function ShiftDay({ view }: { view: SkyView }) {
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const { meta } = view.dataset;
  const sc = view.scenario;
  const free = !!sc.shift;
  const pickDay = (id: DayTypeId) => void applyScenario({ day: id, shift: null });
  return (
    <div className="bar-group bar-day">
      <div className="day-row">
        <fieldset className="day-field">
          <legend className="field-label">Journée-type</legend>
          <div className="seg">
            {meta.day_types.map((d) => {
              const on = !free && sc.day === d.id;
              return (
                <label key={d.id} className={on ? 'is-on' : ''}>
                  <input type="radio" name="day" value={d.id} checked={on} onChange={() => pickDay(d.id as DayTypeId)} />
                  <span>{d.label}</span>
                </label>
              );
            })}
            {free && (
              <span className="seg-free" role="group" aria-label="Horaires libres choisis">
                <svg className="shift-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="free-prefix">Horaires libres :</span>{' '}
                {formatShift(sc.shift!)}
                {endsNextDay(sc.shift!) && <span className="free-prefix">, fin le lendemain matin</span>}
              </span>
            )}
          </div>
        </fieldset>
        {/* Repère de territoire (D-048, T2) : pourquoi ces journées-types, part des salariés du soir et de la nuit (national) */}
        <WorkTimeTip />
      </div>
    </div>
  );
}

/**
 * Horaires du poste, partie libre (D-019), dans le tiroir de la barre : la pastille ouvre les horaires libres
 * (« Début du poste » / « Fin du poste »), ou le texte dit pourquoi ils ne sont pas proposés (« horaires libres :
 * transports en commun seulement pour l'instant »). Le réglage s'ouvre sous la pastille, dans le tiroir : la hauteur
 * de la barre ne change pas.
 *
 * Glisser (souris, doigt) : au plus une mise à jour du ciel par `motion.scrubThrottle`, en fondu court
 * (même règle que la jauge du temps), URL et transition complète au relâchement. Clavier : un cran =
 * une transition complète.
 */
export function ShiftFree({ view }: { view: SkyView }) {
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const setScrub = useSkyStore((s) => s.setBudgetScrub);
  const current = useOdStore((s) => s.current);
  const off = useOdStore((s) => s.off);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Shift | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const firstId = useId();
  const dragging = useRef(false);
  const moved = useRef(false);
  const pending = useRef<Shift | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);

  const { meta } = view.dataset;
  const sc = view.scenario;
  const bounds = current?.bounds ?? null;
  const dayType = meta.day_types.find((d) => d.id === sc.day);
  const base = sc.shift ?? (bounds && dayType ? shiftFromDayType(bounds, dayType) : null);
  const value = draft ?? base;
  const state = freeShiftState({ off, index: current?.index ?? null, hasBounds: !!bounds, mode: sc.mode });
  const free = !!sc.shift;
  /** Panneau montré seulement tant que les horaires libres sont proposés (mode changé : il se ferme) */
  const isOpen = open && state.enabled;

  const commit = useCallback(
    (v: Shift) => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      pending.current = null;
      dragging.current = false;
      moved.current = false;
      const gen = ++generation.current;
      setDraft(v);
      setScrub(false);
      void applyScenario({ shift: v }).then(() => {
        if (gen === generation.current && !dragging.current) setDraft(null);
      });
    },
    [applyScenario, setScrub],
  );

  const release = useCallback(() => {
    if (!dragging.current) return;
    // appui sans changement de valeur : rien à appliquer
    if (!moved.current || !pending.current) {
      dragging.current = false;
      return;
    }
    commit(pending.current);
  }, [commit]);

  useEffect(() => {
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
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

  // Panneau : Échap ou clic ailleurs le referme, le focus revient au bouton
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.setTimeout(() => document.getElementById(`${firstId}-start`)?.focus(), 0);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [isOpen, firstId]);


  const flush = () => {
    timer.current = undefined;
    const v = pending.current;
    if (!v || !dragging.current) return;
    setScrub(true);
    void applyScenario({ shift: v });
  };

  const onChange = (next: Shift) => {
    setDraft(next);
    if (!dragging.current) {
      commit(next);
      return;
    }
    moved.current = true;
    pending.current = next;
    if (timer.current === undefined) timer.current = window.setTimeout(flush, motion.scrubThrottle);
  };

  return (
    <div
      ref={wrap}
      className="shift-free"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && isOpen) {
          e.stopPropagation();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <span className="shift-line">
        {state.enabled && value ? (
          <button
            ref={toggle}
            type="button"
            className={`link-btn shift-toggle ${free ? 'is-free' : ''}`}
            aria-expanded={isOpen}
            aria-controls={panelId}
            onClick={() => setOpen(!isOpen)}
          >
            <svg className="shift-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{free ? `Horaires libres : ${formatShift(sc.shift!)}` : 'Horaires libres…'}</span>
            {free && endsNextDay(sc.shift!) && <span className="sr-only">, fin le lendemain matin</span>}
          </button>
        ) : (
          state.note && (
            <span className="mode-hint shift-note" role="note">
              {state.note}
            </span>
          )
        )}
        {state.enabled && state.note && <span className="sr-only">{state.note}</span>}
      </span>
      {isOpen && bounds && value && (
        <div id={panelId} className="shift-pop" role="group" aria-label="Horaires libres">
          <ShiftPicker
            bounds={bounds}
            value={value}
            firstId={firstId}
            dayShift={dayType && bounds ? shiftFromDayType(bounds, dayType) : null}
            onChange={(next) => onChange(next)}
            onScrubStart={() => {
              dragging.current = true;
              moved.current = false;
            }}
          />
          {/* Demande de Nicolas (10/11) : la note des destinations est rangée dans le « i », mots inchangés ; l'avertissement sur le calcul reste visible */}
          <InfoTip label="Destinations des horaires libres" placement="top" className="shift-pop-tip">
            Destinations : les {formatInt(current?.index?.communes.length ?? 0)} communes et arrondissements d'Île-de-France. Les journées-types restent des
            raccourcis.
          </InfoTip>
          {state.note && <p className="shift-pop-note">{`${state.note.charAt(0).toUpperCase()}${state.note.slice(1)}.`}</p>}
          <button type="button" className="btn shift-pop-close" onClick={() => {
              setOpen(false);
              toggle.current?.focus();
            }}>
            Fermer
          </button>
        </div>
      )}
    </div>
  );
}
