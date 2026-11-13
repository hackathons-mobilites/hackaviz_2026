# Sources

Toutes les sources sont des données ouvertes. Elles sont téléchargées par `scripts/01_download.py` dans `data/raw/`, sauf mention « manuel ». Licences à vérifier jeu par jeu avant toute publication.

| Fichier dans `data/raw/` | Jeu de données | Producteur | Accès | Usage dans le projet |
|---|---|---|---|---|
| `offre.parquet` | Offre hebdomadaire moyenne hors vacances | IDFM | API data.iledefrance-mobilites.fr | zones d'arrêt, fréquence 7 h-9 h, courses 12 h-19 h |
| `arrets.parquet` | Référentiel des arrêts | IDFM | API IDFM | positions, rattachement |
| `lignes.json` | Référentiel des lignes | IDFM | API IDFM | climatisation (`air_conditioning`), clé vers les validations |
| `access.json` | Accessibilité en gare | IDFM | API IDFM | accessibilité |
| `fontaines.json` | Fontaines aux arrêts de transport | IDFM | API IDFM | lieux frais |
| `gares.json`, `traces.geojson` | Emplacement des gares, tracés des lignes | IDFM | API IDFM | positions, cartes, tracés suivis par les véhicules (journée de Nadia) |
| `valid_ferre_2eme.json`, `valid_bus_2eme.json` | Validations par jour, réseau ferré et réseau de surface, 2e trimestre 2026 | IDFM | API IDFM | indices de fréquentation, contrôle agrégé |
| `line_totals.json` | Totaux de validations par ligne | IDFM | API IDFM | fréquentation de référence |
| `gtfs_idfm.zip`, `gtfs/` | GTFS IDFM, horaires prévus | IDFM | manuel, PRIM | graphe, RAPTOR, MATSim |
| `icu.geojson` | Îlots de chaleur urbains, LCZ 2022 (261 050 îlots) | Institut Paris Région | ArcGIS REST geoweb.iau-idf.fr | aléa chaleur de jour |
| `filosofi.geojson` | Filosofi carroyé 200 m (2019) | Insee, via la Géoplateforme | WFS data.geopf.fr | niveau de vie, population |
| `iris.geojson` | Contours IRIS | IGN, via la Géoplateforme | WFS data.geopf.fr | agrégation, votre trajet |
| `communes.geojson` | Communes et arrondissements municipaux | geo.api.gouv.fr | API | agrégation |
| `ilots-de-fraicheur-*.geojson` | Îlots de fraîcheur | Ville de Paris | opendata.paris.fr | lieux frais (Paris) |
| `osm_parcs.json` | Parcs, jardins, bois d'au moins 0,2 ha | contributeurs OpenStreetMap | Overpass | lieux frais (toute la région) |
| `vigilance_idf.json` | Vigilance canicule, archive des bulletins | Météo-France, data.gouv.fr | files.data.gouv.fr | jours orange et rouges par département |
| `H_<dép>_latest-2025-2026.csv.gz` | Observations horaires | Météo-France | meteofrance.s3 (base HOR) | Tmax, Tmin, pluie, une station par département |
| `RP2021_mobpro.parquet`, `varmod_mobpro_2021.csv` | MOBPRO 2021, fichier détail | Insee | manuel, insee.fr | navetteurs : résidence, travail, mode, catégorie sociale |
| `RP2021_mobsco.parquet`, `varmod_mobsco_2021.csv` | MOBSCO 2021, fichier détail | Insee | manuel, insee.fr | élèves et étudiants |
| `flux_travail_2021.zip`, `flux_etude_2021.zip` | Flux de mobilité 2021 | Insee | insee.fr | contrôle des flux |

## Fond de carte

Site : Plan IGN de la Géoplateforme (data.geopf.fr, WMTS, sans clé), seul fond qui accepte une page ouverte en double-clic : les tuiles d'openstreetmap.org refusent les pages locales (« Access blocked »). Maquette : tuiles OpenStreetMap, servies par le serveur local. Écran Nadia de la maquette : fond vectoriel OpenFreeMap (données OpenStreetMap, sans clé); les marches sont tracées à vol d'oiseau, sans service de calcul en ligne. L'attribution reste visible sur la carte.

## Licences

| Producteur | Licence attendue |
|---|---|
| IDFM, Insee, IGN, Météo-France, Ville de Paris, Institut Paris Région | Licence Ouverte Etalab 2.0 (certains jeux IDFM sont sous ODbL : à vérifier) |
| OpenStreetMap | ODbL |

**Géocodage des adresses.** Dans « Une journée sous canicule », les adresses tapées sont recherchées dans la Base Adresse Nationale (api-adresse.data.gouv.fr, Licence Ouverte), depuis le navigateur. Seule l'adresse tapée est envoyée ; le calcul du trajet reste local.

**Réseau piéton.** Extrait OpenStreetMap d'Île-de-France (Geofabrik, `ile-de-france-latest.osm.pbf`, ODbL), téléchargé le 13 novembre 2026 dans `data/osm/` (non versionné) ; voies piétonnes et rues praticables à pied.

**Genre et marges d'adaptation.** Institut Paris Région et partenaires, « Mobilité sous pression climatique : comportements et attentes des Franciliens », Note rapide n° 1060, 2026 (enquête Ipsos BVA) : parmi les Franciliens qui ne peuvent pas télétravailler, les trois quarts n'ont pas non plus de flexibilité horaire ; les femmes constituent les deux tiers de cette catégorie. Vérifié sur la page de l'Institut le 13 novembre 2026.

**Projections (niveau « projeté »).** Ministère de la Transition écologique, « Une trajectoire de référence pour s'adapter au changement climatique (TRACC) », d'après les projections Météo-France 2025 : vagues de chaleur cinq fois plus fréquentes entre 2030 et 2050, jusqu'à 48 °C ; les étés caniculaires d'aujourd'hui seraient normaux à +2,7 °C (2050) et frais à +4 °C (2100) ; à +4 °C, Paris aurait le climat de Montpellier. Valeurs pour la France, consultées le 13 novembre 2026.
