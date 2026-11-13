/**
 * Onglet « Niveau de vie » du halo (retour de Nicolas du 03/11) : situer la commune parmi les communes
 * et arrondissements d'Île-de-France dont la valeur est publiée (INSEE Filosofi, SOC01). Fonctions
 * PURES : la répartition vient du module virtuel `virtual:income-distribution` (lu au build dans
 * public/data/context, voir vite.config.ts). Aucune valeur régionale n'est inventée : nos données n'en
 * publient pas, donc aucune référence régionale n'est tracée. Une valeur sous secret statistique est
 * absente de la répartition (jamais zéro). Décrit la commune, ne dit rien de l'accès aux pôles.
 */
import { formatInt } from './format';

export interface IncomeDistribution {
  /** Millésime Filosofi des valeurs */
  year: number | null;
  /** [code INSEE, niveau de vie médian en euros par an] des communes où il est publié */
  median: [string, number][];
  /** [code INSEE, taux de pauvreté en %] des communes où il est publié */
  poverty: [string, number][];
}

export type IncomeMeasure = 'median' | 'poverty';

/** Valeur écrite d'une bande : « 42 520 € », « 6,7 % » (même écriture sur l'axe, sous le titre et dans le « i ») */
export const incomeValueText: Record<IncomeMeasure, (v: number) => string> = {
  median: (v) => `${formatInt(v)}\u00a0€`,
  poverty: (v) => `${String(v).replace('.', ',')}\u00a0%`,
};

export interface Rank {
  /** Nombre d'AUTRES communes à valeur publiée (la commune elle-même exclue) */
  others: number;
  /** Autres communes à valeur strictement plus basse / plus haute */
  below: number;
  above: number;
}

/** Rang de `value` parmi les valeurs des autres communes (la commune `insee` est exclue). */
export function rankAmong(entries: readonly (readonly [string, number])[], insee: string, value: number): Rank {
  let below = 0;
  let above = 0;
  let others = 0;
  for (const [code, v] of entries) {
    if (code === insee) continue;
    others++;
    if (v < value) below++;
    else if (v > value) above++;
  }
  return { others, below, above };
}

const MEASURE_NAME: Record<IncomeMeasure, string> = {
  median: 'Niveau de vie médian',
  poverty: 'Taux de pauvreté',
};

const PUBLISHED: Record<IncomeMeasure, string> = {
  median: 'dont le niveau de vie médian est publié',
  poverty: 'où le taux de pauvreté est publié',
};

/**
 * Phrase dérivée du rang : « Niveau de vie médian plus élevé que 92 % des 1 270 autres communes et
 * arrondissements d'Île-de-France dont le niveau de vie médian est publié. » Le côté (plus élevé / plus
 * bas) est celui qui compte le plus de communes ; la part est arrondie à l'entier inférieur (jamais
 * « 100 % » si une seule commune est à égalité ou au-dessus). null si aucune autre commune.
 */
export function rankSentence(measure: IncomeMeasure, r: Rank): string | null {
  if (r.others <= 0) return null;
  const name = MEASURE_NAME[measure];
  const where = `d'Île-de-France ${PUBLISHED[measure]}`;
  // Extrêmes : « le plus élevé des 1 271 communes et arrondissements … » (la commune comprise)
  const all = `des ${formatInt(r.others + 1)} communes et arrondissements ${where}`;
  if (r.below === r.others) return `${name} le plus élevé ${all}.`;
  if (r.above === r.others) return `${name} le plus bas ${all}.`;
  const higher = r.below >= r.above;
  const share = Math.floor((100 * (higher ? r.below : r.above)) / r.others);
  const pool = r.others > 1 ? `des ${formatInt(r.others)} autres communes et arrondissements` : "de l'autre commune";
  return `${name} plus ${higher ? 'élevé' : 'bas'} que ${share}\u00a0% ${pool} ${where}.`;
}

/** Valeur publiée de la commune dans la répartition, ou null (secret statistique, non publiée). */
export function valueOf(entries: readonly (readonly [string, number])[], insee: string): number | null {
  for (const [code, v] of entries) if (code === insee) return v;
  return null;
}

/** Bornes de l'axe de la bande : plus petite et plus grande valeur publiée. */
export function extent(entries: readonly (readonly [string, number])[]): [number, number] | null {
  if (!entries.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, v] of entries) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/**
 * Hauteur de chaque point dans la bande, dans [0, 1) : suite de Weyl (nombre d'or) sur le rang de la
 * valeur, donc déterministe et régulière. Elle ne porte AUCUNE donnée : elle évite seulement que
 * 1 271 points se superposent sur une ligne.
 */
export function stripJitter(i: number): number {
  return (i * 0.6180339887498949) % 1;
}
