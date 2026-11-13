/**
 * Synchronisation état ↔ URL : ?o=<insee>&d=<d06|d09|d14>&b=<minutes>&m=<mode>&vs=<insee>&p=<poleId>&h=<halo>&w=<réglage>
 * `w` : réglage de marche des TC (D-024, id de meta.walk_settings.settings), écrit seulement hors défaut.
 * `vh` : véhicule du coût en voiture (D-029, id de meta.vehicles), écrit seulement hors défaut.
 * `s` / `e` : horaires libres (D-019), début et fin du poste en HHMM (`s=0900&e=1700`), écrits
 * seulement s'ils diffèrent d'une journée-type (une journée-type reste `d`, sans `s` ni `e`). Poste de
 * nuit : `e` AVANT `s` est le lendemain matin (`s=2200&e=0600`, début à 21h ou après, fin à 7h au plus
 * tard) ; toute autre fin avant le début est ignorée, puis le scénario revient à la journée-type.
 * `b` : tout entier positif est lu ici, sans borne écrite en dur ; sanitizeScenario le ramène sur la
 * grille de meta.json (pas `outbound_step_min`, bornes [pas, `max_trip_min`], D-018).
 * Vue : &v=map (carte miroir), hors scénario.
 * Les autres paramètres (demo, tour, record…) sont conservés tels quels.
 */
import type { DayTypeId, ModeId } from '../data/types';
import { isNightShape } from '../data/od/shift';
import { DEFAULT_SCENARIO, type Scenario } from './scenario';

const DAY_IDS: readonly string[] = ['d06', 'd09', 'd14'];
const MODE_IDS: readonly string[] = ['transit', 'bike_transit', 'bike', 'walk', 'car', 'car_traffic', 'velib'];
const HALO_IDS: readonly string[] = ['age', 'commute', 'income', 'unemployment'];
const SCENARIO_KEYS = ['o', 'd', 'b', 'm', 'vs', 'p', 'h', 'w', 's', 'e', 'vh'] as const;

/** « 0900 » ou « 09:00 » → 540 ; null si illisible (heures 0-24, minutes 0-59). */
export function parseHhmm(v: string | null): number | null {
  const m = v ? /^(\d{2}):?(\d{2})$/.exec(v) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** 540 → « 0900 » */
export function formatHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

export function parseScenario(search: string, base: Scenario = DEFAULT_SCENARIO): Scenario {
  const q = new URLSearchParams(search);
  const o = q.get('o');
  const d = q.get('d');
  const b = Number(q.get('b'));
  const m = q.get('m');
  const vs = q.get('vs');
  const p = q.get('p');
  // `h=sex` des anciens liens : l'onglet « Population par sexe » est retiré (D-026), ramené à l'âge
  const h = q.get('h') === 'sex' ? 'age' : q.get('h');
  const w = q.get('w');
  const s = parseHhmm(q.get('s'));
  const e = parseHhmm(q.get('e'));
  const vh = q.get('vh');
  // id lu tel quel (forme seulement) ; sanitizeScenario le confronte à meta.vehicles
  const vehicle = vh && /^[a-z0-9_-]{1,32}$/i.test(vh) ? vh : (base.vehicle ?? null);
  return {
    origin: o && /^[0-9AB]{5}$/i.test(o) ? o.toUpperCase() : base.origin,
    day: d && DAY_IDS.includes(d) ? (d as DayTypeId) : base.day,
    budget: Number.isSafeInteger(b) && b > 0 ? b : base.budget,
    mode: m && MODE_IDS.includes(m) ? (m as ModeId) : base.mode,
    compare: vs && /^[0-9AB]{5}$/i.test(vs) ? vs.toUpperCase() : base.compare,
    pole: p && /^[\w-]{1,64}$/.test(p) ? p : base.pole,
    halo: h && HALO_IDS.includes(h) ? (h as Scenario['halo']) : base.halo,
    // id lu tel quel (forme seulement) ; sanitizeScenario le confronte à meta.walk_settings
    walk: w && /^[a-z0-9_-]{1,32}$/i.test(w) ? w : (base.walk ?? null),
    // les deux ou rien ; sanitizeScenario ramène à une journée-type un horaire qui lui est égal.
    // Fin après le début, ou poste de nuit (fin le lendemain matin : `s=2200&e=0600`) ; le reste est ignoré
    shift: s != null && e != null && (e > s || isNightShape(s, e)) ? { start: s, end: e } : (base.shift ?? null),
    ...(vehicle ? { vehicle } : {}),
  };
}

/** true si l'URL contient au moins un paramètre de scénario (lien partagé). */
export function hasScenarioParams(search: string): boolean {
  const q = new URLSearchParams(search);
  return SCENARIO_KEYS.some((k) => q.has(k));
}

export function serializeScenario(s: Scenario, currentSearch = ''): string {
  const q = new URLSearchParams(currentSearch);
  for (const k of SCENARIO_KEYS) q.delete(k);
  if (s.origin) q.set('o', s.origin);
  // Horaires libres : `s` / `e` à la place de `d` (la journée-type n'est plus celle du ciel)
  if (s.shift) {
    q.set('s', formatHhmm(s.shift.start));
    q.set('e', formatHhmm(s.shift.end));
  } else q.set('d', s.day);
  q.set('b', String(s.budget));
  q.set('m', s.mode);
  if (s.compare) q.set('vs', s.compare);
  if (s.pole) q.set('p', s.pole);
  if (s.halo) q.set('h', s.halo);
  if (s.walk) q.set('w', s.walk);
  if (s.vehicle) q.set('vh', s.vehicle);
  const str = q.toString();
  return str ? `?${str}` : '';
}

/** Met à jour l'URL sans recharger ni empiler l'historique. */
export function writeScenarioToUrl(s: Scenario): void {
  const next = serializeScenario(s, window.location.search);
  if (next !== window.location.search) {
    window.history.replaceState(null, '', `${window.location.pathname}${next}${window.location.hash}`);
  }
}

/** Vue partagée : `&v=map` ouvre la carte miroir (la vue n'est pas l'état du scénario). */
export type SharedView = 'sky' | 'map';

export function parseView(search: string): SharedView {
  return new URLSearchParams(search).get('v') === 'map' ? 'map' : 'sky';
}

/** Chaîne de recherche avec `v=map` posé ou retiré ; les autres paramètres sont conservés. */
export function serializeView(view: SharedView, currentSearch = ''): string {
  const q = new URLSearchParams(currentSearch);
  if (view === 'map') q.set('v', 'map');
  else q.delete('v');
  const str = q.toString();
  return str ? `?${str}` : '';
}

export function writeViewToUrl(view: SharedView): void {
  const next = serializeView(view, window.location.search);
  if (next !== window.location.search) {
    window.history.replaceState(null, '', `${window.location.pathname}${next}${window.location.hash}`);
  }
}
