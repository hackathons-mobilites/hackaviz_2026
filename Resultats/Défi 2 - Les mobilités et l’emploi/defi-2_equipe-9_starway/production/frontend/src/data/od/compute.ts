/**
 * Calcul D-019 côté front : fonctions PURES (sans DOM, React ni PixiJS).
 *
 * Pour (origine, début S, fin E, budget B, mode) : état de chaque commune de destination, puis part
 * de chaque pôle = postes atteints de ses communes / `index.poles[p].jobs`.
 * Règle de vérité : accessible = aller ET retour mesurés, chacun <= B. Destination absente du
 * fichier = aucun trajet (sauf retour vers une commune non calculée en export partiel).
 */
import type { CarCongestionMeta, ModeId, Pole } from '../types';
import { parseClock } from '../proof';
import { TRAFFIC_BASE_MODE, TRAFFIC_MODE, trafficLeg } from '../congestion';
import { inboundAt, outboundAt, scalarLeg, SWOD_VERSIONS, type OdLeg, type OdReason, type SwodFile, type SwodSection } from './swod';
import { isNightShape } from './shift';
import type { OdIndex, OdModeDef } from './types';

/**
 * État d'une commune de destination.
 * - accessible : aller ET retour mesurés, chacun <= B
 * - out_only   : aller <= B, retour mesuré au-delà de B ou aucun retour trouvé
 * - none       : aller au-delà de B ou aucun aller trouvé (le retour n'y change rien)
 * - unknown    : verdict impossible, faute de mesure (aller non calculé, ou aller dans le budget
 *                et retour non calculé / point non raccordé)
 * - self       : commune d'origine, trajet non mesuré (voir `selfPairState`)
 */
export type OdDestStatus = 'accessible' | 'out_only' | 'none' | 'unknown' | 'self';

export interface OdDestState {
  /** Index dans index.communes */
  dest: number;
  insee: string;
  status: OdDestStatus;
  out: OdLeg;
  ret: OdLeg;
  /** Postes salariés (INSEE) de la commune (index.jobs) */
  jobs: number;
  /** Index du pôle (ordre de poles.json), null hors pôle */
  pole: number | null;
  /** La destination a un enregistrement dans le fichier (sinon : aucun trajet, ou non calculé) */
  record: boolean;
}

/** Raisons qui empêchent de conclure (pas de mesure), par opposition à « aucun trajet trouvé ». */
const NOT_MEASURED: ReadonlySet<OdReason> = new Set<OdReason>(['not_computed', 'origin_not_snapped']);

/** Verdict d'un couple aller / retour pour un budget par sens. */
export function destStatus(out: OdLeg, ret: OdLeg, budget: number): Exclude<OdDestStatus, 'self'> {
  if (out.minutes == null) return out.reason && NOT_MEASURED.has(out.reason) ? 'unknown' : 'none';
  if (out.minutes > budget) return 'none';
  if (ret.minutes == null) return ret.reason && NOT_MEASURED.has(ret.reason) ? 'unknown' : 'out_only';
  return ret.minutes <= budget ? 'accessible' : 'out_only';
}

/**
 * RÈGLE PROPOSÉE, EN ATTENTE DE VALIDATION PAR NICOLAS (index.self_pair, D-019) : la commune
 * d'origine n'a pas d'enregistrement (r5py rend 0 min entre deux points identiques, ce n'est pas un
 * trajet). Ses postes ne sont comptés ni atteints, ni non atteints : « postes de votre commune : N,
 * trajet non mesuré ». C'est la SEULE fonction à changer si la règle change.
 * Si un futur jeu publie un enregistrement pour ce couple, il est utilisé tel quel (cette fonction
 * n'est alors pas appelée).
 */
export function selfPairState(): Pick<OdDestState, 'status' | 'out' | 'ret'> {
  return { status: 'self', out: { minutes: null, reason: null, dep: null }, ret: { minutes: null, reason: null } };
}

