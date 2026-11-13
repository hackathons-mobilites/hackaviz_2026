import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { demoDataset } from './demo/generateDemo';
import { hasLineFacts, itinerariesSource, lineFactsShort, type ItinerariesFile, type ItinLeg, type ItinTrip } from './itineraries';
import { fetchGzJson, loadItineraries } from './loaders';
import { carCostText, modeComparison, modesAnchorNote, modeVerdict } from './modesCompare';
import { offpeakClock, offpeakFact } from './offpeak';
import type { AccessFile, Dataset, Meta } from './types';

/** Espaces insécables → espaces simples, pour lire les attendus */
const plain = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ');
const LONG_DASH = /[\u2013\u2014]/;

const leg = (o: Partial<ItinLeg>): ItinLeg => ({ m: 'rer', dep: '08:00', arr: '08:20', min: 20, dist_m: 9000, line: 'A', ...o });

describe('lignes utilisées : climatisation et ponctualité publiées (TRA03, QS01)', () => {
  it('version courte, jamais « non » pour « non renseignée »', () => {
    expect(plain(lineFactsShort(leg({ air_conditioning: 'true', punctuality: { value_pct: 89.4, month: '2026-09' } })))).toBe(
      'climatisation : oui · ponctualité : 89,4 % (septembre 2026)',
    );
    expect(plain(lineFactsShort(leg({ m: 'metro', line: '13', air_conditioning: null, punctuality: { value_pct: null, month: null, reason: 'no_open_data' } })))).toBe(
      'climatisation : non renseignée · ponctualité : pas de donnée ouverte',
    );
    expect(lineFactsShort(leg({}))).toBeNull(); // champs non exportés
    expect(lineFactsShort(leg({ m: 'walk', air_conditioning: 'true' }))).toBeNull();
    expect(hasLineFacts([leg({ m: 'walk' }), leg({ air_conditioning: 'false' })])).toBe(true);
    expect(hasLineFacts([leg({})])).toBe(false);
  });
});

const META = (o: Partial<Meta> = {}) =>
  ({ itineraries_communes: ['93048'], itineraries_format: { suffix: '.json.gz', encoding: 'gzip' }, ...o }) as Meta;

describe('itinéraires par réglage de marche (04/11)', () => {
  it('dossier et communes du réglage, rien sans annonce', () => {
    expect(itinerariesSource(META(), null)).toEqual({ dir: 'itineraries', communes: ['93048'], suffix: '.json.gz' });
    expect(itinerariesSource(META(), 'comfort')).toBeNull();
    const m = META({ itineraries_variants: { comfort: { dir: 'itineraries_walk1000', walk_setting: 'comfort', communes: ['75101'] } } });
    expect(itinerariesSource(m, 'comfort')).toEqual({ dir: 'itineraries_walk1000', communes: ['75101'], suffix: '.json.gz' });
    // dossier hors du motif attendu : refusé (aucune URL construite avec une valeur inattendue)
    expect(itinerariesSource(META({ itineraries_variants: { comfort: { dir: '../x', walk_setting: 'comfort', communes: [] } } }), 'comfort')).toBeNull();
    expect(itinerariesSource({} as Meta, null)).toBeNull();
    expect(itinerariesSource({ itineraries_communes: ['1'] } as Meta, null)?.suffix).toBe('.json');
  });

  const real = (meta: Partial<Meta>): Dataset => {
    const d = demoDataset('query');
    return { ...d, origin: 'real', demoReason: undefined, meta: { ...d.meta, ...meta } };
  };
  const file = { insee: '75101', contract: 'itineraries-2', poles: [], days: {} };

  it('fichier gzip décompressé ; fichier déjà décodé par le serveur lu tel quel', async () => {
    const gz = gzipSync(Buffer.from(JSON.stringify(file)));
    const bin = new Response(gz, { headers: { 'content-type': 'application/octet-stream' } });
    expect(await fetchGzJson('x', (async () => bin) as typeof fetch)).toEqual(file);
    const decoded = new Response(JSON.stringify(file), { headers: { 'content-type': 'application/json' } });
    expect(await fetchGzJson('x', (async () => decoded) as typeof fetch)).toEqual(file);
    const html = new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    expect(await fetchGzJson('x', (async () => html) as typeof fetch)).toBeNull();
    expect(await fetchGzJson('x', (async () => new Response('', { status: 404 })) as typeof fetch)).toBeNull();
  });

  it('réglage « confort » : URL du dossier annoncé, aucune requête pour une commune non annoncée', async () => {
    const urls: string[] = [];
    const fetcher = (async (u: string) => {
      urls.push(u);
      return new Response(gzipSync(Buffer.from(JSON.stringify(file))));
    }) as unknown as typeof fetch;
    const d = real({
      itineraries_communes: ['93048'],
      itineraries_format: { suffix: '.json.gz', encoding: 'gzip' },
      itineraries_variants: { comfort: { dir: 'itineraries_walk1000', walk_setting: 'comfort', communes: ['75101'] } },
    });
    expect(await loadItineraries(d, '75101', fetcher, 'comfort')).toEqual(file);
    expect(urls[0]).toMatch(/data\/itineraries_walk1000\/75101\.json\.gz$/);
    expect(await loadItineraries(d, '93048', fetcher, 'comfort')).toBeNull();
    expect(urls).toHaveLength(1);
  });
});

