import { describe, expect, it } from 'vitest';
import { skyNoticeTitle, type SkyNoticeFacts } from './skyNotice';

const base: SkyNoticeFacts = {
  name: 'Sourdun',
  poleCount: 44,
  computedCount: 12,
  communeCount: 1285,
  odFailed: false,
  velibOutOfZone: null,
  astres44: true,
  accessMissing: false,
  walkMissing: false,
};
const OUT = 'Pas de station Vélib\' dans cette commune';

describe('carte « aucun résultat » du ciel', () => {
  it("une commune sans station Vélib' le dit, même sur le ciel à 44 astres (jamais « en cours de calcul »)", () => {
    const t = skyNoticeTitle({ ...base, velibOutOfZone: OUT });
    expect(t).toBe(`${OUT} (Sourdun).`);
    expect(t).not.toContain('en cours de calcul');
  });

  it('un mode absent des 44 astres reste annoncé en cours de calcul', () => {
    expect(skyNoticeTitle(base)).toContain('en cours de calcul pour les 44 astres');
  });

  it("l'échec de chargement passe avant tout le reste", () => {
    const t = skyNoticeTitle({ ...base, odFailed: true, velibOutOfZone: OUT });
    expect(t).toContain('a échoué');
    expect(t).not.toContain('Vélib');
  });

  it('hors 44 astres : commune non publiée, puis réglage de marche, puis scénario', () => {
    expect(skyNoticeTitle({ ...base, astres44: false, accessMissing: true })).toContain('n\'est pas encore publié');
    expect(skyNoticeTitle({ ...base, astres44: false, walkMissing: true })).toContain('réglage de marche');
    expect(skyNoticeTitle({ ...base, astres44: false })).toContain('journée-type ou mode');
  });
});
