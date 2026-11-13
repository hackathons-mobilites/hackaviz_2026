/**
 * npm run tour:voice <id>
 * Contrôle de la voix de la visite (05/11) : pour chaque étape de public/tour/<id>/tour.resolved.json, le MP3 et le WebVTT
 * existent, disent le même texte, et leurs durées s'accordent (voir src/tour/voiceCheck.ts). Code de sortie 1 s'il manque
 * UN SEUL fichier : aucun repli, ni voix du navigateur ni « sous-titres seuls ».
 * --pairs : mesure en plus tous les couples .mp3 / .vtt du dossier (durée du MP3 contre fin du WebVTT), même orphelins,
 * pour lister les décalages voix / sous-titres sans rien exiger.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVoice, mp3DurationMs, voiceReportLines, type VoiceFiles } from '../src/tour/voiceCheck';
import { parseVtt } from '../src/tour/vtt';
import type { ResolvedTour } from '../src/tour/resolve';
import { TOURS } from '../src/tour/registry';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'tour');

/** Dossier d'une visite sous forme de VoiceFiles (lecture seule) */
export function dirFiles(dir: string): VoiceFiles {
  return {
    read: (name) => (existsSync(join(dir, name)) ? new Uint8Array(readFileSync(join(dir, name))) : null),
    list: () => (existsSync(dir) ? readdirSync(dir) : []),
  };
}

/** Rapport de la visite `id` ; null si tour.resolved.json est absent. */
export function voiceReportFor(id: string, base: string = root) {
  const dir = join(base, id);
  const file = join(dir, 'tour.resolved.json');
  if (!existsSync(file)) return null;
  const resolved = JSON.parse(readFileSync(file, 'utf-8')) as ResolvedTour;
  return { resolved, report: checkVoice(resolved, dirFiles(dir)) };
}

export function main(args: string[]): number {
  const id = args.find((a) => !a.startsWith('--'));
  if (!id || !TOURS[id]) {
    console.error(`Usage : npm run tour:voice <id> [--pairs]  (visites : ${Object.keys(TOURS).join(', ')})`);
    return 2;
  }
  const r = voiceReportFor(id);
  if (!r) {
    console.error(`public/tour/${id}/tour.resolved.json absent : lancer d'abord npm run tour:resolve ${id}.`);
    return 1;
  }
  for (const line of voiceReportLines(r.report)) console.log(line);
  if (args.includes('--pairs')) {
    const fs = dirFiles(join(root, id));
    console.log('\nCouples MP3 / WebVTT du dossier (durée du MP3, fin du WebVTT, écart) :');
    for (const name of fs.list().filter((n) => n.endsWith('.mp3')).sort()) {
      const stem = name.replace(/\.mp3$/, '');
      const mp3 = mp3DurationMs(fs.read(name)!);
      const vttBytes = fs.read(`${stem}.vtt`);
      const vtt = vttBytes ? parseVtt(new TextDecoder().decode(vttBytes)) : null;
      const end = vtt?.cues.length ? Math.max(...vtt.cues.map((c) => c.endMs)) : null;
      const drift = mp3 != null && end != null ? end - mp3 : null;
      console.log(`  ${stem.padEnd(24)} voix ${mp3 ?? '-'} ms  sous-titres ${end ?? '-'} ms  écart ${drift ?? '-'} ms${vtt?.estimated ? '  (timings estimés)' : ''}`);
    }
  }
  return r.report.ok ? 0 : 1;
}
