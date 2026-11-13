// Assemblage : vidéo WebM brute + MP3 de chaque étape placés aux instants mesurés -> MP4 H.264 1080p,
// puis variante avec les sous-titres (.vtt de chaque étape, décalés de la même façon) incrustés.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { rel } from './paths.mjs';
import { measureStepMarkers } from './sync.mjs';
import { mediaDurationMs, runFfmpeg, streamDurationsMs } from './tools.mjs';
import { VIDEO_MAX_MS, formatDuration } from './validate.mjs';
import { renderSrt, renderVtt, shiftCues } from './vtt.mjs';

/** Style des sous-titres incrustés (libass, force_style). Taille relative à une hauteur de 288 (SRT). */
export const DEFAULT_SUBTITLE_STYLE =
  'FontName=Arial,FontSize=14,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1.5,Shadow=0,MarginV=36';

/** Écart maximal toléré entre la durée de l'image et celle du son du MP4 (ms) : quelques images à 30 i/s. */
export const AV_TOLERANCE_MS = 100;

/**
 * Instant de chaque étape dans le WebM (ms). Une étape sans repère (le prologue) garde l'écart
 * entre signaux qui la sépare de l'étape repérée la plus proche.
 */
function picturePositions(markers, signalMs) {
  return markers.map((m, i) => {
    if (m !== null) return m;
    let nearest = -1;
    markers.forEach((other, j) => {
      if (other !== null && (nearest < 0 || Math.abs(j - i) < Math.abs(nearest - i))) nearest = j;
    });
    return markers[nearest] - (signalMs[nearest] - signalMs[i]);
  });
}

/**
 * Calcule le placement de chaque étape à partir de timeline.json.
 * Avec `markers` (instant de chaque étape mesuré sur l'image, voir sync.mjs) : chaque MP3 est posé sur l'image de
 * son étape, et la vidéo commence à « ready », situé dans le WebM en lui appliquant le plus petit retard observé.
 * Sans `markers` (fixtures sans barre de progression) : placement aux instants des signaux, coupe depuis `videoStartedAt`.
 */
export function buildPlan({ timeline, steps, avOffsetMs = 0, markers = null, rawMs = null }) {
  const errors = [];
  const warnings = [];
  const ready = timeline.events.find((e) => e.type === 'ready');
  const end = timeline.events.findLast((e) => e.type === 'end');
  if (!ready) errors.push('timeline.json : aucun événement « ready ».');
  if (!end) errors.push('timeline.json : aucun événement « end ».');
  const stepEvents = timeline.events.filter((e) => e.type === 'step');
  const indices = stepEvents.map((e) => e.index);
  const linear = indices.length === steps.length && indices.every((v, i) => v === i);
  if (!linear)
    errors.push(
      `timeline.json : étapes reçues [${indices.map((i) => i + 1).join(', ')}], attendues 1 à ${steps.length} une seule fois dans l'ordre (visite mise en pause, sautée ou interrompue ?).`,
    );
  if (linear) stepEvents.forEach((e, i) => {
    if (e.id !== undefined && e.id !== steps[i].id)
      errors.push(`timeline.json : l'étape ${i + 1} s'appelle « ${e.id} » dans le front et « ${steps[i].id} » dans tour.resolved.json.`);
  });
  if (markers && markers.length !== steps.length) errors.push('Repères image : leur nombre ne correspond pas aux étapes.');
  if (markers && markers.every((m) => m === null)) errors.push('Repères image : aucun instant mesuré.');
  if (errors.length) return { ok: false, errors, warnings };

  const signalMs = stepEvents.map((e) => e.t - ready.t);
  const fullMs = end.t - ready.t;
  let trimStartMs;
  let positions;
  let durationMs;
  if (markers) {
    positions = picturePositions(markers, signalMs);
    const minLag = Math.min(...markers.flatMap((m, i) => (m === null ? [] : [m - signalMs[i]])));
    trimStartMs = Math.max(0, Math.round(minLag));
    if (minLag < 0) warnings.push(`Image en avance de ${Math.round(-minLag)} ms sur les signaux : vérifiez le début de la vidéo.`);
    const last = steps.length - 1;
    const wantedMs = Math.round(positions[last] + (fullMs - signalMs[last]) - trimStartMs);
    durationMs = rawMs === null ? wantedMs : Math.min(wantedMs, rawMs - trimStartMs);
    if (durationMs < wantedMs)
      warnings.push(`Il manque ${wantedMs - durationMs} ms d'image à la fin du WebM : la fin du générique est perdue (la vidéo s'arrête avec le WebM, voir --end-hold).`);
  } else {
    positions = signalMs;
    trimStartMs = ready.t - timeline.videoStartedAt;
    if (trimStartMs < 0) errors.push('« ready » est antérieur au début de la vidéo : horloges incohérentes.');
    durationMs = fullMs;
  }
  const placed = steps.map((s, i) => {
    const offsetMs = Math.round(positions[i] - (markers ? trimStartMs : 0)) + avOffsetMs;
    const audioMs = s.mp3DurationMs ?? s.durationMs;
    return { ...s, offsetMs, audioMs, signalMs: signalMs[i], pictureMs: markers ? markers[i] : null };
  });
  placed.forEach((p, i) => {
    if (p.offsetMs < 0) errors.push(`Étape « ${p.id} » placée avant le début de la vidéo (${p.offsetMs} ms) : --av-offset-ms trop négatif ?`);
    const next = placed[i + 1];
    const limit = next ? next.offsetMs : durationMs;
    const over = p.offsetMs + p.audioMs - limit;
    if (over > 0)
      warnings.push(
        next
          ? `L'audio de « ${p.id} » chevauche l'étape suivante de ${over} ms (image très en retard, ou front qui n'a pas attendu durationMs : voir le hook, point 4).`
          : `L'audio de « ${p.id} » dépasse la fin de la vidéo de ${over} ms : il sera coupé.`,
      );
  });
  if (durationMs > VIDEO_MAX_MS) warnings.push(`Vidéo de ${formatDuration(durationMs)} : au-delà des 3 min autorisées par le dépôt.`);
  return { ok: errors.length === 0, errors, warnings, trimStartMs, durationMs, placed };
}

