/**
 * Bloc « Trajet » du panneau de preuve (demande de Nicolas du 11/11, D-066) : tuiles Durée, Coût, Carbone d'un sens et ligne
 * « aller et retour ». Fonctions PURES, testées (tripTiles.test.ts) : chaque valeur vient d'un itinéraire publié (D-028, ENV01), de
 * `subscriptions.json` (D-032) ou des distances routières (D-029) ; aucun chiffre n'est écrit ici. Le grand chiffre d'une tuile est
 * la valeur ; la petite ligne dessous est la garde courte (« estimation », « au ticket ») ; le reste va dans le « i » (D-064).
 */
import { formatInt } from './format';
import type { ItinCo2, ItinTrip } from './itineraries';
import { formatEur, r2, type ExtraTitle, type LegCost, type TransitOption } from './subscriptions';

export interface Tile {
  /** Grand chiffre, ou mots quand il n'y a pas de chiffre (« Prix inconnu », « Pas d'émission à l'usage ») */
  value: string;
  /** Garde courte sous le chiffre (« estimation », « au ticket ») ; null si rien */
  sub: string | null;
  /** Phrases du « i » de la tuile (portée, méthode, raison d'une valeur absente) ; vide : pas de « i » */
  tip: string[];
}

/** Durée d'un trajet détaillé (celle de l'itinéraire, pas forcément celle du verdict : l'écart est dans le « i » du bloc). */
export function durationTile(trip: Pick<ItinTrip, 'min'> | null | undefined): Tile {
  return typeof trip?.min === 'number' && Number.isFinite(trip.min) ? { value: `${formatInt(trip.min)}\u00a0min`, sub: null, tip: [] } : { value: 'Inconnue', sub: null, tip: [] };
}

/**
 * Coût d'un sens en transports en commun : ce que la personne paie, selon son abonnement (`transitLegCost`). Un prix inconnu est
 * écrit tel quel, jamais 0, jamais estimé ; la raison est dans le « i ».
 */
export function costTile(c: LegCost, option: TransitOption | null, extra: Record<string, ExtraTitle>, ticketDetail: string | null): Tile {
  const label = option?.label ?? 'abonnement';
  if (c.extra_eur === null || c.status === 'unknown' || c.status === 'no_trip') {
    return { value: 'Prix inconnu', sub: null, tip: c.reasons.length ? [`${cap(c.reasons.join(' ; '))}.`] : [] };
  }
  const value = formatEur(c.extra_eur);
  if (c.status === 'included') return { value, sub: `inclus, ${label}`, tip: [] };
  if (c.status === 'extra') {
    const what = c.items.map((i) => `${i.count > 1 ? `${i.count} x ` : ''}${extra[i.title]?.label ?? i.title}`).join(', ');
    return { value, sub: `en plus, ${label}`, tip: [`En plus de votre ${label} : ${what}, non couvert.`] };
  }
  // Trajet entièrement à pied (aucun titre publié pour ce sens) : « à pied, aucun ticket », comme la ligne au ticket d'avant
  if (c.extra_eur === 0 && !ticketDetail) return { value, sub: 'à pied, aucun ticket', tip: [] };
  const tip = [`Au ticket, plein tarif${ticketDetail ? ` (${ticketDetail})` : ''}.`];
  if (c.street_transfer_unverified) tip.push('Correspondance par la rue à vérifier.');
  return { value, sub: 'au ticket', tip };
}

/** Carbone d'un sens (ENV01) : valeur publiée, « estimation » dessous (facteur moyen, jamais une mesure) ; sinon la raison publiée. */
export function carbonTile(co2: ItinCo2 | null | undefined, guard: string): Tile {
  if (co2?.status === 'ok' && typeof co2.value === 'number' && Number.isFinite(co2.value)) {
    return { value: `${formatInt(co2.value)}\u00a0g CO2e`, sub: 'estimation', tip: [guard] };
  }
  return { value: 'Non calculé', sub: null, tip: co2?.reason ? [`${cap(co2.reason)}.`] : [] };
}

/**
 * Ligne « aller et retour » du trajet retenu : « Aller et retour : 91 min · 5,10 € au ticket · environ 186 g CO2e (estimation) ».
 * Une partie n'est écrite que si les DEUX sens la donnent (jamais un total partiel) ; null si aucun sens n'est détaillé.
 */
