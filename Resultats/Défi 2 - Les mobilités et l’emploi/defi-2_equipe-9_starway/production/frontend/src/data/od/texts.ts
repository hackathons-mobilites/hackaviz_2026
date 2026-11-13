/**
 * Textes D-019 : fonctions PURES. Mêmes textes de raison que `access` (proof.ts) quand ils existent ;
 * en plus : « retour non calculé » (export partiel, jamais « aucun retour »), postes de la commune
 * d'origine (trajet non mesuré) et phrase générale sur la limite de marche du moteur.
 * Toute borne (2 h, 2 km) est lue dans od/index.json, jamais écrite en dur.
 */
import { formatInt, formatPercent } from '../format';
import { formatClock, parseClock, proofVerdict, reasonText, walkDistanceText, type TripLeg } from '../proof';
import type { OdDestState, OdPoleShare, OdScenarioStatus } from './compute';
import { DAY_SEGMENT } from './shift';
import type { OdLeg, OdReason } from './swod';
import type { OdIndex, OdTimeSegment } from './types';

export interface OdTextContext {
  /** index.max_trip_min */
  maxTripMin: number | null;
  /** false : marche, vélo, voiture (pas d'heure de départ à citer) */
  timeDependent: boolean;
  /** Mode partiel (`coverage[mode].complete` faux) : un retour 253 vient d'un lot pas encore calculé */
  partial: boolean;
}

/**
 * Complétude d'un mode = `coverage[mode].complete`, jamais `index.complete` (qui vaut false tant que
 * l'un des QUATRE modes manque : le TC publié le 03/11 est complet, sans aucune valeur 253, et ne doit
 * pas être présenté comme « jeu partiel »). Sans couverture lisible pour le mode : `index.complete`.
 */
export function odModePartial(index: Pick<OdIndex, 'coverage' | 'complete'>, mode: string | null | undefined): boolean {
  const cov = mode ? index.coverage?.[mode as keyof OdIndex['coverage']] : undefined;
  if (cov && typeof cov.complete === 'boolean') return !cov.complete;
  return index.complete !== true;
}

export function odTextContext(
  index: Pick<OdIndex, 'max_trip_min' | 'complete' | 'coverage'>,
  timeDependent: boolean,
  mode: string | null = timeDependent ? 'transit' : null,
): OdTextContext {
  return { maxTripMin: index.max_trip_min ?? null, timeDependent, partial: odModePartial(index, mode) };
}

const LEG_NAME: Record<TripLeg, string> = { out: 'aller', ret: 'retour' };

/** Raison d'un sens nul, en minuscules, sans le nom du sens quand le texte d'access le contient déjà. */
export function odReasonText(reason: OdReason, leg: TripLeg, ctx: OdTextContext): string {
  switch (reason) {
    case 'no_trip_within_120':
      return reasonText('no_trip_within_120', ctx.maxTripMin, leg, ctx.timeDependent);
    case 'not_computed':
      // Export partiel : le lot de la commune n'est pas encore calculé. Jamais « aucun retour ».
      return `${LEG_NAME[leg]} non calculé${ctx.partial ? ' (jeu de données partiel)' : ''}`;
    case 'origin_not_snapped':
      // 254 vaut pour le point de départ OU d'arrivée (index.sentinels) : le texte d'access (« point de
      // départ ») serait faux pour une destination non raccordée.
      return 'point de départ ou d’arrivée non raccordé au réseau';
  }
}

/** Le texte de la raison commence-t-il par le nom du sens (« retour non calculé ») ? */
function namesLeg(reason: OdReason): boolean {
  return reason === 'not_computed';
}

/**
 * « retour 65 min, attente comprise (fin du poste à 17h, arrivée 18h05) » : durée comptée depuis la fin du
 * poste `end`, attente comprise ; arrivée = fin + durée (dérivée). Partagé par les trois endroits où le retour
 * s'affiche (communes du pôle, panneau de preuve en journée-type, mode sources).
 */
export function returnLegText(minutes: number, end: number): string {
  return `retour ${minutes} min, attente comprise (fin du poste à ${formatClock(end)}, arrivée ${formatClock(end + minutes)})`;
}

