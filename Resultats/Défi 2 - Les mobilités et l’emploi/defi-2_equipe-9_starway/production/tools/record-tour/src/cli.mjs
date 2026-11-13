#!/usr/bin/env node
// Enregistrement reproductible de la visite guidée STARWAY. Usage : node src/cli.mjs --help
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { joinNegativeValues } from './args.mjs';
import { DEFAULT_SUBTITLE_STYLE, assemble } from './assemble.mjs';
import { REPO_ROOT, paths, rel } from './paths.mjs';
import { recordTour, recordUrl } from './record.mjs';
import { serveStatic } from './server.mjs';
import { printReport, validateInputs } from './validate.mjs';

const USAGE = `Usage : node src/cli.mjs <tourId> [options]     (ou : npm run record -- <tourId> [options])

  <tourId>                 identifiant de la visite (ex. lea) ; lit frontend/public/tour/<tourId>/

Modes
  --dry-run                valide tour.resolved.json, les MP3, les VTT et les outils, sans rien enregistrer
  --assemble-only          réassemble le MP4 depuis le dernier enregistrement (WebM + timeline.json du dossier de travail)

Entrées
  --url <url>              URL de base à enregistrer (ex. http://localhost:5173/) au lieu de servir frontend/dist
  --dist <dossier>         build à servir (défaut : frontend/dist)
  --tour-dir <dossier>     dossier des MP3/VTT/tour.resolved.json (défaut : frontend/public/tour/<tourId>)

Sorties
  --out-dir <dossier>      défaut : design/video
  --work-dir <dossier>     WebM brut, timeline.json, sous-titres fusionnés (défaut : tools/record-tour/.work/<tourId>)
  --no-subtitled           ne produit pas la variante sous-titrée incrustée

Enregistrement
  --headed                 navigateur visible (WebGL sur le GPU, rendu plus fluide ; recommandé)
  --browser-path <exe>     exécutable Chromium à utiliser à la place du navigateur installé par Playwright
  --fps <n>                images par seconde de la capture et du MP4 (défaut : 30)
  --front-subtitles        laisse le front afficher ses sous-titres (sinon ?subs=0 est ajouté à l'URL)
  --hook-timeout <s>       attente maximale de l'événement « ready » (défaut : 60)
  --timeout <s>            attente maximale de l'événement « end » (défaut : 600)
  --end-hold <s>           garde la page ouverte après « end » pour recevoir les dernières images (défaut : 12)

Assemblage
  --sync <bar|events>      bar : son posé sur l'image, mesurée dans le WebM (défaut) ; events : horloges seules (fixtures)
  --av-offset-ms <n>       décale tout l'audio et les sous-titres de n ms (positif = plus tard, négatif = plus tôt ; défaut : 0)
  --subtitle-style <ass>   style libass des sous-titres incrustés (défaut : ${DEFAULT_SUBTITLE_STYLE})
  --preset <p>             preset libx264 (défaut : slow ; « medium » ou « fast » pour un essai rapide)
  --verbose                affiche la sortie de ffmpeg
  -h, --help
`;