/**
 * Contrôle final d'un MP4 : image et son doivent durer autant, et autant que prévu.
 * @param {{ videoMs: number|null, audioMs: number|null, formatMs: number|null } | null} measured durées ffprobe
 */
export function checkOutput(measured, { expectedMs, toleranceMs = AV_TOLERANCE_MS, maxMs = VIDEO_MAX_MS }) {
  const errors = [];
  const warnings = [];
  if (!measured || measured.videoMs === null || measured.audioMs === null)
    return { ok: false, errors: ["durée de l'image ou du son illisible avec ffprobe"], warnings, finalMs: measured?.formatMs ?? null };
  const { videoMs, audioMs, formatMs } = measured;
  const gap = Math.abs(videoMs - audioMs);
  if (gap > toleranceMs) errors.push(`image ${videoMs} ms et son ${audioMs} ms : écart de ${gap} ms, au-delà de la tolérance de ${toleranceMs} ms`);
  if (Math.abs(videoMs - expectedMs) > toleranceMs)
    errors.push(`image ${videoMs} ms pour ${expectedMs} ms prévues : écart au-delà de la tolérance de ${toleranceMs} ms`);
  const finalMs = formatMs ?? Math.max(videoMs, audioMs);
  if (finalMs > maxMs) warnings.push(`durée finale ${formatDuration(finalMs)} : AU-DELÀ DE LA LIMITE STRICTE DE 180 s (brief, p. 15)`);
  return { ok: errors.length === 0, errors, warnings, finalMs };
}

function seconds(ms) {
  return (ms / 1000).toFixed(3);
}

/** Écrit subs.srt (pour l'incrustation) dans workDir et starway-<id>.vtt (sous-titres séparés) dans outDir. */
export function writeSubtitles({ plan, tourId, workDir, outDir }) {
  const cues = plan.placed
    .flatMap((p) => shiftCues(p.cues, p.offsetMs))
    .filter((c) => c.startMs < plan.durationMs)
    .map((c) => ({ ...c, endMs: Math.min(c.endMs, plan.durationMs) }));
  const srt = path.join(workDir, 'subs.srt');
  const vtt = path.join(outDir, `starway-${tourId}.vtt`);
  writeFileSync(srt, renderSrt(cues), 'utf8');
  writeFileSync(vtt, renderVtt(cues, `Sous-titres de la visite « ${tourId} », assemblés par tools/record-tour.`), 'utf8');
  return { srt, vtt, count: cues.length };
}

async function encode({ rawPath, plan, fps, preset, output, subtitlesFile, subtitleStyle, workDir, verbose }) {
  const args = ['-ss', seconds(plan.trimStartMs), '-t', seconds(plan.durationMs), '-i', rawPath];
  for (const p of plan.placed) args.push('-i', p.mp3);
  let video = `[0:v]scale=1920:1080:flags=lanczos,setsar=1,fps=${fps}`;
  if (subtitlesFile) video += `,subtitles=filename=${path.basename(subtitlesFile)}:force_style='${subtitleStyle}'`;
  video += ',format=yuv420p[v]';
  const delays = plan.placed.map((p, i) => `[${i + 1}:a]adelay=delays=${Math.round(p.offsetMs)}:all=1[a${i}]`);
  const mix = `${plan.placed.map((_, i) => `[a${i}]`).join('')}amix=inputs=${plan.placed.length}:normalize=0:dropout_transition=0,apad[a]`;
  args.push(
    '-filter_complex', [video, ...delays, mix].join(';'),
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', preset, '-crf', '18', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', seconds(plan.durationMs),
    '-movflags', '+faststart',
    path.resolve(output),
  );
  // cwd = workDir : le filtre subtitles reçoit un nom de fichier relatif (évite l'échappement des chemins Windows « C:\ »).
  await runFfmpeg(args, { cwd: workDir, verbose });
}

