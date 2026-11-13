import { describe, expect, it } from 'vitest';
import { normalize, buildIndex, searchCommunes } from '../data/search';
import { stepDuration } from '../tour/timing';
import type { Meta } from '../data/types';
import { freeShiftState, timeModesReady } from './freeShift';
import { DEFAULT_SCENARIO, sanitizeShift } from './scenario';
import { formatHhmm, hasScenarioParams, parseHhmm, parseScenario, parseView, serializeScenario, serializeView } from './url';

describe('URL : vue carte (v=map)', () => {
  it('lecture, écriture, et conservée par la sérialisation du scénario', () => {
    expect(parseView('?o=75118&v=map')).toBe('map');
    expect(parseView('?v=autre')).toBe('sky');
    expect(serializeView('map', '?o=75118')).toBe('?o=75118&v=map');
    expect(serializeView('sky', '?o=75118&v=map')).toBe('?o=75118');
    const q = serializeScenario({ ...DEFAULT_SCENARIO, origin: '75118' }, '?v=map');
    expect(parseView(q)).toBe('map');
  });
});

describe('URL ↔ scénario', () => {
  it('aller-retour', () => {
    const s = { ...DEFAULT_SCENARIO, origin: '93066', day: 'd06' as const, budget: 60, mode: 'bike_transit' as const, compare: '77186', pole: 'P_DEFENSE' };
    const q = serializeScenario(s, '?demo=1');
    expect(q).toContain('demo=1');
    expect(parseScenario(q)).toEqual(s);
  });
  it('ignore les valeurs invalides', () => {
    const s = parseScenario('?o=abc&d=d07&b=-3&m=plane');
    expect(s).toEqual(DEFAULT_SCENARIO);
  });
  it('budget : tout entier positif est lu, sans borne en dur (la grille de meta.json est appliquée par sanitizeScenario)', () => {
    expect(parseScenario('?b=35').budget).toBe(35);
    expect(parseScenario('?b=37').budget).toBe(37);
    expect(parseScenario('?b=120').budget).toBe(120);
    expect(parseScenario('?b=0').budget).toBe(DEFAULT_SCENARIO.budget);
    expect(parseScenario('?b=181').budget).toBe(181);
    expect(parseScenario('?b=42.5').budget).toBe(DEFAULT_SCENARIO.budget);
    expect(parseScenario('?b=abc').budget).toBe(DEFAULT_SCENARIO.budget);
    expect(serializeScenario({ ...DEFAULT_SCENARIO, budget: 35 })).toContain('b=35');
  });
  it('détecte un lien partagé', () => {
    expect(hasScenarioParams('?o=93066')).toBe(true);
    expect(hasScenarioParams('?demo=1')).toBe(false);
  });
});

describe('recherche de commune', () => {
  const idx = buildIndex([
    { insee: '93066', name: 'Saint-Denis', dep: '93', lon: 0, lat: 0, population: null, sky: { x: 0, y: 0 } },
    { insee: '91228', name: 'Évry-Courcouronnes', dep: '91', lon: 0, lat: 0, population: null, sky: { x: 0, y: 0 } },
  ]);
  it('tolère accents, tirets et « st »', () => {
    expect(normalize('Évry-Courcouronnes')).toBe('evry courcouronnes');
    expect(searchCommunes(idx, 'evry')[0]?.insee).toBe('91228');
    expect(searchCommunes(idx, 'st denis')[0]?.insee).toBe('93066');
    expect(searchCommunes(idx, '93066')[0]?.insee).toBe('93066');
  });
});

describe('durée d’une étape de visite', () => {
  it('≈ 14 caractères/s, bornée par minDurationMs', () => {
    expect(stepDuration('x'.repeat(140))).toBe(10000 + 900);
    expect(stepDuration('court', 6000)).toBe(6000 + 900);
  });
});

describe('halo : anciens liens (D-026)', () => {
  it('h=sex (onglet retiré) est ramené à l’âge', () => {
    expect(parseScenario('?o=93048&h=sex').halo).toBe('age');
    expect(parseScenario('?o=93048&h=commute').halo).toBe('commute');
  });
  it("h=unemployment (onglet « Chômage », D-048) est lu et écrit ; une valeur inconnue est ignorée", () => {
    const s = parseScenario('?o=93048&h=unemployment');
    expect(s.halo).toBe('unemployment');
    expect(serializeScenario(s)).toContain('h=unemployment');
    expect(parseScenario('?o=93048&h=chomage').halo).toBeNull();
  });
});

