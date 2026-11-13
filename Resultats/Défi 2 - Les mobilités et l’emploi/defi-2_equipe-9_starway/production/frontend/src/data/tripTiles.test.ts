import { describe, expect, it } from 'vitest';
import type { CarLegFacts, CarTripFacts } from './carCost';
import { carCostChartModel, carCostReading, euroRange } from './carCostChart';
import type { ItinTrip } from './itineraries';
import type { LegCost, TransitOption } from './subscriptions';
import { BIKE_CARBON, BIKE_TRANSIT_DETAIL, BIKE_TRANSIT_TC, bikeCarbonTile, carbonTile, costTile, durationTile, roundTripLine } from './tripTiles';

/* FIXTURES : formes des contrats (itinéraires D-028, coût D-032, voiture D-029), valeurs d'exemple, pas des données publiées. */
const NO_DASH = /[\u2013\u2014]/;
const trip = (min: number, g: number | null): ItinTrip =>
  ({ status: 'ok', dep: '08:10', arr: '08:58', min, co2_g: g == null ? { value: null, status: 'no_factor', reason: 'facteur non publié pour une ligne' } : { value: g, status: 'ok' } }) as ItinTrip;
const tickets = (eur: number | null): LegCost => (eur == null ? { status: 'unknown', extra_eur: null, items: [], reasons: ['prix non publié'] } : { status: 'tickets', extra_eur: eur, items: [], reasons: [] });
const navigo = { id: 'navigo_month', label: 'Navigo Mois', kind: 'pass' } as unknown as TransitOption;

describe('tuiles du bloc « Trajet » (D-066)', () => {
  it('durée : la valeur publiée, sinon « Inconnue »', () => {
    expect(durationTile(trip(48, 93)).value).toBe('48\u00a0min');
    expect(durationTile({}).value).toBe('Inconnue');
  });

  it('coût au ticket : le chiffre en grand, « au ticket » dessous, les tickets dans le « i »', () => {
    const t = costTile(tickets(2.55), null, {}, '1 ticket Métro-Train-RER');
    expect(t.value).toBe('2,55\u00a0€');
    expect(t.sub).toBe('au ticket');
    expect(t.tip).toEqual(['Au ticket, plein tarif (1 ticket Métro-Train-RER).']);
  });

  it('trajet entièrement à pied : « à pied, aucun ticket », sans « i »', () => {
    expect(costTile(tickets(0), null, {}, null)).toEqual({ value: '0,00 €', sub: 'à pied, aucun ticket', tip: [] });
  });

  it('prix inconnu : écrit tel quel, jamais 0, la raison publiée au « i »', () => {
    const t = costTile(tickets(null), null, {}, null);
    expect(t.value).toBe('Prix inconnu');
    expect(t.tip).toEqual(['Prix non publié.']);
  });

  it('abonnement : inclus ou en plus, avec le nom du titre', () => {
    expect(costTile({ status: 'included', extra_eur: 0, items: [], reasons: [] }, navigo, {}, null).sub).toBe('inclus, Navigo Mois');
    const extra = costTile({ status: 'extra', extra_eur: 14, items: [{ title: 'orlyval', count: 1 }], reasons: [] }, navigo, { orlyval: { label: 'Ticket Orlyval' } as never }, null);
    expect(extra.sub).toBe('en plus, Navigo Mois');
    expect(extra.tip[0]).toBe('En plus de votre Navigo Mois : Ticket Orlyval, non couvert.');
  });

  it('carbone : « estimation » toujours écrit sous un chiffre ; sinon « Non calculé » et la raison publiée', () => {
    const ok = carbonTile(trip(48, 93).co2_g, 'garde');
    expect(ok).toEqual({ value: '93\u00a0g CO2e', sub: 'estimation', tip: ['garde'] });
    const ko = carbonTile(trip(48, null).co2_g, 'garde');
    expect(ko.value).toBe('Non calculé');
    expect(ko.tip).toEqual(['Facteur non publié pour une ligne.']);
  });

  it('aller et retour : chaque partie seulement si les DEUX sens la donnent, jamais un total partiel', () => {
    expect(roundTripLine({ out: trip(48, 93), ret: trip(43, 90), outCost: tickets(2.55), retCost: tickets(2.55), option: null })).toBe(
      'Aller et retour : 91\u00a0min · 5,10\u00a0€ au ticket · environ 183\u00a0g CO2e (estimation)',
    );
    expect(roundTripLine({ out: trip(48, 93), ret: trip(43, null), outCost: tickets(2.55), retCost: tickets(null), option: null })).toBe('Aller et retour : 91\u00a0min');
    expect(roundTripLine({ out: trip(48, 93), ret: null, outCost: tickets(2.55), retCost: null, option: null })).toBeNull();
    const inc: LegCost = { status: 'included', extra_eur: 0, items: [], reasons: [] };
    expect(roundTripLine({ out: trip(48, 93), ret: trip(43, 90), outCost: inc, retCost: inc, option: navigo })).toContain('rien en plus de votre Navigo Mois');
  });

  it('vélo : des mots, jamais un chiffre de carbone (aucune source retenue ne publie de facteur du vélo)', () => {
    expect(BIKE_CARBON.value).toBe("Pas d'émission à l'usage");
    expect(`${BIKE_CARBON.value} ${BIKE_CARBON.sub} ${BIKE_CARBON.tip.join(' ')}`).not.toMatch(/\d/);
    expect(BIKE_TRANSIT_TC.value).toBe('Non calculé');
    // arbitrage du 11/11 : la vitesse du calcul est lue (meta.speeds.bike_kmh), jamais écrite ; sans elle, aucun sous-libellé
    expect(bikeCarbonTile(12).sub).toBe('vitesse du calcul : 12\u00a0km/h');
    expect(bikeCarbonTile(12.5).sub).toBe('vitesse du calcul : 12,5\u00a0km/h');
    expect(bikeCarbonTile(null).sub).toBeNull();
    expect(`${BIKE_CARBON.sub ?? ''} ${BIKE_CARBON.tip.join(' ')}`).not.toContain('sans assistance');
  });

  it('aucun tiret long, ni « offre »', () => {
    const all = [...[BIKE_CARBON, BIKE_TRANSIT_TC].flatMap((t) => [t.value, t.sub ?? '', ...t.tip]), ...BIKE_TRANSIT_DETAIL].join(' ');
    expect(all).not.toMatch(NO_DASH);
    expect(all.toLowerCase()).not.toContain('offre');
  });
});

