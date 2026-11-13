/**
 * Projets de recrutement de l'enquête BMO 2026 (France Travail, EMP03, D-035), par bassin d'emploi (GEO04).
 * Contrat `bmo-1` (pipeline : `starway/bmo.py`, `scripts/06j_export_bmo.py`). Fonctions PURES.
 *
 * Règles de vérité (docs/etude-bmo.md) :
 * - ce sont des INTENTIONS de recrutement déclarées par les employeurs, une TENDANCE du bassin : ni des offres
 *   publiées, ni des embauches, jamais des postes salariés recensés par l'INSEE (ce que mesurent les astres) ;
 * - clé = code du bassin d'emploi (`pole.bassin.code`, jeu des 44 astres) ; un astre sans bassin
 *   n'a pas de bassin : « non disponible pour cet astre », aucune valeur ;
 * - une case « * » est non diffusée par France Travail (vraisemblablement moins de 5 projets : DÉDUCTION de l'équipe, le
 *   sens n'est pas défini par la source) et n'est pas comptée : une somme dont `masked` > 0 est un minimum
 *   (« au moins n » : 20 + 10 + « * » = « au moins 30 ») ; `n` null : aucune case publiée, « non diffusé » (jamais 0) ;
 * - les projets ne sont pas répartis entre les astres d'un même bassin (Paris : 20 arrondissements, un bassin).
 */
import { formatInt } from './format';
import type { Pole } from './types';

export type BmoMetric = 'met' | 'xmet' | 'smet';

/** Somme des cases publiées (`n`, null si aucune) et nombre de cases « * » non comptées. */
export interface BmoCell {
  n: number | null;
  masked: number;
}

export type BmoCells = Record<BmoMetric, BmoCell>;

export interface BmoFamily {
  code: string;
  label: string;
}

export interface BmoBassin {
  name: string;
  total: BmoCells;
  families: Record<string, BmoCells>;
}

export interface BmoMaskedEvidence {
  rows: number;
  min_published: Record<BmoMetric, number>;
  published_below_threshold: number;
  threshold: number;
}

/** Cases « * » : libellé, statut et note de DÉDUCTION lus dans le fichier publié (écrits par le pipeline, jamais recopiés ici). */
export interface BmoMasked {
  label: string;
  note: string;
  evidence?: BmoMaskedEvidence;
}

export interface BmoFile {
  contract: 'bmo-1';
  year: number;
  families: BmoFamily[];
  masked: BmoMasked;
  region: {
    published: BmoCells;
    official: { source_id: string; table: string; page: number; projects: number };
  };
  bassins: Record<string, BmoBassin>;
}

const METRICS: BmoMetric[] = ['met', 'xmet', 'smet'];

function isCell(x: unknown): x is BmoCell {
  const c = x as BmoCell | null;
  return !!c && typeof c === 'object' && (c.n === null || Number.isInteger(c.n)) && Number.isInteger(c.masked) && c.masked >= 0;
}

function isCells(x: unknown): x is BmoCells {
  const c = x as Record<string, unknown> | null;
  return !!c && typeof c === 'object' && METRICS.every((m) => isCell(c[m]));
}

/** Garde de forme du fichier publié : tout autre contenu (page HTML de repli, ancien contrat) est refusé. */
export function isBmoFile(x: unknown): x is BmoFile {
  const f = x as BmoFile | null;
  if (!f || typeof f !== 'object' || f.contract !== 'bmo-1' || !Number.isInteger(f.year)) return false;
  if (!Array.isArray(f.families) || !f.families.every((a) => typeof a?.code === 'string' && typeof a?.label === 'string')) return false;
  if (!f.region || !isCells(f.region.published) || !Number.isInteger(f.region.official?.projects)) return false;
  if (typeof f.masked?.label !== 'string' || typeof f.masked?.note !== 'string') return false;
  if (!f.bassins || typeof f.bassins !== 'object') return false;
  return Object.values(f.bassins).every((b) => typeof b?.name === 'string' && isCells(b.total) && !!b.families && Object.values(b.families).every(isCells));
}