/**
 * Indice du retour en journée-type (panneau de preuve, bloc « Temps de trajet », point 4.6) : durée comptée depuis
 * la fin du poste, attente du premier véhicule comprise ; aucun « départ 17h », car aucun véhicule ne part
 * forcément à cette heure. « attente comprise (fin du poste à 17h, arrivée 18h05) » ; sans arrivée connue,
 * la fin du poste seule.
 */
export function returnHintText(endTxt: string, arrive: number | null): string {
  return arrive == null ? `attente comprise, depuis la fin du poste à ${endTxt}` : `attente comprise (fin du poste à ${endTxt}, arrivée ${formatClock(arrive)})`;
}

/**
 * Un sens en une ligne : « aller 32 min (départ 8h25, arrivée 8h57) », « retour 65 min, attente comprise
 * (fin du poste à 17h, arrivée 18h05) », « retour non calculé (jeu de données partiel) », « aller : aucun
 * départ dans les 2 h avant le début du poste n'arrive à l'heure ». Heures DÉRIVÉES (départ + durée).
 *
 * Le retour est compté À PARTIR DE LA FIN DU POSTE, attente du premier véhicule comprise (point 4.6, à la
 * demande de Sara) : on n'écrit donc jamais « départ 17h », car aucun véhicule ne part forcément à cette heure.
 */
export function odLegText(leg: OdLeg, which: TripLeg, ctx: OdTextContext, end?: number): string {
  const name = LEG_NAME[which];
  if (leg.minutes != null) {
    if (!ctx.timeDependent) return `${name} ${leg.minutes} min`;
    const dep = which === 'out' ? (leg.dep ?? null) : (end ?? null);
    if (dep == null) return which === 'ret' ? `${name} ${leg.minutes} min, attente comprise` : `${name} ${leg.minutes} min`;
    return which === 'ret' ? returnLegText(leg.minutes, dep) : `${name} ${leg.minutes} min (départ ${formatClock(dep)}, arrivée ${formatClock(dep + leg.minutes)})`;
  }
  if (!leg.reason) return `${name} : trajet non mesuré`;
  const r = odReasonText(leg.reason, which, ctx);
  return namesLeg(leg.reason) ? r : `${name} : ${r}`;
}

export interface OdVerdict {
  kind: 'accessible' | 'blocked' | 'unknown' | 'self';
  title: string;
  detail: string;
}

const NOT_MEASURED: ReadonlySet<OdReason> = new Set<OdReason>(['not_computed', 'origin_not_snapped']);

const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/**
 * « votre commune : 12 345 postes, trajet non mesuré » (index.self_pair, décision de Nicolas du 05/11) :
 * les postes de la commune de départ sortent du total (compteur, part, liste, carte, affiche), ils ne sont
 * jamais comptés comme atteints. Les appelants mettent la majuscule en début de phrase.
 */
export function selfJobsText(jobs: number): string {
  return `votre commune : ${formatInt(jobs)} poste${jobs > 1 ? 's' : ''}, trajet non mesuré`;
}

/**
 * Verdict d'une commune de destination dans les contraintes choisies. Cas mesurés (aucune raison
 * « non calculé ») : exactement le verdict d'access (`proofVerdict`). Sinon : verdict sens par sens
 * qui ne dit jamais « aucun retour » pour un retour non calculé.
 */
export function odVerdict(d: Pick<OdDestState, 'status' | 'out' | 'ret' | 'jobs'>, budget: number, ctx: OdTextContext): OdVerdict {
  if (d.status === 'self') return { kind: 'self', title: 'Votre commune', detail: `${cap(selfJobsText(d.jobs))}.` };
  const unmeasuredOut = d.out.reason != null && NOT_MEASURED.has(d.out.reason);
  const unmeasuredRet = d.ret.reason != null && NOT_MEASURED.has(d.ret.reason);
  if (!unmeasuredOut && !unmeasuredRet) {
    const reason = d.out.minutes == null ? d.out.reason : d.ret.reason;
    const status = d.status === 'unknown' ? 'none' : d.status;
    const v = proofVerdict({ status, out: d.out.minutes, ret: d.ret.minutes, reason }, budget, ctx.maxTripMin, ctx.timeDependent);
    return { kind: v.kind, title: v.title, detail: v.detail };
  }
  if (unmeasuredOut) {
    return { kind: 'unknown', title: 'Non calculé', detail: `${cap(odLegText(d.out, 'out', ctx))}.` };
  }
  // Aller mesuré, retour non calculé ou point non raccordé
  const outPart =
    d.out.minutes == null
      ? odLegText(d.out, 'out', ctx)
      : d.out.minutes > budget
        ? `aller ${d.out.minutes} min (${d.out.minutes - budget} min au-delà)`
        : `aller ${d.out.minutes} min, en ${budget} min ou moins`;
  const retPart = odLegText(d.ret, 'ret', ctx);
  if (d.status === 'unknown') {
    return { kind: 'unknown', title: d.ret.reason === 'not_computed' ? 'Retour non calculé' : 'Non calculé', detail: `${cap(outPart)} ; ${retPart}.` };
  }
  // L'aller suffit à écarter la destination ; le retour reste « non calculé »
  const title = d.out.minutes == null ? 'Aucun trajet trouvé à l’aller' : 'Aller trop long';
  return { kind: 'blocked', title, detail: `${cap(outPart)} ; ${retPart}, avec ${budget} min au plus par sens.` };
}

