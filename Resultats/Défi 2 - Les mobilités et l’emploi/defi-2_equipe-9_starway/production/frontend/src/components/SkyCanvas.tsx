import { useEffect, useRef, useState } from 'react';
import { computePoleStates, type PoleStatus } from '../data/accessibility';
import { buildHalo, isContextHalo } from '../data/halo';
import type { SkyEngine } from '../sky/SkyEngine';
import { datasetBounds } from '../sky/layout';
import type { ShootingKind } from '../sky/layers/ShootingStar';
import type { TransitionCause } from '../sky/transitions';
import { panCamera, setCameraNow, zoomBy } from '../state/cameraControls';
import { IDENTITY, zoomAt } from '../state/camera';
import { isDynamicImportFailure, markBundleStale } from '../state/bundleUpdate';
import { paneFor, STACK_MAX_WIDTH } from '../state/panes';
import { shiftKey, type Scenario } from '../state/scenario';
import { transitCommuneStates } from '../state/skyView';
import { useViewport } from '../hooks/useViewport';
import { useColorVisionStore } from '../store/colorVisionStore';
import { useOdStore } from '../store/useOdStore';
import { useDisplayedView } from '../store/selectors';
import { emitSkyEvent, registerFpsReader, registerSkyEffects, registerSkyHighlighter, registerSkyWaiter } from '../store/skyBridge';
import { gainKey, selectReducedMotion, selectSkyBottom, useSkyStore } from '../store/useSkyStore';
import { motion, reveal } from '../theme/tokens';

function causeOf(prev: Scenario | null, next: Scenario, budgetScrub: boolean): TransitionCause {
  if (!prev) return next.origin ? 'origin' : 'init';
  if (prev.origin !== next.origin) return 'origin';
  // Horaires libres (D-019) : glisser du début ou de la fin = mise à jour légère, comme la jauge
  const shiftMoved = shiftKey(prev) !== shiftKey(next);
  if (budgetScrub && (prev.budget !== next.budget || shiftMoved)) return 'scrub';
  // Journée-type choisie comme raccourci après un horaire libre (ou l'inverse) : même voile d'éclipse
  if (prev.day !== next.day || (shiftMoved && (!prev.shift || !next.shift))) return 'day';
  return 'filter';
}

/** Fenêtre après une interruption de la révélation où les transitions sont des fondus courts (ms) */
const SKIP_QUICK_MS = 400;

const SHOOTING: Partial<Record<PoleStatus, ShootingKind>> = {
  accessible: 'full',
  out_only: 'return_half',
  none: 'out_60',
};

/** Molette, pincement, glisser, double-clic → caméra (sans inertie). Désactivé en diptyque. */
function useCameraInput(el: HTMLDivElement | null, enabled: boolean) {
  useEffect(() => {
    if (!el || !enabled) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      zoomBy(factor, e.clientX, e.clientY, false);
    };
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
      el.classList.add('is-dragging');
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        panCamera(cur.x - prev.x, cur.y - prev.y);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const cam = useSkyStore.getState().camera;
        if (pinchDist > 0) {
          const next = zoomAt(cam, d / pinchDist, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2, window.innerWidth, window.innerHeight);
          setCameraNow(next);
        }
        pinchDist = d;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
      if (pointers.size === 0) el.classList.remove('is-dragging');
    };
    const onDbl = (e: MouseEvent) => zoomBy(e.shiftKey ? 0.5 : 2, e.clientX, e.clientY);

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('dblclick', onDbl);
    };
  }, [el, enabled]);
}

