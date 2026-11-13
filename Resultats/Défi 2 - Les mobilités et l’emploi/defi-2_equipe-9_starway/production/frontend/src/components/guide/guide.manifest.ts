/**
 * Aide de STARWAY : déclaration unique des entrées, de leurs textes et de leurs captures.
 *
 * - `scripts/capture-guide.mjs` lit ce fichier et produit une capture webp par `GuideShot` dans `public/assets/guide/` ; il échoue si un
 *   sélecteur n'existe plus (un changement d'interface se voit tout de suite).
 * - `guide.manifest.test.ts` vérifie les règles de texte et la couverture des fonctions (`GUIDE_COVERAGE`).
 * - `GuideDialog.tsx` affiche ces entrées.
 *
 * Règle (docs/aide.md) : toute fonction ajoutée ou modifiée met à jour ce fichier et relance la capture, dans la même tâche.
 *
 * Aucun chiffre dans les textes : les temps, les postes et les prix sont dans les captures, régénérées à chaque publication.
 * Aucune source citée, hors de l'entrée qui explique le mode sources. Fichier sans import : Node et Vitest le lisent tel quel.
 */

export interface GuideCategory {
  id: string;
  title: string;
  /** Une phrase, sous le titre de la catégorie */
  intro: string;
}

/** Action rejouée par le script avant la capture. Un sélecteur introuvable arrête le script. */
export type ShotStep =
  | { do: 'click'; sel: string }
  | { do: 'fill'; sel: string; value: string }
  | { do: 'focus'; sel: string }
  | { do: 'hover'; sel: string }
  /** Ouvre un `<details>` (pli du panneau, réglage de la légende) */
  | { do: 'open'; sel: string }
  | { do: 'press'; key: string }
  /** Attend qu'un élément apparaisse */
  | { do: 'waitFor'; sel: string }
  | { do: 'wait'; ms: number };

export interface GuideShot {
  /** Nom du fichier (sans extension) dans `public/assets/guide/` */
  file: string;
  /** Adresse du scénario montré (chemin et paramètres) */
  url: string;
  /** Élément attendu pour dire que la page est prête (défaut : la barre de scénario) */
  ready?: string;
  viewport?: 'desktop' | 'wide' | 'tall' | 'xtall' | 'phone';
  steps?: readonly ShotStep[];
  /** Éléments montrés : la capture est leur boîte englobante, ou la fenêtre si `frame` vaut `page` */
  show: readonly string[];
  frame?: 'element' | 'page';
  /** Éléments entourés d'un trait sur la capture */
  highlight?: readonly string[];
  /** Texte alternatif : ce que montre la capture, sans chiffre */
  alt: string;
}

export interface GuideShortcut {
  keys: string;
  does: string;
}

export interface GuideEntry {
  id: string;
  category: string;
  title: string;
  /** À quoi ça sert, en une phrase */
  purpose: string;
  /** Comment faire, pas à pas */
  howTo: readonly string[];
  /** Ce qu'il faut savoir : limites utiles */
  know: readonly string[];
  shots: readonly GuideShot[];
  /** Mots en plus pour la recherche */
  keywords?: string;
  /** Tableau des raccourcis (entrée « Raccourcis clavier » seulement) */
  shortcuts?: readonly GuideShortcut[];
}

/** Scénarios des captures : des communes et un astre réels, publiés dans `public/data/` */
const O = '78358';
const VS = '93066';
const P = 'BE_1146';
/** Astre atteint avec une correspondance (bloc « Correspondances » rendu) */
const P_TRANSFER = 'BE_1147';
const SKY = `/?o=${O}&d=d09&b=45&m=transit`;
const PROOF = `${SKY}&p=${P}`;
const DRAWER: ShotStep = { do: 'click', sel: '.bar-toggle' };
const fold = (id: string): ShotStep => ({ do: 'open', sel: `.proof-panel [data-group="${id}"] details.pf-group-fold` });
const SOURCES_LINK = 'button.top-sources:text-is("Sources & limites")';

export const GUIDE_CATEGORIES: readonly GuideCategory[] = [
  { id: 'premiers-pas', title: 'Premiers pas', intro: 'Entrer dans le ciel et se repérer sur l\'écran.' },
  { id: 'scenario', title: 'Composer mon scénario', intro: 'Commune, horaires et temps de trajet : les trois questions du ciel.' },
  { id: 'moyens', title: 'Moyens de transport', intro: 'Choisir comment on se déplace, et régler ce choix.' },
  { id: 'ciel', title: 'Lire le ciel', intro: 'Ce que disent les astres, leur lumière et leur taille.' },
  { id: 'comparer', title: 'Comparer', intro: 'Deux communes, le même ciel.' },
  { id: 'astre', title: "Ouvrir un astre : le panneau de preuve", intro: 'Tout ce qui justifie un astre allumé ou éteint.' },
  { id: 'mes-reglages', title: 'Mes réglages', intro: 'Ce qui me concerne : gardé sur mon appareil, jamais dans le lien.' },
  { id: 'derriere', title: 'Derrière notre étoile', intro: 'Qui vit dans la commune choisie, et comment on y travaille.' },
  { id: 'lectures', title: 'Autres lectures du ciel', intro: 'Les mêmes données, autrement.' },
  { id: 'partager', title: 'Partager', intro: 'Envoyer un scénario ou le garder.' },
  { id: 'visite', title: 'Visite guidée', intro: 'Un cas raconté, joué dans le site lui-même.' },
  { id: 'confort', title: 'Accessibilité et confort', intro: 'Adapter le site à sa façon de lire.' },
  { id: 'methode', title: 'Sources et méthode', intro: 'Comment tout cela est calculé.' },
];

