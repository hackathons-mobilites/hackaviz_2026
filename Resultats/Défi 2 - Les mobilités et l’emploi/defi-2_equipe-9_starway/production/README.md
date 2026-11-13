# STARWAY - Les constellations de l'emploi

> *« Nous vivons tous sous le même ciel, mais nous n'avons pas accès aux mêmes étoiles. »*

Dataviz interactive de l'équipe **Starway, by Middleway** pour le Hackathon Mobilités 2026 « Spécial Dataviz' » d'Île-de-France Mobilités, **défi n° 2 « Les mobilités et l'emploi »**.

**Voir le site : https://jolly-cliff-07f518503.5.azurestaticapps.net**

**Notre présentation, c'est la visite guidée du site** : sur la page d'accueil, cliquez sur **« Lancer la visite »**, puis sur **« Version courte »** (environ 3 minutes, son activé, sous-titres affichés). Elle pilote le site lui-même, puis vous rend la main.

## Ce que c'est

Le défi n° 2 demande comment les réseaux de transport permettent d'atteindre les lieux où l'emploi se concentre. STARWAY pose la question depuis le domicile : **comment la commune où l'on habite, l'horaire de sa journée de travail et son mode de déplacement changent-ils l'accès, à l'aller et au retour, aux pôles d'emploi d'Île-de-France ?**

La réponse prend la forme d'un ciel fixe de 44 astres (les bassins d'emploi, Paris étant découpé en 20 arrondissements). On choisit sa commune parmi les 1 285 communes et arrondissements de la région, puis une journée de travail, un temps de trajet maximal par sens et un mode de déplacement. Les pôles que l'on peut rejoindre **à l'aller ET au retour** s'allument, les autres restent visibles, éteints.

Deux façons de l'utiliser :

- **Explorer le ciel** : un explorateur de scénarios. On compose les siens, on compare deux communes, on pose le ciel sur une carte, on partage chaque scénario par son lien. Un clic sur un astre ouvre la preuve : durées de l'aller et du retour, trajet, coût, sources.
- **Lancer la visite** : une visite guidée sous-titrée suit Léa, une habitante imaginaire de Maisons-Laffitte, avec des chiffres réels. Elle pilote l'application réelle, en version courte ou complète, puis rend la main.

Les chiffres se lisent sur le site : ils sont produits par le calcul décrit ci-dessous et ne sont pas recopiés ici.

## Ce que l'on peut faire sur le site

### Composer un scénario

- **La commune de départ** : le bouton « Ma commune de départ », en bas à gauche, ouvre un champ de recherche (accents et tirets facultatifs, choix à la souris ou au clavier). Toutes les communes d'Île-de-France et les arrondissements de Paris sont proposés. Le calcul part d'un point de la commune, le centre de gravité de sa population, et non d'une adresse.
- **L'horaire** : une des trois journées-types, ou des horaires libres (début et fin du poste, y compris un poste de nuit qui finit le lendemain matin) pour les transports en commun.
- **Le temps de trajet par sens** : une jauge. L'aller et le retour doivent tenir chacun dans ce temps.
- **Le mode** : transports en commun et marche, vélo jusqu'à la gare puis transports en commun, vélo, marche, voiture sur route vide ou avec un trafic moyen, Vélib'. Un mode qui n'est pas calculé pour la commune choisie est grisé, avec la raison. Le vélo + transports en commun est calculé pour les 1 285 communes et arrondissements ; Vélib', pour les communes qui ont une station.

Chaque scénario a son adresse : « Copier le lien » ouvre le même ciel chez la personne qui le reçoit. Le menu « Découvertes » propose des scénarios remarquables, calculés sur les données et non choisis à la main.

### Ouvrir un astre : le panneau de preuve

