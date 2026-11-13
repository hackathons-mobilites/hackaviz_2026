import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { isTimeDependent, type PoleState } from '../data/accessibility';
import { reasonContext, stateReasonText, type ReasonContext } from '../data/proof';
import { GAIN_MARK, GAIN_POLE_TEXT, isGained } from '../data/gain';
import { formatInt, formatMinutes } from '../data/format';
import { poleShareText } from '../data/od/texts';
import { poleShareState } from '../data/od/summaryText';
import { placeGuideLabel, poleShortName, type GuideLabel, type LabelBox, type PlacedLabel } from '../data/labels';
import { astreBassinLine, astreBassinSentence } from '../data/astreBassin';
import { placeAvoidingZones } from '../data/labelZones';
import { guideEdge, guideLabel as guideLabelLook, poleLook, reveal, skyChrome, skyLayout } from '../theme/tokens';
import { poseDelays } from '../sky/transitions';
import type { Pole } from '../data/types';
import { useViewport } from '../hooks/useViewport';
import { computeFrame, datasetBounds, poleGeometry, toScreen } from '../sky/layout';
import { glyphScale, IDENTITY, project, SEMANTIC_ZOOM } from '../state/camera';
import { nearestInDirection, type ArrowDir } from '../state/keyNav';
import { edgeMarker, keepMarkerInside, nudgeMarkerFrom, paneFor } from '../state/panes';
import { animateCameraTo } from '../state/cameraControls';
import { useDisplayedView, useReveal } from '../store/selectors';
import { highlightPole } from '../store/skyBridge';
import { selectSkyBottom, useSkyStore } from '../store/useSkyStore';
import { isSkyChromeKey, useOverlayRects } from '../store/overlayRects';
import { NeedsMarkLayer } from './needs/NeedsMarks';
import { useNeedsSky } from './needs/useNeedsSky';
import { NEEDS_MARK_ARIA } from '../data/needsSky';

function ariaLabel(pole: Pole, s: PoleState, budget: number, hasOrigin: boolean, ctx: ReasonContext, gained = false): string {
  const jobs = pole.jobs == null ? 'postes salariés non disponibles' : `${formatInt(pole.jobs)} postes salariés recensés par l'INSEE`;
  if (!hasOrigin) return `${pole.name}, ${jobs}.`;
  // Table OD (D-019) : l'astre dit la part de ses postes atteinte aller ET retour, commune par commune
  if (s.od) return `${poleShareText(pole.name, s.od)}.`;
  const times = `aller ${formatMinutes(s.out)}, retour ${formatMinutes(s.ret)}`;
  const reason = stateReasonText(s, ctx);
  const why = reason ? ` (${reason})` : '';
  switch (s.status) {
    case 'accessible':
      // Or du gain (audit point 2) : dit en mots, jamais par la seule couleur
      if (gained) return `${pole.name}, ${jobs}, ${GAIN_POLE_TEXT} (${GAIN_MARK}) : ${times}.`;
      return `${pole.name}, ${jobs}, accessible : ${times}.`;
    case 'out_only':
      return `${pole.name}, ${jobs}, retour au-delà de ${budget} min : ${times}${why}.`;
    case 'none':
      return `${pole.name}, ${jobs}, hors de portée en ${budget} min : ${times}${why}.`;
    default:
      return `${pole.name}, ${jobs}, non calculé pour ce scénario.`;
  }
}

/** Largeur estimée d'une étiquette (px) : Jost ≈ 0,55 em par caractère */
const labelTextW = (t: string, px: number) => t.length * 0.55 * px + 12;

const STATUS_TEXT: Record<PoleState['status'], string> = {
  accessible: 'accessible',
  out_only: 'retour hors de portée',
  none: 'hors de portée',
  unknown: 'non calculé',
};

/** Largeur estimée d'une étiquette courte (px) pour l'évitement des collisions. */

/**
 * Couche DOM accessible superposée au canvas : un bouton par astre (clavier, lecteur d'écran).
 * Aucun libellé permanent : étiquette au survol / focus, libellé du pôle sélectionné,
 * et noms courts sans chevauchement au-delà de 2,5× (zoom sémantique).
 */
