/**
 * Plans sonores PURS (D-026, motion-spec « Son ») : événement du ciel → sons à jouer (instants, hauteurs,
 * panoramiques, enveloppes). Aucun contexte audio ici : tout est testable avec vitest. Le son suit
 * l'image, il ne décide rien : les ordres et les délais viennent du moteur du ciel.
 */
import { motion, shooting as shootingMotion, sound } from '../theme/tokens';

/** dB → gain linéaire. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Écart en cents → rapport de fréquences. */
export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Position à l'écran (fraction 0 à 1 de la largeur) → panoramique dans [-width, +width]. */
export function panOf(x01: number, width: number = sound.pan): number {
  if (!Number.isFinite(x01)) return 0;
  return clamp((x01 - 0.5) * 2, -1, 1) * width;
}

/** Enveloppe percussive : attaque puis décroissance (ms). Mouvement réduit : 150 ms au total, attaque 5 ms. */
export interface Envelope {
  attack: number;
  decay: number;
}

export function shortEnvelope(env: Envelope, reduced: boolean): Envelope {
  if (!reduced) return env;
  const attack = Math.min(env.attack, sound.reducedAttack);
  return { attack, decay: Math.max(0, motion.reduced - attack) };
}

/**
 * `max` indices (au plus) répartis régulièrement dans [0, n - 1], premier et dernier compris, croissants.
 * Sert à plafonner le nombre de notes sans perdre l'étendue de l'allumage.
 */
export function pickEvenly(n: number, max: number): number[] {
  const count = Math.max(0, Math.min(n, Math.floor(max)));
  if (count === 0) return [];
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, i) => Math.round((i * (n - 1)) / (count - 1)));
}

export interface NoteCue {
  /** Départ (ms depuis l'événement) */
  at: number;
  freq: number;
  pan: number;
}

/**
 * Allumage (acte 1) : une note par pôle allumé, dans l'ordre d'allumage déjà visible (durée aller
 * croissante), en montant dans la gamme ; au plus `pluck.maxNotes` notes. La hauteur suit le RANG
 * d'allumage, jamais une valeur : elle redit l'ordre, elle n'ajoute aucune information.
 * Mouvement réduit : un accord unique (D4, A4, D5), centré.
 */
export function planLightingCues(lit: readonly { x: number; delay: number }[], reduced: boolean): NoteCue[] {
  if (!lit.length) return [];
  if (reduced) return sound.pluck.chord.map((freq) => ({ at: 0, freq, pan: 0 }));
  const sorted = [...lit].sort((a, b) => a.delay - b.delay);
  const max = Math.min(sound.pluck.maxNotes, sound.scale.length);
  return pickEvenly(sorted.length, max).map((idx, rank) => ({
    at: Math.max(0, sorted[idx]!.delay),
    freq: sound.scale[rank]!,
    pan: panOf(sorted[idx]!.x),
  }));
}

/**
 * Or du gain (acte 4) : un carillon par pôle doré, au rythme de l'or (délais du moteur), au plus
 * `gain.maxNotes`. Mouvement réduit : un seul carillon, centré.
 */
export function planGainCues(gold: readonly { x: number; delay: number }[], reduced: boolean): { at: number; pan: number }[] {
  if (!gold.length) return [];
  if (reduced) return [{ at: 0, pan: 0 }];
  const sorted = [...gold].sort((a, b) => a.delay - b.delay);
  return pickEvenly(sorted.length, sound.gain.maxNotes).map((idx) => ({ at: Math.max(0, sorted[idx]!.delay), pan: panOf(sorted[idx]!.x) }));
}

/** Panoramique de l'éclipse : dans le sens du voile ; centré en mouvement réduit (pas de balayage). */
export function eclipsePan(direction: 1 | -1 | null, reduced: boolean): { from: number; to: number } {
  if (reduced || direction == null) return { from: 0, to: 0 };
  const p = sound.eclipse.pan;
  return direction === 1 ? { from: -p, to: p } : { from: p, to: -p };
}

/** Hauteur du tic de la jauge : redondante avec la position visible de la poignée (0 à 1). */
export function tickFrequency(fraction: number): number {
  const f = Number.isFinite(fraction) ? clamp(fraction, 0, 1) : 0;
  return sound.tick.lowHz + sound.tick.spanHz * f;
}

/** Un nouveau son est-il permis ? Au plus un toutes les `gapMs` (glisser de la jauge). */
export function throttleOk(last: number | null, now: number, gapMs: number): boolean {
  return last == null || now - last >= gapMs;
}

/** Durée de tenue de la nappe du halo : jusqu'à la fin du dernier arc. */
export function haloHold(arcs: number): number {
  return sound.halo.arcGrow + Math.max(0, Math.floor(arcs) - 1) * sound.halo.arcStagger;
}

