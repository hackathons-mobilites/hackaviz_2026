import { describe, expect, it } from 'vitest';
import { MODE_PHRASE, MODE_SHORT, placeGuideLabel, placeLabelOptions, placeLabels, placeWithLeaders, poleShortName, ringCandidates, segmentHitsBox, segmentsCross, type LabelBox } from './labels';

describe('libellés', () => {
  it('noms courts', () => {
    expect(poleShortName({ id: 'P_PLAINE', name: 'Saint-Denis / Plaine Commune' })).toBe('Plaine Commune');
    expect(poleShortName({ id: 'P_PARIS_QCA', name: 'Paris - Quartier central (1er, 2e)' })).toBe('Paris QCA');
    expect(poleShortName({ id: 'X', name: 'Pôle inconnu (77)' })).toBe('Pôle inconnu');
    // D-030 : name_short a la priorité
    expect(poleShortName({ id: 'BE_1146', name: 'T4 Paris Ouest La Défense', name_short: 'Courbevoie' })).toBe('Courbevoie');
    expect(poleShortName({ id: 'BE_1107_75101', name: 'Paris 1er Arrondissement', name_short: '1er' })).toBe('1er');
  });
  it('jamais deux étiquettes qui se chevauchent', () => {
    const kept = placeLabels([
      { index: 0, x: 0, y: 0, w: 100, h: 16 },
      { index: 1, x: 50, y: 5, w: 100, h: 16 },
      { index: 2, x: 0, y: 40, w: 100, h: 16 },
    ]);
    expect(kept).toEqual([0, 2]);
  });
});

describe('positions candidates', () => {
  it('prend la première position libre, sinon n’affiche pas', () => {
    const kept = placeLabelOptions(
      [
        { index: 0, options: [{ x: 0, y: 0, w: 50, h: 10 }] },
        { index: 1, options: [{ x: 10, y: 0, w: 50, h: 10 }, { x: 0, y: 30, w: 50, h: 10 }] },
        { index: 2, options: [{ x: 5, y: 2, w: 10, h: 5 }] },
      ],
      [],
      2,
    );
    expect(kept.map((k) => [k.index, k.y])).toEqual([
      [0, 0],
      [1, 30],
    ]);
  });
});

describe('étiquettes avec trait de rappel', () => {
  it('position proche si libre, sinon à distance avec un trait, jamais sur un obstacle', () => {
    const disc = { index: -1, x: -10, y: -10, w: 20, h: 20 };
    // tout le voisinage proche est bloqué par un grand obstacle : on part à 44 px avec un trait
    const wall = { index: -2, x: -48, y: -48, w: 96, h: 96 };
    const [near] = placeWithLeaders([{ index: 0, cx: 0, cy: 0, r: 10, w: 40, h: 14 }], [disc]);
    expect(near!.leader).toBeUndefined();
    const [far] = placeWithLeaders([{ index: 0, cx: 0, cy: 0, r: 10, w: 40, h: 14 }], [wall]);
    expect(far?.leader).toBeDefined();
    const box = far!;
    const overlaps = box.x < wall.x + wall.w && box.x + box.w > wall.x && box.y < wall.y + wall.h && box.y + box.h > wall.y;
    expect(overlaps).toBe(false);
  });
});

describe('étiquette toujours placée', () => {
  it('cherche plus loin quand les deux premiers anneaux sont pris', () => {
    const wall = { index: -2, x: -70, y: -70, w: 140, h: 140 };
    const [far] = placeWithLeaders([{ index: 0, cx: 0, cy: 0, r: 10, w: 40, h: 14 }], [wall]);
    expect(far?.leader).toBeDefined();
  });
});

describe("nom de l'étoile-guide (L-02)", () => {
  const inside = () => true;
  // Cas Maisons-Laffitte à 1280 x 720 (?o=78358&d=d14&b=60&m=transit) : étoile (522, 223), La Défense
  // (549, 261) r 15 en dessous, Plaine Commune (616, 231) à droite, carte du contraste du jour en haut à
  // gauche (20..380 x 96..236).
  const guide = { x: 522, y: 223, r: 10 };
  const disc = (x: number, y: number, r: number, index: number) => ({ index, x: x - r - 8, y: y - r - 8, w: (r + 8) * 2, h: (r + 8) * 2 });
  const discs = [disc(549, 261, 15.4, -1), disc(616, 231, 11.3, -2), disc(512, 183, 6.9, -3)];
  const star = { index: -1001, x: 510, y: 211, w: 24, h: 24 };
  const card = { index: -3000, x: 20, y: 96, w: 360, h: 140 };

  it('reste collé à son étoile quand une place proche est libre', () => {
    const g = placeGuideLabel(guide, 130, 18, [...discs, star], inside);
    expect(g.far).toBe(false);
    expect(g.leader).toBeUndefined();
    // à gauche de l'étoile, à 8 px du rayon
    expect(g.x + g.w).toBeCloseTo(522 - 18);
  });

  it('ne passe jamais sous une carte posée sur le ciel', () => {
    const g = placeGuideLabel(guide, 130, 18, [...discs, star, card], inside);
    const overlaps = g.x < card.x + card.w && g.x + g.w > card.x && g.y < card.y + card.h && g.y + g.h > card.y;
    expect(overlaps).toBe(false);
  });

  it('repli ultime à distance, avec un trait de rappel, si tout est pris autour', () => {
    const ring = { index: -9, x: guide.x - 60, y: guide.y - 40, w: 120, h: 80 };
    const g = placeGuideLabel(guide, 130, 18, [ring], inside);
    expect(g.far).toBe(true);
    expect(g.leader).toBeDefined();
  });

  it("n'est jamais omis, même sur un écran saturé", () => {
    const wall = { index: -9, x: -5000, y: -5000, w: 10000, h: 10000 };
    const g = placeGuideLabel(guide, 130, 18, [wall], inside);
    expect(g.w).toBe(130);
  });
});

