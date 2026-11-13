import { geoPath } from 'd3-geo';
import { motion as m } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { formatInt, statusLabel } from '../data/format';
import { calcOrigin, originPointPhrase, reasonContext, stateReasonText, stripSourceParen } from '../data/proof';
import { useProvenanceStore } from '../store/provenanceStore';
import { walkSettingPhrase, walkShortText } from '../data/walkSettings';
import { loadGeo, mirrorProjection, poleDiscLonLat, scaleBarPx, stopNameFromMethod, territoryKind, type GeoData, type TerritoryKind } from '../data/geo';
import { MODE_SHORT, poleShortName, type PlacedLabel } from '../data/labels';
import { mapCommuneKinds, type MapCommuneKind } from '../data/od/sky';
import { formatShift } from '../data/od/shift';
import { poleShareState } from '../data/od/summaryText';
import { odLegText, odTextContext, selfJobsText } from '../data/od/texts';
import { useOdStore } from '../store/useOdStore';
import { placeMapLabels, type MapDisc } from '../data/mapLabels';
import type { Dataset, Pole } from '../data/types';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useViewport } from '../hooks/useViewport';
import { engineFeatures, whenEngineFeatures, type MirrorTargets } from '../sky/featureBridge';
import { computeFrame, datasetBounds, isPhoneLayout, poleGeometry } from '../sky/layout';
import {
  applyMapView,
  centerMapOn,
  inFrame,
  isOverview,
  MAP_IDENTITY,
  MAP_PAN_STEP,
  MAP_ZOOM_MAX,
  MAP_ZOOM_STEP,
  panMap,
  zoomMapAt,
  zoomMapCenter,
  type MapView,
} from '../state/mapZoom';
import { writeViewToUrl } from '../state/url';
import { useCompareView, useSkyView, type SkyView } from '../store/selectors';
import { highlightPole, waitForSky } from '../store/skyBridge';
import { selectReducedMotion, selectSkyBottom, useSkyStore } from '../store/useSkyStore';
import { color, mirror, mirrorAstre, motion } from '../theme/tokens';
import { usePalette } from '../store/colorVisionStore';
import './features.css';
import { useFeaturesStore } from './featuresStore';
import { MapSourceNote } from './provenance/ProofNotes';
import { ChartReadingTip } from './ChartReadingTip';
import { mirrorReading } from '../data/chartReading';

/** Longueur de l'échelle graphique (km) : une valeur ronde lisible à l'échelle régionale. */
const SCALE_KM = 10;
/** Au zoom, l'échelle prend la plus grande de ces longueurs qui tient dans SCALE_MAX_PX */
const SCALE_STEPS_KM = [10, 5, 2, 1] as const;
const SCALE_MAX_PX = 160;
const LABEL_FONT = "400 13px 'Jost Variable', 'Jost', system-ui, sans-serif";
const ORIGIN_FONT = "500 14px 'Jost Variable', 'Jost', system-ui, sans-serif";
/** Largeur de la colonne de légende sur grand écran (px) : la carte y gagne la hauteur de la légende */
const SIDE_W = 300;
/** À partir de cette largeur de fenêtre, la légende peut passer en colonne à droite */
const SIDE_MIN_WIDTH = 1100;
/** Déplacement (px) au-delà duquel un appui devient un glisser (et n'ouvre pas le pôle) */
const DRAG_THRESHOLD = 4;

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font = LABEL_FONT): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Hauteur du bandeau démo (variable CSS --banner-h), pour caler le cadre sous la barre du haut. */
function bannerHeight(): number {
  const el = document.querySelector('.app');
  const v = el ? parseFloat(getComputedStyle(el).getPropertyValue('--banner-h')) : 0;
  return Number.isFinite(v) ? v : 0;
}

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface OriginMark {
  side: 'A' | 'B';
  insee: string;
  name: string;
  x: number;
  y: number;
  label: PlacedLabel | null;
  /** true : (x, y) est le point de départ du calcul publié (D-017), sinon le centre de la commune */
  calc: boolean;
  /** Texte du point de départ (libellé publié dans meta.origin_methods), null si non publié */
  startText: string | null;
}

interface MapLayout {
  frame: Frame;
  /** Légende en colonne à droite (grand écran) plutôt qu'en bas */
  side: boolean;
  communes: { insee: string; d: string }[];
  departments: string;
  territories: (string | null)[];
  /** Disques à l'écran (vue zoomée comprise ; rayon constant) */
  discs: (MapDisc | null)[];
  /** Disque dans le cadre de la carte (sinon : ni étiquette, ni astre, bouton recentré au focus) */
  visible: boolean[];
  scalePx: number | null;
  stops: (string | null)[];
  origins: OriginMark[];
  labels: PlacedLabel[];
}

type BaseLayout = Omit<MapLayout, 'origins' | 'labels' | 'visible'> & { projection: ReturnType<typeof mirrorProjection> };

type PathBoundsArg = Parameters<ReturnType<typeof geoPath>['bounds']>[0];

/**
 * Cadre propre à la carte : la barre de scénario est retirée pendant la carte, la carte prend toute
 * la hauteur entre la ligne du haut (retour + scénario compact) et la légende. Sur grand écran, la
 * légende passe en colonne à droite quand la carte y gagne en échelle (l'IDF projetée est plus large
 * que haute : la hauteur est presque toujours la contrainte). La projection est ajustée au cadre
 * (fitExtent sur les contours des communes) : l'IDF entière le remplit à l'ouverture.
 */
function mapFrame(width: number, height: number, headBottom: number, footer: number, aspect: number): { frame: Frame; side: boolean } {
  const phone = isPhoneLayout(width, height);
  const top = headBottom + (phone ? 10 : 8);
  const margin = phone ? 12 : 24;
  const bottom: Frame = { x: margin, y: top, w: Math.max(100, width - 2 * margin), h: Math.max(100, height - top - footer - (phone ? 16 : 12)) };
  if (phone || width < SIDE_MIN_WIDTH) return { frame: bottom, side: false };
  const right: Frame = { x: margin, y: top, w: Math.max(100, width - 2 * margin - SIDE_W - 16), h: Math.max(100, height - top - 16) };
  const scale = (f: Frame) => Math.min(f.w / aspect, f.h);
  return scale(right) > scale(bottom) * 1.02 ? { frame: right, side: true } : { frame: bottom, side: false };
}

/** Rapport largeur / hauteur de l'IDF projetée (Lambert-93), indépendant de l'écran. */
function geoAspect(geo: GeoData): number {
  const proj = mirrorProjection(geo, { x: 0, y: 0, w: 1000, h: 1000 });
  const [[x0, y0], [x1, y1]] = geoPath(proj).bounds({ type: 'FeatureCollection', features: geo.communes } as unknown as PathBoundsArg);
  const w = x1 - x0;
  const h = y1 - y0;
  return w > 0 && h > 0 ? w / h : 1;
}

