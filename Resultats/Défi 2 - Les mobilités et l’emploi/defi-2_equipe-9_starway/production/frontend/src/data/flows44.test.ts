import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flowToPole } from './proof';
import type { ContextFile, FlowToPole, Pole } from './types';

/**
 * Flux domicile - lieu de travail (EMP02) vers les 44 astres, données PUBLIÉES (05/11) : `context/{insee}.json` est
 * commun aux deux ciels, son bloc `flows_to_poles` porte les identifiants des 44 astres (`BE_...`) puis ceux des
 * 15 pôles (`P_...`). Ces tests ne figent aucune valeur : ils gardent les invariants de la règle de vérité (jamais un
 * 0 de substitution, une part rapportée à tous les actifs occupés, rien de réparti sans astre).
 */
const url = (rel: string) => new URL(`../../public/data/${rel}`, import.meta.url);
const read = <T,>(rel: string): T => JSON.parse(readFileSync(url(rel), 'utf-8')) as T;
const published = existsSync(url('poles.json')) && existsSync(url('context/78358.json'));
/** `poles` du bloc publié : un objet indexé par identifiant (le contrat accepte aussi une liste, lue par `flowToPole`). */
const entries = (c: ContextFile): Record<string, FlowToPole> => c.flows_to_poles!.poles as unknown as Record<string, FlowToPole>;

describe.skipIf(!published)('flux EMP02 vers les 44 astres (context/, racine de public/data)', () => {
  const poles = read<Pole[]>('poles.json');
  const files = readdirSync(new URL('../../public/data/context/', import.meta.url)).filter((f) => f.endsWith('.json'));
  const contexts = files.map((f) => read<ContextFile>(`context/${f}`));

  it('chaque commune porte une entrée pour chacun des 44 astres, jamais un 0 de substitution', () => {
    expect(poles).toHaveLength(44);
    expect(contexts.length).toBeGreaterThan(1200);
    for (const c of contexts) {
      const b = c.flows_to_poles!;
      expect(b.status).toBe('ok');
      for (const p of poles) {
        const e = entries(c)[p.id];
        expect(e, `${c.insee} ${p.id}`).toBeDefined();
        if (e!.flux == null) {
          expect(e!.precision).toBe('no_flow_in_file');
          expect(e!.share_pct).toBeNull();
        } else {
          expect(e!.flux).toBeGreaterThan(0);
          // règle INSEE sur la valeur non arrondie : seul l'entier 200 (199,5 à 200,5) peut être l'un ou l'autre
          if (e!.flux < 200) expect(e!.precision).toBe('order_of_magnitude');
          if (e!.flux > 200) expect(e!.precision).toBe('ok');
        }
      }
    }
  });

  it('la somme des flux vers les astres ne dépasse jamais les actifs occupés (dénominateur : tous les lieux de travail)', () => {
    for (const c of contexts) {
      const b = c.flows_to_poles!;
      const sum = poles.reduce((s, p) => s + (entries(c)[p.id]?.flux ?? 0), 0);
      // marge d'arrondi : chaque flux est arrondi à l'entier, le total aussi
      expect(sum, c.insee).toBeLessThanOrEqual((b.actifs_occupes ?? 0) + poles.length);
    }
  });

  it('un astre est un bassin : la commune ou l’arrondissement d’origine appartient à exactement un astre (origin_poles)', () => {
    const astreOf = new Map<string, string>();
    for (const p of poles) for (const insee of p.communes) astreOf.set(insee, p.id);
    for (const c of contexts) {
      const mine = c.flows_to_poles!.origin_poles?.filter((id) => poles.some((p) => p.id === id)) ?? [];
      expect(mine, c.insee).toEqual([astreOf.get(c.insee)]);
    }
  });

  it('Paris est lu à l’arrondissement : 20 astres, aucun flux publié vers « Paris » entier', () => {
    const paris = poles.filter((p) => p.communes.some((i) => i.startsWith('751')));
    expect(paris).toHaveLength(20);
    for (const p of paris) expect(p.communes).toHaveLength(1);
    const dest = (id: string) => entries(contexts.find((c) => c.insee === '75118')!)[id];
    // le 18e travaille déjà dans son propre arrondissement : la commune d'origine est dans l'astre (le panneau le dit)
    const own = poles.find((p) => p.communes.includes('75118'))!;
    expect(dest(own.id)!.flux).not.toBeNull();
    expect(flowToPole(contexts.find((c) => c.insee === '75118')!, own.id)?.originInPole).toBe(true);
  });

  it('le panneau lit un flux (ou « aucun flux publié ») pour chaque astre, jamais « non disponible » à tort', () => {
    for (const c of contexts.slice(0, 200)) {
      for (const p of poles) {
        const f = flowToPole(c, p.id);
        expect(f, `${c.insee} ${p.id}`).not.toBeNull();
        if (f!.flux == null) expect(f!.precision).toBe('no_flow_in_file');
      }
    }
  });
});
