/**
 * « Comment lire ce graphique » (demande de Nicolas du 10/11) : pour chaque type de graphique du site, le texte du bouton « i »
 * placé à côté de son titre. Deux parties :
 * - `parts` : ce que représente chaque élément du dessin (phrases générales, aucune valeur) ;
 * - `example` : UN CAS PRÉCIS, construit à l'exécution avec les valeurs réellement affichées pour la commune courante.
 *
 * Fonctions PURES : tout chiffre de `example` vient des valeurs passées (jamais un chiffre écrit ici, jamais un exemple fictif).
 * Une valeur absente (non publiée, non calculée) est dite comme telle, rien n'est estimé. Le dénominateur et le millésime sont
 * repris quand le graphique en a un. Vocabulaire : « postes salariés recensés par l'INSEE », libellé court « postes salariés (INSEE) ». Aucun lien de cause tiré des données sociales.
 */
import type { OdSkyTotals, SkyTotals } from './accessibility';
import { formatInt, formatPercent } from './format';
import { formatMargin, type DotRow, type HaloSegment } from './halo';
import { extent, incomeValueText, rankAmong, valueOf, type IncomeMeasure, type Rank } from './incomeRank';
import type { ModeChartLeg, ModeChartModel } from './modeChart';
import type { CommuneChartLeg, CommuneChartModel } from './od/communeChart';
import type { RecruitChartRow } from './recruitChart';
import {
  CHOMAGE_DENOMINATOR,
  ZONE_SCALE_NOTE,
  ZONE_STRIP_READING,
  EVOLUTION_NOTE,
  lastRate,
  ofName,
  quarterLabel,
  rateText,
  zoneLabel,
  zoneRank,
  zoneRankSentence,
  zoneRates,
  zoneSeries,
  type TerritoireFile,
} from './territoire';
import type { TrafficChartModel } from './trafficChart';
import type { TripBandModel } from './tripBand';

export interface ChartReading {
  /** Ce que mesure le graphique, en clair, avant « Comment lire ce graphique » (première ligne de la bulle) ; facultatif */
  intro?: string[];
  /** Ce que représente chaque élément du dessin */
  parts: string[];
  /** Le cas précis, avec les valeurs affichées (vide si le graphique n'a rien à montrer) */
  example: string[];
}

/** Commune d'un graphique : « A · » ou « B · » en comparaison, rien sinon */
export interface ReadingSide {
  name: string;
  tag?: 'A' | 'B';
}

/** Intitulé du bouton : « Comment lire ce graphique » suivi du nom du graphique (plusieurs graphiques par panneau) */
export const READING_TITLE = 'Comment lire ce graphique';
export const readingLabel = (chart: string): string => `${READING_TITLE} : ${chart}`;

const who = (s: ReadingSide): string => (s.tag ? `${s.tag} · ${s.name}` : s.name);
const sentence = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const minutes = (n: number): string => `${formatInt(n)}\u00a0min`;

/* ------------------------------------------------------------------ bande de points : niveau de vie, taux de pauvreté */

/** Phrase lue sous la bande jusqu'au 10/11, rangée dans le « i » mots inchangés */
export const INCOME_STRIP_NOTE = "Un point par commune ou arrondissement ; la hauteur d'un point ne porte aucune donnée.";

const MEASURE: Record<IncomeMeasure, { name: string; higher: string; lower: string }> = {
  median: { name: 'niveau de vie médian', higher: 'plus élevé', lower: 'plus bas' },
  poverty: { name: 'taux de pauvreté', higher: 'plus élevé', lower: 'plus bas' },
};

function rankCase(measure: IncomeMeasure, r: Rank): string | null {
  if (r.others <= 0) return null;
  const m = MEASURE[measure];
  if (r.below === r.others) return `C'est le ${m.name} le plus élevé des ${formatInt(r.others + 1)} communes et arrondissements où il est publié.`;
  if (r.above === r.others) return `C'est le ${m.name} le plus bas des ${formatInt(r.others + 1)} communes et arrondissements où il est publié.`;
  // Même règle que la phrase de rang visible (rankSentence) : le côté le plus nombreux, part arrondie à l'entier inférieur
  const higher = r.below >= r.above;
  const share = Math.floor((100 * (higher ? r.below : r.above)) / r.others);
  const than = higher ? m.lower : m.higher;
  return r.others > 1
    ? `${share}\u00a0% des ${formatInt(r.others)} autres communes et arrondissements où il est publié ont un ${m.name} ${than}.`
    : `L'autre commune où il est publié a un ${m.name} ${than}.`;
}

