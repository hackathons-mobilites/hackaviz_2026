/**
 * Panneau de preuve en horaires libres (D-019) : fonctions PURES, au-dessus de `compute.ts` et
 * `texts.ts` (les textes de raison viennent de là, rien n'est réécrit ici).
 *
 * Un pôle est un ensemble de communes : le panneau montre la PART de ses postes atteinte aller ET
 * retour, puis chaque commune du pôle avec son aller (départ, durée) et son retour.
 */
import { formatInt, formatPercent } from '../format';
import { formatClock, shortCommuneName, type BadgeKind, type ProofBadge } from '../proof';
import type { OdDestState, OdPoleShare } from './compute';
import { odLegText, odVerdict, selfJobsText, type OdTextContext } from './texts';

/** Badge de l'en-tête en horaires libres, cohérent avec l'astre (allumé dès qu'un poste est atteint). */
export function odBadge(
  s: Pick<OdPoleShare, 'reached' | 'measurable' | 'share' | 'notReached' | 'outOnly'> & Partial<Pick<OdPoleShare, 'self'>>,
  budget: number,
): ProofBadge {
  const max = `aller et retour ≤ ${budget}\u00a0min`;
  if (s.reached > 0 && s.share != null && s.reached >= s.measurable) return { kind: 'accessible', text: `Accessible · ${max}` };
  if (s.reached > 0) {
    return { kind: 'accessible', text: `En partie accessible · ${s.share != null ? `${formatPercent(s.share * 100)} des postes, ` : ''}${max}` };
  }
  if (s.outOnly > 0) return { kind: 'out_only', text: `Aller possible, retour hors de portée en ${budget}\u00a0min` };
  if (s.notReached > 0) return { kind: 'blocked', text: `Hors de portée en ${budget}\u00a0min par sens` };
  // Pôle réduit à la commune de départ : rien n'est mesuré, ce n'est pas « non calculé » au sens du jeu de données
  if ((s.self ?? 0) > 0 && s.measurable <= 0) return { kind: 'unknown', text: 'Votre commune : trajet non mesuré' };
  return { kind: 'unknown', text: 'Non calculé' };
}

export interface OdShareSummary {
  /** « 70,6 % » ; null si le pôle n'a aucun poste mesurable */
  percent: string | null;
  /** « 412 000 postes salariés (INSEE) atteints aller et retour, sur 583 659 » (postes mesurables : commune de départ exclue) ; mode sources */
  line: string;
  /**
   * Sans mode sources (audit d'affichage du 11/11, P10 et D1) : « 412 000 postes salariés (INSEE) atteints aller et retour » ; le
   * dénominateur (« sur 583 659 postes du pôle dont le trajet est mesuré ») est dans le « i » de la barre de part
   */
  lineShort: string;
  /** Précisions (non calculés, commune d'origine), une phrase chacune */
  notes: string[];
}

export function odShareSummary(s: Pick<OdPoleShare, 'reached' | 'measurable' | 'share' | 'self' | 'unknown'>): OdShareSummary {
  const notes: string[] = [];
  if (s.unknown > 0) notes.push(`${formatInt(s.unknown)} postes dans des communes non calculées.`);
  if (s.self > 0) notes.push(`${selfJobsText(s.self).charAt(0).toUpperCase()}${selfJobsText(s.self).slice(1)}, hors du pourcentage.`);
  return {
    percent: s.share != null ? formatPercent(s.share * 100) : null,
    line: `${formatInt(s.reached)} postes salariés (INSEE) atteints aller et retour, sur ${formatInt(s.measurable)}`,
    lineShort: `${formatInt(s.reached)} postes salariés (INSEE) atteints aller et retour`,
    notes,
  };
}

export interface OdCommuneCount {
  /** Communes du pôle atteintes aller ET retour dans le temps choisi */
  reached: number;
  /** Communes du pôle mesurées (la commune de départ, « Votre commune », n'est pas mesurée) */
  total: number;
}

