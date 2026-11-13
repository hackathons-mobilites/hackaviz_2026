# Méthodologie

Ce document décrit les méthodes et les hypothèses, dans l'ordre du récit. Chaque paramètre cité ici se retrouve dans le script indiqué.

## 0. Chaîne de calcul

Tous les scripts sont dans `scripts/` et se lancent dans cet ordre depuis la racine de `production/` (Python 3.11, dépendances dans `requirements.txt`). Les données brutes vont dans `data/raw/` (non versionné), les tables intermédiaires dans `data/processed/`, les fichiers du site dans `web/data/`.

| Étape | Script | Entrées | Sorties |
|---|---|---|---|
| Téléchargement | `01_download.py` | API IDFM, Géoplateforme (IGN, Insee), Institut Paris Région, Météo-France, OSM ; GTFS, MOBPRO et MOBSCO à la main | `data/raw/` |
| Indicateurs par arrêt | `02_build.py` | arrêts, offre, ICU, Filosofi, lieux frais | `data/processed/stops.parquet` |
| Canicule observée | `03_volet2.py` | vigilance, températures horaires, validations | indices de fréquentation |
| Export régional | `04_web.py` | tables précédentes | `web/data/core.js`, couches |
| Cartogrammes | `05_carto.py` | communes, IRIS, poids | `web/data/carto_*.js` |
| Accès et flux | `06_graph.py`, `07_access.py`, `08_graph_web.py`, `10_raptor.py` | GTFS, MOBPRO, MOBSCO | temps ressenti, flux, horaires RAPTOR (`web/data/raptor.js`) |
| Micro-simulation | `09_sim.py` | navetteurs MOBPRO, indices observés | `web/data/sim.js` |
| MATSim, entrées | `11_matsim_inputs.py`, `12_matsim_config.py`, `12b_matsim_calib.py`, `12c_matsim_levers.py` | GTFS, MOBPRO, Filosofi | `matsim/scenario/` |
| MATSim, simulation | `matsim/run_matsim.cmd` (Java 17, MATSim 15) | `matsim/scenario/` | `matsim/output_<scénario>/` |
| MATSim, analyse | `13_matsim_analysis.py`, `14_matsim_anim.py` | sorties MATSim | `web/data/matsim.js`, `web/data/msanim_*.js` |
| Constat agrégé | `15_macro.py`, `16_macro_cross.py` | séries journalières | `web/data/macro.js` |
| Lignes | `17_couleurs_lignes.py` | référentiel et tracés IDFM | `web/data/couleurs_lignes.js`, `traces_lignes.js` |
| Réseau piéton | `20_reseau_pieton.py` | extrait OSM Geofabrik | `data/osm/pieton.npz` |
| Profils types | `18_profils_matsim.py` (avec `marche_osm.py`) | sorties MATSim, réseau piéton | `web/data/profils.js`, `profils_vivier.js` |
| Publication | `19_ui_finale.py` | `design/maquette/` | `web/index.html`, `web/app/` |

## Trois niveaux de preuve