/**
 * Bande de points du niveau de vie médian ou du taux de pauvreté : `entries` est la répartition affichée (une valeur publiée par
 * commune ou arrondissement), `sides` la ou les communes marquées d'un trait doré.
 */
export function incomeStripReading({
  measure,
  entries,
  sides,
  year,
  denominator,
}: {
  measure: IncomeMeasure;
  entries: readonly (readonly [string, number])[];
  sides: readonly (ReadingSide & { insee: string })[];
  year: number | null;
  denominator?: string | null;
}): ChartReading {
  const m = MEASURE[measure];
  const dual = sides.length > 1;
  const parts = [
    INCOME_STRIP_NOTE,
    `Plus un point est à droite, plus le ${m.name} est élevé. Une commune sans valeur publiée n'a pas de point.`,
    dual ? 'Traits dorés A et B : les deux communes choisies.' : 'Trait doré : la commune choisie.',
  ];
  const ext = extent(entries);
  if (!ext) return { parts, example: [] };
  const [lo, hi] = ext;
  const example: string[] = [];
  for (const s of sides) {
    const v = valueOf(entries, s.insee);
    const lead = example.length === 0 ? 'Ici, ' : '';
    if (v == null) {
      example.push(`${lead}le ${m.name} de ${who(s)} n'est pas publié (secret statistique ou effectif trop faible) : aucun trait doré n'est tracé pour elle.`);
      continue;
    }
    const value = measure === 'median' ? `${incomeValueText.median(v)} par an` : incomeValueText.poverty(v);
    example.push(`${lead}${who(s)} (${dual ? `trait ${s.tag}` : 'trait doré'}) a un ${m.name} de ${value}.`);
    const rank = rankCase(measure, rankAmong(entries, s.insee, v));
    if (rank) example.push(rank);
  }
  example.push(`Le point le plus à gauche est à ${incomeValueText[measure](lo)}, le plus à droite à ${incomeValueText[measure](hi)}.`);
  const foot = [denominator ? `Dénominateur : ${denominator}.` : '', year != null ? `Millésime ${year}.` : ''].filter(Boolean).join(' ');
  if (foot) example.push(foot);
  return { parts, example: example.map(sentence) };
}

/* ------------------------------------------------------------------ anneau (astrolabe) : âges */

export interface RingSide extends ReadingSide {
  segments: readonly HaloSegment[];
  /** Nom et valeur écrite de chaque segment (même ordre) */
  items: readonly { name: string; value: string }[];
  denominator: string | null;
}

/** Anneau des âges : chaque arc est une tranche d'âge, sa longueur est sa part des habitants. */
export function ringReading({ sides, year }: { sides: readonly RingSide[]; year: number | null }): ChartReading {
  const parts = [
    "Chaque arc est une tranche d'âge ; sa longueur est sa part des habitants. Bout à bout, les arcs font tout l'anneau : toute la population.",
    "Les arcs partent de midi, dans le sens des aiguilles d'une montre. Les chiffres sont dans « Valeurs détaillées ».",
  ];
  const example: string[] = [];
  for (const s of sides) {
    const drawn = s.segments
      .map((seg, i) => ({ len: seg.end - seg.start, name: s.items[i]?.name ?? '', value: s.items[i]?.value ?? '', dotted: !!seg.dotted }))
      .filter((d) => !d.dotted && d.name && d.value);
    if (!drawn.length) {
      example.push(`Ici, la répartition par âge de ${who(s)} n'est pas publiée : aucun arc n'est tracé.`);
      continue;
    }
    const big = drawn.reduce((a, b) => (b.len > a.len ? b : a));
    const small = drawn.reduce((a, b) => (b.len < a.len ? b : a));
    example.push(`Ici, à ${who(s)}, l'arc le plus long est « ${big.name} » : ${big.value} des habitants.`);
    if (small !== big) example.push(`Le plus court est « ${small.name} » : ${small.value}.`);
    if (s.denominator) example.push(`Dénominateur${sides.length > 1 ? ` (${s.tag})` : ''} : ${s.denominator}.`);
  }
  if (year != null) example.push(`Millésime ${year}.`);
  return { parts, example };
}

