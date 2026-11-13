import { motion as m } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useViewport } from '../../hooks/useViewport';
import { selectReducedMotion, useSkyStore } from '../../store/useSkyStore';
import { aideCssVars, aidePage, motion, scenarioBar } from '../../theme/tokens';
import { GUIDE_CAPTURES } from './guide.captures';
import { GUIDE_CATEGORIES, GUIDE_ENTRIES, type GuideEntry, type GuideShot } from './guide.manifest';
import { filterGuide, type GuideSection } from './guideSearch';
import './guide.css';

const VARS = aideCssVars() as CSSProperties;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Page d'aide : un dialogue modal plein écran, par catégorie, avec sommaire et recherche. Tout le contenu vient de `guide.manifest.ts`.
 *
 * Le clavier reste dans l'aide : Échap (vide d'abord la recherche), Tab bouclé, et aucune touche ne part vers le site (M, flèches, plus,
 * moins...). Le reste de l'application est `inert` tant que l'aide est ouverte : un panneau ouvert derrière ne reçoit plus rien.
 */
export default function GuideDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [query, setQuery] = useState('');
  const queryRef = useRef('');
  useEffect(() => {
    queryRef.current = query;
  }, [query]);
  const [tocOpen, setTocOpen] = useState(false);
  const phone = useViewport().width <= scenarioBar.phoneMaxPx;
  const reduced = useSkyStore(selectReducedMotion);
  const sections = useMemo(() => filterGuide(GUIDE_CATEGORIES, GUIDE_ENTRIES, query), [query]);
  const count = sections.reduce((n, s) => n + s.entries.length, 0);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const app = document.querySelector<HTMLElement>('.app');
    if (app) app.inert = true;
    closeRef.current?.focus();
    return () => {
      if (app) app.inert = false;
      opener.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Phase de capture sur window : avant les raccourcis du site (touche M, flèches de la carte, Échap des panneaux)
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (queryRef.current && document.activeElement === searchRef.current) setQuery('');
        else onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const inside = root.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const goTo = (e: MouseEvent<HTMLAnchorElement>, entryId: string) => {
    e.preventDefault();
    setTocOpen(false);
    const el = document.getElementById(`aide-${entryId}`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  };

  const toc = (
    <nav className="guide-toc-nav" aria-label="Sommaire de l'aide">
      <ul>
        {sections.map((s) => (
          <li key={s.category.id}>
            <span className="guide-toc-cat">{s.category.title}</span>
            <ul>
              {s.entries.map((entry) => (
                <li key={entry.id}>
                  <a href={`#aide-${entry.id}`} onClick={(ev) => goTo(ev, entry.id)}>
                    {entry.title}
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );

  return createPortal(
    <m.div
      className="guide-backdrop"
      style={VARS}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: (reduced ? motion.reduced : motion.ui) / 1000, ease: motion.cssEasing.ui }}
    >
      <div ref={dialogRef} className="guide" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="guide-head">
          <div className="guide-head-text">
            <h2 id={titleId}>Aide</h2>
            <p>Tout ce que permet le site, par thème.</p>
          </div>
          <div className="guide-search">
            <label htmlFor={`${titleId}-q`} className="field-label">
              Rechercher dans l'aide
            </label>
            <input
              id={`${titleId}-q`}
              ref={searchRef}
              type="search"
              value={query}
              autoComplete="off"
              spellCheck={false}
              placeholder="Vélo, comparer, nuit…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button ref={closeRef} type="button" className="icon-btn guide-close" onClick={onClose} aria-label="Fermer l'aide">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <p className="sr-only" role="status" aria-live="polite">
          {query ? `${count} résultat${count > 1 ? 's' : ''}` : ''}
        </p>
        <div className="guide-layout">
          {phone ? (
            <details className="guide-toc-fold" open={tocOpen} onToggle={(e) => setTocOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary>Sommaire</summary>
              {toc}
            </details>
          ) : (
            <div className="guide-toc">{toc}</div>
          )}
          <div className="guide-content">
            {sections.length === 0 && <p className="guide-empty">Aucune entrée de l'aide ne correspond à cette recherche.</p>}
            {sections.map((s) => (
              <GuideCategorySection key={s.category.id} section={s} />
            ))}
          </div>
        </div>
      </div>
    </m.div>,
    document.body,
  );
}

function GuideCategorySection({ section }: Readonly<{ section: GuideSection }>) {
  return (
    <section className="guide-section" aria-labelledby={`aide-cat-${section.category.id}`}>
      <h3 id={`aide-cat-${section.category.id}`}>{section.category.title}</h3>
      <p className="guide-intro">{section.category.intro}</p>
      {section.entries.map((entry) => (
        <GuideArticle key={entry.id} entry={entry} />
      ))}
    </section>
  );
}

function GuideArticle({ entry }: Readonly<{ entry: GuideEntry }>) {
  return (
    <article className="guide-article" id={`aide-${entry.id}`} tabIndex={-1} aria-labelledby={`aide-t-${entry.id}`}>
      <h4 id={`aide-t-${entry.id}`}>{entry.title}</h4>
      <p className="guide-purpose">{entry.purpose}</p>
      <div className="guide-cols">
        <div className="guide-text">
          <p className="guide-label">Comment faire</p>
          <ol>
            {entry.howTo.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {entry.shortcuts && (
            <table className="guide-keys">
              <caption className="sr-only">Raccourcis clavier</caption>
              <tbody>
                {entry.shortcuts.map((s) => (
                  <tr key={s.keys}>
                    <th scope="row">{s.keys}</th>
                    <td>{s.does}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="guide-label">À savoir</p>
          <ul>
            {entry.know.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
        <div className="guide-shots">
          {entry.shots.map((shot) => (
            <GuideFigure key={shot.file} shot={shot} />
          ))}
        </div>
      </div>
    </article>
  );
}

function GuideFigure({ shot }: Readonly<{ shot: GuideShot }>) {
  const size = GUIDE_CAPTURES[shot.file];
  const src = `${import.meta.env.BASE_URL}assets/guide/${shot.file}.webp`;
  // Jamais agrandie au-delà de sa taille réelle : une petite capture (un bouton) reste petite
  const phone = shot.viewport === 'phone';
  const natural = size ? size.w / (phone ? aidePage.capture.phoneScale : 1) : undefined;
  const maxWidth = natural === undefined ? undefined : Math.min(natural, phone ? aidePage.phoneShotMaxPx : aidePage.shotMaxPx);
  return (
    <figure style={maxWidth === undefined ? undefined : { maxWidth }}>
      <a href={src} target="_blank" rel="noreferrer">
        <img src={src} alt={shot.alt} loading="lazy" decoding="async" width={size?.w} height={size?.h} />
      </a>
    </figure>
  );
}
