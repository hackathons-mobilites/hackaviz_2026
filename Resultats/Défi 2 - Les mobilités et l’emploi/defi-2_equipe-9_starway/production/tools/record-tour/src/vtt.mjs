// Lecture WebVTT (format produit par tools/tour-tts) et écriture SRT / WebVTT fusionnés.

/** « hh:mm:ss.mmm » ou « mm:ss.mmm » en millisecondes, ou null. */
export function parseTimestamp(s) {
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(s.trim());
  if (!m) return null;
  const [, h = '0', mm, ss, ms] = m;
  return ((Number(h) * 60 + Number(mm)) * 60 + Number(ss)) * 1000 + Number(ms);
}

/**
 * Analyse un fichier WebVTT. Renvoie { cues: [{ startMs, endMs, lines }], notes: [texte des blocs NOTE] }.
 * Lève une erreur si l'en-tête ou un horodatage est invalide.
 */
export function parseVtt(content) {
  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  if (!/^WEBVTT(?:[ \t].*)?$/.test(blocks[0].split('\n')[0])) throw new Error('en-tête « WEBVTT » absent');
  const cues = [];
  const notes = [];
  for (const block of blocks.slice(1)) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    if (/^NOTE(?:\s|$)/.test(lines[0])) {
      notes.push(lines.join('\n').replace(/^NOTE\s?/, ''));
      continue;
    }
    if (/^(STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
    const timingIndex = lines.findIndex((l) => l.includes('-->'));
    if (timingIndex < 0 || timingIndex > 1) throw new Error(`bloc sans horodatage : « ${lines[0]} »`);
    const [startRaw, rest] = lines[timingIndex].split('-->');
    const startMs = parseTimestamp(startRaw);
    const endMs = parseTimestamp(rest.trim().split(/\s+/)[0]);
    if (startMs === null || endMs === null) throw new Error(`horodatage invalide : « ${lines[timingIndex]} »`);
    if (endMs <= startMs) throw new Error(`cue vide ou inversée : « ${lines[timingIndex]} »`);
    const cueLines = lines.slice(timingIndex + 1).map(stripTags).filter((l) => l.trim().length > 0);
    cues.push({ startMs, endMs, lines: cueLines });
  }
  return { cues, notes };
}

function stripTags(line) {
  return line
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

function split(ms) {
  const v = Math.max(0, Math.round(ms));
  return { h: Math.floor(v / 3600000), m: Math.floor(v / 60000) % 60, s: Math.floor(v / 1000) % 60, ms: v % 1000 };
}

export function formatVttTime(ms) {
  const t = split(ms);
  return `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}.${pad(t.ms, 3)}`;
}

export function formatSrtTime(ms) {
  const t = split(ms);
  return `${pad(t.h)}:${pad(t.m)}:${pad(t.s)},${pad(t.ms, 3)}`;
}

/** Décale les cues d'une étape à sa position dans la vidéo. */
export function shiftCues(cues, offsetMs) {
  return cues.map((c) => ({ ...c, startMs: c.startMs + offsetMs, endMs: c.endMs + offsetMs }));
}

export function renderSrt(cues) {
  return (
    cues
      .map((c, i) => `${i + 1}\n${formatSrtTime(c.startMs)} --> ${formatSrtTime(c.endMs)}\n${c.lines.join('\n')}\n`)
      .join('\n') + '\n'
  );
}

export function renderVtt(cues, note) {
  const head = note ? `WEBVTT\n\nNOTE ${note}\n` : 'WEBVTT\n';
  return head + cues.map((c) => `\n${formatVttTime(c.startMs)} --> ${formatVttTime(c.endMs)}\n${c.lines.join('\n')}\n`).join('');
}
