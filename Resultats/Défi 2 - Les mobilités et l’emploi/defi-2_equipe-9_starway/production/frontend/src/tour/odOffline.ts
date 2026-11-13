/**
 * Table OD (D-019) lue HORS navigateur par la résolution de la visite et ses tests : fonction PURE qui rend, pour un
 * scénario, EXACTEMENT la table que `useSkyStore.applyScenario` (donc `prepareOd`) poserait dans `useOdStore.shown`,
 * avec les mêmes fonctions (`odBasis`, `effectiveShift`, `shiftBounds`), pour que le ciel et le compteur résolus ici
 * soient ceux que le site affiche pour le même scénario (décision de Nicolas du 06/11 : la visite dit les chiffres du
 * site). Aucun chiffre n'est calculé ici : `buildSkyView` appelle `computeOd` sur cette table, comme l'application.
 */
import { odBasis, effectiveShift } from '../store/odSync';
import type { OdShown, OdShownSide } from '../store/useOdStore';
import { shiftBounds } from '../data/od/shift';
import type { SwodFile } from '../data/od/swod';
import type { OdIndex } from '../data/od/types';
import type { Dataset } from '../data/types';
import type { Scenario } from '../state/scenario';

/** Index d'un dossier OD et lecture des fichiers d'origine (`o/{insee}.bin`), fournis par l'appelant (Node ou test). */
export interface OdOfflineSource {
  /** Chemin relatif à la racine du site (« data/od_walk3000/ ») */
  folder: string;
  index: OdIndex;
  /** Fichier décodé de l'origine ; null si absent */
  read: (insee: string) => SwodFile | null;
}

function sideOf(src: OdOfflineSource, insee: string): OdShownSide {
  const file = src.index.communes.includes(insee) ? src.read(insee) : null;
  return file ? { insee, status: 'ready', file, error: null } : { insee, status: 'not_computed', file: null, error: null };
}

/**
 * Table OD du scénario de la visite (jamais verrouillée : source `tour`, horaire de la journée-type, réglage de marche
 * par défaut) ; null quand le site n'afficherait pas la table OD (mode non servi comme le vélo + TC, ou pas de commune).
 */
export function offlineOdShown(dataset: Pick<Dataset, 'meta'>, scenario: Scenario, src: OdOfflineSource | null): OdShown | null {
  if (!src || !scenario.origin) return null;
  if (odBasis({ status: 'ready', index: src.index }, scenario.mode, false)) return null;
  const bounds = shiftBounds(src.index);
  const shift = bounds ? effectiveShift(bounds, { shift: null, day: scenario.day }, dataset) : null;
  if (!bounds || !shift) return null;
  return {
    folder: src.folder,
    index: src.index,
    bounds,
    shift,
    budget: scenario.budget,
    mode: scenario.mode,
    a: sideOf(src, scenario.origin),
    b: scenario.compare ? sideOf(src, scenario.compare) : null,
    congestion: dataset.meta.car_congestion ?? null,
  };
}
