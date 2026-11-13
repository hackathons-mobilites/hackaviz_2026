/**
 * Plan sonore de l'animation du logo (motion-spec, « Le logo se verrouille », § Son). Fonctions PURES, testées sans
 * contexte audio : la chronologie de l'image donne les instants, ce plan donne les sons. Aucune donnée ici.
 */
import type { LogoTimeline } from '../data/logoRevealTimeline';
import { logoReveal, sound } from '../theme/tokens';
import { panOf } from './cues';

export type LogoCue =
  | { kind: 'ignite'; at: number; pan: number }
  | {
      kind: 'comet';
      at: number;
      ms: number;
      step: number;
      fromHz: number;
      toHz: number;
      level: number;
      riseFromHz: number;
      riseToHz: number;
      riseLevel: number;
      panFrom: number;
      panTo: number;
    }
  | { kind: 'lock'; at: number; step: number; freq: number; pan: number }
  | { kind: 'impact'; at: number; pan: number }
  | { kind: 'word'; at: number; ms: number }
  | { kind: 'sweep'; at: number; ms: number };

/** Panoramique d'une étoile du symbole : `xs` = abscisses des étoiles, de gauche à droite. */
export const starPan = (x: number, xs: readonly number[]): number => {
  const first = xs[0] ?? 0;
  const last = xs[xs.length - 1] ?? 1;
  return panOf(last === first ? 0.5 : (x - first) / (last - first));
};

/**
 * Tous les sons de la scène, dans l'ordre. `from` (ms, temps de la scène) : un geste arrive en cours de route : seuls les
 * sons qui n'ont pas encore commencé sont gardés. Pas de rattrapage, jamais de son déjà commencé.
 */
export function planLogoScene(
  tl: LogoTimeline,
  xs: readonly number[],
  from = -Infinity,
  t: typeof logoReveal = logoReveal,
  s: typeof sound.logo = sound.logo,
): LogoCue[] {
  const pan = (i: number) => starPan(xs[i] ?? 0, xs);
  const cues: LogoCue[] = [{ kind: 'ignite', at: tl.arrivals[0] as number, pan: pan(0) }];
  for (let i = 0; i < tl.arrivals.length - 1; i++) {
    const a = tl.arrivals[i] as number;
    const b = tl.arrivals[i + 1] as number;
    cues.push({
      kind: 'comet',
      at: a,
      ms: b - a,
      step: i,
      fromHz: s.comet.fromHz * s.comet.hzRatio ** i,
      toHz: s.comet.fromHz * s.comet.hzRatio ** (i + 1),
      level: s.comet.level + i * s.comet.levelStep,
      riseFromHz: s.comet.rise[i] as number,
      riseToHz: s.comet.rise[i + 1] as number,
      riseLevel: s.comet.riseLevel + i * s.comet.riseLevelStep,
      panFrom: pan(i),
      panTo: pan(i + 1),
    });
    cues.push({ kind: 'lock', at: b, step: i, freq: s.lock.notes[i] as number, pan: pan(i + 1) });
  }
  cues.push({ kind: 'impact', at: tl.finalAt, pan: pan(tl.arrivals.length - 1) });
  const wordAt = tl.letterAt[0] as number;
  cues.push({ kind: 'word', at: wordAt, ms: tl.sweepAt + t.sweep - wordAt });
  cues.push({ kind: 'sweep', at: tl.sweepAt, ms: t.sweep });
  return cues.filter((c) => c.at >= from + s.joinMargin).sort((a, b) => a.at - b.at);
}
