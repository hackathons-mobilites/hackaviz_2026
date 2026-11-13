/**
 * Liens externes. Le dépôt se fait dans celui des organisateurs, dossier `defi-2_starway/` : `production/` y contient la copie
 * publique du code et de la documentation (tools/depot/preparer_copie_publique.py). Les liens vers la méthode pointent donc
 * vers ce dossier ; ils ne fonctionnent qu'une fois le dossier déposé.
 */
export const REPO_URL: string = 'https://github.com/hackathons-mobilites/hackaviz_2026';

/** Dossier de l'équipe dans le dépôt des organisateurs (l'apostrophe est typographique, U+2019). */
export const DEPOT_DIR: string = 'Resultats/D\u00e9fi 2 - Les mobilit\u00e9s et l\u2019emploi/defi-2_starway';

const encodePath = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

/** Lien vers un fichier de la copie publique (`production/` du dossier de l'équipe), ou null si REPO_URL est vide. */
export function repoFile(path: string, branch = 'main'): string | null {
  return REPO_URL ? `${REPO_URL.replace(/\/$/, '')}/blob/${branch}/${encodePath(DEPOT_DIR)}/production/${encodePath(path)}` : null;
}