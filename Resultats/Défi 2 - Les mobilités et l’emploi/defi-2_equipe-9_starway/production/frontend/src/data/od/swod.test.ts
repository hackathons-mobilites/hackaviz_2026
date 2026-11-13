import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as front from './swod';
import { buildSwod } from './testkit';

const CONTRACT = fileURLToPath(new URL('../../../../docs/contrats-donnees.md', import.meta.url));
const PARTIAL = fileURLToPath(new URL('../../../../data/interim/od_export_partial/', import.meta.url));
const hasPartial = existsSync(join(PARTIAL, 'index.json'));

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Comparaison octet à octet (toEqual sur des milliers de Uint8Array est trop lent). */
function sameFile(a: front.SwodFile, b: front.SwodFile): boolean {
  const eq = (x?: ArrayLike<number>, y?: ArrayLike<number>) =>
    x === y || (!!x && !!y && x.length === y.length && Buffer.compare(Buffer.from(x as Uint8Array), Buffer.from(y as Uint8Array)) === 0);
  if (a.origin !== b.origin || a.step !== b.step || a.first !== b.first || a.nSlots !== b.nSlots || a.maxTrip !== b.maxTrip) return false;
  if (a.sections.size !== b.sections.size) return false;
  for (const [mode, sa] of a.sections) {
    const sb = b.sections.get(mode);
    if (!sb || sa.kind !== sb.kind || sa.dest.length !== sb.dest.length) return false;
    if (!sa.dest.every((d, i) => d === sb.dest[i])) return false;
    if (!eq(sa.out, sb.out) || !eq(sa.ret, sb.ret)) return false;
    for (const key of ['outSeries', 'retSeries'] as const) {
      const xs = sa[key] ?? [];
      const ys = sb[key] ?? [];
      if (xs.length !== ys.length || !xs.every((x, i) => eq(x, ys[i]))) return false;
    }
  }
  return true;
}

/** Série de 229 départs : valeur constante (sentinelle) ou durées données par départ. */
const fill = (n: number, v: number) => Array.from({ length: n }, () => v);

describe('lecteur SWOD (synthétique)', () => {
  const N = 229;
  // arrivée constante à 9h00 pour les départs de 7h30 à 8h55 (durées 90 à 5), sentinelle ailleurs
  const out = fill(N, 255).map((v, k) => {
    const dep = 180 + 5 * k;
    return dep >= 450 && dep <= 535 ? 540 - dep : v;
  });
  const ret = fill(N, 253);
  const buf = buildSwod({
    origin: 2,
    step: 5,
    first: 180,
    nSlots: N,
    maxTrip: 120,
    sections: [
      { mode: 0, kind: 'series', records: [{ dest: 0, out, ret }] },
      { mode: 3, kind: 'scalar', records: [{ dest: 0, out: 22, ret: 255 }] },
    ],
  });

  it('relit l’en-tête et les séries, sans perte', () => {
    const f = front.parseSwod(buf);
    expect(f).toMatchObject({ origin: 2, step: 5, first: 180, nSlots: N, maxTrip: 120 });
    const s = f.sections.get(0)!;
    expect(s.kind).toBe('series');
    expect([...s.outSeries![0]!]).toEqual(out);
    expect([...s.retSeries![0]!]).toEqual(ret);
    const c = f.sections.get(3)!;
    expect([...c.out!]).toEqual([22]);
    expect(front.scalarLeg(f, c.ret![0]!)).toEqual({ minutes: null, reason: 'no_trip_within_120' });
  });

  it('aller : départ le plus tardif qui arrive à l’heure ; retour : 253 = non calculé', () => {
    const f = front.parseSwod(buf);
    const s = f.sections.get(0)!;
    // début 9h : le départ de 8h55 (5 min) arrive à 9h00
    expect(front.outboundAt(f, s.outSeries![0]!, 540, 120)).toEqual({ minutes: 5, reason: null, dep: 535 });
    // début 8h : aucun départ de la fenêtre n'arrive avant 8h
    expect(front.outboundAt(f, s.outSeries![0]!, 480, 120)).toEqual({ minutes: null, reason: 'no_trip_within_120', dep: null });
    expect(front.inboundAt(f, s.retSeries![0]!, 1020)).toEqual({ minutes: null, reason: 'not_computed' });
    expect(() => front.outboundAt(f, s.outSeries![0]!, 240, 120)).toThrow(RangeError);
    expect(() => front.inboundAt(f, s.retSeries![0]!, 1321)).toThrow(RangeError);
  });

  it('décompresse le gzip nativement (DecompressionStream) et lit aussi un fichier déjà décodé', async () => {
    const gz = toArrayBuffer(gzipSync(Buffer.from(buf)));
    expect(front.isGzip(gz)).toBe(true);
    expect(front.isGzip(buf)).toBe(false);
    const a = await front.decodeSwodBytes(gz);
    const b = await front.decodeSwodBytes(buf);
    expect(a).toEqual(b);
  });

  it('refuse un fichier invalide ou tronqué', () => {
    expect(() => front.parseSwod(new Uint8Array([1, 2, 3]).buffer)).toThrow(/invalide/);
    const bad = new Uint8Array(buf.slice(0));
    bad[0] = 0x58;
    expect(() => front.parseSwod(bad.buffer)).toThrow(/invalide/);
    expect(() => front.parseSwod(buf.slice(0, buf.byteLength - 1))).toThrow();
  });
});

