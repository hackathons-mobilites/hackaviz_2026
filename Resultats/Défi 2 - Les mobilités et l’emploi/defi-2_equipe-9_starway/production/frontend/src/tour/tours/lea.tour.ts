import type { Scenario } from '../../state/scenario';
import type { TourMark } from '../marks';
import type { TourScript, TourStep } from '../types';

/**
 * « Le ciel de Léa » - script v4 « défi » (04/11/2026, demande de Nicolas : des cas précis et des mots du brief
 * qui font reconnaître le défi n° 2 « Les mobilités et l'emploi »). Texte de référence : docs/storyboard.md ;
 * correspondance brief -> acte -> cas -> chiffre -> phrase, et requête qui trouve chaque cas :
 * docs/storyboard.md § 0 et pipeline/scripts/08c_tour_challenge_cases.py.
 *
 * Léa est une habitante FICTIVE. Ses attributs (LEA_PROFILE) sont des CHOIX DE SCÉNARIO, écrits comme tels ;
 * chaque chiffre prononcé est une variable résolue depuis les données (variables.ts), jamais une valeur écrite
 * ici. Les constantes sont soit des paramètres de scénario (ce qu'un utilisateur choisirait), soit des choix de
 * variante de texte, chacun contrôlé contre les données (`checks` de l'étape) : npm run tour:resolve et le
 * lecteur s'arrêtent si la donnée ne correspond plus.
 *
 * Vocabulaire D-025 : à l'oral, « temps de trajet », jamais « budget » ; jamais « offres d'emploi » ni « opportunités
 * d'emploi ». Depuis le 11/11 (17h), la voix dit « postes salariés recensés par l'INSEE » à sa seule mention (acte1-ciel) ;
 * l'écran dit « postes salariés (INSEE) » (légende du compteur, D-065). BMO : « projets de recrutement », « recrutements prévus ». Écrit pour l'oreille (docs/voix-narration.md) : phrases
 * courtes, la ponctuation porte l'intonation. Textes de la vidéo réécrits le 10/11 (retours de l'équipe : discours
 * plus fluide, on doit savoir où regarder) : une idée par phrase, au plus un chiffre par phrase, chaque étape
 * commence par ce qui change à l'écran et la voix dit où se lit le chiffre (positions vérifiées dans components/).
 * Ne jamais citer un `id` de découverte ici : les rangs changent à chaque export.
 *
 * 11/11 (demande de Nicolas, docs/storyboard.md § 0.11) : la COURTE (`lea-video`, démonstration du jury, environ 3 min
 * avec les transitions) présente de nouveau le défi (prologue, besoins du monde du travail ; les moyens de transport
 * sont retirés de la courte depuis la mesure du 11/11) ; la COMPLÈTE (`lea`, 5 min 39 mesurées avec les transitions) reprend les explications de la version longue de l'historique
 * (population de la région, point de départ, pratique observée, journées-types, recoupement, sources).
 */

/* ------------------------------------------------------------------ profil de Léa (fiction assumée) */

/**
 * Attributs de Léa : des choix de scénario, pas des données. Chacun fait passer Léa par un point du défi
 * (storyboard § 0). Les chiffres qu'elle rencontre viennent tous des données.
 * - commune : Maisons-Laffitte (D-020), vélo + TC calculé (04b), trajets recoupés avec Navitia ;
 * - situation : elle cherche un emploi (« élargir le périmètre de recherche d'emploi », brief) ;
 * - métier visé : aide de cuisine, métier BMO S1X20 « Aides de cuisine et employés polyvalents de la
 *   restauration » (famille V, la famille qui compte le plus de projets de recrutement en IDF dans BMO 2026 ;
 *   S1X20 est le métier de la famille V le plus recherché dans le bassin T1 Paris, celui du pôle suivi) ;
 * - horaires : le poste proposé est en 14h-22h (journée-type d14, scénario) ;
 * - temps de trajet : 60 min par sens ; moyens de transport : transports en commun, pas de voiture, un vélo personnel ;
 * - abonnement, besoin d'accessibilité : non utilisés (chantier abonnements ; données handicap en attente).
 */
export const LEA_PROFILE = {
  /** Prénom fictif, affiché sous l'étoile-guide pendant la visite (TourScript.persona) */
  name: 'Léa',
  origin: '78358',
  situation: 'cherche un emploi',
  bmoMetier: 'S1X20',
  /** Famille de ce métier (champ `family` de bmo_metiers.json, contrôlée par `bmo.familyCase`) : le chiffre cité est celui de la famille */
  bmoFamily: 'V',
  shiftDay: 'd14',
  budget: 60,
  car: false,
  bike: true,
} as const;

/* ------------------------------------------------------------------ paramètres de scénario */

const LEA_ORIGIN = LEA_PROFILE.origin;
/** Second horizon de l'acte 3 : Montesson, commune limitrophe (data/processed/adjacency_2026.csv) */
const HORIZON_B = '78418';
/** Temps de trajet par sens de toute la visite */
const B_STORY = LEA_PROFILE.budget;
/** Journée-type du poste proposé (éclipse) */
const ECLIPSE_DAY: Scenario['day'] = LEA_PROFILE.shiftDay;
/**
 * Astre suivi (D-030, 44 astres, 05/11) : Paris 8e, le plus gros des arrondissements (263 144 postes salariés
 * localisés, bassin T1 Paris) : allumé en 9h-17h (aller 53, retour 53 minutes sur la table commune x commune, celle
 * du panneau de preuve ; Navitia, 06/11 : 49 et 53), flux de recensement publiés. Le récit ne l'ouvre qu'en 9h-17h : le
 * soir, c'est Seine-Aval (EVENING_POLE) qui est suivi. Historique : le 06/11, sa fiche de 14h-22h affichait un retour de
 * 76 minutes, dû à un plan de travaux du RER A périmé dans le GTFS du 02/11 ; ce n'est plus le cas (relevé du 12/11 sur la
 * table publiée, horaires du 17/11/2026 : aller 55, retour 46 minutes, atteint aller et retour). Ces valeurs se lisent dans
 * les données, pas ici ; les contrôles de `npm run tour:resolve lea` disent si ces constantes tiennent encore.
 */
const FOCUS_POLE = 'BE_1107_75108';
/**
 * Astre du soir (14h-22h, étapes « éclipse » et « pôle ») : Seine-Aval, ancré à Poissy (`name_short_insee` 78498). Cas
 * CONFIRMÉ aller ET retour par Navitia à 5 minutes près (recoupement du 06/11, de commune à commune comme la table
 * publiée) : 9h-17h aller 36 et retour 36 (Navitia 37 et 36) ; 14h-22h aller 38 et retour 50 (Navitia 34 et 50). La visite
 * ne dit que les temps de Poissy (anchor.out, anchor.ret) : ceux de la ligne du panneau, pas le total de l'astre.
 */
