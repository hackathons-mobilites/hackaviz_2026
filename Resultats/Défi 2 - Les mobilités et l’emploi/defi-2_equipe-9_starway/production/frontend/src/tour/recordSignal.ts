/**
 * Signaux pour l'enregistreur vidéo (tools/record-tour) : CustomEvent('starway:record') sur window,
 * émis uniquement avec ?record=1. Horodatage en ms epoch (même horloge que l'enregistreur).
 */
export type RecordSignal =
  | { type: 'ready'; tourId: string }
  | { type: 'step'; index: number; id: string }
  | { type: 'end' }
  | { type: 'abort'; reason: string };

export const isRecordMode = (): boolean => new URLSearchParams(window.location.search).get('record') === '1';

export function recordSignal(s: RecordSignal): void {
  if (!isRecordMode()) return;
  const detail = { ...s, t: performance.timeOrigin + performance.now() };
  window.dispatchEvent(new CustomEvent('starway:record', { detail }));
  document.documentElement.dataset.recordState = s.type;
}