export type OdScenarioStatus =
  /** Calcul fait */
  | 'ok'
  /** Origine sans fichier (pas dans index.files) : « non calculé pour cette commune », ciel neutre */
  | 'origin_not_computed'
  /** Mode absent de la table OD (vélo + TC : servi par access/) */
  | 'mode_not_in_od'
  /**
   * Mode annoncé mais incomplet (`coverage[mode].complete` faux) : jamais rendu par `computeOd`
   * (qui sait lire un mode partiel), c'est la décision de l'application (`odModeReady`).
   */
  | 'mode_not_ready'
  /** Mode de la table, mais pas de section pour cette origine */
  | 'mode_not_computed'
  /** Début ou fin hors bornes / hors grille, ou E <= S hors poste de nuit (fin le lendemain matin) */
  | 'invalid_shift';

export interface OdScenario {
  origin: string;
  /** Début du poste, minutes depuis minuit (ignoré par les modes sans horaire) */
  start: number;
  /** Fin du poste, minutes depuis minuit (ignorée par les modes sans horaire) */
  end: number;
  /** Temps de trajet maximal par sens (min) */
  budget: number;
  mode: ModeId;
  /**
   * Indices DiRIF (D-029, `meta.car_congestion`) : utilisés seulement par le mode `car_traffic`, qui lit
   * la section `car` de la table et multiplie chaque sens par l'indice de sa tranche (data/congestion.ts).
   */
  congestion?: CarCongestionMeta | null;
}

export interface OdPoleShare {
  index: number;
  id: string;
  /** Postes du pôle (index.poles[p].jobs) : taille de l'astre (aire), identique dans tous les scénarios */
  jobs: number;
  /**
   * Postes du pôle dont le trajet est mesuré : `jobs` moins ceux de la commune de départ (trajet non
   * mesuré, elle sort du total). Dénominateur de la part ; `jobs` reste la taille de l'astre.
   */
  measurable: number;
  /** Postes des communes du pôle atteintes aller ET retour */
  reached: number;
  /** Postes des communes mesurées et non atteintes (none, out_only) */
  notReached: number;
  /** dont : postes atteints à l'aller dans le budget, retour hors budget ou aucun retour trouvé */
  outOnly: number;
  /** Postes des communes sans verdict (non calculé, point non raccordé) */
  unknown: number;
  /** Postes de la commune d'origine si elle est dans le pôle (trajet non mesuré) */
  self: number;
  /** reached / measurable (postes de la commune de départ exclus) ; null si le pôle n'a aucun poste mesurable */
  share: number | null;
  /** Communes du pôle (ordre de index.communes) */
  communes: OdDestState[];
}

export interface OdTotals {
  /** Postes atteints dans les pôles */
  reachedInPoles: number;
  /** Postes atteints dans toute l'Île-de-France (toutes les destinations), hors commune d'origine */
  reachedAll: number;
  /** Postes de tous les pôles */
  polesJobs: number;
  /** Postes de toute l'Île-de-France (somme de index.jobs), commune de départ comprise */
  allJobs: number;
  /**
   * Postes dont le trajet est mesuré : `allJobs` moins ceux de la commune de départ. Dénominateur de
   * « Part = Atteints / Postes » (décision de Nicolas du 05/11, point 4.1 : la commune de départ sort du total).
   */
  measurableJobs: number;
  /** Postes de la commune d'origine (trajet non mesuré) */
  selfJobs: number;
  /** Communes de destination dont le trajet est mesuré (toutes sauf la commune de départ) */
  measurableCommunes: number;
  /** Postes sans verdict (non calculé), toutes destinations */
  unknownJobs: number;
  /** Destinations atteintes aller ET retour (communes) */
  reachedCommunes: number;
}

export interface OdResult {
  status: OdScenarioStatus;
  scenario: OdScenario;
  /** Mode dépendant de l'heure (TC) ; false pour marche, vélo, voiture (S et E sans effet) */
  timeDependent: boolean;
  /** Index de l'origine dans index.communes (-1 si inconnue) */
  originIndex: number;
  /** Une entrée par commune de index.communes (vide si status !== 'ok') */
  dests: OdDestState[];
  /** Une entrée par pôle de index.poles (vide si status !== 'ok') */
  poles: OdPoleShare[];
  totals: OdTotals | null;
}

