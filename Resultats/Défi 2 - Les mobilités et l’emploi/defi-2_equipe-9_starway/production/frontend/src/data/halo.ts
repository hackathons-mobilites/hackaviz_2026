/**
 * Halo « Derrière notre étoile » : profil statistique de la commune d'origine.
 * Fonctions PURES : context/{insee}.json → anneaux (fractions d'angle) + légende chiffrée.
 * Descriptif seulement : aucune causalité avec l'accessibilité. Dénominateur toujours explicite.
 * Couleurs non genrées (haloPalette) : jamais le cyan « accessible » ni l'or « gain ».
 */
import { haloPalette, haloPaletteCv } from '../theme/tokens';
import { formatInt, formatPercent } from './format';
import type { CommuteMode, ContextFile, ContextStatus } from './types';

/**
 * Onglets du halo (D-025, L-10) : l'onglet « Population par sexe » est retiré (part femmes / hommes
 * proche de 50/50 partout : indicateur peu contrasté, règle « pas affiché »). La donnée reste exportée
 * et lue : elle devient une phrase sous l'astrolabe des âges (`sexShareLine`). `h=sex` des anciens
 * liens est ramené à `age` (state/url.ts).
 */
export type HaloContextDimension = 'age' | 'commute' | 'income';
/**
 * Quatrième onglet « Chômage » (D-048, repères de territoire) : il ne lit pas context/{insee}.json mais territoire.json ;
 * `buildHalo` ne le connaît donc pas (voir `HaloContextDimension`).
 */
export type HaloDimension = HaloContextDimension | 'unemployment';
/** Blocs du contexte que buildHalo sait lire (« sex » : données gardées, plus d'onglet) */
export type HaloBlock = HaloContextDimension | 'sex';

export const HALO_DIMENSIONS: { id: HaloDimension; label: string }[] = [
  { id: 'age', label: 'Âges' },
  { id: 'commute', label: 'Modes domicile-travail' },
  { id: 'income', label: 'Niveau de vie' },
  { id: 'unemployment', label: 'Chômage' },
];

/** L'onglet lit context/{insee}.json (donc `buildHalo`) ; faux pour « Chômage », qui lit territoire.json et n'a aucun arc. */
export function isContextHalo(dim: HaloDimension | null | undefined): dim is HaloContextDimension {
  return !!dim && dim !== 'unemployment';
}

/** Couleurs du halo : voir haloPalette (tokens.ts), sans cyan ni or. */
export const haloColors = {
  pale: haloPalette.walk,
  track: haloPalette.track,
  income: haloPalette.income,
} as const;

const AGE_COLORS: readonly string[] = haloPalette.age;

/** Couleurs des groupes d'âge : inchangées en mode daltonien (spec: seuls les modes changent). */

const MODE_COLORS: Record<CommuteMode, string> = {
  transit: haloPalette.transit,
  car: haloPalette.car,
  bike: haloPalette.bike,
  walk: haloPalette.walk,
  other: haloPalette.other,
};

/** Mode daltonien (motion-spec, « Mode daltonien ») : arcs des modes étagés en luminance, mêmes teintes. */
const MODE_COLORS_CV: Record<CommuteMode, string> = {
  transit: haloPaletteCv.transit,
  car: haloPaletteCv.car,
  bike: haloPaletteCv.bike,
  walk: haloPaletteCv.walk,
  other: haloPaletteCv.other,
};

/** Couleurs des modes domicile-travail selon le réglage « couleurs adaptées au daltonisme ». */
export function modeColors(cv = false): Readonly<Record<CommuteMode, string>> {
  return cv ? MODE_COLORS_CV : MODE_COLORS;
}

const INCOME_COLOR: string = haloPalette.income;

/** Couleur du taux de pauvreté (inchangée en mode daltonien, spec: seuls les modes changent). */
export function incomeColor(): string {
  return INCOME_COLOR;
}