describe('heure creuse (offpeak, choix de l’équipe)', () => {
  const f = (o: Partial<ItinerariesFile['offpeak']> = {}): ItinerariesFile => ({
    insee: '93048',
    contract: 'itineraries-2',
    poles: ['P_A', 'P_B'],
    days: {},
    offpeak: { dep: '11:00', out: [38, null], ret: [41, null], reason: [null, 'no_trip_within_120'], ...o },
  });
  it('« en partant à 11h00 : aller N min, retour M min » et la phrase de garde', () => {
    expect(offpeakClock('11:00')).toBe('11h00');
    expect(offpeakClock('9:05')).toBe('9h05');
    expect(offpeakClock('25:00')).toBeNull();
    const a = offpeakFact(f(), 'P_A', 120)!;
    expect(plain(a.text)).toBe('En partant à 11h00 : aller 38 min, retour 41 min');
    expect(a.note).toMatch(/choisi par l’équipe \(pas une donnée\)/);
    expect(plain(offpeakFact(f(), 'P_B', 120)!.text)).toBe('En partant à 11h00 : aller : aucun trajet de 2 h ou moins, retour : aucun trajet de 2 h ou moins');
    expect(offpeakFact(f(), 'P_X', 120)).toBeNull();
    expect(offpeakFact({ ...f(), offpeak: undefined }, 'P_A', 120)).toBeNull();
    expect(offpeakFact(f({ out: [null, null], ret: [null, null], reason: ['not_computed', null] }), 'P_A', 120)).toBeNull();
    expect(LONG_DASH.test(a.text + a.note)).toBe(false);
  });
  it('garde de longueur : une série de heure creuse qui n’a pas autant de valeurs que d’astres du fichier est refusée', () => {
    expect(offpeakFact(f({ out: Array(44).fill(30), ret: Array(44).fill(30), reason: Array(44).fill(null) }), 'P_A', 120)).toBeNull();
    expect(offpeakFact(f({ out: [38], ret: [41], reason: [null] }), 'P_A', 120)).toBeNull();
    expect(offpeakFact(f({ reason: Array(15).fill(null) }), 'P_A', 120)).toBeNull();
  });
});

