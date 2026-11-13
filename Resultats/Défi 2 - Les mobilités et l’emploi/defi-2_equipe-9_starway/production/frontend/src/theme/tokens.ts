/**
 * Source unique des couleurs, durées et easings de STARWAY.
 * Grammaire visuelle : voir skill starway-context (un repère = une seule signification).
 */

export const color = {
  /** Fond du ciel */
  bg: '#080E20',
  /** Panneaux */
  panel: '#101B35',
  /** Texte principal */
  text: '#F4F6FF',
  /** Texte secondaire */
  textDim: '#A8B7D1',
  /** Pôle accessible aller ET retour dans le budget */
  accessible: '#9CEAFF',
  /** Pôle non accessible dans la contrainte (≠ « aucun transport ») */
  dim: '#50617F',
  /** Contour des états « hors budget », « aller seulement » et « non calculé » (5,65:1 sur le fond) */
  dimRing: '#7A8CAD',
  /** Perle : ciel neutre, aucun résultat affiché (= poleLook.neutralTint) */
  neutral: '#C9D3F5',
  /** Gain démontré d'un scénario complémentaire (réservé à l'acte 4) */
  gain: '#F5B86D',
  /** Accent d'interface (boutons, focus) - jamais une donnée */
  accent: '#B39BFF',
  /** Étoile-guide : repère chaud, distinct des pôles et de l'or du gain */
  guide: '#FFE6C7',
  /** Bandeau données fictives */
  demo: '#E5484D',
} as const;

/** Même palette en entiers 0xRRGGBB pour PixiJS. */
export const pixiColor = {
  bg: 0x080e20,
  accessible: 0x9ceaff,
  dim: 0x50617f,
  dimRing: 0x7a8cad,
  gain: 0xf5b86d,
  accent: 0xb39bff,
  guide: 0xffe6c7,
  white: 0xffffff,
} as const;

/**
 * Palette du halo « Derrière notre étoile » : SANS le cyan « accessible » ni l'or « gain »,
 * non genrée ; l'âge suit une rampe ordonnée (variable ordinale).
 */
export const haloPalette = {
  transit: '#C9B8FF',
  bike: '#9D86E8',
  walk: '#E6ECF8',
  car: '#7C8CB0',
  other: '#5F6C8E',
  sexA: '#E6ECF8',
  sexB: '#8C9AC0',
  age: ['#E6ECF8', '#C9D3F5', '#AEB8F2', '#9AA6FF', '#8C86E8', '#7C6CC9'],
  income: '#8E7FC2',
  track: '#2A3658',
} as const;

/**
 * Seconde orbite des pôles dorés (motion-spec, « Mode daltonien », renfort permanent, pour tous) :
 * rayon R + gap (R = rayon de l'orbite), trait de `width` px, couleur de l'or, alpha × gain × lumière.
 * Reste dans l'anneau de focus (R + 6, 2 px). « Un anneau de plus = un gain » : l'or n'est jamais
 * porté par la seule couleur.
 */
export const gainMark = { gap: 2.5, width: 1, alpha: 0.75 } as const;

/**
 * Marque « Ce qu'il me faut sur mon trajet » (D-034, version finale du 05/11/2026), V0 que Maia reprendra : un petit
 * losange creux posé au bord de l'astre, en haut à droite, dans un calque à part (aucun effet sur la position, la taille
 * ni la luminosité de l'astre). Forme + texte (légende, panneau, lecteur d'écran) : la couleur n'est jamais seule. Ni
 * cyan (« accessible ») ni or (« gain »). `size` : demi-diagonale (px) ; `gap` : écart au bord de l'anneau d'état ;
 * `angle` : direction depuis le centre de l'astre (degrés, 0 = droite, négatif = vers le haut) ; `halo` : liseré sombre
 * qui détache le losange du ciel.
 */
export const needsMark = { color: '#E6ECF8', halo: '#080E20', size: 4.5, gap: 3, width: 1.5, haloWidth: 3, angle: -45 } as const;

/**
 * Mode « couleurs adaptées au daltonisme » (motion-spec, « Mode daltonien ») : SEULES ces valeurs
 * changent ; le reste de la palette (fond, cyan, gris, blanc lunaire, étoile-guide) est identique.
 * Mesures (Machado 2009, minimum des trois simulations, tests `theme/palette.test.ts`) :
 * or ambre contre le cyan 1,59:1 de luminance (1,18:1 avec l'or normal), ΔE00 43 ; ambre sur le fond
 * 7,86:1, sur le panneau 6,99:1 ; carte : territoire accessible contre hors de portée 1,98:1 (1,21:1).
 */
export const colorCv = { gain: '#E8923A' } as const;
export const pixiColorCv = { gain: 0xe8923a } as const;
/**
 * Halo en mode daltonien : deux arcs voisins à 1,4:1 au moins dans les trois simulations (ordre TC, voiture, vélo,
 * marche, autre) : 1,73 ; 1,99 ; 3,28 ; 1,58 ; 1,43. La marche garde sa couleur normale. Le rouge de « autre » est
 * éclairci (#FF6B6B donnait 1,03:1 contre le violet TC).
 */
export const haloPaletteCv = { transit: '#9D6FFF', bike: '#7D5FFF', walk: '#E6ECF8', car: '#FFB84D', other: '#FF9999' } as const;
/** Carte miroir : territoire accessible (remplissage et trait), normal puis daltonien (miroir de features.css) */
export const mirrorFill = { accessibleFillOpacity: 0.16, accessibleStrokeOpacity: 0.7 } as const;
export const mirrorCv = { accessibleFillOpacity: 0.32, accessibleStrokeOpacity: 1 } as const;
/** Casing (outline) des territoires en mode OD (D-030) : liseré sombre en mode normal, ambre en mode daltonien */
export const mirrorCasingNormal = { casingColor: '#0b1226', casingAlpha: 0.75, casingWidth: 2.5 } as const;
export const mirrorCasingCv = { casingColor: '#ffc170', casingAlpha: 1.0, casingWidth: 2.5 } as const;

/**
 * Réglage « couleurs adaptées au daltonisme » (bouton de l'en-tête, comme le son) : préférence
 * personnelle, hors scénario. `?cv=1` / `?cv=0` priment pour la session sans être mémorisés ;
 * `?record=1` (vidéo) reste en palette normale sauf `?cv=1`. Coupé par défaut.
 */
export const colorVision = { storageKey: 'starway.cv', defaultOn: false } as const;