/**
 * Nombre de projets : « au moins 32 926 » si des cases « * » ne sont pas comptées, « 32 926 » sinon, « non diffusé » si
 * aucune case n'est publiée (jamais 0).
 */
export function projectsPhrase(c: BmoCell | null | undefined): string {
  if (!c || c.n == null) return 'non diffusé';
  return `${c.masked > 0 ? 'au moins ' : ''}${formatInt(c.n)}`;
}

/** Cases « * » : « 22 cases « * » : non diffusé par France Travail (vraisemblablement moins de 5 projets) » ; null s'il n'y en a pas. */
export function maskedPhrase(c: BmoCell | null | undefined, masked: Pick<BmoMasked, 'label'>): string | null {
  if (!c || c.masked <= 0) return null;
  return `${c.masked} ${c.masked > 1 ? 'cases' : 'case'} « * » : ${masked.label}`;
}

export type RecruitView =
  | { status: 'ok'; code: string; bassin: BmoBassin; astres: number }
  /** Astre sans bassin d'emploi : aucune valeur */
  | { status: 'no_bassin' }
  /** Bassin absent du fichier publié : aucune valeur */
  | { status: 'unknown_bassin'; code: string };

/** Données du bassin d'un astre ; `astres` : nombre d'astres du ciel qui partagent ce bassin (20 pour Paris). */
export function recruitView(file: BmoFile, pole: Pick<Pole, 'bassin'>, poles: readonly Pick<Pole, 'bassin'>[]): RecruitView {
  const code = pole.bassin?.code;
  if (!code) return { status: 'no_bassin' };
  const bassin = file.bassins[code];
  if (!bassin) return { status: 'unknown_bassin', code };
  return { status: 'ok', code, bassin, astres: poles.filter((p) => p.bassin?.code === code).length };
}

/** Mesures d'une famille (`null` : tous les métiers) ; une famille sans ligne dans le bassin renvoie null. */
export function scopeCells(bassin: BmoBassin, family: string | null): BmoCells | null {
  return family == null ? bassin.total : (bassin.families[family] ?? null);
}

export interface FamilyRow {
  code: string;
  label: string;
  cell: BmoCell | null;
  /** 0 à 1 : projets publiés rapportés à la plus grande famille du bassin (repère visuel, pas une part) */
  bar: number;
}

/** Les familles du bassin, dans l'ordre du fichier (projets publiés décroissants en Île-de-France). */
export function familyRows(file: BmoFile, bassin: BmoBassin): FamilyRow[] {
  const rows = file.families.map((f) => ({ code: f.code, label: f.label, cell: bassin.families[f.code]?.met ?? null }));
  const max = Math.max(0, ...rows.map((r) => r.cell?.n ?? 0));
  return rows.map((r) => ({ ...r, bar: max > 0 && r.cell?.n != null ? r.cell.n / max : 0 }));
}

/** Phrase de tendance, avec la source du chiffre dite en clair (la ligne de provenance, elle, n'apparaît qu'en mode sources). */
export function trendText(year: number): string {
  return `Les employeurs de ce bassin d'emploi ont déclaré ces projets de recrutement pour ${year}. Ce sont des intentions recueillies fin ${year - 1} : ni des offres publiées, ni des embauches. Ce chiffre donne une tendance des bassins de recrutement.`;
}

/**
 * Ligne du bassin écrite sous le titre du pli « Emplois et recrutement », pli fermé. Tout est lu dans le fichier publié :
 * « Projets de recrutement 2026 du bassin : au moins 32 926, dont au moins 11 451 jugés difficiles. » Garde mot pour mot le fragment de
 * `keep-visible.json` « dont au moins » (des minimums). Audit d'affichage du 11/11 (P36) : la réserve « ni des offres publiées, ni des
 * embauches » est dans le « i » de la ligne (`trendTipLines`, phrase de `trendText`) ; en mode sources (`withScope`), elle est écrite en clair.
 */
export function recruitLineText(year: number, c: BmoCells, withScope = false): string {
  const hard = c.met.n != null && c.xmet.n != null ? `, dont ${projectsPhrase(c.xmet)} jugés difficiles` : '';
  return `Projets de recrutement ${year} du bassin : ${projectsPhrase(c.met)}${hard}${withScope ? ' : ni des offres publiées, ni des embauches' : ''}.`;
}

