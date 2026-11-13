import { stripDecisionCodes, stripPersonalNotes } from './proof';

/**
 * Textes publiés de la liste des sources (`sources.json`), tels qu'ils s'affichent dans « Sources & limites ».
 * Fonctions PURES. Le mode sources (D-033) garde le texte publié, sans mention de personne ; hors mode sources,
 * ni code de décision (sous toutes ses formes), ni nom de fichier, ni chemin.
 */

/** Nom de fichier ou chemin technique : extension connue, ou chemin de la machine de calcul (`~/`) */
const FILE_RE = /\.(?:py|json|csv|jar|sh|md)\b|~\//;
/** Un mot qui est un nom de fichier ou un chemin */
const FILE_TOKEN_RE = /\s*[\w.{}/~-]*(?:\.(?:py|json|csv|jar|sh|md)\b|~\/[\w.{}/~-]*)/g;
/** Code de décision et sa lettre ou son repère éventuels (« D-031 », « D-031 c », « D-031 a2 ») */
const CODE_RE = /\s*\bD-\d{3}(?:\s+[a-z]\d?\b)?/g;

/** Parenthèse : on retire les parties (séparées par « ; ») qui citent un fichier ; vide, elle disparaît. */
function dropFileClauses(text: string): string {
  return text.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => {
    if (!FILE_RE.test(inner)) return whole;
    const kept = inner
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p && !FILE_RE.test(p));
    return kept.length ? ` (${kept.join(' ; ')})` : '';
  });
}

/** Ponctuation et espaces laissés par les retraits */
function tidy(text: string): string {
  return text
    .replace(/\(\s*[,;]?\s*\)/g, '')
    .replace(/\(\s*[,;]\s*/g, '(')
    .replace(/\s*[,;]\s*\)/g, ')')
    .replace(/,\s*,/g, ',')
    .replace(/\s+([,;.)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Hors mode sources : sans mention de personne, sans code de décision, sans nom de fichier ni chemin. */
export function plainSourceText(text: string): string {
  const noCodes = stripDecisionCodes(text);
  return tidy(dropFileClauses(noCodes).replace(FILE_TOKEN_RE, '').replace(CODE_RE, ''));
}

/** Texte affiché d'un champ de `sources.json` : intact en mode sources (sauf mention de personne), nettoyé sinon. */
export function sourceText(text: string, sourcesOn: boolean): string {
  return sourcesOn ? stripPersonalNotes(text) : plainSourceText(text);
}
