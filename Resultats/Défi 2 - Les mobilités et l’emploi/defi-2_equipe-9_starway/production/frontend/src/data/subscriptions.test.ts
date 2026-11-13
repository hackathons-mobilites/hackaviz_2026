import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { itineraryOf, type ItinerariesFile } from './itineraries';
import cases from './subscriptionCases.json';
import {
  coveringOptions,
  isSubscriptionsFile,
  legCostText,
  navigoTripNote,
  priceText,
  slicesBeyond,
  transitLegCost,
  transitRoundTrip,
  velibRideCost,
  velibRoundTrip,
  type ExtraTitle,
  type SubscriptionsFile,
  type TransitOption,
  type TripLike,
  type VelibOffer,
} from './subscriptions';

// Mêmes cas que pipeline/tests/test_subscriptions.py : les deux calculs doivent rendre le même résultat.
const extra = cases.extra_titles as Record<string, ExtraTitle>;
const options = cases.options as unknown as Record<string, TransitOption>;
const trips = cases.trips as unknown as Record<string, TripLike>;
const offers = cases.velib_offers as unknown as Record<string, VelibOffer>;
const opt = (k: string | null) => (k === null ? null : options[k]!);
const unpriced = cases.unpriced_agencies as Record<string, string>;

describe('coût TC selon l’abonnement (cas partagés)', () => {
  for (const c of cases.leg_cases) {
    it(`${c.trip} / ${c.option}`, () => {
      const got = transitLegCost(trips[c.trip], opt(c.option), extra, unpriced) as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(c.expect)) expect(got[k]).toEqual(v);
    });
  }
  for (const c of cases.round_trip_cases) {
    it(`aller-retour ${c.out} + ${c.ret} / ${c.option}`, () => {
      expect(transitRoundTrip(trips[c.out], trips[c.ret], opt(c.option), extra).total_eur).toEqual(c.expect.total_eur);
    });
  }
});

describe('Vélib’ (cas partagés)', () => {
  for (const c of cases.slice_cases) {
    it(`tranches ${c.ride} min, ${c.included} incluses`, () => expect(slicesBeyond(c.ride, c.included)).toBe(c.expect));
  }
  for (const c of cases.ride_cases) {
    it(`course ${c.ride} min / ${c.offer}`, () => {
      const got = velibRideCost(c.ride, offers[c.offer]!);
      expect([got.status, got.eur]).toEqual([c.expect.status, c.expect.eur]);
    });
  }
  for (const c of cases.velib_round_trip_cases) {
    it(`aller-retour ${c.out} + ${c.ret} / ${c.offer}`, () => {
      expect(velibRoundTrip(c.out, c.ret, offers[c.offer]!).total_eur).toEqual(c.expect.total_eur);
    });
  }
  it('durée négative refusée', () => expect(() => slicesBeyond(-1, 30)).toThrow());
});

describe('textes', () => {
  it('prix : gratuit, par mois, prix non publié avec sa raison', () => {
    expect(priceText({ eur: 0, per: 'month' })).toBe('gratuit');
    expect(priceText({ eur: 90.8, per: 'month' })).toMatch(/^90,80\s€ par mois$/);
    expect(priceText({ eur: null, per: 'year', reason: 'fixé par le département' })).toBe('fixé par le département');
  });
  it('un sens : inclus, en plus, non calculé ; rien sans trajet', () => {
    expect(legCostText(transitLegCost(trips.metro, options.navigo!, extra), extra, 'out')).toBe('Aller : inclus dans votre abonnement.');
    expect(legCostText(transitLegCost(trips.orlyval, options.navigo!, extra), extra, 'ret')).toMatch(/^Retour : 14,00\s€ en plus \(Ticket Orlyval, non couvert/);
    expect(legCostText(transitLegCost(trips.ter, options.day!, extra), extra, 'out')).toBe('Aller : coût non calculé (TER : non écrit).');
    expect(legCostText(transitLegCost(trips.absent, null, extra), extra, 'out')).toBeNull();
  });
});

describe('phrase du Navigo sous le prix au ticket (B2, audit du 09/11)', () => {
  const pub = new URL('../../public/data/subscriptions.json', import.meta.url);
  const itin = new URL('../../public/data/itineraries/91027.json.gz', import.meta.url);
  const file = existsSync(pub) ? (JSON.parse(readFileSync(pub, 'utf-8')) as SubscriptionsFile) : null;

  it('sans le fichier : renvoi général, jamais « inclus »', () => {
    const t = navigoTripNote(null, trips.metro, trips.metro);
    expect(t).toMatch(/hors titres non couverts : voir « Selon vos abonnements »$/);
    expect(t).not.toMatch(/inclus/);
  });
  it.skipIf(!file)('métro seul : inclus ; TER, Orlyval : pas de « inclus »', () => {
    expect(navigoTripNote(file, trips.metro, trips.metro)).toBe('avec un Navigo Mois, le trajet est inclus');
    const orly = navigoTripNote(file, trips.metro, trips.orlyval);
    expect(orly).toBe('avec un Navigo Mois, reste à payer : ticket orlyval au retour (voir « Selon vos abonnements »)');
  });
  it.skipIf(!existsSync(itin) || !file)('Athis-Mons, 14h-22h, retour de BE_1119 par Orlyval : le trajet publié n’est pas dit inclus', () => {
    const it91027 = JSON.parse(gunzipSync(readFileSync(itin)).toString('utf-8')) as ItinerariesFile;
    const out = itineraryOf(it91027, 'BE_1119', 'd14', 'out');
    const ret = itineraryOf(it91027, 'BE_1119', 'd14', 'ret');
    expect(ret?.legs?.some((l) => l.line === 'ORLYVAL')).toBe(true);
    const t = navigoTripNote(file, out, ret);
    expect(t).not.toMatch(/inclus/);
    expect(t).toMatch(/ticket orlyval au retour/);
  });
});

describe('subscriptions.json publié', () => {
  const url = new URL('../../public/data/subscriptions.json', import.meta.url);
  it.skipIf(!existsSync(url))('contrat lisible, aucun tiret long, couverture sourcée', () => {
    const text = readFileSync(url, 'utf-8');
    for (const code of [0x2013, 0x2014]) expect(text.includes(String.fromCharCode(code))).toBe(false);
    const f = JSON.parse(text) as unknown;
    expect(isSubscriptionsFile(f)).toBe(true);
    if (!isSubscriptionsFile(f)) return;
    for (const o of f.transit.options) {
      for (const [fam, v] of Object.entries(o.covers)) if (v === 'unknown') expect(o.unknown_reasons[fam as keyof typeof o.unknown_reasons]).toBeTruthy();
    }
    // Un trajet métro simple est couvert par les titres tout public publiés (Navigo Mois, Semaine, Annuel, Jour)
    const ids = coveringOptions(f, trips.metro, trips.bus).map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(['navigo_month', 'navigo_week', 'navigo_annual', 'navigo_day']));
  });
});
