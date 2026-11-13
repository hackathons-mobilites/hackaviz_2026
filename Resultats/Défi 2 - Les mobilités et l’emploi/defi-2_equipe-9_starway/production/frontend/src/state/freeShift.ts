/**
 * Horaires libres (D-019) dans la barre : disponibles ou non, et la phrase qui le dit. Fonction PURE.
 * Tout est lu dans l'index du dossier courant (`index.modes`, `coverage[mode].complete`) : un mode
 * exporté plus tard s'active seul, sans rien changer ici.
 */
import { odModeReady } from '../data/od/compute';
import type { OdIndex } from '../data/od/types';
import { frenchJoin, MODE_PHRASE } from '../data/labels';
import type { ModeId } from '../data/types';
import type { OdOffReason } from '../store/useOdStore';

export interface FreeShiftState {
  /** Les jauges « Début du poste » / « Fin du poste » répondent */
  enabled: boolean;
  /** Phrase sous les journées-types (null = rien à dire) */
  note: string | null;
}

/** Modes de l'index qui servent des horaires libres (dépendent de l'heure) et sont complets. */
export function timeModesReady(index: Pick<OdIndex, 'modes' | 'coverage'> | null | undefined): ModeId[] {
  if (!index) return [];
  return index.modes.filter((m) => m.kind === 'series' && odModeReady(index, m.id)).map((m) => m.id);
}

export function freeShiftState(input: {
  off: OdOffReason | null;
  index: Pick<OdIndex, 'modes' | 'coverage'> | null | undefined;
  hasBounds: boolean;
  mode: ModeId;
}): FreeShiftState {
  const { off, index, mode } = input;
  if (off === 'no_folder' || off === 'folder_absent') return { enabled: false, note: 'horaires libres : pas encore calculés pour ce réglage de marche' };
  if (off === 'folder_error') return { enabled: false, note: 'horaires libres indisponibles (données illisibles) : journées-types seulement' };
  if (!index || !input.hasBounds) return { enabled: false, note: null };
  const ready = timeModesReady(index);
  if (!odModeReady(index, mode)) {
    return {
      enabled: false,
      note: ready.length
        ? `horaires libres : ${frenchJoin(ready.map((m) => MODE_PHRASE[m] ?? m))} seulement pour l'instant`
        : 'horaires libres : pas encore calculés pour ce mode',
    };
  }
  const def = index.modes.find((m) => m.id === mode);
  // D-029 : la voiture avec trafic moyen dépend de l'horaire (indice de la tranche de l'aller et du retour)
  if (mode === 'car_traffic') return off === 'lock' ? { enabled: true, note: 'visite ou découverte : calculées aux journées-types' } : { enabled: true, note: null };
  if (def?.kind !== 'series') return { enabled: false, note: `${MODE_PHRASE[mode] ?? mode} : même temps à toute heure, l'horaire ne change rien` };
  if (off === 'lock') return { enabled: true, note: 'visite ou découverte : calculées aux journées-types' };
  return { enabled: true, note: null };
}
