/**
 * JEU DE DONNÉES DÉMO - CHIFFRES FICTIFS.
 * Noms de pôles et de communes réels, coordonnées approximatives, mais postes et temps de
 * trajet tirés au hasard (aléatoire déterministe). Activé uniquement par ?demo=1 ou si
 * public/data/meta.json est absent, TOUJOURS avec le bandeau « DONNÉES FICTIVES ».
 */
import { hashString, mulberry32 } from '../../utils/rng';
import type { AccessFile, AccessSeries, Commune, Dataset, DayTypeId, Meta, NullReason, Pole } from '../types';

type DemoPole = [id: string, name: string, lon: number, lat: number, x: number, y: number, weight: number];

// Positions « sky » schématiques posées à la main (géographie respectée dans les grandes lignes).
// Panier réduit, propre au mode démo : ces identifiants ne sont pas ceux de poles.json ; postes et temps FICTIFS.
const DEMO_POLES: DemoPole[] = [
  ['P_PARIS_QCA', 'Paris - Quartier central des affaires', 2.32, 48.874, 0.47, 0.37, 1.0],
  ['P_PARIS_RG', 'Paris Rive Gauche', 2.376, 48.83, 0.56, 0.5, 0.35],
  ['P_PARIS_MONTPARNASSE', 'Paris Montparnasse', 2.321, 48.842, 0.43, 0.52, 0.4],
  ['P_DEFENSE', 'La Défense', 2.238, 48.892, 0.32, 0.34, 0.75],
  ['P_BOULOGNE', 'Boulogne - Issy', 2.255, 48.83, 0.31, 0.56, 0.3],
  ['P_PLAINE', 'Plaine Saint-Denis', 2.36, 48.915, 0.54, 0.22, 0.3],
  ['P_ROISSY', 'Roissy - CDG', 2.55, 49.004, 0.72, 0.1, 0.4],
  ['P_ORLY', 'Orly - Rungis', 2.36, 48.746, 0.54, 0.75, 0.3],
  ['P_MARNE', 'Marne-la-Vallée', 2.66, 48.85, 0.8, 0.46, 0.28],
  ['P_SACLAY', 'Saclay - Massy', 2.2, 48.72, 0.37, 0.8, 0.22],
  ['P_SQY', 'Saint-Quentin-en-Yvelines', 2.04, 48.78, 0.17, 0.66, 0.25],
  ['P_CERGY', 'Cergy-Pontoise', 2.07, 49.04, 0.17, 0.17, 0.22],
  ['P_EVRY', 'Évry - Courcouronnes', 2.44, 48.63, 0.66, 0.92, 0.2],
  ['P_CRETEIL', 'Créteil', 2.46, 48.78, 0.64, 0.66, 0.12],
  ['P_VERSAILLES', 'Versailles / Vélizy', 2.17, 48.8, 0.27, 0.6, 0.15],
];

type DemoCommune = [insee: string, name: string, dep: string, lon: number, lat: number];

