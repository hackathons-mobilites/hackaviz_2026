import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { GAIN_POLE_TEXT, isGained } from '../data/gain';
import {
  ITINERARY_EXAMPLE_TAIL,
  ITINERARY_METHOD_NOTE,
  itineraryAvailability,
  itineraryDay,
  itineraryExampleLead,
  itineraryReturnStopNote,
  itineraryStopNote,
  itineraryOf,
  itinerariesSource,
  itineraryUnavailableText,
  poleUnlistedText,
  tripEntry,
  tripUnavailableText,
} from '../data/itineraries';
import { odBadge, odCommuneCount, odExampleMismatchText, odShiftText } from '../data/od/proofOd';
import { odTextContext } from '../data/od/texts';
import { originPointPhrase, poleCommuneNames, proofContextLine, proofSources, shiftText, shortCommuneName, stripDecisionCodes } from '../data/proof';
import { stopNameFromMethod } from '../data/stopName';
import { walkSettingPhrase } from '../data/walkSettings';
import { frenchDayDate } from '../poster/posterText';
import { returnFocus } from '../hooks/focusReturn';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { centerOnPole } from '../state/centerOn';
import { useCompareView, useSkyView } from '../store/selectors';
import { skyEffects, waitForSky } from '../store/skyBridge';
import { useOdStore } from '../store/useOdStore';
import { selectReducedMotion, selectShowsFakeData, selectSkyBottom, useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { useReservedRect } from '../store/overlayRects';
import './features.css';
import './proof/proof.css';
import { useFeaturesStore } from './featuresStore';
import { useProvenanceStore } from '../store/provenanceStore';
import { equivalentDistance } from '../state/budget';
import { GainBadgeLine, ProofBadgeLine } from './proof/ProofBadgeLine';
import { ProofCarCost } from './proof/ProofCarCost';
import { PanelCredits } from './proof/PanelCredits';
import { ProofJobs } from './proof/ProofJobs';
import { ProofRecruit, RecruitKeep } from './recruit/ProofRecruit';
import { ProofOd } from './proof/ProofOd';
import { ProofTimes } from './proof/ProofTimes';
import { ProofTraffic } from './proof/ProofTraffic';
import { TripBlock } from './proof/TripBlock';
import { ModeTripBlock } from './proof/ModeTripBlock';
import { NeedsAstreMark, NeedsNotes, NeedsRecall, NeedsTripSummary } from './proof/ProofNeeds';
import { PfGroup } from './proof/PfGroup';
import { formatInt } from '../data/format';
import { NEEDS_TITLE, needsTripLabel, type NeedsLeg } from '../data/needs';
import { ProofTransferCheck, TransferRiskBadge } from './proof/ProofTransferCheck';
import { transferCheckMeta } from '../data/transferCheck';
import { sideFacts, type Side } from './proof/sideFacts';
import { useItineraries } from './proof/useItineraries';
import { ProofModes } from './proof/ProofModes';
import { ProofOffpeak } from './proof/ProofOffpeak';
import { ProofPublicOffers } from './proof/ProofPublicOffers';
import { SourceTip } from './proof/SourceTip';
import { TipLines } from './proof/TipLines';
import { InfoTip } from './InfoTip';
import { modeComparison, modesAnchorNote } from '../data/modesCompare';
import { offpeakFact } from '../data/offpeak';
import { useBottomSheet, useIsPhone } from './useBottomSheet';
import { useOriginContext } from './useOriginContext';
import { ProofSubscriptions, ProofTransitCover, ProofTransitPass } from './subscriptions/ProofSubscriptions';
import { useTransitChoice } from './subscriptions/useTransitChoice';
import {
  nearestDayType,
  noItineraryCostText,
  passFigure,
  type NoItineraryCost,
} from '../data/costLines';
import { transitRoundTrip, velibRides } from '../data/subscriptions';
import { useSubscriptionsStore } from './subscriptions/subscriptionsStore';
import { VelibWarning } from './VelibWarning';
import { BassinSourceNote, StopSourceNote, TravelSourceNote } from './provenance/ProofNotes';
import { WorkTimeFold, WorkTimeFoldSources } from './territoire/WorkTime';

/**
 * Nombre de communes affichées avant de replier la liste (« et N autres »).
 * Ajusté en D-030 pour les grands astres (153 communes pour Est 77, 121 pour Seine-Aval) :
 * un seul pôle peut avoir beaucoup de communes, et le repli de 4 → 6 suffit pour éviter un très long défilement.
 */
const COMMUNES_SHOWN = 6;

/** Voiture route vide (P18) : première ligne du « i » du bloc voiture, ou écrite seule si aucun indice de trafic n'est publié */
const CAR_OPTIMISTIC_TEXT = 'Voiture route vide : temps optimiste aux heures de pointe.';

const capitalize = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;

/**
 * Panneau de preuve d'un pôle, en deux niveaux (chantier C, lot 3, D-050) :
 * PREMIER NIVEAU, toujours lu : en-tête (pôle, « Depuis … · journée … · mardi type », badge d'état) ; le résultat (temps aller et
 * retour, ou en horaires libres la part des postes atteinte) ; le trajet aller et retour avec ses lignes (détail replié) ; les
 * phrases qui changent le sens d'un chiffre (liste `keep-visible.json`) ; puis le pied : mode et réglage de marche, crédit
 * OpenStreetMap, trois boutons (carte, centrer, lien).
 * SIX PLIS INDÉPENDANTS (jamais `<details name>` : l'étape 28 de `smoke.mjs` les ouvre tous d'un coup), le chiffre clé dans le titre :
 * « Communes du pôle », « Coût et carbone », « Emplois et recrutement » (postes, projets de recrutement, offres du service
 * public), « Ce qu'il me faut sur mon trajet », « Comparer les moyens de transport » (avec l'heure creuse, lot 4 de l'audit
 * d'affichage du 10/11), « Méthode et sources » (recapitulatif du scénario, point d'arrivée, sources).
 * Blocs rendus seulement si la donnée est publiée (D-028), sinon une phrase dit pourquoi ; en commune par
 * commune, l'itinéraire est un exemple vers l'arrêt d'ancrage du pôle, et le dit.
 * Chaque nombre vient d'un JSON du pipeline ; les heures d'arrivée sont dérivées (départ + durée).
 */
export function ProofPanel() {
  const view = useSkyView();
  const open = !!view?.selectedPole && !!view.selectedState;
  return <AnimatePresence>{open && <ProofContent key="proof" />}</AnimatePresence>;
}

function ProofContent() {
  const view = useSkyView();
  const viewB = useCompareView();
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const provenanceOn = useProvenanceStore((s) => s.on);
  const astres44 = useSkyStore((s) => s.astres44);
  const accessA = useSkyStore((s) => (view?.origin ? s.access[view.origin.insee] : undefined));
  const accessB = useSkyStore((s) => (viewB?.origin ? s.access[viewB.origin.insee] : undefined));
  const gainReport = useSkyStore((s) => s.gainReport);
  const odIndex = useOdStore((s) => s.shown?.index ?? null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fake = useSkyStore(selectShowsFakeData);
  const pole = view?.selectedPole ?? null;
  const state = view?.selectedState ?? null;
  const ctxA = useOriginContext(pole ? view?.origin?.insee : null);
  const ctxB = useOriginContext(pole ? viewB?.origin?.insee : null);
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const setMapOpen = useFeaturesStore((s) => s.setMapOpen);
  const mapOpen = useFeaturesStore((s) => s.mapOpen);
  const mapPhase = useFeaturesStore((s) => s.mapPhase);
  const split = useSkyStore((s) => !!s.scenario.compare);
  const phone = useIsPhone();
  const asideRef = useRef<HTMLElement>(null);
  const od = view?.basis === 'od' ? view.od : null;
  // Itinéraires détaillés (D-028) : TC, réglage de marche par défaut (celui du calcul), une commune, journée-type.
  // En commune par commune (table OD), seulement si les horaires sont ceux d'une journée-type ; l'itinéraire va
  // alors à l'arrêt d'ancrage du pôle (exemple de trajet), pas au centre de chaque commune.
  const itinMeta = view?.dataset.meta;
  const itinDayId =
    view && itinMeta
      ? itineraryDay(itinMeta.day_types, view.scenario.day, od ? { start: od.scenario.start, end: od.scenario.end } : view.scenario.shift ?? null)
      : null;
  // Réglage de marche du scénario (D-024) : itinéraires « confort » publiés à part (meta.itineraries_variants)
  const itinWalkKey = view?.walkSetting?.key ?? null;
  const itinSrc = itinMeta ? itinerariesSource(itinMeta, itinWalkKey) : null;
  const itinWhy =
    view?.origin && itinMeta
      ? itineraryAvailability({
          mode: view.scenario.mode,
          walkKey: itinWalkKey,
          day: itinDayId,
          split,
          listed: !!itinSrc?.communes.includes(view.origin.insee),
          walkPublished: !!itinSrc,
        })
      : null;
  const itin = useItineraries(view?.origin?.insee, !!view?.origin && itinWhy === null, itinWalkKey);
  // Comparer les modes : itinéraire TC du réglage du scénario, chargé aussi quand un autre mode est affiché
  const modesItinOk =
    !!view?.origin && !split && !!itinDayId && !!itinSrc?.communes.includes(view.origin.insee) && view.scenario.mode !== 'transit';
  const itinForModes = useItineraries(view?.origin?.insee, modesItinOk, itinWalkKey);
  // Abonnement TC en vigueur (aucun pendant la visite) : choisit la ligne de coût du pli « Coût et carbone » (D-032)
  const transitChoice = useTransitChoice();

  // Visite en cours : le panneau suit la narration, le focus reste où il est et Tab atteint les commandes de la visite
  const touring = useSkyStore((s) => s.tour.status !== 'idle');
  // Focus initial sur la croix (le titre reste le nom accessible du dialogue)
  useEffect(() => {
    if (pole && useSkyStore.getState().tour.status === 'idle') closeRef.current?.focus();
  }, [pole]);

  const close = () => {
    const id = pole?.id;
    // En visite, focus dans le panneau : il passe à Pause / Reprendre, l'astre ne le reprend pas
    if (useSkyStore.getState().tour.status !== 'idle') {
      returnFocus(document.querySelector<HTMLElement>('.tour-playpause'), asideRef.current);
      void applyScenario({ pole: null });
      return;
    }
    void applyScenario({ pole: null });
    // rendre le focus à l'astre (sur la carte : au bouton du disque)
    const idx = view?.dataset.poles.findIndex((p) => p.id === id) ?? -1;
    const sel = useFeaturesStore.getState().mapPhase === 'sky' ? '.pole-hit' : '.mirror-hit';
    const btn = document.querySelectorAll<HTMLButtonElement>(sel)[idx];
    btn?.focus();
  };
  // Lot 6 : tout repart replié à chaque astre (rien n'est mémorisé d'un astre ni d'une session à l'autre) ; la visite rouvre ce qu'elle commente
  useEffect(() => {
    asideRef.current?.querySelectorAll('details').forEach((d) => {
      d.open = false;
    });
  }, [pole?.id]);
  const { sheetProps, handleProps } = useBottomSheet(phone, close);
  // Tab boucle dans le panneau (prioritaire sur le halo et la carte, qui suspendent leur piège) ; suspendu quand le
  // dialogue « Mes abonnements » est ouvert par-dessus
  const subsOpen = useSubscriptionsStore((s) => s.dialogOpen);
  useFocusTrap(asideRef, !subsOpen && !touring);

  // Échap ferme et rend le focus à l'astre (sauf si le tiroir des sources est au-dessus)
  const closeRefFn = useRef(close);
  useEffect(() => {
    closeRefFn.current = close;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useSkyStore.getState().sourcesOpen && !useSubscriptionsStore.getState().dialogOpen) closeRefFn.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Étoile filante (moteur A) vers un pôle ACCESSIBLE, une fois le ciel posé : trait symbolique,
  // jamais vers un pôle hors de portée (le trait laisserait croire à un chemin). Pas en table OD :
  // un pôle « en partie » atteint n'a pas un trajet unique.
  const reduced = useSkyStore(selectReducedMotion);
  const canTrace = !!pole && !split && !!view && !view.neutral && !od && state?.status === 'accessible' && mapPhase === 'sky';
  const playTrace = () => {
    const id = pole?.id;
    if (!id) return;
    void waitForSky().then(() => {
      if (useSkyStore.getState().scenario.pole === id && useFeaturesStore.getState().mapPhase === 'sky') void skyEffects()?.playShootingStar(id);
    });
  };
  useEffect(() => {
    if (canTrace) playTrace();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois par ouverture sur un pôle
  }, [pole?.id, canTrace]);
  const poleIndex = pole && view ? view.dataset.poles.findIndex((p) => p.id === pole.id) : -1;

  /** Zone du ciel non couverte par le panneau (px écran). */
  const visibleArea = () => {
    const rect = asideRef.current?.getBoundingClientRect();
    const top = phone ? 56 : 72;
    if (!rect) return null;
    if (phone) return { x: 0, y: top, w: window.innerWidth, h: window.innerHeight - rect.height - top };
    return { x: 0, y: top, w: rect.left - 16, h: window.innerHeight - top - selectSkyBottom(useSkyStore.getState()) };
  };

  // Téléphone : la caméra glisse pour garder le pôle visible au-dessus de la feuille (zoom inchangé)
  useEffect(() => {
    if (!phone || poleIndex < 0 || split || useFeaturesStore.getState().mapPhase !== 'sky') return;
    const id = window.requestAnimationFrame(() => {
      const area = visibleArea();
      if (area) centerOnPole(poleIndex, area, 1);
    });
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recadrage à l'ouverture et au changement de pôle seulement
  }, [phone, poleIndex, split]);

  const centerHere = () => {
    const area = visibleArea();
    if (area && poleIndex >= 0) centerOnPole(poleIndex, area);
  };

  // Zone réservée du ciel (L-02) : aucun nom ne passe sous le panneau, les cartes s'en écartent
  useReservedRect('proof', asideRef, !!(view && pole && state));
  if (!view || !pole || !state) return null;

  const { dataset, scenario, origin } = view;
  const modeLabel = dataset.meta.modes.find((x) => x.id === scenario.mode)?.label ?? scenario.mode;
  const day = dataset.meta.day_types.find((d) => d.id === scenario.day);
  const names = poleCommuneNames(pole, dataset.communes);
  const allCommunes = expandedFor === pole.id;
  const shownNames = allCommunes || names.length <= COMMUNES_SHOWN + 1 ? names : names.slice(0, COMMUNES_SHOWN);
  const stop = stopNameFromMethod(pole.point.method);
  const sides: Side[] = [{ view, access: accessA, ctx: ctxA }];
  if (viewB?.origin && viewB.selectedState) sides.push({ view: viewB, access: accessB, ctx: ctxB });
  const dual = sides.length === 2;
  const facts = od ? [] : sides.map(sideFacts);
  // Réglage de marche des TC (D-024) : cité avec sa nature (choix de l'équipe), jamais comme une mesure
  const walk = view.walkSetting;
  const walkNature = dataset.meta.walk_settings?.nature;
  const velib = scenario.mode === 'velib' ? dataset.meta.velib : undefined;
  const gained = isGained(gainReport, pole.id, split);

  // En-tête : « Depuis … · journée … · mardi type », un badge (un par commune en diptyque)
  // D-029 : la voiture avec trafic moyen dépend de l'horaire (indice de la tranche), même sans horaire de TC
  const timeDependent = (od ? od.timeDependent : facts.some((f) => f.timeDependent)) || scenario.mode === 'car_traffic';
  const shift = od ? odShiftText(od.scenario.start, od.scenario.end) : day ? shiftText(day.start, day.end) : null;
  const contextLine = proofContextLine({
    origins: sides.filter((s) => s.view.origin).map((s) => shortCommuneName(s.view.origin!.name)),
    shift,
    shiftKind: scenario.shift ? 'free' : 'day_type',
    // « mardi type » : mode sources seulement (lot 6, précaution de calcul) ; « Méthode et sources » écrit la date de service
    serviceDate: provenanceOn ? dataset.meta.service_date : null,
    timeDependent,
  });
  // Comparaison en table commune par commune : un badge par colonne (lot 5), aucun dans l'en-tête
  const badge = od ? (!dual && state.od ? odBadge(state.od, scenario.budget) : null) : !dual && origin ? facts[0]!.badge : null;
  // Lot 5 (audit d'affichage du 10/11) : en comparaison, la part des postes atteints de CHAQUE commune, « A · … » et « B · … »
  const odSides =
    od && dual && viewB?.origin
      ? [
          { tag: 'A', name: shortCommuneName(origin!.name), od, part: state.od },
          { tag: 'B', name: shortCommuneName(viewB.origin.name), od: viewB.od ?? null, part: viewB.selectedState?.od },
        ]
      : null;

  // Itinéraires (D-028) : blocs rendus seulement si la donnée est publiée ; sinon une phrase dit pourquoi
  const outTrip = itin && itinDayId ? itineraryOf(itin, pole.id, itinDayId, 'out') : null;
  const retTrip = itin && itinDayId ? itineraryOf(itin, pole.id, itinDayId, 'ret') : null;
  const itinDayLabel = dataset.meta.day_types.find((d) => d.id === itinDayId)?.label ?? null;
  // Lot 6 : première phrase au premier niveau (à garder visible), la suite dans « Méthode et sources »
  const exampleNote = od && (outTrip || retTrip) ? itineraryExampleLead(stop, itinDayLabel) : null;
  // Retour de Nicolas (12/11) : l'exemple (vers l'arrêt du pôle) ne doit pas contredire le verdict (vers le centre des communes)
  const verdictNote =
    od && odIndex && !dual && od.status === 'ok' && (outTrip || retTrip) && od.poles.find((p) => p.id === pole.id)
      ? odExampleMismatchText(
          od.poles.find((p) => p.id === pole.id)!,
          { out: outTrip, ret: retTrip },
          new Map(dataset.communes.map((c) => [c.insee, c.name])),
          scenario.budget,
          odTextContext(odIndex, od.timeDependent, od.scenario.mode),
          od.scenario.end,
        )
      : null;
  const defaultWalk = dataset.meta.walk_settings?.settings.find((x) => x.id === dataset.meta.walk_settings?.default)?.label ?? null;
  // Audit d'affichage du 11/11 (P27) : hors transports en commun, l'absence d'arrêts va de soi, la phrase n'est plus écrite
  const itinMissing = [
    origin && itinWhy && itinWhy !== 'mode'
      ? itineraryUnavailableText(itinWhy, { dayLabels: dataset.meta.day_types.map((d) => d.label), defaultWalkLabel: defaultWalk, pending44: astres44 })
      : null,
    ...(itin && itinDayId
      ? (['out', 'ret'] as const).map((l) => tripUnavailableText(tripEntry(itin, pole.id, itinDayId, l), l, dataset.meta.max_trip_min))
      : []),
    itin && itinDayId && !itinWhy ? poleUnlistedText(itin, pole.id, astres44) : null,
  ].filter((t): t is string => !!t);
  // D-031 (c) : correspondances plus courtes que le minimum d'IDFM (verdict de la matrice seulement, hors table OD) ;
  // marquage du jeu du réglage de marche (« confort » : meta.itineraries_variants.comfort.transfer_check)
  const tcMeta = itinWalkKey
    ? transferCheckMeta({ transfer_check: dataset.meta.itineraries_variants?.[itinWalkKey]?.transfer_check })
    : transferCheckMeta(dataset.meta);
  const tc = { meta: tcMeta, out: outTrip, ret: retTrip, budget: scenario.budget, lit: !od && state.status === 'accessible', od: !!od };
  const lineTexts = dataset.meta.line_facts?.texts;
  // Heure creuse (D-028, offpeak publié pour le réglage par défaut), à côté des temps de l'horaire choisi. En commune par
  // commune (table OD, base par défaut), le temps va à l'arrêt d'ancrage du pôle : la note d'exemple le dit.
  const offpeak = itin ? offpeakFact(itin, pole.id, dataset.meta.max_trip_min) : null;
  // Comparer les modes (une commune, journée-type) : durées du ciel de chaque mode. En commune par commune (table OD),
  // ce sont les durées vers l'arrêt d'ancrage du pôle, sans verdict (le verdict du ciel est celui de la table OD).
  const modesFile = scenario.mode === 'transit' ? itin : itinForModes;
  const modes =
    origin && !dual && (!od || !!itinDayId) && poleIndex >= 0
      ? modeComparison({
          meta: dataset.meta,
          access: accessA,
          insee: origin.insee,
          poleIndex,
          polesCount: dataset.poles.length,
          day: itinDayId ?? scenario.day,
          budget: scenario.budget,
          walkKey: itinWalkKey,
          currentMode: scenario.mode,
          transitTrips: modesFile && itinDayId ? { out: itineraryOf(modesFile, pole.id, itinDayId, 'out'), ret: itineraryOf(modesFile, pole.id, itinDayId, 'ret') } : null,
        })
      : null;

  // Lot 3 (D-050) : chiffres clés lus fermés dans le titre des plis, tous tirés des données et des fonctions existantes
  const communesShare = od && od.status === 'ok' ? od.poles.find((p) => p.id === pole.id) : undefined;
  const communeCount = communesShare ? odCommuneCount(communesShare) : { reached: 0, total: 0 };
  // Comparaison : le chiffre du pli dit les deux communes, jamais celui de A seul
  const odSidesFigure = odSides
    ? odSides
        .map((s) => {
          const sh = s.od && s.od.status === 'ok' ? s.od.poles.find((p) => p.id === pole.id) : undefined;
          if (!sh) return null;
          const c = odCommuneCount(sh);
          return `${s.tag} : ${c.reached} sur ${c.total}`;
        })
        .filter(Boolean)
        .join(', ') + ' atteintes'
    : null;
  // Pli « Coût et carbone » (audit d'affichage du 10/11) : une ligne de coût selon le cas, le carbone dessous, jamais le forfait
  // Navigo du contexte (faux depuis D-032). Le titre ne promet le carbone que si le pli en montre un ou dit pourquoi il manque.
  const mode = scenario.mode;
  const isCar = mode === 'car' || mode === 'car_traffic';
  const maxTripMin = dataset.meta.max_trip_min;
  const transitTrips = mode === 'transit' && !dual && !!(outTrip || retTrip);
  const transitOption = transitChoice.option;
  const noItin: NoItineraryCost | null = !origin
    ? null
    : dual
      ? mode === 'transit' || mode === 'bike_transit' || isCar || mode === 'velib'
        ? 'compare'
        : null
      : mode === 'transit' && itinWhy === 'shift'
          ? 'shift'
          : null;
  const noItinCost = noItin ? noItineraryCostText(noItin, dataset.meta.day_types.map((d) => d.label), mode !== 'velib') : null;
  const velibShown = mode === 'velib' && !dual && !!origin && !!transitChoice.file && !!velibRides(transitChoice.file, origin.insee, poleIndex, dataset.poles.length);
  // D-066 : en transports en commun, coût et carbone sont dans le bloc « Trajet » ; le pli ne montre que les abonnements
  const costTitle = transitTrips ? 'Abonnements' : (isCar && !dual) || (!!noItinCost && mode !== 'velib') ? 'Coût et carbone' : 'Coût';
  const passRt =
    transitTrips && transitOption && transitChoice.file
      ? transitRoundTrip(outTrip, retTrip, transitOption, transitChoice.file.transit.extra_titles, transitChoice.file.transit.unpriced_agencies ?? {})
      : null;
  const costFigure = noItinCost ? noItinCost.figure : transitTrips && transitOption && passRt ? passFigure(transitOption, passRt) : null;
  // Un sens sans trajet : les titres qui couvriraient l'aller et le retour ne sont pas cherchés ; sans abonnement choisi, rien à montrer
  const hasCostFold = !!origin && ((transitTrips && (!!transitOption || (!!outTrip && !!retTrip))) || !!noItinCost || (!dual && (isCar || velibShown)));
  // Horaires libres sans itinéraire : la journée-type la plus proche, appliquée par un bouton (on le dit, rien n'est déduit)
  const freeShift = itinWhy === 'shift' && !split ? (od ? { start: od.scenario.start, end: od.scenario.end } : scenario.shift ?? null) : null;
  const nearDayId = freeShift ? nearestDayType(dataset.meta.day_types, freeShift) : null;
  const nearDay = nearDayId ? dataset.meta.day_types.find((d) => d.id === nearDayId) ?? null : null;

  // À pied et à vélo : la vitesse du calcul (meta.speeds), écrite une fois dans « Méthode et sources » (lot 6)
  const speedKmh = equivalentDistance(scenario.budget, scenario.mode, dataset.meta.speeds)?.kmh ?? null;
  const sourceList = proofSources(dataset.sources, sides.map((x) => x.view.origin));
  const otherSources = sourceList.filter((s) => !/openstreetmap/i.test(s));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <m.aside
      ref={asideRef}
      data-testid="preuve"
      className={`proof-panel pf ${phone ? 'is-sheet' : ''}`}
      role="dialog"
      aria-modal={!touring}
      aria-labelledby="proof-title"
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
      {...sheetProps}
    >
      {phone && (
        <div className="sheet-handle" {...handleProps} aria-hidden="true">
          <span />
        </div>
      )}
      <header>
        {/* Lot 6 : lu par les lecteurs d'écran, sans place à l'écran (le titre suffit à lire la réponse) */}
        <p className="eyebrow pf-eyebrow sr-only">Pôle d'emploi</p>
        <h2 id="proof-title" ref={headingRef} tabIndex={-1}>
          {pole.name_official ?? pole.name}
        </h2>
        {origin && <p className="pf-context">{contextLine}</p>}
        {(badge || gained) && (
          <div className="pf-badges">
            {badge && <ProofBadgeLine badge={badge} />}
            {gained && <GainBadgeLine text={GAIN_POLE_TEXT} />}
            <TransferRiskBadge {...tc} />
          </div>
        )}
        <button type="button" className="icon-btn" ref={closeRef} onClick={close} aria-label="Fermer le panneau de preuve">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {/* Vélib' (D-027) : l'avertissement publié, tel quel, en tête du panneau */}
      {velib?.warning && <VelibWarning text={velib.warning} className="pf-velib" restTip />}
      {!origin && <p className="pf-missing">Choisissez une commune de départ pour calculer l'accès.</p>}

      {origin && od && !odSides && <ProofOd pole={pole} part={state.od} result={od} index={odIndex} communes={dataset.communes} view="hero" />}
      {odSides && (
        <section className="pf-section pf-od" aria-labelledby="pf-od-title">
          <h3 className="pf-label" id="pf-od-title">
            Postes atteints aller et retour
          </h3>
          <div className="pf-cols">
            {odSides.map((s) =>
              s.od ? (
                <ProofOd
                  key={s.tag}
                  pole={pole}
                  part={s.part}
                  result={s.od}
                  index={odIndex}
                  communes={dataset.communes}
                  view="hero"
                  side={{ label: `${s.tag} · ${s.name}`, badge: s.part ? <ProofBadgeLine badge={odBadge(s.part, scenario.budget)} /> : null }}
                />
              ) : (
                <div key={s.tag} className="pf-side">
                  <p className="pf-side-head">{`${s.tag} · ${s.name}`}</p>
                  <p className="pf-missing">Non calculé pour cette commune.</p>
                </div>
              ),
            )}
          </div>
        </section>
      )}
      {origin && !od && (
        <ProofTimes
          sides={sides}
          facts={facts}
          dual={dual}
          // Vélo + TC (audit d'affichage du 11/11, D4) : la garde « (durées minimales) » reste écrite dans le titre, la raison va au « i »
          {...(scenario.mode === 'bike_transit'
            ? {
                titleSuffix: '(durées minimales)',
                titleTip: (
                  <SourceTip label="Pourquoi des durées minimales ?" block>
                    <TipLines lines={["Vélo personnel jusqu'à la gare.", "Le temps pour garer le vélo n'est pas compté (aucune donnée) : ce sont des durées minimales."]} />
                  </SourceTip>
                ),
              }
            : {})}
        />
      )}

      {/* Sans indice publié, la phrase reste écrite ; sinon elle est la première ligne du « i » du bloc voiture (audit du 11/11, P18) */}
      {scenario.mode === 'car' && origin && !dataset.meta.car_congestion && <p className="pf-note">{CAR_OPTIMISTIC_TEXT}</p>}
      {/* D-029 : temps route vide, indice DiRIF de la tranche et temps avec le trafic moyen, avec la source */}
      {(scenario.mode === 'car' || scenario.mode === 'car_traffic') && origin && dataset.meta.car_congestion && (
        <ProofTraffic sides={sides} cc={dataset.meta.car_congestion} od={!!od} optimistic={scenario.mode === 'car' ? CAR_OPTIMISTIC_TEXT : null} />
      )}

      {/* D-066 (demande de Nicolas du 11/11) : UN seul bloc « Trajet » (bascule Aller / Retour, autres trajets, tuiles Durée, Coût, Carbone,
          bande, lignes) à la place de « Transports utilisés (aller) », « (retour) » et des « Autres trajets » du pli « Coût et carbone » */}
      {verdictNote && (
        <p className="pf-note pf-verdict-note" role="note" data-verdict-note>
          {verdictNote}
        </p>
      )}
      {(outTrip || retTrip) && (
        <TripBlock
          key={`${origin?.insee ?? ''}|${pole.id}|${itinDayId ?? ''}`}
          outTrip={outTrip}
          retTrip={retTrip}
          alt={origin && !split && itin && itinDayId ? { insee: origin.insee, poleId: pole.id, dayId: itinDayId, walkKey: itinWalkKey } : null}
          example={!!exampleNote}
          exampleNote={exampleNote}
          stopNotes={{ out: itineraryStopNote(pole.point.stop_name), ret: itineraryReturnStopNote(pole.point.stop_name) }}
          texts={lineTexts}
        />
      )}
      {/* Hors transports en commun, même bloc, mêmes tuiles, avec ce que les données donnent (vélo, vélo + TC, voiture) ; une seule commune */}
      {origin && !dual && !(outTrip || retTrip) && (
        <ModeTripBlock mode={scenario.mode} meta={dataset.meta} access={sides[0]?.access} poleIndex={dataset.poles.findIndex((p) => p.id === pole.id)} polesCount={dataset.poles.length} scenario={scenario} />
      )}
      {/* Lot 6 : au premier niveau, seulement si un minimum n'est pas respecté ; le bilan du contrôle est dans « Méthode et sources » */}
      {origin && <ProofTransferCheck {...tc} view="alert" shiftNotCovered={itinWhy === 'shift'} maxTripMin={dataset.meta.max_trip_min} />}
      {itinMissing.length > 0 && (
        <p className="pf-note pf-itin-missing">
          {itinMissing.join(' ')}
          {nearDay && (
            <>
              {' '}
              <button type="button" className="link-btn pf-near-day" onClick={() => void applyScenario({ day: nearDay.id, shift: null })}>
                Voir l'exemple en journée {nearDay.label}
              </button>
            </>
          )}
        </p>
      )}
      {/* Audit d'affichage du 11/11 (P31) : « le trait rejoué n'est pas l'itinéraire » au « i » du bouton, en clair en mode sources */}
      {canTrace && (
        <p className="pf-trace">
          <button type="button" className="link-btn" onClick={playTrace}>
            {reduced ? 'Montrer le trait' : 'Rejouer le trait'}
          </button>{' '}
          <SourceTip label="Ce trait est-il l'itinéraire ?">Trait symbolique : ce n'est pas l'itinéraire.</SourceTip>
        </p>
      )}

      {/* Six plis indépendants (lot 3, D-050) : chacun s'ouvre seul ; le chiffre clé est lu fermé */}
      {origin && od && communesShare && !odSides && (
        <PfGroup id="communes" title="Communes du pôle" figure={`${communeCount.reached} sur ${communeCount.total} atteintes`}>
          <ProofOd pole={pole} part={state.od} result={od} index={odIndex} communes={dataset.communes} view="communes" />
        </PfGroup>
      )}
      {origin && odSides && communesShare && (
        <PfGroup id="communes" title="Communes du pôle" figure={odSidesFigure}>
          {odSides.map((s) =>
            s.od ? <ProofOd key={s.tag} pole={pole} part={s.part} result={s.od} index={odIndex} communes={dataset.communes} view="communes" side={{ label: `${s.tag} · ${s.name}` }} /> : null,
          )}
        </PfGroup>
      )}
      {!od && names.length > 0 && (
        <PfGroup id="communes" title="Communes du pôle">
          <div className="pf-communes">
            {allCommunes ? (
              <>
                <div className="pf-communes-expanded">
                  {names.map((name) => (
                    <div key={name} className="pf-commune">{name}</div>
                  ))}
                </div>
                <button type="button" className="link-btn pf-more" onClick={() => setExpandedFor(null)} aria-label="Replier la liste des communes">
                  Replier ({names.length})
                </button>
              </>
            ) : (
              <p>
                {shownNames.join(', ')}
                {shownNames.length < names.length && (
                  <>
                    {' '}
                    <button type="button" className="link-btn pf-more" onClick={() => setExpandedFor(pole.id)} aria-label={`Afficher les ${names.length} communes du pôle`}>
                      et {names.length - shownNames.length} autres
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        </PfGroup>
      )}

      {/* D-066 : le pli ne garde que ce qui n'est pas dans le bloc « Trajet » : les abonnements en transports en commun, le visuel de la
          voiture (énergie, péages et leur crédit, total, carbone), Vélib' ; en vélo et vélo + TC tout est dans le bloc, le pli disparaît */}
      {hasCostFold && (
        <PfGroup id="cout" title={costTitle} figure={costFigure}>
          {noItinCost && <p className="pf-cost-line">{noItinCost.text}</p>}
          {transitTrips && (transitOption ? <ProofTransitPass outTrip={outTrip} retTrip={retTrip} maxTripMin={maxTripMin} /> : <ProofTransitCover outTrip={outTrip} retTrip={retTrip} />)}
          {origin && !dual && mode === 'velib' && <ProofSubscriptions mode={mode} insee={origin.insee} poleIndex={poleIndex} polesCount={dataset.poles.length} />}
          {/* Comparaison : le coût d'une seule commune sous l'en-tête « Depuis A et B » laisserait croire qu'il vaut pour les deux */}
          {isCar && origin && !dual && (
            <ProofCarCost meta={dataset.meta} access={sides[0]?.access} poleIndex={dataset.poles.findIndex((p) => p.id === pole.id)} polesCount={dataset.poles.length} scenario={scenario} sources={dataset.sources} />
          )}
        </PfGroup>
      )}

      <PfGroup
        id="emplois"
        title="Emplois et recrutement"
        figure={pole.jobs == null ? null : `${formatInt(pole.jobs)} postes salariés (INSEE)`}
        // Audit d'affichage du 11/11 (P34) : « comptées à part » est au « i » du bloc des offres, dans le pli
        keep={<RecruitKeep pole={pole} />}
      >
        <ProofJobs pole={pole} sides={sides} dual={dual} showFlows={!!origin} />
        <ProofRecruit pole={pole} keepOut />
        <ProofPublicOffers pole={pole} />
      </PfGroup>

      {(outTrip || retTrip) && (
        <PfGroup id="besoins" title={NEEDS_TITLE}>
          {/* Aucun besoin coché : à quoi sert ce pli, avec le bouton « Mes réglages » (retour de Cyril, 11/11) */}
          <NeedsRecall emptyHint />
          {outTrip && <NeedsTripSummary trip={outTrip} label={needsTripLabel('out')} />}
          {retTrip && <NeedsTripSummary trip={retTrip} label={needsTripLabel('ret')} />}
          <NeedsAstreMark out={outTrip} ret={retTrip} budget={scenario.budget} />
          <NeedsNotes legs={[...(outTrip?.legs ?? []), ...(retTrip?.legs ?? [])] as NeedsLeg[]} />
        </PfGroup>
      )}

      {/* Audit d'affichage du 10/11 (lot 4) : les modes non calculés sont nommés pli ouvert seulement (ProofModes) ; l'heure creuse, une
          information sur le trajet et non une méthode, quitte « Méthode et sources » pour ce pli */}
      {(modes || offpeak) && (
        <PfGroup id="moyens" title="Comparer les moyens" figure={modes ? `${modes.rows.length} moyens de transport` : null}>
          {modes && (
            <ProofModes
              data={modes}
              budget={scenario.budget}
              onShow={(mode) => void applyScenario({ mode })}
              vehicleNote={dataset.meta.car_costs?.not_included?.join(', ') ?? null}
              anchorNote={od ? modesAnchorNote(stop, itinDayLabel) : null}
              inFold
            />
          )}
          {offpeak && <ProofOffpeak fact={offpeak} anchorNote={null} />}
        </PfGroup>
      )}

      <PfGroup id="methode" title="Méthode et sources">
        {/* Le recap du scénario : sauf la ligne du mode et du réglage de marche (qui dit « choix de l'équipe » et reste visible au pied
            du panneau), il est ici, une phrase par ligne */}
        <div className="pf-recap">
          {/* Audit d'affichage du 11/11 (P37, D2) : le réglage de marche, un choix de l'équipe, est dit ici (le pied ne le redit qu'en mode sources) */}
          {walk && (
            <p>
              {capitalize(walkSettingPhrase(walk))} à chaque bout{walkNature ? ` (${provenanceOn ? walkNature : stripDecisionCodes(walkNature)})` : ''}.
            </p>
          )}
          {/* Sans mode sources (D-033), la parenthèse qui nomme la source (« INSEE Filosofi… ») n'est pas écrite ; `TravelSourceNote` plus bas la donne */}
          <p>{origin ? originPointPhrase(origin, dataset.meta.origin_methods, provenanceOn) : 'Aucune commune de départ'}.</p>
          {/* Retours KBS du 10/11 : le temps de travail (enquête Emploi, niveau national) est dans le « i » de cette ligne, mots inchangés */}
          <p>
            {scenario.shift && shift ? `Horaires ${shift}` : `Journée-type ${day?.label ?? scenario.day}`} (scénario), en {scenario.budget} min ou moins par sens.
            {origin && <WorkTimeFold />}
          </p>
          {/* 12/11 (retour de Nicolas) : sans « Afficher la provenance », la méthode des temps (horaires, calcul, arrivée) est dans un « i » ; les phrases restent mot pour mot */}
          {provenanceOn ? (
            <p>{dataset.origin === 'real' ? `Horaires théoriques IDFM du ${frenchDayDate(dataset.meta.service_date)}, calcul r5py.` : 'Calcul r5py.'}</p>
          ) : (
            <p>
              Comment les temps sont calculés
              <InfoTip label="Comment les temps de trajet sont calculés" placement="top">
                <TipLines
                  lines={[
                    dataset.origin === 'real' ? `Horaires théoriques IDFM du ${frenchDayDate(dataset.meta.service_date)}, calcul r5py.` : 'Calcul r5py.',
                    ...(outTrip || retTrip ? [ITINERARY_METHOD_NOTE] : []),
                    ...(od ? ['Arrivée : le centre de chaque commune du pôle (centre de gravité de sa population). Toutes les gares et tous les arrêts à portée de marche comptent, pas un seul.'] : []),
                  ]}
                />
              </InfoTip>
            </p>
          )}
          {/* Lot 6 : phrases qui étaient au premier niveau sans être de celles à garder visibles (keep-visible.json) */}
          {provenanceOn && (outTrip || retTrip) && <p>{ITINERARY_METHOD_NOTE}</p>}
          {/* Dit une fois (retours KBS du 10/11) : la phrase d'arrêt sous les transports le dit déjà quand l'arrêt est nommé */}
          {exampleNote && !itineraryStopNote(pole.point.stop_name) && <p>{ITINERARY_EXAMPLE_TAIL}</p>}
          {scenario.mode === 'bike_transit' && origin && <p>La marche à l'arrivée est limitée à une distance choisie par l'équipe, pas une donnée.</p>}
          {speedKmh != null && <p>Distances équivalentes à {String(speedKmh).replace('.', ',')}&nbsp;km/h (vitesse du calcul).</p>}
          {!od && !dual && scenario.mode !== 'car_traffic' && facts[0] && !facts[0].missing && !facts[0].timeDependent && <p>Durée indépendante de l’heure : même valeur pour les trois journées-types.</p>}
        </div>
        {origin && <ProofTransferCheck {...tc} view="detail" shiftNotCovered={itinWhy === 'shift'} maxTripMin={dataset.meta.max_trip_min} />}
        {/* Temps de travail (D-048, T2) : sa source, en mode sources seulement (les phrases sont dans le « i » de la journée-type, plus haut) */}
        {origin && <WorkTimeFoldSources />}
        {/* Mode provenance (bouton de la barre du haut) : sources des temps, du point de départ et, en horaires libres, des postes */}
        {origin && <TravelSourceNote className="pf-prov" mode={scenario.mode} origins={sides.map((x) => x.view.origin)} withJobs={!!od} />}
        <div className="pf-place">
          <BassinSourceNote poles={[pole]} className="pf-prov" />
          {/* Table commune x commune (D-019) : chaque commune du pôle est une destination, à son point D-017 ;
              le moteur prend tous les arrêts à portée de marche. L'arrêt le plus desservi ne sert qu'à poser l'astre. */}
          {od ? (
            provenanceOn && <p>Arrivée : le centre de chaque commune du pôle (centre de gravité de sa population). Toutes les gares et tous les arrêts à portée de marche comptent, pas un seul.</p>
          ) : (
            stop && (
              <>
                <p>Point d'arrivée : {stop} (arrêt le plus desservi du pôle)</p>
                <StopSourceNote pole={pole} />
              </>
            )
          )}
        </div>
        {/* Ligne « Sources » (jeux et codes) : mode sources seulement (D-033) ; le lien vers la méthode reste toujours */}
        <div className="pf-footer">
          <p>
            {provenanceOn && otherSources.length > 0 && <>Sources : {otherSources.join(', ')} ·{' '}</>}
            <button type="button" className="link-btn" onClick={() => useSkyStore.getState().setSourcesOpen(true)}>
              Méthode
            </button>
          </p>
        </div>
      </PfGroup>

      {/* Pied du panneau. Règle d'affichage finale du 11/11 (D-064, D8) : sans mode sources, les trois boutons seulement (le mode est dans la
          barre, le réglage de marche dans « Méthode et sources », les producteurs en bas du ciel et dans « Sources et limites ») ; sur téléphone,
          la feuille couvre le bas du ciel : le crédit OpenStreetMap (ODbL) reste ici (D5). En mode sources, le pied est rendu comme avant
          (mode, réglage de marche, ligne « Données »). Démonstration : crédits comme avant */}
      <footer className="pf-footer">
        {provenanceOn && (
          <p>
            {modeLabel}
            {walk ? `, ${walkSettingPhrase(walk)} à chaque bout${walkNature ? ` (${walkNature})` : ''}` : ''}.
          </p>
        )}
        {fake && <p className="demo-note">Temps de trajet FICTIFS (démonstration).</p>}
        {/* Téléphone : la bande sous le ciel est masquée tant que la feuille du panneau est ouverte ; le crédit des producteurs
            (D-060) est donc écrit ici, à la place de « Crédit : © les contributeurs d'OpenStreetMap » qu'il garde en dernier */}
        {(provenanceOn || fake || phone) && <PanelCredits
          mode={scenario.mode}
          pole={pole}
          origins={sides.map((x) => x.view.origin)}
          trips={[outTrip, retTrip]}
          employer={!!origin && !dual && scenario.mode === 'transit' && !!(outTrip || retTrip)}
          access={sides[0]?.access}
          vehicle={scenario.vehicle}
          poleIndex={dataset.poles.findIndex((p) => p.id === pole.id)}
          modeRows={modes?.rows}
        />}
        <div className="pf-actions">
          <button type="button" className="btn btn-ghost pf-btn" onClick={() => setMapOpen(!mapOpen)} aria-pressed={mapOpen}>
            {mapOpen ? 'Revenir au ciel' : 'Voir sur la carte'}
          </button>
          {!dual && !split && !mapOpen && mapPhase === 'sky' && (
            <button type="button" className="btn btn-ghost pf-btn" onClick={centerHere}>
              Centrer sur ce pôle
            </button>
          )}
          <button type="button" className="btn btn-ghost pf-btn" onClick={() => void copyLink()}>
            {copied ? 'Lien copié' : 'Copier le lien'}
          </button>
          <span className="sr-only" aria-live="polite">
            {copied ? 'Lien du scénario copié' : ''}
          </span>
        </div>
      </footer>
    </m.aside>
  );
}

export default ProofPanel;
