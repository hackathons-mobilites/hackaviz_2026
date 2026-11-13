/**
 * Tests contre l'export PARTIEL D-019 (600 origines, lots 0 à 5), lu dans
 * data/interim/od_export_partial/ (jamais copié dans public/). Sautés si le dossier est absent.
 *
 * Les valeurs attendues ont été relevées à la main dans les séries décodées par le lecteur Python
 * (`starway.od_export.parse_file`, `outbound`, `inbound`, `reached_by_pole`) le 03/11/2026 ; elles
 * sont propres à ce jeu (`dataset_id` vérifié) : un nouvel export peut les changer.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkSwodHeader, computeOd } from './compute';
import { shiftBounds, shiftFromDayType } from './shift';
import { decodeSwodBytes, type SwodFile } from './swod';
import { odTextContext, odVerdict, odWalkLimitNote } from './texts';
import type { OdIndex } from './types';

const PARTIAL = fileURLToPath(new URL('../../../../data/interim/od_export_partial/', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../../../public/data/', import.meta.url));
const hasPartial = existsSync(join(PARTIAL, 'index.json'));
const DATASET = '2026-11-17_dc97ca710c6c';
const readIndex = (): OdIndex | null => (hasPartial ? (JSON.parse(readFileSync(join(PARTIAL, 'index.json'), 'utf-8')) as OdIndex) : null);
/** Valeurs relevées à la main : seulement pour CE jeu (un autre export saute ces tests, il ne les fait pas passer). */
const sameDataset = readIndex()?.dataset_id === DATASET;
const itData = it.skipIf(!sameDataset);

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf-8')) as T;
async function origin(insee: string): Promise<SwodFile> {
  const b = readFileSync(join(PARTIAL, 'o', `${insee}.bin`));
  return decodeSwodBytes(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

describe.skipIf(!hasPartial)('export partiel D-019', () => {
  const index = readIndex() as OdIndex;
  const at = (insee: string) => index.communes.indexOf(insee);
  // 9h-17h : journée-type d09 de meta.json, lue dans le fichier publié
  const meta = readJson<{ day_types: { id: string; start: string; end: string }[]; dataset_id?: string }>(join(PUBLIC, 'meta.json'));
  const d09 = meta.day_types.find((d) => d.id === 'd09')!;

  itData('jeu attendu', async () => {
    expect(index.complete).toBe(false);
    const f = await origin('75101');
    expect(checkSwodHeader(index, f, '75101')).toEqual([]);
    const b = shiftBounds(index)!;
    // E > S et grille jusqu'à 22:00 : dernier début utilisable 21:55 (starts.last = 22:05 publié)
    expect(b).toMatchObject({ step: 5, startMin: 300, startMax: 1315, endMin: 305, endMax: 1320 });
    expect(shiftFromDayType(b, d09)).toEqual({ start: 540, end: 1020 });
  });

  itData('Paris 1er vers Paris 15e, 9h-17h : séries décodées relues à la main', async () => {
    const r = computeOd(index, await origin('75101'), { origin: '75101', start: 540, end: 1020, budget: 45, mode: 'transit' });
    const d = r.dests[at('75115')]!;
    // Série aller relevée : départ 8h25 = 32 min (arrivée 8h57), 8h30 = 31 min (arrivée 9h01, trop tard)
    expect(d.out).toEqual({ minutes: 32, reason: null, dep: 505 });
    // Série retour au départ de 17h00 : 32 min
    expect(d.ret).toEqual({ minutes: 32, reason: null });
    expect(d.status).toBe('accessible');
    expect(d.pole).toBe(1); // P_PARIS_RG
  });

  itData('retour vers une commune pas encore calculée : « retour non calculé », jamais « aucun retour »', async () => {
    const f = await origin('75101');
    // 75101 vers 78206 : départ 7h40 = 77 min (arrivée 8h57) ; 78206 hors des lots calculés, retour 253
    const sc = { origin: '75101', start: 540, end: 1020, mode: 'transit' as const };
    const at90 = computeOd(index, f, { ...sc, budget: 90 }).dests[at('78206')]!;
    expect(at90).toMatchObject({ status: 'unknown', out: { minutes: 77, dep: 460 }, ret: { minutes: null, reason: 'not_computed' } });
    const ctx = odTextContext(index, true);
    const v = odVerdict(at90, 90, ctx);
    expect(v.title).toBe('Retour non calculé');
    expect(v.detail).toContain('retour non calculé (jeu de données partiel)');
    expect(`${v.title} ${v.detail}`).not.toMatch(/aucun retour|aucune arrivée/i);
    // À 60 min, l'aller (77 min) suffit à écarter la commune ; le retour reste « non calculé »
    const at60 = computeOd(index, f, { ...sc, budget: 60 }).dests[at('78206')]!;
    expect(at60.status).toBe('none');
    expect(odVerdict(at60, 60, ctx)).toMatchObject({ kind: 'blocked', title: 'Aller trop long' });
  });

  itData('modes sans horaire (scalaires) relus à la main : Paris 1er vers Paris 15e', async () => {
    const f = await origin('75101');
    const sc = { origin: '75101', start: 540, end: 1020, budget: 60 };
    const y = at('75115');
    expect(computeOd(index, f, { ...sc, mode: 'walk' }).dests[y]).toMatchObject({ out: { minutes: 75 }, ret: { minutes: 75 }, status: 'none' });
    expect(computeOd(index, f, { ...sc, mode: 'bike' }).dests[y]).toMatchObject({ out: { minutes: 39 }, ret: { minutes: 35 }, status: 'accessible' });
    expect(computeOd(index, f, { ...sc, mode: 'car' }).dests[y]).toMatchObject({ out: { minutes: 22 }, ret: { minutes: 24 }, status: 'accessible' });
  });

  itData('parts des pôles = agrégation de référence Python (reached_by_pole), Paris 1er, 9h-17h, 45 min', async () => {
    const r = computeOd(index, await origin('75101'), { origin: '75101', start: 540, end: 1020, budget: 45, mode: 'transit' });
    expect(r.poles.map((p) => p.reached)).toEqual([746536, 583659, 598183, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // commune d'origine (Paris 1er, dans Paris QCA) : ni atteinte, ni non atteinte
    expect(r.dests[at('75101')]!.status).toBe('self');
    expect(r.poles[0]!.self).toBe(index.jobs[at('75101')]);
    expect(r.totals!.reachedAll).toBe(1928378);
    for (const p of r.poles) expect(p.reached + p.notReached + p.unknown + p.self).toBe(p.jobs);
    // La Défense : communes hors des lots calculés, retours non calculés -> aucun poste compté atteint
    expect(r.poles[3]!.unknown).toBeGreaterThan(0);
  });

  it('origine sans fichier : « non calculé pour cette commune », ciel neutre', () => {
    const missing = index.communes.find((c) => index.files !== 'all' && !index.files.includes(c));
    if (!missing) return;
    const r = computeOd(index, null, { origin: missing, start: 540, end: 1020, budget: 45, mode: 'transit' });
    expect(r.status).toBe('origin_not_computed');
    expect(r.poles).toEqual([]);
  });

  it('limite de marche non appliquée : phrase générale, distance lue dans l’index', () => {
    if (index.walk_limit?.status !== 'not_applied') return;
    const note = odWalkLimitNote(index, true)!;
    expect(note).toContain('2\u00a0km');
    expect(note).toContain('à l’aller comme au retour');
    expect(odWalkLimitNote(index, false)).toBeNull();
  });
});
