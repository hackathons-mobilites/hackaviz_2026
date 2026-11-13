/**
 * Variables de narration résolues depuis les MÊMES données et fonctions que l'interface.
 * Une variable null n'est jamais prononcée : elle est signalée comme manquante.
 */
import { computeDelta, computePoleStates, getSeries, isTimeDependent, type PoleStatus } from '../data/accessibility';
import type { OdDestState } from '../data/od/compute';
import { durationOral, eurosOral, hourOral, jobsOral, peopleOral, percentOral, populationOral, regionPopulation, starsOral } from '../data/oral';
import { intervalsOverlap } from '../data/halo';
import { metierName, metierProjects, metierProjectsOral, type BmoMetiersFile } from '../data/bmoMetiers';
import { recruitView, type BmoFile } from '../data/bmo';
import { carbonFact, itineraryOf, type ItinerariesFile, type ItinLeg } from '../data/itineraries';
import { poleOralName } from '../data/oralNames';
import { flowToPole, shortCommuneName } from '../data/proof';
import { guardSeries } from '../data/seriesGuard';
import type { AccessFile, ContextFile, DayTypeId } from '../data/types';
import type { SkyView } from '../store/selectors';

export interface NarrationContext {
  view: SkyView;
  /** Vue avant l'application de l'étape (pour les deltas) */
  previous: SkyView | null;
  /** Vue de la commune de comparaison (même scénario) */
  compare?: SkyView | null;
  /** context/{origin}.json chargé (halo) */
  context?: ContextFile | null;
  /** context/{compare}.json chargé : la commune de comparaison (halo à deux communes, niveau de vie de B) */
  compareContext?: ContextFile | null;
  /** Bilan du gain démontré affiché en or pour ce scénario (SkyEngine.showGain), s'il existe */
  gain?: { shown: boolean; gained: readonly string[]; lost: readonly string[] } | null;
  /** Fichiers access/{insee}.json chargés (heure de départ, aller de référence en 9h-17h) */
  access?: Readonly<Record<string, AccessFile | null>>;
  /** Fichiers itineraries/{insee}.json chargés (D-028 : lignes empruntées par le trajet calculé) */
  itineraries?: Readonly<Record<string, ItinerariesFile | null>>;
  /** bmo_metiers.json (D-035) : projets de recrutement par bassin et par métier ; null si non publié. Ne sert plus qu'à relier le métier de Léa à sa famille. */
  bmoMetiers?: BmoMetiersFile | null;
  /** bmo.json (D-035) : le fichier du panneau de preuve (par famille de métiers) ; la visite cite le chiffre de la FAMILLE (décision du 06/11) */
  bmo?: BmoFile | null;
  /** Code BMO du métier suivi par le script (`TourScript.bmoMetier`) */
  bmoMetier?: string | null;
  /**
   * Postes salariés (INSEE) d'une commune (EMP01, index de la table OD : `jobs` aligné sur `communes`) ; null si
   * inconnu. Sert à sortir la commune de départ des totaux de postes (point 4.1 du 05/11, comme le reste du site) :
   * son trajet n'est pas mesuré, ses postes ne sont ni « à sa portée » ni hors de portée. Sans cette fonction, les
   * variables de postes sont nulles et la visite s'arrête : jamais un total qui compterait la commune de départ.
   */
  communeJobs?: ((insee: string) => number | null) | null;
}

/**
 * Postes de la commune de départ comptés dans les astres de `ids` (son astre en fait partie : `Pole.communes`),
 * à retrancher du total de ces astres. 0 si son astre n'y est pas ; null si la donnée manque (variable nulle).
 */
function selfJobsIn({ view, communeJobs }: NarrationContext, ids: readonly string[]): number | null {
  const insee = view.origin?.insee;
  if (!insee || !communeJobs) return null;
  const home = view.dataset.poles.find((p) => p.communes.includes(insee));
  if (!home || !ids.includes(home.id)) return 0;
  const jobs = communeJobs(insee);
  return jobs != null && jobs >= 0 ? jobs : null;
}

/**
 * Bus de remplacement d'un RER ou d'un Transilien dans un tronçon d'itinéraire. Règle vérifiée sur le GTFS IDFM
 * du 17/11/2026 (08c, docs/methodologie.md) : les 13 lignes de type bus des exploitants « RER » et
 * « Transilien » sont toutes des lignes « Remplacement RER x » ou « Remplacement Transilien x ».
 */
function replacementOf(leg: ItinLeg): { agency: 'RER' | 'Transilien'; line: string } | null {
  if (leg.m !== 'bus' || !leg.line) return null;
  return leg.agency === 'RER' || leg.agency === 'Transilien' ? { agency: leg.agency, line: leg.line } : null;
}

