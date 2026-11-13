import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatInt } from '../data/format';
import { INSIGHT_VERB, insightModePhrase, pickContrast } from '../data/insights';
import { useViewport } from '../hooks/useViewport';
import { cardPlacement, type CardPlacement } from '../state/panes';
import { openInsight } from '../store/insightPlayer';
import { useOverlayRects, useReservedRect } from '../store/overlayRects';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { InsightIcon } from './Insights';
import { SkySourceNote } from './provenance/ProofNotes';

/**
 * Montrée une fois par session (critique v0.6, L-14) : fermée, ouverte (« Voir les deux ciels ») ou
 * déjà montrée lors d'un chargement précédent de l'onglet, elle ne revient pas avant la session suivante.
 * Dans la page où elle apparaît, elle reste jusqu'à fermeture ou ouverture (elle s'efface seulement
 * pendant la visite, le diptyque ou le halo).
 */
const DISMISS_KEY = 'starway.contrast.dismissed';
const SEEN_KEY = 'starway.contrast.seen';
const readFlag = (key: string) => {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const writeFlag = (key: string) => {
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    /* stockage indisponible : valable pour cette page seulement */
  }
};
/** Lu une fois au chargement : « déjà vue » vaut pour les chargements suivants, pas pour celui-ci */
const seenBefore = typeof window === 'undefined' ? false : readFlag(SEEN_KEY);

/** Marges de la carte (styles.css, `.contrast-card`) : 20 px du bord, 360 px de large au plus */
const SIDE = 20;
const MAX_W = 360;

/**
 * « Le contraste du jour » (plan § 15) : une phrase, un clic ouvre les deux ciels.
 * Elle ne cache jamais l'étoile-guide ni son nom (L-02) : à gauche par défaut, du côté opposé si
 * elle les couvrirait, repliée en puce si ce côté est pris. Le ciel ne bouge pas.
 */
export function ContrastOfTheDay() {
  const dataset = useSkyStore((s) => s.dataset);
  const phase = useSkyStore((s) => s.phase);
  const busy = useSkyStore((s) => s.tour.status !== 'idle' || !!s.scenario.compare || !!s.scenario.halo);
  const guide = useOverlayRects((s) => s.guide);
  const rightBusy = useOverlayRects((s) => 'proof' in s.rects || 'list' in s.rects);
  const vp = useViewport();
  const [dismissed, setDismissed] = useState(() => readFlag(DISMISS_KEY) || seenBefore);
  // Haut (calc(var(--banner-h) + 96px)) et hauteur de la carte, mesurés après rendu
  const [box, setBox] = useState({ top: 96, h: 150 });
  const ref = useRef<HTMLElement>(null);
  const ins = dataset ? pickContrast(dataset.insights) : null;
  const show = !!ins && !!dataset && phase === 'explore' && !busy && !dismissed;

  const w = Math.min(MAX_W, vp.width - 2 * SIDE);
  const placement: CardPlacement = cardPlacement(
    guide,
    { x: SIDE, y: box.top, w, h: box.h },
    { x: vp.width - SIDE - w, y: box.top, w, h: box.h },
    rightBusy,
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!show || placement === 'chip' || !el) return;
    setBox((b) => (b.top === el.offsetTop && b.h === el.offsetHeight ? b : { top: el.offsetTop, h: el.offsetHeight }));
  }, [show, placement, vp.width]);
  useReservedRect('contrast', ref, show, placement);
  useEffect(() => {
    if (show) writeFlag(SEEN_KEY);
  }, [show]);

  const dismiss = () => {
    setDismissed(true);
    writeFlag(DISMISS_KEY);
  };
  const open = (target: NonNullable<typeof ins>) => {
    dismiss();
    void openInsight(target);
  };

  const name = (insee: string | null | undefined) => dataset?.communes.find((c) => c.insee === insee)?.name ?? insee ?? '';
  const day = ins ? dataset?.meta.day_types.find((d) => d.id === ins.scenario.d)?.label ?? ins.scenario.d : '';
  const pd = ins?.metric.poles_delta;
  const jd = ins?.metric.jobs_delta;
  const verb = ins ? INSIGHT_VERB[ins.kind] : '';

  const closeBtn = (
    <button type="button" className="icon-btn" aria-label="Masquer cette découverte" onClick={dismiss}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );

  return (
    <AnimatePresence>
      {show && ins && (
        <m.aside
          key={`${ins.id}-${placement}`}
          ref={ref}
          className={`contrast-card is-${placement}`}
          aria-label="Deux voisines, deux horizons"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
        >
          {placement === 'chip' ? (
            <div className="contrast-actions">
              <button type="button" className="chip chip-action" onClick={() => open(ins)}>
                <InsightIcon kind={ins.kind} />
                Deux voisines, deux horizons : {verb.charAt(0).toLowerCase()}
                {verb.slice(1)}
              </button>
              {closeBtn}
            </div>
          ) : (
            <>
              <p className="eyebrow">Deux voisines, deux horizons</p>
              <p className="contrast-text">
                {name(ins.scenario.o)} et {name(ins.scenario.vs)} sont voisines. En journée-type {day}, en {insightModePhrase(ins)}, aller et retour en{' '}
                {ins.scenario.b} min ou moins par sens{pd != null || jd != null ? ' : ' : '.'}
                {pd != null && `${formatInt(Math.abs(pd))} pôle${Math.abs(pd) > 1 ? 's' : ''}`}
                {pd != null && jd != null && ' et '}
                {jd != null && `${formatInt(Math.abs(jd))} postes salariés (INSEE)`}
                {(pd != null || jd != null) && " d'écart."}
              </p>
              <SkySourceNote mode={ins.scenario.m} className="contrast-prov" />
              <div className="contrast-actions">
                <button type="button" className="chip chip-action" onClick={() => open(ins)}>
                  <InsightIcon kind={ins.kind} />
                  {verb}
                </button>
                {closeBtn}
              </div>
            </>
          )}
        </m.aside>
      )}
    </AnimatePresence>
  );
}