/**
 * Phrase générale sur la limite de marche du moteur (index.walk_limit, `not_applied`) : à afficher
 * avec les verdicts TC « aucun trajet trouvé » de ce jeu, sans raison par commune (contrat D-019).
 * null si le jeu ne la signale pas, si le mode n'est pas les TC ou si la distance n'est pas publiée.
 */
export function odWalkLimitNote(index: Pick<OdIndex, 'walk_limit'>, timeDependent: boolean): string | null {
  const wl = index.walk_limit;
  if (!timeDependent || !wl || wl.status !== 'not_applied') return null;
  const d = walkDistanceText(wl.limit_m);
  if (!d) return null;
  return `Le moteur de calcul ne relie un arrêt au point d’arrivée que par ${d} de marche au plus. Ici, le point d’arrivée est celui d’une commune dans les deux sens : un « aucun trajet trouvé » peut venir de cette limite, à l’aller comme au retour.`;
}

/**
 * Poste de nuit (fin le lendemain matin) : d'où vient le retour. `weekday` = « mardi » (jour de
 * meta.service_date, `serviceWeekday`) ; null : « jour type ». Mêmes mots dans le panneau de preuve,
 * le mode sources (`nightReturnMethodText`) et docs/limites.md. Aucune durée n'est écrite ici.
 */
export function nightReturnNote(start: number, end: number, weekday: string | null): string {
  const day = weekday ? `${weekday} type` : 'jour type';
  return `Poste de nuit : l’aller arrive avant ${formatClock(start)} et le retour est compté à partir de la fin du poste, à ${formatClock(end)} le lendemain matin. Ce retour du matin est lu dans les horaires du même ${day}, pas dans ceux du lendemain. Le détail du trajet n’est pas affiché en horaires libres.`;
}

/** Mode sources (D-033, méthode) : le retour du matin d'un poste de nuit, avec le jour et la date de service lus dans meta.json. */
export function nightReturnMethodText(weekday: string | null, serviceDate: string | null): string {
  const day = weekday ? `${weekday} type` : 'jour type';
  return `Méthode : le retour du matin d’un poste de nuit est lu dans les horaires du même ${day}${serviceDate ? ` (GTFS IDFM, ${serviceDate})` : ''}, pas dans ceux du lendemain.`;
}

/** Mode sources (D-033, méthode, D-040) : comment est calculée chaque plage de départs hors du jour, selon son nom dans `index.time_segments`. */
const NIGHT_BASIS: Readonly<Record<string, string>> = {
  matin: 'les horaires IDFM complétés des courses de la veille codées 24:00 et plus',
  soir: 'les horaires IDFM complétés des courses du lendemain parties avant 3h',
};

/**
 * Mode sources (D-033, méthode, D-040) : sur quels horaires sont calculées les plages du matin et du soir de la grille
 * (`index.time_segments`). Plages, jour et date lus dans les données ; aucune durée ni aucun code de source écrit ici
 * (la source est citée par sa note, `CodeSourceNote`). Le matin reçoit les courses de la veille passées après minuit, le
 * soir celles du lendemain parties avant 3h : les deux viennent du même mardi type. null sans `time_segments` (ancien
 * export) ou sans plage de nuit.
 */
