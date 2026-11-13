/**
 * Réglage « couleurs adaptées au daltonisme » au chargement (motion-spec, « Affichage ») : fonctions
 * pures, testées (`colorVision.test.ts`). Préférence personnelle : jamais écrite par state/url.ts.
 */
import { colorVision } from '../theme/tokens';

/**
 * `?cv=1` / `?cv=0` priment (pour la session, sans être mémorisés : un lien reçu ne change pas la
 * préférence enregistrée) ; `?record=1` (vidéo) : palette normale sauf `?cv=1` explicite ; sinon le
 * choix mémorisé (« on » / « off ») ; sinon `colorVision.defaultOn`.
 */
export function initialColorVision(search: string, stored: string | null): boolean {
  const q = new URLSearchParams(search);
  const param = q.get('cv');
  if (param === '1') return true;
  if (param === '0') return false;
  if (q.get('record') === '1') return false;
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return colorVision.defaultOn;
}

/**
 * Retire `cv` d'une chaîne de requête (la barre d'adresse, une fois le réglage lu) : « Copier le lien »
 * copie l'adresse affichée, qui ne doit pas imposer ma palette à la personne qui la reçoit.
 * Les autres paramètres restent dans leur ordre.
 */
export function withoutColorVisionParam(search: string): string {
  const q = new URLSearchParams(search);
  if (!q.has('cv')) return search;
  q.delete('cv');
  const s = q.toString();
  return s ? `?${s}` : '';
}
