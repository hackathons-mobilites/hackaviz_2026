import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { shiftBounds } from '../data/od/shift';
import { ShiftPicker } from './ShiftPicker';

const bounds = shiftBounds({
  grid: { first: '03:00', last: '22:00', step_min: 5, n_slots: 229 },
  starts: { first: '05:00', last: '22:05' },
  ends: { first: '03:00', last: '22:00' },
})!;

const render = (start: number, end: number) => renderToStaticMarkup(createElement(ShiftPicker, { bounds, value: { start, end }, onChange: () => {} }));

describe('ShiftPicker (rendu statique)', () => {
  const html = render(540, 1020);

  it('libellés « Début du poste » et « Fin du poste », reliés à leur jauge', () => {
    const labels = [...html.matchAll(/<label class="shift-label" for="([^"]+)">([^<]+)<\/label>/g)].map((m) => [m[1], m[2]]);
    expect(labels.map((l) => l[1])).toEqual(['Début du poste', 'Fin du poste']);
    for (const [id] of labels) expect(html).toContain(`id="${id}"`);
  });

  it('bornes et pas lus dans l’index, valeur parlée', () => {
    expect(html).toMatch(/min="300" max="1315" step="5"/);
    expect(html).toMatch(/min="305" max="1320" step="5"/);
    expect(html).toContain('aria-valuetext="9h, l’aller arrive avant cette heure"');
    expect(html).toContain('aria-valuetext="17h, le retour est compté à partir de cette heure"');
  });

  it('résumé visible et région live pour les ajustements', () => {
    expect(html).toContain('9h-17h');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('case « Poste de nuit » proposée, décochée pour un poste du jour', () => {
    expect(html).toContain('<span>Poste de nuit</span>');
    expect(html).not.toContain('Poste de nuit (fin le lendemain matin)');
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)/);
    expect(html).toContain('Début à partir de 21h, fin au plus tard à 7h.');
  });

  it('case « Poste de nuit » : description reliée, explication et exemples au « i » (demande de Nicolas du 10/11)', () => {
    const box = html.match(/<input type="checkbox"[^>]*aria-describedby="([^"]+)"/);
    expect(box, 'aria-describedby de la case').not.toBeNull();
    const desc = html.match(new RegExp(`id="${box![1]}"[^>]*>([^<]+)<`));
    expect(desc?.[1]).toContain('Fin le lendemain matin. Début à partir de 21h, fin au plus tard à 7h.');
    expect(html).toContain('aria-label="Que veut dire « Poste de nuit » ?"');
    expect(html).toContain('le poste finit le lendemain matin : début à partir de 21h, fin au plus tard à 7h');
    expect(html).toContain('Code du travail, article L3122-2');
    expect(html).toContain('À cocher : vous commencez à 22h et finissez à 6h le lendemain matin.');
    // bornes du test : fin du jour au plus tard à 22h, début dès 5h ; 15h-23h n'est pas proposable, donc pas cité
    expect(html).toContain('À ne pas cocher : vous finissez le jour même, par exemple 14h-22h, ou vous commencez tôt le matin, par exemple 5h-13h.');
    expect(html).not.toContain('15h-23h');
    expect(html).toContain('Le retour du matin est lu dans les horaires du même mardi type.');
  });

  it('poste de nuit 22h-6h : case cochée, bornes de nuit, fin « le lendemain », méthode dite', () => {
    const night = render(1320, 360);
    expect(night).toMatch(/<input type="checkbox"[^>]*checked/);
    expect(night).toContain('22h-6h');
    expect(night).toContain('8\u00a0h, fin le lendemain matin');
    expect(night).toMatch(/min="1260" max="1325" step="5"/);
    expect(night).toMatch(/min="180" max="420" step="5"/);
    expect(night).toContain('Fin du poste, le lendemain');
    expect(night).toContain('aria-valuetext="6h, le lendemain matin, le retour est compté à partir de cette heure"');
    expect(night).toContain('horaires du même mardi type');
    expect(night).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('ShiftPicker sur la grille de 24 h (D-040)', () => {
  const full = shiftBounds({
    grid: { first: '00:00', last: '23:55', step_min: 5, n_slots: 288 },
    starts: { first: '02:00', last: '23:55' },
    ends: { first: '00:00', last: '23:55' },
  })!;
  const renderFull = (start: number, end: number) => renderToStaticMarkup(createElement(ShiftPicker, { bounds: full, value: { start, end }, onChange: () => {} }));

  it('poste du jour : début dès 2h, fin jusqu’à 23h55', () => {
    const html = renderFull(540, 1020);
    expect(html).toMatch(/min="120" max="1430" step="5"/);
    expect(html).toMatch(/min="125" max="1435" step="5"/);
    expect(html).toContain('Début à partir de 21h, fin au plus tard à 7h.');
    // grille publiée (24 h) : les trois exemples « à ne pas cocher » sont proposables par les jauges
    expect(html).toContain('À ne pas cocher : vous finissez le jour même, par exemple 14h-22h ou 15h-23h, ou vous commencez tôt le matin, par exemple 5h-13h.');
  });

  it('poste de nuit : début de 21h à 23h55, fin de 0h à 7h', () => {
    const html = renderFull(1435, 0);
    expect(html).toMatch(/<input type="checkbox"[^>]*checked/);
    expect(html).toMatch(/min="1260" max="1435" step="5"/);
    expect(html).toMatch(/min="0" max="420" step="5"/);
    expect(html).toContain('23h55-0h');
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('panneau « Horaires libres » (ShiftControl) : note des destinations rangée au « i » (demande de Nicolas du 10/11)', () => {
  const src = readFileSync(new URL('./ShiftControl.tsx', import.meta.url), 'utf8');

  it('la phrase des destinations est dans un InfoTip, mots inchangés, nombre lu dans l’index', () => {
    const tip = src.match(/<InfoTip label="Destinations des horaires libres"[^>]*>([\s\S]*?)<\/InfoTip>/);
    expect(tip, 'InfoTip des destinations').not.toBeNull();
    const text = (tip![1] ?? '').replace(/\s+/g, ' ');
    expect(text).toContain("Destinations : les {formatInt(current?.index?.communes.length ?? 0)} communes et arrondissements d'Île-de-France.");
    expect(text).toContain('Les journées-types restent des raccourcis.');
  });

  it('l’avertissement sur le calcul (state.note) reste visible dans le panneau', () => {
    expect(src).toMatch(/\{state\.note && <p className="shift-pop-note">/);
  });
});
