/**
 * Commune de départ (retours de Sara et Cyril, point 4.1, décision de Nicolas du 05/11) : ses postes
 * SORTENT du total (compteur, part, légende, liste, affiche) car son trajet n'est pas mesuré. Ils ne
 * sont jamais comptés comme atteints, et le dénominateur de « Part = Atteints / Postes » ne les
 * contient pas non plus. Ils sont dits à part : « Votre commune : N postes, trajet non mesuré ».
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { formatInt } from '../format';
import { computeOd } from './compute';
import { odBadge, odShareSummary } from './proofOd';
import { odPoleStates, odSkyTotals } from './sky';
import { odCounterDetail, odShare, odSkySummary, poleShareState, selfJobsLine } from './summaryText';
import { parseSwod } from './swod';
import { buildSwod, fixtureIndex } from './testkit';
import { poleShareText, selfJobsText } from './texts';
import type { OdIndex } from './types';

const N = 229;
const constSeries = (v: number) => Array.from({ length: N }, () => v);
const cov = { transit: { origins: 1, complete: true, computed: [] as string[] } };

/*
 * Jeu synthétique (valeurs arbitraires). Origine = A.
 * Astre P0 = A + B (la commune de départ est DANS un astre qui contient d'autres communes),
 * astre P1 = C ; D hors astre.
 */
const index = fixtureIndex({
  communes: ['A', 'B', 'C', 'D'],
  jobs: [100, 200, 300, 400],
  pole_of: [0, 0, 1, null],
  poles: [
    { id: 'P0', jobs: 300 },
    { id: 'P1', jobs: 300 },
  ],
  files: ['A'],
  complete: true,
  coverage: cov,
});

const swod = (records: { dest: number; out: number[]; ret: number[] }[]) =>
  parseSwod(buildSwod({ origin: 0, step: 5, first: 180, nSlots: N, maxTrip: 120, sections: [{ mode: 0, kind: 'series', records }] }));

const file = swod([
  { dest: 1, out: constSeries(30), ret: constSeries(25) },
  { dest: 2, out: constSeries(40), ret: constSeries(20) },
]);

const sc = { origin: 'A', start: 540, end: 1020, budget: 45, mode: 'transit' as const };
const polesOf = [{ id: 'P0' }, { id: 'P1' }];

describe('la commune de départ sort du total (synthétique)', () => {
  const r = computeOd(index, file, sc);

  it('ses postes ne sont jamais comptés comme atteints, ni dans le total, ni dans le dénominateur', () => {
    expect(r.status).toBe('ok');
    expect(r.dests[0]).toMatchObject({ insee: 'A', status: 'self', record: false });
    expect(r.totals).toMatchObject({
      reachedAll: 500, // B (200) + C (300), jamais A (100)
      allJobs: 1000,
      selfJobs: 100,
      measurableJobs: 900, // 1000 moins la commune de départ
      measurableCommunes: 3,
      reachedCommunes: 2,
    });
    // Part = Atteints / Postes, la commune de départ n'étant pas dans Postes
    expect(odShare({ reachedAll: 500, measurableJobs: 900 })).toBeCloseTo(500 / 900, 10);
  });

  it('un astre qui contient la commune de départ et une autre commune : part sur ses postes mesurables', () => {
    const p0 = r.poles[0]!;
    expect(p0).toMatchObject({ jobs: 300, self: 100, measurable: 200, reached: 200 });
    expect(p0.share).toBe(1); // tout ce qui est mesurable dans l'astre est atteint
    expect(r.poles[1]).toMatchObject({ jobs: 300, self: 0, measurable: 300, reached: 300, share: 1 });
    // taille de l'astre inchangée (ciel stable) : `jobs` reste le total du pôle
    const states = odPoleStates(polesOf, r);
    expect(states[0]!.od).toMatchObject({ jobs: 300, measurable: 200, communes: 1, reachedCommunes: 1 });
    expect(odSkyTotals(states, r).od).toMatchObject({ reachedAll: 500, measurableJobs: 900, selfJobs: 100, communes: 3 });
  });

  it('un astre réduit à la commune de départ : aucun poste mesurable, pas de part, ni « atteint » ni « non calculé »', () => {
    const only = fixtureIndex({
      communes: ['A', 'B'],
      jobs: [100, 200],
      pole_of: [0, 1],
      poles: [
        { id: 'P0', jobs: 100 },
        { id: 'P1', jobs: 200 },
      ],
      files: ['A'],
      complete: true,
      coverage: cov,
    });
    const res = computeOd(only, swod([{ dest: 1, out: constSeries(30), ret: constSeries(25) }]), sc);
    const p0 = res.poles[0]!;
    expect(p0).toMatchObject({ jobs: 100, self: 100, measurable: 0, reached: 0, share: null });
    const [s0] = odPoleStates(polesOf, res);
    expect(s0!.status).toBe('unknown');
    expect(poleShareState(s0!.od!)).toBe('votre commune : 100 postes, trajet non mesuré');
    expect(odBadge(p0, 45)).toEqual({ kind: 'unknown', text: 'Votre commune : trajet non mesuré' });
    expect(res.totals).toMatchObject({ reachedAll: 200, measurableJobs: 200, selfJobs: 100 });
  });

  it('textes : « Votre commune : N postes, trajet non mesuré » à part, hors du pourcentage', () => {
    const totals = odSkyTotals(odPoleStates(polesOf, r), r).od!;
    expect(selfJobsText(100)).toBe('votre commune : 100 postes, trajet non mesuré');
    expect(selfJobsText(1)).toBe('votre commune : 1 poste, trajet non mesuré');
    expect(selfJobsLine(100)).toBe('Votre commune : 100 postes, trajet non mesuré');
    expect(selfJobsLine(0)).toBeNull();
    const detail = odCounterDetail(totals, 45, 2023);
    expect(detail).toContain('500 postes salariés sont atteints aller et retour');
    expect(detail).toContain("soit 55,6\u00a0% des 900 postes d'Île-de-France hors votre commune");
    expect(detail).toContain('Votre commune : 100 postes, trajet non mesuré');
    expect(detail).toContain('hors du total et du pourcentage');
    expect(detail).toContain('dans 2 communes sur 3');
    const summary = odSkySummary({
      originName: 'A',
      shiftLabel: '9h-17h',
      modeLabel: 'Transports en commun',
      budget: 45,
      totals: { poleCount: 2, accessibleCount: 2, jobs: 500, totalJobs: 600, hasData: true, od: totals },
    });
    expect(summary).toContain('Votre commune : 100 postes, trajet non mesuré.');
    expect(summary).not.toContain('1\u00a0000');
    expect(poleShareText('P0', r.poles[0]!)).toBe('P0 : 200 postes atteints aller et retour sur 200 (100\u00a0%) ; votre commune : 100 postes, trajet non mesuré');
    expect(poleShareState(odPoleStates(polesOf, r)[0]!.od!)).toContain('votre commune : 100 postes, trajet non mesuré');
    expect(odShareSummary(r.poles[0]!).notes).toEqual(['Votre commune : 100 postes, trajet non mesuré, hors du pourcentage.']);
  });
});

