import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STEP_PAUSE_MS, stepDuration } from './timing';
import { TourPlayer, type TourDeps, type TourVoice, type VoiceHandlers } from './TourPlayer';
import type { TourScript, TourStep } from './types';

/** Faux audio : on décide à la main quand la piste se termine ou échoue. */
class FakeVoice implements TourVoice {
  calls: string[] = [];
  current: { index: number; on: VoiceHandlers } | null = null;
  /** Étapes qui ont un fichier (manifeste) */
  constructor(private readonly recorded: Set<number>) {}
  play(_step: TourStep, index: number, _text: string, on: VoiceHandlers): boolean {
    if (!this.recorded.has(index)) return false;
    this.calls.push(`play:${index}`);
    this.current = { index, on };
    return true;
  }
  pause() {
    this.calls.push('pause');
  }
  resume() {
    this.calls.push('resume');
  }
  stop() {
    this.calls.push('stop');
    this.current = null;
  }
  end() {
    const c = this.current;
    this.current = null;
    c?.on.ended();
  }
  fail() {
    const c = this.current;
    this.current = null;
    c?.on.error();
  }
}

const TEXT = ['Première étape de test.', 'Deuxième étape de test, un peu plus longue.', 'Troisième.'];

function script(minDurationMs?: number[]): TourScript {
  return {
    id: 'test',
    title: 'Test',
    disclaimer: '',
    ready: true,
    steps: TEXT.map((narration, i) => ({
      id: `s${i}`,
      act: 'acte1',
      state: {},
      narration,
      ...(minDurationMs?.[i] != null ? { minDurationMs: minDurationMs[i] } : {}),
    })),
  };
}

interface Harness {
  player: TourPlayer;
  voice: FakeVoice;
  ui: { status: string; stepIndex: number }[];
  finished: string[];
}

function harness(opts: { recorded?: number[]; audioMs?: number[]; min?: number[]; speed?: number; deps?: Partial<TourDeps> } = {}): Harness {
  const voice = new FakeVoice(new Set(opts.recorded ?? []));
  const ui: Harness['ui'] = [];
  const finished: string[] = [];
  const player = new TourPlayer(script(opts.min), {
    apply: async () => {},
    waitForSky: async () => {},
    resolve: (step) => ({ text: step.narration, missing: [] }),
    snapshot: () => {},
    onUpdate: (u) => ui.push({ status: u.status, stepIndex: u.stepIndex }),
    audioMs: (i) => opts.audioMs?.[i],
    voice,
    speed: opts.speed,
    onFinish: (kind) => finished.push(kind),
    ...opts.deps,
  });
  return { player, voice, ui, finished };
}

const last = (h: Harness) => h.ui[h.ui.length - 1]!;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TourPlayer : étape dont la voix n’attend pas le ciel (épilogue)', () => {
  it('la voix démarre sans attendre que le ciel soit posé', async () => {
    const sky = vi.fn(() => new Promise<void>(() => {}));
    const voice = new FakeVoice(new Set([0]));
    const script0 = script();
    script0.steps[0] = { ...script0.steps[0]!, voiceOverSky: true };
    const player = new TourPlayer(script0, {
      apply: async () => {},
      waitForSky: sky,
      resolve: (step) => ({ text: step.narration, missing: [] }),
      snapshot: () => {},
      onUpdate: () => {},
      voice,
    });
    player.start();
    await flush();
    expect(sky).not.toHaveBeenCalled();
    expect(voice.calls).toContain('play:0');
  });
});

describe('TourPlayer : pause puis reprise pendant la pose du ciel (retour de Cyril du 12/11)', () => {
  function slowSky() {
    let release: () => void = () => {};
    const sky = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    const h = harness({
      deps: {
        waitForSky: () => {
          if (!first) return Promise.resolve();
          first = false;
          return sky;
        },
      },
    });
    return { h, release };
  }

  it('ne saute pas l’étape : le minuteur restant de l’étape d’avant n’est pas relancé', async () => {
    const { h, release } = slowSky();
    h.player.start();
    await flush();
    h.player.pause();
    h.player.resume();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(last(h)).toMatchObject({ status: 'playing', stepIndex: 0 });
    release();
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(last(h)).toMatchObject({ status: 'playing', stepIndex: 0 });
  });

  it('en pause jusqu’à la fin de la pose : l’étape démarre en pause, la reprise la joue jusqu’au bout', async () => {
    const { h, release } = slowSky();
    h.player.start();
    await flush();
    h.player.pause();
    release();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(last(h)).toMatchObject({ status: 'paused', stepIndex: 0 });
    h.player.resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(last(h).stepIndex).toBeGreaterThan(0);
  });
});