Le panneau dit pourquoi l'astre est allumé ou non : la part de ses postes atteinte à l'aller et au retour, l'itinéraire de chaque sens ligne par ligne, les correspondances plus courtes que le minimum connu, les communes du pôle, le coût et le carbone du trajet, les postes salariés recensés par l'INSEE et les projets de recrutement du bassin, la comparaison de tous les modes calculés pour ce pôle, et les conditions exactes du calcul. Tout est replié à l'ouverture : on déplie ce que l'on veut lire.

**Autres trajets.** En transports en commun, la fiche propose, sens par sens, trois trajets : **le trajet retenu par le calcul** (l'itinéraire publié, dont la durée est la plus proche du temps calculé, qui n'est donc pas toujours le plus court), **le moins cher** (classé au ticket à l'unité, plein tarif) et **le moins de correspondances**, chacun avec ses lignes, sa durée, son coût et son carbone, comparés au trajet retenu. Quand il n'y a pas de trajet différent à montrer, le panneau ne dit pas la même chose selon que le calcul a été fait ou non :

- « **Calculé, pas d'autre trajet** » : la recherche a été faite pour cette commune, ce pôle, cette journée et ce sens, et elle ne trouve que le trajet retenu ;
- « **Calcul fait, non affiché** » : la recherche a été faite, mais son trajet de référence n'est pas l'itinéraire publié dans le panneau ; la raison est écrite ;
- « **Pas encore calculé** » : la recherche n'a pas été faite, ou sa donnée manque. Une donnée absente n'est jamais présentée comme une absence de trajet.

Les autres trajets sont cherchés pour les trois journées-types, à l'aller et au retour, avec le réglage de marche « normal » (le réglage « confort », au plus 1 km à pied, est publié pour les 1 285 communes, réseaux de jour et de nuit : export final du 13/11/2026 à 06h08 UTC). Le calcul est fini pour toutes les communes de départ (export final du 11/11/2026 à 10h10) : les 1 285 communes et arrondissements sur 1 285 sont couverts (champ `n_communes_with_file` sur `n_communes` de `frontend/public/data/alternatives/coverage.json`), sur 339 240 cases (commune, astre, journée, sens) dont 53 385 avec d'autres trajets, 285 855 calculées sans autre trajet et aucune « Pas encore calculé ». Une case non calculée serait écrite « Pas encore calculé », jamais « pas d'autre trajet ». La largeur de la recherche est un choix de l'équipe, donné dans la bulle « i » du bloc.

**L'or du gain démontré.** En mode vélo + transports en commun, un astre passe en or quand ce mode le rejoint à l'aller et au retour alors que les transports en commun seuls, dans le même scénario, n'en atteignent aucun poste. L'or est réservé à ce gain avant et après : il n'est jamais une décoration.

### Mes réglages

« Mes réglages », dans la barre du haut ou dans le tiroir de la barre du scénario, ouvre un dialogue à deux onglets :

- **Mes abonnements** : son titre de transport (forfaits Navigo, tarifs réduits, gratuités) et sa formule Vélib'. Le coût affiché dans le panneau en tient compte ; le ciel ne change pas.
- **Ce qu'il me faut sur mon trajet** : six cases (véhicules et arrêts déclarés adaptés au fauteuil roulant, gares sans réservation d'assistance, lignes déclarées climatisées, annonces sonores, annonces visuelles). Le site recopie ce que **déclarent** les sources, tronçon par tronçon : « non renseigné » n'est jamais écrit « non », et aucun trajet n'est déclaré « accessible ». Avec les quatre premières cases, un astre est marqué quand tout ce qui est coché est déclaré rempli sur tout le trajet le plus rapide, à l'aller et au retour ; la marque ne change ni son état ni les temps. Les annonces se lisent dans le panneau. Trois besoins restent grisés faute de donnée ouverte : ascenseur de la rue au quai, escalators, guidage au sol.

Rien ne change avant le bouton « Enregistrer ». Ces choix sont gardés **dans ce navigateur seulement** : ils ne sont jamais écrits dans le lien d'un scénario, et la visite guidée joue sans eux.

### Visite guidée

