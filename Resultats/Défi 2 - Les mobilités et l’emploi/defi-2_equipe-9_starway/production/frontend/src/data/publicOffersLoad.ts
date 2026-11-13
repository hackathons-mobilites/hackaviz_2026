import type { Dataset } from './types';
import { fetchJson } from './loaders';
import { isPublicOffersFile, isPublicOffersList, type PublicOffersFile, type PublicOffersList } from './publicOffers';

const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

let countsPromise: Promise<PublicOffersFile | null> | null = null;
let listPromise: Promise<PublicOffersList | null> | null = null;

/** service_public.json (D-036, offres diffusées sur Choisir le service public), chargé une fois quand la case « Service public » est cochée ; null sans fichier valide. */
export function loadPublicOffers(dataset: Pick<Dataset, 'origin'>, fetcher: typeof fetch = fetch): Promise<PublicOffersFile | null> {
  if (dataset.origin === 'demo') return Promise.resolve(null);
  if (!countsPromise) countsPromise = fetchJson<unknown>(`${DATA_BASE}service_public.json`, fetcher).then((f) => (isPublicOffersFile(f) ? f : null));
  return countsPromise;
}

/** Liste des offres (service_public_offres.json, plus lourde), chargée à l'ouverture du pli « Voir les offres » ; null sans fichier valide. */
export function loadPublicOffersList(file: Pick<PublicOffersFile, 'offers_file'>, fetcher: typeof fetch = fetch): Promise<PublicOffersList | null> {
  if (!listPromise) listPromise = fetchJson<unknown>(`${DATA_BASE}${file.offers_file}`, fetcher).then((f) => (isPublicOffersList(f) ? f : null));
  return listPromise;
}
