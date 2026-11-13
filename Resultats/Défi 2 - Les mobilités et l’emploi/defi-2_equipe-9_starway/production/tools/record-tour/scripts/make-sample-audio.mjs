// Génère les fixtures FICTIVES de samples/fictif/ avec ffmpeg :
//  - un MP3 par étape (bip sinusoïdal de durationMs, à la place d'une voix) ;
//  - work/raw.webm (mire de test ffmpeg « testsrc2 » en 1920x1080, chronomètre visible) ;
//  - work/timeline.json (événements simulés, cadencés comme TourPlayer : max(durationMs, minDurationMs) + STEP_PAUSE_MS).
// Rien de tout cela n'est une donnée STARWAY : ces fichiers servent uniquement à tester l'outil.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TOOL_DIR, fileStem } from '../src/paths.mjs';
import { requireFfmpeg, runFfmpeg } from '../src/tools.mjs';
import { readStepPauseMs } from '../src/validate.mjs';

const dir = path.join(TOOL_DIR, 'samples', 'fictif');
const work = path.join(dir, 'work');
const fps = 30;
// Instants simulés : purement techniques (chargement, écran-titre, générique), propres à cette fixture.
const LEAD_MS = 1500;
const TITLE_MS = 500;
const CREDITS_MS = 1000;
const TAIL_MS = 500;

requireFfmpeg();
const tour = JSON.parse(readFileSync(path.join(dir, 'tour.resolved.json'), 'utf8'));
const pause = readStepPauseMs() ?? 0;
mkdirSync(work, { recursive: true });

// Fréquences distinctes pour reconnaître chaque étape à l'écoute.
const freqs = [440, 660, 880, 550, 770];
for (const [i, s] of tour.steps.entries()) {
  const out = path.join(dir, `${fileStem(i, s.id)}.mp3`);
  await runFfmpeg([
    '-f', 'lavfi', '-i', `sine=frequency=${freqs[i % freqs.length]}:duration=${s.durationMs / 1000}`,
    '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', out,
  ]);
  console.log(`${path.basename(out)} : ${s.durationMs} ms`);
}

const t0 = Date.UTC(2026, 0, 1); // origine arbitraire de la fixture (horloge simulée)
const ready = t0 + LEAD_MS;
let t = ready + TITLE_MS;
const events = [{ type: 'ready', tourId: tour.id, t: ready }];
for (const [i, s] of tour.steps.entries()) {
  events.push({ type: 'step', index: i, id: s.id, t });
  t += Math.max(s.durationMs, s.minDurationMs ?? 0) + pause;
}
const end = t + CREDITS_MS;
events.push({ type: 'end', t: end });
const videoMs = end - t0 + TAIL_MS;

await runFfmpeg([
  '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=${fps}`,
  '-t', (videoMs / 1000).toFixed(3), '-c:v', 'libvpx', '-b:v', '1M', '-pix_fmt', 'yuv420p',
  path.join(work, 'raw.webm'),
]);
writeFileSync(
  path.join(work, 'timeline.json'),
  JSON.stringify(
    {
      _comment: 'FICTIF : timeline simulée par scripts/make-sample-audio.mjs pour tester l\'assemblage.',
      tourId: tour.id,
      url: null,
      viewport: { width: 1920, height: 1080 },
      fps,
      headed: false,
      playwright: null,
      videoStartedAt: t0,
      closeRequestedAt: t0 + videoMs,
      timedOut: false,
      events,
    },
    null,
    2,
  ) + '\n',
);
console.log(`work/raw.webm : ${videoMs} ms ; work/timeline.json : ${events.length} événements (pause ${pause} ms lue dans timing.ts)`);