/** Durées (ms) et easings - motion-spec.md. */
export const motion = {
  instant: 120,
  ui: 280,
  light: 600,
  eclipse: 750,
  shooting: 900,
  stagger: 35,
  /** Transitions en mouvement réduit : fondus courts */
  reduced: 150,
  /** Ouverture */
  nebulaFadeIn: 1200,
  starsWaves: 1500,
  titleWordStagger: 80,
  guideBirth: 600,
  /** Compteur de postes */
  counter: 600,
  /**
   * Glisser de la jauge du budget : au plus une mise à jour du ciel par intervalle (ms), en fondu
   * court (`reduced`), sans décalage ni silence ; la transition complète joue au relâchement.
   */
  scrubThrottle: 100,
  /**
   * Visite, acte 1 (`budgetSweep`) : intervalle entre deux crans quand la jauge glisse du plus petit cran
   * jusqu'au budget de la visite (ms). Choix de mise en scène, à valider par la DA ; même mise à jour
   * légère que le glisser (fondu `reduced`), transition complète à l'arrivée.
   */
  budgetSweepStep: 150,
  /**
   * Table OD (D-019) : fondu enchaîné du cœur d'un astre éclairé en partie quand sa part change
   * (l'ancien cœur s'efface pendant que le nouveau apparaît, jamais une croissance). Mouvement
   * réduit : `reduced`. Choix de mise en scène, à valider par la DA.
   */
  partFade: 400,
  easing: {
    light: 'outExpo',
    eclipse: 'inOutSine',
    ui: 'outQuart',
    birth: 'outBack',
  },
  /** Équivalents CSS / Motion des easings anime.js */
  cssEasing: {
    ui: [0.25, 1, 0.5, 1] as [number, number, number, number], // outQuart
    light: [0.16, 1, 0.3, 1] as [number, number, number, number], // outExpo
    eclipse: [0.37, 0, 0.63, 1] as [number, number, number, number], // inOutSine (sortie du titre)
  },
} as const;

/** Ambiance continue (désactivée en mouvement réduit). */
export const ambient = {
  /** alpha × (1 − twinkleDepth + twinkleDepth·sin(ωt + φ)) */
  twinkleDepth: 0.15,
  twinkleOmegaMin: 0.3,
  twinkleOmegaMax: 1.2,
  /** Parallaxe max par plan (px) */
  parallax: { nebula: 2, far: 5, near: 12 },
  /** Dérive de la nébuleuse (px/s) */
  nebulaDrift: 1.5,
  /**
   * 0 : la tuile de poussière dessinait un quadrillage (faux repère), et la plaque v3 (IMG-17) a été
   * refusée (halos et points de plus d'un pixel). À 0, la texture n'est même pas téléchargée.
   */
  dustAlpha: 0,
  /**
   * Volutes v3 (IMG-16, lavande et argent, sans cyan) : alpha et teinte neutre.
   * Réglages proposés par la DA (chatgpt-images-v3.md, « Intégration prévue »), à valider sur capture.
   */
  wispsAlpha: 0.15,
  wispsTint: 0xffffff,
  /** Repli v1 ou procédural (contient du bleu-vert) : teinte qui éteint le cyan (réservé à « accessible ») */
  wispsTintLegacy: 0xa89ce0,
  /** Fond de nébuleuse v3 (IMG-15 / IMG-18, sans bleu-vert) : teinte neutre et opacité (DA, à valider sur capture) */
  deepTint: 0xffffff,
  deepAlpha: 0.9,
  /** Repli v1 ou procédural : teinte qui tire le bleu-vert vers l'ardoise lavande, et opacité (critique v0.4, P0-04) */
  deepTintLegacy: 0xb4aedc,
  deepAlphaLegacy: 0.82,
  /**
   * Fond portrait (IMG-18) quand la FENÊTRE est plus étroite que ce seuil (px) : même seuil que le
   * mobile (STACK_MAX_WIDTH, computeFrame). La fenêtre et non le volet : ouvrir le diptyque sur un
   * grand écran ne change pas le décor.
   */
  portraitBelow: 760,
  /** « Clairière » : assombrissement radial du décor derrière les pôles (jamais des données) */
  clearingAlpha: 0.62,
  /** Rayon de la clairière en fraction du côté du cadre du ciel */
  clearingRadius: 0.78,
  /** Nombre max d'étoiles de fond */
  maxStars: 3600,
  /** Étoiles de fond par mégapixel d'écran */
  starsPerMegapixel: 1500,
} as const;

/** Rendu des astres de données (seules lumière, couleur et opacité varient). */
export const poleLook = {
  /**
   * Quatre états lisibles sans la couleur :
   * neutre (plein, sans contour), accessible (plein cyan, trait plein), hors budget (plein, tirets),
   * non calculé (creux, points).
   */
  coreAlphaOff: 0.7,
  coreAlphaOn: 1,
  coreAlphaUnknown: 0.1,
  coreAlphaNeutral: 0.5,
  /** Perle : ciel posé, avant tout résultat (aucune matrice pour ce scénario) */
  neutralTint: 0xc9d3f5,
  ringOffWidth: 1.75,
  /** « Non calculé » (trou d'une matrice existante) : pointillé lisible */
  unknownDotPeriod: 6,
  unknownDotFill: 0.4,
  unknownDotWidth: 1.25,
  /** Orbite fine des pôles accessibles */
  ringOnAlpha: 0.75,
  /** Reflet identique pour tous les pôles allumés (dépend de l'état, jamais d'une valeur) */
  specularAlpha: 0.28,
  /** Longueur d'arc par tiret (px) : le nombre de tirets suit la circonférence */
  dashPeriod: 7,
  /** Lueur : rayon = r × glowScale (proportionnelle au rayon du disque) */
  glowScale: 3,
  glowAlphaOn: 0.4,
  /** Écart entre le disque et son contour (px) */
  ringGap: 4,
  ringWidth: 1.25,
  /**
   * Table OD (D-019), astre éclairé en partie : opacité du disque gris-bleu sous le cœur cyan
   * (= `coreAlphaOff`, l'état « hors de portée » du reste des postes) et du contour du reste.
   */
  partRestAlpha: 1,
} as const;

/** Carte miroir (spec a, critique v0.4) - lus par l'agent carte */
export const mirror = { flight: 750, territories: 450, labels: 120, discScale: 0.5, skyDecorAlpha: 0.25 } as const;

/**
 * D-030 (44 astres), jetons NOUVEAUX (aucune valeur de Maia modifiée), à régler par Maia.
 * relaxAll : relaxation de collision des 44 astres (sky/layout.ts, écart skyRelax.minGap). Avec false, on
 * retrouve le positionnement de la PR n° 19 (positions brutes, zoom automatique detectOverlapZoom).
 */
export const sky44 = { relaxAll: true } as const;

/**
 * D-030 : contour d'un astre sur la carte (table OD), tracé en deux couches pour rester lisible sur tous les fonds
 * (communes atteintes claires, hors de portée sombres, daltonien) : un liseré sombre sous un trait clair. Largeurs en
 * px écran (traits non mis à l'échelle par le zoom) ; opacités du clair (alpha) et du liseré (casingAlpha).
 * Les limites de communes font 1 px : le contour d'astre est nettement plus épais.
 */
export const mirrorAstre = { width: 1.5, casingWidth: 3.5, hoverExtra: 1, alpha: 0.95, casingAlpha: 0.75, casingColor: '#0b1226' } as const;

