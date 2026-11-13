import type { SubscriptionsFile, TransitOption } from '../../data/subscriptions';
import { useEffectiveSubscriptions } from './useEffectiveSubscriptions';
import { useSubscriptionsFile } from './useSubscriptionsFile';

/** Abonnement TC en vigueur (aucun pendant la visite) et fichier publié. */
export function useTransitChoice(): { file: SubscriptionsFile | null; option: TransitOption | null; unknownId: boolean } {
  const file = useSubscriptionsFile() ?? null;
  const { transit: transitId } = useEffectiveSubscriptions();
  const option = file && transitId ? file.transit.options.find((o) => o.id === transitId) ?? null : null;
  return { file, option, unknownId: !!file && !!transitId && !option };
}
