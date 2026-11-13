import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// La page « Sources & limites » importe docs/limites.md (source unique du texte),
// situé hors de frontend/ : on autorise le serveur de dev à le lire.
const docsDir = fileURLToPath(new URL('../docs', import.meta.url));
const frontendDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Répartition régionale du niveau de vie (halo, onglet « Niveau de vie ») : lue au build dans les
 * fichiers `public/data/context/*.json` écrits par le pipeline (06), pour situer une commune parmi
 * toutes les autres sans télécharger 1 285 fichiers. Module virtuel chargé à la demande (environ
 * 10 Ko gzip) ; seules les valeurs publiées (`status` « ok ») y entrent : une valeur sous secret
 * statistique est absente, jamais zéro. À remplacer par un fichier agrégé du pipeline s'il est publié.
 */
function incomeDistribution(): Plugin {
  const id = 'virtual:income-distribution';
  const dir = fileURLToPath(new URL('./public/data/context', import.meta.url));
  return {
    name: 'starway-income-distribution',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const median: [string, number][] = [];
      const poverty: [string, number][] = [];
      let year: number | null = null;
      let files: string[];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.json'));
      } catch {
        files = [];
      }
      for (const f of files) {
        const ctx = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as {
          insee?: string;
          income?: {
            year?: number;
            status?: string;
            median_status?: string;
            poverty_rate_status?: string;
            median_living_standard_eur?: number | null;
            poverty_rate?: number | null;
          };
        };
        const b = ctx.income;
        const insee = ctx.insee ?? f.replace(/\.json$/, '');
        if (!b) continue;
        if (b.year != null) year = year ?? b.year;
        const ms = b.median_status ?? b.status;
        const ps = b.poverty_rate_status ?? b.status;
        if (ms === 'ok' && b.median_living_standard_eur != null) median.push([insee, b.median_living_standard_eur]);
        if (ps === 'ok' && b.poverty_rate != null) poverty.push([insee, b.poverty_rate]);
      }
      return `export default ${JSON.stringify({ year, median, poverty })};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), incomeDistribution()],
  server: {
    fs: { allow: [frontendDir, docsDir] },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
