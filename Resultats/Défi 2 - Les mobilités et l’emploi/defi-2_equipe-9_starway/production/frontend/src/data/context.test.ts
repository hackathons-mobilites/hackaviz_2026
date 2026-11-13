import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ContextFile } from './types';

// Contrat aligné sur un vrai fichier exporté par le pipeline.
describe('context/{insee}.json', () => {
  it('Montreuil : clés attendues', () => {
    const ctx = JSON.parse(readFileSync(new URL('../../public/data/context/93048.json', import.meta.url), 'utf-8')) as ContextFile;
    expect(ctx.population_sex?.shares.H).toBeTypeOf('number');
    expect(ctx.population_age?.bins.length).toBe(ctx.population_age?.shares.length);
    expect(ctx.commute_mode_by_sex?.totals?.F).toBeGreaterThan(0);
    expect(ctx.income?.median_status).toBeDefined();
    expect(ctx.cost?.car_per_trip_eur).toBeNull();
  });
});