/** Contrôle chaque MP4 produit et affiche sa durée mesurée ; lève une erreur si image et son divergent. */
function verifyOutputs(files, expectedMs) {
  console.log('');
  console.log('Contrôle final (ffprobe)');
  const failures = [];
  for (const file of files) {
    const measured = streamDurationsMs(file);
    const c = checkOutput(measured, { expectedMs });
    const detail = measured ? `image ${measured.videoMs} ms, son ${measured.audioMs} ms` : 'mesure impossible';
    console.log(`  ${c.ok ? 'OK' : 'ÉCHEC'} : ${rel(file)}`);
    console.log(`    durée finale ${c.finalMs === null ? 'inconnue' : `${formatDuration(c.finalMs)} (${c.finalMs} ms)`} ; ${detail} ; tolérance ${AV_TOLERANCE_MS} ms`);
    for (const w of c.warnings) console.log(`    ATTENTION : ${w}`);
    for (const e of c.errors) failures.push(`${rel(file)} : ${e}`);
  }
  if (failures.length) throw new Error(`contrôle final en échec :\n${failures.join('\n')}`);
}

export async function assemble({ tourId, timeline, steps, workDir, outDir, avOffsetMs, subtitled, subtitleStyle, sync = 'bar', preset = 'slow', verbose }) {
  const rawPath = path.join(workDir, 'raw.webm');
  if (!existsSync(rawPath)) throw new Error(`${rel(rawPath)} introuvable : enregistrez d'abord (sans --assemble-only).`);
  const rawMs = mediaDurationMs(rawPath);

  // Constat seulement : cet écart ne dit pas de combien recaler (voir README, « Alignement »).
  if (rawMs !== null && timeline.closeRequestedAt) {
    const wallMs = timeline.closeRequestedAt - timeline.videoStartedAt;
    console.log(`  WebM brut : ${formatDuration(rawMs)} ; horloge de l'enregistreur : ${formatDuration(wallMs)} (écart ${wallMs - rawMs} ms).`);
  }

  let markers = null;
  if (sync === 'bar') {
    console.log('  Mesure de la barre de progression dans le WebM (décode toute la vidéo : plusieurs minutes si le poste est chargé).');
    const found = await measureStepMarkers({ rawPath, stepCount: steps.length, viewport: timeline.viewport });
    if (!found.ok)
      throw new Error(`Alignement sur l'image impossible : ${found.reason}. La visite a-t-elle bien été filmée jusqu'au bout ? (--sync events ne convient qu'aux fixtures sans barre de progression.)`);
    markers = found.markers;
    console.log(`  Barre de progression trouvée en y=${found.bar.y}, x=${found.bar.x0} à ${found.bar.x1}.`);
  } else {
    console.log('  Alignement sur les horloges (--sync events) : le WebM peut commencer après la création de la page.');
    console.log("  Si le son est en retard sur l'image, recalez avec une valeur négative (--av-offset-ms -500) ; positif = son plus tard.");
  }

  const plan = buildPlan({ timeline, steps, avOffsetMs, markers, rawMs });
  for (const w of plan.warnings) console.log(`  ATTENTION : ${w}`);
  if (!plan.ok) throw new Error(plan.errors.join('\n'));

  console.log(`  Coupe : à partir de ${seconds(plan.trimStartMs)} s du WebM, durée ${formatDuration(plan.durationMs)}.`);
  for (const p of plan.placed) {
    const lag = p.pictureMs === null ? ' ; sans repère image (prologue)' : ` ; image à ${seconds(p.pictureMs)} s du WebM, retard sur le signal ${seconds(p.pictureMs - p.signalMs)} s`;
    console.log(`    ${p.stem.padEnd(26)} audio à ${seconds(p.offsetMs).padStart(8)} s (${p.audioMs} ms)${markers ? lag : ''}`);
  }

  mkdirSync(outDir, { recursive: true });
  const outputs = [];
  const main = path.join(outDir, `starway-${tourId}.mp4`);
  console.log(`  Encodage H.264 : ${rel(main)}`);
  await encode({ rawPath, plan, fps: timeline.fps, preset, output: main, workDir, verbose });
  outputs.push(main);

  const subs = writeSubtitles({ plan, tourId, workDir, outDir });
  outputs.push(subs.vtt);
  if (subtitled) {
    const out = path.join(outDir, `starway-${tourId}-sous-titres.mp4`);
    console.log(`  Encodage H.264 avec ${subs.count} sous-titres incrustés : ${rel(out)}`);
    await encode({ rawPath, plan, fps: timeline.fps, preset, output: out, subtitlesFile: subs.srt, subtitleStyle, workDir, verbose });
    outputs.push(out);
  }
  verifyOutputs(outputs.filter((f) => f.endsWith('.mp4')), plan.durationMs);
  return outputs;
}
