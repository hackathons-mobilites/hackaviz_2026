/**
 * Narration enregistrée de la visite dans le navigateur (MP3 + WebVTT de tools/tour-tts).
 *
 * - Manifeste : `durationMs` de tour.resolved.json (écrit par tour-tts après le MP3). Sans lui, aucun
 *   fichier audio n'est demandé : pas de 404, la visite suit la durée estimée comme avant.
 * - Un seul élément <audio> pour toute la visite (une piste à la fois), créé hors du DOM, débloqué
 *   dans le geste « Lancer la visite » (`primeVoice`) pour les navigateurs qui l'exigent (Safari).
 * - Hors du graphe Web Audio : le bouton son (fond et bruitages) ne la coupe pas ; elle a son propre
 *   contrôle « Voix » (soundStore.voice). Voix coupée = audio joué en sourdine : le rythme de l'étape
 *   et les sous-titres alignés restent ceux de l'audio.
 * - Mouvement réduit : sans effet sur la voix.
 */
import { fetchJson } from '../data/loaders';
import { useSoundStore } from '../audio/soundStore';
import type { ResolvedTour } from './resolve';
import type { TourVoice, VoiceHandlers } from './TourPlayer';
import type { TourStep } from './types';
import { hasRecordedVoice, parseVtt, stepAudio, type StepAudio, type TimedCue } from './vtt';

export const tourBase = (tourId: string): string => `${import.meta.env.BASE_URL}tour/${tourId}/`;

/* ------------------------------------------------------------------ manifeste et sous-titres */

const manifests = new Map<string, Promise<ResolvedTour | null>>();

/** tour.resolved.json (mis en cache) ; null s'il est absent ou illisible (la visite marche sans). */
export function loadResolvedTour(tourId: string): Promise<ResolvedTour | null> {
  let p = manifests.get(tourId);
  if (!p) {
    p = fetchJson<ResolvedTour>(`${tourBase(tourId)}tour.resolved.json`).then((r) =>
      r && Array.isArray(r.steps) ? r : null,
    );
    manifests.set(tourId, p);
  }
  return p;
}

/** Fichiers enregistrés d'une visite : audio et sous-titres alignés, étape par étape. */
export class TourAudioAssets {
  readonly resolved: ResolvedTour | null;
  readonly base: string;
  private cues = new Map<number, TimedCue[]>();

  constructor(resolved: ResolvedTour | null, base: string) {
    this.resolved = resolved;
    this.base = base;
  }

  get hasVoice(): boolean {
    return hasRecordedVoice(this.resolved);
  }

  audio(index: number, stepId: string, text: string): StepAudio | null {
    return stepAudio(this.resolved, index, stepId, text, this.base);
  }

  /** Cues WebVTT de l'étape (temps de l'audio) ; null si absentes : le texte est découpé comme avant. */
  stepCues(index: number, stepId: string, text: string): TimedCue[] | null {
    return this.audio(index, stepId, text) ? (this.cues.get(index) ?? null) : null;
  }

  /** Charge les .vtt des étapes enregistrées (petits fichiers texte). Un .vtt de dry-run est ignoré. */
  async prefetchCues(): Promise<void> {
    const steps = this.resolved?.steps ?? [];
    await Promise.all(
      steps.map(async (s, i) => {
        const a = stepAudio(this.resolved, i, s.id, s.text, this.base);
        if (!a || this.cues.has(i)) return;
        try {
          const res = await fetch(a.vtt);
          if (!res.ok) return;
          const parsed = parseVtt(await res.text());
          if (parsed && !parsed.estimated && parsed.cues.length) this.cues.set(i, parsed.cues);
        } catch {
          /* sous-titres découpés depuis le texte */
        }
      }),
    );
  }
}

/* ------------------------------------------------------------------ élément audio unique */

let element: HTMLAudioElement | null = null;
let silentUrl: string | null = null;

