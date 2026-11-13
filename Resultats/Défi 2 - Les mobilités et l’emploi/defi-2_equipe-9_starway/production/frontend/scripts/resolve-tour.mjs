// Lanceur : exécute scripts/resolve-tour.ts avec le chargeur de modules de Vite (TypeScript, imports sans extension).
import { runnerImport } from 'vite';

const { module } = await runnerImport('./scripts/resolve-tour.ts', { configFile: false, logLevel: 'error' });
process.exitCode = module.main(process.argv.slice(2));
