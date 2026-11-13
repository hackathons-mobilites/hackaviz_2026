import type { Commune } from './types';

/** Normalise pour une recherche tolérante aux accents, tirets, apostrophes et casse. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’_]/g, ' ')
    .replace(/\bst\b/g, 'saint')
    .replace(/\bste\b/g, 'sainte')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface IndexedCommune {
  commune: Commune;
  key: string;
}

export function buildIndex(communes: readonly Commune[]): IndexedCommune[] {
  return communes.map((commune) => ({ commune, key: normalize(commune.name) }));
}

/**
 * Recherche : code INSEE ou code département exact, puis préfixe du nom, puis début de mot,
 * puis sous-chaîne.
 */
export function searchCommunes(index: readonly IndexedCommune[], query: string, limit = 8): Commune[] {
  const q = normalize(query);
  if (!q) return [];
  const scored: { c: Commune; score: number }[] = [];
  for (const { commune, key } of index) {
    let score = -1;
    if (commune.insee === q) score = 0;
    else if (key === q) score = 1;
    else if (key.startsWith(q)) score = 2;
    else if (key.includes(` ${q}`)) score = 3;
    else if (key.includes(q)) score = 4;
    else if (/^\d{2,5}$/.test(q) && commune.insee.startsWith(q)) score = 5;
    if (score >= 0) scored.push({ c: commune, score });
  }
  scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name, 'fr'));
  return scored.slice(0, limit).map((s) => s.c);
}