const EVENING_POLE = 'BE_1125';
/** Commune d'ancrage de l'astre du soir (Poissy) : sa ligne du pli « Communes du pôle » porte les minutes dites */
const EVENING_ANCHOR = '78498';
/** Mode de comparaison voiture : avec le trafic moyen DiRIF (D-029), le plus prudent des deux modes voiture */
const CAR_MODE: Scenario['mode'] = 'car_traffic';

/* ------------------------------------------------------------------ choix de variante (contrôlés) */

/** Flux INSEE vers FOCUS_POLE : contrôlé par `flow.case` */
const FLUX = 'ok' as 'ok' | 'ordre_de_grandeur' | 'aucun_flux_publie';
/** Halo niveau de vie (SOC01) : voir `haloNarration` (contrôle `halo.compareCase`) */
/** Acte 3 (9h-17h, après l'acte 1) : contrôlé par `compare.horizonCase` */
const HORIZON = 'ecart' as 'ecart' | 'meme_horizon' | 'autant_pas_les_memes';
/**
 * Acte 4 (vélo personnel jusqu'à la gare, puis TC, symétrique au retour, sans forfait de stationnement, durées
 * minimales, D-011). Contrôlé par `gain.case` et `gain.eclipseCase`.
 * - 'gain' : or peint (même commune, même journée, même temps de trajet, seul le mode change), aucun pôle perdu ;
 * - 'sans_gain' : vélo + TC calculé, aucun pôle gagné ; - 'retire' : étape absente.
 */
export type Acte4 = 'gain' | 'sans_gain' | 'retire';
const ACTE4: Acte4 = 'gain';
/** Le texte ne dit plus « regagne » (06/11) : le contrôle `gain.eclipseCase` n'est plus demandé à l'étape, ce type reste pour `RELIT_PHRASE` */
type Relit = 'partie' | 'toute';

/**
 * Étapes de la visite. Par défaut : carte courte, halo social, moyens de transport, voiture et vélo joués, et (depuis le
 * 06/11, décision de Nicolas) l'étape BMO sur le SITE seulement, avec le chiffre de la FAMILLE de métiers que le panneau
 * affiche, pas celui du métier ; la vidéo du dépôt ne la joue jamais. La carte est gardée dans tous les cas (décision du
 * 04/11). Les étapes « en attente » restent désactivées tant que leur écran ou leur donnée n'existe pas (PENDING_STEPS,
 * condition écrite).
 */
export interface LeaOptions {
  /** Étape « carte miroir » : gardée dans tous les cas sur le site (aucune autre option ne la retire) */
  carte: boolean;
  /** Parenthèse du halo (niveau de vie, SOC01) : jouée par défaut */
  halo: boolean;
  /** Comparaison avec la voiture (trafic moyen DiRIF), avant le vélo */
  voiture: boolean;
  /** Projets de recrutement BMO du bassin de l'astre suivi, par famille de métiers (PR 30, D-035) : jouée sur le site, jamais dans la vidéo */
  bmo: boolean;
  /** Coût d'un aller-retour : voiture contre tickets (en attente, PENDING_STEPS) */
  cout: boolean;
  /**
   * Comparaison des moyens de transport (retour de Cyril) : jouée par défaut depuis que la climatisation (TRA03) et
   * les émissions carbone (ENV01) sont publiées par trajet ; ses contrôles arrêtent la visite sinon.
   */
  moyens: boolean;
}

export function defaultOptions(acte4: Acte4 = ACTE4): LeaOptions {
  return { carte: true, halo: true, voiture: acte4 !== 'retire', bmo: true, cout: false, moyens: true };
}

/**
 * Étapes prêtes mais DÉSACTIVÉES : leur écran ou leur donnée n'existe pas encore. Pour les activer : publier la
 * donnée (contrat écrit), ajouter les variables dans variables.ts (elles sont listées ici), passer l'option à
 * true, relancer npm run tour:resolve lea, régénérer la voix. Le test lea.test.ts vérifie que chaque variable
 * d'une étape en attente est soit déjà définie, soit déclarée dans `pending`.
 */
export const PENDING_STEPS: Record<'cout', { condition: string; pending: readonly string[] }> = {
  cout: {
    condition:
      'Coût voiture publié (chantier data/cout-voiture : meta.car_costs.distances.status = ok, car_trip dans access/) ' +
      'et tarifs des abonnements (chantier data/abonnements). Variables à écrire : carburant d’un aller-retour, ' +
      'tickets d’un aller-retour (itineraries/, déjà publiés), sans forfait inventé.',
    pending: ['car.roundTripCostOral', 'pole.roundTripTicketsOral'],
  },
};

/* ------------------------------------------------------------------ textes */

/**
 * 11/11 (§ 0.11) : reprend la phrase de la v3.1 (03/11, validée à l'écoute) sur la région, et pose la question du défi
 * avec les mots du brief (transports publics, lieux d'emploi, solutions complémentaires). « où l'emploi se concentre »
 * reste retiré (audit du 09/11, C8 : les 44 astres couvrent tous les postes).
 */
const prologue =
  'C’est l’aube. {origin.oralName} dort encore, ou presque. ' +
  'Les mêmes étoiles, pour {region.populationOral} d’habitants d’Île-de-France. Mais pas toutes à portée de main. ' +
  'Voici Léa, une habitante imaginaire, sous un ciel bien réel. Léa cherche un emploi. Elle n’a pas de voiture, mais un vélo, pour plus tard. ' +
      'D’abord, seulement les transports en commun : quels emplois peut-elle rejoindre ? Et qu’est-ce qui pourrait élargir son horizon ?';

/** 11/11 (§ 0.11) : « en partie » expliqué (un astre s'éclaire dès qu'une de ses communes est atteinte aller ET retour, § 0.1 quater) */
const acte1Ciel =
  'Léa se donne {budget} minutes de transports en commun, à l’aller comme au retour. ' +
  'Chaque étoile qui s’allume est un bassin d’emploi, ou un arrondissement de Paris, accessible par Léa selon ses conditions. Sa taille, ce sont ses postes salariés recensés par l’INSEE. ' +
  '{access.stars} s’allument, en partie ou en entier. ' +
  'En partie : quand Léa n’atteint que certaines communes de l’étoile, à l’aller et au retour. ' +
  'Au compteur : {access.jobsOral} à sa portée, hors sa commune.';

/**
 * 11/11 (§ 0.11) : reprend « Un point, pas une adresse » (v3.1, D-017) et dit la base du calcul (table commune x commune,
 * D-019). Le point de départ D-017 reste expliqué à l'écran et dans la FAQ jury.
 */
const acte1Carte =
  'La carte s’ouvre : chaque étoile retrouve sa place. Le ciel de Léa part du cœur habité de {origin.oralName} : un point, pas une adresse. ' +
  'Les temps sont calculés de commune à commune.';

/**
 * Retour 05/11 (Sara, PR 51) : le temps du retour compte l'attente depuis la fin du poste. On dit « à la fin du
 * poste » et « attente comprise », jamais « départ à {heure} » (aucun véhicule ne part forcément à cette heure).
 * 11/11 : une idée par phrase, un seul chiffre par phrase ; les heures du poste se lisent dans la barre du bas.
 */
