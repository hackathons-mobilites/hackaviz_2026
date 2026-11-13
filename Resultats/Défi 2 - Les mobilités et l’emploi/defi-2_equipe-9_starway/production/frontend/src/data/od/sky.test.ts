import { describe, expect, it } from 'vitest';
import type { PoleState } from '../accessibility';
import { planTransition, targetOf } from '../../sky/transitions';
import type { OdDestState, OdResult } from './compute';
import { odFolderFor, checkOdFolder } from './folders';
import { mapCommuneKinds, odPoleStates, odPoleStatus, odSkyTotals, partRing, reachedCommunes } from './sky';
import { odCounterDetail, poleShareState } from './summaryText';
import { odModePartial, odTextContext } from './texts';
import type { Meta } from '../types';

/** Tirets cadratin et demi-cadratin, construits sans le caractère réel (CLAUDE.md, règle 8) */
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

/* Valeurs de TEST (arbitraires, jamais affichées). */
const leg = (minutes: number | null) => ({ minutes, reason: minutes == null ? ('no_trip_within_120' as const) : null });
const dest = (i: number, status: OdDestState['status'], jobs: number, pole: number | null, out: number | null = null): OdDestState => ({
  dest: i,
  insee: `C${i}`,
  status,
  out: { ...leg(out), dep: null },
  ret: leg(out),
  jobs,
  pole,
  record: true,
});

function result(dests: OdDestState[], poles: { id: string; jobs: number }[]): OdResult {
  const shares = poles.map((p, i) => {
    const communes = dests.filter((d) => d.pole === i);
    const sum = (f: (d: OdDestState) => boolean) => communes.filter(f).reduce((a, d) => a + d.jobs, 0);
    const reached = sum((d) => d.status === 'accessible');
    const self = sum((d) => d.status === 'self');
    return {
      index: i,
      id: p.id,
      jobs: p.jobs,
      measurable: p.jobs - self,
      reached,
      notReached: sum((d) => d.status === 'none' || d.status === 'out_only'),
      outOnly: sum((d) => d.status === 'out_only'),
      unknown: sum((d) => d.status === 'unknown'),
      self,
      share: p.jobs - self > 0 ? reached / (p.jobs - self) : null,
      communes,
    };
  });
  const reachedAll = dests.filter((d) => d.status === 'accessible').reduce((a, d) => a + d.jobs, 0);
  const selfJobs = dests.filter((d) => d.status === 'self').reduce((a, d) => a + d.jobs, 0);
  const allJobs = dests.reduce((a, d) => a + d.jobs, 0);
  return {
    status: 'ok',
    scenario: { origin: 'C0', start: 540, end: 1020, budget: 45, mode: 'transit' },
    timeDependent: true,
    originIndex: 0,
    dests,
    poles: shares,
    totals: {
      reachedInPoles: shares.reduce((a, s) => a + s.reached, 0),
      reachedAll,
      polesJobs: poles.reduce((a, p) => a + p.jobs, 0),
      allJobs,
      measurableJobs: allJobs - selfJobs,
      selfJobs,
      measurableCommunes: dests.filter((d) => d.status !== 'self').length,
      unknownJobs: 0,
      reachedCommunes: dests.filter((d) => d.status === 'accessible').length,
    },
  };
}

const poles = [
  { id: 'P0', jobs: 100 },
  { id: 'P1', jobs: 50 },
  { id: 'P2', jobs: 40 },
];
const dests = [
  dest(0, 'self', 10, 0),
  dest(1, 'accessible', 30, 0, 25),
  dest(2, 'none', 60, 0, 70),
  dest(3, 'out_only', 50, 1, 30),
  dest(4, 'accessible', 7, null, 12),
  dest(5, 'none', 40, 2),
];
const r = result(dests, poles);