/** Itinéraire calculé (D-028) du sens `leg` vers le pôle sélectionné, journée de la vue ; null si absent. */
function selectedTrip({ view, itineraries }: NarrationContext, leg: 'out' | 'ret') {
  const pole = view.scenario.pole;
  const file = view.origin ? itineraries?.[view.origin.insee] : null;
  if (!pole || !file || view.scenario.mode !== 'transit' || view.scenario.shift) return null;
  return itineraryOf(file, pole, view.scenario.day, leg);
}

/** Durée (min) du trajet détaillé tel que le panneau l'affiche ; null sans itinéraire publié. */
function tripMinutes(trip: { min?: number } | null | undefined): number | null {
  return typeof trip?.min === 'number' && Number.isFinite(trip.min) ? trip.min : null;
}

/** Écart de l'étape (B = maintenant, A = avant) ; null si l'un des deux états n'est pas calculé. */
function stepDelta({ view, previous }: NarrationContext) {
  if (!previous || !view.totals.hasData || !previous.totals.hasData) return null;
  return computeDelta(view.dataset.poles, previous.states, view.states);
}

/**
 * Compteur du site : postes salariés (INSEE) atteints aller et retour (table OD), commune de départ hors du
 * total ; null si le ciel n'est pas calculé sur la table OD (vélo + TC : `access/`). C'est le chiffre que
 * `odCounterDetail` écrit dans le compteur, jamais une somme refaite ici.
 */
function odReached(view: SkyView | null | undefined): number | null {
  return view && view.basis === 'od' && view.totals.hasData ? (view.totals.od?.reachedAll ?? null) : null;
}

/** « près de 2,6 millions de postes » → « près de 2,6 millions » ; « près de 55 000 postes » → « près de 55 000 » */
function withoutPostes(oral: string | null): string | null {
  return oral ? oral.replace(/ (de )?postes$/, '') : null;
}

/**
 * Commune unique de l'astre sélectionné quand le ciel est calculé sur la table OD (un arrondissement de Paris) : ses
 * temps sont ceux que le panneau de preuve montre pour l'astre (`odCommuneRows`). null pour un astre de plusieurs
 * communes (plusieurs temps, aucun n'est « le » temps de l'astre) ou hors table OD.
 */
function odPoleCommune({ view }: NarrationContext): OdDestState | null {
  const st = view.selectedState;
  if (!st || view.basis !== 'od' || !view.od || view.od.status !== 'ok') return null;
  const communes = view.od.poles[st.index]?.communes.filter((c) => c.status !== 'self') ?? [];
  return communes.length === 1 ? communes[0]! : null;
}

/** Aller ou retour (minutes) de l'astre sélectionné : celui de la table OD sur le ciel OD, celui d'`access/` sinon. */
function poleLeg(ctx: NarrationContext, leg: 'out' | 'ret'): number | null {
  const { view } = ctx;
  if (view.basis === 'od') return odPoleCommune(ctx)?.[leg].minutes ?? null;
  return view.selectedState?.[leg] ?? null;
}

/** Statut de l'astre sélectionné avec le même sens que `access/` : sur la table OD, celui de sa commune unique. */
function poleStatusOf(ctx: NarrationContext): PoleStatus | null {
  const { view } = ctx;
  const st = view.selectedState;
  if (!st) return null;
  if (view.basis !== 'od') return st.status;
  const s = odPoleCommune(ctx)?.status;
  return s && s !== 'self' ? s : null;
}

/**
 * Commune d'ancrage de l'astre sélectionné (`name_short_insee` de poles.json : Poissy pour Seine-Aval) quand le ciel est
 * calculé sur la table OD et que l'astre compte plusieurs communes : la ligne du panneau de preuve de cette commune
 * (`odCommuneRows`), que le recoupement Navitia du 06/11 a confirmée aller et retour. null hors table OD, sans commune
 * d'ancrage ou si elle n'est pas dans l'astre.
 */
function odAnchorCommune({ view }: NarrationContext): OdDestState | null {
  const st = view.selectedState;
  const insee = view.selectedPole?.name_short_insee;
  if (!st || !insee || view.basis !== 'od' || !view.od || view.od.status !== 'ok') return null;
  return view.od.poles[st.index]?.communes.find((c) => c.insee === insee) ?? null;
}

function dayOf(view: SkyView) {
  return view.dataset.meta.day_types.find((d) => d.id === view.scenario.day) ?? null;
}

type Resolver = (ctx: NarrationContext) => string | number | null;