const MODE_LABELS: Record<CommuteMode, string> = {
  transit: 'Transports en commun',
  car: 'Voiture',
  bike: 'Vélo',
  walk: 'Marche',
  other: 'Autres',
};

export interface HaloSegment {
  /** Fractions de tour [0, 1] */
  start: number;
  end: number;
  color: string;
  /** Opacité (atténuée si l'estimation est imprécise) ; 1 par défaut */
  alpha?: number;
  /** Piste en pointillé (valeur non diffusée : secret statistique) */
  dotted?: boolean;
}

export interface HaloRing {
  /** 0 = anneau intérieur */
  level: number;
  segments: HaloSegment[];
  /** Libellé de l'anneau (ex. « Femmes ») */
  label?: string;
  /** Valeur écrite au bout de l'arc de données (premier segment), ex. « 24,1 % » */
  endLabel?: string;
}

export interface HaloLegendItem {
  label: string;
  color: string;
  value: string;
  group?: string;
  /** « ± 2,3 pt » si la marge d'erreur est connue */
  margin?: string;
  /** Estimation imprécise : marge inconnue ou au moins égale à la part */
  imprecise?: boolean;
}

/** Opacité des arcs dont l'estimation est imprécise (lisibilité, pas une donnée) */
export const IMPRECISE_ALPHA = 0.35;

/**
 * Règle dérivée de la donnée, sans seuil inventé : une part est imprécise si sa marge à 95 % est
 * inconnue (null) ou au moins égale à la part elle-même (l'intervalle inclut alors 0).
 */
export function isImprecise(value: number, margin: number | null | undefined): boolean {
  return margin == null || margin >= value;
}

/**
 * Les intervalles [part - marge, part + marge] de deux parts se recouvrent-ils ?
 * Oui → l'écart entre elles n'est pas établi au seuil de 95 %. null si une marge est inconnue.
 */
export function intervalsOverlap(
  a: number | null | undefined,
  ma: number | null | undefined,
  b: number | null | undefined,
  mb: number | null | undefined,
): boolean | null {
  if (a == null || b == null || ma == null || mb == null) return null;
  return a - ma <= b + mb && b - mb <= a + ma;
}

export function formatMargin(margin: number): string {
  return `\u00b1\u00a0${formatPercent(margin).replace(/\u00a0%$/, '')}\u00a0pt`;
}

export interface HaloView {
  rings: HaloRing[];
  legend: HaloLegendItem[];
  source: string;
  year: number | null;
  denominator: string | null;
  /** Message si le bloc est masqué (statut ≠ ok) */
  hidden: string | null;
  note?: string;
  /** Montant affiché en carte de statistique (jamais en arc : un montant n'est pas une part) */
  stat?: { value: string; caption: string; hidden?: boolean };
  /** Garde-fou de lecture (aucune causalité) */
  guard?: string;
  /**
   * Règle d'affichage finale du 11/11 (D1) : la ligne courte TOUJOURS écrite sous l'onglet, sans mode sources : la base et le millésime
   * (« Sur 23 093 habitants, recensement 2023. ») ; la phrase « Dénominateur : … » complète et les définitions vont dans le « i ».
   */
  base?: string | null;
}

/** « , recensement 2023 » ou « , Filosofi 2021 » (rien sans millésime publié). */
const vintage = (source: string, year: number | null | undefined) => (year ? `, ${source === 'SOC01' ? 'Filosofi' : 'recensement'} ${year}` : '');

const SOURCE_LABEL: Record<string, string> = {
  GEN04: 'INSEE, recensement de la population (GEN04)',
  GEN01: 'INSEE, recensement de la population (GEN01)',
  SOC01: 'INSEE, Filosofi (SOC01)',
};

