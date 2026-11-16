// Build de la page de présentation du projet (index-sommaire.html) dans sommaire/ : une page (renommée index.html), son
// petit script (main-sommaire.js), l'icône d'onglet, les captures (captures/) et les affiches (affiches/). Aucune donnée :
// les fiches renvoient vers les répertoires eau/, air/, fauteuils/, ligne7/ placés au même niveau que la page.
// Usage : pnpm build:sommaire
import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, "../shared/assets");
const SORTIE = resolve(__dirname, "sommaire");

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    outDir: SORTIE,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: resolve(__dirname, "index-sommaire.html") },
  },
  plugins: [
    {
      name: "finaliser-sommaire",
      apply: "build",
      closeBundle() {
        fs.renameSync(join(SORTIE, "index-sommaire.html"), join(SORTIE, "index.html"));
        fs.copyFileSync(join(ASSETS, "favicon.ico"), join(SORTIE, "favicon.ico"));
        // captures d'écran des cartes (captures/*.png à la racine du template)
        const captures = resolve(__dirname, "captures");
        const images = fs.existsSync(captures) ? fs.readdirSync(captures).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
        if (images.length) fs.mkdirSync(join(SORTIE, "captures"), { recursive: true });
        for (const f of images) fs.copyFileSync(join(captures, f), join(SORTIE, "captures", f)); // images seules
        // affiches (affiches/*.png|jpg à la racine du template)
        const dossierAffiches = resolve(__dirname, "affiches");
        const affiches = fs.existsSync(dossierAffiches) ? fs.readdirSync(dossierAffiches).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
        if (affiches.length) fs.mkdirSync(join(SORTIE, "affiches"), { recursive: true });
        for (const f of affiches) fs.copyFileSync(join(dossierAffiches, f), join(SORTIE, "affiches", f));
        console.log(`✓ index.html + favicon.ico + ${images.length} capture(s) + ${affiches.length} affiche(s)`);
      },
    },
  ],
});