const acte1Preuve =
  'Dans le panneau de droite, la fiche de {pole.oralName}. ' +
  'Voici un exemple de trajet : pour arriver avant le début de sa journée de travail, l’aller prend {trip.out} minutes. ' +
  'À la fin de sa journée de travail, le retour prend {trip.ret} minutes, attente comprise.';

/**
 * 11/11 (§ 0.11) : la pratique observée n'est pas un trajet calculé (v3.1 « Ça, c'est le calcul » ; l'écran affiche « Une
 * pratique observée, pas une possibilité calculée »). Le flux ne dit jamais que le trajet est facile.
 */
const PRATIQUE = 'Ce sont des déplacements réellement constatés, pas des trajets calculés par STARWAY.';
const fluxNarration: Record<typeof FLUX, string> = {
  ok: `D’après les flux domicile-travail du recensement, {flow.peopleOral} habitants de {origin.oralName} y travaillent déjà. ${PRATIQUE}`,
  ordre_de_grandeur:
    'D’après les flux domicile-travail du recensement, {flow.peopleOral} habitants de {origin.oralName} y travaillent déjà. ' +
    `Un ordre de grandeur, précise l’INSEE. ${PRATIQUE}`,
  aucun_flux_publie: 'Les flux domicile-travail du recensement, eux, ne publient aucun chiffre pour ce trajet.',
};

/**
 * Slogan de l'acte 3, variante « écart » seulement (retour de Cyril du 06/11 20h41 : il illustre l'inégalité entre
 * TERRITOIRES, jamais entre revenus). Depuis le 10/11 (retours de l'équipe sur la vidéo) : UNE seule phrase liée,
 * « le même ciel, mais pas les mêmes étoiles », sans point au milieu (l'ancien « Le même ciel. Pas les mêmes étoiles. »
 * laissait un silence trop long entre les deux moitiés). Même phrase sur le site et dans la vidéo.
 */
const SLOGAN_ECART = 'le même ciel, mais pas les mêmes étoiles : voilà une inégalité entre territoires.';
const horizonChute: Record<typeof HORIZON, string> = {
  ecart: `Deux voisines, ${SLOGAN_ECART}`,
  meme_horizon: 'Deux voisines. Le même horizon.',
  autant_pas_les_memes: 'Autant d’étoiles, mais pas les mêmes.',
};
/**
 * Acte 3 : « seulement » n'est dit que si la voisine allume moins d'étoiles (`compare.rankCase` = 'moins') ;
 * sinon la phrase longue, qui donne les deux nombres.
 */
const RANK = 'moins' as 'moins' | 'autre';
/**
 * 11/11 (§ 0.11) : la voix dit où regarder (ciel B à droite, en-têtes en haut de chaque ciel, Diptych) et ce que « les mêmes
 * réglages » veut dire (retour de Sandra : journée, temps de trajet, mode ; l'état de l'étape ne change que la commune). Les
 * deux nombres d'étoiles sont ceux des deux ciels ; les postes de la voisine sont ceux de l'en-tête B ; un chiffre par phrase.
 */
const MEMES_REGLAGES = 'L’écran se partage en deux. À droite, celui de sa voisine, {compare.oralName}, avec les mêmes réglages : même journée, même temps de trajet, mêmes transports en commun.';
const acte3: Record<typeof RANK, string> = {
  moins: `${MEMES_REGLAGES} À gauche, {origin.oralName} : {access.stars}. À droite, seulement {compare.stars}. En haut de son ciel : {compare.jobsOral} à sa portée. ${horizonChute[HORIZON]}`,
  autre: `${MEMES_REGLAGES} À gauche, {origin.oralName} : {access.stars}. À droite, {compare.oralName} : {compare.stars}. ${horizonChute[HORIZON]}`,
};

/**
 * Éclipse (journée-type du poste proposé, 14h-22h) : le texte ne dit QUE la méthode, aucun nombre d'étoiles perdues ni de
 * postes. Historique : le 06/11, le recoupement Navitia (passation 4.21) avait montré que la perte alors calculée de 23
 * étoiles sur 24 venait d'un plan de travaux du RER A périmé dans le GTFS du 02/11 : « 23 étoiles de moins » a été retiré.
 * Sur la table publiée aujourd'hui (relevé du 12/11, horaires du 17/11/2026), le site allume 24 étoiles en 9h-17h et 5 en
 * 14h-22h ; la phrase reste sans nombre (un nombre dit ici devrait être recoupé de nouveau).
 * Le ciel et le compteur du site restent ce que l'application calcule ; la visite ne les commente pas.
 * 11/11 (§ 0.11) : reprend le restaurant de la version « défi » (04/11) et les mots du brief « besoins du monde du travail »
 * (§ 0.1 septies, point b), et dit qu'une journée-type est un scénario (règle de vérité 8).
 */
const acte2Eclipse =
  'Passons au soir : un poste de {day.startOral} à {day.endOral}. Un restaurant le propose à Léa, comme aide de cuisine. ' +
  'Les transports répondent-ils aux besoins du monde du travail, même avec des horaires décalés ? ' +
  'Même point de départ, même temps de trajet. ' +
  'Le ciel est recalculé : l’aller doit arriver avant {day.startOral}, et le retour compte à partir de la fin du poste. ' +
  'Une journée-type est un scénario, pas un horaire réel.';

/**
 * Cas du soir CONFIRMÉ par Navitia (EVENING_POLE) : les temps sont ceux de la ligne de Poissy dans le panneau de preuve.
 * Contrôlé par `anchor.verdictCase` (la commune d'ancrage est atteinte aller et retour). Aucun bus de remplacement
 * (« un bus du RER A » retiré le 06/11 : il venait d'un plan de travaux périmé, voir FOCUS_POLE).
 * 11/11 (§ 0.11) : « recoupés » (jamais « validés ») ; l'écart de 5 minutes au plus est vérifié par siteFigures.test.ts
 * sur le fichier du recoupement.
 */
const soirNarration =
  'Dans le panneau de droite, la fiche de {pole.oralName}. Dans la liste des communes du pôle, la ligne de {anchor.oralName}. ' +
  'L’aller prend {anchor.out} minutes. Le retour en prend {anchor.ret}, attente comprise. {anchor.oralName} reste à sa portée, même le soir. ' +
  'Ces temps ont été recoupés avec le calculateur d’Île-de-France Mobilités.';

/**
 * Là où l'emploi se crée : le CHIFFRE DE LA FAMILLE de métiers de Léa dans le bassin, celui que la liste « Projets de
 * recrutement par famille de métiers » du panneau affiche (décision de Nicolas du 06/11), pas celui de son métier (non affiché).
 * Étape du site seulement : la vidéo ne la joue jamais.
 * 11/11 (§ 0.11) : reprend le métier visé (profil, § 0.2) et la nature des projets (version du 06/11 : « déclarés par les
 * employeurs »).
 */
