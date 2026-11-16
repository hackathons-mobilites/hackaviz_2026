// Build de la seule carte de la qualité de l'air des lignes (index-air.html) dans air/, le plus léger possible :
// - une page (renommée index.html), son script (MapLibre + main-air.js) et sa feuille MapLibre
// - une seule donnée : idf-mobilites/pipeline/22-air-lignes.json (≈ 180 Ko)
// Usage : pnpm build:air — dossier autonome, servi depuis n'importe quel sous-dossier (chemins relatifs)
import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, "../shared/assets");
const SORTIE = resolve(__dirname, "air");
const DONNEE = "idf-mobilites/pipeline/22-air-lignes.json";

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    outDir: SORTIE,
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: { input: resolve(__dirname, "index-air.html") },
  },
  plugins: [
    {
      name: "finaliser-air",
      apply: "build",
      closeBundle() {
        // page d'entrée du dossier : index.html
        fs.renameSync(join(SORTIE, "index-air.html"), join(SORTIE, "index.html"));
        // donnée unique de l'animation
        const source = join(ASSETS, DONNEE);
        if (!fs.existsSync(source)) throw new Error(`donnée absente (lancer pnpm data:22) : ${DONNEE}`);
        fs.mkdirSync(dirname(join(SORTIE, DONNEE)), { recursive: true });
        fs.copyFileSync(source, join(SORTIE, DONNEE));
        // icône d'onglet (triangle rouge) : copiée à côté de la page, déclarée en ./favicon.ico
        fs.copyFileSync(join(ASSETS, "favicon.ico"), join(SORTIE, "favicon.ico"));
        console.log(`✓ index.html + favicon.ico + ${DONNEE}`);
      },
    },
  ],
});
