import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  carbonLegsText,
  carbonLine,
  carbonMissingText,
  costMissingText,
  coverLine,
  joinOr,
  missingLegReason,
  nearestDayType,
  noItineraryCostText,
  optionPriceLine,
  passFigure,
  passLine,
  ticketDetailLines,
  ticketLine,
  ticketMissingReasons,
  tripLimitText,
} from './costLines';
import { ticketFact, type ItinTrip } from './itineraries';
import { coveringOptions, transitRoundTrip, type SubscriptionsFile } from './subscriptions';
import type { DayType } from './types';

const LONG_DASH = /[\u2013\u2014]/;
const file = JSON.parse(readFileSync(new URL('../../public/data/subscriptions.json', import.meta.url), 'utf-8')) as SubscriptionsFile;
const navigo = file.transit.options.find((o) => o.id === 'navigo_month')!;
const navigoDay = file.transit.options.find((o) => o.id === 'navigo_day')!;
const extra = file.transit.extra_titles;

const metro = (eur: number): ItinTrip => ({
  status: 'ok',
  legs: [{ m: 'metro', line: '1', min: 10 } as never],
  tickets: { status: 'ok', cost_eur: eur, metro_train_rer: 1, bus_tram: 0, airport: 0 } as never,
  co2_g: { status: 'ok', value: 50 } as never,
});
const orly: ItinTrip = {
  status: 'ok',
  legs: [{ m: 'metro', line: 'ORLYVAL', min: 8 } as never],
  tickets: { status: 'ok', cost_eur: 14, metro_train_rer: 0, bus_tram: 0, airport: 0 } as never,
};
const DAYS: DayType[] = [
  { id: 'd06', label: '6h-14h', start: '06:00', end: '14:00' },
  { id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' },
  { id: 'd14', label: '14h-22h', start: '14:00', end: '22:00' },
];

describe('ligne au ticket (aucun abonnement choisi)', () => {
  it("une seule ligne, valeurs lues dans les tickets publiés, « trajet de l'exemple » dit (« exemple de trajet » reste lu sans rien ouvrir, dans le titre du pli)", () => {
    const p = metro(2.55).tickets!.cost_eur!;
    const o = ticketFact(metro(p), 'out');
    const r = ticketFact(metro(p), 'ret');
    // Audit d'affichage du 11/11 (K1) : le total aller-retour est le chiffre du pli fermé, il n'est plus redit
    expect(ticketLine(o, r)).toBe("Au ticket : aller 2,55\u00a0€, retour 2,55\u00a0€ (trajet de l'exemple).");
    expect(ticketDetailLines(o, r)).toEqual(['Aller : 1 ticket Métro-Train-RER.', 'Retour : 1 ticket Métro-Train-RER.']);
  });
  it('jamais un total partiel', () => {
    expect(ticketLine(ticketFact(metro(2.55), 'out'), null)).toBeNull();
  });
  it('raisons publiées quand un prix manque, sans doublon ; sens sans trajet', () => {
    expect(tripLimitText(120)).toBe('2\u00a0h');
    expect(tripLimitText(90)).toBe('90\u00a0min');
    expect(missingLegReason(120)).toBe("un sens n'a pas de trajet de 2\u00a0h ou moins");
    expect(ticketMissingReasons(metro(2.55), null, 120)).toEqual([missingLegReason(120)]);
    const street = { ...metro(2.55), tickets: { status: 'street_transfer_unverified', cost_eur: 2.55 } as never };
    expect(ticketMissingReasons(street, street, 120)).toEqual(['une correspondance par la rue entre deux gares reste à vérifier']);
    const unknown = { ...metro(2.55), tickets: { status: 'unknown', cost_eur: null, reasons: ['navette sans titre relevé'] } as never };
    expect(costMissingText(ticketMissingReasons(unknown, unknown, 120))).toBe('Coût non calculé : navette sans titre relevé.');
  });
});

describe('abonnements qui couvriraient le trajet (subscriptions.json publié)', () => {
  it('noms des abonnements tout public, titre d’un jour hors de la phrase et dans le « i » avec son prix', () => {
    const cover = coveringOptions(file, metro(2.55), metro(2.55));
    const line = coverLine(cover)!;
    expect(line.lead.startsWith('Avec un Navigo Mois')).toBe(true);
    expect(line.lead).not.toContain(navigoDay.label!);
    expect(`${line.lead}${line.tail}`).toMatch(/: rien à payer en plus, hors coût de l'abonnement$/);
    expect(optionPriceLine(navigo)).toBe(`Navigo Mois : ${navigo.price.text}.`);
    expect(optionPriceLine(navigoDay)).toContain("(titre d'un jour, aller et retour du même jour)");
  });
  it('aucun abonnement : pas de phrase', () => {
    expect(coverLine([])).toBeNull();
    expect(coverLine([navigoDay])).toBeNull();
  });
  it('liste jointe par « ou »', () => {
    expect(joinOr(['A'])).toBe('A');
    expect(joinOr(['A', 'B', 'C'])).toBe('A, B ou C');
  });
});

describe('abonnement choisi : ce qui reste à payer, hors coût de l’abonnement (D-032)', () => {
  it('trajet couvert : rien à payer en plus', () => {
    const rt = transitRoundTrip(metro(2.55), metro(2.55), navigo, extra);
    const l = passLine(navigo, rt, extra, 120);
    expect(l.lead).toBe(`Avec votre Navigo Mois (${navigo.price.text}) : rien à payer en plus pour ce trajet, `);
    expect(l.tail).toBe("hors coût de l'abonnement");
    expect(passFigure(navigo, rt)).toBe('rien en plus de votre abonnement');
  });
  it('Orlyval : reste à payer, avec la raison', () => {
    const rt = transitRoundTrip(orly, orly, navigo, extra);
    const l = passLine(navigo, rt, extra, 120);
    expect(rt.total_eur).not.toBeNull();
    expect(l.lead).toMatch(/: reste à payer .+ \(ticket .+ à l'aller et au retour\), $/);
    expect(passFigure(navigo, rt)).toMatch(/en plus de votre abonnement$/);
  });
  it('un sens sans trajet : coût non calculé, jamais 0', () => {
    const rt = transitRoundTrip(metro(2.55), null, navigo, extra);
    const l = passLine(navigo, rt, extra, 120);
    expect(l.lead).toContain(`coût non calculé pour ce trajet (${missingLegReason(120)})`);
    expect(l.tail).toBeNull();
    expect(passFigure(navigo, rt)).toBeNull();
  });
});

describe('carbone', () => {
  it('ligne courte, détail par sens dans le « i »', () => {
    const f = { outG: 50, retG: 60, totalG: 110 };
    expect(carbonLine(f)).toBe('Carbone : environ 110\u00a0g CO2e aller et retour');
    expect(carbonLegsText(f)).toBe('Aller 50\u00a0g, retour 60\u00a0g.');
  });
  it('raison claire : sens sans trajet, raisons publiées sans doublon', () => {
    expect(carbonMissingText([], true, 120)).toBe("Carbone non calculé : un sens n'a pas de trajet de 2\u00a0h ou moins.");
    expect(carbonMissingText(['facteur non publié', 'facteur non publié'], false, 120)).toBe('Carbone non calculé : facteur non publié.');
    expect(carbonMissingText([], false, 120)).toBeNull();
  });
});

describe('sans itinéraire : la phrase du pli et le chiffre du titre', () => {
  const labels = DAYS.map((d) => d.label);
  it('horaires libres, comparaison, vélo + TC', () => {
    expect(noItineraryCostText('shift', labels)).toEqual({ text: 'Coût et carbone : calculés en journée-type seulement (6h-14h, 9h-17h, 14h-22h).', figure: 'non calculés en horaires libres' });
    expect(noItineraryCostText('compare', labels)).toEqual({ text: 'Coût et carbone : calculés pour une seule commune, hors comparaison.', figure: 'hors comparaison' });
    expect(noItineraryCostText('bike_transit', labels).text).toBe('Coût et carbone : calculés pour les transports en commun seulement.');
    expect(noItineraryCostText('compare', labels, false).text).toBe('Coût : calculé pour une seule commune, hors comparaison.');
  });
});

describe('journée-type la plus proche des horaires libres', () => {
  it('8h-16h → 9h-17h ; 13h-21h → 14h-22h ; 5h-13h → 6h-14h', () => {
    expect(nearestDayType(DAYS, { start: 8 * 60, end: 16 * 60 })).toBe('d09');
    expect(nearestDayType(DAYS, { start: 13 * 60, end: 21 * 60 })).toBe('d14');
    expect(nearestDayType(DAYS, { start: 5 * 60, end: 13 * 60 })).toBe('d06');
  });
  it('sur 24 h (poste de nuit), égalité : la première publiée', () => {
    expect(nearestDayType(DAYS, { start: 22 * 60, end: 6 * 60 })).toBe('d06');
    expect(nearestDayType([], { start: 0, end: 60 })).toBeNull();
  });
});

describe('textes sans tiret long', () => {
  it('aucun U+2013 ni U+2014', () => {
    const rt = transitRoundTrip(orly, orly, navigo, extra);
    const all = [
      ticketLine(ticketFact(metro(2.55), 'out'), ticketFact(metro(2.55), 'ret')),
      passLine(navigo, rt, extra, 120).lead,
      noItineraryCostText('shift', ['6h-14h']).text,
      carbonMissingText([], true, 120),
    ].join(' ');
    expect(all).not.toMatch(LONG_DASH);
  });
});
