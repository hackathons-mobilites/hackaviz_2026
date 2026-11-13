/**
 * Repères visuels de la visite (retour de Cyril du 10/11 : « on ne sait pas où regarder quand la voix annonce un chiffre »).
 * Module PUR (testé par vitest), sans DOM : il dit QUAND chaque repère s'allume ; `components/TourMarks.tsx` dit OÙ.
 *
 * Une étape porte des `marks` : `{ at: <fragment du texte de l'étape>, target: <cible nommée> }`.
 * - Le fragment est écrit dans le texte du script (variables comprises, ex. `'{access.stars} s’allument'`), jamais en
 *   millisecondes : il est retrouvé dans le texte résolu, puis dans les sous-titres WebVTT de l'étape. Si la voix est
 *   régénérée, les temps suivent. Un fragment introuvable est ignoré à l'écran et fait échouer le test `marks.test.ts`.
 * - Le repère s'allume dans le sous-titre qui contient le début du fragment, à l'endroit du fragment dans ce sous-titre
 *   (au prorata des caractères, comme le découpage des sous-titres sans audio) : deux éléments annoncés dans le même
 *   sous-titre s'allument l'un après l'autre, au moment où la voix les dit. Un fragment qui ouvre le sous-titre s'allume
 *   donc avec lui.
 * - Il dure jusqu'au repère suivant de l'étape, ou jusqu'à la fin de l'étape. `target: 'none'` éteint sans rien montrer.
 */

/** Cibles nommées (aucun sélecteur CSS dans les scripts) : la correspondance avec l'écran est dans `components/tourMarkTargets.ts`. */
export type MarkTarget =
  /** Compteur de postes salariés (INSEE) atteints (barre de scénario) */
  | 'counter'
  /** Jauge du temps de trajet par sens */
  | 'budget'
  /** Choix de la journée-type (absent de la barre au téléphone : aucun repère) */
  | 'dayType'
  /** Choix du mode de transport */
  | 'mode'
  /** Champ de la commune de départ (barre de scénario) */
  | 'search'
  /** Étoile-guide (commune de départ) du ciel A */
  | 'origin'
  /** Astres allumés, en partie ou en entier : de tous les ciels affichés (un seul, ou A et B du diptyque) */
  | 'stars:lit'
  /** Astres allumés du seul ciel B du diptyque */
  | 'stars:lit:B'
  /** Panneau de preuve entier */
  | 'proof'
  /** Ciel B entier du diptyque (la voisine, à droite ; en bas au téléphone) */
  | 'sky:B'
  /** En-tête du ciel A ou B du diptyque (commune, étoiles, postes) ; écart entre les deux */
  | 'diptych:A'
  | 'diptych:B'
  | 'diptych:delta'
  /** Panneau du halo (profil de la commune) */
  | 'halo'
  /** Éteint le repère courant sans en allumer un autre */
  | 'none'
  /** Un astre du ciel A (identifiant de poles.json) */
  | `pole:${string}`
  /** Une partie du panneau de preuve : `flows`, `recruit`, `trajet`, ou un pli (`communes`, `cout`, `emplois`, `besoins`, `moyens`, `methode`) */
  | `proof:${string}`
  /** La ligne d'une commune (code INSEE) du graphique « Temps de trajet par commune », pli « Communes du pôle » ouvert */
  | `row:${string}`;

export interface TourMark {
  /** Fragment du texte de l'étape (tel qu'écrit dans le script, variables `{...}` comprises) : première occurrence */
  at: string;
  /** Une cible, ou plusieurs montrées ensemble (ex. l'astre et son panneau) */
  target: MarkTarget | readonly MarkTarget[];
}

export interface TimedMark {
  startMs: number;
  targets: readonly MarkTarget[];
  /** Rang du repère dans l'étape (clé d'affichage) */
  index: number;
}

/** Cue minimale (TimedCue de vtt.ts) */
export interface MarkCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** Espaces (y compris insécables et fines insécables des nombres) ramenées à une espace simple. */
export function normalizeSpaces(s: string): string {
  // \s couvre en JavaScript l'espace insécable (U+00A0) et l'espace fine insécable (U+202F)
  return s.replace(/\s+/g, ' ').trim();
}

