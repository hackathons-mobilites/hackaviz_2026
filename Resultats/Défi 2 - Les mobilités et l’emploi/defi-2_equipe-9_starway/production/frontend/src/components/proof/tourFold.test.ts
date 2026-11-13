import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tourFoldDecision } from './tourFold';
import { TOURS } from '../../tour/registry';
import { buildLea, defaultOptions } from '../../tour/tours/lea.tour';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');

/**
 * La visite ouvre les plis qu'elle commente (lot 5, D-052) : `.pf-flows` est dans le pli « Emplois et recrutement », fermé par défaut.
 * La décision est pure ; l'ouverture réelle est vérifiée dans un navigateur (voir la PR).
 */
describe('plis et visite (tourFoldDecision)', () => {
  it('élément souligné dans un pli fermé : le pli s’ouvre, et c’est la visite qui l’a ouvert', () => {
    expect(tourFoldDecision(true, false, false)).toEqual({ change: true, open: true, openedByTour: true });
  });

  it('marque retirée : le pli ouvert par la visite se referme', () => {
    expect(tourFoldDecision(false, true, true)).toEqual({ change: true, open: false, openedByTour: false });
  });

  it('un pli que le visiteur a ouvert lui-même reste ouvert, avant, pendant et après la visite', () => {
    expect(tourFoldDecision(true, true, false)).toEqual({ change: false, open: true, openedByTour: false });
    expect(tourFoldDecision(false, true, false)).toEqual({ change: false, open: true, openedByTour: false });
  });

  it('pli déjà refermé à la main pendant l’étape : rien à refermer', () => {
    expect(tourFoldDecision(false, false, true)).toEqual({ change: false, open: false, openedByTour: false });
  });

  it('même étape qui se répète : pas de réouverture inutile', () => {
    expect(tourFoldDecision(true, true, true)).toEqual({ change: false, open: true, openedByTour: true });
  });
});

describe('branchement de la visite', () => {
  it('le pli observe la marque de la visite ; le contrôleur ne fait que poser la marque (aucun pli nommé dans tour/)', () => {
    const pf = read('./useTourFold.ts');
    expect(pf).toContain("attributeFilter: ['data-tour-focus']");
    expect(read('./PfGroup.tsx')).toContain('useTourFold(');
    expect(read('./ProofTransports.tsx')).toContain('useTourFold(');
    expect(read('./PfGroup.tsx')).not.toMatch(/name=/);
    const fold = read('../../tour/foldFocus.ts');
    expect(fold).toContain('data-tour-focus');
    expect(read('../../tour/controller.ts')).toContain('focusFolds(step.openFold)');
  });

  it('l’étape des moyens de transport ouvre des plis qui existent vraiment dans le panneau (identifiants lus dans le code)', () => {
    const steps = [...TOURS.lea!.steps, ...TOURS['lea-video']!.steps, ...buildLea('gain', defaultOptions('gain'), { halo: true, moyens: true, carte: true }).steps];
    const moyens = steps.filter((s) => s.id === 'acte4-moyens');
    expect(moyens.length).toBeGreaterThan(0);
    const panel = read('../ProofPanel.tsx');
    for (const s of moyens) {
      expect(s.openFold, s.id).toEqual(['trajet', 'cout', 'moyens']);
      for (const id of s.openFold!) {
        // « trajet » est le pli de la section des lignes (ProofTransports), les autres sont des groupes du panneau
        if (id === 'trajet') expect(read('./ProofTransports.tsx')).toContain('pf-transports');
        else expect(panel, id).toMatch(new RegExp(`<PfGroup[^>]*\\bid="${id}"`));
      }
    }
  });

  it('la marque d’un pli est soulignée comme celle des flux, sans animation', () => {
    expect(read('./pfGroup.css')).toMatch(/\.pf-group\[data-tour-focus\][^{]*\{[^}]*outline/);
  });
});
