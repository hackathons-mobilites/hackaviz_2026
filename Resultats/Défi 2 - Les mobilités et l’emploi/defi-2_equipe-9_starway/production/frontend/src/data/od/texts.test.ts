import { describe, expect, it } from 'vitest';
import { proofVerdict } from '../proof';
import type { OdDestState } from './compute';
import type { OdLeg } from './swod';
import { calcMethodText, nightNetworkMethodText, nightReturnMethodText, returnHintText, nightReturnNote, odLegText, odReasonText, odScenarioStatusText, odVerdict, odWalkLimitNote, poleShareText, selfJobsText, type OdTextContext } from './texts';

const ctx: OdTextContext = { maxTripMin: 120, timeDependent: true, partial: true };
const leg = (minutes: number | null, reason: OdLeg['reason'] = minutes == null ? 'no_trip_within_120' : null, dep?: number): OdLeg => ({
  minutes,
  reason,
  ...(dep !== undefined ? { dep } : {}),
});
const dest = (status: OdDestState['status'], out: OdLeg, ret: OdLeg, jobs = 1000) => ({ status, out, ret, jobs });
/** Ni tiret cadratin ni tiret demi-cadratin, jamais (CLAUDE.md, règle 8). */
const NO_LONG_DASH = /[\u2013\u2014]/;

describe('odLegText', () => {
  it('heures dérivées : départ retenu (aller) ou fin du poste (retour), plus la durée', () => {
    expect(odLegText(leg(32, null, 505), 'out', ctx)).toBe('aller 32 min (départ 8h25, arrivée 8h57)');
    expect(odLegText(leg(32), 'ret', ctx, 1020)).toBe('retour 32 min, attente comprise (fin du poste à 17h, arrivée 17h32)');
    // 4.6 : le retour est compté depuis la fin du poste, attente comprise ; jamais « départ 17h »
    expect(odLegText(leg(65), 'ret', ctx, 1020)).toBe('retour 65 min, attente comprise (fin du poste à 17h, arrivée 18h05)');
    expect(odLegText(leg(65), 'ret', ctx, 1020)).not.toMatch(/départ/);
    expect(odLegText(leg(65), 'ret', ctx)).toBe('retour 65 min, attente comprise');
    expect(odLegText(leg(22), 'ret', { ...ctx, timeDependent: false }, 1020)).toBe('retour 22 min');
    // panneau en journée-type : même mot, jamais « départ »
    expect(returnHintText('17h', 1085)).toBe('attente comprise (fin du poste à 17h, arrivée 18h05)');
    expect(returnHintText('17h', null)).toBe('attente comprise, depuis la fin du poste à 17h');
    expect(odLegText(leg(22), 'out', { ...ctx, timeDependent: false })).toBe('aller 22 min');
  });

  it('mêmes textes que access pour « aucun trajet », sens par sens', () => {
    expect(odLegText(leg(null), 'out', ctx)).toBe('aller : aucun départ dans les 2\u00a0h avant le début du poste n’arrive à l’heure');
    expect(odLegText(leg(null), 'ret', ctx)).toBe('retour : aucune arrivée trouvée dans les 2\u00a0h après la fin du poste');
    expect(odLegText(leg(null), 'ret', { ...ctx, timeDependent: false })).toBe('retour : aucun trajet trouvé en 2\u00a0h ou moins');
  });

  it('retour non calculé (export partiel) et point non raccordé (départ ou arrivée)', () => {
    expect(odLegText(leg(null, 'not_computed'), 'ret', ctx)).toBe('retour non calculé (jeu de données partiel)');
    expect(odLegText(leg(null, 'not_computed'), 'ret', { ...ctx, partial: false })).toBe('retour non calculé');
    expect(odReasonText('origin_not_snapped', 'out', ctx)).toBe('point de départ ou d’arrivée non raccordé au réseau');
  });
});

