import { describe, expect, it } from 'vitest';
import { cueAt, cueChunks, CUE_MAX_CHARS } from './cues';

describe('repères de sous-titres', () => {
  const text =
    'C’est l’aube. Montreuil dort encore... ou presque. Dans le ciel, rien ne distingue cette ville d’une autre. ' +
    'Les mêmes étoiles, pour plus de 12 millions d’habitants d’Île-de-France. Et pourtant.';
  it('aucun repère ne dépasse la longueur de deux lignes, rien n’est perdu', () => {
    const cues = cueChunks(text);
    expect(cues.every((c) => c.length <= CUE_MAX_CHARS)).toBe(true);
    expect(cues.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });
  it('rythme proportionnel aux caractères', () => {
    const cues = ['a'.repeat(10), 'b'.repeat(30)];
    expect(cueAt(cues, 0, 4000)).toBe(0);
    expect(cueAt(cues, 999, 4000)).toBe(0);
    expect(cueAt(cues, 1001, 4000)).toBe(1);
    expect(cueAt(cues, 99999, 4000)).toBe(1);
  });
});
