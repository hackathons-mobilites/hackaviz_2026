# Design system · Réseau sous canicule

> **Brouillon, en cours de validation par l'équipe.** L'interface actuelle de `web/` est un prototype interne et ne suit pas encore ce document. La maquette de référence est [`design/maquette/index.html`](design/maquette/index.html) (étape « Mesures »).

Les valeurs (couleurs, polices, espacements) sont dans [`design/tokens.css`](design/tokens.css) ; ce document dit **quand** et **comment** les employer.

## 1. Origine

- **Palette et typographie** : design system « Paris Mobilité », version « Papier ». Couleurs observées sur iledefrance-mobilites.fr, **pas une charte officielle IDFM**. Le projet est une candidature indépendante au Hackathon Mobilités 2026 et n'affirme aucune affiliation.
- **Mise en page** : bureau en canevas. Des fenêtres sont posées sur un fond uni, avec une carte dans une fenêtre et non en plein écran.
- **Ton** : bulletin statistique éditorial. La hiérarchie vient de la typographie et des filets fins, pas des couleurs, des ombres ni des icônes.

## 2. Principes

1. **La donnée d'abord.** Fond clair, carte en niveaux de gris, un seul accent bleu : les couleurs de données gardent tout leur contraste.
2. **Une question par fenêtre.** Le titre de chaque fenêtre est une question (« Quelle mesure protège le mieux ? ») ; son contenu y répond par un chiffre, un graphique et une phrase.
3. **La méthode est visible.** La fenêtre « Données et méthode » montre le chemin des sources aux calculs, pas seulement une liste de sources.
4. **Rien ne demande d'action pour fonctionner.** Pas de « rechargez », « lancez » ni « calcul en cours » à l'écran.

## 3. Mise en page

| Zone | Contenu | Règle |
|---|---|---|
| Rail droit « Outils » | carte, graphique, tableau, sources, notes | 56 px, boutons de 38 px |
| Bureau | fenêtre carte (2 lignes de haut) · fenêtre méthode (hauteur de son contenu, entièrement visible) · fenêtre résultat (reste) | du bord gauche jusqu'au rail des outils ; grille `1,32fr / 1fr` ; écart `--gap` |
| Rangée du bas | sélecteur d'écran (gauche : « Mesures », « Cartogramme »…) · barre du guide (centre, 640 px au plus) · zoom (droite) | une seule rangée flexible ; seule la barre du guide rétrécit ; l'écran affiché est en `--accent` |

- **Pas de barre du haut** : ni titre du site, ni fil d'Ariane, ni boutons d'action. Le bureau commence en haut de l'écran ; c'est le titre de chaque fenêtre (une question) qui dit de quoi parle l'écran.
- Formats vérifiés : 1 280 × 800, 1 440 × 900, 1 920 × 1 080. Aucun chevauchement, aucun texte coupé, aucune fenêtre qui défile.
- **Règle : la carte se voit toujours en entier.** Elle est recadrée sur ce qui est affiché (et non sur les limites réelles de la région) au chargement, après chaque réglage, pendant et après chaque déformation, au redimensionnement et quand le guide rend la main. Seul un zoom demandé (par l'utilisateur ou le guide sur un exemple) la montre en partie.
- **Règle : tout tient sur un seul écran, sans défilement vertical.** La mise en page de référence fait 1 280 × 800. Sur un écran plus petit, tout le bureau est réduit à l'échelle (comme un canevas qu'on dézoome), jamais empilé ni mis en défilement. Le guide, l'organigramme et la carte tiennent compte de cette échelle.
- **Aucun texte ne déborde** : on raccourcit le texte ou on le laisse passer à la ligne, jamais d'ellipse sur une information.
- Pas de défilement horizontal de la page.

## 4. Navigation

Pas de barre d'étapes. On change d'écran avec le sélecteur en bas à gauche, ou en le demandant au guide (« Montre le cartogramme ») ; **le guide est la navigation fine**. On lui demande ce qu'on veut voir et il ouvre la bonne fenêtre, le bon scénario, la bonne carte (section 8). Le titre de la fenêtre principale dit où l'on est.

## 5. Couleur

