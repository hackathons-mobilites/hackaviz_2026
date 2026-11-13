import { useEffect, useState } from 'react';
import type { ItinerariesFile } from '../../data/itineraries';
import { loadItineraries } from '../../data/loaders';
import { useSkyStore } from '../../store/useSkyStore';

/**
 * Itinéraires détaillés (D-028) de la commune pour le réglage de marche `walkKey` (null = défaut,
 * `itineraries/` ; « comfort » : `meta.itineraries_variants.comfort`, 04/11), chargés à la demande quand
 * `enabled` (TC, journée-type, hors diptyque, commune annoncée pour ce réglage ; en commune par commune
 * aussi, comme exemple de trajet vers l'arrêt d'ancrage). null sinon : les blocs « Transports utilisés »,
 * coût au ticket et carbone sont alors remplacés par une phrase (ProofPanel).
 */
export function useItineraries(insee: string | null | undefined, enabled: boolean, walkKey: string | null = null): ItinerariesFile | null {
  const dataset = useSkyStore((s) => s.dataset);
  const [loaded, setLoaded] = useState<{ key: string; file: ItinerariesFile | null } | null>(null);
  const key = `${walkKey ?? ''}|${insee ?? ''}`;
  useEffect(() => {
    if (!dataset || !insee || !enabled) return;
    let alive = true;
    void loadItineraries(dataset, insee, fetch, walkKey).then((file) => {
      if (alive) setLoaded({ key, file });
    });
    return () => {
      alive = false;
    };
  }, [dataset, insee, enabled, walkKey, key]);
  return enabled && loaded && loaded.key === key ? loaded.file : null;
}