Chaque chiffre affiché porte son niveau : **Mesuré** (donnée observée : validations, températures, enquête), **Reconstitué** (calculé par nos modèles : simulation MATSim, indicateurs d'arrêt), **Projeté** (climat futur, trajectoire TRACC). À l'écran, la pastille est écrite en toutes lettres, avec une bordure pleine, tiretée ou pointillée.

## 1. Unité d'analyse

La **zone d'arrêt** IDFM (17 458 dans la région) : un regroupement des quais d'un même arrêt, quel que soit le mode. Elle est rattachée à sa commune (ou arrondissement de Paris) et à son IRIS (`02_build.py`).

## 2. Volet 1 · vulnérabilité des arrêts

| Indicateur | Calcul | Script |
|---|---|---|
| Aléa chaleur | note d'aléa de jour de l'îlot de chaleur (ICU, LCZ 2022) sous l'arrêt, tampon de 50 m | `02_build.py` |
| Lieu frais | distance au plus proche îlot de fraîcheur (Paris) ou parc, jardin, bois OSM d'au moins 0,2 ha, jusqu'à 3 km | `02_build.py` |
| Fréquence | passages de 7 h à 9 h, rang centile par mode sur toute la région | `02_build.py` |
| Climatisation | part des courses de l'arrêt sans climatisation (`air_conditioning` : non = 1, partielle = ½, oui = 0) | `02_build.py` |
| Revenus | niveau de vie médian des carreaux Filosofi dans 400 m, rang centile régional | `02_build.py` |

**Fragilités d'un arrêt** (récit « Une journée sous canicule ») : un arrêt cumule une fragilité par critère franchi : aléa chaleur d'au moins 10 sur 17 ; au moins 50 % de bus sans climatisation ; fréquence dans les 20 % les plus faibles de son mode ; aucun lieu frais à moins de 300 m ; revenus dans les 20 % les plus bas de la région. Un arrêt est dit **très exposé** à partir de trois fragilités. La scène « Les arrêts autour de son trajet » compte les arrêts à moins d'un kilomètre de l'itinéraire et la part des voyageurs d'un jour ordinaire qui passent par un arrêt très exposé.

## 3. Volet 2 · la canicule observée

- Vigilance canicule par département, d'après l'archive des bulletins Météo-France.
- Températures horaires d'une station par département.
- **Indice de fréquentation** = validations du jour ÷ médiane des mêmes jours de semaine ordinaires × 100. Le ferré est publié par gare, le bus par ligne (`03_volet2.py`).

## 4. Constat agrégé (`15_macro.py`, `16_macro_cross.py`)

Chaque affirmation du récit est testée sur la série journalière régionale :

- régression des indices sur la Tmax des jours ouvrés (effets fixes jour de semaine, tendance, vacances, ponts, pluie ; erreurs robustes HC1), placebo sur les jours frais, panel des départements à effets fixes ;
- élasticités à la chaleur par gare et par ligne de bus (`log(validations) ~ … + max(Tmax − 28 °C, 0)`, du 1er avril au 30 juin 2026), puis méta-régression de ces élasticités sur le revenu, la part de cadres, la part de navetteurs TC, la part d'élèves, l'accessibilité, la fréquence, le mode et la climatisation ;
- indices de concentration des conditions d'exposition par décile de revenu.

Résultats retenus : la chaleur fait baisser la fréquentation (environ −0,9 % par °C au-dessus de 28 °C pour le ferré, −2,7 % pour les bus non climatisés). Ceux qui peuvent éviter le trajet le font (quartiers aisés, pôles d'emploi de cadres, zones scolaires). Les conditions d'exposition ne sont pas concentrées chez les plus modestes à l'échelle régionale. L'effet propre de la vigilance ne se sépare pas de celui de la chaleur.

## 5. Accès et flux (`06_graph.py`, `07_access.py`, `10_raptor.py`)

- **Temps ressenti** = à bord × (1 + h·G_clim) + 2 × attente × (1 + 0,06·h·aléa) + 2 × marche × (1 + 0,05·h·aléa) + 3 min par montée, avec h = (T − 25) / 14.
- **Isochrones** : RAPTOR (Delling et al. 2012) dans le navigateur (`web/raptor_engine.js`), sur les horaires GTFS du mardi 10 novembre 2026 (5 185 motifs, 914 851 passages). Canicule : marche à 3,6 km/h, accès ≤ 600 m, correspondance ≤ 250 m ; personne âgée : 3,4 km/h, 400 m, 200 m.
- **Graphe à fréquences** (attente = ½ intervalle) pour la matrice régionale et les flux MOBPRO / MOBSCO.

## 6. Micro-simulation (`09_sim.py`)

Chaque navetteur TC (MOBPRO 2021) peut renoncer au trajet. La probabilité, logistique, dépend de la part du trajet en bus, en bus non climatisé et de la hausse du temps ressenti, avec un effet cadre fixé. Elle est calée sur les indices observés de la semaine rouge. La validation ligne par ligne reste faible (r ≈ 0).

## 7. Simulation multi-agents MATSim (`11` à `14`)

**Population** (`11_matsim_inputs.py`). Navetteurs MOBPRO 2021 en transport en commun (`TRANS = 6`) qui habitent et travaillent en Île-de-France, tirés avec remise selon leur poids `IPONDI` jusqu'à 1 % de l'effectif, soit 24 147 agents. Le domicile est un carreau Filosofi de la commune, tiré selon le nombre d'habitants, à ±100 m près ; le travail est placé près d'une zone d'arrêt de la commune de travail, tirée selon le nombre de départs entre 7 h et 9 h, à 150 m près (loi normale). Départ du domicile selon une loi normale centrée sur 7 h 45 (écart type 45 min, borné de 5 h 30 à 10 h 30), journée de travail centrée sur 8 h 30 (écart type 1 h). Chaque agent a deux plans : aller-retour en transport, ou télétravail (mode « stay »). Trois sous-populations : cadres, essentiels (employés, ouvriers), autres.

**Réseau et horaires.** GTFS IDFM du mardi 10 novembre 2026, de 5 h à 22 h, en Lambert 93. Réseau artificiel : une boucle par zone d'arrêt et un lien par paire d'arrêts consécutifs. Six modes de transport : `rail`, `subway`, `tram`, `bus_ac` (bus climatisé), `bus_noac` (bus non climatisé), `cable`. Calcul d'itinéraire par SwissRailRaptor ; marche téléportée (distance à vol d'oiseau × 1,3).

**Configuration** (`12_matsim_config.py`, MATSim 15) : 30 itérations, graine 4711, 4 fils de calcul ; capacité de la file d'attente à 1 % (échantillon) ; stratégies ChangeExpBeta 0,7, ReRoute 0,1, TimeAllocationMutator 0,1 (±1 h), SubtourModeChoice 0,1 (transport, marche, vélo) ; innovation arrêtée à 80 % des itérations, moyenne des scores (MSA) ensuite ; cinq plans gardés par agent. Score : activité 6 utils/h, retard −18, correspondance −1. Constantes du télétravail par sous-population (cadres −7,94, essentiels −14,74, autres −11,34), calées par `12b_matsim_calib.py` sur 10 %, 5 % et 25 % de télétravail un jour ordinaire.

| Utilité horaire | Jour ordinaire | Canicule |
|---|---|---|
| Train, RER | −0,5 | −1 |
| Métro | −0,5 | −2 |
| Tram, câble | −0,8 | −1,5 |
| Bus climatisé | −1 | −3 |
| Bus non climatisé | −1 | −5 |
| Marche | −2 | −5 |
| Attente | −1 | −4 |
| Vitesse de marche | 1,25 m/s | 1,0 m/s |
| Rayon d'accès aux arrêts | 1 000 m | 600 m |
| Correspondance à pied | 400 m | 250 m |

**Lancement** (`matsim/run_matsim.cmd`) : pour chaque scénario, `java -Xmx6g -cp "matsim-15.0.jar;libs/*" org.matsim.run.RunMatsim config_<scénario>.xml`, environ 30 minutes par scénario, puis `13_matsim_analysis.py` et `14_matsim_anim.py`. Installation de MATSim : voir `matsim/README.md`.

**Animation de la couverture** (`14_matsim_anim.py`) : positions des véhicules entre deux arrêts (événements d'arrivée et de départ) et étapes des agents de 6 h 30 à 9 h 30 ; dans le navigateur, chaque rame est dessinée à sa longueur réelle (RER 220 m, métro 110 m, tram 45 m, bus 14 m) le long du tracé officiel de sa ligne. Pendant le trajet suivi, les rames simulées de sa propre ligne autour d'elle ne sont pas dessinées : seul son véhicule, placé à sa position, reste visible.

| Scénario | Ce qui change par rapport à la canicule |
|---|---|
| Tous les bus climatisés | bus non climatisé à −3 au lieu de −5 |
| Bus renforcés aux heures de pointe | un départ intermédiaire dès que l'intervalle atteint 10 min, de 6 h à 10 h et de 16 h à 20 h (+45 707 départs, +33,6 %) |
| Horaires décalés | 50 % des cadres et des autres actifs avancent leur journée d'une heure ; bonus de télétravail +1 ; ouverture du travail à 6 h |

**Dose de chaleur** = minutes dehors (marche, attente en surface) × intensité de chaleur de l'heure × aléa d'îlot de chaleur du lieu ÷ 10. L'attente dans le métro souterrain ne compte pas.

**Arrêts souterrains** (`18_profils_matsim.py`) : arrêts de métro, gares ferrées à moins de 200 m d'un arrêt de métro, et une liste nommée de gares RER souterraines sans métro. Une attente sur un de ces quais, et une marche entre deux étapes souterraines (couloir de correspondance), ne comptent pas comme minutes dehors.

**Limite connue** : la simulation reproduit l'indice du ferré (87 simulé contre 85 observé) mais pas celui des bus (122 contre 68 pour les bus climatisés, 91 contre 58 pour les non climatisés). Les comparaisons entre mesures sont lisibles ; les niveaux absolus des bus ne le sont pas encore.

### Profils types (`18_profils_matsim.py`)

L'écran « Une journée sous canicule » suit un agent MATSim réel, choisi par une règle reproductible, et non une personne inventée.

- **Minutes dehors** d'un trajet = marche + attente à un arrêt en surface (l'attente sur un quai de métro ne compte pas). Elles viennent des étapes du premier trajet de la journée (`output_legs`), scénario canicule.
- **Médianes de groupe** (par catégorie sociale) sur les agents qui partent en transport en commun entre 6 h 30 et 9 h 30, avec des communes de domicile et de travail différentes : durée, marche, attente.
- **Score** d'un agent = |durée − médiane| / médiane + |marche − médiane| / médiane + |attente − médiane| / max(médiane, 1) ; on trie par score puis par numéro d'agent, on garde le premier dont toutes les étapes à bord se rattachent à un arrêt du site (à moins de 120 m), et les dix suivants (« une autre personne du même groupe »).
- **Les cinq profils** : employé essentiel habitant la grande couronne (77, 78, 91, 95) avec une étape en RER ou train, qui voyage dans les deux scénarios ; ouvrier hors Paris avec une étape en bus non climatisé ; profession intermédiaire ; cadre qui voyage ; cadre qui voyage un jour ordinaire et reste chez lui en canicule (son trajet habituel est montré comme trajet évité). Les prénoms et les métiers sont des exemples, signalés comme tels ; seuls la catégorie, les communes, les horaires et les étapes viennent de la simulation.
- **Parts qui restent chez elles** et **minutes dehors par personne** (en comptant 0 pour celles qui restent) : moyennes sur tous les agents de la catégorie.
- **« Comme elle »** = agents de la même catégorie et du même département de domicile qui partent en transport, × 100 (échantillon de 1 %), arrondi à la centaine.
- Les lignes à bord sont calées sur les tracés officiels IDFM entre les arrêts de montée et de descente. Les marches sont tracées le long des rues : plus court chemin sur le réseau piéton OpenStreetMap (`20_reseau_pieton.py`, `marche_osm.py`, A* sur 4,2 millions de nœuds), simplifié à 6 m près ; leur durée reste celle de MATSim (marche téléportée : distance à vol d'oiseau × 1,3 à 1 m/s). Pour un trajet recalculé sur les horaires, la marche reste à vol d'oiseau. Aucun service en ligne n'est appelé pour ces calculs.
- **Vivier** (`web/data/profils_vivier.js`, chargé au moment du calcul) : les trajets du matin en transport du scénario canicule et le retour du soir de chaque agent, au plus trois agents par catégorie et couple de communes (9 168 agents, 5 203 couples, 7,5 Mo). Le domicile et le travail sont des points (adresse géocodée par la Base Adresse Nationale, commune ou gare du site, ou clic sur la carte). On compare ces points au départ et à l'arrivée réels de chaque agent : d'abord un agent de sa catégorie à moins de 800 m aux deux bouts, puis un agent d'une autre catégorie à la même distance (la catégorie change surtout le télétravail, pas l'itinéraire), puis le plus proche jusqu'à 2,5 km ; le carton d'ouverture donne les distances quand le trajet n'est pas exactement le sien ; si une heure est choisie, seuls les départs à moins de 30 minutes comptent. La simulation ne contient pas l'âge : à 60 ans et plus ou avec une poussette, le trajet est calculé sur les horaires (RAPTOR) avec une marche plus lente.
- Le jeu de la conclusion compte les **minutes au soleil ou dans un bus chaud** : marche + attente en surface + bus non climatisé ; ombrager l'arrêt annule l'attente au soleil, doubler les passages la divise par deux, climatiser les bus annule les minutes en bus non climatisé.

## 8. Créer son personnage et son trajet

Chacun peut créer son personnage en quatre étapes : catégorie sociale, prénom et apparence, journée (heure de départ, âge, poussette), domicile et travail. Le domicile et le travail se donnent par une adresse (recherchée dans la Base Adresse Nationale, seul service appelé, et seulement pour l'adresse tapée), par une commune ou une gare du site, ou par un clic sur la carte. Le trajet est d'abord cherché dans la simulation MATSim (vivier ci-dessus : même catégorie à moins de 800 m aux deux bouts, puis autre catégorie, puis le plus proche jusqu'à 2,5 km) ; sinon, ou pour une personne de 60 ans et plus ou avec une poussette, il est calculé dans le navigateur par RAPTOR sur les horaires (le moins de correspondances parmi les itinéraires qui arrivent dans les 5 minutes du plus rapide), avec une marche plus lente et la température horaire du 25 juin 2026. Les choix restent dans le navigateur.

## 9. Cartogrammes (`05_carto.py`)

Cartogramme de diffusion (Gastner et Newman 2004) des communes et des IRIS, pondéré par la fréquentation, la population ou l'exposition. Deux variantes : contour libre, et contour régional fixe (correction par pondération inverse des distances aux sommets de la frontière). L'échelle logarithmique est recommandée avec le contour fixe : l'écart de surface y reste sous 5 % pour les communes.

## 10. Accessibilité et vérifications

- Audit automatique axe-core 4.10 (règles WCAG 2.2 A et AA) sur la couverture, le choix d'une personne, une scène et les cinq pages de fin : aucun défaut.
- Chaque dessin a un texte alternatif, chaque scène un tableau « Données » ; la frise du trajet se pilote au clavier ; aucune information ne repose sur la seule couleur (motifs, mots, bordures).
- La mise en page s'adapte au téléphone, à la tablette et à l'ordinateur, sans défilement : un panneau trop plein se resserre ou passe en pages.