### Interface
- `--accent` (bleu) est la **seule** couleur d'action : onglet actif, bouton principal, scénario actif, focus, fenêtre active (contour de 1,5 px).
- `--alert` (rouge) signifie **alerte**, et seulement cela : badge de vigilance, valeur critique.
- Texte : `--tx`, `--tx2`, `--tx3`. `--tx3` est le plancher (4,7:1 sur le canevas).

### Données

| Usage | Palette | Règle |
|---|---|---|
| Chaleur, dose | `--heat-1` à `--heat-5` | séquentielle orangée, clair = faible |
| Effet d'une mesure | `--div-pos` (bleu, baisse) · `--div-mid` · `--div-neg` (rouge, hausse) | divergente centrée sur « canicule sans mesure » |
| Part, densité | `--seq-1` à `--seq-5` | séquentielle bleue |
| Non significatif | `--ns` | gris, jamais coloré |
| Modes | `--m-metro`, `--m-rer`, `--m-tram`, `--m-bus` | codage fixe ; les lignes de la carte gardent leur couleur officielle IDFM |

- La couleur ne porte jamais seule l'information : valeur écrite au bout de chaque barre, légende sur chaque carte.
- Au plus 4 couleurs catégorielles par graphique.

## 6. Typographie

| Rôle | Police | Taille |
|---|---|---|
| Question du récit | Raleway 700 | 16 px |
| Titre de fenêtre | Raleway 600 | `--fs-title` (17 px) |
| Chiffre clé | Raleway 700, interlettrage −0,02 em | `--fs-figure` |
| Texte, onglets, contrôles | Raleway 500-600 | `--fs-body`, `--fs-ui` |
| Valeurs de graphique, légendes chiffrées | IBM Plex Mono | `--fs-mono` |
| Sources, notes | Raleway | `--fs-small` (12 px), jamais moins |

- Raleway a des chiffres elzéviriens par défaut : toujours `font-variant-numeric: lining-nums tabular-nums`.
- Typographie française : espace insécable avant `: ; ? !` et `%`, guillemets « », apostrophe ’, signe moins « − » (U+2212) et non le tiret, virgule décimale.

## 7. Composants

| Composant | Règle |
|---|---|
| Pilule | fond `--panel`, filet 1 px `--line`, ombre à peine visible (`--shadow-s`), rayon `--r`, 44 px de haut |
| Fenêtre | en-tête : titre (une question) et bouton agrandir, rien d'autre ; onglets optionnels ; corps ; pied optionnel. Pas de poignée ni de menu « … » qui ne font rien. « Agrandir » (bouton ou double-clic sur l'en-tête) occupe tout le bureau ; second clic ou Échap pour revenir |
| Sélecteur de scénario | puce accentuée « Scénario · valeur » en tête des filtres de la fenêtre carte ; menu groupé Référence / Mesures. Le scénario ne prend pas de place permanente à l'écran |
| Puce de filtre | état courant d'un paramètre (heure, catégorie), sur une seule ligne. La puce de contexte « 24 juin · 40,5 °C » est en `--alert` : c'est le jour de vigilance rouge |
| Note de lecture | précaution (« échantillon de 1 % ») posée sur la carte, en haut à gauche, pas dans la barre de filtres |
| Organigramme de méthode | sources à gauche, traitements à droite, résultat en bas ; chaque bloc : icône linéaire monochrome de 15 px dans un carré à filet, titre, une ligne de détail. Connecteurs coudés fins avec pointe, tracés automatiquement selon la taille de la fenêtre. Survol d'une étape : ses sources et ses liens passent en `--accent`, le reste s'estompe. Seul le bloc résultat porte l'accent au repos |
| Formulaire de réglages | une ligne par réglage : libellé court à gauche (150 px), commande à droite (contrôle segmenté ou liste), filet fin entre les lignes ; dernière ligne : la précision du calcul en chiffres. Le formulaire garde toujours la même hauteur : un réglage qui n'existe que dans certains cas (le jour) va dans la barre de la fenêtre carte |
| Barres divergentes | barres de 16 px à angles quasi droits ; libellés en `--tx2`, valeur au bout de la barre ; la référence (zéro) est dite dans la ligne de source sous le graphique |
| Ligne de source | sous chaque graphique, 11,5 px `--tx3` : ce que mesure le graphique, la source, l'échelle |
| « À retenir » | surtitre en petites capitales puis une phrase dont le début est en gras, sous un filet fin. **Pas d'encadré coloré ni de filet de couleur à gauche** |
| Contrôle segmenté | 2 à 4 options, option active pleine `--accent` |
| Barre du guide | mascotte, champ « Demandez au guide… », bouton « Demander » ; voir section 8 |

