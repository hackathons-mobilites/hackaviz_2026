/**
 * Abonnements (D-032 proposée) : coût d'un trajet publié pour une personne qui a tel abonnement. Fonctions PURES,
 * copie exacte de `pipeline/starway/subscriptions.py` ; les deux rejouent les mêmes cas
 * (`subscriptionCases.json`, lu par vitest et par pytest) pour donner le même résultat.
 *
 * Contrat : `subscriptions.json` (`contract` « subscriptions-1 », écrit par `scripts/06i_export_subscriptions.py`).
 * Règle : coût d'un sens = ce qu'il faut payer EN PLUS de l'abonnement sur l'itinéraire publié (D-028) ; une
 * couverture non écrite dans les sources (`unknown`) donne `null` et une raison, jamais 0 ; le prix d'un abonnement
 * est affiché à côté, jamais divisé par un nombre de trajets (aucune source ne donne les jours travaillés).
 */
import { nbsp } from './format';
import { seriesFit } from './seriesGuard';
import type { ItinLeg, ItinTickets, ItinTrip } from './itineraries';

export type Cover = 'yes' | 'no' | 'unknown';
export type Family = 'rail' | 'surface' | 'ter' | 'airport_rail' | 'orlyval';

export interface SourceQuote {
  source_id: string;
  file: string;
  quote: string;
  read_with?: string;
}

export interface Price {
  eur: number | null;
  per: 'month' | 'week' | 'year' | 'day' | 'ride';
  text?: string;
  year_eur?: number;
  reason?: string;
  variants?: { label: string; eur: number }[];
  quotes?: SourceQuote[];
}

export interface TransitOption {
  id: string;
  label?: string;
  /** `pass` : abonnement ; `day` : titre d'une journée (son prix s'ajoute une fois à l'aller-retour) */
  kind: 'pass' | 'day';
  audience?: 'all' | 'conditions';
  zones?: string;
  price: Price;
  covers: Record<Family, Cover>;
  unknown_reasons: Partial<Record<Family, string>>;
  cover_quotes?: SourceQuote[];
  employer?: boolean;
  employer_note?: string;
  bike_parking?: boolean;
  conditions?: string | null;
}

export interface ExtraTitle {
  label: string;
  eur: number;
}

export interface VelibOffer {
  id: string;
  label?: string;
  kind: 'ride' | 'subscription' | 'day';
  audience?: string;
  price: Price;
  ride: { included_min: number; step_min: number; per_ride_eur: number | null; beyond_eur: number | null; cap_eur: number | null; beyond_reason?: string };
  employer?: boolean;
}

export interface NotProposed {
  id: string;
  label: string;
  reason: string;
}

export interface SubscriptionsFile {
  contract: string;
  service_date: string;
  price_validity?: string;
  decision?: string;
  transit: { options: TransitOption[]; extra_titles: Record<string, ExtraTitle>; unit_tickets?: Record<string, { label: string; eur: number }>; unpriced_agencies?: Record<string, string>; not_proposed: NotProposed[] };
  velib: { offers: VelibOffer[]; rides: Record<string, { out: (number | null)[]; ret: (number | null)[] }>; rides_rule?: string };
  bike: { personal: { text: string }; parking: { text: string; scope: string; without: string; options: string[] } };
  car: { options: unknown[]; status: string; reason: string };
  employer: { text: string; scope: string; to_verify?: string };
  texts: Record<string, string>;
}

export function isSubscriptionsFile(v: unknown): v is SubscriptionsFile {
  if (!v || typeof v !== 'object') return false;
  const f = v as Partial<SubscriptionsFile>;
  return typeof f.contract === 'string' && f.contract.startsWith('subscriptions-') && !!f.transit && Array.isArray(f.transit.options) && !!f.velib;
}

