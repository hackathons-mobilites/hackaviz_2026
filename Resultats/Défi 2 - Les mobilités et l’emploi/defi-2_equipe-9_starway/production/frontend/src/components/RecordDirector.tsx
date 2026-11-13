import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { fetchJson } from '../data/loaders';
import { waitForSky, whenSkyReady } from '../store/skyBridge';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { playReveal } from '../state/reveal';
import { startTour } from '../tour/controller';
import { isRecordMode, recordSignal } from '../tour/recordSignal';
import { TOURS } from '../tour/registry';
import type { ResolvedTour } from '../tour/resolve';
import { OSM_CREDIT } from '../data/attribution';

/** Délai entre l'écran-titre posé et le début de la visite (skill starway-guided-tour : 2 s) */
const RECORD_START_DELAY_MS = 2000;

/**
 * Mode enregistrement vidéo : ?record=1&tour=<id>[&subs=0].
 * Écran-titre posé, signal « ready », 2 s, puis le même chemin que « Lancer la visite » sur le titre :
 * le titre se retire, le ciel se pose (temps A et B), puis la visite démarre (le prologue fait le
 * temps C, l'acte 1 le temps D). Curseur et contrôles masqués.
 * Production : seulement si la visite est validée (ready: true). Textes et durées audio
 * contrôlés contre public/tour/<id>/tour.resolved.json.
 */
export function RecordDirector() {
  const status = useSkyStore((s) => s.status);
  const credits = useSkyStore((s) => s.tour.credits);
  const started = useRef(false);
  const params = new URLSearchParams(window.location.search);
  const tourId = params.get('tour');
  const record = isRecordMode() && !!tourId;

  useEffect(() => {
    if (!record) return;
    const root = document.documentElement;
    root.classList.add('record-mode');
    if (params.get('subs') === '0') root.classList.add('no-subs');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  useEffect(() => {
    if (!record || status !== 'ready' || started.current || !tourId) return;
    started.current = true;
    const abort = (reason: string) => recordSignal({ type: 'abort', reason });
    void (async () => {
      const script = TOURS[tourId];
      if (!script) return abort(`visite inconnue : ${tourId}`);
      if (import.meta.env.PROD && !script.ready) return abort('visite non validée (ready: false) : on ne filme pas un cas non validé');
      const resolved = await fetchJson<ResolvedTour>(`${import.meta.env.BASE_URL}tour/${tourId}/tour.resolved.json`);
      if (!resolved) return abort('tour.resolved.json introuvable : lancer npm run tour:resolve puis tools/tour-tts');
      const meta = useSkyStore.getState().dataset?.meta;
      // Identité du jeu de données : dataset_id quand il est publié (processing_version ne change pas
      // pendant un calcul), sinon processing_version.
      const metaId = (meta as { dataset_id?: string | null } | undefined)?.dataset_id ?? null;
      if (meta && metaId && resolved.dataset_id !== metaId)
        return abort(`jeu de données différent (visite ${resolved.dataset_id ?? 'non renseigné'}, données ${metaId}) : régénérer la visite et l'audio`);
      if (meta && !metaId && resolved.processing_version !== meta.processing_version)
        return abort(`processing_version différente (visite ${resolved.processing_version}, données ${meta.processing_version}) : régénérer la visite et l'audio`);
      useSkyStore.getState().setPhase('title');
      await whenSkyReady();
      await waitForSky();
      recordSignal({ type: 'ready', tourId });
      window.setTimeout(
        () => void playReveal({ thenTour: () => startTour(script, { resolved, record: true }) }),
        RECORD_START_DELAY_MS,
      );
    })();
  }, [record, status, tourId]);

  if (!record) return null;
  return (
    <AnimatePresence>
      {credits && (
        <m.section
          key="credits"
          className="end-credits"
          aria-label="Générique"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motion.light / 1000 }}
        >
          <p className="credits-title">STARWAY</p>
          <p>Le même ciel, mais pas les mêmes étoiles</p>
          <p className="credits-small">
            Données ouvertes : INSEE (Flores, recensement, Filosofi), Île-de-France Mobilités (GTFS), {OSM_CREDIT}{' '}
            (ODbL), API Géo (contours des communes). Léa est une habitante fictive ; tous les chiffres sont calculés.
          </p>
          <p className="credits-small">Équipe Middleway · Hackathon Mobilités 2026 · Île-de-France Mobilités</p>
        </m.section>
      )}
    </AnimatePresence>
  );
}
