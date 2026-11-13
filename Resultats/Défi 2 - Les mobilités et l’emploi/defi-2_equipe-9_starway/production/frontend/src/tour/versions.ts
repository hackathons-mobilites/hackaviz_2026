/**
 * Les deux versions de la visite proposées au clic sur « Lancer la visite » : même application, mêmes états, mêmes
 * chiffres (`lea.tour.ts` les construit ensemble) ; seuls les mots et le nombre d'étapes changent. Module PUR.
 */
import { TOUR_COPY } from './microcopy';
import { lea, leaVideo } from './tours/lea.tour';
import type { TourScript } from './types';

export interface TourVersion {
  script: TourScript;
  label: string;
  note: string;
}

export const TOUR_VERSIONS: readonly TourVersion[] = [
  { script: leaVideo, label: TOUR_COPY.versionShort, note: TOUR_COPY.versionShortNote },
  { script: lea, label: TOUR_COPY.versionFull, note: TOUR_COPY.versionFullNote },
];

/** Paramètre d'adresse de la version (`?visite=1&tour=lea-video`, `?tour=lea-video&record=1`) */
export const TOUR_ID_PARAM = 'tour';

export const tourVersion = (id: string | null | undefined): TourVersion | undefined => TOUR_VERSIONS.find((v) => v.script.id === id);

/** Version lancée par `?visite=1` : celle de `tour=<id>`, sinon la version complète (comportement historique de `?visite=1`). */
export function resumeScript(query: URLSearchParams): TourScript {
  return tourVersion(query.get(TOUR_ID_PARAM))?.script ?? lea;
}
