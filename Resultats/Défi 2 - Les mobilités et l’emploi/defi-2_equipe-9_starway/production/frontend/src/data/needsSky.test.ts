import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ItinerariesFile, ItinTrip } from './itineraries';
import { NEED_ORDER, needsFixedText, type NeedId, type NeedsLeg } from './needs';
import cases from './needsRuleCases.json';
import {
  astreMarkText,
  astresCountText,
  boxState,
  markedPoles,
  needsLegendDetails,
  needsLegendText,
  needsSkyWhy,
  pairMarked,
  sameAstres,
  starMarked,
  tripSummaryLines,
  type BoxState,
} from './needsSky';
import { poleGeometry, computeFrame } from '../sky/layout';
import type { Pole } from './types';

type LegName = keyof typeof cases.legs;
const legs = (names: readonly string[] | null): NeedsLeg[] | null => (names ? names.map((n) => cases.legs[n as LegName] as unknown as NeedsLeg) : null);

describe('règle du ciel : cas partagés avec pytest (needsRuleCases.json)', () => {
  for (const c of cases.mark) {
    it(c.name, () => {
      expect(starMarked(legs(c.out), legs(c.ret), c.selected as NeedId[])).toBe(c.marked);
    });
  }
  for (const c of cases.boxes) {
    it(`case ${c.box} : ${c.name}`, () => {
      expect(boxState(c.box as NeedId, legs(c.legs))).toBe(c.state as BoxState);
    });
  }
});

/* ------------------------------------------------------------------ du ciel affiché */

const trip = (names: string[], min: number): ItinTrip => ({ status: 'ok', min, matrix_min: min, legs: legs(names)! });
const file = (rows: Record<string, { out?: ItinTrip; ret?: ItinTrip }>): ItinerariesFile => ({
  insee: '75101',
  contract: 'itineraries-2',
  poles: Object.keys(rows),
  days: { d09: { out: Object.values(rows).map((r) => r.out ?? { status: 'no_trip_in_matrix' }), ret: Object.values(rows).map((r) => r.ret ?? { status: 'no_trip_in_matrix' }) } },
});

describe('astres marqués du ciel affiché', () => {
  const F = file({
    a: { out: trip(['bus_ok'], 30), ret: trip(['bus_ok'], 35) },
    b: { out: trip(['bus_ok'], 30), ret: trip(['bus_vehicule_non'], 35) },
    c: { out: trip(['bus_ok'], 30) }, // pas de retour
    d: { out: trip(['bus_ok'], 30), ret: trip(['bus_ok'], 80) }, // retour hors budget
    e: { out: trip(['walk'], 10), ret: trip(['walk'], 10) }, // à pied seulement
  });
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const base = { file: F, poleIds: ids, day: 'd09' as const, budget: 60 };

  it('seuls les astres dont l’aller ET le retour sont déclarés remplis, dans le budget, sont marqués', () => {
    expect(markedPoles({ ...base, selected: ['wc_trip', 'wc_stops'] })).toEqual(['a']);
    expect(markedPoles({ ...base, selected: ['wc_trip'], budget: 90 })).toEqual(['a', 'd']);
  });
  it('aucune marque pour les annonces seules, ni sans case cochée, ni sans fichier ni journée', () => {
    expect(markedPoles({ ...base, selected: ['audio', 'visual'] })).toEqual([]);
    expect(markedPoles({ ...base, selected: [] })).toEqual([]);
    expect(markedPoles({ ...base, selected: ['wc_trip'], file: null })).toEqual([]);
    expect(markedPoles({ ...base, selected: ['wc_trip'], day: null })).toEqual([]);
  });
  it('un fichier calculé pour d’autres astres ne marque rien (alignement par identifiants)', () => {
    expect(sameAstres(F, ids)).toBe(true);
    expect(sameAstres(F, ['a', 'b'])).toBe(false);
    expect(sameAstres(F, ['b', 'a', 'c', 'd', 'e'])).toBe(false);
    expect(markedPoles({ ...base, selected: ['wc_trip'], poleIds: ['x', 'y'] })).toEqual([]);
  });
  it('pairMarked : sens absent ou durée absente = pas de marque', () => {
    expect(pairMarked(trip(['bus_ok'], 30), null, ['wc_trip'], 60)).toBe(false);
    expect(pairMarked({ status: 'ok', legs: legs(['bus_ok'])! }, trip(['bus_ok'], 30), ['wc_trip'], 60)).toBe(false);
  });
});

