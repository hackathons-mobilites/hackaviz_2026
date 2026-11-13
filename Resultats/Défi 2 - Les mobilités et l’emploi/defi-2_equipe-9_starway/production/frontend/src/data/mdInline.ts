/**
 * Markdown « en ligne » minimal du tiroir « Sources & limites » (docs/limites.md repris tel quel) :
 * fonction PURE (sans React), testée sur les .md réellement importés par l'interface.
 *
 * - `**gras**` : texte en gras ;
 * - `[libellé](https://...)` : lien externe public, rendu en vrai lien ;
 * - `[libellé](fichier.md)` ou tout autre cible relative : le dépôt est privé, le lien n'ouvrirait rien.
 *   On affiche le LIBELLÉ SEUL, jamais le Markdown brut (retours de Sara et Cyril, 05/11, point 4.2).
 */
export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string };

// Le gras peut contenir une étoile seule (« * » de France Travail) : seul `**` le ferme
const TOKEN = /(\*\*(?:[^*]|\*(?!\*))+\*\*|\[[^\]]+\]\([^)\s]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const EXTERNAL = /^https?:\/\//i;

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  for (const part of text.split(TOKEN)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      tokens.push({ kind: 'bold', text: part.slice(2, -2) });
      continue;
    }
    const link = LINK.exec(part);
    if (link) {
      const [, label, target] = link;
      tokens.push(EXTERNAL.test(target!) ? { kind: 'link', text: label!, href: target! } : { kind: 'text', text: label! });
      continue;
    }
    tokens.push({ kind: 'text', text: part });
  }
  return tokens;
}

/** Texte lu à l'écran (ou par un lecteur d'écran) : sans balise ni cible de lien. */
export function inlineToPlainText(text: string): string {
  return parseInline(text)
    .map((t) => t.text)
    .join('');
}
