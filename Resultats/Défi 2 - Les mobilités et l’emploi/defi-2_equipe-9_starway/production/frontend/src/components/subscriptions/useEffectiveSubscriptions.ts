import { useSkyStore } from '../../store/useSkyStore';
import { isRecordMode } from '../../tour/recordSignal';
import { useSubscriptionsStore, type SubscriptionChoice } from './subscriptionsStore';

const NONE: SubscriptionChoice = { transit: null, velib: null };

/** Les réglages personnels existent-ils ici ? Non pendant la visite guidée ni l'enregistrement vidéo (`?record=1`). */
export function usePersonalSettingsAllowed(): boolean {
  const tourActive = useSkyStore((s) => s.tour.status !== 'idle');
  // `window` absent : rendu des tests, sans enregistrement possible
  return !tourActive && (typeof window === 'undefined' || !isRecordMode());
}

/**
 * Abonnements EN VIGUEUR : ceux du navigateur, sauf pendant la visite et l'enregistrement vidéo, qui jouent sans eux
 * (comme `useNeedsSelected`). Rien n'est effacé : le choix revient à la fin de la visite.
 */
export function useEffectiveSubscriptions(): SubscriptionChoice {
  const transit = useSubscriptionsStore((s) => s.transit);
  const velib = useSubscriptionsStore((s) => s.velib);
  return usePersonalSettingsAllowed() ? { transit, velib } : NONE;
}