describe('odVerdict', () => {
  it('cas mesurés : exactement le verdict d’access (proofVerdict)', () => {
    const cases = [
      dest('accessible', leg(30, null, 510), leg(25)),
      dest('out_only', leg(30, null, 510), leg(50)),
      dest('out_only', leg(30, null, 510), leg(null)),
      dest('none', leg(50, null, 400), leg(25)),
      dest('none', leg(null), leg(null)),
    ];
    for (const d of cases) {
      const reason = d.out.minutes == null ? d.out.reason : d.ret.reason;
      const ref = proofVerdict({ status: d.status as 'accessible' | 'out_only' | 'none', out: d.out.minutes, ret: d.ret.minutes, reason }, 45, 120, true);
      expect(odVerdict(d, 45, ctx)).toEqual({ kind: ref.kind, title: ref.title, detail: ref.detail });
    }
  });

  it('retour non calculé : jamais « aucun retour »', () => {
    const v = odVerdict(dest('unknown', leg(40, null, 500), leg(null, 'not_computed')), 45, ctx);
    expect(v).toEqual({
      kind: 'unknown',
      title: 'Retour non calculé',
      detail: 'Aller 40 min, en 45 min ou moins ; retour non calculé (jeu de données partiel).',
    });
    const blocked = odVerdict(dest('none', leg(null), leg(null, 'not_computed')), 45, ctx);
    expect(blocked.title).toBe('Aucun trajet trouvé à l’aller');
    expect(blocked.detail).toBe(
      'Aller : aucun départ dans les 2\u00a0h avant le début du poste n’arrive à l’heure ; retour non calculé (jeu de données partiel), avec 45 min au plus par sens.',
    );
    for (const x of [v, blocked]) expect(`${x.title} ${x.detail}`).not.toMatch(/aucun retour|aucune arrivée/i);
  });

  it('commune d’origine : postes à part, trajet non mesuré', () => {
    expect(odVerdict(dest('self', leg(null, null), leg(null, null), 88594), 45, ctx)).toEqual({
      kind: 'self',
      title: 'Votre commune',
      detail: 'Votre commune : 88\u00a0594 postes, trajet non mesuré.',
    });
    expect(selfJobsText(12)).toBe('votre commune : 12 postes, trajet non mesuré');
  });
});

