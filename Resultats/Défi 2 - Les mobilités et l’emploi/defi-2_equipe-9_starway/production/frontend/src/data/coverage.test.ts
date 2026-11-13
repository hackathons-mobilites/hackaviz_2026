import { describe, expect, it } from 'vitest';
import { demoDataset } from './demo/generateDemo';
import { modeComputedFor, modeCoverageText, modeMissingMessage, modePublishedIn, modeUnavailableText } from './coverage';

describe('meta.mode_coverage', () => {
  const meta = { ...demoDataset('query').meta, mode_coverage: { bike_transit: ['93048'] } };
  it('mode partiel : seulement les communes listées', () => {
    expect(modeComputedFor(meta, 'bike_transit', '93048')).toBe(true);
    expect(modeComputedFor(meta, 'bike_transit', '93066')).toBe(false);
  });
  it('mode absent de mode_coverage : toutes les communes', () => {
    expect(modeComputedFor(meta, 'transit', '93066')).toBe(true);
    expect(modeComputedFor({ ...meta, mode_coverage: {} }, 'bike_transit', '93066')).toBe(true);
  });
});

describe('mode partiel en clair (vélo + TC)', () => {
  const meta = { ...demoDataset('query').meta, mode_coverage: { bike_transit: ['93048', '93066'] } };
  it('nombre de communes lu dans mode_coverage', () => {
    expect(modeCoverageText(meta, 'bike_transit')).toBe('calculé pour 2 communes seulement');
    expect(modeCoverageText(meta, 'transit')).toBeNull();
    expect(modeCoverageText({ ...meta, mode_coverage: { bike_transit: [] } }, 'bike_transit')).toBe('pas encore calculé');
  });
  it('message seulement pour une commune hors couverture', () => {
    expect(modeMissingMessage(meta, 'bike_transit', '75101', 'Vélo + TC')).toBe('Vélo + TC non calculé pour cette commune (calculé pour 2 communes seulement).');
    expect(modeMissingMessage(meta, 'bike_transit', '93048', 'Vélo + TC')).toBeNull();
    expect(modeMissingMessage(meta, 'transit', '75101', 'TC + marche')).toBeNull();
  });
});

describe('mode publié dans access/ (D-029 : car_traffic déduit de car)', () => {
  const meta = demoDataset('query').meta;
  const cc = { ...(meta.car_congestion ?? {}), base_mode: 'car' } as NonNullable<typeof meta.car_congestion>;
  const withCar = { modes: { car: { any: {} } } } as never;
  const withoutCar = { modes: { transit: { d09: {} } } } as never;
  it('car_traffic : disponible dès que la série car et meta.car_congestion existent', () => {
    expect(modePublishedIn({ car_congestion: cc }, withCar, 'car_traffic')).toBe(true);
    expect(modePublishedIn({ car_congestion: cc }, withoutCar, 'car_traffic')).toBe(false);
    expect(modePublishedIn({ car_congestion: undefined }, withCar, 'car_traffic')).toBe(false);
  });
  it('autres modes : la série du mode elle-même', () => {
    expect(modePublishedIn({ car_congestion: cc }, withCar, 'car')).toBe(true);
    expect(modePublishedIn({ car_congestion: cc }, withCar, 'transit')).toBe(false);
    expect(modePublishedIn({ car_congestion: cc }, withoutCar, 'transit')).toBe(true);
  });
});

describe("Vélib' grisé : raison en clair (D-027)", () => {
  const base = demoDataset('query').meta;
  const meta = {
    ...base,
    mode_coverage: { velib: ['75101', '75102', '92012'] },
    velib: { ...(base.velib ?? {}), out_of_zone: "Pas de station Vélib' dans cette commune" } as NonNullable<typeof base.velib>,
  };
  it('commune sans station : texte publié meta.velib.out_of_zone', () => {
    expect(modeUnavailableText(meta, 'velib', '93066')).toBe("pas de station Vélib' dans cette commune");
  });
  it('sans commune : nombre de communes avec une station, lu dans mode_coverage', () => {
    expect(modeUnavailableText(meta, 'velib', null)).toBe('3 communes avec une station seulement');
    expect(modeCoverageText(meta, 'velib')).toBe('3 communes avec une station seulement');
  });
  it('autres modes : portée inchangée', () => {
    expect(modeUnavailableText({ ...meta, mode_coverage: { bike_transit: ['93048'] } }, 'bike_transit', '75101')).toBe('calculé pour 1 commune seulement');
    expect(modeUnavailableText(meta, 'car_traffic', '75101')).toBe('pas encore calculé');
  });
});