export function nightNetworkMethodText(
  segments: readonly Pick<OdTimeSegment, 'name' | 'from' | 'to'>[] | undefined,
  weekday: string | null,
  serviceDate: string | null,
): string | null {
  const clauses: string[] = [];
  let both = 0;
  for (const s of segments ?? []) {
    if (s.name === DAY_SEGMENT) continue;
    const a = parseClock(s.from);
    const b = parseClock(s.to);
    if (a == null || b == null) continue;
    const basis = NIGHT_BASIS[s.name] ?? 'les horaires IDFM complétés des courses de nuit';
    clauses.push(clauses.length === 0 ? `de ${formatClock(a)} à ${formatClock(b)}, les trajets sont calculés sur ${basis}` : `de ${formatClock(a)} à ${formatClock(b)}, sur ${basis}`);
    if (s.name === 'matin' || s.name === 'soir') both += 1;
  }
  if (clauses.length === 0) return null;
  const day = weekday ? `${weekday} type` : 'jour type';
  const same = both === 2 ? ` ; le matin et le soir viennent du même ${day}${serviceDate ? ` (GTFS IDFM, ${serviceDate})` : ''}, le soir avec les courses du lendemain après minuit` : '';
  return `Méthode : ${clauses.join(' ; ')} (ces courses sont absentes sinon du calcul)${same}.`;
}

/**
 * Mode sources (D-033, méthode) et page « Sources & limites » : comment sont calculés les postes atteints
 * (question et réponse de l'équipe, 05/11 ; point 4.7). Texte de méthode, aucune donnée : aucun chiffre.
 * - aller : le départ le plus tardif qui arrive avant le début du poste ;
 * - retour : compté à partir de la fin du poste, attente comprise (point 4.6, à la demande de l'équipe) ;
 * - une commune est comptée en entier si l'aller et le retour tiennent chacun dans le temps choisi ;
 * - Part = Atteints / Postes, la commune de départ (trajet non mesuré) étant hors du total (point 4.1).
 * Sans horaire (marche, vélo, voiture), les deux premières phrases laissent place à « durées indépendantes de l'heure ».
 */
export function calcMethodText(timeDependent: boolean): string {
  const legs = timeDependent
    ? 'aller : départ le plus tardif qui arrive avant le début du poste ; retour : compté à partir de la fin du poste, attente comprise'
    : 'aller et retour : durées indépendantes de l’heure';
  return `Méthode du calcul des postes atteints : ${legs} ; une commune est comptée en entier si l’aller et le retour tiennent chacun dans le temps choisi ; Part = Atteints / Postes, les postes de votre commune (trajet non mesuré) étant hors du total.`;
}

/** Texte d'un scénario qui ne peut pas être calculé (ciel neutre). null pour `ok`. */
export function odScenarioStatusText(status: OdScenarioStatus): string | null {
  switch (status) {
    case 'ok':
      return null;
    case 'origin_not_computed':
      return 'Non calculé pour cette commune.';
    case 'mode_not_in_od':
      return 'Ce mode n’est pas calculé pour les horaires libres : il reste disponible avec les journées-types.';
    case 'mode_not_ready':
      return 'Ce mode n’est pas encore calculé commune par commune : il reste disponible avec les journées-types.';
    case 'mode_not_computed':
      return 'Ce mode n’est pas encore calculé pour cette commune.';
    case 'invalid_shift':
      return 'Ces horaires ne sont pas calculés : choisissez un début et une fin de poste proposés (fin le jour même, ou poste de nuit avec une fin le lendemain matin).';
  }
}

/**
 * Résumé d'un astre éclairé en partie (aria-label, liste du ciel), exemple fictif (postes atteints
 * et postes de la commune inventés pour montrer la forme ; ce n'est pas un résultat) :
 * « Paris Rive gauche : 412 000 postes atteints aller et retour sur 495 000 (83,2 %) ; votre commune :
 * 12 345 postes, trajet non mesuré ». Le dénominateur ne compte pas la commune de départ. Le nom est
 * fourni par l'appelant (labels.ts).
 */
export function poleShareText(name: string, s: Pick<OdPoleShare, 'reached' | 'measurable' | 'share' | 'self' | 'unknown'>): string {
  const parts = [`${name} : ${formatInt(s.reached)} postes atteints aller et retour sur ${formatInt(s.measurable)}${s.share != null ? ` (${formatPercent(s.share * 100)})` : ''}`];
  if (s.unknown > 0) parts.push(`${formatInt(s.unknown)} postes non calculés`);
  if (s.self > 0) parts.push(selfJobsText(s.self));
  return parts.join(' ; ');
}