/** Trajet tel que publié (sous-ensemble d'`ItinTrip` utile au calcul). */
export type TripLike = Pick<ItinTrip, 'status'> & { legs?: (Pick<ItinLeg, 'm' | 'line'> & { agency?: string | null })[]; tickets?: Partial<ItinTickets> & { status: string } };

export interface LegCost {
  status: 'no_trip' | 'unknown' | 'tickets' | 'included' | 'extra';
  extra_eur: number | null;
  items: { title: string; count: number }[];
  reasons: string[];
  street_transfer_unverified?: boolean;
}

const ORLYVAL_LINE = 'ORLYVAL';

/** Arrondi au centime, même règle que le pipeline (`math.floor(x * 100 + 0.5 + 1e-7) / 100`). */
export function r2(x: number): number {
  return Math.floor(x * 100 + 0.5 + 1e-7) / 100;
}

export function legCounts(legs: readonly Pick<ItinLeg, 'm' | 'line'>[]): { orlyval: number; ter: number } {
  const rides = legs.filter((l) => l.m !== 'walk');
  return { orlyval: rides.filter((l) => l.line === ORLYVAL_LINE).length, ter: rides.filter((l) => l.m === 'ter').length };
}

/** Raisons des tronçons d'un exploitant sans titre relevé (`transit.unpriced_agencies`). */
export function unpricedReasons(legs: readonly { agency?: string | null }[], unpriced: Record<string, string>): string[] {
  const seen: string[] = [];
  for (const l of legs) {
    const why = unpriced[l.agency ?? ''];
    if (why && !seen.includes(why)) seen.push(why);
  }
  return seen;
}

/** Coût d'un sens TC publié pour `option` (null = aucun abonnement, tickets à l'unité). */
export function transitLegCost(trip: TripLike | null | undefined, option: TransitOption | null, extra: Record<string, ExtraTitle>, unpriced: Record<string, string> = {}): LegCost {
  if (!trip || trip.status !== 'ok') return { status: 'no_trip', extra_eur: null, items: [], reasons: [] };
  const tk = trip.tickets ?? { status: 'unknown' };
  const street = tk.status === 'street_transfer_unverified';
  const blocked = unpricedReasons(trip.legs ?? [], unpriced);
  if (blocked.length) return { status: 'unknown', extra_eur: null, items: [], reasons: blocked, street_transfer_unverified: street };
  if (tk.status === 'unknown' || tk.cost_eur === null || tk.cost_eur === undefined) {
    return { status: 'unknown', extra_eur: null, items: [], reasons: [...(tk.reasons ?? [])], street_transfer_unverified: street };
  }
  if (option === null) return { status: 'tickets', extra_eur: r2(tk.cost_eur), items: [], reasons: [], street_transfer_unverified: street };
  const cov = option.covers;
  const counts = legCounts(trip.legs ?? []);
  const reasons: string[] = [];
  const items: { title: string; count: number }[] = [];
  if (counts.ter && cov.ter !== 'yes') reasons.push(option.unknown_reasons.ter ?? 'TER : couverture non écrite dans les sources lues');
  const airport = tk.airport ?? 0;
  if (airport) {
    if (cov.airport_rail === 'unknown') reasons.push(option.unknown_reasons.airport_rail ?? 'aéroports : couverture non écrite');
    else if (cov.airport_rail === 'no') items.push({ title: 'airport_ticket', count: airport });
  }
  if (counts.orlyval && cov.airport_rail !== 'no') {
    if (cov.orlyval === 'unknown') reasons.push(option.unknown_reasons.orlyval ?? 'Orlyval : couverture non écrite');
    else if (cov.orlyval === 'no') items.push({ title: 'orlyval_ticket', count: counts.orlyval });
  }
  if (reasons.length) return { status: 'unknown', extra_eur: null, items: [], reasons, street_transfer_unverified: false };
  const sum = items.reduce((s, i) => s + (extra[i.title]?.eur ?? Number.NaN) * i.count, 0);
  if (Number.isNaN(sum)) return { status: 'unknown', extra_eur: null, items: [], reasons: ['titre complémentaire non publié'], street_transfer_unverified: false };
  return {
    status: items.length ? 'extra' : 'included',
    extra_eur: r2(sum),
    items,
    reasons: [],
    street_transfer_unverified: street && items.some((i) => i.title === 'airport_ticket'),
  };
}