/**
 * Le « i » de cette ligne : la tendance (`trendText`), mots inchangés, une phrase par ligne de la bulle. Sans mode sources (audit
 * d'affichage du 11/11, P36), la deuxième phrase garde sa réserve « ni des offres publiées, ni des embauches » ; en mode sources, la
 * réserve est écrite dans la ligne (`withScope`), la bulle ne la redit pas.
 */
export function trendTipLines(year: number, withScope = true): string[] {
  return [
    `Les employeurs de ce bassin d'emploi ont déclaré ces projets de recrutement pour ${year}.`,
    `Ce sont des intentions recueillies fin ${year - 1}${withScope ? ' : ni des offres publiées, ni des embauches' : ''}.`,
    'Ce chiffre donne une tendance des bassins de recrutement.',
  ];
}

/** Saisonniers du bassin, pour le « i » de la ligne : « Projets saisonniers : au moins 1 705. » (« non diffusé » si aucune case publiée). */
export function seasonalText(c: BmoCells): string {
  return `Projets saisonniers : ${projectsPhrase(c.smet)}.`;
}

/** Détail d'une famille ou du bassin : difficiles et saisonniers, avec les mêmes réserves. */
export function detailText(c: BmoCells): string {
  const parts: string[] = [];
  if (c.xmet.n != null) parts.push(`${projectsPhrase(c.xmet)} jugés difficiles`);
  if (c.smet.n != null) parts.push(`${projectsPhrase(c.smet)} saisonniers`);
  return parts.length ? `Dont ${parts.join(' et ')}.` : 'Difficiles et saisonniers : non diffusés.';
}

export function scopeText(astres: number): string {
  const share = astres > 1 ? ` Ce bassin d'emploi couvre ${astres} astres : le même bloc s'affiche pour chacun, les projets ne leur sont pas répartis.` : '';
  return `Le bassin d'emploi est un découpage de France Travail. Les projets ne sont pas localisés plus finement et ne sont pas répartis entre les astres.${share}`;
}

/** Texte « Champ et limites » (docs/etude-bmo.md § 1 et § 5) : ce que BMO couvre, ce qu'il ne dit pas. « * » : voir `starLimit`. */
export const LIMITS: readonly string[] = [
  "Enquête Besoins en main-d'oeuvre de France Travail : employeurs privés, collectivités territoriales, établissements publics administratifs. Hors administrations de l'État. Contrats courts et saisonniers inclus.",
  "Les projets sont des intentions déclarées pour l'année, pas des postes ouverts : ils ne s'ajoutent pas aux postes salariés des astres recensés par l'INSEE (autre source, autre champ).",
  "Ni la page méthode de France Travail ni le rapport « Éclairages et synthèses n° 87 » ne disent si l'intérim est compté (ni les particuliers employeurs), et l'équipe n'a pas la réponse : le chiffre n'affirme rien là-dessus, dans un sens comme dans l'autre.",
];

/** Limite sur « * » : le libellé, le fait qu'il s'agit d'une déduction, et la conséquence (minimum), tels qu'écrits par le pipeline. */
export function starLimit(masked: BmoMasked): string {
  return `Cases marquées « * » : ${masked.label}. ${masked.note} Elles ne sont pas comptées : les chiffres sont des minimums.`;
}

/** Méthode, affichée avec la source quand le mode sources est actif (D-033). */
export function methodText(masked: BmoMasked): string {
  return `Méthode : somme des cases publiées par France Travail, par bassin d'emploi et par famille de métiers (lignes de plusieurs départements ou comités locaux additionnées) ; une case « * » n'est pas comptée, d'où « au moins n » ; aucune case publiée : « non diffusé », jamais 0. « * » : ${masked.label}.`;
}

/** Repère pour l'Île-de-France entière : total officiel de France Travail, à côté de la somme des cases publiées. */
export function regionText(file: BmoFile): string {
  return `Île-de-France : ${formatInt(file.region.official.projects)} projets de recrutement déclarés pour ${file.year} (total officiel de France Travail).`;
}