const bmoNarration =
  'À droite, plus bas : les projets de recrutement. Léa vise un poste d’aide de cuisine. ' +
  // Le chiffre vaut pour tout le bassin (les 20 arrondissements), jamais pour le seul pôle suivi : « qui couvre tout Paris » est contrôlé (`bmo.bassinOral`)
  'Dans le bassin d’emploi {bmo.bassinOral}, qui couvre tout Paris, les employeurs en prévoient {bmo.familyProjectsOral} ' +
  'dans sa famille de métiers : les {bmo.familyOral}. ' +
  // 12/11 (audit de vérité) : « opportunités d'emploi » (retour de Cyril du 06/11) était trop proche d'« emplois disponibles » ;
  // la phrase dit ce que mesure l'enquête : des recrutements prévus par les employeurs, pour l'année de l'enquête
  'Ce sont les recrutements prévus pour {bmo.yearOral}, d’après l’enquête BMO de France Travail. ' +
  'Ces projets sont déclarés par les employeurs.';

/**
 * Retour de Cyril, « moyens de transport » et « émissions carbone ». Dite avec la fiche du pôle suivi ouverte :
 * le panneau montre, pour ce trajet, la climatisation DÉCLARÉE de chaque ligne (TRA03, « ligne équipée », pas
 * plus) et les émissions carbone (ENV01). Contrôles : `moyens.climCase`, `moyens.carbonCase`.
 */
const moyensNarration =
  'Dans la même fiche, Léa peut comparer les moyens de transport : les émissions carbone de chaque trajet. ' +
  'Les solutions complémentaires, comme le vélo jusqu’à la gare, visent à réduire l’utilisation de la voiture. ' +
  'Et les lignes déclarées climatisées sont utiles face au changement climatique.';

// Journée 14h-22h : l'indice DiRIF s'applique à l'aller, pas au retour de 22h (route vide, meta.car_congestion, gardé par lea.test.ts)
// 11/11 (§ 0.11) : la source du trafic moyen est dite (DiRIF, crédits du site) ; 11/11 (audit de vérité) : le temps est dit
// comme une estimation, comme la barre (« Voiture trafic DiRIF (estimation) ») ; 11/11 16h50 (retour de Cyril, validé par
// Nicolas) : une question, puis le conditionnel, moins sec ; « estimé à l'aller » garde la règle DiRIF (aller seulement)
const voiture =
  'Et si Léa avait une voiture ? Avec le trafic moyen estimé à l’aller, {access.stars} s’allumeraient. ' +
  'Une estimation, à partir du trafic moyen mesuré par la direction des routes d’Île-de-France. ' +
  '{access.jobsOralCap} seraient à sa portée. Mais Léa n’a pas de voiture.';

/** En attente (PENDING_STEPS.cout) */
const coutNarration =
  'Un aller-retour en voiture : {car.roundTripCostOral} de carburant. En transports en commun, au ticket : {pole.roundTripTicketsOral}.';

/** Variante longue (non prononcée par défaut) : à remettre si la durée le permet */
export const RELIT_PHRASE: Record<Relit, string> = {
  partie: ', parmi celles que l’heure avait éteintes.',
  toute: ' : toutes celles que l’heure avait éteintes.',
};
const acte4Narration: Record<'gain' | 'sans_gain', string> = {
  // D-056 (09/11) : l'or exige aussi une part TC commune par commune nulle. La phrase ne nomme ni l'or ni un nombre : elle tient tant que `gain.case` vaut 'gain'.
  // 06/11 16h30 (décision de Nicolas) : AUCUN nombre d'astres en or ni de postes. Les astres en or comparent le vélo + TC aux
  // TC seuls de 14h-22h, calculés avec un plan de travaux du RER A périmé (recoupement Navitia, passation 4.21) : le nombre
  // n'est pas confirmé. Reste l'idée : le vélo jusqu'à la gare élargit le périmètre de recherche d'emploi. Le contrôle
  // `gain.case` garde la certitude que le calcul montre bien un gain ; le compteur de ce mode (calculé sur `access/` seulement)
  // additionne des astres entiers et n'est pas cité non plus.
  gain:
    'Alors, une solution complémentaire : son vélo jusqu’à la gare, puis les transports en commun. ' +
    // 06/11 20h41 : « sans prendre la voiture » (le mot reste entendu dans la vidéo, où l'étape des moyens de transport est coupée)
    'Sans compter le temps pour le garer, son périmètre de recherche d’emploi s’élargit, sans prendre la voiture.',
  sans_gain: 'Alors, une solution complémentaire : son vélo jusqu’à la gare, puis les transports en commun. Ici, le calcul ne rallume aucune étoile.',
};

/**
 * Halo « Derrière notre étoile », niveau de vie (SOC01), DEUX communes (06/11 20h41, décision de Nicolas) : la visite le joue
 * juste après Montesson, comparaison ouverte, en 9h-17h. Descriptif seulement : aucun lien de cause avec l'accessibilité (ni
 * « plus riche », ni « moins riche », ni mot qui rapproche le niveau de vie des étoiles). Les deux médianes sont lues dans
 * context/{insee}.json ; contrôle `halo.compareCase`. Le taux de pauvreté n'est plus dit (une seule idée par phrase).
 * 11/11 (§ 0.11) : reprend « Derrière l'étoile, des habitants » (v3.1) sans le mot « étoile » (interdit dans le halo) et
 * nomme la source (INSEE, Filosofi).
 */
const haloNarration =
  'Le halo s’ouvre : derrière chaque commune, des habitants. ' +
  'D’après l’INSEE, le niveau de vie médian est d’environ {halo.incomeMedianOral} par an à {origin.oralName}. Il est d’environ {halo.compareIncomeMedianOral} à {compare.oralName}.';
const haloGuard = 'Ce halo décrit qui y vit, pas ce que chacun peut atteindre.';

/** 11/11 (§ 0.11) : « Chaque chiffre renvoie à sa source » (mode sources du site, pitch) */
const epilogue =
  'Léa est imaginaire, mais ses chiffres sont réels. Ils sont calculés avec des données ouvertes, pour chaque commune d’Île-de-France. ' +
  'Chaque chiffre renvoie à sa source. ' +
  'À vous d’explorer : votre commune, votre heure, votre temps de trajet. ' +
  'Nous vivons tous sous le même ciel. À vous, maintenant, de découvrir vos étoiles.';

/* ------------------------------------------------------------------ textes courts de la VIDÉO (?tour=lea-video&record=1) */

