import type { PoleState } from './accessibility';
import { formatInt } from './format';
import { MODE_PHRASE, MODE_SHORT } from './labels';
import type { Insight, ModeId, Pole } from './types';

/**
 * « Le contraste du jour » (plan § 15) : UNE seule découverte territoriale robuste,
 * uniquement si insights.json en fournit une (la mieux classée). Si le jeu publie le recoupement
 * Navitia (`crosscheck`, audit du 03/11 point 5), seule une découverte `confirmed` est mise en avant ;
 * un ancien jeu sans ce champ garde la règle d'avant.
 */
export function pickContrast(insights: readonly Insight[]): Insight | null {
  const checked = insights.some((i) => i.crosscheck !== undefined);
  return (
    [...insights]
      .filter((i) => i.kind === 'territorial_gap' && i.robust && !!i.scenario.vs && (!checked || i.crosscheck === 'confirmed'))
      .sort((a, b) => a.rank - b.rank)[0] ?? null
  );
}

/** Mention discrète d'une découverte dont le verdict tient à l'arrondi d'une minute ; null sinon. */
export function crosscheckNote(ins: Pick<Insight, 'crosscheck'>): string | null {
  return ins.crosscheck === 'within_one_minute' ? 'verdict à une minute près selon le calculateur d’IDFM' : null;
}


/**
 * Métrique d'une découverte en clair (lignes de texte), tirée des seuls champs du fichier.
 * `late_return` (pipeline/starway/insights.py, late_return) :
 * - |poles_delta| = pôles atteints à l'aller dans le budget dont le retour dépasse le budget ou n'est pas trouvé ;
 * - |jobs_delta| = leurs postes salariés (INSEE) ;
 * - jobs = postes accessibles aller ET retour ; jobs_ref = postes des pôles atteints à l'aller (retour non exigé).
 * `bike_gain` (insights.py, bike_gain) : vélo + TC face aux TC + marche, même commune, même journée-type,
 * même budget ; poles_delta / jobs_delta = écart NET (pôles gagnés moins pôles perdus) ; jobs = postes
 * accessibles aller et retour en vélo + TC ; jobs_ref = en TC + marche.
 * Les autres types gardent l'écart signé (« -3 pôles · -42 000 postes »).
 */
