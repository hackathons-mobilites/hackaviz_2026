/**
 * Affiche exportable : textes PURS, tous lus dans les données du ciel affiché (aucun chiffre ajouté).
 * La composition graphique (Canvas 2D) est dans renderPoster.ts.
 */
import type { SkyTotals } from '../data/accessibility';
import { OSM_CREDIT } from '../data/attribution';
import { formatInt, nbsp } from '../data/format';
import { odShare, selfJobsLine } from '../data/od/summaryText';
import { filosofiGridLabel, shortCommuneName, stripDecisionCodes, usesCalcOrigin } from '../data/proof';
import { activeWalkSetting, walkSettingPhrase } from '../data/walkSettings';
import type { Commune, Dataset, Pole } from '../data/types';
import type { Scenario } from '../state/scenario';

export interface PosterText {
  title: string;
  /** Temps choisi, en grand sous le titre (L-16) : « 60 min par sens » */
  timeHeadline: string;
  subtitle: string;
  kicker: string;
  sentence: string;
  skyCaption: string;
  areaCaption: string;
  /**
   * Note du mode, lue dans meta.json : réglage de marche des TC en vigueur avec sa nature (D-024), ou
   * avertissement Vélib' tel quel (D-027) ; null pour les autres modes.
   */
  modeNote: string | null;
  /** Entrée « accessible » de la légende, avec le budget (la légende de l'affiche doit se suffire) */
  legendOn: string;
  cards: { value: string; caption: string; accent: boolean }[];
  sources: string;
  url: string;
  mentions: string;
  fileName: string;
  demo: boolean;
}

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** "2026-11-17" → « 17 novembre 2026 » ; texte non daté rendu tel quel. */
export function frenchDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** "2026-11-17" → « mardi 17 novembre 2026 » (jour de la semaine calculé, calendrier grégorien). */
export function frenchDayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${WEEKDAYS[wd]} ${frenchDate(iso)}`;
}

/**
 * Libellés courts des sources réellement affichées (présentes dans sources.json). GEO02 (INSEE
 * Filosofi, carreaux) seulement si le point de départ d'une commune affichée en vient (D-017).
 */
export function posterSources(
  dataset: Pick<Dataset, 'sources' | 'meta' | 'origin'>,
  poles: readonly Pole[],
  origins: readonly (Pick<Commune, 'origin'> | null | undefined)[] = [],
): string {
  if (dataset.origin === 'demo') return 'Données fictives de démonstration';
  const ids = new Set(dataset.sources.map((s) => s.source_id));
  const year = poles.find((p) => p.jobs_source === 'EMP01')?.jobs_year;
  const out: string[] = [];
  if (ids.has('EMP01')) out.push(`INSEE Flores${year ? ` ${year}` : ''}`);
  if (ids.has('TRA01')) out.push(`IDFM GTFS, offre du ${frenchDate(dataset.meta.service_date)}`);
  if (ids.has('CYC01')) out.push(`${OSM_CREDIT} (ODbL)`);
  if (ids.has('GEO01')) out.push('API Géo');
  const filo = usesCalcOrigin(origins) ? filosofiGridLabel(dataset.sources) : null;
  if (filo) out.push(filo);
  return out.join(' · ');
}

export function posterFileName(s: Pick<Scenario, 'origin' | 'day' | 'budget' | 'mode' | 'compare' | 'walk'>, hd = false): string {
  const vs = s.compare ? `-vs-${s.compare}` : '';
  // réglage de marche hors défaut (D-024) : nom distinct, deux affiches ne s'écrasent pas
  const w = s.walk && s.mode === 'transit' ? `-${s.walk}` : '';
  return `starway-${s.origin ?? 'ciel'}-${s.day}-${s.budget}-${s.mode}${w}${vs}${hd ? '-hd' : ''}.png`;
}

export interface PosterInput {
  dataset: Dataset;
  scenario: Scenario;
  originName: string;
  totals: SkyTotals;
  demo: boolean;
  url: string;
  now: Date;
  /** Diptyque : commune B et totaux de son ciel (mêmes journée, budget, mode et réglage de marche) */
  compare?: { originName: string; totals: SkyTotals };
  /**
   * Table OD (D-019) : horaires du ciel (« 8h-16h », libres ou journée-type) ; les totaux portent
   * alors `od` (toute l'Île-de-France) et l'affiche dit une part atteinte, jamais « pôles accessibles ».
   */
  shiftLabel?: string;
}

/**
 * Note du mode sur l'affiche : TC, réglage de marche en vigueur et sa nature, sans code de décision (« Réglage de marche
 * normal : jusqu'à 3 km à pied à chaque bout, choix de l'équipe, pas une donnée. ») ; Vélib',
 * l'avertissement publié tel quel. null sinon.
 */
export function posterModeNote(meta: Dataset['meta'], scenario: Pick<Scenario, 'mode' | 'walk'>): string | null {
  if (scenario.mode === 'velib') return meta.velib?.warning ?? null;
  const ws = activeWalkSetting(meta, scenario.mode, scenario.walk);
  if (!ws) return null;
  const phrase = walkSettingPhrase(ws);
  const nature = meta.walk_settings?.nature;
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} à chaque bout${nature ? `, ${stripDecisionCodes(nature)}` : ''}.`;
}