/**
 * Textes de la version courte, jouée par le site et par l'enregistrement de la vidéo du dépôt (décision de Nicolas du 06/11) : le brief IDFM (page 15) dit
 * « Possibilité de présentation vidéo (3 minutes max) », sans dérogation. La version complète garde les textes ci-dessus ;
 * la visite `lea-video` se lance par le bouton « Lancer la visite » (version courte, choix de `TourChoice`) ou par `?tour=lea-video&record=1`
 * (RecordDirector, sans passer par le choix).
 * Mêmes étapes, mêmes états, mêmes variables et mêmes contrôles que le site (aucun chiffre écrit) : seuls changent les
 * mots. L'étape BMO n'est jamais dans la vidéo (décision de Nicolas) : `buildLea(.., video)` refuse l'option `bmo`.
 *
 * Réécriture du 10/11 (retours de l'équipe : discours robotique, slogan coupé en deux, on ne sait pas où regarder) :
 * - une idée par phrase, au plus un chiffre par phrase ;
 * - chaque étape commence par ce qui change à l'écran ;
 * - la voix dit où se lit le chiffre. Positions vérifiées dans le code et à l'écran (1280 x 720 et 1920 x 1080) : barre du
 *   scénario EN BAS (ScenarioBar : journée-type, jauge du temps de trajet, mode, puis le COMPTEUR à droite de la barre) ;
 *   fiche du pôle À DROITE (ProofPanel, `.proof-panel` right: 20px) ; diptyque : ciel A à gauche, ciel B (la voisine)
 *   À DROITE, en-têtes en haut de chaque ciel (Diptych, `.pane-head-B` left: 50 % + 20px). Le compteur du bas reste celui
 *   de la commune A en diptyque : la voisine n'est donc pas citée par son compteur.
 * - Gardes de vérité conservées : « en partie ou en entier » (des pôles ne s'allument qu'en partie), « à l'aller seulement »
 *   pour le trafic moyen de la voiture (indice DiRIF de l'aller de 14h), « même point de départ » et « aller et retour » à l'éclipse.
 *
 * 11/11 (demande de Nicolas, § 0.11) : la courte est la démonstration du jury, environ 3 min AVEC les transitions (2 min 55
 * au plus). Elle présente de nouveau le défi : la question du brief au prologue (transports publics, lieux d'emploi, solutions
 * complémentaires), les « besoins du monde du travail » à l'éclipse, l'aller ET le retour de Paris 8e. L'étape des moyens
 * de transport (carbone, climatisation déclarée), remise un moment, est retirée de nouveau depuis la mesure du 11/11 (189 s
 * avec elle) : 9 étapes, 336 mots résolus, 179 à 182 s avec les transitions (`measure-record.mjs`).
 */
const VIDEO_FLUX: Record<typeof FLUX, string> = {
  ok: 'D’après les flux domicile-travail du recensement, {flow.peopleOral} habitants de {origin.oralName} y travaillent déjà.',
  ordre_de_grandeur: 'D’après les flux domicile-travail du recensement, {flow.peopleOral} habitants de {origin.oralName} y travaillent déjà : un ordre de grandeur.',
  aucun_flux_publie: 'Les flux domicile-travail du recensement ne publient aucun chiffre pour ce trajet.',
};
const VIDEO_HORIZON: Record<typeof HORIZON, string> = {
  ecart: `${SLOGAN_ECART.charAt(0).toUpperCase()}${SLOGAN_ECART.slice(1)}`,
  meme_horizon: 'Le même horizon.',
  autant_pas_les_memes: 'Autant d’étoiles, mais pas les mêmes.',
};
/** Le nombre d'étoiles de la voisine se lit dans le ciel de droite ; « seulement » n'est dit que si `compare.rankCase` = 'moins' */
const VIDEO_ACTE3: Record<typeof RANK, string> = {
  // Retour de Sandra (10/11) : « avec les mêmes réglages » (mêmes critères que Léa)
  moins: `L’écran se partage en deux : à droite, le ciel de sa voisine, {compare.oralName}, avec les mêmes réglages : on y voit s’allumer seulement {compare.stars}. ${VIDEO_HORIZON[HORIZON]}`,
  autre: `L’écran se partage en deux : à droite, le ciel de sa voisine, {compare.oralName}, avec les mêmes réglages : on y voit s’allumer {compare.stars}. ${VIDEO_HORIZON[HORIZON]}`,
};
const VIDEO_SOIR =
  'Dans le panneau de droite, la fiche de {pole.oralName}. Dans la liste, {anchor.oralName} : l’aller prend {anchor.out} minutes. ' +
  'Le retour en prend {anchor.ret}, attente comprise. {anchor.oralName} reste à sa portée, même le soir.';
/**
 * Étape des moyens de transport (retour de Cyril), version courte : texte PRÊT mais NON JOUÉ (`moyens: false` dans
 * VIDEO_OPTIONS depuis la mesure du 11/11 : la courte durait 189 s avec elle). Elle
 * commence par l'endroit où regarder (la fiche de Paris 8e, à droite) ; « réduire l'utilisation de la voiture » reste dit par
 * le site, la courte garde « sans prendre la voiture » à l'étape du vélo.
 */
export const VIDEO_MOYENS =
  'À droite, Léa peut comparer les moyens de transport : les émissions carbone de chaque trajet. ' +
  'Et les lignes déclarées climatisées, utiles face au changement climatique.';
