// Chemins du dépôt STARWAY utilisés par l'outil d'enregistrement.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Racine du dépôt : premier parent contenant frontend/package.json et tools/. */
export function findRepoRoot(start = TOOL_DIR) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'frontend', 'package.json')) && existsSync(path.join(dir, 'tools'))) return dir;
    if (path.dirname(dir) === dir) throw new Error('Racine du dépôt STARWAY introuvable (frontend/package.json).');
  }
}

export const REPO_ROOT = findRepoRoot();

export const paths = {
  dist: path.join(REPO_ROOT, 'frontend', 'dist'),
  tourDir: (id) => path.join(REPO_ROOT, 'frontend', 'public', 'tour', id),
  meta: path.join(REPO_ROOT, 'frontend', 'public', 'data', 'meta.json'),
  timingTs: path.join(REPO_ROOT, 'frontend', 'src', 'tour', 'timing.ts'),
  outDir: path.join(REPO_ROOT, 'design', 'video'),
  workDir: (id) => path.join(TOOL_DIR, '.work', id),
};

/** Préfixe des fichiers d'une étape, identique à tools/tour-tts (TourDocument.FileStem) : « 01-prologue ». */
export function fileStem(index, stepId) {
  return `${String(index + 1).padStart(2, '0')}-${stepId}`;
}

/** Chemin relatif lisible pour les messages. */
export function rel(p) {
  const r = path.relative(REPO_ROOT, p);
  return r && !r.startsWith('..') ? r.split(path.sep).join('/') : p;
}
