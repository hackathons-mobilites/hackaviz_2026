/**
 * Dossier de la table D-019 selon le réglage de marche (D-024) : fonctions PURES.
 *
 * Contrat « Variantes de marche D-024 » : un dossier par réglage, `od_walk{L}/` où L est la limite
 * de marche publiée du réglage (`meta.walk_settings.settings[].leg_limit_m`) : « normal » 3 000 m →
 * `od_walk3000/`, « confort » 1 000 m → `od_walk1000/`. Le nom est DÉRIVÉ de la distance publiée,
 * jamais écrit ici, et le réglage est revérifié au chargement dans `index.walk_setting.id` (le front
 * lit le réglage dans l'index, jamais dans le nom du dossier). Aucun repli silencieux sur `od/`.
 */
import type { Meta } from '../types';
import { sanitizeWalk, walkSettingsMeta } from '../walkSettings';
import type { OdIndex } from './types';

export interface OdFolder {
  /** Chemin relatif à la racine du site, avec la barre finale (« data/od_walk3000/ ») */
  path: string;
  /** Réglage attendu dans `index.walk_setting.id` */
  settingId: string;
  /** Dossier des fichiers `o/{insee}.bin` s'il diffère de `path` (aperçu D-030 : ceux du jeu publié, inchangés) */
  binPath?: string;
}

/**
 * Dossier OD du réglage choisi (`w`, sinon le défaut). Le dossier ne dépend pas du mode : marche,
 * vélo et voiture sont identiques dans les deux dossiers (copiés par 06d), seul le TC change.
 * null si meta ne publie pas de réglage lisible (aucun dossier ne peut alors être choisi).
 */
export function odFolderFor(meta: Pick<Meta, 'walk_settings'> | null | undefined, walk: string | null | undefined): OdFolder | null {
  const ws = walkSettingsMeta(meta);
  if (!ws) return null;
  const id = sanitizeWalk(walk, meta) ?? ws.default;
  const s = ws.settings.find((x) => x.id === id);
  if (!s || !Number.isInteger(s.leg_limit_m) || s.leg_limit_m <= 0) return null;
  return { path: `data/od_walk${s.leg_limit_m}/`, settingId: s.id };
}

/**
 * L'index chargé est-il celui du réglage demandé ? Liste vide = oui. Un index sans bloc
 * `walk_setting` (ancien export) n'est pas accepté pour un réglage : on ne suppose rien.
 */
export function checkOdFolder(index: Pick<OdIndex, 'walk_setting'>, folder: OdFolder): string[] {
  const id = index.walk_setting?.id;
  if (!id) return [`${folder.path}index.json : bloc walk_setting absent (réglage ${folder.settingId} attendu)`];
  if (id !== folder.settingId) return [`${folder.path}index.json : réglage ${id} au lieu de ${folder.settingId}`];
  return [];
}
