# Réseau sous canicule · Île-de-France

**Hackaviz IDFM 2026, défi 1 : chaleur et transports en commun.**

Le 24 juin 2026, Paris-Montsouris relève 40,5 °C en pleine vigilance rouge. Ce projet répond, pour les 17 458 zones d'arrêt de la région, à trois questions :

1. **Où** les voyageurs sont-ils les plus exposés à la chaleur en attendant, en marchant ou à bord ?
2. **Qui** renonce au transport quand il fait chaud, et qui n'a pas le choix ?
3. **Quelle mesure** (bus climatisés, renfort de fréquence, horaires décalés) protège le mieux, et qui en profite ?

Le résultat est un écran unique, « Une journée sous canicule » : on choisit une personne type tirée de la simulation multi-agents MATSim (fiche modifiable : prénom, elle ou il, apparence, métier d'exemple), puis on suit sa matinée du jeudi 25 juin 2026 sur la carte, minute par minute, avec un compteur de minutes passées dehors, quelques scènes dessinées et, à la fin, la comparaison des cinq personnes et trois mesures à tester.

## Ouvrir le site

```bash
python -m http.server 8765 -d web
```

Puis ouvrir <http://localhost:8765>. Il faut une connexion internet pour le fond de carte (OpenFreeMap), MapLibre et les polices. Toutes les données du site sont déjà dans `web/data/` : rien d'autre à lancer. Le guide conversationnel de la maquette (`design/maquette/agent/serveur.py`) n'est pas utilisé par le site final.


## Modifier l'interface

La source de l'interface est `design/maquette/` (`trajet.html` et ses fichiers) avec `design/tokens.css`. Après une modification, republier le site :

```bash
python scripts/19_ui_finale.py
```

Le script recopie ces fichiers dans `web/` (`web/index.html`, `web/app/`) en corrigeant les chemins. Les écrans Mesures, Cartogramme et Simulation de la maquette ne sont plus proposés : leurs fichiers restent dans `design/maquette/` comme étapes de travail.

## Arborescence

```
reseau-sous-canicule/
│
├── README.md               ce fichier : présentation, arborescence, chaîne de calcul
├── REGLES.md               règles du projet : commits, langue, données, code (à lire avant de contribuer)
├── DESIGN.md               design system : règles d'interface, couleurs, typographie, composants
├── requirements.txt        dépendances Python
│
├── design/
│   └── tokens.css          valeurs du design system (couleurs, polices, espacements, contrastes mesurés)
│
├── data/                   données, jamais versionnées (voir data/*/README.md)
│   ├── raw/                sources téléchargées telles quelles, jamais modifiées (≈ 1,6 Go)
│   │   ├── gtfs/           GTFS IDFM décompressé
│   │   └── …               IDFM, Institut Paris Région, Insee, IGN, Météo-France, Ville de Paris, OSM
│   └── processed/          tables intermédiaires produites par les scripts (parquet, npz, json)
│
├── scripts/                chaîne de calcul, à lancer dans l'ordre depuis la racine
│   ├── 01_download.py      téléchargement de toutes les sources → data/raw/
│   ├── 02 … 10             indicateurs, volet canicule, export web, cartogrammes, graphe, accès, simulation, RAPTOR
│   ├── 11 … 14             simulation multi-agents MATSim : entrées, configurations, calage, mesures, analyse, animation
│   ├── 15, 16              contrôle agrégé : ce que raconte le site tient-il à l'échelle régionale ?
│   ├── 17_couleurs_lignes.py  couleurs et tracés des lignes (GTFS, tracés IDFM) pour « Une journée sous canicule »
│   ├── 18_profils_matsim.py   cinq profils types tirés de la simulation MATSim (fiches et trajets)
│   ├── 19_ui_finale.py        publie l'interface (design/maquette) dans web/
│   ├── 20_reseau_pieton.py    réseau piéton OSM (marches tracées le long des rues)
│   └── marche_osm.py          plus court chemin piéton (utilisé par 18_profils_matsim.py)
│
├── matsim/
│   ├── README.md           installation de MATSim 15 et lancement
│   ├── run_matsim.cmd      lance les cinq scénarios puis l'analyse
│   ├── scenario/           entrées versionnées : réseau, horaires, population (1 %), configurations
│   ├── lib/                MATSim 15 (non versionné, à télécharger)
│   └── output_<scénario>/  sorties des simulations (non versionnées, ≈ 600 Mo chacune)
│
├── web/                    le site, autonome (publié par scripts/19_ui_finale.py)
│   ├── index.html          « Une journée sous canicule »
│   ├── app/                styles et scripts de l'écran, recopiés de design/maquette/
│   ├── raptor_engine.js    calcul d'itinéraires RAPTOR dans le navigateur (« Modifier son trajet »)
│   ├── data/               données du site produites par les scripts (window.XXX = {...})
│   └── tiles/              couches lourdes découpées en tuiles de 0,05° (îlots, carreaux Insee, lieux frais)
│
├── docs/
│   ├── methodologie.md     méthodes et hypothèses, étape par étape
│   └── sources.md          jeux de données, producteurs, licences, usage
│
└── .githooks/
    └── commit-msg          refuse tout commit qui attribue une coautorité à une IA (voir REGLES.md)
```

### Ce qui est versionné, ce qui ne l'est pas

| Dossier | Versionné | Pourquoi |
|---|---|---|
| `scripts/`, `web/*.html`, `web/*.js`, `design/`, `docs/` | oui | code et documentation |
| `web/data/`, `web/tiles/` | oui | le site doit s'ouvrir sans relancer la chaîne (≈ 230 Mo, aucun fichier de plus de 40 Mo) |
| `matsim/scenario/` | oui | entrées des simulations (≈ 11 Mo), pour relancer MATSim sans les sources |
| `data/raw/`, `data/processed/` | non | volumineux et entièrement reproductibles par `scripts/` |
| `matsim/lib/`, `matsim/output_*/`, `matsim/*.log` | non | bibliothèque tierce et sorties lourdes |

## Refaire les calculs

Prérequis : Python 3.11 ou plus (`pip install -r requirements.txt`), et Java 17 pour MATSim. Toutes les commandes se lancent depuis la racine du projet.

| Étape | Commande | Entrées | Sorties | Durée |
|---|---|---|---|---|
| Sources | `python scripts/01_download.py` | internet | `data/raw/` | ≈ 4 min |
| Indicateurs par zone d'arrêt | `python scripts/02_build.py` | `data/raw/` | `data/processed/stops.parquet` | ≈ 3 min |
| Volet canicule | `python scripts/03_volet2.py` | vigilance, météo, validations | `data/processed/volet2.json` | – |
| Export web | `python scripts/04_web.py` | `data/processed/` | `web/data/*.js`, `web/tiles/` | – |
| Cartogrammes | `python scripts/05_carto.py` puis `python scripts/05_carto.py --fixe` | `web/data/` | `carto_*.js`, `carto_*_fixe.js` | ≈ 20 + 35 min |
| Graphe de transport | `python scripts/06_graph.py` | GTFS | `data/processed/graph.npz` | ≈ 1 min |
| Accès et flux | `python scripts/07_access.py` | graphe, MOBPRO, MOBSCO | `web/data/access.js`, `od.js` | ≈ 6 min |
| Graphe web | `python scripts/08_graph_web.py` | graphe | `web/data/graph.js` | < 1 min |
| Micro-simulation | `python scripts/09_sim.py` | flux, validations | `web/data/sim.js`, `agents.js` | ≈ 3 min |
| Horaires RAPTOR | `python scripts/10_raptor.py` | GTFS | `web/data/raptor.js` | ≈ 1 min |
| MATSim : entrées | `python scripts/11_matsim_inputs.py` | GTFS, MOBPRO | `matsim/scenario/` | – |
| MATSim : configurations | `python scripts/12_matsim_config.py` | | `config_*.xml`, `run_matsim.cmd` | < 1 min |
| MATSim : mesures | `python scripts/12c_matsim_levers.py` | scénario | horaires et population des mesures | < 1 min |
| MATSim : simulations | `matsim\run_matsim.cmd` | `matsim/scenario/` | `matsim/output_*/`, `web/data/matsim.js`, `msanim_*.js` | ≈ 30 min par scénario |
| Contrôle agrégé | `python scripts/15_macro.py` puis `python scripts/16_macro_cross.py` | validations, météo, Filosofi | `web/data/macro.js` | – |
| Couleurs et tracés des lignes | `python scripts/17_couleurs_lignes.py` | GTFS, tracés IDFM | `web/data/couleurs_lignes.js`, `traces_lignes.js` | < 1 min |
| Réseau piéton | `python scripts/20_reseau_pieton.py` | `data/osm/ile-de-france-latest.osm.pbf` (Geofabrik, à télécharger) | `data/osm/pieton.npz` | ≈ 1 min |
| Profils types | `python scripts/18_profils_matsim.py` | sorties MATSim (deux scénarios), population, GTFS | `web/data/profils.js`, `profils_vivier.js` | ≈ 3 min |
| Publication de l'interface | `python scripts/19_ui_finale.py` | `design/maquette/`, `design/tokens.css` | `web/index.html`, `web/app/` | < 1 s |

Le GTFS IDFM et les fichiers détail MOBPRO et MOBSCO 2021 de l'Insee se téléchargent une fois à la main : les URL sont dans `scripts/01_download.py` et dans [`docs/sources.md`](docs/sources.md). Un fichier déjà présent dans `data/raw/` n'est pas retéléchargé ; le supprimer pour le rafraîchir.

`12b_matsim_calib.py` recale les constantes de télétravail après une première simulation ordinaire ; on ne le relance que si la population change.

## Le récit

| Groupe | Étapes | Question |
|---|---|---|
| Constat | 1 | À l'échelle de la région, la chaleur fait-elle vraiment baisser la fréquentation, et pour qui ? |
| Volet 1 · vulnérabilité | 2 à 9 | Quels arrêts exposent le plus : îlot de chaleur, ombre, lieu frais, fréquence, climatisation, revenus ? |
| Volet 2 · canicule | 10 à 12 | Comment la fréquentation a-t-elle réagi pendant la semaine rouge ? |
| Autres vues | 13 à 16 | Cartogrammes, surfaces interpolées, comparaisons |
| Accès et flux | 17 à 24 | Temps ressenti, isochrones, déserts de fraîcheur, navetteurs, élèves |
| Simuler | 25 à 30 | Micro-simulation, MATSim, mesures testées, simulateur « et si » |
| Votre trajet | 31, 32 | Le récit d'un trajet choisi par l'utilisateur, d'une commune ou d'un IRIS à un autre |

Méthodes et hypothèses détaillées : [`docs/methodologie.md`](docs/methodologie.md).

## Équipe et licence

Équipe du Hackathon Mobilités 2026 Spécial Dataviz (IDFM). Licence du code à fixer par l'équipe avant publication. Les données gardent la licence de leur producteur (Licence Ouverte Etalab ou ODbL, voir [`docs/sources.md`](docs/sources.md)). Ce projet n'est pas un site officiel d'Île-de-France Mobilités.