describe('phrases générales', () => {
  it('limite de marche : distance lue dans l’index, TC seulement, jamais si appliquée', () => {
    const note = odWalkLimitNote({ walk_limit: { status: 'not_applied', limit_m: 1500 } }, true);
    expect(note).toContain('1,5\u00a0km');
    expect(odWalkLimitNote({ walk_limit: { status: 'not_applied', limit_m: 2000 } }, false)).toBeNull();
    expect(odWalkLimitNote({ walk_limit: { status: 'applied', limit_m: 2000 } }, true)).toBeNull();
    expect(odWalkLimitNote({}, true)).toBeNull();
  });

  it('part d’un astre en texte (aria-label) : la commune de départ n’est pas dans le dénominateur', () => {
    // exemple fictif : 835 130 postes dans l'astre, dont 88 594 dans la commune de départ, donc 746 536 mesurables
    expect(poleShareText('Paris QCA', { reached: 412000, measurable: 746536, share: 412000 / 746536, self: 88594, unknown: 0 })).toBe(
      'Paris QCA : 412\u00a0000 postes atteints aller et retour sur 746\u00a0536 (55,2\u00a0%) ; votre commune : 88\u00a0594 postes, trajet non mesuré',
    );
  });

  it('poste de nuit : le retour du matin vient des horaires du même mardi type (panneau, mode sources)', () => {
    const note = nightReturnNote(1320, 360, 'mardi');
    expect(note).toContain('l’aller arrive avant 22h');
    expect(note).toContain('le retour est compté à partir de la fin du poste, à 6h le lendemain matin');
    expect(note).toContain('horaires du même mardi type, pas dans ceux du lendemain');
    expect(note).toContain('détail du trajet n’est pas affiché en horaires libres');
    expect(nightReturnNote(1260, 330, null)).toContain('du même jour type');
    expect(nightReturnMethodText('mardi', '17/11/2026')).toBe(
      'Méthode : le retour du matin d’un poste de nuit est lu dans les horaires du même mardi type (GTFS IDFM, 17/11/2026), pas dans ceux du lendemain.',
    );
    expect(nightReturnMethodText(null, null)).not.toContain('GTFS');
  });

  it('réseau de nuit (D-040) : plages lues dans les données, jour et date de service, aucun code ni durée', () => {
    const segments = [
      { name: 'matin', from: '00:00', to: '06:55' },
      { name: 'jour', from: '07:00', to: '22:00' },
      { name: 'soir', from: '22:05', to: '23:55' },
    ];
    const t = nightNetworkMethodText(segments, 'mardi', '17/11/2026')!;
    expect(t).toContain('de 0h à 6h55, les trajets sont calculés sur les horaires IDFM complétés des courses de la veille codées 24:00 et plus');
    expect(t).toContain('de 22h05 à 23h55, sur les horaires IDFM complétés des courses du lendemain parties avant 3h');
    expect(t).toContain('le matin et le soir viennent du même mardi type (GTFS IDFM, 17/11/2026), le soir avec les courses du lendemain après minuit');
    expect(t).not.toMatch(/TRA01|[\u2013\u2014]|\d\s?%/);
    expect(nightNetworkMethodText(segments, null, null)).toContain('même jour type, le soir');
    expect(nightNetworkMethodText([segments[2]!], 'mardi', null)).toBe(
      'Méthode : de 22h05 à 23h55, les trajets sont calculés sur les horaires IDFM complétés des courses du lendemain parties avant 3h (ces courses sont absentes sinon du calcul).',
    ); // le soir seul : pas de phrase sur le même mardi type
    expect(nightNetworkMethodText([segments[0]!], 'mardi', null)).toContain('courses de la veille codées 24:00 et plus');
    expect(nightNetworkMethodText(undefined, 'mardi', null)).toBeNull(); // ancien export
    expect(nightNetworkMethodText([segments[1]!], 'mardi', null)).toBeNull(); // pas de plage de nuit
  });

  it('méthode des postes atteints (4.7) : aller, retour attente comprise, commune entière, Part = Atteints / Postes', () => {
    const t = calcMethodText(true);
    expect(t).toContain('départ le plus tardif qui arrive avant le début du poste');
    expect(t).toContain('compté à partir de la fin du poste, attente comprise');
    expect(t).toContain('comptée en entier');
    expect(t).toContain('Part = Atteints / Postes');
    expect(t).toContain('hors du total');
    expect(t).not.toMatch(/départ (à|après) /);
    expect(calcMethodText(false)).toContain('indépendantes de l’heure');
    expect(calcMethodText(false)).not.toContain('départ le plus tardif');
    expect(t).not.toMatch(NO_LONG_DASH);
  });

  it('aucun tiret long dans les textes produits', () => {
    const all = [
      odWalkLimitNote({ walk_limit: { status: 'not_applied', limit_m: 2000 } }, true)!,
      nightReturnNote(1320, 360, 'mardi'),
      nightReturnMethodText('mardi', '17/11/2026'),
      ...(['ok', 'origin_not_computed', 'mode_not_in_od', 'mode_not_computed', 'invalid_shift'] as const).map((s) => odScenarioStatusText(s) ?? ''),
      odVerdict(dest('unknown', leg(40, null, 500), leg(null, 'not_computed')), 45, ctx).detail,
      odLegText(leg(null, 'origin_not_snapped'), 'out', ctx),
    ];
    for (const t of all) expect(t).not.toMatch(NO_LONG_DASH);
  });
});
