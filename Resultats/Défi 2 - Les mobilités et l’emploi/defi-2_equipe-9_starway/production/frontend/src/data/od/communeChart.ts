/**
 * Graphique des communes du pôle (chantier C, lot 4, D-051) : fonctions PURES, au-dessus de `proofOd.ts` et `texts.ts`.
 *
 * Une ligne par commune, la plus grande en postes d'abord (même ordre que la liste) : un triangle ALLER en haut de la
 * ligne, un triangle RETOUR en bas, sur un axe commun qui part de 0. Rien n'est inventé : le maximum de l'axe est le plus
 * grand des temps dessinés et du temps choisi, le trait pointillé est le temps choisi, et chaque phrase vient de `texts.ts`.
 * Un sens sans durée (aucun trajet, non calculé, votre commune) n'est JAMAIS dessiné comme une valeur : il est écrit.
 */
import { formatInt } from '../format';
import type { OdPoleShare } from './compute';
import { odCommuneRows } from './proofOd';
import type { OdTextContext } from './texts';
import type { OdLeg } from './swod';

export interface CommuneChartLeg {
  /** Durée du sens en minutes ; null = aucun trajet ou non mesuré (écrit, jamais dessiné) */
  minutes: number | null;
  /** La durée tient dans le temps choisi (triangle plein) ; faux = au-delà (triangle vide) */
  within: boolean;
  /** Mot écrit à la place du triangle quand `minutes` est nul : « Aucun trajet », « Non calculé » ; null sinon */
  written: string | null;
}

export interface CommuneChartRow {
  insee: string;
  name: string;
  jobs: number;
  /** Accessible aller ET retour dans le temps choisi (seul cas où les triangles sont cyan) */
  accessible: boolean;
  /** Commune de départ : rien n'est mesuré, la ligne le dit en toutes lettres */
  self: boolean;
  out: CommuneChartLeg;
  ret: CommuneChartLeg;
  /** Phrase complète : au survol, au focus et dans le tableau (verdict, aller, retour) */
  sentence: string;
  /** Texte de l'aller et du retour du tableau (mêmes phrases que la liste d'avant) */
  outText: string;
  retText: string;
  /** Verdict (titre) */
  title: string;
}

export interface CommuneChartModel {
  rows: CommuneChartRow[];
  /** Temps choisi par sens (min) : le trait pointillé */
  budget: number;
  /** Fin de l'axe : le plus grand des temps dessinés et du temps choisi */
  axisMax: number;
  /** Graduations : 0, le temps choisi, la fin de l'axe (sans doublon, dans l'ordre) */
  ticks: number[];
}

function legModel(leg: OdLeg, budget: number): CommuneChartLeg {
  if (leg.minutes != null) return { minutes: leg.minutes, within: leg.minutes <= budget, written: null };
  const notMeasured = leg.reason === 'not_computed' || leg.reason === 'origin_not_snapped' || leg.reason == null;
  return { minutes: null, within: false, written: notMeasured ? 'Non calculé' : 'Aucun trajet' };
}

export function communeChartModel(
  share: Pick<OdPoleShare, 'communes'>,
  names: ReadonlyMap<string, string>,
  budget: number,
  ctx: OdTextContext,
  end: number,
): CommuneChartModel {
  const text = odCommuneRows(share, names, budget, ctx, end);
  const byInsee = new Map(share.communes.map((d) => [d.insee, d]));
  const rows: CommuneChartRow[] = text.map((r) => {
    const d = byInsee.get(r.insee)!;
    const self = d.status === 'self';
    const sentence = [`${r.name} : ${formatInt(r.jobs)} postes salariés recensés par l'INSEE. ${r.title}.`, r.out && `${r.out}.`, r.ret && `${r.ret}.`].filter(Boolean).join(' ');
    return {
      insee: r.insee,
      name: r.name,
      jobs: r.jobs,
      accessible: d.status === 'accessible',
      self,
      out: self ? { minutes: null, within: false, written: null } : legModel(d.out, budget),
      ret: self ? { minutes: null, within: false, written: null } : legModel(d.ret, budget),
      sentence,
      outText: r.out,
      retText: r.ret,
      title: r.title,
    };
  });
  const drawn = rows.flatMap((r) => [r.out.minutes, r.ret.minutes]).filter((m): m is number => m != null);
  const axisMax = Math.max(budget, ...drawn);
  const ticks = [0, budget, axisMax].filter((t, i, a) => a.indexOf(t) === i);
  return { rows, budget, axisMax, ticks };
}