export function PoleLayer({ side = 'A' }: { side?: 'A' | 'B' }) {
  // Vue AFFICHÉE (Acte 0) : mêmes états que le ciel, rien de lu avant l'allumage
  const view = useDisplayedView(side);
  const { intro, mask } = useReveal();
  const accessFiles = useSkyStore((s) => s.access);
  const gainReport = useSkyStore((s) => s.gainReport);
  // « Ce qu'il me faut sur mon trajet » : astres marqués (calque à part, ciel A hors diptyque, rien d'autre ne change)
  const needsSky = useNeedsSky();
  const astres44 = useSkyStore((s) => s.astres44);
  const viewport0 = useViewport();
  const split = useSkyStore((s) => !!s.scenario.compare);
  // En diptyque, chaque ciel occupe un volet (côte à côte, ou empilés sur mobile).
  const skyBottom = useSkyStore(selectSkyBottom);
  const pane = useMemo(
    () => paneFor(side, split, viewport0.width, viewport0.height, skyBottom),
    [side, split, viewport0, skyBottom],
  );
  const paneLeft = pane.left;
  const paneTop = pane.top;
  const viewport = useMemo(() => ({ width: pane.width, height: pane.height }), [pane.width, pane.height]);
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const storeCamera = useSkyStore((s) => s.camera);
  const camera = split ? IDENTITY : storeCamera;
  const [hover, setHover] = useState<number | null>(null);
  const [guideHover, setGuideHover] = useState(false);
  const dataset = view?.dataset;
  const frame = useMemo(
    () =>
      computeFrame(viewport.width, viewport.height, pane.bottomInset, dataset ? datasetBounds(dataset) : undefined, pane.topInset),
    [viewport, pane.bottomInset, pane.topInset, dataset],
  );
  const geometry = useMemo(() => (view ? poleGeometry(view.dataset.poles, frame, astres44) : []), [view, frame, astres44]);

  const screen = useMemo(
    () =>
      geometry.map((g) => {
        const p = project(camera, g);
        return { x: p.x + paneLeft, y: p.y + paneTop, r: g.r * glyphScale(camera.k) };
      }),
    [geometry, camera, paneLeft, paneTop],
  );

  const selectedIndex = view?.scenario.pole ? view.dataset.poles.findIndex((p) => p.id === view.scenario.pole) : -1;

  // Étoile-guide : position écran et étiquette permanente (nom de la commune), prioritaire.
  const originSky = view?.origin?.sky ?? null;
  const guide = useMemo(() => {
    if (!originSky) return null;
    const g = project(camera, toScreen(frame, originSky));
    return { x: g.x + paneLeft, y: g.y + paneTop };
  }, [originSky, camera, frame, paneLeft, paneTop]);
  const guideName = view?.origin?.name ?? '';
  // Visite seulement (retour de Sandra et Maia du 10/11) : le prénom fictif du personnage sous le nom de la commune, ciel A
  const persona = useSkyStore((s) => (side === 'A' && (s.tour.status === 'playing' || s.tour.status === 'paused') ? (s.tour.persona ?? null) : null));
  // Repère de bord de l'étoile-guide (hors champ ou collée au bord, ciel A seul) : sa boîte reste ENTIÈRE dans le volet
  // (mobile 390 px : « Provins » était coupé par le bord) ; les noms l'évitent comme les boutons de zoom.
  const edge = useMemo(() => {
    if (!guide || !guideName || split) return null;
    const rect = { left: paneLeft, top: paneTop + frame.y, width: viewport.width, height: frame.h };
    const mk0 = edgeMarker(guide, rect);
    if (!mk0) return null;
    const w = guideName.length * guideEdge.charEm * guideEdge.fontPx + guideEdge.chromePx;
    const h = guideEdge.minHeight;
    const c = keepMarkerInside(mk0, { w, h }, rect, guideEdge.margin);
    return { x: c.x, y: c.y, angle: mk0.angle, w, h, rect };
  }, [guide, guideName, split, paneLeft, paneTop, frame, viewport]);
  // Taille des noms posés sur le ciel : clamp(12px, 0.75vw, 15px), même règle que le CSS.
  const fontPx = Math.min(15, Math.max(12, viewport0.width * 0.0075));
  const lineH = Math.round(fontPx * 1.3);

  // Étiquettes du ciel : nom de l'étoile-guide d'abord, puis les pôles (plus gros d'abord).
  // Position proche dans 8 directions, sinon à 44 px avec un trait de rappel ; jamais sur un disque.
  // Zones réservées (L-02) : cartes et panneaux posés sur le ciel, publiés par les composants
  const overlayRects = useOverlayRects((s) => s.rects);
  const setGuideAnchor = useOverlayRects((s) => s.setGuide);
  const haloOpen = side === 'A' && !!view?.scenario.halo;
  const guideW = guideName ? labelTextW(guideName, 13) + 14 + (side === 'A' ? 20 : 0) : 0;
  // Orbite du halo (sky/layers/Halo.ts) : rayon = guideLabel.orbitFactor × taille de l'étoile-guide
  const orbitR = haloOpen ? Math.max(12, Math.min(frame.w, frame.h) * skyLayout.guideSize) * guideLabelLook.orbitFactor * glyphScale(camera.k) : 0;

  // Les cartes du ciel s'écartent de l'étoile-guide : elles lisent sa position (ciel A, un seul ciel)
  useEffect(() => {
    if (side !== 'A') return;
    setGuideAnchor(guide && !split && guideName ? { x: guide.x, y: guide.y, labelW: guideW } : null);
  }, [side, guide, split, guideName, guideW, setGuideAnchor]);
  useEffect(() => () => {
    if (side === 'A') setGuideAnchor(null);
  }, [side, setGuideAnchor]);

  // Étiquettes du ciel : nom de l'étoile-guide d'abord (collé, prioritaire), puis les pôles (plus gros
  // d'abord). Position proche dans 8 directions, sinon à 44 px avec un trait de rappel ; jamais sur un
  // disque, jamais sous une carte posée sur le ciel.
  const labels = useMemo(() => {
    const out: { guide: GuideLabel | null; poles: PlacedLabel[]; edge: { x: number; y: number; angle: number } | null } = { guide: null, poles: [], edge: null };
    if (!view) return out;
    const grow = poleLook.ringGap + poleLook.ringWidth + 4;
    const discs: LabelBox[] = screen.map((p, i) => ({
      index: -1 - i,
      x: p.x - p.r - grow,
      y: p.y - p.r - grow,
      w: (p.r + grow) * 2,
      h: (p.r + grow) * 2,
    }));
    const inPane = (b: Omit<LabelBox, 'index'>) =>
      b.x > paneLeft && b.y > paneTop && b.x + b.w < paneLeft + viewport.width && b.y + b.h < paneTop + viewport.height;
    const reserved: LabelBox[] = [...discs];
    // bords du volet : hors cadre = réservé
    reserved.push(
      { index: -2000, x: paneLeft - 1000, y: paneTop - 1000, w: 1000, h: viewport.height + 2000 },
      { index: -2001, x: paneLeft + viewport.width, y: paneTop - 1000, w: 1000, h: viewport.height + 2000 },
      { index: -2002, x: paneLeft, y: paneTop - 1000, w: viewport.width, h: 1000 },
      { index: -2003, x: paneLeft, y: paneTop + viewport.height, w: viewport.width, h: 1000 },
      // la barre de scénario (et les cartes posées au-dessus) : aucun nom de pôle dessous, un trait de rappel ne l'y mène pas
      { index: -2004, x: paneLeft, y: paneTop + viewport.height - pane.bottomInset, w: viewport.width, h: pane.bottomInset + 1000 },
    );
    // cartes et panneaux posés sur le ciel
    const chrome: LabelBox[] = [];
    Object.entries(overlayRects).forEach(([key, r], i) => (isSkyChromeKey(key) ? chrome : reserved).push({ index: -3000 - i, ...r }));
    if (guide && guideName) {
      reserved.push({ index: -1001, x: guide.x - 20, y: guide.y - 20, w: 40, h: 40 });
      const g = placeGuideLabel({ x: guide.x, y: guide.y, r: 20 }, guideW, 24 + (persona ? guideLabelLook.personaPx : 0), [...reserved, ...chrome], inPane, guideLabelLook.near, guideLabelLook.far);
      out.guide = g;
      reserved.push(g);
    }
    // Orbite du halo : aucun nom de pôle à l'intérieur (le nom de la commune, lui, reste collé à son étoile)
    if (guide && orbitR > 0) reserved.push({ index: -1002, x: guide.x - orbitR - 2, y: guide.y - orbitR - 2, w: orbitR * 2 + 4, h: orbitR * 2 + 4 });
    // Repère de bord de l'étoile-guide : écarté du nom de l'étoile (qui reste collé à elle), puis évité par les noms des pôles
    if (edge) {
      const c = nudgeMarkerFrom({ x: edge.x, y: edge.y }, { w: edge.w, h: edge.h }, edge.rect, guideEdge.margin, out.guide, guideEdge.margin);
      out.edge = { x: c.x, y: c.y, angle: edge.angle };
      chrome.push({ index: -1004, x: c.x - edge.w / 2, y: c.y - edge.h / 2, w: edge.w, h: edge.h });
    }
    if (camera.k < SEMANTIC_ZOOM) return out;
    const tagged = new Set([hover, selectedIndex].filter((i): i is number => i != null && i >= 0));
    for (const i of tagged) {
      const p = screen[i]!;
      reserved.push({ index: i, x: p.x - 90, y: p.y + p.r + 4, w: 180, h: 54 });
    }
    const small = viewport0.width < 430;
    const items = view.dataset.poles
      .map((p, i) => ({ p, i }))
      .filter(({ i }) => !tagged.has(i))
      .sort((a, b) => (b.p.jobs ?? 0) - (a.p.jobs ?? 0))
      .map(({ p, i }) => {
        const sc = screen[i]!;
        return { index: i, cx: sc.x, cy: sc.y, r: sc.r + poleLook.ringGap, w: labelTextW(poleShortName(p), fontPx), h: lineH, allowDrop: small && sc.r < 10 };
      });
    // boutons de zoom, barre du haut, légende : les noms qui tombent dessous sont posés de nouveau, les autres ne bougent pas
    out.poles = placeAvoidingZones(items, reserved, chrome, {
      bounds: { x: paneLeft, y: paneTop, w: viewport.width, h: viewport.height - pane.bottomInset },
      step: skyChrome.searchStep,
    });
    return out;
  }, [view, camera.k, screen, hover, selectedIndex, viewport, viewport0.width, paneLeft, paneTop, pane.bottomInset, guide, guideName, guideW, fontPx, lineH, overlayRects, orbitR, edge, persona]);

  if (!view || !mask.poles) return null;
  // Noms des pôles : fondu qui finit avec le dernier astre posé ; nom de l'étoile-guide : au temps C
  const poseLabels = intro === 'pose' ? 'labels-pose' : '';
  const lastPose = poseDelays(view.dataset.poles.length).at(-1) ?? 0;
  const labelVars = {
    '--labels-fade': `${reveal.labelsFade}ms`,
    '--labels-delay': `${Math.max(0, lastPose + reveal.poleAppear - reveal.labelsFade)}ms`,
  } as CSSProperties;
  const originLabels = intro === 'origin' ? 'labels-origin' : '';
  const hasOrigin = !!view.origin && view.totals.hasData;
  const timeDependent = isTimeDependent(view.origin ? accessFiles[view.origin.insee] : null, view.scenario.mode, view.scenario.day);
  const reasons = reasonContext(view.dataset.meta, timeDependent, view.walkSetting);

  const tooltip = (i: number, pinned: boolean) => {
    const pole = view.dataset.poles[i]!;
    const s = view.states[i]!;
    const sc = screen[i]!;
    return (
      <div
        key={`tip-${i}`}
        className={`pole-tip status-${hasOrigin ? s.status : 'idle'} ${pinned ? 'is-pinned' : ''}`}
        style={{ left: sc.x, top: sc.y + sc.r + 8 }}
        aria-hidden="true"
      >
        <strong>{poleShortName(pole)}</strong>
        {!pinned && <span className="tip-jobs">{pole.jobs == null ? 'postes non disponibles' : `${formatInt(pole.jobs)} postes`}</span>}
        {/* Bassin d'emploi de l'astre (comme la carte), lu dans poles.json */}
        {!pinned && astreBassinLine(pole) && <span className="tip-jobs tip-bassin">{astreBassinLine(pole)}</span>}
        {hasOrigin && (
          <span className="tip-status">
            {s.od ? (
              poleShareState(s.od)
            ) : (
              <>
                {STATUS_TEXT[s.status]}
                {s.status === 'accessible' && isGained(gainReport, pole.id, split) && ` · ${GAIN_MARK}`}
                {!pinned && s.status !== 'unknown' && ` · aller ${formatMinutes(s.out)}, retour ${formatMinutes(s.ret)}`}
              </>
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <ul className="pole-layer" aria-label={split ? `Pôles d'emploi, ciel ${side} (${view.origin?.name ?? ''})` : "Pôles d'emploi du ciel"}>
        {view.dataset.poles.map((pole, i) => {
          const s = screen[i]!;
          const size = Math.max(44, s.r * 2 + 16);
          const selected = selectedIndex === i;
          return (
            <li key={pole.id}>
              <button
                type="button"
                className="pole-hit" data-testid="astre" data-pole-id={pole.id} data-etat={view.states[i]!.status}
                style={{ left: s.x - size / 2, top: s.y - size / 2, width: size, height: size }}
                aria-label={`${ariaLabel(pole, view.states[i]!, view.scenario.budget, hasOrigin, reasons, isGained(gainReport, pole.id, split))}${
                  astreBassinSentence(pole) ? ` ${astreBassinSentence(pole)}` : ''
                }${side === 'A' && !split && needsSky.marked.has(pole.id) ? ` ${NEEDS_MARK_ARIA}.` : ''}`}
                aria-pressed={selected}
                onClick={() => void applyScenario({ pole: selected ? null : pole.id }, 'user')}
                onFocus={() => {
                  setHover(i);
                  highlightPole(i);
                }}
                onBlur={() => {
                  setHover(null);
                  highlightPole(null);
                }}
                onKeyDown={(e) => {
                  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
                  const next = nearestInDirection(screen, i, e.key as ArrowDir);
                  if (next == null) return;
                  e.preventDefault();
                  const list = e.currentTarget.closest('ul');
                  list?.querySelectorAll<HTMLButtonElement>('.pole-hit')[next]?.focus();
                }}
                onMouseEnter={() => {
                  setHover(i);
                  highlightPole(i);
                }}
                onMouseLeave={() => {
                  setHover(null);
                  highlightPole(null);
                }}
              />
            </li>
          );
        })}
      </ul>

      {side === 'A' && !split && (
        <NeedsMarkLayer
          astres={view.dataset.poles.flatMap((p, i) => (needsSky.marked.has(p.id) && screen[i] ? [screen[i]!] : []))}
          width={viewport0.width}
          height={viewport0.height}
        />
      )}

      <svg
        className={`label-leaders ${poseLabels}`}
        style={labelVars}
        aria-hidden="true"
        width={viewport0.width}
        height={viewport0.height}
      >
        {labels.poles
          .filter((b) => b.leader)
          .map((b) => (
            <line key={`ld-${b.index}`} x1={b.leader!.x1} y1={b.leader!.y1} x2={b.leader!.x2} y2={b.leader!.y2} className="leader-pole" />
          ))}
        {labels.guide?.leader && (
          // Repli ultime du nom de l'étoile-guide : trait de 1,5 px et point de 2 px côté étoile
          <g className="leader-guide">
            <line x1={labels.guide.leader.x1} y1={labels.guide.leader.y1} x2={labels.guide.leader.x2} y2={labels.guide.leader.y2} />
            <circle cx={labels.guide.leader.x1} cy={labels.guide.leader.y1} r={1} />
          </g>
        )}
      </svg>
      {labels.poles.map((b) => (
        <div
          key={`sem-${b.index}`}
          className={`pole-short ${poseLabels} ${hasOrigin && view.states[b.index]?.status === 'accessible' ? 'is-on' : ''}`}
          style={{ ...labelVars, left: b.x, top: b.y, width: b.w, lineHeight: `${b.h}px` }}
          aria-hidden="true"
        >
          {poleShortName(view.dataset.poles[b.index]!)}
        </div>
      ))}
      {selectedIndex >= 0 && selectedIndex !== hover && tooltip(selectedIndex, true)}
      {hover != null && tooltip(hover, false)}

      {guide && view.origin && labels.edge && (() => {
        // Étoile-guide hors champ (zoom) : repère de bord dans la direction réelle ; un clic recentre.
        const mk = labels.edge;
        return (
          <button
            type="button"
            className="guide-edge"
            style={{ left: mk.x, top: mk.y }}
            aria-label={`Votre étoile ${view.origin.name} est hors champ : recentrer`}
            onClick={() =>
              animateCameraTo({
                k: storeCamera.k,
                x: storeCamera.x + (paneLeft + viewport.width / 2 - guide.x),
                y: storeCamera.y + (paneTop + frame.y + frame.h / 2 - guide.y),
              })
            }
          >
            <svg viewBox="0 0 12 12" aria-hidden="true" style={{ transform: `rotate(${mk.angle}rad)` }}>
              <path d="M3 2 L9 6 L3 10" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </svg>
            <span>{view.origin.name}</span>
          </button>
        );
      })()}
      {guide && view.origin && (() => {
        const label = labels.guide;
        const left = Math.min(guide.x - 18, label?.x ?? guide.x - 18);
        const top = Math.min(guide.y - 18, label?.y ?? guide.y - 18);
        const right = Math.max(guide.x + 18, label ? label.x + label.w : guide.x + 18);
        const bottom = Math.max(guide.y + 18, label ? label.y + label.h : guide.y + 18);
        const actionable = side === 'A';
        return (
          <>
            <button
              type="button"
              className={`guide-hit ${actionable ? '' : 'is-inert'}`}
              style={{ left, top, width: right - left, height: bottom - top }}
              aria-label={actionable ? `Afficher le profil de la commune : ${view.origin.name}` : `Commune comparée : ${view.origin.name}`}
              aria-disabled={!actionable || undefined}
              aria-expanded={actionable ? !!view.scenario.halo : undefined}
              tabIndex={actionable ? 0 : -1}
              onClick={() => actionable && void applyScenario({ halo: view.scenario.halo ? null : 'age' }, 'user')}
              onMouseEnter={() => setGuideHover(true)}
              onMouseLeave={() => setGuideHover(false)}
              onFocus={() => setGuideHover(true)}
              onBlur={() => setGuideHover(false)}
            >
              <span
                className="guide-hit-marker"
                style={{ left: guide.x - left, top: guide.y - top }}
                aria-hidden="true"
              />
              <svg
                className={`guide-reticle ${originLabels}`}
                viewBox="0 0 36 36"
                style={{ left: guide.x - left, top: guide.y - top }}
                aria-hidden="true"
              >
                <path className="guide-reticle-contrast" d="M11 3H4v7m21-7h7v7M4 26v7h7m21-7v7h-7" />
                <path className="guide-reticle-line" d="M11 3H4v7m21-7h7v7M4 26v7h7m21-7v7h-7" />
              </svg>
              {label && (
                <span
                  className={`guide-name ${originLabels}`}
                  style={{ left: label.x - left, top: label.y - top, width: label.w }}
                  aria-hidden="true"
                >
                  <span>{guideName}</span>
                  {actionable && <span className="guide-info-icon">i</span>}
                  {persona && <span className="guide-persona">{persona}</span>}
                </span>
              )}
            </button>
            {guideHover && (
              <div className="guide-tip" style={{ left: guide.x, top: guide.y }} aria-hidden="true">
                <span>{actionable ? 'Profil de la commune' : 'Commune comparée'}</span>
                <strong>{view.origin.name}</strong>
              </div>
            )}
          </>
        );
      })()}
    </>
  );
}