const VIDEO_NARRATION: Record<string, string> = {
  // L'étoile-guide naît à cette étape (temps C de la révélation) ; la légende la nomme « Votre commune (point de départ) ».
  // 11/11 : le défi est posé d'abord (mots du brief), puis le point de départ et Léa.
  prologue:
    'Voici {origin.oralName}. C’est ici que vit Léa, une habitante imaginaire. Elle cherche un emploi : sans voiture, avec un vélo pour plus tard. ' +
        'D’abord, seulement les transports en commun : quels emplois peut-elle rejoindre ? Et qu’est-ce qui pourrait élargir son horizon ?',
  // La jauge glisse en bas pendant la phrase ; le compteur est à droite de la barre du bas. `access.jobsCount` : le nombre du
  // compteur sans le mot « postes » (« près de 2,6 millions »), la phrase dit « postes salariés recensés par l'INSEE » (retour de
  // Cyril, validé par Nicolas le 11/11 à 17h : première mention ; aucune variable de millésime Flores, donc aucune année dite).
  // « en partie ou en entier » reste : des pôles ne s'allument qu'en partie. « hors sa commune » part : le compteur affiche « hors votre commune ».
  'acte1-ciel':
    'Léa se donne {budget} minutes de transports en commun, à l’aller comme au retour. ' +
    'Chaque étoile qui s’allume est un bassin d’emploi ou un arrondissement, accessible par Léa selon ses conditions. {access.stars} s’allument, en partie ou en entier. ' +
    'Au compteur, les postes salariés recensés par l’INSEE : {access.jobsCount}.',
  // retirée de la vidéo par défaut (VIDEO_OPTIONS), texte court prêt si Nicolas la remet
  'acte1-carte': 'Sur la carte, chaque étoile retrouve sa place.',
  // La fiche s'ouvre à droite et défile jusqu'au bloc des flux (proofFocus 'flows').
  // 11/11 : l'aller ET le retour de Paris 8e reviennent (règle centrale du défi : accessible = aller et retour), un chiffre par phrase.
  'acte1-preuve':
    'Dans le panneau de droite, la fiche de {pole.oralName}. Voici un exemple de trajet : l’aller prend {trip.out} minutes. ' +
    `À la fin de sa journée de travail, le retour en prend {trip.ret}, attente comprise. ${VIDEO_FLUX[FLUX]}`,
  'acte3-horizons': VIDEO_ACTE3[RANK],
  // La journée-type change dans la barre du bas ; le diptyque se referme. « Même point de départ » et « aller et retour » restent (plan final § 6).
  // 11/11 : la question du brief « besoins du monde du travail » (§ 0.1 septies, point b).
  'acte2-eclipse':
    'Passons au soir : un poste de {day.startOral} à {day.endOral}. Les transports répondent-ils aux besoins du monde du travail ? ' +
    'Même point de départ, même temps de trajet : le ciel est recalculé, aller et retour.',
  'acte2-pole': VIDEO_SOIR,
  // retirée de la vidéo par défaut (VIDEO_OPTIONS), texte court prêt (deux communes, garde conservée)
  halo: 'Niveau de vie médian, environ {halo.incomeMedianOral} par an à {origin.oralName}, {halo.compareIncomeMedianOral} à {compare.oralName}. ' + haloGuard,
  'acte4-moyens': VIDEO_MOYENS,
  // « estimé à l'aller » : l'indice DiRIF vaut pour l'aller de 14h, pas pour le retour de 22h (meta.car_congestion) ;
  // 11/11 16h50 (retour de Cyril, validé par Nicolas) : une question, puis le conditionnel, moins sec
  'acte4-voiture':
    'Et si Léa avait une voiture ? Avec le trafic moyen estimé à l’aller, {access.stars} s’allumeraient. ' +
    '{access.jobsOralCap} seraient à sa portée. Mais Léa n’a pas de voiture.',
  // Même phrase que le site : le temps pour garer le vélo n'est pas compté (D-011), la vidéo doit le dire aussi
  'acte4-velo': acte4Narration.gain,
  // 11/11 : l'invitation du site (votre commune, votre heure, votre temps de trajet), repères sur la barre du bas
  epilogue:
    'Léa est imaginaire, mais ses chiffres sont réels. À vous d’explorer : votre commune, votre heure, votre temps de trajet. ' +
    'Nous vivons tous sous le même ciel. À vous, maintenant, de découvrir vos étoiles.',
};
/**
 * Étapes retirées de la VIDÉO seulement (elles restent sur le site). Mesure du 06/11 (`scripts/measure-record.mjs`) : environ
 * 50 s hors voix pour 9 étapes (révélation 9 s, transitions de 2 à 6 s par étape, pause de 0,9 s, générique 5 s) ; la carte
 * miroir coûte à elle seule 11 s (vol de la caméra), le halo 13 s. 11/11 (§ 0.11) : les moyens de transport, remis dans la
 * courte (10 étapes), en sont retirés de nouveau après la mesure (`measure-record.mjs` : 189 s avec eux, l'étape en pèse
 * 15) : 9 étapes, 179 et 182 s mesurées avec les transitions, au-dessus de la cible de 2 min 55.
 */
const VIDEO_OPTIONS: Partial<LeaOptions> = { carte: false, halo: false, moyens: false };
/** Durée minimale d'une étape de la vidéo (ms) : la voix la rythme, ce plancher n'allonge pas les textes courts */
const VIDEO_MIN_MS = 3000;

/**
 * Variables prononcées par la variante par défaut (defaultOptions('gain')). Toutes définies dans variables.ts
 * (lea.test.ts).
 */
export const LEA_REQUIRED_VARIABLES = [
  'origin.oralName',
  'region.populationOral',
  'budget',
  'access.stars',
  'access.jobsOral',
  'access.jobsOralCap',
  'pole.oralName',
  'anchor.oralName',
  'anchor.out',
  'anchor.ret',
  'day.startOral',
  'day.endOral',
  'trip.out',
  'trip.ret',
  'flow.peopleOral',
  'compare.oralName',
  'compare.stars',
  'compare.jobsOral',
  'halo.incomeMedianOral',
  'halo.compareIncomeMedianOral',
  'bmo.bassinOral',
  'bmo.familyProjectsOral',
  'bmo.familyOral',
  'bmo.yearOral',
] as const;

/* ------------------------------------------------------------------ repères visuels (retour de Cyril du 10/11) */

/**
 * Repères de la visite : pour chaque chiffre ou élément annoncé, l'élément de l'écran qui le montre, allumé quand la voix
 * arrive au fragment (`at`, écrit dans le texte de l'étape, jamais un temps). Cibles : `tour/marks.ts`. Un fragment qui
 * n'est plus dans le texte fait échouer `marks.test.ts` : si un texte change, adapter le fragment ici.
 * Chaque fragment commence une phrase ou suit une ponctuation (`lea.test.ts`, « repères datables sur la voix »).
 */
const SITE_MARKS: Record<string, readonly TourMark[]> = {
  prologue: [{ at: '{origin.oralName} dort encore', target: 'origin' }],
  'acte1-ciel': [
    { at: 'Léa se donne', target: ['mode', 'budget'] },
    { at: 'Chaque étoile qui', target: 'none' },
    { at: '{access.stars} s’allument', target: 'stars:lit' },
    { at: 'Au compteur', target: 'counter' },
  ],
  'acte1-preuve': [
    { at: 'Dans le panneau de droite', target: [`pole:${FOCUS_POLE}`, 'proof'] },
    { at: 'Voici un exemple de trajet', target: 'proof:trajet' },
    { at: 'À la fin de sa journée de travail', target: 'proof:trajet-retour' },
    { at: 'D’après les flux', target: 'proof:flows' },
  ],
  'acte2-recrutement': [
    { at: 'À droite, plus bas', target: 'proof' },
    { at: 'les projets de recrutement', target: 'proof:recruit' },
  ],
  'acte4-moyens': [
    { at: 'Dans la même fiche', target: 'proof' },
    { at: 'les émissions carbone', target: 'proof:carbone' },
    { at: 'Les solutions complémentaires', target: 'proof:moyens' },
    { at: 'Et les lignes déclarées climatisées', target: 'proof:trajet' },
  ],
  'acte3-horizons': [
    { at: 'À droite, celui de sa voisine', target: 'sky:B' },
    { at: 'À gauche, {origin.oralName}', target: 'diptych:A' },
    { at: 'À droite, seulement', target: ['stars:lit:B', 'diptych:B'] },
    { at: 'En haut de son ciel', target: 'diptych:B' },
    { at: 'Deux voisines', target: 'stars:lit' },
  ],
  halo: [{ at: 'Le halo s’ouvre', target: 'halo' }],
  'acte2-eclipse': [
    { at: 'un poste de', target: 'dayType' },
    { at: 'Même point de départ', target: 'origin' },
    { at: 'même temps de trajet', target: 'budget' },
    { at: 'Le ciel est recalculé', target: 'stars:lit' },
  ],
  'acte2-pole': [
    { at: 'Dans le panneau de droite', target: [`pole:${EVENING_POLE}`, 'proof'] },
    { at: 'Dans la liste des communes', target: 'proof:communes' },
    { at: 'L’aller prend', target: `row:${EVENING_ANCHOR}` },
  ],
  'acte4-voiture': [
    { at: 'Et si Léa avait une voiture', target: 'mode' },
    { at: 'Avec le trafic moyen estimé', target: 'stars:lit' },
    { at: '{access.jobsOralCap} seraient', target: 'counter' },
  ],
  'acte4-velo': [
    { at: 'Alors, une solution complémentaire', target: 'mode' },
    { at: 'Sans compter le temps', target: 'stars:lit' },
  ],
  epilogue: [
    { at: 'Léa est imaginaire', target: 'stars:lit' },
    { at: 'votre commune', target: 'search' },
    { at: 'votre heure', target: 'dayType' },
    { at: 'votre temps de trajet', target: 'budget' },
  ],
};