describe('comparer les modes', () => {
  const meta = {
    modes: [
      { id: 'transit', label: 'Transports en commun + marche' },
      { id: 'bike_transit', label: 'Vélo + transports en commun' },
      { id: 'bike', label: 'Vélo' },
      { id: 'car', label: 'Voiture (route vide)' },
      { id: 'velib', label: "Vélib'" },
    ],
    mode_coverage: { bike_transit: [], velib: ['75101'] },
    day_types: [{ id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' }],
  } as unknown as Meta;
  const access: AccessFile = {
    insee: '93048',
    processing_version: '0.1.0',
    modes: {
      transit: { d09: { out: [42, 70], ret: [44, 30], reason: [null, null] } },
      bike: { any: { out: [55, null], ret: [50, null], reason: [null, 'no_trip_within_120'] } },
      car: { any: { out: [30, 35], ret: [28, 33], reason: [null, null] } },
    },
    variants: { comfort: { transit: { d09: { out: [50, 80], ret: [48, 30], reason: [null, null] } } } },
  } as unknown as AccessFile;
  const trip = (cost: number, g: number): ItinTrip => ({
    status: 'ok',
    legs: [leg({})],
    tickets: { metro_train_rer: 1, bus_tram: 0, airport: 0, cost_eur: cost, status: 'ok' },
    co2_g: { value: g, status: 'ok' },
  });

  it('une ligne par mode publié, verdict au temps choisi, coût et carbone seulement s’ils sont publiés', () => {
    const r = modeComparison({ meta, access, insee: '93048', poleIndex: 0, polesCount: 2, day: 'd09', budget: 45, walkKey: null, currentMode: 'transit', transitTrips: { out: trip(2.55, 50), ret: trip(2.55, 48) } });
    expect(r.rows.map((x) => x.mode)).toEqual(['transit', 'bike', 'car']);
    expect(r.notComputed).toEqual(['Vélo + transports en commun', "Vélib'"]);
    const [tc, bike, car] = r.rows;
    expect(tc).toMatchObject({ out: 42, ret: 44, verdict: 'accessible', current: true });
    expect(plain(tc!.cost)).toBe('5,10 € au ticket');
    expect(plain(tc!.carbon)).toBe('98 g CO2e (estimation)'); // V4 (audit du 11/11)
    expect(bike).toMatchObject({ out: 55, ret: 50, verdict: 'none', cost: null, carbon: null });
    expect(car).toMatchObject({ verdict: 'accessible', cost: null, carbon: null }); // car_trip non publié
  });
  it('réglage « confort » appliqué au TC seulement ; « retour seulement »', () => {
    const r = modeComparison({ meta, access, insee: '93048', poleIndex: 1, polesCount: 2, day: 'd09', budget: 45, walkKey: 'comfort', currentMode: 'car', transitTrips: null });
    expect(r.rows[0]).toMatchObject({ mode: 'transit', out: 80, ret: 30, verdict: 'in_only', verdictText: 'Retour seulement', cost: null });
    expect(r.rows.find((x) => x.mode === 'car')!.current).toBe(true);
    expect(modeVerdict(40, 50, 45)).toBe('out_only');
    expect(modeVerdict(null, null, 45, 'not_computed')).toBe('unknown');
  });
  it('garde de longueur : des séries de 2 astres sur 44 (ou de 44 sur 2) sont refusées, « non calculé », jamais une valeur', () => {
    for (const n of [44, 15, 1, 3]) {
      const r = modeComparison({ meta, access, insee: '93048', poleIndex: 0, polesCount: n, day: 'd09', budget: 45, walkKey: null, currentMode: 'transit', transitTrips: null });
      expect(r.rows, `n = ${n}`).toEqual([]);
      expect(r.notComputed.length, `n = ${n}`).toBe(5);
    }
    // série de 44 lue sur 2 astres
    const long = { ...access, modes: { transit: { d09: { out: Array(44).fill(10), ret: Array(44).fill(10), reason: Array(44).fill(null) } } } } as unknown as AccessFile;
    const r = modeComparison({ meta, access: long, insee: '93048', poleIndex: 0, polesCount: 2, day: 'd09', budget: 45, walkKey: null, currentMode: 'transit', transitTrips: null });
    expect(r.rows.find((x) => x.mode === 'transit')).toBeUndefined();
  });
  it('coût voiture : seulement depuis car_trip publié (énergie seule des voitures, péages non comptés)', () => {
    const m = {
      ...meta,
      vehicles: [
        { id: 'petrol', label: 'Voiture essence', family: 'car', cost_eur_per_km: 0.12 },
        { id: 'moto_125', label: 'Scooter ou moto 125 cm3', family: 'two_wheeler', cost_eur_per_km: 0.05 },
      ],
    } as unknown as Meta;
    expect(carCostText(m, access, 0, 2)).toBeNull();
    const withTrip = { ...access, car_trip: { dist_m: { out: [10000, null], ret: [12000, null] }, reason: { out: [null, 'no_route'], ret: [null, 'no_route'] } } } as unknown as AccessFile;
    expect(plain(carCostText(m, withTrip, 0, 2))).toBe('Énergie seule, péages non comptés : essence 2,64 €'); // 1,20 + 1,44 ; les deux-roues ont leur bloc
    expect(carCostText(m, withTrip, 1, 2)).toBeNull();
    // garde de longueur : 2 distances ne servent pas 44 ni 15 astres
    expect(carCostText(m, withTrip, 0, 44)).toBeNull();
    expect(carCostText(m, withTrip, 0, 15)).toBeNull();
  });
  it('commune par commune (table OD) : phrase d’arrêt d’ancrage, sans verdict annoncé', () => {
    const t = modesAnchorNote('Gare du Nord', '9h-17h');
    expect(t).toContain('vers Gare du Nord, l\'arrêt le plus desservi du pôle, journée 9h-17h');
    expect(t).toContain('aucun verdict');
    expect(modesAnchorNote(null, null)).toContain("vers l'arrêt le plus desservi du pôle.");
  });
});
