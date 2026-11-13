// Validation des entrées d'un enregistrement (mode --dry-run, et préalable à tout enregistrement).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileStem, paths, rel } from './paths.mjs';
import { mediaDurationMs, probeFfmpeg, INSTALL_HINT } from './tools.mjs';
import { parseVtt } from './vtt.mjs';

/** Durée maximale de la vidéo du dépôt (brief du hackathon : 3 min). */
export const VIDEO_MAX_MS = 180_000;

/** Marqueur écrit par tools/tour-tts dans les .vtt produits sans Azure (Program.cs, EstimatedMarker). */
const TTS_DRY_RUN_MARKER = 'Timings estimés (dry-run)';

/**
 * Pause entre deux étapes, lue dans frontend/src/tour/timing.ts (STEP_PAUSE_MS) pour ne pas
 * dupliquer la constante. null si le fichier ou la constante est introuvable.
 */
export function readStepPauseMs() {
  try {
    const m = /STEP_PAUSE_MS\s*=\s*(\d+)/.exec(readFileSync(paths.timingTs, 'utf8'));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

/**
 * Valide tour.resolved.json, les MP3 et les VTT d'une visite.
 * @returns {{ ok: boolean, errors: string[], warnings: string[], info: string[], tour: any, steps: any[], stepPauseMs: number|null }}
 */
export function validateInputs({ tourId, tourDir, checkDist = false, distDir = paths.dist, checkTools = true }) {
  const errors = [];
  const warnings = [];
  const info = [];
  const steps = [];
  const resolvedPath = path.join(tourDir, 'tour.resolved.json');
  let tour = null;

  info.push(`Dossier de la visite : ${rel(tourDir)}`);

  // Outils
  let ff = null;
  if (checkTools) {
    ff = probeFfmpeg();
    if (!ff) errors.push(INSTALL_HINT);
    else {
      info.push(`ffmpeg : ${ff.version}`);
      if (!ff.libx264) errors.push('ffmpeg ne propose pas l\'encodeur libx264 (H.264) : utilisez la build « full » de Gyan.FFmpeg.');
      if (!ff.aac) errors.push('ffmpeg ne propose pas l\'encodeur aac.');
      if (!ff.subtitles) errors.push('ffmpeg ne propose pas le filtre « subtitles » (libass) : variante sous-titrée impossible.');
      if (!ff.ffprobe) errors.push('ffprobe introuvable (livré avec ffmpeg) : durées des MP3 non vérifiables.');
    }
  }

  // tour.resolved.json
  if (!existsSync(resolvedPath)) {
    errors.push(
      `${rel(resolvedPath)} introuvable. Générez-le avec « npm run tour:resolve ${tourId} » (frontend/), puis l'audio avec « dotnet run --project tools/tour-tts -- ${tourId} ».`,
    );
    return { ok: false, errors, warnings, info, tour, steps, stepPauseMs: readStepPauseMs() };
  }
  try {
    tour = readJson(resolvedPath);
  } catch (e) {
    errors.push(`${rel(resolvedPath)} : JSON invalide (${e.message}).`);
    return { ok: false, errors, warnings, info, tour, steps, stepPauseMs: readStepPauseMs() };
  }
  if (typeof tour?._comment === 'string' && /FICTI/i.test(tour._comment)) warnings.push(`Fichier marqué FICTIF : ${tour._comment}`);
  if (!tour.id) errors.push('Champ « id » manquant dans tour.resolved.json.');
  else if (tour.id !== tourId) errors.push(`Le fichier décrit la visite « ${tour.id} », pas « ${tourId} ».`);
  if (!tour.processing_version) warnings.push('« processing_version » absent : impossible de vérifier que l\'audio correspond aux données.');
  else {
    info.push(`processing_version de la visite : ${tour.processing_version}`);
    if (existsSync(paths.meta)) {
      try {
        const meta = readJson(paths.meta);
        if (meta.processing_version && meta.processing_version !== tour.processing_version)
          warnings.push(
            `processing_version différente de frontend/public/data/meta.json (${meta.processing_version}) : le front refusera la visite, régénérez tour.resolved.json et l'audio.`,
          );
      } catch {
        warnings.push('frontend/public/data/meta.json illisible : processing_version non comparée.');
      }
    }
  }
  if (!Array.isArray(tour.steps) || tour.steps.length === 0) {
    errors.push('Aucune étape dans « steps ».');
    return { ok: false, errors, warnings, info, tour, steps, stepPauseMs: readStepPauseMs() };
  }

  const stepPauseMs = readStepPauseMs();
  if (stepPauseMs === null) warnings.push('STEP_PAUSE_MS introuvable dans frontend/src/tour/timing.ts : durée estimée sans les pauses.');

  // Étapes
  const seen = new Set();
  const expected = new Set(['tour.resolved.json']);
  tour.steps.forEach((s, i) => {
    const label = `Étape ${i + 1} « ${s?.id ?? '?'} »`;
    if (!s?.id) {
      errors.push(`Étape ${i + 1} : « id » manquant.`);
      return;
    }
    if (seen.has(s.id)) errors.push(`${label} : identifiant en double.`);
    seen.add(s.id);
    if (!s.text || !String(s.text).trim()) errors.push(`${label} : « text » vide.`);

    const stem = fileStem(i, s.id);
    const mp3 = path.join(tourDir, `${stem}.mp3`);
    const vtt = path.join(tourDir, `${stem}.vtt`);
    expected.add(`${stem}.mp3`).add(`${stem}.vtt`);
    const step = { index: i, id: s.id, act: s.act, stem, mp3, vtt, durationMs: s.durationMs, minDurationMs: s.minDurationMs ?? 0, cues: [], mp3DurationMs: null };

    if (!Number.isInteger(s.durationMs) || s.durationMs <= 0)
      errors.push(`${label} : « durationMs » absent ou invalide. L'audio n'a pas été généré (dotnet run --project tools/tour-tts -- ${tourId}).`);

    if (!existsSync(mp3)) errors.push(`${label} : ${rel(mp3)} introuvable.`);
    else if (statSync(mp3).size === 0) errors.push(`${label} : ${rel(mp3)} est vide.`);
    else if (ff?.ffprobe) {
      step.mp3DurationMs = mediaDurationMs(mp3);
      if (step.mp3DurationMs === null) errors.push(`${label} : ${rel(mp3)} illisible par ffprobe.`);
    }

    if (!existsSync(vtt)) errors.push(`${label} : ${rel(vtt)} introuvable.`);
    else {
      try {
        const parsed = parseVtt(readFileSync(vtt, 'utf8'));
        step.cues = parsed.cues;
        if (parsed.cues.length === 0) errors.push(`${label} : ${rel(vtt)} ne contient aucune cue.`);
        if (parsed.notes.some((n) => n.includes(TTS_DRY_RUN_MARKER)))
          warnings.push(`${label} : ${rel(vtt)} vient d'un dry-run de tour-tts (timings estimés, pas l'audio réel).`);
        for (let k = 1; k < parsed.cues.length; k++)
          if (parsed.cues[k].startMs < parsed.cues[k - 1].endMs) {
            warnings.push(`${label} : cues ${k} et ${k + 1} se chevauchent dans ${rel(vtt)}.`);
            break;
          }
        const lastEnd = parsed.cues.at(-1)?.endMs ?? 0;
        if (Number.isInteger(s.durationMs) && stepPauseMs !== null) {
          const slot = Math.max(s.durationMs, step.minDurationMs) + stepPauseMs;
          if (lastEnd > slot)
            warnings.push(`${label} : la dernière cue finit à ${lastEnd} ms, après la fin de l'étape (${slot} ms) : elle débordera sur l'étape suivante.`);
        }
      } catch (e) {
        errors.push(`${label} : ${rel(vtt)} invalide (${e.message}).`);
      }
    }
    steps.push(step);
  });

  // Fichiers orphelins (audio d'une ancienne version du script)
  try {
    const orphans = readdirSync(tourDir).filter((f) => /\.(mp3|vtt)$/i.test(f) && !expected.has(f));
    if (orphans.length) warnings.push(`Fichiers sans étape correspondante (anciens ?) : ${orphans.join(', ')}.`);
  } catch {
    /* dossier déjà signalé */
  }

  // Copie dans frontend/dist (celle que sert l'enregistreur)
  if (checkDist) {
    const distIndex = path.join(distDir, 'index.html');
    const distTour = path.join(distDir, 'tour', tourId, 'tour.resolved.json');
    if (!existsSync(distIndex)) errors.push(`${rel(distIndex)} introuvable : lancez « npm run build » dans frontend/.`);
    else if (!existsSync(distTour)) errors.push(`${rel(distTour)} introuvable : relancez « npm run build » après la génération de l'audio.`);
    else if (readFileSync(distTour, 'utf8') !== readFileSync(resolvedPath, 'utf8'))
      errors.push(`${rel(distTour)} diffère de ${rel(resolvedPath)} : relancez « npm run build » dans frontend/.`);
  }

  return { ok: errors.length === 0, errors, warnings, info, tour, steps, stepPauseMs };
}

/** Somme des créneaux d'étape, telle que TourPlayer les calcule (timing.ts : max(audio, min) + pause). */
export function estimateNarrationMs(steps, stepPauseMs) {
  return steps.reduce((t, s) => t + Math.max(s.durationMs || 0, s.minDurationMs || 0) + (stepPauseMs ?? 0), 0);
}

export function formatDuration(ms) {
  const s = Math.round(ms / 100) / 10;
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${(s - m * 60).toFixed(1)} s` : `${s.toFixed(1)} s`;
}

/** Affiche le rapport de validation ; renvoie true si aucune erreur. */
export function printReport(result) {
  const { errors, warnings, info, steps, stepPauseMs } = result;
  for (const l of info) console.log(`  ${l}`);
  if (steps.length) {
    console.log('');
    console.log('  Étape                      durationMs  MP3 (ffprobe)  cues  fin dernière cue');
    for (const s of steps) {
      const mp3 = s.mp3DurationMs === null ? '-' : `${s.mp3DurationMs} ms`;
      const last = s.cues.at(-1)?.endMs;
      console.log(
        `  ${s.stem.padEnd(26)} ${String(s.durationMs ?? '-').padStart(10)}  ${mp3.padStart(13)}  ${String(s.cues.length).padStart(4)}  ${last === undefined ? '-' : `${last} ms`}`,
      );
    }
    const total = estimateNarrationMs(steps, stepPauseMs);
    console.log('');
    console.log(
      `  Durée de narration estimée : ${formatDuration(total)} (max(durationMs, minDurationMs) + ${stepPauseMs ?? '?'} ms de pause par étape, hors transitions du ciel, écran-titre et générique).`,
    );
    if (total > VIDEO_MAX_MS) warnings.push(`La narration seule dépasse 3 min (${formatDuration(total)}) : la vidéo ne tiendra pas dans la limite du dépôt.`);
  }
  if (warnings.length) {
    console.log('');
    for (const w of warnings) console.log(`  ATTENTION : ${w}`);
  }
  if (errors.length) {
    console.log('');
    for (const e of errors) console.log(`  ERREUR : ${e}`);
  }
  console.log('');
  console.log(errors.length ? `  ${errors.length} erreur(s) : entrées non valides.` : '  Entrées valides.');
  return errors.length === 0;
}
