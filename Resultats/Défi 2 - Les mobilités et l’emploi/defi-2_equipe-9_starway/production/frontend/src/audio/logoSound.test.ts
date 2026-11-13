import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLogoTimeline } from '../data/logoRevealTimeline';
import { logoReveal, sound } from '../theme/tokens';
import type { AudioEngine } from './engine';
import { LogoSound } from './logoSound';
import { noise, pad, swell, tone } from './voices';

vi.mock('./voices', () => ({ noise: vi.fn(), pad: vi.fn(), swell: vi.fn(), tone: vi.fn() }));

const tl = buildLogoTimeline();
const LOCK = sound.logo.lock.notes as readonly number[];
const gain = () => ({ gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() });

function setup(state: AudioContextState | null = 'running') {
  const ctx = state ? { state, currentTime: 100, createGain: gain, resume: vi.fn(() => Promise.resolve()) } : null;
  const engine = {
    ctx,
    get running() {
      return this.ctx?.state === 'running';
    },
    at: (ms = 0) => 100 + ms / 1000,
    voice: () => (ctx ? { ctx, dry: gain(), wet: gain(), noise: {} } : null),
  };
  let allowed = true;
  const logo = new LogoSound(engine as unknown as AudioEngine, () => allowed);
  return { logo, ctx, setAllowed: (v: boolean) => (allowed = v) };
}
const calls = () => vi.mocked(tone).mock.calls.length + vi.mocked(noise).mock.calls.length + vi.mocked(swell).mock.calls.length + vi.mocked(pad).mock.calls.length;
/** Notes de verre des verrouillages (seul timbre à deux partiels triangle + sinus dans cette liste) */
const lockNotes = () => vi.mocked(tone).mock.calls.filter((c) => c[2].partials[0]?.type === 'triangle').map((c) => c[2].freq);

describe('sons du logo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('sans geste (pas de contexte) : aucun son, aucune erreur', () => {
    const { logo } = setup(null);
    expect(() => {
      logo.scenePlay(tl, performance.now());
      logo.join();
      logo.hover(0, 0);
      logo.sprint();
      logo.back();
      logo.stop();
    }).not.toThrow();
    expect(calls()).toBe(0);
  });

  it('contexte prêt : toute la scène, chaque verrouillage plus aigu que le précédent', () => {
    const { logo } = setup();
    logo.scenePlay(tl, performance.now());
    expect(lockNotes()).toEqual([...LOCK]);
    const whens = vi.mocked(tone).mock.calls.map((c) => c[1]);
    expect(Math.min(...whens)).toBeCloseTo(100 + (tl.arrivals[0] as number) / 1000, 1);
  });

  it('une scène n’est programmée qu’une fois, même si les gestes s’enchaînent', () => {
    const { logo } = setup();
    logo.scenePlay(tl, performance.now());
    const n = calls();
    logo.join();
    logo.join();
    expect(calls()).toBe(n);
  });

  it('bouton son coupé : rien ; quand on le remet, seule la suite de la scène sonne', () => {
    const { logo, setAllowed } = setup();
    setAllowed(false);
    logo.scenePlay(tl, performance.now());
    expect(calls()).toBe(0);
    setAllowed(true);
    vi.advanceTimersByTime((tl.arrivals[3] as number) + 5);
    logo.join();
    expect(lockNotes()).toEqual([LOCK[3]]);
  });

  it('couper le son en pleine scène puis le remettre ne rejoue pas ce qui est passé', () => {
    const { logo } = setup();
    logo.scenePlay(tl, performance.now());
    logo.cancel();
    vi.clearAllMocks();
    vi.advanceTimersByTime(tl.finalAt + 5);
    logo.join();
    expect(lockNotes()).toEqual([]);
  });

  it('premier geste : on attend le réveil du contexte, puis seuls les sons à venir partent', async () => {
    const { logo, ctx } = setup('suspended');
    logo.scenePlay(tl, performance.now());
    expect(ctx?.resume).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(0);
    vi.advanceTimersByTime((tl.arrivals[2] as number) + 5);
    (ctx as { state: string }).state = 'running';
    await Promise.resolve();
    await Promise.resolve();
    expect(lockNotes()).toEqual([LOCK[2], LOCK[3]]);
  });

  it('contexte bloqué (reprise refusée) : aucune erreur, aucun son', async () => {
    const { logo, ctx } = setup('suspended');
    if (ctx) ctx.resume = vi.fn(() => Promise.reject(new Error('bloqué')));
    logo.scenePlay(tl, performance.now());
    await Promise.resolve();
    await Promise.resolve();
    expect(calls()).toBe(0);
  });

  it('survol : limité dans le temps, jamais pendant une scène', () => {
    const { logo } = setup();
    logo.hover(1, 1000);
    logo.hover(2, 1000 + sound.logo.hover.minGapMs - 1);
    logo.hover(3, 1000 + sound.logo.hover.minGapMs);
    expect(vi.mocked(tone).mock.calls.map((c) => c[2].freq)).toEqual([sound.logo.hover.notes[1], sound.logo.hover.notes[3]]);
    vi.clearAllMocks();
    logo.scenePlay(tl, performance.now());
    const n = calls();
    logo.hover(0, 99999);
    expect(calls()).toBe(n);
    // scène finie : le survol répond de nouveau
    vi.advanceTimersByTime(tl.end + 1);
    logo.hover(0, 199999);
    expect(calls()).toBe(n + 1);
  });

  it('survol : rien tant que le contexte ne tourne pas', () => {
    const { logo } = setup('suspended');
    logo.hover(0, 0);
    expect(calls()).toBe(0);
  });

  it('sprint : la scène s’efface, une seule montée, conclue sur le dernier verrouillage à la fin du sprint', () => {
    const { logo } = setup();
    logo.scenePlay(tl, performance.now());
    vi.clearAllMocks();
    logo.sprint();
    expect(vi.mocked(swell).mock.calls).toHaveLength(1);
    expect(vi.mocked(swell).mock.calls[0]?.[2].duration).toBe(logoReveal.sprint);
    expect(lockNotes()).toEqual([LOCK[3]]);
    expect(vi.mocked(tone).mock.calls[1]?.[1]).toBeCloseTo(100 + logoReveal.sprint / 1000, 5);
    // la scène ne revient pas au geste suivant
    vi.clearAllMocks();
    logo.join();
    expect(calls()).toBe(0);
  });

  it('clic pour rejouer : le retour en arrière, puis toute la scène', () => {
    const { logo } = setup();
    logo.scenePlay(tl, performance.now(), true);
    const first = vi.mocked(tone).mock.calls[0]?.[2];
    expect(first?.glideTo).toBe(sound.logo.replay.toHz);
    expect(first?.glideMs).toBe(logoReveal.cameraIn);
    expect(lockNotes()).toEqual([...LOCK]);
  });

  it('retour au titre : deux notes qui descendent', () => {
    const { logo } = setup();
    logo.back();
    const c = vi.mocked(tone).mock.calls;
    expect(c.map((x) => x[2].freq)).toEqual([...sound.logo.back.notes]);
    expect(c[0]?.[2].freq as number).toBeGreaterThan(c[1]?.[2].freq as number);
  });

  it('sortie du titre : plus aucune scène, même au geste suivant', () => {
    const { logo } = setup();
    logo.scenePlay(tl, performance.now());
    logo.stop();
    vi.clearAllMocks();
    logo.join();
    expect(calls()).toBe(0);
  });
});
