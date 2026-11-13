/**
 * Contrôle de l'affichage : lecture des fichiers PUBLIÉS sur le site visé (`/data/...`). Aucun fichier local n'est lu : ce sont ceux que
 * le navigateur reçoit. Décodage SWOD réécrit depuis le contrat (`contrats-donnees.md`, section « od/o/{insee}.bin ») : indépendant
 * du lecteur du front.
 */
import { gunzipSync } from 'node:zlib';

const RAISONS = { 253: 'not_computed', 254: 'origin_not_snapped', 255: 'no_trip_within_120' };

/** Décode un fichier SWOD v1 ou v2 (contrat D-019 / D-040). */
export function decodeSwod(buffer) {
  const u8 = new Uint8Array(buffer);
  const v = new DataView(buffer);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'SWOD' || (u8[4] !== 1 && u8[4] !== 2)) throw new Error(`fichier SWOD invalide (${magic}, version ${u8[4]})`);
  const version = u8[4];
  const step = u8[5];
  const first = v.getUint16(6, true);
  const nSlots = v.getUint16(8, true);
  const origin = v.getUint16(10, true);
  const nSec = u8[12];
  const maxTrip = u8[13];
  const sections = new Map();
  let p = 16;
  for (let s = 0; s < nSec; s++) {
    const mode = u8[p];
    const kind = u8[p + 1];
    const n = v.getUint16(p + 2, true);
    const len = v.getUint32(p + 4, true);
    p += 8;
    const end = p + len;
    if (kind === 0) {
      const records = new Map();
      for (let i = 0; i < n; i++, p += 4) records.set(v.getUint16(p, true), { out: u8[p + 2], ret: u8[p + 3] });
      sections.set(mode, { kind: 'scalaire', records });
    } else {
      const records = new Map();
      for (let i = 0; i < n; i++) {
        const dest = v.getUint16(p, true);
        p += 2;
        const decode = () => {
          let nRuns;
          if (version === 1) nRuns = u8[p++];
          else {
            nRuns = v.getUint16(p, true);
            p += 2;
          }
          const serie = new Uint8Array(nSlots);
          let k = 0;
          for (let r = 0; r < nRuns; r++, p += 2) {
            const L = u8[p];
            const val = u8[p + 1];
            for (let j = 0; j < L; j++) serie[k++] = val <= maxTrip ? val - step * j : val;
          }
          if (k !== nSlots) throw new Error(`série de ${k} départs au lieu de ${nSlots}`);
          return serie;
        };
        const out = decode();
        const ret = decode();
        records.set(dest, { out, ret });
      }
      sections.set(mode, { kind: 'serie', records });
    }
    if (p !== end) throw new Error('longueur de section incohérente');
  }
  return { step, first, nSlots, origin, maxTrip, sections };
}

/** Sens aller d'une série : départ le plus tardif de [S - lookback, S - pas] qui arrive au plus tard à S. */
export function allerSerie(f, serie, S, lookback) {
  const lo = (S - lookback - f.first) / f.step;
  const hi = (S - f.step - f.first) / f.step;
  if (!Number.isInteger(lo) || lo < 0 || !Number.isInteger(hi) || hi >= f.nSlots) return { minutes: null, reason: 'not_computed', dep: null };
  for (let k = hi; k >= lo; k--) {
    const val = serie[k];
    const dep = f.first + k * f.step;
    if (val <= f.maxTrip && dep + val <= S) return { minutes: val, reason: null, dep };
  }
  for (const sentinel of [253, 254]) {
    let tous = true;
    for (let k = lo; k <= hi && tous; k++) tous = serie[k] === sentinel;
    if (tous) return { minutes: null, reason: RAISONS[sentinel], dep: null };
  }
  return { minutes: null, reason: 'no_trip_within_120', dep: null };
}

export function retourSerie(f, serie, E) {
  const k = (E - f.first) / f.step;
  if (!Number.isInteger(k) || k < 0 || k >= f.nSlots) return { minutes: null, reason: 'not_computed' };
  const val = serie[k];
  return val <= f.maxTrip ? { minutes: val, reason: null } : { minutes: null, reason: RAISONS[val] ?? 'no_trip_within_120' };
}

export function scalaire(f, val) {
  return val <= f.maxTrip ? { minutes: val, reason: null } : { minutes: null, reason: RAISONS[val] ?? 'no_trip_within_120' };
}

const TAILLE_CACHE = 40;

export class Donnees {
  constructor(base) {
    this.base = base;
    this.cache = new Map();
    this.requetes = 0;
  }

  async #octets(chemin) {
    for (let essai = 1; ; essai++) {
      this.requetes += 1;
      try {
        const r = await fetch(`${this.base}/data/${chemin}`, { signal: AbortSignal.timeout(60000) });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // `vite preview` répond la page de l'application (200, HTML) pour un fichier absent : c'est un fichier manquant
        if ((r.headers.get('content-type') ?? '').includes('text/html')) return null;
        return new Uint8Array(await r.arrayBuffer());
      } catch (e) {
        if (essai >= 4) throw new Error(`${chemin} : ${e.message}`, { cause: e });
        await new Promise((res) => setTimeout(res, 1000 * essai));
      }
    }
  }

  #garder(cle, valeur) {
    this.cache.set(cle, valeur);
    if (this.cache.size > TAILLE_CACHE) {
      for (const k of this.cache.keys()) {
        if (k.startsWith('v:')) continue;
        this.cache.delete(k);
        if (this.cache.size <= TAILLE_CACHE) break;
      }
    }
    return valeur;
  }

  /** Fichier JSON, ou null s'il n'existe pas. `garde` : fichier conservé (meta, poles...). */
  async json(chemin, garde = false) {
    const cle = `${garde ? 'v:' : ''}${chemin}`;
    if (this.cache.has(cle)) return this.cache.get(cle);
    const bytes = await this.#octets(chemin);
    return this.#garder(cle, bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null);
  }

  /** JSON compressé en gzip (itinéraires, alternatifs). */
  async jsonGz(chemin) {
    if (this.cache.has(chemin)) return this.cache.get(chemin);
    const bytes = await this.#octets(chemin);
    if (!bytes) return this.#garder(chemin, null);
    const texte = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('utf8') : new TextDecoder().decode(bytes);
    return this.#garder(chemin, JSON.parse(texte));
  }

  async swod(dir, insee) {
    const cle = `swod:${dir}:${insee}`;
    if (this.cache.has(cle)) return this.cache.get(cle);
    const bytes = await this.#octets(`${dir}/o/${insee}.bin`);
    if (!bytes) return this.#garder(cle, null);
    const copie = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
    const ab = copie.buffer.slice(copie.byteOffset, copie.byteOffset + copie.byteLength);
    return this.#garder(cle, decodeSwod(ab));
  }
}