/** Partie indépendante du scénario et du zoom (contours, disques) : recalculée seulement au redimensionnement. */
function buildBase(geo: GeoData, dataset: Dataset, width: number, height: number, headBottom: number, footer: number, skyBottom: number, astres44?: boolean): BaseLayout {
  const { frame, side } = mapFrame(width, height, headBottom, footer, geoAspect(geo));
  const projection = mirrorProjection(geo, frame);
  const path = geoPath(projection);
  // rayons du ciel (cadre du ciel, sans la carte) × 0,5 pour tous : l'aire reste ∝ postes
  const skyGeo = poleGeometry(dataset.poles, computeFrame(width, height, skyBottom, datasetBounds(dataset)), astres44);
  const communeByInsee = new Map(geo.communes.map((f) => [f.properties.insee, f]));
  const discs = dataset.poles.map((p, i) => {
    // D-030 (44 astres) : disque au centre de la commune qui nomme l'astre (poleDiscLonLat)
    const xy = projection(poleDiscLonLat(geo, p, !!astres44, communeByInsee));
    return xy ? { x: xy[0], y: xy[1], r: (skyGeo[i]?.r ?? 6) * mirror.discScale } : null;
  });
  // échelle mesurée au centre de l'emprise des communes
  const [[bx0, by0], [bx1, by1]] = path.bounds({ type: 'FeatureCollection', features: geo.communes } as unknown as PathBoundsArg);
  const center = projection.invert?.([(bx0 + bx1) / 2, (by0 + by1) / 2]) ?? [2.35, 48.85];
  return {
    frame,
    side,
    projection,
    communes: geo.communes.map((f) => ({ insee: f.properties.insee, d: path(f) ?? '' })),
    departments: path(geo.departments) ?? '',
    territories: dataset.poles.map((p) => {
      const f = geo.poleAreas.get(p.id);
      return f ? path(f) : null;
    }),
    discs,
    scalePx: scaleBarPx(projection, center[0], center[1], SCALE_KM),
    stops: dataset.poles.map((p) => geo.anchors.get(p.id)?.properties.stop_name ?? stopNameFromMethod(p.point.method)),
  };
}

/**
 * Vue zoomée : disques et communes d'origine à leur position à l'écran (même facteur sur les deux
 * axes : la projection n'est pas déformée), rayons et textes à taille constante. Les étiquettes sont
 * replacées à chaque vue, près de leur point et sans chevauchement ; un disque hors du cadre n'a pas
 * d'étiquette. Origine (A, et B en diptyque) d'abord, puis les pôles par postes décroissants.
 */
function buildLayout(
  base: BaseLayout,
  dataset: Dataset,
  views: { side: 'A' | 'B'; view: SkyView }[],
  dual: boolean,
  width: number,
  zv: MapView,
): MapLayout {
  const { projection, frame } = base;
  const discs: (MapDisc | null)[] = base.discs.map((d) => (d ? { ...applyMapView(zv, d), r: d.r } : null));
  const visible = discs.map((d) => !!d && inFrame(d, frame, d.r));
  const obstacles = discs.map((d, i) => (visible[i] ? d : null));
  const bounds = {
    x0: Math.max(4, frame.x - 20),
    y0: frame.y - 8,
    x1: base.side ? frame.x + frame.w + 12 : width - 4,
    y1: frame.y + frame.h + 8,
  };
  const reserved: PlacedLabel[] = [];
  const origins: OriginMark[] = [];
  for (const { side, view } of views) {
    if (!view.origin) continue;
    // D-017 : le point de départ du calcul s'il est publié (communes.json → origin), sinon le centre de la commune
    const o = view.origin;
    const start = calcOrigin(o);
    const xy0 = projection(start ? [start.lon, start.lat] : [o.lon, o.lat]);
    if (!xy0) continue;
    const xy = applyMapView(zv, { x: xy0[0], y: xy0[1] });
    const name = dual ? `${side} · ${o.name}` : o.name;
    const [label] = inFrame(xy, frame)
      ? placeMapLabels([{ index: side === 'A' ? -1000 : -1001, cx: xy.x, cy: xy.y, r: 7, w: textWidth(name, ORIGIN_FONT), h: 18 }], obstacles, {
          bounds,
          reserved,
          distances: [6, 22, 40],
        })
      : [];
    if (label) reserved.push(label);
    const startText = start ? originPointPhrase(o, dataset.meta.origin_methods).replace(/^Point/, 'point') : null;
    origins.push({ side, insee: o.insee, name, x: xy.x, y: xy.y, label: label ?? null, calc: !!start, startText });
  }
  const order = dataset.poles.map((p, i) => ({ p, i })).sort((a, b) => (b.p.jobs ?? 0) - (a.p.jobs ?? 0));
  const labels = placeMapLabels(
    order.filter(({ i }) => visible[i]).map(({ p, i }) => ({ index: i, cx: discs[i]!.x, cy: discs[i]!.y, r: discs[i]!.r, w: textWidth(poleShortName(p)), h: 16 })),
    obstacles,
    // distances courtes : une étiquette reste près de son point ; sans place, elle attend un zoom plus fort
    { bounds, reserved, distances: [4, 20, 36, 52] },
  );
  return { ...base, discs, visible, origins, labels };
}

const KIND_LABEL: Record<TerritoryKind, string> = {
  accessible: 'accessible aller et retour',
  out_only: 'aller possible, retour hors de portée',
  off: 'hors de portée',
  unknown: 'non calculé',
  neutral: 'ciel non révélé',
};

/** Glyphe d'état d'un disque (diptyque : la carte dessine les disques, les ciels s'effacent). Mêmes formes que l'astre. */
function DiscGlyph({ d, kind, selected }: { d: MapDisc; kind: TerritoryKind; selected: boolean }) {
  const ring = d.r + 3;
  return (
    <g className={`mdisc mdisc-${kind}`}>
      {kind === 'accessible' && (
        <>
          <circle cx={d.x} cy={d.y} r={d.r} fill={color.accessible} />
          <circle cx={d.x} cy={d.y} r={ring} fill="none" stroke={color.accessible} strokeWidth={1.25} />
        </>
      )}
      {kind === 'off' && (
        <>
          <circle cx={d.x} cy={d.y} r={d.r} fill={color.dim} />
          <circle cx={d.x} cy={d.y} r={ring} fill="none" stroke={color.dimRing} strokeWidth={1.4} strokeDasharray="3 2.5" />
        </>
      )}
      {kind === 'out_only' && (
        <>
          <circle cx={d.x} cy={d.y} r={d.r} fill={color.dim} />
          {/* moitié haute pleine (l'aller), moitié basse en tirets (le retour), comme l'astre */}
          <path d={`M${d.x - ring} ${d.y} A${ring} ${ring} 0 0 1 ${d.x + ring} ${d.y}`} fill="none" stroke={color.dimRing} strokeWidth={1.4} />
          <path
            d={`M${d.x + ring} ${d.y} A${ring} ${ring} 0 0 1 ${d.x - ring} ${d.y}`}
            fill="none"
            stroke={color.dimRing}
            strokeWidth={1.4}
            strokeDasharray="3 2.5"
          />
        </>
      )}
      {kind === 'unknown' && <circle cx={d.x} cy={d.y} r={ring} fill="none" stroke={color.dimRing} strokeWidth={1.2} strokeDasharray="0.1 3" strokeLinecap="round" />}
      {kind === 'neutral' && <circle cx={d.x} cy={d.y} r={d.r} fill={color.neutral} fillOpacity={0.55} />}
      {selected && <circle cx={d.x} cy={d.y} r={ring + 4} fill="none" stroke={color.accent} strokeWidth={2} />}
    </g>
  );
}

