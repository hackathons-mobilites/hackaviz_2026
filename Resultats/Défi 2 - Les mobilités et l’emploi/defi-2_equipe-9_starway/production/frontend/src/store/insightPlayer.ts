/**
 * Ouverture d'une découverte (L-03) : joue le plan pur de `insightPlan` (data/insights.ts) sur le
 * store réel. Chaque étape est un scénario complet ; entre deux étapes, le ciel finit sa transition
 * (waitForSky) puis reste calme `insightPlay.referenceHold` ms. Si l'utilisateur change de scénario
 * entre-temps, la suite est annulée (on ne lui reprend jamais la main).
 */
import { create } from 'zustand';
import { insightPlan, lateReturnFocus, type InsightStepScenario } from '../data/insights';
import type { Insight } from '../data/types';
import { buildSkyView } from '../state/skyView';
import { insightPlay } from '../theme/tokens';
import { waitForSky } from './skyBridge';
import { selectReducedMotion, useSkyStore } from './useSkyStore';

interface InsightChipState {
  /** Découverte ouverte (puce « Découverte · … · Revoir · Fermer ») ; null = aucune */
  active: Insight | null;
  setActive: (ins: Insight | null) => void;
}

export const useInsightChip = create<InsightChipState>()((set) => ({
  active: null,
  setActive: (active) => set({ active }),
}));

let playToken = 0;

const sameStep = (s: InsightStepScenario) => {
  const sc = useSkyStore.getState().scenario;
  // Les découvertes portent sur le réglage de marche par défaut (D-024) : un autre réglage efface la puce
  return (
    sc.origin === s.origin && sc.day === s.day && sc.budget === s.budget && sc.mode === s.mode && (sc.compare ?? null) === s.compare && !sc.walk
  );
};

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Le scénario affiché est-il encore celui de la découverte ? (sinon la puce disparaît) */
export function scenarioMatchesInsight(ins: Insight): boolean {
  const sc = ins.scenario;
  return sameStep({ origin: sc.o, day: sc.d, budget: sc.b, mode: sc.m, compare: sc.vs ?? null });
}

export async function openInsight(ins: Insight): Promise<void> {
  const token = ++playToken;
  const st0 = useSkyStore.getState();
  if (!st0.dataset) return;
  const meta = st0.dataset.meta;
  const dayLabel = (id: string) => meta.day_types.find((d) => d.id === id)?.label ?? id;
  const plan = insightPlan(ins, dayLabel, selectReducedMotion(st0));
  const { applyScenario } = st0;
  useInsightChip.getState().setActive(null);
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    if (i > 0) {
      await waitForSky();
      await wait(insightPlay.referenceHold);
      // l'utilisateur a changé de scénario pendant le calme : on s'arrête là
      if (token !== playToken || !sameStep(plan.steps[i - 1]!)) return;
    }
    await applyScenario({ ...step, pole: null, halo: null }, 'insight');
    if (token !== playToken) return;
  }
  useInsightChip.getState().setActive(ins);
  if (!plan.focusLateReturn) return;
  await waitForSky();
  const st = useSkyStore.getState();
  const last = plan.steps.at(-1)!;
  if (token !== playToken || !st.dataset || !sameStep(last) || st.scenario.pole) return;
  const view = buildSkyView(st.dataset, st.scenario, st.access, st.revealed);
  const id = view.neutral ? null : lateReturnFocus(view.dataset.poles, view.states);
  if (id) await applyScenario({ pole: id }, 'insight');
}