export function hiddenMessage(status: ContextStatus | undefined): string {
  switch (status) {
    case 'secret':
      return 'Non diffusé par l’INSEE (secret statistique).';
    // 'small_sample' n'est plus produit par le pipeline (seuil de 200 retiré, D-011) : message générique,
    // aucun seuil implicite
    case 'to_compute':
      return 'Pas encore calculé.';
    default:
      return 'Donnée non disponible pour cette commune.';
  }
}

const pct = formatPercent;

/** Segments consécutifs proportionnels aux valeurs (normalisés sur leur somme). */
export function toSegments(values: { value: number; color: string }[]): HaloSegment[] {
  const total = values.reduce((s, v) => s + Math.max(0, v.value), 0);
  if (total <= 0) return [];
  let acc = 0;
  return values.map((v) => {
    const start = acc;
    acc += Math.max(0, v.value) / total;
    return { start, end: acc, color: v.color };
  });
}

function empty(source: string, hidden: string): HaloView {
  return { rings: [], legend: [], source: SOURCE_LABEL[source] ?? source, year: null, denominator: null, hidden };
}

/** `cv` : couleurs adaptées au daltonisme (seuls les arcs des modes changent de couleur, jamais une valeur). */
export function buildHalo(ctx: ContextFile | null | undefined, dim: HaloBlock, cv = false): HaloView {
  const MODE_COLORS = modeColors(cv);
  switch (dim) {
    case 'sex': {
      const b = ctx?.population_sex;
      if (!b || b.status !== 'ok' || b.shares.F == null || b.shares.H == null) return empty('GEN04', hiddenMessage(b?.status));
      const items = [
        { label: 'Femmes', value: b.shares.F, color: haloPalette.sexA },
        { label: 'Hommes', value: b.shares.H, color: haloPalette.sexB },
      ];
      return {
        rings: [{ level: 0, segments: toSegments(items) }],
        legend: items.map((i) => ({ label: i.label, color: i.color, value: pct(i.value) })),
        source: SOURCE_LABEL[b.source] ?? b.source,
        year: b.year,
        denominator: b.total != null ? `${b.denominator ?? 'population totale'} : ${formatInt(b.total)} habitants` : b.denominator ?? null,
        hidden: null,
        base: b.total != null ? `Sur ${formatInt(b.total)} habitants${vintage(b.source, b.year)}.` : null,
      };
    }
    case 'age': {
      const b = ctx?.population_age;
      if (!b || b.status !== 'ok' || b.shares.length !== b.bins.length || !b.bins.length) return empty('GEN04', hiddenMessage(b?.status));
      const items = b.bins.map((bin, i) => ({ label: `${bin} ans`, value: b.shares[i]!, color: AGE_COLORS[i % AGE_COLORS.length]! }));
      return {
        rings: [{ level: 0, segments: toSegments(items) }],
        legend: items.map((i) => ({ label: i.label, color: i.color, value: pct(i.value) })),
        source: SOURCE_LABEL[b.source] ?? b.source,
        year: b.year,
        denominator: b.total != null ? `${b.denominator ?? 'population totale'} : ${formatInt(b.total)} habitants` : b.denominator ?? null,
        hidden: null,
        base: b.total != null ? `Sur ${formatInt(b.total)} habitants${vintage(b.source, b.year)}.` : null,
      };
    }
    case 'commute': {
      const b = ctx?.commute_mode_by_sex;
      if (!b || b.status !== 'ok') return empty('GEN01', hiddenMessage(b?.status));
      const modes: CommuteMode[] = ['transit', 'car', 'bike', 'walk', 'other'];
      const margin = (sex: 'F' | 'H', m: CommuteMode) => b.margin95?.[sex]?.[m] ?? null;
      const ring = (sex: 'F' | 'H', level: number, label: string): HaloRing => ({
        level,
        label,
        segments: toSegments(modes.map((m) => ({ value: b[sex][m] ?? 0, color: MODE_COLORS[m] }))).map((seg, i) => {
          const m = modes[i]!;
          const v = b[sex][m] ?? 0;
          return isImprecise(v, margin(sex, m)) ? { ...seg, alpha: IMPRECISE_ALPHA } : seg;
        }),
      });
      const legend: HaloLegendItem[] = [];
      for (const [sex, group] of [
        ['F', 'Femmes (anneau intérieur)'],
        ['H', 'Hommes (anneau extérieur)'],
      ] as const) {
        for (const m of modes) {
          const v = b[sex][m];
          if (v == null) continue;
          const mg = margin(sex, m);
          legend.push({
            label: MODE_LABELS[m],
            color: MODE_COLORS[m],
            value: pct(v),
            group,
            margin: mg != null ? formatMargin(mg) : undefined,
            imprecise: isImprecise(v, mg),
          });
        }
      }
      const totals = b.totals;
      return {
        rings: [ring('F', 0, 'Femmes'), ring('H', 1, 'Hommes')],
        legend,
        source: SOURCE_LABEL[b.source] ?? b.source,
        year: b.year,
        denominator:
          (b.denominator ?? 'actifs occupés de chaque sexe') +
          (totals?.F != null && totals.H != null
            ? ` : ${formatInt(totals.F)} femmes, ${formatInt(totals.H)} hommes`
            : ''),
        hidden: null,
        base:
          totals?.F != null && totals.H != null
            ? `Sur ${formatInt(totals.F)} femmes et ${formatInt(totals.H)} hommes qui ont un emploi${vintage(b.source, b.year)}.`
            : `Sur les femmes et les hommes qui ont un emploi${vintage(b.source, b.year)}.`,
        note: [
          b.other_includes?.length ? `« Autres » comprend : ${b.other_includes.join(', ')}.` : null,
          b.precision_source ? `Marges d'erreur à 95 % : ${b.precision_source}.` : null,
        ]
          .filter(Boolean)
          .join(' ') || undefined,
      };
    }
    case 'income': {
      const b = ctx?.income;
      const guard = 'Décrit la commune de résidence. Ne dit rien de l’accès aux pôles, ni d’une cause.';
      const denominator =
        'personnes des ménages fiscaux de la commune ; seuil de pauvreté à 60 % du niveau de vie médian national (définition INSEE)';
      const secretRing: HaloRing = { level: 0, segments: [{ start: 0, end: 1, color: haloColors.track, dotted: true }] };
      if (!b || (b.status !== 'ok' && b.status !== 'secret')) return empty('SOC01', hiddenMessage(b?.status));
      const medianStatus = b.median_status ?? b.status;
      const povertyStatus = b.poverty_rate_status ?? b.status;
      const medianOk = medianStatus === 'ok' && b.median_living_standard_eur != null;
      const povertyOk = povertyStatus === 'ok' && b.poverty_rate != null;
      if (!medianOk && !povertyOk) {
        if (medianStatus !== 'secret' && povertyStatus !== 'secret') return empty('SOC01', hiddenMessage(medianStatus));
        // Secret statistique : piste seule, en pointillé ; jamais de valeur approchée
        return { ...empty('SOC01', hiddenMessage('secret')), rings: [secretRing], year: b.year, guard };
      }
      const legend: HaloLegendItem[] = [];
      const rings: HaloRing[] = [];
      if (povertyOk) {
        rings.push({
          level: 0,
          segments: [
            { start: 0, end: b.poverty_rate! / 100, color: incomeColor() },
            { start: b.poverty_rate! / 100, end: 1, color: haloColors.track },
          ],
          endLabel: pct(b.poverty_rate!),
        });
        legend.push({ label: 'Taux de pauvreté', color: incomeColor(), value: pct(b.poverty_rate!) });
      } else {
        rings.push(secretRing);
        legend.push({ label: 'Taux de pauvreté', color: haloColors.track, value: hiddenMessage(povertyStatus) });
      }
      return {
        rings,
        legend,
        stat: medianOk
          ? { value: `${formatInt(b.median_living_standard_eur!)} € par an`, caption: 'niveau de vie médian par unité de consommation' }
          : { value: hiddenMessage(medianStatus), caption: 'niveau de vie médian par unité de consommation', hidden: true },
        source: SOURCE_LABEL[b.source] ?? b.source,
        year: b.year,
        denominator,
        hidden: null,
        guard,
        base: `Sur les personnes des ménages fiscaux${vintage(b.source, b.year)}.`,
      };
    }
  }
}