const DEMO_COMMUNES: DemoCommune[] = [
  ['75113', 'Paris 13e Arrondissement', '75', 2.362, 48.828],
  ['75118', 'Paris 18e Arrondissement', '75', 2.348, 48.892],
  ['75120', 'Paris 20e Arrondissement', '75', 2.401, 48.863],
  ['93066', 'Saint-Denis', '93', 2.357, 48.936],
  ['93048', 'Montreuil', '93', 2.443, 48.861],
  ['93008', 'Bobigny', '93', 2.44, 48.908],
  ['93014', 'Clichy-sous-Bois', '93', 2.553, 48.91],
  ['93071', 'Sevran', '93', 2.527, 48.939],
  ['93005', 'Aulnay-sous-Bois', '93', 2.497, 48.938],
  ['93051', 'Noisy-le-Grand', '93', 2.553, 48.848],
  ['95018', 'Argenteuil', '95', 2.247, 48.947],
  ['95127', 'Cergy', '95', 2.064, 49.036],
  ['95500', 'Pontoise', '95', 2.099, 49.051],
  ['95268', 'Garges-lès-Gonesse', '95', 2.401, 48.973],
  ['92050', 'Nanterre', '92', 2.206, 48.892],
  ['92012', 'Boulogne-Billancourt', '92', 2.24, 48.835],
  ['92004', 'Asnières-sur-Seine', '92', 2.285, 48.914],
  ['94028', 'Créteil', '94', 2.455, 48.79],
  ['94081', 'Vitry-sur-Seine', '94', 2.392, 48.787],
  ['94041', 'Ivry-sur-Seine', '94', 2.384, 48.813],
  ['94054', 'Orly', '94', 2.393, 48.744],
  ['77284', 'Meaux', '77', 2.878, 48.96],
  ['77288', 'Melun', '77', 2.655, 48.539],
  ['77186', 'Fontainebleau', '77', 2.701, 48.405],
  ['77379', 'Provins', '77', 3.299, 48.56],
  ['77108', 'Chelles', '77', 2.591, 48.881],
  ['77468', 'Torcy', '77', 2.651, 48.85],
  ['78646', 'Versailles', '78', 2.13, 48.805],
  ['78361', 'Mantes-la-Jolie', '78', 1.717, 48.991],
  ['78498', 'Poissy', '78', 2.044, 48.929],
  ['78517', 'Rambouillet', '78', 1.835, 48.644],
  ['78423', 'Montigny-le-Bretonneux', '78', 2.033, 48.771],
  ['91228', 'Évry-Courcouronnes', '91', 2.44, 48.629],
  ['91377', 'Massy', '91', 2.271, 48.73],
  ['91223', 'Étampes', '91', 2.161, 48.435],
  ['91174', 'Corbeil-Essonnes', '91', 2.483, 48.611],
];

const PARIS = { lon: 2.3488, lat: 48.8534 };

/** Projection « fisheye » douce : Paris au centre, grande couronne comprimée vers les bords. */
export function demoSkyPosition(lon: number, lat: number): { x: number; y: number } {
  const dx = (lon - PARIS.lon) * Math.cos((PARIS.lat * Math.PI) / 180);
  const dy = lat - PARIS.lat;
  const r = Math.hypot(dx, dy);
  if (r === 0) return { x: 0.48, y: 0.45 };
  const rr = 0.52 * Math.pow(Math.min(r / 0.8, 1), 0.62);
  const x = 0.48 + (dx / r) * rr * 1.0;
  const y = 0.45 - (dy / r) * rr * 0.95;
  const clamp = (v: number) => Math.min(0.97, Math.max(0.03, v));
  return { x: clamp(x), y: clamp(y) };
}