export function insightMetricLines(ins: Pick<Insight, 'kind' | 'metric' | 'scenario'>): string[] {
  const { poles_delta: pd, jobs_delta: jd, jobs, jobs_ref: ref } = ins.metric;
  if (ins.kind === 'late_return') {
    const lines: string[] = [];
    if (pd != null) {
      const n = Math.abs(pd);
      const s = n > 1 ? 's' : '';
      lines.push(`${formatInt(n)} pôle${s} atteint${s} à l'aller, mais pas au retour en ${ins.scenario.b} min ou moins`);
    }
    const lost = jd != null ? `${formatInt(Math.abs(jd))} postes salariés (INSEE) perdus au retour` : null;
    const both = jobs != null ? `aller et retour : ${jobs === 0 ? 'aucun poste' : `${formatInt(jobs)} postes`}` : null;
    const second = [lost, both].filter((x): x is string => !!x).join(' ; ');
    if (second) lines.push(`${second.charAt(0).toUpperCase()}${second.slice(1)}`);
    return lines;
  }
  if (ins.kind === 'bike_gain') {
    const lines: string[] = [];
    const sgn = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${formatInt(Math.abs(n))}`;
    const head = [pd != null ? `${sgn(pd)} pôle${Math.abs(pd) > 1 ? 's' : ''}` : null, jd != null ? `${sgn(jd)} postes` : null].filter(Boolean);
    if (head.length) lines.push(`${head.join(' · ')} (écart net face aux ${MODE_PHRASE.transit})`);
    const amount = (n: number) => (n === 0 ? 'aucun poste' : `${formatInt(n)} postes`);
    if (jobs != null && ref != null) {
      lines.push(`Aller et retour : ${amount(jobs)} en ${MODE_PHRASE.bike_transit}, ${amount(ref)} en ${MODE_PHRASE.transit}`);
    }
    return lines;
  }
  if (pd == null && jd == null) return [];
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${formatInt(Math.abs(n))}`;
  const parts = [pd != null ? `${signed(pd)} pôle${Math.abs(pd) > 1 ? 's' : ''}` : null, jd != null ? `${signed(jd)} postes` : null];
  return [parts.filter(Boolean).join(' · ')];
}

/**
 * Mode d'une découverte en clair (liste des découvertes, « Deux voisines ») : « Transports en commun » ;
 * `bike_gain` dit les deux modes comparés.
 */
export function insightModeText(ins: Pick<Insight, 'kind' | 'scenario'>): string {
  const m = MODE_SHORT[ins.scenario.m as ModeId] ?? ins.scenario.m;
  return ins.kind === 'bike_gain' ? `${m} comparé aux ${MODE_PHRASE.transit}` : m;
}

/** Même chose dans une phrase (« En journée-type 9h-17h, en transports en commun, … ») : nom du mode en minuscules (MODE_PHRASE). */
export function insightModePhrase(ins: Pick<Insight, 'kind' | 'scenario'>): string {
  const m = MODE_PHRASE[ins.scenario.m as ModeId] ?? ins.scenario.m;
  return ins.kind === 'bike_gain' ? `${m} comparé aux ${MODE_PHRASE.transit}` : m;
}

/**
 * Pôle à ouvrir dans le panneau de preuve après une découverte « retour hors budget » : le pôle
 * « aller possible, retour hors budget » qui compte le plus de postes (à égalité, ordre de poles.json).
 * null s'il n'y en a aucun (le panneau reste fermé).
 */
export function lateReturnFocus(poles: readonly Pole[], states: readonly PoleState[]): string | null {
  let best: number | null = null;
  for (const s of states) {
    if (s.status !== 'out_only') continue;
    if (best == null || (poles[s.index]?.jobs ?? -1) > (poles[best]?.jobs ?? -1)) best = s.index;
  }
  return best == null ? null : (poles[best]?.id ?? null);
}

/** Scénario posé par une étape d'ouverture de découverte (mêmes champs que le store). */
export interface InsightStepScenario {
  origin: string;
  day: Insight['scenario']['d'];
  budget: number;
  mode: ModeId;
  compare: string | null;
}

/**
 * Ce que joue l'ouverture d'une découverte (critique v0.6 § 7, L-03) : le verbe du bouton, une
 * sous-ligne qui dit le passage montré, et les scénarios posés dans l'ordre. Une seule différence
 * réelle entre deux étapes (la journée-type pour l'éclipse, le mode pour le gain), jamais inventée :
 * la référence est celle du fichier (`compare_day`, ou les TC + marche pour `bike_gain`).
 * - eclipse : journée de référence, calme, puis journée de la découverte (voile, silence) ;
 * - territorial_gap : le diptyque, annoncé ;
 * - bike_gain : TC + marche, calme, puis vélo + TC (l'or apparaît) ;
 * - late_return : le ciel, puis le panneau de preuve du pôle dont le retour manque.
 * Mouvement réduit : la référence n'est pas montrée, l'état final arrive directement.
 */
export interface InsightPlan {
  verb: string;
  subline: string | null;
  steps: InsightStepScenario[];
  /** Ouvrir la preuve du pôle « aller possible, retour hors de portée » qui compte le plus de postes */
  focusLateReturn: boolean;
}

/** Titre court de chaque type de découverte (liste, puce, contraste du jour). */
export const INSIGHT_TITLE: Record<Insight['kind'], string> = {
  eclipse: 'Éclipse horaire',
  territorial_gap: 'Deux horizons',
  bike_gain: 'Gain vélo + transports en commun',
  late_return: 'Aller oui, retour non',
};

export const INSIGHT_VERB: Record<Insight['kind'], string> = {
  eclipse: 'Voir l’éclipse',
  territorial_gap: 'Voir les deux ciels',
  bike_gain: 'Voir le gain du vélo',
  late_return: 'Voir le retour qui manque',
};

export function insightPlan(
  ins: Pick<Insight, 'kind' | 'scenario'>,
  dayLabel: (id: string) => string,
  reduced = false,
): InsightPlan {
  const sc = ins.scenario;
  const final: InsightStepScenario = { origin: sc.o, day: sc.d, budget: sc.b, mode: sc.m, compare: sc.vs ?? null };
  const verb = INSIGHT_VERB[ins.kind] ?? 'Voir ce ciel';
  if (ins.kind === 'eclipse' && sc.compare_day && sc.compare_day !== sc.d) {
    return {
      verb,
      subline: `${dayLabel(sc.compare_day)}, puis ${dayLabel(sc.d)}`,
      steps: reduced ? [final] : [{ ...final, day: sc.compare_day }, final],
      focusLateReturn: false,
    };
  }
  if (ins.kind === 'bike_gain' && sc.m !== 'transit') {
    return {
      verb,
      subline: `${MODE_SHORT.transit}, puis ${MODE_PHRASE[sc.m] ?? sc.m}`,
      steps: reduced ? [final] : [{ ...final, mode: 'transit' }, final],
      focusLateReturn: false,
    };
  }
  return { verb, subline: null, steps: [final], focusLateReturn: ins.kind === 'late_return' };
}