/* ------------------------------------------------------------------ constellation en lignes : modes domicile-travail par sexe */

/** Phrase lue sous la légende des formes jusqu'au 10/11, rangée dans le « i » mots inchangés */
export const DOT_KEY_NOTE = "segment : marge d'erreur à 95 % ; pointillé : estimation imprécise";

export interface DotSide extends ReadingSide {
  rows: readonly DotRow[];
  denominator: string | null;
}

function dotValue(v: number, margin: number | null, imprecise: boolean): string {
  if (imprecise) return `${formatPercent(v)} (estimation imprécise : point en pointillé)`;
  return margin != null ? `${formatPercent(v)} (marge d'erreur ${formatMargin(margin)})` : formatPercent(v);
}

/** Modes domicile-travail : une ligne par mode, femmes en point plein, hommes en anneau, sur un axe de 0 à 100 %. */
export function dotPlotReading({ sides, year }: { sides: readonly DotSide[]; year: number | null }): ChartReading {
  const parts = [
    'Une ligne par mode pour aller travailler, sur un axe de 0 à 100 %. Point plein : les femmes ; anneau : les hommes.',
    `${sentence(DOT_KEY_NOTE)}.`,
    "Si les segments des deux points se chevauchent, l'écart entre femmes et hommes n'est pas établi.",
  ];
  const example: string[] = [];
  for (const s of sides) {
    // La ligne la plus remplie : celle dont un point est le plus à droite
    const best = s.rows.reduce<DotRow | null>((a, r) => (Math.max(r.f ?? -1, r.h ?? -1) > Math.max(a?.f ?? -1, a?.h ?? -1) ? r : a), null);
    if (!best) {
      example.push(`Ici, les modes domicile-travail de ${who(s)} ne sont pas publiés : aucun point n'est tracé.`);
      continue;
    }
    const f = best.f != null ? `point plein à ${dotValue(best.f, best.fMargin, best.fImprecise)}` : "le point plein n'est pas tracé (valeur non publiée)";
    const h = best.h != null ? `anneau à ${dotValue(best.h, best.hMargin, best.hImprecise)}` : "l'anneau n'est pas tracé (valeur non publiée)";
    example.push(`Ici, à ${who(s)}, ligne « ${best.label} » : ${f} et ${h}.`);
    if (best.f != null) example.push(`Soit ${formatPercent(best.f)} des femmes actives occupées de la commune qui déclarent ce mode principal pour aller travailler.`);
    if (s.denominator) example.push(`Dénominateur${sides.length > 1 ? ` (${s.tag})` : ''} : ${s.denominator}.`);
  }
  if (year != null) example.push(`Millésime ${year}.`);
  return { parts, example };
}

/* ------------------------------------------------------------------ chômage : bande des zones d'emploi, courbe d'évolution */

/** Bande des zones d'emploi : un point par zone à son taux du dernier trimestre, la zone de la commune marquée d'un trait doré. */
export function zoneStripReading(file: TerritoireFile, sides: readonly (ReadingSide & { zoneId: string | null })[]): ChartReading {
  const dual = sides.length > 1;
  const parts = [
    ZONE_STRIP_READING,
    ZONE_SCALE_NOTE,
    "La hauteur d'un point ne porte aucune donnée ; plus un point est à droite, plus le taux est élevé.",
    dual ? "Traits dorés A et B : les zones d'emploi des deux communes choisies." : "Trait doré : la zone d'emploi de la commune choisie.",
  ];
  const rates = zoneRates(file);
  if (!rates.length) return { parts, example: [] };
  const quarter = quarterLabel(file.chomage.quarter);
  const example: string[] = [];
  for (const s of sides) {
    const z = s.zoneId ? file.chomage.zones[s.zoneId] : undefined;
    if (!z || !s.zoneId) {
      example.push(`Ici, aucun repère de chômage n'est publié pour ${who(s)} : aucun trait doré n'est tracé.`);
      continue;
    }
    example.push(`Ici, ${who(s)} est dans la zone d'emploi ${ofName(z.name)} (${dual ? `trait ${s.tag}` : 'trait doré'}) : ${rateText(lastRate(z))} au ${quarter}.`);
    const r = zoneRank(file, s.zoneId);
    if (r) example.push(zoneRankSentence(r));
  }
  const lo = rates[0]!;
  const hi = rates[rates.length - 1]!;
  example.push(`Le point le plus à gauche est à ${rateText(lo.rate)} (${zoneLabel(lo.name)}), le plus à droite à ${rateText(hi.rate)} (${zoneLabel(hi.name)}).`);
  example.push(`Dénominateur : ${CHOMAGE_DENOMINATOR}.`);
  return { parts, example };
}