export function buildPosterText(i: PosterInput): PosterText {
  const { dataset, scenario, totals } = i;
  const day = dataset.meta.day_types.find((d) => d.id === scenario.day);
  const mode = dataset.meta.modes.find((m) => m.id === scenario.mode)?.label ?? scenario.mode;
  const n = totals.poleCount;
  const share = (t: SkyTotals) => (t.jobs != null && t.totalJobs ? (100 * t.jobs) / t.totalJobs : null);
  const jobsTxt = (t: SkyTotals) => (t.jobs == null ? 'non disponible' : formatInt(t.jobs));
  const shareTxt = (t: SkyTotals) => {
    const v = share(t);
    return v == null ? 'non disponible' : `${nbsp(nf1.format(v))}\u00a0%`;
  };
  const b = i.compare;
  const year = dataset.poles.find((p) => p.jobs_source === 'EMP01')?.jobs_year;
  const date = `${i.now.getDate()} ${MONTHS[i.now.getMonth()]} ${i.now.getFullYear()}`;
  const od = totals.od;
  if (od && i.shiftLabel && (!b || b.totals.od)) {
    const odB = b?.totals.od;
    const shareOd = (t: NonNullable<SkyTotals['od']>) => {
      const v = odShare(t);
      return v == null ? 'non disponible' : `${nbsp(nf1.format(100 * v))}\u00a0%`;
    };
    // La commune de départ sort du total (trajet non mesuré) : dite à part, pour A et pour B
    const selfA = selfJobsLine(od.selfJobs);
    const selfB = odB ? selfJobsLine(odB.selfJobs) : null;
    const selfNote = odB
      ? selfA && selfB
        ? `Votre commune, A : ${formatInt(od.selfJobs)} postes ; B : ${formatInt(odB.selfJobs)} postes, trajet non mesuré, hors des totaux et des pourcentages.`
        : null
      : selfA
        ? `${selfA}, hors du total et du pourcentage.`
        : null;
    const scopeTxt = od.selfJobs > 0 ? 'des postes d’Île-de-France hors commune de départ' : 'des postes d’Île-de-France';
    return {
      title: b ? `Depuis ${shortCommuneName(i.originName)} et ${shortCommuneName(b.originName)}` : `Depuis ${shortCommuneName(i.originName)}`,
      timeHeadline: `${scenario.budget} min par sens`,
      subtitle: `Temps de trajet aller et retour, chacun ${scenario.budget} min ou moins · horaires ${i.shiftLabel} (scénario) · ${mode.charAt(0).toLowerCase()}${mode.slice(1)}`,
      kicker: 'Ce que montre le ciel',
      sentence: `Chaque pôle d’emploi s’éclaire selon la part de ses postes atteinte à l’aller et au retour, en ${scenario.budget} min ou moins dans chaque sens ; toutes les communes d’Île-de-France sont des destinations.`,
      skyCaption: `${n} pôles d’emploi, aux mêmes places pour tous les scénarios.`,
      legendOn: `Cœur cyan : postes atteints aller et retour (en ${scenario.budget} min ou moins par sens)`,
      areaCaption: `Aire des disques proportionnelle aux postes salariés recensés par l’INSEE${year ? ` (Flores ${year})` : ''}, aire du cœur aux postes atteints.${selfNote ? ` ${selfNote}` : ''}`,
      modeNote: posterModeNote(dataset.meta, scenario),
      cards: odB
        ? [
            { value: `${formatInt(od.reachedAll)} / ${formatInt(odB.reachedAll)}`, caption: 'postes salariés (INSEE) atteints aller et retour, A / B', accent: true },
            { value: `${formatInt(od.reachedCommunes)} / ${formatInt(odB.reachedCommunes)}`, caption: `communes atteintes sur ${formatInt(od.communes)}, A / B`, accent: false },
            { value: `${shareOd(od)} / ${shareOd(odB)}`, caption: `${scopeTxt}, A / B`, accent: false },
          ]
        : [
            { value: formatInt(od.reachedAll), caption: 'postes salariés (INSEE) atteints aller et retour', accent: true },
            { value: `${formatInt(od.reachedCommunes)} sur ${formatInt(od.communes)}`, caption: 'communes atteintes', accent: false },
            { value: shareOd(od), caption: scopeTxt, accent: false },
          ],
      sources: posterSources(
        dataset,
        dataset.poles,
        [scenario.origin, scenario.compare].map((insee) => (insee ? dataset.communes?.find((c) => c.insee === insee) : null)),
      ),
      url: i.url,
      mentions: `Généré le ${date} · données ${dataset.meta.processing_version} · fond : image générée par IA, décor sans donnée`,
      fileName: posterFileName(scenario),
      demo: i.demo,
    };
  }
  return {
    title: b ? `Depuis ${shortCommuneName(i.originName)} et ${shortCommuneName(b.originName)}` : `Depuis ${shortCommuneName(i.originName)}`,
    timeHeadline: `${scenario.budget} min par sens`,
    subtitle: `Temps de trajet aller et retour, chacun ${scenario.budget} min ou moins · journée-type ${day?.label ?? scenario.day} (scénario) · ${mode.charAt(0).toLowerCase()}${mode.slice(1)}`,
    kicker: 'Ce que montre le ciel',
    sentence: `Les pôles d’emploi accessibles à l’aller et au retour, en ${scenario.budget} min ou moins dans chaque sens, s’allument.`,
    skyCaption: `${n} pôles d’emploi, aux mêmes places pour tous les scénarios.`,
    legendOn: `Accessible aller et retour (en ${scenario.budget} min ou moins par sens)`,
    areaCaption: `Aire des disques proportionnelle aux postes salariés recensés par l’INSEE${year ? ` (Flores ${year})` : ''}.`,
    modeNote: posterModeNote(dataset.meta, scenario),
    cards: b
      ? [
          { value: `${jobsTxt(totals)} / ${jobsTxt(b.totals)}`, caption: 'postes salariés (INSEE) accessibles aller et retour, A / B', accent: true },
          { value: `${totals.accessibleCount} / ${b.totals.accessibleCount} sur ${n}`, caption: 'pôles d’emploi accessibles, A / B', accent: false },
          { value: `${shareTxt(totals)} / ${shareTxt(b.totals)}`, caption: `des postes des ${n} pôles, A / B`, accent: false },
        ]
      : [
          { value: jobsTxt(totals), caption: 'postes salariés (INSEE) accessibles aller et retour', accent: true },
          { value: `${totals.accessibleCount} sur ${n}`, caption: 'pôles d’emploi accessibles', accent: false },
          { value: shareTxt(totals), caption: `des postes des ${n} pôles`, accent: false },
        ],
    sources: posterSources(
      dataset,
      dataset.poles,
      [scenario.origin, scenario.compare].map((insee) => (insee ? dataset.communes?.find((c) => c.insee === insee) : null)),
    ),
    url: i.url,
    mentions: `Généré le ${date} · données ${dataset.meta.processing_version} · fond : image générée par IA, décor sans donnée`,
    fileName: posterFileName(scenario),
    demo: i.demo,
  };
}

/** Texte intégral de l'affiche (bouton « Copier le texte de l'affiche », alternative accessible). */
export function posterPlainText(t: PosterText): string {
  return [
    t.demo ? 'DONNÉES FICTIVES - démonstration' : null,
    `STARWAY - ${t.title}`,
    `Temps de trajet : ${t.timeHeadline}`,
    t.subtitle,
    `${t.kicker} : ${t.sentence}`,
    ...t.cards.map((c) => `${c.value} ${c.caption}`),
    t.skyCaption,
    t.areaCaption,
    t.modeNote,
    `Sources : ${t.sources}`,
    t.url,
  ]
    .filter(Boolean)
    .join('\n');
}