/** Étoile filante (spec f) */
export const shooting = {
  leg: 750,
  pause: 150,
  curve: 0.18,
  tailFraction: 0.28,
  traceAlpha: 0.35,
  /** Points de la queue */
  tailPoints: 18,
  /** Épaisseur de la queue à la tête (px écran), 0 au bout */
  tailWidth: 3,
  /** Taille apparente de la tête (px écran) */
  headPx: 14,
  /** Blanc lunaire #F4F6FF : la filante est un trajet, pas un état (le cyan reste au pôle) */
  color: 0xf4f6ff,
  /** Dissipation de la queue quand un sens échoue (ms) */
  failFade: 400,
} as const;

/** Silence (spec f) */
export const silence = {
  freezeIn: 300,
  hold: 600,
  release: 600,
  dimAlpha: 0.35,
  dimRadius: 2.2,
  /** Atténuation locale autour d'un pôle perdu : alpha 0 → dimAlpha → 0 (ms) */
  dimDuration: 600,
} as const;

export const eclipse = {
  /** Opacité du voile (texture IA) */
  veilAlpha: 0.45,
  /** Opacité du voile procédural (plus sombre : il doit se lire sur fond sombre) */
  fallbackVeilAlpha: 0.7,
  /** Largeur du voile en fraction de l'écran */
  veilWidth: 0.45,
  /** Immobilité après le passage du voile, avant la phrase suivante (ms) */
  holdAfter: 900,
} as const;

/** Mise en page du ciel (px). Le ciel est le même pour tous : seule la marge s'adapte à l'écran. */
export const skyLayout = {
  marginTop: 104,
  marginBottom: 190,
  marginSide: 0.07,
  /** Rayon max d'un pôle, en fraction du plus petit côté du cadre */
  maxPoleRadius: 0.05,
  minPoleRadius: 4,
  /** Rayon des étoiles de fond : toujours plus petit que le plus petit pôle */
  maxStarRadius: 1.6,
  /** Taille de l'étoile-guide, en fraction du plus petit côté du cadre (n'encode rien) */
  guideSize: 0.042,
  /**
   * Socle de l'étoile-guide (retour de Nicolas du 03/11 : sur un astre allumé, Paris 8e sous Paris
   * Centre-est, l'éclat additif se fondait dans le disque cyan et seul le nom restait) : disque couleur
   * fond sous l'éclat, rayon en fraction de la taille de l'étoile-guide, et son opacité. Ne recouvre
   * que la place de l'étoile, jamais le contour d'état du pôle en entier.
   */
  guideSocket: 0.58,
  guideSocketAlpha: 0.82,
  /** Marge autour de l'emprise des données (unités sky) */
  boundsPad: 0.03,
} as const;

/** Une seule famille : Jost (OFL), comme le logo et la slide. Chiffres en tabulaires (tnum). */
export const font = {
  sans: "'Jost Variable', 'Jost', system-ui, sans-serif",
} as const;

/** Échelle typographique (miroir en variables CSS). Light 300 seulement à partir de 24 px ; plancher 12 px. */
export const type = {
  display: { size: 'clamp(40px, 5.2vw, 84px)', weight: 300, tracking: '-0.01em' },
  stat: { size: 'clamp(34px, 3.2vw, 52px)', weight: 300 },
  h2: { size: '22px', weight: 400 },
  body: { size: '15px', weight: 400 },
  small: { size: '13px', weight: 400 },
  label: { size: '12px', weight: 500, tracking: '0.16em', caps: true },
} as const;

/** Échelle d'espacement (px) */
export const space = [4, 8, 12, 16, 24, 32, 48, 64] as const;

/**
 * Logo de l'écran titre qui se verrouille (motion-spec, « Le logo se verrouille ») : c'est ici qu'on le règle.
 * Durées en ms ; distances en unités du logo (viewBox 1978 x 420), sauf mention « px ». Aucune donnée : décor de marque.
 */
export const logoReveal = {
  /** Couleurs du logo officiel (public/assets/img/starway-logo.svg), rien d'autre */
  color: { gold: '#F5B86D', lunar: '#EEF1EC', cyan: '#9CEAFF', word: '#F4F6FF', white: '#FFFFFF' },

  /** Scène d'ouverture : part de la largeur de fenêtre, largeur maximale (px) et part de la zone libre au-dessus des boutons */
  sceneWidth: 0.82,
  sceneMaxWidth: 1040,
  sceneHeight: 0.8,
  /** Marge (px) réservée en haut de la zone libre, sous les boutons d'outils */
  sceneTop: 56,
  /** Les boutons apparaissent dès l'ouverture : rien de cliquable n'est invisible */
  actionsAt: 200,

  /** Verrouillage de l'étoile dorée, puis durée de chaque saut de la comète, de plus en plus court */
  ignite: 560,
  segments: [640, 490, 380, 280],
  /** Étoiles en attente : opacité et taille */
  dormantOpacity: 0.2,
  dormantScale: 0.6,
  /** Réticule de l'étoile-guide du ciel : se referme sur l'étoile, puis reste jusqu'au point final */
  lockApproach: 340,
  lockHold: 460,
  lockPeak: 1.42,
  reticleFrom: 1.9,
  reticleTo: 1.16,
  reticleTurn: 90,
  reticleSnap: 0.1,
  reticleSnapTime: 130,
  reticleOut: 1.3,
  /** Épaisseur du réticule (px à l'écran, quelle que soit la taille du logo) */
  reticleStroke: 2.5,
  /** Onde et éclair de chaque verrouillage, en multiples de la taille de l'étoile */
  rippleFrom: 0.7,
  rippleTo: 2.5,
  rippleStroke: 3.5,
  flashSize: 2.3,
  /** Retour d'énergie le long du M après le point final */
  echo: 460,
  echoStagger: 70,
  echoScale: 0.18,

  /** Comète : largeur et halo de la tête, longueur de la queue (échantillons x pas de temps) */
  cometWidth: 16,
  cometGlow: 62,
  cometCore: 9,
  trailSamples: 16,
  trailStep: 15,
  /** Courbure de l'accélération sur chaque saut */
  cometEase: 1.25,

  /** Onde du point final */
  shock: 1100,
  shockFrom: 30,
  shockRadius: 900,
  shockStroke: 15,
  shockOpacity: 0.85,

  /** Temps sur le symbole grand une fois tout verrouillé, puis recul de la caméra */
  finalHold: 300,
  camera: 1100,
  /** Rejeu (clic sur le logo) : le logo revient au centre, le titre s'efface le temps de la scène */
  cameraIn: 460,

  /** Le mot naît pendant le recul, lettre par lettre, encore sombre ; la lumière le révèle */
  letterDelay: 380,
  letterStagger: 70,
  letterDuration: 460,
  letterShift: 34,
  letterDim: 0.4,
  /** Pas moyen entre deux lettres et front de la lumière */
  letterPitch: 165,
  sweepSoftness: 130,
  sweepDelay: 800,
  sweep: 900,
  sweepWidth: 220,
  sweepFrom: 700,
  sweepTravel: 1360,
  sweepGlowRadius: 170,
  sweepGlowOpacity: 0.34,
  /** Le titre commence ici, compté depuis le début du recul */
  titleAfterPull: 900,

  /** Clic sur « Explorer le ciel » : la comète file sur le M, le logo s'avance un peu */
  sprint: 620,
  sprintZoom: 1.28,
  sprintStar: 0.45,
  sprintStroke: 7,
  /** Le logo reste avancé le temps que le titre se retire, puis revient s'il n'y a pas eu de révélation */
  sprintHold: 600,
  sprintBack: 300,

  /** Au repos : passage discret de la comète (le reste du temps, plus aucune écriture sur le DOM) */
  idleEvery: 11000,
  idleRun: 1500,
  /** Décalage au mouvement de la souris (px à l'écran) : au repos, et sur le symbole grand */
  parallaxRest: 3.5,
  parallaxScene: 11,
  parallaxFollow: 0.07,
  parallaxDepth: [0.6, 1, 0.75, 1.2, 0.9],
  /** Survol d'une étoile : portée, grossissement, vitesse de réaction */
  hoverRadius: 40,
  hoverScale: 0.22,
  hoverFollow: 0.16,
  /** Sous ce seuil, plus rien ne bouge : la boucle s'arrête */
  settleEpsilon: 0.002,
} as const;

