import { describe, expect, it } from 'vitest';
import { odCommuneCount } from './proofOd';

/** Chiffre clé du pli « Communes du pôle » : lu dans les statuts du calcul, la commune de départ n'est pas mesurée. */
describe('odCommuneCount (« 9 sur 11 atteintes »)', () => {
  const d = (status: string) => ({ status }) as never;

  it('compte les communes atteintes aller et retour sur les communes mesurées', () => {
    expect(odCommuneCount({ communes: [d('accessible'), d('accessible'), d('out_only'), d('none'), d('unknown')] })).toEqual({ reached: 2, total: 5 });
  });

  it('la commune de départ (« self ») n’est ni atteinte ni comptée', () => {
    expect(odCommuneCount({ communes: [d('self'), d('accessible'), d('none')] })).toEqual({ reached: 1, total: 2 });
  });

  it('un pôle sans commune : 0 sur 0', () => {
    expect(odCommuneCount({ communes: [] })).toEqual({ reached: 0, total: 0 });
  });
});
