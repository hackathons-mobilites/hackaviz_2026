/**
 * Lecteur de visite guidée : pour chaque étape → applyScenario(state) → attente de la fin de transition
 * du ciel → sous-titre résolu → narration → étape suivante.
 *
 * Fin d'une étape :
 * - narration enregistrée (`voice`, MP3 de tools/tour-tts) : fin naturelle de l'audio (« ended »), puis
 *   le reste de `minDurationMs` s'il est plus long, puis la respiration `STEP_PAUSE_MS` ;
 * - sans audio (cas par défaut) ou si l'audio ne se lit pas : durée calculée par `stepDuration`
 *   (durée audio connue, sinon ~14 caractères/s), comme avant.
 * Pause, reprise, suivant, précédent et arrêt pilotent l'audio avec le minuteur.
 */
import { STEP_PAUSE_MS, stepDuration } from './timing';
import type { TourScript, TourStep } from './types';

/** Fin de l'audio d'une étape : naturelle (« ended ») ou en erreur (fichier illisible, lecture refusée) */
export interface VoiceHandlers {
  ended: () => void;
  error: () => void;
}

/**
 * Narration enregistrée, vue du lecteur. Une seule piste à la fois (un seul élément audio pour toute
 * la visite). Implémentation navigateur : tour/voice.ts ; faux audio dans les tests.
 */
export interface TourVoice {
  /**
   * Démarre l'audio de l'étape s'il existe pour CE texte (manifeste : `durationMs` de tour.resolved.json).
   * false : pas d'audio, l'étape suit la durée estimée. true : `ended` ou `error` sera appelé (sauf arrêt).
   */
  play(step: TourStep, index: number, text: string, on: VoiceHandlers): boolean;
  pause(): void;
  resume(): void;
  /** Coupe la piste courante (étape suivante, précédente, fin de visite) : plus aucun rappel */
  stop(): void;
}

export interface TourDeps {
  apply: (step: TourStep) => Promise<void>;
  waitForSky: () => Promise<void>;
  /** Résout la narration de l'étape APRÈS application de son état */
  resolve: (step: TourStep) => { text: string; missing: string[] };
  /** Capture l'état courant (pour les deltas) avant d'appliquer l'étape */
  snapshot: () => void;
  onUpdate: (ui: {
    status: 'playing' | 'paused' | 'ended' | 'idle';
    stepIndex: number;
    subtitle: string;
    act: string;
    stepMs?: number;
  }) => void;
  /** Appelé si une variable manque : on ne prononce jamais un trou */
  onMissing?: (step: TourStep, missing: string[]) => void;
  /** Facteur de vitesse (vérification en dev) ; 1 par défaut. Différent de 1 : pas d'audio */
  speed?: number;
  /** La narration de l'étape commence (sous-titre affiché = début de l'audio) */
  onStepStart?: (step: TourStep, index: number, text: string) => void;
  /** Durée de l'audio de l'étape (ms), si connue pour ce texte (tour.resolved.json) */
  audioMs?: (index: number, text: string) => number | undefined;
  /** Narration enregistrée ; absente = durée estimée seulement */
  voice?: TourVoice;
  /** Le ciel est posé, avant la narration : effets de l'étape (silence, étoile filante) */
  afterSky?: (step: TourStep, index: number) => Promise<void> | void;
  /** Fin naturelle (« end ») ou interruption (« abort », avec la raison) */
  onFinish?: (kind: 'end' | 'abort', reason?: string) => void;
  /**
   * L'utilisateur a défait l'état de l'étape pendant sa pose (panneau de preuve ou carte fermés au moment où la visite les ouvre) :
   * la narration n'est pas résolue sur cet état, la visite se met en pause et « Reprendre » rejoue l'étape.
   */
  interrupted?: (step: TourStep) => boolean;
}

export class TourPlayer {
  private index = -1;
  private timer: number | undefined;
  private remaining = 0;
  private startedAt = 0;
  private status: 'idle' | 'playing' | 'paused' | 'ended' = 'idle';
  private run = 0;
  private subtitle = '';
  private stepMs = 0;
  /** L'étape attend la fin de son audio */
  private waitingVoice = false;
  /** Temps de narration écoulé dans l'étape (hors pauses), pour `minDurationMs` */
  private activeMs = 0;
  private activeSince = 0;
  private minMs = 0;
  /** Durée calculée de l'étape (repli si l'audio échoue) */
  private fallbackMs = 0;
  /** Pause posée parce que l'utilisateur a défait l'étape : la reprise la rejoue */
  private held = false;
  /**
   * L'étape se prépare (état appliqué, ciel posé) : ni la voix ni le minuteur ne sont encore lancés. Une pause puis une reprise à ce moment
   * ne doivent rien programmer (retour de Cyril du 12/11 : « si on clique sur pause, par moment ça déconne quand on relance ») : le minuteur
   * restant était celui de l'étape d'AVANT et passait tout de suite à la suivante ; `goTo` lit l'état à la fin de la préparation.
   */
  private preparing = false;

  private script: TourScript;
  private deps: TourDeps;

  constructor(script: TourScript, deps: TourDeps) {
    this.script = script;
    this.deps = deps;
  }

