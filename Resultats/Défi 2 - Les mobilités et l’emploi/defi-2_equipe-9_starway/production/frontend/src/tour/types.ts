import type { Scenario } from '../state/scenario';
import type { TourMark } from './marks';

export type TourAct = 'prologue' | 'acte1' | 'acte2' | 'acte3' | 'halo' | 'acte4' | 'epilogue';

export interface TourStep {
  id: string;
  act: TourAct;
  /** État appliqué via applyScenario - exactement comme un utilisateur */
  state: Partial<Scenario>;
  /**
   * Narration à variables, ex. « {access.poleCount} pôles s'allument ».
   * Variables : voir variables.ts. Aucune donnée en dur.
   */
  narration: string;
  /** Durée minimale d'affichage (ms) */
  minDurationMs?: number;
  /**
   * La voix démarre sans attendre que le ciel ait fini de se poser : pour une étape dont le texte ne décrit rien de l'écran (épilogue). Évite
   * le silence entre la dernière séquence et l'épilogue (retour de Cyril du 12/11 : « comme une coupure »). Jamais pour une étape qui dit où regarder.
   */
  voiceOverSky?: boolean;
  /**
   * false = ciel non révélé pendant l'étape (astres neutres, prologue). Défaut : true.
   * Le halo (`state.halo`) est lui aussi propre à l'étape : fermé s'il n'est pas demandé.
   */
  reveal?: boolean;
  /**
   * Pôle suivi par l'étape (identifiant de poles.json) : étoile filante une fois le ciel posé.
   * Vérifié contre les données par npm run tour:resolve.
   */
  focusPole?: string;
  /**
   * Vue de l'étape : ciel (défaut) ou carte miroir. La carte change la vue, jamais l'état ; le lecteur
   * attend la fin de la chorégraphie (mapPhase) avant la narration. Ignoré par npm run tour:resolve.
   */
  view?: 'sky' | 'map';
  /** Section du panneau de preuve à faire défiler et souligner : flux INSEE EMP02, ou projets de recrutement (BMO). Facultatif. */
  proofFocus?: 'flows' | 'recruit';
  /**
   * Révélation de l'acte 1 (D-018) : la jauge part du plus petit cran (`meta.outbound_step_min`) et glisse
   * jusqu'à `state.budget` pendant la narration, avec la mise à jour légère du glisser, puis la transition
   * complète. Mouvement réduit : pas de glisser. npm run tour:resolve ne lit que l'état final.
   */
  budgetSweep?: { from: 'min' };
  /**
   * Variables de contrôle (non prononcées) et valeur attendue, ex. { 'pole.legCase': 'retour' } : vérifie
   * qu'une constante de variante du script correspond aux données. Un écart arrête la visite et
   * npm run tour:resolve, comme une variable manquante.
   */
  checks?: Readonly<Record<string, string>>;
  /**
   * Plis du panneau de preuve que l'étape commente (identifiants de `PfGroup` : `communes`, `cout`, `emplois`, `besoins`, `moyens`,
   * `methode` ; ou `trajet` : « Détail du trajet », climatisation et ponctualité de chaque ligne) : ils s'ouvrent pendant l'étape et se
   * referment à la suivante (lot 5, D-052). Un `proofFocus` ouvre déjà le pli de son élément : `openFold` sert aux étapes qui commentent
   * un pli sans souligner un élément précis.
   */
  openFold?: readonly string[];
  /**
   * Repères visuels de l'étape (retour de Cyril du 10/11) : pendant la narration, l'élément dont parle la voix est entouré
   * (anneau ou cadre accent), le reste de l'interface légèrement voilé (jamais le ciel). `at` est un fragment du texte
   * `narration` (variables comprises), jamais un temps : le repère s'allume quand la voix arrive au fragment (cues WebVTT
   * de l'étape) et dure jusqu'au repère suivant ou à la fin de l'étape. Cibles nommées : voir `tour/marks.ts`. Décoratif
   * (aria-hidden), facultatif ; un fragment introuvable fait échouer `marks.test.ts`.
   */
  marks?: readonly TourMark[];
}

export interface TourScript {
  id: string;
  title: string;
  /** Voix Azure AI Speech (audio pré-généré plus tard, tools/tour-tts) */
  voice?: string;
  disclaimer: string;
  /**
   * false tant que le cas n'est pas choisi dans insights.json après le GO données :
   * le bouton affiche « bientôt » (sauf en mode démo, pour tester le lecteur).
   */
  ready: boolean;
  /**
   * Prénom FICTIF du personnage de la visite (ex. « Léa ») : affiché en petit sous le nom de l'étoile-guide (ciel A) pendant la
   * visite seulement, pour que l'écran montre qui la voix présente. Jamais en exploration libre. Facultatif.
   */
  persona?: string;
  /** Code BMO (France Travail) du métier visé par le cas, pour l'étape « recrutement » (variables `bmo.*`). Facultatif. */
  bmoMetier?: string;
  steps: TourStep[];
}
