import { motion as m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { isTimeDependent } from '../data/accessibility';
import { noTripText } from '../data/proof';
import { useReservedChildren } from '../store/overlayRects';
import { useDisplayedView, useReveal } from '../store/selectors';
import { useProvenanceStore } from '../store/provenanceStore';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { InfoTip } from './InfoTip';
import { NeedsMarkGlyph } from './needs/NeedsMarks';
import { NeedsMethodNote } from './provenance/NeedsMethodNote';
import { useNeedsSky } from './needs/useNeedsSky';
import { NeedsRecall } from './proof/ProofNeeds';
import { useNeedsReadCtx, useNeedsSelected } from './proof/useNeedsMeta';
import { needsFixedText, ASSISTANCE_LINKS, NEEDS_TITLE } from '../data/needs';
import { needsLegendDetails, needsLegendText } from '../data/needsSky';
import { legendNeedsRecallShown } from '../data/mySettings';
import { SizeKey } from './SizeKey';
import { ChartReadingTip } from './ChartReadingTip';
import { skyReading } from '../data/chartReading';
import { StatusGlyph } from './StatusGlyph';

/**
 * Légende en bandeau d'une ligne (en haut à gauche) : un repère = une seule signification.
 * Masquée pendant le diptyque et la visite (rien par-dessus le ciel).
 * Le décor (étoiles de fond, nébuleuse) n'y figure pas.
 * Acte 0 : entre au temps D (allumage) ; elle lit la vue affichée, donc un ciel en perle (chargement,
 * scénario sans matrice) n'a qu'une entrée d'état, « Perle », jamais « Accessible » ni « Hors de portée ».
 * Les explications ne sont jamais au seul survol : bouton « i » (InfoTip), au clavier et visible.
 * Allégée (D-049) : le pictogramme et un nom court ; la phrase complète et le détail sont au « i » du mot (« Cœur cyan : postes
 * atteints aller et retour, ≤ N min par sens », « Calcul sur le trajet le plus rapide… »). Le « i » explique un mot, il ne cache jamais une rubrique.
 */
export function Legend() {
  const sourcesOn = useProvenanceStore((s) => s.on);
  const view = useDisplayedView();
  const tourActive = useSkyStore((s) => s.tour.status !== 'idle');
  const { mask } = useReveal();
  const accessFiles = useSkyStore((s) => s.access);
  // Or du gain démontré : entrée de légende seulement tant que l'or est visible (report.legend non nul)
  const gain = useSkyStore((s) => s.gainReport);
  // « Ce qu'il me faut sur mon trajet » : légende calculée sur le ciel affiché
  const needsSky = useNeedsSky();
  const needsSelected = useNeedsSelected();
  const needsCtx = useNeedsReadCtx();
  const needsPublished = useSkyStore((s) => !!s.dataset?.meta.needs);
  const legendRef = useRef<HTMLUListElement>(null);
  const visible = !!view && mask.light && !tourActive && !view.scenario.compare;
  // Zone réservée du ciel (arbitrage de Nicolas du 05/11, mobile 390 px) : aucun nom de pôle sous une ligne de la légende
  useReservedChildren('legend', legendRef, visible);
  useEffect(() => {
    const legend = legendRef.current;
    if (!visible || !legend) return;
    const measure = () => {
      document.documentElement.style.setProperty('--legend-bottom', `${legend.getBoundingClientRect().bottom}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(legend);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      document.documentElement.style.removeProperty('--legend-bottom');
    };
  }, [visible]);
  if (!view || !mask.light || tourActive || view.scenario.compare) return null;
  // Borne de recherche des trajets publiée par le pipeline (meta.max_trip_min), jamais écrite ici
  const maxTrip = view.dataset.meta.max_trip_min ?? null;
  const pearl = view.neutral || !view.totals.hasData;
  const jobsYear = view.dataset.poles.find((p) => p.jobs_source === 'EMP01')?.jobs_year;
  const td = isTimeDependent(view.origin ? accessFiles[view.origin.insee] : null, view.scenario.mode, view.scenario.day);
  // « Non calculé » = trou d'une matrice existante (sans matrice, le ciel est neutre)
  const showUnknown = !pearl && view.states.some((s) => s.status === 'unknown');
  const showOutOnly = !pearl && view.states.some((s) => s.status === 'out_only');
  /** Table OD (D-019) : astres éclairés en partie */
  const od = view.basis === 'od';
  const selfInPole = od && view.states.some((s) => (s.od?.self ?? 0) > 0);
  // TC : le réglage de marche en vigueur est cité dans les explications (D-024), même texte que le ciel
  const walkLegM = view.walkSetting?.leg_limit_m ?? null;
  return (
    <m.ul
      ref={legendRef}
      className="legend"
      aria-label="Légende"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
    >
      {pearl ? (
        <li>
          <StatusGlyph kind="neutral" />
          Perle : aucun résultat affiché
          <InfoTip label="Que veut dire « Perle » ?">
            Le ciel montre les pôles à leur place, sans état d'accessibilité : aucun résultat n'est affiché pour ce scénario.
          </InfoTip>
        </li>
      ) : (
        <>
          {od ? (
            <li>
              <StatusGlyph kind="part" />
              Atteints aller <em>et</em> retour
              <InfoTip label="Comment lire un astre éclairé en partie ?">
                Cœur cyan : postes atteints aller et retour, ≤ {view.scenario.budget} min par sens. Toutes les communes d'Île-de-France sont des destinations. Chaque astre garde sa taille (postes du pôle) ; son cœur cyan a l'aire
                des postes de ses communes atteintes aller et retour, et l'arc plein de son contour en suit la part (le reste en tirets).
                {selfInPole ? ' Le creux du contour : votre commune, trajet non mesuré, hors du total et des pourcentages.' : ''}
              </InfoTip>
            </li>
          ) : (
            <li>
              <StatusGlyph kind="accessible" />
              Accessible aller <em>et</em> retour, ≤ {view.scenario.budget} min par sens
            </li>
          )}
          {showOutOnly && (
            <li>
              <StatusGlyph kind="out_only" />
              Aller possible, retour hors de portée
              <InfoTip label="Que veut dire « Aller possible, retour hors de portée » ?">
                Aller dans le temps choisi, mais le retour le dépasse, ou {noTripText('ret', maxTrip, td, walkLegM)}. Moitié haute pleine : l'aller ;
                moitié basse en tirets : le retour.
              </InfoTip>
            </li>
          )}
          <li>
            <StatusGlyph kind="none" />
            {od ? 'Aucun poste atteint' : 'Hors de portée'}
            <InfoTip label="Que veut dire « Hors de portée » ?">
              L'aller dépasse le temps choisi, ou {noTripText('out', maxTrip, td, walkLegM)}.{td ? " Le pôle peut être desservi à d'autres heures." : ''}
            </InfoTip>
          </li>
        </>
      )}
      {!pearl && showUnknown && (
        <li>
          <StatusGlyph kind="unknown" />
          Non calculé
        </li>
      )}
      {gain?.legend && (
        <li>
          {/* même forme que l'astre doré : disque, orbite et seconde orbite (la couleur n'est jamais seule) */}
          <StatusGlyph kind="gain" />
          {gain.legend.label}
          <InfoTip label="Que veut dire l'or ?">{gain.legend.detail.charAt(0).toUpperCase() + gain.legend.detail.slice(1)}.</InfoTip>
        </li>
      )}
      {/* Audit d'affichage du 10/11 (lot 4) : « aucun coché » est un réglage, pas une information ; le rappel n'apparaît qu'avec au moins
          un besoin coché, le réglage reste dans « Mes réglages » (barre du bas) et dans le pli « Ce qu'il me faut sur mon trajet » d'un astre */}
      {legendNeedsRecallShown({ published: needsPublished, origin: !!view.origin, pearl, checked: needsSelected.length }) && (
        <li className="legend-needs">
          <NeedsRecall label={NEEDS_TITLE} />
        </li>
      )}
      {!pearl && needsLegendText(needsSky.legend, needsSelected) && (
        <li className="legend-needs">
          {needsSky.legend.kind === 'ready' && <NeedsMarkGlyph />}
          <span>
            {needsLegendText(needsSky.legend, needsSelected)}
            <InfoTip label="Que veut dire la marque ?">
              {needsLegendDetails(needsSky.legend, needsSelected, od).join(' ')} {needsFixedText(needsCtx.withSources === false ? {} : needsCtx.dates)}
              {ASSISTANCE_LINKS.length > 0 && (
                <>
                  {' '}
                  Assistance :{' '}
                  {ASSISTANCE_LINKS.map((l, i) => (
                    <span key={l.url}>
                      {i > 0 ? ', ' : ''}
                      <a href={l.url} target="_blank" rel="noopener noreferrer">
                        {l.label}
                      </a>
                    </span>
                  ))}
                  .
                </>
              )}
            </InfoTip>
          </span>
          <NeedsMethodNote className="legend-needs-note" />
        </li>
      )}
      <li>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="6" cy="12" r="2.5" fill="none" stroke="#A8B7D1" />
          <circle cx="13" cy="10" r="5.5" fill="none" stroke="#A8B7D1" />
        </svg>
        Taille : postes salariés (INSEE)
        <InfoTip label="Comment lire la taille des astres ?">
          L'aire de chaque astre est proportionnelle à ses postes salariés recensés par l'INSEE
          {sourcesOn && jobsYear ? ` (Flores ${jobsYear})` : ''}. Repères tracés à l'échelle du ciel affiché :
          <SizeKey dataset={view.dataset} />
        </InfoTip>
      </li>
      <li>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2 L11.2 8.8 L18 10 L11.2 11.2 L10 18 L8.8 11.2 L2 10 L8.8 8.8 Z" fill="#FFE6C7" />
        </svg>
        Votre commune (point de départ)
      </li>
      {/* « Comment lire ce graphique » du ciel : chaque repère en une phrase, puis le cas de la commune affichée (totaux du ciel affiché) */}
      <li className="legend-read">
        <ChartReadingTip
          chart="le ciel"
          reading={skyReading({ origin: pearl ? null : (view.origin?.name ?? null), budget: view.scenario.budget, totals: view.totals, od })}
        />
      </li>
    </m.ul>
  );
}
