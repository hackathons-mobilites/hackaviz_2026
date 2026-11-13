import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatInt } from './format';

/**
 * Le texte alternatif de l'image de partage (og:image:alt de index.html) n'est pas écrit à la main : il est produit par
 * `design/slides/src/build_og.py` (lancé par `rendu_slide.py`). Ce test échoue si ses chiffres ne sont plus ceux des
 * données publiées (poles.json) : il faut alors relancer `rendu_slide.py`, pas corriger le HTML.
 */
describe('index.html : texte alternatif de l’image de partage (C13, audit du 09/11)', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf-8');
  const alt = /<meta property="og:image:alt" content="([^"]*)"/.exec(html)?.[1] ?? '';
  const poles = JSON.parse(readFileSync(new URL('../../public/data/poles.json', import.meta.url), 'utf-8')) as { jobs: number | null }[];
  const norm = (s: string) => s.replace(/\s/g, ' ');

  it('nombre d’astres et total des postes égaux à poles.json', () => {
    const total = poles.reduce((s, p) => s + (p.jobs ?? 0), 0);
    expect(alt).toContain(`${poles.length} astres`);
    expect(norm(alt)).toContain(`${norm(formatInt(total))} postes salariés recensés par l'INSEE`);
  });

  // Exemple de l'éclipse : commune et deux pourcentages lus dans les valeurs du dernier rendu de la slide (écrites par
  // build_slide.py depuis od_walk3000), jamais recopiés ici
  const valeurs = JSON.parse(readFileSync(new URL('../../../design/slides/slide-depot.valeurs.json', import.meta.url), 'utf-8')) as {
    valeurs: { quoi: string; valeur: number | string | null }[];
  };
  const valeur = (quoi: string) => valeurs.valeurs.find((v) => v.quoi === quoi)?.valeur;
  const pct = (x: unknown) => `${(x as number).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

  it('commune de l’exemple et ses deux pourcentages égaux à slide-depot.valeurs.json', () => {
    const ref = valeur('part atteinte, journée de référence (%)');
    const day = valeur('part atteinte, journée comparée (%)');
    expect(typeof ref).toBe('number');
    expect(typeof day).toBe('number');
    expect(alt).toContain(`depuis ${valeur("commune de l'exemple") as string},`);
    expect(norm(alt)).toContain(norm(`${pct(ref)} des postes salariés atteints aller et retour en ${valeur('journée-type de référence') as string}`));
    expect(norm(alt)).toContain(norm(`${pct(day)} en ${valeur('journée-type comparée') as string}`));
  });
});
