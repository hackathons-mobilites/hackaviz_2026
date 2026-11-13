import { describe, expect, it } from 'vitest';
import { durationOral, eurosOral, hourOral, jobsOral, peopleOral, percentOral, populationOral, regionPopulation, starsOral } from './oral';

const NBSP = '\u00a0';

describe('formats oraux (règles d’arrondi)', () => {
  it('étoiles accordées', () => {
    expect(starsOral(0)).toBe('aucune étoile');
    expect(starsOral(1)).toBe('une étoile');
    expect(starsOral(7)).toBe('7 étoiles');
    expect(starsOral(null)).toBeNull();
  });
  it('postes : millions, dizaines de milliers, milliers, préfixe selon le sens', () => {
    expect(jobsOral(2_693_126)).toBe('près de 2,7 millions de postes');
    expect(jobsOral(1_240_000)).toBe('plus de 1,2 million de postes');
    expect(jobsOral(2_000_000)).toBe('2 millions de postes');
    expect(jobsOral(853_210)).toBe(`plus de 850${NBSP}000 postes`);
    expect(jobsOral(42_707)).toBe(`près de 43${NBSP}000 postes`);
    expect(jobsOral(0)).toBeNull();
    expect(jobsOral(null)).toBeNull();
  });
  it('population : arrondi inférieur', () => {
    expect(populationOral(12_271_794)).toBe('plus de 12 millions');
    expect(populationOral(1_000_000)).toBe('1 million');
  });
  it('heures', () => {
    expect(hourOral('06:00')).toBe('6 heures');
    expect(hourOral('01:00')).toBe('1 heure');
    expect(hourOral('14:30')).toBe('14 heures 30');
    expect(hourOral('6h')).toBeNull();
  });
  it('pourcentages à l’unité', () => {
    expect(percentOral(62.8)).toBe(`63${NBSP}%`);
    expect(percentOral(null)).toBeNull();
  });
  it('population régionale sans double compte de Paris', () => {
    expect(
      regionPopulation([
        { insee: '75056', population: 100 },
        { insee: '75101', population: 40 },
        { insee: '75102', population: 60 },
        { insee: '93048', population: 10 },
      ]),
    ).toBe(110);
    expect(regionPopulation([{ insee: '93048', population: null }])).toBeNull();
  });
  it('personnes (flux) : millier, centaine, dizaine ; « environ » pour un ordre de grandeur', () => {
    expect(peopleOral(1_633)).toBe(`plus de 1${NBSP}600`);
    expect(peopleOral(870)).toBe('870');
    expect(peopleOral(866)).toBe('près de 870');
    expect(peopleOral(12_340)).toBe(`plus de 12${NBSP}000`);
    expect(peopleOral(9_960)).toBe(`près de 10${NBSP}000`);
    expect(peopleOral(132, true)).toBe('environ 130');
    expect(peopleOral(0)).toBeNull();
    expect(peopleOral(null)).toBeNull();
  });
  it('euros à la centaine', () => {
    expect(eurosOral(42_520)).toBe(`42${NBSP}500 euros`);
    expect(eurosOral(23_480)).toBe(`23${NBSP}500 euros`);
    expect(eurosOral(null)).toBeNull();
  });
  it('durées en heures et minutes', () => {
    expect(durationOral(120)).toBe('2 heures');
    expect(durationOral(90)).toBe('1 heure 30');
    expect(durationOral(60)).toBe('1 heure');
    expect(durationOral(45)).toBe('45 minutes');
    expect(durationOral(1)).toBe('1 minute');
    expect(durationOral(0)).toBeNull();
    expect(durationOral(null)).toBeNull();
  });
});
