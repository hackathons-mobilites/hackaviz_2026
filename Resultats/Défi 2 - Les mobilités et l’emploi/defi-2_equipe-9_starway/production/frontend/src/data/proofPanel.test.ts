import { describe, expect, it } from 'vitest';
import { gainSummaryText, isGained } from './gain';
import {
  carbonFact,
  isItinerariesFile,
  itineraryOf,
  legTitle,
  lineComfortFacts,
  lineFacts,
  lineStopFacts,
  monthText,
  punctualityText,
  ticketFact,
  type ItinerariesFile,
  type ItinLeg,
  type ItinTrip,
} from './itineraries';
import { odBadge, odCommuneRows, odShareSummary } from './od/proofOd';
import type { OdDestState } from './od/compute';
import { clockRange, formatHHMM, longestLeg, proofBadge, proofContextLine, proofVerdict, serviceWeekday, shiftText } from './proof';

/** Espaces insécables → espaces simples, pour lire les attendus */
const plain = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ');
const LONG_DASH = /[\u2013\u2014]/;

describe('panneau de preuve : en-tête (maquette)', () => {
  it('heures HH:MM et plage départ → arrivée', () => {
    expect(formatHHMM(495)).toBe('08:15');
    expect(formatHHMM(1440 + 5)).toBe('00:05');
    expect(clockRange({ depart: 495, arrive: 537 })).toBe('08:15 → 08:57');
    expect(clockRange({ depart: 1020, arrive: null })).toBeNull();
  });
  it('« Depuis Montreuil · journée 9h-17h · mardi type » : le jour vient de la date de service', () => {
    expect(serviceWeekday('2026-11-17')).toBe('mardi');
    expect(serviceWeekday('demain')).toBeNull();
    expect(shiftText('09:00', '17:00')).toBe('9h-17h');
    expect(proofContextLine({ origins: ['Montreuil'], shift: '9h-17h', serviceDate: '2026-11-17', timeDependent: true })).toBe(
      'Depuis Montreuil · journée 9h-17h · mardi type',
    );
    expect(proofContextLine({ origins: ['Montreuil'], shift: '8h30-16h30', shiftKind: 'free', serviceDate: '2026-11-17', timeDependent: true })).toBe(
      'Depuis Montreuil · horaires 8h30-16h30 · mardi type',
    );
    // mode sans horaire : ni journée ni jour de semaine ; « Durée indépendante de l'heure » est dans « Méthode et sources » (audit du 11/11, P4)
    expect(proofContextLine({ origins: ['Montreuil', 'Vincennes'], shift: '9h-17h', serviceDate: '2026-11-17', timeDependent: false })).toBe('Depuis Montreuil et Vincennes');
    // date absente : rien d'inventé
    expect(proofContextLine({ origins: ['Montreuil'], shift: '9h-17h', serviceDate: null, timeDependent: true })).toBe('Depuis Montreuil · journée 9h-17h');
  });
  it('badge égal au verdict, jamais « budget »', () => {
    const ok = proofVerdict({ status: 'accessible', out: 38, ret: 42, reason: null }, 45);
    expect(plain(proofBadge(ok, 45).text)).toBe('Accessible · aller et retour ≤ 45 min');
    const ret = proofVerdict({ status: 'out_only', out: 38, ret: 52, reason: null }, 45);
    expect(proofBadge(ret, 45)).toEqual({ kind: 'out_only', text: 'Retour trop long' });
    const out = proofVerdict({ status: 'none', out: 50, ret: 40, reason: null }, 45);
    expect(proofBadge(out, 45).kind).toBe('in_only');
    const none = proofVerdict({ status: 'none', out: null, ret: null, reason: 'no_trip_within_120' }, 45, 120);
    expect(proofBadge(none, 45)).toEqual({ kind: 'blocked', text: 'Aucun trajet trouvé' });
    for (const b of [ok, ret, out, none].map((v) => proofBadge(v, 45).text)) {
      expect(b).not.toMatch(/budget/i);
      expect(b).not.toMatch(LONG_DASH);
    }
  });
});

describe('panneau de preuve : sens le plus long', () => {
  it('« Sens le plus long : 42 min, pour 45 min au plus par sens »', () => {
    const l = longestLeg(38, 42, 45)!;
    expect(l.leg).toBe('ret');
    expect(l.within).toBe(true);
    expect(plain(l.text)).toBe('Sens le plus long : 42 min, pour 45 min au plus par sens');
    expect(l.fill).toBeCloseTo(42 / 45);
    expect(l.mark).toBe(1);
  });
  it('au-delà : l’écart est dit, la barre déborde le repère', () => {
    const l = longestLeg(52, 40, 45)!;
    expect(l.leg).toBe('out');
    expect(plain(l.text)).toBe('Sens le plus long : 52 min (7 min au-delà), pour 45 min au plus par sens');
    expect(l.fill).toBe(1);
    expect(l.mark).toBeCloseTo(45 / 52);
  });
  it('un sens sans durée : pas de barre fabriquée', () => {
    expect(longestLeg(30, null, 45)).toBeNull();
    expect(longestLeg(null, null, 45)).toBeNull();
  });
});

