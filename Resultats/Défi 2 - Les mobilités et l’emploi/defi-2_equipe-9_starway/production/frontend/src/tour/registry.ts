/** Visites disponibles (identifiant → script). `lea` : version complète ; `lea-video` : version courte, aussi filmée par `?tour=lea-video&record=1` (voir `versions.ts`). */
import { lea, leaVideo } from './tours/lea.tour';
import type { TourScript } from './types';

export const TOURS: Record<string, TourScript> = { [lea.id]: lea, [leaVideo.id]: leaVideo };