describe('TourPlayer : l’utilisateur défait l’étape pendant sa pose (audit du 09/11)', () => {
  function closable() {
    let closed = false;
    const applied: string[] = [];
    const missing: string[] = [];
    const h = harness({
      deps: {
        apply: async (step) => {
          applied.push(step.id);
          closed = false;
        },
        // Le panneau a été fermé au moment où la visite l'ouvrait : les variables du pôle manqueraient
        afterSky: () => {
          closed = applied.length === 1;
        },
        interrupted: () => closed,
        resolve: (step) => (closed ? { text: '', missing: ['pole.out'] } : { text: step.narration, missing: [] }),
        onMissing: (step) => missing.push(step.id),
      },
    });
    return { h, applied, missing };
  }

  it('la visite se met en pause, sans arrêt ni variable manquante', async () => {
    const { h, missing } = closable();
    h.player.start();
    await flush();
    expect(last(h).status).toBe('paused');
    expect(h.finished).toEqual([]);
    expect(missing).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(last(h)).toEqual({ status: 'paused', stepIndex: 0 });
  });

  it('« Reprendre » rejoue l’étape (le panneau se rouvre) et la visite continue', async () => {
    const { h, applied } = closable();
    h.player.start();
    await flush();
    h.player.resume();
    await flush();
    expect(applied).toEqual(['s0', 's0']);
    expect(last(h)).toEqual({ status: 'playing', stepIndex: 0 });
    await vi.advanceTimersByTimeAsync(stepDuration(TEXT[0]!));
    expect(last(h).stepIndex).toBe(1);
    expect(h.finished).toEqual([]);
  });

  it('« Suivant » depuis cette pause passe à l’étape suivante', async () => {
    const { h, applied } = closable();
    h.player.start();
    await flush();
    h.player.next();
    await flush();
    expect(applied).toEqual(['s0', 's1']);
    expect(last(h)).toEqual({ status: 'playing', stepIndex: 1 });
  });

  it('une vraie variable manquante, sans geste de l’utilisateur, arrête toujours la visite', async () => {
    const missing: string[] = [];
    const h = harness({
      deps: {
        interrupted: () => false,
        resolve: () => ({ text: '', missing: ['pole.out'] }),
        onMissing: (step) => missing.push(step.id),
      },
    });
    h.player.start();
    await flush();
    expect(missing).toEqual(['s0']);
    expect(h.finished).toEqual(['abort']);
  });
});

