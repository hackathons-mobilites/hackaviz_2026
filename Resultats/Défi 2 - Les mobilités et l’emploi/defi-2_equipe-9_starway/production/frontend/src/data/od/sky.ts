/**
 * Table OD (D-019) → états du ciel : fonctions PURES (sans DOM, React ni PixiJS).
 *
 * Le ciel garde ses astres, leurs positions et leurs tailles (aire ∝ postes du pôle). Ce module ne
 * change que ce que dit chaque astre : la PART de ses postes atteinte aller ET retour (communes du
 * pôle atteintes), et les totaux sur toute l'Île-de-France.
 */
import type { OdSkyTotals, PoleOdPart, PoleState, PoleStatus, SkyTotals } from '../accessibility';
import type { Pole } from '../types';
import type { OdDestState, OdResult } from './compute';

/** Statut d'un pôle à partir de sa part : allumé dès qu'un poste est atteint, sinon le pire constat mesuré. */
export function odPoleStatus(part: Pick<PoleOdPart, 'reached' | 'notReached' | 'outOnly'>): PoleStatus {
  if (part.reached > 0) return 'accessible';
  if (part.outOnly > 0) return 'out_only';
  if (part.notReached > 0) return 'none';
  // seulement des postes sans verdict (non calculés, ou commune d'origine) : rien n'est mesuré
  return 'unknown';
}

function fastestOut(communes: readonly OdDestState[]): number | null {
  let best: number | null = null;
  for (const d of communes) {
    if (d.status !== 'accessible' || d.out.minutes == null) continue;
    if (best == null || d.out.minutes < best) best = d.out.minutes;
  }
  return best;
}

/**
 * États des pôles (ordre de poles.json) depuis un résultat OD. Un résultat non calculable (origine
 * sans fichier, mode absent, horaire hors bornes) donne un ciel « non calculé » : jamais de zéro.
 */
export function odPoleStates(poles: readonly Pick<Pole, 'id'>[], result: OdResult): PoleState[] {
  return poles.map((pole, index) => {
    const s = result.status === 'ok' ? result.poles[index] : undefined;
    if (!s || s.id !== pole.id) {
      return { index, id: pole.id, status: 'unknown', out: null, ret: null, reason: 'not_computed' };
    }
    const od: PoleOdPart = {
      jobs: s.jobs,
      measurable: s.measurable,
      reached: s.reached,
      notReached: s.notReached,
      outOnly: s.outOnly,
      unknown: s.unknown,
      self: s.self,
      share: s.share,
      communes: s.communes.filter((d) => d.status !== 'self').length,
      reachedCommunes: s.communes.filter((d) => d.status === 'accessible').length,
      fastestOut: fastestOut(s.communes),
    };
    const status = odPoleStatus(od);
    return { index, id: pole.id, status, out: null, ret: null, reason: status === 'unknown' && s.unknown > 0 ? 'not_computed' : null, od };
  });
}

/** Totaux du ciel OD : pôles allumés (au moins un poste atteint), postes atteints dans les pôles et sur l'IDF. */
export function odSkyTotals(states: readonly PoleState[], result: OdResult): SkyTotals {
  const t = result.totals;
  const od: OdSkyTotals | undefined = t
    ? {
        reachedAll: t.reachedAll,
        allJobs: t.allJobs,
        measurableJobs: t.measurableJobs,
        selfJobs: t.selfJobs,
        unknownJobs: t.unknownJobs,
        reachedCommunes: t.reachedCommunes,
        communes: t.measurableCommunes,
      }
    : undefined;
  return {
    poleCount: states.length,
    accessibleCount: states.filter((s) => s.status === 'accessible').length,
    jobs: t ? t.reachedInPoles : null,
    totalJobs: t ? t.polesJobs : null,
    hasData: result.status === 'ok' && states.some((s) => s.status !== 'unknown'),
    ...(od ? { od } : {}),
  };
}

export interface ReachedCommune {
  insee: string;
  jobs: number;
  /** Index du pôle (poles.json) ou null hors pôle */
  pole: number | null;
  out: number | null;
  ret: number | null;
}

/** Communes atteintes aller ET retour, triées par postes décroissants (puis code INSEE). */
export function reachedCommunes(result: OdResult | null): ReachedCommune[] {
  if (!result || result.status !== 'ok') return [];
  return result.dests
    .filter((d) => d.status === 'accessible')
    .map((d) => ({ insee: d.insee, jobs: d.jobs, pole: d.pole, out: d.out.minutes, ret: d.ret.minutes }))
    .sort((a, b) => b.jobs - a.jobs || a.insee.localeCompare(b.insee));
}

/** État d'une commune pour la carte miroir : celui du résultat, ou null si la commune n'est pas une destination de l'index. */
export type MapCommuneKind = 'accessible' | 'out_only' | 'none' | 'unknown' | 'self';

export function mapCommuneKinds(result: OdResult | null): Map<string, MapCommuneKind> {
  const out = new Map<string, MapCommuneKind>();
  if (!result || result.status !== 'ok') return out;
  for (const d of result.dests) out.set(d.insee, d.status);
  return out;
}

/**
 * Fractions du contour d'un astre éclairé en partie (dans l'ordre du tracé, depuis midi, sens
 * horaire) : atteint (arc plein cyan), commune d'origine (creux), non calculé (points), le reste
 * (tirets). Somme = 1 ; toutes nulles si le pôle n'a aucun poste publié.
 */
export interface PartRing {
  reached: number;
  self: number;
  unknown: number;
  rest: number;
}

export function partRing(part: Pick<PoleOdPart, 'jobs' | 'reached' | 'self' | 'unknown'> | null | undefined): PartRing | null {
  if (!part || !(part.jobs > 0)) return null;
  const f = (v: number) => Math.min(1, Math.max(0, v / part.jobs));
  const reached = f(part.reached);
  const self = Math.min(1 - reached, f(part.self));
  const unknown = Math.min(1 - reached - self, f(part.unknown));
  return { reached, self, unknown, rest: Math.max(0, 1 - reached - self - unknown) };
}
