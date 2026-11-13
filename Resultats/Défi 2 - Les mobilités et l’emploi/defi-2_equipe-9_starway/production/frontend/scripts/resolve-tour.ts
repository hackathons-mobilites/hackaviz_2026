/**
 * npm run tour:resolve <id>
 * Rejoue la visite sur les JSON de public/data/ et écrit public/tour/<id>/tour.resolved.json
 * (textes résolus + processing_version). Échoue (code 1) si une variable est nulle : on ne prononce
 * jamais un trou. Les durationMs déjà écrits par tools/tour-tts sont conservés si le texte est inchangé.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBmoFile } from '../src/data/bmo';
import { isBmoMetiersFile } from '../src/data/bmoMetiers';
import { odFolderFor } from '../src/data/od/folders';
import { communeJobsOf } from '../src/data/od/communeJobs';
import type { OdIndex } from '../src/data/od/types';
import type { AccessFile, Commune, ContextFile, Dataset, Meta, Pole } from '../src/data/types';
import { readItinerariesFile, readOdOffline } from './nodeData';
import { TOURS } from '../src/tour/registry';
import { resolveTour, type ResolvedTour } from '../src/tour/resolve';
import { stepFileStem } from '../src/tour/vtt';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const readJson = <T,>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as T) : null);

export function main(args: string[]): number {
  const id = args[0];
  const script = id ? TOURS[id] : undefined;
  if (!script) {
    console.error(`Usage : npm run tour:resolve <id>  (visites : ${Object.keys(TOURS).join(', ')})`);
    return 2;
  }
  // Poles, meta, access et itinéraires sont à la racine de data/ (ciel des 44 astres, D-030)
  const sky = join(root, 'data');
  const meta = readJson<Meta>(join(sky, 'meta.json'));
  const poles = readJson<Pole[]>(join(sky, 'poles.json'));
  const communes = readJson<Commune[]>(join(root, 'data', 'communes.json'));
  if (!meta || !poles || !communes) {
    console.error('public/data/ incomplet (meta.json, poles.json, communes.json) : résolution impossible.');
    return 1;
  }
  const dataset: Dataset = { origin: 'real', meta, poles, communes, insights: [], sources: [] };
  // Postes par commune (point 4.1 : la commune de départ sort des totaux) : index de la table OD du réglage de marche
  // par défaut, le même que celui que le site charge (odFolderFor)
  const odFolder = odFolderFor(meta, null);
  const odIndex = odFolder ? readJson<OdIndex>(join(root, odFolder.path, 'index.json')) : null;
  // La visite dit les chiffres du site (06/11) : ceux de la table commune x commune. Sans elle, jamais un autre calcul.
  const od = readOdOffline(root, meta);
  if (!od) {
    console.error(`Table commune x commune introuvable (${odFolder?.path ?? 'dossier non publié'}) : la visite ne peut pas dire les chiffres du site, rien n'est écrit.`);
    return 1;
  }
  const outPath = join(root, 'tour', script.id, 'tour.resolved.json');
  const { tour, missing } = resolveTour(
    script,
    {
      dataset,
      access: (insee) => readJson<AccessFile>(join(sky, 'access', `${insee}.json`)),
      context: (insee) => readJson<ContextFile>(join(root, 'data', 'context', `${insee}.json`)),
      // Même règle que le navigateur (loadItineraries) : fichier lu seulement s'il est annoncé par meta.itineraries_communes
      itineraries: (insee) => (meta.itineraries_communes?.includes(insee) ? readItinerariesFile(join(root, 'data'), meta, insee) : null),
      // Projets de recrutement par métier (D-035) : lus seulement s'ils respectent le contrat bmo-metiers-1
      bmoMetiers: ((f) => (isBmoMetiersFile(f) ? f : null))(readJson<unknown>(join(root, 'data', 'bmo_metiers.json'))),
      // Chiffre de la famille de métiers : le fichier du panneau de preuve (contrat bmo-1)
      bmo: ((f) => (isBmoFile(f) ? f : null))(readJson<unknown>(join(root, 'data', 'bmo.json'))),
      communeJobs: odIndex ? (insee) => communeJobsOf(odIndex, insee) : null,
      od,
    },
    readJson<ResolvedTour>(outPath),
    undefined,
    // le manifeste ne ment pas : durationMs n'est conservé que si le MP3 existe sous le nom actuel de l'étape (NN-id)
    (index, stepId) => existsSync(join(root, 'tour', script.id, `${stepFileStem(index, stepId)}.mp3`)),
  );
  if (missing.length) {
    console.error(`Visite « ${script.id} » : variables nulles, rien n'est écrit.`);
    for (const m of missing) console.error(`  - étape ${m.step} : ${m.variables.join(', ')}`);
    return 1;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(tour, null, 2)}\n`, 'utf-8');
  const kept = tour.steps.filter((s) => s.durationMs != null).length;
  console.log(`Écrit ${outPath} (${tour.steps.length} étapes, processing_version ${tour.processing_version}, audio conservé pour ${kept}).`);
  if (kept < tour.steps.length) {
    console.log(
      `Voix : ${tour.steps.length - kept} étape(s) sur ${tour.steps.length} sans voix enregistrée (sous-titres seuls). Détail et contrôle strict : npm run tour:voice ${script.id}`,
    );
  }
  return 0;
}