describe('TourPlayer et narration enregistrée', () => {
  it('fin d’étape sur « ended » : l’étape attend l’audio, puis la respiration', async () => {
    const h = harness({ recorded: [0, 1, 2], audioMs: [1000, 1000, 1000] });
    h.player.start();
    await flush();
    expect(h.voice.calls).toEqual(['play:0']);
    // l'audio dure plus longtemps que prévu : l'étape ne passe pas au minuteur
    await vi.advanceTimersByTimeAsync(60_000);
    expect(last(h).stepIndex).toBe(0);
    h.voice.end();
    await vi.advanceTimersByTimeAsync(STEP_PAUSE_MS - 1);
    expect(last(h).stepIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(last(h).stepIndex).toBe(1);
    expect(h.voice.calls).toContain('play:1');
  });

  it('audio plus court que minDurationMs : l’étape tient sa durée minimale', async () => {
    const h = harness({ recorded: [0], min: [8000] });
    h.player.start();
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    h.voice.end();
    await vi.advanceTimersByTimeAsync(8000 - 3000 + STEP_PAUSE_MS - 1);
    expect(last(h).stepIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(last(h).stepIndex).toBe(1);
  });

  it('pause et reprise pilotent l’audio ; le temps en pause ne compte pas', async () => {
    const h = harness({ recorded: [0], min: [4000] });
    h.player.start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    h.player.pause();
    expect(h.voice.calls).toEqual(['play:0', 'pause']);
    expect(last(h).status).toBe('paused');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(last(h).stepIndex).toBe(0);
    h.player.resume();
    expect(h.voice.calls).toEqual(['play:0', 'pause', 'resume']);
    await vi.advanceTimersByTimeAsync(1000);
    h.voice.end(); // 2 000 ms de narration jouée, minimum 4 000
    await vi.advanceTimersByTimeAsync(2000 + STEP_PAUSE_MS - 1);
    expect(last(h).stepIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(last(h).stepIndex).toBe(1);
  });

  it('pause pendant la respiration après l’audio : la reprise finit la respiration', async () => {
    const h = harness({ recorded: [0] });
    h.player.start();
    await flush();
    h.voice.end();
    await vi.advanceTimersByTimeAsync(400);
    h.player.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(last(h).stepIndex).toBe(0);
    h.player.resume();
    expect(h.voice.calls).not.toContain('resume'); // l'audio est fini : rien à relancer
    await vi.advanceTimersByTimeAsync(STEP_PAUSE_MS - 400);
    expect(last(h).stepIndex).toBe(1);
  });

  it('fichier absent (pas dans le manifeste) : durée estimée, comme sans audio', async () => {
    const h = harness({ recorded: [] });
    h.player.start();
    await flush();
    expect(h.voice.calls).toEqual([]);
    const d = stepDuration(TEXT[0]!, undefined, undefined);
    await vi.advanceTimersByTimeAsync(d - 1);
    expect(last(h).stepIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(last(h).stepIndex).toBe(1);
  });

  it('sans aucun audio branché : comportement inchangé', async () => {
    const h = harness({ deps: { voice: undefined } });
    h.player.start();
    await flush();
    const d0 = stepDuration(TEXT[0]!);
    const d1 = stepDuration(TEXT[1]!);
    await vi.advanceTimersByTimeAsync(d0 + d1);
    expect(last(h).stepIndex).toBe(2);
  });

  it('audio en erreur : repli sur la durée calculée, temps déjà joué déduit', async () => {
    const h = harness({ recorded: [0], audioMs: [5000] });
    h.player.start();
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    h.voice.fail();
    const total = stepDuration(TEXT[0]!, undefined, 5000);
    await vi.advanceTimersByTimeAsync(total - 2000 - 1);
    expect(last(h).stepIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(last(h).stepIndex).toBe(1);
  });

  it('suivant, précédent, stop coupent l’audio ; un « ended » périmé est ignoré', async () => {
    const h = harness({ recorded: [0, 1, 2] });
    h.player.start();
    await flush();
    const stale = h.voice.current!.on;
    h.player.next();
    await flush();
    expect(h.voice.calls).toEqual(['play:0', 'stop', 'play:1']);
    stale.ended();
    await vi.advanceTimersByTimeAsync(STEP_PAUSE_MS * 3);
    expect(last(h).stepIndex).toBe(1);
    h.player.prev();
    await flush();
    expect(last(h).stepIndex).toBe(0);
    expect(h.voice.calls.slice(-2)).toEqual(['stop', 'play:0']);
    h.player.stop();
    expect(h.voice.calls[h.voice.calls.length - 1]).toBe('stop');
    expect(last(h).status).toBe('ended');
    expect(h.finished).toEqual(['abort']);
  });

  it('fin naturelle : dernière étape terminée par son audio', async () => {
    const h = harness({ recorded: [0, 1, 2] });
    h.player.start();
    for (let i = 0; i < 3; i++) {
      await flush();
      h.voice.end();
      await vi.advanceTimersByTimeAsync(STEP_PAUSE_MS);
    }
    expect(last(h).status).toBe('ended');
    expect(h.finished).toEqual(['end']);
  });

  it('mise en pause pendant la pose du ciel : l’audio part en pause et attend la reprise', async () => {
    let release!: () => void;
    const sky = new Promise<void>((r) => (release = r));
    const h = harness({ recorded: [0], deps: { waitForSky: () => sky } });
    h.player.start();
    await flush();
    h.player.pause();
    release();
    await flush();
    expect(h.voice.calls).toEqual(['play:0', 'pause']);
    h.player.resume();
    expect(h.voice.calls).toEqual(['play:0', 'pause', 'resume']);
  });

  it('vitesse de vérification (dev, ?tourspeed) : pas d’audio', async () => {
    const h = harness({ recorded: [0, 1, 2], speed: 4 });
    h.player.start();
    await flush();
    expect(h.voice.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(stepDuration(TEXT[0]!) / 4);
    expect(last(h).stepIndex).toBe(1);
  });
});