export const GUIDE_ENTRIES: readonly GuideEntry[] = [
  // ---------- Premiers pas ----------
  {
    id: 'aide',
    category: 'premiers-pas',
    title: 'Utiliser cette aide',
    purpose: 'Trouver comment faire quelque chose sur le site.',
    howTo: [
      'Choisissez « Aide » dans la barre du haut (au téléphone, dans le menu).',
      'Parcourez le sommaire, ou tapez un mot dans la recherche.',
      'Échap ou la croix referme l\'aide : le ciel n\'a pas bougé.',
    ],
    know: ['Si une visite guidée est en cours, elle se met en pause quand l\'aide s\'ouvre.'],
    shots: [
      {
        file: 'aide',
        url: SKY,
        steps: [{ do: 'click', sel: '.guide-btn' }, { do: 'waitFor', sel: '.guide-article' }],
        show: ['.guide'],
        frame: 'page',
        alt: "L'aide ouverte par-dessus le ciel : sommaire à gauche, entrées à droite.",
      },
    ],
    keywords: 'guide mode d\'emploi tutoriel',
  },
  {
    id: 'accueil',
    category: 'premiers-pas',
    title: "L'écran d'accueil",
    purpose: 'Entrer dans le ciel, ou lancer la visite guidée.',
    howTo: [
      '« Explorer le ciel » ouvre le ciel pour composer votre scénario.',
      '« Lancer la visite » joue un cas déjà préparé.',
      'Le logo STARWAY de la barre du haut ramène à cet écran : le scénario en cours est gardé.',
    ],
    know: ['Son, couleurs adaptées et réduction des animations se règlent dès cet écran.', 'Échap passe directement au ciel.'],
    shots: [
      {
        file: 'accueil',
        url: '/',
        ready: '.title-screen .title-actions',
        show: ['.title-screen'],
        frame: 'page',
        highlight: ['.title-actions'],
        alt: "L'écran d'accueil : le titre, les boutons pour explorer le ciel et lancer la visite, et trois réglages en haut à droite.",
      },
    ],
  },
  {
    id: 'vue-ensemble',
    category: 'premiers-pas',
    title: "Se repérer sur l'écran",
    purpose: 'Savoir où se trouve chaque chose.',
    howTo: [
      'En haut : découvertes, visite, autres lectures du ciel, Mes réglages et réglages d\'affichage.',
      'Au centre : le ciel, un astre par pôle d\'emploi ; la légende en haut à gauche, le zoom en bas à droite.',
      'En bas : la barre du scénario, avec une flèche pour déplier les autres réglages.',
    ],
    know: ['La barre du bas garde la même hauteur dans tous les scénarios : le ciel ne se recadre jamais.', 'Sous le ciel, une ligne nomme toujours les producteurs des données.'],
    shots: [
      {
        file: 'vue-ensemble',
        url: SKY,
        show: ['.scenario-bar'],
        frame: 'page',
        highlight: ['.top-bar', '.legend', '.zoom-controls', '.scenario-bar'],
        alt: 'Le site entier : barre du haut, ciel au centre avec la légende et les boutons de zoom, barre du scénario en bas.',
      },
    ],
    keywords: 'interface écran zones barre',
  },
  {
    id: 'telephone',
    category: 'premiers-pas',
    title: 'Sur téléphone',
    purpose: 'Retrouver les mêmes fonctions sur un petit écran.',
    howTo: [
      'Le bouton à trois traits, en haut à droite, ouvre le menu des autres fonctions.',
      'La journée-type et le mode sont dans le tiroir de la barre du bas, ouvert avec la flèche.',
      'Les panneaux s\'ouvrent par le bas : tirez la poignée vers le bas pour les fermer.',
    ],
    know: ['En comparaison, les deux ciels sont empilés.'],
    shots: [
      {
        file: 'telephone',
        url: SKY,
        viewport: 'phone',
        steps: [{ do: 'click', sel: '.top-menu-btn' }, { do: 'waitFor', sel: '.top-more.is-open' }],
        show: ['.top-bar'],
        frame: 'page',
        alt: 'Le site sur téléphone, le menu du haut ouvert avec ses réglages, le ciel et la barre du bas.',
      },
    ],
    keywords: 'mobile smartphone menu petit écran',
  },

  // ---------- Composer mon scénario ----------
  {
    id: 'commune',
    category: 'scenario',
    title: 'Choisir sa commune de départ',
    purpose: 'Dire d\'où part le trajet : le ciel s\'éclaire depuis cette commune.',
    howTo: [
      'En bas à gauche, cliquez sur « Ma commune de départ » (ou sur Changer) : un champ vide s\'ouvre.',
      'Tapez le début du nom : accents et tirets sont facultatifs. La liste s\'ouvre dès la première lettre.',
      'Choisissez à la souris, ou avec les flèches et Entrée. Échap ou un clic ailleurs garde la commune précédente.',
    ],
    know: [
      'Toutes les communes d\'Île-de-France et les arrondissements de Paris sont proposés.',
      'Le calcul part d\'un point de la commune, pas de votre adresse : votre temps réel peut varier.',
      'Tant qu\'aucune commune n\'est choisie, le champ propose les communes du récit ; ensuite, tapez un nom.',
    ],
    shots: [
      {
        file: 'commune',
        url: SKY,
        steps: [{ do: 'click', sel: '.bar-origin .commune-pick' }, { do: 'fill', sel: '.bar-origin input[role="combobox"]', value: 'mais' }, { do: 'waitFor', sel: '.combo-list' }],
        show: ['.bar-origin', '.combo-list'],
        alt: 'Le champ de commune de départ avec le début d\'un nom tapé et la liste des communes proposées.',
      },
    ],
    keywords: 'ville adresse domicile recherche étoile-guide',
  },
  {
    id: 'journee',
    category: 'scenario',
    title: 'Choisir une journée-type',
    purpose: 'Voir le ciel selon l\'heure à laquelle on travaille.',
    howTo: [
      'Dans la barre du bas, choisissez un des horaires proposés.',
      'L\'aller arrive avant le début du poste, le retour part après sa fin.',
      'Le « i » à côté rappelle d\'abord que ces journées-types sont des scénarios hypothétiques, puis dit la part des salariés qui travaillent le soir ou la nuit.',
    ],
    know: ['Ce sont des scénarios hypothétiques, pas les horaires réels d\'un salarié.'],
    shots: [
      {
        file: 'journee',
        url: SKY,
        show: ['.bar-day'],
        alt: 'Les trois journées-types de la barre du bas, l\'une sélectionnée, et le bouton « i ».',
      },
    ],
    keywords: 'horaire matin soir éclipse',
  },
  {
    id: 'horaires-libres',
    category: 'scenario',
    title: 'Mes horaires libres',
    purpose: 'Calculer le ciel pour vos propres heures de début et de fin.',
    howTo: [
      'Dépliez les réglages avec la flèche, au bout de la barre du bas.',
      'Choisissez « Horaires libres… ».',
      'Réglez « Début du poste » et « Fin du poste » avec les deux jauges.',
      '« Fermer » replie le réglage. Une journée-type de la barre du bas revient aux horaires proposés.',
    ],
    know: [
      'Au clavier : flèches pour un pas, Page précédente et Page suivante pour une heure.',
      'La fin reste toujours après le début : l\'autre jauge se décale si besoin, et c\'est dit à l\'écran.',
      'Chaque astre s\'éclaire selon la part de ses postes atteinte, commune par commune.',
      'Proposés pour les transports en commun ; pour les autres modes, une phrase dit pourquoi.',
      'Le « i » en haut du réglage dit quelles destinations sont comptées.',
    ],
    shots: [
      {
        file: 'horaires-libres',
        url: SKY,
        viewport: 'tall',
        steps: [DRAWER, { do: 'click', sel: '.shift-toggle' }, { do: 'waitFor', sel: '.shift-pop' }],
        show: ['.bar-drawer'],
        alt: 'Les réglages du scénario dépliés, avec les jauges de début et de fin de poste et la case poste de nuit.',
      },
    ],
    keywords: 'heure personnalisé début fin poste',
  },
  {
    id: 'poste-nuit',
    category: 'scenario',
    title: 'Poste de nuit',
    purpose: 'Calculer un poste dont la fin tombe le lendemain matin.',
    howTo: [
      'Ouvrez les horaires libres.',
      'Cochez « Poste de nuit ».',
      'Réglez le début du poste, puis sa fin le lendemain matin.',
    ],
    know: ['Le retour du matin est lu dans les horaires du même mardi type.', 'Le « i » à côté de la case dit la plage de début et de fin autorisée, avec un exemple à cocher et un à ne pas cocher.'],
    shots: [
      {
        file: 'poste-nuit',
        url: `/?o=${O}&s=2200&e=0600&b=45&m=transit`,
        viewport: 'tall',
        steps: [DRAWER, { do: 'click', sel: '.shift-toggle' }, { do: 'waitFor', sel: '.shift-pop' }],
        show: ['.shift-pop'],
        alt: 'Le réglage des horaires libres, case poste de nuit cochée, avec une fin de poste le lendemain matin.',
      },
    ],
    keywords: 'nuit lendemain',
  },
  {
    id: 'temps-trajet',
    category: 'scenario',
    title: 'Régler le temps de trajet par sens',
    purpose: 'Dire combien de temps on accepte pour chaque trajet.',
    howTo: [
      'Faites glisser la jauge « Temps de trajet par sens ».',
      'Au clavier : placez-vous dessus, puis flèches ; Page précédente et Page suivante vont de repère en repère.',
      'Le ciel et le compteur suivent à mesure.',
    ],
    know: ['Ce temps vaut pour chaque sens : l\'aller et le retour doivent tous les deux tenir dedans.', 'Le « i » à côté de la valeur explique les repères de la jauge.'],
    shots: [
      {
        file: 'temps-trajet',
        url: SKY,
        show: ['.bar-budget'],
        alt: 'La jauge du temps de trajet par sens, dans la barre du bas.',
      },
    ],
    keywords: 'budget durée minutes jauge',
  },
  {
    id: 'reglages',
    category: 'scenario',
    title: 'Déplier les réglages du scénario',
    purpose: 'Accéder aux réglages qui ne tiennent pas dans la barre.',
    howTo: [
      'Cliquez sur la flèche, à droite de la barre du bas.',
      'Horaires libres, réglages du mode, comparaison, lien et Mes réglages s\'y trouvent. Dépliez les réglages, puis ouvrez le « i » du compteur pour lire sa phrase complète.',
      'La croix en haut à droite du tiroir, Échap ou la même flèche le referme.',
    ],
    know: ['Le tiroir s\'ouvre par-dessus le ciel : rien ne se déplace.'],
    shots: [
      {
        file: 'reglages',
        url: SKY,
        viewport: 'tall',
        steps: [DRAWER, { do: 'waitFor', sel: '.bar-drawer' }],
        show: ['.bar-drawer', '.bar-toggle'],
        highlight: ['.bar-toggle'],
        alt: 'Le tiroir des réglages ouvert au-dessus de la barre du bas, avec la flèche qui l\'ouvre.',
      },
    ],
    keywords: 'tiroir plus options',
  },

  // ---------- Moyens de transport ----------
  {
    id: 'modes',
    category: 'moyens',
    title: 'Choisir un moyen de transport',
    purpose: 'Voir le ciel en transports en commun, à vélo, à pied ou en voiture.',
    howTo: [
      'Ouvrez la liste « Mode » dans la barre du bas (au téléphone, dans le tiroir).',
      'Choisissez : « Transports en commun », « Vélo + transports en commun », « Vélo », « Marche », « Voiture, route vide », « Voiture, trafic moyen », suivi de « (estimation) », ou « Vélib\' ».',
      'Le « i » « Précision sur ce mode », à côté, dit ce que suppose ce mode.',
    ],
    know: ['Un mode non calculé pour votre commune est grisé, avec la raison.'],
    shots: [
      {
        file: 'modes',
        url: SKY,
        viewport: 'wide',
        show: ['.bar-mode'],
        alt: 'La liste du mode dans la barre du bas, avec le « i » qui précise ce que suppose ce mode.',
      },
    ],
    keywords: 'tc bus métro rer train',
  },
  {
    id: 'marche',
    category: 'moyens',
    title: 'Régler la marche des transports en commun',
    purpose: 'Limiter la distance à pied acceptée au début et à la fin du trajet.',
    howTo: [
      'Mode « Transports en commun », puis dépliez les réglages.',
      'Dans « Réglages du mode », choisissez le niveau de « Marche ».',
    ],
    know: [
      'C\'est un choix de l\'équipe, pas une donnée. Il s\'applique à chaque bout du trajet.',
      'Les correspondances à pied gardent leur propre limite, celle du moteur de calcul.',
      'Le réglage en vigueur est rappelé en première ligne du pli « Méthode et sources » d\'un astre.',
      'En réglage confort, les autres trajets du bloc « Trajet » sont ceux du réglage confort, calculés pour toutes les communes.',
    ],
    shots: [
      {
        file: 'marche',
        url: SKY,
        viewport: 'tall',
        steps: [DRAWER, { do: 'waitFor', sel: '#walk-select' }],
        show: ['.drawer-mode'],
        highlight: ['#walk-select'],
        alt: 'La cellule réglages du mode avec la liste de la marche à pied.',
      },
    ],
    keywords: 'pied confort distance arrêt',
  },
  {
    id: 'pied-velo',
    category: 'moyens',
    title: 'Marche à pied et vélo',
    purpose: 'Voir ce qu\'on atteint sans transports ni voiture.',
    howTo: [
      'Dans la liste « Mode », choisissez « Marche » ou « Vélo ».',
      'Dépliez les réglages : la distance équivalente au temps choisi y est donnée.',
    ],
    know: [
      'Cette distance est un chemin parcouru à vitesse constante, pas un rayon à vol d\'oiseau.',
      'À pied et à vélo, l\'horaire ne change pas le trajet.',
    ],
    shots: [
      {
        file: 'pied-velo',
        url: `/?o=${O}&d=d09&b=45&m=bike`,
        viewport: 'tall',
        steps: [DRAWER, { do: 'waitFor', sel: '.drawer-ref' }],
        show: ['.drawer-ref'],
        alt: 'La distance équivalente au temps choisi, dans les réglages du scénario, à vélo.',
      },
    ],
    keywords: 'distance équivalente',
  },
  {
    id: 'voiture',
    category: 'moyens',
    title: 'Voiture : route vide ou trafic moyen',
    purpose: 'Comparer un trajet routier théorique et un trajet avec du trafic.',
    howTo: [
      'Dans la liste « Mode », choisissez « Voiture, route vide » ou « Voiture, trafic moyen », suivi de « (estimation) » : ce temps est modélisé.',
      'Le « i » « Précision sur ce mode », à côté de la liste, résume ce que suppose le mode ; en trafic moyen, il nomme l\'indice utilisé.',
      'Ouvrez un astre : le graphique du panneau donne, pour l\'aller et le retour, le temps route vide et le temps avec le trafic moyen (estimation).',
    ],
    know: [
      'Le « i » « Comment ce temps est-il calculé ? », sous le graphique, dit dans l\'ordre : en route vide, que ce temps est optimiste aux heures de pointe ; que le trafic moyen, mesuré sur les voies rapides et appliqué à tout le trajet, est un choix de l\'équipe ; quel temps décide du verdict ; la règle de chaque sens.',
      'Commune par commune, le titre du graphique précise qu\'il s\'agit d\'un exemple vers le point du pôle.',
      'Avec le mode sources, ces précisions sont écrites en clair dans le bloc.',
      'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.',
      'Le coût et le carbone du trajet en voiture sont dans le bloc « Trajet » et dans le pli « Coût et carbone » : voir « Coût, carbone et abonnements ».',
    ],
    shots: [
      {
        file: 'voiture',
        url: `/?o=${O}&d=d09&b=45&m=car_traffic&p=${P}`,
        viewport: 'tall',
        steps: [{ do: 'waitFor', sel: '.proof-panel .pf-traffic' }],
        show: ['.pf-traffic .pf-cc'],
        alt: 'Le graphique du panneau d\'un astre : route vide et trafic moyen, pour chaque sens.',
      },
    ],
    keywords: 'auto route embouteillage heure de pointe',
  },
  {
    id: 'vehicule',
    category: 'moyens',
    title: 'Choisir son véhicule',
    purpose: 'Adapter le coût et le carbone à votre voiture ou votre deux-roues.',
    howTo: [
      'Choisissez un mode voiture, puis dépliez les réglages.',
      'Dans « Réglages du mode », choisissez le « Véhicule ».',
      'Ouvrez un astre : les tuiles Coût et Carbone du bloc « Trajet » et le pli « Coût et carbone » suivent ce choix.',
    ],
    know: [
      'Le véhicule ne change ni le ciel ni les temps.',
      'Les deux-roues gardent le temps de la voiture : aucune mesure publique ne chiffre leur gain.',
    ],
    shots: [
      {
        file: 'vehicule',
        url: `/?o=${O}&d=d09&b=45&m=car`,
        viewport: 'tall',
        steps: [DRAWER, { do: 'waitFor', sel: '#vehicle-select' }],
        show: ['.drawer-mode'],
        highlight: ['#vehicle-select'],
        alt: 'La cellule réglages du mode en voiture, avec la liste des véhicules.',
      },
    ],
    keywords: 'essence diesel électrique moto scooter deux-roues',
  },
  {
    id: 'velib',
    category: 'moyens',
    title: "Vélib'",
    purpose: 'Estimer un trajet en vélo en libre-service.',
    howTo: [
      "Dans la liste « Mode », choisissez « Vélib' ».",
      'Dans la barre du bas, la première phrase de l\'avertissement reste écrite : son « i » donne le texte complet.',
      'Dans le panneau d\'un astre, l\'avertissement est en tête : la première phrase est écrite, la suite est dans le « i » « Que veut dire l\'avertissement Vélib\' ? ».',
    ],
    know: [
      'Le temps suppose un vélo à la station de départ et une place libre à l\'arrivée : personne ne peut le garantir à l\'avance.',
      'Proposé seulement pour les communes qui ont une station.',
    ],
    shots: [
      {
        file: 'velib',
        url: '/?o=75111&d=d09&b=45&m=velib',
        viewport: 'wide',
        show: ['.bar-mode'],
        alt: 'Le mode Vélib\' choisi, avec son avertissement et le bouton « i ».',
      },
    ],
    keywords: 'vélo libre-service station',
  },
  {
    id: 'velo-tc',
    category: 'moyens',
    title: 'Vélo + transports en commun',
    purpose: 'Voir ce que le vélo jusqu\'à la gare ajoute aux transports en commun.',
    howTo: [
      'Dans la liste « Mode », choisissez « Vélo + transports en commun ».',
      'Les astres en or sont ceux que ce scénario gagne : voir « L\'or : un gain démontré ».',
    ],
    know: [
      'Vélo personnel jusqu\'à la gare, puis transports et marche : le « i » « Précision sur ce mode », dans la barre du bas, le rappelle.',
      'Dans le panneau d\'un astre, le titre « Temps de trajet (durées minimales) » le dit ; son « i » « Pourquoi des durées minimales ? » explique que le temps pour garer le vélo n\'est pas compté.',
      'Le « i » « Et pour garer le vélo en gare ? », sur la tuile Coût du bloc « Trajet », donne l\'offre de stationnement en gare.',
      "Le « i » « Pourquoi pas de détail du trajet ? », à côté du titre « Trajet », dit que seule la durée est calculée pour ce mode : pas de lignes ni d'horaires, ni le coût et le carbone de la partie en transports en commun.",
      'Calculé pour toutes les communes d\'Île-de-France.',
    ],
    shots: [
      {
        file: 'velo-tc',
        url: `/?o=${O}&d=d09&b=60&m=bike_transit`,
        show: ['.scenario-bar'],
        frame: 'page',
        alt: 'Le ciel en vélo plus transports en commun, certains astres dorés, avec le mode choisi dans la barre du bas.',
      },
    ],
    keywords: 'intermodalité gare rabattement',
  },

  // ---------- Lire le ciel ----------
  {
    id: 'astres',
    category: 'ciel',
    title: 'Les astres et leur taille',
    purpose: 'Comprendre ce que représente chaque astre.',
    howTo: [
      'Chaque astre est un pôle d\'emploi.',
      'Son aire est proportionnelle à ses postes salariés recensés par l\'INSEE.',
      'Votre commune est l\'étoile-guide, à son nom.',
    ],
    know: [
      'Ce sont des postes salariés recensés par l\'INSEE, pas des offres à pourvoir.',
      'Places et tailles sont les mêmes dans tous les scénarios : seule la lumière change.',
      'Les petits points de fond sont un décor : ils ne portent aucune donnée.',
    ],
    shots: [
      {
        file: 'astres',
        url: SKY,
        show: ['.scenario-bar'],
        frame: 'page',
        alt: 'Le ciel complet : des astres de tailles différentes, certains allumés en cyan, et l\'étoile-guide de la commune choisie.',
      },
    ],
    keywords: 'pôle emploi taille aire postes étoile-guide',
  },
  {
    id: 'etats',
    category: 'ciel',
    title: 'Les états d\'un astre',
    purpose: 'Savoir si un pôle est accessible, et dans quel sens.',
    howTo: [
      'En transports en commun, à pied, à vélo et en voiture (route vide ou trafic moyen), chaque commune du pôle est calculée : le cœur cyan et l\'arc plein du contour montrent la part de ses postes atteinte à l\'aller et au retour.',
      'En vélo + transports, en Vélib\' et pendant une découverte, tout le pôle est accessible ou non : cyan s\'il l\'est à l\'aller et au retour.',
      'Moitié haute pleine, moitié basse en tirets : aller possible, retour hors de portée.',
      'Gris-bleu : hors de portée dans ce scénario.',
    ],
    know: [
      'Hors de portée ne veut pas dire qu\'aucun transport n\'existe : c\'est le scénario qui ne passe pas.',
      'La couleur n\'est jamais seule : la forme du contour dit la même chose.',
    ],
    shots: [
      {
        file: 'etats',
        url: SKY,
        show: ['.legend > li:first-child', '.legend > li:nth-child(2)'],
        alt: 'La légende du ciel avec les pictogrammes des états d\'un astre.',
      },
    ],
    keywords: 'accessible hors de portée retour aller cyan gris perle non calculé',
  },
  {
    id: 'legende',
    category: 'ciel',
    title: 'La légende et les bulles « i »',
    purpose: 'Obtenir l\'explication d\'un mot, sans quitter le ciel.',
    howTo: [
      'La légende est en haut à gauche du ciel.',
      'Cliquez sur un « i » ou placez-vous dessus : une bulle s\'ouvre.',
      'Échap, un nouveau clic ou un clic ailleurs la referme.',
    ],
    know: ['Les bulles existent partout : barre du bas, légende et panneaux.', 'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.'],
    shots: [
      {
        file: 'legende',
        url: SKY,
        steps: [{ do: 'click', sel: '.legend .info-btn' }, { do: 'wait', ms: 400 }],
        show: ['.legend'],
        frame: 'page',
        alt: 'La légende avec une bulle « i » ouverte qui explique un état d\'astre.',
      },
    ],
    keywords: 'infobulle explication aide contextuelle',
  },
  {
    id: 'or',
    category: 'ciel',
    title: 'L\'or : un gain démontré',
    purpose: 'Repérer les pôles qu\'un mode complémentaire rend accessibles.',
    howTo: [
      'Choisissez « Vélo + transports en commun » dans la liste « Mode ».',
      'Les astres dorés sont atteints aller et retour avec ce mode, mais pas en transports seuls.',
      'L\'entrée « Or » apparaît dans la légende tant qu\'il y a de l\'or à l\'écran.',
    ],
    know: ['Un astre doré est toujours une différence réelle entre deux calculs.', 'En mode couleurs adaptées, l\'or vire à l\'ambre.'],
    shots: [
      {
        file: 'or',
        url: `/?o=${O}&d=d09&b=60&m=bike_transit`,
        show: ['.legend > li:first-child', '.legend li:has-text("gain démontré")'],
        alt: 'La légende du ciel en vélo plus transports en commun, avec une ligne pour l\'or.',
      },
    ],
    keywords: 'gain doré vélo',
  },
  {
    id: 'compteur',
    category: 'ciel',
    title: 'Le compteur de postes',
    purpose: 'Lire d\'un coup d\'œil combien de postes le scénario atteint.',
    howTo: [
      'Le compteur est à droite de la barre du bas.',
      'Sous le nombre, sa légende : « postes salariés (INSEE), aller et retour ».',
      'Dépliez les réglages, puis ouvrez le « i » « Détail du compteur » : il dit ce que sont ces postes, puis la phrase complète du compteur.',
      'Une courte mention dit la variation après chaque changement.',
    ],
    know: [
      'Commune par commune, il compte les postes salariés recensés par l\'INSEE atteints à l\'aller et au retour dans toute la région ; pour les autres modes, ceux des pôles accessibles.',
      'Le filet sous le nombre en montre la part. Son « i » « Comment lire ce graphique » dit ce que vaut sa longueur entière, puis détaille un cas précis, avec les valeurs affichées.',
    ],
    shots: [
      {
        file: 'compteur',
        url: SKY,
        show: ['.bar-counter'],
        alt: 'Le compteur des postes salariés (INSEE) accessibles, dans la barre du bas.',
      },
    ],
    keywords: 'nombre total postes',
  },
  {
    id: 'zoom',
    category: 'ciel',
    title: 'Zoomer et se déplacer',
    purpose: 'Regarder de près un groupe d\'astres.',
    howTo: [
      'Molette, pincement ou boutons plus et moins en bas à droite du ciel.',
      'Glissez pour déplacer la vue ; un double-clic zoome à cet endroit, Maj et double-clic dézoome.',
      'Le troisième bouton recentre le ciel.',
    ],
    know: [
      'En zoomant, davantage de noms de pôles trouvent leur place.',
      'Si votre étoile sort du cadre, un repère au bord de l\'écran y ramène.',
      'Le zoom est désactivé pendant une comparaison.',
    ],
    shots: [
      {
        file: 'zoom',
        url: SKY,
        steps: [{ do: 'click', sel: '.zoom-controls .icon-btn' }, { do: 'wait', ms: 500 }],
        show: ['.zoom-controls'],
        alt: 'Les boutons de zoom du ciel, avec le niveau de zoom affiché.',
      },
    ],
    keywords: 'molette pincer recadrer',
  },
  {
    id: 'ciel-neutre',
    category: 'ciel',
    title: 'Quand le ciel reste neutre',
    purpose: 'Comprendre pourquoi aucun résultat ne s\'affiche.',
    howTo: [
      'Une carte, au centre du ciel, explique ce qui manque.',
      'Choisissez un autre mode ou une autre commune.',
    ],
    know: [
      'Le ciel neutre montre les pôles à leur place, sans état d\'accessibilité : rien n\'est dit sur eux.',
      'La barre du bas dit aussi quand un mode n\'existe pas pour cette commune.',
    ],
    shots: [
      {
        file: 'ciel-neutre',
        url: `/?o=${O}&d=d09&b=45&m=velib`,
        steps: [{ do: 'waitFor', sel: '.sky-notice' }],
        show: ['.sky-notice'],
        alt: 'La carte qui s\'affiche au centre du ciel quand le mode n\'est pas disponible pour la commune choisie (ici Vélib\', sans station dans la commune).',
      },
    ],
    keywords: 'pas de résultat non calculé perle',
  },

  // ---------- Comparer ----------
  {
    id: 'comparer',
    category: 'comparer',
    title: 'Comparer deux communes',
    purpose: 'Voir côte à côte ce que deux communes atteignent, dans le même scénario.',
    howTo: [
      'Dépliez les réglages, puis choisissez « Comparer… ».',
      'Tapez le nom de la seconde commune et choisissez-la.',
      'Pour changer de commune B, cliquez sur son nom en haut du ciel B : il s\'ouvre en recherche, comme la commune de départ.',
      '« Quitter la comparaison », en haut du ciel B, revient au ciel de la commune A seule ; la croix de l\'étiquette « B » des réglages fait de même.',
    ],
    know: [
      'Les deux ciels partagent les mêmes places et les mêmes tailles : seule la lumière diffère.',
      'L\'écart affiché est calculé entre les deux ciels, sans en tirer de cause.',
      'Le panneau d\'un astre donne le résultat de chaque commune, « A · … » et « B · … » ; coût, carbone et itinéraire sont calculés pour une seule commune, hors comparaison.',
      'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.',
    ],
    shots: [
      {
        file: 'comparer',
        url: `${SKY}&vs=${VS}`,
        steps: [{ do: 'waitFor', sel: '.split-delta' }, { do: 'wait', ms: 4000 }],
        show: ['.scenario-bar'],
        frame: 'page',
        highlight: ['.split-delta', '.pane-head-B'],
        alt: 'Deux ciels côte à côte pour deux communes, avec l\'écart entre elles au milieu ; en haut du ciel B, le nom de la commune B et « Quitter la comparaison ».',
      },
    ],
    keywords: 'diptyque deux ciels b versus quitter sortir changer commune b',
  },

  // ---------- Panneau de preuve ----------
  {
    id: 'ouvrir-astre',
    category: 'astre',
    title: 'Ouvrir un astre',
    purpose: 'Comprendre pourquoi un astre est allumé ou non.',
    howTo: [
      'Cliquez sur un astre.',
      'Au clavier : Tab jusqu\'au ciel, flèches d\'un astre à l\'autre, Entrée.',
      'Échap ou la croix ferme le panneau et rend la main à l\'astre.',
    ],
    know: ['Depuis la liste du ciel, un nom de pôle ouvre le même panneau.', 'En tête, le panneau rappelle la commune de départ et, quand l\'heure compte, l\'horaire joué.', 'Sans le mode sources, les précisions de chaque bloc sont dans ses « i ».'],
    shots: [
      {
        file: 'ouvrir-astre',
        url: PROOF,
        steps: [{ do: 'waitFor', sel: '.proof-panel .pf-od' }],
        show: ['.proof-panel'],
        frame: 'page',
        alt: 'Le panneau de preuve d\'un astre ouvert à droite du ciel.',
      },
    ],
    keywords: 'panneau preuve cliquer détail',
  },
  {
    id: 'temps-itineraire',
    category: 'astre',
    title: 'Résultat et itinéraire',
    purpose: 'Lire ce que le scénario atteint, puis l\'aller et le retour, ligne par ligne.',
    howTo: [
      "Si l'exemple de trajet et le verdict de l'astre ne disent pas la même chose (l'exemple va jusqu'à l'arrêt le plus desservi, le verdict jusqu'au centre des communes), une phrase au-dessus du bloc « Trajet » donne les durées du verdict.",
      "Sous la barre de part, la durée de chaque sens qui fait le verdict, avec ce qui dépasse le temps choisi : pour un arrondissement, ses deux sens ; pour un astre de plusieurs communes éteint, la commune du pôle la plus proche. Son « i » dit d'où viennent ces durées et pourquoi l'exemple de trajet peut en donner d'autres.",
      'En tête du panneau : la part des postes du pôle atteinte à l\'aller et au retour ; pour les modes calculés par pôle, le temps de chaque sens, avec le dépassement écrit seulement quand un sens dépasse le temps choisi.',
      'Dessous, en transports en commun, le bloc « Trajet » : la bascule « Aller » / « Retour » (chaque bouton porte la durée de son sens), la ligne « Aller et retour » (durée, coût, carbone du trajet retenu), puis, pour le sens choisi, les tuiles Durée, Coût et Carbone, la bande du trajet avec chaque ligne empruntée, sa climatisation déclarée et sa ponctualité ; le bouton « Arrêts et horaires du trajet » déplie le sens, arrêt par arrêt.',
      'Quand d\'autres trajets sont calculés, des onglets les montrent dans le même bloc : « Trajet retenu », « Le moins cher » et « Le moins de correspondances », avec l\'écart au trajet retenu, en prix, en durée ou en correspondances.',
      '« Rejouer le trait » relance l\'étoile filante dans le ciel ; son « i » rappelle que ce trait n\'est pas l\'itinéraire.',
    ],
    know: [
      'Commune par commune, l\'itinéraire est un exemple vers le point du pôle : le titre du bloc le dit (« Trajet, exemple de trajet ») ; le « i » « D\'où part et où arrive cet exemple ? » précise l\'exemple, son arrêt et l\'écart éventuel avec la durée du calcul.',
      'Le « i » « Climatisation et ponctualité : d\'où viennent ces valeurs ? », au bout des lignes, dit ce que veulent dire ces valeurs, le mois de la ponctualité et d\'où elles viennent.',
      'Le « i » de la tuile Coût (« Quels tickets pour ce trajet ? » en transports en commun, « Quelles dépenses pour ce trajet ? » en voiture) ouvre un anneau : la part de chaque ticket, ou de l\'énergie et du péage, dans le coût du sens choisi. Rien n\'est dessiné quand le prix n\'est pas sûr ou quand un abonnement couvre le trajet.',
      'Avec le mode sources, ces précisions sont écrites en clair, au même endroit.',
      'Le détail ligne par ligne existe en transports en commun seulement. À vélo, en vélo + transports en commun et en voiture, le même bloc « Trajet » donne le coût et le carbone ; en voiture, il garde la bascule « Aller » / « Retour ».',
      'En horaires libres, le panneau écrit « Détail du trajet : non calculé en horaires libres. » ; le bouton « Voir l\'exemple en journée … » passe à la journée-type la plus proche.',
      'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.',
    ],
    shots: [
      {
        file: 'temps-itineraire',
        url: PROOF,
        viewport: 'tall',
        steps: [{ do: 'waitFor', sel: '.proof-panel .pf-trip-block' }],
        show: ['.pf-od', '.pf-trip-block .pf-tb'],
        alt: 'La part des postes du pôle atteinte, puis le bloc « Trajet » : la bascule aller et retour, les tuiles durée, coût et carbone et la bande du trajet.',
      },
    ],
    keywords: 'ligne bus métro rer horaire départ arrivée',
  },
  {
    id: 'correspondances',
    category: 'astre',
    title: 'Vérification des correspondances',
    purpose: 'Savoir si un trajet tient avec des correspondances réalistes.',
    howTo: [
      'Si une correspondance est trop courte, le bloc apparaît sous l\'itinéraire ; sinon, le bilan est dans « Méthode et sources ».',
      'Une correspondance plus courte que le minimum officiel est listée, avec le temps du trajet en le respectant.',
    ],
    know: [
      'Un astre peut rester allumé avec la mention « à vérifier » : en respectant ce minimum, ce même trajet dépasserait le temps choisi. L\'estimation est pessimiste, un autre itinéraire existe souvent.',
      'Le ciel ne change pas. Le contrôle porte sur l\'exemple de trajet, pas sur chaque commune du pôle.',
      'Dans « Méthode et sources », le « i » au bout du bilan dit d\'où vient le minimum de correspondance.',
    ],
    shots: [
      {
        file: 'correspondances',
        url: `/?o=${O}&d=d09&b=60&m=transit&p=${P_TRANSFER}`,
        viewport: 'tall',
        steps: [fold('methode'), { do: 'waitFor', sel: '.proof-panel .tc-section' }],
        show: ['.tc-section'],
        alt: 'Le bloc Correspondances du panneau d\'un astre.',
      },
    ],
    keywords: 'correspondance changement minimum à vérifier',
  },
  {
    id: 'pli-communes',
    category: 'astre',
    title: 'Le pli « Communes du pôle »',
    purpose: 'Voir quelles communes composent un pôle.',
    howTo: [
      'Ouvrez le pli « Communes du pôle », sous l\'itinéraire.',
      'Commune par commune : un graphique des temps aller et retour. Pour les autres modes : la liste, que le lien « et autres » déroule.',
    ],
    know: ['Le chiffre lu sur le pli fermé dit combien de communes sont atteintes.', 'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.'],
    shots: [
      {
        file: 'pli-communes',
        url: PROOF,
        viewport: 'tall',
        steps: [fold('communes')],
        show: ['.proof-panel [data-group="communes"]'],
        alt: 'Le pli Communes du pôle déplié.',
      },
    ],
    keywords: 'pôle communes liste',
  },
  {
    id: 'pli-cout',
    category: 'astre',
    title: 'Coût, carbone et abonnements',
    purpose: 'Voir ce que coûte le trajet, son carbone, et ce que changerait un abonnement.',
    howTo: [
      'Le coût et le carbone d\'un trajet sont en tuiles, en grand, dans le bloc « Trajet » en haut de la fiche : en transports en commun, Durée, Coût (« au ticket » ou selon votre abonnement) et Carbone (« estimation ») du sens choisi, et la ligne « Aller et retour ».',
      'Le « i » de chaque tuile donne le détail : les tickets de ce sens, la méthode du carbone, ou pourquoi une valeur n\'est pas calculée.',
      'Le pli « Abonnements » (transports en commun) dit quels abonnements couvriraient l\'aller et le retour ; avec votre abonnement, ce qui reste à payer en plus. Le bouton « Mes réglages » (ou « Modifier ») adapte le coût à ce que vous avez déjà.',
      'En voiture, la tuile Coût du bloc « Trajet » donne le sens choisi, le péage et le crédit de son tarif dessous ; le pli « Coût et carbone » donne le total et le carbone aller et retour en grand, puis le graphique « Coût de chaque sens » : une barre par sens, énergie en plein, péage hachuré, montant au bout ; chaque péage est écrit dessous avec le crédit de son tarif.',
      'À vélo : « Aucun titre de transport » et « Pas d\'émission à l\'usage », sans chiffre de coût ni de carbone ; en vélo + transports en commun, la partie en transports en commun est « Non calculé ». Le pli n\'existe plus pour ces deux modes.',
    ],
    know: [
      'Le prix et le carbone des transports en commun viennent d\'un exemple de trajet en journée-type : en horaires libres et en comparaison, le pli dit qu\'ils ne sont pas calculés.',
      'Le carbone est toujours une estimation, écrite sous le chiffre. Aucune source retenue ne publie de facteur d\'émission du vélo : le site n\'écrit pas de chiffre pour le vélo.',
      'Le prix d\'un abonnement n\'est jamais divisé par un nombre de trajets : la ligne dit ce que vous payez en plus, hors coût de l\'abonnement.',
      'Les coûts d\'une voiture dépendent du véhicule choisi dans les réglages du mode. Le « i » « Ce qui est compté » dit d\'abord que le coût vaut vers le point d\'arrivée du pôle, puis ce que le coût et le carbone comptent, et ce qu\'ils ne comptent pas.',
      'Le « i » « Comment lire ce graphique », à côté du titre du graphique de la voiture, détaille le cas affiché, avec ses valeurs.',
      'Les autres trajets (« Trajet retenu », « Le moins cher », « Le moins de correspondances ») sont dans le bloc « Trajet » ; sans eux, le bloc écrit la raison : « Autres trajets : calculé, pas d\'autre trajet », « calcul fait, non affiché » ou « pas encore calculé » ; en réglage de marche confort, « Autres trajets : calculés pour le réglage de marche normal. » et le bouton « Voir en réglage normal ».',
      'Le « i » de « Trajet retenu » : c\'est le trajet qui sert à dire si le pôle est à portée, aller et retour ; ce n\'est pas toujours le moins cher ni celui avec le moins de correspondances.',
    ],
    shots: [
      {
        file: 'pli-cout',
        url: PROOF,
        viewport: 'xtall',
        steps: [fold('cout')],
        show: ['.proof-panel [data-group="cout"]'],
        alt: 'Le pli Abonnements du panneau d\'un astre, déplié, en transports en commun.',
      },
    ],
    keywords: 'prix ticket passe navigo abonnement employeur énergie essence co2 péage',
  },
  {
    id: 'pli-emplois',
    category: 'astre',
    title: 'Le pli « Emplois et recrutement »',
    purpose: 'Situer le pôle en postes salariés recensés par l\'INSEE, et voir qui y travaille déjà.',
    howTo: [
      'Le nombre de postes salariés (INSEE) du pôle est écrit sur la ligne du pli « Emplois et recrutement », même fermé.',
      'Sous le pli, une ligne donne les projets de recrutement du bassin : voir « Projets de recrutement ».',
      'Ouvrez le pli : « Ils y travaillent déjà » dit combien d\'habitants de votre commune qui ont un emploi travaillent dans ce pôle, et leur part parmi les habitants de la commune qui ont un emploi.',
    ],
    know: [
      'Ce sont des postes salariés recensés par l\'INSEE : ils ne disent rien des postes à pourvoir.',
      'Le « i » « Comment lire ce graphique », au bout de cette phrase, dit ce que montre la barre, rappelle que c\'est une pratique observée, pas une possibilité calculée, et donne le dénominateur et l\'année du recensement.',
      'Une valeur estimée est suivie de « estimation », avec sa marge quand elle est publiée.',
    ],
    shots: [
      {
        file: 'pli-emplois',
        url: PROOF,
        viewport: 'tall',
        steps: [fold('emplois'), { do: 'waitFor', sel: '.proof-panel .pf-flows' }],
        show: ['.proof-panel [data-group="emplois"] summary', '.proof-panel .pf-flows'],
        alt: 'Le pli Emplois et recrutement ouvert : les postes salariés (INSEE) du pôle sur sa ligne, puis les habitants de la commune qui ont un emploi et y travaillent déjà.',
      },
    ],
    keywords: 'emploi actifs',
  },
  {
    id: 'recrutement',
    category: 'astre',
    title: 'Projets de recrutement',
    purpose: 'Voir une tendance de recrutement à l\'échelle du bassin d\'emploi.',
    howTo: [
      'Sous le pli « Emplois et recrutement », même fermé, une ligne donne les projets de recrutement du bassin ; son « i » dit ce qu\'ils sont.',
      'Ouvrez le pli : le bloc « Projets de recrutement du bassin » les détaille par famille de métiers.',
      'Choisissez une famille de métiers pour filtrer.',
    ],
    know: [
      'Ce sont des intentions déclarées par les employeurs, pas des postes réels : le « i » de la ligne précise que ce ne sont ni des offres publiées, ni des embauches (écrit en clair avec le mode sources).',
      'Quand une case n\'est pas diffusée, le chiffre est un minimum, écrit « au moins » ; le « i » « Pourquoi « au moins » ? » l\'explique.',
      'À Paris, tous les arrondissements partagent un même bassin.',
      'Le pli « Champ et limites », en bas du bloc, dit ce que l\'enquête couvre et ne couvre pas.',
      'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.',
    ],
    shots: [
      {
        file: 'recrutement',
        url: PROOF,
        viewport: 'tall',
        steps: [fold('emplois'), { do: 'waitFor', sel: '.proof-panel .pf-recruit' }],
        show: ['.proof-panel .pf-recruit'],
        alt: 'Le bloc Projets de recrutement du bassin d\'emploi dans le panneau d\'un astre.',
      },
    ],
    keywords: 'bassin embauche métiers tendance',
  },
  {
    id: 'offres-public',
    category: 'astre',
    title: 'Offres du service public',
    purpose: 'Voir les offres diffusées par la fonction publique près d\'un pôle.',
    howTo: [
      'Dans le pli « Emplois et recrutement », descendez au bloc des offres.',
      'Cochez « Service public » pour les afficher.',
      '« Offres les plus récentes » déroule la liste.',
    ],
    know: [
      'Ces offres ne viennent que de la fonction publique : État, territoriale et hospitalière.',
      'Le « i » au bout du titre du bloc dit qu\'elles sont comptées à part des postes salariés (INSEE), à quelle date elles ont été relevées et quels versants de la fonction publique elles couvrent. Case cochée, « Comptées à part des postes salariés (INSEE). » est écrit sous la case.',
      'Une date de publication ne prouve pas que le poste est encore à pourvoir : le « i » du chiffre le rappelle.',
    ],
    shots: [
      {
        file: 'offres-public',
        url: PROOF,
        viewport: 'tall',
        steps: [fold('emplois'), { do: 'click', sel: '.proof-panel .pf-offers-toggle input' }, { do: 'waitFor', sel: '.proof-panel .pf-offers .pf-stat' }],
        show: ['.proof-panel .pf-offers'],
        alt: 'Le bloc des offres du service public dans le panneau d\'un astre.',
      },
    ],
    keywords: 'fonction publique concours fonctionnaire',
  },
  {
    id: 'pli-moyens',
    category: 'astre',
    title: 'Comparer les moyens',
    purpose: 'Comparer, sur ce même pôle, tous les modes calculés.',
    howTo: [
      'Ouvrez le pli « Comparer les moyens » : fermé, il dit combien de moyens de transport sont comparés.',
      'Le graphique range les moyens du plus court au plus long ; le tableau donne l\'aller, le retour, le coût et le carbone de chaque mode, et, quand le calcul est fait par pôle, le verdict pour le temps choisi.',
      'Le lien « afficher » d\'une ligne ouvre le ciel de ce mode, sans changer de pôle.',
    ],
    know: [
      'Les modes non calculés pour cette commune sont nommés sous le tableau.',
      'Le carbone est une estimation, écrit « (estimation) » pour les transports en commun comme pour la voiture (énergie seule).',
      'Le « i » « Ce que compte ce tableau » dit d\'où viennent les durées, le coût et le carbone ; commune par commune, il dit d\'abord vers quel arrêt vont les durées (écrit sous le tableau avec le mode sources).',
      'L\'heure creuse, en bas du pli, donne les temps en partant en milieu de journée ; son « i » dit pourquoi cette heure.',
      'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.',
    ],
    shots: [
      {
        file: 'pli-moyens',
        url: PROOF,
        viewport: 'xtall',
        steps: [fold('moyens')],
        show: ['.proof-panel [data-group="moyens"]'],
        alt: 'Le pli Comparer les moyens de transport avec un graphique des temps par mode.',
      },
    ],
    keywords: 'modes tableau',
  },
  {
    id: 'pli-methode',
    category: 'astre',
    title: 'Méthode et sources du panneau',
    purpose: 'Vérifier les conditions exactes du calcul de cet astre.',
    howTo: [
      'Ouvrez le pli « Méthode et sources ».',
      'En transports en commun, la première ligne donne le réglage de marche en vigueur, un choix de l\'équipe.',
      'Viennent ensuite le point de départ, l\'horaire et le temps choisi, puis, sous « Comment les temps sont calculés » (un « i »), les horaires théoriques du calcul, la méthode de l\'itinéraire et le point d\'arrivée. Avec le mode sources, ces phrases sont écrites en clair.',
      'Le « i » de la ligne de l\'horaire dit pourquoi ces journées-types : la part des salariés qui travaillent le soir ou la nuit, au niveau national.',
      'Le lien « Méthode », en bas du pli, ouvre « Sources & limites ».',
    ],
    know: [
      'Quand la durée ne dépend pas de l\'heure, c\'est dit ici, une seule fois.',
      'Le bilan du contrôle des correspondances est aussi dans ce pli.',
      'Le trajet réel dépend de votre adresse et des aléas du jour.',
      'Les sources de chaque bloc s\'affichent avec le mode sources.',
    ],
    shots: [
      {
        file: 'pli-methode',
        url: PROOF,
        viewport: 'tall',
        steps: [fold('methode')],
        show: ['.proof-panel [data-group="methode"]'],
        alt: 'Le pli Méthode et sources déplié.',
      },
    ],
    keywords: 'calcul point arrivée récapitulatif',
  },
  {
    id: 'actions-panneau',
    category: 'astre',
    title: 'Actions du panneau',
    purpose: 'Passer à la carte, recentrer le ciel ou copier le lien de cet astre.',
    howTo: [
      '« Voir sur la carte » montre ce pôle sur la carte des communes ; carte ouverte, le bouton devient « Revenir au ciel ».',
      '« Centrer sur ce pôle » cadre le ciel dessus (hors comparaison).',
      '« Copier le lien » ouvrira directement cet astre.',
    ],
    know: [
      'Sans le mode sources, le pied du panneau ne porte que ces boutons ; sur téléphone, il garde aussi la ligne qui nomme les producteurs des données, parce que la feuille du panneau cache celle du bas du ciel.',
      'Avec le mode sources, il rappelle aussi le mode, le réglage de marche et les producteurs des données affichées.',
      'En transports en commun, le réglage de marche est toujours rappelé en première ligne de « Méthode et sources ».',
    ],
    shots: [
      {
        file: 'actions-panneau',
        url: PROOF,
        viewport: 'tall',
        steps: [{ do: 'waitFor', sel: '.proof-panel .pf-actions' }],
        show: ['.proof-panel .pf-actions'],
        alt: 'Les boutons du pied du panneau : voir sur la carte, centrer, copier le lien.',
      },
    ],
  },

  // ---------- Mes réglages ----------
  {
    id: 'mes-besoins',
    category: 'mes-reglages',
    title: 'Ce qu\'il me faut sur mon trajet',
    purpose: 'Signaler, sur les trajets, ce dont vous avez besoin : accessibilité fauteuil, annonces sonores ou visuelles.',
    howTo: [
      'Ouvrez « Mes réglages », dans la barre du haut ou dans le tiroir de la barre de scénario, puis l\'onglet « Ce qu\'il me faut sur mon trajet ».',
      'Cochez vos besoins, puis « Enregistrer ». Les quatre premières cases (dont « Lignes déclarées climatisées ») posent une marque ; les annonces se lisent dans le panneau.',
      'Ouvrez un astre, en transports en commun : le pli du même nom détaille chaque trajet.',
    ],
    know: [
      'Ce réglage ne change ni les temps ni les états du ciel.',
      'Rien ne change avant « Enregistrer » ; Annuler, Échap ou la croix referment sans rien garder.',
      'Gardé dans ce navigateur, jamais dans le lien ; la visite guidée joue sans lui.',
      'Certaines cases restent grisées : il n\'existe pas de donnée ouverte.',
      'Dès qu\'une case est cochée, la légende du ciel le rappelle, avec un lien « Modifier » ; sans case cochée, elle n\'en dit rien.',
      'Sans besoin coché, le pli d\'un astre écrit : « Indiquez dans Mes réglages ce dont vous avez besoin sur un trajet : ce pli vous dira si celui-ci y répond. » ; « Mes réglages » y ouvre ce réglage.',
    ],
    shots: [
      {
        file: 'mes-besoins',
        url: SKY,
        viewport: 'tall',
        steps: [{ do: 'click', sel: '.subs-top' }, { do: 'waitFor', sel: '.subs-dialog' }, { do: 'click', sel: '.settings-tab:last-child' }, { do: 'waitFor', sel: '.pf-needs' }],
        show: ['.subs-dialog'],
        alt: 'Le dialogue Mes réglages sur l\'onglet des besoins, avec ses cases à cocher et le bouton Enregistrer.',
      },
    ],
    keywords: 'fauteuil handicap pmr annonces accessibilité ascenseur réglages enregistrer',
  },
  {
    id: 'mes-abonnements',
    category: 'mes-reglages',
    title: 'Mes abonnements',
    purpose: 'Dire ce que vous avez déjà pour que le coût affiché en tienne compte.',
    howTo: [
      'Ouvrez « Mes réglages », dans la barre du haut ou dans le tiroir de la barre de scénario, sur l\'onglet « Mes abonnements ».',
      'Sélectionnez votre titre de transport, et votre formule Vélib\' si vous en avez une.',
      '« Enregistrer » applique le choix : le coût dans le panneau d\'un astre est ajusté.',
    ],
    know: [
      'Le réglage ne change pas le ciel, seulement le coût affiché.',
      'Rien ne change avant « Enregistrer » ; Annuler, Échap ou la croix referment sans rien garder.',
      'Gardé dans ce navigateur, jamais dans le lien ; la visite guidée joue sans lui.',
      'La prise en charge par l\'employeur est expliquée, jamais déduite du coût affiché.',
    ],
    shots: [
      {
        file: 'mes-abonnements',
        url: SKY,
        viewport: 'tall',
        steps: [{ do: 'click', sel: '.subs-top' }, { do: 'waitFor', sel: '.subs-dialog' }],
        show: ['.subs-dialog'],
        alt: 'Le dialogue Mes réglages sur l\'onglet des abonnements, avec la liste des titres de transport et le bouton Enregistrer.',
      },
    ],
    keywords: 'navigo forfait abonnement tarif réglages enregistrer',
  },

  // ---------- Derrière notre étoile ----------
  {
    id: 'derriere',
    category: 'derriere',
    title: 'Ouvrir « Derrière notre étoile »',
    purpose: 'Découvrir le profil de la commune choisie.',
    howTo: [
      'Cliquez sur votre commune, l\'étoile-guide, dans le ciel.',
      'Choisissez un onglet.',
      'Échap ou la croix referme le panneau.',
    ],
    know: [
      'Ces statistiques décrivent la commune : aucun lien de cause avec l\'accessibilité.',
      'En bas de chaque onglet, une ligne courte donne la base de la statistique et son année ; le « i » « Portée de cette statistique » donne le dénominateur complet et la portée, écrits en clair avec le mode sources.',
      'En comparaison, les deux communes sont côte à côte, avec le dénominateur de chacune écrit.',
    ],
    shots: [
      {
        file: 'derriere',
        url: `${SKY}&h=age`,
        steps: [{ do: 'waitFor', sel: '.halo-panel .halo-tabs' }],
        show: ['.halo-panel'],
        frame: 'page',
        alt: 'Le panneau Derrière notre étoile ouvert à côté du ciel, avec ses onglets.',
      },
    ],
    keywords: 'halo profil population commune',
  },
  {
    id: 'onglet-ages',
    category: 'derriere',
    title: 'Onglet Âges',
    purpose: 'Voir la répartition de la population par âge.',
    howTo: ['Onglet « Âges » de « Derrière notre étoile ».', '« Valeurs détaillées » donne les chiffres.'],
    know: ['En bas de l\'onglet, une ligne courte donne la base, le nombre d\'habitants, et l\'année du recensement ; le « i » « Portée de cette statistique » donne la phrase complète du dénominateur.', 'Une phrase sous l\'anneau redit la part des femmes et des hommes.', 'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.'],
    shots: [
      {
        file: 'onglet-ages',
        url: `${SKY}&h=age`,
        viewport: 'tall',
        steps: [{ do: 'waitFor', sel: '.halo-panel .halo-visual' }],
        show: ['.halo-body'],
        alt: 'L\'onglet Âges avec son anneau et ses valeurs.',
      },
    ],
  },
  {
    id: 'onglet-modes',
    category: 'derriere',
    title: 'Onglet Modes domicile-travail',
    purpose: 'Voir comment les habitants de la commune qui ont un emploi vont travailler.',
    howTo: ['Onglet « Modes domicile-travail ».', 'Une ligne par mode, par sexe.'],
    know: ['Le dénominateur est celui des habitants qui ont un emploi (actifs occupés), pas de toute la population : en bas de l\'onglet, une ligne courte donne le nombre de femmes et d\'hommes qui ont un emploi et l\'année du recensement ; le « i » « Portée de cette statistique » donne la phrase complète.', 'Une valeur peu précise est signalée « estimation imprécise » dans « Valeurs détaillées ».', 'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.'],
    shots: [
      {
        file: 'onglet-modes',
        url: `${SKY}&h=commute`,
        viewport: 'tall',
        steps: [{ do: 'waitFor', sel: '.halo-panel .halo-visual' }],
        show: ['.halo-body'],
        alt: 'L\'onglet des modes domicile-travail, une ligne par mode pour les femmes et les hommes.',
      },
    ],
  },
  {
    id: 'onglet-niveau',
    category: 'derriere',
    title: 'Onglet Niveau de vie',
    purpose: 'Situer la commune parmi celles d\'Île-de-France.',
    howTo: ['Onglet « Niveau de vie ».', 'Deux bandes, niveau de vie médian et taux de pauvreté : un point par commune, la vôtre est marquée.'],
    know: ['En bas de l\'onglet, une ligne courte donne la base, les personnes des ménages fiscaux, et l\'année ; le « i » « Portée de cette statistique » donne le dénominateur complet et la portée.', 'Une valeur peut ne pas être publiée (secret statistique ou effectif trop faible) : le panneau le dit.', 'La hauteur d\'un point ne porte aucune donnée.', 'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.'],
    shots: [
      {
        file: 'onglet-niveau',
        url: `${SKY}&h=income`,
        viewport: 'tall',
        steps: [{ do: 'waitFor', sel: '.halo-panel .income-ranks' }],
        show: ['.halo-body'],
        alt: 'L\'onglet Niveau de vie, la commune placée parmi les communes de la région.',
      },
    ],
    keywords: 'revenu pauvreté rang',
  },
  {
    id: 'onglet-chomage',
    category: 'derriere',
    title: 'Onglet Chômage',
    purpose: 'Situer le chômage de la zone d\'emploi de la commune.',
    howTo: ['Onglet « Chômage ».', 'En tête, le taux de la zone d\'emploi, suivi de « (provisoire) » quand le dernier trimestre l\'est.', 'La bande compare les zones d\'emploi ; la courbe suit le temps.'],
    know: [
      'Les valeurs sont celles de la zone d\'emploi, pas de la commune.',
      'En bas de l\'onglet, une ligne courte donne la base : la population active estimée au lieu de résidence.',
      'Le « i » « Portée de cette statistique », à côté du taux, donne le dénominateur complet, rappelle que le taux parle des habitants et non des emplois d\'un astre, sans lien de cause, et dit quand le trimestre est provisoire.', 'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.'],
    shots: [
      {
        file: 'onglet-chomage',
        url: `${SKY}&h=unemployment`,
        viewport: 'tall',
        steps: [{ do: 'waitFor', sel: '.halo-panel .terr-strip' }],
        show: ['.halo-body'],
        alt: 'L\'onglet Chômage avec la bande des zones d\'emploi et la courbe d\'évolution.',
      },
    ],
    keywords: 'zone emploi taux',
  },
  {
    id: 'reperes-territoire',
    category: 'derriere',
    title: 'Repères de territoire',
    purpose: 'Situer la commune dans l\'organisation de la région.',
    howTo: [
      'Une ligne sous le nom de la commune donne sa polarité dans le schéma régional, si elle en a une.',
      'Le « i » explique ce qu\'est une polarité.',
      'Le « i » des journées-types rappelle que ce sont des scénarios hypothétiques, puis dit la part des salariés qui travaillent le soir et la nuit.',
    ],
    know: ['Une polarité est un fait de planification : ce n\'est pas un classement d\'accessibilité.', 'Une commune sans polarité n\'affiche rien.'],
    shots: [
      {
        file: 'reperes-territoire',
        url: '/?o=95018&d=d09&b=45&m=transit&h=age',
        steps: [{ do: 'waitFor', sel: '.halo-panel .terr-polarity-block' }],
        show: ['.halo-panel header', '.terr-polarity-block'],
        alt: 'L\'en-tête du panneau Derrière notre étoile avec la ligne de polarité sous le nom de la commune.',
      },
    ],
    keywords: 'polarité schéma régional planification',
  },

  // ---------- Autres lectures ----------
  {
    id: 'decouvertes',
    category: 'lectures',
    title: 'Découvertes',
    purpose: 'Ouvrir en un clic des scénarios remarquables, calculés sur les données.',
    howTo: [
      'Choisissez « Découvertes » dans la barre du haut.',
      'Cliquez sur une carte : le scénario se joue dans le ciel.',
      'Une puce en haut du ciel permet de la revoir ou de la fermer.',
    ],
    know: [
      'Ces découvertes sont calculées, pas écrites à la main.',
      'Certaines peuvent être indisponibles : la raison est donnée.',
      'Une carte « Deux voisines, deux horizons » peut proposer une comparaison, une fois par session, quand un écart a été vérifié.',
    ],
    shots: [
      {
        file: 'decouvertes',
        url: SKY,
        viewport: 'tall',
        steps: [{ do: 'click', sel: '.insights .btn' }, { do: 'waitFor', sel: '#insights-list' }],
        show: ['#insights-list'],
        alt: 'La liste des découvertes ouverte depuis la barre du haut.',
      },
    ],
    keywords: 'insights remarquable éclipse écart gain contraste du jour',
  },
  {
    id: 'carte-miroir',
    category: 'lectures',
    title: 'La carte miroir',
    purpose: 'Situer les pôles sur la vraie carte des communes.',
    howTo: [
      'Bouton « Voir la carte » de la barre du haut (icône de carte), ou touche M.',
      'Glissez, zoomez à la molette ou avec les touches plus, moins et les flèches.',
      'Carte ouverte, le même bouton devient « Revenir au ciel », avec une étoile : lui, la touche M ou Échap ramènent au ciel.',
    ],
    know: ['La carte et le ciel montrent le même scénario.', 'Le lien partagé peut ouvrir directement la carte.', 'Le « i » « Comment lire ce graphique », à côté du titre du graphique, dit ce que montre chaque élément puis détaille un cas précis, avec les valeurs affichées.'],
    shots: [
      {
        file: 'carte-miroir',
        url: `${SKY}&v=map`,
        steps: [{ do: 'waitFor', sel: '.mirror-svg' }, { do: 'wait', ms: 7000 }],
        show: ['.mirror-svg'],
        frame: 'page',
        alt: 'La carte des communes d\'Île-de-France, avec les pôles posés sur leur territoire.',
      },
    ],
    keywords: 'map géographie territoire',
  },
  {
    id: 'liste',
    category: 'lectures',
    title: 'Lire le ciel en liste',
    purpose: 'Avoir le ciel en tableau, triable et lisible au lecteur d\'écran.',
    howTo: [
      'Bouton « Liste » de la barre du haut.',
      'Cliquez sur un titre de colonne pour trier.',
      'Le nom d\'un pôle ouvre son panneau de preuve.',
    ],
    know: ['Le tableau reste à jour quand le scénario change.', 'Survoler une ligne surligne l\'astre dans le ciel.'],
    shots: [
      {
        file: 'liste',
        url: SKY,
        viewport: 'tall',
        steps: [{ do: 'click', sel: '.top-actions button[aria-label="Lire le ciel en liste"]' }, { do: 'waitFor', sel: '.sky-table' }],
        show: ['.sky-list-panel'],
        alt: 'Le ciel en tableau : état, pôle, postes, postes atteints et part.',
      },
    ],
    keywords: 'tableau trier lecteur d\'écran',
  },

  // ---------- Partager ----------
  {
    id: 'lien',
    category: 'partager',
    title: 'Partager par lien',
    purpose: 'Envoyer exactement le scénario que vous regardez.',
    howTo: [
      'Dépliez les réglages et choisissez « Copier le lien », ou utilisez celui du panneau d\'un astre.',
      'Collez-le : la personne ouvre le même ciel.',
    ],
    know: ['L\'adresse contient la commune, les horaires, le temps, le mode et l\'astre ouvert.', 'Vos besoins, abonnements, couleurs adaptées et mode sources ne sont pas transmis.'],
    shots: [
      {
        file: 'lien',
        url: SKY,
        viewport: 'tall',
        steps: [DRAWER, { do: 'waitFor', sel: '.drawer-copy' }],
        show: ['.drawer-link'],
        highlight: ['.drawer-copy'],
        alt: 'Le bouton Copier le lien dans les réglages du scénario.',
      },
    ],
    keywords: 'url partage scénario adresse',
  },
  {
    id: 'affiche',
    category: 'partager',
    title: 'Exporter une affiche',
    purpose: 'Enregistrer une image du ciel, avec le scénario en clair.',
    howTo: [
      'Bouton « Affiche » de la barre du haut.',
      'Choisissez l\'image ordinaire ou haute définition, ou copiez le texte de l\'affiche.',
    ],
    know: ['Désactivée si le scénario n\'a pas de résultat.', 'Pendant une comparaison, les deux ciels doivent être calculés.'],
    shots: [
      {
        file: 'affiche',
        url: SKY,
        steps: [{ do: 'click', sel: '.poster-menu .btn' }, { do: 'waitFor', sel: '.poster-list' }],
        show: ['.poster-menu', '.poster-list'],
        alt: 'Le menu du bouton Affiche ouvert, avec les formats disponibles.',
      },
    ],
    keywords: 'image png télécharger exporter poster',
  },

  // ---------- Visite ----------
  {
    id: 'visite',
    category: 'visite',
    title: 'Lancer la visite guidée',
    purpose: 'Suivre un cas raconté, du début à la fin, dans le site lui-même.',
    howTo: [
      '« Lancer la visite », sur l\'écran d\'accueil ou dans la barre du haut.',
      'Choisissez la version courte, celle présentée au jury (le défi et l\'essentiel du récit), ou la version complète, où chaque écran est expliqué.',
      'Le récit pilote le ciel, avec sous-titres.',
      'À la fin, le ciel est à vous.',
    ],
    know: [
      'Les deux versions présentent le défi des mobilités et de l\'emploi et finissent sur « Nous vivons tous sous le même ciel. À vous, maintenant, de découvrir vos étoiles. »',
      'La version courte est celle présentée au jury.',
      'Léa, l\'habitante de la visite, est fictive ; les chiffres sont réels. Son prénom s\'affiche sous l\'étoile-guide.',
      'Un repère lumineux entoure, à l\'écran, ce dont parle la voix ; le reste de l\'interface s\'atténue pendant la visite.',
      'Une action de votre part met la visite en pause.',
      'Échap referme le choix sans lancer la visite.',
      'La visite joue sans vos réglages : ils reviennent à la fin.',
    ],
    shots: [
      {
        file: 'visite',
        url: SKY,
        steps: [{ do: 'click', sel: '.top-actions .btn-tour' }, { do: 'click', sel: '.tour-choice-option[data-tour-version="lea"]' }, { do: 'waitFor', sel: '.tour-overlay .tour-subtitle' }, { do: 'wait', ms: 1500 }],
        show: ['.tour-overlay'],
        frame: 'page',
        alt: 'La visite guidée en cours, avec les sous-titres en bas de l\'écran.',
      },
    ],
    keywords: 'histoire récit léa narration',
  },
  {
    id: 'visite-commandes',
    category: 'visite',
    title: 'Les commandes de la visite',
    purpose: 'Reprendre la main pendant le récit.',
    howTo: [
      'Boutons, sous les sous-titres : étape précédente, pause ou reprendre, étape suivante, quitter.',
      'Quand la voix est disponible, le bouton « Voix » la coupe, les sous-titres restent.',
    ],
    know: ['Le bouton son de la barre du haut ne règle que l\'ambiance : la voix a son propre bouton.'],
    shots: [
      {
        file: 'visite-commandes',
        url: SKY,
        steps: [{ do: 'click', sel: '.top-actions .btn-tour' }, { do: 'click', sel: '.tour-choice-option[data-tour-version="lea"]' }, { do: 'waitFor', sel: '.tour-overlay .tour-controls' }, { do: 'click', sel: '.tour-controls button[aria-label="Pause"]' }, { do: 'wait', ms: 500 }],
        show: ['.tour-controls'],
        alt: 'Les boutons de la visite : précédent, pause ou reprendre, suivant, quitter.',
      },
    ],
    keywords: 'pause voix quitter sous-titres',
  },

  // ---------- Confort ----------
  {
    id: 'mode-sources',
    category: 'confort',
    title: 'Mode sources',
    purpose: 'Afficher, sous chaque chiffre, sa source, son millésime et le lien vers sa fiche.',
    howTo: [
      'Bouton « Provenance des données » de la barre du haut.',
      'Une ligne de sources s\'ajoute à la bande sous le ciel ; chaque bloc du panneau d\'un astre porte sa source.',
      'Cliquez sur une source pour ouvrir sa fiche dans « Sources & limites ».',
    ],
    know: [
      'Sans le mode sources, restent écrits la valeur, son unité, le verdict et les courtes réserves (« estimation », « non calculé », « aller et retour », « au moins », « provisoire »…) ; les autres précisions (portée, méthode, dénominateur complet, millésime) sont dans les « i ».',
      'Avec le mode sources, ces précisions sont écrites en clair, au même endroit, et le pied du panneau d\'un astre rappelle le mode, le réglage de marche et les producteurs des données.',
      'Le crédit du tarif reste toujours écrit à côté de chaque montant de péage.',
      'Avec ou sans le mode sources, la bande sous le ciel nomme les producteurs des données du scénario et du panneau ouvert.',
      'Il ne change ni le ciel, ni les données, ni le lien.',
      'Coupé par défaut pour alléger la lecture.',
    ],
    shots: [
      {
        file: 'mode-sources',
        url: `${PROOF}&src=1`,
        steps: [{ do: 'waitFor', sel: '#prov-sky' }, { do: 'waitFor', sel: '.proof-panel .prov-note' }],
        show: ['.proof-panel'],
        frame: 'page',
        highlight: ['#prov-sky'],
        alt: 'Le site en mode sources : une ligne de provenance dans la bande sous le ciel et une ligne de source dans le panneau.',
      },
    ],
    keywords: 'provenance origine données fiche',
  },
  {
    id: 'daltonisme',
    category: 'confort',
    title: 'Couleurs adaptées au daltonisme',
    purpose: 'Rendre l\'or et les contrastes distinguables quelle que soit votre vision des couleurs.',
    howTo: ['Bouton en forme de disque à moitié plein, dans la barre du haut.', 'Le choix est gardé pour vos prochaines visites.'],
    know: ['Seules des couleurs changent : les formes, les états et les places restent identiques.'],
    shots: [
      {
        file: 'daltonisme',
        url: `/?o=${O}&d=d09&b=60&m=bike_transit&cv=1`,
        show: ['.legend > li:first-child', '.legend li:has-text("gain démontré")'],
        alt: 'La légende avec les couleurs adaptées au daltonisme.',
      },
    ],
    keywords: 'couleur vision protanopie deutéranopie tritanopie',
  },
  {
    id: 'reduire-animations',
    category: 'confort',
    title: 'Réduire les animations',
    purpose: 'Enlever les mouvements du ciel, sans rien perdre d\'information.',
    howTo: ['Bouton « Réduire les animations » de la barre du haut.', 'Il suit aussi le réglage de votre système.'],
    know: ['Sans parallaxe, scintillement ni traînées ; les transitions deviennent de simples fondus.'],
    shots: [
      {
        file: 'reduire-animations',
        url: SKY,
        show: ['.top-actions'],
        highlight: ['.top-bar button[aria-pressed][aria-label*="nimations"]'],
        alt: 'Le bouton de réduction des animations dans la barre du haut.',
      },
    ],
    keywords: 'mouvement réduit épilepsie vertige',
  },
  {
    id: 'son',
    category: 'confort',
    title: 'Le son d\'ambiance',
    purpose: 'Ajouter une ambiance et des bruitages, si vous le souhaitez.',
    howTo: ['Bouton à haut-parleur de la barre du haut.', 'Rien ne joue avant votre premier geste.'],
    know: ['Le son ne porte aucune information : le couper ne retire rien.'],
    shots: [
      {
        file: 'son',
        url: SKY,
        show: ['.top-actions'],
        highlight: ['.top-bar button[aria-label="Son d\'ambiance"]'],
        alt: 'Le bouton du son d\'ambiance dans la barre du haut.',
      },
    ],
    keywords: 'audio musique volume',
  },
  {
    id: 'raccourcis',
    category: 'confort',
    title: 'Raccourcis clavier',
    purpose: 'Tout faire au clavier.',
    howTo: ['Tab parcourt les boutons et les astres, Entrée active.', 'Échap referme ce qui est ouvert, le plus récent d\'abord.'],
    know: [
      'Le premier appui sur Tab propose « Aller à la barre de scénario » : un raccourci vers les réglages, sans passer par chaque astre.','Le focus est toujours visible.', 'Un lecteur d\'écran annonce le résumé du ciel à chaque changement.'],
    shortcuts: [
      { keys: 'Tab / Maj + Tab', does: 'Passer à l\'élément suivant ou précédent' },
      { keys: 'Entrée', does: 'Ouvrir l\'astre, valider le choix' },
      { keys: 'Échap', does: 'Fermer le panneau, la bulle, le tiroir ou l\'aide' },
      { keys: 'Flèches sur un astre', does: 'Passer à l\'astre voisin dans cette direction' },
      { keys: 'Flèches haut et bas dans la recherche', does: 'Parcourir les communes proposées' },
      { keys: 'Flèches gauche et droite', does: 'Changer d\'onglet dans « Derrière notre étoile »' },
      { keys: 'Flèches, Début, Fin sur une jauge', does: 'Changer la valeur d\'un pas, ou aller aux bornes' },
      { keys: 'Page précédente, Page suivante sur une jauge', does: 'Sauter un repère ou une heure' },
      { keys: 'M', does: 'Ouvrir ou fermer la carte' },
      { keys: 'Plus, Moins, Zéro sur la carte', does: 'Zoomer, dézoomer, revenir à la vue d\'ensemble' },
      { keys: 'Flèches sur la carte', does: 'Déplacer la carte' },
    ],
    shots: [
      {
        file: 'raccourcis',
        url: SKY,
        steps: [{ do: 'focus', sel: '.pole-layer .pole-hit' }, { do: 'wait', ms: 300 }],
        show: ['.pole-tip'],
        alt: 'Un astre avec le focus clavier et son infobulle.',
      },
    ],
    keywords: 'clavier tabulation lecteur d\'écran',
  },

  // ---------- Sources et méthode ----------
  {
    id: 'sources-limites',
    category: 'methode',
    title: 'Sources & limites',
    purpose: 'Comprendre ce que montre le ciel, ses limites et sa méthode.',
    howTo: [
      'Lien « Sources & limites » de la barre du haut ; sur téléphone, dans le menu à trois traits.',
      'Le sommaire mène aux limites, aux données, au traitement et aux licences.',
      'Une fois descendu dans la page, « Retour en haut », en bas à droite, ramène au titre et au sommaire.',
      'Une ligne de source, en mode sources, ouvre directement sa fiche.',
    ],
    know: ['Le ciel est un calcul sur des données ouvertes, pour une journée type : il ne garantit aucun trajet réel.'],
    shots: [
      {
        file: 'sources-limites',
        url: SKY,
        viewport: 'tall',
        steps: [{ do: 'click', sel: SOURCES_LINK }, { do: 'waitFor', sel: '#sources-title' }],
        show: ['.drawer'],
        alt: 'Le tiroir Sources et limites ouvert, avec son sommaire.',
      },
    ],
    keywords: 'méthode licences limites données calcul',
  },
];