/* ------------------------------------------------------------------ itinéraires (D-028, proposés) */

// Fichier FICTIF de test (aucun itinéraire n'est publié au 03/11) : forme de pipeline/starway/itin_export.py
const leg = (o: Partial<ItinLeg>): ItinLeg => ({ m: 'metro', dep: '08:20', arr: '08:40', min: 20, dist_m: 7000, ...o });
const trip = (o: Partial<ItinTrip> = {}): ItinTrip => ({
  status: 'ok',
  dep: '08:15',
  arr: '08:57',
  min: 42,
  matrix_min: 42,
  delta_min: 0,
  legs: [leg({ m: 'walk', role: 'access', dep: '08:15', arr: '08:20', min: 5, dist_m: 380 }), leg({ line: '1', from: 'A', to: 'B' })],
  tickets: { metro_train_rer: 1, bus_tram: 0, airport: 0, cost_eur: 2.55, status: 'ok' },
  co2_g: { value: 27, status: 'ok' },
  ...o,
});
const file = (out: ItinTrip, ret: ItinTrip): ItinerariesFile => ({
  insee: '00000',
  contract: 'itineraries-proposed-1',
  poles: ['P_X', 'P_Y'],
  days: { d09: { out: [out, { status: 'no_trip_in_matrix', reason: 'no_trip_within_120' }], ret: [ret, { status: 'not_computed', reason: 'not_computed' }] } },
});

