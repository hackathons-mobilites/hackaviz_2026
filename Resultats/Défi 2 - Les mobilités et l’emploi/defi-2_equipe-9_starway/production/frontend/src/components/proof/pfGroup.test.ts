import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ItinTrip } from '../../data/itineraries';
import { PfGroup } from './PfGroup';
import { ProofTransports } from './ProofTransports';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');

/**
 * Panneau de preuve en deux niveaux (chantier C, lot 3, D-050) : six plis indépendants, jamais `<details name>` (l'étape 28 de
 * `smoke.mjs` ouvre tous les plis d'un coup), classe `pf-fold` lue par `smoke.mjs` et l'inventaire, chiffre clé dans le titre,
 * phrases « à garder visible » hors du pli. Aucune valeur chiffrée écrite en dur.
 */
describe('pli du panneau (PfGroup)', () => {
  const html = renderToStaticMarkup(createElement(PfGroup, { id: 'essai', title: 'Titre', figure: 'chiffre clé', keep: createElement('p', null, 'Phrase à garder'), children: createElement('p', null, 'Contenu') }));

  it('un <details> fermé de classe pf-fold, sans attribut name (plis indépendants)', () => {
    expect(html).toMatch(/<details class="pf-fold pf-group-fold">/);
    expect(html).not.toMatch(/<details[^>]*\sname=/);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('le titre et le chiffre clé sont dans le résumé, lus fermé', () => {
    const summary = html.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? '';
    expect(summary).toContain('Titre');
    expect(summary).toContain('chiffre clé');
  });

  it('le contenu est dans le pli, la phrase « à garder » est dehors', () => {
    const inside = html.match(/<details[\s\S]*?<\/details>/)?.[0] ?? '';
    expect(inside).toContain('Contenu');
    expect(inside).not.toContain('Phrase à garder');
    expect(html.replace(inside, '')).toContain('Phrase à garder');
  });
});

describe('panneau : six plis indépendants, sans <details name>', () => {
  const panel = read('../ProofPanel.tsx');
  it('les six plis demandés, par leur titre', () => {
    for (const t of ['Communes du pôle', 'Coût et carbone', 'Emplois et recrutement', 'NEEDS_TITLE', 'Comparer les moyens', 'Méthode et sources']) expect(panel).toContain(t);
  });
  it('aucun <details name> dans les composants du panneau, du recrutement et des offres', () => {
    for (const f of ['../ProofPanel.tsx', './PfGroup.tsx', './ProofModes.tsx', './ProofPublicOffers.tsx', '../recruit/ProofRecruit.tsx', './ProofTransports.tsx']) expect(read(f), f).not.toMatch(/<details[^>]*\sname=/);
  });
  it('les chiffres clés des titres viennent de fonctions et de données, pas de nombres écrits (communes atteintes, postes, prix au ticket)', () => {
    expect(panel).toMatch(/odCommuneCount\(communesShare\)/);
    expect(panel).toMatch(/formatInt\(pole\.jobs\)/);
    // D-066 : le total aller et retour au ticket est dans le bloc « Trajet » (roundTripLine, data/tripTiles.ts, testé), plus dans le titre du pli
    expect(read('./TripBlock.tsx')).toMatch(/roundTripLine\(/);
  });
});

describe('bloc des transports : crédit des données hors du pli, besoins déplaçables', () => {
  const trip = {
    status: 'ok',
    dep: '08:00',
    arr: '08:40',
    min: 40,
    legs: [{ m: 'rail', dep: '08:05', arr: '08:35', min: 30, line: 'A', from: 'Gare', to: 'Arrêt' }],
  } as unknown as ItinTrip;
  const render = (props: object) => renderToStaticMarkup(createElement(ProofTransports, { trip, ...props }));

  it('lot 6 : la phrase « calculé avec r5py » quitte le bloc du trajet pour « Méthode et sources »', () => {
    expect(render({ leg: 'ret', repeatNotes: false })).not.toContain('calculé avec r5py');
    expect(render({ leg: 'ret' })).not.toContain('calculé avec r5py');
    expect(render({})).not.toContain('calculé avec r5py');
    expect(read('../ProofPanel.tsx')).toContain('ITINERARY_METHOD_NOTE');
  });

  it('needs="external" : le bloc ne porte plus le réglage des besoins', () => {
    expect(render({ needs: 'external' })).not.toContain('Ce que déclarent les sources');
  });
});