export interface RoundTripCost {
  out: LegCost;
  ret: LegCost;
  /** Ce que la personne paie pour l'aller-retour en plus de son abonnement (titre d'un jour compris) ; null sinon */
  total_eur: number | null;
}

export function transitRoundTrip(out: TripLike | null | undefined, ret: TripLike | null | undefined, option: TransitOption | null, extra: Record<string, ExtraTitle>, unpriced: Record<string, string> = {}): RoundTripCost {
  const o = transitLegCost(out, option, extra, unpriced);
  const r = transitLegCost(ret, option, extra, unpriced);
  let total: number | null = null;
  if (o.extra_eur !== null && r.extra_eur !== null) {
    total = o.extra_eur + r.extra_eur;
    if (option?.kind === 'day' && option.price.eur !== null) total += option.price.eur;
    total = r2(total);
  }
  return { out: o, ret: r, total_eur: total };
}

/** Tranches de `step` minutes facturées au-delà des `included` premières (CGAU : 29 min 59 s = 30 premières minutes). */
export function slicesBeyond(rideMin: number, included: number, step = 30): number {
  if (rideMin < 0) throw new RangeError('durée négative');
  if (rideMin < included) return 0;
  return Math.floor((rideMin - included) / step) + 1;
}

export interface RideCost {
  status: 'no_trip' | 'unknown' | 'included' | 'paid';
  eur: number | null;
  reason: string | null;
}

/** Coût d'une course Vélib' mécanique (durée de la partie vélo, minutes entières). */
export function velibRideCost(rideMin: number | null | undefined, offer: VelibOffer): RideCost {
  if (rideMin === null || rideMin === undefined) return { status: 'no_trip', eur: null, reason: null };
  const rule = offer.ride;
  const n = slicesBeyond(rideMin, rule.included_min, rule.step_min);
  if (n && rule.beyond_eur === null) return { status: 'unknown', eur: null, reason: rule.beyond_reason ?? null };
  let eur = (rule.per_ride_eur ?? 0) + n * (rule.beyond_eur ?? 0);
  if (rule.cap_eur !== null) eur = Math.min(eur, rule.cap_eur);
  eur = r2(eur);
  return { status: eur === 0 ? 'included' : 'paid', eur, reason: null };
}

export function velibRoundTrip(outMin: number | null | undefined, retMin: number | null | undefined, offer: VelibOffer): { out: RideCost; ret: RideCost; total_eur: number | null } {
  const o = velibRideCost(outMin, offer);
  const r = velibRideCost(retMin, offer);
  let total: number | null = null;
  if (o.eur !== null && r.eur !== null) total = r2(o.eur + r.eur + (offer.kind === 'day' && offer.price.eur !== null ? offer.price.eur : 0));
  return { out: o, ret: r, total_eur: total };
}

// ------------------------------------------------------------------ textes (aucun chiffre écrit en dur)

const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

export function formatEur(v: number): string {
  return nbsp(eurFmt.format(v));
}

const PER: Record<Price['per'], string> = { month: 'par mois', week: 'par semaine', year: 'par an', day: 'par jour', ride: 'la course' };

/** « 90,80 € par mois » ; prix non publié : la raison (ex. Améthyste, fixé par le département). */
export function priceText(p: Price): string {
  if (p.eur === null) return p.text ?? p.reason ?? 'prix non publié';
  if (p.eur === 0) return 'gratuit';
  return `${formatEur(p.eur)} ${PER[p.per]}`;
}

