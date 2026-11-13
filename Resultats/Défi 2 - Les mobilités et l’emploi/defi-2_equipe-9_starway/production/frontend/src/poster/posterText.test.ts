import { describe, expect, it } from 'vitest';
import type { Dataset, Pole } from '../data/types';
import { DEFAULT_SCENARIO } from '../state/scenario';
import { buildPosterText, frenchDate, frenchDayDate, posterFileName, posterModeNote, posterPlainText, posterSources } from './posterText';

const poles = [
  { id: 'A', jobs: 300, jobs_year: 2023, jobs_source: 'EMP01' },
  { id: 'B', jobs: 100, jobs_year: 2023, jobs_source: 'EMP01' },
] as Pole[];

const dataset = {
  origin: 'real',
  meta: {
    processing_version: '0.1.0',
    service_date: '2026-11-17',
    day_types: [{ id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' }],
    modes: [{ id: 'transit', label: 'Transports en commun + marche' }],
  },
  poles,
  sources: [{ source_id: 'EMP01' }, { source_id: 'TRA01' }, { source_id: 'GEO01' }],
} as unknown as Dataset;

describe('affiche : textes issus des données', () => {
  it('date et nom de fichier', () => {
    expect(frenchDate('2026-11-17')).toBe('17 novembre 2026');
    expect(frenchDayDate('2026-11-17')).toBe('mardi 17 novembre 2026');
    expect(posterFileName({ ...DEFAULT_SCENARIO, origin: '93048', budget: 60 })).toBe('starway-93048-d09-60-transit.png');
    expect(posterFileName({ ...DEFAULT_SCENARIO, origin: '93048', compare: '77284' }, true)).toBe('starway-93048-d09-45-transit-vs-77284-hd.png');
  });

  it('sources : seulement celles présentes dans sources.json', () => {
    expect(posterSources(dataset, poles)).toBe('INSEE Flores 2023 · IDFM GTFS, offre du 17 novembre 2026 · API Géo');
    expect(posterSources({ ...dataset, origin: 'demo' }, poles)).toBe('Données fictives de démonstration');
  });

  it('GEO02 cité seulement si le point de départ publié en vient', () => {
    const withGeo02 = {
      ...dataset,
      sources: [
        ...dataset.sources,
        { source_id: 'GEO02', titre: 'INSEE Filosofi 2021 - données au carreau de 200 m (y compris données imputées), csv', millesime: 'revenus 2021' },
      ],
    } as unknown as Dataset;
    const placed = { origin: { lon: 2.44, lat: 48.86, method: 'gravity' } };
    expect(posterSources(withGeo02, poles, [placed])).toBe(
      'INSEE Flores 2023 · IDFM GTFS, offre du 17 novembre 2026 · API Géo · INSEE Filosofi 2021, carreaux de 200 m',
    );
    expect(posterSources(withGeo02, poles, [{ origin: null }])).not.toContain('Filosofi');
    expect(posterSources(dataset, poles, [placed])).not.toContain('Filosofi');
  });

  it('chiffres = totaux du ciel affiché', () => {
    const t = buildPosterText({
      dataset,
      scenario: { ...DEFAULT_SCENARIO, origin: '93048', budget: 60 },
      originName: 'Montreuil',
      totals: { poleCount: 2, accessibleCount: 1, jobs: 300, totalJobs: 400, hasData: true },
      demo: false,
      url: 'https://exemple/?o=93048',
      now: new Date(2026, 10, 13),
    });
    expect(t.title).toBe('Depuis Montreuil');
    expect(t.timeHeadline).toBe('60 min par sens');
    expect(t.subtitle).toBe(
      'Temps de trajet aller et retour, chacun 60 min ou moins · journée-type 9h-17h (scénario) · transports en commun + marche',
    );
    expect(t.sentence).toContain('en 60 min ou moins dans chaque sens');
    expect(t.legendOn).toBe('Accessible aller et retour (en 60 min ou moins par sens)');
    expect(t.cards.map((c) => c.value)).toEqual(['300', '1 sur 2', '75\u00a0%']);
    expect(t.cards[0]!.accent).toBe(true);
    expect(t.mentions).toContain('13 novembre 2026');
    const txt = posterPlainText(t);
    expect(txt).toContain('https://exemple/?o=93048');
    expect(txt).toContain('Temps de trajet : 60 min par sens');
    expect(txt).not.toMatch(/[\u2013\u2014]/);
  });

  it('table OD (D-019) : horaires du ciel, postes et communes atteints sur l’Île-de-France, jamais « pôles accessibles »', () => {
    const t = buildPosterText({
      dataset,
      scenario: { ...DEFAULT_SCENARIO, origin: '93048', budget: 45, shift: { start: 480, end: 960 } },
      originName: 'Montreuil',
      totals: {
        poleCount: 2,
        accessibleCount: 1,
        jobs: 300,
        totalJobs: 400,
        hasData: true,
        od: { reachedAll: 500, allJobs: 1000, measurableJobs: 990, selfJobs: 10, unknownJobs: 0, reachedCommunes: 7, communes: 19 },
      },
      demo: false,
      url: 'https://exemple/?o=93048&s=0800&e=1600',
      now: new Date(2026, 10, 13),
      shiftLabel: '8h-16h',
    });
    expect(t.subtitle).toContain('horaires 8h-16h (scénario)');
    // Part = Atteints / Postes, commune de départ hors du dénominateur : 500 sur 990, jamais sur 1 000
    expect(t.cards.map((c) => c.value)).toEqual(['500', '7 sur 19', '50,5\u00a0%']);
    expect(t.cards[2]!.caption).toBe('des postes d’Île-de-France hors commune de départ');
    // la commune de départ est dite à part, hors du total et du pourcentage
    expect(t.areaCaption).toContain('Votre commune : 10 postes, trajet non mesuré, hors du total et du pourcentage.');
    expect(t.legendOn).toContain('Cœur cyan');
    expect(posterPlainText(t)).not.toMatch(/pôles d’emploi accessibles/);
  });

  it("postes inconnus : jamais de 0 de substitution", () => {
    const t = buildPosterText({
      dataset,
      scenario: { ...DEFAULT_SCENARIO, origin: '93048' },
      originName: 'Montreuil',
      totals: { poleCount: 2, accessibleCount: 1, jobs: null, totalJobs: null, hasData: true },
      demo: true,
      url: 'u',
      now: new Date(2026, 10, 13),
    });
    expect(t.cards[0]!.value).toBe('non disponible');
    expect(t.cards[2]!.value).toBe('non disponible');
    expect(posterPlainText(t).startsWith('DONNÉES FICTIVES')).toBe(true);
  });
  it('diptyque : titre « A et B », chiffres en A / B', () => {
    const t = buildPosterText({
      dataset,
      scenario: { ...DEFAULT_SCENARIO, origin: '93048', compare: '77284', budget: 60 },
      originName: 'Montreuil',
      totals: { poleCount: 2, accessibleCount: 1, jobs: 300, totalJobs: 400, hasData: true },
      demo: false,
      url: 'u',
      now: new Date(2026, 10, 13),
      compare: { originName: 'Meaux', totals: { poleCount: 2, accessibleCount: 0, jobs: 0, totalJobs: 400, hasData: true } },
    });
    expect(t.title).toBe('Depuis Montreuil et Meaux');
    expect(t.cards.map((c) => c.value)).toEqual(['300 / 0', '1 / 0 sur 2', '75\u00a0% / 0\u00a0%']);
    expect(t.fileName).toBe('starway-93048-d09-60-transit-vs-77284.png');
  });
});

describe('affiche : note du mode', () => {
  // Fixture au format de meta.json (les vrais textes sont publiés par 06)
  const meta = {
    walk_settings: {
      nature: 'choix de test',
      default: 'a',
      mode: 'transit',
      settings: [
        { id: 'a', label: 'a : jusqu’à 4 km à pied', leg_limit_m: 4000, max_time_walking_min: 60, key: null },
        { id: 'b', label: 'b : pas plus de 500 m à pied', leg_limit_m: 500, max_time_walking_min: 8, key: 'b' },
      ],
    },
    velib: { warning: 'Avertissement de test. Suite.', out_of_zone: 'Hors zone de test' },
  } as unknown as Parameters<typeof posterModeNote>[0];
  it("TC : réglage en vigueur et sa nature ; Vélib' : avertissement tel quel ; autres modes : rien", () => {
    expect(posterModeNote(meta, { mode: 'transit', walk: null })).toBe('Réglage de marche a : jusqu’à 4 km à pied à chaque bout, choix de test.');
    expect(posterModeNote(meta, { mode: 'transit', walk: 'b' })).toBe('Réglage de marche b : pas plus de 500 m à pied à chaque bout, choix de test.');
    expect(posterModeNote({ ...meta, walk_settings: { ...meta.walk_settings!, nature: 'choix de test (D-024), pas une donnée' } }, { mode: 'transit', walk: null })).toBe(
      'Réglage de marche a : jusqu’à 4 km à pied à chaque bout, choix de test, pas une donnée.',
    );
    expect(posterModeNote(meta, { mode: 'velib', walk: 'b' })).toBe('Avertissement de test. Suite.');
    expect(posterModeNote(meta, { mode: 'car', walk: 'b' })).toBeNull();
  });
  it('nom de fichier distinct hors réglage par défaut, en TC seulement', () => {
    const base = { origin: '78396', day: 'd14' as const, budget: 60, compare: null };
    expect(posterFileName({ ...base, mode: 'transit', walk: 'comfort' })).toBe('starway-78396-d14-60-transit-comfort.png');
    expect(posterFileName({ ...base, mode: 'car', walk: 'comfort' })).toBe('starway-78396-d14-60-car.png');
  });
});
