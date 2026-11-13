import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { astreOffers, type PublicOffersFile, type PublicOffersList } from '../../data/publicOffers';
import type { Commune, Pole } from '../../data/types';
import { MethodLine, OffersList, OffersScopeTip, PublicOffersBlock } from './ProofPublicOffers';

/**
 * Bloc « Offres diffusées sur Choisir le service public » sur les données PUBLIÉES : case « Service public » décochée par
 * défaut (aucun chiffre), « offres diffusées au 11/10/2026 », jamais « postes ouverts », mode sources coupé par défaut
 * (D-033, aucune ligne de source dans le rendu), source ET méthode quand il est activé.
 */
const read = <T,>(rel: string): T => JSON.parse(readFileSync(new URL(`../../../public/data/${rel}`, import.meta.url), 'utf-8')) as T;
const file = read<PublicOffersFile>('service_public.json');
const list = read<PublicOffersList>('service_public_offres.json');
const poles44 = read<Pole[]>('poles.json');
const communes = read<Commune[]>('communes.json');
const BAD = /\bnull\b|\bundefined\b|\bNaN\b|Infinity|\[object/;

const withOffers = poles44.map((p) => ({ p, n: astreOffers(file, p).n })).sort((a, b) => b.n - a.n);
const busy = withOffers[0]!.p;
const quiet = poles44.find((p) => astreOffers(file, p).n === 0);

const render = (pole: Pole, shown: boolean, state: Parameters<typeof PublicOffersBlock>[0]['state'] = { status: 'ready', file }) =>
  renderToStaticMarkup(createElement(PublicOffersBlock, { pole, communes, state, shown, onShown: () => undefined }));

describe('bloc offres diffusées (Service public)', () => {
  it('case « Service public » décochée : aucun chiffre, la date du fichier, « comptées à part »', () => {
    const html = render(busy, false);
    expect(html).toContain('Offres diffusées sur Choisir le service public');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Service public');
    expect(html).toContain('Offres diffusées au 11/10/2026');
    expect(html).toContain('Offres du service public : comptées à part des postes salariés (INSEE).');
    expect(html).not.toContain('pf-stat');
    expect(html).not.toMatch(BAD);
  });

  it('audit du 11/11 (P34) : « comptées à part », la date de diffusion et les versants dans le « i » du titre du bloc, la case le cite', () => {
    const html = renderToStaticMarkup(createElement(OffersScopeTip, { file }));
    expect(html).toContain('id="pf-offers-hint"');
    expect(html).toContain('Offres du service public : comptées à part des postes salariés (INSEE).');
    expect(html).toContain('aria-label="En savoir plus sur les offres du service public"');
    expect(html).toContain('Offres diffusées au 11/10/2026 : fonction publique d&#x27;État, territoriale et hospitalière.');
    // sans mode sources : tout est dans la bulle
    expect(html.slice(0, html.indexOf('info-pop'))).not.toContain('comptées à part');
    const block = render(busy, false);
    expect(block).toContain('aria-describedby="pf-offers-hint"');
    expect(block).not.toContain('pf-offers-apart');
    // case cochée (garde V11) : la réserve est écrite sous la case, à côté de la valeur
    expect(render(busy, true)).toContain('<p class="pf-note pf-offers-apart">Comptées à part des postes salariés (INSEE).</p>');
    expect(html).not.toMatch(BAD);
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('case cochée (audit du 10/11) : la réserve sur la date de publication est dans un « i »', () => {
    const html = render(busy, true);
    expect(html).toContain('aria-label="Que dit ce chiffre des offres ?"');
    expect(html).not.toMatch(/<p class="pf-note pf-offers-note">Une date de publication/);
    expect(html).toContain('Une date de publication ne prouve pas que le poste est encore à pourvoir.');
  });

  it('case cochée : « offres diffusées au 11/10/2026 », versants, repère régional, limites, jamais « postes ouverts »', () => {
    const html = render(busy, true);
    expect(html).toMatch(/\d[\d\u00a0]* offres? diffusées? au 11\/10\/2026/);
    expect(html).toContain('connues seulement au département');
    expect(html).toContain('Champ et limites');
    expect(html).toContain('Fonction Publique');
    expect(html).toContain('pas compté dans les postes salariés de l');
    expect(html).toContain('astre recensés par l');
    expect(html.toLowerCase()).not.toMatch(/postes? ouverts?/);
    expect(html).not.toMatch(/[\u2013\u2014]/);
    expect(html).not.toMatch(BAD);
  });

  it('astre sans offre rattachée : « Aucune offre », sans liste ni versants', () => {
    if (!quiet) return;
    const html = render(quiet, true);
    expect(html).toContain('Aucune offre diffusée au 11/10/2026');
    expect(html).not.toContain('pf-offers-versants');
    expect(html).not.toContain('Voir les offres');
  });

  it('mode sources (D-033) : la ligne de méthode n\'existe que mode activé ; coupé (défaut), ni source ni méthode dans le bloc', () => {
    const coupe = render(busy, true);
    expect(coupe).not.toContain('Méthode');
    expect(coupe).not.toContain('prov-note');
    expect(renderToStaticMarkup(createElement(MethodLine, { on: false, file }))).toBe('');
    const html = renderToStaticMarkup(createElement(MethodLine, { on: true, file }));
    expect(html).toContain('Méthode : ');
    expect(html).toContain('date de début de publication est passée');
    expect(html).toContain('prov-note');
    expect(html).not.toMatch(BAD);
    expect(html.toLowerCase()).not.toMatch(/postes? ouverts?/);
  });

  it('chargement et fichier indisponible : message, aucune valeur', () => {
    expect(render(busy, true, { status: 'loading' })).toContain('Chargement');
    const off = render(busy, true, { status: 'unavailable' });
    expect(off).toContain('Non disponible');
    expect(off).not.toContain('pf-stat');
    expect(off).not.toContain('checkbox');
  });
});

describe('liste des offres', () => {
  it('intitulé en lien officiel, employeur, commune et dates de publication ; borne et total dits', () => {
    const html = renderToStaticMarkup(createElement(OffersList, { pole: busy, communes, list }));
    expect(html).toContain('href="https://choisirleservicepublic.gouv.fr/offre-emploi/offre-reference-');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('publication du ');
    expect((html.match(/<li/g) ?? []).length).toBeLessThanOrEqual(10);
    expect(html).toContain('dépubliée');
    expect(html).not.toMatch(BAD);
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});