« Lancer la visite », sur l'écran d'accueil ou dans la barre du haut, propose deux versions du même récit : la **version courte**, qui va à l'essentiel, et la **version complète**. Les deux pilotent le vrai site, avec les mêmes états et les mêmes chiffres : le lieu, l'heure, puis le mode changent le ciel de Léa. Les sous-titres accompagnent chaque étape. Une voix de synthèse, générée à l'avance (Azure AI Speech, voix et réglage validés à l'écoute), lit le texte : 4 min 24 s de narration pour la version complète (13 étapes) et 2 min 10 s pour la version courte (9 étapes). Avec les transitions du ciel, la révélation d'ouverture et le générique, la visite dure environ 3 min en version courte (178 à 179 s, mesures du 13/11/2026) et 5 min 39 s (339 s, mesure du 11/11/2026) en version complète. Le bouton « Voix » la coupe, les sous-titres restent. Pendant la visite, l'élément dont parle la voix (un astre, le compteur, la jauge, une partie du panneau) est entouré au moment où elle en parle, les boutons qu'elle n'utilise pas sont atténués (jamais le ciel), le prénom « Léa » s'affiche sous l'étoile-guide et les sous-titres suivent la voix, par phrase ou par morceau de phrase. Les commandes permettent de revenir en arrière, de mettre en pause, d'avancer ou de quitter, et toute action de l'utilisateur met la visite en pause. À la fin, le ciel est à vous.

### Aide et mode sources

- **Aide** (barre du haut) : une entrée par fonction du site, avec ce à quoi elle sert, comment faire, ce qu'il faut savoir et une capture, et une recherche. Les captures se refont à partir du site (voir [docs/aide.md](docs/aide.md)).
- **Mode sources** (bouton « Provenance des données ») : une bande sous le ciel, et sous chaque bloc du panneau la source, son millésime et un lien vers sa fiche dans « Sources & limites ». Hors de ce mode, sources et millésimes sont rangés dans les bulles « i », le pli « Méthode et sources » et la page « Sources & limites » ; le crédit OpenStreetMap, avec son lien, reste toujours visible ; la phrase de licence (ODbL) est dans une bulle « i ».

### Autres lectures du ciel

La **carte miroir** pose les mêmes pôles sur la carte des communes ; « **Lire le ciel en liste** » donne le même contenu en tableau triable ; l'**affiche** exporte une image du ciel avec le scénario en clair et son texte à copier. Un clic sur sa commune ouvre « **Derrière notre étoile** » : âges, modes domicile-travail, niveau de vie, chômage de la zone d'emploi, chaque valeur avec son dénominateur. Ces statistiques décrivent la commune et ne disent rien de l'accès aux pôles, ni d'une cause.

## Comment lire le ciel

