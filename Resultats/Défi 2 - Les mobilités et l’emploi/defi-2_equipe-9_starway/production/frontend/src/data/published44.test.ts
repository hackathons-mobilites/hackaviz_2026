import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isItinerariesFile, itineraryOf, itinerariesSource, tripEntry, type ItinerariesFile } from './itineraries';
import { modeComputedFor } from './coverage';
import type { AccessFile, Meta, Pole } from './types';

/**
 * Données PUBLIÉES (racine de public/data = 44 astres) : ce test garde la publication alignée sur ce ciel
 * (meta.access_sky, ordre des pôles, détail des trajets).
 */
const url = (rel: string) => new URL(`../../public/data/${rel}`, import.meta.url);
const read = <T,>(rel: string): T => JSON.parse(readFileSync(url(rel), 'utf-8')) as T;
const readGz = <T,>(rel: string): T => JSON.parse(gunzipSync(readFileSync(url(rel))).toString('utf-8')) as T;
const published = existsSync(url('meta.json')) && existsSync(url('itineraries/78358.json.gz'));

describe.skipIf(!published)('fichiers calculés vers les 44 astres (racine de public/data)', () => {
  const meta = read<Meta>('meta.json');
  const poles = read<Pole[]>('poles.json');

  it('meta.access_sky dit 44 astres : le panneau lit access/ et itineraries/ par position', () => {
    expect(meta.access_sky?.sky).toBe('44');
    expect(meta.access_sky?.poles).toBe(44);
    expect(poles).toHaveLength(44);
  });

  it('access/ : une série par astre, dans l’ordre de poles.json', () => {
    const a = read<AccessFile>('access/78358.json');
    const s = a.modes.transit?.d09;
    expect(s?.out).toHaveLength(44);
    expect(s?.ret).toHaveLength(44);
  });

  it('itinéraires de Maisons-Laffitte en 9h-17h : lignes, ticket et carbone pour les astres atteints', () => {
    expect(itinerariesSource(meta, null)?.communes).toContain('78358');
    const f = readGz<ItinerariesFile>('itineraries/78358.json.gz');
    expect(isItinerariesFile(f)).toBe(true);
    expect(f.poles).toEqual(poles.map((p) => p.id));
    const trips = poles.map((p) => itineraryOf(f, p.id, 'd09', 'out')).filter((t) => !!t);
    expect(trips.length).toBeGreaterThan(10);
    for (const t of trips) {
      expect(t!.legs?.some((l) => l.m !== 'walk')).toBe(true);
      expect(t!.tickets).toBeDefined();
      expect(t!.co2_g).toBeDefined();
    }
    // jamais une valeur pour un sens sans détail : le statut et sa raison sont publiés
    const none = poles.map((p) => tripEntry(f, p.id, 'd09', 'out')).find((t) => t && t.status !== 'ok');
    expect(none?.status).toMatch(/^(no_trip_in_matrix|no_itinerary_found)$/);
  });

  it('le réglage confort a son détail d’itinéraire (05/11) : mêmes astres, même ordre, jamais une valeur sans statut', () => {
    const src = itinerariesSource(meta, 'comfort');
    expect(src?.dir).toBe('itineraries_walk1000');
    expect(src?.communes).toContain('78358');
    const f = readGz<ItinerariesFile>('itineraries_walk1000/78358.json.gz');
    expect(isItinerariesFile(f)).toBe(true);
    expect(f.poles).toEqual(poles.map((p) => p.id));
    const trips = poles.map((p) => itineraryOf(f, p.id, 'd09', 'out')).filter((t) => !!t);
    expect(trips.length).toBeGreaterThan(10);
    expect(meta.access_communes?.length).toBeGreaterThan(1000);
  });

  it('vélo + TC publié pour toutes les communes (flux du 06/11) : aucune liste partielle dans meta.mode_coverage', () => {
    // Un mode absent de mode_coverage est calculé pour toutes les communes de access/ (coverage.ts)
    expect(meta.mode_coverage?.bike_transit).toBeUndefined();
    expect(modeComputedFor(meta, 'bike_transit', '78358')).toBe(true);
    for (const insee of meta.access_communes ?? []) {
      if (!['78358', '78418'].includes(insee) && Number(insee) % 97 !== 0) continue; // échantillon fixe, sans choix à la main
      const f = read<AccessFile>(`access/${insee}.json`);
      expect(f.modes?.bike_transit, `${insee} : vélo + TC publié dans access/`).toBeTruthy();
    }
  });
});
