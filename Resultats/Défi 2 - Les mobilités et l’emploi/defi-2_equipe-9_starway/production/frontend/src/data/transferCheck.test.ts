import { describe, expect, it } from 'vitest';
import type { ItinTrip } from './itineraries';
import {
  boundText,
  minimumSourceText,
  secondsText,
  shortTransferText,
  sideRisks,
  statusText,
  transferCheckMeta,
  transferCheckOf,
  transferSourceCodes,
  verdictAtRisk,
  type TransferCheck,
  type TransferCheckMeta,
} from './transferCheck';

/** Espaces insécables → espaces simples, pour lire les attendus */
const plain = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ');
const LONG_DASH = /[\u2013\u2014]/;

// Forme du contrat itineraries-2 (06t) ; valeurs du cas Versailles vers Maisons-Laffitte, 9h-17h, retour
const RET_SHORT: TransferCheck = {
  status: 'short',
  short: [{ at: 'La Défense', to: 'La Défense', available_s: 184, min_s: 300, source: 'navitia' }],
  bound_min: 63,
};
const OUT_OK: TransferCheck = { status: 'verified' };
const NO_BOUND: TransferCheck = {
  status: 'short',
  short: [{ at: 'Pyramides', to: 'Pyramides', available_s: 99, min_s: 300, source: 'gtfs' }],
  bound_min: null,
  bound_reason: 'no_run',
};

const trip = (tc: unknown): ItinTrip => ({ status: 'ok', legs: [], transfer_check: tc } as unknown as ItinTrip);

describe('correspondances D-031 (c) : lecture du contrat', () => {
  it('annonce meta.transfer_check : absente ou mal formée = rien', () => {
    expect(transferCheckMeta({})).toBeNull();
    expect(transferCheckMeta(null)).toBeNull();
    expect(transferCheckMeta({ transfer_check: { rule: 'osm', checked_at: 'x' } })).toBeNull();
    expect(transferCheckMeta({ transfer_check: { rule: 'reference', checked_at: '2026-11-04T09:17:16Z', sources: ['TRA01', 'TRA02'] } })?.rule).toBe(
      'reference',
    );
  });
  it('marque du trajet : statut connu, liste non vide pour short', () => {
    expect(transferCheckOf(trip(RET_SHORT))).toEqual(RET_SHORT);
    expect(transferCheckOf(trip({ status: 'short' }))).toBeNull();
    expect(transferCheckOf(trip({ status: 'maybe' }))).toBeNull();
    expect(transferCheckOf(trip(undefined))).toBeNull();
    expect(transferCheckOf(null)).toBeNull();
  });
});

