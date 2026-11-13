import { describe, expect, it } from 'vitest';
import { modeChartModel, wrapLabel } from './modeChart';
import type { ModeRow } from './modesCompare';

describe('wrapLabel (nom du mode sur deux lignes au plus)', () => {
  it('coupe aux espaces, glouton, sans rien perdre', () => {
    expect(wrapLabel('Voiture', 18)).toEqual(['Voiture']);
    expect(wrapLabel('Transports en commun + marche', 18)).toEqual(['Transports en', 'commun + marche']);
    expect(wrapLabel('Voiture (trafic moyen DiRIF)', 18)).toEqual(['Voiture (trafic', 'moyen DiRIF)']);
  });

  it('jamais plus de deux lignes : le reste est gardé sur la seconde', () => {
    expect(wrapLabel('a b c d e f g h i j k l m n o p', 4)).toEqual(['a b', 'c d e f g h i j k l m n o p']);
  });
});

const row = (mode: string, out: number | null, ret: number | null, verdict: ModeRow['verdict'] = 'accessible', current = false): ModeRow => ({
  mode: mode as ModeRow['mode'],
  label: mode,
  out,
  ret,
  verdict,
  verdictText: '',
  cost: null,
  carbon: null,
  current,
});

describe('modeChartModel (comparer les moyens de transport)', () => {
  const m = modeChartModel([row('transit', 40, 45), row('car', 20, 25), row('walk', null, null, 'none'), row('bike', 30, 28), row('velib', null, null, 'unknown')]);

  it('trie par le temps aller + retour, le plus court d’abord ; sans durée à la fin, dans l’ordre du tableau', () => {
    expect(m.rows.map((r) => r.mode)).toEqual(['car', 'bike', 'transit', 'walk', 'velib']);
  });

  it('l’axe part de 0 et finit au plus grand temps dessiné, sans budget ni seuil', () => {
    expect(m.axisMax).toBe(45);
    expect(modeChartModel([row('walk', null, null, 'none')]).axisMax).toBe(0);
  });

  it('« aucun trajet » et « non calculé » sont écrits, jamais dessinés comme une valeur', () => {
    const walk = m.rows.find((r) => r.mode === 'walk')!;
    expect(walk.out).toEqual({ minutes: null, written: 'Aucun trajet' });
    expect(walk.sentence).toBe('walk : aller : aucun trajet, retour : aucun trajet.');
    const velib = m.rows.find((r) => r.mode === 'velib')!;
    expect(velib.ret).toEqual({ minutes: null, written: 'Non calculé' });
  });

  it('un seul sens sans durée : l’autre sens reste dessiné, le mode passe après', () => {
    const one = modeChartModel([row('a', 10, null), row('b', 50, 50)]);
    expect(one.rows.map((r) => r.mode)).toEqual(['b', 'a']);
    expect(one.rows[1]!.out.minutes).toBe(10);
    expect(one.rows[1]!.ret.written).toBe('Aucun trajet');
  });

  it('phrase du survol : aller et retour en minutes, sans tiret long', () => {
    expect(m.rows[0]!.sentence).toBe('car : aller 20\u00a0min, retour 25\u00a0min.');
    for (const r of m.rows) expect(r.sentence).not.toMatch(/[\u2013\u2014]/);
  });
});