/** Phrase d'un sens pour la personne. */
export function legCostText(c: LegCost, extra: Record<string, ExtraTitle>, leg: 'out' | 'ret'): string | null {
  const sens = leg === 'out' ? 'Aller' : 'Retour';
  switch (c.status) {
    case 'no_trip':
      return null;
    case 'unknown':
      return `${sens} : coût non calculé${c.reasons.length ? ` (${c.reasons.join(' ; ')})` : ''}.`;
    case 'included':
      return `${sens} : inclus dans votre abonnement.`;
    case 'tickets':
      return `${sens} : ${formatEur(c.extra_eur ?? 0)} au ticket${c.street_transfer_unverified ? ' (correspondance par la rue à vérifier)' : ''}.`;
    case 'extra': {
      const what = c.items.map((i) => `${i.count > 1 ? `${i.count} x ` : ''}${extra[i.title]?.label ?? i.title}`).join(', ');
      return `${sens} : ${formatEur(c.extra_eur ?? 0)} en plus (${what}, non couvert par votre abonnement).`;
    }
  }
}

/**
 * Suite de la phrase du prix au ticket : ce qu'un forfait Navigo Mois change pour CE trajet, d'après ses tronçons publiés
 * (D-032). Jamais « inclus » sans contrôle : Orlyval reste à payer, un sens non calculé est dit. `file` encore absent :
 * renvoi général, vrai pour tout trajet.
 */
export function navigoTripNote(file: SubscriptionsFile | null | undefined, out: TripLike | null | undefined, ret: TripLike | null | undefined): string {
  const general = 'avec un forfait Navigo, hors titres non couverts : voir « Selon vos abonnements »';
  const option = file?.transit.options.find((o) => o.id === 'navigo_month');
  if (!file || !option) return general;
  const { out: o, ret: r } = transitRoundTrip(out, ret, option, file.transit.extra_titles, file.transit.unpriced_agencies ?? {});
  const sides = ([['aller', o], ['retour', r]] as const).filter(([, c]) => c.status !== 'no_trip');
  if (sides.length === 0 || sides.some(([, c]) => c.status === 'unknown')) return general;
  const name = option.label ?? 'forfait Navigo Mois';
  const extras = sides.filter(([, c]) => c.status === 'extra');
  if (extras.length === 0) return sides.length === 2 ? `avec un ${name}, le trajet est inclus` : `avec un ${name}, ce sens est inclus`;
  const labels = (c: LegCost) => c.items.map((i) => (file.transit.extra_titles[i.title]?.label ?? i.title).toLowerCase()).join(', ');
  const what = extras.map(([s, c]) => `${labels(c)} ${s === 'aller' ? 'à l’aller' : 'au retour'}`).join(' et ');
  return `avec un ${name}, reste à payer : ${what} (voir « Selon vos abonnements »)`;
}

/** Titres tout public qui couvriraient l'aller ET le retour sans rien payer en plus (sauf le titre d'un jour lui-même). */
export function coveringOptions(file: SubscriptionsFile, out: TripLike | null | undefined, ret: TripLike | null | undefined): TransitOption[] {
  return file.transit.options.filter((o) => {
    if (o.audience !== 'all') return false;
    const rt = transitRoundTrip(out, ret, o, file.transit.extra_titles, file.transit.unpriced_agencies ?? {});
    return rt.out.status === 'included' && rt.ret.status === 'included';
  });
}

/**
 * Durées Vélib' (par position d'astre). Garde de longueur (arbitrage du 05/11) : une série d'un autre nombre d'astres que
 * `polesCount` est refusée (null : non calculé), jamais lue par position.
 */
export function velibRides(
  file: SubscriptionsFile,
  insee: string,
  poleIndex: number,
  polesCount: number,
): { out: number | null; ret: number | null } | null {
  const r = file.velib.rides[insee];
  if (!r || poleIndex < 0 || !seriesFit(polesCount, r.out) || !seriesFit(polesCount, r.ret)) return null;
  return { out: r.out[poleIndex] ?? null, ret: r.ret[poleIndex] ?? null };
}
