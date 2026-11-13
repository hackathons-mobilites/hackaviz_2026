import { describe, expect, it } from 'vitest';
import { carTripFacts, co2Grams, energyEur, roundGrams, sanitizeVehicle, selectedVehicle } from './carCost';
import { parseScenario, serializeScenario } from '../state/url';
import { DEFAULT_SCENARIO } from '../state/scenario';
import { passageWindow, roundCents, tollLeg, windowPrices } from './tolls';
import type { CarTrip, TollCell, TollsFile, VehicleMeta } from './types';

/*
 * FIXTURES au format de tolls.json (contrat tolls-1) : mêmes grilles que les fichiers synthétiques de
 * pipeline/tests/test_toll_tariffs.py, pas des valeurs publiées. Indices : 0 Montesson (A14), 1 Rueil,
 * 2 Vélizy (Duplex A86), 3 Coutevroult (A4, grille non relevée). Les cas LEG_CASES sont ceux de
 * pipeline/tests/test_toll_publish.py (mêmes valeurs attendues).
 */
const A14_TUESDAY: [number, number, number][] = [
  [0, 360, 6.6],
  [360, 600, 10.8],
  [600, 960, 6.6],
  [960, 1260, 10.8],
  [1260, 1440, 6.6],
];
const A14_TUESDAY_C5: [number, number, number][] = A14_TUESDAY.map(([a, b, p]) => [a, b, p === 6.6 ? 3.4 : 5.5]);
const TJ: TollsFile = {
  contract: 'tolls-1',
  processing_version: 'test',
  service_date: '2026-11-17',
  days: {},
  points: [
    { id: 'SAPN_A14_MONTESSON', label: 'A14 - gare de Montesson', road: 'A14', operator: 'SAPN', system: 'SAPN_A14', pricing: 'prix_fixe', status: 'ok', notice: 'avis' },
    { id: 'DUPLEX_RUEIL', label: 'Duplex A86 - gare de Rueil', road: 'A86', operator: 'Cofiroute', system: 'DUPLEX_A86', pricing: 'couple_entree_sortie_horaire', status: 'ok' },
    { id: 'DUPLEX_VELIZY', label: 'Duplex A86 - gare de Vélizy', road: 'A86', operator: 'Cofiroute', system: 'DUPLEX_A86', pricing: 'couple_entree_sortie_horaire', status: 'ok' },
    { id: 'SANEF_A4_COUTEVROULT', label: 'A4 - barrière de Coutevroult', road: 'A4', operator: 'Sanef', system: 'SANEF_A4', pricing: 'prix_fixe', status: 'non_trouve' },
  ],
  grids: [
    ...[-1, 0, 1].map((d) => ({ e: 0, s: 0, c: 1, t: 'standard', d, slots: A14_TUESDAY })),
    ...[-1, 0, 1].map((d) => ({ e: 0, s: 0, c: 5, t: 'standard', d, slots: A14_TUESDAY_C5 })),
    { e: 1, s: 2, c: 1, t: 'standard', d: 0, slots: [[420, 450, 11.4], [450, 480, 11.4]] },
    { e: 1, s: 2, c: 1, t: 'telepeage', d: 0, slots: [[420, 450, 11.4]] },
    { e: 2, s: 1, c: 1, t: 'standard', d: 0, slots: [[420, 450, 14.3], [450, 480, 14.9]] },
    { e: 1, s: 2, c: 5, t: 'standard', status: 'interdit', reason: 'deux-roues interdits' },
  ],
  status_texts: { non_trouve: 'grille tarifaire non relevée', interdit: 'interdit aux deux-roues' },
  classes: { '1': 'véhicules légers', '5': 'motos' },
  tariffs: {},
  rule: { price: 'un prix si la fenêtre tient dans une tranche, sinon une fourchette' },
  not_applied: [],
  sources: [],
};
const M = 0;
const R = 1;
const Z = 2;

// [cellule, classe, début, fin, tarif, attendu [min, max, statut]] ; minutes depuis minuit du mardi 17/11/2026
const LEG_CASES: [TollCell, number, number, number, string, [number | null, number | null, string]][] = [
  [[], 1, 480, 520, 'standard', [0, 0, 'sans_peage']],
  [[[M, M]], 1, 480, 520, 'standard', [10.8, 10.8, 'ok']],
  [[[M, M]], 1, 570, 620, 'standard', [6.6, 10.8, 'fourchette']],
  [[[M, M]], 5, 660, 700, 'standard', [3.4, 3.4, 'ok']],
  [[[M, M]], 1, -30, 20, 'standard', [6.6, 6.6, 'ok']],
  [[[M, M]], 1, 600, 600, 'standard', [6.6, 6.6, 'ok']],
  [[[R, Z]], 1, 420, 440, 'standard', [11.4, 11.4, 'ok']],
  [[[R, Z]], 1, 420, 440, 'telepeage', [11.4, 11.4, 'ok']],
  [[[Z, R]], 1, 430, 460, 'standard', [14.3, 14.9, 'fourchette']],
  [[[R, Z]], 5, 420, 440, 'standard', [null, null, 'interdit']],
  [[[R, Z]], 1, 600, 620, 'standard', [null, null, 'tranche_absente']],
  [[[M, M], [R, Z]], 1, 420, 440, 'standard', [22.2, 22.2, 'ok']],
  [{ s: 'non_trouve', p: [3] }, 1, 420, 440, 'standard', [null, null, 'non_trouve']],
  [null, 1, 420, 440, 'standard', [null, null, 'no_route']],
  [[[M, M]], 1, 1430, 1450, 'standard', [6.6, 6.6, 'ok']],
];

