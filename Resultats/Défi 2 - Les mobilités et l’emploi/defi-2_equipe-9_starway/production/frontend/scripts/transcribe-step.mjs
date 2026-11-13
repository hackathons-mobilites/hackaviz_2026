// Vérité terrain de la synchro : reconnaissance vocale Azure (ressource Speech de l'équipe) sur un MP3 de la visite,
// avec l'horodatage de chaque mot. Usage : SPEECH_KEY=... node scripts/transcribe-step.mjs <fichier.mp3> [--json]
// La clé n'est jamais affichée. Sert à vérifier les sous-titres et les repères, pas au site.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const file = process.argv[2];
const asJson = process.argv.includes('--json');
const key = process.env.SPEECH_KEY;
const region = process.env.SPEECH_REGION || 'francecentral';
if (!file || !key) {
  console.error('Usage : SPEECH_KEY=... node scripts/transcribe-step.mjs <fichier.mp3> [--json]');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'starway-stt-'));
const wav = join(dir, 'step.wav');
const conv = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
if (conv.status !== 0) {
  console.error('ffmpeg a échoué');
  process.exit(1);
}

const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=fr-FR&format=detailed&wordLevelTimestamps=true`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000' },
  body: readFileSync(wav),
});
rmSync(dir, { recursive: true, force: true });
if (!res.ok) {
  console.error(`STT HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.json();
const best = body.NBest?.[0];
const words = (best?.Words ?? []).map((w) => ({ word: w.Word, startMs: Math.round(w.Offset / 10000), endMs: Math.round((w.Offset + w.Duration) / 10000) }));
if (asJson) console.log(JSON.stringify({ status: body.RecognitionStatus, display: best?.Display, words }));
else {
  console.log(`${body.RecognitionStatus} : ${best?.Display ?? ''}`);
  for (const w of words) console.log(`${(w.startMs / 1000).toFixed(2).padStart(6)} - ${(w.endMs / 1000).toFixed(2).padStart(6)}  ${w.word}`);
}
