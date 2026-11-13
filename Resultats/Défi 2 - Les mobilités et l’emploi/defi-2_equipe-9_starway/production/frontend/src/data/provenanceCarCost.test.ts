import { describe, expect, it } from 'vitest';
import { carCostProvenance } from './provenanceCarCost';
import type { Meta, ModeId, SourceEntry, TollsFile, VehicleMeta } from './types';

/** Mode motorisé du scénario et meta (seul `velib` est lu, pour le réseau routier du calcul) */
const CTX = { mode: 'car' as ModeId, meta: {} as Pick<Meta, 'velib'> };

/** Entrées réduites, recopiées de la forme publiée dans sources.json (titres et millésimes du manifeste). */
const SOURCES: SourceEntry[] = [
  { source_id: 'COST08', titre: 'SDES - Bilan annuel des transports en 2024 (rapport complet, 220 pages)', url_source: 'u', millesime: '2024', date_extraction: '2026-11-03T21:40Z', licence: 'LO' },
  { source_id: 'COST07', titre: 'Ministère de l\'Économie - Prix des carburants en France, flux instantané v2', url_source: 'u', date_extraction: '2026-11-03T21:41Z', licence: 'LO' },
  { source_id: 'ENV02', titre: 'ADEME - Base Carbone V23.6 (facteurs d\'émission de la Base Empreinte), fichier complet', url_source: 'u', millesime: 'V23.6', date_extraction: '2026-11-03T21:42Z', licence: 'LO' },
  { source_id: 'VEH01', titre: 'ADEME - 2RM : mise à jour des connaissances', url_source: 'u', millesime: '2023', licence: 'LO' },
  { source_id: 'CYC01', titre: 'OpenStreetMap - extrait Île-de-France (Geofabrik)', url_source: 'u', date_extraction: '2026-10-30T10:00Z', licence: 'ODbL', traitements: 'aucun (entrée directe de r5py)' },
  { source_id: 'TOLL01', titre: 'data.gouv.fr - Autoroutes et péages en flux libre (portiques free flow)', url_source: 'u', date_extraction: '2026-11-03T21:46Z', licence: 'LO' },
  { source_id: 'TOLL04', titre: 'VINCI Autoroutes - tarifs Duplex A86 2026 et Cofiroute 2026', url_source: 'u', millesime: '2026', licence: 'LO' },
];

const vehicle = {
  consumption_source: { source_id: 'COST08', year: 2024, text: 'SDES' },
  price_source: { source_id: 'COST07', text: 'médiane' },
  co2_source: { source_id: 'ENV02', version: 'V23.6', element_id: '13988', name: 'Essence', unit: 'kgCO2e/litre', total: 2.69 },
} as unknown as Pick<VehicleMeta, 'consumption_source' | 'price_source' | 'co2_source'>;
const tolls = { sources: [{ source_id: 'TOLL01' }, { source_id: 'TOLL04' }, { source_id: 'TOLL01' }, { source_id: 'TOLL99' }] } as unknown as Pick<TollsFile, 'sources'>;

const codes = (parts: ReturnType<typeof carCostProvenance>) => parts.map((p) => [p.lead, p.tags.map((t) => t.code)]);

describe('carCostProvenance', () => {
  it('cite consommation, prix, carbone, distances et péages avec leur fiche', () => {
    const parts = carCostProvenance(SOURCES, { vehicle, tolls, withTrip: true, ...CTX });
    expect(codes(parts)).toEqual([
      ['Consommation', ['COST08']],
      ["Prix de l'énergie", ['COST07']],
      ['Carbone', ['ENV02']],
      ['Distances routières', ['CYC01']],
      ['Péages', ['TOLL01', 'TOLL04']], // sans doublon, TOLL99 absent de sources.json : rien d'inventé
    ]);
    const conso = parts[0]!.tags[0]!;
    expect(conso.text).toBe('SDES 2024 (COST08)');
    expect(conso.anchor).toBe('fiche-COST08');
    expect(parts[3]!.engine).toBe('calcul r5py');
    expect(parts.every((p) => p.tags.every((t) => t.anchor === `fiche-${t.code}`))).toBe(true);
  });

  it('deux-roues : la consommation vient de VEH01 (ADEME 2023), pas du SDES', () => {
    const moto = { ...vehicle, consumption_source: { source_id: 'VEH01', year: 2023, text: 'ADEME' } } as typeof vehicle;
    const parts = carCostProvenance(SOURCES, { vehicle: moto, tolls, withTrip: true, ...CTX });
    expect(parts[0]!.tags[0]).toMatchObject({ code: 'VEH01', period: '2023' });
  });

  it('sans distances routières publiées : ni distances ni péages cités', () => {
    expect(codes(carCostProvenance(SOURCES, { vehicle, tolls, withTrip: false, ...CTX })).map((x) => x[0])).toEqual(['Consommation', "Prix de l'énergie", 'Carbone']);
  });

  it('tolls.json pas chargé : pas de source de péage', () => {
    expect(carCostProvenance(SOURCES, { vehicle, tolls: null, withTrip: true, ...CTX }).some((p) => p.lead === 'Péages')).toBe(false);
  });

  it('un code absent de sources.json ne produit rien', () => {
    expect(carCostProvenance([], { vehicle, tolls, withTrip: true, ...CTX })).toEqual([]);
  });
});