/** Acte 0 : écran titre et révélation du ciel (motion-spec, « la mise au point », D-021) */
export const reveal = {
  /** A. sortie du titre (ms), déplacement (px) et flou (px) */
  titleOut: 400,
  titleOutY: 16,
  titleOutBlur: 6,
  /** B. début de la pose (ms après le clic) : chevauche la fin de la sortie du titre */
  poseAt: 250,
  /** B. apparition d'un astre (ms, outExpo) */
  poleAppear: 600,
  /** B. décalage entre deux astres (ms), plafonné par poseWindow / (N - 1) */
  poleStagger: 40,
  /** B. fenêtre maximale des départs (ms), quel que soit le nombre de pôles */
  poseWindow: 560,
  /** B. flou initial du calque des données (BlurFilter.strength) et durée de la mise au point (ms, outQuart) */
  focusBlur: 8,
  focusDuration: 900,
  /** Décor au titre : échelle autour du centre de l'écran, ramenée à 1 pendant la pose (ms, outQuart) */
  decorDolly: 1.04,
  decorDollyDuration: 1400,
  /** Noms des pôles et de l'étoile-guide (ms) */
  labelsFade: 280,
  /** Respiration entre deux temps (ms) */
  beat: 100,
  /** E. immobilité avant les cartes secondaires (ms) */
  quietAfter: 600,
  /** Lien partagé : fondu du décor et début de la pose (ms) */
  sharedDecorFade: 800,
  sharedPoseAt: 400,
  /** Retour au titre : interface (ms), ciel (ms), début du titre (ms) */
  backUi: 280,
  backSky: 400,
  backTitleAt: 400,
} as const;

/**
 * Son (motion-spec, « Son », D-026) : second rendu de la même vue, jamais seul porteur d'une
 * information. Synthétisé en code (Web Audio), aucun fichier. Niveaux en dB relatifs au bus maître,
 * fréquences en Hz, durées en ms. Les durées synchronisées avec l'image sont lues dans `motion`,
 * `reveal`, `shooting`, `silence` et `mirror` (aucune n'est écrite deux fois) ; le reste est un
 * réglage d'écoute, à accorder à l'oreille (DA).
 */