/** Étoile-guide à quatre branches (diptyque) : A pleine, B en contour. */
function GuideGlyph({ x, y, side }: { x: number; y: number; side: 'A' | 'B' }) {
  const r = 8;
  const d = `M${x} ${y - r} Q${x + 1} ${y - 1} ${x + r * 0.86} ${y} Q${x + 1} ${y + 1} ${x} ${y + r} Q${x - 1} ${y + 1} ${x - r * 0.86} ${y} Q${x - 1} ${y - 1} ${x} ${y - r}Z`;
  return side === 'A' ? <path d={d} fill={color.guide} /> : <path d={d} fill="none" stroke={color.guide} strokeWidth={1.25} />;
}

/** Zone qui ne déclenche ni glisser ni zoom (boutons de la carte, légende, ligne du haut). */
function isMapUi(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.mirror-head, .mirror-foot, .mirror-zoom');
}

/**
 * Carte miroir (plan § 15, critique v0.4 spec a) : du ciel au territoire, et retour.
 * Contours GEO01 (API Géo) en SVG, projection Lambert-93, disques posés sur l'arrêt de référence
 * de chaque pôle. Mêmes états que le ciel ; la carte change la vue, jamais l'état.
 * Ciel seul : les astres du moteur volent vers la carte. Diptyque : carte unique, les deux ciels
 * s'effacent, la carte dessine les disques et un sélecteur « Vu depuis A / B » bascule les états.
 * Zoom (vue seulement, même facteur sur les deux axes) : molette centrée sur le pointeur, pincement,
 * glisser, double-clic, boutons + / - / vue d'ensemble, clavier (+, -, flèches, 0). Traits, disques et
 * étiquettes gardent leur taille à l'écran ; les étiquettes sont replacées près de leur point.
 */