export function roundTripLine(p: {
  out: ItinTrip | null;
  ret: ItinTrip | null;
  outCost: LegCost | null;
  retCost: LegCost | null;
  option: TransitOption | null;
}): string | null {
  const { out, ret, outCost, retCost, option } = p;
  if (!out || !ret) return null;
  const parts: string[] = [];
  if (typeof out.min === 'number' && typeof ret.min === 'number') parts.push(`${formatInt(out.min + ret.min)}\u00a0min`);
  const known = (c: LegCost | null) => (c && c.extra_eur !== null && c.status !== 'unknown' && c.status !== 'no_trip' ? c.extra_eur : null);
  const co = known(outCost);
  const cr = known(retCost);
  if (co !== null && cr !== null) {
    const total = r2(co + cr);
    parts.push(option ? (total === 0 ? `rien en plus de votre ${option.label ?? option.id}` : `${formatEur(total)} en plus de votre ${option.label ?? option.id}`) : `${formatEur(total)} au ticket`);
  }
  const g = (c: ItinCo2 | undefined) => (c?.status === 'ok' && typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : null);
  const go = g(out.co2_g);
  const gr = g(ret.co2_g);
  if (go !== null && gr !== null) parts.push(`environ ${formatInt(go + gr)}\u00a0g CO2e (estimation)`);
  return parts.length ? `Aller et retour : ${parts.join(' · ')}` : null;
}

/* ------------------------------------------------------------------ vélo */

/**
 * Carbone du vélo personnel : aucune source retenue du projet ne publie un facteur du vélo (ENV01 : bus, métro, RER et train, tram ;
 * ENV02 : véhicules à moteur ; l'API Impact CO2 de l'ADEME est écartée). Donc des mots, jamais un chiffre (D-066).
 */
export const BIKE_CARBON: Tile = {
  value: "Pas d'émission à l'usage",
  sub: null,
  tip: [
    'Vélo personnel : aucun carburant pendant le trajet.',
    "La recharge d'un vélo à assistance électrique n'est pas comptée, ni la fabrication et l'entretien du vélo.",
    "Aucune source retenue par le projet ne publie de facteur d'émission du vélo : pas de chiffre.",
  ],
};

const kmhFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Carbone du vélo seul : la tuile sans chiffre, et dessous la vitesse du calcul lue dans `meta.speeds.bike_kmh` (« vitesse du calcul : 12 km/h »,
 * arbitrage du 12/11 : aucun mot qui interprète le réglage du moteur) ; vitesse non publiée : aucun sous-libellé.
 */
export function bikeCarbonTile(bikeKmh: number | null | undefined): Tile {
  const ok = typeof bikeKmh === 'number' && Number.isFinite(bikeKmh) && bikeKmh > 0;
  return { ...BIKE_CARBON, sub: ok ? `vitesse du calcul : ${kmhFmt.format(bikeKmh)}\u00a0km/h` : null };
}

/**
 * « i » du titre du bloc « Trajet » en vélo + TC (demande de Nicolas, 13/11) : ce mode n'a que sa durée, pas d'itinéraire ligne
 * par ligne (lignes, horaires, correspondances), contrairement aux transports en commun seuls.
 */
export const BIKE_TRANSIT_DETAIL: readonly string[] = [
  "En vélo + transports en commun, seule la durée est calculée : c'est elle qui fait le verdict, en tête de la fiche.",
  "Le détail du trajet (gare où laisser le vélo, lignes, horaires, correspondances) n'est pas calculé pour ce mode, ni donc le coût et le carbone de la partie en transports en commun.",
  'Pour un trajet détaillé ligne par ligne, choisissez le mode « Transports en commun ».',
];

/** Partie en transports en commun d'un trajet vélo + TC : pas d'itinéraire détaillé publié, donc ni prix ni carbone. */
export const BIKE_TRANSIT_TC: Tile = {
  value: 'Non calculé',
  sub: 'partie en transports en commun',
  tip: ['Coût et carbone : calculés pour les transports en commun seulement.'],
};

function cap(s: string): string {
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}