describe('tollLeg (mêmes cas que le pipeline)', () => {
  it.each(LEG_CASES)('cas %#', (cell, classe, lo, hi, tarif, [min, max, status]) => {
    const r = tollLeg(TJ, cell, classe, lo, hi, tarif);
    expect(r.status).toBe(status);
    if (min == null) expect(r.min).toBeNull();
    else expect(r.min).toBeCloseTo(min, 9);
    if (max == null) expect(r.max).toBeNull();
    else expect(r.max).toBeCloseTo(max, 9);
  });

  it('refuse une fenêtre inversée et signale un jour non publié', () => {
    expect(() => windowPrices(new Map([[0, [[0, 1440, 1]]]]), 10, 5)).toThrow();
    expect(windowPrices(new Map([[0, [[0, 1440, 1]]]]), 1430, 1450).status).toBe('jour_absent');
  });

  it('fenêtre de passage : aller avant le début, retour après la fin', () => {
    expect(passageWindow('out', 540, 40)).toEqual([500, 540]);
    expect(passageWindow('ret', 1020, 35)).toEqual([1020, 1055]);
    expect(passageWindow('out', 540, null)).toBeNull();
    expect(roundCents(0.125)).toBe(0.13);
  });
});

const PETROL: VehicleMeta = {
  id: 'petrol', label: 'Voiture essence', family: 'car', energy: 'SP95-E10', unit: 'L', consumption_per_100km: 6, consumption_source: { source_id: 'X', year: 2024, text: '' },
  price_eur_per_unit: 2, price_source: { source_id: 'Y', text: '' }, cost_eur_per_km: 0.12, toll_class: 1, co2_kg_per_km: 0.1614, status: 'ok',
};
const MOTO: VehicleMeta = { ...PETROL, id: 'moto_125', label: 'Scooter ou moto 125 cm3', family: 'two_wheeler', toll_class: 5, cost_eur_per_km: 0.0532, co2_kg_per_km: 0.071554 };

describe('coût et carbone (mêmes opérations que starway/vehicles.py)', () => {
  it('énergie et carbone au centime et au gramme, jamais 0 pour une distance absente', () => {
    // mêmes valeurs que test_vehicles_costs et test_two_wheelers_and_carbon du pipeline
    expect(roundCents(energyEur(12_345, PETROL)!)).toBe(1.48);
    expect(energyEur(null, PETROL)).toBeNull();
    expect(roundGrams(co2Grams(10_000, PETROL)!)).toBe(1614);
    expect(roundGrams(co2Grams(12_345, PETROL)!)).toBe(1992);
    expect(co2Grams(1000, { co2_kg_per_km: null })).toBeNull();
  });

  it('trajet aller et retour : énergie + péage à l’heure de passage, fourchette si la fenêtre chevauche deux tranches', () => {
    const trip: CarTrip = { dist_m: { out: [10_000], ret: [12_345] }, reason: { out: [null], ret: [null] }, toll: { out: [[[M, M]]], ret: [[]] } };
    // 9h-17h : aller 8h20-9h (base 10,80 €), retour 17h-17h40 sans péage
    const f = carTripFacts(trip, TJ, PETROL, 0, 540, 1020, 40, 40);
    expect(f.out.energy).toBe(1.2);
    expect(f.out.totalMin).toBe(12);
    expect(f.ret.totalMin).toBe(1.48);
    expect(f.energy).toBe(2.68);
    expect(f.totalMin).toBe(13.48);
    expect(f.co2).toBe(3606);
    // aller 9h30-10h20 : 6,60 € ou 10,80 €
    const g = carTripFacts(trip, TJ, PETROL, 0, 620, 1020, 50, 40);
    expect([g.totalMin, g.totalMax]).toEqual([9.28, 13.48]);
    // deux-roues : classe 5
    expect(carTripFacts(trip, TJ, MOTO, 0, 540, 1020, 40, 40).out.toll?.min).toBe(5.5);
    // péage inconnu : total inconnu, énergie connue
    const u = carTripFacts({ ...trip, toll: { out: [{ s: 'non_trouve', p: [3] }], ret: [[]] } }, TJ, PETROL, 0, 540, 1020, 40, 40);
    expect(u.totalMin).toBeNull();
    expect(u.energy).toBe(2.68);
    // tolls.json pas encore chargé : ni péage ni total
    expect(carTripFacts(trip, null, PETROL, 0, 540, 1020, 40, 40).totalMin).toBeNull();
  });

  it('véhicule choisi : défaut = premier publié, identifiant inconnu ignoré', () => {
    const meta = { vehicles: [PETROL, MOTO] };
    expect(selectedVehicle(meta, null)?.id).toBe('petrol');
    expect(selectedVehicle(meta, 'moto_125')?.id).toBe('moto_125');
    expect(selectedVehicle(meta, 'xx')?.id).toBe('petrol');
    expect(sanitizeVehicle('petrol', meta)).toBeNull();
    expect(sanitizeVehicle('moto_125', meta)).toBe('moto_125');
    expect(sanitizeVehicle('xx', meta)).toBeNull();
    expect(selectedVehicle({}, 'petrol')).toBeNull();
  });
});

describe('véhicule dans l’URL (vh)', () => {
  it('écrit seulement hors défaut, relu tel quel', () => {
    expect(serializeScenario({ ...DEFAULT_SCENARIO, origin: '78418', mode: 'car', vehicle: 'moto_125' })).toContain('vh=moto_125');
    expect(serializeScenario({ ...DEFAULT_SCENARIO, origin: '78418', mode: 'car' })).not.toContain('vh=');
    expect(parseScenario('?o=78418&m=car&vh=diesel').vehicle).toBe('diesel');
    expect(parseScenario('?o=78418&m=car&vh=<x>').vehicle).toBeUndefined();
  });
});