describe('itinéraires : lecture du contrat proposé', () => {
  it('seul un itinéraire calculé est rendu ; tout autre cas masque le bloc', () => {
    const f = file(trip(), trip());
    expect(isItinerariesFile(f)).toBe(true);
    expect(isItinerariesFile({ contract: 'autre', poles: [], days: {} })).toBe(false);
    expect(itineraryOf(f, 'P_X', 'd09', 'out')?.min).toBe(42);
    expect(itineraryOf(f, 'P_Y', 'd09', 'out')).toBeNull();
    expect(itineraryOf(f, 'P_Y', 'd09', 'ret')).toBeNull();
    expect(itineraryOf(f, 'P_X', 'd14', 'out')).toBeNull();
    expect(itineraryOf(null, 'P_X', 'd09', 'out')).toBeNull();
    expect(itineraryOf(file(trip({ legs: [] }), trip()), 'P_X', 'd09', 'out')).toBeNull();
  });
  it('noms de ligne', () => {
    expect(legTitle({ m: 'rer', line: 'A' })).toBe('RER A');
    expect(legTitle({ m: 'train', line: 'J' })).toBe('Transilien J');
    expect(legTitle({ m: 'walk', line: null })).toBe('Marche');
    expect(legTitle({ m: null, line: 'X' })).toBe('Ligne X');
  });
  it('faits par ligne : ce que dit la source, « non renseigné » jamais lu « non »', () => {
    expect(lineFacts(leg({}))).toEqual([]); // champs pas encore exportés : aucune ligne
    expect(lineFacts(leg({ air_conditioning: 'partial', accessibility: null }))).toEqual([
      'Climatisation (déclarée à IDFM) : partielle',
      'Ligne déclarée accessible (IDFM) : non renseigné',
    ]);
    expect(lineFacts(leg({ air_conditioning: 'unknown' }))).toEqual(['Climatisation (déclarée à IDFM) : non renseignée']);
    expect(lineFacts(leg({ station_from: { label: 'accessible sur demande auprès d’un agent' }, station_to: null }))).toEqual([
      'Gare de montée (IDFM) : accessible sur demande auprès d’un agent',
      'Gare de descente (IDFM) : niveau non renseigné',
    ]);
    expect(lineFacts(leg({ m: 'walk', air_conditioning: 'true' }))).toEqual([]);
    const all = lineFacts(leg({ m: 'rer', air_conditioning: 'true', accessibility: 'false', punctuality: { value_pct: 90, month: '2026-09' } })).join(' ');
    expect(all).not.toMatch(/trajet accessible/i);
  });
  it('retours KBS du 10/11 : climatisation et ponctualité au « i », le reste au pli des arrêts, sans perte ni doublon', () => {
    const l = leg({ m: 'rer', line: 'C', air_conditioning: 'true', accessibility: 'false', punctuality: { value_pct: 90, month: '2026-09' } });
    const comfort = lineComfortFacts(l);
    const stops = lineStopFacts(l);
    expect(comfort[0]).toBe('Climatisation (déclarée à IDFM) : oui');
    expect(comfort[1]).toMatch(/^Ponctualité de la ligne/);
    expect(stops).toEqual(['Ligne déclarée accessible (IDFM) : non']);
    // même ensemble que lineFacts, chaque phrase une seule fois
    expect([...stops, ...comfort].sort()).toEqual([...lineFacts(l)].sort());
    expect(lineComfortFacts(leg({ m: 'walk', air_conditioning: 'true' }))).toEqual([]);
    expect(lineComfortFacts(leg({}))).toEqual([]);
  });
  it('ponctualité : RER et Transilien seulement, toujours avec le mois ; ailleurs « pas de donnée ouverte »', () => {
    const p = { value_pct: 89.4, month: '2026-09' };
    expect(monthText('2026-09')).toBe('septembre 2026');
    expect(plain(punctualityText({ m: 'rer', line: 'C', punctuality: p }))).toBe(
      'Ponctualité de la ligne (SNCF Voyageurs, septembre 2026) : 89,4 % des voyageurs arrivés avec moins de 5 min de retard',
    );
    // RER A et B : ce que couvre la valeur (lignes RATP et SNCF)
    expect(plain(punctualityText({ m: 'rer', line: 'A', punctuality: p }))).toMatch(/RATP et la SNCF/);
    expect(punctualityText({ m: 'train', line: 'J', punctuality: p })).not.toBeNull();
    expect(punctualityText({ m: 'train', line: 'J', punctuality: p })).not.toMatch(/RATP/);
    const none = { value_pct: null, month: null, reason: 'no_open_data' };
    expect(plain(punctualityText({ m: 'metro', line: '14', punctuality: none }))).toBe('Ponctualité : pas de donnée ouverte pour cette ligne');
    expect(plain(punctualityText({ m: 'bus', line: '129', punctuality: none }))).toBe('Ponctualité : pas de donnée ouverte pour cette ligne');
    expect(plain(punctualityText({ m: 'rer', line: 'C', punctuality: { value_pct: null, month: null, reason: 'month_not_published' } }))).toBe(
      'Ponctualité : mois non publié pour cette ligne',
    );
    // champ non exporté : rien ; taux sans mois : rien ; jamais « taux d'incident »
    expect(punctualityText({ m: 'rer', line: 'C' })).toBeNull();
    expect(punctualityText({ m: 'rer', line: 'C', punctuality: { value_pct: 89.4, month: null } })).toBeNull();
    expect(punctualityText({ m: 'walk', line: null, punctuality: none })).toBeNull();
    expect(punctualityText({ m: 'rer', line: 'A', punctuality: p })).not.toMatch(/incident/i);
  });
  it('coût au ticket : seulement un prix publié sans réserve', () => {
    expect(plain(ticketFact(trip(), 'out')?.text)).toBe('Aller : 2,55 € (1 ticket Métro-Train-RER)');
    expect(ticketFact(trip({ tickets: { metro_train_rer: 2, bus_tram: 0, airport: 0, cost_eur: 5.1, status: 'street_transfer_unverified' } }), 'out')).toBeNull();
    expect(ticketFact(trip({ tickets: { metro_train_rer: null, bus_tram: null, airport: null, cost_eur: null, status: 'unknown' } }), 'ret')).toBeNull();
    expect(ticketFact(null, 'out')).toBeNull();
  });
  it('carbone : les deux sens publiés, sinon rien (jamais un total partiel)', () => {
    expect(carbonFact(trip(), trip({ co2_g: { value: 31, status: 'ok' } }))).toEqual({ outG: 27, retG: 31, totalG: 58 });
    expect(carbonFact(trip(), trip({ co2_g: { value: null, status: 'unknown', reason: 'facteur non publié pour la ligne V' } }))).toBeNull();
    expect(carbonFact(trip(), null)).toBeNull();
  });
});

/* ------------------------------------------------------------------ or du gain */