describe('le ciel ne bouge pas : position, taille et luminosité des astres', () => {
  const poles = ['a', 'b', 'c', 'd', 'e'].map(
    (id, i) => ({ id, name: id, sky: { x: 0.1 + i * 0.18, y: 0.2 + (i % 2) * 0.4 }, jobs: 1000 * (i + 1) }) as unknown as Pole,
  );
  it('la mise en page du ciel ne lit pas les cases : même géométrie avec ou sans marque', () => {
    const frame = computeFrame(1280, 800, 0, undefined, 0);
    const before = JSON.stringify(poleGeometry(poles, frame, false));
    const file2 = file({ a: { out: trip(['bus_ok'], 30), ret: trip(['bus_ok'], 30) } });
    markedPoles({ selected: ['wc_trip', 'wc_stops', 'station'], file: file2, poleIds: ['a'], day: 'd09', budget: 60 });
    expect(JSON.stringify(poleGeometry(poles, frame, false))).toBe(before);
  });
  it('le calcul des marques ne modifie pas ses entrées et ne retire aucun astre', () => {
    const f = file({ a: { out: trip(['bus_ok'], 30), ret: trip(['bus_ok'], 30) }, b: { out: trip(['bus_ok'], 30) } });
    const snapshot = JSON.stringify(f);
    const out = markedPoles({ selected: ['wc_trip'], file: f, poleIds: ['a', 'b'], day: 'd09', budget: 60 });
    expect(JSON.stringify(f)).toBe(snapshot);
    expect(out.every((id) => ['a', 'b'].includes(id))).toBe(true);
  });
  const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');
  const walk = (rel: string): string[] => {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    return (readdirSync(dir, { recursive: true }) as string[])
      .filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))
      .map((n) => join(dir, n));
  };
  it('le moteur du ciel, l’URL, la visite et le store du ciel ne lisent jamais le réglage', () => {
    const files = ['../sky/', '../state/', '../tour/'].flatMap(walk);
    files.push(fileURLToPath(new URL('../store/useSkyStore.ts', import.meta.url)));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const text = readFileSync(f, 'utf-8');
      expect(text, f).not.toMatch(/needsStore|from '(?:\.\.?\/)+(?:data\/)?needs(?:Sky)?'|NEEDS_STORAGE_KEY|starway\.needs/);
    }
  });
  it('le calque de marque est décoratif, sans clic, et ne touche pas au moteur', () => {
    const layer = src('../components/needs/NeedsMarks.tsx');
    expect(layer).toContain('aria-hidden="true"');
    expect(layer).not.toMatch(/sky\/|SkyEngine|useSkyStore/);
    expect(src('../components/needs/needsMarks.css')).toMatch(/pointer-events:\s*none/);
  });
});

