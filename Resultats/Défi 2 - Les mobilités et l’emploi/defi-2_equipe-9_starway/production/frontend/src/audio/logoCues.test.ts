import { describe, expect, it } from 'vitest';
import { LOGO_STARS } from '../data/logoGeometry';
import { buildLogoTimeline } from '../data/logoRevealTimeline';
import { sound } from '../theme/tokens';
import { planLogoScene, starPan, type LogoCue } from './logoCues';

const tl = buildLogoTimeline();
const XS = LOGO_STARS.map((s) => s.x);
const of = <K extends LogoCue['kind']>(cues: LogoCue[], kind: K) => cues.filter((c): c is Extract<LogoCue, { kind: K }> => c.kind === kind);

describe('plan sonore du logo', () => {
  const plan = planLogoScene(tl, XS);

  it('tout est dans l’ordre de l’image : étoile dorée, sauts, verrouillages, point final, mot, lumière', () => {
    const at = plan.map((c) => c.at);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(plan[0]?.kind).toBe('ignite');
    expect(plan[0]?.at).toBe(tl.arrivals[0]);
    expect(of(plan, 'impact')[0]?.at).toBe(tl.finalAt);
    expect(of(plan, 'word')[0]?.at).toBe(tl.letterAt[0]);
    expect(of(plan, 'sweep')[0]?.at).toBe(tl.sweepAt);
  });

  it('un verrouillage à chaque étoile après la dorée, net sur l’instant de l’image, et de plus en plus aigu', () => {
    const locks = of(plan, 'lock');
    expect(locks.map((l) => l.at)).toEqual(tl.arrivals.slice(1));
    for (let i = 1; i < locks.length; i++) expect(locks[i]?.freq as number).toBeGreaterThan(locks[i - 1]?.freq as number);
  });

  it('la tension monte avec l’accélération : chaque saut plus aigu, plus fort, plus court, sans trou de hauteur', () => {
    const c = of(plan, 'comet');
    expect(c).toHaveLength(4);
    for (let i = 1; i < c.length; i++) {
      const [p, q] = [c[i - 1], c[i]] as [(typeof c)[number], (typeof c)[number]];
      expect(q.fromHz).toBeCloseTo(p.toHz, 5);
      expect(q.riseFromHz).toBe(p.riseToHz);
      expect(q.level).toBeGreaterThan(p.level);
      expect(q.riseLevel).toBeGreaterThan(p.riseLevel);
      expect(q.ms).toBeLessThan(p.ms);
    }
  });

  it('chaque saut part de son étoile et finit sur la suivante, de gauche à droite', () => {
    const c = of(plan, 'comet');
    expect(c[0]?.panFrom).toBeCloseTo(-sound.pan);
    expect(c[3]?.panTo).toBeCloseTo(sound.pan);
    expect(starPan(5, [5, 5])).toBe(0);
  });

  it('geste en cours de route : aucun rattrapage, seuls les sons à venir', () => {
    const from = (tl.arrivals[2] as number) + 10;
    const late = planLogoScene(tl, XS, from);
    expect(late.every((c) => c.at >= from + sound.logo.joinMargin)).toBe(true);
    expect(of(late, 'ignite')).toHaveLength(0);
    expect(of(late, 'lock').map((l) => l.step)).toEqual([2, 3]);
    expect(of(late, 'comet').map((c) => c.step)).toEqual([3]);
  });

  it('un son sur le point de partir est laissé de côté, plutôt que de sonner en retard', () => {
    const at = tl.arrivals[1] as number;
    expect(of(planLogoScene(tl, XS, at - sound.logo.joinMargin + 1), 'lock').map((l) => l.at)).not.toContain(at);
    expect(of(planLogoScene(tl, XS, at - sound.logo.joinMargin), 'lock').map((l) => l.at)).toContain(at);
  });

  it('scène finie : plus rien à jouer', () => {
    expect(planLogoScene(tl, XS, tl.end)).toEqual([]);
  });

  it('un seul son par étape : pas de doublon', () => {
    expect(of(plan, 'ignite')).toHaveLength(1);
    expect(of(plan, 'impact')).toHaveLength(1);
    expect(of(plan, 'word')).toHaveLength(1);
    expect(of(plan, 'sweep')).toHaveLength(1);
  });

  it('niveaux bas : rien au-dessus de la cloche de l’étoile-guide (sauf la basse de l’impact), survol sous le tic de la jauge', () => {
    const l = sound.logo;
    for (const v of [l.ignite.level, l.lock.level, l.word.level, l.sweep.level, l.hover.level, l.replay.level, l.sprint.level, l.back.level]) {
      expect(v).toBeLessThanOrEqual(sound.guide.level);
    }
    expect(l.hover.level).toBeLessThan(sound.tick.level);
  });
});
