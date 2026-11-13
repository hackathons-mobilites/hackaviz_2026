import { motion as m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { modeComputedFor, modeMissingMessage, modePublishedIn, modeUnavailableText } from '../data/coverage';
import { MODE_PHRASE, MODE_SHORT } from '../data/labels';
import { LOADING_MESSAGE, missingAccessMessage } from '../data/summary';
import { stripDecisionCodes } from '../data/proof';
import { useProvenanceStore } from '../store/provenanceStore';
import { budgetScale, equivalentDistance, walkVariantOptions } from '../state/budget';
import { compareAnnouncement } from '../state/compareAnnounce';
import { splitFirstSentence, walkDistanceText, walkShortText } from '../data/walkSettings';
import type { ModeId } from '../data/types';
import { useViewport } from '../hooks/useViewport';
import { useDisplayedView, useReveal, useSkyView } from '../store/selectors';
import { selectReducedMotion, useSkyStore } from '../store/useSkyStore';
import { motion, reveal, scenarioBar } from '../theme/tokens';
import { BudgetRange } from './BudgetRange';
import { CommuneSearch } from './CommuneSearch';
import { CounterBlock, CounterDetail } from './CounterBlock';
import { InfoTip } from './InfoTip';
import './scenarioBar.css';
import { MySettingsEntry } from './settings/MySettings';
import { ShiftDay, ShiftFree } from './ShiftControl';
import { VehicleSelect } from './VehicleSelect';
import { VelibWarning } from './VelibWarning';

/**
 * Barre de scénario compacte (D-049, chantier C lot 2) : UNE ligne (commune, journée-type, temps de trajet par sens
 * avec sa durée, mode, compteur) et une flèche. La flèche ouvre un tiroir PAR-DESSUS le ciel (horaires libres, marche
 * ou véhicule, comparer, lien, distance équivalente, phrase complète du compteur) : la barre garde la même hauteur, tiroir ouvert
 * ou non, pour tous les scénarios et tous les modes (D-021 : le ciel n'est jamais recadré). `aria-expanded` sur la
 * flèche, Échap referme. Les notes de mode qui changent le sens (route vide, vélo + TC, indice du trafic, Vélib',
 * mode non calculé) restent dans la ligne.
 * Acte 0 : montée dès le titre, invisible et `inert`, pour que sa hauteur fixe le cadre du ciel AVANT
 * la pose (sinon le ciel sauterait d'un bloc à son apparition) ; elle entre au temps C.
 */
export function ScenarioBar() {
  const view = useSkyView();
  /** Vue affichée : le compteur n'a pas de valeur avant l'allumage */
  const shownView = useDisplayedView();
  const { mask, lights } = useReveal();
  const visible = mask.origin;
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const sourcesOn = useProvenanceStore((s) => s.on);
  const setBarHeight = useSkyStore((s) => s.setBarHeight);
  const reduced = useSkyStore(selectReducedMotion);
  const loading = useSkyStore((s) => s.loadingOrigin);
  const revealed = useSkyStore((s) => s.revealed);
  const astres44 = useSkyStore((s) => s.astres44);
  const odFailed = useSkyStore((s) => s.odFailed);
  const accessFiles = useSkyStore((s) => s.access);
  /** Téléphone : la journée-type passe dans le tiroir (la ligne n'y tient pas) */
  const phone = useViewport().width <= scenarioBar.phoneMaxPx;
  const [copied, setCopied] = useState(false);
  const [comparing, setComparing] = useState(false);
  /** Tiroir ouvert (par-dessus le ciel, sans changer la hauteur de la barre) */
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Comparaison entrée, changée ou quittée (en-tête du ciel B, tiroir ou lien) : dite aux lecteurs d'écran (retours du
  // testeur KBS, 10/11). Ici, car la barre reste montée quand le diptyque disparaît. Rien au chargement d'un lien, rien
  // pendant la visite (sa narration le dit) ni avant la fin de la révélation.
  const compareInsee = useSkyStore((s) => s.scenario.compare);
  const [seenCompare, setSeenCompare] = useState(compareInsee);
  const [compareMsg, setCompareMsg] = useState('');
  if (seenCompare !== compareInsee) {
    setSeenCompare(compareInsee);
    const st = useSkyStore.getState();
    const nameOf = (insee: string) => st.dataset?.communes.find((c) => c.insee === insee)?.name ?? insee;
    const originName = st.scenario.origin ? nameOf(st.scenario.origin) : null;
    setCompareMsg(compareAnnouncement(seenCompare, compareInsee, originName, nameOf, st.tour.status !== 'idle' || st.intro !== 'done'));
  }

  // Hauteur mesurée → le ciel, la légende et le zoom se placent au-dessus. Le tiroir est hors du flux (position
  // absolue au-dessus de la barre) : l'ouvrir ne change pas cette hauteur.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--bar-h', `${h}px`);
      setBarHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [setBarHeight]);

  // Échap referme le tiroir même quand le focus a quitté la barre (la recherche de la seconde commune se démonte au choix et
  // laisse le focus sur la page) ; jamais si le focus est ailleurs (panneau, liste) : Échap y garde son sens
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const active = document.activeElement;
      if (active && active !== document.body && !ref.current?.contains(active)) return;
      setExpanded(false);
      toggleRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (!view || !shownView) return null;
  const { meta, communes } = view.dataset;
  const sc = view.scenario;
  const computed = new Set(meta.access_communes ?? []);
  const suggestions = (meta.story_communes.length ? meta.story_communes : [...computed])
    .map((insee) => communes.find((c) => c.insee === insee))
    .filter((c): c is NonNullable<typeof c> => !!c && c.insee !== sc.origin)
    .slice(0, 8);
  const showCounter = lights && !!shownView.origin && shownView.totals.hasData;
  const originFile = sc.origin ? accessFiles[sc.origin] : null;
  // Mode partiel (vélo + TC, D-014 / D-020) choisi pour une commune hors couverture : message clair, ciel neutre
  const modeMissing = modeMissingMessage(meta, sc.mode, sc.origin, MODE_SHORT[sc.mode] ?? sc.mode);
  /** Jauge continue (D-018) ; null = ancien jeu sans pas ni horizon : boutons meta.budgets */
  const scale = budgetScale(meta);
  /** À pied ou à vélo : distance équivalente au temps choisi, si le pipeline publie ses vitesses (L-06) */
  const distance = equivalentDistance(sc.budget, sc.mode, meta.speeds);
  /** Réglage de marche des TC (D-024, L-07) : options publiées, pour le seul mode concerné */
  const walkOptions = walkVariantOptions(meta, sc.mode);
  const walkMeta = meta.walk_settings;
  const walkId = view.walkSetting?.id ?? walkOptions.find((o) => o.isDefault)?.id ?? '';
  /** Vélib' (D-027) : avertissement publié, première phrase dans la ligne, texte entier au « i » */
  const velibWarning = sc.mode === 'velib' && !modeMissing ? meta.velib?.warning : undefined;
  /** Note du mode (tout ce qui change le sens d'un temps) : reste dans la ligne de la barre, pour tous les modes (L-04 / L-07) */
  const modeNote = modeMissing
    ? modeMissing
    : sc.mode === 'bike_transit'
      ? "vélo jusqu'à la gare, puis transports en commun et marche"
      : sc.mode === 'car'
        ? 'route vide : temps optimiste aux heures de pointe'
        : sc.mode === 'car_traffic'
          ? "indice de trafic moyen de la DiRIF (direction des routes d'Île-de-France) sur les voies rapides, appliqué à tout le trajet (choix de l'équipe)"
          : // Réglage de marche publié mais sans objet pour ce mode (D-024) : on le dit plutôt que de le cacher
          meta.walk_settings && sc.mode !== meta.walk_settings.mode
          ? `réglage de marche : ${MODE_PHRASE[meta.walk_settings.mode] ?? meta.walk_settings.mode} seulement`
          : null;
  /** Transports en commun : le réglage de marche en vigueur, dit court dans la ligne (le sélecteur est dans le tiroir) */
  const walkShort = walkShortText(view.walkSetting);
  const barNote = modeNote ?? walkShort;
  const vehicleChoice = !modeMissing && (sc.mode === 'car' || sc.mode === 'car_traffic') && (meta.vehicles?.length ?? 0) > 1;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copiez le lien du scénario :', window.location.href);
    }
  };

  const closeDrawer = () => {
    setExpanded(false);
    toggleRef.current?.focus();
  };

  /** Choix du mode : dans la ligne sur ordinateur, dans le tiroir au téléphone (la note reste dans la ligne) */
  const modeSelect = (
    <select
      id="mode-select"
      className="select"
      title={`${MODE_SHORT[sc.mode] ?? meta.modes.find((mo) => mo.id === sc.mode)?.label ?? ''}${sc.mode === 'car_traffic' ? ' (estimation)' : ''}`}
      value={sc.mode}
      onChange={(e) => void applyScenario({ mode: e.target.value as ModeId })}
    >
      {meta.modes.map((mo) => {
        // Mode proposé seulement si la commune a des données pour lui (D-014) ; jamais de zéro affiché.
        const unavailable = !modeComputedFor(meta, mo.id, sc.origin) || (!!originFile && !modePublishedIn(meta, originFile, mo.id));
        const why = modeUnavailableText(meta, mo.id, sc.origin);
        return (
          <option key={mo.id} value={mo.id} title={mo.label} disabled={unavailable && mo.id !== sc.mode}>
            {MODE_SHORT[mo.id] ?? mo.label}
            {/* temps modélisé (route vide corrigée par l'indice de trafic moyen DiRIF) : « estimation » visible (D-064, Nicolas 11/11) */}
            {mo.id === 'car_traffic' && !unavailable ? ' (estimation)' : ''}
            {unavailable ? ` (${why})` : ''}
          </option>
        );
      })}
    </select>
  );

  return (
    <m.section
      ref={ref}
      id="scenario-options"
      className={`scenario-bar ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      aria-label="Scénario"
      aria-hidden={visible ? undefined : true}
      inert={!visible}
      onKeyDown={(e) => {
        // Les bulles « i » et les horaires libres ferment d'abord (ils arrêtent l'événement) ; ensuite le tiroir
        if (e.key === 'Escape' && expanded) {
          e.stopPropagation();
          closeDrawer();
        }
      }}
      initial={{ y: 24, opacity: 0, visibility: 'hidden' }}
      animate={
        visible
          ? { y: 0, opacity: 1, visibility: 'visible' }
          : { y: 24, opacity: 0, transitionEnd: { visibility: 'hidden' } }
      }
      transition={{ duration: (visible ? motion.ui : reveal.backUi) / 1000, ease: motion.cssEasing.ui }}
    >
      <p className="sr-only" aria-live="polite">
        {compareMsg}
      </p>
      <div className="bar-row">
        <div className="bar-group bar-origin">
          <CommuneSearch
            communes={communes}
            value={view.origin}
            label="Ma commune de départ"
            placeholder="Tapez une commune"
            featured={suggestions}
            featuredLabel={meta.story_communes.length ? 'Communes du récit' : 'Communes calculées'}
            onSelect={(c) => void applyScenario({ origin: c.insee, pole: null })}
          />
        </div>

        {!phone && <ShiftDay view={view} />}

        {scale ? (
          <div className="bar-group bar-budget">
            <label className="field-label" id="budget-label" htmlFor="budget-range">
              Temps de trajet par sens
            </label>
            <BudgetRange scale={scale} value={sc.budget} labelId="budget-label" />
          </div>
        ) : (
          <fieldset className="bar-group bar-budget">
            <legend className="field-label">Temps de trajet par sens</legend>
            <div className="seg">
              {meta.budgets.map((b) => (
                <label key={b} className={sc.budget === b ? 'is-on' : ''}>
                  <input type="radio" name="budget" value={b} checked={sc.budget === b} onChange={() => void applyScenario({ budget: b })} />
                  <span>{b} min</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="bar-group bar-mode">
          {!phone && (
            <label className="field-label" htmlFor="mode-select">
              Mode
            </label>
          )}
          <div className="mode-line">
            {!phone && modeSelect}
            {/* Note du mode dans la ligne, jamais cachée : la hauteur de la barre ne dépend pas du mode (leçon de D-021).
                Vélib' : avertissement (D-027) ; mode non calculé : le message ; TC : réglage de marche en vigueur. */}
            {velibWarning ? (
              <span className="mode-note mode-hint velib-hint">
                <strong>{splitFirstSentence(velibWarning)[0]}</strong>
                <InfoTip label="Que veut dire l'avertissement Vélib' ?" placement="top" className="velib-tip">
                  <VelibWarning text={velibWarning} />
                </InfoTip>
              </span>
            ) : modeMissing ? (
              <span className="mode-note mode-hint" role="note" title={modeNote ?? undefined}>
                {barNote}
              </span>
            ) : barNote ? (
              // Lot 6 : une précision de calcul, au « i » (le texte reste dans le tiroir quand c'est une note de mode)
              <InfoTip label="Précision sur ce mode" placement="top" className="walk-tip">
                {barNote}
              </InfoTip>
            ) : null}
          </div>
        </div>

        <div className="bar-group bar-counter" aria-busy={!!loading}>
          {showCounter ? (
            <CounterBlock view={shownView} reduced={reduced} />
          ) : (
            <>
              <span className="sr-only">Postes salariés (INSEE) accessibles</span>
              {/* Pas de zone annoncée ici : SkySummary est la seule (une annonce par changement) */}
              <span className="counter-msg">
                {!mask.light
                  ? '-'
                  : loading && !lights
                    ? LOADING_MESSAGE
                    : !revealed
                      ? 'Le ciel n’est pas encore révélé.'
                      : shownView.accessMissing
                        ? missingAccessMessage(meta.access_communes)
                        : shownView.origin
                          ? (modeMissing ?? (astres44 && odFailed ? 'Chargement des données échoué : rechargez la page.' : astres44 ? 'En cours de calcul pour les 44 astres (journée-type ou mode).' : 'Pas encore calculé pour ce scénario (journée-type ou mode).'))
                          : 'Choisissez une commune de départ.'}
              </span>
            </>
          )}
        </div>

        <button
          ref={toggleRef}
          type="button"
          className="icon-btn bar-toggle"
          aria-expanded={expanded}
          aria-controls="scenario-drawer"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Replier les réglages du scénario' : 'Déplier les réglages du scénario'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Tiroir : par-dessus le ciel, hors du flux (la barre garde sa hauteur). Toujours monté (les identifiants
          #walk-select et #vehicle-select existent fermé), masqué par `hidden` tant qu'il est fermé. */}
      <div id="scenario-drawer" className="bar-drawer" role="group" aria-label="Réglages du scénario" hidden={!expanded}>
        {/* Demande de Nicolas (10/11) : fermer depuis le haut du tiroir, comme les panneaux (croix) ; même effet que la flèche du bas */}
        <button type="button" className="icon-btn drawer-close" onClick={closeDrawer} aria-label="Fermer les réglages du scénario" aria-keyshortcuts="Escape">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="drawer-grid">
          {phone && (
            <div className="drawer-cell drawer-day">
              <ShiftDay view={view} />
            </div>
          )}
          {phone && (
            <div className="drawer-cell drawer-modepick">
              <label className="field-label" htmlFor="mode-select">
                Mode
              </label>
              {modeSelect}
            </div>
          )}
          <div className="drawer-cell drawer-shift">
            <span className="field-label">Horaires</span>
            <ShiftFree view={view} />
          </div>

          {(!modeMissing && walkOptions.length > 1) || vehicleChoice || modeNote ? (
            <div className="drawer-cell drawer-mode">
              <span className="field-label">Réglages du mode</span>
              {!modeMissing && walkOptions.length > 1 ? (
                <span className="walk-setting">
                  <label htmlFor="walk-select" className="walk-label">
                    Marche
                  </label>
                  <select
                    id="walk-select"
                    className="select walk-select"
                    value={walkId}
                    onChange={(e) => {
                      const opt = walkOptions.find((o) => o.id === e.target.value);
                      void applyScenario({ walk: opt && !opt.isDefault ? opt.id : null });
                    }}
                  >
                    {walkOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <InfoTip label="Que règle « Marche » ?" placement="top" className="walk-tip">
                    Distance à pied au plus à chaque bout d'un trajet en transports en commun
                    {walkMeta?.legs?.length ? ` (${walkMeta.legs.join(', ')})` : ''}.
                    {walkMeta?.nature ? (() => { const n = sourcesOn ? walkMeta.nature : stripDecisionCodes(walkMeta.nature); return ` ${n.charAt(0).toUpperCase()}${n.slice(1)}.`; })() : ''}
                    {walkDistanceText(walkMeta?.transfer_limit_m) ? ` Correspondances à pied : ${walkDistanceText(walkMeta?.transfer_limit_m)} au plus (limite du moteur de calcul).` : ''}{' '}
                    <button type="button" className="link-btn" onClick={() => useSkyStore.getState().setSourcesOpen(true, 'marche-reglage')}>
                      Sources &amp; limites
                    </button>
                  </InfoTip>
                </span>
              ) : vehicleChoice ? (
                <VehicleSelect meta={meta} vehicle={sc.vehicle} note={modeNote} />
              ) : null}
              {/* Audit d'affichage du 11/11 (B9, B10) : en voiture, la note du mode est une précision de calcul, déjà au « i » de la ligne du mode
                  (« Précision sur ce mode ») ; écrite ici en mode sources seulement */}
              {modeNote && (sourcesOn || (sc.mode !== 'car' && sc.mode !== 'car_traffic') || !!modeMissing) && <p className="drawer-note">{modeNote}</p>}
            </div>
          ) : null}

          <div className="drawer-cell drawer-compare">
            <span className="field-label">Comparer</span>
            <div className="compare-row">
              {sc.compare ? (
                <span className="chip chip-compare">
                  B : {communes.find((c) => c.insee === sc.compare)?.name ?? sc.compare}
                  <button type="button" className="chip-x" autoFocus onClick={() => void applyScenario({ compare: null })} aria-label="Quitter la comparaison">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              ) : comparing ? (
                <div className="compare-search">
                  <CommuneSearch
                    communes={communes}
                    value={null}
                    label="Comparer avec"
                    placeholder="Seconde commune…"
                    autoFocus
                    onSelect={(c) => {
                      setComparing(false);
                      void applyScenario({ compare: c.insee });
                    }}
                    onCancel={() => setComparing(false)}
                  />
                </div>
              ) : (
                <button type="button" className="chip chip-action" autoFocus onClick={() => setComparing(true)}>
                  Comparer…
                </button>
              )}
            </div>
          </div>

          {scale && distance && (
            <div className="drawer-cell drawer-ref">
              <span className="field-label">Distance équivalente</span>
              <span className="drawer-ref-line">
                <span className="bar-distance">
                  {distance.text}
                  <InfoTip label="Que signifie cette distance ?" placement="top">
                    Distance de chemin parcourue en {sc.budget} min à vitesse constante (vitesse du calcul :{' '}
                    {String(distance.kmh).replace('.', ',')} km/h), pas un rayon à vol d'oiseau.
                  </InfoTip>
                </span>
              </span>
            </div>
          )}

          <div className="drawer-cell drawer-link">
            <span className="field-label">Partager</span>
            <button
              type="button"
              className="btn drawer-copy"
              onClick={() => void copy()}
              aria-label={copied ? 'Lien copié' : 'Copier le lien du scénario'}
            >
              {copied ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12l5 5 9-10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              <span aria-hidden="true">{copied ? 'Lien copié' : 'Copier le lien'}</span>
            </button>
          </div>

          <MySettingsEntry />

          {showCounter && (
            <div className="drawer-cell drawer-counter">
              <span className="field-label">Compteur</span>
              <CounterDetail view={shownView} />
            </div>
          )}
        </div>
      </div>
    </m.section>
  );
}