/** Série (mode, journée) de la commune d'origine pour le scénario de la vue ; null si absente. */
function originSeries({ view, access }: NarrationContext, day = view.scenario.day) {
  const file = view.origin ? access?.[view.origin.insee] : null;
  // Garde de longueur (arbitrage du 05/11) : la série doit avoir autant d'éléments que les astres affichés
  return file ? guardSeries(view.dataset.poles.length, getSeries(file, view.scenario.mode, day)) : null;
}

/** Bloc niveau de vie (SOC01) : médiane et taux de pauvreté publiés ou non (mêmes statuts que le halo). */
function incomeFacts(ctx: ContextFile | null | undefined) {
  const b = ctx?.income;
  if (!b || (b.status !== 'ok' && b.status !== 'secret')) return null;
  const medianStatus = b.median_status ?? b.status;
  const povertyStatus = b.poverty_rate_status ?? b.status;
  return {
    median: medianStatus === 'ok' && b.median_living_standard_eur != null ? b.median_living_standard_eur : null,
    poverty: povertyStatus === 'ok' && b.poverty_rate != null ? b.poverty_rate : null,
    povertySecret: povertyStatus === 'secret',
  };
}

/** Flux EMP02 de la commune d'origine vers le pôle sélectionné ; null si la donnée n'est pas lisible. */
function selectedFlow({ view, context }: NarrationContext) {
  return view.scenario.pole ? flowToPole(context, view.scenario.pole) : null;
}


/**
 * Projets de recrutement du métier suivi par la visite (`TourScript.bmoMetier`) dans le bassin d'emploi de
 * l'astre sélectionné ; null sans fichier publié, sans métier ou sans bassin (jamais de valeur).
 * (Chiffre du MÉTIER : plus prononcé depuis le 06/11, le panneau ne l'affiche pas.)
 */
function bmoOf({ view, bmoMetiers, bmoMetier }: NarrationContext) {
  return bmoMetiers && bmoMetier ? metierProjects(bmoMetiers, view.selectedPole?.bassin?.code, bmoMetier) : null;
}

/**
 * Famille de métiers du métier suivi (`bmo_metiers.json`, champ `family`) et chiffre de CETTE FAMILLE dans le bassin de
 * l'astre suivi, lu dans `bmo.json` : le fichier que lit le panneau de preuve (`recruitView`, `familyRows`), donc le nombre
 * de la ligne de la famille dans la liste « Projets de recrutement par famille de métiers ». null sans fichier, sans
 * métier, sans bassin ou sans case publiée.
 */
function bmoFamilyOf({ view, bmo, bmoMetiers, bmoMetier }: NarrationContext) {
  const code = bmoMetiers && bmoMetier ? bmoMetiers.metiers.find((m) => m.code === bmoMetier)?.family : null;
  const pole = view.selectedPole;
  if (!bmo || !code || !pole) return null;
  const rv = recruitView(bmo, pole, view.dataset.poles);
  if (rv.status !== 'ok') return null;
  const cell = rv.bassin.families[code]?.met ?? null;
  const label = bmo.families.find((f) => f.code === code)?.label ?? null;
  return cell && cell.n != null && label ? { code, label, cell } : null;
}