const leg = (distM: number, energy: number, toll: CarLegFacts['toll']): CarLegFacts => {
  const tMin = toll ? (toll.status === 'sans_peage' ? 0 : toll.min) : null;
  const tMax = toll ? (toll.status === 'sans_peage' ? 0 : toll.max) : null;
  return { distM, energy, toll, totalMin: tMin == null ? null : energy + tMin, totalMax: tMax == null ? null : energy + tMax, co2: 3201, minutes: 30 };
};

describe('graphique du coût de la voiture (D-066)', () => {
  const facts: CarTripFacts = {
    out: leg(17700, 2.49, { status: 'sans_peage', min: 0, max: 0, items: [] }),
    ret: leg(18600, 2.62, { status: 'fourchette', min: 3.1, max: 4.2, items: [{ e: 1, s: 1 }] } as never),
    energy: 5.11,
    totalMin: 8.83,
    totalMax: 9.93,
    co2: 6575,
  };

  it('une barre par sens, échelle commune au plus grand total (haut de la fourchette)', () => {
    const m = carCostChartModel(facts)!;
    expect(m.rows.map((r) => r.label)).toEqual(['Aller · 17,7\u00a0km', 'Retour · 18,6\u00a0km']);
    expect(m.rows[0]).toMatchObject({ energy: 2.49, tollMin: 0, tollMax: 0, text: '2,49\u00a0€' });
    expect(m.rows[1]).toMatchObject({ tollMin: 3.1, tollMax: 4.2, text: euroRange(5.72, 6.82) });
    expect(m.axisMax).toBeCloseTo(6.82, 5);
  });

  it('péage inconnu : la barre s’arrête à l’énergie et le montant le dit', () => {
    const m = carCostChartModel({ ...facts, ret: { ...facts.ret, toll: { status: 'inconnu', min: null, max: null, items: [] } as never, totalMin: null, totalMax: null } })!;
    expect(m.rows[1]).toMatchObject({ tollMin: null, text: '2,62\u00a0€ sans le péage' });
  });

  it('« Comment lire ce graphique » : le cas affiché, avec les valeurs du modèle', () => {
    const r = carCostReading(carCostChartModel(facts)!, { total: 'de 8,83 € à 9,93 €', co2: 6575 });
    expect(r.example[0]).toBe("À l'aller (17,7\u00a0km) : énergie 2,49\u00a0€, aucun péage, soit 2,49\u00a0€.");
    expect(r.example[1]).toContain('péage 3,10 à 4,20\u00a0€');
    expect(r.example[2]).toMatch(/^Aller et retour : de 8,83 € à 9,93 €, et environ 6.575\u00a0g CO2e \(estimation, énergie seule\)\.$/);
    expect([...r.parts, ...r.example].join(' ')).not.toMatch(NO_DASH);
  });

  it('aucun sens avec distance : rien à dessiner', () => {
    expect(carCostChartModel({ ...facts, out: { ...facts.out, distM: null }, ret: { ...facts.ret, distM: null } })).toBeNull();
  });
});
