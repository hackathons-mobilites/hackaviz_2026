/**
 * Péages d'un sens en voiture ou en deux-roues (D-029, contrat tolls-1), calculés comme le pipeline
 * (pipeline/starway/toll_publish.py, `toll_leg`) : mêmes cas de test dans tolls.test.ts et
 * pipeline/tests/test_toll_publish.py.
 *
 * Fenêtre de passage, en minutes depuis minuit du jour de service : aller [S - T, S), retour [E, E + T),
 * T = durée du sens affichée (route vide ou trafic moyen DiRIF). La position du péage sur le chemin
 * n'est pas connue : un seul prix si la fenêtre tient dans une tranche, sinon une fourchette (min, max),
 * jamais une moyenne. Une cellule inconnue rend le péage du sens inconnu (null), jamais 0.
 */
import type { TollCell, TollsFile } from './types';

export type TollStatus = 'sans_peage' | 'ok' | 'fourchette' | 'no_route' | string;

export interface TollItem {
  e: number;
  s: number;
  prices: number[];
}

export interface TollLeg {
  min: number | null;
  max: number | null;
  status: TollStatus;
  /** Points en cause quand le péage est inconnu */
  points?: number[];
  items: TollItem[];
}

const DAY = 1440;

/** Au centime, demi-centime vers le haut (même calcul que le pipeline). */
export function roundCents(x: number): number {
  return Math.floor(x * 100 + 0.5) / 100;
}

/** Tranches d'un couple par jour (-1, 0, +1), ou un statut si le couple est interdit ou absent. */
function slotsFor(tj: TollsFile, e: number, s: number, c: number, t: string): { byDay: Map<number, [number, number, number][]>; status: string | null } {
  const gs = tj.grids.filter((g) => g.e === e && g.s === s && g.c === c);
  if (gs.some((g) => g.status === 'interdit')) return { byDay: new Map(), status: 'interdit' };
  if (gs.length === 0) return { byDay: new Map(), status: 'couple_absent' };
  const own = gs.filter((g) => g.t === t);
  if (own.length === 0) return { byDay: new Map(), status: 'tarif_absent' };
  return { byDay: new Map(own.map((g) => [g.d ?? 0, g.slots ?? []])), status: null };
}

/** Prix des tranches qui recoupent [lo, hi) ; lo === hi : la tranche qui contient cet instant. */
export function windowPrices(byDay: Map<number, [number, number, number][]>, lo: number, hi: number): { prices: number[]; status: string } {
  if (hi < lo) throw new Error('fenêtre de passage inversée');
  const found = new Set<number>();
  if (lo === hi) {
    const d = Math.floor(lo / DAY);
    const slots = byDay.get(d);
    if (!slots) return { prices: [], status: 'jour_absent' };
    const x = lo - d * DAY;
    for (const [a, b, p] of slots) if (a <= x && x < b) found.add(p);
  } else {
    for (let d = Math.floor(lo / DAY); d <= Math.floor((hi - 1) / DAY); d++) {
      const slots = byDay.get(d);
      if (!slots) return { prices: [], status: 'jour_absent' };
      const a0 = Math.max(lo - d * DAY, 0);
      const b0 = Math.min(hi - d * DAY, DAY);
      for (const [a, b, p] of slots) if (a < b0 && a0 < b) found.add(p);
    }
  }
  if (found.size === 0) return { prices: [], status: 'tranche_absente' };
  const prices = [...found].sort((x, y) => x - y);
  return { prices, status: prices.length === 1 ? 'ok' : 'fourchette' };
}

/** Péage d'un sens (EUR) pour une classe de véhicule et une fenêtre de passage. */
export function tollLeg(tj: TollsFile, cell: TollCell | undefined, classe: number, lo: number, hi: number, tarif = 'standard'): TollLeg {
  if (cell == null) return { min: null, max: null, status: 'no_route', items: [] };
  if (!Array.isArray(cell)) return { min: null, max: null, status: cell.s, points: cell.p, items: [] };
  if (cell.length === 0) return { min: 0, max: 0, status: 'sans_peage', items: [] };
  let loSum = 0;
  let hiSum = 0;
  const items: TollItem[] = [];
  for (const [e, s] of cell) {
    const { byDay, status } = slotsFor(tj, e, s, classe, tarif);
    if (status) return { min: null, max: null, status, points: [e, s], items };
    const w = windowPrices(byDay, lo, hi);
    if (w.status !== 'ok' && w.status !== 'fourchette') return { min: null, max: null, status: w.status, points: [e, s], items };
    loSum += w.prices[0]!;
    hiSum += w.prices[w.prices.length - 1]!;
    items.push({ e, s, prices: w.prices });
  }
  const min = roundCents(loSum);
  const max = roundCents(hiSum);
  return { min, max, status: min === max ? 'ok' : 'fourchette', items };
}

/** Fenêtre de passage d'un sens : aller [S - T, S), retour [E, E + T) ; null sans durée. */
export function passageWindow(leg: 'out' | 'ret', clock: number, minutes: number | null | undefined): [number, number] | null {
  if (minutes == null) return null;
  return leg === 'out' ? [clock - minutes, clock] : [clock, clock + minutes];
}

/** Nom lisible d'un passage : « A14 - gare de Montesson » ou « Duplex A86 - gare de Rueil > Duplex A86 - gare de Vélizy ». */
export function passageLabel(tj: TollsFile, e: number, s: number): string {
  const a = tj.points[e]?.label ?? '?';
  const b = tj.points[s]?.label ?? '?';
  return e === s ? a : `${a} > ${b}`;
}

/**
 * Crédits des producteurs des tarifs traversés (« tarif © VINCI Autoroutes 2026 »), publiés par le pipeline
 * (`points[].credit`, D-060) : toujours affichés à côté du montant, mode sources ou non (accord de l'organisateur du
 * hackathon du 09/11/2026). Sans crédit publié, le nom de l'exploitant, jamais rien.
 */
export function tollCredits(tj: TollsFile, items: readonly { e: number; s: number }[]): string[] {
  const out: string[] = [];
  for (const { e, s } of items) {
    for (const i of e === s ? [e] : [e, s]) {
      const p = tj.points[i];
      const c = p?.credit ?? (p?.operator ? `tarif ${p.operator}` : null);
      if (c && !out.includes(c)) out.push(c);
    }
  }
  return out;
}

/** Contrat attendu (un fichier d'un autre contrat est ignoré). */
export function isTollsFile(x: unknown): x is TollsFile {
  const f = x as TollsFile | null;
  return !!f && f.contract === 'tolls-1' && Array.isArray(f.points) && Array.isArray(f.grids);
}
