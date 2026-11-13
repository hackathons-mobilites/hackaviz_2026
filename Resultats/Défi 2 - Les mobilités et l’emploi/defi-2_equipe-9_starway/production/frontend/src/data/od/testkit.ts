/**
 * Outils de TEST seulement (jamais importés par l'application) : encodeur SWOD v1 minimal, miroir de
 * `starway.od_export.encode_runs` / `pack_file`, pour fabriquer de petits fichiers synthétiques.
 * Les valeurs des tests synthétiques sont arbitraires et ne sont jamais affichées.
 */
import type { OdIndex } from './types';

export type FixtureSection =
  | { mode: number; kind: 'series'; records: { dest: number; out: number[]; ret: number[] }[] }
  | { mode: number; kind: 'scalar'; records: { dest: number; out: number; ret: number }[] };

export interface FixtureFile {
  origin: number;
  step: number;
  first: number;
  nSlots: number;
  maxTrip: number;
  sections: FixtureSection[];
}

/** Plages de départs consécutifs de même arrivée (durée), ou de même sentinelle ; 255 départs au plus par plage. */
export function encodeRuns(series: readonly number[], step: number, maxTrip: number): number[] {
  const bytes: number[] = [];
  let k = 0;
  while (k < series.length) {
    const v = series[k]!;
    let L = 1;
    while (k + L < series.length && L < 255) {
      const next = series[k + L]!;
      const same = v <= maxTrip ? next <= maxTrip && next === v - step * L : next === v;
      if (!same) break;
      L++;
    }
    bytes.push(L, v);
    k += L;
  }
  return bytes;
}

export function buildSwod(f: FixtureFile, version: 1 | 2 = 1): ArrayBuffer {
  const out: number[] = [];
  const u16 = (n: number) => out.push(n & 0xff, (n >> 8) & 0xff);
  const u32 = (n: number, into: number[]) => into.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  out.push(...[...'SWOD'].map((c) => c.charCodeAt(0)), version, f.step);
  u16(f.first);
  u16(f.nSlots);
  u16(f.origin);
  out.push(f.sections.length, f.maxTrip, 0, 0);
  for (const s of f.sections) {
    const payload: number[] = [];
    for (const r of s.records) {
      payload.push(r.dest & 0xff, (r.dest >> 8) & 0xff);
      if (s.kind === 'scalar') {
        const rec = r as { out: number; ret: number };
        payload.push(rec.out, rec.ret);
      } else {
        const rec = r as { out: number[]; ret: number[] };
        for (const series of [rec.out, rec.ret]) {
          const runs = encodeRuns(series, f.step, f.maxTrip);
          const nRuns = runs.length / 2;
          // version 1 : nombre de plages sur 1 octet ; version 2 (D-040) : sur 2 octets
          if (version === 1) payload.push(nRuns, ...runs);
          else payload.push(nRuns & 0xff, (nRuns >> 8) & 0xff, ...runs);
        }
      }
    }
    out.push(s.mode, s.kind === 'series' ? 1 : 0);
    u16(s.records.length);
    u32(payload.length, out);
    out.push(...payload);
  }
  return new Uint8Array(out).buffer;
}

/** Index minimal cohérent pour les tests synthétiques (champs du contrat D-019). */
export function fixtureIndex(over: Partial<OdIndex> & Pick<OdIndex, 'communes' | 'jobs' | 'pole_of' | 'poles'>): OdIndex {
  return {
    processing_version: 'test',
    generated_at: 'test',
    dataset_id: 'test',
    service_date: 'test',
    complete: true,
    format: { name: 'SWOD', version: 1, path: 'o/{insee}.bin', endianness: 'little', compression: 'gzip' },
    grid: { first: '03:00', last: '22:00', step_min: 5, n_slots: 229 },
    starts: { first: '05:00', last: '22:05' },
    ends: { first: '03:00', last: '22:00' },
    outbound_lookback_min: 120,
    max_trip_min: 120,
    sentinels: { '253': 'not_computed', '254': 'origin_not_snapped', '255': 'no_trip_within_120' },
    modes: [
      { id: 'transit', code: 0, kind: 'series' },
      { id: 'walk', code: 1, kind: 'scalar' },
      { id: 'bike', code: 2, kind: 'scalar' },
      { id: 'car', code: 3, kind: 'scalar' },
    ],
    coverage: {},
    files: 'all',
    jobs_source: 'test',
    self_pair: { status: 'not_measured' },
    ...over,
  };
}