/** L'origine a-t-elle un fichier (index.files) ? */
export function originHasFile(index: Pick<OdIndex, 'files'>, insee: string): boolean {
  return index.files === 'all' || index.files.includes(insee);
}

/** Mode lu dans la table : `car_traffic` (D-029) lit la section `car` (même temps route vide). */
export function odTableMode(mode: ModeId | string): string {
  return mode === TRAFFIC_MODE ? TRAFFIC_BASE_MODE : mode;
}

export function odModeDef(index: Pick<OdIndex, 'modes'>, mode: ModeId): OdModeDef | null {
  const id = odTableMode(mode);
  return index.modes.find((m) => m.id === id) ?? null;
}

/**
 * Le mode peut-il servir les horaires libres dans l'application ? Il faut une section dans les
 * fichiers (`index.modes`) ET une couverture complète du mode (`coverage[mode].complete`, jamais
 * `index.complete`). Rien n'est écrit en dur : un mode exporté plus tard (marche, vélo, voiture)
 * s'active seul quand le pipeline publie sa couverture complète.
 */
export function odModeReady(index: Pick<OdIndex, 'modes' | 'coverage'>, mode: ModeId | string): boolean {
  const id = odTableMode(mode);
  if (!index.modes.some((m) => m.id === id)) return false;
  return index.coverage?.[id as keyof OdIndex['coverage']]?.complete === true;
}

/**
 * Le retour vers `insee` est-il calculé pour ce mode ? Faux en export partiel quand la commune de
 * destination n'est pas dans `coverage[mode].computed` (son lot n'est pas encore calculé).
 */
export function returnComputed(index: Pick<OdIndex, 'coverage' | 'complete'>, mode: string, insee: string): boolean {
  const cov = index.coverage[mode as keyof OdIndex['coverage']];
  // Sans couverture lisible, on ne suppose rien : calculé seulement si l'export entier est complet
  if (!cov) return index.complete === true;
  if (cov.complete) return true;
  if (!Array.isArray(cov.computed)) return false;
  let set = computedSets.get(cov.computed);
  if (!set) {
    set = new Set(cov.computed);
    computedSets.set(cov.computed, set);
  }
  return set.has(insee);
}

const computedSets = new WeakMap<readonly string[], ReadonlySet<string>>();

/**
 * Début et fin dans la plage calculable du fichier (sans quoi outboundAt / inboundAt lèvent une erreur).
 * Fin après le début (poste du jour) ou poste de nuit (fin le lendemain matin, `isNightShape`) : l'aller
 * lit la série aller au début, le retour la série retour à l'heure de fin, déjà dans la table.
 */
function shiftInFile(f: SwodFile, start: number, end: number, lookback: number): boolean {
  const lo = (start - lookback - f.first) / f.step;
  const hi = (start - f.step - f.first) / f.step;
  const k = (end - f.first) / f.step;
  return Number.isInteger(lo) && lo >= 0 && hi < f.nSlots && Number.isInteger(k) && k >= 0 && k < f.nSlots && (end > start || isNightShape(start, end));
}

function legsOf(f: SwodFile, section: SwodSection, i: number, sc: OdScenario, lookback: number): { out: OdLeg; ret: OdLeg } {
  if (section.kind === 'series') {
    return { out: outboundAt(f, section.outSeries![i]!, sc.start, lookback), ret: inboundAt(f, section.retSeries![i]!, sc.end) };
  }
  return { out: scalarLeg(f, section.out![i]!), ret: scalarLeg(f, section.ret![i]!) };
}

function emptyResult(status: OdScenarioStatus, sc: OdScenario, originIndex: number, timeDependent: boolean): OdResult {
  return { status, scenario: sc, timeDependent, originIndex, dests: [], poles: [], totals: null };
}