describe('URL : horaires libres (D-019, s / e)', () => {
  const meta = {
    day_types: [
      { id: 'd06', label: '6h-14h', start: '06:00', end: '14:00' },
      { id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' },
      { id: 'd14', label: '14h-22h', start: '14:00', end: '22:00' },
    ],
  } as unknown as Meta;

  it('s=0800&e=1600 : lu, réécrit en HHMM, sans d (la journée-type n’est plus celle du ciel)', () => {
    const s = parseScenario('?o=75101&s=0800&e=1600&b=45&m=transit');
    expect(s.shift).toEqual({ start: 480, end: 960 });
    const q = serializeScenario({ ...s, origin: '75101' });
    expect(q).toContain('s=0800');
    expect(q).toContain('e=1600');
    expect(q).not.toContain('d=');
    expect(parseScenario(q).shift).toEqual({ start: 480, end: 960 });
    expect(hasScenarioParams('?s=0800&e=1600')).toBe(true);
  });

  it('une journée-type reste d= : un horaire égal à une journée-type y est ramené', () => {
    const s = sanitizeShift({ start: 540, end: 1020 }, meta);
    expect(s).toEqual({ shift: null, day: 'd09' });
    const q = serializeScenario({ ...DEFAULT_SCENARIO, origin: '75101', day: 'd09', shift: null });
    expect(q).toContain('d=d09');
    expect(q).not.toMatch(/[?&]s=/);
  });

  it('valeurs illisibles, un seul des deux, ou fin avant le début hors poste de nuit : ignorés', () => {
    expect(parseScenario('?s=0800').shift).toBeNull();
    expect(parseScenario('?s=2500&e=2600').shift).toBeNull();
    expect(parseScenario('?s=1600&e=0800').shift).toBeNull();
    expect(parseHhmm('08:30')).toBe(510);
    expect(parseHhmm('8h30')).toBeNull();
    expect(formatHhmm(510)).toBe('0830');
    expect(sanitizeShift({ start: 900, end: 800 }, meta)).toEqual({ shift: null, day: null });
  });

  it('poste de nuit : s=2200&e=0600 est lu, réécrit tel quel et partageable (fin le lendemain matin)', () => {
    const s = parseScenario('?o=75101&s=2200&e=0600&b=45&m=transit');
    expect(s.shift).toEqual({ start: 1320, end: 360 });
    const q = serializeScenario({ ...s, origin: '75101' });
    expect(q).toContain('s=2200');
    expect(q).toContain('e=0600');
    expect(q).not.toContain('d=');
    expect(parseScenario(q).shift).toEqual({ start: 1320, end: 360 });
    expect(sanitizeShift({ start: 1320, end: 360 }, meta)).toEqual({ shift: { start: 1320, end: 360 }, day: null });
    // 21h-5h30
    const t = parseScenario('?o=75101&s=2100&e=0530');
    expect(t.shift).toEqual({ start: 1260, end: 330 });
    expect(serializeScenario(t)).toContain('e=0530');
  });

  it('D-040 : poste qui commence jusqu’à 23h55 ou finit à minuit, partageable dans l’URL', () => {
    for (const [q, shift] of [
      ['?o=75101&s=2355&e=0000', { start: 1435, end: 0 }], // 23h55-0h
      ['?o=75101&s=2130&e=0000', { start: 1290, end: 0 }], // 21h30-0h
      ['?o=75101&s=2300&e=0700', { start: 1380, end: 420 }], // 23h-7h
    ] as const) {
      const s = parseScenario(q);
      expect(s.shift).toEqual(shift);
      expect(parseScenario(serializeScenario({ ...s, origin: '75101' })).shift).toEqual(shift);
      expect(sanitizeShift(shift, meta)).toEqual({ shift, day: null });
    }
    // poste du jour : fin après 22h et début avant 5h
    expect(parseScenario('?s=1400&e=2330').shift).toEqual({ start: 840, end: 1410 });
    expect(parseScenario('?s=0300&e=1100').shift).toEqual({ start: 180, end: 660 });
    // un début à 18h avec fin à 2h n'est pas un poste de nuit au sens légal : ignoré
    expect(parseScenario('?s=1800&e=0200').shift).toBeNull();
  });

  it('poste de nuit : les fins avant le début qui n’en sont pas sont ignorées (retour à la journée-type)', () => {
    // fin après 7h, début avant 21h, E = S, un seul des deux
    expect(parseScenario('?s=2200&e=0800').shift).toBeNull();
    expect(parseScenario('?s=2000&e=0600').shift).toBeNull();
    expect(parseScenario('?s=1700&e=0900').shift).toBeNull();
    expect(parseScenario('?s=2200&e=2200').shift).toBeNull();
    expect(parseScenario('?s=2200').shift).toBeNull();
    expect(sanitizeShift({ start: 1320, end: 480 }, meta)).toEqual({ shift: null, day: null });
    expect(sanitizeShift({ start: 1200, end: 360 }, meta)).toEqual({ shift: null, day: null });
    // lien partagé avec une valeur invalide : le scénario garde sa journée-type (9h-17h par défaut)
    const bad = parseScenario('?o=75101&s=2200&e=0800');
    expect(bad.shift).toBeNull();
    expect(bad.day).toBe(DEFAULT_SCENARIO.day);
  });
});

describe('horaires libres : disponibles selon la couverture publiée par mode', () => {
  const index = {
    modes: [{ id: 'transit' as const, code: 0, kind: 'series' as const }],
    coverage: { transit: { origins: 1285, complete: true }, walk: { origins: 0, complete: false } },
  };
  it('TC : oui ; vélo + TC : phrase claire, rien en dur', () => {
    expect(freeShiftState({ off: null, index, hasBounds: true, mode: 'transit' })).toEqual({ enabled: true, note: null });
    expect(freeShiftState({ off: 'mode', index, hasBounds: true, mode: 'bike_transit' }).note).toBe(
      "horaires libres : transports en commun seulement pour l'instant",
    );
    expect(timeModesReady(index)).toEqual(['transit']);
  });
  it('marche exportée plus tard (scalaire, complète) : table OD, mais l’horaire ne change rien', () => {
    const later = {
      modes: [...index.modes, { id: 'walk' as const, code: 1, kind: 'scalar' as const }],
      coverage: { ...index.coverage, walk: { origins: 1285, complete: true } },
    };
    const st = freeShiftState({ off: null, index: later, hasBounds: true, mode: 'walk' });
    expect(st.enabled).toBe(false);
    expect(st.note).toContain('même temps à toute heure');
  });
  it('visite ou découverte : réglable (le verrou se lève au premier changement), avec la phrase', () => {
    expect(freeShiftState({ off: 'lock', index, hasBounds: true, mode: 'transit' }).enabled).toBe(true);
    expect(freeShiftState({ off: 'folder_absent', index: null, hasBounds: false, mode: 'transit' }).enabled).toBe(false);
  });
});
