import type { GuideCategory, GuideEntry } from './guide.manifest';

/** Minuscules, sans accents ni tirets : « vélo-tc » trouve « velo tc ». Fonction pure. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[-'’]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function haystack(entry: GuideEntry, category: GuideCategory | undefined): string {
  return normalizeSearch(
    [entry.title, entry.purpose, entry.keywords ?? '', category?.title ?? '', ...entry.howTo, ...entry.know, ...(entry.shortcuts ?? []).flatMap((s) => [s.keys, s.does])].join(' '),
  );
}

export interface GuideSection {
  category: GuideCategory;
  entries: GuideEntry[];
}

/** Entrées qui contiennent tous les mots de la recherche, par catégorie ; recherche vide : tout, dans l'ordre du manifeste. */
export function filterGuide(categories: readonly GuideCategory[], entries: readonly GuideEntry[], query: string): GuideSection[] {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  return categories
    .map((category) => ({
      category,
      entries: entries.filter((e) => e.category === category.id && words.every((w) => haystack(e, category).includes(w))),
    }))
    .filter((s) => s.entries.length > 0);
}
