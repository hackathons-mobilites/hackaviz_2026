import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatPercent } from './format';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/**
 * `toFixed` écrit un point décimal : il ne sert que pour des valeurs qui ne sont jamais lues à l'écran (attributs SVG, styles,
 * couleurs, journal d'un outil), sinon il est suivi de `.replace('.', ',')`. Fichiers où tous les `toFixed` sont de cette sorte :
 */
const NOT_DISPLAYED = new Set([
  'components/LogoReveal.tsx', // transformations et opacités SVG
  'components/StatusGlyph.tsx', // tracé SVG
  'components/territoire/UnemploymentTab.tsx', // points d'une polyline SVG
  'sky/textures.ts', // couleurs rgba des textures
  'tour/voiceCheck.ts', // rapport console de scripts/check-tour-voice.mjs, jamais affiché sur le site
]);

describe('nombres décimaux affichés avec une virgule (10/11)', () => {
  it('formatPercent écrit une virgule décimale et une espace insécable avant %', () => {
    expect(formatPercent(40.2)).toBe('40,2 %');
    expect(formatPercent(62.84)).toBe('62,8 %');
    expect(formatPercent(40)).toBe('40 %');
    expect(formatPercent(40.2)).not.toMatch(/\d\.\d/);
  });

  it('le compteur écrit sa part avec formatPercent (jamais toFixed ni String)', () => {
    const counter = readFileSync(join(SRC, 'components/CounterBlock.tsx'), 'utf8');
    expect(counter).toContain('formatPercent(share * 100)');
    expect(counter).not.toMatch(/toFixed\(|String\(share/);
  });

  it('tout toFixed d’un texte affiché est suivi d’une virgule décimale', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const rel = file.slice(SRC.length).replace(/\\/g, '/').replace(/^\//, '');
      if (NOT_DISPLAYED.has(rel)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\.toFixed\(\d\)/.test(line) && !/\.toFixed\(\d\)\.replace\('\.', ','\)/.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