function audioElement(): HTMLAudioElement | null {
  if (element) return element;
  if (typeof Audio === 'undefined') return null;
  element = new Audio();
  element.preload = 'auto';
  element.muted = !useSoundStore.getState().voice;
  useSoundStore.subscribe((s, p) => {
    if (s.voice !== p.voice && element) element.muted = !s.voice;
  });
  return element;
}

/** WAV PCM 8 bits, 8 kHz, mono, 50 ms de silence (blob: autorisé par la CSP media-src, data: ne l'est pas). */
function silentWav(): string {
  if (silentUrl) return silentUrl;
  const samples = 400;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
  silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentUrl;
}

/**
 * À appeler DANS le geste « Lancer la visite » : lit 50 ms de silence sur l'élément unique, ce qui
 * l'autorise à lire la narration plus tard (après la pose du ciel) dans les navigateurs stricts.
 * Ne joue aucun son audible ; sans effet si une narration a déjà commencé.
 */
export function primeVoice(): void {
  const el = audioElement();
  if (!el || voice.busy) return;
  try {
    const url = silentWav();
    el.src = url;
    void el
      .play()
      .then(() => {
        if (el.src === url) el.pause();
      })
      .catch(() => undefined);
  } catch {
    /* sans déblocage, la lecture peut être refusée : repli sur la durée estimée */
  }
}

/** Implémentation navigateur de TourVoice. */
class HtmlVoice implements TourVoice {
  private assets: TourAudioAssets | null = null;
  private token = 0;
  private want = false;
  private active = false;
  private handlers: VoiceHandlers | null = null;

  /** Une narration est en cours (lecture ou pause) */
  get busy(): boolean {
    return this.active;
  }

  setAssets(assets: TourAudioAssets | null): void {
    this.stop();
    this.assets = assets;
  }

  play(step: TourStep, index: number, text: string, on: VoiceHandlers): boolean {
    const a = this.assets?.audio(index, step.id, text);
    const el = a ? audioElement() : null;
    if (!a || !el) return false;
    const t = ++this.token;
    this.handlers = on;
    this.active = true;
    this.want = true;
    el.onended = () => {
      if (t !== this.token || !this.active) return;
      this.active = false;
      on.ended();
    };
    el.onerror = () => {
      if (t !== this.token || !this.active) return;
      this.active = false;
      on.error();
    };
    el.src = a.mp3;
    this.kick(t);
    this.prefetchNext(index);
    return true;
  }

  private kick(t: number): void {
    const el = element;
    if (!el || !this.want) return;
    el.play().catch((err: unknown) => {
      if (t !== this.token || !this.active) return;
      // play() interrompu par pause() ou par un autre fichier : pas une erreur
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // lecture refusée (aucun geste) ou format non lu : l'étape suit la durée calculée
      this.active = false;
      this.handlers?.error();
    });
  }

  /** Met le MP3 de l'étape suivante dans le cache HTTP (/tour/* : max-age 300) : départ sans attente. */
  private prefetchNext(index: number): void {
    const s = this.assets?.resolved?.steps[index + 1];
    const a = s ? this.assets?.audio(index + 1, s.id, s.text) : null;
    if (a) void fetch(a.mp3).catch(() => undefined);
  }

  pause(): void {
    this.want = false;
    if (this.active) element?.pause();
  }

  resume(): void {
    if (!this.active) return;
    this.want = true;
    this.kick(this.token);
  }

  stop(): void {
    this.token++;
    this.want = false;
    this.handlers = null;
    if (!this.active) return;
    this.active = false;
    if (element) {
      element.onended = null;
      element.onerror = null;
      element.pause();
    }
  }

  /** Position dans l'audio de l'étape (ms) pour les sous-titres ; null si aucune narration en cours. */
  positionMs(): number | null {
    return this.active && element ? element.currentTime * 1000 : null;
  }
}

/** Instance unique (un seul élément audio par page). */
export const voice = new HtmlVoice();
