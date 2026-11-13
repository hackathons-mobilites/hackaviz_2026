/**
 * Lecture des fichiers de public/data/ HORS navigateur (npm run tour:resolve et tests de la visite).
 * Même règle que `loadItineraries` : les itinéraires sont publiés en `{insee}.json.gz` (gzip, 04/11) quand
 * `meta.itineraries_format.suffix` le dit, en `{insee}.json` sinon. Placé dans scripts/ (typé pour Node) :
 * il ne fait jamais partie du bundle du site.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ItinerariesFile } from '../src/data/itineraries';
import { odFolderFor } from '../src/data/od/folders';
import { parseSwod, type SwodFile } from '../src/data/od/swod';
import type { OdIndex } from '../src/data/od/types';
import type { Meta } from '../src/data/types';
import type { OdOfflineSource } from '../src/tour/odOffline';

/** Chemin (relatif à public/data) du fichier d'itinéraires d'une commune, selon le format annoncé par meta.json. */
export function itinerariesRelPath(meta: Pick<Meta, 'itineraries_format'> | null | undefined, insee: string): string {
  return `itineraries/${insee}${meta?.itineraries_format?.suffix ?? '.json'}`;
}

/** Lit un fichier d'itinéraires (gzip ou non, détecté sur les deux premiers octets) ; null s'il n'existe pas. */
export function readItinerariesFile(dataRoot: string, meta: Pick<Meta, 'itineraries_format'> | null | undefined, insee: string): ItinerariesFile | null {
  const path = join(dataRoot, itinerariesRelPath(meta, insee));
  if (!existsSync(path)) return null;
  let buf = readFileSync(path);
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return JSON.parse(buf.toString('utf-8')) as ItinerariesFile;
}

/**
 * Table OD (D-019) du ciel par défaut, lue sur le disque comme le site la charge (même dossier : `odFolderFor`, réglage
 * de marche par défaut, 44 astres ; index et fichiers `o/{insee}.bin`, gzip ou non). `publicRoot` = dossier `public/`.
 * null si le dossier n'est pas publié : la visite ne peut alors pas dire les chiffres du site (jamais d'autre base).
 */
export function readOdOffline(publicRoot: string, meta: Pick<Meta, 'walk_settings'>): OdOfflineSource | null {
  const folder = odFolderFor(meta, null);
  if (!folder) return null;
  const indexPath = join(publicRoot, folder.path, 'index.json');
  if (!existsSync(indexPath)) return null;
  const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as OdIndex;
  const binDir = join(publicRoot, folder.binPath ?? folder.path, 'o');
  const cache = new Map<string, SwodFile | null>();
  return {
    folder: folder.path,
    index,
    read: (insee) => {
      if (!cache.has(insee)) {
        const p = join(binDir, `${insee}.bin`);
        if (!existsSync(p)) cache.set(insee, null);
        else {
          let raw = readFileSync(p);
          if (raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b) raw = gunzipSync(raw);
          cache.set(insee, parseSwod(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer));
        }
      }
      return cache.get(insee) ?? null;
    },
  };
}
