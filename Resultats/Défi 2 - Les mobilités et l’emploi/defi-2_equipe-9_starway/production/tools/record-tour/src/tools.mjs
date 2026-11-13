// Détection et exécution de ffmpeg / ffprobe.
import { spawn, spawnSync } from 'node:child_process';

export const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
export const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';

const INSTALL_HINT =
  'ffmpeg introuvable. Installez-le avec « winget install Gyan.FFmpeg » puis rouvrez le terminal, ' +
  'ou indiquez son chemin dans la variable d\'environnement FFMPEG_PATH (et FFPROBE_PATH).';

/** Version et capacités utiles de ffmpeg, ou null s'il est absent. */
export function probeFfmpeg() {
  const v = spawnSync(ffmpegBin, ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (v.error || v.status !== 0) return null;
  const version = (v.stdout.split(/\r?\n/)[0] || '').trim();
  const encoders = spawnSync(ffmpegBin, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '';
  const filters = spawnSync(ffmpegBin, ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout || '';
  const probe = spawnSync(ffprobeBin, ['-version'], { encoding: 'utf8' });
  return {
    version,
    libx264: /\blibx264\b/.test(encoders),
    aac: /\baac\b/.test(encoders),
    subtitles: /\bsubtitles\b/.test(filters),
    ffprobe: !probe.error && probe.status === 0,
  };
}

export function requireFfmpeg() {
  const info = probeFfmpeg();
  if (!info) throw new Error(INSTALL_HINT);
  return info;
}

export { INSTALL_HINT };

/** Durée d'un fichier média en millisecondes (ffprobe), ou null si inconnue. */
export function mediaDurationMs(file) {
  const r = spawnSync(
    ffprobeBin,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { encoding: 'utf8' },
  );
  if (r.error || r.status !== 0) return null;
  const s = Number.parseFloat(r.stdout.trim());
  return Number.isFinite(s) ? Math.round(s * 1000) : null;
}

/** Durées mesurées d'un fichier (ffprobe), en millisecondes : image, son et conteneur ; null si absente. */
export function streamDurationsMs(file) {
  const r = spawnSync(
    ffprobeBin,
    ['-v', 'error', '-show_entries', 'stream=codec_type,duration:format=duration', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  if (r.error || r.status !== 0) return null;
  const info = JSON.parse(r.stdout);
  const ms = (v) => {
    const s = Number.parseFloat(v);
    return Number.isFinite(s) ? Math.round(s * 1000) : null;
  };
  const stream = (type) => ms(info.streams?.find((s) => s.codec_type === type)?.duration);
  return { videoMs: stream('video'), audioMs: stream('audio'), formatMs: ms(info.format?.duration) };
}

/** Lance ffmpeg ; rejette avec la fin de stderr en cas d'échec. */
export function runFfmpeg(args, { cwd, verbose = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ['-hide_banner', '-y', ...args], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    child.stderr.on('data', (d) => {
      const s = d.toString();
      if (verbose) process.stderr.write(s);
      tail = (tail + s).slice(-4000);
    });
    child.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(INSTALL_HINT) : e));
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg a échoué (code ${code}) :\n${tail}`)),
    );
  });
}
