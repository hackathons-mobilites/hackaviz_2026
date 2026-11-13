import { AnimatePresence, motion as m } from 'motion/react';
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
// Source unique du texte des limites : docs/limites.md (repris tel quel sur cette page).
import limitesMd from '../../../docs/limites.md?raw';
import { formatInt } from '../data/format';
import { parseInline } from '../data/mdInline';
import { calcMethodText } from '../data/od/texts';
import { originGroups, demoUsesRealPoles } from '../data/originSummary';
import { originPointPhrase, stripDecisionCodes, stripPersonalNotes } from '../data/proof';
import { sourceText } from '../data/sourceText';
import { ficheAnchor } from '../data/provenance';
import { frenchDate, frenchDayDate } from '../poster/posterText';
import type { InsightKind, Meta, ModeId } from '../data/types';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useProvenanceStore } from '../store/provenanceStore';
import { selectReducedMotion, useSkyStore } from '../store/useSkyStore';
import { repoFile } from '../theme/links';
import { motion } from '../theme/tokens';

/** Rendu Markdown minimal (titres, listes, gras, liens) - suffisant pour docs/limites.md ; voir data/mdInline.ts. */
function inline(text: string): ReactNode[] {
  return parseInline(text).map((t, i) => {
    if (t.kind === 'bold') return <strong key={i}>{t.text}</strong>;
    if (t.kind === 'link')
      return (
        <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">
          {t.text}
        </a>
      );
    return <Fragment key={i}>{t.text}</Fragment>;
  });
}

/**
 * Ancres de paragraphes de docs/limites.md, pour y renvoyer depuis l'interface (panneau de preuve,
 * liste du ciel) : début du libellé en gras → id. Le texte reste celui du fichier.
 */
/** Sommaire du tiroir (L-22, critique v0.6 § 9) : une entrée par section, dans l'ordre */
const TOC: { id: string; label: string }[] = [
  { id: 'src-ciel', label: 'Ce que montre le ciel' },
  { id: 'src-limites', label: 'Limites' },
  { id: 'src-donnees', label: 'Données' },
  { id: 'src-traitement', label: 'Traitement' },
  { id: 'src-methode', label: 'Méthode' },
  { id: 'src-visuels', label: 'IA générative' },
  { id: 'src-code', label: 'Licences' },
];

const LIMIT_ANCHORS: { match: RegExp; id: string }[] = [
  { match: /^\*\*Marche à pied : un réglage/, id: 'marche-reglage' },
  { match: /^\*\*Vélib'/, id: 'velib' },
];

function limitAnchor(item: string): string | undefined {
  return LIMIT_ANCHORS.find((a) => a.match.test(item))?.id;
}

function renderMarkdown(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`ul-${out.length}`}>
          {list.map((li, i) => {
            const id = limitAnchor(li);
            return (
              <li key={i} id={id ? `limite-${id}` : undefined} tabIndex={id ? -1 : undefined}>
                {inline(li)}
              </li>
            );
          })}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (!line || line.startsWith('# ')) continue; // le titre H1 est remplacé par celui de la page
    if (line.startsWith('## ')) out.push(<h4 key={out.length}>{inline(line.slice(3))}</h4>);
    else if (/^ce texte est repris/i.test(line)) continue;
    else out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return out;
}

const LIMITES = renderMarkdown(stripPersonalNotes(limitesMd));
/** Hors mode sources (D-033) : les mêmes limites, sans les codes de décision. */
const LIMITES_PLAIN = renderMarkdown(stripDecisionCodes(limitesMd));

/** "2026-11-02T22:01:26Z" → « 2 novembre 2026, 22h01 (UTC) » */
function frenchDateTime(iso: string): string {
  const t = /T(\d{2}):(\d{2})/.exec(iso);
  return t ? `${frenchDate(iso)}, ${Number(t[1])}h${t[2]} (UTC)` : frenchDate(iso);
}

/** Au-delà, la couverture d'un mode partiel est donnée en nombre seulement (pas de liste de noms) */
const COVERAGE_NAMES_MAX = 30;

const DOCS = [
  { label: 'Méthodologie', path: 'docs/methodologie.md' },
  { label: 'Limites', path: 'docs/limites.md' },
];

const INSIGHT_LABEL: Record<InsightKind, string> = {
  eclipse: 'Éclipse horaire',
  territorial_gap: 'Deux horizons',
  bike_gain: 'Gain vélo + transports en commun',
  late_return: 'Aller oui, retour non',
};

/** Champs de meta.json écrits par le pipeline (contrats-donnees.md), lus tels quels. */
type MetaExtra = Meta & {
  mode_coverage?: Partial<Record<ModeId, string[]>>;
  insights?: { written: boolean; kinds: Partial<Record<InsightKind, { status: string; reason?: string }>> };
};

