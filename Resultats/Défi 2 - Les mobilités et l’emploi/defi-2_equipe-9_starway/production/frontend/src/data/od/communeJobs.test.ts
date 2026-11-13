import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { communeJobsOf } from './communeJobs';
import type { OdIndex } from './types';

describe('communeJobsOf (postes de la commune de départ, point 4.1)', () => {
  const index = { communes: ['75101', '78358', '95000'], jobs: [10, 5530, -1] } as Pick<OdIndex, 'communes' | 'jobs'>;
  it('lit les postes alignés sur communes', () => {
    expect(communeJobsOf(index, '78358')).toBe(5530);
    expect(communeJobsOf(index, '75101')).toBe(10);
  });
  it('commune absente, index absent ou valeur illisible : null, jamais 0', () => {
    expect(communeJobsOf(index, '00000')).toBeNull();
    expect(communeJobsOf(null, '78358')).toBeNull();
    expect(communeJobsOf(index, '95000')).toBeNull();
    expect(communeJobsOf({ communes: ['78358'], jobs: [] }, '78358')).toBeNull();
  });
  const url = new URL('../../../public/data/od_walk3000/index.json', import.meta.url);
  it.skipIf(!existsSync(url))('index publié : Maisons-Laffitte a des postes salariés (INSEE) (valeur lue, aucune valeur figée)', () => {
    const published = JSON.parse(readFileSync(url, 'utf-8')) as OdIndex;
    expect(published.communes).toHaveLength(published.jobs.length);
    const jobs = communeJobsOf(published, '78358');
    expect(jobs).not.toBeNull();
    expect(jobs!).toBeGreaterThan(0);
  });
});
