/**
 * Pli « Coût » / « Coût et carbone » du panneau de preuve (audit d'affichage du 10/11, demande de Nicolas) : UNE ligne de coût
 * selon le cas, le carbone juste dessous, puis les titres qui couvriraient le trajet. Fonctions PURES, testées
 * (costLines.test.ts) ; chaque valeur vient des données publiées (itinéraires D-028, subscriptions.json D-032, ENV01),
 * aucun chiffre n'est écrit ici. Le prix d'un abonnement est affiché à côté, jamais divisé (D-032).
 */
import type { DayType, DayTypeId } from './types';
import type { CarbonFact, ItinTrip, TicketFact } from './itineraries';
import { formatInt } from './format';
import { formatEur, priceText, type ExtraTitle, type RoundTripCost, type TransitOption } from './subscriptions';

const low = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

/** « 2 h » ou « 90 min » : durée maximale d'un trajet calculé (meta.max_trip_min) ; null si absente. */
export function tripLimitText(maxTripMin: number | null | undefined): string | null {
  if (typeof maxTripMin !== 'number' || !(maxTripMin > 0)) return null;
  return maxTripMin % 60 === 0 ? `${maxTripMin / 60}\u00a0h` : `${maxTripMin}\u00a0min`;
}

/** « un sens n'a pas de trajet de 2 h ou moins » : raison commune au coût et au carbone quand un sens manque. */
export function missingLegReason(maxTripMin: number | null | undefined): string {
  const lim = tripLimitText(maxTripMin);
  return `un sens n'a pas de trajet${lim ? ` de ${lim} ou moins` : ''}`;
}

const legEur = (t: TicketFact) => (t.eur === 0 && !t.detail ? 'à pied' : formatEur(t.eur));

/**
 * Ligne « Au ticket » (aucun abonnement choisi) : « Au ticket : aller 2,55 €, retour 2,55 € (trajet de l'exemple). » Le total
 * aller-retour est le chiffre du pli fermé (audit d'affichage du 11/11, K1 : il n'est plus redit ici). Seulement si les deux sens ont
 * un prix sûr (jamais un total partiel) ; sinon null.
 */
export function ticketLine(out: TicketFact | null, ret: TicketFact | null): string | null {
  if (!out || !ret) return null;
  return `Au ticket : aller ${legEur(out)}, retour ${legEur(ret)} (trajet de l'exemple).`;
}

/** Contenu du « i » de la ligne au ticket : les titres de chaque sens (« Aller : 1 ticket Métro-Train-RER. »). */
export function ticketDetailLines(out: TicketFact | null, ret: TicketFact | null): string[] {
  const one = (t: TicketFact | null, side: string) => (t ? `${side} : ${t.detail || 'à pied, aucun ticket'}.` : null);
  return [one(out, 'Aller'), one(ret, 'Retour')].filter((x): x is string => !!x);
}

/**
 * Pourquoi le coût au ticket n'est pas affiché (raisons publiées, sans doublon) : sens sans trajet, correspondance par la rue
 * à vérifier, prix inconnu avec sa raison. Liste vide si les deux sens ont un prix sûr.
 */
export function ticketMissingReasons(
  out: ItinTrip | null | undefined,
  ret: ItinTrip | null | undefined,
  maxTripMin: number | null | undefined,
): string[] {
  const reasons: string[] = [];
  const add = (r: string) => {
    if (r && !reasons.includes(r)) reasons.push(r);
  };
  for (const t of [out, ret]) {
    if (!t) {
      add(missingLegReason(maxTripMin));
      continue;
    }
    const k = t.tickets;
    if (k?.status === 'ok' && k.cost_eur != null && Number.isFinite(k.cost_eur)) continue;
    if (k?.status === 'street_transfer_unverified') add('une correspondance par la rue entre deux gares reste à vérifier');
    else {
      const why = (k?.reasons ?? []).filter(Boolean);
      if (why.length) why.forEach(add);
      else add('prix non publié');
    }
  }
  return reasons;
}

