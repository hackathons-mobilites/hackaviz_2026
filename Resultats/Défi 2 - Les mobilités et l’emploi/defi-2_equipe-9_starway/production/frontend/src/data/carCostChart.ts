/**
 * Graphique « Coût de la voiture, aller et retour » du pli « Coût et carbone » (demande de Nicolas du 11/11, D-066) : une barre par
 * sens, longueur = euros sur une échelle commune, énergie en plein, péage hachuré à la suite (sa fourchette en pointillé). Fonctions
 * PURES, testées (carCostChart.test.ts) : chaque montant vient de `carTripFacts` (distances R5, `meta.vehicles`, `tolls.json`) ;
 * aucun chiffre n'est écrit ici.
 */
import type { CarLegFacts, CarTripFacts } from './carCost';
import type { ChartReading } from './chartReading';
import { formatInt, nbsp } from './format';

const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const kmFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
export const euro = (x: number): string => nbsp(eurFmt.format(x));
/** « 2,49 € » ou « 2,49 à 3,10 € » (fourchette d'un péage dont l'heure de passage n'est connue qu'à peu près) */
export const euroRange = (a: number, b: number): string => (a === b ? euro(a) : `${nbsp(eurFmt.format(a).replace(/\s*€$/, ''))} à ${euro(b)}`);

export interface CarCostRow {
  dir: 'out' | 'ret';
  /** « Aller · 17,7 km » */
  label: string;
  energy: number;
  /** Péage du sens : 0 sans péage ; null si inconnu (la barre s'arrête à l'énergie et la ligne le dit) */
  tollMin: number | null;
  tollMax: number | null;
  /** Montant écrit au bout de la barre */
  text: string;
}

export interface CarCostChartModel {
  rows: CarCostRow[];
  /** Plus grand total (max de la fourchette) des deux sens : l'axe part de 0 */
  axisMax: number;
}

function row(dir: 'out' | 'ret', f: CarLegFacts): CarCostRow | null {
  if (f.distM == null || f.energy == null) return null;
  const known = f.toll && f.toll.min != null;
  const tollMin = !f.toll || f.toll.status === 'sans_peage' ? 0 : known ? f.toll.min : null;
  const tollMax = !f.toll || f.toll.status === 'sans_peage' ? 0 : known ? (f.toll.max ?? f.toll.min) : null;
  const text = f.totalMin != null && f.totalMax != null ? euroRange(f.totalMin, f.totalMax) : `${euro(f.energy)} sans le péage`;
  return { dir, label: `${dir === 'out' ? 'Aller' : 'Retour'} · ${kmFmt.format(f.distM / 1000)}\u00a0km`, energy: f.energy, tollMin, tollMax, text };
}

/** Modèle du graphique ; null si aucun sens n'a de distance et d'énergie (rien n'est dessiné). */
export function carCostChartModel(facts: CarTripFacts): CarCostChartModel | null {
  const rows = [row('out', facts.out), row('ret', facts.ret)].filter((r): r is CarCostRow => !!r);
  if (!rows.length) return null;
  const axisMax = Math.max(...rows.map((r) => r.energy + (r.tollMax ?? 0)));
  return { rows, axisMax };
}

/** « Comment lire ce graphique » : ce que dit chaque élément, puis le cas affiché, valeurs du modèle. */
export function carCostReading(model: CarCostChartModel, totals: { total: string | null; co2: number | null }): ChartReading {
  const parts = [
    "Une barre par sens : triangle vers la droite pour l'aller, vers la gauche pour le retour, sur la même échelle en euros.",
    "Plein : l'énergie (carburant ou électricité). Hachuré : le péage. Contour en pointillé : un péage connu seulement en fourchette.",
    'Le montant du sens est écrit au bout de la barre. Le carbone est donné à part, il n\'est pas dessiné.',
  ];
  const sideText = (r: CarCostRow) => {
    const toll = r.tollMin === 0 ? 'aucun péage' : r.tollMin == null ? 'péage inconnu' : `péage ${euroRange(r.tollMin, r.tollMax ?? r.tollMin)}`;
    return `${r.dir === 'out' ? "À l'aller" : 'Au retour'} (${r.label.split(' · ')[1]}) : énergie ${euro(r.energy)}, ${toll}, soit ${r.text}.`;
  };
  const example = model.rows.map(sideText);
  if (totals.total) example.push(`Aller et retour : ${totals.total}${totals.co2 != null ? `, et environ ${formatInt(totals.co2)}\u00a0g CO2e (estimation, énergie seule)` : ''}.`);
  return { parts, example };
}