export function MirrorMap() {
  const sourcesOn = useProvenanceStore((s) => s.on);
  const open = useFeaturesStore((s) => s.mapOpen);
  const phase = useFeaturesStore((s) => s.mapPhase);
  const mapSide = useFeaturesStore((s) => s.mapSide);
  const setMapSide = useFeaturesStore((s) => s.setMapSide);
  const setPhase = useFeaturesStore((s) => s.setMapPhase);
  const setOpen = useFeaturesStore((s) => s.setMapOpen);
  const showToast = useFeaturesStore((s) => s.showToast);
  const dataset = useSkyStore((s) => s.dataset);
  const split = useSkyStore((s) => !!s.scenario.compare);
  const appPhase = useSkyStore((s) => s.phase);
  const reduced = useSkyStore(selectReducedMotion);
  const skyBottom = useSkyStore(selectSkyBottom);
  const astres44 = useSkyStore((s) => s.astres44);
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const view = useSkyView();
  const viewB = useCompareView();
  const { width, height } = useViewport();
  const palette = usePalette();
  const [geo, setGeo] = useState<GeoData | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [footerH, setFooterH] = useState(isPhoneLayout(width, height) ? 120 : 72);
  const [headBottom, setHeadBottom] = useState(() => bannerHeight() + (isPhoneLayout(width, height) ? 60 + 92 : 72 + 44));
  /** Vue zoomée de la carte (identité = IDF entière), liée au cadre pour lequel elle a été réglée */
  const [zoom, setZoom] = useState<{ key: string; v: MapView }>({ key: '', v: MAP_IDENTITY });
  const footerRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const panRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelOpen = useSkyStore((s) => !!s.scenario.pole || !!s.scenario.halo);
  // Tab boucle dans la carte (retour, sélecteur, disques), suspendu sous le panneau de preuve ou le halo
  // Visite en cours : la carte suit la narration, le focus reste où il est et Tab atteint les commandes de la visite
  const touring = useSkyStore((s) => s.tour.status !== 'idle');
  useFocusTrap(sectionRef, phase === 'map' && !panelOpen && !touring);
  // Focus initial sur « Revenir au ciel » quand la carte est posée (le focus est rendu à l'ouvreur au retour)
  useEffect(() => {
    if (phase === 'map' && !useSkyStore.getState().scenario.pole && useSkyStore.getState().tour.status === 'idle') closeRef.current?.focus();
  }, [phase]);
  const headRef = useRef<HTMLDivElement | null>(null);
  const token = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  /** Mode de la bascule en cours : vol (ciel seul) ou effacement (diptyque) */
  const flightMode = useRef<'fly' | 'fade'>('fly');
  const wasExplore = useRef(false);
  const dual = split && !!viewB?.origin;
  // Acte 0 : un lien &v=map attend la fin de la révélation (version courte), puis le vol
  const introDone = useSkyStore((s) => s.intro === 'done');
  const effectiveOpen = open && appPhase === 'explore' && introDone;

  // Données géographiques chargées à la première ouverture (tolérant : fichiers absents)
  useEffect(() => {
    if (!open || geo) return;
    let alive = true;
    void loadGeo().then((g) => {
      if (!alive) return;
      if (g) setGeo(g);
      else {
        setOpen(false);
        showToast('Carte indisponible : les contours des communes ne sont pas publiés.');
      }
    });
    return () => {
      alive = false;
    };
  }, [open, geo, setOpen, showToast]);

  // Retour à l'écran-titre : la carte se ferme (un lien &v=map attend l'entrée dans l'explorateur)
  useEffect(() => {
    if (appPhase === 'explore') wasExplore.current = true;
    else if (wasExplore.current && open) setOpen(false);
  }, [appPhase, open, setOpen]);

  // Bascule ciel seul ↔ diptyque carte ouverte : on referme proprement (la chorégraphie diffère)
  const prevDual = useRef(dual);
  useEffect(() => {
    if (prevDual.current !== dual && open) setOpen(false);
    prevDual.current = dual;
  }, [dual, open, setOpen]);

  const base = useMemo(
    () => (geo && dataset ? buildBase(geo, dataset, width, height, headBottom, footerH, skyBottom, astres44) : null),
    [geo, dataset, width, height, headBottom, footerH, skyBottom, astres44],
  );
  const frameRef = useRef<Frame | null>(null);
  const sideRef = useRef(false);
  useEffect(() => {
    frameRef.current = base?.frame ?? null;
    sideRef.current = !!base?.side;
  }, [base]);
  // Nouveau cadre (fenêtre redimensionnée, légende remesurée) : retour à la vue d'ensemble
  const frameKey = base ? `${Math.round(base.frame.x)},${Math.round(base.frame.y)},${Math.round(base.frame.w)},${Math.round(base.frame.h)}` : '';
  const zv = zoom.key === frameKey ? zoom.v : MAP_IDENTITY;
  const frameKeyRef = useRef(frameKey);
  useEffect(() => {
    frameKeyRef.current = frameKey;
  }, [frameKey]);
  const setZv = useCallback((u: MapView | ((v: MapView) => MapView)) => {
    setZoom((z) => {
      const key = frameKeyRef.current;
      const cur = z.key === key ? z.v : MAP_IDENTITY;
      return { key, v: typeof u === 'function' ? u(cur) : u };
    });
  }, []);

  const views = useMemo(() => {
    const out: { side: 'A' | 'B'; view: SkyView }[] = [];
    if (view) out.push({ side: 'A', view });
    if (dual && viewB) out.push({ side: 'B', view: viewB });
    return out;
  }, [view, viewB, dual]);
  const layout = useMemo(() => (base && dataset ? buildLayout(base, dataset, views, dual, width, zv) : null), [base, dataset, views, dual, width, zv]);
  // Cibles du vol (moteur) : un astre hors du cadre zoomé s'efface (cible nulle) ; au retour vers le
  // ciel, tous repartent de leur position réelle
  const leaving = phase === 'leaving';
  const targets: MirrorTargets | null = useMemo(() => {
    if (!layout) return null;
    const a = layout.origins.find((o) => o.side === 'A');
    return {
      poles: layout.discs.map((d, i) => (d && (leaving || layout.visible[i]) ? { x: d.x, y: d.y } : null)),
      guide: a ? { x: a.x, y: a.y } : null,
      guideOut: !!a && !leaving && !inFrame(a, layout.frame, 8),
    };
  }, [layout, leaving]);

  // Hauteur réelle de la légende (elle passe sur plusieurs lignes sur un écran étroit) ; en colonne,
  // sa hauteur ne réduit pas la carte : on garde la dernière mesure en bas
  const mounted = phase !== 'sky' && !!layout;
  useLayoutEffect(() => {
    const foot = footerRef.current;
    const head = headRef.current;
    if (!mounted || !foot || !head) return;
    const ro = new ResizeObserver(() => {
      if (!sideRef.current) setFooterH(Math.ceil(foot.getBoundingClientRect().height));
      setHeadBottom(Math.ceil(head.getBoundingClientRect().bottom));
    });
    ro.observe(foot);
    ro.observe(head);
    return () => ro.disconnect();
  }, [mounted]);

  // Cibles les plus récentes (mesures de la légende arrivées pendant l'attente du moteur)
  const latestTargets = useRef<MirrorTargets | null>(null);
  useEffect(() => {
    latestTargets.current = targets;
  }, [targets]);

  // Chorégraphie : décor 280 ms → vol 750 ms (moteur) → territoires 450 ms + étiquettes 120 ms ; retour inverse.
  // Diptyque : les deux ciels s'effacent en 280 ms, puis la carte apparaît.
  useEffect(() => {
    const root = document.documentElement;
    if (effectiveOpen && targets && phase === 'sky') {
      const t = ++token.current;
      flightMode.current = dual ? 'fade' : 'fly';
      opener.current = useSkyStore.getState().tour.status === 'idle' ? (document.activeElement as HTMLElement | null) : null;
      setPhase('entering');
      root.classList.add('mirror-on');
      if (useSkyStore.getState().scenario.halo) void applyScenario({ halo: null });
      void (async () => {
        // Lien partagé &v=map : attendre que le moteur soit démarré et son ouverture terminée
        const [a, b] = await Promise.all([whenEngineFeatures('A'), dual ? whenEngineFeatures('B') : Promise.resolve(null)]);
        await waitForSky();
        if (t !== token.current) return;
        if (dual) await Promise.all([a?.setMirrorHidden(true), b?.setMirrorHidden(true)]);
        else await a?.setMirror(latestTargets.current ?? targets);
        if (t === token.current) {
          setPhase('map');
          writeViewToUrl('map');
        }
      })();
    } else if (!effectiveOpen && (phase === 'map' || phase === 'entering')) {
      const t = ++token.current;
      setPhase('leaving');
      writeViewToUrl('sky');
      void (async () => {
        await new Promise((r) => window.setTimeout(r, reduced ? motion.reduced : motion.ui));
        if (t !== token.current) return;
        if (flightMode.current === 'fade') {
          await Promise.all([engineFeatures('A')?.setMirrorHidden(false), engineFeatures('B')?.setMirrorHidden(false)]);
        } else await engineFeatures('A')?.setMirror(null);
        if (t !== token.current) return;
        root.classList.remove('mirror-on');
        setPhase('sky');
        // prochaine ouverture : vue d'ensemble
        setZv(MAP_IDENTITY);
        opener.current?.focus?.();
      })();
    }
  }, [effectiveOpen, targets, phase, setPhase, reduced, applyScenario, dual, setZv]);

  // Redimensionnement ou zoom carte ouverte : nouvelles cibles, sans animation (au retour aussi)
  useEffect(() => {
    if (targets && flightMode.current === 'fly' && phase !== 'sky') engineFeatures('A')?.updateMirrorTargets(targets);
  }, [targets, phase]);

  useEffect(() => () => document.documentElement.classList.remove('mirror-on'), []);

  // Échap revient au ciel (le panneau de preuve, s'il est ouvert, se ferme d'abord)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useSkyStore.getState().scenario.pole || useSkyStore.getState().sourcesOpen) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  /** Applique un changement de vue sur le cadre courant. */
  const updateView = useCallback((fn: (v: MapView, f: Frame) => MapView) => {
    const f = frameRef.current;
    if (f) setZv((v) => fn(v, f));
  }, [setZv]);

  // Clavier : + / - zooment au centre, flèches déplacent, 0 revient à la vue d'ensemble
  useEffect(() => {
    if (phase !== 'map') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const st = useSkyStore.getState();
      if (st.scenario.pole || st.scenario.halo || st.sourcesOpen) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('input, textarea, select, [role="radiogroup"], [contenteditable="true"]')) return;
      const f = frameRef.current;
      if (!f) return;
      const step = Math.min(f.w, f.h) * MAP_PAN_STEP;
      let fn: ((v: MapView, f: Frame) => MapView) | null = null;
      switch (e.key) {
        case '+':
        case '=':
          fn = (v, fr) => zoomMapCenter(v, MAP_ZOOM_STEP, fr);
          break;
        case '-':
        case '_':
          fn = (v, fr) => zoomMapCenter(v, 1 / MAP_ZOOM_STEP, fr);
          break;
        case '0':
        case 'à': // touche 0 d'un clavier AZERTY sans Maj
          fn = () => MAP_IDENTITY;
          break;
        // la flèche montre ce qui est de ce côté : la carte glisse en sens inverse
        case 'ArrowLeft':
          fn = (v, fr) => panMap(v, step, 0, fr);
          break;
        case 'ArrowRight':
          fn = (v, fr) => panMap(v, -step, 0, fr);
          break;
        case 'ArrowUp':
          fn = (v, fr) => panMap(v, 0, step, fr);
          break;
        case 'ArrowDown':
          fn = (v, fr) => panMap(v, 0, -step, fr);
          break;
      }
      if (!fn) return;
      e.preventDefault();
      updateView(fn);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, updateView]);

  // Pointeur : molette (centrée sur le pointeur), glisser, pincement, double-clic. Sur toute la carte
  // (la surface de déplacement couvre l'écran : le ciel dessous ne reçoit plus rien).
  useEffect(() => {
    const el = sectionRef.current;
    const svg = el?.querySelector('svg.mirror-svg') as SVGSVGElement | null;
    if (!el || !svg || phase !== 'map') return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let dragging = false;
    let pinch = 0;
    let swallowClick = false;

    const onWheel = (e: WheelEvent) => {
      if (isMapUi(e.target)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      updateView((v, f) => zoomMapAt(v, factor, e.clientX, e.clientY, f));
    };
    const onDown = (e: PointerEvent) => {
      if (isMapUi(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        dragging = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        dragging = true;
        for (const id of pointers.keys()) if (!svg.hasPointerCapture(id)) svg.setPointerCapture(id);
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        if (!dragging && start && Math.hypot(cur.x - start.x, cur.y - start.y) > DRAG_THRESHOLD) {
          dragging = true;
          svg.setPointerCapture(e.pointerId);
          el.classList.add('is-dragging');
        }
        if (dragging) updateView((v, f) => panMap(v, cur.x - prev.x, cur.y - prev.y, f));
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch > 0) {
          const factor = d / pinch;
          updateView((v, f) => zoomMapAt(v, factor, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2, f));
        }
        pinch = d;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      pinch = 0;
      if (pointers.size === 0) {
        if (dragging) {
          // le clic qui suit un glisser n'ouvre pas le pôle sous le pointeur
          swallowClick = true;
          window.setTimeout(() => (swallowClick = false), 0);
        }
        dragging = false;
        start = null;
        el.classList.remove('is-dragging');
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const onDbl = (e: MouseEvent) => {
      // sur le fond seulement : un double-clic sur un pôle ouvre déjà son panneau
      if (e.target !== svg) return;
      const factor = e.shiftKey ? 1 / 2 : 2;
      updateView((v, f) => zoomMapAt(v, factor, e.clientX, e.clientY, f));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('click', onClick, true);
    svg.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      svg.removeEventListener('click', onClick, true);
      svg.removeEventListener('dblclick', onDbl);
      el.classList.remove('is-dragging');
    };
  }, [phase, updateView]);

  const focusPole = useCallback(
    (i: number | null) => {
      setHover(i);
      if (!dual) highlightPole(i);
    },
    [dual],
  );

  // Table OD (D-019) : chaque commune est une destination ; son état depuis l'origine (ciel affiché)
  const odActive = dual && mapSide === 'B' && viewB ? viewB : view;
  const odResult = odActive?.basis === 'od' ? odActive.od : null;
  const communeKinds = useMemo(() => mapCommuneKinds(odResult), [odResult]);
  const odIndex = useOdStore((s) => s.shown?.index ?? null);
  const [communeTip, setCommuneTip] = useState<{ insee: string; x: number; y: number } | null>(null);
  // D-030 (44 astres) : commune -> astre (poles[].communes), pour dire à quel astre appartient une commune survolée
  const astreOfCommune = useMemo(() => {
    const m = new Map<string, number>();
    if (astres44 && dataset) dataset.poles.forEach((p, i) => p.communes.forEach((c) => m.set(c, i)));
    return m;
  }, [astres44, dataset]);

  // Contours des communes : ~1 300 tracés, construits une fois par cadre et par état (le zoom ne change que le transform du groupe)
  const communesEl = useMemo(
    () =>
      base ? (
        <>
          <g
            className={`mirror-communes ${communeKinds.size ? 'is-od' : ''}`}
            onPointerLeave={communeKinds.size ? () => setCommuneTip(null) : undefined}
          >
            {base.communes.map((c) => {
              const k = communeKinds.get(c.insee);
              return (
                <path
                  key={c.insee}
                  d={c.d}
                  className={k ? `mc mc-${k}` : undefined}
                  onPointerMove={k ? (e) => setCommuneTip({ insee: c.insee, x: e.clientX, y: e.clientY }) : undefined}
                />
              );
            })}
          </g>
          <path className="mirror-deps" d={base.departments} />
        </>
      ) : null,
    [base, communeKinds],
  );

  if (phase === 'sky' || !layout || !view || !dataset) return null;

  const shown = phase === 'map';
  const fade = reduced ? motion.reduced / 1000 : shown ? mirror.territories / 1000 : motion.ui / 1000;
  const active = dual && mapSide === 'B' && viewB ? viewB : view;
  const activeSide: 'A' | 'B' = active === view ? 'A' : 'B';
  const kinds = active.states.map((s) => territoryKind(s.status, active.neutral));
  // Raison d'un sens nul : mêmes textes que le ciel et la liste (réglage de marche des TC cité, D-024)
  const reasons = reasonContext(active.dataset.meta, !!active.origin && isTimeDep(active), active.walkSetting);
  const whyOf = (i: number) => {
    const st = active.states[i];
    return !active.neutral && !!st && (st.status === 'none' || st.status === 'out_only') ? stateReasonText(st, reasons) : null;
  };
  const accessibleCount = kinds.filter((k) => k === 'accessible').length;
  /** Table OD : communes atteintes et postes, toute l'Île-de-France */
  const odTotals = active.basis === 'od' ? active.totals.od ?? null : null;
  const odShift = active.od ? formatShift({ start: active.od.scenario.start, end: active.od.scenario.end }) : null;
  const selected = view.scenario.pole ? dataset.poles.findIndex((p) => p.id === view.scenario.pole) : -1;
  const n = dataset.poles.length;
  const summary = active.origin
    ? active.neutral
      ? `Carte des ${n} pôles d'emploi et de ${active.origin.name}.`
      : odTotals
        ? `Carte des communes d'Île-de-France : ${formatInt(odTotals.reachedCommunes)} communes sur ${formatInt(odTotals.communes)} atteintes aller et retour depuis ${active.origin.name} en ${active.scenario.budget} minutes ou moins par sens, soit ${formatInt(odTotals.reachedAll)} postes salariés recensés par l'INSEE.`
        : `Carte des ${n} pôles d'emploi : ${accessibleCount} accessibles aller et retour depuis ${active.origin.name} en ${active.scenario.budget} minutes ou moins par sens.`
    : `Carte des ${n} pôles d'emploi d'Île-de-France.`;
  const hasUnknown = kinds.includes('unknown');
  const hasOutOnly = kinds.includes('out_only');
  const day = dataset.meta.day_types.find((d) => d.id === view.scenario.day);
  const walkShort = walkShortText(view.walkSetting);
  const scenarioLine = [
    odShift ? `horaires ${odShift}` : `journée-type ${day?.label ?? view.scenario.day}`,
    `en ${view.scenario.budget} min ou moins par sens`,
    `${MODE_SHORT[view.scenario.mode]}${walkShort ? `, ${walkShort}` : ''}`,
  ].join(' · ');
  const { frame } = layout;
  // Zone de dessin de la carte (les contours zoomés ne passent ni sous la ligne du haut, ni sous la légende)
  const clip = { x: 0, y: frame.y - 8, w: layout.side ? frame.x + frame.w + 12 : width, h: frame.h + 16 };
  const overview = isOverview(zv);
  const maxed = zv.k >= MAP_ZOOM_MAX - 1e-3;
  const hoverDisc = hover != null && layout.visible[hover] ? layout.discs[hover] : null;
  // Astre de la commune survolée : son contour est mis en avant (en plus du contour de la commune)
  const communeAstre = communeTip ? (astreOfCommune.get(communeTip.insee) ?? null) : null;
  const astreOutline = astres44 && !!odTotals;
  // Échelle graphique : longueur ronde qui reste lisible au zoom courant (mesurée sur la projection)
  const pxPerKm = layout.scalePx ? (layout.scalePx / SCALE_KM) * zv.k : null;
  const scaleKm = pxPerKm ? (SCALE_STEPS_KM.find((km) => km * pxPerKm <= SCALE_MAX_PX) ?? SCALE_STEPS_KM.at(-1)!) : null;
  const scale = pxPerKm && scaleKm ? { km: scaleKm, px: scaleKm * pxPerKm } : null;

  return (
    <section className="mirror" aria-label="Carte miroir" ref={sectionRef}>
      <div className={`mirror-pan ${shown ? 'is-on' : ''}`} ref={panRef} aria-hidden="true" />
      <m.svg
        className="mirror-svg"
        width={width}
        height={height}
        role="img"
        aria-label={summary}
        initial={{ opacity: 0 }}
        animate={{ opacity: shown ? 1 : 0 }}
        transition={{ duration: fade, ease: motion.cssEasing.ui }}
      >
        <defs>
          {/* Table OD : hachures « aller possible, retour hors de portée » (la couleur n'est jamais seule) */}
          <pattern id="mc-hatch" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="rgba(80, 97, 127, 0.28)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="#9fb0cf" strokeWidth="1.4" />
          </pattern>
          <clipPath id="mirror-clip" clipPathUnits="userSpaceOnUse">
            <rect x={clip.x} y={clip.y} width={clip.w} height={clip.h} />
          </clipPath>
        </defs>
        <g clipPath="url(#mirror-clip)">
          {/* même facteur sur les deux axes ; traits d'épaisseur constante (vector-effect: non-scaling-stroke) */}
          <g transform={`translate(${zv.x} ${zv.y}) scale(${zv.k})`}>
            {communesEl}
            <g className={`mirror-territories ${odTotals ? 'is-od' : ''} ${astreOutline ? 'is-astres' : ''}`} style={astreOutline ? getAstreVars(palette) : undefined}>
              {/* D-030 : liseré sombre sous le contour clair de l'astre (lisible sur communes atteintes et hors de portée) */}
              {astreOutline && layout.territories.map((d, i) => (d ? <path key={`casing-${dataset.poles[i]!.id}`} d={d} className="terr-casing" aria-hidden="true" /> : null))}
              {layout.territories.map((d, i) =>
                d ? (
                  <path
                    key={dataset.poles[i]!.id}
                    d={d}
                    className={`terr terr-${kinds[i]} ${hover === i || selected === i || communeAstre === i ? 'is-hover' : ''}`}
                    onPointerEnter={() => focusPole(i)}
                    onPointerLeave={() => focusPole(null)}
                    onClick={() => void applyScenario({ pole: dataset.poles[i]!.id })}
                  />
                ) : null,
              )}
            </g>
            {layout.origins.map((o) => (
              <path key={o.side} className={`mirror-origin ${o.side === 'B' ? 'is-b' : ''}`} d={originPath(geo, o.insee, layout)} />
            ))}
          </g>
          {dual && (
            <g className="mirror-discs" aria-hidden="true">
              {layout.discs.map((d, i) =>
                d && layout.visible[i] ? <DiscGlyph key={dataset.poles[i]!.id} d={d} kind={kinds[i]!} selected={selected === i || hover === i} /> : null,
              )}
              {layout.origins.map((o) => (
                <GuideGlyph key={o.side} x={o.x} y={o.y} side={o.side} />
              ))}
            </g>
          )}
        </g>
        <m.g
          className="mirror-labels"
          initial={{ opacity: 0 }}
          animate={{ opacity: shown ? 1 : 0 }}
          transition={{ duration: reduced ? motion.reduced / 1000 : mirror.labels / 1000, delay: shown && !reduced ? mirror.territories / 1000 : 0 }}
        >
          {layout.labels.map((l) => (
            <g key={l.index}>
              {l.leader && <line className="mirror-leader" x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2} />}
              <text x={l.x} y={l.y + 12} className={`mirror-label ${kinds[l.index] === 'accessible' ? 'is-on' : ''}`}>
                {poleShortName(dataset.poles[l.index]!)}
              </text>
            </g>
          ))}
          {layout.origins.map((o) =>
            o.label ? (
              <g key={o.side}>
                {o.label.leader && <line className="mirror-leader" x1={o.label.leader.x1} y1={o.label.leader.y1} x2={o.label.leader.x2} y2={o.label.leader.y2} />}
                <text x={o.label.x} y={o.label.y + 14} className="mirror-origin-label">
                  {o.name}
                </text>
              </g>
            ) : null,
          )}
        </m.g>
      </m.svg>

      <ul className="mirror-poles" aria-label="Pôles d'emploi sur la carte">
        {dataset.poles.map((p, i) => {
          const d = layout.discs[i];
          const d0 = layout.visible[i] ? d : null;
          if (!d) return null;
          const s = Math.max(28, d.r * 2 + 8);
          const st = active.states[i]!;
          const why = whyOf(i);
          const label = `${p.name}, ${p.jobs == null ? 'postes non disponibles' : `${formatInt(p.jobs)} postes salariés recensés par l'INSEE`}, ${
            active.neutral ? 'ciel non révélé' : st.od ? poleShareState(st.od) : statusLabel[st.status]
          }${why && !st.od ? ` (${why})` : ''}${dual && active.origin ? ` depuis ${active.origin.name}` : ''}${astres44 && p.bassin ? `, ${astreLine(p)}, ${astreSize(p)}` : ''}${layout.stops[i] ? `, point d'arrivée ${layout.stops[i]} (arrêt le plus desservi du pôle)` : ''}`;
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`mirror-hit ${d0 ? '' : 'is-out'}`}
                style={{ left: d.x - s / 2, top: d.y - s / 2, width: s, height: s }}
                aria-label={label}
                aria-pressed={selected === i}
                onPointerEnter={() => focusPole(i)}
                onPointerLeave={() => focusPole(null)}
                onFocus={() => {
                  focusPole(i);
                  // pôle hors du cadre zoomé atteint au clavier : la carte se recentre dessus
                  const b = base?.discs[i];
                  if (!layout.visible[i] && b) updateView((v, f) => centerMapOn(v, b, f));
                }}
                onBlur={() => focusPole(null)}
                onClick={() => void applyScenario({ pole: p.id })}
              />
            </li>
          );
        })}
      </ul>

      {hover != null && hoverDisc && (
        <div className="mirror-tip" style={{ left: hoverDisc.x, top: hoverDisc.y + hoverDisc.r + 10 }} aria-hidden="true">
          <strong>{dataset.poles[hover]!.name}</strong>
          <span>{active.states[hover]?.od ? poleShareState(active.states[hover]!.od!) : KIND_LABEL[kinds[hover]!]}</span>
          {whyOf(hover) && !active.states[hover]?.od && <span>{capitalizeFirst(whyOf(hover)!)}</span>}
          {astres44 && astreLine(dataset.poles[hover]!) && <span>{astreLine(dataset.poles[hover]!)}</span>}
          {astres44 && astreSize(dataset.poles[hover]!) && <span>{astreSize(dataset.poles[hover]!)}</span>}
          {layout.stops[hover] && (
            <span>
              {active.states[hover]?.od
                ? astres44
                  ? `Disque au centre de ${nameCommune(dataset, hover)} (commune qui nomme l'astre), arrêt le plus desservi : ${layout.stops[hover]}`
                  : `Disque posé sur : ${layout.stops[hover]} (arrêt le plus desservi du pôle, pour l'affichage seulement)`
                : `Point d'arrivée : ${layout.stops[hover]} (arrêt le plus desservi du pôle)`}
            </span>
          )}
        </div>
      )}

      {communeTip && odResult && shown && (() => {
        const d = odResult.dests.find((x) => x.insee === communeTip.insee);
        if (!d) return null;
        const ctx = odIndex
          ? odTextContext(odIndex, odResult.timeDependent, active.scenario.mode)
          : { maxTripMin: null, timeDependent: odResult.timeDependent, partial: false };
        const name = dataset.communes.find((c) => c.insee === d.insee)?.name ?? d.insee;
        return (
          <div className="mirror-tip mirror-tip-commune" style={{ left: communeTip.x, top: communeTip.y + 18 }} aria-hidden="true">
            <strong>{name}</strong>
            {communeAstre != null && astreLine(dataset.poles[communeAstre]!) && <span>{astreLine(dataset.poles[communeAstre]!)}</span>}
            <span>{formatInt(d.jobs)} postes salariés (INSEE)</span>
            {d.status === 'self' ? (
              <span>{capitalizeFirst(selfJobsText(d.jobs))}</span>
            ) : (
              <>
                <span>{COMMUNE_LABEL[d.status]}</span>
                <span>{capitalizeFirst(odLegText(d.out, 'out', ctx))}</span>
                <span>{capitalizeFirst(odLegText(d.ret, 'ret', ctx, odResult.scenario.end))}</span>
              </>
            )}
          </div>
        );
      })()}

      <div className="mirror-head" ref={headRef}>
        <button type="button" className="btn mirror-close" ref={closeRef} onClick={() => setOpen(false)} aria-keyshortcuts="Escape">
          Revenir au ciel <kbd>Échap</kbd>
        </button>
        <p className="mirror-scenario">
          {dual ? (
            <>
              <span className="mirror-scn-origin">A · {view.origin?.name}</span> et <span className="mirror-scn-origin">B · {viewB?.origin?.name}</span>
            </>
          ) : (
            view.origin && <span className="mirror-scn-origin">Depuis {view.origin.name}</span>
          )}
          <span>{scenarioLine}</span>
          {!active.neutral && active.origin && (
            <span className="mirror-scn-count">
              {odTotals
                ? `${formatInt(odTotals.reachedCommunes)} communes atteintes, ${formatInt(odTotals.reachedAll)} postes${dual ? ` depuis ${activeSide}` : ''}`
                : `${accessibleCount} pôles sur ${n} accessibles${dual ? ` depuis ${activeSide}` : ''}`}
            </span>
          )}
        </p>
        {dual && (
          <div className="seg mirror-side" role="radiogroup" aria-label="États des territoires">
            {(['A', 'B'] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={activeSide === s} className={activeSide === s ? 'is-on' : ''} onClick={() => setMapSide(s)}>
                Vu depuis {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {shown && (
        <div className="mirror-zoom" role="group" aria-label="Zoom de la carte" style={{ top: frame.y, right: 24 }}>
          <button type="button" className="icon-btn" onClick={() => updateView((v, f) => zoomMapCenter(v, MAP_ZOOM_STEP, f))} disabled={maxed} aria-label="Zoomer sur la carte" aria-keyshortcuts="+">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="icon-btn" onClick={() => updateView((v, f) => zoomMapCenter(v, 1 / MAP_ZOOM_STEP, f))} disabled={overview} aria-label="Dézoomer la carte" aria-keyshortcuts="-">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="icon-btn" onClick={() => setZv(MAP_IDENTITY)} disabled={overview} aria-label="Vue d'ensemble de l'Île-de-France" aria-keyshortcuts="0">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          {!overview && <span className="zoom-level mono">{zv.k.toFixed(1).replace('.', ',')}×</span>}
        </div>
      )}

      <m.div
        ref={footerRef}
        className={`mirror-foot ${layout.side ? 'is-side' : ''}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: shown ? 1 : 0 }}
        transition={{ duration: fade }}
      >
        <ul className="mirror-legend" aria-label="Légende de la carte">
          {!active.neutral && odTotals && (
            <>
              <li>
                <span className="mk mk-c-accessible" aria-hidden="true" /> Commune atteinte aller et retour en {active.scenario.budget} min ou moins par sens
              </li>
              {communeKindsList(communeKinds).includes('out_only') && (
                <li>
                  <span className="mk mk-c-out_only" aria-hidden="true" /> Aller possible, retour hors de portée (hachures)
                </li>
              )}
              <li>
                <span className="mk mk-c-none" aria-hidden="true" /> Hors de portée
              </li>
              {communeKindsList(communeKinds).includes('unknown') && (
                <li>
                  <span className="mk mk-unknown" aria-hidden="true" /> Non calculé
                </li>
              )}
              <li>
                {astreOutline ? (
                  <>
                    <span className="mk mk-terr-astre" aria-hidden="true" /> Contour épais : communes regroupées dans un astre (disque : part de ses postes atteinte au survol)
                  </>
                ) : (
                  <>
                    <span className="mk mk-terr-od" aria-hidden="true" /> Contour d'un pôle d'emploi (disque : part de ses postes atteinte au survol)
                  </>
                )}
              </li>
              {active.walkSetting && <li className="mirror-legend-note">{capitalizeFirst(walkSettingPhrase(active.walkSetting))} à chaque bout</li>}
            </>
          )}
          {!active.neutral && !odTotals && (
            <>
              <li>
                <span className="mk mk-accessible" aria-hidden="true" /> Accessible aller et retour en {active.scenario.budget} min ou moins par sens
              </li>
              {hasOutOnly && (
                <li>
                  <svg className="mk mk-svg" viewBox="0 0 18 12" aria-hidden="true">
                    <rect x="0.75" y="0.75" width="16.5" height="10.5" rx="2.5" className="mk-out_only-shape" />
                  </svg>{' '}
                  Aller possible, retour hors de portée
                </li>
              )}
              <li>
                <span className="mk mk-off" aria-hidden="true" /> Hors de portée
              </li>
              {active.walkSetting && <li className="mirror-legend-note">{capitalizeFirst(walkSettingPhrase(active.walkSetting))} à chaque bout</li>}
              {hasUnknown && (
                <li>
                  <span className="mk mk-unknown" aria-hidden="true" /> Non calculé
                </li>
              )}
            </>
          )}
          {/* Hors table OD (journées-types), les communes hors astre ne sont pas des destinations :
              leur contour sombre ne veut pas dire « inaccessible ». En table OD (D-019), toutes le sont. */}
          {!odTotals && <li className="mirror-legend-note">Autres communes : en cours de calcul pour les 44 astres (mode ou réglage pas encore calculé)</li>}
          {layout.origins.map((o) => (
            <li key={o.side}>
              <span className={`mk mk-origin ${o.side === 'B' ? 'is-b' : ''}`} aria-hidden="true" /> {o.name}
              {o.startText ? ` : ${sourcesOn ? o.startText : stripSourceParen(o.startText)}` : ' : commune de départ'}
            </li>
          ))}
          {scale && (
            <li className="mirror-scale-dom">
              <span className="mirror-scale-bar" style={{ width: scale.px }} aria-hidden="true" /> {scale.km} km
            </li>
          )}
        </ul>
        <p>
          Contours des communes : API Géo, IGN (ODbL), simplifiés pour l'affichage ; aucun calcul ne les utilise.{' '}
          {/* « Comment lire ce graphique » : la place des disques et la projection du ciel (phrases rangées ici, mots inchangés), puis le cas
              de la commune affichée (communes ou pôles en cyan, lus dans les totaux du ciel) */}
          <ChartReadingTip
            chart="carte miroir"
            placement="top"
            reading={mirrorReading({
              origin: active.neutral ? null : (active.origin?.name ?? null),
              budget: active.scenario.budget,
              od: odTotals,
              accessibleCount,
              poleCount: n,
              astres: astres44,
            })}
          />
        </p>
        {/* Mode provenance : contours, disques, aire et temps de trajet, chacun avec le lien vers sa fiche */}
        <MapSourceNote mode={active.scenario.mode} />
        <p className="mirror-zoom-help">Molette, pincement ou touches + et - pour zoomer, glisser ou flèches pour se déplacer, 0 pour la vue d'ensemble.</p>
      </m.div>
    </section>
  );
}

/** D-030 : jetons du contour d'astre (theme/tokens.ts, mirrorAstre) passés au CSS (features.css, .mirror-territories.is-astres) */
function getAstreVars(palette: ReturnType<typeof usePalette>): CSSProperties {
  return {
    '--astre-w': `${mirrorAstre.width}px`,
    '--astre-casing-w': `${palette.mirrorCasing.casingWidth}px`,
    '--astre-hover-extra': `${mirrorAstre.hoverExtra}px`,
    '--astre-a': mirrorAstre.alpha,
    '--astre-casing-a': palette.mirrorCasing.casingAlpha,
    '--astre-casing': palette.mirrorCasing.casingColor,
  } as CSSProperties;
}

/** Astre : « Astre Fontainebleau, bassin Sud 77 » (nom court du ciel et bassin publiés), null hors des 44 astres. */
function astreLine(p: Pole): string | null {
  return p.bassin ? `Astre ${poleShortName(p)}, bassin ${p.bassin.name}` : null;
}

/** Astre : « 106 communes, 49 468 postes salariés (INSEE) » (poles.json, jamais écrit en dur). */
function astreSize(p: Pole): string | null {
  if (!p.bassin) return null;
  const n = p.communes.length;
  return `${formatInt(n)} commune${n > 1 ? 's' : ''}${p.jobs == null ? '' : `, ${formatInt(p.jobs)} postes salariés (INSEE)`}`;
}

const COMMUNE_LABEL: Record<Exclude<MapCommuneKind, 'self'>, string> = {
  accessible: 'atteinte aller et retour',
  out_only: 'aller possible, retour hors de portée',
  none: 'hors de portée',
  unknown: 'non calculé',
};

function communeKindsList(kinds: ReadonlyMap<string, MapCommuneKind>): MapCommuneKind[] {
  return [...new Set(kinds.values())];
}

/** Commune qui nomme l'astre `i` (name_short_insee), sinon le nom court de l'astre. */
function nameCommune(dataset: Dataset, i: number): string {
  const p = dataset.poles[i]!;
  return dataset.communes.find((c) => c.insee === p.name_short_insee)?.name ?? poleShortName(p);
}

function capitalizeFirst(t: string): string {
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
}

/** Série propre à la journée-type (TC) : la raison cite alors l'heure (aller avant le début, retour après la fin). */
function isTimeDep(v: SkyView): boolean {
  return v.scenario.mode === 'transit' || v.scenario.mode === 'bike_transit';
}

function originPath(geo: GeoData | null, insee: string, layout: MapLayout): string {
  const i = geo?.communes.findIndex((c) => c.properties.insee === insee) ?? -1;
  return i >= 0 ? (layout.communes[i]?.d ?? '') : '';
}

export default MirrorMap;
