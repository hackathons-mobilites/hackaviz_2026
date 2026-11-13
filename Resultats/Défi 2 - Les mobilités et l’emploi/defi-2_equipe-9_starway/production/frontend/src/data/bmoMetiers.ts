/**
 * Projets de recrutement BMO 2026 par bassin d'emploi ET par métier (France Travail, EMP03, D-035) : fichier
 * `bmo_metiers.json` (contrat `bmo-metiers-1`), publié POUR LA VISITE GUIDÉE (étape « recrutement »). Le panneau de
 * preuve lit `bmo.json` (par famille de métiers) ; ce fichier-ci n'est lu que par la visite. Fonctions PURES.
 *
 * Mêmes règles de vérité que `bmo.ts` : une TENDANCE déclarée par les employeurs (ni offres, ni embauches, jamais les
 * postes salariés des astres recensés par l'INSEE) ; une case « * » n'est pas comptée (« au moins n ») ; aucune case publiée :
 * aucune valeur (jamais 0).
 */
import { formatInt } from './format';
import { peopleOral } from './oral';

/** `[met, met_masked, xmet, xmet_masked, smet, smet_masked]` (`n` null : aucune case publiée). */
export type BmoMetierRow = readonly [number | null, number, number | null, number, number | null, number];

export interface BmoMetier {
  code: string;
  name: string;
  family: string;
}

export interface BmoMetiersFile {
  contract: 'bmo-metiers-1';
  year: number;
  metiers: BmoMetier[];
  /** bassins[code_bassin][code_metier] */
  bassins: Record<string, Record<string, BmoMetierRow>>;
}

/** Garde de forme : tout autre contenu (page HTML de repli, autre contrat) est refusé. */
export function isBmoMetiersFile(x: unknown): x is BmoMetiersFile {
  const f = x as BmoMetiersFile | null;
  if (!f || typeof f !== 'object' || f.contract !== 'bmo-metiers-1' || !Number.isInteger(f.year)) return false;
  if (!Array.isArray(f.metiers) || !f.metiers.every((m) => typeof m?.code === 'string' && typeof m?.name === 'string')) return false;
  if (!f.bassins || typeof f.bassins !== 'object') return false;
  return Object.values(f.bassins).every(
    (b) => !!b && typeof b === 'object' && Object.values(b).every((r) => Array.isArray(r) && r.length === 6 && (r[0] === null || Number.isInteger(r[0]))),
  );
}

/** Projets de recrutement d'un métier dans un bassin : somme des cases publiées et cases « * » non comptées ; null si absent. */
export function metierProjects(file: BmoMetiersFile, bassin: string | null | undefined, metier: string): { n: number | null; masked: number } | null {
  if (!bassin) return null;
  const row = file.bassins[bassin]?.[metier];
  return row ? { n: row[0], masked: row[1] } : null;
}

/** Libellé du métier (celui de la source), null s'il n'existe pas. */
export function metierName(file: BmoMetiersFile, metier: string): string | null {
  return file.metiers.find((m) => m.code === metier)?.name ?? null;
}

/**
 * « près de 7 000 » (arrondi comme les personnes de la visite), « au moins 6 000 » si des cases « * » ne sont pas
 * comptées ; null si aucune case n'est publiée : la visite ne prononce jamais « 0 projet ».
 */
export function metierProjectsOral(c: { n: number | null; masked: number } | null): string | null {
  if (!c || c.n == null || c.n <= 0) return null;
  if (c.masked > 0) {
    // « au moins » : arrondi par le bas, jamais au-dessus de la somme des cases publiées
    const step = c.n >= 10_000 ? 1_000 : c.n >= 1_000 ? 100 : 10;
    return `au moins ${formatInt(Math.max(step, Math.floor(c.n / step) * step))}`;
  }
  return peopleOral(c.n);
}
