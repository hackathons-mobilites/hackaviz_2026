/**
 * Site mis à jour pendant qu'une page ancienne est ouverte (retour de Sara, 05/11, point 4.3 : page blanche
 * sur « Comparer » après la mise en ligne de 14h05).
 *
 * Cause probable : chaque mise en ligne remplace les fichiers JS à nom haché ; une page restée ouverte
 * demande au clic (Comparer, carte, liste du ciel) un fichier qui n'existe plus, l'import dynamique échoue et,
 * sans limite d'erreur, React démonte toute l'application. Ici : un module PUR (sans React) qui reconnaît ces
 * échecs de chargement et un petit état « le site a changé », lu par `AppErrorBoundary`.
 *
 * AUCUN rechargement automatique : la personne garde la main, un bouton recharge la page (un rechargement
 * automatique pourrait boucler si le fichier manque réellement).
 */

/** Message affiché, mot pour mot (consigne de Nicolas du 05/11). */
export const BUNDLE_UPDATED_MESSAGE = "Le site vient d'être mis à jour. Rechargez la page.";
/** Texte du bouton de la limite d'erreur */
export const BUNDLE_RELOAD_LABEL = 'Recharger la page';

/** Messages des navigateurs quand un module chargé à la demande est introuvable ou illisible. */
const DYNAMIC_IMPORT_FAILURES: readonly RegExp[] = [
  /failed to fetch dynamically imported module/i, // Chrome, Edge
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /failed to load module script/i, // type MIME inattendu (page HTML à la place du module)
  /unable to preload css/i, // Vite : feuille de style d'un chunk
  /loading (css )?chunk [\w-]+ failed/i, // webpack, en repli
];

/** `error` ressemble-t-il à l'échec de chargement d'un module dynamique (`import()`) ? */
export function isDynamicImportFailure(error: unknown): boolean {
  if (error == null) return false;
  const text =
    typeof error === 'string'
      ? error
      : typeof error === 'object'
        ? `${(error as { name?: unknown }).name ?? ''} ${(error as { message?: unknown }).message ?? ''}`
        : '';
  if (/^ChunkLoadError\b/.test(text)) return true;
  return DYNAMIC_IMPORT_FAILURES.some((re) => re.test(text));
}

/* ------------------------------------------------------------------ état partagé (sans React) */

let stale = false;
const listeners = new Set<() => void>();

/** Le site a changé sous cette page : l'affichage propose de recharger. Idempotent. */
export function markBundleStale(): void {
  if (stale) return;
  stale = true;
  listeners.forEach((l) => l());
}

export function isBundleStale(): boolean {
  return stale;
}

export function subscribeBundleStale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Texte des autres erreurs (aucun détail technique affiché) */
export const UNEXPECTED_ERROR_MESSAGE = "Une erreur a interrompu l'affichage. Rechargez la page.";

/** État de la limite d'erreur : `stale` = l'erreur est un échec de chargement de module (site mis à jour). */
export interface BoundaryState {
  failed: boolean;
  stale: boolean;
}

/** Ce que la limite fait d'une erreur de rendu : l'échec d'un import dynamique dit « site mis à jour ». */
export function stateFromError(error: unknown): BoundaryState {
  const stale = isDynamicImportFailure(error);
  if (stale) markBundleStale();
  return { failed: true, stale };
}

/** Pour les tests uniquement : remet l'état à zéro. */
export function resetBundleStaleForTests(): void {
  stale = false;
  listeners.clear();
}

/** Cible minimale (window en production, EventTarget dans les tests). */
export type GuardTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Écoute les échecs de chargement de modules dynamiques :
 *  - `vite:preloadError` (Vite : préchargement d'un chunk ou de son CSS en échec). On ne supprime PAS l'erreur
 *    (pas de preventDefault) : elle remonte jusqu'à la limite d'erreur, qui affiche le message ;
 *  - `unhandledrejection` : un `import()` en échec hors du rendu React (effet, gestionnaire d'événement).
 * Renvoie la fonction qui retire les écouteurs.
 */
export function installBundleUpdateGuard(target: GuardTarget = window): () => void {
  const onPreload = () => markBundleStale();
  const onRejection = (event: Event) => {
    if (isDynamicImportFailure((event as { reason?: unknown }).reason)) markBundleStale();
  };
  target.addEventListener('vite:preloadError', onPreload);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('vite:preloadError', onPreload);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
