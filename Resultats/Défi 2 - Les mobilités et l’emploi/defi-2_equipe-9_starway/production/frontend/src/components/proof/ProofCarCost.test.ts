import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCENARIO, type Scenario } from '../../state/scenario';
import type { AccessFile, Meta, SourceEntry, TollsFile, VehicleMeta } from '../../data/types';
import { CarCostView } from './ProofCarCost';

/* Le rendu serveur de zustand relit toujours l'état initial : le bouton « sources » est donc simulé
   (état lu par ProvenanceNote : `s.on`). */
const prov = vi.hoisted(() => ({ on: false }));
vi.mock('../../store/provenanceStore', () => ({ useProvenanceStore: (select: (s: { on: boolean }) => unknown) => select({ on: prov.on }) }));

/* FIXTURES (format des contrats, valeurs d'exemple, pas des données publiées). */
const base: Omit<VehicleMeta, 'id' | 'label'> = {
  family: 'car', energy: 'SP95-E10', unit: 'L', consumption_per_100km: 6, consumption_source: { source_id: 'COST08', year: 2024, text: 'SDES' },
  price_eur_per_unit: 2, price_source: { source_id: 'COST07', text: 'médiane' }, cost_eur_per_km: 0.12, toll_class: 1, co2_kg_per_km: 0.1614,
  co2_kg_per_unit: 2.69, co2_source: { source_id: 'ENV02', version: 'V23.6', element_id: '13988', name: 'Essence ; E10', unit: 'kgCO2e/litre', total: 2.69 }, status: 'ok',
};
const vehicles: VehicleMeta[] = [
  { ...base, id: 'petrol', label: 'Voiture essence' },
  { ...base, id: 'moto_125', label: 'Scooter ou moto 125 cm3', family: 'two_wheeler', toll_class: 5, cost_eur_per_km: 0.0532, co2_kg_per_km: 0.071554, time: { same_as: 'car', text: 'Même temps de trajet que la voiture.' } },
];
const meta = {
  day_types: [{ id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' }],
  vehicles,
  car_costs: {
    formula: 'f', label: 'Énergie et péages', not_included: ['stationnement'], rounding: 'r',
    carbon: { formula: 'f', unit: 'g CO2e', rounding: 'r', occupancy: 'une personne seule dans le véhicule', perimeter: 'énergie seule', tc_comparison: 'ordre de grandeur', source_id: 'ENV02' },
    distances: { status: 'ok' }, tolls: { status: 'ok', file: 'tolls.json' },
  },
} as unknown as Meta;
const tolls = {
  contract: 'tolls-1', processing_version: 't', service_date: '2026-11-17', days: {},
  points: [
    { id: 'SAPN_A14_MONTESSON', label: 'A14 - gare de Montesson', road: 'A14', operator: 'SAPN', system: 'SAPN_A14', pricing: 'prix_fixe', status: 'ok', notice: 'Gratuité annoncée, non appliquée.', credit: 'tarif SAPN 2026 (Journal officiel)' },
    { id: 'DUPLEX_RUEIL', label: 'Duplex A86 - gare de Rueil', road: 'A86', operator: 'Cofiroute', system: 'DUPLEX_A86', pricing: 'h', status: 'ok', credit: 'tarif © VINCI Autoroutes 2026' },
    { id: 'DUPLEX_VELIZY', label: 'Duplex A86 - gare de Vélizy', road: 'A86', operator: 'Cofiroute', system: 'DUPLEX_A86', pricing: 'h', status: 'ok', credit: 'tarif © VINCI Autoroutes 2026' },
  ],
  grids: [
    { e: 0, s: 0, c: 1, t: 'standard', d: 0, slots: [[0, 600, 10.8], [600, 1440, 6.6]] },
    { e: 0, s: 0, c: 5, t: 'standard', d: 0, slots: [[0, 1440, 5.5]] },
    { e: 1, s: 2, c: 5, t: 'standard', status: 'interdit' },
  ],
  status_texts: { non_trouve: 'grille tarifaire non relevée' }, classes: { '1': 'véhicules légers', '5': 'motos' }, tariffs: {}, rule: { price: 'un prix par tranche' },
  not_applied: [], sources: [],
} as unknown as TollsFile;
const access = {
  insee: '78418', processing_version: 't',
  modes: { car: { any: { out: [40, 30], ret: [40, 30], reason: [null, null] } } },
  car_trip: { dist_m: { out: [10_000, 20_000], ret: [12_345, 20_000] }, reason: { out: [null, null], ret: [null, null] }, toll: { out: [[[0, 0]], [[1, 2]]], ret: [[], { s: 'non_trouve', p: [0] }] } },
} as unknown as AccessFile;

const render = (scenario: Partial<Scenario>, i = 0, tj: TollsFile | null = tolls, sources: SourceEntry[] = [], polesCount = 2) =>
  renderToStaticMarkup(createElement(CarCostView, { meta, access, poleIndex: i, polesCount, scenario: { ...DEFAULT_SCENARIO, mode: 'car', ...scenario }, tolls: tj, sources }));

const SOURCES: SourceEntry[] = [
  { source_id: 'COST08', titre: 'SDES - Bilan annuel des transports en 2024', url_source: 'u', millesime: '2024', licence: 'LO' },
  { source_id: 'COST07', titre: 'Ministère de l\'Économie - Prix des carburants en France', url_source: 'u', date_extraction: '2026-11-03T21:41Z', licence: 'LO' },
  { source_id: 'ENV02', titre: 'ADEME - Base Carbone V23.6', url_source: 'u', millesime: 'V23.6', date_extraction: '2026-11-03T21:42Z', licence: 'LO' },
];

describe('CarCostView : provenance (D-033, coupée par défaut)', () => {
  it('mode sources coupé : aucune ligne de provenance dans le DOM', () => {
    prov.on = false;
    expect(render({}, 0, tolls, SOURCES)).not.toContain('prov-note');
  });

  it('mode sources actif : jeu, millésime, code et lien vers la fiche de chaque chiffre', () => {
    prov.on = true;
    try {
      const html = render({}, 0, tolls, SOURCES);
      expect(html).toContain('prov-note');
      expect(html).toContain('href="#fiche-COST08"');
      expect(html).toContain('href="#fiche-COST07"');
      expect(html).toContain('href="#fiche-ENV02"');
      expect(html).toContain('SDES 2024 (COST08)');
      expect(html).not.toMatch(/[\u2013\u2014]/);
      expect(render({}, 0, tolls, [])).not.toContain('prov-note'); // aucun code publié : rien d'inventé
    } finally {
      prov.on = false;
    }
  });
});

describe('CarCostView : sources internes aux lignes Énergie et Carbone (D-033, lot 6)', () => {
  const view = (sourcesOn: boolean) =>
    renderToStaticMarkup(createElement(CarCostView, { meta, access, poleIndex: 0, polesCount: 2, scenario: { ...DEFAULT_SCENARIO, mode: 'car' }, tolls, sources: [], sourcesOn }));

  it('mode sources coupé : la valeur reste, le nom de la source part', () => {
    const html = view(false);
    expect(html).toContain('Énergie : 6 L/100 km x');
    expect(html).toContain('combustion et amont');
    expect(html).not.toContain('SDES');
    expect(html).not.toContain('médiane');
    expect(html).not.toContain('Base Carbone');
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('crédit du producteur du péage à côté du montant, mode sources coupé ou non (accord du 09/11/2026, D-060)', () => {
    for (const on of [false, true]) {
      const html = view(on);
      expect(html).toContain('péage 10,80');
      expect(html).toContain('A14 - gare de Montesson ; tarif SAPN 2026 (Journal officiel))');
    }
    // aucun montant (péage inconnu) : aucun crédit
    expect(render({}, 1)).not.toContain('tarif SAPN 2026');
  });

  it('mode sources actif : tout réapparaît', () => {
    const html = view(true);
    expect(html).toContain('(SDES)');
    expect(html).toContain('médiane');
    expect(html).toContain('ADEME, Base Carbone V23.6, élément 13988');
  });
});

describe('CarCostView (rendu statique)', () => {
  it('garde de longueur : des distances de 2 astres sur 44 astres (ou sur 1) sont refusées, jamais un coût', () => {
    for (const n of [44, 15, 1]) {
      const html = render({}, 0, tolls, [], n);
      expect(html).toContain('pas encore publié');
      expect(html).not.toContain('Aller (10 km)');
      expect(html).not.toMatch(/\d,\d\d\s*€|13,48/);
    }
    // et la bonne longueur est lue
    expect(render({}, 0, tolls, [], 2)).toContain('Aller (10 km)');
  });

  it('voiture essence : énergie, péage à l’heure de passage, total, carbone, avis et ce qui n’est pas compté', () => {
    const html = render({});
    expect(html).toContain('Coût et carbone : voiture essence');
    expect(html).toContain('Aller (10 km) : énergie 1,20');
    expect(html).toContain('péage 10,80');
    expect(html).toContain('A14 - gare de Montesson');
    expect(html).toContain('aucun péage');
    expect(html).toContain('13,48'); // 1,20 + 1,4814 + 10,80, arrondi après la somme
    expect(html).toMatch(/3.606.g CO2e/);
    expect(html).toContain('Gratuité annoncée, non appliquée.');
    expect(html).toContain('Non compté : stationnement');
    expect(html).toContain('une personne seule dans le véhicule');
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('deux-roues : classe 5, phrase sur le temps ; Duplex A86 interdit : aucun coût', () => {
    const html = render({ vehicle: 'moto_125' });
    expect(html).toContain('péage 5,50');
    expect(html).toContain('Même temps de trajet que la voiture');
    expect(render({ vehicle: 'moto_125' }, 1)).toContain('interdit aux deux-roues');
  });

  it('péage inconnu : total inconnu, énergie gardée ; tolls.json pas chargé : rien d’inventé', () => {
    const html = render({}, 1);
    expect(html).toContain('péage inconnu');
    expect(html).toContain('Total inconnu');
    expect(render({}, 0, null)).toContain('péages en cours de chargement');
  });
});
