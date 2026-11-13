/**
 * Audit d'affichage du 10/11, lot 4 (demande de Nicolas) : sans le mode sources, l'information seulement ; la méthode dans un « i ».
 * - « Comparer les moyens » : le carbone voiture est calculé (car_trip x facteur ADEME, comme « Coût et carbone »), plus jamais
 *   « non publié » à tort ; une phrase au plus sous le tableau, la méthode dans le « i » ; les modes non calculés, pli ouvert seulement ;
 * - heure creuse : la valeur visible, « choisi par l'équipe » dans le « i » ;
 * - voiture : le total et le carbone visibles, avec « estimation, énergie seule » et « pas commune par commune » ; ce qui est compté dans le « i » ;
 * FIXTURES : format des contrats, valeurs d'exemple (pas des données publiées).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { carCarbonText, carCostText, modeComparison, modesAnchorNote, MODES_ANCHOR_TAIL, splitAnchorNote } from '../../data/modesCompare';
import { modesParts } from '../../data/provenance';
import type { AccessFile, Dataset, Meta, SourceEntry, TollsFile, VehicleMeta } from '../../data/types';
import { DEFAULT_SCENARIO } from '../../state/scenario';
import { CarCostView } from './ProofCarCost';
import { ProofModes } from './ProofModes';
import { ProofOffpeak } from './ProofOffpeak';

const prov = vi.hoisted(() => ({ on: false }));
vi.mock('../../store/provenanceStore', () => ({ useProvenanceStore: (select: (s: { on: boolean }) => unknown) => select({ on: prov.on }) }));

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ');
const LONG_DASH = /[\u2013\u2014]/;
/** Texte lu sans rien ouvrir : le contenu des bulles « i » (span.info-pop) est retiré */
const outsideTips = (html: string) => html.replace(/<span[^>]*class="info-pop"[^>]*>[\s\S]*?<\/span><\/span><\/span>/g, '');
const insideTips = (html: string) => (html.match(/<span[^>]*class="info-pop"[^>]*>[\s\S]*?<\/span><\/span><\/span>/g) ?? []).join(' ');
const text = (html: string) => plain(html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')).replace(/ +/g, ' ');

const vehicle = (o: Partial<VehicleMeta>): VehicleMeta =>
  ({
    family: 'car', energy: 'SP95-E10', unit: 'L', consumption_per_100km: 6, consumption_source: { source_id: 'COST08', year: 2024, text: 'SDES' },
    price_eur_per_unit: 2, price_source: { source_id: 'COST07', text: 'médiane' }, cost_eur_per_km: 0.12, toll_class: 1, co2_kg_per_km: 0.1614,
    co2_kg_per_unit: 2.69, co2_source: { source_id: 'ENV02', version: 'V23.6', element_id: '13988', name: 'Essence ; E10', unit: 'kgCO2e/litre', total: 2.69 }, status: 'ok',
    ...o,
  }) as VehicleMeta;

const META = {
  modes: [
    { id: 'transit', label: 'Transports en commun + marche' },
    { id: 'car', label: 'Voiture (route vide)' },
    { id: 'velib', label: "Vélib'" },
  ],
  mode_coverage: { velib: ['75111'] },
  day_types: [{ id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' }],
  service_date: '2026-11-17',
  vehicles: [
    vehicle({ id: 'petrol', label: 'Voiture essence' }),
    vehicle({ id: 'electric', label: 'Voiture électrique', co2_kg_per_km: 0.009, cost_eur_per_km: 0.035 }),
    vehicle({ id: 'moto_125', label: 'Scooter ou moto 125 cm3', family: 'two_wheeler', toll_class: 5, co2_kg_per_km: 0.0715 }),
  ],
  car_costs: {
    formula: 'f', label: 'Énergie et péages', not_included: ['stationnement', 'assurance'], rounding: 'r',
    carbon: { formula: 'f', unit: 'g CO2e', rounding: 'r', occupancy: 'une personne seule dans le véhicule', perimeter: 'énergie seule', tc_comparison: 'ordre de grandeur', source_id: 'ENV02' },
    distances: { status: 'ok' }, tolls: { status: 'ok', file: 'tolls.json' },
  },
} as unknown as Meta;

const ACCESS = {
  insee: '93048', processing_version: 't',
  modes: {
    transit: { d09: { out: [42, 70], ret: [44, 30], reason: [null, null] } },
    car: { any: { out: [30, 35], ret: [28, 33], reason: [null, null] } },
  },
  car_trip: { dist_m: { out: [10_000, null], ret: [12_000, null] }, reason: { out: [null, 'no_route'], ret: [null, 'no_route'] } },
} as unknown as AccessFile;

const TOLLS = {
  contract: 'tolls-1', processing_version: 't', service_date: '2026-11-17', days: {}, points: [], grids: [], status_texts: {},
  classes: { '1': 'véhicules légers', '5': 'motos' }, tariffs: {}, rule: { price: 'un prix par tranche' }, not_applied: [], sources: [],
} as unknown as TollsFile;
const CAR_ACCESS = {
  insee: '78418', processing_version: 't',
  modes: { car: { any: { out: [40], ret: [40], reason: [null] } } },
  car_trip: { dist_m: { out: [10_000], ret: [12_345] }, reason: { out: [null], ret: [null] }, toll: { out: [[]], ret: [[]] } },
} as unknown as AccessFile;

describe('« Comparer les moyens » : carbone voiture calculé (phrase fausse corrigée)', () => {
  it('voitures seulement, même calcul que « Coût et carbone » (distance x facteur au km, arrondi après la somme)', () => {
    // essence : (10 000 + 12 000) x 0,1614 = 3 550,8 g ; électrique : 22 000 x 0,009 = 198 g ; le deux-roues a son bloc (Duplex A86)
    expect(plain(carCarbonText(META, ACCESS, 0, 2))).toBe('essence 3 551 g ; électrique 198 g CO2e (estimation, énergie seule)');
    expect(carCarbonText(META, ACCESS, 1, 2)).toBeNull(); // aucune distance : rien d'inventé
    expect(carCarbonText(META, { ...ACCESS, car_trip: undefined } as AccessFile, 0, 2)).toBeNull();
    expect(carCarbonText(META, ACCESS, 0, 44)).toBeNull(); // garde de longueur
    expect(carCarbonText({ vehicles: [vehicle({ id: 'x', label: 'Voiture x', co2_kg_per_km: null as unknown as number })] }, ACCESS, 0, 2)).toBeNull();
  });
  it('la ligne voiture porte coût ET carbone ; la ligne TC garde son carbone ENV01', () => {
    const r = modeComparison({ meta: META, access: ACCESS, insee: '93048', poleIndex: 0, polesCount: 2, day: 'd09', budget: 45, walkKey: null, currentMode: 'car', transitTrips: null });
    const car = r.rows.find((x) => x.mode === 'car')!;
    expect(plain(car.cost)).toBe(plain(carCostText(META, ACCESS, 0, 2)));
    expect(plain(car.carbon)).toContain('essence 3 551 g');
    expect(r.rows.find((x) => x.mode === 'transit')!.carbon).toBeNull(); // pas d'itinéraire publié ici
    expect(r.notComputed).toEqual(["Vélib'"]);
  });
  it('provenance : « Carbone voiture » cite le code publié dans meta.car_costs.carbon, « Carbone des transports en commun » seulement si les transports en commun ont un carbone', () => {
    const sources = [{ source_id: 'ENV02', titre: 'ADEME - Base Carbone V23.6', url_source: 'u', millesime: 'V23.6', licence: 'LO' }] as SourceEntry[];
    const ds: Pick<Dataset, 'origin' | 'meta' | 'sources' | 'poles'> = { origin: 'real', meta: META, sources, poles: [] };
    const parts = modesParts(ds, [
      { mode: 'transit', cost: null, carbon: null },
      { mode: 'car', cost: null, carbon: 'essence 3 551 g CO2e (estimation, énergie seule)' },
    ]);
    // (aucune source de durée dans cette fixture : la partie « Durées » est vide et retirée)
    expect(parts.map((p) => p.lead)).toEqual(['Carbone voiture']);
    expect(parts[0]!.tags.map((t) => t.code)).toEqual(['ENV02']);
    expect(modesParts(ds, [{ mode: 'car', cost: null, carbon: null }])).toEqual([]);
  });
});

describe('« Comparer les moyens » : une phrase au plus, la méthode dans le « i »', () => {
  const data = modeComparison({ meta: META, access: ACCESS, insee: '93048', poleIndex: 0, polesCount: 2, day: 'd09', budget: 45, walkKey: null, currentMode: 'transit', transitTrips: null });
  const render = (anchorNote: string | null) =>
    renderToStaticMarkup(createElement(ProofModes, { data, budget: 45, onShow: () => {}, vehicleNote: 'stationnement, assurance', anchorNote, inFold: true }));

  it('hors table OD : aucune phrase de méthode visible, tout est dans « Ce que compte ce tableau »', () => {
    const html = render(null);
    const seen = text(outsideTips(html));
    expect(seen).not.toContain('Coût des transports en commun');
    expect(seen).not.toContain('Mêmes durées');
    expect(seen).not.toContain('TC seulement');
    expect(seen).toContain("Non calculés pour cette commune : Vélib'"); // pli ouvert : dit pourquoi la ligne manque
    const tip = text(insideTips(html));
    expect(html).toContain('aria-label="Ce que compte ce tableau"');
    expect(tip).toContain('Mêmes durées que le ciel de chaque mode');
    expect(tip).toContain('Coût des transports en commun : prix au ticket');
    expect(tip).not.toMatch(/\bTC\b/); // retour de Cyril (11/11) : pas de sigle
    expect(tip).toContain('(non compté : stationnement, assurance)');
    expect(tip).toContain('« Non publié » : aucune valeur dans les données, rien n’est estimé.');
    expect(tip).not.toContain('TC seulement');
    expect(html).toContain('(estimation, énergie seule)'); // la case carbone de la voiture
    expect(html).not.toMatch(LONG_DASH);
  });
  it('table OD (audit du 11/11, M7) : les deux phrases (vers quel arrêt, pourquoi pas de verdict) sont dans le « i », la première en tête', () => {
    const note = modesAnchorNote('La Défense', '9h-17h');
    expect(splitAnchorNote(note)).toEqual({ lead: "Durées vers La Défense, l'arrêt le plus desservi du pôle, journée 9h-17h.", tail: MODES_ANCHOR_TAIL });
    expect(splitAnchorNote('autre phrase')).toEqual({ lead: 'autre phrase', tail: null });
    const html = render(note);
    expect(text(outsideTips(html))).not.toContain('Durées vers La Défense');
    expect(text(outsideTips(html))).not.toContain('aucun verdict');
    const tip = text(insideTips(html));
    const lead = tip.indexOf("Durées vers La Défense, l'arrêt le plus desservi du pôle, journée 9h-17h.");
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(tip.indexOf("c'est pourquoi aucun verdict n'est donné ici")).toBeGreaterThan(lead);
  });
});

describe('heure creuse : la valeur visible, « choisi par l’équipe » dans le « i »', () => {
  it('rend la phrase de la donnée et range la garde, mots inchangés', () => {
    const fact = { text: 'En partant à 11h00 : aller 42 min, retour 40 min', note: 'Heure creuse : départ à 11h00 choisi par l’équipe (pas une donnée), dans les deux sens. Le verdict du ciel reste celui des horaires de la journée-type.' } as Parameters<typeof ProofOffpeak>[0]['fact'];
    const html = renderToStaticMarkup(createElement(ProofOffpeak, { fact, anchorNote: null }));
    expect(text(outsideTips(html))).toContain('En partant à 11h00 : aller 42 min, retour 40 min');
    expect(text(outsideTips(html))).not.toContain('choisi par');
    expect(text(insideTips(html))).toContain(fact.note);
  });
});

describe('voiture : coût et carbone, le total visible, ce qui est compté dans le « i »', () => {
  const render = (vehicleId: string, sourcesOn = false) =>
    renderToStaticMarkup(
      createElement(CarCostView, { meta: META, access: CAR_ACCESS, poleIndex: 0, polesCount: 1, scenario: { ...DEFAULT_SCENARIO, mode: 'car', vehicle: vehicleId }, tolls: TOLLS, sources: [], sourcesOn }),
    );
  for (const id of ['petrol', 'electric']) {
    it(`${id} : total et carbone (estimation, énergie seule) visibles ; « pas commune par commune » et méthode dans « Ce qui est compté »`, () => {
      const html = render(id);
      const seen = text(outsideTips(html));
      // D-066 : le total et le carbone aller et retour en tuiles (chiffre en grand, garde courte dessous)
      expect(seen).toMatch(/Aller et retour\s*[\d\s,]+€\s*énergie et péages/);
      expect(seen).toMatch(/Carbone aller et retour\s*[\d\s]+g CO2e\s*estimation, énergie seule/);
      // Audit d'affichage du 11/11 (K18) : la portée passe en tête du « i » ; écrite en clair en mode sources
      expect(seen).not.toContain("Vers le point d'arrivée du pôle, pas commune par commune.");
      const tipText = text(insideTips(html));
      expect(tipText.indexOf("Vers le point d'arrivée du pôle, pas commune par commune.")).toBeGreaterThanOrEqual(0);
      expect(tipText.indexOf("Vers le point d'arrivée du pôle, pas commune par commune.")).toBeLessThan(tipText.indexOf('Non compté'));
      expect(text(outsideTips(render(id, true)))).toContain("Vers le point d'arrivée du pôle, pas commune par commune.");
      for (const gone of ['Non compté', 'une personne seule', 'Énergie :', 'Distance routière', 'classe 1']) expect(seen, gone).not.toContain(gone);
      expect(html).toContain('aria-label="Ce qui est compté"');
      const tip = text(insideTips(html));
      expect(tip).toContain('Non compté : stationnement, assurance.');
      expect(tip).toContain('Carbone : une personne seule dans le véhicule ; énergie seule');
      expect(tip).toContain('Énergie : 6 L/100 km x');
      expect(tip).toContain('Distance routière R5. Péages : classe 1 (véhicules légers)');
      expect(tip).not.toContain('SDES'); // sources : mode sources seulement
      expect(html).not.toMatch(LONG_DASH);
    });
  }
  it('mode sources : les sources reviennent dans le « i »', () => {
    expect(text(insideTips(render('petrol', true)))).toContain('(SDES)');
  });
});