/** Chiffre clé du pli « Communes du pôle » : « 9 sur 11 atteintes » (lu dans les statuts du calcul, jamais écrit). */
export function odCommuneCount(share: Pick<OdPoleShare, 'communes'>): OdCommuneCount {
  const measured = share.communes.filter((d) => d.status !== 'self');
  return { reached: measured.filter((d) => d.status === 'accessible').length, total: measured.length };
}

export interface OdCommuneRow {
  insee: string;
  name: string;
  jobs: number;
  /** Glyphe : même forme que l'astre (`StatusGlyph`) */
  glyph: BadgeKind | 'self';
  title: string;
  out: string;
  ret: string;
}

const GLYPH: Record<OdDestState['status'], OdCommuneRow['glyph']> = {
  accessible: 'accessible',
  out_only: 'out_only',
  none: 'blocked',
  unknown: 'unknown',
  self: 'self',
};

const NBSP = String.fromCharCode(0xa0);
const cap = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;

/**
 * Une ligne par commune du pôle, la plus grande en postes d'abord (égalité : ordre de l'index).
 * Aller : « Aller 32 min (départ 8h25, arrivée 8h57) » ; retour à la fin du poste `end` (minutes).
 */
export function odCommuneRows(
  share: Pick<OdPoleShare, 'communes'>,
  names: ReadonlyMap<string, string>,
  budget: number,
  ctx: OdTextContext,
  end: number,
): OdCommuneRow[] {
  return [...share.communes]
    .sort((a, b) => b.jobs - a.jobs || a.dest - b.dest)
    .map((d) => {
      const v = odVerdict(d, budget, ctx);
      const self = d.status === 'self';
      return {
        insee: d.insee,
        name: shortCommuneName(names.get(d.insee) ?? d.insee),
        jobs: d.jobs,
        glyph: GLYPH[d.status],
        title: v.title,
        out: self ? '' : cap(odLegText(d.out, 'out', ctx)),
        ret: self ? '' : cap(odLegText(d.ret, 'ret', ctx, end)),
      };
    });
}

/**
 * Retour de Nicolas (12/11) : Maisons-Laffitte vers Paris 9e, 14h-22h, 60 min : l'astre dit « retour hors de portée »
 * alors que l'exemple de trajet du bloc « Trajet » affiche « Retour · 44 min ». Les deux calculs sont justes mais ne
 * vont pas au même point : le verdict va au centre de chaque commune du pôle (table commune par commune, D-017 / D-019),
 * l'exemple à l'arrêt le plus desservi du pôle (itinéraire détaillé) ; quelques minutes de marche font manquer un train
 * le soir. Quand l'exemple et le verdict se contredisent (exemple dans le temps choisi et astre éteint, ou l'inverse),
 * cette phrase, écrite au-dessus de l'exemple, donne les durées du verdict (commune du pôle la plus grande en postes) :
 * l'écran ne se contredit plus. Sinon null (rien n'est ajouté).
 */
export function odExampleMismatchText(
  share: Pick<OdPoleShare, 'communes' | 'reached'>,
  trips: { out: { min?: number | null } | null; ret: { min?: number | null } | null },
  names: ReadonlyMap<string, string>,
  budget: number,
  ctx: OdTextContext,
  end: number,
): string | null {
  const o = trips.out?.min, r = trips.ret?.min;
  if (typeof o !== 'number' || typeof r !== 'number') return null;
  const measured = share.communes.filter((d) => d.status !== 'self' && d.status !== 'unknown');
  if (!measured.length) return null;
  const exampleWithin = o <= budget && r <= budget;
  const lit = share.reached > 0;
  if (exampleWithin === lit) return null;
  // Astre allumé : la commune atteinte la plus grande (celle qui allume l'astre) ; éteint : la plus grande du pôle
  const pool = lit ? measured.filter((d) => d.status === 'accessible') : measured;
  const main = [...(pool.length ? pool : measured)].sort((a, b) => b.jobs - a.jobs || a.dest - b.dest)[0]!;
  const name = shortCommuneName(names.get(main.insee) ?? main.insee);
  const many = share.communes.filter((d) => d.status !== 'self').length > 1;
  const where = many ? `au centre de chaque commune du pôle, dont ${name}` : `au centre de ${name}`;
  const legs = `${odLegText(main.out, 'out', ctx)}, ${odLegText(main.ret, 'ret', ctx, end)}`;
  // Audit du 13/11 : la condition ne dit rien de chaque sens pris à part (l'exemple peut être plus court à l'aller et plus long au
  // retour) : la phrase dit seulement ce qui est sûr, l'exemple tient ou non dans le temps choisi
  const fit = exampleWithin ? 'il tient dans le temps choisi' : 'il dépasse le temps choisi';
  return `Le verdict compte le trajet jusqu'${where} : ${legs}. L'exemple ci-dessous va jusqu'à l'arrêt le plus desservi du pôle : ${fit}, mais il ne change pas le verdict.`;
}

