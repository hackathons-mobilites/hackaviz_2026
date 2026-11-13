import type { HaloDimension } from '../data/halo';
import { sanitizeVehicle } from '../data/carCost';
import { isNightShape } from '../data/od/shift';
import { parseClock } from '../data/proof';
import type { DayTypeId, Meta, ModeId } from '../data/types';
import { sanitizeWalk } from '../data/walkSettings';
import { sanitizeBudget } from './budget';

/** Un scénario = l'état complet de l'explorateur, sérialisable dans l'URL. */
export interface Scenario {
  /** Commune d'origine (code INSEE) - l'étoile-guide */
  origin: string | null;
  day: DayTypeId;
  budget: number;
  mode: ModeId;
  /** Commune de comparaison (diptyque, acte 3) */
  compare: string | null;
  /** Pôle sélectionné (panneau de preuve) */
  pole: string | null;
  /** Halo « Derrière notre étoile » ouvert sur une dimension (null = fermé) */
  halo: HaloDimension | null;
  /**
   * Réglage de marche des TC (D-024, `meta.walk_settings.settings[].id`, paramètre d'URL `w`) ;
   * null ou absent = réglage par défaut. Ne joue qu'en TC (`walk_settings.mode`).
   */
  walk?: string | null;
  /**
   * Horaires libres (D-019, URL `s` / `e`) : début et fin du poste en minutes depuis minuit ; null ou
   * absent = les horaires de la journée-type `day`. Une fin AVANT le début est le lendemain matin (poste
   * de nuit, `isNightShape` : début à 21h ou après, fin à 7h au plus tard). Une journée-type reste un raccourci (`d`) : un
   * horaire égal à une journée-type est ramené à elle par `sanitizeScenario`. Ne joue que sur la table
   * OD (modes couverts, `odModeReady`) ; ailleurs, le ciel reste aux journées-types.
   */
  shift?: { start: number; end: number } | null;
  /**
   * Véhicule du coût et du carbone en voiture (D-029, `meta.vehicles[].id`, paramètre d'URL `vh`) ;
   * absent ou null = le premier véhicule publié (voiture essence). Ne change ni le ciel ni les temps.
   */
  vehicle?: string | null;
}

export const DEFAULT_SCENARIO: Scenario = {
  origin: null,
  day: 'd09',
  budget: 45,
  mode: 'transit',
  compare: null,
  pole: null,
  halo: null,
  walk: null,
  shift: null,
};

/** Minutes dans une journée (unité d'horloge, pas une donnée) */
const DAY_MIN = 24 * 60;

/**
 * Horaire libre lisible (entiers, dans la journée, fin après le début), ou null. Les bornes et le pas
 * de la table OD sont vérifiés plus tard, une fois od/index.json chargé (`isValidShift`).
 */
export function sanitizeShift(shift: Scenario['shift'], meta: Pick<Meta, 'day_types'>): { shift: Scenario['shift']; day: DayTypeId | null } {
  if (!shift) return { shift: null, day: null };
  const { start, end } = shift;
  // Fin après le début, ou poste de nuit (fin le lendemain matin, dans la fenêtre légale 21h-7h)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > DAY_MIN || (end <= start && !isNightShape(start, end))) return { shift: null, day: null };
  // Horaire égal à une journée-type : c'est elle (raccourci `d`), l'URL n'écrit pas `s` / `e`
  const same = meta.day_types.find((d) => parseClock(d.start) === start && parseClock(d.end) === end);
  if (same) return { shift: null, day: same.id };
  return { shift: { start, end }, day: null };
}

/**
 * Scénario d'ouverture sans lien partagé : première commune du récit, sinon Montreuil si calculée
 * (cas provisoire, à confirmer avec insights.json), sinon la
 * première commune calculée. Journée 9h-17h, 60 min, TC.
 */
export function openingScenario(meta: Meta): Partial<Scenario> {
  const computed = meta.access_communes ?? [];
  const origin = meta.story_communes[0] ?? (computed.includes('93048') ? '93048' : computed[0]) ?? null;
  return { origin, day: 'd09', budget: meta.budgets.includes(60) ? 60 : meta.budgets.at(-1) ?? 45, mode: 'transit' };
}

/**
 * Ramène un scénario dans les valeurs autorisées par meta.json. Budget : multiple du pas
 * `outbound_step_min` le plus proche, dans [pas, max_trip_min] (D-018) ; ancien jeu : meta.budgets.
 */
export function sanitizeScenario(s: Scenario, meta: Meta, knownInsee: ReadonlySet<string>, knownPoles: ReadonlySet<string>): Scenario {
  const days = meta.day_types.map((d) => d.id);
  const modes = meta.modes.map((m) => m.id);
  const free = sanitizeShift(s.shift, meta);
  const day = free.day ?? s.day;
  return {
    origin: s.origin && knownInsee.has(s.origin) ? s.origin : null,
    day: days.includes(day) ? day : (days.includes('d09') ? 'd09' : days[0] ?? 'd09'),
    budget: sanitizeBudget(s.budget, meta),
    mode: modes.includes(s.mode) ? s.mode : (modes[0] ?? 'transit'),
    compare: s.compare && knownInsee.has(s.compare) ? s.compare : null,
    pole: s.pole && knownPoles.has(s.pole) ? s.pole : null,
    halo: s.origin && knownInsee.has(s.origin) ? s.halo : null,
    walk: sanitizeWalk(s.walk, meta),
    shift: free.shift,
    ...(sanitizeVehicle(s.vehicle, meta) ? { vehicle: sanitizeVehicle(s.vehicle, meta) } : {}),
  };
}

/** Clé d'un horaire libre (« 540-1020 ») ; '' pour une journée-type. */
export function shiftKey(s: Pick<Scenario, 'shift'>): string {
  return s.shift ? `${s.shift.start}-${s.shift.end}` : '';
}
