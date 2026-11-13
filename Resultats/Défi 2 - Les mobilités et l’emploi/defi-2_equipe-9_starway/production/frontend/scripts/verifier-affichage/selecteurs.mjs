/**
 * Contrôle de l'affichage : TOUS les sélecteurs du DOM et les réglages liés à l'interface, au même endroit.
 *
 * L'interface change (allègement, « Mes réglages », onglets de trajets, point de départ) : c'est le SEUL fichier à ajuster
 * après une mise en ligne. Chaque valeur est un sélecteur CSS ; les `data-testid` viennent en premier, la classe sert de repli
 * tant que la version avec `data-testid` n'est pas en ligne.
 * Les phrases attendues sont dans `textes.mjs`.
 */

export const STOCKAGE = {
  /** localStorage : abonnements (voir `subscriptionsStore`). Deux clés : `transit`, `velib` */
  abonnements: 'starway.subscriptions',
  /** localStorage : cases de « Ce qu'il me faut sur mon trajet » (liste JSON d'identifiants) */
  besoins: 'starway.needs.v3',
};

/** Paramètre d'URL du mode sources (D-033) : `src=1` activé, `src=0` coupé */
export const PARAM_SOURCES = 'src';

export const SEL = {
  /** Ciel */
  astre: '[data-testid="astre"], .pole-hit',
  compteur: '[data-testid="compteur-postes"], .counter-value',
  legendeCompteur: '.counter-caption',
  resumeCiel: 'p.sr-only[aria-live="polite"]',
  etiquetteCourte: '.pole-short',
  legendeBesoins: '.legend-needs',

  /** Panneau de preuve */
  preuve: '[data-testid="preuve"], .proof-panel',
  titre: '#proof-title',
  contexte: '.pf-context',
  badge: '.pf-badges .pf-badge',
  odSection: 'section.pf-section.pf-od',
  odPart: '.pf-stat',
  odLigne: '.pf-caption',
  odNotes: '.pf-src',
  temps: '.pf-times',
  tempsCellule: '.pf-legcell',
  tempsNom: '.pf-leg-name',
  tempsMinutes: '.pf-leg-min',
  tempsHeures: '.pf-leg-clock',
  tempsIndice: '.pf-leg-hint',
  tempsRaison: '.pf-leg-line',
  tempsManquant: '.pf-missing',
  /** D-066 : un seul bloc « Trajet » (bascule Aller / Retour) ; le détail du sens choisi est `.pf-transports`, sans titre */
  trajetBloc: '.pf-trip-block',
  trajetTitre: '.pf-label-row h3.pf-label',
  trajetSens: '.alt-dir-btn',
  trajetMeta: '.pf-trip-meta',
  trajetAR: '.pf-trip-rt',
  transports: '.pf-transports',
  transportsTitre: 'h3.pf-label',
  lignes: '.pf-lines > li',
  ligneTitre: 'strong',
  ligneHeures: '.pf-trip-time',
  ligneFaits: '.pf-lines-facts',
  troncons: '.pf-trip > li',
  tronconOu: '.pf-trip-where',
  itinManquant: '.pf-itin-missing',
  correspondances: '.tc-list > li:not(.tc-bound)',
  groupe: '.pf-group',
  groupeChiffre: '.pf-group-figure',
  /** D-066 : tuiles Coût et Carbone du sens affiché, dans le bloc « Trajet » */
  cout: '.pf-trip-block .pf-cost',
  coutLigne: '.pf-tile-value',
  carbone: '.pf-trip-block .pf-carbon .pf-tile-value',
  abonnements: '.pf-subs',
  /** Retirés avant de lire une phrase : bulles « i », boutons « Mes réglages » / « Modifier », lignes du mode sources */
  horsPhrase: '.info-tip, .subs-settings-btn, .prov-note, .pf-prov',
  voitureCout: '.pf-carcost',
  voitureLignes: '.pf-carcost-legs > li',
  voitureTrafic: '.pf-traffic-legs > li',
  communesLignes: '.pf-cc-table tbody tr',
  modesLignes: '.pf-modes-table tbody tr',
  modesCourant: '.pf-modes-cur',
  besoinsResume: '.pf-needs-summary',
  besoinsVerdict: '.pf-needs-verdict',
  provenance: '.pf-prov',
  fermerPreuve: 'button[aria-label="Fermer le panneau de preuve"]',

  /** Trajets alternatifs (`alternatives-1`, branche front/trajets-onglets : selecteurs à confirmer une fois en ligne) */
  alternatives: '.pf-trip-block',
  alternativesEtat: '.alt-state',
  alternativesOnglets: '.alt-tab',
};

/** Attribut `data-*` posés sur les boutons d'astre (ajoutés avec `data-testid`, repli sur `aria-label` tant qu'ils ne sont pas en ligne) */
export const ATTR_ASTRE = { id: 'data-pole-id', etat: 'data-etat' };

/**
 * Commutateur du contrôle de l'or du gain (décision D-056, branche `front/or-gain-commune`).
 * Actif depuis l'intégration du 10/11 : la correction fait partie du même groupe de fusion. `--or-gain=attente` le remet en attente
 * (rapporté à part, sans faire échouer le script) pour contrôler un site en ligne antérieur.
 */
export const OR_GAIN_ACTIF = true;