describe('légende calculée sur le ciel affiché', () => {
  it('« n astres sur 44 : tout ce que vous avez coché est déclaré rempli », sans pourcentage', () => {
    const t = needsLegendText({ kind: 'ready', marked: 12, total: 44 }, ['wc_trip', 'station']);
    expect(t).toBe('12 astres sur 44 : tout ce que vous avez coché est déclaré rempli');
    expect(t).not.toMatch(/%/);
    expect(astresCountText(1, 15)).toBe('1 astre sur 15');
    expect(astresCountText(0, 15)).toBe('0 astre sur 15');
  });
  it('si des annonces sont aussi cochées, la phrase ne couvre que les quatre premières cases', () => {
    expect(needsLegendText({ kind: 'ready', marked: 3, total: 44 }, ['wc_trip', 'audio'])).toBe(
      '3 astres sur 44 : tout ce que vous avez coché parmi les quatre premières cases est déclaré rempli',
    );
  });
  it('annonces seules ou ciel sans itinéraire en TC : aucune marque, et la légende le dit', () => {
    expect(needsLegendText({ kind: 'signs_only' }, ['audio'])).toMatch(/aucune marque sur le ciel/);
    for (const why of ['mode', 'walk', 'shift', 'not_published', 'pending', 'no_origin', 'loading'] as const) {
      expect(needsLegendText({ kind: 'unavailable', why }, ['wc_trip'])).toMatch(/Aucune marque|Calcul de la marque/);
    }
    expect(needsLegendText({ kind: 'unavailable', why: 'mode' }, ['wc_trip'])).toMatch(/transports en commun/);
    expect(needsLegendText({ kind: 'none' }, [])).toBeNull();
  });
  it('détails : pas de marque = non rempli ou non renseigné ; trajet sans gare ferrée ; toujours le même rappel', () => {
    const d = needsLegendDetails({ kind: 'ready', marked: 1, total: 44 }, ['station', 'audio'], false).join(' ');
    expect(d).toContain('Pas de marque : non rempli ou non renseigné.');
    expect(d).toContain('Un trajet sans gare ferrée ne bloque pas');
    expect(d).toContain('Calcul sur le trajet le plus rapide, un autre trajet peut exister. Ascenseurs non couverts.');
    expect(needsLegendDetails({ kind: 'ready', marked: 1, total: 44 }, ['wc_trip'], true).join(' ')).toContain("l'arrêt le plus desservi");
    expect(needsLegendDetails({ kind: 'none' }, [], false)).toEqual([]);
  });
  it('jamais « accessible » ni « sûr » dans ces phrases ; pas de « non » pour une absence', () => {
    const all = [
      ...(['ready', 'signs_only', 'unavailable'] as const).flatMap((k) => {
        const st = k === 'ready' ? ({ kind: k, marked: 2, total: 44 } as const) : k === 'signs_only' ? ({ kind: k } as const) : ({ kind: k, why: 'mode' } as const);
        return [needsLegendText(st, [...NEED_ORDER]) ?? '', ...needsLegendDetails(st, [...NEED_ORDER], true)];
      }),
      needsFixedText({ TRA03: '03/11/2026' }),
    ].join(' ');
    expect(all).not.toMatch(/\baccessibles?\b|\bsûr|faisable/i);
  });
});

describe('raisons d’absence de marque (mêmes règles que le détail du trajet)', () => {
  const meta = {
    day_types: [{ id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' }],
    itineraries_communes: ['75101'],
    itineraries_variants: undefined,
    itineraries_format: undefined,
  } as unknown as Parameters<typeof needsSkyWhy>[0]['meta'];
  const p = { meta, mode: 'transit', day: 'd09' as const, shift: null, walkKey: null, origin: '75101', split: false };
  it('TC, journée-type, commune publiée : calculable', () => {
    expect(needsSkyWhy(p)).toBeNull();
  });
  it('autre mode, horaires libres, diptyque, commune non publiée, pas de commune', () => {
    expect(needsSkyWhy({ ...p, mode: 'car' })).toBe('mode');
    expect(needsSkyWhy({ ...p, shift: { start: 7 * 60, end: 15 * 60 } })).toBe('shift');
    expect(needsSkyWhy({ ...p, split: true })).toBe('compare');
    expect(needsSkyWhy({ ...p, origin: '99999' })).toBe('not_published');
    expect(needsSkyWhy({ ...p, origin: null })).toBe('no_origin');
  });
});

describe('panneau de l’astre', () => {
  const ok = trip(['bus_ok'], 30);
  it('états par sens et phrase sur la marque, jamais « non » pour une absence', () => {
    expect(tripSummaryLines(legs(['bus_arret_null']), ['wc_stops', 'audio'])).toEqual([
      'Arrêts déclarés adaptés au fauteuil roulant : non renseigné : au moins une valeur absente de la source',
      'Annonces sonores : rempli sur tout le trajet',
    ]);
    expect(tripSummaryLines(legs(['bus_ok']), ['station'])[0]).toContain('aucune gare ferrée du jeu sur ce trajet');
    expect(astreMarkText(ok, ok, [], 60)).toBeNull();
    expect(astreMarkText(ok, ok, ['audio'], 60)).toMatch(/aucune marque sur le ciel/);
    expect(astreMarkText(ok, ok, ['wc_trip'], 60)).toMatch(/^Astre marqué/);
    expect(astreMarkText(ok, trip(['bus_vehicule_non'], 30), ['wc_trip'], 60)).toBe('Pas de marque : non rempli ou non renseigné.');
    expect(astreMarkText(ok, null, ['wc_trip'], 60)).toMatch(/Aller ou retour non détaillé/);
  });
});