/**
 * Couverture des fonctions : à chaque élément repéré dans le code correspond l'entrée de l'aide qui l'explique. `guide.manifest.test.ts`
 * relit le code : une fonction ajoutée sans entrée ici fait échouer le test, une ligne devenue fausse aussi.
 * `technical` : composants sans fonction pour l'utilisateur.
 */
export const GUIDE_COVERAGE = {
  /** Composants et boutons de la barre du haut (TopBar.tsx) */
  topBar: {
    Insights: 'decouvertes',
    TourButton: 'visite',
    MirrorMapButton: 'carte-miroir',
    PosterButton: 'affiche',
    SubscriptionsButton: 'mes-abonnements',
    SoundToggle: 'son',
    ColorVisionToggle: 'daltonisme',
    ProvenanceToggle: 'mode-sources',
    ReducedMotionToggle: 'reduire-animations',
    GuideButton: 'aide',
    Logo: 'accueil',
    SkyList: 'liste',
    'Lire le ciel en liste': 'liste',
    'Sources & limites': 'sources-limites',
    Menu: 'telephone',
  },
  /** Plis du panneau de preuve (`PfGroup` de ProofPanel.tsx) */
  folds: {
    communes: 'pli-communes',
    cout: 'pli-cout',
    emplois: 'pli-emplois',
    besoins: 'mes-besoins',
    moyens: 'pli-moyens',
    methode: 'pli-methode',
  },
  /** Cellules de la barre du scénario et de son tiroir (ScenarioBar.tsx) */
  bar: {
    origin: 'commune',
    day: 'journee',
    budget: 'temps-trajet',
    mode: 'modes',
    counter: 'compteur',
    modepick: 'modes',
    shift: 'horaires-libres',
    compare: 'comparer',
    ref: 'pied-velo',
    link: 'lien',
  },
  /** Onglets de « Derrière notre étoile » (HALO_DIMENSIONS) */
  haloTabs: {
    age: 'onglet-ages',
    commute: 'onglet-modes',
    income: 'onglet-niveau',
    unemployment: 'onglet-chomage',
  },
  /** Modes de transport (`MODE_IDS` de state/url.ts) */
  modes: {
    transit: 'modes',
    bike_transit: 'velo-tc',
    bike: 'pied-velo',
    walk: 'pied-velo',
    car: 'voiture',
    car_traffic: 'voiture',
    velib: 'velib',
  },
  /** Commandes de la visite (`aria-label` de TourOverlay.tsx) */
  tourControls: ['Étape précédente', 'Pause', 'Reprendre', 'Étape suivante', 'Quitter la visite', 'Voix'],
  /** Paramètres d'un lien partagé (`SCENARIO_KEYS` de state/url.ts) */
  urlParams: {
    o: 'commune',
    d: 'journee',
    b: 'temps-trajet',
    m: 'modes',
    vs: 'comparer',
    p: 'ouvrir-astre',
    h: 'derriere',
    w: 'marche',
    s: 'horaires-libres',
    e: 'horaires-libres',
    vh: 'vehicule',
  },
  /** Touches gérées par le code (`e.key` des composants), décrites dans « Raccourcis clavier » */
  keys: ['Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'm', 'M', '+', '=', '-', '_', '0', 'à', 'Tab', 'Home', 'End'],
  /** Composants montés par App.tsx */
  app: {
    ContrastOfTheDay: 'decouvertes',
    InsightChip: 'decouvertes',
    HaloPanel: 'derriere',
    Legend: 'etats',
    PoleLayer: 'astres',
    ProofPanel: 'ouvrir-astre',
    MySettings: 'mes-abonnements',
    SkipLink: 'raccourcis',
    ScenarioBar: 'vue-ensemble',
    SkyCanvas: 'astres',
    SkyNotice: 'ciel-neutre',
    SkyCredit: 'mode-sources',
    SkySummary: 'raccourcis',
    SourcesDrawer: 'sources-limites',
    TitleScreen: 'accueil',
    TopBar: 'vue-ensemble',
    TourOverlay: 'visite-commandes',
    ZoomControls: 'zoom',
    MirrorMap: 'carte-miroir',
    Diptych: 'comparer',
  },
  technical: ['MotionConfig', 'AnimatePresence', 'Suspense', 'DemoBanner', 'FpsMeter', 'FeaturesToast', 'RecordDirector', 'TourResume'],
} as const;
