import { describe, expect, it } from 'vitest';
import {
  carbonNote,
  lineFacts,
  itineraryAvailability,
  itineraryDay,
  ITINERARY_EXAMPLE_TAIL,
  itineraryExampleLead,
  itineraryExampleNote,
  itineraryStopNote,
  itineraryUnavailableText,
  poleUnlistedText,
  ticketFact,
  ticketNote,
  ticketTotalText,
  tripEntry,
  tripUnavailableText,
  type ItinerariesFile,
  type ItinTrip,
} from './itineraries';
import type { DayType } from './types';

/** Espaces insécables → espaces simples, pour lire les attendus */
const plain = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ');
const LONG_DASH = /[\u2013\u2014]/;

const DAYS: DayType[] = [
  { id: 'd06', label: '6h-14h', start: '06:00', end: '14:00' },
  { id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' },
  { id: 'd14', label: '14h-22h', start: '14:00', end: '22:00' },
];

const trip = (o: Partial<ItinTrip> = {}): ItinTrip => ({
  status: 'ok',
  dep: '08:15',
  arr: '08:57',
  min: 42,
  matrix_min: 42,
  delta_min: 0,
  legs: [{ m: 'metro', dep: '08:15', arr: '08:57', min: 42, dist_m: 9000, line: '1', from: 'A', to: 'B' }],
  tickets: { metro_train_rer: 1, bus_tram: 0, airport: 0, cost_eur: 2.55, status: 'ok' },
  co2_g: { value: 34, status: 'ok' },
  ...o,
});

describe('itinéraires : quand le détail est disponible (D-028)', () => {
  it('journée-type : celle du scénario, ou des horaires libres identiques à une journée-type', () => {
    expect(itineraryDay(DAYS, 'd09', null)).toBe('d09');
    expect(itineraryDay(DAYS, 'd09', { start: 360, end: 840 })).toBe('d06');
    expect(itineraryDay(DAYS, 'd09', { start: 540, end: 1020 })).toBe('d09');
    expect(itineraryDay(DAYS, 'd09', { start: 510, end: 990 })).toBeNull();
  });
  it('TC, réglage par défaut, journée-type, une commune, commune publiée', () => {
    const ok = { mode: 'transit', walkKey: null, day: 'd09' as const, split: false, listed: true };
    expect(itineraryAvailability(ok)).toBeNull();
    expect(itineraryAvailability({ ...ok, mode: 'bike' })).toBe('mode');
    expect(itineraryAvailability({ ...ok, walkKey: 'comfort' })).toBe('walk');
    // itinéraires « confort » publiés (meta.itineraries_variants, 04/11) : détail disponible
    expect(itineraryAvailability({ ...ok, walkKey: 'comfort', walkPublished: true })).toBeNull();
    expect(itineraryAvailability({ ...ok, walkKey: 'comfort', walkPublished: true, listed: false })).toBe('not_published');
    expect(itineraryAvailability({ ...ok, day: null })).toBe('shift');
    expect(itineraryAvailability({ ...ok, split: true })).toBe('compare');
    expect(itineraryAvailability({ ...ok, listed: false })).toBe('not_published');
  });
  it('phrases courtes, sans tiret long', () => {
    const p = { dayLabels: DAYS.map((d) => d.label), defaultWalkLabel: "normal : jusqu'à 3 km à pied" };
    // Audit d'affichage du 10/11 : le pli « Coût et carbone » dit lui-même pourquoi coût et carbone manquent (horaires libres, mode, comparaison)
    // Audit d'affichage du 11/11 (P28, D9) : la liste des journées-types est sur les boutons de la barre et sur le bouton qui suit
    expect(itineraryUnavailableText('shift', p)).toBe('Détail du trajet : non calculé en horaires libres.');
    expect(itineraryUnavailableText('mode', p)).toBe('Détail du trajet : transports en commun seulement.');
    expect(itineraryUnavailableText('compare', p)).toBe('Détail du trajet : affiché pour une seule commune, hors comparaison.');
    expect(itineraryUnavailableText('walk', p)).toContain("« normal : jusqu'à 3 km à pied »");
    expect(itineraryUnavailableText('not_published', p)).toBe('Détail du trajet, coût au ticket et carbone : pas encore publiés pour cette commune.');
    for (const w of ['mode', 'walk', 'shift', 'compare', 'not_published'] as const) expect(itineraryUnavailableText(w, p)).not.toMatch(LONG_DASH);
  });
  it('ciel des 44 astres : ce qui manque est « en cours de calcul », jamais une valeur', () => {
    const p = { dayLabels: DAYS.map((d) => d.label), defaultWalkLabel: 'normal', pending44: true };
    expect(itineraryUnavailableText('walk', p)).toBe(
      'Détail du trajet, coût au ticket et carbone : en cours de calcul pour les 44 astres avec ce réglage de marche (publiés pour le réglage « normal »).',
    );
    expect(itineraryUnavailableText('not_published', p)).toBe('Détail du trajet, coût au ticket et carbone : en cours de calcul pour les 44 astres.');
    // les causes qui ne sont pas un calcul manquant gardent leur phrase
    expect(itineraryUnavailableText('mode', p)).toContain('transports en commun seulement');
    for (const w of ['mode', 'walk', 'shift', 'compare', 'not_published'] as const) expect(itineraryUnavailableText(w, p)).not.toMatch(LONG_DASH);
  });
  it("exemple de trajet vers l'arrêt d'ancrage, en commune par commune", () => {
    expect(itineraryExampleNote('La Défense', '9h-17h')).toBe(
      "Exemple de trajet vers La Défense, l'arrêt le plus desservi du pôle, journée 9h-17h. Les temps plus haut vont au centre de chaque commune du pôle : ils peuvent différer.",
    );
    expect(itineraryExampleNote(null, null)).toContain("vers l'arrêt le plus desservi du pôle.");
  });
  it('lot 6 : la première phrase seule au premier niveau, la suite dans « Méthode et sources », sans perdre un mot', () => {
    const lead = itineraryExampleLead('La Défense', '9h-17h');
    expect(lead).toBe("Exemple de trajet vers La Défense, l'arrêt le plus desservi du pôle, journée 9h-17h.");
    expect(`${lead} ${ITINERARY_EXAMPLE_TAIL}`).toBe(itineraryExampleNote('La Défense', '9h-17h'));
  });
  it("phrase de l'arrêt d'affichage de l'astre : avec le nom publié, sans valeur chiffrée, jamais sans nom", () => {
    const note = itineraryStopNote('Palais Royal - Musée du Louvre');
    expect(note).toBe(
      "Itinéraire détaillé jusqu'à l'arrêt le plus desservi de l'astre (Palais Royal - Musée du Louvre). La durée du titre est calculée jusqu'au centre de la commune : les deux peuvent différer.",
    );
    expect(note).not.toMatch(/\d/);
    expect(note).not.toMatch(LONG_DASH);
    expect(itineraryStopNote('  Gare de Lyon ')).toContain('(Gare de Lyon)');
    for (const missing of [undefined, null, '', '   ']) expect(itineraryStopNote(missing)).toBeNull();
  });
  it('sens sans détail : raison publiée', () => {
    expect(tripUnavailableText(trip(), 'out', 120)).toBeNull();
    expect(tripUnavailableText(null, 'out', 120)).toBeNull();
    expect(plain(tripUnavailableText({ status: 'no_trip_in_matrix', reason: 'no_trip_within_120' }, 'ret', 120))).toBe(
      'Retour : aucun trajet de 2 h ou moins vers cet arrêt, rien à détailler.',
    );
    expect(tripUnavailableText({ status: 'no_itinerary_found' }, 'out', 120)).toBe('Aller : détail indisponible (aucun itinéraire retrouvé pour ce trajet).');
    const f: ItinerariesFile = { insee: '1', contract: 'itineraries-1', poles: ['P'], days: { d09: { out: [{ status: 'no_itinerary_found' }], ret: [trip()] } } };
    expect(tripEntry(f, 'P', 'd09', 'out')?.status).toBe('no_itinerary_found');
    expect(tripEntry(f, 'Q', 'd09', 'out')).toBeNull();
    // astre absent d'un fichier chargé : une phrase le dit (le silence du panneau à 44 astres)
    expect(poleUnlistedText(f, 'P', true)).toBeNull();
    expect(poleUnlistedText(f, 'Q', true)).toBe('Détail du trajet, coût au ticket et carbone : en cours de calcul pour cet astre.');
    expect(poleUnlistedText(f, 'Q', false)).toContain('pas encore publiés pour ce pôle');
    expect(poleUnlistedText(null, 'Q', true)).toBeNull();
    expect(poleUnlistedText(f, 'Q', true)).not.toMatch(LONG_DASH);
  });
});

describe('itinéraires : ticket aller + retour, carbone', () => {
  it('total aller et retour seulement si les deux prix sont sûrs', () => {
    const out = ticketFact(trip(), 'out');
    const ret = ticketFact(trip({ tickets: { metro_train_rer: 1, bus_tram: 1, airport: 0, cost_eur: 4.6, status: 'ok' } }), 'ret');
    expect(plain(ticketTotalText(out, ret))).toBe('Aller et retour : 7,15 €');
    expect(ticketTotalText(out, null)).toBeNull();
  });
  it('trajet tout à pied : aucun ticket', () => {
    const walk = trip({ legs: [{ m: 'walk', role: 'direct', dep: '08:00', arr: '08:30', min: 30, dist_m: 1800 }], tickets: { metro_train_rer: 0, bus_tram: 0, airport: 0, cost_eur: 0, status: 'ok' } });
    expect(ticketFact(walk, 'out')?.text).toBe('Aller : à pied, aucun ticket');
  });
  it('prix non affiché : la raison publiée', () => {
    expect(ticketNote(trip(), 'out')).toBeNull();
    expect(ticketNote(trip({ tickets: { metro_train_rer: 2, bus_tram: 0, airport: 0, cost_eur: 5.1, status: 'street_transfer_unverified' } }), 'ret')).toBe(
      'Retour : prix non affiché, une correspondance par la rue entre deux gares reste à vérifier.',
    );
    expect(
      ticketNote(trip({ tickets: { metro_train_rer: null, bus_tram: null, airport: null, cost_eur: null, status: 'unknown', reasons: ['CDG VAL : titre non documenté'] } }), 'out'),
    ).toBe('Aller : prix non affiché (CDG VAL : titre non documenté).');
  });
  it('carbone absent : la raison publiée, une seule fois', () => {
    const v = trip({ co2_g: { value: null, status: 'unknown', reason: 'facteur non publié pour la ligne V (train)' } });
    expect(carbonNote(v, v)).toBe('Carbone non calculé : facteur non publié pour la ligne V (train).');
    expect(carbonNote(trip(), trip())).toBeNull();
  });
});

describe('itinéraires : transport à la demande', () => {
  it('dit la réservation, rien pour une course régulière', () => {
    expect(lineFacts({ m: 'bus', dep: '23:32', arr: '23:33', min: 1, dist_m: null, line: 'TàD', on_demand: true })[0]).toBe(
      'Transport à la demande : réservation obligatoire, horaire théorique du GTFS (IDFM)',
    );
    expect(lineFacts({ m: 'bus', dep: '08:00', arr: '08:10', min: 10, dist_m: 3000, line: '129' })).toEqual([]);
  });
});