Icônes : linéaires, traits de 1,6 à 1,7 px, `currentColor`, un seul jeu cohérent. Sur les boutons (agrandir, outils, zoom) et dans l'organigramme de méthode, où elles identifient la nature d'une source ou d'un traitement. Jamais devant un libellé de liste, une puce ou une légende ; jamais d'émoji.

## 8. Le guide

Le guide est un agent qui **pilote l'interface** pour répondre : on lui pose une question, il répond dans une bulle et montre la réponse à l'écran.

| Élément | Règle |
|---|---|
| Mascotte | goutte d'eau bleue (`--accent`), dessinée pour le projet ; 26 px dans la barre, 38 px dans la bulle. États : repos, réflexion (flotte), parole (bouche animée). Pas de mascotte ni de pictogramme IDFM |
| Bulle | au-dessus de la barre ; se place automatiquement pour ne jamais cacher l'élément montré ; texte écrit progressivement ; suggestions de questions suivantes ; bouton « Compris » |
| Mise en avant | l'écran s'assombrit sauf l'élément montré, entouré de `--accent` ; un élément petit (carte de méthode) est agrandi de 6 % |
| Actions | zoomer la carte sur une commune, choisir un scénario, changer d'indicateur, souligner une mesure dans le graphique (les autres s'estompent), agrandir une fenêtre |
| Retour | « Compris » ou Échap annule tout ce que le guide a changé à l'affichage (fenêtre agrandie, mise en avant) ; le scénario choisi reste |
| Ouverture | au clic dans le champ, la bulle propose cinq questions types |

- Le guide ne répond qu'avec les chiffres affichés dans le site, et montre toujours où il les prend.
- **Architecture** : le guide est un agent du **Claude Agent SDK**, lancé par le serveur local `design/maquette/agent/serveur.py`. Il n'a accès qu'à ses outils : lire les données du site (chercher une commune ou un IRIS, classer les zones avec filtre par commune ou département, résultats des mesures, méthode) et piloter l'interface (régler le cartogramme, entourer une zone, zoomer, mettre en avant, agrandir, changer de scénario ou d'écran, proposer des questions de suite). Ni fichiers, ni shell, ni web. Le serveur renvoie au navigateur la réponse et la liste d'actions, que la page exécute avant d'afficher le texte ; la conversation est reprise d'une question à l'autre. Sans serveur, le guide retombe sur des questions préparées.
- **Longueur des réponses** : deux phrases, 35 à 50 mots. La première répond, la seconde donne le chiffre qui le prouve. Ni pavé, ni réponse vague ; toujours un exemple concret montré à l'écran.

## 9. Carte

