/**
 * Repères de territoire (D-048, plan docs/plan-contexte-territoire.md) : chômage de la zone d'emploi, du département et de
 * la région, temps de travail (soir et nuit) et polarité SDRIF-E de la commune de départ. Fonctions PURES au-dessus de
 * `territoire.json` (contrat `territoire-1`, publié par `pipeline/scripts/06v_export_territoire.py`).
 *
 * Aucun chiffre n'est écrit ici : tout vient du fichier. Descriptif seulement : aucun lien de cause avec l'accessibilité,
 * aucun seuil, aucun verdict. Le taux de chômage est mesuré au lieu de RÉSIDENCE : il parle des habitants de la commune de
 * départ, jamais d'un astre. La part du soir et de la nuit est nationale (enquête Emploi) : aucune valeur par territoire.
 */

export interface TerritoireZone {
  name: string;
  /** Un taux (en %) par trimestre de `quarters`, du plus ancien au plus récent */
  series: number[];
}

export interface TerritoireRate {
  name: string;
  rate: number;
}

export interface TerritoireChomage {
  /** Dernier trimestre publié : « 2026-T2 » */
  quarter: string;
  /** Le dernier trimestre est provisoire (peut être révisé) */
  provisional: boolean;
  /** Date de parution ISO : « 2026-09-18 » */
  published: string;
  quarters: string[];
  zones: Record<string, TerritoireZone>;
  departments: Record<string, TerritoireRate>;
  region: TerritoireRate;
}

export interface TerritoireTempsDeTravail {
  year: number;
  evening_pct: number;
  night_pct: number;
  /** Champ de l'enquête : « France hors Mayotte, ensemble des salariés » */
  scope: string;
  published: string;
}

export interface TerritoireCommune {
  zone: string;
  /** Nom de la polarité SDRIF-E ; null si la commune n'en a pas (la raison est dans `null_reasons`) */
  polarity: string | null;
}

