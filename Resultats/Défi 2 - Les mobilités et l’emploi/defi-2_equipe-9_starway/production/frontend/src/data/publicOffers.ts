/**
 * Offres diffusées sur « Choisir le service public » (DGAFP, EMP04, D-036), par commune. Contrat `service-public-1`
 * (comptes) et `service-public-offres-1` (liste) ; pipeline : `starway/service_public.py`,
 * `scripts/06q_export_service_public.py`. Fonctions PURES.
 *
 * Règles de vérité (docs/methodologie.md § 5 novemdecies) :
 * - ce sont des offres DIFFUSÉES, en ligne à la date du fichier selon leurs dates de publication. Une date de
 *   publication ne prouve pas que le poste est encore à pourvoir : jamais écrit « postes ouverts » ;
 * - jamais mélangées aux postes salariés des astres recensés par l'INSEE (Flores) ni comptées dedans ; aucun effet sur le ciel ni
 *   sur les verdicts ;
 * - rattachées à un astre par la COMMUNE seulement (clé réelle : code postal vérifié) ; une offre connue seulement au
 *   département reste à part, sans répartition entre les astres ;
 */
import { formatInt } from './format';
import type { Pole } from './types';

export const SERVICE_PUBLIC_CONTRACT = 'service-public-1';
export const OFFERS_CONTRACT = 'service-public-offres-1';

/** Versants de la fonction publique, dans l'ordre d'affichage ; « n/c » : non renseigné dans le fichier. */
export const VERSANT_ORDER = ['FPT', 'FPE', 'FPH', 'n/c'] as const;

export interface PublicOffersCommune {
  n: number;
  v: Record<string, number>;
}

export interface PublicOffersFile {
  contract: typeof SERVICE_PUBLIC_CONTRACT;
  as_of: string;
  source_id: string;
  file: { name: string; sha256: string; extracted_at: string };
  method: string;
  metadata_gap: { fiche_temporal_coverage: { start: string; end: string }; note: string };
  versants: Record<string, string>;
  counts: { online_references: number; file_rows_without_publication_dates: number };
  region: { offers: number; commune: number; departement: number; departement_reasons: Record<string, number> };
  communes: Record<string, PublicOffersCommune>;
  offers_file: string;
}

/** Une offre de la liste : référence, intitulé, versant, indice d'employeur, début et fin de publication (null : sans fin). */
export interface PublicOffer {
  r: string;
  t: string;
  v: string;
  e: number;
  d: string;
  f: string | null;
}

