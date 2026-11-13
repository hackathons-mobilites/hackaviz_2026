import { useEffect } from 'react';
import { useFeaturesStore } from '../components/featuresStore';
import { buildHalo, isContextHalo } from '../data/halo';
import { budgetFraction, budgetScale } from '../state/budget';
import { onSkyEvent } from '../store/skyBridge';
import { selectReducedMotion, useSkyStore } from '../store/useSkyStore';
import { autoStartAllowed } from './cues';
import { soundscape } from './soundscape';
import { useSoundStore } from './soundStore';

/** Événements qui valent geste de l'utilisateur (règle des navigateurs pour démarrer l'audio) */
const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'] as const;

/** La jauge du temps de trajet a-t-elle le focus (glisser ou clavier) ? */
function budgetFocused(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement && el.type === 'range' && !!el.closest('.budget-range');
}

/**
 * Design sonore (D-026) : UN seul branchement, monté une fois dans App. S'abonne au store du ciel
 * (révélation, visite, halo, preuve, comparaison, jauge), à la carte miroir et aux événements du
 * ciel A (allumage, silence, éclipse, étoile-guide, filante, or), et les confie au chef d'orchestre.
 * Aucun composant n'est modifié pour le son, sauf le bouton son.
 */
export function useSoundscape(): void {
  useEffect(() => {
    const sc = soundscape;
    const s0 = useSkyStore.getState();
    sc.configure({
      on: useSoundStore.getState().on,
      reduced: selectReducedMotion(s0),
      tour: s0.tour.status,
      atTitle: s0.intro === 'title',
      hidden: document.visibilityState === 'hidden',
    });

    const onGesture = () => sc.gesture();
    GESTURES.forEach((g) => window.addEventListener(g, onGesture, { capture: true, passive: true }));
    const onVisibility = () => sc.setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    // Enregistrement de la visite avec ?sound=1 : l'enregistreur autorise l'audio sans geste
    if (autoStartAllowed(window.location.search)) sc.gesture();

    const unsubSound = useSoundStore.subscribe((s, p) => {
      if (s.on !== p.on) sc.setOn(s.on);
    });

    const unsubSky = useSkyStore.subscribe((s, p) => {
      const reduced = selectReducedMotion(s);
      if (reduced !== selectReducedMotion(p)) sc.setReduced(reduced);
      if (s.tour.status !== p.tour.status) sc.setTour(s.tour.status);

      // Acte 0 : A (le titre se retire), B (le ciel se pose), retour au titre (l'oculaire se ferme)
      if (p.phase === 'title' && s.phase === 'explore') sc.titleOut();
      if (s.intro !== p.intro) {
        if (s.intro === 'pose') sc.pose();
        sc.setAtTitle(s.intro === 'title');
      }

      if (s.intro !== 'done') return;
      const sc1 = s.scenario;
      const sc0 = p.scenario;
      // Halo : ouverture ou changement d'onglet, tenu jusqu'à la fin des arcs
      if (sc1.halo && sc1.halo !== sc0.halo) {
        const ctx = sc1.origin ? s.contexts[sc1.origin] : null;
        const arcs = ctx !== undefined && isContextHalo(sc1.halo) ? buildHalo(ctx, sc1.halo).rings.reduce((n, r) => n + r.segments.length, 0) : 1;
        sc.halo(Math.max(1, arcs));
      }
      // Panneau de preuve : ouverture (ou autre pôle)
      if (sc1.pole && sc1.pole !== sc0.pole) sc.proof();
      // Comparaison : le séparateur descend
      if (sc1.compare && !sc0.compare) sc.compare();
      // Jauge : un tic par cran, seulement si c'est la jauge qui bouge (glisser ou clavier)
      if (sc1.budget !== sc0.budget && s.dataset && budgetFocused()) {
        const scale = budgetScale(s.dataset.meta);
        if (scale) sc.tick(budgetFraction(sc1.budget, scale), scale.marks.includes(sc1.budget));
      }
    });

    const unsubMap = useFeaturesStore.subscribe((s, p) => {
      if (s.mapPhase === p.mapPhase) return;
      // diptyque : pas de vol (les astres s'effacent), donc pas de glissade
      if (useSkyStore.getState().scenario.compare) return;
      if (p.mapPhase === 'sky' && s.mapPhase === 'entering') sc.mirror('down');
      else if (s.mapPhase === 'leaving') sc.mirror('up');
    });

    const unsubEvents = onSkyEvent((e) => sc.sky(e));

    return () => {
      GESTURES.forEach((g) => window.removeEventListener(g, onGesture, { capture: true }));
      document.removeEventListener('visibilitychange', onVisibility);
      unsubSound();
      unsubSky();
      unsubMap();
      unsubEvents();
    };
  }, []);
}