/*
 * Tables publiées (od_walk3000), 44 astres.
 * Aucune valeur chiffrée n'est figée (les tables seront republiées) : seulement les invariants.
 */
const DIR = 'public/data/od_walk3000';
const INDEXES: [string, string][] = [
  ['44 astres', `${DIR}/index.json`],
];
const ORIGINS = ['75118', '93066', '78517', '92050'];
const published = existsSync(`${DIR}/index.json`) && existsSync(`${DIR}/o/75118.bin`);

function readOrigin(insee: string) {
  const raw = readFileSync(`${DIR}/o/${insee}.bin`);
  const buf = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  return parseSwod(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

describe.skipIf(!published).each(INDEXES)('commune de départ hors du total, tables publiées, %s', (_label, indexPath) => {
  const idx = JSON.parse(readFileSync(indexPath, 'utf8')) as OdIndex;

  it.each(ORIGINS)('origine %s : le total ne la contient pas', (insee) => {
    const r = computeOd(idx, readOrigin(insee), { origin: insee, start: 9 * 60, end: 17 * 60, budget: 60, mode: 'transit' });
    expect(r.status).toBe('ok');
    const self = r.dests[r.originIndex]!;
    expect(self.status).toBe('self');
    const t = r.totals!;
    // somme des seules communes atteintes : jamais la commune de départ
    const reached = r.dests.filter((d) => d.status === 'accessible').reduce((a, d) => a + d.jobs, 0);
    expect(t.reachedAll).toBe(reached);
    expect(t.selfJobs).toBe(self.jobs);
    expect(t.selfJobs).toBeGreaterThan(0);
    expect(t.measurableJobs).toBe(t.allJobs - self.jobs);
    expect(t.measurableCommunes).toBe(idx.communes.length - 1);
    expect(t.reachedAll).toBeLessThanOrEqual(t.measurableJobs);
    const sky = odSkyTotals(odPoleStates(idx.poles, r), r).od!;
    expect(sky.measurableJobs).toBe(t.measurableJobs);
    expect(sky.communes).toBe(idx.communes.length - 1);
    // astre de la commune de départ : part sur ses
    // postes mesurables, taille de l'astre inchangée
    if (self.pole != null) {
      const pole = r.poles[self.pole]!;
      expect(pole.jobs).toBe(idx.poles[self.pole]!.jobs);
      expect(pole.self).toBe(self.jobs);
      expect(pole.measurable).toBe(pole.jobs - self.jobs);
      if (pole.measurable > 0) expect(pole.share).toBeCloseTo(pole.reached / pole.measurable, 12);
      else expect(pole.share).toBeNull();
    }
    // aucun astre ne compte la commune de départ comme atteinte ou non atteinte
    for (const p of r.poles) {
      expect(p.reached + p.notReached + p.unknown).toBe(p.measurable);
      expect(p.reached).toBeLessThanOrEqual(p.measurable);
    }
    // la phrase du compteur dit la commune de départ à part
    expect(odCounterDetail(sky, 60, 2023)).toContain(`Votre commune : ${formatInt(self.jobs)} poste`);
  });
});
