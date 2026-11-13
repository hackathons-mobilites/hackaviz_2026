import { useEffect, useRef } from 'react';
import { playReveal } from '../state/reveal';
import { waitForSky, whenSkyReady } from '../store/skyBridge';
import { useSkyStore } from '../store/useSkyStore';
import { startTour } from '../tour/controller';
import { isRecordMode } from '../tour/recordSignal';
import { TOUR_ID_PARAM, resumeScript } from '../tour/versions';

/** Paramètre à usage unique : au chargement, lance la visite (mesure des sous-titres, scripts). */
const TOUR_RESUME_PARAM = 'visite';

/**
 * `?visite=1` : lance la visite au chargement, comme le fait le bouton de l'écran-titre, sans afficher le choix de la
 * version, et retire les paramètres de l'adresse (un rechargement ne la relance pas). Version complète par défaut,
 * `&tour=lea-video` pour la version courte. La narration part sans nouveau geste : si le navigateur refuse le son, la
 * visite se lit aux sous-titres. En mode enregistrement, c'est RecordDirector qui lance la visite.
 */
export function TourResume() {
  const status = useSkyStore((s) => s.status);
  const started = useRef(false);
  useEffect(() => {
    if (status !== 'ready' || started.current || isRecordMode()) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get(TOUR_RESUME_PARAM) !== '1') return;
    started.current = true;
    const script = resumeScript(q);
    q.delete(TOUR_RESUME_PARAM);
    q.delete(TOUR_ID_PARAM);
    const search = q.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
    void (async () => {
      await whenSkyReady();
      await waitForSky();
      void playReveal({ thenTour: () => startTour(script) });
    })();
  }, [status]);
  return null;
}