export const sound = {
  storageKey: 'starway.sound',
  /** Son activé après le premier geste si l'utilisateur ne l'a jamais coupé (à valider par Nicolas) */
  defaultOn: true,
  /**
   * Voix de la visite (MP3 de tools/tour-tts) : contrôle « Voix » propre, dans la barre de la visite.
   * Le bouton son ne la coupe pas : elle porte le récit (doublé par les sous-titres, toujours affichés).
   * Hors du graphe Web Audio (élément <audio>), donc hors du bus maître et du compresseur.
   */
  voice: { storageKey: 'starway.voice', defaultOn: true },
  master: 0.35,
  /** Coupure ou remise du son (bouton) : rampe du bus maître */
  toggleRamp: 300,
  compressor: { threshold: -18, knee: 6, ratio: 4, attack: 0.005, release: 0.25 },
  /** Réverbération : réponse générée (bruit blanc stéréo × décroissance exponentielle) */
  reverb: { seconds: 3.2, preDelay: 0.02, send: 0.28, decayPower: 3 },
  /** Ré majeur pentatonique, D4 à A5 : gamme commune à tous les sons tonals */
  scale: [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.26, 739.99, 880],
  /** Panoramique maximal d'un son placé sur un astre (x à l'écran) */
  pan: 0.6,
  /** Avance de programmation des sons (ms) */
  lookahead: 10,
  bed: {
    level: -30,
    root: 73.42,
    fifth: 110,
    detuneCents: 4,
    /** Bruit filtré : niveau relatif aux sinus (dB) */
    noiseLevel: -12,
    noiseLowpass: 1000,
    noiseBand: 700,
    noiseQ: 0.6,
    noiseSeconds: 6,
    lowpass: 420,
    lfoHz: 0.04,
    lfoDepth: 160,
    fadeIn: 2400,
    fadeOut: 800,
    send: 0.5,
    /** « Oculaire » : passe-bas du fond, ouvert dans l'explorateur, fermé sur l'écran titre */
    focusOpen: 2400,
    focusClosed: 300,
  },
  tourDuck: { gain: 0.25, attack: 300, release: 1200 },
  /** Fond pendant le silence : gain × silenceDuck (durées : `silence`) */
  silenceDuck: 0.2,
  /** Bruitages coupés quand la narration de la visite démarre (ms) */
  narrationMute: 120,
  /** A. titre qui se retire : souffle (durée : `reveal.titleOut`) */
  titleOut: { level: -30, q: 1, fromHz: 400, toHz: 1600 },
  /** B. le ciel se pose : D4, A4, E5 derrière un passe-bas qui s'ouvre (tenue : `reveal.focusDuration`) */
  focus: { level: -36, notes: [293.66, 440, 659.26], attack: 250, release: 600, fromHz: 300, toHz: 2400 },
  /** C. naissance de l'étoile-guide : cloche chaude (D4) */
  guide: { level: -22, freq: 293.66, attack: 8, decay: 1400 },
  /** D. allumage : une note par pôle allumé, dans l'ordre d'allumage (décalage : `motion.stagger`) */
  pluck: { level: -30, attack: 4, decay: 500, maxNotes: 9, octaveLevel: -10, chord: [293.66, 440, 587.33] },
  /** Silence : une glissade descendante A4 → D4 (durée : `silence.dimDuration`) */
  lost: { level: -30, fromHz: 440, toHz: 293.66, lowpass: 1200 },
  /** Jauge : tic, au plus un par `motion.scrubThrottle` ; tic double et plus doux sur un repère */
  tick: { level: -36, lowHz: 1200, spanHz: 1200, q: 6, noiseMs: 6, toneMs: 15, toneLevel: -6, markGapMs: 45, markLevel: -42 },
  /** Éclipse : souffle en passe-bande (durée : `motion.eclipse`), panoramique dans le sens du voile */
  eclipse: { level: -26, fromHz: 900, toHz: 350, q: 1.2, pan: 0.8 },
  /** Étoile filante : souffle sifflé (durées : `shooting.leg`, `shooting.pause`, `shooting.failFade`) */
  shooting: { level: -30, lowHz: 900, highHz: 2200, q: 6, toneHz: 880, toneLevel: -40 },
  /** Or du gain : carillon D5 + A5 et triangle à l'octave, timbre réservé à l'or (décalage : celui de l'or) */
  gain: { level: -24, notes: [587.33, 880], octaveLevel: -18, attack: 6, decay: 1800, maxNotes: 6, send: 0.45 },
  /** Carte miroir : glissade grave (durée : `mirror.flight`), D3 → A2 à l'aller, l'inverse au retour */
  mirror: { level: -30, highHz: 146.83, lowHz: 110, noiseLowpass: 500, noiseLevel: -10 },
  /**
   * Halo : nappe frottée A3 + E4, tenue jusqu'à la fin des arcs. Pousse et décalage des arcs : mêmes
   * valeurs que l'astrolabe (motion-spec, Halo v2 ; écrites en dur dans SkyEngine.setHalo pour l'instant)
   */
  halo: { level: -32, notes: [220, 329.63], attack: 300, release: 500, arcGrow: 700, arcStagger: 80 },
  /** Panneau de preuve : effleurement de bruit en passe-haut */
  proof: { level: -36, highpass: 2500, duration: 90 },
  /**
   * Comparaison : un sinus qui se dédouble vers ± spread, la seconde voix glisse à la quinte. Durée de
   * la descente du séparateur : 500 ms (écrite en dur dans Diptych.tsx pour l'instant)
   */
  compare: { level: -28, root: 293.66, fifth: 440, spread: 0.7, glide: 500, release: 600 },
  /**
   * Logo de l'écran titre (motion-spec, « Le logo se verrouille », § Son) : niveaux en dB sous le bus maître, durées en ms,
   * hauteurs prises dans la gamme commune. Timbres entièrement synthétisés. Durées de la scène : `logoReveal`.
   */
  logo: {
    /** Étoile dorée : cloche chaude, de la famille de la naissance de l'étoile-guide */
    ignite: { level: -22, freq: 293.66, attack: 10, decay: 1500, send: 0.4 },
    /** Comète : un souffle par saut, plus aigu et plus fort à chaque fois ; une note tenue qui monte sans s'interrompre */
    comet: { level: -36, levelStep: 2, fromHz: 700, hzRatio: 1.45, q: 3.5, send: 0.2, rise: [146.83, 220, 293.66, 440, 587.33], riseLevel: -38, riseLevelStep: 2.5, riseRelease: 40 },
    /** Verrouillage : claquement de bruit très court et note qui monte d'étoile en étoile (D5, E5, F#5, A5) */
    lock: { level: -25, notes: [587.33, 659.26, 739.99, 880], attack: 2, decay: 260, clickLevel: -28, clickHz: 3200, clickQ: 2, clickMs: 18, thudHz: 110, thudLevel: -24, thudDecay: 70, send: 0.25 },
    /** Point final : chute grave, puis l'onde (souffle qui descend, sur la durée de `logoReveal.shock`) */
    impact: { level: -20, fromHz: 146.83, toHz: 73.42, glide: 500, attack: 4, decay: 1300, waveLevel: -30, waveFromHz: 1400, waveToHz: 180, waveQ: 0.8, send: 0.5 },
    /** Mot : accord qui s'ouvre pendant que les lettres naissent ; la lumière passe de gauche à droite */
    word: { level: -33, notes: [293.66, 440, 587.33], attack: 300, release: 900, fromHz: 400, toHz: 3000, send: 0.45 },
    sweep: { level: -40, fromHz: 3000, toHz: 7000, q: 1.5, pan: 0.5 },
    /** Survol d'une étoile : à peine audible, et jamais plus d'un toutes les `minGapMs` */
    hover: { level: -44, attack: 3, decay: 160, minGapMs: 220, notes: [293.66, 587.33, 659.26, 739.99, 880] },
    /** Clic pour rejouer : retour en arrière, le temps que le logo revienne au centre */
    replay: { level: -34, fromHz: 659.26, toHz: 293.66, attack: 20, send: 0.3 },
    /** Sprint : montée d'une seule traite, conclue sur le dernier verrouillage ; la révélation prend le relais */
    sprint: { level: -32, fromHz: 220, toHz: 880, noiseLevel: -36, noiseFromHz: 700, noiseToHz: 2600, q: 2.5, panFrom: -0.5, panTo: 0.5 },
    /** Retour au titre : deux notes qui descendent et se referment, quand le titre revient */
    back: { level: -32, notes: [587.33, 440], gapMs: 140, attack: 8, decay: 900, send: 0.4 },
    /** Coupure de la scène (Échap, son coupé, sortie du titre) */
    stopFade: 120,
    /** On n'accroche que les sons qui partent dans au moins cette marge : jamais de son déjà commencé ni de rattrapage */
    joinMargin: 40,
  },
  /** Mouvement réduit : bruitages de 150 ms (`motion.reduced`), attaque 5 ms, sans balayage ni arpège */
  reducedAttack: 5,
} as const;

/* ------------------------------------------------------------------------------------------------
 * Refonte DA v0.6 (D-026, docs/critique-visuelle-v0.6.md, motion-spec « Ajouts v0.6 »).
 * Mise en page et mouvement seulement : aucune de ces valeurs n'encode une donnée.
 * ---------------------------------------------------------------------------------------------- */

/** Nom de l'étoile-guide (L-02) : collé, prioritaire ; repli ultime à distance avec trait renforcé */
export const guideLabel = {
  /** Écart entre l'étoile et son nom (px) */
  near: 8,
  /** Repli ultime : distance du nom (px), trait de rappel 1,5 px et point de 2 px côté étoile */
  far: 44,
  /** Orbite du halo dans le ciel : rayon = orbitFactor × taille de l'étoile-guide (zone réservée des noms) */
  orbitFactor: 2.2,
  /** Visite : hauteur réservée sous le nom pour le prénom fictif du personnage (`TourScript.persona`, px) */
  personaPx: 16,
} as const;

/** Orbite du halo v2 (L-08) : cercle sans donnée autour de l'étoile-guide, « ce panneau parle d'elle » */
export const haloOrbit = {
  color: 0xb39bff,
  alpha: 0.35,
  width: 1,
  /** Naissance (ms, outQuart) = motion.ui */
  appear: 280,
} as const;

