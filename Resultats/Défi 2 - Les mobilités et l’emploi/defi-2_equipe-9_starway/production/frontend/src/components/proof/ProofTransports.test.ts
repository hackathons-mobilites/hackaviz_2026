import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { itineraryReturnStopNote, itineraryStopNote, type ItinTrip } from '../../data/itineraries';
import type { Pole } from '../../data/types';
import { ProofTransports } from './ProofTransports';

/**
 * Phrase sous le bloc « Transports utilisés (aller) » : l'itinéraire détaillé s'arrête à l'arrêt d'affichage de
 * l'astre (point.stop_name de poles.json), la durée du titre va au centre de la commune. Toujours visible (hors
 * `<details>`), avec le nom publié, aller seulement, jamais sans nom. Aucune valeur chiffrée écrite en dur.
 */
const poles44: Pole[] = JSON.parse(readFileSync(new URL('../../../public/data/poles.json', import.meta.url), 'utf-8')) as Pole[];
const pole = poles44[0]!;

const trip: ItinTrip = {
  status: 'ok',
  dep: '08:00',
  arr: '08:40',
  min: 40,
  legs: [{ m: 'rail', dep: '08:05', arr: '08:35', min: 30, line: 'A', from: 'Gare', to: 'Arrêt' }],
} as unknown as ItinTrip;

const render = (props: { leg?: 'out' | 'ret'; stopNote?: string | null }) => renderToStaticMarkup(createElement(ProofTransports, { trip, ...props }));
const outsideFold = (html: string) => html.replace(/<details[\s\S]*?<\/details>/g, '');

describe('phrase de l’arrêt d’affichage sous « Transports utilisés »', () => {
  it('les 44 astres publient un nom d’arrêt ; sans nom, aucune phrase devinée', () => {
    expect(poles44.every((p) => !!p.point.stop_name?.trim())).toBe(true);
    for (const missing of [undefined, null, '', '   ']) expect(itineraryStopNote(missing)).toBeNull();
  });

  it('aller : la phrase avec le nom de l’arrêt est dans le bloc, hors pli', () => {
    const note = itineraryStopNote(pole.point.stop_name);
    expect(note).toContain(`(${pole.point.stop_name})`);
    const html = render({ stopNote: note });
    const visible = outsideFold(html);
    expect(visible).toContain("Itinéraire détaillé jusqu&#x27;à l&#x27;arrêt le plus desservi de l&#x27;astre");
    expect(visible).toContain(pole.point.stop_name!.replace(/'/g, '&#x27;'));
    expect(visible).toContain('La durée du titre est calculée jusqu&#x27;au centre de la commune : les deux peuvent différer.');
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('sans nom d’arrêt, ou sans phrase transmise : rien n’est écrit', () => {
    expect(render({ stopNote: itineraryStopNote(undefined) })).not.toContain('jusqu&#x27;à l&#x27;arrêt le plus desservi');
    expect(render({})).not.toContain('jusqu&#x27;à l&#x27;arrêt le plus desservi');
    expect(render({ leg: 'ret' })).not.toContain('arrêt le plus desservi de l&#x27;astre');
  });
});

/**
 * Phrase miroir sous « Transports utilisés (retour) » : le retour part de l'arrêt d'affichage de l'astre (04h : origine
 * du retour = point du pôle), la durée du titre part du centre de la commune. Visible, hors pli, avec le nom publié,
 * jamais sans nom, jamais sous les 15 pôles. Aucune valeur chiffrée écrite en dur.
 */
describe('phrase miroir de l’arrêt d’affichage sous « Transports utilisés (retour) »', () => {
  it('retour : la phrase « depuis » avec le nom de l’arrêt est dans le bloc, hors pli', () => {
    const note = itineraryReturnStopNote(pole.point.stop_name);
    expect(note).toContain(`(${pole.point.stop_name})`);
    const html = render({ leg: 'ret', stopNote: note });
    const visible = outsideFold(html);
    expect(visible).toContain('Transports utilisés (retour)');
    expect(visible).toContain('Itinéraire détaillé depuis l&#x27;arrêt le plus desservi de l&#x27;astre');
    expect(visible).toContain(pole.point.stop_name!.replace(/'/g, '&#x27;'));
    expect(visible).toContain('La durée du titre est calculée depuis le centre de la commune : les deux peuvent différer.');
    expect(visible).not.toContain('jusqu&#x27;à l&#x27;arrêt');
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('même nom que l’aller, formulation miroir ; un nom vide : pas de phrase', () => {
    const out = itineraryStopNote(pole.point.stop_name)!;
    const ret = itineraryReturnStopNote(pole.point.stop_name)!;
    expect(out).not.toBe(ret);
    expect(ret).toBe(out.replace('jusqu\'à l\'arrêt', 'depuis l\'arrêt').replace('jusqu\'au centre', 'depuis le centre'));
    for (const missing of [undefined, null, '', '   ']) expect(itineraryReturnStopNote(missing)).toBeNull();
    expect(itineraryReturnStopNote('  Gare de Lyon ')).toContain('(Gare de Lyon)');
  });

  it('sans phrase transmise, le retour n’écrit rien', () => {
    expect(render({ leg: 'ret', stopNote: itineraryReturnStopNote(undefined) })).not.toContain('arrêt le plus desservi de l&#x27;astre');
    expect(render({ leg: 'ret' })).not.toContain('pf-stop-note');
  });
});