/** Courbe d'évolution du taux d'une zone d'emploi, du premier au dernier trimestre publié. */
export function evolutionReading(file: TerritoireFile, zoneId: string): ChartReading {
  const parts = [
    "Le taux de chômage de la zone d'emploi à chaque trimestre, du plus ancien, à gauche, au plus récent, à droite. L'axe vertical part de 0.",
    file.chomage.provisional ? 'Le point au bout : le dernier trimestre ; creux, il est provisoire.' : 'Le point au bout : le dernier trimestre.',
    EVOLUTION_NOTE,
  ];
  const s = zoneSeries(file, zoneId);
  const z = file.chomage.zones[zoneId];
  if (s.length < 2 || !z) return { parts, example: [] };
  const first = s[0]!;
  const last = s[s.length - 1]!;
  const max = s.reduce((a, b) => (b.rate > a.rate ? b : a));
  const min = s.reduce((a, b) => (b.rate < a.rate ? b : a));
  return {
    parts,
    example: [
      `Ici, la zone d'emploi ${ofName(z.name)} part de ${rateText(first.rate)} au ${quarterLabel(first.quarter)} et arrive à ${rateText(last.rate)} au ${quarterLabel(last.quarter)}${file.chomage.provisional ? ' (provisoire)' : ''}.`,
      `Le point le plus haut est à ${rateText(max.rate)} (${quarterLabel(max.quarter)}), le plus bas à ${rateText(min.rate)} (${quarterLabel(min.quarter)}).`,
    ],
  };
}

/* ------------------------------------------------------------------ triangles aller / retour : moyens de transport, communes du pôle */

/** Phrase lue sous le titre du graphique des moyens jusqu'au 10/11, rangée dans le « i » mots inchangés */
export const MODE_VERDICT_NOTE = 'Le verdict est dans le tableau.';

const TRI_PARTS = [
  "Triangle vers la droite, en haut : l'aller ; vers la gauche, en bas : le retour. Leur place sur l'axe, qui part de 0, est la durée en minutes.",
  '« Aucun trajet » et « Non calculé » sont écrits, jamais dessinés.',
];

const modeLeg = (name: 'aller' | 'retour', l: ModeChartLeg): string => (l.minutes != null ? `${name} ${minutes(l.minutes)}` : `${name} : ${l.written!.toLowerCase()}`);

/** Graphique « Comparer les moyens » : une ligne par moyen de transport, triée par le temps aller + retour. */
export function modeChartReading(model: ModeChartModel, { verdicts }: { verdicts: boolean }): ChartReading {
  const parts = [
    'Une ligne par moyen de transport, du plus court, en haut, au plus long (aller + retour).',
    ...TRI_PARTS,
    ...(verdicts ? [MODE_VERDICT_NOTE] : []),
  ];
  const rows = model.rows;
  if (!rows.length) return { parts, example: [] };
  const timed = rows.filter((r) => r.out.minutes != null && r.ret.minutes != null);
  const top = rows[0]!;
  const example = [`Ici, en haut : « ${top.label} », ${modeLeg('aller', top.out)}, ${modeLeg('retour', top.ret)}${timed[0] === top && timed.length > 1 ? " : l'aller + retour le plus court" : ''}.`];
  const longest = timed.length > 1 ? timed[timed.length - 1]! : null;
  if (longest && longest !== top) example.push(`Le plus long : « ${longest.label} », ${modeLeg('aller', longest.out)}, ${modeLeg('retour', longest.ret)}.`);
  const none = rows.filter((r) => r.out.minutes == null || r.ret.minutes == null);
  if (none.length) example.push(`Sans durée dessinée : ${none.map((r) => `« ${r.label} »`).join(', ')} ; c'est écrit sur la ligne.`);
  const cur = rows.find((r) => r.current);
  if (cur) example.push(`Le ciel affiché est celui de « ${cur.label} ».`);
  if (model.axisMax > 0) example.push(`L'axe va de 0 à ${minutes(model.axisMax)}.`);
  return { parts, example };
}

