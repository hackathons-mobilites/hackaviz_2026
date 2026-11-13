import { useNeedsMeta } from '../proof/useNeedsMeta';
import { useSubscriptionsStore } from './subscriptionsStore';
import { usePersonalSettingsAllowed } from './useEffectiveSubscriptions';
import { useSubscriptionsFile } from './useSubscriptionsFile';

/**
 * Lien « Mes réglages » de la barre du haut (à côté de « Sources & limites ») : il ouvre le même dialogue que l'entrée du
 * tiroir de la barre de scénario. Rien pendant la visite, ni si aucun des deux réglages n'est publié.
 */
export function SubscriptionsButton() {
  const file = useSubscriptionsFile();
  const needsMeta = useNeedsMeta();
  const open = useSubscriptionsStore((s) => s.openDialog);
  const allowed = usePersonalSettingsAllowed();
  if ((!file && !needsMeta) || !allowed) return null;
  return (
    <button type="button" className="link-btn top-sources subs-top" aria-haspopup="dialog" onClick={(e) => open(e.currentTarget)}>
      Mes réglages
    </button>
  );
}