describe('lecteur SWOD v2 (D-040) : 288 départs, plus de 255 plages', () => {
  const N = 288; // 00:00 à 23:55
  // une plage par départ : l'arrivée change à chaque départ (durées 100 et 107 en alternance)
  const out = Array.from({ length: N }, (_, k) => 100 + (k % 2) * 7);
  const ret = fill(N, 255); // aucun retour : une plage de sentinelle de 288 départs, coupée à 255
  const file = {
    origin: 1,
    step: 5,
    first: 0,
    nSlots: N,
    maxTrip: 120,
    sections: [{ mode: 0, kind: 'series' as const, records: [{ dest: 3, out, ret }] }],
  };

  it('relit sans perte une série de 288 plages et une plage de sentinelle de plus de 255 départs', () => {
    const f = front.parseSwod(buildSwod(file, 2));
    expect(f).toMatchObject({ first: 0, nSlots: 288 });
    expect([...f.sections.get(0)!.outSeries![0]!]).toEqual(out);
    expect([...f.sections.get(0)!.retSeries![0]!]).toEqual(ret);
  });

  it('une même série en version 1 et en version 2 donne les mêmes valeurs (si 255 plages au plus)', () => {
    const short = { ...file, nSlots: 229, sections: [{ mode: 0, kind: 'series' as const, records: [{ dest: 3, out: out.slice(0, 229), ret: fill(229, 253) }] }] };
    const a = front.parseSwod(buildSwod(short, 1));
    const b = front.parseSwod(buildSwod(short, 2));
    expect([...a.sections.get(0)!.outSeries![0]!]).toEqual([...b.sections.get(0)!.outSeries![0]!]);
    expect(front.SWOD_VERSIONS).toEqual([1, 2]);
  });

  it('refuse une version inconnue', () => {
    const bad = new Uint8Array(buildSwod(file, 2));
    bad[4] = 3;
    expect(() => front.parseSwod(bad.buffer)).toThrow(/version 3/);
  });

  it('aller depuis le soir et retour le matin dans la même série (poste 22h-6h)', () => {
    const o = fill(N, 255).map((v, k) => (k * 5 >= 21 * 60 && k * 5 <= 21 * 60 + 55 ? 25 : v));
    const r = fill(N, 255).map((v, k) => (k * 5 === 6 * 60 ? 40 : v));
    const f = front.parseSwod(buildSwod({ ...file, sections: [{ mode: 0, kind: 'series', records: [{ dest: 3, out: o, ret: r }] }] }, 2));
    const s = f.sections.get(0)!;
    expect(front.outboundAt(f, s.outSeries![0]!, 22 * 60, 120)).toEqual({ minutes: 25, reason: null, dep: 21 * 60 + 35 }); // 21h35 + 25 min = 22h
    expect(front.inboundAt(f, s.retSeries![0]!, 6 * 60)).toEqual({ minutes: 40, reason: null });
    // début à 02:00 : fenêtre [00:00, 01:55] entièrement dans la grille ; avant, hors plage
    expect(() => front.outboundAt(f, s.outSeries![0]!, 2 * 60, 120)).not.toThrow();
    expect(() => front.outboundAt(f, s.outSeries![0]!, 2 * 60 - 5, 120)).toThrow(RangeError);
    // fin à 23:55 lisible, 24:00 hors grille
    expect(() => front.inboundAt(f, s.retSeries![0]!, 23 * 60 + 55)).not.toThrow();
    expect(() => front.inboundAt(f, s.retSeries![0]!, 24 * 60)).toThrow(RangeError);
  });
});