/** Une ligne « A : x · B : y » du halo en diptyque (aucune phrase comparative). */
export interface HaloPair {
  label: string;
  group?: string;
  a: string;
  b: string;
  /** Précision de chaque côté, comme dans la légende d'une seule commune (marge, estimation imprécise) */
  aMargin?: string;
  bMargin?: string;
  aImprecise?: boolean;
  bImprecise?: boolean;
}

/** « 24,1 % ± 2,3 pt » ou « 3,0 % (estimation imprécise, ± 4,1 pt) » : mêmes mots que la légende. */
export function pairSideText(value: string, margin: string | undefined, imprecise: boolean | undefined): string {
  if (imprecise) return `${value} (estimation imprécise${margin ? `, ${margin}` : ''})`;
  return margin ? `${value} ${margin}` : value;
}

function sideValue(h: HaloView, find: (h: HaloView) => string | undefined): string {
  if (h.hidden) return /secret/.test(h.hidden) ? 'non diffusé (secret statistique)' : 'non disponible';
  return find(h) ?? 'non disponible';
}

/** Valeurs de A et de B, catégorie par catégorie, dans l'ordre de la légende de A (sinon de B). */
export function haloPairs(a: HaloView, b: HaloView): HaloPair[] {
  const out: HaloPair[] = [];
  const ref = a.hidden ? b : a;
  const stat = ref.stat;
  if (stat) {
    const v = (h: HaloView) => (h.stat && !h.stat.hidden ? h.stat.value : h.stat?.value);
    out.push({ label: stat.caption, a: sideValue(a, v), b: sideValue(b, v) });
  }
  for (const item of ref.legend) {
    const find = (h: HaloView) => (h.hidden ? undefined : h.legend.find((l) => l.label === item.label && l.group === item.group));
    const v = (h: HaloView) => find(h)?.value;
    const la = find(a);
    const lb = find(b);
    out.push({
      label: item.label,
      ...(item.group ? { group: item.group } : {}),
      a: sideValue(a, v),
      b: sideValue(b, v),
      ...(la?.margin ? { aMargin: la.margin } : {}),
      ...(lb?.margin ? { bMargin: lb.margin } : {}),
      ...(la?.imprecise ? { aImprecise: true } : {}),
      ...(lb?.imprecise ? { bImprecise: true } : {}),
    });
  }
  return out;
}

