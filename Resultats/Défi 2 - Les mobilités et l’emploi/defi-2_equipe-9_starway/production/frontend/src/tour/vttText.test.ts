import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Sous-titres enregistrés (public/tour/<id>/NN-étape.vtt, écrits par scripts/align-tour-vtt.mjs) : le texte des cues est celui
 * de tour.resolved.json mot pour mot, espaces insécables des nombres comprises ; aucun nombre n'est coupé entre deux lignes
 * ou deux cues (audit du 12/11 : « au moins 47 / 000 », « environ 42 / 500 ») ; la dernière cue ne dépasse pas `durationMs`.
 */
const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);
const file = (rel: string) => fileURLToPath(new URL(`../../public/tour/${rel}`, import.meta.url));
const ms = (t: string) => {
  const [h, m, s] = t.split(':');
  return Math.round(((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000);
};
interface Cue {
  startMs: number;
  endMs: number;
  lines: string[];
}
function cuesOf(vtt: string): Cue[] {
  return [...vtt.matchAll(/(\d\d:\d\d:\d\d\.\d+) --> (\d\d:\d\d:\d\d\.\d+)\r?\n([\s\S]*?)(?:\r?\n\r?\n|\s*$)/g)].map((m) => ({
    startMs: ms(m[1]!),
    endMs: ms(m[2]!),
    lines: m[3]!.split(/\r?\n/).filter((l) => l.length > 0),
  }));
}

describe.each(['lea', 'lea-video'])('sous-titres enregistrés de « %s »', (id) => {
  const manifest = file(`${id}/tour.resolved.json`);
  const resolved = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf-8')) as { steps: { id: string; text: string; durationMs?: number }[] }) : null;
  const steps = (resolved?.steps ?? []).map((s, i) => ({ ...s, stem: `${String(i + 1).padStart(2, '0')}-${s.id}` })).filter((s) => s.durationMs && existsSync(file(`${id}/${s.stem}.vtt`)));

  it('au moins une étape enregistrée est contrôlée', () => {
    expect(steps.length).toBeGreaterThan(0);
  });

  it.each(steps.map((s) => [s.stem, s] as const))('%s : texte mot pour mot, nombres entiers, fin dans la durée de l’étape', (_stem, step) => {
    const cues = cuesOf(readFileSync(file(`${id}/${step.stem}.vtt`), 'utf-8'));
    expect(cues.length).toBeGreaterThan(0);
    // 1. mot pour mot, insécables comprises : les lignes et les cues ne sont séparées que par une espace simple du texte
    const said = cues.map((c) => c.lines.join(' ')).join(' ');
    expect(said).toBe(step.text.replace(/[ \t\r\n]+/g, ' ').trim());
    // 2. aucun nombre coupé : ni une ligne ni une cue ne finit par un chiffre quand la suivante commence par un chiffre,
    //    et une insécable n'est jamais au bord d'une ligne
    const lines = cues.flatMap((c) => c.lines);
    lines.forEach((line, i) => {
      expect(line.startsWith(NBSP) || line.startsWith(NNBSP) || line.endsWith(NBSP) || line.endsWith(NNBSP), `insécable au bord de « ${line} »`).toBe(false);
      const next = lines[i + 1];
      if (next) expect(/\d$/.test(line) && /^\d/.test(next), `nombre coupé entre « ${line} » et « ${next} »`).toBe(false);
    });
    // 3. cues dans l'ordre, sans chevauchement ; la dernière finit au plus tard à la durée de l'étape
    cues.forEach((c, i) => {
      expect(c.endMs).toBeGreaterThan(c.startMs);
      if (i > 0) expect(c.startMs).toBeGreaterThanOrEqual(cues[i - 1]!.endMs);
    });
    expect(cues.at(-1)!.endMs).toBeLessThanOrEqual(step.durationMs!);
  });
});
