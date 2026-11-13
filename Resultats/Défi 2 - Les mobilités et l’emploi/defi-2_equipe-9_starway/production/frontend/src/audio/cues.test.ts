import { describe, expect, it } from 'vitest';
import { motion, shooting, sound } from '../theme/tokens';
import {
  archCurve,
  autoStartAllowed,
  bedLevel,
  centsToRatio,
  dbToGain,
  easeCurve,
  eclipsePan,
  haloHold,
  initialSoundOn,
  initialVoiceOn,
  panOf,
  pickEvenly,
  planGainCues,
  planLightingCues,
  shootingSegments,
  shortEnvelope,
  throttleOk,
  tickFrequency,
} from './cues';

describe('conversions', () => {
  it('dB et cents', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 10);
    expect(centsToRatio(1200)).toBeCloseTo(2, 10);
    expect(centsToRatio(0)).toBe(1);
  });

  it('panoramique : x à l\'écran → [-0,6 ; 0,6], borné, centré si x invalide', () => {
    expect(panOf(0.5)).toBe(0);
    expect(panOf(0)).toBeCloseTo(-sound.pan);
    expect(panOf(1)).toBeCloseTo(sound.pan);
    expect(panOf(3)).toBeCloseTo(sound.pan);
    expect(panOf(Number.NaN)).toBe(0);
  });
});

describe('enveloppes', () => {
  it('mouvement réduit : 150 ms au total, attaque 5 ms au plus', () => {
    const e = shortEnvelope({ attack: 8, decay: 1400 }, true);
    expect(e.attack).toBe(sound.reducedAttack);
    expect(e.attack + e.decay).toBe(motion.reduced);
    expect(shortEnvelope({ attack: 3, decay: 500 }, true).attack).toBe(3);
    expect(shortEnvelope({ attack: 8, decay: 1400 }, false)).toEqual({ attack: 8, decay: 1400 });
  });

  it('arche : 0 → crête à mi-course → 0', () => {
    const c = archCurve(0.5, 33);
    expect(c[0]).toBeCloseTo(0, 6);
    expect(c[32]).toBeCloseTo(0, 6);
    expect(c[16]).toBeCloseTo(0.5, 6);
  });

  it('courbes : bornes exactes et monotones', () => {
    const c = easeCurve(900, 350, 'inOutSine', 16);
    expect(c[0]).toBe(900);
    expect(c[15]).toBeCloseTo(350, 3);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeLessThanOrEqual(c[i - 1]!);
  });
});

describe('allumage', () => {
  it('pickEvenly garde le premier et le dernier, au plus max', () => {
    expect(pickEvenly(3, 9)).toEqual([0, 1, 2]);
    expect(pickEvenly(13, 9)).toHaveLength(9);
    expect(pickEvenly(13, 9)[0]).toBe(0);
    expect(pickEvenly(13, 9).at(-1)).toBe(12);
    expect(pickEvenly(0, 9)).toEqual([]);
    expect(pickEvenly(5, 1)).toEqual([0]);
  });

  it('une note par pôle, dans l\'ordre d\'allumage (délais du moteur), en montant dans la gamme', () => {
    const lit = [
      { x: 0.9, delay: 70 },
      { x: 0.1, delay: 0 },
      { x: 0.5, delay: 35 },
    ];
    const notes = planLightingCues(lit, false);
    expect(notes.map((n) => n.at)).toEqual([0, 35, 70]);
    expect(notes.map((n) => n.freq)).toEqual(sound.scale.slice(0, 3));
    expect(notes[0]!.pan).toBeLessThan(0);
    expect(notes[2]!.pan).toBeGreaterThan(0);
  });

  it('au plus 9 notes, qui couvrent toute la durée de l\'allumage', () => {
    const lit = Array.from({ length: 14 }, (_, i) => ({ x: 0.5, delay: i * motion.stagger }));
    const notes = planLightingCues(lit, false);
    expect(notes).toHaveLength(sound.pluck.maxNotes);
    expect(notes[0]!.at).toBe(0);
    expect(notes.at(-1)!.at).toBe(13 * motion.stagger);
    expect(notes.at(-1)!.freq).toBe(sound.scale[8]);
  });

  it('mouvement réduit : un accord unique centré ; rien sans allumage', () => {
    const notes = planLightingCues([{ x: 0.2, delay: 0 }, { x: 0.8, delay: 35 }], true);
    expect(notes.map((n) => n.freq)).toEqual([...sound.pluck.chord]);
    expect(notes.every((n) => n.at === 0 && n.pan === 0)).toBe(true);
    expect(planLightingCues([], false)).toEqual([]);
    expect(planLightingCues([], true)).toEqual([]);
  });
});

describe('or du gain', () => {
  it('au plus 6 carillons, au rythme de l\'or', () => {
    const gold = Array.from({ length: 8 }, (_, i) => ({ x: 0.5, delay: i * 60 }));
    const cues = planGainCues(gold, false);
    expect(cues).toHaveLength(sound.gain.maxNotes);
    expect(cues[0]!.at).toBe(0);
    expect(cues.at(-1)!.at).toBe(7 * 60);
    expect(planGainCues(gold, true)).toEqual([{ at: 0, pan: 0 }]);
    expect(planGainCues([], false)).toEqual([]);
  });
});

describe('éclipse', () => {
  it('panoramique dans le sens du voile ; centré en mouvement réduit', () => {
    expect(eclipsePan(1, false)).toEqual({ from: -sound.eclipse.pan, to: sound.eclipse.pan });
    expect(eclipsePan(-1, false)).toEqual({ from: sound.eclipse.pan, to: -sound.eclipse.pan });
    expect(eclipsePan(1, true)).toEqual({ from: 0, to: 0 });
    expect(eclipsePan(null, false)).toEqual({ from: 0, to: 0 });
  });
});