/**
 * Phrase sous l'astrolabe des âges (L-10) : « 51,6 % de femmes, 48,4 % d'hommes ; population totale,
 * RP 2023 ». Tout vient du bloc population_sex ; null s'il n'est pas « ok ».
 */
export function sexShareLine(ctx: ContextFile | null | undefined, withMethod = true): string | null {
  const b = ctx?.population_sex;
  if (!b || b.status !== 'ok' || b.shares.F == null || b.shares.H == null) return null;
  const shares = `${pct(b.shares.F)} de femmes, ${pct(b.shares.H)} d'hommes`;
  // Sans mode sources (D-033, lot 6) : la base et le millésime sont écrits une fois, en bas de l'onglet (audit d'affichage du 11/11, H3 et D1)
  if (!withMethod) return `${shares}.`;
  const den = b.denominator ?? 'population totale';
  const src = b.source === 'GEN04' || b.source === 'GEN01' ? 'RP' : b.source;
  return `${shares} ; ${den}${b.year ? `, ${src} ${b.year}` : ''}.`;
}

/** Sans mode sources (D-033, lot 6) : retire d'un dénominateur la parenthèse du recensement (« (RP, exploitation principale) »). Fonction PURE. */
export function stripCensusParen(text: string): string {
  return text.replace(/\s*\(RP[^)]*\)/g, '');
}