export interface PublicOffersList {
  contract: typeof OFFERS_CONTRACT;
  as_of: string;
  link: string;
  employers: string[];
  communes: Record<string, PublicOffer[]>;
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Garde de forme du fichier de comptes : tout autre contenu (page HTML de repli, ancien contrat) est refusé. */
export function isPublicOffersFile(x: unknown): x is PublicOffersFile {
  const f = x as PublicOffersFile | null;
  if (!f || typeof f !== 'object' || f.contract !== SERVICE_PUBLIC_CONTRACT || typeof f.as_of !== 'string' || !ISO.test(f.as_of)) return false;
  if (typeof f.method !== 'string' || !f.versants || typeof f.versants !== 'object') return false;
  if (!f.region || !isInt(f.region.offers) || !isInt(f.region.commune) || !isInt(f.region.departement)) return false;
  if (!f.counts || !isInt(f.counts.online_references) || !isInt(f.counts.file_rows_without_publication_dates)) return false;
  if (typeof f.metadata_gap?.note !== 'string') return false;
  if (!f.communes || typeof f.communes !== 'object') return false;
  return Object.values(f.communes).every((c) => isInt(c?.n) && !!c.v && Object.values(c.v).every(isInt));
}

/** Garde de forme de la liste (chargée à la demande). */
export function isPublicOffersList(x: unknown): x is PublicOffersList {
  const f = x as PublicOffersList | null;
  if (!f || typeof f !== 'object' || f.contract !== OFFERS_CONTRACT || typeof f.link !== 'string' || !f.link.includes('{r}')) return false;
  if (!Array.isArray(f.employers) || !f.communes || typeof f.communes !== 'object') return false;
  return Object.values(f.communes).every((l) => Array.isArray(l) && l.every((o) => typeof o?.r === 'string' && typeof o.t === 'string' && ISO.test(o.d)));
}

export interface AstreOffers {
  /** Offres rattachées à une commune de l'astre (même clé que les postes : la commune) */
  n: number;
  /** Par versant, dans l'ordre d'affichage, les versants à zéro omis */
  versants: { code: string; label: string; n: number }[];
  /** Communes de l'astre qui portent au moins une offre */
  communes: string[];
  /** Nombre de communes de l'astre */
  communeCount: number;
}

/** Offres diffusées dans les communes d'un astre (somme des communes ; une offre n'a qu'une commune, donc aucun doublon). */
export function astreOffers(file: PublicOffersFile, pole: Pick<Pole, 'communes'>): AstreOffers {
  const sums: Record<string, number> = {};
  const withOffers: string[] = [];
  let n = 0;
  for (const code of pole.communes) {
    const c = file.communes[code];
    if (!c) continue;
    n += c.n;
    withOffers.push(code);
    for (const [v, k] of Object.entries(c.v)) sums[v] = (sums[v] ?? 0) + k;
  }
  const known = VERSANT_ORDER.filter((v) => sums[v]);
  const other = Object.keys(sums).filter((v) => !(VERSANT_ORDER as readonly string[]).includes(v));
  return {
    n,
    versants: [...known, ...other].map((code) => ({ code, label: file.versants[code] ?? code, n: sums[code]! })),
    communes: withOffers,
    communeCount: pole.communes.length,
  };
}

/** « 12/10/2026 » depuis « 2026-10-12 » ; chaîne vide si illisible. */
export function frDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** « au 11/10/2026 » : la date du fichier, pas la date du jour. */
export function asOfText(file: Pick<PublicOffersFile, 'as_of'>): string {
  return `au ${frDate(file.as_of)}`;
}

/** Titre du chiffre : « 62 offres diffusées au 11/10/2026 » (jamais « postes », jamais « ouvertes »). */
export function offersPhrase(n: number, file: Pick<PublicOffersFile, 'as_of'>): string {
  return `${formatInt(n)} ${n > 1 ? 'offres diffusées' : 'offre diffusée'} ${asOfText(file)}`;
}

/** Périmètre du chiffre, en clair : l'astre est une liste de communes, une offre a une seule commune. */
export function scopeText(a: Pick<AstreOffers, 'n' | 'communes' | 'communeCount'>): string {
  const total = `${formatInt(a.communeCount)} ${a.communeCount > 1 ? 'communes' : 'commune'}`;
  if (a.communeCount === 1) return 'Offres dont le code postal désigne la commune de cet astre.';
  return `Offres dont le code postal désigne l'une des ${total} de cet astre : ${formatInt(a.communes.length)} en portent au moins une.`;
}

/** Repère régional, séparé : ce qui est rattaché à une commune et ce qui reste au département (sans répartition). */
export function regionText(file: PublicOffersFile): string {
  const r = file.region;
  return (
    `En Île-de-France : ${formatInt(r.offers)} offres diffusées ${asOfText(file)}, dont ${formatInt(r.commune)} rattachées à une commune ` +
    `et ${formatInt(r.departement)} connues seulement au département, non réparties entre les astres.`
  );
}

/** Limites du bloc, écrites une fois (jamais de chiffre : ils viennent du fichier). */
export const LIMITS: readonly string[] = [
  'Ce sont des offres diffusées sur Choisir le service public : une date de publication ne prouve pas que le poste est encore à pourvoir.',
  'Elles ne sont pas des postes salariés recensés par l\'INSEE : ce chiffre n\'est jamais ajouté aux postes de l\'astre, et il ne change ni la taille des astres ni les verdicts.',
  'Une référence est comptée une fois, même si le fichier la répète sur plusieurs lignes.',
  'L\'adresse est un texte libre : une offre n\'est rattachée à une commune que si son code postal la désigne sans ambiguïté et que le nom écrit ne la contredit pas. Les autres restent au département.',
];

/** Lien officiel d'une offre (le modèle vient du fichier publié : `link`, avec `{r}` pour la référence). */
export function offerUrl(list: Pick<PublicOffersList, 'link'>, ref: string): string {
  return list.link.replace('{r}', encodeURIComponent(ref));
}

/** Les offres les plus récemment publiées dans les communes d'un astre (à égalité de date : référence). */
export function recentOffers(list: PublicOffersList, pole: Pick<Pole, 'communes'>, limit: number): { offers: (PublicOffer & { insee: string })[]; total: number } {
  const all: (PublicOffer & { insee: string })[] = [];
  for (const insee of pole.communes) for (const o of list.communes[insee] ?? []) all.push({ ...o, insee });
  all.sort((a, b) => (a.d === b.d ? a.r.localeCompare(b.r) : a.d < b.d ? 1 : -1));
  return { offers: all.slice(0, limit), total: all.length };
}

/** Employeur (organisme de rattachement du fichier) d'une offre ; chaîne vide si l'indice est hors liste. */
export function employerOf(list: Pick<PublicOffersList, 'employers'>, o: Pick<PublicOffer, 'e'>): string {
  return list.employers[o.e] ?? '';
}