| Ce que l'on voit | Ce que cela veut dire |
|---|---|
| Un astre | Un pôle d'emploi. Sa place ne change jamais, quel que soit le scénario. Son aire est proportionnelle à ses **postes salariés recensés par l'INSEE** (Flores 2023). |
| L'étoile-guide | La commune de départ choisie. |
| Astre cyan, contour plein | **Accessible** : l'aller et le retour tiennent chacun dans le temps choisi. |
| Astre partiellement allumé | Une partie seulement de ses postes est accessible : le cœur cyan est proportionnel aux postes des communes atteintes. Les modes calculés pour le pôle entier (vélo + transports en commun, Vélib') allument l'astre en entier ou pas du tout. |
| Éteint, contour plein en haut et tirets en bas | L'aller est possible, le retour est hors de portée ou introuvable. |
| Éteint, tirets | Hors de portée dans ce scénario, ce qui ne veut pas dire « aucun transport ». |
| Points | Pas calculé pour ce scénario. Aucune valeur n'est mise à la place. |
| Or, avec une seconde orbite | Gain démontré : le pôle est atteint à l'aller et au retour avec le vélo jusqu'à la gare, et les transports en commun seuls n'en atteignent aucun poste. |
| Une marque sur l'astre | Les besoins cochés dans « Mes réglages » (véhicules, arrêts, gares) sont déclarés remplis par les sources sur tout le trajet le plus rapide, à l'aller et au retour. La marque ne change ni l'état de l'astre ni les temps. |

Chaque état a une forme propre et ne dépend pas de la seule couleur. Le bouton « Lire le ciel en liste » donne le même contenu en texte, et un mode de couleurs adaptées au daltonisme est proposé.

Les journées-types (6h-14h, 9h-17h, 14h-22h) sont des scénarios, pas les horaires réels des salariés.

## Lancer le site en local

Il faut **Node.js 24**. Le site est entièrement statique : les données sont déjà dans `frontend/public/data/`, et aucune API n'est appelée pendant la consultation. Le calcul n'est donc pas nécessaire pour lancer le site.

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

Autres commandes, dans `frontend/` : `npm run build` (version de production dans `frontend/dist`), `npm run preview`, `npm test`, `npm run lint`.

## Refaire le calcul

Le dossier `pipeline/` télécharge les sources, calcule les temps de trajet et écrit les fichiers lus par le site. Il faut **Python 3.12** et un **JDK 21** (pour r5py) : soit installé sur la machine (`JAVA_HOME`), soit décompressé dans `.tools/jdk-21/` à la racine du dépôt, où le pipeline le trouve seul.

```bash
cd pipeline
python -m venv .venv
source .venv/bin/activate      # Windows (Git Bash) : source .venv/Scripts/activate
pip install -e ".[dev]"

python scripts/01_download.py                  # sources dans data/raw/ (voir la note ci-dessous)
python scripts/02_build_geo.py                 # communes et arrondissements
python scripts/03_build_jobs_poles.py          # postes salariés (INSEE) par commune
python scripts/03b_sky_groups.py --publish     # les 44 astres (réécrit frontend/public/data/poles.json)
python scripts/04_compute_matrix.py            # essai du moteur : 3 communes, transports en commun (construit d'abord le réseau)
```

Certaines sources se déposent à la main, parce que leur site refuse les téléchargements automatiques ou que le fichier est lu une seule fois : la liste et les adresses sont dans [data/raw/README.md](data/raw/README.md). Les bassins d'emploi, lus par `03b_sky_groups.py`, sont dans ce cas.

| Étape | Scripts de `pipeline/scripts/` | Machine |
|---|---|---|
| Sources, communes, postes, astres | `01_download`, `02_build_geo`, `03_build_jobs_poles`, `03b_sky_groups` | ordinaire |
| Temps de trajet | `04_compute_matrix_b44` (marche, vélo, voiture), `04e_compute_walk_variant` (transports en commun), `04c_compute_od_table` (commune à commune), `04h_transit_itineraries` (trajets détaillés), `04b_compute_story_matrix` (vélo + transports en commun), `04d_compute_velib` (Vélib'), `04g_car_distances`, `04q_transit_alternatives` (autres trajets, file d'attente écrite par `04r_alternatives_priority`) | **puissante** |
| Contexte communal et export vers le site | `05_build_context`, `06_export_front`, `06b` à `06w`, `08e_insights_astres` | ordinaire, mais à partir des résultats de l'étape précédente (`data/interim/`, non versionné) |
| Contrôles | `07_quality_checks` (code de sortie 1 si un contrôle bloquant échoue) | ordinaire |

Ce qui exige une machine puissante :

- la première construction du réseau r5py demande environ 30 minutes et 10 Go de mémoire, puis elle est mise en cache ;
- le calcul complet sur toute l'Île-de-France prend plusieurs jours sur une machine à grande mémoire (32 Go de mémoire Java pour les transports en commun, option `--max-memory 32G`). Les calculs avancent par lots et reprennent là où ils se sont arrêtés ;
- les transports en commun utilisent un moteur R5 légèrement modifié (limite de marche, temps de correspondance) : les correctifs et les scripts de construction sont dans `pipeline/r5/`.

Le flux d'horaires d'IDFM change plusieurs fois par jour. Un nouveau téléchargement ne redonne donc pas exactement les mêmes horaires : le fichier utilisé est identifié par son empreinte sha256 dans [data/sources_manifest.csv](data/sources_manifest.csv). L'enchaînement et les options exactes des calculs sont dans [docs/methodologie.md](docs/methodologie.md).

Les tests se lancent depuis `pipeline/` avec `python -m pytest` ; ceux qui lisent les données brutes demandent d'avoir fait le téléchargement. Les recoupements avec le calculateur d'IDFM (scripts `07d`, `07i`, `07j`) sont facultatifs et demandent une clé personnelle de l'API PRIM (`PRIM_API_KEY`, dans un fichier `.env` non versionné).

## Données et sources

Le référentiel complet est [docs/sources.md](docs/sources.md) : une fiche par source, avec producteur, licence, millésime, fichiers, empreintes et usage. Il est généré depuis [data/sources_manifest.csv](data/sources_manifest.csv), qui trace chaque fichier téléchargé. [docs/tracabilite.md](docs/tracabilite.md) relie chaque bloc affiché à sa source et à sa formule, et [docs/donnees-utilisees.md](docs/donnees-utilisees.md) présente les données et leur rôle.

Principales sources :

| Source | Sert à | Licence |
|---|---|---|
| INSEE, Flores 2023 | postes salariés (INSEE), taille des astres | Licence Ouverte 2.0 |
| INSEE, recensement et Filosofi | point de départ des communes, profil des communes | Licence Ouverte 2.0 |
| IDFM, horaires GTFS | temps de trajet en transports en commun | Licence Mobilités |
| OpenStreetMap | réseaux piéton, cyclable et routier | ODbL 1.0, « © les contributeurs d'OpenStreetMap » |
| Découpage administratif (API Géo) | communes et contours | ODbL 1.0 |
| France Travail, bassins d'emploi 2026 | découpage en astres | licence non écrite ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon le 09/11/2026, France Travail crédité dans le site : bande sous le ciel en mode provenance, pied du panneau au téléphone ou en mode provenance, et page « Sources & limites » (voir [docs/sources.md](docs/sources.md)) |
| Sociétés d'autoroute (VINCI Autoroutes, Sanef, SAPN, APRR), tarifs 2026 | coût des péages en voiture | réutilisation dans la dataviz autorisée par l'organisateur du hackathon à trois conditions, producteur crédité à côté de chaque montant ; copie APRR de data.gouv.fr : Licence Ouverte 2.0 |

Quelques documents cités n'affichent pas de licence : ils sont signalés comme tels dans `docs/sources.md`. Les fichiers dérivés de `frontend/public/data/` gardent la licence de leur source.

Les tableaux bruts de tarifs de péage (`data/processed/toll_tariffs.csv`, `toll_crosscheck.json`, `toll_crosscheck_a5.csv` et `data/peages_releves_manuels.csv`) ne sont pas redistribués, l'accord sur les péages excluant tout réexport des données brutes : pour refaire l'étape des péages (`04j_toll_tariffs.py`, puis `04k_toll_crosscheck.py`), il faut retélécharger les grilles aux adresses de [data/sources_manifest.csv](data/sources_manifest.csv), le site ne lisant que `frontend/public/data/tolls.json`, qui est fourni.

## Méthode et limites

Un pôle d'emploi est **accessible** depuis une commune si le trajet **aller** (départ le plus tardif qui arrive avant le début du poste) **et** le trajet **retour** (départ à la fin du poste) durent chacun le temps choisi ou moins. Les temps sont calculés avec r5py sur les horaires GTFS et sur OpenStreetMap. Chaque commune part du centre de gravité de sa population.

Rien n'est inventé : chaque paramètre est sourcé, dérivé d'une donnée ou retiré, et les quelques choix de l'équipe sont écrits comme tels. Ce qui n'est pas calculé est dit, jamais remplacé par une autre valeur. Détails : [docs/methodologie.md](docs/methodologie.md).

Ce que STARWAY ne mesure pas (liste complète : [docs/limites.md](docs/limites.md), reprise sur la page « Sources & limites » du site) :

- les postes salariés recensés par l'INSEE sont des postes existants, pas des postes à pourvoir ;
- les journées-types sont des scénarios ;
- les horaires sont théoriques, sur un mardi type : retards, travaux et affluence ne sont pas modélisés ;
- une commune est ramenée à un seul point, et le temps réel dépend de l'adresse ;
- les trajets en voiture sont sans embouteillage, ou avec un trafic moyen : l'indice de la DiRIF, mesuré sur les voies rapides, est appliqué à tout le trajet, ce qui est un choix de l'équipe ;
- les statistiques sociales décrivent les communes et n'expliquent rien.

Après le dépôt : recalculer l'exemple de trajet vers le centre des communes, comme le verdict ; aujourd'hui il va à l'arrêt le plus desservi, et une phrase explique l'écart quand les deux se contredisent (7,2 % des cas). Calculer aussi le détail du trajet en vélo + transports en commun, qui n'a aujourd'hui que sa durée.

Les difficultés rencontrées avec les données ouvertes et nos recommandations à IDFM sont dans [docs/depot-officiel/README.md](../README.md).

## Accessibilité

Ce que fait le site :

- chaque état d'un astre a une forme propre (contour plein, tirets, points, moitié pleine et moitié en tirets), la même dans la légende, la liste, la carte et l'affiche : rien ne repose sur la seule couleur ;
- « Lire le ciel en liste » écrit l'état de chaque pôle en toutes lettres ; chaque astre a un nom pour les lecteurs d'écran, et un résumé du ciel est annoncé à chaque changement de scénario ;
- un réglage « Couleurs adaptées au daltonisme », un interrupteur « Réduire les animations » (la préférence du système est respectée), des sous-titres pendant la visite ; aucun son ne porte une information absente de l'écran ;
- tout se fait au clavier : jauge, bulles « i », commune, panneau de preuve, liste, carte, Mes réglages, visite. Le premier appui sur Tab propose « Aller à la barre de scénario », pour ne pas traverser les 44 astres.

Ce qui a été mesuré : le 09/11/2026, sur le site alors en ligne, de façon automatisée (Chromium piloté par Playwright) ou sur captures : contrastes du texte et des éléments graphiques (formule WCAG 2.x, recoupée avec Contrast Finder), lecture en niveaux de gris et avec un simulateur de daltonisme, parcours au clavier réel, arbre d'accessibilité de Chromium, cibles tactiles et largeur de 390 px, zoom à 200 % simulé. Les valeurs, et les points restés sous les seuils, sont dans la section « Accessibilité » de [docs/depot-officiel/README.md](../README.md#accessibilité). Des corrections ont suivi ces mesures (lien d'évitement, focus pendant la visite et à la fermeture des menus, mise en page des fenêtres basses, crédit OpenStreetMap au téléphone) ; elles n'ont pas été remesurées sur le site en ligne.