/** Jauge du temps de trajet, poignée « comète » (L-05) : blanc lunaire, jamais cyan ni or */
export const comet = {
  /**
   * Largeur de la piste (px, miroir de styles.css) : 220 px à partir de 1 440 px ; 184 px de 761 à
   * 1 439 px (écart à la spec, qui dit 220 dès 1 280 : à 1 280 px la barre tient sur une ligne avec
   * 184 px, pas avec 220) ; toute la largeur de la feuille sur mobile.
   */
  trackWide: 220,
  trackNarrow: 184,
  wideFrom: 1440,
  /** Rayons (px, viewBox de la comète) : lueur au repos / survol / glisser (la tête est l'étoile, `starBox`) */
  glow: 8,
  glowHover: 10,
  glowDrag: 11,
  glowAlpha: 0.35,
  glowAlphaHover: 0.5,
  /** Glisser : étirement horizontal de la queue seule (la tête ne change jamais de taille) */
  tailStretch: 1.25,
  /** Mobile (doigt) : lueur (toute la comète est agrandie de 1,33) */
  glowTouch: 12,
  /** Zone de frappe du curseur natif (px) : bureau, doigt */
  thumb: 18,
  thumbTouch: 44,
  /**
   * Tête « étoile qui vieillit » (IMG-20, `star-age-1` à `6`, 128 px, même échelle pour les 6) :
   * côté de la boîte d'affichage (px) au bureau et au doigt. À 40 px, la naissante fait environ
   * 16 px, la géante 32 px, la braise 6 px.
   */
  starBox: 40,
  starBoxTouch: 48,
  /** Anneau de focus clavier autour de l'étoile (rayon, px du viewBox) : entoure la géante, plus grand stade */
  starFocus: 17,
  /**
   * Cœur lunaire `#F4F6FF` (px) sous l'étoile : la poignée ne disparaît jamais, même braise.
   * Son opacité suit en continu le poids des deux derniers stades (aucun seuil), plafonnée à `coreAlpha`.
   */
  core: 3,
  coreAlpha: 0.7,
} as const;

/** Halo v2 « astrolabe » (L-08, L-11) : SVG dans le panneau, d3-shape */
export const astrolabe = {
  /** Côté du SVG (px) : seul, et en comparaison A/B (même échelle relative) */
  size: 260,
  sizeCompare: 150,
  /** Anneau (px, pour size = 260 ; proportionnel en A/B) */
  inner: 92,
  outer: 104,
  /** Graduations tous les 10 %, plus longues à 25, 50 et 75 % */
  tickStep: 0.1,
  majorTicks: [0.25, 0.5, 0.75],
  tick: 4,
  tickMajor: 8,
  cornerRadius: 3,
  padAngle: 0.02,
  /** Écart entre l'anneau et les noms posés autour (px) */
  labelGap: 14,
  /** Arcs qui poussent (ms, outQuart), décalage entre arcs, rétraction au changement d'onglet, fondu des noms */
  grow: 700,
  stagger: 80,
  retract: 280,
  labelFade: 120,
} as const;

/** Constellation en lignes des modes par sexe (L-09) : points qui glissent de 0 à leur valeur */
export const dotPlot = {
  glide: 600,
  stagger: 60,
  /** Estimation imprécise : contour pointillé à 50 % */
  impreciseAlpha: 0.5,
} as const;

/** Découvertes qui jouent leur moment (L-03) : ciel de référence tenu avant l'effet (ms) */
export const insightPlay = {
  referenceHold: 600,
} as const;

/**
 * Poussière cosmique en code (L-25, IMG-19 refusée) : points de 1 px au plus, tirage à graine fixe
 * (identique à chaque visite), fusion additive, sans scintillement. Décor : n'encode rien.
 */
export const dust = {
  count: 1500,
  alphaMin: 0.05,
  alphaMax: 0.15,
  /** Rayon des points (px) : 0,5 = disque de 1 px de diamètre */
  radius: 0.5,
  seed: 20261113,
  /** Teinte lavande pâle (aucun cyan) */
  tint: 0xd8d4f0,
  /** Surface de référence (px²) pour `count` : moins de points sur un écran plus petit, densité constante */
  referenceArea: 1920 * 1080,
  /** Budget total des points de fond (étoiles + poussière), skill starway-sky-ui § Performance */
  spriteBudget: 4000,
} as const;

/**
 * Relaxation fixe des trois pôles de Paris (L-23, validée par Nicolas le 03/11, D-026) : leurs disques
 * et leurs lueurs fusionnaient en une tache. Une seule relaxation de collision, calculée dans la mise en
 * page du ciel (sky/layout.ts) depuis poles.json et le cadre : identique dans tous les scénarios,
 * toutes les communes et les deux volets du diptyque. Seuls ces pôles bougent, de quelques pixels.
 */
export const skyRelax = {
  poles: ['P_PARIS_QCA', 'P_PARIS_RG', 'P_PARIS_EST'] as readonly string[],
  /** Écart minimal entre deux contours d'état (orbite de contour comprise), px écran */
  minGap: 4,
  iterations: 60,
} as const;

/**
 * Bande « Niveau de vie » du halo (IncomeRanks) : opacité des points des communes. 0,6 donne
 * #6B7993 sur le panneau, 3,89:1 (élément graphique ≥ 3:1, WCAG 1.4.11 ; audit du 03/11, point 9).
 */
export const incomeStrip = { dotOpacity: 0.6 } as const;

/**
 * Repères de territoire (D-048, ajout seulement) : géométrie, en unités du `viewBox`, de la bande des 15 zones d'emploi (même dessin que
 * « Niveau de vie » : points en `color.textDim`, repère en `color.guide`) et de la courbe d'évolution d'une zone. Jamais cyan ni or : le
 * chômage n'est ni « accessible » ni un gain.
 * - `width` : largeur du viewBox ; `pad` : marge gauche et droite ; `stripH` : hauteur de la bande ; `bandTop` et `bandH` : position et hauteur de la
 *   zone des points ; `dotR` : rayon d'un point ; `dotHitR` : rayon de la zone de survol d'un point ; `markR` : rayon du point du repère ;
 * - courbe : `trendH` : hauteur ; `trendTop` : marge haute ; `trendBase` : ordonnée de l'axe (taux 0) ; `trendEndPx` : place réservée à droite pour
 *   écrire le dernier taux ; `lineW` : trait de la courbe ; `endR` : rayon du point du dernier trimestre (creux quand il est provisoire).
 */
export const territoireChart = { width: 320, pad: 10, stripH: 62, bandTop: 14, bandH: 22, dotR: 3.2, dotHitR: 8, markR: 4.5, trendH: 84, trendTop: 8, trendBase: 66, trendEndPx: 34, lineW: 2, endR: 3.5 } as const;

/**
 * Mode « provenance des données » (motion-spec, section « Affichage », partie B ; demande de Nicolas
 * du 03/11) : bouton de la barre du haut, comme le son. Préférence personnelle, hors scénario : jamais
 * dans l'URL écrite par state/url.ts. `?src=1` / `?src=0` priment pour la session sans être mémorisés.
 * Coupé par défaut : le bouton l'active (à valider par Nicolas, la spec DA recommandait activé).
 */
export const provenance = { storageKey: 'starway.provenance', defaultOn: false } as const;