/**
 * Repères de la version courte (textes de VIDEO_NARRATION, réécrits le 10/11 : la voix dit où regarder, « en bas »,
 * « en bas à droite », « à droite » ; le repère s'allume sur ces mots).
 */
const VIDEO_MARKS: Record<string, readonly TourMark[]> = {
  prologue: [{ at: 'Voici {origin.oralName}', target: 'origin' }],
  'acte1-ciel': [
    { at: 'Léa se donne', target: 'budget' },
    { at: 'Chaque étoile qui', target: 'none' },
    { at: '{access.stars} s’allument', target: 'stars:lit' },
    { at: 'Au compteur', target: 'counter' },
  ],
  'acte1-preuve': [
    { at: 'Dans le panneau de droite', target: [`pole:${FOCUS_POLE}`, 'proof'] },
    { at: 'Voici un exemple de trajet', target: 'proof:trajet' },
    { at: 'À la fin de sa journée de travail', target: 'proof:trajet-retour' },
    { at: 'D’après les flux', target: 'proof:flows' },
  ],
  'acte4-moyens': [
    { at: 'À droite, Léa peut comparer', target: 'proof' },
    { at: 'les émissions carbone', target: 'proof:carbone' },
    { at: 'Et les lignes déclarées climatisées', target: 'proof:trajet' },
  ],
  'acte3-horizons': [
    { at: 'L’écran se partage en deux', target: 'sky:B' },
    { at: 'on y voit s’allumer', target: ['stars:lit:B', 'diptych:B'] },
    { at: 'Le même ciel', target: 'stars:lit' },
  ],
  'acte2-eclipse': [
    { at: 'un poste de', target: 'dayType' },
    { at: 'Même point de départ', target: 'origin' },
    { at: 'même temps de trajet', target: 'budget' },
    { at: 'le ciel est recalculé', target: 'stars:lit' },
  ],
  // Le pli « Communes du pôle » est ouvert (openFold) : la ligne de l'ancrage porte les minutes d'aller et de retour dites
  'acte2-pole': [
    { at: 'Dans le panneau de droite', target: [`pole:${EVENING_POLE}`, 'proof'] },
    { at: 'Dans la liste', target: 'proof:communes' },
    { at: 'l’aller prend', target: `row:${EVENING_ANCHOR}` },
  ],
  'acte4-voiture': [
    { at: 'Et si Léa avait une voiture', target: 'mode' },
    { at: 'Avec le trafic moyen estimé', target: 'stars:lit' },
    { at: '{access.jobsOralCap} seraient', target: 'counter' },
  ],
  'acte4-velo': [
    { at: 'Alors, une solution complémentaire', target: 'mode' },
    { at: 'Sans compter le temps', target: 'stars:lit' },
  ],
  epilogue: [
    { at: 'mais ses chiffres sont réels', target: 'stars:lit' },
    { at: 'À vous d’explorer', target: 'search' },
    { at: 'votre heure', target: 'dayType' },
    { at: 'votre temps de trajet', target: 'budget' },
  ],
};

/* ------------------------------------------------------------------ étapes */

/**
 * Script de la visite pour une variante d'acte 4 et un jeu d'options (le site utilise `lea`). `video` : variante de la
 * vidéo du dépôt (textes courts, `lea-video`), sans l'étape BMO (décision de Nicolas du 06/11 : le site seulement). `video`
 * peut aussi être un objet d'options qui remplace celles de VIDEO_OPTIONS (ex. `{ halo: true }` pour remettre le halo) ;
 * y demander `bmo` est une erreur.
 */