Ce qui n'est pas testé : rien n'a été testé avec des utilisateurs ni audité selon le RGAA, et aucun lecteur d'écran réel (NVDA, VoiceOver) n'a été utilisé : le rendu vocal n'est pas vérifié. Le simulateur de daltonisme ne remplace pas un test par des personnes concernées.

## Arborescence du dépôt

```text
.
├── .github/workflows/pr-checks.yml   # contrôles du front sur chaque pull request
├── data/
│   ├── raw/README.md                 # comment obtenir les sources brutes (non versionnées)
│   ├── processed/                    # sorties intermédiaires du pipeline
│   └── sources_manifest.csv          # adresse, millésime, licence et empreinte de chaque fichier
├── design/
│   ├── slides/                       # diapositive de présentation
│   └── voice/                        # échantillon de la voix de référence
├── docs/
│   ├── methodologie.md               # comment chaque chiffre est calculé
│   ├── limites.md                    # ce que STARWAY ne mesure pas
│   ├── sources.md                    # référentiel des sources (généré)
│   ├── tracabilite.md                # source et formule de chaque donnée affichée (généré)
│   ├── donnees-utilisees.md          # les données et leur rôle
│   ├── aide.md                       # fonctionnement de l'Aide du site et de ses captures
│   ├── analyse-*.md, etude-bmo.md, peages-recoupement.md
│   ├── depot-officiel/               # README du dépôt officiel du hackathon
│   └── reference/                    # référentiel Excel lu par le pipeline
├── frontend/
│   ├── src/                          # application React, moteur du ciel PixiJS
│   ├── scripts/                      # outils du front (visite, tests de fumée)
│   └── public/data/                  # données publiées, produites par le pipeline
├── pipeline/
│   ├── scripts/                      # étapes numérotées du calcul
│   ├── starway/                      # bibliothèque Python du pipeline
│   ├── r5/                           # correctifs du moteur R5
│   └── tests/
├── tools/
│   ├── tour-tts/                     # .NET 10 : voix et sous-titres de la visite
│   ├── tour-tts.Tests/
│   └── record-tour/                  # enregistrement de la vidéo
├── LICENSE
├── LICENSE-CC-BY-4.0
└── README.md
```

