/**
 * Formats destinés à l'ORAL (visite guidée). Uniquement des RÈGLES d'arrondi et d'accord,
 * explicites et testées : aucune valeur métier écrite ici (D-011). Pas de tiret cadratin.
 */
import { formatInt, nbsp } from './format';
import type { Commune } from './types';

const dec1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** 0 → « aucune étoile », 1 → « une étoile », n → « n étoiles ». */
export function starsOral(n: number | null | undefined): string | null {
  if (n == null || n < 0 || !Number.isInteger(n)) return null;
  if (n === 0) return 'aucune étoile';
  if (n === 1) return 'une étoile';
  return `${n} étoiles`;
}

/** Préfixe selon le sens de l'arrondi : « près de » (arrondi au-dessus), « plus de » (au-dessous), rien si égal. */
function approxPrefix(rounded: number, exact: number): string {
  if (rounded > exact) return 'près de ';
  if (rounded < exact) return 'plus de ';
  return '';
}

/**
 * Postes à l'oral, avec le mot « postes ».
 * Règles : ≥ 1 million → millions à 1 décimale (« million » au singulier sous 2) ;
 * ≥ 100 000 → arrondi à la dizaine de milliers ; sinon arrondi au millier.
 * 0 ou inconnu → null (on ne prononce pas « 0 poste »).
 */
export function jobsOral(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) {
    const millions = Math.round(n / 100_000) / 10;
    const word = millions < 2 ? 'million' : 'millions';
    return `${approxPrefix(millions * 1_000_000, n)}${nbsp(dec1.format(millions))} ${word} de postes`;
  }
  const step = n >= 100_000 ? 10_000 : 1_000;
  const rounded = Math.max(step, Math.round(n / step) * step);
  return `${approxPrefix(rounded, n)}${formatInt(rounded)} postes`;
}

/**
 * Population à l'oral, sans le nom (« plus de 12 millions »).
 * Règle : ≥ 1 million → arrondi au million INFÉRIEUR (« plus de N millions », ou « N millions » si exact) ;
 * sinon arrondi au millier inférieur.
 */
export function populationOral(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) {
    const m = Math.floor(n / 1_000_000);
    return `${m * 1_000_000 < n ? 'plus de ' : ''}${m} million${m >= 2 ? 's' : ''}`;
  }
  const k = Math.floor(n / 1_000) * 1_000;
  return `${k < n ? 'plus de ' : ''}${formatInt(k)}`;
}

/** "06:00" → « 6 heures », "14:30" → « 14 heures 30 », "01:00" → « 1 heure ». */
export function hourOral(hhmm: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const hours = `${h} heure${h >= 2 ? 's' : ''}`;
  return min ? `${hours} ${min}` : hours;
}

/** Part en % arrondie à l'unité : 62.8 → « 63 % ». */
export function percentOral(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `${Math.round(v)}\u00a0%`;
}

/**
 * Population régionale sans double compte : Paris figure soit en commune (75056), soit en
 * arrondissements (751xx) ; si les deux sont présents, on garde les arrondissements.
 * null si une population manque.
 */
export function regionPopulation(communes: readonly Pick<Commune, 'insee' | 'population'>[]): number | null {
  const hasArr = communes.some((c) => /^751\d\d$/.test(c.insee));
  let total = 0;
  for (const c of communes) {
    if (hasArr && c.insee === '75056') continue;
    if (c.population == null) return null;
    total += c.population;
  }
  return total;
}

/**
 * Nombre de personnes à l'oral (flux INSEE EMP02), sans le nom.
 * Règles : ≥ 10 000 → au millier ; 1 000 à 9 999 → à la centaine ; < 1 000 → à la dizaine ;
 * préfixe « près de » / « plus de » selon le sens de l'arrondi (même règle que `jobsOral`).
 * `orderOfMagnitude` (flux < 200, « ordre de grandeur » selon l'INSEE) force « environ ».
 * 0 ou inconnu → null.
 */
export function peopleOral(n: number | null | undefined, orderOfMagnitude = false): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  const step = n >= 10_000 ? 1_000 : n >= 1_000 ? 100 : 10;
  const rounded = Math.max(step, Math.round(n / step) * step);
  const prefix = orderOfMagnitude ? 'environ ' : approxPrefix(rounded, n);
  return `${prefix}${formatInt(rounded)}`;
}

/** Montant en euros à l'oral, arrondi à la centaine : 42 520 → « 42 500 euros ». La phrase dit « environ ». */
export function eurosOral(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return `${formatInt(Math.max(100, Math.round(n / 100) * 100))} euros`;
}

/** Durée en minutes à l'oral : 120 → « 2 heures », 90 → « 1 heure 30 », 45 → « 45 minutes ». */
export function durationOral(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isInteger(minutes) || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} minute${m >= 2 ? 's' : ''}`;
  return hourOral(`${h}:${String(m).padStart(2, '0')}`);
}
