/**
 * Réglages de marche des TC (D-024) et mode Vélib' (D-027) : fonctions PURES, tout est lu dans
 * meta.json (`walk_settings`, `velib`). Un réglage de marche est un CHOIX DE L'ÉQUIPE, pas une donnée :
 * les textes le disent et citent sa distance publiée (`leg_limit_m`), jamais une valeur écrite ici.
 */
import type { Meta, ModeId, WalkSetting, WalkSettingsMeta } from './types';

type WalkMeta = Pick<Meta, 'walk_settings'>;

/** Réglages publiés lisibles (distance positive), ou null si meta n'en publie pas. */
export function walkSettingsMeta(meta: WalkMeta | null | undefined): WalkSettingsMeta | null {
  const ws = meta?.walk_settings;
  if (!ws || !Array.isArray(ws.settings)) return null;
  const settings = ws.settings.filter((s) => !!s && typeof s.id === 'string' && Number.isFinite(s.leg_limit_m) && s.leg_limit_m > 0);
  if (!settings.some((s) => s.id === ws.default)) return null;
  return { ...ws, settings };
}

/** Le réglage s'applique-t-il à ce mode (TC seulement, `walk_settings.mode`) ? */
export function walkAppliesTo(meta: WalkMeta | null | undefined, mode: ModeId | string): boolean {
  const ws = walkSettingsMeta(meta);
  return !!ws && ws.mode === mode;
}

/**
 * Réglage demandé (paramètre d'URL `w`) ramené aux valeurs publiées : id connu et différent du défaut,
 * sinon null (= défaut). Le choix est gardé quel que soit le mode : il ne joue qu'en TC.
 */
export function sanitizeWalk(id: string | null | undefined, meta: WalkMeta | null | undefined): string | null {
  const ws = walkSettingsMeta(meta);
  if (!ws || !id || id === ws.default) return null;
  return ws.settings.some((s) => s.id === id) ? id : null;
}

/** Réglage en vigueur pour ce mode (choisi, sinon défaut) ; null si le mode n'a pas de réglage. */
export function activeWalkSetting(meta: WalkMeta | null | undefined, mode: ModeId | string, walk: string | null | undefined): WalkSetting | null {
  const ws = walkSettingsMeta(meta);
  if (!ws || ws.mode !== mode) return null;
  const id = sanitizeWalk(walk, meta) ?? ws.default;
  return ws.settings.find((s) => s.id === id) ?? null;
}

/**
 * Clé des séries à lire dans access/{insee}.json : null = `modes` (réglage par défaut, ou mode sans
 * réglage), sinon la clé de `variants` du réglage choisi.
 */
export function walkSeriesKey(meta: WalkMeta | null | undefined, mode: ModeId | string, walk: string | null | undefined): string | null {
  const s = activeWalkSetting(meta, mode, walk);
  return s?.key ?? null;
}

/**
 * Distance publiée en texte : 3000 → « 3 km », 1500 → « 1,5 km », 800 → « 800 m ».
 * null si absente ou illisible : aucune distance n'est alors citée.
 */
export function walkDistanceText(limitM: number | null | undefined): string | null {
  if (typeof limitM !== 'number' || !Number.isFinite(limitM) || limitM <= 0) return null;
  if (limitM < 1000) return `${Math.round(limitM)}\u00a0m`;
  const km = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(limitM / 1000);
  return `${km}\u00a0km`;
}

/** « avec au plus 3 km à pied à chaque bout » (accès et sortie), ou '' sans distance publiée. */
export function walkClause(legLimitM: number | null | undefined): string {
  const d = walkDistanceText(legLimitM);
  return d ? `avec au plus ${d} à pied à chaque bout` : '';
}

/** Résumé court (barre mobile, carte) : « ≤ 3 km à pied » ; '' sans réglage. */
export function walkShortText(setting: Pick<WalkSetting, 'leg_limit_m'> | null | undefined): string {
  const d = walkDistanceText(setting?.leg_limit_m);
  return d ? `≤ ${d} à pied` : '';
}

/** « réglage de marche normal : jusqu'à 3 km à pied » (libellé publié tel quel) ; '' sans réglage. */
export function walkSettingPhrase(setting: Pick<WalkSetting, 'label'> | null | undefined): string {
  return setting?.label ? `réglage de marche ${setting.label}` : '';
}

/**
 * Coupe un texte après sa première phrase (point suivi d'une espace) : la première phrase de
 * l'avertissement Vélib' s'affiche en gras, le reste à la suite, sans rien réécrire.
 */
export function splitFirstSentence(text: string): [string, string] {
  const i = text.search(/[.!?](\s|$)/);
  if (i < 0) return [text, ''];
  return [text.slice(0, i + 1), text.slice(i + 1).trim()];
}