function fail(message, code = 1) {
  console.error(`\nErreur : ${message}`);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({
    args: joinNegativeValues(process.argv.slice(2)),
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean' },
      'assemble-only': { type: 'boolean' },
      url: { type: 'string' },
      dist: { type: 'string' },
      'tour-dir': { type: 'string' },
      'out-dir': { type: 'string' },
      'work-dir': { type: 'string' },
      'no-subtitled': { type: 'boolean' },
      headed: { type: 'boolean' },
      'browser-path': { type: 'string' },
      fps: { type: 'string', default: '30' },
      'front-subtitles': { type: 'boolean' },
      'hook-timeout': { type: 'string', default: '60' },
      timeout: { type: 'string', default: '600' },
      'end-hold': { type: 'string', default: '12' },
      sync: { type: 'string', default: 'bar' },
      'av-offset-ms': { type: 'string', default: '0' },
      'subtitle-style': { type: 'string', default: DEFAULT_SUBTITLE_STYLE },
      preset: { type: 'string', default: 'slow' },
      verbose: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (e) {
  console.error(e.message);
  console.error(USAGE);
  process.exit(2);
}
const { values: o, positionals } = parsed;
if (o.help) {
  console.log(USAGE);
  process.exit(0);
}
const tourId = positionals[0];
if (!tourId || positionals.length > 1 || !/^[a-z0-9_-]+$/i.test(tourId)) {
  console.error(USAGE);
  process.exit(2);
}

const num = (name, { min = -Infinity } = {}) => {
  const v = Number(o[name]);
  if (!Number.isFinite(v) || v < min) fail(`--${name} doit être un nombre${min > -Infinity ? ` >= ${min}` : ''}.`, 2);
  return v;
};
const fromCwd = (p) => (p ? path.resolve(p) : null);
const fps = num('fps', { min: 1 });
const hookTimeoutMs = num('hook-timeout', { min: 1 }) * 1000;
const endTimeoutMs = num('timeout', { min: 1 }) * 1000;
const endHoldMs = num('end-hold', { min: 0 }) * 1000;
if (!['bar', 'events'].includes(o.sync)) fail('--sync doit valoir bar ou events.', 2);
const avOffsetMs = Math.round(num('av-offset-ms'));
const tourDir = fromCwd(o['tour-dir']) ?? paths.tourDir(tourId);
const distDir = fromCwd(o.dist) ?? paths.dist;
const outDir = fromCwd(o['out-dir']) ?? paths.outDir;
const workDir = fromCwd(o['work-dir']) ?? paths.workDir(tourId);
const recording = !o['dry-run'] && !o['assemble-only'];
const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
if (!PRESETS.includes(o.preset)) fail(`--preset doit valoir : ${PRESETS.join(', ')}.`, 2);

console.log(`STARWAY - enregistrement de la visite « ${tourId} »`);
console.log(`Dépôt : ${REPO_ROOT}`);
console.log('');
console.log('Validation des entrées');
// La copie de frontend/dist n'est vérifiée que lorsqu'on la sert (pas avec --url).
const result = validateInputs({ tourId, tourDir, checkDist: !o.url && (recording || (o['dry-run'] && !o['tour-dir'])), distDir });
const ok = printReport(result);
if (o['dry-run']) process.exit(ok ? 0 : 1);
if (!ok) fail('entrées non valides : corrigez-les (voir ci-dessus) avant d\'enregistrer.');

try {
  let timeline;
  if (recording) {
    console.log('');
    console.log('Enregistrement (Playwright, Chromium)');
    const server = o.url ? null : await serveStatic(distDir);
    if (server) console.log(`  ${rel(distDir)} servi sur ${server.url}`);
    try {
      timeline = await recordTour({
        tourId,
        url: recordUrl(o.url ?? server.url, tourId, { frontSubtitles: o['front-subtitles'] }),
        workDir,
        headed: o.headed,
        fps,
        hookTimeoutMs,
        endTimeoutMs,
        endHoldMs,
        expectedSteps: result.steps.length,
        browserPath: o['browser-path'],
      });
    } finally {
      await server?.close();
    }
  } else {
    const tl = path.join(workDir, 'timeline.json');
    if (!existsSync(tl)) fail(`${rel(tl)} introuvable : lancez d'abord un enregistrement.`);
    timeline = JSON.parse(readFileSync(tl, 'utf8'));
    if (timeline.tourId !== tourId) fail(`${rel(tl)} concerne la visite « ${timeline.tourId} », pas « ${tourId} ».`);
  }
  console.log('');
  console.log('Assemblage (ffmpeg)');
  const outputs = await assemble({
    tourId,
    timeline,
    steps: result.steps,
    workDir,
    outDir,
    avOffsetMs,
    sync: o.sync,
    subtitled: !o['no-subtitled'],
    subtitleStyle: o['subtitle-style'],
    preset: o.preset,
    verbose: o.verbose,
  });
  console.log('');
  console.log('Terminé :');
  for (const f of outputs) console.log(`  ${rel(f)}`);
} catch (e) {
  fail(e.message);
}