export interface TerritoireFile {
  contract: 'territoire-1';
  chomage: TerritoireChomage;
  temps_de_travail: TerritoireTempsDeTravail;
  communes: Record<string, TerritoireCommune>;
  null_reasons?: Record<string, string>;
  sources?: { source_id: string; file: string; sha256: string; label: string; downloaded: string }[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Garde de forme : un fichier absent ou d'un autre contrat n'affiche rien (rien n'est inventé). */
export function isTerritoireFile(x: unknown): x is TerritoireFile {
  if (!isObj(x) || x.contract !== 'territoire-1') return false;
  const c = x.chomage;
  const t = x.temps_de_travail;
  if (!isObj(c) || !isObj(t) || !isObj(x.communes)) return false;
  if (typeof c.quarter !== 'string' || typeof c.provisional !== 'boolean' || typeof c.published !== 'string' || !Array.isArray(c.quarters)) return false;
  if (!isObj(c.zones) || !isObj(c.departments) || !isObj(c.region) || !isNum(c.region.rate)) return false;
  for (const z of Object.values(c.zones)) {
    if (!isObj(z) || typeof z.name !== 'string' || !Array.isArray(z.series) || z.series.length === 0 || !z.series.every(isNum)) return false;
  }
  for (const d of Object.values(c.departments)) if (!isObj(d) || typeof d.name !== 'string' || !isNum(d.rate)) return false;
  return isNum(t.year) && isNum(t.evening_pct) && isNum(t.night_pct) && typeof t.scope === 'string' && typeof t.published === 'string';
}

/* ------------------------------------------------------------------ mise en forme */

const nfRate = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 8.6 → « 8,6 % » (une décimale, comme la source) */
export function rateText(v: number): string {
  return `${nfRate.format(v)}\u00a0%`;
}

/** 27 → « 27 % » (la part du soir et de la nuit est publiée en entier) */
export function pctText(v: number): string {
  return `${v}\u00a0%`;
}

/** « 2026-09-18 » → « 18/09/2026 » ; null si illisible */
export function frDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** « 2026-T2 » → « 2e trimestre 2026 » ; « 2026-T1 » → « 1er trimestre 2026 » ; le texte reçu si illisible */
export function quarterLabel(q: string): string {
  const m = /^(\d{4})-T([1-4])$/.exec(q);
  return m ? `${m[2] === '1' ? '1er' : `${m[2]}e`} trimestre ${m[1]}` : q;
}

/** « de Paris », « d'Étampes » (élision devant une voyelle) */
export function ofName(name: string): string {
  return /^[AEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜ]/i.test(name) ? `d'${name}` : `de ${name}`;
}

/** « Zone d'emploi de Paris », « Zone d'emploi d'Étampes » */
export function zoneLabel(name: string): string {
  return `Zone d'emploi ${ofName(name)}`;
}

/** Département d'une commune de départ : les deux premiers chiffres du code commune (Île-de-France). */
export const departmentOf = (insee: string): string => insee.slice(0, 2);

/* ------------------------------------------------------------------ chômage */

/** Dernier taux publié d'une zone (son dernier trimestre) */
export const lastRate = (z: Pick<TerritoireZone, 'series'>): number => z.series[z.series.length - 1]!;

/** Taux du dernier trimestre des zones d'emploi, triés du plus bas au plus haut (un point par zone sur la bande) */
export function zoneRates(file: TerritoireFile): { id: string; name: string; rate: number }[] {
  return Object.entries(file.chomage.zones)
    .map(([id, z]) => ({ id, name: z.name, rate: lastRate(z) }))
    .sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name, 'fr'));
}

export interface ZoneRank {
  /** Zones d'emploi à taux strictement plus élevé */
  above: number;
  /** Autres zones à taux strictement égal (hors la zone elle-même) */
  tied: number;
  /** Nombre de zones d'emploi d'Île-de-France */
  total: number;
}

/** Rang d'une zone parmi les zones d'emploi publiées : comptes seulement, aucun seuil. */
export function zoneRank(file: TerritoireFile, zoneId: string): ZoneRank | null {
  const z = file.chomage.zones[zoneId];
  if (!z) return null;
  const rate = lastRate(z);
  let above = 0;
  let tied = 0;
  for (const [id, other] of Object.entries(file.chomage.zones)) {
    const r = lastRate(other);
    if (r > rate) above++;
    else if (r === rate && id !== zoneId) tied++;
  }
  return { above, tied, total: Object.keys(file.chomage.zones).length };
}

/**
 * Phrase du rang (plan § 3) : « 3 zones d'emploi sur 15 en Île-de-France ont un taux plus élevé. » ou « Le taux le plus élevé
 * des 15 zones d'emploi d'Île-de-France. » ; les égalités sont dites (« ex aequo avec 1 autre »), jamais départagées.
 */
export function zoneRankSentence(r: ZoneRank): string {
  const ties = r.tied === 0 ? '' : ` (ex aequo avec ${r.tied} autre${r.tied > 1 ? 's' : ''})`;
  if (r.above === 0) return `Le taux le plus élevé des ${r.total} zones d'emploi d'Île-de-France${ties}.`;
  return `${r.above} zone${r.above > 1 ? 's' : ''} d'emploi sur ${r.total} en Île-de-France ${r.above > 1 ? 'ont' : 'a'} un taux plus élevé${ties}.`;
}

export interface CommuneTerritoire {
  insee: string;
  zoneId: string;
  zone: TerritoireZone;
  /** Département de la commune, ou null si le fichier n'a pas son taux */
  department: (TerritoireRate & { code: string }) | null;
  polarity: string | null;
}

/** Repères d'une commune de départ ; null si le fichier ne la connaît pas ou si sa zone manque. */
export function communeTerritoire(file: TerritoireFile | null | undefined, insee: string | null | undefined): CommuneTerritoire | null {
  if (!file || !insee) return null;
  const c = file.communes[insee];
  const zone = c ? file.chomage.zones[c.zone] : undefined;
  if (!c || !zone) return null;
  const code = departmentOf(insee);
  const dep = file.chomage.departments[code];
  return { insee, zoneId: c.zone, zone, department: dep ? { code, ...dep } : null, polarity: c.polarity };
}

/** Note : trimestre provisoire (toujours visible, plan § 3) */
export function provisionalNote(c: Pick<TerritoireChomage, 'quarter' | 'provisional'>): string | null {
  return c.provisional ? `Le dernier trimestre (${quarterLabel(c.quarter)}) est provisoire : il peut être révisé.` : null;
}

/**
 * Lecture de la bande des zones d'emploi : lue sous la bande jusqu'au 10/11, rangée depuis dans le « i » « Comment lire ce graphique »
 * (demande de Nicolas du 10/11), mots inchangés.
 */
export const ZONE_STRIP_READING = "Un point par zone d'emploi d'Île-de-France.";

/**
 * Maille de la bande : écrite sous la bande jusqu'au 10/11, rangée depuis dans son « i » « Comment lire ce graphique » (lot 6 de
 * l'audit d'affichage du 10/11), mots inchangés.
 */
export const ZONE_SCALE_NOTE = "Une zone d'emploi est plus large que la commune, et différente des bassins d'emploi de France Travail qui font nos astres.";

/**
 * Dénominateur du taux de chômage localisé (règle de vérité : dénominateurs explicites), tel que le définit la feuille « Documentation »
 * du fichier de l'Insee (SOC02, chomage-zone-t1-2003-t2-2026.xlsx) : « le rapport (en %) entre une estimation du nombre de chômeurs et
 * la population active estimée au lieu de résidence. La population active comprend les personnes occupant un emploi et les chômeurs. »
 */
export const CHOMAGE_DENOMINATOR = 'population active estimée au lieu de résidence (personnes occupant un emploi et chômeurs)';

/** Notes du chômage, TOUJOURS visibles dans l'onglet : mesure au lieu de résidence, aucune cause (la maille est au « i » de la bande). */
export const CHOMAGE_NOTES: readonly string[] = [
  "Taux mesuré au lieu de résidence : il parle des habitants de la commune de départ, pas des emplois d'un astre. Descriptif : aucun lien de cause avec l'accessibilité.",
];

/** Note de l'évolution : le découpage des zones est celui de 2020 sur toute la série (rangée dans le « i » de la courbe depuis le 10/11). */
export const EVOLUTION_NOTE = "L'évolution est tracée dans le découpage 2020 des zones d'emploi.";

/** « Source : Insee, taux de chômage localisés, données CVS, 2e trimestre 2026 (provisoire), paru le 18/09/2026. » */
export function chomageSource(c: Pick<TerritoireChomage, 'quarter' | 'provisional' | 'published'>): string {
  const date = frDate(c.published);
  return `Source : Insee, taux de chômage localisés, données CVS, ${quarterLabel(c.quarter)}${c.provisional ? ' (provisoire)' : ''}${date ? `, paru le ${date}` : ''}.`;
}

/** Lecture du taux d'une zone, pour l'étiquette, la bulle et le tableau : « Zone d'emploi d'Étampes : 6,0 % ». */
export const zoneRateLine = (name: string, rate: number): string => `${zoneLabel(name)} : ${rateText(rate)}`;

/**
 * Phrase qui décrit la bande pour les lecteurs d'écran : étendue, puis la valeur de chaque côté.
 * `sides` : une entrée par commune choisie (A et B en diptyque).
 */
export function stripDescription(file: TerritoireFile, sides: readonly { tag?: string; name: string; zoneId: string }[]): string {
  const rates = zoneRates(file);
  const lo = rates[0]!;
  const hi = rates[rates.length - 1]!;
  const head = `Taux de chômage des ${rates.length} zones d'emploi d'Île-de-France au ${quarterLabel(file.chomage.quarter)}, de ${rateText(lo.rate)} à ${rateText(hi.rate)}.`;
  const per = sides
    .map((s) => {
      const z = file.chomage.zones[s.zoneId];
      return z ? `${s.tag ? `${s.tag} · ` : ''}${s.name} : ${zoneRateLine(z.name, lastRate(z))}.` : '';
    })
    .filter(Boolean);
  return [head, ...per].join(' ');
}

/** Évolution d'une zone : points (trimestre, taux) du plus ancien au plus récent, lus tels quels. */
export function zoneSeries(file: TerritoireFile, zoneId: string): { quarter: string; rate: number }[] {
  const z = file.chomage.zones[zoneId];
  if (!z) return [];
  return z.series.map((rate, i) => ({ quarter: file.chomage.quarters[i] ?? '', rate }));
}

/** Phrase de l'évolution pour les lecteurs d'écran : premier et dernier trimestre, sans commentaire. */
export function evolutionDescription(file: TerritoireFile, zoneId: string): string | null {
  const s = zoneSeries(file, zoneId);
  const z = file.chomage.zones[zoneId];
  if (s.length < 2 || !z) return null;
  const first = s[0]!;
  const last = s[s.length - 1]!;
  return `Taux de chômage de la zone d'emploi ${ofName(z.name)} : ${rateText(first.rate)} au ${quarterLabel(first.quarter)}, ${rateText(last.rate)} au ${quarterLabel(last.quarter)}.`;
}

/* ------------------------------------------------------------------ temps de travail */

/** Citation du temps de travail (« Source : Insee », date de parution) : affichée en mode sources (D-033) et reprise dans « Sources & limites ». */
export function workTimeSource(t: TerritoireTempsDeTravail): string {
  const date = frDate(t.published);
  return `Source : Insee, enquête Emploi ${t.year}${date ? `, paru le ${date}` : ''}, ${t.scope}.`;
}

/**
 * Bulle de la journée-type (plan § 3) : part des salariés qui ont travaillé le soir et la nuit, nationale. Aucun chiffre pour
 * la journée-type 6h-14h : la source n'a pas de catégorie « tôt le matin ». La citation de la source : `workTimeSource`.
 */
export function workTimeSentences(t: TerritoireTempsDeTravail): string[] {
  return [
    `En ${t.year}, ${pctText(t.evening_pct)} des salariés ont travaillé au moins une fois le soir (20h-0h) et ${pctText(t.night_pct)} la nuit (0h-5h) sur quatre semaines.`,
    'Aucune catégorie « tôt le matin » dans cette source : aucun chiffre pour la journée-type 6h-14h.',
    "Les trois journées-types sont choisies par l'équipe : aucune source ouverte ne donne les horaires réels par poste et par territoire.",
  ];
}

/* ------------------------------------------------------------------ polarité */

/** Sous le nom de la commune : « Polarité du SDRIF-E : Argenteuil » ; null si la commune n'en a pas (rien n'est affiché). */
export function polarityLine(polarity: string | null | undefined): string | null {
  return polarity ? `Polarité du SDRIF-E : ${polarity}` : null;
}

/** Étiquette du pli « Communes du pôle » (la bulle « i » la définit) */
export const POLARITY_TAG = 'polarité SDRIF-E';

/** Bulle « i » de la polarité : ce que la source dit, et ce qu'elle ne dit pas. */
export const POLARITY_TIP =
  "Commune ou groupe de communes que le schéma régional SDRIF-E retient pour son rôle dans l'accueil d'équipements, d'emplois et de services, existant ou en devenir. Ce n'est pas un classement d'accessibilité. Source : Région Île-de-France, Institut Paris Region.";