/** « Coût non calculé : <raisons>. » */
export function costMissingText(reasons: readonly string[]): string {
  return `Coût non calculé : ${reasons.join(' ; ')}.`;
}

/** Noms joints : « Navigo Mois, Navigo Semaine ou Navigo Annuel ». */
export function joinOr(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}`;
}

/**
 * Ligne des abonnements qui couvriraient l'aller ET le retour (aucun abonnement choisi), sans le « i » ni le point :
 * « Avec un Navigo Mois, Navigo Semaine ou Navigo Annuel : rien à payer en plus, hors coût de l'abonnement ».
 * Seuls les abonnements (`kind: pass`) sont nommés : un titre d'un jour s'ajoute au prix, il est dans le « i » avec son prix.
 */
export function coverLine(cover: readonly TransitOption[]): { lead: string; tail: string } | null {
  const names = cover.filter((o) => o.kind === 'pass').map((o) => o.label ?? o.id);
  if (names.length === 0) return null;
  return { lead: `Avec un ${joinOr(names)} : rien à payer en plus, `, tail: "hors coût de l'abonnement" };
}

/** « Navigo Mois : 90,80 € par mois, toutes zones » : chaque titre du « i » avec son prix publié (SUB01). */
export function optionPriceLine(o: TransitOption): string {
  return `${o.label ?? o.id} : ${o.price.text ?? priceText(o.price)}${o.kind === 'day' ? " (titre d'un jour, aller et retour du même jour)" : ''}.`;
}

/** Ce qui reste à payer avec un abonnement : « ticket Orlyval à l'aller et au retour ». */
function extrasText(rt: RoundTripCost, extra: Record<string, ExtraTitle>): string {
  const label = (title: string) => low(extra[title]?.label ?? title);
  const side = (c: RoundTripCost['out']) => c.items.map((i) => `${i.count > 1 ? `${i.count} x ` : ''}${label(i.title)}`).join(', ');
  const o = rt.out.status === 'extra' ? side(rt.out) : null;
  const r = rt.ret.status === 'extra' ? side(rt.ret) : null;
  if (o && r && o === r) return `${o} à l'aller et au retour`;
  return [o ? `${o} à l'aller` : null, r ? `${r} au retour` : null].filter(Boolean).join(' et ');
}

/**
 * Ligne de coût avec un abonnement choisi (`kind: pass`), sans le « i » ni le point final :
 * - tout couvert : « Avec votre Navigo Mois (90,80 € par mois, toutes zones) : rien à payer en plus pour ce trajet, » + tail ;
 * - supplément : « … : reste à payer 28,00 € (ticket Orlyval à l'aller et au retour), » + tail ;
 * - inconnu (couverture non écrite, sens sans trajet) : « … : coût non calculé pour ce trajet (raisons) », sans tail.
 * `tail` = « hors coût de l'abonnement » : le « i » qui suit donne la règle (jamais divisé) et la prise en charge par l'employeur.
 */
export function passLine(
  option: TransitOption,
  rt: RoundTripCost,
  extra: Record<string, ExtraTitle>,
  maxTripMin: number | null | undefined,
): { lead: string; tail: string | null } {
  const head = `Avec votre ${option.label ?? option.id} (${option.price.text ?? priceText(option.price)}) : `;
  if (rt.total_eur === 0) return { lead: `${head}rien à payer en plus pour ce trajet, `, tail: "hors coût de l'abonnement" };
  if (rt.total_eur !== null) return { lead: `${head}reste à payer ${formatEur(rt.total_eur)} (${extrasText(rt, extra)}), `, tail: "hors coût de l'abonnement" };
  const reasons: string[] = [];
  for (const c of [rt.out, rt.ret]) {
    const rs = c.status === 'no_trip' ? [missingLegReason(maxTripMin)] : c.reasons;
    for (const r of rs) if (r && !reasons.includes(r)) reasons.push(r);
  }
  return { lead: `${head}coût non calculé pour ce trajet${reasons.length ? ` (${reasons.join(' ; ')})` : ''}`, tail: null };
}