const VARIABLE = /\{[A-Za-z0-9_.]+\}/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Position (en caractères, dans le texte résolu NORMALISÉ) du début du fragment `at`, cherché dans le texte du script
 * `template` (variables comprises). null si le fragment n'est pas dans le script ou si le texte résolu ne correspond pas
 * au script (texte d'une autre version).
 */
export function fragmentOffset(template: string, resolved: string, at: string): number | null {
  const tpl = normalizeSpaces(template);
  const frag = normalizeSpaces(at);
  const text = normalizeSpaces(resolved);
  if (!frag) return null;
  const idx = tpl.indexOf(frag);
  if (idx < 0) return null;
  // Expression du script : littéraux échappés, variables en groupes paresseux, un groupe vide au début du fragment
  let pattern = '';
  let pos = 0;
  const literal = (end: number) => {
    if (idx >= pos && idx < end) pattern += `${escapeRe(tpl.slice(pos, idx))}(?<frag>)${escapeRe(tpl.slice(idx, end))}`;
    else pattern += escapeRe(tpl.slice(pos, end));
    pos = end;
  };
  for (const m of tpl.matchAll(VARIABLE)) {
    literal(m.index);
    if (idx === m.index) pattern += '(?<frag>)';
    pattern += '([\\s\\S]*?)';
    pos = m.index + m[0].length;
  }
  literal(tpl.length);
  if (idx === tpl.length) pattern += '(?<frag>)';
  const match = new RegExp(`^${pattern}$`, 'd').exec(text);
  const start = match?.indices?.groups?.frag?.[0];
  return start ?? null;
}

/** Début (en caractères du texte normalisé) de chaque cue, retrouvée dans l'ordre ; null si une cue n'y est pas. */
export function cueOffsets(text: string, cues: readonly MarkCue[]): number[] | null {
  const t = normalizeSpaces(text);
  const out: number[] = [];
  let cursor = 0;
  for (const c of cues) {
    const i = t.indexOf(normalizeSpaces(c.text), cursor);
    if (i < 0) return null;
    out.push(i);
    cursor = i + 1;
  }
  return out;
}

/**
 * Instant (ms depuis le début de la narration de l'étape) où la voix arrive au caractère `offset`.
 * Avec les cues WebVTT : dans la cue qui contient ce caractère, au prorata de sa place dans la cue.
 * Sans cues (pas d'audio, sous-titres découpés) ou cues qui ne correspondent pas au texte : au prorata sur `totalMs`.
 */
export function offsetToMs(offset: number, text: string, cues: readonly MarkCue[] | null | undefined, totalMs: number): number {
  const t = normalizeSpaces(text);
  const starts = cues?.length ? cueOffsets(t, cues) : null;
  if (cues?.length && starts) {
    let i = 0;
    for (let k = 0; k < starts.length; k++) if (starts[k]! <= offset) i = k;
    const cue = cues[i]!;
    const len = Math.max(1, normalizeSpaces(cue.text).length);
    const into = Math.min(1, Math.max(0, (offset - starts[i]!) / len));
    return cue.startMs + into * (cue.endMs - cue.startMs);
  }
  if (!t.length || totalMs <= 0) return 0;
  return (Math.min(Math.max(0, offset), t.length) / t.length) * totalMs;
}

export interface MarkTimeline {
  marks: TimedMark[];
  /** Fragments introuvables (le test les refuse ; à l'écran, le repère est simplement absent) */
  missing: string[];
}

/** Repères de l'étape, datés sur la narration (cues WebVTT, sinon durée de l'étape), triés par instant de départ. */
export function markTimeline(
  template: string,
  resolved: string,
  marks: readonly TourMark[] | undefined,
  cues: readonly MarkCue[] | null | undefined,
  totalMs: number,
): MarkTimeline {
  const out: TimedMark[] = [];
  const missing: string[] = [];
  (marks ?? []).forEach((m, index) => {
    const off = fragmentOffset(template, resolved, m.at);
    if (off == null) {
      missing.push(m.at);
      return;
    }
    const targets: readonly MarkTarget[] = typeof m.target === 'string' ? [m.target] : m.target;
    out.push({ startMs: offsetToMs(off, resolved, cues, totalMs), targets, index });
  });
  out.sort((a, b) => a.startMs - b.startMs || a.index - b.index);
  return { marks: out, missing };
}

/** Repère allumé à l'instant `ms` : le dernier commencé (il dure jusqu'au suivant ou à la fin de l'étape) ; null avant le premier. */
export function activeMark(marks: readonly TimedMark[], ms: number): TimedMark | null {
  let found: TimedMark | null = null;
  for (const m of marks) {
    if (m.startMs <= ms) found = m;
    else break;
  }
  return found && !(found.targets.length === 1 && found.targets[0] === 'none') ? found : null;
}

/** Forme du repère : anneau autour d'un astre ou de l'étoile-guide, cadre autour d'un élément d'interface. */
export function markShape(target: MarkTarget): 'ring' | 'frame' {
  return target === 'origin' || target.startsWith('stars:') || target.startsWith('pole:') ? 'ring' : 'frame';
}

/**
 * Sous-titres par phrase (retour de l'équipe du 10/11 : sous-titres coupés au milieu d'une phrase courte, « comprise. » seul) :
 * le texte de l'étape est découpé par phrases (`chunks`, ex. `cueChunks`, qui regroupe les phrases courtes et ne coupe une
 * phrase longue qu'à une virgule), et chaque morceau commence quand la voix y arrive d'après les cues WebVTT (`offsetToMs`).
 * Les temps restent ceux des .vtt (aucun temps inventé) ; seul le découpage affiché change. Cues absentes ou qui ne disent
 * pas le texte : null (l'appelant garde les cues telles quelles).
 */
export function sentenceCues(text: string, chunks: readonly string[], cues: readonly MarkCue[]): MarkCue[] | null {
  if (!cues.length || !chunks.length) return null;
  const starts = cueOffsets(text, chunks.map((c) => ({ startMs: 0, endMs: 0, text: c })));
  if (!starts || !cueOffsets(text, cues)) return null;
  const end = cues[cues.length - 1]!.endMs;
  const times = starts.map((o) => offsetToMs(o, text, cues, 0));
  return chunks.map((c, i) => ({ startMs: times[i]!, endMs: times[i + 1] ?? end, text: c }));
}