/* ------------------------------------------------------------------ astrolabe (L-08) */

export interface ArcLabel {
  /** Index du segment dans l'anneau */
  index: number;
  name: string;
  value: string;
  /** Position du texte (centre de l'astrolabe en 0, 0) et ancrage horizontal */
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  /** Point de l'anneau d'où part le trait de rappel quand le nom a été écarté (sinon null) */
  from: { x: number; y: number } | null;
}

/**
 * Noms et valeurs posés AUTOUR de l'anneau, au milieu de chaque arc (angle 0 = midi, sens horaire).
 * Deux noms trop proches d'un même côté sont écartés verticalement (au moins `minGap` px), avec un
 * trait de rappel depuis l'anneau. Fonction pure : mêmes entrées, mêmes positions.
 */
export function arcLabels(
  segments: readonly { start: number; end: number }[],
  items: readonly { name: string; value: string }[],
  r: number,
  minGap = 30,
): ArcLabel[] {
  const raw = segments.map((seg, index) => {
    const a = ((seg.start + seg.end) / 2) * Math.PI * 2;
    const sx = Math.sin(a);
    const cy = -Math.cos(a);
    return {
      index,
      name: items[index]?.name ?? '',
      value: items[index]?.value ?? '',
      x: sx * r,
      y: cy * r,
      anchor: (sx > 0.2 ? 'start' : sx < -0.2 ? 'end' : 'middle') as ArcLabel['anchor'],
      ring: { x: sx * (r - 2), y: cy * (r - 2) },
    };
  });
  const out: ArcLabel[] = raw.map((l) => ({ index: l.index, name: l.name, value: l.value, x: l.x, y: l.y, anchor: l.anchor, from: null }));
  for (const side of [1, -1]) {
    const idx = raw.map((_, i) => i).filter((i) => (side > 0 ? raw[i]!.x >= 0 : raw[i]!.x < 0)).sort((a, b) => raw[a]!.y - raw[b]!.y);
    for (let k = 1; k < idx.length; k++) {
      const prev = out[idx[k - 1]!]!;
      const cur = out[idx[k]!]!;
      if (cur.y - prev.y < minGap) {
        cur.y = prev.y + minGap;
        cur.from = raw[idx[k]!]!.ring;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ constellation en lignes (L-09) */

export interface DotRow {
  mode: CommuteMode;
  label: string;
  /** Parts en % (0-100) et marges à 95 % (points) ; null si non publié */
  f: number | null;
  h: number | null;
  fMargin: number | null;
  hMargin: number | null;
  fImprecise: boolean;
  hImprecise: boolean;
}

/** Une ligne par mode : femmes et hommes sur le même axe 0-100 %, avec leur marge d'erreur. */
export function commuteDotRows(ctx: ContextFile | null | undefined): DotRow[] {
  const b = ctx?.commute_mode_by_sex;
  if (!b || b.status !== 'ok') return [];
  const modes: CommuteMode[] = ['transit', 'car', 'bike', 'walk', 'other'];
  return modes
    .map((m) => {
      const f = b.F[m] ?? null;
      const h = b.H[m] ?? null;
      const fMargin = b.margin95?.F?.[m] ?? null;
      const hMargin = b.margin95?.H?.[m] ?? null;
      return {
        mode: m,
        label: MODE_LABELS[m],
        f,
        h,
        fMargin,
        hMargin,
        fImprecise: f != null && isImprecise(f, fMargin),
        hImprecise: h != null && isImprecise(h, hMargin),
      };
    })
    .filter((r) => r.f != null || r.h != null);
}