describe('table OD → états du ciel (positions et tailles inchangées, seule la part change)', () => {
  const states = odPoleStates(poles, r);

  it('un astre s’allume dès qu’un poste est atteint ; sinon le constat mesuré ; out / ret du pôle nuls', () => {
    expect(states.map((s) => s.status)).toEqual(['accessible', 'out_only', 'none']);
    expect(states[0]).toMatchObject({ out: null, ret: null, od: { reached: 30, self: 10, jobs: 100, measurable: 90, share: 30 / 90, reachedCommunes: 1, communes: 2, fastestOut: 25 } });
    expect(odPoleStatus({ reached: 0, notReached: 0, outOnly: 0 })).toBe('unknown');
  });

  it('compteur : postes atteints sur toute l’Île-de-France (hors pôles compris), commune d’origine à part', () => {
    const t = odSkyTotals(states, r);
    expect(t).toMatchObject({ accessibleCount: 1, jobs: 30, totalJobs: 190, hasData: true });
    expect(t.od).toMatchObject({ reachedAll: 37, allJobs: 197, measurableJobs: 187, selfJobs: 10, reachedCommunes: 2, communes: 5 });
    const txt = odCounterDetail(t.od!, 45, 2023);
    expect(txt).toContain('37');
    expect(txt).toContain('(Flores 2023)');
    expect(txt).toContain('trajet non mesuré');
    // la commune de départ n'est dans ni le total, ni le dénominateur : 37 sur 187, jamais sur 197
    expect(txt).toContain('187');
    expect(txt).not.toContain('197');
    expect(txt).not.toMatch(LONG_DASH);
  });

  it('résultat non calculable : ciel « non calculé », jamais de zéro', () => {
    const none = odPoleStates(poles, { ...r, status: 'origin_not_computed', poles: [], dests: [], totals: null });
    expect(none.every((s) => s.status === 'unknown' && !s.od)).toBe(true);
    expect(odSkyTotals(none, { ...r, status: 'origin_not_computed', totals: null }).hasData).toBe(false);
  });

  it('contour : atteint, creux (origine), reste ; somme 1', () => {
    expect(partRing(states[0]!.od)).toEqual({ reached: 0.3, self: 0.1, unknown: 0, rest: 0.6 });
    expect(partRing({ jobs: 0, reached: 0, self: 0, unknown: 0 })).toBeNull();
  });

  it('communes atteintes triées par postes ; états de la carte', () => {
    expect(reachedCommunes(r).map((c) => c.insee)).toEqual(['C1', 'C4']);
    const kinds = mapCommuneKinds(r);
    expect(kinds.get('C0')).toBe('self');
    expect(kinds.get('C3')).toBe('out_only');
  });

  it('jamais « accessible » pour une part : le texte dit la part', () => {
    expect(poleShareState(states[0]!.od!)).toMatch(/^33,3\s%/);
    expect(poleShareState(states[1]!.od!)).toBe('aucun poste atteint aller et retour');
  });
});

describe('rendu : astre éclairé en partie (transitions)', () => {
  const states = odPoleStates(poles, r);
  it('canal od et part posés sur la cible ; hors table OD : 0 et null', () => {
    expect(targetOf(states[0])).toMatchObject({ light: 1, od: 1, part: { reached: 0.3 } });
    const access: PoleState = { index: 0, id: 'P0', status: 'accessible', out: 20, ret: 20, reason: null };
    expect(targetOf(access)).toMatchObject({ light: 1, od: 0, part: null });
  });

  it('une part qui change sans changer d’état est un pas (fondu enchaîné), une part identique non', () => {
    const geo = [{ index: 0, id: 'P0', x: 10, y: 10, r: 10 }];
    const cur = [targetOf(states[0])];
    const more = odPoleStates(poles, result([dest(0, 'self', 10, 0), dest(1, 'accessible', 30, 0, 25), dest(2, 'accessible', 60, 0, 40)], poles));
    expect(planTransition([more[0]!], geo, 'filter', { reduced: false, screenWidth: 100, current: cur })).toHaveLength(1);
    expect(planTransition([states[0]!], geo, 'filter', { reduced: false, screenWidth: 100, current: cur })).toHaveLength(0);
  });
});

describe('textes : complétude PAR MODE (coverage[mode].complete, jamais index.complete)', () => {
  const index = {
    max_trip_min: 120,
    complete: false,
    coverage: { transit: { origins: 1285, complete: true }, walk: { origins: 0, complete: false, computed: [] } },
  };
  it('TC complet n’est pas « jeu partiel » même si index.complete vaut false', () => {
    expect(odModePartial(index, 'transit')).toBe(false);
    expect(odModePartial(index, 'walk')).toBe(true);
    expect(odTextContext(index, true).partial).toBe(false);
    expect(odModePartial({ complete: false, coverage: {} }, 'car')).toBe(true);
  });
});

describe('dossier du réglage de marche', () => {
  const meta = {
    walk_settings: {
      default: 'normal',
      mode: 'transit',
      settings: [
        { id: 'normal', label: 'n', leg_limit_m: 3000, key: null },
        { id: 'comfort', label: 'c', leg_limit_m: 1000, key: 'comfort' },
      ],
    },
  } as unknown as Pick<Meta, 'walk_settings'>;
  it('nom dérivé de la distance publiée, réglage attendu dans l’index', () => {
    expect(odFolderFor(meta, null)).toEqual({ path: 'data/od_walk3000/', settingId: 'normal' });
    expect(odFolderFor(meta, 'comfort')).toEqual({ path: 'data/od_walk1000/', settingId: 'comfort' });
    expect(odFolderFor({}, null)).toBeNull();
    expect(checkOdFolder({ walk_setting: { id: 'comfort' } }, { path: 'x/', settingId: 'comfort' })).toEqual([]);
    expect(checkOdFolder({}, { path: 'x/', settingId: 'comfort' })).toHaveLength(1);
  });
  it('un index sans réglage de marche est refusé, avec le dossier dans le message', () => {
    const f44 = odFolderFor(meta, null)!;
    expect(checkOdFolder({}, f44)[0]).toContain(f44.path);
  });
});
