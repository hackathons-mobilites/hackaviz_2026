/**
 * Découpe de la narration en repères de sous-titres (2 lignes au plus), en attendant les WebVTT
 * générés par tools/tour-tts. Coupure aux fins de phrase, puis aux virgules, sinon aux mots.
 * Le temps de chaque repère est proportionnel à son nombre de caractères (règle de lecture).
 */
export const CUE_MAX_CHARS = 84;

function splitLong(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const parts: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const slice = rest.slice(0, max + 1);
    let cut = Math.max(slice.lastIndexOf(', '), slice.lastIndexOf(' : '));
    if (cut < max * 0.4) cut = slice.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut + (rest[cut] === ',' ? 1 : 0)).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function cueChunks(text: string, max = CUE_MAX_CHARS): string[] {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const cues: string[] = [];
  for (const s of sentences) {
    for (const piece of splitLong(s, max)) {
      const last = cues[cues.length - 1];
      if (last && last.length + 1 + piece.length <= max) cues[cues.length - 1] = `${last} ${piece}`;
      else cues.push(piece);
    }
  }
  return cues;
}

/** Repère affiché après `elapsed` ms sur une durée `total`. */
export function cueAt(cues: readonly string[], elapsed: number, total: number): number {
  if (cues.length <= 1 || total <= 0) return 0;
  const lens = cues.map((c) => c.length);
  const sum = lens.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < cues.length; i++) {
    acc += (lens[i]! / sum) * total;
    if (elapsed < acc) return i;
  }
  return cues.length - 1;
}

/** Coupe une phrase trop longue en morceaux ≤ max, au signe de ponctuation (« , », « : », « ; ») le plus proche du milieu, sinon à l'espace. */
function splitSentence(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const mid = s.length / 2;
  let best = -1;
  for (const m of s.matchAll(/[,:;] /g)) {
    const cut = m.index + 1;
    if (cut <= max && s.length - cut - 1 <= max * 2 && (best < 0 || Math.abs(cut - mid) < Math.abs(best - mid))) best = cut;
  }
  if (best < 0) {
    for (const m of s.matchAll(/ /g)) if (m.index <= max && (best < 0 || Math.abs(m.index - mid) < Math.abs(best - mid))) best = m.index;
  }
  if (best <= 0) return [s];
  return [...splitSentence(s.slice(0, best).trim(), max), ...splitSentence(s.slice(best).trim(), max)];
}

/**
 * Découpage PAR PHRASE des sous-titres datés (retour de l'équipe du 10/11, synchronisation du 11/11) : UNE phrase par sous-titre,
 * jamais deux (un sous-titre ne doit pas afficher une phrase que la voix n'a pas encore dite) ; une phrase trop longue est coupée à
 * la ponctuation la plus proche de son milieu, et sa fin n'est jamais collée au début de la phrase suivante (contrairement à `cueChunks`).
 */
export function sentenceChunks(text: string, max = CUE_MAX_CHARS): string[] {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const out: string[] = [];
  for (const s of sentences) out.push(...splitSentence(s, max));
  return out;
}