- **Animation (écran Simulation)** : deux vues en **points regroupés**. **Agents** (par défaut) : chaque voyageur simulé est un point coloré selon son état (attente dehors en `--heat-4`, marche en encre estompée, vélo en `--ok`, à bord en gris) ; quand plusieurs sont proches (cellule de 10 px), ils fusionnent en un cercle dont la taille suit leur nombre ; avec « Bus non clim. », ceux qui sont dans un bus non climatisé passent en `--alert` et le reste s'estompe. **Différence** : un cercle par hexagone de 1 km, bleu (`--div-pos`) là où il y a moins de voyageurs dehors en vigilance rouge qu'en journée ordinaire, rouge (`--div-neg`) là où il y en a plus, taille selon l'écart ; les petits écarts dus à l'échantillon sont masqués ; les deux plus fortes baisses et hausses sont nommées sur la carte et dans le bandeau. Pas de carte de chaleur. Réseau en fond, très léger. Commandes dans la barre de la fenêtre : vue, journée (désactivée en Différence), Lecture / Pause, bus non climatisés, curseur de l'heure avec horloge ; le graphique des départs porte un curseur synchronisé.
- **Recommandations de la note de Jorge (7 novembre 2026), intégrées dans l'écran unique** : chaque scène et chaque page du final pose sa **question en titre** (« Qui peut rester chez soi ce jeudi ? », « Sa ligne a-t-elle résisté à la canicule ? »…) et donne la réponse en une phrase ; chaque vue a un bouton **« Données »** qui remplace le dessin par son tableau (accessibilité) ; les **trois niveaux** sont distingués : « Mesuré » (plein), « Reconstitué » (tirets), « Projeté » (pointillés). Ajouts : la part des **femmes** parmi les actifs sans télétravail ni horaires flexibles (deux sur trois, enquête Ipsos BVA, Institut Paris Région 2026) dans la scène « La porte » ; l'aparté mesuré **« Sa ligne a-t-elle résisté ? »** (graphique en pente jour normal / vigilance rouge, ses lignes en trait épais, tirets pour les bus sans clim, indice présenté comme un ordre de grandeur, le choix des jours de référence pouvant le décaler de quelques points) ; la page **« Demain »** du final (trajectoire TRACC : vagues de chaleur 5 fois plus fréquentes entre 2030 et 2050, un été comme 2026 deviendrait normal, puis frais à +4 °C ; valeurs nationales). Les horaires décalés (départ à 5 h) restent hors champ : la simulation et les horaires chargés ne couvrent que le matin.
- **Créer son personnage, puis calculer** : rien n'est montré avant le calcul, ni trajet ni résultat ; la carte fait seulement tourner la simulation (trains et voyageurs simulés, de 6 h 30 à 9 h 30, horloge en haut à droite). Le panneau de gauche guide en quatre étapes : 1. son travail (employé, ouvrier, profession intermédiaire, cadre ; ou un exemple de la simulation qui remplit tout), 2. son personnage (prénom, elle ou il, apparence), 3. sa journée (métier d'exemple, heure de départ ou « à l'heure de la simulation », âge, poussette), 4. son trajet : domicile et travail par adresse (suggestions : communes et gares du site, puis adresses de la Base Adresse Nationale, Île-de-France seulement), ou par un clic sur la carte (bouton « Sur la carte », épingles « Domicile » et « Travail ») ; puis « Calculer sa journée ». Le calcul cherche d'abord dans la simulation : quelqu'un de sa catégorie qui fait ce trajet, puis quelqu'un d'une autre catégorie, puis le trajet simulé le plus proche entre communes voisines ; à défaut, ou si sa marche est plus lente (60 ans et plus, poussette, que la simulation ne distingue pas), le trajet est calculé sur les horaires. Le carton d'ouverture dit d'où vient le trajet.
- **Un seul écran** : le livrable se résume à « Une journée sous canicule » ; les écrans Mesures, Cartogramme et Simulation ne sont plus proposés (fichiers conservés, plus de liens). **La carte d'abord** : chaque scène est un panneau étroit sur le côté (380 px au bureau), sans voile, ou un tiroir bas de 40 % au plus sur tablette et téléphone. **Graphiques illustrés plutôt que des barres** : l'arrêt dessiné (soleil et température, vagues de chaleur si le quartier est chaud, poteau à la couleur de la ligne attendue, la personne qui attend, arbre et distance du lieu frais), le trajet en pictogrammes (à pied, attente, à bord ; longueur = minutes, aller et retour à la même échelle), la conclusion en soleils (un soleil = une minute dehors, rangées de dix) avec la silhouette de chaque personne.
- **Écran « Une journée sous canicule »** (anciennement « La journée de Nadia ») : un **récit illustré**, en 2D, qui suit **une personne type tirée de la simulation MATSim**. **Ouverture** : « Choisissez une personne. », cinq cartes (groupe radio) et **une fiche par personne** : silhouette (six choix : teint et coiffure), prénom modifiable (20 caractères), accord elle / il, catégorie en mots simples, métier d'**exemple** (pastille « exemple », liste fermée), communes de domicile et de travail, heure de départ, lignes, barre « Dehors ce matin » (à pied / à l'arrêt), « Jeudi 25 juin : elle part / reste chez elle » avec dix bonshommes de son groupe, « Comme elle : environ N … (estimé) », badge « Reconstitué » et la mention « Personne simulée (MATSim, 1 % des navetteurs), pas une personne réelle ». Bouton « Une autre personne du même groupe » (dix suivants dans l'ordre de sélection). « Modifier son trajet » (replié) recalcule sur les horaires (RAPTOR) et l'annonce « hors simulation ». Prénom, accord, silhouette et métier sont gardés dans le navigateur seulement, jamais dans l'adresse. **Pendant le trajet**, trois éléments : l'heure et la température (haut gauche, avec « Vigilance rouge »), le compteur **« Dehors : N min »** (haut droite : à pied + à l'arrêt en surface, état « au soleil », « à bord, à l'abri », « à bord, sans clim »), la frise dont **les motifs sont la légende** (orange plein = à pied, orange hachuré = à l'arrêt, bleu = à bord, orange clair rayé = bus sans clim), plus une ligne de légende en phrase simple (« Huit minutes à pied, en plein soleil. », « Dans le RER B, elle est à l'abri du soleil : le compteur s'arrête. »). Plus de thermomètre ni d'anneau de « dose » : l'unité est la minute dehors. **Trois scènes** : la porte (dix bonshommes par catégorie : qui part, qui reste chez soi), à l'arrêt (trois questions : quartier très chaud, lieu frais à moins de 300 m, passages ; « inconnu » si la donnée manque ; nombre estimé de Franciliens dehors à cette minute), arrivée (bandes ce matin / ce soir à partir des trajets aller et retour de l'agent). **Deux apartés** (cartogrammes, voir plus bas). **Conclusion** : « Ceux qui ne peuvent pas rester chez eux passent le plus de temps dehors. » : les cinq personnes en barres (minutes dehors ce matin, trait = médiane de son groupe), moyenne par personne en comptant ceux qui restent chez eux (employé contre cadre), boutons « Suivre … », puis trois mesures à cocher (ombrager les arrêts, doubler les passages, climatiser les bus) qui recalculent ses minutes au soleil ou dans un bus chaud et se dessinent sur la carte. Une personne qui reste chez elle (Julie) : son trajet habituel en pointillés gris, puis directement la comparaison. **Personnage** : silhouette choisie sur la fiche ; de face quand il attend, de profil quand il marche, remplacé à bord par le badge de la ligne. Les véhicules suivent les tracés officiels IDFM ; la marche est tracée à vol d'oiseau (aucun service en ligne). **Téléphone** : fiche en une colonne (cartes en ligne défilante, boutons collés en bas), scènes et conclusion en tiroir bas, carte au-dessus.
- **Cartogramme dans le récit** : un aparté, « Les arrêts de son trajet » (sur la carte, pendant son plus long trajet) : les arrêts à moins d'un kilomètre de son itinéraire deviennent des cercles proportionnels aux voyageurs d'un jour ordinaire, orange s'ils cumulent au moins trois fragilités ; titre calculé (part des voyageurs qui passent par un arrêt très exposé). L'aparté « Où vivent les plus exposés » (carte redessinée selon les habitants exposés) a été retiré le 13 novembre 2026 : la forme déformée ne se lisait pas en quelques secondes. Le temps de trajet de sa commune est montré par des barres jour normal / canicule.
- **Relecture des panneaux (12-11-2026)** : chaque panneau a été capturé en clair et en sombre puis relu comme par un visiteur pressé (compris en 5 secondes ?), avec un audit clavier et lecteur d'écran. Règles qui en découlent : une phrase qui dit le constat, pas de chiffre qui contredit le message (« 1 vulnérabilité sur 5 » a été retiré) ; on annote le graphique plutôt que d'ajouter une phrase (« 20 min dehors » au-dessus de la barre, « +12 min » sur la courbe, étiquettes au bout des droites) ; les séries se distinguent par la couleur et le trait ; des mots simples (« un bus toutes les 3 min », « jour normal », « chaleur reçue ») ; pendant le trajet, seul son itinéraire est en couleur, le reste du réseau en gris neutre opaque (la transparence s'accumulait sur les tracés superposés), voyageurs simulés et autres trains masqués sauf au chapitre « Elle n'est pas seule » ; la jauge devient bleue « au frais » à bord climatisé ; chaque graphique a un texte alternatif qui donne la conclusion ; chapitres : focus à l'ouverture, Échap pour fermer (plus Entrée), focus rendu à la fermeture, bouton « Lecture continue » pour couper la fermeture automatique ; repères de la frise en vrais boutons nommés ; 12 px minimum.
- **Contraste** : tout texte visible atteint 4,5:1 (3:1 au-delà de 24 px ou 18,7 px gras), en clair comme en sombre, vérifié par un audit automatique sur chaque écran et chaque chapitre. L'orange de la chaleur a une variante texte (`--hot-tx`, plus foncée en clair, plus claire en sombre) ; sur une couleur de ligne, l'encre (blanche ou foncée) est choisie pour le meilleur contraste. Les graphiques prennent leurs couleurs dans les variables du thème (`style="fill:var(--tx2)"`), jamais une valeur figée au dessin.
- **Performance** : la scène ne réécrit dans le DOM que ce qui change, et jamais une variable CSS sur un conteneur qui englobe toute la scène (recalcul de style de tout le sous-arbre à chaque image).
- **Mode sombre** : suit la préférence du système ; bouton soleil / lune dans la barre du bas de chaque écran, choix mémorisé sur le poste. Jetons sombres dans `tokens.css` ; fond de carte OpenFreeMap « dark » sur l'écran Nadia, fond OSM inversé ailleurs.
- **Noms sur les cartes** : toujours des repères nommés. Communes en petites capitales espacées, arrondissements de Paris abrégés (« 15e ») en gris, IRIS en casse normale ; trois tailles selon l'importance de la zone ; halo blanc fin. Les plus grandes zones sont nommées d'abord, **jamais deux étiquettes qui se chevauchent**, 40 noms au plus ; la zone entourée par le guide est toujours nommée. Recalcul après chaque réglage, déformation et zoom.
- **Cartogramme** : le fond OpenStreetMap en gris s'estompe à mesure que la carte se déforme (les formes ne correspondent plus au terrain) ; aplats séparés par un filet blanc ; légende en bandeau sous la carte, jamais par-dessus ; un encadré « Ce que montre la carte » donne le message, calculé à partir de ce qui est affiché (concentration du poids, zones qui ressortent, avec leur nom) ; bouton « Cartogramme / Carte réelle » pour animer la déformation ; la légende dit à quoi la surface est proportionnelle.

- Fond OSM en niveaux de gris (`--map-filter`), attribution visible.
- Une couche de données par onglet, une légende dans la fenêtre (en bas à gauche), le niveau d'agrégation affiché en haut à droite (« Communes », « IRIS »).
- Symboles proportionnels pour les volumes, aplats pour les taux.

## 10. Mouvement

Entrée des fenêtres de 6 px, croissance des barres ; durée ≤ 0,2 s, sauf les gestes du guide (cadre de mise en avant 0,35 s, vol de la carte 1,2 s). Tout est coupé par `prefers-reduced-motion` : le guide répond alors sans animation.

## 11. Accessibilité

- Contraste du texte ≥ 4,5:1, des éléments graphiques ≥ 3:1.
- Focus visible : contour 2 px `--accent`.
- Cibles cliquables ≥ 24 px.
- Graphiques en SVG avec `role="img"` et un `aria-label` qui dit ce qu'il faut retenir.
- Navigation complète au clavier ; `lang="fr"`.

## 12. Points en attente de décision

- **Logotipo et mascotte IDFM** du design system d'origine : écartés tant que l'organisation du hackathon n'a pas autorisé leur usage.
- **Mode sombre** : non retenu pour l'instant.
- **Autres écrans** à maquetter : constat agrégé, votre trajet.
- **Agent du guide** : branchement sur le Claude Agent SDK, puis sur l'API.

## 13. Interdits

- Charte, logo ou mascotte IDFM sans autorisation ; présenter le projet comme officiel.
- Dégradés, flous, lueurs, trames de fond ; une seconde couleur d'action.
- Les motifs « générés » : cartes à icône et fond teinté, encadrés à filet de couleur à gauche, icône devant chaque libellé, ombres portées partout.
- Un texte qui demande de lancer, recharger ou attendre.
- Un chiffre sans source ni unité.