/**
 * Bouton « Horaires libres… » de la barre de scénario (D-019, demande de Nicolas du 05/11 : « je ne
 * l'avais pas trouvé »). Une pastille à contour accent (jamais une donnée), icône d'horloge, sur la
 * deuxième ligne réservée de la cellule (24 px : la hauteur de la barre ne change pas). Miroir CSS :
 * variables `--shift-toggle-*` de components/shiftPicker.css. Alphas : fond de l'accent (#B39BFF) ;
 * le contour reste l'accent plein (contraste > 3:1 sur le panneau, WCAG 1.4.11).
 */
export const shiftToggle = { height: 24, fillAlpha: 0.14, hoverFillAlpha: 0.26, iconSize: 14 } as const;

/**
 * Noms du ciel sous les éléments d'interface (arbitrage de Nicolas du 05/11, mobile 390 px). Les boutons de zoom,
 * la barre du haut et la légende sont des zones réservées (store/overlayRects.ts) : un nom posé dessous est repris
 * (data/labelZones.ts), les autres ne bougent pas. Ajout seulement : aucune valeur existante ne change.
 */
export const skyChrome = {
  /**
   * Un nom qui était posé et ne trouve plus de place dans les 8 directions à la portée de ses traits de rappel (44 px,
   * 88, 132) est cherché sur tout le volet, de proche en proche : pas de la grille de recherche (px). Sans cela,
   * un nom serait perdu au lieu d'être déplacé.
   */
  searchStep: 4,
} as const;

/**
 * Repère de bord de l'étoile-guide (.guide-edge, styles.css) : commune hors champ ou collée au bord. Miroir de ses
 * dimensions CSS pour le garder entier dans le volet : police 12 px, largeur d'un caractère 0,55 em (Jost, comme
 * les noms du ciel), enveloppe = marges de 10 px de chaque côté + icône de 12 px + écart de 4 px + bordure de 1 px
 * de chaque côté = 38 px ; `minHeight` : hauteur minimale de la cible (44 px) ; `margin` : écart minimal au bord du volet (px).
 */
export const guideEdge = { fontPx: 12, charEm: 0.55, chromePx: 38, minHeight: 44, margin: 4 } as const;
/**
 * Sous-titres de la visite et de la vidéo (05/11, demande de Nicolas : « ni trop petits ni trop grands » à 1920, 1280 et
 * 390 px). JETON RÉGLABLE par Maia : `TourOverlay` le publie en variables CSS (`--tour-sub-*`), `styles.css` les lit
 * (valeurs de repli = celles d'avant ce jeton), `tour/subtitleSize.ts` en tire la taille calculée et le test
 * `subtitleSize.test.ts` vérifie les bornes de lisibilité et que la plus longue cue tient dans `maxLines` lignes.
 * - interface : taille = clamp(fontMinPx, fontVw % de la largeur, fontMaxPx) ; sous `mobileMaxWidth` px : `mobilePx` ;
 * - vidéo (`?record=1`) : clamp(recordMinPx, recordVw %, recordMaxPx), plus grande (1920 x 1080 vue de loin) ;
 * - `maxLines` : au-delà, le texte serait COUPÉ (line-clamp), jamais autorisé ;
 * - `avgCharEm` : largeur moyenne d'un caractère en em, avec 10 % de marge pour les retours à la ligne ; MESURÉ dans Chromium
 *   (`scripts/measure-subtitles.mjs`, police du site) : 0,454 em (83 caractères sur deux lignes à 390 px, 320 px de texte) ;
 * - `readableMinPx` / `readableMaxPx` : bornes de lisibilité vérifiées par le test (à ajuster avec le regard de Maia).
 */
export const tourSubtitle = {
  fontMinPx: 18,
  fontVw: 1.6,
  fontMaxPx: 24,
  mobileMaxWidth: 430,
  mobilePx: 17,
  recordMinPx: 22,
  recordVw: 1.9,
  recordMaxPx: 30,
  maxLines: 2,
  avgCharEm: 0.5,
  readableMinPx: 16,
  readableMaxPx: 32,
} as const;

/**
 * Repères visuels de la visite (retour de Cyril du 10/11, `tour/marks.ts`, `components/TourMarks.tsx`) : l'élément dont parle
 * la voix est entouré, au moment où elle en parle. Couleur : l'ACCENT d'interface (jamais le cyan « accessible », qui est une
 * donnée, ni l'or réservé au gain), comme le soulignement `proofFocus` déjà en place. Réglable par Maia.
 * - `strokePx` / `glowPx` : trait du cadre ou de l'anneau et sa lueur (flou du trait large, `glowAlpha`) ;
 * - `padPx` / `cornerPx` : marge du cadre autour de l'élément et arrondi ; `ringGapPx` : écart entre l'astre et son anneau ;
 * - `litStrokePx` : anneaux plus fins pour « les astres allumés » (plusieurs à la fois) ;
 * - `inMs` : entrée douce (fondu et léger resserrement depuis `inScale`, `motion.cssEasing.ui`) ; mouvement réduit : fondu
 *   `motion.reduced`, sans resserrement ;
 * - `veilAlpha` : voile couleur fond posé sur le RESTE DE L'INTERFACE (barre, panneaux, légende), jamais sur le ciel : les
 *   étoiles qui s'allument restent visibles. Pas de voile sous `phoneMaxWidth` px (téléphone) : le repère seul.
 */
export const tourMark = {
  color: color.accent,
  strokePx: 2,
  glowPx: 7,
  glowAlpha: 0.35,
  padPx: 6,
  cornerPx: 10,
  ringGapPx: 6,
  litStrokePx: 1.5,
  inMs: 360,
  inScale: 1.12,
  veilAlpha: 0.5,
  phoneMaxWidth: 430,
  /**
   * Mode épuré (pendant la visite seulement) : opacité des réglages et boutons que la visite n'utilise pas (bouton du tiroir,
   * « i » de la barre, menu du haut, zoom, plis non commentés du panneau). Pleine opacité au survol et au focus clavier.
   */
  calmOpacity: 0.32,
} as const;

/**
 * Taille minimale d'une cible interactive à la souris (WCAG 2.5.8, niveau AA : 24 x 24 px CSS, mesurée sur la boîte
 * de l'élément, pas sur un pseudo-élément). Ajout seulement : aucune valeur existante ne change. Miroir CSS :
 * `--target-min` (`:root` de styles.css), utilisé par la bande de provenance du ciel (skyCredit.css) et le « i » du
 * compteur (styles.css). La taille visuelle ne change pas : la boîte grandit, une marge négative rend à la mise en
 * page l'espace d'origine. Contrôle : `node scripts/targets.mjs` et `targetSize.test.ts`.
 */
export const targetSize = { minPx: 24 } as const;