export function SourcesDrawer() {
  const open = useSkyStore((s) => s.sourcesOpen);
  const anchor = useSkyStore((s) => s.sourcesAnchor);
  const setOpen = useSkyStore((s) => s.setSourcesOpen);
  const dataset = useSkyStore((s) => s.dataset);
  const sourcesOn = useProvenanceStore((s) => s.on);
  // Textes publiés de la liste des sources : sans code de décision ni fichier hors mode sources (D-033), sans mention de personne partout
  const cleanSource = (t: string) => sourceText(t, sourcesOn);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    // Renvoi vers un paragraphe (« Marche limitée à 2 km »…) : il prend le focus et vient à l'écran
    const t = window.setTimeout(() => {
      // Fiche d'une source (mode provenance : « fiche-EMP01 ») ou paragraphe des limites
      const target = anchor ? document.getElementById(anchor.startsWith('fiche-') ? anchor : `limite-${anchor}`) : null;
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start', behavior: selectReducedMotion(useSkyStore.getState()) ? 'auto' : 'smooth' });
      } else closeRef.current?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      returnFocus.current?.focus?.();
    };
  }, [open, setOpen, anchor]);

  const meta = dataset?.meta as MetaExtra | undefined;
  // Sommaire ancré (L-22) : la section prend le focus et vient en haut du tiroir ; l'URL ne change pas
  // (elle porte le scénario, pas la position dans le tiroir)
  const goTo = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'start', behavior: selectReducedMotion(useSkyStore.getState()) ? 'auto' : 'smooth' });
  };
  const isDemo = dataset?.origin === 'demo';
  const drawerRef = useRef<HTMLDivElement>(null);
  // « Retour en haut » (retour du testeur KBS, 10/11) : visible dès que le sommaire est sorti de l'écran du tiroir
  // (seuil tiré de la page elle-même, pas d'un nombre de pixels choisi), au clavier comme à la souris
  const bodyRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [scrolled, setScrolled] = useState(false);
  // Tiroir rouvert : il repart du haut, le bouton aussi
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    setScrolled(false);
  }
  const onBodyScroll = () => {
    const body = bodyRef.current;
    const toc = tocRef.current;
    if (!body || !toc) return;
    setScrolled(body.scrollTop > toc.offsetTop + toc.offsetHeight);
  };
  const backToTop = () => {
    // Le focus remonte au titre du tiroir (le bouton disparaît en haut), Tab reprend au sommaire
    titleRef.current?.focus({ preventScroll: true });
    bodyRef.current?.scrollTo({ top: 0, behavior: selectReducedMotion(useSkyStore.getState()) ? 'auto' : 'smooth' });
  };
  useFocusTrap(drawerRef, open);
  const totalCommunes = dataset?.communes.length ?? 0;
  const originInsee = useSkyStore((s) => s.scenario.origin);
  const originCommune = originInsee ? (dataset?.communes.find((c) => c.insee === originInsee) ?? null) : null;
  const origins = dataset && !isDemo ? originGroups(dataset.communes, meta?.origin_methods) : [];
  const namesOf = (codes: readonly string[]) =>
    codes
      .map((c) => dataset?.communes.find((x) => x.insee === c)?.name ?? c)
      .sort((a, b) => a.localeCompare(b, 'fr'));
  const coverage = meta
    ? meta.modes.map((mo) => {
        const list = meta.mode_coverage?.[mo.id];
        return {
          id: mo.id,
          label: mo.label,
          text: !list
            ? 'toutes les communes calculées'
            : list.length
              ? `${formatInt(list.length)} communes sur ${formatInt(totalCommunes)}${
                  // liste courte (vélo + TC : communes du récit et voisines) : les noms, dans l'ordre alphabétique
                  list.length <= COVERAGE_NAMES_MAX ? ` (${namesOf(list).join(', ')})` : ''
                }`
              : 'pas encore calculé',
        };
      })
    : [];
  const pendingInsights = meta?.insights
    ? (Object.entries(meta.insights.kinds) as [InsightKind, { status: string; reason?: string }][]).filter(
        ([, k]) => k.status !== 'ok',
      )
    : [];

  return (
    <AnimatePresence>
      {open && (
        <m.div
          key="sources"
          className="drawer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motion.ui / 1000 }}
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <m.div
            ref={drawerRef}
            className="drawer sources-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sources-title"
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
          >
            <header className="drawer-head">
              <h2 id="sources-title" ref={titleRef} tabIndex={-1}>
                Sources &amp; limites
              </h2>
              <button ref={closeRef} type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Fermer">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="drawer-body" ref={bodyRef} onScroll={onBodyScroll}>
              {isDemo && (
                <p className="demo-note">
                  {dataset && demoUsesRealPoles(dataset.poles) ? (
                    <>
                      Vous consultez une <strong>démonstration</strong> : les pôles et leurs postes salariés recensés par l'INSEE sont
                      réels, les <strong>durées de trajet sont tirées au hasard</strong>.
                    </>
                  ) : (
                    <>
                      Vous consultez un jeu de <strong>données fictives</strong> de démonstration : postes et durées de
                      trajet sont tirés au hasard. Les noms de pôles et de communes sont réels, les chiffres ne le sont pas.
                    </>
                  )}
                </p>
              )}

              <nav className="drawer-toc" aria-label="Sommaire" ref={tocRef}>
                <ul>
                  {TOC.filter((t) => t.id !== 'src-traitement' || (meta && !isDemo)).map((t) => (
                    <li key={t.id}>
                      <a href={`#${t.id}`} onClick={(e) => goTo(e, t.id)}>
                        {t.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>

              <section id="src-ciel" tabIndex={-1} aria-labelledby="src-ciel-h">
                <h3 id="src-ciel-h">Ce que montre le ciel</h3>
                <p>
                  Chaque astre est <strong>un bassin d'emploi</strong> ou <strong>un arrondissement</strong> de Paris. Ensemble,
                  les astres couvrent tous les <strong>postes salariés recensés par l'INSEE</strong> en Île-de-France (Flores). Ce ne sont
                  pas des offres d'emploi. Un astre est <strong>accessible</strong> si l'aller (départ le plus tardif qui arrive avant le début du poste) <em>et</em> le
                  retour (compté à partir de la fin du poste, attente comprise) durent chacun le temps choisi ou moins.
                </p>
                <p>{calcMethodText(true)}</p>
                {origins.length > 0 && (
                  <>
                    <p>
                      Point de départ du calcul, publié commune par commune (le temps réel dépend de l'adresse exacte) :
                    </p>
                    <ul className="coverage-list">
                      {origins.map((g) => (
                        <li key={g.method ?? 'none'}>
                          {g.label} : {formatInt(g.count)} commune{g.count > 1 ? 's' : ''}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {originCommune && <p>{originPointPhrase(originCommune, meta?.origin_methods)} ({originCommune.name}).</p>}
              </section>

              <section id="src-limites" tabIndex={-1} aria-labelledby="src-limites-h">
                <h3 id="src-limites-h">Limites</h3>
                {sourcesOn ? LIMITES : LIMITES_PLAIN}
              </section>

              <section id="src-donnees" tabIndex={-1} aria-labelledby="src-donnees-h">
                <h3 id="src-donnees-h">Sources des données</h3>
                {dataset && dataset.sources.length > 0 ? (
                  <ul className="sources-list">
                    {dataset.sources.map((s, i) => (
                      // Première entrée d'un code : fiche visée par les lignes de provenance (data/provenance.ts)
                      <li
                        key={`${s.source_id}-${i}`}
                        id={dataset.sources.findIndex((x) => x.source_id === s.source_id) === i ? ficheAnchor(s.source_id) : undefined}
                        tabIndex={dataset.sources.findIndex((x) => x.source_id === s.source_id) === i ? -1 : undefined}
                      >
                        <strong>{cleanSource(s.titre)}</strong>
                        <span>
                          {[s.source_id, s.millesime && `millésime ${cleanSource(s.millesime)}`, s.licence && cleanSource(s.licence)].filter(Boolean).join(' · ')}
                        </span>
                        {(s.date_extraction || s.date_service_transport) && (
                          <span className="source-dates">
                            {[s.date_extraction && `extrait le ${s.date_extraction}`, s.date_service_transport && `offre du ${cleanSource(s.date_service_transport)}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                        {sourcesOn && (s.traitements || s.limites) && (
                          <details className="source-more">
                            <summary>Traitements et limites</summary>
                            {s.traitements && <p>Traitements : {cleanSource(s.traitements)}</p>}
                            {s.limites && <p>Limites : {cleanSource(s.limites)}</p>}
                          </details>
                        )}
                        {s.url_source && (
                          <a href={s.url_source} target="_blank" rel="noreferrer">
                            {s.url_source}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>La liste détaillée des sources (sources.json) sera publiée avec les données du pipeline.</p>
                )}
              </section>

              {meta && !isDemo && (
                <section id="src-traitement" tabIndex={-1} aria-labelledby="src-traitement-h">
                  <h3 id="src-traitement-h">Traitement et versions</h3>
                  <dl className="meta-list">
                    <dt>Version du traitement</dt>
                    <dd className="mono">{meta.processing_version}</dd>
                    <dt>Données générées le</dt>
                    <dd className="mono">{frenchDateTime(meta.generated_at)}</dd>
                    <dt>Jour de service simulé</dt>
                    <dd className="mono">{frenchDayDate(meta.service_date)}</dd>
                    <dt>GTFS IDFM téléchargé le</dt>
                    <dd className="mono">{frenchDate(meta.gtfs_downloaded_at)}</dd>
                    <dt>Communes calculées</dt>
                    <dd className="mono">
                      {meta.access_communes
                        ? `${formatInt(meta.access_communes.length)} sur ${formatInt(dataset?.communes.length ?? 0)}`
                        : 'toutes'}
                    </dd>
                  </dl>
                  <h4>Couverture des modes</h4>
                  <ul className="coverage-list">
                    {coverage.map((c) => (
                      <li key={c.id}>
                        <strong>{c.label}</strong> : {c.text}
                      </li>
                    ))}
                  </ul>
                  {pendingInsights.length > 0 && (
                    <>
                      <h4>Découvertes non publiées</h4>
                      <ul className="coverage-list">
                        {pendingInsights.map(([kind, k]) => (
                          <li key={kind}>
                            <strong>{INSIGHT_LABEL[kind] ?? kind}</strong>
                            {k.reason ? ` : ${k.reason}` : ''}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              )}

              <section id="src-methode" tabIndex={-1} aria-labelledby="src-methode-h">
                <h3 id="src-methode-h">Méthode détaillée</h3>
                <ul className="coverage-list">
                  {DOCS.map((d) => {
                    const href = repoFile(d.path);
                    return (
                      <li key={d.path}>
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer">
                            {d.label}
                          </a>
                        ) : (
                          <>
                            {d.label}, dans le dépôt du projet
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section id="src-visuels" tabIndex={-1} aria-labelledby="src-visuels-h">
                <h3 id="src-visuels-h">Visuels et IA générative</h3>
                <p>
                  Les fonds de nébuleuse et les étoiles décoratives sont du <strong>décor</strong> (procédural ou généré par
                  IA) : ils ne portent aucune donnée. Seuls les astres ronds à contour (les pôles) et l'étoile-guide sont
                  des repères de données.
                </p>
              </section>

              <section id="src-code" tabIndex={-1} aria-labelledby="src-code-h">
                <h3 id="src-code-h">Code et licences</h3>
                <p>
                  Code ouvert, composants open source : React, PixiJS, anime.js, Motion, D3, Zustand (MIT / ISC), police
                  Jost (OFL). Calcul : Python, r5py et le moteur R5 (licences dans le README).
                </p>
                <p>
                  Licences du projet : le code est sous licence MIT ; les textes et les visuels du projet sont sous Creative Commons
                  Attribution 4.0 (CC BY 4.0), y compris les images décoratives générées par IA, qui ne portent aucune donnée. Les données restent aux conditions de chaque producteur,
                  et ces conditions ne sont pas les mêmes partout : Licence Ouverte d'Etalab, ODbL, ODC-BY pour les gares de péage du
                  ministère de la Transition écologique, Licence Mobilités pour les horaires d'Île-de-France Mobilités. Certaines
                  sources n'écrivent aucune licence, dont le découpage en bassins d'emploi de France Travail sur lequel reposent les
                  astres : elles sont citées avec leur source et leur date, sans que cela vaille licence.
                </p>
                <p>
                  Accord de l'organisateur : Île-de-France Mobilités, qui organise le hackathon, a autorisé le 09/11/2026 la
                  réutilisation dans cette dataviz des données dont la licence n'est pas écrite ou reste limitée (tarifs de péage de
                  VINCI Autoroutes, Sanef, SAPN et APRR, bassins d'emploi et enquête BMO de France Travail, Tarif Bleu d'EDF), à
                  trois conditions : des données mises à disposition par leurs producteurs et non obtenues par scraping, aucun
                  réexport des données brutes, le producteur crédité dans la dataviz elle-même. Les producteurs sont donc nommés
                  sous le ciel et au pied du panneau de chaque astre, et chaque montant de péage est suivi de son crédit (par
                  exemple « tarif © VINCI Autoroutes 2026 »). Le message de l'organisateur nomme VINCI ; l'équipe l'applique aux
                  autres sources citées. Cet accord vaut pour la dataviz, pas pour une redistribution des données : les mentions
                  légales de VINCI Autoroutes et d'EDF demandent une autorisation écrite, celles de Sanef n'ont pas pu être lues. Le
                  détail par fichier est dans le manifeste des sources, dans le dépôt.
                </p>
              </section>
            </div>
            <AnimatePresence>
              {scrolled && (
                <m.button
                  key="to-top"
                  type="button"
                  className="btn btn-ghost to-top"
                  onClick={backToTop}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 19V5 M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Retour en haut
                </m.button>
              )}
            </AnimatePresence>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