const communeLeg = (name: 'aller' | 'retour', l: CommuneChartLeg): string =>
  l.minutes != null ? `${name} ${minutes(l.minutes)} (triangle ${l.within ? 'plein' : 'vide'})` : `${name} : ${(l.written ?? 'non mesuré').toLowerCase()}`;

const cyanCount = (n: number, total: number): string =>
  `${formatInt(n)} commune${n > 1 ? 's' : ''} sur ${formatInt(total)} ${n > 1 ? 'sont' : 'est'} en cyan.`;

/** Graphique des communes du pôle : une ligne par commune, triée par postes, trait pointillé au temps choisi. */
export function communeChartReading(model: CommuneChartModel): ChartReading {
  const b = minutes(model.budget);
  const parts = [
    "Une ligne par commune du pôle, de celle qui compte le plus de postes salariés recensés par l'INSEE (écrits à droite) à celle qui en compte le moins.",
    ...TRI_PARTS,
    'Trait pointillé : le temps choisi par sens ; triangle plein : dans ce temps, vide : au-delà. Cyan : atteinte aller et retour.',
  ];
  const measured = model.rows.filter((r) => !r.self);
  const top = measured[0];
  if (!top) return { parts, example: [] };
  const example = [
    `Ici, en haut : ${top.name}, ${formatInt(top.jobs)} postes salariés. ${sentence(communeLeg('aller', top.out))}, ${communeLeg('retour', top.ret)} : ${
      top.accessible ? `les deux tiennent dans les ${b} par sens, la ligne est en cyan` : 'la ligne est en perle'
    }.`,
    cyanCount(measured.filter((r) => r.accessible).length, measured.length),
  ];
  if (model.rows.some((r) => r.self)) example.push('« Votre commune, non mesuré » : la commune de départ, sans trajet mesuré.');
  return { parts, example };
}

/* ------------------------------------------------------------------ voiture : route vide et trafic moyen */

export function trafficChartReading(model: TrafficChartModel): ChartReading {
  const parts = [
    "Une ligne par sens. Point vide : le temps en route vide ; point plein : avec le trafic moyen. L'axe part de 0, en minutes.",
    "À droite : l'indice du trafic moyen de la tranche horaire. Sans indice, seul le point vide est tracé.",
  ];
  const example = model.rows.map((r, i) => {
    const sens = `${i === 0 ? 'Ici, ' : ''}${r.label === 'Aller' ? "à l'aller" : 'au retour'}`;
    if (r.free == null) return sentence(`${sens} : aucun trajet en voiture trouvé, rien n'est tracé.`);
    if (r.traffic == null) return sentence(`${sens} : point vide à ${minutes(r.free)} (route vide), pas de point plein (${(r.written ?? '').toLowerCase()}).`);
    return sentence(`${sens} : point vide à ${minutes(r.free)} (route vide), point plein à ${minutes(r.traffic)} avec le trafic moyen (indice ${r.indexText ?? ''}).`);
  });
  return { parts, example };
}

/* ------------------------------------------------------------------ barres : projets de recrutement par famille de métiers */

