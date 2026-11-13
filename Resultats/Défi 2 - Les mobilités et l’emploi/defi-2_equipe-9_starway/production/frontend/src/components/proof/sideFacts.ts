/**
 * Faits d'un côté du panneau de preuve (une commune de départ) : dérivés de la vue du ciel et de
 * access/{insee}.json, sans React. Partagés par l'en-tête (badge) et le bloc « Temps de trajet ».
 */
import { getSeries } from '../../data/accessibility';
import { guardSeries } from '../../data/seriesGuard';
import { modeComputedFor } from '../../data/coverage';
import { outboundTimes, proofBadge, proofVerdict, returnTimes, type LegTimes, type ProofBadge, type ProofVerdict } from '../../data/proof';
import { missingAccessMessage } from '../../data/summary';
import type { AccessFile, ContextFile } from '../../data/types';
import type { SkyView } from '../../store/selectors';

export interface Side {
  view: SkyView;
  access: AccessFile | null | undefined;
  ctx: ContextFile | null | undefined;
}

export interface SideFacts {
  /** Durées dépendantes de l'heure (TC, vélo + TC) : départ et heures citables */
  timeDependent: boolean;
  outT: LegTimes;
  retT: LegTimes;
  verdict: ProofVerdict;
  badge: ProofBadge;
  /** Pas de durée à montrer : message mesuré (fichier absent, hors zone Vélib', réglage non calculé) */
  missing: string | null;
}

export function sideFacts(side: Side): SideFacts {
  const { view, access } = side;
  const state = view.selectedState!;
  const { scenario, dataset } = view;
  const day = dataset.meta.day_types.find((d) => d.id === scenario.day);
  const index = dataset.poles.findIndex((p) => p.id === view.selectedPole?.id);
  // Réglage de marche D-024 : mêmes séries que le ciel (`variants.{key}` hors défaut)
  // Séries lues par position : une série d'un autre découpage ne s'applique pas aux astres affichés (D-030) : jamais l'heure de départ d'un autre astre
  const found = getSeries(access, scenario.mode, scenario.day, view.walkSetting?.key);
  // Garde de longueur (arbitrage du 05/11) : une série de longueur différente de celle des astres affichés est refusée
  const series = guardSeries(dataset.poles.length, found);
  const misaligned = !!found && !series;
  const timeDependent = !misaligned && !!access?.modes?.[scenario.mode]?.[scenario.day];
  const outT = outboundTimes(timeDependent ? series?.dep?.[index] : null, state.out);
  const retT = timeDependent && day ? returnTimes(day.end, state.ret) : { depart: null, arrive: null };
  const verdict = proofVerdict(state, scenario.budget, dataset.meta.max_trip_min, timeDependent, view.walkSetting?.leg_limit_m ?? null);
  // Pas de résultat : la raison publiée (hors zone Vélib', réglage de marche absent), sinon le texte général
  const velibOut =
    scenario.mode === 'velib' && !modeComputedFor(dataset.meta, 'velib', view.origin?.insee ?? null) ? dataset.meta.velib?.out_of_zone : null;
  let missing: string | null = null;
  if (view.accessMissing) missing = missingAccessMessage(dataset.meta.access_communes);
  else if (verdict.kind === 'unknown') missing = velibOut ? `${velibOut}.` : view.walkMissing ? 'Réglage de marche non encore calculé pour cette commune.' : verdict.detail;
  const badge: ProofBadge = view.accessMissing ? { kind: 'unknown', text: 'Non calculé' } : proofBadge(verdict, scenario.budget);
  return { timeDependent, outT, retT, verdict, badge, missing };
}
