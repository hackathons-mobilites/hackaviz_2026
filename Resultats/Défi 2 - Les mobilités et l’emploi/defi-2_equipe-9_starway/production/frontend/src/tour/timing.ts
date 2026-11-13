/** Durée d'une étape sans audio : ~14 caractères/s, bornée par minDurationMs, + respiration. */
export const CHARS_PER_SECOND = 14;
export const STEP_PAUSE_MS = 900;

export function stepDuration(text: string, minDurationMs = 0, audioMs?: number): number {
  const reading = Math.ceil((text.length / CHARS_PER_SECOND) * 1000);
  return Math.max(minDurationMs, audioMs ?? reading) + STEP_PAUSE_MS;
}
