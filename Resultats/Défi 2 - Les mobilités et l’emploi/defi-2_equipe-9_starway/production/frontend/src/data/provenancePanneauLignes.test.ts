/**
 * Provenance des blocs du panneau de preuve « lignes utilisées, heure creuse, comparer les modes »
 * (règle de Nicolas du 04/11 : toute source affichée seulement quand le mode provenance est activé,
 * lue dans les JSON publiés, rien en dur). Fonctions pures de `provenance.ts` ; l'affichage conditionnel
 * est celui de `ProvenanceNote` (couvert par provenance.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { ItinLeg } from './itineraries';
import { alternativesPart, modesParts, offpeakPart, sourceTag, tripFactsPart } from './provenance';
import type { Dataset, Meta, SourceEntry, VehicleMeta } from './types';

const SOURCES: SourceEntry[] = [
  { source_id: 'TRA01', titre: "IDFM - Horaires prévus sur les lignes de TC d'Île-de-France (GTFS Datahub)", url_source: 'x', date_extraction: '2026-11-02T14:15Z', licence: 'ODbL', traitements: 'aucun (entrée directe de r5py)' },
  { source_id: 'CYC01', titre: 'OpenStreetMap - extrait Île-de-France (Geofabrik)', url_source: 'x', date_extraction: '2026-11-02T14:20Z', licence: 'ODbL', traitements: 'aucun (entrée directe de r5py)' },
  { source_id: 'TRA03', titre: "IDFM - Référentiel des lignes d'Île-de-France", url_source: 'x', date_extraction: '2026-11-03T10:00Z', licence: 'ODbL' },
  { source_id: 'QS01', titre: 'SNCF Voyageurs - Régularité mensuelle des lignes Transilien et RER', url_source: 'x', date_extraction: '2026-11-03T10:05Z', licence: 'ODbL' },
  { source_id: 'COST02', titre: 'IDFM - Tarifs des tickets', url_source: 'x', date_extraction: '2026-11-02T16:00Z', licence: 'page publique' },
  { source_id: 'ENV01', titre: 'IDFM - Émissions de CO2e par voyageur-kilomètre', url_source: 'x', date_extraction: '2026-11-02T16:10Z', licence: 'ODbL' },
  { source_id: 'VEH01', titre: 'SDES - Consommations des véhicules', url_source: 'x', millesime: '2024', licence: 'LO' },
  { source_id: 'COST06', titre: 'Prix des carburants - prix-carburants.gouv.fr', url_source: 'x', date_extraction: '2026-11-03T09:00Z', licence: 'LO' },
];

const VEHICLES = [
  {
    id: 'essence',
    label: 'Voiture essence',
    consumption_source: { source_id: 'VEH01', year: 2024, text: 't' },
    price_source: { source_id: 'COST06', text: 't' },
  },
  {
    id: 'diesel',
    label: 'Voiture diesel',
    consumption_source: { source_id: 'VEH01', year: 2024, text: 't' },
    price_source: { source_id: 'COST06', text: 't' },
  },
] as unknown as VehicleMeta[];

const META = {
  service_date: '2026-11-17',
  vehicles: VEHICLES,
  line_facts: { sources: ['TRA03', 'QS01'], tra03_snapshot: '2026-11-03', punctuality_month: '2026-09' },
} as unknown as Meta;

const DS: Pick<Dataset, 'origin' | 'meta' | 'sources' | 'poles'> = { origin: 'real', meta: META, sources: SOURCES, poles: [] };

const texts = (p: { tags: { text: string }[] } | null | undefined) => p?.tags.map((t) => t.text) ?? [];
const leg = (over: Partial<ItinLeg>): ItinLeg => ({ m: 'metro', dep: '08:00', arr: '08:10', min: 10, dist_m: null, ...over });

describe('sourceTag : période déjà formulée par la donnée', () => {
  it('prime sur le millésime de sources.json', () => {
    expect(sourceTag('QS01', SOURCES, { period: 'septembre 2026' })?.text).toBe('SNCF Voyageurs, septembre 2026 (QS01)');
    expect(sourceTag('QS01', SOURCES, { period: null })?.text).toBe('SNCF Voyageurs, extrait du 03/11/2026 (QS01)');
  });
  it('ne cite pas un code absent de sources.json', () => {
    expect(sourceTag('QS01', [], { period: 'septembre 2026' })).toBeNull();
  });
});

describe('tripFactsPart : période lue dans la donnée (climatisation TRA03, ponctualité QS01)', () => {
  const rer = leg({ m: 'rer', line: 'B', air_conditioning: 'true', punctuality: { value_pct: 89.4, month: '2026-09' } });

  it('cite les deux sources, avec le mois lu sur le tronçon et la date de l’extrait lue dans meta', () => {
    const p = tripFactsPart(SOURCES, { legs: [rer] }, META.line_facts);
    expect(p?.lead).toBe('Faits de ligne');
    expect(texts(p)).toEqual(['IDFM, extrait du 03/11/2026 (TRA03)', 'SNCF Voyageurs, septembre 2026 (QS01)']);
    expect(p!.tags.map((t) => t.anchor)).toEqual(['fiche-TRA03', 'fiche-QS01']);
  });
  it('mois non publié sur le tronçon : celui de meta.line_facts', () => {
    const l = leg({ m: 'train', punctuality: { value_pct: null, month: null, reason: 'month_not_published' } });
    expect(texts(tripFactsPart(SOURCES, { legs: [l] }, META.line_facts))).toContain('SNCF Voyageurs, septembre 2026 (QS01)');
  });
  it('la marche et un trajet vide ne citent rien', () => {
    expect(tripFactsPart(SOURCES, { legs: [leg({ m: 'walk' })] }, META.line_facts)).toBeNull();
    expect(tripFactsPart(SOURCES, { legs: [] }, META.line_facts)).toBeNull();
  });
  it('sans entrée dans sources.json : rien (le chiffre reste, sans mention de source)', () => {
    expect(tripFactsPart([], { legs: [rer] }, META.line_facts)).toBeNull();
  });
  it('sans date d’extrait ni mois publiés : le millésime de sources.json ; une ponctualité sans mois n’est pas affichée, donc pas citée', () => {
    const l = leg({ m: 'rer', line: 'A', air_conditioning: 'true', punctuality: { value_pct: 90, month: null } });
    expect(texts(tripFactsPart(SOURCES, { legs: [l] }, null))).toEqual(['IDFM, extrait du 03/11/2026 (TRA03)']);
    expect(texts(tripFactsPart(SOURCES, { legs: [l] }))).toEqual(['IDFM, extrait du 03/11/2026 (TRA03)']);
    const noOpenData = leg({ m: 'bus', punctuality: { value_pct: null, month: null, reason: 'no_open_data' } });
    expect(texts(tripFactsPart(SOURCES, { legs: [noOpenData] }, null))).toEqual(['SNCF Voyageurs, extrait du 03/11/2026 (QS01)']);
  });
});

describe('offpeakPart (heure creuse)', () => {
  it('horaires GTFS à la date de service et rues OSM, calcul r5py', () => {
    const p = offpeakPart(DS);
    expect(p?.lead).toBe('Heure creuse');
    expect(p?.engine).toBe('calcul r5py');
    expect(texts(p)).toEqual(['GTFS IDFM, mardi 17/11/2026 (TRA01)', 'OpenStreetMap, extrait du 02/11/2026 (CYC01)']);
  });
  it('rien en mode démo', () => {
    expect(offpeakPart({ ...DS, origin: 'demo' })).toBeNull();
  });
});

describe('alternativesPart (autres trajets)', () => {
  it('mêmes horaires et mêmes rues que les itinéraires, règle de choix écrite, aucun chiffre', () => {
    const p = alternativesPart(DS);
    expect(p?.lead).toBe('Autres trajets');
    expect(p?.engine).toBe('calcul r5py');
    expect(texts(p)).toEqual(['GTFS IDFM, mardi 17/11/2026 (TRA01)', 'OpenStreetMap, extrait du 02/11/2026 (CYC01)']);
    expect(p?.method).toMatch(/avant le début du poste à l'aller et partent après sa fin au retour/);
    expect(p?.method).not.toMatch(/\d/);
  });
  it('rien en mode démo', () => {
    expect(alternativesPart({ ...DS, origin: 'demo' })).toBeNull();
  });
});

describe('modesParts (comparer les modes)', () => {
  const rows = [
    { mode: 'transit' as const, cost: '5,40 € au ticket', carbon: '1 200 g CO2e' },
    { mode: 'bike' as const, cost: null, carbon: null },
    { mode: 'car' as const, cost: 'Carburant seul : essence 3,84 €', carbon: null },
  ];

  it('durées de tous les modes affichés, ticket, carbone et coût voiture lus', () => {
    const parts = modesParts(DS, rows);
    expect(parts.map((p) => p.lead)).toEqual(['Durées', 'Coût des transports en commun', 'Carbone des transports en commun', 'Coût voiture']);
    expect(texts(parts[0])).toEqual(['GTFS IDFM, mardi 17/11/2026 (TRA01)', 'OpenStreetMap, extrait du 02/11/2026 (CYC01)']);
    expect(texts(parts[1])).toEqual(['IDFM, extrait du 02/11/2026 (COST02)']);
    expect(texts(parts[2])).toEqual(['IDFM, extrait du 02/11/2026 (ENV01)']);
    // une seule fois chaque source, millésime de la consommation lu dans le véhicule
    expect(texts(parts[3])).toEqual(['SDES 2024 (VEH01)', 'Prix des carburants, extrait du 03/11/2026 (COST06)']);
  });
  it('« non publié » : aucune source citée pour une case vide', () => {
    const parts = modesParts(DS, [
      { mode: 'transit', cost: null, carbon: null },
      { mode: 'car', cost: null, carbon: null },
    ]);
    expect(parts.map((p) => p.lead)).toEqual(['Durées']);
  });
  it('marche et vélo seuls : OSM uniquement, sans GTFS', () => {
    const parts = modesParts(DS, [{ mode: 'walk', cost: null, carbon: null }]);
    expect(texts(parts[0])).toEqual(['OpenStreetMap, extrait du 02/11/2026 (CYC01)']);
  });
  it('rien sans ligne ni en mode démo', () => {
    expect(modesParts(DS, [])).toEqual([]);
    expect(modesParts({ ...DS, origin: 'demo' }, rows)).toEqual([]);
  });
});
