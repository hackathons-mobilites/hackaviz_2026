/**
 * Ligne de crédits du panneau de preuve (D-060, accord de l'organisateur du hackathon du 09/11/2026) : les producteurs
 * des blocs affichés, lus par les fonctions de provenance, toujours visibles. FIXTURES (format des contrats, valeurs
 * d'exemple, pas des données publiées).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDIT_NAMES, OSM_CREDIT } from './attribution';
import type { ItinLeg } from './itineraries';
import { DAY_TYPES_HYPOTHETICAL } from './labels';
import { creditLine, creditNames, crossedTollProducers, panelCreditCodes, scenarioCreditCodes, type PanelCreditInput } from './panelCredits';
import type { Dataset, Meta, Pole, SourceEntry, TollsFile, VehicleMeta } from './types';

const src = (source_id: string, titre: string): SourceEntry => ({ source_id, titre, url_source: 'x', date_extraction: '2026-11-03T10:00Z', licence: 'LO' });
const SOURCES: SourceEntry[] = [
  src('TRA01', "IDFM - Horaires prévus sur les lignes de TC d'Île-de-France (GTFS Datahub)"),
  src('CYC01', 'OpenStreetMap - extrait Île-de-France (Geofabrik)'),
  src('EMP01', 'INSEE Flores - Nombre d’établissements et effectifs salariés'),
  src('GEO04', "France Travail - Bassins d'emploi 2026"),
  src('GEO01', 'API Géo - communes'),
  src('COST02', 'IDFM - Tarifs des tickets'),
  src('SUB05', 'Code du travail numérique (ministère du Travail) - article L3261-2'),
  src('ROAD01', 'DRIEAT Île-de-France, DiRIF - Baromètre trafic'),
  src('COST07', 'Ministère de l’Économie - Prix des carburants'),
  src('COST08', 'SDES - Bilan annuel des transports en 2024'),
  src('ENV02', 'ADEME - Base Carbone'),
  src('EMP04', 'Choisir le service public (DGAFP) - offres'),
];
const VEHICLES = [
  { id: 'petrol', label: 'Voiture essence', family: 'car', consumption_source: { source_id: 'COST08', year: 2024, text: 't' }, price_source: { source_id: 'COST07', text: 't' }, co2_source: { source_id: 'ENV02' } },
] as unknown as VehicleMeta[];
const META = { service_date: '2026-11-17', vehicles: VEHICLES, car_congestion: { source_id: 'ROAD01' } } as unknown as Meta;
const DS: PanelCreditInput['ds'] = { origin: 'real', meta: META, sources: SOURCES, poles: [{}, {}] as unknown as Dataset['poles'] };
const POLE = { jobs_source: 'EMP01', jobs_year: 2023, bassin: { source: "GEO04, France Travail, bassins d'emploi 2026" }, point: { method: 'arrêt le plus desservi (GTFS IDFM)' } } as unknown as Pole;
const COMMUNE = { origin: null };
const leg = (over: Partial<ItinLeg>): ItinLeg => ({ m: 'metro', dep: '08:00', arr: '08:10', min: 10, dist_m: null, ...over });
const TOLLS = {
  points: [
    { id: 'A', label: 'a', road: 'A14', operator: 'SAPN', system: 'SAPN_A14', pricing: 'p', status: 'ok', credit: 'tarif SAPN 2026 (Journal officiel)' },
    { id: 'R', label: 'r', road: 'A86', operator: 'Cofiroute (VINCI Autoroutes)', system: 'DUPLEX_A86', pricing: 'p', status: 'ok', credit: 'tarif © VINCI Autoroutes 2026' },
    { id: 'V', label: 'v', road: 'A86', operator: 'Cofiroute (VINCI Autoroutes)', system: 'DUPLEX_A86', pricing: 'p', status: 'ok', credit: 'tarif © VINCI Autoroutes 2026' },
  ],
} as unknown as TollsFile;

const line = (x: Omit<PanelCreditInput, 'ds'>) => {
  const { codes, tolls } = panelCreditCodes({ ds: DS, ...x });
  return creditLine(creditNames(codes, SOURCES, tolls));
};

describe('ligne de crédits du panneau : producteurs des blocs affichés', () => {
  it('TC avec itinéraire et prise en charge employeur : IDFM, INSEE, France Travail, API Géo, Service Public, OpenStreetMap en dernier', () => {
    const l = line({ mode: 'transit', pole: POLE, origins: [COMMUNE], trips: [{ legs: [leg({})] }], employer: true, publicOffers: false });
    expect(l).toBe(`Données : Île-de-France Mobilités, INSEE, France Travail, API Géo, Service Public, ${OSM_CREDIT}`);
    expect(l).not.toMatch(/DiRIF|VINCI|SDES|ADEME/);
  });

  it('voiture par le Duplex A86 : DiRIF, coût et carbone du véhicule, VINCI Autoroutes ; pas d’IDFM', () => {
    const access = { car_trip: { dist_m: { out: [1, 1], ret: [1, 1] }, reason: { out: [null, null], ret: [null, null] }, toll: { out: [[[1, 2]], []], ret: [[], []] } } };
    const l = line({ mode: 'car', pole: POLE, origins: [COMMUNE], trips: [], employer: false, publicOffers: true, access: access as never, vehicle: 'petrol', poleIndex: 0, tolls: TOLLS });
    expect(l).toBe(
      `Données : INSEE, France Travail, API Géo, DiRIF, Choisir le service public, SDES, Ministère de l'Économie, ADEME, VINCI Autoroutes, ${OSM_CREDIT}`,
    );
    expect(l).not.toContain('Île-de-France Mobilités');
    expect(l).not.toMatch(/[\u2013\u2014]/);
  });

  it('sans commune de départ : seulement les postes et le bassin de l’astre', () => {
    expect(line({ mode: 'transit', pole: POLE, origins: [null], trips: [], employer: false, publicOffers: false })).toBe('Données : INSEE, France Travail');
  });

  it('péage inconnu ou absent : aucun producteur de péage', () => {
    expect(crossedTollProducers(TOLLS, [{ s: 'non_trouve', p: [0] }, [], null])).toEqual([]);
    expect(crossedTollProducers(TOLLS, [[[0, 0]]])).toEqual(['SAPN']);
    expect(crossedTollProducers(null, [[[1, 2]]])).toEqual([]);
  });
});

describe('bande sous le ciel : producteurs du scénario, toujours crédités (D-060 amendée le 11/11, audit de vérité B1)', () => {
  const EDF = { source_id: 'COST06', titre: 'EDF - Grille de prix « Tarif Bleu »', url_source: 'u', millesime: '2026', licence: 'accord' } as unknown as SourceEntry;
  const ELECTRIC = { id: 'electric', label: 'Voiture électrique', family: 'car', consumption_source: { source_id: 'ENV02', text: 't' }, price_source: { source_id: 'COST06', text: 't' }, co2_source: { source_id: 'ENV02' } } as unknown as VehicleMeta;
  const ds = { origin: 'real' as const, meta: { ...META, vehicles: [...VEHICLES, ELECTRIC] } as Meta, sources: [...SOURCES, EDF] };
  const names = (x: Parameters<typeof scenarioCreditCodes>[1]) => creditNames(scenarioCreditCodes(ds, x), ds.sources);

  it('voiture avec trafic : DiRIF, lu dans meta.car_congestion ; route vide : pas de DiRIF', () => {
    expect(names({ mode: 'car_traffic', vehicle: 'petrol', panelOpen: false, hasOrigin: true })).toContain('DiRIF');
    expect(names({ mode: 'car', vehicle: 'petrol', panelOpen: false, hasOrigin: true })).not.toContain('DiRIF');
    // la source vient des données : sans indice publié, rien
    const noIndex = { ...ds, meta: { ...ds.meta, car_congestion: undefined } as Meta };
    expect(creditNames(scenarioCreditCodes(noIndex, { mode: 'car_traffic', panelOpen: false, hasOrigin: true }), ds.sources)).not.toContain('DiRIF');
  });

  it('voiture électrique choisie : EDF ; essence : pas EDF', () => {
    expect(names({ mode: 'car', vehicle: 'electric', panelOpen: false, hasOrigin: true })).toContain('EDF');
    expect(names({ mode: 'car', vehicle: 'petrol', panelOpen: false, hasOrigin: true })).not.toContain('EDF');
  });

  it('panneau ouvert : « Comparer les moyens » (DiRIF, EDF) et, en transports en commun, Service Public', () => {
    const tc = names({ mode: 'transit', panelOpen: true, hasOrigin: true });
    expect(tc).toEqual(expect.arrayContaining(['DiRIF', 'EDF', 'Service Public']));
    expect(names({ mode: 'bike', panelOpen: true, hasOrigin: true })).not.toContain('Service Public');
    // panneau fermé en transports en commun : rien de plus que le ciel
    expect(names({ mode: 'transit', panelOpen: false, hasOrigin: true })).toEqual([]);
  });

  it('sans commune de départ ou en démonstration : rien ; un code absent de sources.json ne crédite rien', () => {
    expect(names({ mode: 'car_traffic', panelOpen: true, hasOrigin: false })).toEqual([]);
    expect(scenarioCreditCodes({ ...ds, origin: 'demo' }, { mode: 'car_traffic', panelOpen: true, hasOrigin: true })).toEqual([]);
    expect(scenarioCreditCodes({ ...ds, sources: SOURCES }, { mode: 'car', vehicle: 'electric', panelOpen: false, hasOrigin: true })).not.toContain('COST06');
  });

  it('la bande du ciel appelle scenarioCreditCodes ; le pied du panneau reste réservé au mode sources', () => {
    const sky = readFileSync(new URL('../components/SkyCredit.tsx', import.meta.url), 'utf8');
    expect(sky).toMatch(/scenarioCreditCodes\(dataset, \{ mode, vehicle, panelOpen, hasOrigin \}\)/);
    const panel = readFileSync(new URL('../components/ProofPanel.tsx', import.meta.url), 'utf8');
    // (au téléphone aussi : la bande est masquée sous la feuille du panneau ouverte, le crédit est donc au pied du panneau)
    expect(panel).toMatch(/\{\(provenanceOn \|\| fake \|\| phone\) && <PanelCredits/);
  });
});

describe('journées-types : scénarios hypothétiques (audit de vérité C5)', () => {
  it('le « i » des journées-types le dit en première ligne, même sans le fichier du territoire', () => {
    expect(DAY_TYPES_HYPOTHETICAL).toMatch(/scénarios hypothétiques, pas les horaires réels/);
    const tip = readFileSync(new URL('../components/territoire/WorkTime.tsx', import.meta.url), 'utf8');
    const body = tip.slice(tip.indexOf('export function WorkTimeTip'), tip.indexOf('export function WorkTimeFold'));
    expect(body).toContain('{DAY_TYPES_HYPOTHETICAL}');
    expect(body).not.toMatch(/return null/);
    expect(body.indexOf('DAY_TYPES_HYPOTHETICAL')).toBeLessThan(body.indexOf('<Sentences'));
  });
});

describe('table des producteurs crédités', () => {
  it('chaque code publié dans sources.json a un nom crédité (sauf OpenStreetMap, mention propre, et péages, crédités par tolls.json)', () => {
    const published = JSON.parse(readFileSync(new URL('../../public/data/sources.json', import.meta.url), 'utf-8')) as SourceEntry[];
    const codes = [...new Set(published.map((s) => s.source_id))];
    const missing = codes.filter((c) => !(c in CREDIT_NAMES) && c !== 'CYC01' && !c.startsWith('TOLL'));
    expect(missing).toEqual([]);
    for (const n of Object.values(CREDIT_NAMES)) expect(n).not.toMatch(/[\u2013\u2014]/);
  });
});
