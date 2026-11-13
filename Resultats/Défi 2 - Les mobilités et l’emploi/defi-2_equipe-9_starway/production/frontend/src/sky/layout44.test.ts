/**
 * Ciel à 44 astres (D-030), aux écrans de référence, depuis le fichier publié (`poles.json`). Règle : aucun repère d'état (disque + contour + seconde orbite de l'or)
 * n'en touche un autre ; écart minimal = `skyRelax.minGap` (jeton de Maia, aucune valeur nouvelle) ;
 * déplacement minimal depuis le barycentre des postes ; déterministe ; rayons inchangés ; le zoom
 * automatique de Maia (`detectOverlapZoom`) n'a plus rien à corriger (k = 1), l'échelle globale reste intacte.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Commune, Pole } from '../data/types';
import { sky44, skyRelax } from '../theme/tokens';
import { computeFrame, datasetBounds, detectOverlapZoom, makeRadius, poleGeometry, stateMarkOuter, toScreen } from './layout';

const read = <T,>(rel: string): T | null => {
  const url = new URL(`../../public/data/${rel}`, import.meta.url);
  return existsSync(url) ? (JSON.parse(readFileSync(url, 'utf-8')) as T) : null;
};

const poles44 = read<Pole[]>('poles.json');
const communes = read<Commune[]>('communes.json');

/** Écrans de référence de la demande (barre de scénario mesurée dans le navigateur : 128 px bureau, 212 px téléphone). */
const SCREENS = [
  { w: 1280, h: 720, bar: 128 },
  { w: 1600, h: 900, bar: 128 },
  { w: 1920, h: 1080, bar: 128 },
  { w: 390, h: 844, bar: 212 },
];

function measure(poles: Pole[], screen: (typeof SCREENS)[number]) {
  const bounds = datasetBounds({ communes: communes!, poles });
  const frame = computeFrame(screen.w, screen.h, screen.bar, bounds);
  const geo = poleGeometry(poles, frame, true);
  let minClear = Infinity;
  for (let i = 0; i < geo.length; i++) {
    for (let j = i + 1; j < geo.length; j++) {
      const a = geo[i]!;
      const b = geo[j]!;
      minClear = Math.min(minClear, Math.hypot(a.x - b.x, a.y - b.y) - stateMarkOuter(a.r) - stateMarkOuter(b.r));
    }
  }
  const moves = geo.map((g, i) => {
    const p0 = toScreen(frame, poles[i]!.sky);
    return { id: g.id, px: Math.hypot(g.x - p0.x, g.y - p0.y) };
  });
  const max = moves.reduce((m, x) => (x.px > m.px ? x : m), moves[0]!);
  return { frame, geo, minClear, max, moved: moves.filter((m) => m.px > 0.5).length };
}

// sky44.relaxAll = false (jeton de Maia) : positions brutes + zoom automatique de la PR n° 19, rien à mesurer ici
describe.skipIf(!poles44 || !communes || !sky44.relaxAll)('ciel à 44 astres (D-030)', () => {
  it('44 astres, chacun avec son bassin et son nom court', () => {
    expect(poles44!.length).toBe(44);
    for (const p of poles44!) {
      expect(p.bassin).toBeTruthy();
      expect(p.name_short).toBeTruthy();
    }
  });

  for (const s of SCREENS) {
    it(`aucun repère d'état ne touche un autre à ${s.w} x ${s.h}`, () => {
      const m = measure(poles44!, s);
      // écart entre bords extérieurs >= minGap (tolérance de calcul flottant)
      expect(m.minClear).toBeGreaterThanOrEqual(skyRelax.minGap - 1e-3);
      // rayons inchangés : même échelle d'aire pour tous, quelle que soit la relaxation
      const radius = makeRadius(poles44!, m.frame);
      expect(m.geo.map((g) => g.r)).toEqual(poles44!.map((p) => radius(p.jobs)));
      // plus de disque à corriger par le zoom automatique : l'échelle globale reste à 1
      expect(detectOverlapZoom(m.geo, 0)).toBe(1);
      console.info(`${s.w} x ${s.h} : ${m.moved} astres déplacés, au plus ${m.max.px.toFixed(1)} px (${m.max.id}), écart minimal ${m.minClear.toFixed(2)} px`);
    });
  }

  it('déterministe et indépendant du scénario : mêmes entrées, mêmes positions', () => {
    const bounds = datasetBounds({ communes: communes!, poles: poles44! });
    const f = computeFrame(1600, 900, 128, bounds);
    expect(poleGeometry(poles44!, f, true)).toEqual(poleGeometry(poles44!, f, true));
  });
});
