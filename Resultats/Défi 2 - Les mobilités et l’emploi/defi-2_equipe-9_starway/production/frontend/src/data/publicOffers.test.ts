import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  astreOffers,
  asOfText,
  employerOf,
  frDate,
  isPublicOffersFile,
  isPublicOffersList,
  LIMITS,
  offersPhrase,
  offerUrl,
  recentOffers,
  regionText,
  scopeText,
  type PublicOffersFile,
  type PublicOffersList,
} from './publicOffers';
import type { Pole } from './types';

/**
 * Offres diffusées sur Choisir le service public (D-036) sur les données PUBLIÉES : une offre n'a qu'une commune, un astre
 * en somme les communes, aucune valeur inventée, jamais « postes ouverts », jamais mélangées aux postes salariés recensés par l'INSEE.
 */
const read = <T,>(rel: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf-8')) as T;
const file = read<PublicOffersFile>('service_public.json');
const list = read<PublicOffersList>('service_public_offres.json');
const poles44 = read<Pole[]>('poles.json');

const BAD = /\bnull\b|\bundefined\b|\bNaN\b|Infinity|\[object/;

describe('fichiers publiés', () => {
  it('les deux contrats sont reconnus', () => {
    expect(isPublicOffersFile(file)).toBe(true);
    expect(isPublicOffersList(list)).toBe(true);
  });

  it('refuse une page HTML de repli, un ancien contrat et un total incohérent', () => {
    expect(isPublicOffersFile('<!doctype html>')).toBe(false);
    expect(isPublicOffersFile({ ...file, contract: 'service-public-0' })).toBe(false);
    expect(isPublicOffersFile({ ...file, communes: { '75101': { n: -1, v: {} } } })).toBe(false);
    expect(isPublicOffersList({ ...list, link: 'https://exemple.fr/' })).toBe(false);
    expect(isPublicOffersList(null)).toBe(false);
  });

  it('la date du fichier est celle du 11/10/2026 et le texte la reprend', () => {
    expect(file.as_of).toBe('2026-10-11');
    expect(asOfText(file)).toBe('au 11/10/2026');
    expect(offersPhrase(1, file)).toBe('1 offre diffusée au 11/10/2026');
    expect(offersPhrase(62, file)).toBe('62 offres diffusées au 11/10/2026');
    expect(frDate('2026-10-11')).toBe('11/10/2026');
    expect(frDate('11/10/2026')).toBe('');
  });

  it('les comptes se recoupent : communes + département = Île-de-France, la liste = les comptes', () => {
    expect(file.region.offers).toBe(file.region.commune + file.region.departement);
    const sum = Object.values(file.communes).reduce((s, c) => s + c.n, 0);
    expect(sum).toBe(file.region.commune);
    for (const [insee, c] of Object.entries(file.communes)) {
      expect(Object.values(c.v).reduce((s, n) => s + n, 0), insee).toBe(c.n);
      expect(list.communes[insee]?.length, insee).toBe(c.n);
    }
  });

  it("l'écart de métadonnées est écrit : la fiche dit 2021-2023, le fichier va plus loin", () => {
    expect(file.metadata_gap.fiche_temporal_coverage).toEqual({ start: '2021-01-01', end: '2023-12-31' });
    expect(file.metadata_gap.note).toMatch(/2021-2023/);
  });
});

describe('rattachement aux astres (les communes)', () => {
  it('les 44 astres : chaque offre rattachée à une commune est dans exactement un astre', () => {
    const sum = poles44.reduce((s, p) => s + astreOffers(file, p).n, 0);
    expect(sum).toBe(file.region.commune);
  });

  it('Paris : un arrondissement ne porte que ses offres, la somme des 20 est celle de Paris rattachée', () => {
    const paris = poles44.filter((p) => /^BE_1107_751/.test(p.id));
    expect(paris).toHaveLength(20);
    const sum = paris.reduce((s, p) => s + astreOffers(file, p).n, 0);
    const direct = Object.entries(file.communes)
      .filter(([k]) => /^751\d\d$/.test(k))
      .reduce((s, [, c]) => s + c.n, 0);
    expect(sum).toBe(direct);
  });

  it('versants : somme = total, libellés du fichier, zéro omis', () => {
    const big = poles44.map((p) => astreOffers(file, p)).sort((a, b) => b.n - a.n)[0]!;
    expect(big.versants.reduce((s, v) => s + v.n, 0)).toBe(big.n);
    expect(big.versants.every((v) => v.n > 0 && v.label.length > 3)).toBe(true);
  });

  it('un astre sans offre rattachée : zéro, jamais une valeur inventée', () => {
    const a = astreOffers(file, { communes: ['00000'] });
    expect(a).toMatchObject({ n: 0, versants: [], communes: [], communeCount: 1 });
  });
});

describe('textes', () => {
  it('jamais « postes ouverts », jamais de tiret long, jamais de valeur absente écrite', () => {
    const all = [regionText(file), scopeText({ n: 3, communes: ['a', 'b'], communeCount: 9 }), scopeText({ n: 1, communes: ['a'], communeCount: 1 }), ...LIMITS, file.method, file.metadata_gap.note].join('\n');
    expect(all.toLowerCase()).not.toMatch(/postes? ouverts?/);
    expect(all).not.toMatch(/[\u2013\u2014]/);
    expect(all).not.toMatch(BAD);
  });

  it('le repère régional sépare ce qui est rattaché à une commune de ce qui reste au département', () => {
    const t = regionText(file);
    expect(t).toContain('connues seulement au département');
    expect(t).toContain('non réparties entre les astres');
    expect(t).toContain('au 11/10/2026');
  });
});

describe('liste des offres', () => {
  const t4 = poles44.find((p) => p.communes.length > 50)!;

  it('les plus récentes d\'abord, bornées, avec le total', () => {
    const { offers, total } = recentOffers(list, t4, 5);
    expect(offers.length).toBeLessThanOrEqual(5);
    expect(total).toBe(astreOffers(file, t4).n);
    for (let i = 1; i < offers.length; i++) expect(offers[i - 1]!.d >= offers[i]!.d).toBe(true);
  });

  it("lien officiel de la forme publiée, référence encodée, employeur lu dans la liste", () => {
    const o = recentOffers(list, t4, 1).offers[0]!;
    expect(offerUrl(list, o.r)).toBe(`https://choisirleservicepublic.gouv.fr/offre-emploi/offre-reference-${encodeURIComponent(o.r)}/`);
    expect(employerOf(list, o).length).toBeGreaterThan(0);
    expect(employerOf(list, { e: 99999 })).toBe('');
  });

  it("aucun champ personnel : seulement référence, intitulé, versant, employeur, dates", () => {
    const keys = new Set(Object.values(list.communes).flatMap((l) => l.flatMap((o) => Object.keys(o))));
    expect([...keys].sort()).toEqual(['d', 'e', 'f', 'r', 't', 'v']);
    const text = JSON.stringify(list);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
  });
});