describe('correspondances D-031 (c) : textes', () => {
  it('durées en minutes et secondes', () => {
    expect(plain(secondsText(90))).toBe('1 min 30');
    expect(plain(secondsText(300))).toBe('5 min');
    expect(plain(secondsText(184))).toBe('3 min 04');
    expect(plain(secondsText(45))).toBe('45 s');
  });
  it('une phrase par correspondance trop courte, avec sa source', () => {
    const t = shortTransferText(RET_SHORT.short![0]!, 'ret');
    expect(plain(t)).toBe("Retour : correspondance de 3 min 04 à La Défense : le calculateur d'IDFM en exige 5 min ; ce trajet peut être plus long.");
    const g = shortTransferText({ at: 'Auber', to: 'Haussmann Saint-Lazare', available_s: 94, min_s: 381, source: 'gtfs' }, 'out');
    expect(plain(g)).toBe(
      'Aller : correspondance de 1 min 34 entre Auber et Haussmann Saint-Lazare : le minimum publié par IDFM est de 6 min 21 ; ce trajet peut être plus long.',
    );
    expect(LONG_DASH.test(t + g)).toBe(false);
  });
  it('borne : au-delà du budget, dans le budget, sans budget, sans borne', () => {
    const [r] = sideRisks(OUT_OK, RET_SHORT, 60);
    expect(r).toEqual({ side: 'ret', bound: 63, reason: undefined, atRisk: true });
    expect(plain(boundText(r!, 60, 120))).toBe("En respectant les minimums d’IDFM par les mêmes lignes, le retour prendrait au plus 63 min, au-delà de 60 min.");
    expect(plain(boundText({ ...r!, atRisk: false }, 65, 120))).toContain('il reste dans les 65 min');
    expect(plain(boundText(r!, null, 120))).toBe("En respectant les minimums d’IDFM par les mêmes lignes, le retour prendrait au plus 63 min.");
    const [n] = sideRisks(NO_BOUND, null, 30);
    expect(plain(boundText(n!, 30, 120))).toBe('Aller : en respectant les minimums d’IDFM, aucune course des mêmes lignes n’arrive avant le début du poste.');
    expect(plain(boundText({ side: 'ret', bound: null, reason: 'over_max', atRisk: true }, 30, 120))).toContain('le même trajet dépasserait 120 min');
  });
  it('statuts sans correspondance trop courte', () => {
    expect(statusText(OUT_OK, 'out')).toBe('Correspondances (aller) : toutes respectent le minimum d’IDFM.');
    expect(statusText({ status: 'partly_unverified', unverified: 2 }, 'ret')).toContain('2 sans minimum connu');
    expect(statusText({ status: 'no_transfer' }, 'out')).toBeNull();
    expect(statusText(RET_SHORT, 'ret')).toBeNull();
  });
  it('source des minimums et date du contrôle', () => {
    const meta = { rule: 'reference' as const, checked_at: '2026-11-04T09:17:16Z', service_date: '2026-11-17', walk_setting: 'normal', sources: ['TRA01', 'TRA02'] };
    const s = minimumSourceText(meta, ['gtfs', 'navitia']);
    expect(s).toContain('transfers.txt');
    expect(s).toContain('Navitia');
    expect(s).toContain('contrôle du 04/11/2026');
    expect(minimumSourceText(meta, ['gtfs'])).not.toContain('Navitia');
  });
});

describe('correspondances D-031 (c) : verdict à vérifier (règle de 07h)', () => {
  it('allumé et borne au-delà du budget : à vérifier ; borne dans le budget : non', () => {
    expect(verdictAtRisk(true, OUT_OK, RET_SHORT, 60)).toBe(true);
    expect(verdictAtRisk(true, OUT_OK, RET_SHORT, 65)).toBe(false);
  });
  it('verdict éteint : jamais marqué (le ciel ne change pas)', () => {
    expect(verdictAtRisk(false, OUT_OK, RET_SHORT, 60)).toBe(false);
  });
  it('sans borne : à vérifier à tout budget de la jauge', () => {
    expect(verdictAtRisk(true, NO_BOUND, OUT_OK, 120)).toBe(true);
  });
  it('aucune marque (fichier non marqué, sens sans itinéraire) : rien', () => {
    expect(verdictAtRisk(true, null, null, 30)).toBe(false);
    expect(sideRisks(null, OUT_OK, 30)).toEqual([]);
  });
});

describe('transferSourceCodes : codes cités lus dans meta.transfer_check.sources', () => {
  const base: TransferCheckMeta = {
    rule: 'reference',
    checked_at: '2026-11-09T23:39:19Z',
    service_date: '2026-11-17',
    walk_setting: 'normal',
    sources: ['TRA01', 'TRA02B'],
  };
  it('navitia cite le code publié à côté de TRA01 (TRA02B), gtfs cite TRA01', () => {
    expect(transferSourceCodes(base, ['navitia'])).toEqual(['TRA02B']);
    expect(transferSourceCodes(base, ['gtfs', 'navitia'])).toEqual(['TRA01', 'TRA02B']);
    expect(transferSourceCodes(base, ['gtfs'])).toEqual(['TRA01']);
  });
  it("ne cite plus TRA02 (trajets « journeys », contrôle seulement)", () => {
    expect(transferSourceCodes(base, ['gtfs', 'navitia'])).not.toContain('TRA02');
  });
  it('aucune correspondance trop courte : la règle cite TRA01', () => {
    expect(transferSourceCodes(base, [])).toEqual(['TRA01']);
  });
  it('sources absentes ou réduites à TRA01 : navitia retombe sur TRA02B', () => {
    expect(transferSourceCodes({ ...base, sources: ['TRA01'] }, ['navitia'])).toEqual(['TRA02B']);
    expect(transferSourceCodes({ ...base, sources: undefined as unknown as string[] }, ['navitia'])).toEqual(['TRA02B']);
  });
});
