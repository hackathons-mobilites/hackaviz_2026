import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, sanitizeScenario } from '../state/scenario';
import { parseScenario, serializeScenario } from '../state/url';
import type { Meta } from './types';
import {
  activeWalkSetting,
  sanitizeWalk,
  splitFirstSentence,
  walkAppliesTo,
  walkClause,
  walkSeriesKey,
  walkSettingPhrase,
  walkShortText,
} from './walkSettings';

const nb = (s: string) => s.replace(/\u00a0/g, ' ');

// Fixture au format de meta.walk_settings (valeurs de test : les vraies sont publiées par 06)
const meta = {
  walk_settings: {
    nature: 'choix de test',
    default: 'a',
    mode: 'transit',
    settings: [
      { id: 'a', label: 'a : jusqu’à 4 km à pied', leg_limit_m: 4000, max_time_walking_min: 60, key: null },
      { id: 'b', label: 'b : pas plus de 500 m à pied', leg_limit_m: 500, max_time_walking_min: 8, key: 'bk' },
    ],
  },
} as unknown as Pick<Meta, 'walk_settings'>;

describe('réglages de marche D-024 : lecture de meta.walk_settings', () => {
  it('TC seulement ; défaut sans clé (modes), autre réglage par sa clé (variants)', () => {
    expect(walkAppliesTo(meta, 'transit')).toBe(true);
    expect(walkAppliesTo(meta, 'bike_transit')).toBe(false);
    expect(activeWalkSetting(meta, 'transit', null)?.id).toBe('a');
    expect(activeWalkSetting(meta, 'transit', 'b')?.id).toBe('b');
    expect(activeWalkSetting(meta, 'car', 'b')).toBeNull();
    expect(walkSeriesKey(meta, 'transit', null)).toBeNull();
    expect(walkSeriesKey(meta, 'transit', 'b')).toBe('bk');
    expect(walkSeriesKey(meta, 'velib', 'b')).toBeNull();
  });
  it('identifiant inconnu ou égal au défaut : null (défaut) ; rien de publié : rien', () => {
    expect(sanitizeWalk('b', meta)).toBe('b');
    expect(sanitizeWalk('a', meta)).toBeNull();
    expect(sanitizeWalk('zzz', meta)).toBeNull();
    expect(sanitizeWalk('b', {})).toBeNull();
    expect(activeWalkSetting({}, 'transit', 'b')).toBeNull();
  });
  it('textes : distance publiée citée, libellé publié tel quel', () => {
    expect(nb(walkClause(4000))).toBe('avec au plus 4 km à pied à chaque bout');
    expect(walkClause(null)).toBe('');
    expect(nb(walkShortText({ leg_limit_m: 500 }))).toBe('≤ 500 m à pied');
    expect(walkSettingPhrase({ label: 'b : pas plus de 500 m à pied' })).toBe('réglage de marche b : pas plus de 500 m à pied');
  });
});

describe('réglage de marche : URL (w=) et scénario', () => {
  const full = {
    ...meta,
    day_types: [{ id: 'd14', label: '14h-22h', start: '14:00', end: '22:00' }],
    budgets: [60],
    modes: [{ id: 'transit', label: 'TC' }],
  } as unknown as Meta;
  it('w lu et écrit hors défaut seulement', () => {
    expect(parseScenario('?o=78396&w=b').walk).toBe('b');
    expect(serializeScenario({ ...DEFAULT_SCENARIO, origin: '78396', walk: 'b' })).toContain('w=b');
    expect(serializeScenario({ ...DEFAULT_SCENARIO, origin: '78396' })).not.toContain('w=');
    const known = new Set(['78396']);
    const poles = new Set<string>();
    expect(sanitizeScenario(parseScenario('?o=78396&d=d14&b=60&w=b'), full, known, poles).walk).toBe('b');
    expect(sanitizeScenario(parseScenario('?o=78396&d=d14&b=60&w=a'), full, known, poles).walk).toBeNull();
    expect(sanitizeScenario(parseScenario('?o=78396&d=d14&b=60&w=zzz'), full, known, poles).walk).toBeNull();
  });
});

describe('avertissement Vélib’ : première phrase en gras, texte inchangé', () => {
  it('coupe après le premier point suivi d’une espace', () => {
    expect(splitFirstSentence('Un : deux. Trois. Quatre.')).toEqual(['Un : deux.', 'Trois. Quatre.']);
    expect(splitFirstSentence('Sans point')).toEqual(['Sans point', '']);
  });
});