/** Hôte du canvas PixiJS. Le moteur est chargé à la demande (bundle séparé). */
export function SkyCanvas({ side = 'A' }: { side?: 'A' | 'B' }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const engineRef = useRef<SkyEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const dataset = useSkyStore((s) => s.dataset);
  const reduced = useSkyStore(selectReducedMotion);
  /** Mode daltonien : ciel A et ciel B du diptyque (chacun son moteur) */
  const cv = useColorVisionStore((s) => s.on);
  const camera = useSkyStore((s) => s.camera);
  const barHeight = useSkyStore(selectSkyBottom);
  const viewport = useViewport();
  const contexts = useSkyStore((s) => s.contexts);
  // Vue AFFICHÉE (Acte 0) : neutre et sans commune tant que la révélation ne l'a pas permis
  const view = useDisplayedView(side);
  const intro = useSkyStore((s) => s.intro);
  const skipAt = useSkyStore((s) => s.introSkipAt);
  const split = useSkyStore((s) => !!s.scenario.compare);
  const pane = paneFor(side, split, viewport.width, viewport.height, barHeight);
  const stacked = split && viewport.width <= STACK_MAX_WIDTH;
  const prevScenario = useRef<Scenario | null>(null);
  const prevPole = useRef<string | null>(null);
  /** État du pôle quand sa filante a été tracée ; la trace effacée pendant un glisser est retracée au relâchement */
  const shotStatus = useRef<PoleStatus | null>(null);
  const traceStale = useRef(false);
  useCameraInput(host, side === 'A' && !split);

  useEffect(() => {
    const el = host;
    if (!dataset || !el) return;
    let cancelled = false;
    let engine: SkyEngine | null = null;
    let unregister: (() => void) | null = null;
    const st = useSkyStore.getState();
    // CSP stricte : polyfill PixiJS sans eval, chargé avant le moteur
    import('../sky/pixiCsp')
      .then(() => import('../sky/SkyEngine'))
      .then(({ SkyEngine }) =>
        SkyEngine.create(el, dataset.poles, selectReducedMotion(st), selectSkyBottom(st), {
          opening: side === 'A',
          // lien partagé : décor plus court (pas de titre à lire)
          openingFade: st.sharedLink ? reveal.sharedDecorFade : motion.nebulaFadeIn,
          // Acte 0 : astres cachés jusqu'à la pose, tant que la révélation n'est pas finie
          veiled: st.intro !== 'done',
          bounds: datasetBounds(dataset),
          astres44: st.astres44,
        }),
      )
      .then((e) => {
        if (cancelled) {
          e.destroy();
          return;
        }
        engine = e;
        engineRef.current = e;
        unregister = registerSkyHighlighter((i) => e.highlight(i));
        if (side === 'A') {
          registerSkyWaiter(() => e.settled());
          registerSkyEffects({ lastTransition: () => e.lastTransition(), playShootingStar: (id) => e.playShootingStar(id) });
          registerFpsReader(() => e.fps());
          // Design sonore (D-026) : le son suit ce que le ciel A joue réellement
          e.setEventSink(emitSkyEvent);
        }
        prevScenario.current = null;
        prevPole.current = null;
        setEngineReady(true);
      })
      .catch((err: unknown) => {
        console.error('WebGL indisponible, ciel statique', err);
        // Moteur du ciel introuvable (fichier remplacé par une mise en ligne) : ce n'est pas un problème de WebGL
        if (isDynamicImportFailure(err)) markBundleStale();
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
      unregister?.();
      if (side === 'A') {
        registerSkyWaiter(null);
        registerSkyEffects(null);
        registerFpsReader(null);
      }
    };
  }, [dataset, host, side]);

  // Passage simple ⇄ diptyque : l'hôte change de taille, le moteur se recadre.
  useEffect(() => {
    if (!host || !engineReady) return;
    const ro = new ResizeObserver(() => engineRef.current?.resize());
    ro.observe(host);
    return () => ro.disconnect();
  }, [host, engineReady]);

  useEffect(() => {
    engineRef.current?.setReducedMotion(reduced);
  }, [reduced, engineReady]);

  useEffect(() => {
    engineRef.current?.setPalette(cv);
  }, [cv, engineReady]);

  useEffect(() => {
    engineRef.current?.setCamera(split ? IDENTITY : camera);
  }, [camera, engineReady, split]);

  // Halo « Derrière notre étoile » (ciel A seulement)
  const haloDim = view?.scenario.halo ?? null;
  const haloOrigin = view?.origin?.insee ?? null;
  const haloCtx = haloOrigin ? contexts[haloOrigin] : undefined;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || side !== 'A') return;
    const rings = isContextHalo(haloDim) && haloCtx !== undefined ? buildHalo(haloCtx, haloDim, cv).rings : null;
    // Halo v2 (D-025) : le ciel ne garde qu'une orbite sans donnée, ouverte dès que le panneau l'est (l'onglet « Chômage » n'a aucun arc)
    void engine.setHalo(haloDim && haloOrigin ? (rings ?? []) : null);
  }, [haloDim, haloCtx, haloOrigin, engineReady, side, cv]);

  useEffect(() => {
    engineRef.current?.setInsets(pane.bottomInset, pane.topInset);
  }, [pane.bottomInset, pane.topInset, engineReady]);

  // Acte 0 : le moteur suit l'étape de la révélation (les deux ciels du diptyque ensemble)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !engineReady) return;
    if (intro === 'title') void engine.veilSky();
    else if (engine.isVeiled()) void engine.pose();
  }, [intro, engineReady]);

  // Interruption : valeurs finales en 150 ms
  useEffect(() => {
    if (skipAt) engineRef.current?.finishIntro();
  }, [skipAt, engineReady]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !view || !engineReady) return;
    const st0 = useSkyStore.getState();
    const cause = causeOf(prevScenario.current, view.scenario, st0.budgetScrub);
    prevScenario.current = view.scenario;
    // Juste après une interruption de la révélation : fondus de 150 ms (allumage compris)
    const quick = st0.introSkipAt > 0 && performance.now() - st0.introSkipAt < SKIP_QUICK_MS;
    void engine.update(
      { states: view.states, origin: view.origin?.sky ?? null, originKey: view.origin?.insee ?? null, neutral: view.neutral || !view.totals.hasData, day: view.scenario.day },
      cause,
      { quick },
    );

    // Or du « gain démontré » (ciel A, hors diptyque) : vélo + TC face aux TC seuls, même journée-type,
    // même budget, part TC commune par commune nulle (D-056). Une référence manque : showGain refuse, rien n'est peint.
    if (side === 'A') {
      const sc = view.scenario;
      // Pendant un glisser, l'or (calculé pour un budget précis) est retiré, puis recalculé au relâchement.
      // L'or n'est jamais peint pendant la révélation (vue affichée : `done` seulement)
      if (!split && sc.mode === 'bike_transit' && view.origin && cause !== 'scrub' && useSkyStore.getState().intro === 'done') {
        const file = useSkyStore.getState().access[view.origin.insee] ?? null;
        const ref = computePoleStates(view.dataset.poles, file, 'transit', sc.day, sc.budget);
        const communeTransit = transitCommuneStates(view.dataset, sc, useOdStore.getState().transitRef);
        const key = gainKey(sc);
        void engine
          .showGain(
            { states: ref, mode: 'transit', day: sc.day, budget: sc.budget, neutral: view.neutral },
            { states: view.states, mode: sc.mode, day: sc.day, budget: sc.budget, neutral: view.neutral || !view.totals.hasData },
            communeTransit,
          )
          .then((r) => {
            const now = useSkyStore.getState().scenario;
            if (gainKey(now) === key) useSkyStore.getState().setGainReport({ ...r, key });
          });
      } else {
        engine.clearGain();
        if (useSkyStore.getState().gainReport) useSkyStore.getState().setGainReport(null);
      }
    }

    const poleId = view.scenario.pole;
    const index = poleId ? view.dataset.poles.findIndex((p) => p.id === poleId) : -1;
    engine.setSelected(index >= 0 ? index : null);
    const status = index >= 0 ? view.states[index]!.status : null;
    if (cause === 'scrub') {
      // La trace ne doit jamais contredire l'état affiché : effacée si l'état du pôle change, retracée au relâchement
      if (poleId === prevPole.current && status !== shotStatus.current && !traceStale.current) {
        engine.clearShooting();
        traceStale.current = true;
      }
    } else if (poleId !== prevPole.current || cause !== 'filter' || traceStale.current) {
      prevPole.current = poleId;
      shotStatus.current = status;
      traceStale.current = false;
      engine.clearShooting();
      const kind = index >= 0 ? SHOOTING[view.states[index]!.status] : undefined;
      if (kind && view.origin && side === 'A') {
        // La filante part une fois l'état du ciel posé
        void engine.settled().then(() => {
          if (useSkyStore.getState().scenario.pole === poleId) void engine.shoot(index, kind);
        });
      }
    }
  }, [view, engineReady, side, split]);

  return (
    <div
      ref={setHost}
      className={`sky-host sky-host-${side} ${split ? 'is-split' : ''} ${stacked ? 'is-stacked' : ''} ${failed ? 'sky-fallback' : ''}`}
      aria-hidden="true"
    />
  );
}