## Composants ouverts et licences

Tous les composants du site et du calcul sont ouverts. Les versions exactes sont dans `frontend/package-lock.json` et `pipeline/pyproject.toml`.

| Partie | Composants | Licence |
|---|---|---|
| Site | Vite, React, PixiJS, pixi-filters, anime.js, Motion, Zustand | MIT |
| Site | TypeScript | Apache-2.0 |
| Site | d3-geo, d3-scale, d3-shape | ISC |
| Site | police Jost | SIL OFL 1.1 |
| Calcul | pandas, geopandas, shapely, psutil | BSD-3-Clause |
| Calcul | numpy | BSD-3-Clause et licences compatibles |
| Calcul | pyproj, pyogrio, openpyxl, moteur R5 | MIT |
| Calcul | requests, JPype | Apache-2.0 |
| Calcul | r5py | GPL-3.0-or-later ou MIT |
| Calcul | OpenJDK 21 | GPL-2.0 avec Classpath Exception |
| Vidéo (outil hors site) | Playwright | Apache-2.0 |
| Vidéo (outil hors site) | ffmpeg, appelé comme programme externe | GPL-3.0 |

Une seule exception, hors du site : l'outil hors ligne `tools/tour-tts` utilise le SDK Speech de Microsoft (propriétaire, redistribuable) pour générer la voix de la visite. Il n'est pas embarqué dans le site. Le site est hébergé sur Azure Static Web Apps. Le développement a été assisté par des outils d'IA (Claude Code, GitHub Copilot).

**Licences du projet :**

- **Code** : [MIT](LICENSE), © 2026 Starway, by Middleway.
- **Textes et visuels composés pour le projet** : [CC BY 4.0](LICENSE-CC-BY-4.0), © 2026 Starway, by Middleway.
- **Images décoratives** (décors, textures lumineuses) : générées par IA (ChatGPT, OpenAI), diffusées elles aussi sous [CC BY 4.0](LICENSE-CC-BY-4.0) (décision de l'équipe du 11/11/2026). Elles n'encodent aucune donnée : tout ce qui porte une information est dessiné en code à partir des données.
- **Données** : chaque source garde la licence de son producteur, avec l'attribution demandée (voir [docs/sources.md](docs/sources.md)).

## Équipe

**Starway, by Middleway** : Nicolas Vallot, Maia Sutter, Cyril Gateau, Florian Caillaud, Sara Putzu.
