/**
 * Noms du ciel et éléments d'interface posés par-dessus (boutons de zoom, barre du haut, légende) : arbitrage de
 * Nicolas du 05/11, mobile 390 px. La règle de placement (`placeWithLeaders`) ne change pas, pour aucun des deux
 * ciels : elle tourne d'abord SANS ces zones, exactement comme avant ; seuls les noms qui tombent dessous sont
 * posés de nouveau, un par un, autour des noms qui n'ont pas bougé. Aucun autre nom ne se déplace, donc aucun
 * nom n'est perdu par ricochet (un placement glouton avec les zones en plus décalerait des noms voisins).
 * Un nom qui était posé avant et ne trouve aucune place dans les 8 directions à la portée habituelle des traits de
 * rappel est cherché sur tout le volet, de proche en proche (`searchStep`, un jeton) : « aucun nom perdu ». Les noms
 * que la règle d'origine n'avait pas posés restent non posés (rien ne change pour eux).
 * Les zones sont des données (rectangles écran publiés par les composants, `store/overlayRects.ts`).
 */
import { placeWithLeaders, segmentHitsBox, segmentsCross, type LabelBox, type PlacedLabel } from './labels';

export type LabelItem = { index: number; cx: number; cy: number; r: number; w: number; h: number; allowDrop?: boolean };

/** Valeurs par défaut de `placeWithLeaders` : près 5 px, loin 44 px (portée habituelle d'un trait de rappel), écart 3 px. */
const NEAR = 5;
const FAR = 44;
const PAD = 3;

/** Une boîte de nom touche-t-elle un rectangle (écart `pad` px) ? */
export function labelTouches(b: Omit<LabelBox, 'index'>, z: Omit<LabelBox, 'index'>, pad = PAD): boolean {
  return b.x - pad < z.x + z.w && b.x + b.w + pad > z.x && b.y - pad < z.y + z.h && b.y + b.h + pad > z.y;
}

/** Point du rectangle le plus proche de (px, py). */
function nearestPoint(b: Omit<LabelBox, 'index'>, px: number, py: number): { x: number; y: number } {
  return { x: Math.min(Math.max(px, b.x), b.x + b.w), y: Math.min(Math.max(py, b.y), b.y + b.h) };
}

/**
 * Dernier recours pour un nom déplacé : la place libre la plus proche de son astre sur tout le volet (grille de `step` px),
 * en préférant une position dont le trait de rappel ne croise aucun autre trait ni aucune boîte (sauf son propre disque).
 * Ne touche ni un disque, ni une zone, ni un autre nom (même écart `PAD`).
 */
export function nearestFreeLabel(
  it: LabelItem,
  blocked: readonly LabelBox[],
  placed: readonly PlacedLabel[],
  bounds: Omit<LabelBox, 'index'>,
  step: number,
): PlacedLabel | null {
  const own = -1 - it.index;
  const cands: { x: number; y: number; d: number }[] = [];
  for (let x = bounds.x; x + it.w <= bounds.x + bounds.w; x += step) {
    for (let y = bounds.y; y + it.h <= bounds.y + bounds.h; y += step) {
      const q = nearestPoint({ x, y, w: it.w, h: it.h }, it.cx, it.cy);
      cands.push({ x, y, d: Math.hypot(q.x - it.cx, q.y - it.cy) });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  const leaderOf = (box: Omit<LabelBox, 'index'>): PlacedLabel['leader'] | undefined => {
    const q = nearestPoint(box, it.cx, it.cy);
    const d = Math.hypot(q.x - it.cx, q.y - it.cy);
    if (d <= it.r + NEAR + 1) return undefined;
    const ux = (q.x - it.cx) / d;
    const uy = (q.y - it.cy) / d;
    return { x1: it.cx + ux * it.r, y1: it.cy + uy * it.r, x2: q.x, y2: q.y };
  };
  let firstFree: PlacedLabel | null = null;
  for (const c of cands) {
    const box = { x: c.x, y: c.y, w: it.w, h: it.h };
    if (blocked.some((p) => labelTouches(box, p)) || placed.some((p) => labelTouches(box, p))) continue;
    const leader = leaderOf(box);
    const label: PlacedLabel = { index: it.index, ...box, ...(leader ? { leader } : {}) };
    if (!firstFree) firstFree = label;
    const clean =
      !leader ||
      (!placed.some((p) => p.leader && segmentsCross(leader, p.leader)) &&
        !blocked.some((p) => p.index !== own && segmentHitsBox(leader, p)) &&
        !placed.some((p) => segmentHitsBox(leader, p)));
    if (clean) return label;
  }
  return firstFree;
}

/**
 * Pose les noms comme `placeWithLeaders(items, reserved)`, puis reprend ceux qui touchent une des `zones`.
 * Avec `bounds` (le volet) et `step`, un nom déplacé qui ne trouve plus de place dans les 8 directions est cherché
 * sur tout le volet ; sans eux, un tel nom n'est pas posé.
 */
export function placeAvoidingZones(
  items: readonly LabelItem[],
  reserved: readonly LabelBox[],
  zones: readonly Omit<LabelBox, 'index'>[],
  search?: { bounds: Omit<LabelBox, 'index'>; step: number },
): PlacedLabel[] {
  const first = placeWithLeaders(items, reserved, NEAR, FAR, PAD);
  if (!zones.length) return first;
  const under = new Set(first.filter((b) => zones.some((z) => labelTouches(b, z))).map((b) => b.index));
  if (!under.size) return first;
  const kept = first.filter((b) => !under.has(b.index));
  const blocks: LabelBox[] = zones.map((z, i) => ({ index: -5000 - i, ...z }));
  const blocked = [...reserved, ...blocks];
  const redo = items.filter((it) => under.has(it.index));
  const again = placeWithLeaders(redo, [...blocked, ...kept], NEAR, FAR, PAD, kept);
  if (search) {
    const got = new Set(again.map((b) => b.index));
    for (const it of redo) {
      if (got.has(it.index)) continue;
      const label = nearestFreeLabel(it, blocked, [...kept, ...again], search.bounds, search.step);
      if (label) again.push(label);
    }
  }
  // même ordre que `items` (priorité décroissante) pour que le rendu reste stable
  const byIndex = new Map([...kept, ...again].map((b) => [b.index, b]));
  return items.flatMap((it) => {
    const b = byIndex.get(it.index);
    return b ? [b] : [];
  });
}
