// Lanceur : exécute scripts/check-tour-voice.ts avec le chargeur de modules de Vite (même mécanisme que resolve-tour.mjs).
import { runnerImport } from 'vite';

const { module } = await runnerImport('./scripts/check-tour-voice.ts', { configFile: false, logLevel: 'error' });
process.exitCode = module.main(process.argv.slice(2));
