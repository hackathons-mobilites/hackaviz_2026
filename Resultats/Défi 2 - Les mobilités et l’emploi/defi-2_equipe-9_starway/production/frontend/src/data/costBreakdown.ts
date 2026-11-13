/**
 * Parts de chaque dépense dans le coût d'un sens (demande de Nicolas du 12/11 : « un rond qui met le % du rond pour chaque dépense :
 * si c'est juste métro, 100 % métro ; si voiture, une part pour l'énergie, une pour le péage »). Fonctions PURES, testées
 * (costBreakdown.test.ts) : chaque montant vient d'un itinéraire publié (nombre de tickets, D-028), des prix à l'unité de
 * `subscriptions.json` (`transit.unit_tickets`, COST02) ou des faits de la voiture (D-029). Aucune autre dépense n'est inventée
 * (ni usure, ni assurance : aucune source retenue) et rien n'est dessiné si les parts ne retombent pas sur le total publié.
 */
import type { CarLegFacts } from './carCost';
import { euro, euroRange } from './carCostChart';
import type { ItinTickets } from './itineraries';

/** Prix à l'unité d'un ticket (`subscriptions.json`, `transit.unit_tickets`) */
export interface UnitTicket {
  label: string;
  eur: number;
}

export interface CostSlice {
  id: string;
  /** « Ticket Métro-Train-RER », « Énergie : SP95-E10 », « Péage » */
  label: string;
  eur: number;
  /** Part entière en %, la somme des parts fait 100 */
  pct: number;
  /** « 2 tickets x 2,55 € » ; null si rien à ajouter */
  detail: string | null;
  /** Motif hachuré (le péage, comme dans le graphique de la voiture) : la part ne repose jamais sur la seule couleur */
  hatched: boolean;
}

export interface CostBreakdown {
  slices: CostSlice[];
  totalEur: number;
  /** Précision à écrire sous l'anneau (péage connu en fourchette) ; null sinon */
  note: string | null;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Parts entières qui font exactement 100 (méthode du plus fort reste) ; tableau vide si le total n'est pas positif. */
export function percentShares(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [];
  const exact = values.map((v) => (v / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}

const TICKET_KINDS = ['metro_train_rer', 'bus_tram', 'airport'] as const;

/**
 * Transports en commun, au ticket : une part par type de ticket (nombre x prix à l'unité). null si le sens n'a pas de prix sûr, si un prix
 * à l'unité manque, si le trajet est entièrement à pied (aucun ticket) ou si la somme ne retombe pas sur le coût publié.
 */
export function ticketBreakdown(tickets: ItinTickets | null | undefined, unit: Readonly<Record<string, UnitTicket>> | null | undefined): CostBreakdown | null {
  if (!tickets || tickets.status !== 'ok' || tickets.cost_eur == null || !unit) return null;
  const parts: { id: string; label: string; eur: number; detail: string | null }[] = [];
  for (const kind of TICKET_KINDS) {
    const n = tickets[kind];
    if (!n || n <= 0) continue;
    const u = unit[kind];
    if (!u || !Number.isFinite(u.eur)) return null;
    parts.push({ id: kind, label: u.label, eur: r2(n * u.eur), detail: n > 1 ? `${n} tickets x ${euro(u.eur)}` : null });
  }
  if (!parts.length) return null;
  const total = r2(parts.reduce((s, p) => s + p.eur, 0));
  if (Math.abs(total - tickets.cost_eur) > 0.005) return null;
  const pct = percentShares(parts.map((p) => p.eur));
  return { slices: parts.map((p, i) => ({ ...p, pct: pct[i]!, hatched: false })), totalEur: total, note: null };
}

/**
 * Voiture, un sens : l'énergie et le péage. Le péage connu seulement en fourchette est compté à son bas (dit sous l'anneau). null si
 * le péage est interdit ou inconnu, ou si l'énergie manque : aucune part n'est devinée.
 */
export function carBreakdown(f: Pick<CarLegFacts, 'energy' | 'toll'>, energyLabel: string): CostBreakdown | null {
  const energy = f.energy;
  const toll = f.toll;
  if (energy == null || !toll) return null;
  const energySlice = { id: 'energy', label: `Énergie : ${energyLabel}`, eur: r2(energy), detail: null, hatched: false };
  if (toll.status === 'sans_peage') {
    return { slices: [{ ...energySlice, pct: 100 }], totalEur: energySlice.eur, note: null };
  }
  if (toll.min == null) return null;
  const tollEur = r2(toll.min);
  const total = r2(energySlice.eur + tollEur);
  if (!(total > 0)) return null;
  const pct = percentShares([energySlice.eur, tollEur]);
  const slices: CostSlice[] = [
    { ...energySlice, pct: pct[0]! },
    { id: 'toll', label: 'Péage', eur: tollEur, pct: pct[1]!, detail: null, hatched: true },
  ];
  const note = toll.max != null && toll.max > toll.min ? `Péage compté au bas de sa fourchette (${euroRange(toll.min, toll.max)}).` : null;
  return { slices, totalEur: total, note };
}

/** Phrase pour un lecteur d'écran : « 56 % Ticket Métro-Train-RER (2,55 €), 44 % Ticket Bus-Tram (2,05 €), soit 4,60 € ». */
export function breakdownSentence(b: CostBreakdown): string {
  const parts = b.slices.map((s) => `${s.pct}\u00a0% ${s.label} (${euro(s.eur)})`);
  return `${parts.join(', ')}, soit ${euro(b.totalEur)}.`;
}