export function buildLea(acte4: Acte4 = ACTE4, options: LeaOptions = defaultOptions(acte4), video: boolean | Partial<LeaOptions> = false): TourScript {
  if (typeof video === 'object' && video.bmo) throw new Error('Étape BMO : sur le site seulement, jamais dans la vidéo (décision de Nicolas du 06/11)');
  const opts: LeaOptions = video ? { ...options, ...VIDEO_OPTIONS, ...(typeof video === 'object' ? video : {}), bmo: false } : options;
  const played = acte4 !== 'retire';
  const steps: TourStep[] = [
    {
      id: 'prologue',
      act: 'prologue',
      // Ciel « neutre » jusqu'à l'acte 1 ; l'étoile-guide naît (temps C de D-021)
      reveal: false,
      state: { origin: LEA_ORIGIN, day: 'd09', budget: B_STORY, mode: 'transit', compare: null, pole: null },
      narration: prologue,
      minDurationMs: 8000,
    },
    {
      id: 'acte1-ciel',
      act: 'acte1',
      // Révélation : la jauge glisse du plus petit cran jusqu'à B_STORY pendant la narration
      state: { budget: B_STORY },
      budgetSweep: { from: 'min' },
      // Même base que le site : table commune x commune (compteur, astres allumés), jamais `access/`
      checks: { 'sky.basisCase': 'od' },
      narration: acte1Ciel,
      minDurationMs: 8000,
    },
    ...(opts.carte
      ? [{ id: 'acte1-carte', act: 'acte1', state: {}, view: 'map', narration: acte1Carte, minDurationMs: 6000 } satisfies TourStep]
      : []),
    {
      id: 'acte1-preuve',
      act: 'acte1',
      state: { pole: FOCUS_POLE },
      focusPole: FOCUS_POLE,
      proofFocus: 'flows',
      checks: { 'flow.case': FLUX, 'pole.verdictCase': 'allume', 'sky.basisCase': 'od' },
      narration: `${acte1Preuve} ${fluxNarration[FLUX]}`,
      minDurationMs: 9000,
    },
    // Étapes 8 (BMO) et 10 (moyens) sur la fiche de Paris 8e en 9h-17h, déjà ouverte (06/11 16h40, décision de Nicolas) : en
    // 14h-22h cette fiche affichait, le 06/11, un retour de 76 min que Navitia ne confirmait pas (46 ; la table publiée le
    // 12/11 dit 46 aussi). 9h-17h : 53 / 53, Navitia 49 / 53.
    // Aucune étoile filante (déjà tirée à l'étape précédente) ; le bassin T1 Paris et le chiffre de la famille ne dépendent pas de la journée.
    ...(opts.bmo
      ? [
          {
            id: 'acte2-recrutement',
            act: 'acte2',
            state: {},
            // le bloc « Projets de recrutement » de la fiche ouverte est souligné comme les flux ;
            // contrôles : le métier de Léa existe, sa famille a un chiffre dans le bassin (celui de la liste du panneau)
            proofFocus: 'recruit',
            checks: { 'bmo.bassinOral': 'T1 Paris', 'bmo.metierCase': LEA_PROFILE.bmoMetier, 'bmo.familyCase': LEA_PROFILE.bmoFamily },
            narration: bmoNarration,
            minDurationMs: 6000,
          } satisfies TourStep,
        ]
      : []),
    ...(opts.moyens
      ? [
          {
            id: 'acte4-moyens',
            act: 'acte4',
            // Même fiche (en TC, 9h-17h) : la climatisation déclarée et le carbone du trajet y sont lisibles
            state: {},
            checks: { 'moyens.climCase': 'declaree', 'moyens.carbonCase': 'publie' },
            // Lot 5 (D-052) : les faits des lignes (« Détail du trajet »), le carbone (« Coût et carbone ») et le tableau des moyens
            // sont dans des plis fermés par défaut : l'étape les ouvre, ils se referment à l'étape suivante
            openFold: ['trajet', 'cout', 'moyens'],
            narration: moyensNarration,
            minDurationMs: 8000,
          } satisfies TourStep,
        ]
      : []),
    {
      id: 'acte3-horizons',
      act: 'acte3',
      // Le lieu : seule la comparaison s'ouvre, en 9h-17h (la fiche du pôle se referme)
      state: { compare: HORIZON_B, pole: null },
      checks: { 'compare.horizonCase': HORIZON, 'sky.basisCase': 'od', ...(RANK === 'moins' ? { 'compare.rankCase': 'moins' } : {}) },
      narration: acte3[RANK],
      minDurationMs: 7000,
    },
    // Halo JUSTE APRÈS Montesson (06/11 20h41) : même journée (9h-17h), la comparaison reste ouverte (aucun `compare` dans l'état :
    // l'étape précédente le pose, l'étape de l'éclipse le referme), le halo s'ouvre sur les DEUX communes (A et B).
    ...(opts.halo
      ? [
          {
            id: 'halo',
            act: 'halo',
            state: { halo: 'income' },
            checks: { 'halo.compareCase': 'deux_medianes', 'sky.basisCase': 'od' },
            narration: `${haloNarration} ${haloGuard}`,
            minDurationMs: 7000,
          } satisfies TourStep,
        ]
      : []),
    {
      id: 'acte2-eclipse',
      act: 'acte2',
      // L'heure : seule la journée-type change (la comparaison se referme) ; étoile filante vers l'astre du soir (Seine-Aval)
      state: { day: ECLIPSE_DAY, compare: null },
      focusPole: EVENING_POLE,
      checks: { 'sky.basisCase': 'od' },
      narration: acte2Eclipse,
      minDurationMs: 6000,
    },
    {
      id: 'acte2-pole',
      act: 'acte2',
      // Fiche de l'astre du soir : Poissy (ancrage de Seine-Aval), aller et retour confirmés par Navitia (recoupement du 06/11)
      state: { pole: EVENING_POLE },
      focusPole: EVENING_POLE,
      // Le pli « Communes du pôle » est ouvert : la ligne de l'ancrage (Poissy) montre les minutes d'aller et de retour dites
      openFold: ['communes'],
      checks: { 'anchor.verdictCase': 'allume', 'sky.basisCase': 'od' },
      narration: soirNarration,
      minDurationMs: 5000,
    },
    ...(played && opts.voiture
      ? [
          {
            id: 'acte4-voiture',
            act: 'acte4',
            // Seul le mode change (la fiche du pôle se referme) : même commune, même journée, même temps de trajet
            state: { mode: CAR_MODE, pole: null },
            checks: { 'delta.sign': 'de plus', 'sky.basisCase': 'od' },
            narration: voiture,
            minDurationMs: 5000,
          } satisfies TourStep,
        ]
      : []),
    ...(played && opts.cout
      ? [{ id: 'acte4-cout', act: 'acte4', state: {}, narration: coutNarration, minDurationMs: 6000 } satisfies TourStep]
      : []),
    ...(played
      ? [
          {
            id: 'acte4-velo',
            act: 'acte4',
            state: { mode: 'bike_transit', pole: null },
            // Pas d'étoile filante vers un astre en or (06/11 16h30) : le nombre et la liste des astres en or ne sont pas confirmés
            // Vélo + TC : seul calcul de ce mode, sur `access/` (le site l'affiche ainsi) ; le contrôle `gain.case` garde le gain
            checks: acte4 === 'gain' ? { 'gain.case': 'gain', 'sky.basisCase': 'access' } : { 'gain.case': 'sans_gain', 'sky.basisCase': 'access' },
            narration: acte4Narration[acte4 === 'gain' ? 'gain' : 'sans_gain'],
            minDurationMs: 6000,
          } satisfies TourStep,
        ]
      : []),
    {
      id: 'epilogue',
      act: 'epilogue',
      state: { mode: 'transit' },
      narration: epilogue,
      minDurationMs: 5000,
      // Le texte ne décrit rien de l'écran : la voix suit tout de suite la dernière séquence, le ciel se repose pendant qu'elle parle
      voiceOverSky: true,
    },
  ];

  // Vidéo (?tour=lea-video&record=1) : mêmes étapes, états et contrôles, textes courts et planchers de durée réduits.
  // Repères : ceux de la version (SITE_MARKS ou VIDEO_MARKS), posés sur le texte effectivement dit.
  const narrated = video
    ? steps.map((s) => {
        const short = s.id === 'acte4-velo' && acte4 !== 'gain' ? undefined : VIDEO_NARRATION[s.id];
        const marks = short ? VIDEO_MARKS[s.id] : SITE_MARKS[s.id];
        return {
          ...s,
          narration: short ?? s.narration,
          ...(s.minDurationMs != null ? { minDurationMs: Math.min(s.minDurationMs, VIDEO_MIN_MS) } : {}),
          ...(marks ? { marks } : {}),
        };
      })
    : steps.map((s) => (SITE_MARKS[s.id] ? { ...s, marks: SITE_MARKS[s.id] } : s));

  return {
    id: video ? 'lea-video' : 'lea',
    title: video ? 'Le ciel de Léa (vidéo du dépôt)' : 'Le ciel de Léa',
    voice: 'fr-FR-Marc:MAI-Voice-2',
    disclaimer:
      'Léa est une habitante fictive. Tous les chiffres sont calculés à partir de données ouvertes (INSEE, IDFM, France Travail, DiRIF, OpenStreetMap).',
    ready: true,
    persona: LEA_PROFILE.name,
    ...(opts.bmo ? { bmoMetier: LEA_PROFILE.bmoMetier } : {}),
    steps: narrated,
  };
}

export const lea: TourScript = buildLea();
/** Version courte, celle de la vidéo du dépôt : proposée au clic sur « Lancer la visite », jouée sans choix par `?tour=lea-video&record=1` */
export const leaVideo: TourScript = buildLea(ACTE4, defaultOptions(ACTE4), true);
