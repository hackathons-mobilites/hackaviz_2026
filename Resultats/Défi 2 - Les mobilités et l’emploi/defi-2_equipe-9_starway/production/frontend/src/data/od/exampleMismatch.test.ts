/**
 * Retour de Nicolas (12/11) : Maisons-Laffitte vers Paris 9e, 14h-22h, 60 min. Le verdict (table commune par commune, centre
 * de l'arrondissement) dit « retour hors de portée », l'exemple de trajet (arrêt du pôle) affiche 40 et 44 min. Valeurs
 * reprises des données publiées le 12/11 (od_walk3000/o/78358.bin et itineraries/78358.json.gz) : retour à 22h, 76 min.
 */
import { describe, expect, it } from 'vitest';
import type { OdDestState } from './compute';
import { odExampleMismatchText, odHeroLegsText } from './proofOd';
import type { OdTextContext } from './texts';

const ctx: OdTextContext = { maxTripMin: 120, timeDependent: true, partial: false };
const names = new Map([
  ['75109', 'Paris 9e Arrondissement'],
  ['78358', 'Maisons-Laffitte'],
]);

function dest(insee: string, status: OdDestState['status'], out: number | null, ret: number | null, jobs = 1000): OdDestState {
  return {
    dest: Number(insee),
    insee,
    status,
    out: { minutes: out, reason: out == null ? 'no_trip_within_120' : null, dep: out == null ? null : 13 * 60 + 20 },
    ret: { minutes: ret, reason: ret == null ? 'no_trip_within_120' : null },
    jobs,
    pole: 0,
  } as OdDestState;
}

describe('odExampleMismatchText : le panneau ne contredit plus le verdict (12/11)', () => {
  it('Paris 9e en 14h-22h : astre éteint, exemple dans les 60 min : les durées du verdict sont écrites', () => {
    const t = odExampleMismatchText(
      { reached: 0, communes: [dest('75109', 'out_only', 55, 76)] },
      { out: { min: 40 }, ret: { min: 44 } },
      names,
      60,
      ctx,
      22 * 60,
    );
    expect(t).not.toBeNull();
    expect(t).toContain('au centre de Paris 9e');
    expect(t).toContain('aller 55 min');
    expect(t).toContain('retour 76 min');
    expect(t).toContain('il tient dans le temps choisi');
    expect(t).toContain('il ne change pas le verdict');
  });

  it('astre allumé mais exemple hors du temps choisi : la phrase dit « il dépasse le temps choisi »', () => {
    const t = odExampleMismatchText(
      { reached: 1000, communes: [dest('75109', 'accessible', 40, 44)] },
      { out: { min: 62 }, ret: { min: 44 } },
      names,
      60,
      ctx,
      22 * 60,
    );
    expect(t).toContain('il dépasse le temps choisi');
  });

  it('pôle de plusieurs communes : la plus grande en postes est citée', () => {
    const t = odExampleMismatchText(
      { reached: 0, communes: [dest('78358', 'out_only', 30, 70, 50), dest('75109', 'out_only', 55, 76, 9000)] },
      { out: { min: 40 }, ret: { min: 44 } },
      names,
      60,
      ctx,
      22 * 60,
    );
    expect(t).toContain('au centre de chaque commune du pôle, dont Paris 9e');
  });

  it('astre allumé par une petite commune du pôle : c’est elle qui est citée, pas la plus grande', () => {
    const t = odExampleMismatchText(
      { reached: 50, communes: [dest('78358', 'accessible', 30, 40, 50), dest('75109', 'out_only', 55, 76, 9000)] },
      { out: { min: 62 }, ret: { min: 44 } },
      names,
      60,
      ctx,
      22 * 60,
    );
    expect(t).toContain('dont Maisons-Laffitte');
    expect(t).toContain('il dépasse le temps choisi');
  });

  it('exemple et verdict d’accord, ou exemple incomplet : rien n’est écrit', () => {
    expect(
      odExampleMismatchText({ reached: 1000, communes: [dest('75109', 'accessible', 40, 44)] }, { out: { min: 40 }, ret: { min: 44 } }, names, 60, ctx, 22 * 60),
    ).toBeNull();
    expect(
      odExampleMismatchText({ reached: 0, communes: [dest('75109', 'out_only', 55, 76)] }, { out: { min: 40 }, ret: null }, names, 60, ctx, 22 * 60),
    ).toBeNull();
    expect(odExampleMismatchText({ reached: 0, communes: [dest('75109', 'self', null, null)] }, { out: { min: 40 }, ret: { min: 44 } }, names, 60, ctx, 22 * 60)).toBeNull();
  });
});

describe('odHeroLegsText : la durée du verdict en tête de la fiche (12/11)', () => {
  it('arrondissement : les deux sens, avec ce qui dépasse le temps choisi', () => {
    const t = odHeroLegsText({ reached: 0, communes: [dest('75109', 'out_only', 55, 76)] }, names, 60, ctx, 22 * 60)!;
    expect(t.startsWith('Aller 55 min')).toBe(true);
    expect(t).toContain('retour 76 min');
    expect(t).toContain('au-delà de 60 min');
    expect(t.match(/au-delà/g)).toHaveLength(1);
  });
  it('pôle de plusieurs communes éteint : la commune la plus proche', () => {
    const t = odHeroLegsText({ reached: 0, communes: [dest('78358', 'none', 70, 80, 50), dest('75109', 'none', 62, 58, 9000)] }, names, 60, ctx, 17 * 60)!;
    expect(t).toContain('la plus proche, Paris 9e');
  });
  it('pôle de plusieurs communes allumé, ou commune de départ seule : rien', () => {
    expect(odHeroLegsText({ reached: 50, communes: [dest('78358', 'accessible', 30, 40, 50), dest('75109', 'none', 62, 58)] }, names, 60, ctx, 1020)).toBeNull();
    expect(odHeroLegsText({ reached: 0, communes: [dest('78358', 'self', null, null)] }, names, 60, ctx, 1020)).toBeNull();
  });
});

describe('« i » des durées du verdict (13/11)', () => {
  it('dit d’où viennent les durées et pourquoi l’exemple peut différer, sans tiret long', async () => {
    const { HERO_LEGS_METHOD } = await import('./proofOd');
    const all = HERO_LEGS_METHOD.join(' ');
    expect(all).toContain('centre de gravité de sa population');
    expect(all).toContain('attente du premier départ comprise');
    expect(all).toContain('arrêt le plus desservi du pôle');
    expect(all).toContain('ne changent pas le verdict');
    expect(all).not.toMatch(/[\u2013\u2014]/);
  });
});
