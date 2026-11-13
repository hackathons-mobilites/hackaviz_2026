import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { projectsPhrase, type BmoFile } from '../../data/bmo';
import type { Pole } from '../../data/types';
import { BmoMethodLine } from '../provenance/BmoMethodNote';
import { RecruitBlock, RecruitKeepLine } from './ProofRecruit';

/**
 * Bloc « Projets de recrutement du bassin » sur les données PUBLIÉES : mode sources coupé par défaut (D-033, aucune
 * ligne de source dans le rendu), jamais « null » ni « NaN », « non disponible » sans valeur pour un astre sans bassin.
 */
const read = <T,>(rel: string): T => JSON.parse(readFileSync(new URL(`../../../public/data/${rel}`, import.meta.url), 'utf-8')) as T;
const file = read<BmoFile>('bmo.json');
const BAD = /\bnull\b|\bundefined\b|\bNaN\b|Infinity|\[object/;

const bassinPole = (id: string, code: string, name: string): Pole => ({ id, bassin: { code, name, source: 'GEO04 - France Travail, bassins d\'emploi 2026' } }) as Pole;
const t4 = bassinPole('BE_1146', '1146', 'T4 Paris Ouest La Défense');
const paris = Array.from({ length: 20 }, (_, i) => bassinPole(`BE_1107_751${String(i + 1).padStart(2, '0')}`, '1107', 'T1 Paris'));
const old = { id: 'P_DEFENSE' } as Pole;

const render = (pole: Pole, poles: Pole[], bmo: Parameters<typeof RecruitBlock>[0]['bmo'] = { status: 'ready', file }, family: string | null = null) =>
  renderToStaticMarkup(createElement(RecruitBlock, { pole, poles, bmo, family, onFamily: () => undefined }));

describe('bloc projets de recrutement', () => {
  it('un astre-bassin : minimum, tendance, familles, limites, sans source tant que le mode sources est coupé', () => {
    const html = render(t4, [t4, ...paris]);
    expect(html).toContain('Projets de recrutement du bassin');
    expect(html).toContain('Bassin d&#x27;emploi T4 Paris Ouest La Défense');
    expect(html).toMatch(/au moins 32\u00a0926|32\u00a0926/);
    expect(html).toContain('tendance');
    expect(html).toContain('Champ et limites');
    expect(html).toContain('388\u00a0806');
    expect((html.match(/<li/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(html).not.toContain('prov-note');
    expect(html).not.toMatch(/EMP03|GEO04/);
    expect(html).not.toMatch(BAD);
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('une famille choisie : son total, ses difficiles et saisonniers, avec « au moins » si des cases « * » manquent', () => {
    const fam = file.families[0]!;
    const html = render(t4, [t4], { status: 'ready', file }, fam.code);
    expect(html).toContain(fam.label);
    expect(html).toContain('jugés difficiles');
    expect(html).not.toMatch(BAD);
  });

  it('Paris : le bloc est commun aux 20 arrondissements et le dit', () => {
    const html = render(paris[0]!, paris);
    expect(html).toContain('T1 Paris');
    expect(html).toContain('couvre 20 astres');
    expect(html).toMatch(/au moins 118\u00a0850/);
    expect(html).toContain('6 cases « * » : non diffusé par France Travail (vraisemblablement moins de 5 projets)');
    expect(html).toContain('Déduction de l&#x27;équipe');
    expect(html).toContain('Non comptées');
    expect(html).not.toMatch(/non publié/);
  });

  it('pli fermé (audit du 10/11) : une seule ligne chiffrée, le reste dans son « i », mots inchangés', () => {
    const bassin = file.bassins['1146']!;
    const html = renderToStaticMarkup(createElement(RecruitKeepLine, { file, bassin, astres: 1 }));
    const line = html.slice(0, html.indexOf('<span class="info-tip'));
    // la ligne : total et difficiles lus dans le fichier, « dont au moins » ; la réserve « ni des offres… » au « i » (audit du 11/11, P36)
    expect(line).toContain(`Projets de recrutement ${file.year} du bassin : ${projectsPhrase(bassin.total.met)}, dont ${projectsPhrase(bassin.total.xmet)} jugés difficiles.`);
    expect(line).not.toContain('ni des offres publiées');
    expect(line).not.toContain('tendance');
    // le « i » : bassin, intentions de fin d'année et réserve (phrase de `trendText`, mots inchangés), tendance, saisonniers, découpage du bassin
    expect(html).toContain('aria-label="En savoir plus sur les projets de recrutement du bassin"');
    expect(html).toContain('Bassin d&#x27;emploi T4 Paris Ouest La Défense.');
    expect(html).toContain(`Ce sont des intentions recueillies fin ${file.year - 1} : ni des offres publiées, ni des embauches.`);
    expect(html).toContain('Ce chiffre donne une tendance des bassins de recrutement.');
    expect(html).toContain(`Projets saisonniers : ${projectsPhrase(bassin.total.smet)}.`);
    expect(html).toContain('Le bassin d&#x27;emploi est un découpage de France Travail.');
    expect((html.match(/ni des offres publiées/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(BAD);
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('pli ouvert (audit du 10/11) : « au moins » visible, cases « * » et découpage du bassin dans un « i »', () => {
    const html = renderToStaticMarkup(createElement(RecruitBlock, { pole: t4, poles: [t4], bmo: { status: 'ready', file }, family: null, onFamily: () => undefined, keepOut: true }));
    expect(html).toMatch(/<span class="pf-stat">au moins /);
    expect(html).toContain('aria-label="Pourquoi « au moins » ?"');
    expect(html).toContain('aria-label="Qu&#x27;est-ce que le bassin d&#x27;emploi ?"');
    // plus de paragraphe pour ces textes : ils sont dans les bulles
    expect(html).not.toMatch(/<p class="pf-recruit-detail[^"]*">[^<]*cases « \* »/);
    expect(html).not.toMatch(/<p class="pf-note">Le bassin d/);
    // keepOut : ni la ligne ni la tendance ne sont répétées
    expect(html).not.toContain('pf-recruit-trend');
    expect(html).not.toContain('Dont au moins');
  });

  it('Champ et limites : « * » est une déduction ; l\'intérim n\'est pas affirmé', () => {
    const html = render(t4, [t4]);
    expect(html).toMatch(/Cases marquées « \* » : non diffusé par France Travail/);
    expect(html).toContain('53\u00a0786 lignes');
    expect(html).toContain('l&#x27;équipe n&#x27;a pas la réponse');
  });

  it('mode sources (D-033) : la ligne de méthode accompagne la source ; coupé par défaut : ni source ni méthode dans le bloc', () => {
    const off = render(t4, [t4]);
    expect(off).not.toContain('Méthode');
    expect(off).not.toContain('prov-note');
    const html = renderToStaticMarkup(createElement(BmoMethodLine, { masked: file.masked }));
    expect(html).toContain('prov-note');
    expect(html).toContain('Méthode : somme des cases publiées');
    expect(html).toContain('au moins n');
    expect(html).not.toMatch(BAD);
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('astre sans bassin : non disponible pour cet astre, sans valeur', () => {
    const html = render(old, [old]);
    expect(html).toContain('Non disponible pour cet astre');
    expect(html).not.toMatch(/\d{3}/);
    expect(html).not.toContain('pf-stat');
  });

  it('chargement et fichier indisponible : message, aucune valeur', () => {
    expect(render(t4, [t4], { status: 'loading' })).toContain('Chargement');
    const off = render(t4, [t4], { status: 'unavailable' });
    expect(off).toContain('Non disponible');
    expect(off).not.toContain('pf-stat');
  });

  it('bassin absent du fichier publié : non disponible, aucune valeur', () => {
    const ghost = bassinPole('BE_9999', '9999', 'Inconnu');
    const html = render(ghost, [ghost]);
    expect(html).toContain('Non disponible pour ce bassin');
    expect(html).not.toContain('pf-stat');
  });
});