/**
 * Le lecteur du front doit rendre EXACTEMENT ce que rend le lecteur de référence du contrat (bloc
 * `swod-reader`, lui-même testé contre le lecteur Python par pipeline/tests/test_od_export.py).
 */
describe.skipIf(!hasPartial)('lecteur du front = lecteur de référence du contrat (export partiel)', () => {
  it('mêmes séries et mêmes allers / retours sur un échantillon de fichiers', async () => {
    // Fins de ligne normalisées : le contrat peut être réenregistré en CRLF sous Windows
    const md = readFileSync(CONTRACT, 'utf-8').replace(/\r\n/g, '\n');
    const block = /<!-- swod-reader:begin -->\s*```ts\n([\s\S]*?)```\s*<!-- swod-reader:end -->/.exec(md)?.[1];
    expect(block, 'bloc swod-reader introuvable dans le contrat').toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), 'swod-ref-'));
    const refPath = join(dir, 'reference.ts');
    writeFileSync(refPath, block!);
    const ref = (await import(/* @vite-ignore */ pathToFileURL(refPath).href)) as typeof front;

    const files = readdirSync(join(PARTIAL, 'o')).filter((f) => f.endsWith('.bin')).sort();
    // échantillon régulier : premier, dernier et un fichier sur 30
    const sample = files.filter((_, i) => i % 30 === 0 || i === files.length - 1);
    const starts = [300, 360, 540, 840, 1315];
    const ends = [180, 840, 1020, 1320];
    for (const name of sample) {
      const bytes = toArrayBuffer(readFileSync(join(PARTIAL, 'o', name)));
      const a = await front.decodeSwodBytes(bytes.slice(0));
      const b = await ref.decodeSwodBytes(bytes.slice(0));
      expect(sameFile(a, b), name).toBe(true);
      const s = a.sections.get(0);
      if (name === sample[0] && s?.outSeries?.[0]) {
        // la comparaison n'est pas vide : une valeur modifiée la fait échouer
        const before = s.outSeries[0][0]!;
        b.sections.get(0)!.outSeries![0]![0] = before === 0 ? 1 : 0;
        expect(sameFile(a, b)).toBe(false);
        b.sections.get(0)!.outSeries![0]![0] = before;
      }
      if (!s) continue;
      for (let i = 0; i < s.dest.length; i += 17) {
        for (const st of starts) expect(front.outboundAt(a, s.outSeries![i]!, st, 120)).toEqual(ref.outboundAt(b, s.outSeries![i]!, st, 120));
        for (const e of ends) expect(front.inboundAt(a, s.retSeries![i]!, e)).toEqual(ref.inboundAt(b, s.retSeries![i]!, e));
      }
    }
  }, 60_000);
});