/**
 * Cœur du calcul. `file` = fichier SWOD décodé de l'origine (null si absent ou non chargé).
 * Ne lève pas d'erreur pour un scénario hors bornes : `invalid_shift`.
 */
export function computeOd(index: OdIndex, file: SwodFile | null, sc: OdScenario): OdResult {
  const originIndex = index.communes.indexOf(sc.origin);
  const def = odModeDef(index, sc.mode);
  const timeDependent = def?.kind === 'series';
  if (!def) return emptyResult('mode_not_in_od', sc, originIndex, false);
  const traffic = sc.mode === TRAFFIC_MODE ? sc.congestion ?? null : null;
  if (sc.mode === TRAFFIC_MODE && !traffic) return emptyResult('mode_not_in_od', sc, originIndex, false);
  if (originIndex < 0 || !originHasFile(index, sc.origin) || !file) return emptyResult('origin_not_computed', sc, originIndex, timeDependent);
  const section = file.sections.get(def.code);
  if (!section) return emptyResult('mode_not_computed', sc, originIndex, timeDependent);
  const lookback = index.outbound_lookback_min;
  if (timeDependent && !shiftInFile(file, sc.start, sc.end, lookback)) return emptyResult('invalid_shift', sc, originIndex, timeDependent);

  const recordAt = new Map<number, number>();
  section.dest.forEach((d, i) => recordAt.set(d, i));

  const dests: OdDestState[] = index.communes.map((insee, dest) => {
    const base = { dest, insee, jobs: index.jobs[dest] ?? 0, pole: index.pole_of[dest] ?? null };
    const i = recordAt.get(dest);
    if (i !== undefined) {
      const legs = legsOf(file, section, i, sc, lookback);
      // D-029 : chaque sens avec l'indice de sa tranche (début S pour l'aller, fin E pour le retour), sinon route vide
      const out = traffic ? { ...legs.out, minutes: trafficLeg(traffic, 'out', sc.start, legs.out.minutes).used } : legs.out;
      const ret = traffic ? { ...legs.ret, minutes: trafficLeg(traffic, 'ret', sc.end, legs.ret.minutes).used } : legs.ret;
      return { ...base, out, ret, status: destStatus(out, ret, sc.budget), record: true };
    }
    if (dest === originIndex) return { ...base, ...selfPairState(), record: false };
    // Absente : aucune durée dans les deux sens, sauf retour non calculé en export partiel
    const out: OdLeg = { minutes: null, reason: 'no_trip_within_120', dep: null };
    const ret: OdLeg = { minutes: null, reason: returnComputed(index, def.id, insee) ? 'no_trip_within_120' : 'not_computed' };
    return { ...base, out, ret, status: destStatus(out, ret, sc.budget), record: false };
  });

  const poles = poleShares(index, dests);
  return { status: 'ok', scenario: sc, timeDependent, originIndex, dests, poles, totals: totalsOf(dests, poles) };
}

/** Agrégation par pôle (même règle que `starway.od_export.reached_by_pole`, référence Python). */
export function poleShares(index: Pick<OdIndex, 'poles'>, dests: readonly OdDestState[]): OdPoleShare[] {
  const shares: OdPoleShare[] = index.poles.map((p, i) => ({
    index: i,
    id: p.id,
    jobs: p.jobs,
    measurable: p.jobs,
    reached: 0,
    notReached: 0,
    outOnly: 0,
    unknown: 0,
    self: 0,
    share: null,
    communes: [],
  }));
  for (const d of dests) {
    if (d.pole == null) continue;
    const s = shares[d.pole];
    if (!s) continue;
    s.communes.push(d);
    if (d.status === 'accessible') s.reached += d.jobs;
    else if (d.status === 'self') s.self += d.jobs;
    else if (d.status === 'unknown') s.unknown += d.jobs;
    else {
      s.notReached += d.jobs;
      if (d.status === 'out_only') s.outOnly += d.jobs;
    }
  }
  // La commune de départ sort du total : ses postes ne sont ni atteints ni non atteints, donc hors du dénominateur
  for (const s of shares) {
    s.measurable = Math.max(0, s.jobs - s.self);
    s.share = s.measurable > 0 ? s.reached / s.measurable : null;
  }
  return shares;
}