/**
 * Demande de Nicolas (12/11) : en tête de la fiche, la durée calculée qui fait le verdict, et ce qui dépasse le temps choisi
 * (« retour 76 min … : au-delà de 60 min »). Astre d'une seule commune (arrondissement) : ses deux sens, toujours. Astre de
 * plusieurs communes éteint : la commune du pôle la plus proche (plus petit des deux sens le plus long). Astre de plusieurs
 * communes allumé : null (la part atteinte dit déjà tout, chaque commune est dans « Communes du pôle »).
 */
export function odHeroLegsText(
  share: Pick<OdPoleShare, 'communes' | 'reached'>,
  names: ReadonlyMap<string, string>,
  budget: number,
  ctx: OdTextContext,
  end: number,
): string | null {
  const cands = share.communes.filter((d) => d.status !== 'self');
  const measured = cands.filter((d) => d.status !== 'unknown');
  if (!measured.length) return null;
  const many = cands.length > 1;
  if (many && share.reached > 0) return null;
  const worst = (d: OdDestState) => Math.max(d.out.minutes ?? Infinity, d.ret.minutes ?? Infinity);
  const d = many ? [...measured].sort((a, b) => worst(a) - worst(b) || b.jobs - a.jobs || a.dest - b.dest)[0]! : measured[0]!;
  const over = (m: number | null) => (m != null && m > budget ? ` : au-delà de ${budget}${NBSP}min` : '');
  const legs = `${cap(odLegText(d.out, 'out', ctx))}${over(d.out.minutes)} ; ${odLegText(d.ret, 'ret', ctx, end)}${over(d.ret.minutes)}.`;
  return many ? `Commune du pôle la plus proche, ${shortCommuneName(names.get(d.insee) ?? d.insee)} : ${legs.charAt(0).toLowerCase()}${legs.slice(1)}` : legs;
}

/**
 * « i » de la ligne des durées du verdict (demande de Nicolas, 13/11) : d'où viennent ces durées, et pourquoi l'exemple de trajet
 * du bloc « Trajet », juste en dessous, peut en donner d'autres. Mêmes mots que le « i » « Comment les temps sont calculés ».
 */
export const HERO_LEGS_METHOD: readonly string[] = [
  "Ces durées font le verdict de l'astre : l'aller et le retour doivent chacun tenir dans le temps choisi.",
  "Départ : le centre de votre commune, arrivée : le centre de la commune du pôle (chaque fois le centre de gravité de sa population : un point, pas une adresse). Toutes les gares et tous les arrêts à portée de marche comptent.",
  "Aller : pour arriver avant le début du poste. Retour : compté dès la fin du poste, attente du premier départ comprise.",
  "L'exemple de trajet ci-dessous va jusqu'à l'arrêt le plus desservi du pôle : ses durées peuvent être un peu différentes, elles ne changent pas le verdict.",
];

/** « 8h30-16h30 » depuis des minutes (horaires libres). */
export function odShiftText(start: number, end: number): string {
  return `${formatClock(start)}-${formatClock(end)}`;
}
