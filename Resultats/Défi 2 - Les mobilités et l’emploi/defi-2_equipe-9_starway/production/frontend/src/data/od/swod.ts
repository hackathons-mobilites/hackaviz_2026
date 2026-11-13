/**
 * Lecteur SWOD v1 et v2 (D-019, D-040), sans dépendance.
 *
 * Copie du lecteur de référence du contrat (contrats-donnees.md, bloc `swod-reader`), adaptée au seul
 * réglage `noUncheckedIndexedAccess` du front (assertions `!` sur les lectures d'octets) et à
 * l'annulation (`fetchSwod(url, init)`). `swod.test.ts` vérifie que les deux lecteurs rendent
 * exactement la même chose sur l'export partiel : toute modification de la logique doit le garder vert.
 * Version 2 : le nombre de plages d'une série est sur 2 octets (une série de 288 départs peut en avoir plus de 255).
 */
export type OdReason = 'no_trip_within_120' | 'origin_not_snapped' | 'not_computed';
export interface OdLeg {
  minutes: number | null;
  reason: OdReason | null;
  /** Aller seulement : départ retenu, minutes depuis minuit */
  dep?: number | null;
}
export interface SwodSection {
  mode: number; // index.modes[].code
  kind: 'series' | 'scalar';
  dest: Uint16Array; // index dans index.communes, croissants
  out?: Uint8Array;
  ret?: Uint8Array; // scalaire : minutes ou sentinelle
  outSeries?: Uint8Array[];
  retSeries?: Uint8Array[]; // série : valeur au départ k = first + k * step
}
export interface SwodFile {
  origin: number;
  step: number;
  first: number;
  nSlots: number;
  maxTrip: number;
  sections: Map<number, SwodSection>;
}
const REASONS: Record<number, OdReason> = { 253: 'not_computed', 254: 'origin_not_snapped', 255: 'no_trip_within_120' };
/** Versions du format lues : 1 (nombre de plages sur 1 octet) et 2 (sur 2 octets, D-040). */
export const SWOD_VERSIONS: readonly number[] = [1, 2];

/** Premiers octets gzip (1f 8b) : décompression native, sinon lecture directe (serveur qui a déjà décodé). */
export function isGzip(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  return b.length === 2 && b[0] === 0x1f && b[1] === 0x8b;
}

export async function decodeSwodBytes(buf: ArrayBuffer): Promise<SwodFile> {
  if (isGzip(buf)) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = await new Response(stream).arrayBuffer();
  }
  return parseSwod(buf);
}

export async function fetchSwod(url: string, init?: RequestInit): Promise<SwodFile> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return decodeSwodBytes(await res.arrayBuffer());
}

export function parseSwod(buf: ArrayBuffer): SwodFile {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (u8.length < 16) throw new Error('fichier SWOD invalide (trop court)');
  const magic = String.fromCharCode(u8[0]!, u8[1]!, u8[2]!, u8[3]!);
  if (magic !== 'SWOD' || (u8[4] !== 1 && u8[4] !== 2)) throw new Error(`fichier SWOD invalide (${magic}, version ${u8[4]})`);
  const version = u8[4]!;
  const step = u8[5]!,
    first = v.getUint16(6, true),
    nSlots = v.getUint16(8, true),
    origin = v.getUint16(10, true);
  const nSec = u8[12]!,
    maxTrip = u8[13]!;
  const sections = new Map<number, SwodSection>();
  let p = 16;
  for (let s = 0; s < nSec; s++) {
    const mode = u8[p]!,
      kind = u8[p + 1]!,
      n = v.getUint16(p + 2, true),
      len = v.getUint32(p + 4, true);
    p += 8;
    const end = p + len;
    const dest = new Uint16Array(n);
    if (kind === 0) {
      const out = new Uint8Array(n),
        ret = new Uint8Array(n);
      for (let i = 0; i < n; i++, p += 4) {
        dest[i] = v.getUint16(p, true);
        out[i] = u8[p + 2]!;
        ret[i] = u8[p + 3]!;
      }
      sections.set(mode, { mode, kind: 'scalar', dest, out, ret });
    } else {
      const outSeries: Uint8Array[] = [],
        retSeries: Uint8Array[] = [];
      for (let i = 0; i < n; i++) {
        dest[i] = v.getUint16(p, true);
        p += 2;
        for (const target of [outSeries, retSeries]) {
          let nRuns: number;
          if (version === 1) nRuns = u8[p++]!;
          else {
            nRuns = v.getUint16(p, true);
            p += 2;
          }
          const series = new Uint8Array(nSlots);
          let k = 0;
          for (let r = 0; r < nRuns; r++, p += 2) {
            const L = u8[p]!,
              val = u8[p + 1]!;
            for (let j = 0; j < L; j++) series[k++] = val <= maxTrip ? val - step * j : val;
          }
          if (k !== nSlots) throw new Error(`série de ${k} départs au lieu de ${nSlots}`);
          target.push(series);
        }
      }
      sections.set(mode, { mode, kind: 'series', dest, outSeries, retSeries });
    }
    if (p !== end) throw new Error('longueur de section incohérente');
  }
  if (p !== buf.byteLength) throw new Error('octets en trop en fin de fichier');
  return { origin, step, first, nSlots, maxTrip, sections };
}

/** Aller pour un début de poste `start` (minutes depuis minuit) : départ le plus tardif qui arrive à l'heure. */
export function outboundAt(f: SwodFile, series: Uint8Array, start: number, lookback: number): OdLeg {
  const lo = (start - lookback - f.first) / f.step,
    hi = (start - f.step - f.first) / f.step;
  if (!Number.isInteger(lo) || lo < 0 || hi >= f.nSlots) throw new RangeError(`début de poste ${start} hors plage`);
  for (let k = hi; k >= lo; k--) {
    const val = series[k]!,
      dep = f.first + k * f.step;
    if (val <= f.maxTrip && dep + val <= start) return { minutes: val, reason: null, dep };
  }
  for (const sentinel of [253, 254]) {
    let all = true;
    for (let k = lo; k <= hi && all; k++) all = series[k] === sentinel;
    if (all) return { minutes: null, reason: REASONS[sentinel]!, dep: null };
  }
  return { minutes: null, reason: 'no_trip_within_120', dep: null };
}

/** Retour pour une fin de poste `end` : la durée au départ `end` de la série retour. */
export function inboundAt(f: SwodFile, series: Uint8Array, end: number): OdLeg {
  const k = (end - f.first) / f.step;
  if (!Number.isInteger(k) || k < 0 || k >= f.nSlots) throw new RangeError(`fin de poste ${end} hors grille`);
  const val = series[k]!;
  return val <= f.maxTrip ? { minutes: val, reason: null } : { minutes: null, reason: REASONS[val] ?? 'no_trip_within_120' };
}

/** Durée d'un mode sans horaire (section scalaire). */
export function scalarLeg(f: SwodFile, val: number): OdLeg {
  return val <= f.maxTrip ? { minutes: val, reason: null } : { minutes: null, reason: REASONS[val] ?? 'no_trip_within_120' };
}