export function recruitChartReading(rows: readonly RecruitChartRow[], { bassin, year }: { bassin: string; year: number | null }): ChartReading {
  const parts = [
    'Une barre par famille de métiers, de la plus nombreuse à la moins nombreuse. Sa longueur est rapportée à la plus grande : un repère, pas une part.',
    'Bout estompé : « au moins » (cases non diffusées non comptées). Famille non diffusée : pas de barre. Famille choisie : soulignée.',
  ];
  const drawn = rows.filter((r) => r.n != null);
  if (!drawn.length) return { parts, example: [] };
  const top = drawn[0]!;
  const last = drawn[drawn.length - 1]!;
  const when = year != null ? ` pour ${year}` : '';
  const example = [`Ici, dans le bassin d'emploi ${bassin}, la barre du haut est « ${top.label} » : ${top.phrase} projets de recrutement déclarés${when}${top.atLeast ? ' (bout estompé)' : ''}.`];
  if (last !== top) example.push(`La plus courte est « ${last.label} » : ${last.phrase}${last.atLeast ? ' (bout estompé)' : ''}.`);
  const hidden = rows.length - drawn.length;
  if (hidden > 0) example.push(`${formatInt(hidden)} famille${hidden > 1 ? 's' : ''} non diffusée${hidden > 1 ? 's' : ''} : pas de barre.`);
  return { parts, example };
}

/* ------------------------------------------------------------------ bande du trajet */

export function tripBandReading(model: TripBandModel | null, side: 'out' | 'ret'): ChartReading {
  const parts = [
    "La largeur de chaque tronçon est sa durée, écrite dessous. Pointillé : la marche ; cadre vide : l'attente ; couleur : la ligne empruntée.",
    "Aller et retour ont la même échelle. C'est un trajet donné en exemple, pas un verdict.",
  ];
  if (!model || !model.segments.length) return { parts, example: [] };
  const widest = model.segments.reduce((a, b) => (b.minutes > a.minutes ? b : a));
  return {
    parts,
    example: [
      `Ici, ${side === 'out' ? "à l'aller" : 'au retour'}, de gauche à droite : ${model.segments.map((s) => s.text).join(' ; ')}.`,
      `Le tronçon le plus large : ${widest.text}.`,
    ],
  };
}

/* ------------------------------------------------------------------ barre de part */

/** Barre de la part des postes du pôle atteints aller et retour (premier niveau du panneau, commune par commune). */
export function odShareReading({ percent, reached, measurable, year }: { percent: string | null; reached: number; measurable: number; year: number | null }): ChartReading {
  const parts = [
    "La barre entière : les postes salariés du pôle, recensés par l'INSEE, dont le trajet est mesuré ; la partie cyan : ceux atteints aller et retour.",
    'Le chiffre écrit fait foi, la barre le montre.',
  ];
  if (percent == null) return { parts, example: [] };
  return {
    parts,
    example: [
      `Ici, la barre est remplie à ${percent} : ${formatInt(reached)} postes salariés sont atteints aller et retour, sur ${formatInt(measurable)} postes du pôle dont le trajet est mesuré.`,
      "Dénominateur : postes du pôle dont le trajet est mesuré (sans ceux de la commune de départ, dont le trajet n'est pas mesuré).",
      ...(year != null ? [`Millésime des postes ${year}.`] : []),
    ],
  };
}

/** Barre de la part des habitants en emploi (actifs occupés) de la commune qui travaillent déjà dans le pôle (flux observés). */
export function flowShareReading({ name, flux, share, year, approx }: { name: string; flux: number; share: number; year: number | null; approx: boolean }): ChartReading {
  return {
    parts: [
      'La barre entière : tous les habitants de la commune qui ont un emploi ; la partie remplie : ceux qui travaillent dans ce pôle.',
      'En perle : une pratique observée, pas une possibilité calculée. Le chiffre écrit fait foi.',
    ],
    example: [
      `Ici, ${approx ? 'environ ' : ''}${formatInt(flux)} habitants de ${name} qui ont un emploi travaillent dans ce pôle : ${formatPercent(share)} des habitants en emploi de la commune, la part remplie de la barre.`,
      "Dénominateur : les actifs occupés du recensement (habitants de la commune qui ont un emploi, quel que soit leur lieu de travail ; les chômeurs n'y sont pas).",
      ...(year != null ? [`Recensement ${year}.`] : []),
    ],
  };
}

/* ------------------------------------------------------------------ jauge du compteur */

