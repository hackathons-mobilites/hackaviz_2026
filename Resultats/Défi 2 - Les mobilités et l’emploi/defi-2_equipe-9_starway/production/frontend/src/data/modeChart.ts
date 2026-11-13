/**
 * Graphique « Comparer les moyens de transport » (lot 4, D-051) : fonctions PURES. Une ligne par mode publié, mêmes triangles que les
 * communes (aller vers la droite en haut, retour vers la gauche en bas), en perle, sans ligne de budget et sans verdict (le verdict est
 * dans le tableau). Triés par le temps aller + retour, le plus court d'abord ; un mode dont un sens n'a pas de durée passe après, dans
 * l'ordre du tableau. « Aucun trajet » et « non calculé » sont ÉCRITS, jamais dessinés comme une valeur.
 */
import type { ModeRow } from './modesCompare';
import type { ModeId } from './types';

export interface ModeChartLeg {
  minutes: number | null;
  /** Mot écrit à la place du triangle quand `minutes` est nul ; null sinon */
  written: string | null;
}

export interface ModeChartRow {
  mode: ModeId;
  label: string;
  current: boolean;
  out: ModeChartLeg;
  ret: ModeChartLeg;
  /** Phrase du survol et du focus : « Voiture : aller 22 min, retour 25 min » ; un sens sans durée est écrit */
  sentence: string;
}

export interface ModeChartModel {
  rows: ModeChartRow[];
  /** Fin de l'axe : le plus grand des temps dessinés (l'axe part de 0) ; 0 si rien n'est dessiné */
  axisMax: number;
}

const leg = (minutes: number | null, unknown: boolean): ModeChartLeg =>
  minutes != null ? { minutes, written: null } : { minutes: null, written: unknown ? 'Non calculé' : 'Aucun trajet' };

const legText = (name: 'aller' | 'retour', l: ModeChartLeg) => (l.minutes != null ? `${name} ${l.minutes}\u00a0min` : `${name} : ${l.written!.toLowerCase()}`);

/**
 * Nom d'un mode sur deux lignes au plus, coupé aux espaces (au plus `maxChars` caractères par ligne, remplissage glouton) ; ce qui ne
 * tient pas est laissé à la dernière ligne (le dessin la coupe : le nom entier est dans la phrase et le tableau).
 */
export function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (lines.length === 1 || !cur || `${cur} ${w}`.length <= maxChars) cur = cur ? `${cur} ${w}` : w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  lines.push(cur);
  return lines;
}

export function modeChartModel(rows: readonly ModeRow[]): ModeChartModel {
  const built = rows.map((r, i) => {
    const unknown = r.verdict === 'unknown';
    const out = leg(unknown ? null : r.out, unknown);
    const ret = leg(unknown ? null : r.ret, unknown);
    const row: ModeChartRow = { mode: r.mode, label: r.label, current: r.current, out, ret, sentence: `${r.label} : ${legText('aller', out)}, ${legText('retour', ret)}.` };
    const total = out.minutes != null && ret.minutes != null ? out.minutes + ret.minutes : null;
    return { row, total, i };
  });
  built.sort((a, b) => (a.total == null ? 1 : 0) - (b.total == null ? 1 : 0) || (a.total != null && b.total != null ? a.total - b.total : 0) || a.i - b.i);
  const sorted = built.map((b) => b.row);
  const drawn = sorted.flatMap((r) => [r.out.minutes, r.ret.minutes]).filter((m): m is number => m != null);
  return { rows: sorted, axisMax: Math.max(0, ...drawn) };
}