describe('traits de rappel (D-030, 44 astres)', () => {
  it('segments : croisement propre et traversée de rectangle', () => {
    expect(segmentsCross({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 0, y1: 10, x2: 10, y2: 0 })).toBe(true);
    expect(segmentsCross({ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 0, y1: 5, x2: 10, y2: 5 })).toBe(false);
    expect(segmentsCross({ x1: 0, y1: 0, x2: 5, y2: 5 }, { x1: 5, y1: 5, x2: 9, y2: 0 })).toBe(false);
    expect(segmentHitsBox({ x1: 0, y1: 5, x2: 20, y2: 5 }, { x: 8, y: 0, w: 4, h: 10 })).toBe(true);
    expect(segmentHitsBox({ x1: 0, y1: 20, x2: 20, y2: 20 }, { x: 8, y: 0, w: 4, h: 10 })).toBe(false);
  });
  it('astres serrés : aucun nom perdu, pas plus de croisements que le placement au premier emplacement libre', () => {
    // grappe de 12 astres de 8 px de rayon, nom de 60 x 14 px, disques réservés comme PoleLayer (index -1 - i)
    const items = Array.from({ length: 12 }, (_, i) => ({ index: i, cx: 300 + (i % 4) * 22, cy: 300 + Math.floor(i / 4) * 22, r: 8, w: 60, h: 14 }));
    const discs = items.map((it) => ({ index: -1 - it.index, x: it.cx - 12, y: it.cy - 12, w: 24, h: 24 }));
    const crossings = (list: { leader?: { x1: number; y1: number; x2: number; y2: number } }[]) => {
      const ls = list.flatMap((p) => (p.leader ? [p.leader] : []));
      let n = 0;
      for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) if (segmentsCross(ls[i]!, ls[j]!)) n++;
      return n;
    };
    // référence : premier emplacement libre, sans regard sur les traits (placement d'avant)
    const placedRef: LabelBox[] = [...discs];
    const naive: { leader?: { x1: number; y1: number; x2: number; y2: number } }[] = [];
    const hit = (a: Omit<LabelBox, 'index'>, b: LabelBox) => a.x - 3 < b.x + b.w && a.x + a.w + 3 > b.x && a.y - 3 < b.y + b.h && a.y + a.h + 3 > b.y;
    for (const it of items) {
      const options = [5, 44, 88, 132].flatMap((gap, k) => ringCandidates(it.cx, it.cy, it.r, it.w, it.h, gap, k > 0));
      const free = options.find((o) => !placedRef.some((p) => hit(o, p)));
      if (!free) continue;
      placedRef.push({ index: it.index, x: free.x, y: free.y, w: free.w, h: free.h });
      naive.push(free);
    }
    const placed = placeWithLeaders(items, discs);
    expect(placed).toHaveLength(items.length);
    expect(crossings(placed)).toBeLessThanOrEqual(crossings(naive));
  });
});

describe('noms des modes (retour de Cyril, 11/11)', () => {
  it('le menu des modes parle en mots simples : ni « TC » ni « DiRIF », la méthode est au « i »', () => {
    for (const label of Object.values(MODE_SHORT)) {
      expect(label).not.toMatch(/\bTC\b|DiRIF/);
    }
    expect(MODE_SHORT.transit).toBe('Transports en commun');
    expect(MODE_SHORT.car_traffic).toBe('Voiture, trafic moyen');
  });
  it('dans une phrase, le nom du mode est en minuscules (« face aux transports en commun »)', () => {
    expect(MODE_PHRASE.transit).toBe('transports en commun');
    expect(MODE_PHRASE.bike_transit).toBe('vélo + transports en commun');
  });
});