/**
 * Ce que sont les « postes salariés (INSEE) » du compteur, en clair (retour de Cyril, validé par Nicolas le 11/11) : première
 * ligne du « i » du compteur. Millésime LU dans les données (`jobs_year` des pôles EMP01), jamais écrit à la main ; sans
 * millésime publié, la phrase ne le dit pas.
 */
export function jobsDefinition(year: number | null): string {
  return `Postes salariés (INSEE) : postes salariés recensés par l'INSEE (Flores${year != null ? ` ${year}` : ''}), comptés au lieu de travail.`;
}

/**
 * Filet (jauge) sous le compteur de la barre : la part des postes atteints aller et retour. Même calcul que l'écran
 * (`CounterBlock`) : table OD, `reachedAll / measurableJobs` (toute l'Île-de-France hors commune de départ, `odShare`) ;
 * sinon `jobs / totalJobs` (postes des pôles du ciel). Le cas reprend le pourcentage, le nombre et le dénominateur affichés.
 */
export function counterGaugeReading({
  origin,
  budget,
  totals,
  od,
  year,
}: {
  origin: string | null;
  budget: number;
  totals: SkyTotals;
  od: boolean;
  year: number | null;
}): ChartReading {
  const o = od ? totals.od ?? null : null;
  // le millésime est dit une fois, dans la définition des postes (première ligne de la bulle)
  const intro = [jobsDefinition(year)];
  const parts = [
    o
      ? "Le filet sous le nombre : sa longueur entière représente les postes salariés d'Île-de-France dont le trajet est mesuré ; la partie cyan, ceux atteints aller et retour dans le temps choisi."
      : "Le filet sous le nombre : sa longueur entière représente les postes salariés de tous les pôles d'emploi du ciel ; la partie cyan, ceux des pôles accessibles aller et retour dans le temps choisi.",
    'Le nombre écrit fait foi, le filet le montre.',
  ];
  if (!origin || !totals.hasData) return { intro, parts, example: [] };
  const head = `Ici, depuis ${origin}, en ${minutes(budget)} ou moins par sens`;
  if (o) {
    if (!(o.measurableJobs > 0)) return { intro, parts, example: [] };
    const pct = formatPercent((o.reachedAll / o.measurableJobs) * 100);
    return {
      intro,
      parts,
      example: [
        `${head} : le filet est rempli à ${pct}, soit ${formatInt(o.reachedAll)} postes salariés atteints aller et retour sur ${formatInt(o.measurableJobs)} postes d'Île-de-France${o.selfJobs > 0 ? ' hors votre commune' : ''}.`,
        o.selfJobs > 0
          ? "Dénominateur : postes d'Île-de-France sans ceux de votre commune de départ, dont le trajet n'est pas mesuré."
          : "Dénominateur : postes d'Île-de-France dont le trajet est mesuré.",
      ],
    };
  }
  if (totals.jobs == null || !totals.totalJobs) return { intro, parts, example: [] };
  const pct = formatPercent((totals.jobs / totals.totalJobs) * 100);
  const poles = `${formatInt(totals.accessibleCount)} pôle${totals.accessibleCount > 1 ? 's' : ''} accessible${totals.accessibleCount > 1 ? 's' : ''}`;
  return {
    intro,
    parts,
    example: [
      `${head} : le filet est rempli à ${pct}, soit ${formatInt(totals.jobs)} postes salariés dans ${poles} aller et retour, sur ${formatInt(totals.totalJobs)} postes des ${formatInt(totals.poleCount)} pôles du ciel.`,
      `Dénominateur : postes salariés des ${formatInt(totals.poleCount)} pôles d'emploi du ciel.`,
    ],
  };
}

/* ------------------------------------------------------------------ ciel, diptyque, carte miroir */

function skyCase(totals: SkyTotals, od: boolean): string | null {
  if (!totals.hasData) return null;
  if (od && totals.od) return `${formatInt(totals.od.reachedAll)} postes salariés (INSEE) atteints aller et retour, dans ${formatInt(totals.od.reachedCommunes)} communes sur ${formatInt(totals.od.communes)}`;
  return `${formatInt(totals.accessibleCount)} astres sur ${formatInt(totals.poleCount)} allumés${totals.jobs != null ? `, ${formatInt(totals.jobs)} postes salariés (INSEE)` : ''}`;
}

