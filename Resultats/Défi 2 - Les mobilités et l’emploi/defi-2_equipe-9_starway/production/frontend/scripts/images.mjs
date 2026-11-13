// Liste les images de public/assets/img/ et signale celles de plus de 400 Ko (skill starway-image-prompts).
// L'optimisation des décors v3 (png → webp + avif) est faite par scripts/optimize-images.py
// (Pillow, déjà présent sur le poste) : aucune dépendance npm ajoutée.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/assets/img/', import.meta.url));
const LIMIT = 400 * 1024;
let warn = 0;
for (const f of readdirSync(dir)) {
  const size = statSync(join(dir, f)).size;
  const flag = size > LIMIT ? '  ⚠ > 400 Ko' : size === 0 ? '  ⚠ vide' : '';
  if (flag) warn++;
  console.log(`${f.padEnd(32)} ${(size / 1024).toFixed(0).padStart(6)} Ko${flag}`);
}
console.log(warn ? `\n${warn} fichier(s) à optimiser (voir scripts/optimize-images.py).` : '\nOK');