function km(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const DAYS: DayTypeId[] = ['d06', 'd09', 'd14'];
/** Plafond des durées FICTIVES (au-delà : null, comme `no_trip_within_120` du pipeline) */
const DEMO_MAX_TRIP = 120;

export const DEMO_META: Meta = {
  processing_version: 'demo',
  generated_at: '2026-11-02T00:00:00Z',
  service_date: 'fictif',
  gtfs_downloaded_at: 'fictif',
  day_types: [
    { id: 'd06', label: '6h-14h', start: '06:00', end: '14:00' },
    { id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' },
    { id: 'd14', label: '14h-22h', start: '14:00', end: '22:00' },
  ],
  budgets: [30, 45, 60],
  modes: [
    { id: 'transit', label: 'Transports en commun + marche' },
    { id: 'bike_transit', label: 'Vélo + transports en commun' },
    { id: 'bike', label: 'Vélo' },
    { id: 'walk', label: 'Marche' },
    { id: 'car', label: 'Voiture (sans trafic)' },
  ],
  story_communes: ['93066', '77186', '95018'],
  // Même forme que le meta.json du pipeline (jauge du budget, D-018) : horizon = plafond des durées
  // tirées ci-dessous (DEMO_MAX_TRIP), pas = celui de la grille des départs aller du calcul réel.
  max_trip_min: DEMO_MAX_TRIP,
  outbound_step_min: 5,
  sources: 'sources.json',
};

export function demoPoles(): Pole[] {
  const rnd = mulberry32(hashString('starway-demo-poles'));
  return DEMO_POLES.map(([id, name, lon, lat, x, y, weight]) => ({
    id,
    name,
    communes: [],
    // Postes FICTIFS : ordre de grandeur plausible, valeur aléatoire.
    jobs: Math.round((weight * 380_000 + rnd() * 60_000) / 100) * 100,
    jobs_year: 2023,
    jobs_source: 'DÉMO (fictif)',
    point: { lon, lat, method: 'démo' },
    sky: { x, y },
  }));
}

export function demoCommunes(): Commune[] {
  return DEMO_COMMUNES.map(([insee, name, dep, lon, lat]) => ({
    insee,
    name,
    dep,
    lon,
    lat,
    population: null,
    sky: demoSkyPosition(lon, lat),
  }));
}

function cap(v: number): number | null {
  const r = Math.round(v);
  return r > DEMO_MAX_TRIP ? null : Math.max(3, r);
}

/** Temps de trajet FICTIFS pour une commune (déterministes). */
export function demoAccess(insee: string, poles: readonly Pole[], communes: readonly Commune[]): AccessFile | null {
  const c = communes.find((x) => x.insee === insee);
  if (!c) return null;
  const rnd = mulberry32(hashString(`starway-demo-access-${insee}`));
  const outer = ['77', '78', '91', '95'].includes(c.dep) ? 8 : c.dep === '75' ? -4 : 0;
  const dists = poles.map((p) => km(c.lon, c.lat, p.point.lon, p.point.lat));

  const transit: Partial<Record<DayTypeId, AccessSeries>> = {};
  const bikeTransit: Partial<Record<DayTypeId, AccessSeries>> = {};
  const baseNoise = dists.map(() => (rnd() - 0.5) * 16);
  for (const day of DAYS) {
    const out: (number | null)[] = [];
    const ret: (number | null)[] = [];
    const reason: (NullReason | null)[] = [];
    const outB: (number | null)[] = [];
    const retB: (number | null)[] = [];
    const reasonB: (NullReason | null)[] = [];
    dists.forEach((d, i) => {
      const base = 14 + d * 2.1 + outer + baseNoise[i]!;
      const early = day === 'd06' ? 6 + rnd() * 10 : 0;
      const late = day === 'd14' ? 8 + rnd() * 22 : 0;
      const o = cap(base + early + (rnd() - 0.5) * 6);
      const lateNoService = day === 'd14' && outer > 0 && rnd() < 0.25;
      const r = lateNoService ? null : cap(base + late + (rnd() - 0.5) * 8);
      out.push(o);
      ret.push(r);
      reason.push(o == null ? 'no_trip_within_120' : r == null ? (lateNoService ? 'no_service_at_hour' : 'no_trip_within_120') : null);
      const gain = rnd() < 0.4 ? 4 + rnd() * 12 : 0;
      const ob = o == null ? null : cap(o - gain);
      const rb = r == null ? null : cap(r - gain);
      outB.push(ob);
      retB.push(rb);
      reasonB.push(ob == null || rb == null ? 'no_trip_within_120' : null);
    });
    // Départ aller FICTIF : le plus tardif sur une grille de 5 min qui arrive avant le début du poste.
    const startMin = Number(DEMO_META.day_types.find((d) => d.id === day)!.start.slice(0, 2)) * 60;
    const depOf = (o: number | null): string | null => {
      if (o == null) return null;
      const t = Math.floor((startMin - o) / 5) * 5;
      return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    };
    transit[day] = { out, ret, reason, dep: out.map(depOf) };
    bikeTransit[day] = { out: outB, ret: retB, reason: reasonB, dep: outB.map(depOf) };
  }
  const anySeries = (speedMinPerKm: number, fixed: number): AccessSeries => {
    const v = dists.map((d) => cap(fixed + d * speedMinPerKm));
    return { out: v, ret: [...v], reason: v.map((x) => (x == null ? 'no_trip_within_120' : null)) };
  };
  const modes: AccessFile['modes'] = {
    transit,
    bike_transit: bikeTransit,
    bike: { any: anySeries(4, 4) },
    walk: { any: anySeries(12, 2) },
    car: { any: anySeries(1.5, 9) },
  };
  return { insee, processing_version: 'demo', modes };
}

export function demoDataset(reason: 'query' | 'missing_meta'): Dataset {
  return {
    origin: 'demo',
    demoReason: reason,
    meta: DEMO_META,
    poles: demoPoles(),
    communes: demoCommunes(),
    insights: [],
    sources: [],
  };
}