export const VARIABLES: Record<string, Resolver> = {
  /**
   * Étape « recrutement » (D-035, PR 30) : l'astre suivi porte `bassin` (44 astres).
   * Le métier de Léa est celui du script (`bmoMetier`) : ce module ne connaît pas Léa.
   */
  'bmo.bassinOral': ({ view }) => view.selectedPole?.bassin?.name ?? null,
  'bmo.projectsOral': (ctx) => metierProjectsOral(bmoOf(ctx)),
  /** Chiffre de la FAMILLE de métiers du métier suivi, celui du panneau (« au moins 47 000 » pour « au moins 47 307 ») */
  'bmo.familyProjectsOral': (ctx) => metierProjectsOral(bmoFamilyOf(ctx)?.cell ?? null),
  /** Libellé de la famille tel que le panneau l'écrit, en minuscule initiale : « fonctions liées à la vente, au tourisme et aux services » */
  'bmo.familyOral': (ctx) => {
    const f = bmoFamilyOf(ctx);
    return f ? `${f.label.charAt(0).toLowerCase()}${f.label.slice(1)}` : null;
  },
  'bmo.yearOral': ({ bmo, bmoMetiers }) => (bmo ? String(bmo.year) : bmoMetiers ? String(bmoMetiers.year) : null),
  /** Contrôle (non prononcé) : le code du métier suivi existe, a un libellé et des projets publiés dans le bassin de l'astre suivi */
  'bmo.metierCase': (ctx) => (bmoOf(ctx)?.n != null && ctx.bmoMetier && metierName(ctx.bmoMetiers!, ctx.bmoMetier) ? ctx.bmoMetier : null),
  /** Contrôle (non prononcé) : code de la famille du métier suivi, si le panneau affiche un chiffre pour elle dans ce bassin */
  'bmo.familyCase': (ctx) => bmoFamilyOf(ctx)?.code ?? null,
  'origin.name': ({ view }) => view.origin?.name ?? null,
  /** Nom à l'oral (arrondissements raccourcis : « Paris 18e ») */
  'origin.oralName': ({ view }) => (view.origin ? shortCommuneName(view.origin.name) : null),
  'compare.oralName': ({ view }) => {
    const c = view.dataset.communes.find((x) => x.insee === view.scenario.compare);
    return c ? shortCommuneName(c.name) : null;
  },
  /** Postes atteints par la commune de comparaison : l'en-tête B du diptyque (table OD : le compteur de ce ciel) */
  'compare.jobsOral': ({ compare }) =>
    compare && compare.origin && !compare.accessMissing && compare.totals.hasData
      ? jobsOral(compare.basis === 'od' ? odReached(compare) : compare.totals.jobs)
      : null,
  /** Heure de départ de l'aller (départ le plus tardif de la grille qui arrive à temps) ; null si inconnue */
  'pole.outDepartOral': (ctx) => {
    const { view, access } = ctx;
    const st = view.selectedState;
    if (!st || !view.origin) return null;
    // Table OD : le départ retenu de l'aller est dans la ligne de la commune du panneau (« départ 8h10 »)
    if (view.basis === 'od') {
      const dep = odPoleCommune(ctx)?.out.dep;
      return dep == null ? null : hourOral(`${String(Math.floor(dep / 60)).padStart(2, '0')}:${String(dep % 60).padStart(2, '0')}`);
    }
    if (st.out == null) return null;
    if (!isTimeDependent(access?.[view.origin.insee], view.scenario.mode, view.scenario.day)) return null;
    return hourOral(originSeries(ctx)?.dep?.[st.index]);
  },
  /**
   * Quel sens sort du budget pour le pôle sélectionné (contrôle de la constante ECLIPSE_LEG, non prononcé) :
   * aller_absent, retour_absent, les_deux, aller, retour (aller identique à celui de 9h-17h), retour_seul, allume.
   */
  'pole.legCase': (ctx) => {
    const { view } = ctx;
    const status = poleStatusOf(ctx);
    const st = view.selectedState;
    if (!st || !status || status === 'unknown') return null;
    const out = poleLeg(ctx, 'out');
    const ret = poleLeg(ctx, 'ret');
    const b = view.scenario.budget;
    if (out == null) return 'aller_absent';
    if (ret == null) return 'retour_absent';
    if (out > b && ret > b) return 'les_deux';
    if (out > b) return 'aller';
    if (ret > b) {
      const ref = originSeries(ctx, 'd09')?.out?.[st.index];
      return ref != null && ref === out ? 'retour' : 'retour_seul';
    }
    return 'allume';
  },
  /**
   * Verdict du pôle sélectionné, sans exiger que l'aller soit identique à celui de 9h-17h (contrôle, non
   * prononcé ; plus robuste que `pole.legCase` si les durées bougent de quelques minutes, D-031) :
   * 'aller_oui_retour_non' (l'aller tient dans le temps de trajet, pas le retour, ou aucun retour),
   * 'allume', 'aller_non' (l'aller ne tient pas ou n'existe pas). Sur la table OD : le statut de la commune
   * unique de l'astre, celui que le panneau et l'astre affichent.
   */
  'pole.verdictCase': (ctx) => {
    const status = poleStatusOf(ctx);
    if (!status || status === 'unknown') return null;
    return status === 'accessible' ? 'allume' : status === 'out_only' ? 'aller_oui_retour_non' : 'aller_non';
  },
  /**
   * Le retour calculé vers le pôle sélectionné passe-t-il par un bus de remplacement (travaux) ? Contrôle, non
   * prononcé : 'remplacement', 'regulier', null si l'itinéraire détaillé (D-028) n'est pas publié.
   */
  'pole.retReplacementCase': (ctx) => {
    const t = selectedTrip(ctx, 'ret');
    if (!t?.legs) return null;
    return t.legs.some((l) => replacementOf(l)) ? 'remplacement' : 'regulier';
  },
  /**
   * « un bus du RER A » (ou « un bus de la ligne L » pour un Transilien), lu dans l'itinéraire du retour. Le texte dit
   * ce que le panneau montre (un tronçon « Bus », ligne A, exploitant RER), pas plus : que ce bus soit un
   * REMPLACEMENT (travaux) se lit dans le GTFS (« Remplacement RER A ») mais n'est écrit nulle part à l'écran ni dans
   * le mode sources ; il reste contrôlé par `pole.retReplacementCase`, qui arrête la visite si le retour n'en est plus un.
   */
  'pole.retReplacementOral': (ctx) => {
    const r = selectedTrip(ctx, 'ret')?.legs?.map(replacementOf).find((x) => x) ?? null;
    if (!r) return null;
    return r.agency === 'RER' ? `un bus du RER ${r.line}` : `un bus de la ligne ${r.line}`;
  },
  /**
   * La phrase des moyens de transport dit « les lignes déclarées climatisées » : contrôle (non prononcé) que le
   * trajet du pôle suivi, tel que le panneau le montre (aller et retour), emprunte au moins une ligne dont la
   * climatisation est déclarée à IDFM (TRA03, champ `air_conditioning` = oui). 'declaree' ; 'non_declaree'
   * sinon ; null si l'itinéraire détaillé n'est pas publié. Rien de plus que la déclaration de la ligne.
   */
  'moyens.climCase': (ctx) => {
    const legs = (['out', 'ret'] as const).flatMap((s) => selectedTrip(ctx, s)?.legs ?? []);
    if (!legs.length || !legs.some((l) => l.m !== 'walk' && l.air_conditioning !== undefined)) return null;
    return legs.some((l) => l.m !== 'walk' && l.air_conditioning === 'true') ? 'declaree' : 'non_declaree';
  },
  /** « les émissions carbone de chaque trajet » : contrôle que le panneau les montre pour ce trajet (ENV01, aller ET retour) */
  'moyens.carbonCase': (ctx) => {
    const out = selectedTrip(ctx, 'out');
    const ret = selectedTrip(ctx, 'ret');
    if (!out || !ret) return null;
    return carbonFact(out, ret) ? 'publie' : 'non_publie';
  },
  /** Horizon de recherche du calcul (meta.max_trip_min) à l'oral : « 2 heures » */
  'trip.maxOral': ({ view }) => durationOral(view.dataset.meta.max_trip_min ?? null),
  /** Actifs occupés de la commune qui travaillent dans le pôle sélectionné (EMP02) */
  'flow.peopleOral': (ctx) => {
    const f = selectedFlow(ctx);
    if (!f || f.precision === 'no_flow_in_file') return null;
    return peopleOral(f.flux, f.precision === 'order_of_magnitude');
  },
  /** Variante de l'étape des flux (contrôle de la constante FLUX, non prononcé) */
  'flow.case': (ctx) => {
    const f = selectedFlow(ctx);
    if (!f) return null;
    return f.precision === 'ok' ? 'ok' : f.precision === 'order_of_magnitude' ? 'ordre_de_grandeur' : 'aucun_flux_publie';
  },
  /** Niveau de vie médian (SOC01) à la centaine, « 42 500 euros » ; la phrase dit « d'environ » */
  'halo.incomeMedianOral': ({ context }) => eurosOral(incomeFacts(context)?.median),
  'halo.povertyOral': ({ context }) => percentOral(incomeFacts(context)?.poverty),
  /**
   * Niveau de vie médian (SOC01) de la commune de COMPARAISON (B du diptyque), même arrondi à la centaine que la commune de
   * départ : la ligne de B du halo à deux communes. Lue dans context/{compare}.json ; null si le fichier ou la médiane manque.
   */
  'halo.compareIncomeMedianOral': ({ compareContext }) => eurosOral(incomeFacts(compareContext)?.median),
  /** 'deux_medianes' si les deux communes ont une médiane publiée (contrôle de l'étape du halo, non prononcé) */
  'halo.compareCase': ({ context, compareContext }) =>
    incomeFacts(context)?.median != null && incomeFacts(compareContext)?.median != null ? 'deux_medianes' : null,
  /** Variante du halo niveau de vie (contrôle de la constante INCOME, non prononcé) */
  'halo.incomeCase': ({ context }) => {
    const f = incomeFacts(context);
    if (!f || f.median == null) return null;
    if (f.poverty != null) return 'deux';
    return f.povertySecret ? 'pauvrete_secrete' : null;
  },
  'compare.name': ({ view }) => view.dataset.communes.find((c) => c.insee === view.scenario.compare)?.name ?? null,
  budget: ({ view }) => view.scenario.budget,
  'day.label': ({ view }) => view.dataset.meta.day_types.find((d) => d.id === view.scenario.day)?.label ?? null,
  'mode.label': ({ view }) => view.dataset.meta.modes.find((m) => m.id === view.scenario.mode)?.label.toLowerCase() ?? null,
  'access.poleCount': ({ view }) => (view.totals.hasData ? view.totals.accessibleCount : null),
  'access.poleTotal': ({ view }) => view.totals.poleCount,
  'delta.sign': (ctx) => {
    const d = stepDelta(ctx);
    if (!d) return null;
    return d.polesDelta > 0 ? 'de plus' : d.polesDelta < 0 ? 'de moins' : 'de différence';
  },
  'pole.name': ({ view }) => view.selectedPole?.name ?? null,
  'pole.out': (ctx) => poleLeg(ctx, 'out'),
  'pole.ret': (ctx) => poleLeg(ctx, 'ret'),
  /**
   * Durée de l'EXEMPLE de trajet que le bloc « Trajet » du panneau montre (itinéraire détaillé D-028, attente comprise), aller et retour :
   * celle que la voix doit dire quand le repère éclaire ce bloc (retours de Cyril et de Nicolas du 12/11 : la voix disait les 53 min de la
   * matrice, l'écran en montrait 45 et 43). null si l'itinéraire n'est pas publié.
   */
  'trip.out': (ctx) => tripMinutes(selectedTrip(ctx, 'out')),
  'trip.ret': (ctx) => tripMinutes(selectedTrip(ctx, 'ret')),
  'pole.oralName': ({ view }) => (view.selectedPole ? poleOralName(view.selectedPole) : null),
  /** Commune d'ancrage de l'astre suivi (Poissy pour Seine-Aval) : nom, aller et retour de sa ligne du panneau (table OD) */
  'anchor.oralName': (ctx) => {
    const insee = odAnchorCommune(ctx) ? ctx.view.selectedPole?.name_short_insee : null;
    const c = insee ? ctx.view.dataset.communes.find((x) => x.insee === insee) : null;
    return c ? shortCommuneName(c.name) : null;
  },
  'anchor.out': (ctx) => odAnchorCommune(ctx)?.out.minutes ?? null,
  'anchor.ret': (ctx) => odAnchorCommune(ctx)?.ret.minutes ?? null,
  /** Contrôle (non prononcé) : 'allume' si la commune d'ancrage est atteinte aller ET retour dans le temps de trajet, sinon le statut du panneau */
  'anchor.verdictCase': (ctx) => {
    const s = odAnchorCommune(ctx)?.status;
    return !s || s === 'self' || s === 'unknown' ? null : s === 'accessible' ? 'allume' : s === 'out_only' ? 'aller_oui_retour_non' : 'aller_non';
  },

  /**
   * Acte 4 : phrases conditionnelles résolues depuis le bilan du gain (jamais devinées).
   * Chaîne vide quand la condition n'est pas remplie ; null (visite arrêtée) si aucun bilan n'existe.
   */
  'gain.goldPhrase': ({ view, gain }) => {
    if (!gain) return null;
    if (!gain.shown) return '';
    const jobs = view.dataset.poles.filter((p) => gain.gained.includes(p.id)).map((p) => p.jobs);
    if (jobs.some((j) => j == null)) return null;
    const total = (jobs as number[]).reduce((a, b) => a + b, 0);
    const oral = jobsOral(total);
    return oral ? ` En or, ce qu’elle gagne : ${oral}.` : null;
  },
  'gain.lostPhrase': ({ gain }) => {
    if (!gain) return null;
    return gain.lost.length ? ` Mais elle en perd ${starsOral(gain.lost.length)}.` : '';
  },
  /** Postes des seuls pôles peints en or (gain démontré, même journée, même budget) ; null sans or */
  'gain.jobsOral': (ctx) => {
    const { view, gain } = ctx;
    if (!gain || !gain.shown) return null;
    const jobs = view.dataset.poles.filter((p) => gain.gained.includes(p.id)).map((p) => p.jobs);
    if (!jobs.length || jobs.some((j) => j == null)) return null;
    // la commune de départ n'est jamais comptée (point 4.1) : retranchée si son astre est parmi les astres en or
    const self = selfJobsIn(ctx, gain.gained);
    return self == null ? null : jobsOral((jobs as number[]).reduce((a, b) => a + b, 0) - self);
  },
  /**
   * Les pôles dorés sont-ils des étoiles éteintes par l'éclipse (contrôle, non prononcé) ? Éclipse = pôles
   * accessibles en TC en 9h-17h et plus en TC dans la journée courante, même commune, même temps de trajet.
   * 'toute' : l'or rallume exactement ces pôles ; 'partie' : seulement certains d'entre eux ; 'autre' : un pôle
   * doré n'était pas éteint par l'éclipse ; null : pas d'or, journée 9h-17h ou données absentes.
   */
  'gain.eclipseCase': ({ view, gain, access }) => {
    const sc = view.scenario;
    const file = view.origin ? access?.[view.origin.insee] : null;
    if (!gain || !gain.shown || !file || sc.day === 'd09') return null;
    const on = (day: DayTypeId) =>
      new Set(computePoleStates(view.dataset.poles, file, 'transit', day, sc.budget).filter((x) => x.status === 'accessible').map((x) => x.id));
    const ref = on('d09');
    const now = on(sc.day);
    const eclipsed = [...ref].filter((id) => !now.has(id));
    if (!gain.gained.every((id) => eclipsed.includes(id))) return 'autre';
    return gain.gained.length === eclipsed.length ? 'toute' : 'partie';
  },
  /**
   * Acte 3 (contrôle de la constante HORIZON, non prononcé) : 'ecart' si les deux communes n'allument pas le
   * même nombre de pôles ; 'meme_horizon' si elles allument exactement les mêmes ; 'autant_pas_les_memes' sinon.
   */
  'compare.horizonCase': ({ view, compare }) => {
    if (!compare || !compare.origin || compare.accessMissing || !compare.totals.hasData || !view.totals.hasData) return null;
    const ids = (v: SkyView) => v.states.filter((x) => x.status === 'accessible').map((x) => x.id);
    const a = ids(view);
    const b = ids(compare);
    if (a.length !== b.length) return 'ecart';
    return a.every((id) => b.includes(id)) ? 'meme_horizon' : 'autant_pas_les_memes';
  },
  /** Acte 3 (contrôle, non prononcé) : la commune de comparaison allume-t-elle 'moins', 'plus' ou 'autant' de pôles ? */
  'compare.rankCase': ({ view, compare }) => {
    if (!compare || !compare.origin || compare.accessMissing || !compare.totals.hasData || !view.totals.hasData) return null;
    const a = view.totals.accessibleCount;
    const b = compare.totals.accessibleCount;
    if (b < a) return 'moins';
    return b > a ? 'plus' : 'autant';
  },
  /** Bilan de l'or (contrôle de la constante ACTE4, non prononcé) : gain, gain_et_perte, sans_gain */
  'gain.case': ({ gain }) => (gain ? (gain.shown ? (gain.lost.length ? 'gain_et_perte' : 'gain') : 'sans_gain') : null),
  'gain.lostStars': ({ gain }) => (gain && gain.lost.length ? starsOral(gain.lost.length) : null),
  /** Nombre de pôles peints en or (gain démontré face aux TC seuls, même journée, même temps de trajet) ; null sans or */
  'gain.stars': ({ gain }) => (gain && gain.shown && gain.gained.length ? starsOral(gain.gained.length) : null),
  'region.populationOral': ({ view }) => populationOral(regionPopulation(view.dataset.communes)),
  'access.stars': ({ view }) => (view.totals.hasData ? starsOral(view.totals.accessibleCount) : null),
  /**
   * Postes salariés (INSEE) atteints à l'aller ET au retour : le COMPTEUR du site (`totals.od.reachedAll`, table OD,
   * commune de départ hors du total, « hors votre commune ») quand le ciel est calculé sur la table OD. Hors table OD
   * (vélo + TC), somme des postes des astres allumés, commune de départ retranchée (point 4.1 du 05/11).
   */
  'access.jobsOral': (ctx) => {
    const { view } = ctx;
    if (!view.totals.hasData) return null;
    if (view.basis === 'od') return jobsOral(odReached(view));
    if (view.totals.jobs == null) return null;
    const self = selfJobsIn(
      ctx,
      view.states.filter((s) => s.status === 'accessible').map((s) => s.id),
    );
    return self == null ? null : jobsOral(view.totals.jobs - self);
  },
  /** Même valeur, première lettre en capitale : pour une phrase qui commence par le nombre (« Plus de 4,2 millions de postes seraient… ») */
  'access.jobsOralCap': (ctx) => {
    const v = VARIABLES['access.jobsOral']!(ctx);
    return typeof v === 'string' && v ? `${v.charAt(0).toUpperCase()}${v.slice(1)}` : v;
  },
  /** Compteur du site avant l'étape (même règle que `access.jobsOral`, ciel précédent) : « de A à B » à l'éclipse */
  'delta.fromJobsOral': ({ previous }) => jobsOral(odReached(previous)),
  /** Les deux compteurs du site à l'éclipse, sans le mot « postes » (la phrase le dit) : table OD seulement, sinon la visite s'arrête */
  'delta.fromJobsCount': ({ previous }) => withoutPostes(jobsOral(odReached(previous))),
  'access.jobsCount': ({ view }) => withoutPostes(jobsOral(odReached(view))),
  /**
   * Base de calcul du ciel de l'étape (contrôle, non prononcé) : 'od' = table commune x commune, celle du compteur et du
   * ciel du site pour les transports en commun et la voiture ; 'access' = journées-types (vélo + TC, seul calcul de ce
   * mode). La visite s'arrête si une étape n'est pas sur la base que le site affiche pour ce scénario.
   */
  'sky.basisCase': ({ view }) => (view.neutral ? null : view.basis),
  'delta.stars': (ctx) => {
    const d = stepDelta(ctx);
    return d ? starsOral(Math.abs(d.polesDelta)) : null;
  },
  /**
   * Écart de postes entre deux états du ciel. Table OD : différence des deux compteurs du site (postes atteints
   * avant et après, commune de départ hors des deux totaux). Sinon `access/` : postes des astres gagnés ou perdus,
   * sans la commune de départ (si son astre gagne ou perd, ses postes sortent de l'écart).
   */
  'delta.jobsOral': (ctx) => {
    const a = odReached(ctx.previous);
    const b = odReached(ctx.view);
    if (a != null && b != null) return jobsOral(Math.abs(a - b));
    const d = stepDelta(ctx);
    if (!d || d.jobsDelta == null) return null;
    const gainedSelf = selfJobsIn(ctx, d.gained);
    const lostSelf = selfJobsIn(ctx, d.lost);
    if (gainedSelf == null || lostSelf == null) return null;
    return jobsOral(Math.abs(d.jobsDelta - gainedSelf + lostSelf));
  },
  'day.startOral': ({ view }) => hourOral(dayOf(view)?.start),
  'day.endOral': ({ view }) => hourOral(dayOf(view)?.end),
  'compare.stars': ({ compare }) =>
    compare && compare.origin && !compare.accessMissing && compare.totals.hasData ? starsOral(compare.totals.accessibleCount) : null,
  // Une part n'est prononcée que si sa marge d'erreur à 95 % est connue (affichable à l'écran).
  'halo.transitF': ({ context }) => {
    const b = context?.commute_mode_by_sex;
    return b && b.status === 'ok' && b.margin95?.F?.transit != null ? percentOral(b.F.transit) : null;
  },
  'halo.transitH': ({ context }) => {
    const b = context?.commute_mode_by_sex;
    return b && b.status === 'ok' && b.margin95?.H?.transit != null ? percentOral(b.H.transit) : null;
  },
  /**
   * 'parts' si les intervalles part ± marge (TC, femmes et hommes) ne se recouvrent pas,
   * 'ecart_non_etabli' s'ils se recouvrent, null si une part ou une marge manque.
   * Sert à choisir la constante HALO du script (non prononcé tel quel).
   */
  'halo.transitGap': ({ context }) => {
    const b = context?.commute_mode_by_sex;
    if (!b || b.status !== 'ok') return null;
    const o = intervalsOverlap(b.F.transit, b.margin95?.F?.transit, b.H.transit, b.margin95?.H?.transit);
    return o == null ? null : o ? 'ecart_non_etabli' : 'parts';
  },
};

export interface ResolvedNarration {
  text: string;
  missing: string[];
}

export function resolveNarration(template: string, ctx: NarrationContext): ResolvedNarration {
  const missing: string[] = [];
  const text = template.replace(/\{([\w.]+)\}/g, (_, name: string) => {
    const fn = VARIABLES[name];
    const v = fn ? fn(ctx) : null;
    if (v == null) {
      missing.push(name);
      return '…';
    }
    return String(v);
  });
  return { text, missing };
}

/**
 * Contrôle des constantes de variante d'une étape (TourStep.checks) : chaque variable de contrôle doit
 * valoir exactement la valeur attendue par le script. Renvoie les écarts sous la forme
 * « nom=obtenu (attendu) », traités comme des variables manquantes : la visite s'arrête.
 */
export function checkVariables(checks: Readonly<Record<string, string>> | undefined, ctx: NarrationContext): string[] {
  if (!checks) return [];
  const out: string[] = [];
  for (const [name, expected] of Object.entries(checks)) {
    const fn = VARIABLES[name];
    const v = fn ? fn(ctx) : null;
    if (v == null || String(v) !== expected) out.push(`${name}=${v ?? 'null'} (attendu ${expected})`);
  }
  return out;
}