describe('jauge', () => {
  it('hauteur du tic : redondante avec la position, bornée', () => {
    expect(tickFrequency(0)).toBe(sound.tick.lowHz);
    expect(tickFrequency(1)).toBe(sound.tick.lowHz + sound.tick.spanHz);
    expect(tickFrequency(2)).toBe(sound.tick.lowHz + sound.tick.spanHz);
    expect(tickFrequency(Number.NaN)).toBe(sound.tick.lowHz);
  });

  it('au plus un tic toutes les motion.scrubThrottle ms', () => {
    const gap = motion.scrubThrottle;
    expect(throttleOk(null, 0, gap)).toBe(true);
    expect(throttleOk(1000, 1000 + gap - 1, gap)).toBe(false);
    expect(throttleOk(1000, 1000 + gap, gap)).toBe(true);
  });
});

describe('étoile filante', () => {
  it('deux arcs réussis : aller grave → aigu vers le pôle, pause muette, retour inverse', () => {
    const segs = shootingSegments(
      [
        { dir: 'out', end: 1, ok: true },
        { dir: 'back', end: 1, ok: true },
      ],
      0.2,
      0.8,
      false,
    );
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ at: 0, duration: shooting.leg, fromHz: sound.shooting.lowHz, toHz: sound.shooting.highHz, fade: null });
    expect(segs[0]!.fromPan).toBeLessThan(0);
    expect(segs[0]!.toPan).toBeGreaterThan(0);
    expect(segs[1]!.at).toBe(shooting.leg + shooting.pause);
    expect(segs[1]!.fromHz).toBe(sound.shooting.highHz);
    expect(segs[1]!.toHz).toBe(sound.shooting.lowHz);
  });

  it('retour hors budget : le son s\'arrête à mi-chemin et s\'éteint comme la queue', () => {
    const segs = shootingSegments(
      [
        { dir: 'out', end: 1, ok: true },
        { dir: 'back', end: 0.5, ok: false },
      ],
      0.5,
      1,
      false,
    );
    const back = segs[1]!;
    expect(back.duration).toBe(shooting.leg * 0.5);
    expect(back.fade).toBe(shooting.failFade);
    const mid = sound.shooting.highHz + (sound.shooting.lowHz - sound.shooting.highHz) * 0.5;
    expect(back.toHz).toBeCloseTo(mid);
  });

  it('aller hors budget : un seul arc arrêté à 60 % ; mouvement réduit : aucun son', () => {
    const legs = [{ dir: 'out' as const, end: 0.6, ok: false }];
    const segs = shootingSegments(legs, 0, 1, false);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.duration).toBeCloseTo(shooting.leg * 0.6);
    expect(shootingSegments(legs, 0, 1, true)).toEqual([]);
  });
});

describe('halo et fond', () => {
  it('nappe tenue jusqu\'à la fin du dernier arc', () => {
    expect(haloHold(1)).toBe(sound.halo.arcGrow);
    expect(haloHold(4)).toBe(sound.halo.arcGrow + 3 * sound.halo.arcStagger);
    expect(haloHold(0)).toBe(sound.halo.arcGrow);
  });

  it('fond : abaissé pendant la visite, encore plus pendant le silence', () => {
    expect(bedLevel({ tour: false, silence: false })).toBe(1);
    expect(bedLevel({ tour: true, silence: false })).toBe(sound.tourDuck.gain);
    expect(bedLevel({ tour: true, silence: true })).toBeCloseTo(sound.tourDuck.gain * sound.silenceDuck);
  });
});

describe('réglage initial du son', () => {
  it('paramètre d\'URL, puis mode enregistrement, puis choix mémorisé, puis défaut', () => {
    expect(initialSoundOn('?sound=1', 'off')).toBe(true);
    expect(initialSoundOn('?sound=0', 'on')).toBe(false);
    expect(initialSoundOn('?record=1&tour=lea', 'on')).toBe(false);
    expect(initialSoundOn('?record=1&tour=lea&sound=1', null)).toBe(true);
    expect(initialSoundOn('', 'off')).toBe(false);
    expect(initialSoundOn('', 'on')).toBe(true);
    expect(initialSoundOn('', null)).toBe(sound.defaultOn);
    expect(initialSoundOn('', 'n importe quoi')).toBe(sound.defaultOn);
  });

  it('démarrage sans geste : seulement enregistrement + ?sound=1', () => {
    expect(autoStartAllowed('?record=1&sound=1')).toBe(true);
    expect(autoStartAllowed('?record=1')).toBe(false);
    expect(autoStartAllowed('?sound=1')).toBe(false);
  });
});

describe('voix de la visite : préférence propre, indépendante du son d’ambiance', () => {
  it('?voice= prime, puis le choix mémorisé, puis la valeur par défaut', () => {
    expect(initialVoiceOn('?voice=0', 'on')).toBe(false);
    expect(initialVoiceOn('?voice=1', 'off')).toBe(true);
    expect(initialVoiceOn('', 'off')).toBe(false);
    expect(initialVoiceOn('', 'on')).toBe(true);
    expect(initialVoiceOn('', null)).toBe(sound.voice.defaultOn);
  });
  it('le son coupé ne coupe pas la voix', () => {
    expect(initialSoundOn('?sound=0', null)).toBe(false);
    expect(initialVoiceOn('?sound=0', null)).toBe(sound.voice.defaultOn);
  });
});
