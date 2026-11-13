import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { astreBassinLine, astreBassinName, astreBassinSentence, astreCommunesText, astreSizeText } from './astreBassin';
import { formatInt } from './format';
import type { Pole } from './types';

const read = (rel: string): Pole[] => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf-8')) as Pole[];
const polesOf = (rel: string): Pole[] => {
  const f = read(rel) as unknown as { poles?: Pole[] } | Pole[];
  return Array.isArray(f) ? f : (f.poles ?? []);
};

describe('ligne « bassin » du survol et de l’alternative textuelle (arbitrage du 05/11, point 3)', () => {
  it('44 astres : nom du bassin, communes et postes salariés (INSEE) viennent de poles.json', () => {
    const poles = polesOf('poles.json');
    expect(poles).toHaveLength(44);
    for (const p of poles) {
      expect(p.bassin?.name).toBeTruthy();
      expect(astreBassinName(p)).toBe(`Bassin ${p.bassin!.name}`);
      const n = p.communes.length;
      expect(astreCommunesText(p)).toBe(`${formatInt(n)} commune${n > 1 ? 's' : ''}`);
      const sentence = astreBassinSentence(p)!;
      expect(sentence).toContain(p.bassin!.name);
      expect(sentence).toContain(`L'astre regroupe ${formatInt(n)} commune`);
      expect(astreBassinLine(p)).toBe(`Bassin ${p.bassin!.name} · astre de ${formatInt(n)} commune${n > 1 ? 's' : ''}`);
      if (p.jobs != null) expect(sentence).toContain(`${formatInt(p.jobs)} postes salariés (INSEE)`);
      expect(sentence).not.toMatch(/offre|emploi disponible|[\u2013\u2014]/i);
      expect(astreBassinLine(p)).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('astre sans bassin : aucune ligne, rien ne change', () => {
    for (const p of [{ id: 'X', communes: [], jobs: null } as unknown as Pole]) {
      expect(p.bassin).toBeUndefined();
      expect(astreBassinName(p)).toBeNull();
      expect(astreCommunesText(p)).toBeNull();
      expect(astreSizeText(p)).toBeNull();
      expect(astreBassinSentence(p)).toBeNull();
      expect(astreBassinLine(p)).toBeNull();
    }
  });

  it('postes absents : jamais inventés, seul le nombre de communes reste', () => {
    const p = { bassin: { code: 'X1', name: 'Sud 77', source: 'GEO04' }, communes: ['77001'], jobs: null };
    expect(astreSizeText(p)).toBe('1 commune');
    expect(astreBassinSentence(p)).toBe("Bassin Sud 77. L'astre regroupe 1 commune.");
  });

  it('exemple de la carte : Sud 77, 106 communes, postes lus', () => {
    const p = { bassin: { code: 'X1', name: 'Sud 77', source: 'GEO04' }, communes: Array.from({ length: 106 }, (_, i) => String(i)), jobs: 49468 };
    expect(astreSizeText(p)).toBe(`106 communes, ${formatInt(49468)} postes salariés (INSEE)`);
  });
});
