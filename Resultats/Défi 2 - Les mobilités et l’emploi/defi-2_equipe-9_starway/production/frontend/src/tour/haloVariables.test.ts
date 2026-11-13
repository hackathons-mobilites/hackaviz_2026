import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ContextFile } from '../data/types';
import { VARIABLES, type NarrationContext } from './variables';

const montreuil = JSON.parse(
  readFileSync(new URL('../../public/data/context/93048.json', import.meta.url), 'utf-8'),
) as ContextFile;
const ctx = (context: ContextFile) => ({ context }) as unknown as NarrationContext;

describe('variables du halo (marges)', () => {
  it('Montreuil : parts prononcées, écart établi', () => {
    expect(VARIABLES['halo.transitF']!(ctx(montreuil))).toMatch(/^\d+\u00a0%$/);
    expect(VARIABLES['halo.transitGap']!(ctx(montreuil))).toBe('parts');
  });
  it('niveau de vie des deux communes : la médiane de B vient de son propre fichier, jamais de celui de A', () => {
    const b = { ...montreuil, income: { ...montreuil.income!, median_living_standard_eur: 31_234, median_status: 'ok', status: 'ok' } } as ContextFile;
    const both = { context: montreuil, compareContext: b } as unknown as NarrationContext;
    expect(VARIABLES['halo.compareIncomeMedianOral']!(both)).toBe('31\u00a0200 euros');
    expect(VARIABLES['halo.compareCase']!(both)).toBe('deux_medianes');
    // pas de commune de comparaison, ou médiane non publiée : rien n'est dit
    expect(VARIABLES['halo.compareIncomeMedianOral']!(ctx(montreuil))).toBeNull();
    expect(VARIABLES['halo.compareCase']!(ctx(montreuil))).toBeNull();
    const secret = { ...b, income: { ...b.income!, status: 'secret', median_status: 'secret', median_living_standard_eur: null } } as unknown as ContextFile;
    expect(VARIABLES['halo.compareCase']!({ context: montreuil, compareContext: secret } as unknown as NarrationContext)).toBeNull();
  });
  it('marge inconnue : la part n’est pas prononcée', () => {
    const b = montreuil.commute_mode_by_sex!;
    const c: ContextFile = { ...montreuil, commute_mode_by_sex: { ...b, margin95: { F: { ...b.margin95!.F, transit: null }, H: b.margin95!.H } } };
    expect(VARIABLES['halo.transitF']!(ctx(c))).toBeNull();
    expect(VARIABLES['halo.transitH']!(ctx(c))).not.toBeNull();
    expect(VARIABLES['halo.transitGap']!(ctx(c))).toBeNull();
  });
});