/** Chiffre du titre du pli avec un abonnement choisi : « rien en plus de votre abonnement » ou « 28,00 € en plus de votre abonnement ». */
export function passFigure(option: TransitOption, rt: RoundTripCost): string | null {
  if (rt.total_eur === null) return null;
  if (option.kind === 'day') return `Aller et retour : ${formatEur(rt.total_eur)} avec un ${option.label ?? option.id}`;
  return rt.total_eur === 0 ? 'rien en plus de votre abonnement' : `${formatEur(rt.total_eur)} en plus de votre abonnement`;
}

/* ------------------------------------------------------------------ carbone */

/** « Carbone : environ 100 g CO2e aller et retour » : la suite, « (estimation i). », est posée par le composant. */
export function carbonLine(fact: CarbonFact): string {
  return `Carbone : environ ${formatInt(fact.totalG)}\u00a0g CO2e aller et retour`;
}

/** Première phrase du « i » du carbone : le détail par sens. */
export function carbonLegsText(fact: CarbonFact): string {
  return `Aller ${formatInt(fact.outG)}\u00a0g, retour ${formatInt(fact.retG)}\u00a0g.`;
}

/**
 * Carbone non affiché alors que le pli montre un coût : raisons publiées (facteur absent : `co2_g.reason`) et sens sans trajet,
 * « Carbone non calculé : un sens n'a pas de trajet de 2 h ou moins. » ; null si rien à dire.
 */
export function carbonMissingText(published: readonly string[], legMissing: boolean, maxTripMin: number | null | undefined): string | null {
  const reasons = [...(legMissing ? [missingLegReason(maxTripMin)] : []), ...published].filter((r, i, a) => !!r && a.indexOf(r) === i);
  return reasons.length ? `Carbone non calculé : ${reasons.join(' ; ')}.` : null;
}

/* ------------------------------------------------------------------ sans itinéraire */

export type NoItineraryCost = 'shift' | 'compare' | 'bike_transit';

/**
 * Phrase du pli quand aucun itinéraire n'est calculé pour ce scénario, et chiffre lu sur le pli fermé :
 * horaires libres (journées-types lues dans meta.day_types), comparaison, vélo + TC. `carbon` : le mode a un carbone ailleurs
 * (TC, vélo + TC, voiture) ; faux pour Vélib' (« Coût : … »).
 */
export function noItineraryCostText(kind: NoItineraryCost, dayLabels: readonly string[], carbon = true): { text: string; figure: string | null } {
  const what = carbon ? 'Coût et carbone : calculés' : 'Coût : calculé';
  switch (kind) {
    case 'shift':
      return { text: `${what} en journée-type seulement${dayLabels.length ? ` (${dayLabels.join(', ')})` : ''}.`, figure: `non ${carbon ? 'calculés' : 'calculé'} en horaires libres` };
    case 'compare':
      return { text: `${what} pour une seule commune, hors comparaison.`, figure: 'hors comparaison' };
    case 'bike_transit':
      return { text: `${what} pour les transports en commun seulement.`, figure: null };
  }
}

/* ------------------------------------------------------------------ journée-type la plus proche */

const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? NaN) * 60 + (m ?? NaN);
};
const circ = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
};

/**
 * Journée-type la plus proche d'horaires libres (écart du début + écart de la fin, sur 24 h) : le bouton « Voir l'exemple en
 * journée 9h-17h » l'applique, rien n'est déduit des horaires libres. Égalité : la première de meta.day_types. null si aucune.
 */
export function nearestDayType(dayTypes: readonly DayType[], shift: { start: number; end: number }): DayTypeId | null {
  let best: { id: DayTypeId; d: number } | null = null;
  for (const dt of dayTypes) {
    const d = circ(clock(dt.start), shift.start) + circ(clock(dt.end), shift.end);
    if (Number.isFinite(d) && (!best || d < best.d)) best = { id: dt.id, d };
  }
  return best?.id ?? null;
}