/** Le ciel : un astre par pôle d'emploi, à place et taille fixes ; sa lumière dit s'il est atteint aller et retour. */
export function skyReading({ origin, budget, totals, od }: { origin: string | null; budget: number; totals: SkyTotals; od: boolean }): ChartReading {
  const parts = [
    "Chaque astre est un pôle d'emploi : même place et même taille dans tous les scénarios ; son aire suit ses postes salariés recensés par l'INSEE.",
    od
      ? "Son cœur cyan : la part de ses postes atteinte aller et retour dans le temps choisi ; l'arc plein de son contour en suit la part."
      : 'Allumé en cyan : atteint aller et retour dans le temps choisi ; gris-bleu : hors de portée, mais toujours là.',
    "L'étoile-guide : votre commune de départ. Les petits points de fond sont un décor, sans donnée.",
  ];
  const c = skyCase(totals, od);
  if (!origin || !c) return { parts, example: [] };
  return { parts, example: [`Ici, depuis ${origin}, en ${minutes(budget)} ou moins par sens : ${c}.`] };
}

/** Diptyque : deux ciels identiques, seule la lumière change. */
export function diptychReading(a: { name: string; totals: SkyTotals; od: boolean }, b: { name: string; totals: SkyTotals; od: boolean }, budget: number): ChartReading {
  const parts = [
    "Deux ciels côte à côte, A et B : mêmes astres, mêmes places, mêmes tailles. Seule la lumière change, selon la commune de départ.",
    "Un astre allumé d'un côté et éteint de l'autre est atteint aller et retour depuis une commune, pas depuis l'autre.",
    "« B par rapport à A » : la différence entre les deux ciels (B moins A).",
  ];
  const ca = skyCase(a.totals, a.od);
  const cb = skyCase(b.totals, b.od);
  if (!ca || !cb) return { parts, example: [] };
  return { parts, example: [`Ici, en ${minutes(budget)} ou moins par sens : depuis A · ${a.name}, ${ca} ; depuis B · ${b.name}, ${cb}.`] };
}

/** Phrases lues sous la légende de la carte jusqu'au 10/11, rangées dans le « i » mots inchangés */
export const MIRROR_DISC_NOTE = {
  astres: "Chaque disque est posé au centre de la commune qui nomme son astre (le contour épais entoure toutes les communes de l'astre) ; sa surface est proportionnelle aux postes salariés recensés par l'INSEE.",
  poles: "Chaque disque est posé sur l'arrêt le plus desservi de son pôle ; sa surface est proportionnelle aux postes salariés recensés par l'INSEE.",
  sky: 'Le ciel est une projection schématique de cette carte.',
};

/** Carte miroir : les communes à leur vraie place, coloriées selon leur état depuis la commune de départ. */
export function mirrorReading({
  origin,
  budget,
  od,
  accessibleCount,
  poleCount,
  astres,
}: {
  origin: string | null;
  budget: number;
  od: OdSkyTotals | null;
  accessibleCount: number;
  poleCount: number;
  astres: boolean;
}): ChartReading {
  const parts = [
    od
      ? "Chaque commune est à sa vraie place. Cyan : commune atteinte aller et retour dans le temps choisi ; hachures : aller possible, retour hors de portée ; sombre : hors de portée."
      : "Chaque pôle est à sa vraie place. Cyan : pôle accessible aller et retour dans le temps choisi ; sombre : hors de portée.",
    astres ? MIRROR_DISC_NOTE.astres : MIRROR_DISC_NOTE.poles,
    MIRROR_DISC_NOTE.sky,
  ];
  if (!origin) return { parts, example: [] };
  const c = od
    ? `${formatInt(od.reachedCommunes)} communes sont en cyan : elles sont atteintes aller et retour et comptent ${formatInt(od.reachedAll)} postes salariés`
    : `${formatInt(accessibleCount)} pôles sur ${formatInt(poleCount)} sont en cyan`;
  return { parts, example: [`Ici, depuis ${origin}, en ${minutes(budget)} ou moins par sens : ${c}.`] };
}