/**
 * Barre de scénario compacte (chantier C, lot 2, D-049) : UNE ligne sur ordinateur, hauteur fixe pour tous les
 * scénarios et tous les modes (le cadre du ciel ne dépend jamais du scénario, D-021). Le tiroir s'ouvre par-dessus
 * le ciel et ne change jamais cette hauteur. Miroir CSS : `--bar-row-h`, `--bar-pad-y`, `--bar-control-h`,
 * `--bar-drawer-max-w` (`:root` de styles.css) ; contrôle : `scenarioBar.test.ts`.
 * - `rowPx` : hauteur du contenu de la ligne (le compteur et la note du mode y tiennent sur trois lignes de 12 px) ;
 * - `padYPx` : marge haute et basse de la barre ;
 * - `controlPx` : hauteur des champs et du segment des journées-types ;
 * - `drawerMaxPx` : largeur maximale du tiroir sur ordinateur ;
 * - `phoneMaxPx` : largeur jusqu'à laquelle la barre est celle du téléphone (même seuil que les requêtes de média de
 *   styles.css) : la journée-type passe alors dans le tiroir.
 * La hauteur de la barre vaut `rowPx + 2 x padYPx`, bordure comprise.
 */
/** « Mes réglages » : durée d'affichage de la confirmation « Enregistré dans ce navigateur » (ms). */
export const mySettings = { savedMs: 4500 } as const;

export const scenarioBar = { rowPx: 44, padYPx: 8, controlPx: 36, drawerMaxPx: 780, phoneMaxPx: 760 } as const;

/**
 * Graphiques en triangles du panneau de preuve (chantier C, lot 4, D-051) : géométrie en unités du `viewBox` (le SVG se met à
 * l'échelle de la largeur du panneau). Aller = triangle vers la droite, retour = vers la gauche, sur un axe qui part de 0.
 * - `width` : largeur du viewBox ; `labelPx` : colonne du nom (`labelWidePx` : colonne plus large des moyens de transport, nom sur deux lignes) ; `jobsPx` : colonne des postes (à droite) ;
 * - `rowPx` : hauteur d'une commune ; `laneOutPx` et `laneRetPx` : hauteur de l'aller (haut de la ligne) et du retour (bas) ;
 * - `markPx` : demi-hauteur d'un triangle ; `strokePx` : trait des contours et du trait pointillé ; `dash` : pointillé ;
 * - `axisPx` : hauteur de l'axe en bas ; `fontPx` : taille du texte ; `hitPad` : marge de la zone de survol.
 * Contrôle : `data/od/communeChart.test.ts` (axe, sens écrits, tri).
 */
export const triChart = { width: 320, labelPx: 96, labelWidePx: 120, jobsPx: 62, rowPx: 32, laneOutPx: 9, laneRetPx: 23, markPx: 5, strokePx: 1.5, dash: '3 3', axisPx: 18, fontPx: 11, hitPad: 2 } as const;

/**
 * Bande du trajet (lot 4, D-051), unités du `viewBox` de `triChart.width` : `bandPx` = hauteur de la bande ; `labelPx` = hauteur de la
 * rangée des durées écrites dessous ; `radiusPx` = arrondi des segments ; `fontPx` = texte des durées et du nom de ligne ;
 * `charEm` = largeur moyenne d'un caractère en fraction de `fontPx` (un nom ou une durée n'est écrit que s'il tient dans son segment).
 */
export const tripBand = { bandPx: 20, labelPx: 14, radiusPx: 2, fontPx: 10, fontPxPhone: 12, charEm: 0.6 } as const;

/**
 * Barres fines (lot 4, D-051 : projets de recrutement, part des actifs et des postes), unités du `viewBox` de `triChart.width` :
 * `rowPx` = hauteur d'une ligne (nom et valeur en haut, barre dessous) ; `textY` = ligne de base du texte ; `barY` et `barPx` =
 * position et hauteur de la barre ; `fadeFrac` = part de la longueur d'une barre « au moins » qui s'estompe au bout ; `fadeAlpha` =
 * opacité du bout estompé.
 */
export const barChart = { rowPx: 30, textY: 10, barY: 17, barPx: 8, fadeFrac: 0.3, fadeAlpha: 0.15 } as const;

/**
 * Graphique « route vide et trafic moyen » (lot 4, D-051), unités du `viewBox` de `triChart.width` : `rowPx` = hauteur d'un sens ;
 * `labelPx` = colonne du sens (« Aller », « Retour ») ; `indexPx` = colonne de l'indice écrit, à droite ; `dotPx` = rayon des points
 * (le point vide est la route vide, le point plein le trafic moyen) ; `axisPx` : hauteur de l'axe.
 */
export const trafficChart = { rowPx: 26, labelPx: 44, indexPx: 112, dotPx: 4, axisPx: 16 } as const;

/** Barre fine d'une part (lot 4, D-051) : `barPx` = hauteur de la barre, en unités du `viewBox` de `triChart.width` ; jamais un camembert. */
export const shareBar = { barPx: 6 } as const;

/**
 * Aide du site (`components/guide/`) et ses captures (`scripts/capture-guide.mjs`). Ajout seulement : aucune valeur existante ne change.
 * - `zIndex` : au-dessus de tout (le tiroir des sources est à 60, l'écran titre à 100) ;
 * - `maxWidthPx`, `tocWidthPx`, `shotMaxPx`, `phoneShotMaxPx` : largeur de la page, du sommaire, d'une capture et d'une capture de téléphone à l'écran ; `twoColsMinPx` : largeur de
 *   fenêtre à partir de laquelle le texte et la capture sont côte à côte (miroir : `@media` de `guide.css`, contrôlé par le test) ;
 * - `capture` : tailles de fenêtre, densité du téléphone, qualité webp (0 à 1), trait de mise en valeur et marge des captures.
 * Miroirs CSS : `--aide-*`, posés par `aideCssVars()`.
 */
export const aidePage = {
  zIndex: 120,
  maxWidthPx: 1360,
  tocWidthPx: 280,
  shotMaxPx: 640,
  phoneShotMaxPx: 280,
  twoColsMinPx: 1040,
  capture: {
    desktop: { width: 1280, height: 800 },
    wide: { width: 1600, height: 800 },
    tall: { width: 1280, height: 1000 },
    xtall: { width: 1280, height: 1600 },
    phone: { width: 390, height: 844 },
    phoneScale: 2,
    webpQuality: 0.8,
    ringPx: 2,
    padPx: 12,
  },
} as const;

/** Variables CSS de l'aide, posées sur son conteneur */
export function aideCssVars(): Record<string, string> {
  return {
    '--aide-z': String(aidePage.zIndex),
    '--aide-max-w': `${aidePage.maxWidthPx}px`,
    '--aide-toc-w': `${aidePage.tocWidthPx}px`,
    '--aide-shot-max': `${aidePage.shotMaxPx}px`,
  };
}

/**
 * Graphique « Coût de chaque sens » de la voiture (D-066), unités du `viewBox` de `triChart.width` : `rowPx` = hauteur d'un sens ;
 * `labelPx` = début des barres (triangle et « Aller · 17,7 km » à gauche) ; `valuePx` = place du montant à droite ; `barPx` = épaisseur.
 */
export const carCostChart = { rowPx: 30, labelPx: 130, valuePx: 84, barPx: 12 } as const;
