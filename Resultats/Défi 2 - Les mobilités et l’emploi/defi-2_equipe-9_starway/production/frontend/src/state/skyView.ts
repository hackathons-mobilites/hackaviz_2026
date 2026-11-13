/** Vue dérivée de l'état du ciel : module PUR (sans React ni store), partagé par l'UI, le moteur et la visite. */
import { computePoleStates, computeTotals, type PoleState, type SkyTotals } from '../data/accessibility';
import type { AccessFile, Commune, Dataset, Pole, WalkSetting } from '../data/types';
import { activeWalkSetting } from '../data/walkSettings';
import { isTrafficMode, withCarTraffic } from '../data/congestion';
import { computeOd, type OdResult } from '../data/od/compute';
import { shiftFromDayType } from '../data/od/shift';
import { odPoleStates, odSkyTotals } from '../data/od/sky';
import type { OdShown } from '../store/useOdStore';
import type { Scenario } from './scenario';

/** Table OD du scénario affiché et ciel concerné (A : origine, B : comparaison du diptyque). */
export interface OdViewInput {
  shown: OdShown;
  side: 'A' | 'B';
}

export interface SkyView {
  dataset: Dataset;
  scenario: Scenario;
  origin: Commune | null;
  states: PoleState[];
  totals: SkyTotals;
  /** true si la commune est choisie mais son fichier access/{insee}.json est absent */
  accessMissing: boolean;
  selectedPole: Pole | null;
  selectedState: PoleState | null;
  /** Ciel neutre : aucune commune choisie, ou ciel pas encore révélé (prologue) */
  neutral: boolean;
  /** Réglage de marche en vigueur (D-024, TC seulement : choisi, sinon défaut) ; null pour les autres modes */
  walkSetting: WalkSetting | null;
  /** Réglage choisi hors défaut mais absent du fichier de la commune (« réglage non encore calculé ») */
  walkMissing: boolean;
  /**
   * Base du calcul : `od` = table commune x commune (D-019, horaires libres, astres éclairés selon la
   * part de leurs postes atteinte) ; `access` = astres aux journées-types.
   */
  basis: 'od' | 'access';
  /** Résultat OD de ce ciel (toutes les communes de destination), null en base `access` */
  od: OdResult | null;
}

/** Résultat OD applicable à ce ciel : même commune, même mode, ciel révélé ; null sinon. */
function odResultFor(dataset: Dataset, scenario: Scenario, od: OdViewInput | null | undefined, revealed: boolean): OdResult | null {
  if (!od || !revealed || !scenario.origin) return null;
  const side = od.side === 'A' ? od.shown.a : od.shown.b;
  if (!side || side.insee !== scenario.origin || side.status === 'error' || od.shown.mode !== scenario.mode) return null;
  return computeOd(od.shown.index, side.status === 'ready' ? side.file : null, {
    origin: side.insee,
    start: od.shown.shift.start,
    end: od.shown.shift.end,
    budget: scenario.budget,
    mode: scenario.mode,
    congestion: dataset.meta.car_congestion ?? null,
  });
}

/**
 * Ciel TC commune par commune du MÊME scénario (commune, journée-type, temps de trajet) : référence de l'or (D-056).
 * Le vélo + TC n'est pas dans la table OD, mais le ciel TC que l'application affiche l'est. null si `shown` ne porte
 * pas sur ce scénario ou si le résultat n'est pas calculable : aucun or n'est alors démontré.
 */
export function transitCommuneStates(dataset: Dataset, scenario: Scenario, shown: OdShown | null): PoleState[] | null {
  if (!shown || shown.mode !== 'transit') return null;
  const day = dataset.meta.day_types.find((d) => d.id === scenario.day);
  const shift = day ? shiftFromDayType(shown.bounds, day) : null;
  if (!shift || shift.start !== shown.shift.start || shift.end !== shown.shift.end) return null;
  const result = odResultFor(dataset, { ...scenario, mode: 'transit' }, { shown, side: 'A' }, true);
  return result?.status === 'ok' ? odPoleStates(dataset.poles, result) : null;
}

/** Vue dérivée (pure) de l'état du ciel, partagée par l'UI et le moteur. */
export function buildSkyView(
  dataset: Dataset,
  scenario: Scenario,
  access: Readonly<Record<string, AccessFile | null>>,
  revealed = true,
  od: OdViewInput | null = null,
): SkyView {
  const origin = scenario.origin ? dataset.communes.find((c) => c.insee === scenario.origin) ?? null : null;
  const rawFile = scenario.origin ? access[scenario.origin] : undefined;
  // Voiture avec trafic moyen DiRIF (D-029) : série déduite de `car` pour l'horaire affiché
  const file = isTrafficMode(scenario.mode) ? withCarTraffic(rawFile, dataset.meta, scenario.day, scenario.shift) : rawFile;
  // Réglage de marche D-024 : séries `variants.{key}` hors défaut (TC seulement), même ciel, mêmes pôles
  const walkSetting = activeWalkSetting(dataset.meta, scenario.mode, scenario.walk);
  const walkKey = walkSetting?.key ?? null;
  // Ciel non révélé : mêmes astres, aucune lumière d'accessibilité (états « non calculé »).
  const states = computePoleStates(dataset.poles, origin && revealed ? file : null, scenario.mode, scenario.day, scenario.budget, walkKey);
  const selIndex = scenario.pole ? dataset.poles.findIndex((p) => p.id === scenario.pole) : -1;
  const odResult = origin ? odResultFor(dataset, scenario, od, revealed) : null;
  if (odResult) {
    // Table OD : les astres gardent place et taille ; chacun dit la part de ses postes atteinte
    const odStates = odPoleStates(dataset.poles, odResult);
    return {
      dataset,
      scenario,
      origin,
      states: odStates,
      totals: odSkyTotals(odStates, odResult),
      accessMissing: false,
      selectedPole: selIndex >= 0 ? dataset.poles[selIndex]! : null,
      selectedState: selIndex >= 0 ? odStates[selIndex]! : null,
      neutral: false,
      walkSetting,
      walkMissing: false,
      basis: 'od',
      od: odResult,
    };
  }
  return {
    dataset,
    scenario,
    origin,
    states,
    totals: computeTotals(dataset.poles, states),
    accessMissing: !!origin && file === null,
    selectedPole: selIndex >= 0 ? dataset.poles[selIndex]! : null,
    selectedState: selIndex >= 0 ? states[selIndex]! : null,
    neutral: !origin || !revealed,
    walkSetting,
    walkMissing: !!walkKey && !!file && !!file.modes[scenario.mode] && !file.variants?.[walkKey],
    basis: 'access',
    od: null,
  };
}

