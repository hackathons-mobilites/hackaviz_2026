import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isBmoMetiersFile, metierName, metierProjects, metierProjectsOral, type BmoMetiersFile } from './bmoMetiers';

const file: BmoMetiersFile = {
  contract: 'bmo-metiers-1',
  year: 2026,
  metiers: [{ code: 'S1X20', name: 'Aides de cuisine et employés polyvalents de la restauration', family: 'V' }],
  bassins: { '1107': { S1X20: [6973, 0, 1815, 0, 1083, 0], S9X99: [null, 1, null, 1, null, 1], S2X60: [2921, 2, 1253, 0, 480, 0] } },
};

describe('projets de recrutement par métier (BMO, D-035)', () => {
  it('lecture : somme publiée et cases « * » non comptées ; absent : null', () => {
    expect(metierProjects(file, '1107', 'S1X20')).toEqual({ n: 6973, masked: 0 });
    expect(metierProjects(file, '1107', 'S0X00')).toBeNull();
    expect(metierProjects(file, '9999', 'S1X20')).toBeNull();
    expect(metierProjects(file, undefined, 'S1X20')).toBeNull();
    expect(metierName(file, 'S1X20')).toMatch(/^Aides de cuisine/);
  });
  it('à l’oral : arrondi comme les personnes, « au moins » par le bas si des cases « * » manquent, jamais 0', () => {
    expect(metierProjectsOral({ n: 6973, masked: 0 })).toBe('près de 7\u00a0000');
    expect(metierProjectsOral({ n: 6973, masked: 2 })).toBe('au moins 6\u00a0900');
    expect(metierProjectsOral({ n: null, masked: 1 })).toBeNull();
    expect(metierProjectsOral({ n: 0, masked: 0 })).toBeNull();
    expect(metierProjectsOral(null)).toBeNull();
  });
  it('garde de forme : autre contrat ou ligne mal formée refusés', () => {
    expect(isBmoMetiersFile(file)).toBe(true);
    expect(isBmoMetiersFile({ ...file, contract: 'bmo-1' })).toBe(false);
    expect(isBmoMetiersFile({ ...file, bassins: { '1107': { S1X20: [1, 2] } } })).toBe(false);
    expect(isBmoMetiersFile(null)).toBe(false);
  });
  const url = new URL('../../public/data/bmo_metiers.json', import.meta.url);
  it.skipIf(!existsSync(url))('fichier publié : contrat valide, métier de Léa publié dans le bassin T1 Paris (Paris 8e)', () => {
    const f = JSON.parse(readFileSync(url, 'utf-8')) as unknown;
    expect(isBmoMetiersFile(f)).toBe(true);
    const bmo = f as BmoMetiersFile;
    expect(bmo.year).toBe(2026);
    expect(metierName(bmo, 'S1X20')).toMatch(/^Aides de cuisine/);
    expect(metierProjects(bmo, '1107', 'S1X20')?.n).toBeGreaterThan(0);
  });
});
