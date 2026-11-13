import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { targetSize } from './tokens';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** Taille minimale des cibles (WCAG 2.5.8) : le jeton et son miroir CSS restent d'accord, et les contrôles du bas du ciel les utilisent. */
describe('targetSize (cibles de 24 px au minimum)', () => {
  it('le jeton vaut 24 px, minimum de WCAG 2.5.8', () => {
    expect(targetSize.minPx).toBe(24);
  });

  it('--target-min (styles.css) est le miroir du jeton', () => {
    const styles = read('../styles.css');
    const m = styles.match(/--target-min:\s*(\d+)px/);
    expect(m, '--target-min doit être défini dans :root').not.toBeNull();
    expect(Number(m![1])).toBe(targetSize.minPx);
  });

  it('la bande du ciel et le « i » du compteur prennent leur taille de --target-min, sans valeur en dur', () => {
    const credit = read('../components/skyCredit.css');
    expect(credit).toMatch(/\.sky-credit-line:not\(\.sky-prov\) \.link-btn[\s\S]*?min-height:\s*var\(--target-min\)/);
    expect(credit).toMatch(/\.sky-credit-line:not\(\.sky-prov\) a,[\s\S]*?min-width:\s*var\(--target-min\)/);
    const styles = read('../styles.css');
    expect(styles).toMatch(/\.counter-info \.info-btn \{[^}]*width:\s*var\(--target-min\)[^}]*height:\s*var\(--target-min\)/);
  });
});