function totalsOf(dests: readonly OdDestState[], poles: readonly OdPoleShare[]): OdTotals {
  const t: OdTotals = {
    reachedInPoles: 0,
    reachedAll: 0,
    polesJobs: 0,
    allJobs: 0,
    measurableJobs: 0,
    selfJobs: 0,
    measurableCommunes: 0,
    unknownJobs: 0,
    reachedCommunes: 0,
  };
  for (const d of dests) {
    t.allJobs += d.jobs;
    if (d.status === 'self') {
      t.selfJobs += d.jobs;
      continue;
    }
    t.measurableJobs += d.jobs;
    t.measurableCommunes += 1;
    if (d.status === 'accessible') {
      t.reachedAll += d.jobs;
      t.reachedCommunes += 1;
    } else if (d.status === 'unknown') t.unknownJobs += d.jobs;
  }
  for (const p of poles) {
    t.reachedInPoles += p.reached;
    t.polesJobs += p.jobs;
  }
  return t;
}

/**
 * Cohérence de l'index avec poles.json et avec lui-même (contrôlée par 07 côté pipeline ; le front
 * la revérifie pour ne jamais afficher une part fausse). Liste vide = cohérent.
 */
export function checkOdIndex(index: OdIndex, poles: readonly Pick<Pole, 'id' | 'jobs'>[]): string[] {
  const problems: string[] = [];
  if (index.format?.name !== 'SWOD' || !SWOD_VERSIONS.includes(index.format.version)) problems.push(`format ${index.format?.name} v${index.format?.version} non lu (SWOD v1 ou v2 attendu)`);
  const n = index.communes.length;
  if (index.jobs.length !== n) problems.push(`jobs : ${index.jobs.length} valeurs pour ${n} communes`);
  if (index.pole_of.length !== n) problems.push(`pole_of : ${index.pole_of.length} valeurs pour ${n} communes`);
  if (index.poles.length !== poles.length) problems.push(`${index.poles.length} pôles dans l'index, ${poles.length} dans poles.json`);
  index.poles.forEach((p, i) => {
    if (poles[i] && poles[i].id !== p.id) problems.push(`pôle ${i} : ${p.id} dans l'index, ${poles[i].id} dans poles.json`);
  });
  const sums = index.poles.map(() => 0);
  index.pole_of.forEach((p, y) => {
    if (p != null && sums[p] !== undefined) sums[p] += index.jobs[y] ?? 0;
  });
  index.poles.forEach((p, i) => {
    if (sums[i] !== p.jobs) problems.push(`${p.id} : somme des communes ${sums[i]} au lieu de ${p.jobs}`);
  });
  for (const [field, value] of [
    ['grid.first', index.grid.first],
    ['starts.first', index.starts.first],
    ['ends.last', index.ends.last],
  ] as const) {
    if (parseClock(value) == null) problems.push(`${field} illisible (${value})`);
  }
  return problems;
}

/** Le fichier décodé correspond-il à l'index et à l'origine demandée ? Liste vide = oui. */
export function checkSwodHeader(index: OdIndex, f: SwodFile, insee: string): string[] {
  const problems: string[] = [];
  if (index.communes[f.origin] !== insee) problems.push(`origine ${index.communes[f.origin]} au lieu de ${insee}`);
  if (f.step !== index.grid.step_min) problems.push(`pas ${f.step} au lieu de ${index.grid.step_min}`);
  if (f.first !== parseClock(index.grid.first)) problems.push(`premier départ ${f.first} au lieu de ${index.grid.first}`);
  if (f.nSlots !== index.grid.n_slots) problems.push(`${f.nSlots} départs au lieu de ${index.grid.n_slots}`);
  if (f.maxTrip !== index.max_trip_min) problems.push(`durée maximale ${f.maxTrip} au lieu de ${index.max_trip_min}`);
  return problems;
}
