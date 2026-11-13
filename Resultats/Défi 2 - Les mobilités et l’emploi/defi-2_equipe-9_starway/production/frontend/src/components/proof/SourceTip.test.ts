import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildHalo, sexShareLine } from '../../data/halo';
import type { ContextFile } from '../../data/types';
import { SourceTipView } from './SourceTip';

/**
 * Règle d'affichage finale du 11/11 (audit d'affichage, D-064) : une précision est dans un « i » sans le mode sources, écrite en clair avec
 * (« tout revient »), mots inchangés.
 */
const PHRASE = "Trait symbolique : ce n'est pas l'itinéraire.";
const render = (on: boolean, block = false) => renderToStaticMarkup(createElement(SourceTipView, { label: "Ce trait est-il l'itinéraire ?", on, block, children: PHRASE }));
const outside = (html: string) => html.replace(/<span[^>]*class="info-pop"[\s\S]*?<\/span><\/span>/g, '');

describe('SourceTip : « i » sans le mode sources, texte en clair avec', () => {
  it('sources coupées : un bouton « i » nommé, la phrase seulement dans la bulle', () => {
    const html = render(false);
    expect(html).toContain('class="info-btn"');
    expect(html).toContain('aria-label="Ce trait est-il l&#x27;itinéraire ?"');
    expect(html).toContain('class="info-pop"');
    expect(html).toContain('Trait symbolique : ce n&#x27;est pas l&#x27;itinéraire.');
    expect(outside(html)).not.toContain('Trait symbolique');
  });

  it('sources activées : la phrase en clair, mots inchangés, sans bouton ni bulle', () => {
    const html = render(true);
    expect(html).toBe('<span class="pf-src">Trait symbolique : ce n&#x27;est pas l&#x27;itinéraire.</span>');
    expect(html).not.toContain('info-btn');
    expect(render(true, true)).toContain('class="pf-src pf-src-block"');
  });
});

describe('halo (D1) : une base courte écrite, la phrase « Dénominateur » complète au « i »', () => {
  const ctx = JSON.parse(readFileSync(new URL('../../../public/data/context/78358.json', import.meta.url), 'utf-8')) as ContextFile;
  it('âges : « Sur N habitants, recensement AAAA. » lu dans le fichier ; la ligne des sexes ne redit plus le millésime', () => {
    const h = buildHalo(ctx, 'age');
    const b = ctx.population_age!;
    if (b.status !== 'ok' || b.total == null) return;
    expect(h.base).toMatch(new RegExp(`^Sur [\\d\\s]+ habitants, recensement ${b.year}\\.$`));
    expect(sexShareLine(ctx, false) ?? '').not.toContain('Millésime');
  });
  it('niveau de vie : la base dit les ménages fiscaux et le millésime Filosofi', () => {
    const h = buildHalo(ctx, 'income');
    if (h.hidden) return;
    expect(h.base).toBe(`Sur les personnes des ménages fiscaux, Filosofi ${ctx.income!.year}.`);
    expect(h.guard).toBe('Décrit la commune de résidence. Ne dit rien de l’accès aux pôles, ni d’une cause.');
  });
});
