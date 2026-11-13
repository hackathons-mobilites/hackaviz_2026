/**
 * Bassin d'emploi d'un astre pour le survol et l'alternative textuelle du ciel (arbitrage de Nicolas du 05/11, point 3,
 * comme la bulle de la carte) : nom du bassin, nombre de communes, postes salariés (INSEE) de l'astre, lus dans
 * `poles.json` (`bassin`, `communes`, `jobs`), jamais écrits en dur. Sans bassin,
 * aucune ligne : rien ne change. Texte seulement : aucune position, taille ni luminosité d'astre n'en dépend.
 */
import { formatInt } from './format';
import type { Pole } from './types';

type BassinPole = Pick<Pole, 'bassin' | 'communes' | 'jobs'>;

/** « Bassin Sud 77 » ; null sans bassin publié. */
export function astreBassinName(p: Pick<Pole, 'bassin'>): string | null {
  return p.bassin?.name ? `Bassin ${p.bassin.name}` : null;
}

/** « 106 communes » ; null sans bassin publié (même règle que la carte : seuls les 44 astres ont un bassin). */
export function astreCommunesText(p: Pick<Pole, 'bassin' | 'communes'>): string | null {
  if (!p.bassin) return null;
  const n = p.communes.length;
  return `${formatInt(n)} commune${n > 1 ? 's' : ''}`;
}

/** « 106 communes, 49 468 postes salariés (INSEE) » (comme la carte) ; les postes absents ne sont pas inventés. */
export function astreSizeText(p: BassinPole): string | null {
  const communes = astreCommunesText(p);
  if (!communes) return null;
  return `${communes}${p.jobs == null ? '' : `, ${formatInt(p.jobs)} postes salariés (INSEE)`}`;
}

/**
 * Ligne courte du survol et de la liste : « Bassin Sud 77 · astre de 106 communes ». Le nombre de communes est celui de l'ASTRE,
 * pas du bassin (les 20 arrondissements de Paris sont 20 astres d'un seul bassin) : la ligne le dit.
 */
export function astreBassinLine(p: Pick<Pole, 'bassin' | 'communes'>): string | null {
  const name = astreBassinName(p);
  const communes = astreCommunesText(p);
  return name && communes ? `${name} · astre de ${communes}` : null;
}

/** Phrase pour l'étiquette d'un astre (aria-label) : « Bassin Sud 77. L'astre regroupe 106 communes, 49 468 postes salariés (INSEE). » */
export function astreBassinSentence(p: BassinPole): string | null {
  const name = astreBassinName(p);
  const size = astreSizeText(p);
  return name && size ? `${name}. L'astre regroupe ${size}.` : null;
}