describe('or du gain démontré, dit en mots', () => {
  const r = { shown: true, gained: ['P_X', 'P_Y'] };
  it('pôle doré seulement si l’or est peint, jamais en diptyque', () => {
    expect(isGained(r, 'P_X')).toBe(true);
    expect(isGained(r, 'P_Z')).toBe(false);
    expect(isGained(r, 'P_X', true)).toBe(false);
    expect(isGained({ shown: false, gained: ['P_X'] }, 'P_X')).toBe(false);
    expect(isGained(null, 'P_X')).toBe(false);
  });
  it('phrase du résumé du ciel', () => {
    expect(plain(gainSummaryText(r, 1105553))).toBe(
      "Dont 2 pôles en or (gain démontré) : accessibles aller et retour en vélo + transports en commun, pas en transports en commun seuls, soit 1 105 553 postes salariés recensés par l'INSEE.",
    );
    expect(gainSummaryText({ shown: true, gained: ['P_X'] }, null)).toBe(
      'Dont 1 pôle en or (gain démontré) : accessible aller et retour en vélo + transports en commun, pas en transports en commun seuls.',
    );
    expect(gainSummaryText({ shown: true, gained: [] }, 0)).toBeNull();
    expect(gainSummaryText(r, 10, true)).toBeNull();
  });
});

/* ------------------------------------------------------------------ horaires libres (D-019) */

describe('panneau en horaires libres : part du pôle et communes', () => {
  // Valeurs FICTIVES de test (aucune donnée publiée n'est citée)
  const d = (o: Partial<OdDestState>): OdDestState => ({
    dest: 0,
    insee: '00001',
    status: 'accessible',
    out: { minutes: 30, reason: null, dep: 500 },
    ret: { minutes: 35, reason: null },
    jobs: 1000,
    pole: 0,
    record: true,
    ...o,
  });
  const ctx = { maxTripMin: 120, timeDependent: true, partial: false };
  it('badge cohérent avec l’astre (allumé dès qu’un poste est atteint)', () => {
    expect(plain(odBadge({ reached: 100, measurable: 100, share: 1, notReached: 0, outOnly: 0 }, 45).text)).toBe('Accessible · aller et retour ≤ 45 min');
    expect(plain(odBadge({ reached: 25, measurable: 100, share: 0.25, notReached: 75, outOnly: 0 }, 45).text)).toBe(
      'En partie accessible · 25 % des postes, aller et retour ≤ 45 min',
    );
    // commune de départ dans l'astre : « Accessible » veut dire tout ce qui est mesurable (900 sur 900), pas 900 sur 1 000
    expect(odBadge({ reached: 900, measurable: 900, share: 1, notReached: 0, outOnly: 0, self: 100 }, 45).text).toContain('Accessible');
    expect(odBadge({ reached: 0, measurable: 100, share: 0, notReached: 100, outOnly: 40 }, 45).kind).toBe('out_only');
    expect(odBadge({ reached: 0, measurable: 100, share: 0, notReached: 100, outOnly: 0 }, 45).kind).toBe('blocked');
    expect(odBadge({ reached: 0, measurable: 100, share: 0, notReached: 0, outOnly: 0 }, 45).kind).toBe('unknown');
  });
  it('part atteinte, dénominateur dit, commune d’origine à part (hors du dénominateur)', () => {
    const s = odShareSummary({ reached: 250, measurable: 700, share: 250 / 700, self: 300, unknown: 0 });
    expect(plain(s.percent)).toBe('35,7 %');
    expect(plain(s.line)).toBe('250 postes salariés (INSEE) atteints aller et retour, sur 700');
    expect(plain(s.notes.join(' '))).toBe('Votre commune : 300 postes, trajet non mesuré, hors du pourcentage.');
  });
  it('une ligne par commune, la plus grande d’abord, aller et retour avec leurs heures', () => {
    const rows = odCommuneRows(
      {
        communes: [
          d({ dest: 1, insee: 'A', jobs: 10 }),
          d({ dest: 2, insee: 'B', jobs: 500, status: 'out_only', ret: { minutes: 60, reason: null } }),
          d({ dest: 3, insee: 'C', jobs: 40, status: 'self', out: { minutes: null, reason: null, dep: null }, ret: { minutes: null, reason: null } }),
        ],
      },
      new Map([
        ['A', 'Paris 8e Arrondissement'],
        ['B', 'Puteaux'],
      ]),
      45,
      ctx,
      1020,
    );
    expect(rows.map((r) => r.insee)).toEqual(['B', 'C', 'A']);
    expect(rows[0]!.glyph).toBe('out_only');
    expect(plain(rows[0]!.out)).toBe('Aller 30 min (départ 8h20, arrivée 8h50)');
    expect(plain(rows[0]!.ret)).toBe('Retour 60 min, attente comprise (fin du poste à 17h, arrivée 18h)');
    expect(rows[0]!.ret).not.toMatch(/départ/);
    expect(rows[1]!.glyph).toBe('self');
    expect(rows[1]!.out).toBe('');
    expect(rows[2]!.name).toBe('Paris 8e');
    for (const r of rows) expect(`${r.title}${r.out}${r.ret}`).not.toMatch(LONG_DASH);
  });
});
