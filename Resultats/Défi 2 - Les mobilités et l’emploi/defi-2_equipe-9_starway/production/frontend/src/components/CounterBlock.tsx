import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { computeDelta } from '../data/accessibility';
import { counterGaugeReading, jobsDefinition } from '../data/chartReading';
import { formatInt, formatPercent } from '../data/format';
import { poleShortName } from '../data/labels';
import { odCounterDetail, odShare, poleShareLine } from '../data/od/summaryText';
import { useProvenanceStore } from '../store/provenanceStore';
import type { SkyView } from '../state/skyView';
import { waitForSky } from '../store/skyBridge';
import { lightingDuration } from '../sky/transitions';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { ChartReadingTip } from './ChartReadingTip';
import { InfoTip } from './InfoTip';
import { JobsCounter } from './JobsCounter';

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${formatInt(Math.abs(n))}`;

/** Durée d'affichage de la puce de variation (ms) - rythme d'interface, pas une donnée */
const BADGE_MS = 3000;

/**
 * Compteur façon slide : le nombre, puis sa légende, puis le contexte ; jauge de la part des postes
 * accessibles parmi les postes des pôles ; puce de variation réelle après chaque changement
 * (computeDelta, même commune). Rien si la variation est nulle.
 * Aucune zone annoncée ici : SkySummary est la seule (sinon deux annonces à chaque cran de la jauge).
 * Le nombre défile sur la durée de l'allumage du ciel (dernier délai + 600 ms) et finit avec lui.
 */
export function CounterBlock({ view, reduced }: { view: SkyView; reduced: boolean }) {
  const t = view.totals;
  /** Table OD (D-019) : toute l'Île-de-France est destination ; le compteur porte sur ses postes */
  const od = view.basis === 'od' ? t.od ?? null : null;
  const share = od ? odShare(od) : t.jobs != null && t.totalJobs ? t.jobs / t.totalJobs : null;
  const prev = useRef<SkyView | null>(null);
  const [badge, setBadge] = useState<{ key: number; parts: string[] } | null>(null);

  useEffect(() => {
    // Glisser de la jauge du budget : pas de puce à chaque cran ; au relâchement, la variation
    // se mesure depuis le ciel d'avant le geste.
    if (useSkyStore.getState().budgetScrub) return;
    const before = prev.current;
    prev.current = view;
    if (!before || !before.origin || before.origin.insee !== view.origin?.insee) return;
    if (!before.totals.hasData || !view.totals.hasData || before.scenario === view.scenario) return;
    const parts: string[] = [];
    const a = before.basis === 'od' ? before.totals.od : undefined;
    const b = view.basis === 'od' ? view.totals.od : undefined;
    if (a && b) {
      // Table OD : écart réel de postes et de communes atteints (mêmes destinations des deux côtés)
      const dc = b.reachedCommunes - a.reachedCommunes;
      const dj = b.reachedAll - a.reachedAll;
      if (dc === 0 && dj === 0) return;
      parts.push(`${signed(dc)} commune${Math.abs(dc) > 1 ? 's' : ''}`, `${signed(dj)} postes`);
    } else if (before.basis === view.basis) {
      const d = computeDelta(view.dataset.poles, before.states, view.states);
      if (d.polesDelta === 0 && (d.jobsDelta ?? 0) === 0) return;
      parts.push(`${signed(d.polesDelta)} pôle${Math.abs(d.polesDelta) > 1 ? 's' : ''}`);
      if (d.jobsDelta != null) parts.push(`${signed(d.jobsDelta)} postes`);
    } else return; // changement de base de calcul : pas de variation à afficher (on ne compare pas deux calculs différents)
    let alive = true;
    let timer: number | undefined;
    // La puce apparaît à la fin de la transition du ciel.
    void waitForSky().then(() => {
      if (!alive) return;
      setBadge({ key: Date.now(), parts });
      timer = window.setTimeout(() => alive && setBadge(null), BADGE_MS);
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [view]);

  if (od) return <OdCounter view={view} reduced={reduced} od={od} share={share} badge={badge} />;

  /** Ciel tout éteint (L-18) : phrase à la place de la légende du nombre */
  const none = t.hasData && t.accessibleCount === 0;
  const detail = poleCounterDetail(view, share);
  // Deux lignes (L-04) : le nombre, puis sa légende ; la phrase complète (pôles, part) est dans le tiroir de la barre
  // (`CounterDetail`, D-049) et au lecteur d'écran. La jauge de part reste un filet sous la légende.
  return (
    <div className="counter-block">
      <div className="counter-top">
        <AnimatePresence>
          {badge && (
            <m.span
              key={badge.key}
              className="counter-badge"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
            >
              <BadgeParts parts={badge.parts} />
            </m.span>
          )}
        </AnimatePresence>
        <JobsCounter value={t.jobs} reduced={reduced} duration={lightingDuration(t.accessibleCount)} />
      </div>
      <span className={`counter-caption ${none ? 'is-none' : ''}`}>
        {none ? (
          <>
            Aucun pôle accessible aller <em>et</em> retour en {view.scenario.budget} min ou moins par sens
          </>
        ) : (
          <>
            postes salariés (INSEE), aller <em>et</em> retour
          </>
        )}
        <span className="sr-only">. {detail}</span>
      </span>
      {share != null && <CounterGauge view={view} share={share} />}
    </div>
  );
}

/** Phrase complète du compteur (journées-types) : « n pôles sur N accessibles aller et retour en … ». */
function poleCounterDetail(view: SkyView, share: number | null): string {
  const t = view.totals;
  const poleWord = `pôle${t.accessibleCount > 1 ? 's' : ''}`;
  return `${t.accessibleCount} ${poleWord} sur ${t.poleCount} accessible${t.accessibleCount > 1 ? 's' : ''} aller et retour en ${view.scenario.budget} min ou moins par sens${
    share != null ? `, soit ${formatPercent(share * 100)} des postes salariés des ${t.poleCount} pôles` : ''
  }.`;
}

/**
 * Phrase complète du compteur (D-049) : dans le tiroir de la barre, au « i » du compteur depuis le lot 6 (même contenu : la phrase
 * et, en table OD, la part de chaque astre ; elle était écrite deux fois). Les lecteurs d'écran la lisent aussi dans la légende du compteur.
 */
export function CounterDetail({ view }: { view: SkyView }) {
  const sourcesOn = useProvenanceStore((s) => s.on);
  const t = view.totals;
  const od = view.basis === 'od' ? t.od ?? null : null;
  /** Millésime des postes, lu dans les données (pôles EMP01) : définition des postes en première ligne du « i » (11/11) */
  const jobsYear = view.dataset.poles.find((p) => p.jobs_source === 'EMP01')?.jobs_year ?? null;
  if (od) {
    // « (Flores 2023) » : mode sources seulement (D-033) ; le terme « postes salariés (INSEE) » est dit juste avant (légende), d'où « postes salariés » ici
    const detail = odCounterDetail(od, view.scenario.budget, sourcesOn ? jobsYear : null);
    return (
      <div className="counter-full">
        <div className="counter-detail">
          <InfoTip label="Détail du compteur" placement="top" className="counter-info">
            <span className="counter-detail counter-definition">{jobsDefinition(jobsYear)}</span>
            {/* une phrase par ligne : le relevé des phrases lit les bulles ligne par ligne */}
            {'\n'}
            <span className="counter-detail">{detail}</span>
            <span className="counter-poles-title">Dans les {view.dataset.poles.length} pôles d'emploi (part des postes atteinte) :</span>
            <span className="counter-poles">
              {view.dataset.poles.map((p, i) => {
                const part = view.states[i]?.od;
                return <span key={p.id}>{part ? poleShareLine(poleShortName(p), part) : `${poleShortName(p)} : non calculé`}</span>;
              })}
            </span>
          </InfoTip>
        </div>
      </div>
    );
  }
  if (!t.hasData) return null;
  const share = t.jobs != null && t.totalJobs ? t.jobs / t.totalJobs : null;
  const detail = poleCounterDetail(view, share);
  return (
    <div className="counter-full">
      <div className="counter-detail">
        <InfoTip label="Détail du compteur" placement="top" className="counter-info">
          <span className="counter-detail counter-definition">{jobsDefinition(jobsYear)}</span>
          {/* une phrase par ligne : le relevé des phrases lit les bulles ligne par ligne */}
          {'\n'}
          <span className="counter-detail">{detail}</span>
        </InfoTip>
      </div>
    </div>
  );
}

/**
 * Filet de la part sous le nombre, et son « i » « Comment lire ce graphique » (seul graphique du site qui n'en avait pas, 10/11) :
 * ce que montre le filet, puis le cas avec les valeurs affichées (`counterGaugeReading`, même calcul que la part de l'écran).
 */
function CounterGauge({ view, share }: { view: SkyView; share: number }) {
  const year = view.dataset.poles.find((p) => p.jobs_source === 'EMP01')?.jobs_year ?? null;
  const reading = counterGaugeReading({
    origin: view.origin?.name ?? null,
    budget: view.scenario.budget,
    totals: view.totals,
    od: view.basis === 'od',
    year,
  });
  return (
    <div className="counter-gauge-row">
      <div className="counter-gauge" aria-hidden="true">
        <span style={{ transform: `scaleX(${share})` }} />
      </div>
      <ChartReadingTip chart="filet du compteur, part des postes atteints" reading={reading} placement="top" className="counter-gauge-tip" />
    </div>
  );
}

type Badge = { key: number; parts: string[] } | null;

/**
 * Texte de la pastille : une ligne par écart (« +54 communes », puis « +2 580 329 postes »), jamais coupée au milieu. Le séparateur
 * « · » reste dans le texte de la page (lecteurs d'écran, relevés), sans être affiché : la feuille de style pose les écarts l'un sous
 * l'autre. Deux lignes au plus, donc une hauteur connue (constat du 12/11 : le texte libre passait sur quatre lignes à 1280 px).
 */
function BadgeParts({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={p} className="counter-badge-part">
          {i > 0 && <span className="counter-badge-sep"> · </span>}
          {p}
        </span>
      ))}
    </>
  );
}

function BadgeChip({ badge }: { badge: Badge }) {
  return (
    <AnimatePresence>
      {badge && (
        <m.span
          key={badge.key}
          className="counter-badge"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
        >
          <BadgeParts parts={badge.parts} />
        </m.span>
      )}
    </AnimatePresence>
  );
}

/**
 * Compteur de la table OD (D-019) : postes atteints aller ET retour sur toute l'Île-de-France (somme
 * des postes Flores des communes atteintes), avec la part ; le détail des pôles est dans le tiroir de la barre (`CounterDetail`).
 */
function OdCounter({
  view,
  reduced,
  od,
  share,
  badge,
}: {
  view: SkyView;
  reduced: boolean;
  od: NonNullable<SkyView['totals']['od']>;
  share: number | null;
  badge: Badge;
}) {
  const sourcesOn = useProvenanceStore((st) => st.on);
  const jobsYear = view.dataset.poles.find((p) => p.jobs_source === 'EMP01')?.jobs_year ?? null;
  const detail = odCounterDetail(od, view.scenario.budget, sourcesOn ? jobsYear : null);
  const none = od.reachedAll === 0;
  return (
    <div className="counter-block is-od">
      <div className="counter-top">
        <BadgeChip badge={badge} />
        <JobsCounter value={od.reachedAll} reduced={reduced} duration={lightingDuration(view.totals.accessibleCount)} />
      </div>
      <span className={`counter-caption ${none ? 'is-none' : ''}`}>
        {none ? (
          <>
            Aucun poste atteint aller <em>et</em> retour en {view.scenario.budget} min ou moins par sens
          </>
        ) : (
          <>
            {/* 12/11 : la part (« 40,2 % de l'IDF hors votre commune ») coupait la légende par « … » à 1280 et 1440 px (colonne de 100 px, trois
                lignes au plus) ; elle reste dite par le filet, son « i », le « i » du compteur et la phrase lue par les lecteurs d'écran */}
            postes salariés (INSEE), aller <em>et</em> retour
          </>
        )}
        <span className="sr-only">. {detail}</span>
      </span>
      {share != null && <CounterGauge view={view} share={share} />}
    </div>
  );
}
