import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BIKE_CARBON } from '../../data/tripTiles';
import { TripTiles } from './TripTiles';

/* Le bouton « sources » est simulé (état lu par SourceTip : `s.on`), comme dans ProofCarCost.test.ts. */
const prov = vi.hoisted(() => ({ on: false }));
vi.mock('../../store/provenanceStore', () => ({ useProvenanceStore: (select: (s: { on: boolean }) => unknown) => select({ on: prov.on }) }));

const render = () =>
  renderToStaticMarkup(
    createElement(TripTiles, {
      label: 'Trajet aller : durée, coût et carbone',
      tiles: [
        { label: 'Durée', tile: { value: '48 min', sub: null, tip: [] } },
        { label: 'Carbone', className: 'pf-carbon', tile: { value: '93 g CO2e', sub: 'estimation', tip: ['Phrase de méthode.'] }, tipLabel: 'Comment ce carbone est-il estimé ?' },
        { label: 'Carbone', tile: BIKE_CARBON },
      ],
    }),
  );

describe('tuiles du bloc « Trajet » (D-066)', () => {
  it('une liste de définitions : libellé, grand chiffre, garde courte ; la méthode dans un « i » nommé', () => {
    prov.on = false;
    const html = render();
    expect(html).toContain('<dl class="pf-tiles" aria-label="Trajet aller : durée, coût et carbone" data-count="3">');
    expect(html).toContain('<dt class="pf-tile-label">Carbone</dt>');
    expect(html).toContain('93 g CO2e');
    expect(html).toContain('estimation');
    expect(html).toContain('aria-label="Comment ce carbone est-il estimé ?"');
    // des mots plutôt qu'un chiffre : plus petits
    expect(html).toContain('pf-tile-figure is-words">Pas d&#x27;émission à l&#x27;usage');
  });

  it('mode sources : la phrase du « i » est écrite en clair, au même endroit (D-064)', () => {
    prov.on = true;
    const html = render();
    expect(html).not.toContain('aria-label="Comment ce carbone est-il estimé ?"');
    expect(html).toContain('Phrase de méthode.');
    prov.on = false;
  });
});