  get stepCount(): number {
    return this.script.steps.length;
  }

  get isPlaying(): boolean {
    return this.status === 'playing';
  }

  start(): void {
    void this.goTo(0);
  }

  pause(): void {
    if (this.status !== 'playing') return;
    window.clearTimeout(this.timer);
    if (this.preparing) {
      // rien à figer : ni voix ni minuteur
    } else if (this.waitingVoice) {
      this.activeMs += performance.now() - this.activeSince;
      this.deps.voice?.pause();
    } else {
      this.remaining = Math.max(0, this.remaining - (performance.now() - this.startedAt));
    }
    this.status = 'paused';
    this.emit();
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.status = 'playing';
    this.emit();
    if (this.preparing) return;
    if (this.held) {
      void this.goTo(this.index);
      return;
    }
    if (this.waitingVoice) {
      this.activeSince = performance.now();
      this.deps.voice?.resume();
    } else {
      this.schedule(this.remaining);
    }
  }

  next(): void {
    if (this.index + 1 < this.script.steps.length) void this.goTo(this.index + 1);
    else this.finish('end');
  }

  prev(): void {
    void this.goTo(Math.max(0, this.index - 1));
  }

  /** Quitte la visite en laissant l'utilisateur dans l'état courant. */
  stop(reason = 'arrêt de la visite'): void {
    this.finish('abort', reason);
  }

  private stopVoice(): void {
    if (!this.waitingVoice) return;
    this.waitingVoice = false;
    this.deps.voice?.stop();
  }

  private finish(kind: 'end' | 'abort', reason?: string): void {
    if (this.status === 'ended') return;
    window.clearTimeout(this.timer);
    this.stopVoice();
    this.run++;
    this.preparing = false;
    this.status = 'ended';
    this.subtitle = 'À vous d’explorer.';
    this.emit();
    this.deps.onFinish?.(kind, reason);
  }

  private async goTo(i: number): Promise<void> {
    window.clearTimeout(this.timer);
    this.stopVoice();
    const run = ++this.run;
    const step = this.script.steps[i];
    if (!step) return this.finish('end');
    this.index = i;
    this.status = 'playing';
    this.held = false;
    this.preparing = true;
    this.deps.snapshot();
    await this.deps.apply(step);
    if (!step.voiceOverSky) await this.deps.waitForSky();
    if (run !== this.run) return;
    await this.deps.afterSky?.(step, i);
    if (run !== this.run) return;
    if (this.deps.interrupted?.(step)) {
      this.preparing = false;
      this.held = true;
      this.status = 'paused';
      this.emit();
      return;
    }
    const { text, missing } = this.deps.resolve(step);
    if (missing.length) {
      this.deps.onMissing?.(step, missing);
      this.stop(`variable manquante : ${missing.join(', ')} (étape ${step.id})`);
      return;
    }
    this.subtitle = text;
    this.emit();
    this.deps.onStepStart?.(step, i, text);
    if (run !== this.run) return; // interrompue par onStepStart (texte incohérent)
    const speed = this.deps.speed ?? 1;
    const total = stepDuration(text, step.minDurationMs, this.deps.audioMs?.(i, text)) / speed;
    this.stepMs = Math.max(0, total - STEP_PAUSE_MS / speed);
    this.minMs = (step.minDurationMs ?? 0) / speed;
    this.fallbackMs = total;
    this.activeMs = 0;
    this.emit();
    const voiced =
      speed === 1 &&
      !!this.deps.voice?.play(step, i, text, {
        ended: () => this.voiceDone(run, false),
        error: () => this.voiceDone(run, true),
      });
    this.preparing = false;
    if (voiced) {
      this.waitingVoice = true;
      this.activeSince = performance.now();
      // Mise en pause pendant la pose du ciel : l'audio attend la reprise
      if (this.status !== 'playing') this.deps.voice?.pause();
      return;
    }
    if (this.status === 'playing') this.schedule(total);
    else this.remaining = total;
  }

  /** Fin de l'audio de l'étape : reste de `minDurationMs`, respiration ; en erreur, durée calculée. */
  private voiceDone(run: number, error: boolean): void {
    if (run !== this.run || !this.waitingVoice) return;
    this.waitingVoice = false;
    if (this.status === 'playing') this.activeMs += performance.now() - this.activeSince;
    const speed = this.deps.speed ?? 1;
    const rest = error
      ? Math.max(0, this.fallbackMs - this.activeMs)
      : Math.max(0, this.minMs - this.activeMs) + STEP_PAUSE_MS / speed;
    if (this.status === 'playing') this.schedule(rest);
    else this.remaining = rest;
  }

  private schedule(ms: number): void {
    this.startedAt = performance.now();
    this.remaining = ms;
    const run = this.run;
    this.timer = window.setTimeout(() => {
      if (run === this.run && this.status === 'playing') this.next();
    }, ms);
  }

  private emit(): void {
    const step = this.script.steps[this.index];
    this.deps.onUpdate({
      status: this.status,
      stepIndex: Math.max(0, this.index),
      subtitle: this.subtitle,
      act: this.status === 'ended' ? 'epilogue' : (step?.act ?? ''),
      stepMs: this.stepMs,
    });
  }
}
