import { reasonText, type TripLeg } from './proof';
import type { NullReason } from './types';
import type { PoleStatus } from './accessibility';

const nf = new Intl.NumberFormat('fr-FR');

/** 412345 → « 412 345 » (espace fine insécable du fr-FR). */
export function formatInt(n: number): string {
  return nbsp(nf.format(Math.round(n)));
}

/**
 * Intl fr-FR sépare les milliers par une espace fine (U+202F), absente de certaines polices :
 * on la remplace par une espace insécable ordinaire (U+00A0).
 */
export function nbsp(s: string): string {
  return s.replace(/\u202f/g, '\u00a0');
}

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** 62.8 → « 62,8 % » */
export function formatPercent(v: number): string {
  return `${nbsp(nf1.format(v))}\u00a0%`;
}

/** Arrondi à la centaine (utilisé pendant l'animation du compteur et à l'oral). */
export function roundHundred(n: number): number {
  return Math.round(n / 100) * 100;
}

export function formatMinutes(min: number | null): string {
  return min == null ? '-' : `${min} min`;
}

/**
 * Raison d'un trajet absent, pour le sens concerné (`reasonLeg` de proof.ts). La borne de recherche
 * vient de meta.max_trip_min : aucune durée n'est écrite ici, rien n'est cité si le champ est absent.
 */
export function reasonLabel(reason: NullReason, maxTripMin?: number | null, leg: TripLeg = 'out', timeDependent = true): string {
  return reasonText(reason, maxTripMin, leg, timeDependent);
}

export const statusLabel: Record<PoleStatus, string> = {
  accessible: 'accessible aller et retour',
  out_only: 'aller possible, retour hors de portée',
  none: 'hors de portée',
  unknown: 'non calculé',
};