export interface SweepSegment {
  /** Départ (ms depuis l'événement) */
  at: number;
  /** Durée du balayage (ms) */
  duration: number;
  fromHz: number;
  toHz: number;
  fromPan: number;
  toPan: number;
  /** Sens qui échoue : le son s'éteint au point d'arrêt en `fade` ms (comme la queue) ; null = fin normale */
  fade: number | null;
}

/**
 * Étoile filante : un balayage par arc, calé sur l'image (shooting.leg × fraction parcourue, pause
 * muette sur le pôle). Aller : grave → aigu, de l'étoile-guide vers le pôle ; retour : l'inverse.
 * La partie non parcourue n'est jamais jouée. Mouvement réduit : aucun son.
 */
export function shootingSegments(
  legs: readonly { dir: 'out' | 'back'; end: number; ok: boolean }[],
  fromX: number,
  toX: number,
  reduced: boolean,
): SweepSegment[] {
  if (reduced) return [];
  const { lowHz, highHz } = sound.shooting;
  const a = panOf(fromX);
  const b = panOf(toX);
  const out: SweepSegment[] = [];
  let t = 0;
  legs.forEach((leg, i) => {
    const end = clamp(leg.end, 0, 1);
    const duration = shootingMotion.leg * Math.max(0.5, end);
    const [f0, f1, p0, p1] = leg.dir === 'out' ? [lowHz, highHz, a, b] : [highHz, lowHz, b, a];
    out.push({
      at: t,
      duration,
      fromHz: f0,
      toHz: f0 + (f1 - f0) * end,
      fromPan: p0,
      toPan: p0 + (p1 - p0) * end,
      fade: leg.ok ? null : shootingMotion.failFade,
    });
    t += duration + (leg.ok ? 0 : shootingMotion.failFade);
    if (i < legs.length - 1) t += shootingMotion.pause;
  });
  return out;
}

export type Ease = 'linear' | 'inOutSine' | 'outQuart' | 'outExpo';

export function ease(name: Ease, t: number): number {
  const x = clamp(t, 0, 1);
  switch (name) {
    case 'inOutSine':
      return -(Math.cos(Math.PI * x) - 1) / 2;
    case 'outQuart':
      return 1 - Math.pow(1 - x, 4);
    case 'outExpo':
      return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
    default:
      return x;
  }
}

/** Courbe échantillonnée de `from` à `to` (setValueCurveAtTime), mêmes easings que l'image. */
export function easeCurve(from: number, to: number, name: Ease, points = 32): Float32Array {
  const n = Math.max(2, Math.floor(points));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = from + (to - from) * ease(name, i / (n - 1));
  return out;
}

/** Enveloppe en arche 0 → crête à mi-course → 0 (souffles de l'éclipse et du titre), en `inOutSine`. */
export function archCurve(peak: number, points = 32): Float32Array {
  const n = Math.max(3, Math.floor(points));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out[i] = peak * ease('inOutSine', t < 0.5 ? t * 2 : (1 - t) * 2);
  }
  return out;
}

/** Gain du fond selon la visite et le silence (multiplicateurs, hors fondu d'entrée). */
export function bedLevel(opts: { tour: boolean; silence: boolean }): number {
  return (opts.tour ? sound.tourDuck.gain : 1) * (opts.silence ? sound.silenceDuck : 1);
}

/**
 * Son activé au chargement : `?sound=1` ou `?sound=0` priment ; en mode enregistrement vidéo
 * (`?record=1`), coupé sauf `?sound=1` ; sinon le choix mémorisé (« on » / « off ») ; sinon
 * `sound.defaultOn`. Le son ne JOUE de toute façon qu'après un geste (sauf enregistrement).
 */
export function initialSoundOn(search: string, stored: string | null): boolean {
  const q = new URLSearchParams(search);
  const param = q.get('sound');
  if (param === '1') return true;
  if (param === '0') return false;
  if (q.get('record') === '1') return false;
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return sound.defaultOn;
}

/**
 * Voix de la visite activée au chargement : `?voice=1` ou `?voice=0` priment ; sinon le choix mémorisé
 * (« on » / « off ») ; sinon `sound.voice.defaultOn`. Indépendante du son d'ambiance (`?sound=`). En
 * mode enregistrement, le site ne joue pas la voix de toute façon (ffmpeg la pose sur la vidéo).
 */
export function initialVoiceOn(search: string, stored: string | null): boolean {
  const param = new URLSearchParams(search).get('voice');
  if (param === '1') return true;
  if (param === '0') return false;
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return sound.voice.defaultOn;
}

/** Faut-il démarrer le contexte audio sans geste ? Seulement pour l'enregistrement de la visite avec `?sound=1`. */
export function autoStartAllowed(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.get('record') === '1' && q.get('sound') === '1';
}
