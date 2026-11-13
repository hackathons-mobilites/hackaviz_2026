# Contrats de données pipeline → front

Tous les fichiers sont écrits dans `frontend/public/data/` et servis tels quels par Azure Static Web Apps. Les types TypeScript correspondants vivent dans `frontend/src/data/types.ts` : **toute modification d'un contrat met à jour les deux côtés dans la même tâche**.

Conventions : minutes et postes en entiers ; `null` = non calculable (avec une raison) ; jamais de 0 de substitution ; `processing_version` (semver ou hash git) dans chaque fichier racine.

## `meta.json`
```json
{
  "processing_version": "0.1.0",
  "generated_at": "2026-11-04T18:00:00Z",
  "service_date": "2026-11-17",
  "gtfs_downloaded_at": "2026-11-02",
  "day_types": [
    { "id": "d06", "label": "6h-14h", "start": "06:00", "end": "14:00" },
    { "id": "d09", "label": "9h-17h", "start": "09:00", "end": "17:00" },
    { "id": "d14", "label": "14h-22h", "start": "14:00", "end": "22:00" }
  ],
  "budgets": [30, 45, 60],
  "modes": [
    { "id": "transit", "label": "Transports en commun + marche" },
    { "id": "bike_transit", "label": "Vélo + transports en commun" },
    { "id": "bike", "label": "Vélo" },
    { "id": "walk", "label": "Marche" },
    { "id": "car", "label": "Voiture (route vide)" },
    { "id": "car_traffic", "label": "Voiture (trafic moyen DiRIF)" },
    { "id": "velib", "label": "Vélib' (vélo en libre-service)" }
  ],
  "story_communes": ["78358", "78418"],
  "access_communes": ["93048", "77284", "77222"],
  "sources": "sources.json"
}
```
- `story_communes` (écrit par 06 depuis `data/processed/story_communes.txt`) : communes du récit (Maisons-Laffitte 78358, Montesson 78418), choisies **après exploration des données** ; vide si le fichier manque.
- `speeds` (écrit par 06 depuis `starway/config.py`, L-06a) : `{ "walk_kmh": 3.6, "bike_kmh": 12.0 }`, vitesses du calcul (valeurs par défaut de r5py). Le front en tire « ≈ N km à pied / à vélo » sans écrire de vitesse en dur ; rien si absent.
- `dataset_id` (écrit par 06) : identité du jeu de temps de trajet publié, `"{service_date}_{12 premiers caractères de origin_points_sha256}"`, lue dans `data/interim/matrix/run_params.json` (`null` si aucun calcul). Deux calculs faits avec des points de départ différents (centre de gravité de la population ou centre API Géo) ont des `dataset_id` différents ; `processing_version` ne change pas (il est figé dans `run_params` du calcul en cours). **Usage front** : la visite et l'audio pré-généré (voix générée à l'avance avec Azure AI Speech) enregistrent le `dataset_id` des données qui ont servi à écrire la narration (par exemple dans `tour.json` et dans le manifeste audio) ; au lancement de la visite, et dans `RecordDirector` avant tout enregistrement vidéo, le front compare ce champ à `meta.dataset_id`. S'ils diffèrent, il n'utilise pas l'audio (repli sous-titres, avertissement en développement, refus d'enregistrer en mode `record`), parce que les chiffres prononcés ne correspondent plus au ciel affiché.
- `origin_point_rule` (écrit par 06) : règle du point de départ du calcul publié, recopiée de `run_params.json` (ex. « D-017 : origin_lon/origin_lat de communes_idf_2026.csv »).
- `max_trip_min` (écrit par 06) : durée maximale de recherche du calcul (120 min, `starway/config.py`). Le front l'affiche sans l'écrire en dur, sens par sens (aller : « aucun départ dans les 2 h avant le début du poste n'arrive à l'heure » ; retour : « aucune arrivée trouvée dans les 2 h après la fin du poste » ; marche, vélo, voiture : « aucun trajet trouvé en 2 h ou moins »).
- `outbound_step_min` (écrit par 06) : pas de la grille des départs aller du calcul (5 min, `OUTBOUND_STEP_MIN` de `starway/config.py`). Le front en fait le pas de la jauge du budget par sens, de `outbound_step_min` à `max_trip_min` (budget réglable en continu, au pas de la grille de calcul) ; `budgets` reste la liste des budgets où les découvertes sont calculées (repères de la jauge). Si l'un des deux champs manque, le front revient aux boutons `budgets`.
- `origin_methods` (écrit par 06) : libellés des codes `communes.json[].origin.method`.
- `mode_coverage` (écrit par 06) : pour **chaque mode de `modes` qui n'est pas publié pour toutes les origines** (1 285), la liste des origines où il est publié, **éventuellement vide**. Exemple en cours de nuit : `{ "transit": ["75101", "..."], "bike_transit": [], "bike": [...], "walk": [...], "car": [...] }`. Un mode **absent** de `mode_coverage` est publié pour toutes les origines. Une commune est publiée pour un mode quand toutes ses journées requises sont calculées (d06, d09 et d14 pour `transit` et `bike_transit`, `any` sinon) ; `access/{insee}.json` ne contient que les modes publiés pour elle. Hors couverture : le front n'invente rien, affiche « non calculé pour cette commune » et laisse le ciel neutre. Le vélo + TC restera partiel (communes du récit et limitrophes, calcul `04b`).
- `insights` (écrit par 06) : `{ "written": bool, "kinds": { "eclipse": { "status": "ok", "scope": "..." } | { "status": "not_computed", "reason": "phrase en français simple, affichable telle quelle", "detail": "explication technique (journal, page Sources & limites)" }, "territorial_gap": ..., "bike_gain": ..., "late_return": ... } }`. `insights.json` ne contient que les types `ok` ; il est absent si aucun ne l'est. `eclipse`, `territorial_gap` et `late_return` exigent la matrice TC publiée pour **toutes** les origines (sinon le classement dépendrait de l'ordre du calcul) ; `bike_gain` porte sur les origines calculées en vélo + TC (`scope`). Le front peut afficher la `reason` à la place du panneau « Découvertes ».
  `insights.excluded` (écrit par 06) : **liste** (éventuellement vide) de découvertes écartées avant le classement, chacune `{ "would_be_id": "late_return_01", "kind": "late_return", "scenario": {...}, "cause": "..." }` ; `would_be_id` est l'identifiant qu'elle aurait eu (les suivantes remontent d'un rang). Depuis l'adoption des deux réglages de marche (03/11/2026), l'exclusion « retour non mesuré » n'a plus d'objet ; la seule règle active est `cause: "navitia_contradicted"` (découverte contredite par le recoupement Navitia de `07d`, réglage de marche publié) : l'entrée porte alors aussi `crosscheck_file` (chemin du résumé dans le dépôt, ex. `data/processed/navitia_crosscheck_walk3000_summary.json`), `crosscheck_generated_at` et `trips` (`[{insee, pole_id, day, leg, starway_min, navitia_min}]`, sens TC recoupés). `would_be_id` peut dépasser le rang 10 (`late_return_11`) quand la découverte ne remontait qu'après un autre écart. Le front ne l'affiche pas (traçabilité).
  `insights.crosscheck` (écrit par 06 si `07d` a tourné) : `{ "file", "generated_at", "walk_setting", "navitia_last_load_at", "service_date", "statuses": ["confirmed", "within_one_minute", "contradicted", "not_checked"], "method", "published_counts": {statut: n} }`. Tout lien ou texte qui cite un `id` de découverte doit être revérifié contre le fichier publié.
  **Découvertes des 44 astres (`scripts/08e_insights_astres.py`, pas encore publiées)** : le bloc porte en plus `sky: "44"`, `basis: "od_astres"` (calculées sur la table commune x commune agrégée par astre, pas sur `access/`), `navitia_15_flags` (liste de `{id, kind, scenario, contradicted_on_15_poles_as, note}` : découvertes dont le scénario a été contredit par Navitia sur l'ancien ciel, signalées et gardées, le front ne l'affiche pas) et `params` (table lue, budgets, journées, nombre d'origines). `excluded` vaut `[]`, `crosscheck` est absent, chaque découverte porte `crosscheck: "not_checked"` (aucun recoupement des 44 astres) ; `bike_gain` est `not_computed` (vélo + TC absent de la table ; depuis le 10/11, `detail` dit où le vélo + TC est publié, nombre de communes lu dans `meta.mode_coverage` et `meta.access_communes`, sans « pas encore calculé »). Au 10/11, `excluded` et `crosscheck` sont remplis par le recoupement Navitia (`docs/methodologie.md`, « Recoupement Navitia des découvertes (10/11) »). Dans `insights.json`, `metric.poles_delta` compte des **astres atteints au moins en partie** et `metric.jobs_delta` des postes salariés (INSEE), hors commune de départ. Contrôle 07 : `starway.insights_astres.check_published`.
- `walk_settings` (écrit par 06) : réglages de marche des TC, **choisis par l'équipe** (pas des données). Le réglage `default` est publié dans `access/{insee}.json` `modes.transit` ; chaque autre réglage sous `variants.{key}.transit`.
  ```json
  { "nature": "choix de l'équipe (D-024), pas une donnée", "default": "normal", "mode": "transit",
    "legs": ["accès depuis le point de départ", "sortie vers le point d'arrivée"], "transfer_limit_m": 1000,
    "all_walk_trip": "un trajet tout à pied compte comme un seul trajet à pied : il est limité de même",
    "settings": [
      { "id": "normal", "label": "normal : jusqu'à 3 km à pied", "leg_limit_m": 3000, "max_time_walking_min": 50, "key": null,
        "r5_version": "v7.5.1-r5py-walk3000", "r5_jar_sha256": "...", "dataset_id": "2026-11-17_dc97ca710c6c_walk3000" },
      { "id": "comfort", "label": "confort : pas plus de 1 km à pied", "leg_limit_m": 1000, "max_time_walking_min": 17, "key": "comfort",
        "r5_version": "v7.5.1-r5py-walk1000", "r5_jar_sha256": "...", "dataset_id": "2026-11-17_dc97ca710c6c_walk1000" } ] }
  ```
  `leg_limit_m` : distance maximale de chaque trajet à pied d'un trajet TC (accès et sortie) ; `max_time_walking_min` : la même limite en minutes (distance / `speeds.walk_kmh`, arrondi à la minute supérieure) ; `transfer_limit_m` : correspondances à pied (limite du moteur, inchangée). Le front affiche le libellé et la nature (« choix de l'équipe »), jamais comme une mesure. `dataset_id` de chaque réglage : identité du jeu (le `dataset_id` racine, qui sert à l'audio de la visite, ne change pas).
  **Ajout du recalcul des correspondances (04/11, écrit par 06 dès le prochain export, champ en plus, rien d'autre ne change)** : chaque entrée de `settings` porte `transfer_rules` : `"r5"` (moteur d'origine : correspondance = marche OSM + plus de 60 s, comme jusqu'ici) ou `"gtfs_navitia"` (recalcul : minimums de `transfers.txt` et minimum au même arrêt du calculateur officiel IDFM, `06_export_front.py --transfer-rules gtfs_navitia`). Le front peut l'ignorer ; Sources & limites peut le citer (« correspondances : minimums officiels d'IDFM »).
- `velib` (écrit par 06) : `{ "warning": "Vélib' : vélo pas forcément disponible. Ce temps suppose qu'un vélo vous attend à la station de départ et qu'une place est libre à l'arrivée. Personne ne peut le garantir à l'avance : les données ouvertes ne donnent la disponibilité qu'en temps réel. Le temps pour prendre et rendre le vélo n'est pas compté.", "out_of_zone": "Pas de station Vélib' dans cette commune", "source": "VEL01", "snapshot": "2026-11-03", "licence": "ODbL 1.0 ...", "stations": 1520, "origins": 88, "method": "..." }`. `warning` s'affiche **tel quel** (première phrase en gras) sous le choix du mode Vélib' et en tête du panneau de preuve d'un trajet Vélib' ; `out_of_zone` remplace « non calculé pour cette commune » pour une commune hors de `mode_coverage.velib`.
- `walk_limit` : **retiré** depuis l'adoption des deux réglages de marche (03/11/2026). Il décrivait la limite cachée de 2 000 m de R5 et la raison `no_stop_within_walk_limit`, qui ne sont plus publiées.
- `itineraries_communes` (détail des trajets du panneau de preuve, écrit par `06h --publish` puis par 06 à partir du dossier publié) : liste triée des codes INSEE qui ont un fichier `itineraries/{insee}.json.gz` (réglage de marche par défaut, communes **complètes** seulement). Autres réglages : `itineraries_variants` ; format : `itineraries_format` ; faits par ligne : `line_facts` (section `itineraries/` plus bas, 04/11). Le front ne demande un fichier que pour ces communes (aucun 404) ; ailleurs, il dit « pas encore publiés pour cette commune ». Absent : aucun itinéraire publié.
- `transfer_check` (marquage des correspondances, écrit par `06t`, réécrit par 06 depuis le dossier publié, retiré par `06h --publish`) : `{ "rule", "checked_at", "service_date", "walk_setting", "sources", "contract": "itineraries-2" }` quand tous les fichiers `itineraries/` portent le marquage des correspondances ; absent sinon. Détail : section « Appliqué (04/11/2026) : correspondances plus courtes que le minimum officiel » plus bas.
- `access_communes` : communes qui ont un fichier `access/{insee}.json`. Lors d'un export partiel (POC), le front ne propose l'accessibilité réelle que pour celles-ci ; pour les autres, il affiche « non calculé », jamais des données de démo sans bandeau.
- `access_sky` (écrit par 06, **contrat ajouté le 04/11, branche `data/publication-44`, le front doit suivre au moment de la bascule des données**) : `{ "sky": "15" | "44", "poles": 15 | 44, "poles_file": "poles.json" | "poles_d030.json", "poles_sha256": "...", "transfer_rules": "r5" | "gtfs_navitia" }`. Dit sur quels pôles sont alignés les tableaux de `access/{insee}.json` (`out`, `ret`, `reason`, `dep` ont une valeur par pôle, dans l'ordre de `poles.json` du ciel indiqué). Le front n'indexe `access/` avec le ciel affiché que si `access_sky.sky` est celui du ciel (sinon « en cours de calcul », comme aujourd'hui avec 44 astres et un `access/` calculé vers 15 pôles). Absent : lire comme `"15"`. 07 compare `access/`, `itineraries/` et `subscriptions.json` à ce ciel (`access_sky_poles_file`).

## `poles.json`
```json
[
  {
    "id": "P_DEFENSE",
    "name": "La Défense",
    "communes": ["92062", "92026", "92050"],
    "jobs": null,
    "jobs_year": 2023,
    "jobs_source": "EMP01",
    "point": { "lon": 2.2385, "lat": 48.8920, "method": "gare principale" },
    "sky": { "x": 0.31, "y": 0.42 }
  }
]
```
`sky.x`, `sky.y` ∈ [0, 1] : position schématique **identique** pour tous les scénarios.

### 44 astres = bassins d'emploi France Travail 2026, Paris en 20 arrondissements (choix de l'équipe du 04/11)
**Publié (bascule du 04/11)** : le ciel par défaut est celui des 44 astres : `frontend/public/data/poles.json` (écrit par `03b_sky_groups.py --publish`, copie de `data/processed/poles_d030.json`), `od_walk3000/index.json` et `od_walk1000/index.json` (`06d --poles ...`, bloc `preview.published = true`), `geo/poles.geojson` (`06b`). L'ancien ciel des 15 pôles est retiré (09/11/2026). Seuls `poles.json`, `geo/poles.geojson` et `od_walk{L}/index.json` sont propres au ciel ; les `o/{insee}.bin` restent à la racine. Les fichiers `access/`, `itineraries/`, `insights.json` et `context/` (flux) restent alignés sur les 15 pôles : le front ne lit pas `access/` par position avec les 44 astres. Exemple d'entrée :
```json
{ "id": "BE_1146", "name": "T4 Paris Ouest La Défense", "name_short": "Courbevoie", "name_official": "T4 Paris Ouest La Défense",
  "name_short_insee": "92026", "communes": ["92026", "92033", "..."], "jobs": 615567, "jobs_year": 2023, "jobs_source": "EMP01",
  "point": { "lon": 2.2396, "lat": 48.89161, "method": "arrêt d'affichage : arrêt parent le plus desservi le 17/11/2026 (3771 départs) dans les communes de l'astre : La Défense (IDFM:71517, GTFS IDFM)",
             "stop_id": "IDFM:71517", "stop_name": "La Défense", "insee": "92062", "departures": 3771 },
  "sky": { "x": 0.3653, "y": 0.4351 },
  "bassin": { "code": "1146", "name": "T4 Paris Ouest La Défense", "source": "GEO04, France Travail, bassins d'emploi 2026" } }
```
Changements pour le front (les champs de base gardent leur sens) :
- **44 entrées** : d'abord les 20 arrondissements (`BE_1107_{insee}`, de 75101 à 75120), puis les 24 autres bassins par code croissant (`BE_{code_bassin}`). Les `id` `P_*` disparaissent ;
- les `communes` couvrent **les 1 285 origines** (partition exacte, 100 % des 6 418 845 postes Flores 2023) : `od_walk*/index.json` `pole_of` n'a plus de `null` (le front doit continuer d'accepter `null`) ;
- `name` = `name_official` : nom du **panneau** (libellé GEO04 recopié, ex. « T4 Paris Ouest La Défense » ; arrondissement : nom officiel API Géo, « Paris 1er Arrondissement ») ;
- `name_short` (**ajouté**) : nom du **ciel** = commune de l'astre qui compte le plus de postes Flores (égalité : code INSEE croissant) ; astre arrondissement : son numéro, « 1er » à « 20e ». `name_short_insee` (**ajouté**) : code de cette commune (traçabilité) ;
- `bassin` (**ajouté**) : `{ code, name, source }` du bassin d'emploi (les 20 arrondissements portent `1107`, « T1 Paris ») ;
- `point` = **arrêt d'affichage** (règle des pôles : arrêt parent le plus desservi le 17/11/2026 dans les communes de l'astre), avec 4 clés **ajoutées** : `stop_id`, `stop_name`, `insee` (commune de l'arrêt), `departures`. Il ne sert à aucun temps de trajet : les verdicts viennent de la table commune x commune ;
- `sky` = projection du **barycentre des postes** (centres API Géo des communes de l'astre pondérés par les postes Flores, en Lambert-93), même projection que les communes (`sky_project`), **sans relaxation** : deux astres peuvent être proches (écart minimal 0,0175, entre le 1er et le 2e). Le front écarte les positions au zoom sans grossir les disques au même rythme ; il ne déplace jamais un astre selon le scénario.
- `od_walk*/index.json` d'aperçu : même contrat que l'index publié du même réglage ; seuls `pole_of`, `poles`, `generated_at` changent, plus un bloc `preview` (`decision`, `poles_source`, `index_source`, `index_source_sha256`, `bin_files`, `published: false`). Les fichiers `o/{insee}.bin` sont **ceux du dossier publié** (ils ne contiennent aucun pôle) : le front lit `preview-d030/od_walk3000/index.json` et `od_walk3000/o/{insee}.bin`.
- `preview-d030/geo/poles.geojson` : même contrat que `geo/poles.geojson`, 88 entités (44 contours, 44 arrêts d'affichage lus dans `point`).
Contrôles (07) : nombre d'astres dérivé de la source (25 bassins GEO04 des 1 285 origines, T1 Paris remplacé par ses 20 arrondissements : 44), partition et 100 % des postes, fichier identique au recalcul des règles, index et carte alignés, aperçu construit sur l'index publié actuel.

## `communes.json` (index léger, toutes communes IDF)
```json
[{ "insee": "93066", "name": "Saint-Denis", "dep": "93", "lon": 2.35, "lat": 48.93, "population": null, "sky": { "x": 0.52, "y": 0.30 },
   "origin": { "lon": 2.3613, "lat": 48.9394, "method": "gravity" } }]
```
- `lon`, `lat` : centre API Géo (libellés, carte). `sky` : position stable du ciel, calculée depuis ce centre.
- `origin` (**optionnel**) : point de départ réel du routage = centre de gravité de la population (Filosofi 2021, carreaux de 200 m) ou centre du carreau habité le plus proche (`method` le dit). `method` ∈ `gravity` | `nearest_inhabited`, libellés complets dans `meta.origin_methods`. C'est ce point que la carte miroir et le panneau de preuve doivent désigner comme « point de départ ». Il ne déplace jamais l'étoile-guide dans le ciel.

## `access/{insee}.json` (un fichier par commune, chargé à la demande)
Indexation par position : `poles[i]` correspond à `poles.json[i]`.
```json
{
  "insee": "93066",
  "processing_version": "0.1.0",
  "modes": {
    "transit": {
      "d09": {
        "out": [38, null, 52],
        "ret": [41, null, 47],
        "reason": [null, "no_trip_within_120", null]
      }
    }
  }
}
```
- `out` : durée aller en minutes (départ au plus tard permettant d'arriver avant `start`).
- `ret` : durée retour en minutes (départ à `end`, attente initiale comprise).
- `dep` (modes à horaire seulement : `transit`, `bike_transit`) : heure de départ de l'aller retenue, chaîne `"HH:MM"` ou `null`. Définition exacte : **départ le plus tardif de la grille de 5 minutes (de `start` - 120 min à `start` - 5 min) qui arrive avant `start`** ; `out` est la durée de ce trajet, donc `dep + out <= start` (contrôlé par 07). `null` si `out` est `null`. Absent pour `walk`, `bike`, `car` (clé `any`). Aucun champ pour le retour : il part à `end`.
- Toute durée supérieure à la durée maximale de recherche (`MAX_TRIP_MIN` = 120 min ; r5py rend parfois 121 ou 122) est publiée `null` avec `no_trip_within_120` (règle appliquée à l'export, les lots ne sont pas modifiés).
- Accessible pour un budget B ⇔ `out <= B && ret <= B` - **calculé côté front**, pas stocké (les budgets sont des filtres).
- `reason` (si `out` ou `ret` est `null`) : `no_trip_within_120` | `no_service_at_hour` | `origin_not_snapped` | `not_computed`. La raison décrit le **premier sens nul** : l'aller s'il est nul, sinon le retour (convention `reasonLeg` du front).
- `no_stop_within_walk_limit` et la clé de série `walk_limit` : **plus publiées depuis l'adoption des deux réglages de marche** (03/11/2026). Avec un réglage de marche annoncé, un retour nul est un résultat mesuré : `no_trip_within_120`, dont le texte cite le réglage (« aucun retour trouvé en 2 h ou moins avec au plus 3 km à pied à chaque bout », distance tirée de `meta.walk_settings`).
- `variants` (racine, facultatif) : `{ "comfort": { "transit": { "d06": {...}, "d09": {...}, "d14": {...} } } }`, présent pour chaque commune publiée en TC et pour chaque réglage de `meta.walk_settings.settings` dont `key` n'est pas `null`. Chaque série a **exactement** le contrat de `modes.transit.{day}` (`out`, `dep`, `ret`, `reason`, indexés comme `poles.json`). `modes.transit` porte toujours le réglage `meta.walk_settings.default`. Seul le mode `transit` a des réglages : pour les autres modes, le sélecteur est inactif et le dit.
- `velib` (mode) : `modes.velib.any = { "out", "ret", "reason" }` pour les seules communes de `meta.mode_coverage.velib` (88) ; mêmes valeurs pour les trois journées-types (le vélo en libre-service n'a pas d'horaire dans les données). Temps minimal : marche jusqu'à une station, Vélib' jusqu'à une autre, marche jusqu'à l'arrivée, meilleur couple de stations ; prise et dépose du vélo non comptées. Toujours accompagné de `meta.velib.warning`.
- Modes non dépendants de l'heure (`walk`, `bike`, `car`) : mêmes valeurs pour les trois journées-types ; on peut les stocker une fois sous la clé `"any"`.

### Itinéraires TC du panneau de preuve : champs par ligne
Le front lit les fichiers d'itinéraires (contrat plus bas), types et textes dans `frontend/src/data/itineraries.ts`, seulement pour les communes annoncées. Un champ absent n'affiche rien, `null` ou `unknown` affiche « non renseigné(e) », jamais « non ».
- **Publiés depuis le 04/11/2026** (06h, `starway/line_facts.py`) sur **chaque tronçon en TC** (jamais sur la marche) :
  - `air_conditioning` : `"true" | "partial" | "false" | "unknown"`, recopié du référentiel des lignes IDFM (TRA03, ODbL, champ `air_conditioning`, déclaration de la ligne) par `route_id` sans `IDFM:` = `id_line` ; vide ou autre valeur du référentiel = `"unknown"` ; ligne absente du référentiel = `null` ;
  - `punctuality` : `{ "value_pct": 89.4, "month": "2026-09" }` (QS01, ODbL, `taux_de_ponctualite` du mois le plus récent du fichier, le même pour toutes les lignes, valeur recopiée sans arrondi) pour un tronçon `rer` ou `train` dont la ligne (`line`) est dans QS01 ; sinon `{ "value_pct": null, "month": null, "reason": "no_open_data" }` (métro, tram, bus, TER, ligne V...) ou `"reason": "month_not_published"` (ligne de QS01 sans valeur au mois retenu ; jamais la valeur d'un autre mois). Mot affiché : **« ponctualité »** (part des voyageurs arrivés avec moins de 5 min de retard), jamais « taux d'incident ». RER A et B : texte publié `meta.line_facts.texts.punctuality.shared_text` (exploités par la RATP et la SNCF ; SNCF Voyageurs ne dit pas si le taux couvre toute la ligne).
  - par fichier, avant `days` : `"line_facts_meta": { "sources": ["TRA03", "QS01"], "tra03_snapshot": "2026-11-03", "punctuality_month": "2026-09", "qs01_updated": "2026-11-03" }` (dates d'extraction lues dans le manifeste).
- **Non publiés** (filtre handicap en attente de l'équipe, proposition-panneau-preuve.md § 3) : `accessibility` (`"true" | "false" | "unknown"`, TRA03) ; `station_from`, `station_to` (`{ "level", "label", "comment" }`, TRA04).
- **Licence** : TRA03 et QS01 sont sous ODbL ; les dossiers `itineraries/` et `itineraries_walk1000/` qui reprennent ces valeurs sont une base dérivée publiée sous la même licence, avec attribution (texte `meta.line_facts.texts.licence`, affiché sous le détail du trajet).
Les valeurs ci-dessus sont des exemples de format (sauf la règle), pas des mesures.

### Appliqué (04/11) : « Mes besoins », accessibilité déclarée par tronçon (`needs-1`)
Écrit par **`06n_export_needs.py`** (`starway/needs.py`, tests `tests/test_needs.py`) dans les fichiers déjà publiés ; aucune durée ni statut ne change, `access/` et le ciel non plus. Après `06h --publish`, relancer 06n (les champs disparaissent, `meta.needs` aussi à la prochaine exécution de 06). Les noms `accessibility`, `station_from` et `station_to` proposés ci-dessus **ne sont pas ceux de ce contrat** : `a11y` les remplace pour l'accessibilité (à aligner avec la branche `data/panneau-lignes` si elle publie `air_conditioning` et `punctuality`).
- Par tronçon en TC (jamais sur la marche) : `"a11y": { "line": "true|false|unknown|null", "audio": "true|false|partial|unknown|null", "visual": "true|false|partial|unknown|null", "st_from"?: { "level": 3, "comment"?: "..." } | null, "st_to"?: {...} | null }`. `line`, `audio`, `visual` : référentiel des lignes IDFM (TRA03, ODbL), `null` si la ligne n'y est pas ; `st_from` / `st_to` : accessibilité en gare (TRA04), présents pour un tronçon ferré (rer, train, ter, rail) ou un quai du jeu, `null` si la gare est absente. `wc_trip`, `wc_from`, `wc_to` (GTFS, TRA01) restent ceux de 06h.
- Par fichier : `"needs_meta": { "contract": "needs-1", "sources": ["TRA01","TRA03","TRA04"], "tra03_snapshot": "<16 premiers caractères du sha256>", "tra04_snapshot": "..." }`, placé avant `days`.
- `meta.json` : `"needs": { ...needs_meta, "needs": ["wc_trip","wc_stops","station","audio","visual"], "station_levels": { "1": "<libellé exact>", ... } }` (écrit par 06n, relu par 06 depuis les fichiers publiés ; absent = réglage masqué). **Version finale du 05/11 : `texts` est supprimé** (les textes sont ceux du front, `data/needs.ts`), `needs` ne liste plus les handicaps mais les cinq cases ; `a11y` et `needs_meta` des fichiers ne changent pas. `06n --meta-only` réécrit ce bloc sans lots. Les cases 1 à 3 (`wc_trip`, `wc_stops`, `station`) peuvent marquer un astre, 4 et 5 (`audio`, `visual`) jamais : règle `starway.needs.star_marked` = `frontend/src/data/needsSky.ts` `starMarked` (cas communs `frontend/src/data/needsRuleCases.json`).
- Front : `data/needs.ts` (types `NeedsMeta`, `LegA11y`), `store/needsStore.ts`, `components/proof/ProofNeeds.tsx`. Source affichée seulement en mode sources : `needsPart`, `NeedsSourceNote`.
- Contrôles 07 : `needs_ok` (P0), `needs_present` (P1).

### Appliqué (03/11 au soir, complété le 04/11) : voiture avec trafic moyen DiRIF, véhicules, coût, péages et carbone par trajet (le front suit)
Écrit par `06_export_front.py` (fonctions `starway/congestion.py`, `starway/vehicles.py`, `starway/toll_publish.py`, `starway/car_dist.load_corrected`), contrôlé par 07 (« voiture D-029 »). Remplace la proposition `meta.costs` ci-dessous.

- **`meta.modes`** : `car` s'appelle « Voiture (route vide) » ; `car_traffic` « Voiture (trafic moyen DiRIF) » vient juste après. **Aucune série `car_traffic` n'est publiée** dans `access/` ni dans la table OD : le front la déduit de `car` (`frontend/src/data/congestion.ts`). `mode_coverage.car_traffic` = `mode_coverage.car` (absents tous les deux si la voiture est publiée partout).
- **`meta.car_congestion`** :
  ```json
  "car_congestion": {
    "mode": "car_traffic", "base_mode": "car", "source_id": "ROAD01",
    "publisher": "DRIEAT Île-de-France, Direction des routes d'Île-de-France (DiRIF)",
    "title": "Baromètre trafic mensuel de la circulation, n° 41, novembre 2025, page 2 « Temps de parcours les jours ouvrés »",
    "url": "https://www.dir.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/barometre_mensuel_no41-_novembre_2025.pdf",
    "downloaded_at": "2026-11-03T22:..Z", "sha256": "9018fb3b...", "month": "2025-11",
    "scope": "voies rapides d'Île-de-France", "network": "voies structurantes du réseau routier national non concédé (...)",
    "days": "jours ouvrés (hors week-ends et jours fériés)", "definition": "...", "quote": "...", "read_from": "...",
    "uncertainty": 0.02,
    "periods": [ { "id": "p06_10", "start": "06:00", "end": "10:00", "index": 1.75 },
                 { "id": "p10_16", "start": "10:00", "end": "16:00", "index": 1.39 },
                 { "id": "p16_20", "start": "16:00", "end": "20:00", "index": 1.95 } ],
    "day_types": { "d06": { "out": null, "ret": "p10_16", "out_reason": "no_period" },
                   "d09": { "out": "p06_10", "ret": "p16_20" },
                   "d14": { "out": "p10_16", "ret": null, "ret_reason": "no_period" } },
    "rule": { "out": "...", "ret": "...", "rounding": "...", "otherwise": "...", "verdict": "..." },
    "texts": { "no_period": "pas de mesure de la DiRIF à cette heure", "outside_period": "...", "choice": "...", "label": "..." },
    "decision": "D-029"
  }
  ```
  Règle (à appliquer telle quelle, identique au pipeline) : aller (arrivée au début S) dans la tranche p telle que `p.start < S <= p.end` et `S - T x index >= p.start` ; retour (départ à la fin E) dans la tranche p telle que `p.start <= E < p.end` et `E + T x index <= p.end` ; temps avec trafic = `floor((T x round(index x 100) + 50) / 100)`. Sinon (`no_period`, `outside_period`) : temps route vide gardé et texte `texts.*` affiché, jamais « x 1 ». `day_types` donne la tranche candidate de chaque sens des journées-types (le débordement dépend de T). Le verdict du mode `car_traffic` utilise ces temps ; le ciel ne bouge pas.
- **`meta.vehicles`** (une entrée par véhicule publié, dans cet ordre ; **changé le 04/11** : quatre deux-roues, carbone, `tolls` retiré, le front a suivi) :
  ```json
  { "id": "petrol", "label": "Voiture essence", "family": "car", "energy": "SP95-E10", "unit": "L",
    "consumption_per_100km": 6.7247,
    "consumption_source": { "source_id": "COST08", "year": 2024, "text": "SDES, ... « dont essence »", "file_sha256": "..." },
    "price_eur_per_unit": 2.089,
    "price_source": { "source_id": "COST07", "statistic": "médiane non pondérée des stations d'Île-de-France",
                      "fuel_field": "e10_prix", "text": "...", "read_at": "2026-11-03T22:08Z", "file_sha256": "...",
                      "stations_idf": 831, "stations_with_price": 604, "median": 2.089, "q1": 2.0112, "q3": 2.189,
                      "min": 1.88, "max": 2.469, "updated_oldest": "...", "updated_newest": "...",
                      "updated_by_month": { "2026-11": 485 }, "price_and_rupture": 0 },
    "cost_eur_per_km": 0.140478, "toll_class": 1,
    "co2_kg_per_unit": 2.69, "co2_kg_per_km": 0.180893,
    "co2_source": { "source_id": "ENV02", "version": "V23.6", "element_id": "13988", "name": "Essence ; E10",
                    "unit": "kgCO2e/litre", "total": 2.69, "posts": { "Combustion": 2.19, "Amont": 0.502 },
                    "validity": "déc-20", "modified": "18/06/2021", "comment": null, "file_sha256": "..." },
    "status": "ok" }
  ```
  - `id` : `petrol`, `diesel`, `electric` (`family: "car"`, classe de péage 1), puis `moto_125` (« Scooter ou moto 125 cm3 »), `maxiscooter`, `moto_mid` (« Moto de cylindrée moyenne »), `moto_900` (« Moto de plus de 900 cm3 ») (`family: "two_wheeler"`, SP95-E10, classe 5). Pas de deux-roues électrique (`meta.car_costs.two_wheelers.electric` le dit).
  - deux-roues : `consumption_source` = `{ "source_id": "VEH01", "year": 2023, "text": "ADEME ... page 6 : moyenne de N véhicules d'essai (n° ...), lue sur la figure ...", "reading_file": "data/processed/ademe_2rm_conso_lecture.csv", "vehicles": ["28", "32", "24", "27"], "co2_exhaust_g_km": [47.9, 63.3] }` ; `time` = `{ "same_as": "car", "text": "Même temps de trajet que la voiture. En réalité il peut être plus court (circulation entre les files), mais ..." }` (pas de `source_url` : le décret de 2025 n'est plus cité, non revérifiable) : `text` s'affiche tel quel.
  - `diesel` (gazole, `gazole_prix`, ENV02 élément 25775) ; `electric` (unit `kWh`, `price_source` : `source_id` COST06, `text`, `valid_from` ; ENV02 élément 43642).
  - `co2_kg_per_km` = `consumption_per_100km / 100 x co2_kg_per_unit` ; `null` avec `co2_reason` si le facteur n'est pas lu.
- **`meta.car_costs`** : `formula`, `label` (« Énergie et péages »), `energy_label`, `not_included` (liste à afficher), `rounding`, `carbon` (`formula`, `unit` « g CO2e », `rounding`, `occupancy` « une personne seule dans le véhicule ... », `perimeter`, `tc_comparison`, `source_id` ENV02), `two_wheelers` (`time`, `source_url`, `electric`), `distances` : `{ "status": "ok" | "pending" | "refused", "reason"?, "car_speed_mps"?, "pairs"?, "toll_key_rule"?, "agreement_with_car_matrix"?, ... }`, `tolls` : `{ "status": "ok" | "pending", "file": "tolls.json", "contract": "tolls-1", "cells": { "sans_peage": n, "passages": n, "non_trouve": n, ... } }`. Sans `distances.status: "ok"`, aucun `car_trip` n'existe ; sans `tolls.status: "ok"`, ni `car_trip.toll` ni `tolls.json`.
- **`access/{insee}.json` `car_trip`** (seulement avec les distances corrigées ; **changé le 04/11** : `cost_eur` retiré, `toll` ajouté) :
  ```json
  "car_trip": { "dist_m": { "out": [14210, null], "ret": [13150, 40102] },
                "reason": { "out": [null, "no_route"], "ret": [null, null] },
                "toll": { "out": [[[0, 0]], null], "ret": [[], { "s": "non_trouve", "p": [4] }] } }
  ```
  Tableaux alignés sur `poles.json`, vers le point d'ancrage du pôle (pas commune par commune). Valeurs ci-dessus : exemples de format.
  - `toll[sens][i]` : `[]` = aucun péage traversé (0 € sûr) ; `[[e, s], ...]` = passages tarifés, indices de `tolls.json.points` (entrée, sortie ; un point à prix fixe donne `[e, e]`) ; `{ "s": statut, "p": [indices] }` = péage inconnu (`non_trouve` grille non relevée, `couple_indetermine`, `sens_requis`, `couple_absent`, `couple_asymetrique` ; textes dans `tolls.json.status_texts`) ; `null` = pas de trajet.
  - **Le coût et le carbone ne sont plus stockés** (poids : 7 véhicules x 3 tableaux x 2) : le front les calcule depuis `dist_m` et `meta.vehicles`, avec les opérations de `starway/vehicles.py` (`energy_eur` = distance / 1000 x `cost_eur_per_km` ; `co2_g` = distance x `co2_kg_per_km` ; au centime et au gramme, demi-unité vers le haut, total arrondi après la somme) : `frontend/src/data/carCost.ts`, mêmes cas de test des deux côtés. 07 vérifie la formule (distance x consommation x prix ou facteur).
- **`tolls.json`** (contrat `tolls-1`, écrit par 06 avec `car_trip`, `starway/toll_publish.py`, chargé à la demande par le panneau de preuve) :
  ```json
  { "contract": "tolls-1", "processing_version": "0.1.0", "service_date": "2026-11-17",
    "days": { "-1": { "date": "2026-11-16", "weekday": "lundi", "types": { "DUPLEX_A86": "lundi", "APRR": "tous" } }, "0": {}, "1": {} },
    "points": [ { "id": "SAPN_A14_MONTESSON", "label": "A14 - gare de Montesson", "road": "A14", "operator": "SAPN",
                  "system": "SAPN_A14", "pricing": "prix_fixe", "status": "ok", "notice": "Gratuité de l'A14 ... Non appliquée ...",
                  "credit": "tarif SAPN 2026 (Journal officiel)" },
                { "id": "SANEF_A4_COUTEVROULT", "status": "non_trouve", "reason": "grille Sanef / SAPN 2026 non téléchargeable ..." } ],
    "grids": [ { "e": 0, "s": 0, "c": 1, "t": "standard", "d": 0, "slots": [[0, 360, 6.6], [360, 600, 10.8]] },
               { "e": 12, "s": 14, "c": 5, "t": "standard", "status": "interdit", "reason": "deux-roues interdits dans le Duplex A86" } ],
    "status_texts": { "non_trouve": "grille tarifaire non relevée" }, "classes": { "1": "...", "5": "..." },
    "tariffs": { "standard": "...", "telepeage": "..." }, "rule": { "window_out": "...", "window_ret": "...", "price": "...", "order": "..." },
    "not_applied": ["..."], "sources": [ { "source_id": "TOLL01", "title": "...", "url": "...", "read_at": "...", "licence": "..." } ],
    "decision": "D-029" }
  ```
  - `points[].credit` (ajouté le 10/11/2026, D-060, champ facultatif, contrat inchangé) : crédit du producteur du tarif, présent sur chaque point qui a au moins un prix (07, P0) : « tarif © VINCI Autoroutes 2026 », « tarif © Sanef 2026 », « tarif SAPN 2026 (Journal officiel) », « tarif APRR 2026 » (année = date d'effet de la grille, `toll_publish.point_credits`). Le front l'affiche **toujours** à côté du montant, mode sources ou non (accord de l'organisateur du hackathon du 09/11/2026).
  - `points` : registre `starway/toll_tariffs.py`, dans son ordre (indices de `car_trip.toll`) ; `grids` : une grille par couple (entrée `e`, sortie `s`), classe `c` (1 ou 5), tarif `t` (`standard` ; `telepeage` pour le Duplex A86 seulement, jamais dans le total) et jour `d` (-1 veille, 0 mardi 17/11/2026, +1 lendemain) ; `slots` : `[début, fin, prix TTC]` en minutes, de 0 à 1440 sans trou (07).
  - **Règle du front** (`frontend/src/data/tolls.ts`, identique à `toll_publish.toll_leg`) : fenêtre de passage en minutes depuis minuit du jour de service : aller `[S - T, S)`, retour `[E, E + T)`, T = durée affichée du sens (route vide, ou trafic moyen DiRIF en `car_traffic`) ; un prix si la fenêtre tient dans une tranche, sinon une fourchette (min, max), jamais une moyenne ; une cellule inconnue ou un passage interdit rendent le péage du sens inconnu (`null`), jamais 0.
- **Affichage** (front, 04/11) : sélecteur « Véhicule » sur la deuxième ligne de la cellule « Mode » en `car` et `car_traffic` (URL `vh`, écrit seulement hors défaut) ; bloc « Coût et carbone » du panneau de preuve (`components/proof/ProofCarCost.tsx`) : aller et retour (distance, énergie, péages traversés, leurs noms et le crédit de leur producteur, total, carbone), total aller et retour, tarif badge du Duplex à part, avis de `points[].notice`, `not_included`, sources ; jamais sur le ciel.

### Proposé (03/11, REMPLACÉ par la section « voiture avec trafic moyen DiRIF » ci-dessus) : distance routière voiture et `meta.costs`
Demande de l'équipe : un coût carburant voiture = distance routière x consommation moyenne x prix du carburant. Calcul `04g_car_distances.py` (`data/interim/car_dist/`, méthodologie § 5 decies). **Bloqué tant que le recoupement échoue** : la durée des itinéraires vaut 2,15 fois la minute de la matrice voiture en médiane, la distance mesurée n'est donc peut-être pas celle du trajet le plus rapide. Si l'équipe valide ensuite, le front devra suivre :
- **Où** : dans `access/{insee}.json`, série `modes.car.any`, deux tableaux de plus alignés sur `poles.json` (pas de fichier à part : 30 entiers par commune, déjà chargés avec les minutes) :
  ```json
  "car": { "any": { "out": [33, 51], "ret": [26, 48], "reason": [null, null],
                    "dist_m": { "out": [14210, 38877], "ret": [13150, 40102] } } }
  ```
  `dist_m` : distance du chemin voiture trouvé par R5 (mètres, entier), même commune (centre de gravité de la population) et même pôle (point d'ancrage) que `out` / `ret`, **chaque sens mesuré séparément** (sens uniques). `null` quand la durée est `null` (même raison) ou quand l'itinéraire n'est pas trouvé (`no_route`, alors signalé au panneau de preuve) ; jamais 0 hors trajet vers soi-même. Les valeurs ci-dessus sont des exemples de format, pas des mesures.
- **`meta.costs`** (un seul bloc, chaque valeur avec sa source, sa date et son statut ; aucune valeur sans source) :
  ```json
  "costs": {
    "transit": { "navigo_month_all_zones_eur": 90.80, "valid_from": "2026-01-01", "employer_share_min": 0.5,
                 "sources": ["COST01 (IDFM, page Navigo Mois, lue le 03/11/2026)", "Code du travail R3261-1"] },
    "car_fuel": { "consumption_l_per_100km": { "petrol": 6.72, "diesel": 5.93 }, "consumption_year": 2024,
                  "consumption_source": "SDES, Bilan annuel des transports en 2024 (25/11/2025), onglet G3.b",
                  "price_eur_per_l": { "petrol": null, "diesel": null }, "price_status": "not_extracted",
                  "price_source": "Prix des carburants en France, flux instantané v2 (data.gouv.fr, Licence Ouverte 2.0)",
                  "price_statistic": null, "price_date": null,
                  "not_included": ["stationnement", "péages", "assurance", "achat", "entretien", "congestion"] } }
  ```
  Valeurs IDFM et SDES recopiées de `docs/proposition-cout.md` (lues le 03/11/2026) ; le prix du carburant reste `null` tant que la statistique (par exemple médiane des stations d'IDF à une date donnée) n'est pas choisie par l'équipe et le fichier ajouté au manifeste.
- **Calcul côté front** : coût carburant d'un sens = `dist_m / 1000 x consumption / 100 x price`, affiché avec essence et gazole (on ne connaît pas la voiture de la personne), la date du prix, et la liste `not_included` ; jamais sur le ciel (le ciel ne code que l'accessibilité) ; jamais comparé au Navigo sans dire que l'un est un coût partiel par trajet et l'autre un forfait mensuel complet.

## `itineraries/{insee}.json.gz` (appliqué le 03/11/2026) : détail des trajets du panneau de preuve
**Changement du 04/11/2026 (le front suit, même branche)** :
- **format** : chaque fichier est le JSON minifié décrit ci-dessous **compressé en gzip** (`{insee}.json.gz`, en-tête sans date : mêmes octets d'un export à l'autre), annoncé par `meta.itineraries_format = { "suffix": ".json.gz", "encoding": "gzip" }`. Le front télécharge les octets (`.gz` servi en `application/octet-stream`, `staticwebapp.config.json`) et les décompresse (`DecompressionStream`, comme les tables SWOD) ; si le serveur les a déjà décodés (premiers octets autres que `1f 8b`), il lit le JSON tel quel. Poids : 74,8 Mo de JSON (réglage « normal », correspondances marquées) deviennent **7,5 Mo** ; tous les scripts passent par `starway/itin_sets.py` (`read_doc`, `write_doc`) ;
- **réglage « confort »** : même contrat dans `itineraries_walk1000/{insee}.json.gz` (lots `itineraries_walk1000` de 04h, durées = `access/{insee}.json` `variants.comfort.transit`, `walk_setting: "comfort"`, pas de bloc `offpeak`), annoncé par **`meta.itineraries_variants`** : `{ "comfort": { "dir": "itineraries_walk1000", "walk_setting": "comfort", "communes": [...], "transfer_check": {...} } }` (`transfer_check` : marquage des correspondances du jeu, absent s'il n'est pas marqué). Le front prend le dossier dans l'annonce (jamais en dur) ;
- **faits par ligne** (`air_conditioning`, `punctuality`, `line_facts_meta`) : section précédente ; `meta.line_facts` = bloc `line_facts_meta` commun à tous les fichiers des deux jeux + `texts` (libellés, définitions, textes « pas de donnée ouverte », RER A et B, licence) ; absent si un fichier n'en a pas.
Les annonces (`itineraries_communes`, `transfer_check`, `itineraries_variants`, `itineraries_format`, `line_facts`) sont calculées depuis les dossiers publiés par une seule fonction (`starway/itin_meta.py`), appelée par 06, 06h et 06t ; 07 vérifie qu'elles sont égales aux dossiers (P0).

Produit par `06h_export_itineraries.py --publish` à partir de 04h (méthodologie § 5 duodecies), écrit dans `frontend/public/data/itineraries/` pour les **seules communes complètes** (15 pôles x 3 journées x 2 sens), annoncées par `meta.itineraries_communes` ; sans `--publish`, aperçu dans `data/processed/itineraries_preview/`. Un fichier par commune ou arrondissement (975 publiés le 03/11 au soir, 1 285 attendus ; 43 Ko en moyenne, 128 Ko au plus), chargé à la demande quand le panneau de preuve s'ouvre, comme `access/{insee}.json`. `contract` vaut `"itineraries-1"` à la sortie de 06h, puis `"itineraries-2"` une fois marqué par 06t (marquage des correspondances, plus bas) ; le front accepte tout `contract` qui commence par `itineraries-`.

```json
{
  "insee": "93048", "contract": "itineraries-1", "processing_version": "0.1.0",
  "service_date": "2026-11-17", "walk_setting": "normal",
  "poles": ["P_PARIS_QCA", "..."],
  "days": {
    "d09": {
      "out": [ {
        "status": "ok", "dep": "08:20", "arr": "09:01", "min": 41, "matrix_min": 41, "delta_min": 0,
        "rides": 2, "wait_min": 4.5, "walk_m": 980,
        "legs": [
          { "m": "walk", "role": "access", "dep": "08:20", "arr": "08:26", "min": 6.2, "dist_m": 372,
            "from": null, "to": "Mairie de Montreuil" },
          { "m": "metro", "line": "9", "color": "D5C900", "text_color": "000000", "route_type": 1, "agency": "RATP",
            "from": "Mairie de Montreuil", "to": "Nation", "dep": "08:27", "arr": "08:41", "min": 14.0,
            "wait_min": 1.0, "dist_m": 5120, "wc_trip": null, "wc_from": true, "wc_to": true },
          { "m": "walk", "role": "transfer", "dep": "08:41", "arr": "08:43", "min": 1.5, "dist_m": 89,
            "from": "Nation", "to": "Nation" },
          { "m": "rer", "line": "A", "color": "EB2132", "...": "..." },
          { "m": "walk", "role": "egress", "dep": "09:00", "arr": "09:01", "min": 0.8, "dist_m": 46,
            "from": "La Défense", "to": null } ],
        "tickets": { "metro_train_rer": 1, "bus_tram": 0, "airport": 0, "cost_eur": 2.55, "status": "ok" },
        "co2_g": { "value": 61, "status": "ok" } },
        { "status": "no_trip_in_matrix", "reason": "no_trip_within_120" } ],
      "ret": [ "... même forme, départ à la fin du poste ..." ] },
    "d06": { "...": "..." }, "d14": { "...": "..." } },
  "offpeak": { "dep": "11:00", "out": [38, null], "ret": [41, null], "reason": [null, "no_trip_within_120"] }
}
```
(valeurs de l'exemple illustratives du format, pas des résultats)

- **Alignement** : `days.{d}.out[i]` et `.ret[i]` correspondent à `poles[i]` (ordre de `poles.json`, comme `access/`). Aller : départ au `dep` de `access/` ; retour : départ à la fin du poste.
- **Durées** : `matrix_min` = la valeur de `access/` (celle du verdict et du ciel, à ne jamais remplacer) ; `min` = durée de l'itinéraire détaillé (`arr` moins `dep`, minutes tronquées) ; `delta_min` = `min - matrix_min` (banc : 0 pour 63 %, au plus 1 min pour 94 %). Si `delta_min` n'est pas 0, écrire « itinéraire détaillé à N min près ». Les heures sont des heures d'horloge tronquées à la minute ; au-delà de minuit « 24:10 ».
- **Tronçons** (`legs`, dans l'ordre) : `m` = `walk` (rôle `access`, `transfer`, `egress`, ou `direct` pour un trajet tout à pied), `metro`, `rer`, `train` (Transilien), `ter`, `tram`, `bus`, `cable`, `funicular` ; pour un tronçon en TC : `line` (`route_short_name`), `color` et `text_color` (hexadécimal sans « # », `null` si absent du GTFS), `route_type` (GTFS), `agency`, arrêts `from` et `to` (noms GTFS ; tirets longs publiés en tiret simple ; deux arrêts différents peuvent porter le même nom), `wait_min` (attente à l'arrêt avant la montée), `dist_m` (**somme des distances à vol d'oiseau entre arrêts successifs de la course**, de la montée à la descente, depuis le 03/11 : la longueur R5 le long de `shapes.txt` était impossible pour 3,7 % des tronçons) ; `wc_trip` (course accessible en fauteuil), `wc_from`, `wc_to` (arrêts) : `true`, `false`, ou `null` quand le GTFS n'en dit rien (jamais deviné) ; `on_demand: true` (présent seulement dans ce cas) : course de transport à la demande (réservation obligatoire au sens du GTFS), `dist_m` vaut alors `null`, et le carbone du sens est `unknown` avec la raison. Marche : `dist_m` peut être `null`.
- **Tickets** (titres à l'unité, plein tarif, pour qui n'a pas de forfait ; le coût selon les abonnements est calculé par le front avec `subscriptions.json` ; le forfait Navigo reste dans `context/`) : nombre de tickets Métro-Train-RER (2,55 €), Bus-Tram (2,05 €), Paris Région <> Aéroports (14,00 €) et `cost_eur` ; `status` = `ok` ou `unknown` (ligne sans titre relevé, par exemple CDG VAL, navette Magical Shuttle ou bus de remplacement d'une ligne ferrée : tous les nombres et `cost_eur` à `null`, `reasons` donne la raison ; la valeur `street_transfer_unverified`, émise jusqu'au 03/11, ne l'est plus depuis la correction du 04/11 : une correspondance par la rue entre deux stations est sans second ticket si le couple figure dans la liste officielle IDFM, sinon elle compte un nouveau ticket ; le front sait encore lire l'ancienne valeur). Sources des règles : TKT01 (CGVU des tickets, liste des correspondances par la voie publique). Phrase à afficher : « Prix au ticket à l'unité, plein tarif, tarifs au 1er janvier 2026 ; avec un forfait Navigo, le trajet est inclus. »
- **Carbone** (`co2_g`) : g CO2e pour ce sens, somme des tronçons en TC (distance x valeur par mode du calculateur IDFM, jeu ENV01) ; `status` = `ok` ou `unknown` (`value` = `null`, `reason` = « facteur non publié pour la ligne X »). La marche n'est pas comptée. Phrase de garde : celle de proposition-panneau-preuve.md § 4 (facteur moyen, bus gazole).
- **Trajet absent** : `{ "status": "no_trip_in_matrix", "reason": "<raison de access/>" }` (la matrice n'a pas de trajet de 120 min ou moins : rien à détailler), `no_itinerary_found` (rare : la matrice a une durée, aucun itinéraire trouvé ; à afficher « détail indisponible »), `point_not_snapped`, `not_computed`.
- **Heure creuse** (`offpeak`) : temps TC porte à porte pour un départ fixe à 11h00 (choix de l'équipe, pas une donnée), commune vers pôle (`out`) et pôle vers commune (`ret`), `null` + `reason` sinon. Ce n'est pas la règle de l'aller du ciel : libellé « en partant à 11h00 : N min », comparé à `matrix_min`.
- **Taille** (essai de 06h sur les 200 trajets du banc) : 1,4 Ko par trajet détaillé en moyenne, 2,4 Ko au plus ; environ **67 Mo** bruts pour 44 832 trajets et 1 285 fichiers (5 à 120 Ko par fichier), taux gzip 0,14, soit environ 10 Mo transférés pour toute l'IDF (un fichier à la fois : 1 à 17 Ko compressés) ; le site passerait de 108 à environ 175 Mo (limite 250 Mo). Réductible de moitié avec une table des noms d'arrêts par fichier si la place manque (changement de contrat).
- **Ce que le front fait** (03/11, `ProofPanel.tsx`, `data/itineraries.ts`) : pour une commune de `meta.itineraries_communes`, le mode TC, le réglage de marche par défaut, une journée-type et hors comparaison, `fetch(/data/itineraries/{insee}.json)` (cache par commune), puis `days[d].out[i]` et `days[d].ret[i]` : blocs « Transports utilisés (aller) » et « (retour) » (heures, pastille de ligne, `line`, `from` → `to`, minutes, mention du transport à la demande), coût au ticket de chaque sens et total aller et retour quand les deux prix sont sûrs (sinon la raison : correspondance par la rue à vérifier, titre non relevé), carbone aller et retour (sinon la raison publiée). **En mode commune par commune** (table OD, mode par défaut) : mêmes blocs quand les horaires sont ceux d'une journée-type, avec le libellé « Exemple de trajet vers <arrêt>, l'arrêt le plus desservi du pôle, journée 9h-17h » (l'itinéraire va à l'arrêt d'ancrage, pas au centre de chaque commune du pôle). Hors de ces cas, une phrase dit pourquoi le détail n'est pas disponible (mode, réglage « confort », horaires libres, comparaison, commune pas encore publiée, aucun trajet de 2 h ou moins). Le verdict reste calculé depuis `access/` (ou la table OD).
  **Depuis le 04/11 (V0, `components/proof/ProofTransports.tsx`, `ProofOffpeak.tsx`, `ProofModes.tsx`, `data/offpeak.ts`, `data/modesCompare.ts`)** : le réglage « confort » a son détail (`meta.itineraries_variants.comfort`, marquage des correspondances du jeu) ; sous les temps, l'heure creuse « En partant à 11h00 : aller N min, retour M min » avec la phrase « départ choisi par l'équipe (pas une donnée) » (réglage « normal » seulement : `offpeak` absent du jeu « confort ») ; les lignes utilisées restent visibles avec « climatisation : … · ponctualité : … » (version courte), le détail des tronçons, les phrases complètes et la mention ODbL étant repliés ; bloc replié « Comparer les modes » (une ligne par mode publié pour la commune : aller, retour, verdict au temps choisi, coût et carbone seulement s'ils sont publiés, sinon « non publié »).

### Appliqué (04/11/2026) : correspondances plus courtes que le minimum officiel (le front suit)
Écrit par **`06t_export_transfer_check.py`** dans les fichiers déjà publiés, à partir du contrôle `07h_transfer_times_check.py` (méthodologie § 5 quindecies) ; aucun calcul de trajet, aucune durée publiée ne change, `access/` et le ciel non plus. Un fichier marqué passe au contrat **`itineraries-2`** (= `itineraries-1` + les champs ci-dessous ; le front accepte tout `itineraries-*`). Après un `06h --publish`, les fichiers repassent en `itineraries-1` sans marque et `meta.transfer_check` disparaît, jusqu'à ce que 07h puis 06t soient relancés.

Par fichier, avant `days` :
```json
"transfer_check_meta": { "rule": "reference", "checked_at": "2026-11-04T09:17:16Z", "service_date": "2026-11-17",
                         "walk_setting": "normal", "sources": ["TRA01", "TRA02B"] }
```
Par trajet `status: "ok"` (tous ; les trajets sans itinéraire n'ont rien) :
```json
"transfer_check": {
  "status": "short",
  "short": [ { "at": "La Défense", "to": "La Défense", "available_s": 184, "min_s": 300, "source": "navitia" } ],
  "bound_min": 63
}
```
(valeurs publiées pour Maisons-Laffitte, retour depuis Versailles / Vélizy, 9h-17h)
- **`status`** : `short` (au moins une correspondance plus courte que le minimum), `verified` (toutes ont un minimum et le respectent), `partly_unverified` (aucune trop courte, au moins une sans minimum connu), `no_transfer` (0 ou 1 tronçon en TC).
- **Règle** (une seule par jeu, dans `transfer_check_meta.rule`, jamais mélangée) : `reference` par défaut (minimum = ligne `transfers.txt` du couple exact de quais, sinon durée de correspondance du calculateur d'IDFM, Navitia, API « connections » relevée par 07i, pour les couples sans ligne, au même arrêt surtout) ; `gtfs` avec `06t --rule gtfs` (seul `transfers.txt`). `sources` : codes de `sources.json` (TRA01, et TRA02B pour `reference` : réponses « connections » lues dans `navitia_connections.csv`, ligne TRA02B du manifeste). **Changé le 10/11** (audit du mode sources) : c'était TRA02, la ligne des trajets `journeys`, qui ne sert qu'au contrôle ; le front lit ce champ (`transferSourceCodes` de `data/transferCheck.ts`, repli TRA02B) depuis le 10/11. Même valeur dans `meta.transfer_check.sources` et `meta.itineraries_variants.comfort.transfer_check.sources`.
- **`short`** (présent seulement pour `status: short`, dans l'ordre du trajet) : `at` quai de descente, `to` quai de montée (noms du GTFS tels que publiés dans `legs`, tirets longs en tiret simple), `available_s` = départ du tronçon suivant moins arrivée du précédent (secondes du GTFS, toujours plus petit que `min_s`), `min_s` = minimum, `source` = `gtfs` ou `navitia`. Les heures sont celles des tronçons (`legs`) : non répétées.
- **`unverified`** (présent si > 0) : nombre de correspondances sans minimum connu (ni ligne `transfers.txt`, ni durée Navitia).
- **`bound_min`** (présent seulement pour `status: short`) : borne haute de la durée qui respecte les minimums, **sur les mêmes lignes et les mêmes quais** (courses suivantes du GTFS du jour ; aller ramené à la grille de 5 min), en minutes ; `null` avec **`bound_reason`** : `no_run` (aucune course des mêmes lignes ne le permet ; aller : en arrivant avant le début du poste), `over_max` (au-delà de `max_trip_min`), `over_lookback` (aller : départ avant la fenêtre de 120 min). Ce n'est **pas un nouveau calcul** : un autre itinéraire peut être plus rapide (tirage 07j : la borne dépasse Navitia de 10,8 min en médiane).
- **Verdict « à vérifier »** (dérivé par le front, pour **tout budget** de la jauge) : verdict allumé par la matrice (`access/`, aller et retour <= budget) dont un sens est `short` avec `bound_min` `null` ou supérieur au budget. Même règle que 07h ; 06t et 07 recomptent les verdicts à 30, 45 et 60 min et les comparent au résumé de 07h (`by_day`). « À vérifier » n'est pas « faux » : le texte doit le dire. Aucun champ `transfer_risk` n'est publié (la borne suffit, et un budget continu ne se réduit pas aux trois repères).
- **Non couvert** : horaires libres et destinations commune par commune (aucun itinéraire, donc aucun contrôle ; le front le dit), vélo + TC, comparaison (le réglage de marche « confort » est couvert depuis le 04/11 : `itineraries_walk1000/`, annonce `meta.itineraries_variants.comfort.transfer_check`). En commune par commune avec les horaires d'une journée-type, la marque porte sur l'exemple de trajet vers l'arrêt d'ancrage, pas sur le verdict.
- **Poids** (04/11) : +6,4 Mo bruts sur `itineraries/` (68,4 à 74,8 Mo ; 44 829 trajets marqués, 35 992 correspondances trop courtes).

`meta.json` gagne `transfer_check` = le bloc commun des fichiers + `"contract": "itineraries-2"` (écrit par 06t, réécrit par 06 depuis le dossier publié, retiré par `06h --publish`) : le front sait sans charger d'itinéraire si le marquage est publié.

**Ce que fait le front** (04/11, V0, `components/proof/ProofTransferCheck.tsx`, `data/transferCheck.ts`) : dans le panneau de preuve, sous l'itinéraire, un bloc « Correspondances » : une phrase par correspondance trop courte (« Retour : correspondance de 3 min 04 à La Défense : le calculateur d'IDFM en exige 5 min ; ce trajet peut être plus long. »), la borne (« au plus 63 min, au-delà de 60 min »), la source des minimums et la date du contrôle (tags TRA01 / TRA02B en mode provenance, lus dans `meta.transfer_check.sources`) ; si le verdict allumé est à vérifier, une marque textuelle dans l'en-tête (« À vérifier : correspondance plus courte que le minimum d'IDFM ») et la garde « borne pessimiste, à vérifier ne veut pas dire faux ». Jamais sur le ciel.

### Proposé (04/11, NON appliqué) : `crosscheck.json` (recoupement Navitia publié, pour la visite)
Pour que la visite dise les chiffres du calculateur d'IDFM là où il contredit STARWAY (décision de l'équipe du 04/11 pour Versailles) sans écrire de chiffre dans le script : un fichier `crosscheck.json` écrit par 06 depuis `navitia_crosscheck_walk3000_summary.json` (bloc `tour_counts`) : `{ "generated_at", "navitia_last_load_at", "service_date", "walk_setting", "scenarios": { "78358_d09": { "60": { "starway": {"poles": [...], "stars": 8, "jobs": 2936875}, "navitia": {"poles": [...], "stars": 7, "jobs": 2844425}, "only_starway": ["P_VERSAILLES"], "only_navitia": [], "within_one_minute": [] } } }, "trips": [ {insee, pole_id, day, leg, starway_min, navitia_min} ] }`. La visite lirait `navitia.stars` et `navitia.jobs` ; le ciel et la carte gardent les durées STARWAY.

## `alternatives/{insee}.json.gz` et `alternatives/coverage.json` (`alternatives-1`, D-055, définitif le 09/11/2026, le front suit)

Produit par `06w_export_alternatives.py` à partir de `04q`, **rejouable à tout moment sur ce qui est fini** : publication par tranches. Réglage de marche normal dans `alternatives/` ; le réglage « confort » a son propre dossier, `alternatives_comfort/`, même contrat (sous-section « Réglage confort » ci-dessous, préparé le 11/11, non publié). Échantillon réel : `docs/echantillons/alternatives-1/` (`78358.json.gz`, `coverage.json`, `78358.extrait.json` lisible).

**Chemins** : `data/alternatives/coverage.json` (toujours présent quand la fonction est publiée) et `data/alternatives/{insee}.json.gz` (gzip comme `itineraries/`, seulement pour les communes dont au moins un réseau est calculé).

**Accessibilité des trajets B et C (ajout additif du 12/11, D-067)** : chaque tronçon en TC des trajets alternatifs porte le champ `a11y` (mêmes clés que `itineraries/`, TRA03 et TRA04, `starway.needs.annotate_trip`), pour que « Mes réglages » s'applique aux trois trajets. Le reste du fichier est inchangé octet pour octet.

**`coverage.json`** (`alternatives-coverage-1`)

| Champ | Sens |
|---|---|
| `poles`, `days`, `dirs` | ordre des astres, journées (`d06`, `d09`, `d14`), sens (`out`, `ret`) |
| `codes` | `{"a": "calcule_avec_alternatives", "s": "calcule_sans_alternative", "n": "pas_encore_calcule"}` |
| `communes[insee]` | `null` = aucune case calculée pour cette commune ; sinon `{jour: {sens: chaine}}`, une lettre par astre dans l'ordre de `poles` |
| `counts`, `n_communes`, `n_communes_with_file` | compteurs des trois états, pour afficher l'avancement |
| `walk_setting`, `suboptimal_min`, `setting_note`, `comfort_note` | à afficher : la largeur de 15 min est un réglage de l'équipe (exception D-011), le confort n'est pas calculé |

**`{insee}.json.gz`** (`alternatives-1`) : mêmes en-têtes, plus `days.{jour}.{sens}[i]` pour l'astre `poles[i]`, trois journées et deux sens toujours présents.

| Champ de la case | Valeur |
|---|---|
| `state` | l'un des trois états |
| `a_lines` | suite des lignes de A (absent si pas de trajet A). **A se lit dans `itineraries/{insee}.json.gz`**, au même indice : ce fichier ne le répète pas |
| `B`, `C` | `null` si le trajet a les mêmes lignes que A, **ou si A le bat sur son propre critère** (précision du 10/11, sans changement de forme : B et C sont choisis parmi les options qui tiennent les horaires, A parmi toutes ; quand A a un prix connu plus bas, ou le même prix et une durée plus courte, « le moins cher » est A ; idem pour C avec les montées puis la durée) ; `{ "same_as": "B" }` pour C identique à B ; sinon un trajet |
| `status` | seulement quand il n'y a pas de trajet A (`no_trip_in_matrix` : pas de trajet dans la matrice) |

Un trajet a les champs d'`itineraries/` : `dep`, `arr`, `min`, `rides`, `wait_min`, `walk_m`, `legs` (mêmes clés, avec lignes, arrêts, correspondances et faits par ligne), `tickets` (`cost_eur`, `status`, etc., règle D-028), `co2_g` (`value`, `status`). Un prix inconnu n'est jamais retenu en B ; `co2_g.value` peut être `null` avec sa raison.

**Comment le front lit les trois états**

1. Lire `coverage.json`. Une commune à `null`, ou une lettre `n` : afficher « pas encore calculé ». **Ne jamais écrire « pas d'alternative » pour ce cas**, et ne pas charger de fichier de commune pour `null`.
2. Lettre `s` (`calcule_sans_alternative`) : calculé, et aucun autre trajet que A dans la largeur de recherche, ou pas de trajet du tout (`status`). Afficher A seul.
3. Lettre `a` (`calcule_avec_alternatives`) : charger `{insee}.json.gz`, afficher A (depuis `itineraries/`), puis B et C quand ils ne valent pas `null`. Onglets : « Trajet du calcul » (A, depuis le 10/11 : A n'est pas toujours le plus court), « Le moins cher », « Le moins de correspondances » ; le mot « recommandé » n'est pas employé.
4. Lettre `a` ou `s` mais `a_lines` différent des lignes de l'itinéraire publié, `a_lines` présent sans itinéraire publié, ou `status` (pas de A) avec un itinéraire publié : la case est calculée, ses trajets ne sont pas montrés ; le front écrit « Calcul fait, non affiché » avec la raison, **jamais « Pas encore calculé »** (10/11, sans changement de forme).

Contrôle `07` (`check_alternatives`) : couverture = fichiers, trois états stricts, B ou C seulement dans l'état « avec alternatives », aucun contenu dans une case non calculée. Poids du site mesuré à chaque export (alerte à 220 Mo).

**Limites de l'échantillon** : une seule commune (78358, Maisons-Laffitte), palier 1 (sans départs plus tôt), trois journées et deux sens calculés (264 cases sur 339 240, les autres sont `pas_encore_calcule`), GTFS `e990deba` et réseau de nuit `3e38b797`. Tickets et carbone calculés comme à l'export publié, sur ces GTFS. Le `07` complet n'a pas été lancé sur cet échantillon, seul son contrôle de couverture. Publication réelle : phase D, après `archive prete` et l'accord de l'équipe.

### Réglage confort : `alternatives_comfort/` (phase G, préparé le 11/11/2026, NON publié, front écrit le 11/11)

**Changement de contrat** (additif, le dossier normal ne change pas d'un octet) : un second dossier, écrit par `06w_export_alternatives.py --walk-setting comfort` à partir des sorties confort de 04q (au plus 1 km à pied, D-024).

- **Chemins** : `data/alternatives_comfort/coverage.json` et `data/alternatives_comfort/{insee}.json.gz`. Mêmes contrats (`alternatives-coverage-1`, `alternatives-1`), mêmes clés, mêmes trois états, mêmes règles qu'`alternatives/`.
- **En-têtes** : `walk_setting: "comfort"` (couverture et chaque fichier) ; `comfort_note: null` (la note « réglage de marche « confort » non calculé » serait fausse ici ; la clé reste, pour garder les mêmes clés) ; `suboptimal_min` et `setting_note` inchangés.
- **Trajet A de référence** : l'itinéraire confort publié, `{dir}/{insee}.json.gz` avec `dir` = `meta.itineraries_variants.comfort.dir` (aujourd'hui `itineraries_walk1000`, 1 285 communes), au même indice d'astre ; **jamais** `itineraries/` (réglage normal). `a_lines` se compare à cet itinéraire-là.
- **Publication partielle** : comme en normal, une commune sans aucun réseau calculé vaut `null`, un réseau pas encore calculé pour une commune donne des lettres `n` pour ses journées (6h-14h pour le réseau de nuit, 9h-17h et 14h-22h pour le réseau de jour) ; `n_communes_with_file` et `counts` donnent l'avancement. Jamais « pas d'autre trajet » pour une case non calculée.
- **Garde-fous de l'export** : refus (code 2, rien n'est écrit) si un `<réseau>/run_params.json` de la source est absent ou dit un autre réglage, ou si `--out` vise le dossier de l'autre réglage. `07` : même contrôle P0 que pour `alternatives/`, plus `walk_setting: "comfort"` dans la couverture et dans chaque fichier.
- **Départs plus tôt (ajout additif du 11/11, écart de palier 2)** : chaque fichier de commune confort porte `earlier_departures` = `{"d06": bool|null, "d09": bool|null, "d14": bool|null}` : `true` si un palier avec départs plus tôt (`p2` ou `p4`, `alternatives.PALIERS_EARLIER`) est fini dans la source pour le réseau de cette journée (nuit : `d06` ; jour : `d09`, `d14`), `false` si seuls des paliers sans le sont, `null` si ce réseau n'est pas calculé pour la commune. Avec `--normal-src <sources de la phase F>`, 06w écrit aussi `earlier_departures_normal`, même forme, lu dans ces sources. Les deux sont **déduits des fichiers finis de 04q, jamais d'une liste de communes**. Absents de `coverage.json` et de tout le dossier normal `alternatives/` (inchangé d'un octet). `check_published` refuse une forme autre que `{journée: vrai, faux ou null}` sur les journées de la couverture. Front : une ligne au « i » des autres trajets seulement si `earlier_departures[jour] === false` et `earlier_departures_normal[jour] === true` (`earlierDeparturesGap`) ; champ absent ou `null` : rien.

**Ce que fait le front** (11/11, branche `front/alternatifs-confort`, code et tests écrits, contrôles à lancer) :

1. Dossier dérivé du réglage publié dans `meta.walk_settings` : réglage par défaut → `alternatives/`, sinon `alternatives_{id}/` (`alternativesDir`, `alternatives.ts`) ; caches séparés par URL (`loadAlternatives.ts`). Hors défaut, la couverture et le fichier de commune doivent dire `walk_setting` égal à l'identifiant du réglage, sinon ils sont traités comme non publiés (`matchesWalkSetting`).
2. A est l'itinéraire que le panneau a déjà chargé pour le réglage du scénario (`useItineraries(..., walkKey)`, dossier `meta.itineraries_variants.comfort.dir`), jamais `itineraries/` en confort ; `a_lines` se compare à lui (`resolveAlternatives`, inchangé).
3. `proof/TripBlock.tsx` (hook `useAlternatives`, choix du dossier par `alternativesSource`) : en confort, si `alternatives_comfort/coverage.json` est publié et qu'au moins un sens de la case y est calculé (`walkCoverageUsable`), mêmes états et mêmes onglets qu'en normal, et le « i » ajoute « Calculés pour le réglage de marche confort : ... » (libellé publié). Sinon (404, autre réglage, commune à `null` ou lettres `n`) : comportement d'avant, mot pour mot (« Autres trajets : calculés pour le réglage de marche normal. » et le bouton « Voir en réglage normal »). Un sens `n` quand l'autre est calculé : « Pas encore calculé », comme en normal.
4. `comfort_note` est `string | null` ; `null` n'affiche rien. Écart de palier 2 (`earlierDeparturesGap`, 11/11) : le « i » ajoute « Pour cette commune, en réglage confort, les départs plus tôt n'ont pas été cherchés : il peut y avoir moins d'autres trajets qu'en réglage normal. », écrit en clair en mode sources (D-064).
5. `smoke.mjs` tolère le 404 de `data/alternatives_comfort/coverage.json`. Réglage normal inchangé (même URL, aucune exigence nouvelle). Tests : `alternatives.test.ts`, bloc « réglage confort (phase G) ».

## `context/{insee}.json` (halo « Derrière notre étoile » + volet)
```json
{
  "insee": "93066",
  "population_sex": { "source": "GEN04", "year": 2023, "denominator": "population totale", "total": null, "shares": { "F": null, "H": null }, "status": "to_compute" },
  "population_age": { "source": "GEN04", "year": 2023, "bins": ["0-14","15-29","30-44","45-59","60-74","75+"], "shares": [], "status": "to_compute" },
  "commute_mode_by_sex": { "source": "GEN01", "year": 2023, "denominator": "actifs occupés résidents de chaque sexe", "F": { "transit": null, "car": null, "bike": null, "walk": null, "other": null }, "H": {}, "status": "to_compute" },
  "income": { "source": "SOC01", "year": 2023, "median_living_standard_eur": null, "poverty_rate": null, "status": "to_compute" },
  "cost": {
    "transit_month_eur": 90.8, "transit_label": "forfait Navigo Mois toutes zones (1 à 5), tarif plein",
    "transit_source": "COST01 - IDFM, page « Forfait Navigo Mois » : « Tarifs du forfait applicables au 1er janvier 2026 » (instantané du 2026-11-02)",
    "transit_source_url": "https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-mois",
    "transit_scope": "identique pour toutes les communes ; c'est le forfait toutes zones au plein tarif : d'autres forfaits, des tarifs réduits et la prise en charge par l'employeur sont proposés dans « Mes réglages » ; les forfaits deux zones et quelques autres titres ne le sont pas",
    "car_per_trip_eur": null, "car_status": "not_computed", "car_reason": "non estimé (décision D-011) : ...",
    "method": "forfait mensuel publié par IDFM, identique pour toutes les communes (constat, pas un calcul par trajet) ; aucun coût voiture",
    "status": "ok"
  },
  "flows_to_poles": {
    "source": "EMP02", "year": 2023,
    "measure": "actifs occupés de 15 ans ou plus résidant dans la commune et travaillant dans une commune du pôle (RP 2023, exploitation complémentaire)",
    "denominator": "actifs occupés de 15 ans ou plus résidant dans la commune, quel que soit leur lieu de travail (y compris la commune elle-même et hors Île-de-France)",
    "actifs_occupes": 8991, "unit": "%",
    "poles": {
      "P_DEFENSE": { "flux": 483, "share_pct": 5.4, "precision": "ok" },
      "P_CERGY": { "flux": 10, "share_pct": 0.1, "precision": "order_of_magnitude" },
      "P_X": { "flux": null, "share_pct": null, "precision": "no_flow_in_file" }
    },
    "origin_pole": "P_PARIS_QCA",
    "precision_rule": "INSEE, base « Mobilités professionnelles en 2023 » (page 8998300) : « compte tenu notamment du sondage, les flux faibles (moins de 200) devront être considérés comme des ordres de grandeur »",
    "note": "description des navettes déclarées au recensement ; ne dit rien de la cause ...",
    "status": "ok"
  }
}
```
`status` ∈ `ok` | `to_compute` | `secret` | `small_sample` | `not_available` | `not_computed`. Le front masque tout bloc dont le statut n'est pas `ok`.

`cost` :
- `transit_month_eur` : seul coût publié, le forfait plein toutes zones, avec sa phrase de validité et l'URL de la page IDFM (contrôlées par 05 dans l'instantané COST01).
- `car_per_trip_eur` vaut toujours `null`, avec `car_status: "not_computed"` et `car_reason` : le barème kilométrique fiscal n'est pas un coût de trajet (aucune hypothèse inventée, seule la donnée fait foi). `method` décrit désormais le forfait TC (plus de barème kilométrique). Le front ne montre aucun coût voiture.

`flows_to_poles` (EMP02, panneau de preuve : « N actifs de la commune travaillent déjà dans ce pôle (INSEE, RP 2023) ») :
- `poles` : objet dont les clés sont les `id` de `poles.json`, dans le même ordre, et contient toujours les 15 pôles.
  **44 astres** : le bloc porte les identifiants des **deux** jeux (`context/` est commun aux deux ciels) : les 44 astres (`BE_...`, un par bassin d'emploi, `BE_1107_751xx` pour les 20 arrondissements de Paris) puis les 15 pôles (`P_...`) ; le front lit par identifiant. Le flux d'un astre = somme des flux INSEE vers ses communes (EMP02 donne le lieu de travail à l'arrondissement pour Paris, jamais 75056) ; le lieu de travail hors Île-de-France reste dans le dénominateur, rattaché à aucun astre, jamais réparti. `origin_poles` : liste des pôles et astres auxquels appartient la commune d'origine (un par jeu) ; `origin_pole` : celui du ciel passé à `05 --astres` (défaut 44).
- `flux` : entier (estimation arrondie). `null` + `precision: "no_flow_in_file"` si l'INSEE ne publie aucun flux pour ce couple (le CSV contient l'ensemble des flux estimés) : il n'y a pas de 0 de substitution, et le front n'affiche rien, ou « aucun actif recensé », jamais « 0 ».
- `precision` : `ok` (flux estimé ≥ 200) | `order_of_magnitude` (flux estimé < 200, règle INSEE citée dans `precision_rule`, évaluée sur la valeur non arrondie : un flux publié 200 peut donc être `order_of_magnitude`) | `no_flow_in_file`. Pour `order_of_magnitude`, le front doit écrire « environ N (ordre de grandeur, INSEE) ».
- `share_pct` : part des actifs occupés résidents (`actifs_occupes` = dénominateur). Il ne s'agit pas d'une part de la population.
- `origin_pole` : pôle auquel appartient la commune d'origine (`null` sinon). Dans ce cas, le flux compte aussi les actifs qui travaillent dans leur propre commune.
- Le texte ne présente jamais ce flux comme une cause ou une conséquence de l'accessibilité calculée.

## `insights.json` (découvertes calculées)
Scénarios remarquables détectés automatiquement par le pipeline (`06_export_front.py`). Ils alimentent le panneau « Découvertes » et le choix du cas de la visite guidée.
```json
[
  {
    "id": "eclipse_max",
    "kind": "eclipse",
    "scenario": { "o": "<insee>", "d": "d06", "b": 45, "m": "transit", "vs": null, "compare_day": "d09" },
    "metric": { "jobs_delta": null, "poles_delta": null },
    "rank": 1,
    "robust": true,
    "crosscheck": "confirmed"
  }
]
```
`kind` ∈ `eclipse` (écart entre journées-types) | `territorial_gap` (écart entre deux communes proches ou de profil comparable) | `bike_gain` (gain vélo + TC, aller ET retour) | `late_return` (aller dans le budget, retour hors budget ou aucun retour trouvé). `robust: true` seulement si l'écart tient pour au moins deux budgets. Aucune découverte ne repose, au budget publié, sur un retour non mesuré (`no_stop_within_walk_limit`) : elles sont écartées avant le classement (`meta.insights.excluded`), contrôle 07.

`crosscheck` (depuis le 03/11/2026, **champ ajouté**) : recoupement Navitia de la découverte (`07d`, pôle qui pèse le plus dans son écart, sens TC qui le décident) : `confirmed` (même verdict avec les durées Navitia arrondies à la minute inférieure comme supérieure) | `within_one_minute` (le verdict dépend de l'arrondi à la minute d'une durée Navitia) | `not_checked` (pas de recoupement, ou recoupement périmé). `contradicted` n'apparaît jamais dans `insights.json` : la découverte est écartée (`meta.insights.excluded`, cause `navitia_contradicted`). Le front ne met en avant (contraste du jour, visite) qu'une découverte `confirmed` ; il peut lister les autres avec une mention. Contrôles 07 : P0 aucune publiée contredite et statut fondé ; P1 aucune `not_checked`.

**44 astres (10/11/2026, D-054, décision du 10/11)** : `crosscheck` vient de `07d` (astre qui pèse le plus dans l'écart, trajet vers l'arrêt de l'astre). Une découverte que `07d` dit contredite est revue sur la table commune x commune, sa base réelle (`tools/prim/recoupement_decouvertes_table_10_11.py`, couples de communes de l'astre) : confirmée là, elle est publiée `confirmed` ; contredite là aussi, elle n'est pas publiée, elle figure dans `meta.insights.excluded` (`would_be_id`, `kind`, `scenario`, `cause` = `navitia_contradicted`) et la suivante remonte, jamais ajustée. Le front n'a rien à changer : mêmes valeurs qu'avant.

## `geo/communes.geojson` et `geo/poles.geojson` (carte miroir, plan § 15)
Produits par `scripts/06b_export_geo.py`. Usage **temporaire** (bouton « Voir sur la carte ») : situer physiquement les pôles et l'étoile-guide. Ces contours sont **simplifiés pour le rendu** et ne servent à aucun calcul ; ils ne remplacent jamais la position stable du ciel (`sky`).

GeoJSON (FeatureCollection), coordonnées WGS84 `[lon, lat]` à 4 décimales, **anneaux extérieurs dans le sens horaire** (convention de `d3-geo` : `d3.geoPath` + `d3.geoMercator().fitSize(...)` fonctionne tel quel ; c'est l'inverse de la recommandation RFC 7946, sans effet pour les autres lecteurs). Membres de premier niveau (métadonnées) : `processing_version`, `source`, `coordinates`, `winding`, `rendering` (`method`, `tolerance_m`, `coord_decimals`, `note`, `area_change_median_pct`, `area_change_max_pct`).

`geo/communes.geojson` : 1 285 entités (les 1 265 communes hors Paris + les 20 arrondissements, mêmes codes que `communes.json`), `Polygon` ou `MultiPolygon`.
```json
{ "type": "Feature", "properties": { "insee": "93066", "name": "Saint-Denis" }, "geometry": { "type": "Polygon", "coordinates": [[[2.3311, 48.9373], "..."]] } }
```
`geo/poles.geojson` : 30 entités dans l'ordre de `poles.json`, d'abord les 15 contours, puis les 15 ancrages ; discriminant `properties.kind`.
```json
{ "type": "Feature", "properties": { "kind": "pole_area", "pole_id": "P_DEFENSE", "name": "La Défense", "communes": ["92026", "92050", "92062"] }, "geometry": { "type": "Polygon", "coordinates": ["..."] } }
{ "type": "Feature", "properties": { "kind": "anchor", "pole_id": "P_DEFENSE", "stop_id": "IDFM:71517", "stop_name": "La Défense", "insee": "92062", "departures": 3771, "service_date": "2026-11-17", "method": "arrêt parent le plus desservi le jour de référence dans les communes du pôle (TRA01)" }, "geometry": { "type": "Point", "coordinates": [2.2396, 48.89161] } }
```
- `pole_area` = union des contours simplifiés des communes membres (frontières identiques à celles de `communes.geojson`).
- `anchor` = le point du pôle utilisé par le routage (identique à `poles.json[i].point`) ; `departures` = départs comptés ce jour-là (règle de `docs/methodologie.md` § 3 bis).
- Contrôlé par `07_quality_checks.py` (codes = origines, poids < 600 Ko, ordre et ancrages = `poles.json`, sens des anneaux).

## Table commune x commune (proposée) : `od/index.json` et `od/o/{insee}.bin` (horaires de poste libres, destinations commune par commune)
Jeu **à côté** de `access/` : `access/{insee}.json`, `meta.json` et la visite ne changent pas. Écrit par `scripts/06d_export_od.py` depuis les lots de `04c` ; contrôlé par 07 (« table OD D-019 »). Tant que cette table n'est pas adoptée, le front ne l'affiche qu'en option (ou en développement).

**Ce que le jeu permet** : pour une commune d'origine x, **n'importe quel début de poste S et n'importe quelle fin de poste E** de la grille de 5 min (aucun pas de publication fixé), et chaque commune de destination y :
- aller : départ le plus tardif t de [S - `outbound_lookback_min`, S - `grid.step_min`] tel que t + TT(x vers y, t) <= S (même règle que `access`, `latest_feasible`) ; `dep` = t ;
- retour : TT(y vers x, E) (départ à E, attente comprise) ;
- accessible pour un budget B : aller <= B **et** retour <= B (calculé par le front) ;
- postes : `index.jobs[y]` (EMP01, Flores 2023) ; pôle : `index.pole_of[y]` (index dans `poles.json`, `null` hors pôle).

### `od/index.json` (chargé une fois, environ 50 Ko)
```json
{ "processing_version": "0.1.0", "decision": "D-019 (proposée, non adoptée)", "generated_at": "...",
  "dataset_id": "2026-11-17_dc97ca710c6c", "service_date": "2026-11-17", "complete": false,
  "format": { "name": "SWOD", "version": 1, "path": "o/{insee}.bin", "endianness": "little", "compression": "gzip" },
  "grid": { "first": "03:00", "last": "22:00", "step_min": 5, "n_slots": 229 },
  "starts": { "first": "05:00", "last": "22:05" }, "ends": { "first": "03:00", "last": "22:00" },
  "outbound_lookback_min": 120, "max_trip_min": 120,
  "sentinels": { "253": "not_computed", "254": "origin_not_snapped", "255": "no_trip_within_120" },
  "modes": [ { "id": "transit", "code": 0, "kind": "series" }, { "id": "walk", "code": 1, "kind": "scalar" },
             { "id": "bike", "code": 2, "kind": "scalar" }, { "id": "car", "code": 3, "kind": "scalar" } ],
  "coverage": { "transit": { "origins": 600, "complete": false, "computed": ["75101", "..."] }, "walk": {}, "bike": {}, "car": {} },
  "files": "all",
  "communes": ["75101", "..."], "jobs": [88594, "..."], "pole_of": [0, "...", null],
  "jobs_source": "EMP01, INSEE Flores 2023, postes salariés (arrondissements pour Paris)",
  "poles": [ { "id": "P_PARIS_QCA", "jobs": 835130 } ],
  "self_pair": { "status": "not_measured", "reason": "same_point", "rule": "..." },
  "dest_point_rule": "...", "origin_point_rule": "...",
  "walk_limit": { "status": "not_applied", "limit_m": 2000, "detail": "..." },
  "volume": { "files": 600, "bytes_total": 23876264, "gzip9_bytes_total": 12272525, "published_bytes_total": 12272525, "...": "..." } }
```
- `communes` : ordre des destinations (index utilisé dans les fichiers binaires) = les 1 285 origines triées (arrondissements pour Paris, jamais 75056). `jobs` et `pole_of` sont alignés dessus. Somme de `jobs` = total Flores IDF ; somme par pôle = `poles.json[].jobs` (contrôlé).
- `starts` / `ends` : bornes des S et E calculables (S de `grid.first` + 120 min à `min(grid.last + 5 min, 23:55)` ; E = départs de la grille). Le front ne propose que des multiples de `grid.step_min` dans ces bornes. Poste du jour : E > S. Poste de nuit (fin le lendemain matin, fenêtre légale 21h à 7h) : E < S, lu dans la même table. **Depuis l'ajout du réseau de nuit**, la grille va de 00:00 à 23:55 (288 départs, `starts` de 02:00 à 23:55, `ends` de 00:00 à 23:55) ; avant, 03:00 à 22:00 (229 départs, `starts` de 05:00 à 22:05).
- `time_segments` (présent seulement quand la grille est assemblée de trois tables) : `segments[]` = `{ name: "matin"|"jour"|"soir", from, to, n_slots, source_dir, gtfs_source: "TRA01B"|"TRA01"|"TRA01C", gtfs_sha256 }` (chaque départ vient d'une seule table : matin 00:00 à 06:55 sur le réseau de nuit TRA01B, jour 07:00 à 22:00 sur TRA01, soir 22:05 à 23:55 sur le réseau du soir TRA01C = TRA01B + courses du mercredi parties avant 3h), `rule`, `same_typical_day` (le matin et le soir viennent du même mardi type, le soir avec les courses du mercredi après minuit). Le front ne s'en sert que pour le texte de méthode et la note de source du mode sources (le code de source de chaque plage lue est celui de `gtfs_source`) ; absent des anciens exports.
- `coverage` : par mode, nombre d'origines calculées ; `computed` (liste) seulement si le mode est partiel. `files` : `"all"` ou la liste des origines qui ont un fichier (une origine a un fichier dès qu'elle est calculée en TC). Export partiel (`complete: false`) : le retour vers une destination dont le lot n'est pas calculé vaut 253 (`not_computed`) ; le front affiche « retour non calculé », jamais « aucun retour ».
- `walk_limit.status = "not_applied"` : R5 limite à 2 000 m la marche entre le dernier arrêt et le point d'arrivée. Ici le point d'arrivée est celui d'une commune **dans les deux sens** : un « aucun trajet trouvé » peut venir de cette limite, à l'aller comme au retour. Le marquage `no_stop_within_walk_limit` de `access` n'est pas transposable : le front affiche la phrase générale de « Sources & limites » sur ces verdicts, sans raison par commune.

### `od/o/{insee}.bin` (une origine par fichier, binaire SWOD v1)
Stocké compressé gzip (`format.compression`, -9) : le front teste les deux premiers octets (`1f 8b`) et décompresse avec `DecompressionStream("gzip")` (natif, aucune dépendance) ; sinon il lit directement (cas où le serveur a déjà décodé). Petit-boutiste. Ajouter `".bin": "application/octet-stream"` aux `mimeTypes` de `staticwebapp.config.json` (`/data/*` est déjà exclu du repli de navigation).

| Octets | Champ |
|---|---|
| 0-3 | `"SWOD"` |
| 4 | version (2 depuis l'ajout du réseau de nuit ; 1 reste lue : nombre de plages sur 1 octet) |
| 5 | pas de la grille, min (5) |
| 6-7 | premier départ, minutes depuis minuit (uint16, 180 = 03:00 avant l'ajout du réseau de nuit, 0 = 00:00 depuis) |
| 8-9 | nombre de départs `n_slots` (uint16, 229 avant l'ajout du réseau de nuit, 288 depuis) |
| 10-11 | index de l'origine dans `index.communes` (uint16) |
| 12 | nombre de sections |
| 13 | `max_trip_min` (120) |
| 14-15 | réservé (0) |

Puis, pour chaque section : `mode` (uint8, `index.modes[].code`), `kind` (uint8 : 1 = série, 0 = scalaire), `n` enregistrements (uint16), longueur de la charge utile en octets (uint32), charge utile. Une section n'existe que si le mode est calculé pour cette origine.
- **Scalaire** (`walk`, `bike`, `car`, indépendants de l'heure) : `n` x 4 octets = destination (uint16), aller (uint8), retour (uint8).
- **Série** (`transit`) : pour chaque enregistrement, destination (uint16), puis la série aller TT(x vers y, t) et la série retour TT(y vers x, t), chacune codée `nRuns` (uint8 en version 1, **uint16 en version 2**) puis `nRuns` plages de 2 octets (longueur L, valeur v). Une plage de sentinelle de plus de 255 départs est coupée en plages consécutives de même valeur (L tient sur un octet). Plage `v <= max_trip` : L départs consécutifs **de même arrivée** (le départ i de la plage dure `v - pas x i` minutes) ; `v` = 253, 254, 255 : L départs portant cette sentinelle. La somme des L vaut `n_slots`. Codage **sans perte** des durées mesurées par r5py (aucune durée dérivée) ; les durées de plus de 120 min (121, 122) sont publiées 255, comme dans `access`.
- Valeur d'une minute : 0 à 120 = minutes ; 253 = non calculé ; 254 = point non accroché au réseau ; 255 = aucun trajet en 120 min (`index.sentinels`).
- **Format creux** : un enregistrement n'existe que si au moins une durée (<= 120) existe à l'aller ou au retour, à un départ quelconque de la grille. **Destination absente** = aucune durée dans les deux sens à aucun départ (`no_trip_within_120`), sauf en export partiel pour le retour (voir `coverage`). Mesuré sur les lots 0 à 5 : 74 % des couples orientés (origines de ces lots vers les 1 285 communes) n'ont aucune durée aller à aucun départ.
- **Trajet vers soi-même** (`index.self_pair`) : la commune d'origine n'a **jamais** d'enregistrement. 04c route du centre de gravité de la population de la commune vers ce même point et r5py rend 0 min (mesuré pour les 600 couples x vers x des lots 0 à 5, à tous les départs) : ce n'est pas un temps de trajet. Ses postes ne sont comptés **ni atteints, ni non atteints** : « postes de votre commune : N, trajet non mesuré ». Si la commune appartient à un pôle, ses postes sont la part « non mesurée » de l'astre.

### Lecteur TypeScript de référence
Exécuté par `pipeline/tests/test_od_export.py` (Node 22.6 ou plus, types retirés à la volée) contre le lecteur Python `starway.od_export.parse_file` : toute modification de ce bloc doit garder le test vert.
<!-- swod-reader:begin -->
```ts
// Lecteur SWOD v1 et v2 (D-019, D-040), sans dépendance. v2 : nombre de plages d'une série sur 2 octets.
export type OdReason = "no_trip_within_120" | "origin_not_snapped" | "not_computed";
export interface OdLeg { minutes: number | null; reason: OdReason | null; dep?: number | null }
export interface SwodSection {
  mode: number; // index.modes[].code
  kind: "series" | "scalar";
  dest: Uint16Array; // index dans index.communes, croissants
  out?: Uint8Array; ret?: Uint8Array; // scalaire : minutes ou sentinelle
  outSeries?: Uint8Array[]; retSeries?: Uint8Array[]; // série : valeur au départ k = first + k * step
}
export interface SwodFile {
  origin: number; step: number; first: number; nSlots: number; maxTrip: number;
  sections: Map<number, SwodSection>;
}
const REASONS: Record<number, OdReason> = { 253: "not_computed", 254: "origin_not_snapped", 255: "no_trip_within_120" };

export async function decodeSwodBytes(buf: ArrayBuffer): Promise<SwodFile> {
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    buf = await new Response(stream).arrayBuffer();
  }
  return parseSwod(buf);
}

export async function fetchSwod(url: string): Promise<SwodFile> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return decodeSwodBytes(await res.arrayBuffer());
}

export function parseSwod(buf: ArrayBuffer): SwodFile {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== "SWOD" || (u8[4] !== 1 && u8[4] !== 2)) throw new Error(`fichier SWOD invalide (${magic}, version ${u8[4]})`);
  const version = u8[4];
  const step = u8[5], first = v.getUint16(6, true), nSlots = v.getUint16(8, true), origin = v.getUint16(10, true);
  const nSec = u8[12], maxTrip = u8[13];
  const sections = new Map<number, SwodSection>();
  let p = 16;
  for (let s = 0; s < nSec; s++) {
    const mode = u8[p], kind = u8[p + 1], n = v.getUint16(p + 2, true), len = v.getUint32(p + 4, true);
    p += 8;
    const end = p + len;
    const dest = new Uint16Array(n);
    if (kind === 0) {
      const out = new Uint8Array(n), ret = new Uint8Array(n);
      for (let i = 0; i < n; i++, p += 4) {
        dest[i] = v.getUint16(p, true); out[i] = u8[p + 2]; ret[i] = u8[p + 3];
      }
      sections.set(mode, { mode, kind: "scalar", dest, out, ret });
    } else {
      const outSeries: Uint8Array[] = [], retSeries: Uint8Array[] = [];
      for (let i = 0; i < n; i++) {
        dest[i] = v.getUint16(p, true);
        p += 2;
        for (const target of [outSeries, retSeries]) {
          let nRuns: number;
          if (version === 1) nRuns = u8[p++];
          else { nRuns = v.getUint16(p, true); p += 2; }
          const series = new Uint8Array(nSlots);
          let k = 0;
          for (let r = 0; r < nRuns; r++, p += 2) {
            const L = u8[p], val = u8[p + 1];
            for (let j = 0; j < L; j++) series[k++] = val <= maxTrip ? val - step * j : val;
          }
          if (k !== nSlots) throw new Error(`série de ${k} départs au lieu de ${nSlots}`);
          target.push(series);
        }
      }
      sections.set(mode, { mode, kind: "series", dest, outSeries, retSeries });
    }
    if (p !== end) throw new Error("longueur de section incohérente");
  }
  if (p !== buf.byteLength) throw new Error("octets en trop en fin de fichier");
  return { origin, step, first, nSlots, maxTrip, sections };
}

/** Aller pour un début de poste `start` (minutes depuis minuit) : départ le plus tardif qui arrive à l'heure. */
export function outboundAt(f: SwodFile, series: Uint8Array, start: number, lookback: number): OdLeg {
  const lo = (start - lookback - f.first) / f.step, hi = (start - f.step - f.first) / f.step;
  if (!Number.isInteger(lo) || lo < 0 || hi >= f.nSlots) throw new RangeError(`début de poste ${start} hors plage`);
  for (let k = hi; k >= lo; k--) {
    const val = series[k], dep = f.first + k * f.step;
    if (val <= f.maxTrip && dep + val <= start) return { minutes: val, reason: null, dep };
  }
  for (const sentinel of [253, 254]) {
    let all = true;
    for (let k = lo; k <= hi && all; k++) all = series[k] === sentinel;
    if (all) return { minutes: null, reason: REASONS[sentinel], dep: null };
  }
  return { minutes: null, reason: "no_trip_within_120", dep: null };
}

/** Retour pour une fin de poste `end` : la durée au départ `end` de la série retour. */
export function inboundAt(f: SwodFile, series: Uint8Array, end: number): OdLeg {
  const k = (end - f.first) / f.step;
  if (!Number.isInteger(k) || k < 0 || k >= f.nSlots) throw new RangeError(`fin de poste ${end} hors grille`);
  const val = series[k];
  return val <= f.maxTrip ? { minutes: val, reason: null } : { minutes: null, reason: REASONS[val] ?? "no_trip_within_120" };
}

/** Durée d'un mode sans horaire (section scalaire). */
export function scalarLeg(f: SwodFile, val: number): OdLeg {
  return val <= f.maxTrip ? { minutes: val, reason: null } : { minutes: null, reason: REASONS[val] ?? "no_trip_within_120" };
}
```
<!-- swod-reader:end -->

### Ce que fait le front (agent viz)
1. Charger `od/index.json` une fois ; à chaque origine, `fetchSwod("data/od/" + format.path.replace("{insee}", insee))`. Si l'origine n'est pas dans `files`, « non calculé pour cette commune », ciel neutre.
2. Scénario (S, E, B, mode) : pour chaque enregistrement de la section du mode, aller (`outboundAt(f, outSeries[i], S, index.outbound_lookback_min)` ou `scalarLeg(out[i])`) et retour (`inboundAt(f, retSeries[i], E)` ou `scalarLeg(ret[i])`) ; accessible si les deux minutes sont non nulles et <= B. Une destination absente est non accessible (aucun trajet). Les budgets et la jauge restent ceux de la jauge (`outbound_step_min` à `max_trip_min`).
3. Astres : pour le pôle p, `atteints(p)` = somme des `jobs[y]` accessibles avec `pole_of[y] = p` ; part = `atteints(p) / poles[p].jobs` ; la commune d'origine, si elle est dans p, est la part « non mesurée » (ni atteinte, ni non atteinte). La traduction visuelle d'une part (astre éclairé en partie) est à définir par la DA : **positions et tailles inchangées**. Le cyan ne doit dire « accessible » que pour des postes réellement atteints aller et retour.
4. Compteur : postes atteints dans les pôles, et en option tous les postes d'IDF atteints (`jobs` de toutes les destinations) avec la part hors pôles : choix encore ouvert.
5. Panneau de preuve d'un pôle : la liste de ses communes avec aller (départ `dep` en HH:MM, minutes), retour (minutes) et raison, mêmes textes que `access` (`no_trip_within_120` sens par sens, `not_computed`, `origin_not_snapped`) ; plus la phrase `walk_limit` générale.
6. Vélo + TC (`bike_transit`) : absent de ce jeu (modes asymétriques) ; il reste servi par `access/` aux 3 journées-types.
7. Visite (Léa) et audio : inchangés, ils lisent `access/` (`meta.dataset_id`).

### Mise en œuvre front, phase 1 (03/11, non branchée dans l'app)
Code : `frontend/src/data/od/` (`swod.ts`, `compute.ts`, `shift.ts`, `texts.ts`, `loader.ts`, types dans `types.ts`), store `frontend/src/store/useOdStore.ts`, composant `frontend/src/components/ShiftPicker.tsx`. Le format n'est pas modifié. Points relevés en l'implémentant (à garder en tête côté pipeline) :
- **Lecteur de référence et TypeScript strict** : le bloc `swod-reader` ne compile pas tel quel avec `noUncheckedIndexedAccess` (réglage du front). `swod.ts` en est une copie adaptée (assertions `!`, `fetchSwod(url, init)` pour l'annulation, refus d'un fichier de moins de 16 octets) ; `swod.test.ts` extrait le bloc de ce fichier et vérifie que les deux lecteurs rendent exactement les mêmes séries et les mêmes allers / retours sur l'export partiel. Toute modification du bloc doit garder ce test vert aussi.
- **Bornes utiles des débuts** : `starts.last` = 22:05 est publié, mais avec E > S et `ends.last` = 22:00, aucun poste ne peut commencer après 21:55. Le sélecteur propose donc les débuts de `starts.first` à `min(starts.last, ends.last - pas)` et les fins de `max(ends.first, starts.first + pas)` à `ends.last` (`shiftBounds`, bornes publiées gardées dans `published`).
- **Raison 254** : le texte d'`access` (« point de départ non raccordé au réseau ») serait faux pour une destination non raccordée ; le front écrit « point de départ ou d'arrivée non raccordé au réseau ».
- **Verdict avec un retour 253** : aller dans le budget et retour non calculé = « sans verdict » (`unknown`, postes comptés à part, ni atteints ni non atteints) ; aller hors budget ou aucun aller trouvé = non accessible, retour affiché « retour non calculé (jeu de données partiel) ».
- **Destination absente en export partiel** : retour `not_computed` si la destination n'est pas dans `coverage[mode].computed`, sinon `no_trip_within_120`. Mode absent de `coverage` : retour non calculé, sauf si `complete` vaut `true` (rien n'est supposé).
- **Contrôles faits au chargement** : `format` SWOD v1, en-tête de chaque fichier (`origin`, pas, premier départ, `n_slots`, `max_trip_min`) conforme à l'index et à l'origine demandée ; `checkOdIndex` revérifie l'ordre des pôles contre `poles.json` et la somme des postes par pôle. Un fichier annoncé par `files` mais introuvable est une erreur de publication, pas « non calculé ».

### Mise en œuvre front, phase 2 (03/11, branchée)
Le front lit `od_walk3000/` ou `od_walk1000/` selon le réglage de marche (nom dérivé de `meta.walk_settings.settings[].leg_limit_m`, réglage revérifié dans `index.walk_setting.id`), sert un mode par la table seulement si `index.modes` le contient ET `coverage[mode].complete` vaut true (`odModeReady`), et lit le « jeu partiel » mode par mode (`odModePartial`). Format inchangé.

### Variantes de marche : `od_walk3000/` (« normal ») et `od_walk1000/` (« confort »)
Ajout du 03/11 (le front doit suivre). Même format SWOD v1, même `index.json`, un dossier par réglage de marche (choix de l'équipe, pas une donnée) :

| Dossier | `index.walk_setting.id` | Marche de chaque trajet à pied des TC (accès, sortie) |
|---|---|---|
| `od/` | `r5_default` | sortie limitée à 2 000 m par R5, accès non limité (réglage d'origine de R5) |
| `od_walk3000/` | `normal` | 3 000 m (accès 50 min à 3,6 km/h) |
| `od_walk1000/` | `comfort` | 1 000 m (accès 17 min à 3,6 km/h) |

- Chaque dossier est **autonome** : TC calculés avec le jar R5 du réglage (`04c --walk-setting`, lots `data/interim/od_walk{L}/`), marche / vélo / voiture **identiques** à `od/` (copiés par 06d : ils ne dépendent pas du réglage, vérifié). `index.source_by_mode` dit d'où vient chaque mode.
- Nouveau bloc `walk_setting` dans **tous** les `index.json` (y compris `od/`) : `{ "id", "nature", "limit_m" (variantes), "egress_limit_m", "access_limit_min" (null = non limité), "applies_to": ["transit"], "rule", "r5_jar", "r5_jar_sha256", "r5_version" }`. Le front lit le réglage dans ce bloc, jamais dans le nom du dossier.
- `walk_limit.status` vaut `"setting"` dans une variante (la limite est voulue par le réglage, `detail` la décrit) et reste `"not_applied"` dans `od/`.
- **Choix du dossier par le front** : réglage de marche de l'utilisateur `normal` → `data/od_walk3000/`, `comfort` → `data/od_walk1000/` (défaut du site : `normal`). Vérifier au chargement `index.walk_setting.id` = le réglage demandé et `dataset_id` identique entre dossiers (même GTFS, mêmes points). Changer de réglage recharge l'index et les fichiers d'origine du nouveau dossier (caches séparés par dossier). Si le dossier du réglage est absent ou `coverage.transit.complete` vaut `false`, afficher « réglage non encore calculé pour cette commune » plutôt que de retomber en silence sur `od/`.
- Le ciel ne change pas entre réglages (mêmes positions, tailles, postes) : seuls les verdicts TC changent.
- Volume : chaque dossier pèse à peu près autant que `od/` (la section TC domine) ; trois dossiers doivent tenir ensemble sous la limite du plan Free (250 Mo, 15 000 fichiers) : à mesurer par `06d --measure` sur les tables complètes avant de publier les trois.

#### Publié le 03/11/2026 : TC complet, marche / vélo / voiture non encore exportés (le front doit suivre)
- `frontend/public/data/od_walk3000/` (« normal », défaut) et `od_walk1000/` (« confort ») : TC **complet** (1 285 origines x 1 285 destinations, 229 départs), `files: "all"`. Écrits par `06d --walk-setting {normal|comfort} --transit-only` : la table de base `od/` (marche, vélo, voiture) était encore en calcul.
- `index.modes` ne contient que `transit` ; aucune section marche / vélo / voiture dans les fichiers. `index.coverage` annonce **les quatre modes** : `transit` `{ "origins": 1285, "complete": true }` ; `walk`, `bike`, `car` `{ "origins": 0, "complete": false, "computed": [], "status": "not_computed", "reason": "..." }`. Aucune valeur n'est publiée pour ces modes (ni 0, ni estimation).
- `index.complete` vaut donc `false` (il dit « les quatre modes complets »). **Complétude d'un mode = `coverage[mode].complete`**, jamais `index.complete` : le TC de ces dossiers est complet, il ne contient aucune valeur 253 et ne doit pas être présenté comme « jeu partiel ». Mode absent de `index.modes` : « mode non encore calculé pour ce jeu » (ou repli sur `access/` aux journées-types), jamais « aucun trajet ».
- `od/` (réglage d'origine de R5) n'est **pas** publié : le front n'en a pas besoin (réglage par défaut « normal »).
- Quand `od/` sera complète, le même dossier est réécrit avec les quatre modes (`06d --walk-setting normal`, puis `comfort`, sans `--transit-only`) : `index.modes` aura 4 entrées, `complete: true`, `source_by_mode` dira `od/` pour marche, vélo, voiture. Aucun autre champ ne change.

## `subscriptions.json` (publié le 04/11/2026 en V0) : abonnements et coût du trajet pour la personne
Écrit par `scripts/06i_export_subscriptions.py` (catalogue `starway/subscription_catalog.py`, calcul `starway/subscriptions.py`), contrôlé par 07 (P0 « abonnements D-032 »). Fichier **à part** de `meta.json` (47 Ko, 10 Ko compressé), chargé une fois par le front ; absent (404) : la zone « Mes abonnements » et le bloc « Selon vos abonnements » ne s'affichent pas. Le ciel ne dépend jamais de ce fichier.
```json
{ "contract": "subscriptions-1", "processing_version": "0.1.0", "decision": "D-032 (proposée)", "generated_at": "...",
  "service_date": "2026-11-17", "price_validity": "tarifs IDFM au 1er janvier 2026 ; Vélib' : ...",
  "families": { "rail": "...", "surface": "...", "ter": "...", "airport_rail": "...", "orlyval": "..." },
  "transit": {
    "options": [ { "id": "navigo_month", "label": "Navigo Mois", "kind": "pass", "audience": "all", "zones": "1-5",
                   "price": { "eur": 90.8, "per": "month", "text": "90,80 € par mois, toutes zones",
                              "record": { "source_id": "SUB01", "file": "SUB01/titres-et-tarifs.json", "record": "Forfait Navigo Mois", "field": "price", "value": "90,80€", "period": "par mois" },
                              "quotes": [ { "source_id": "COST01", "file": "COST01/forfait-navigo-mois.html", "quote": "Tarifs du forfait applicables au 1er janvier 2026." } ] },
                   "covers": { "rail": "yes", "surface": "yes", "ter": "yes", "airport_rail": "yes", "orlyval": "no" },
                   "unknown_reasons": {}, "cover_quotes": [ "..." ],
                   "employer": true, "bike_parking": false, "conditions": null } ],
    "extra_titles": { "orlyval_ticket": { "label": "Ticket Orlyval", "eur": 14.0, "quote": {} },
                      "airport_ticket": { "label": "Ticket Paris Région <> Aéroports", "eur": 14.0, "quote": {} } },
    "unit_tickets": { "metro_train_rer": { "label": "Ticket Métro-Train-RER", "eur": 2.55, "quote": {} },
                      "bus_tram": { "label": "Ticket Bus-Tram", "eur": 2.05, "quote": {} },
                      "airport": { "label": "Ticket Paris Région <> Aéroports", "eur": 14.0, "quote": {} } },   // 12/11 : prix à l'unité (COST02), mêmes montants que fares_carbon.TICKET_PRICES_EUR ; part de chaque ticket dans le coût d'un sens
    "unpriced_agencies": { "Magical Shuttle": "navette Magical Shuttle (...) : coût non calculé" },
    "not_proposed": [ { "id": "navigo_zones", "label": "...", "reason": "phrase affichable", "quotes": [] } ],
    "dataset": { "source_id": "SUB01", "licence": "Licence Ouverte v2.0 (Etalab)", "modified": "2026-11-03T19:00:31+00:00" } },
  "velib": {
    "offers": [ { "id": "v_plus", "label": "V-Plus", "kind": "subscription", "audience": "all",
                  "price": { "eur": 4.3, "per": "month", "text": "...", "variants": [ { "label": "Jeune", "eur": 3.22 } ] },
                  "ride": { "included_min": 30, "step_min": 30, "per_ride_eur": 0.0, "beyond_eur": 1.0, "cap_eur": 18.0 },
                  "quotes": [], "employer": true } ],
    "rides": { "75101": { "out": [12, null, "..."], "ret": [13, null, "..."] } },
    "rides_rule": "..." },
  "bike": { "personal": { "text": "..." }, "parking": { "text": "...", "scope": "...", "without": "...", "options": ["navigo_annual"] } },
  "car": { "options": [], "status": "not_proposed", "reason": "..." },
  "employer": { "text": "...", "scope": "...", "to_verify": "...", "quotes": [] },
  "texts": { "no_subscription": "hors abonnement", "ticket_scope": "...", "never_divided": "...", "velib_ride": "...", "would_cover": "..." } }
```
(valeurs de l'exemple : format seulement)
- **Options TC** : `kind` = `pass` (abonnement : son prix n'est jamais ajouté à un aller-retour ni divisé) ou `day` (titre d'une journée : son prix s'ajoute une fois à l'aller-retour) ; `audience` = `all` ou `conditions` (`conditions` : phrase à afficher) ; `price.eur` peut valoir `null` avec `price.reason` (Améthyste : prix fixé par le département) ; `covers` : `yes` / `no` / `unknown` pour chacune des 5 familles, `unknown_reasons[famille]` : phrase affichable.
- **Citations** : tout objet `{ source_id, file, quote }` est une phrase recopiée d'un fichier gardé (`data/raw/<file>`), retrouvée par 07 ; un PDF porte aussi `sha256` et `read_with`.
- **Calcul (front = pipeline)** : `transitLegCost(trip, option, extra_titles, unpriced_agencies)` sur un sens de `itineraries/{insee}.json` (`status`, `legs[].m`, `legs[].line`, `legs[].agency`, `tickets`) : statut `no_trip`, `unknown` (`extra_eur` null + `reasons`), `tickets` (sans abonnement : `tickets.cost_eur`), `included` (0) ou `extra` (`items` : titres en plus) ; `transitRoundTrip` ; Vélib' : `velibRideCost(rides[insee][leg][i], offer)` (tranches de 30 min au-delà de `included_min`, `beyond_eur` null : non calculé avec `beyond_reason`). Code : `frontend/src/data/subscriptions.ts`, cas de test partagés `frontend/src/data/subscriptionCases.json`.
- **`velib.rides`** : pour chaque commune de `meta.mode_coverage.velib`, durée en minutes entières (arrondi inférieur de R5) de la partie vélo du trajet Vélib' publié, alignée sur `poles.json` ; `null` si et seulement si `access/{insee}.json` `modes.velib.any` vaut `null` pour ce sens.
- **Affichage** (V0) : panneau de preuve seulement (bloc « Selon vos abonnements » sous « Coût ») et dialogue « Mes abonnements » (barre du haut) ; réglage mémorisé dans `localStorage` (`starway.subscriptions`), hors URL et hors visite.

## `service_public.json` et `service_public_offres.json` (publiés le 05/11/2026) : offres diffusées sur Choisir le service public
Produits par `scripts/06q_export_service_public.py` (EMP04, GEO01 pour les codes postaux). **Offres diffusées, jamais « postes ouverts »**, jamais mêlées aux postes salariés recensés par l'INSEE : ni `poles.json` ni `meta.json` ne les citent, le ciel ne les lit pas. Le front lit ces deux fichiers à part (absents, HTML ou autre contrat : « non disponible », aucune valeur).
```jsonc
// service_public.json (contrat « service-public-1 », environ 20 Ko)
{ "contract": "service-public-1", "processing_version": "0.1.0", "generated_at": "...", "source_id": "EMP04",
  "as_of": "2026-10-11",                       // date du fichier (son nom) : « offres diffusées au 11/10/2026 »
  "file": { "name": "offres-datagouv-20261011.csv", "sha256": "...", "extracted_at": "2026-11-05T11:01Z" },
  "method": "...",                             // phrase affichée en mode sources (D-033), avec la source
  "metadata_gap": { "fiche_temporal_coverage": { "start": "2021-01-01", "end": "2023-12-31" },
                    "first_publication_min": "2021-06-23", "first_publication_max": "2026-10-10", "note": "..." },
  "versants": { "FPE": "Fonction Publique de l'Etat", "FPT": "...", "FPH": "...", "n/c": "Versant non renseigné dans le fichier" },
  "counts": { "file_rows": 0, "file_rows_without_publication_dates": 0, "online_rows": 0, "online_references": 0,
              "online_open_ended_rows": 0, "online_outside_idf_rows": 0, "online_outside_idf_with_idf_postal_code_rows": 0 },
  "region": { "offers": 0, "commune": 0, "departement": 0,              // offers = commune + departement
              "departement_reasons": { "cp_cedex_ou_inconnu": 0, "cp_absent": 0, "...": 0 },
              "commune_how": { "cp_et_nom": 0, "cp_seul": 0 }, "versants": { "FPT": 0 } },
  "departements": { "75": { "name": "Paris", "offers": 0, "commune": 0, "departement": 0 } },   // 8 départements d'Île-de-France
  "communes": { "75101": { "n": 0, "v": { "FPT": 0, "FPE": 0 } } },  // seulement les communes qui portent au moins une offre rattachée
  "offers_file": "service_public_offres.json" }
// service_public_offres.json (contrat « service-public-offres-1 », environ 890 Ko, chargé à l'ouverture du pli « Voir les offres »)
{ "contract": "service-public-offres-1", "as_of": "2026-10-11", "fields": { "r": "...", "t": "...", "v": "...", "e": "...", "d": "...", "f": "..." },
  "link": "https://choisirleservicepublic.gouv.fr/offre-emploi/offre-reference-{r}/",
  "employers": ["Communes", "..."],                                   // organisme de rattachement du fichier
  "communes": { "75101": [ { "r": "référence", "t": "intitulé", "v": "FPT", "e": 0, "d": "AAAA-MM-JJ", "f": "AAAA-MM-JJ ou null (sans fin)" } ] } }
```
- **« En ligne »** : début de publication <= `as_of` <= fin de publication (dates « par défaut » du fichier), une offre par référence. Les lignes sans date ne sont pas comptées (`file_rows_without_publication_dates`).
- **Rattachement** : la clé est la commune (`communes` du fichier = `poles[].communes`, 44 astres et ancien jeu de 15 pôles). Une offre connue seulement au département n'est que dans `region` et `departements` : **jamais répartie** entre astres ni listée par commune. `region.offers` = `region.commune` + `region.departement` ; la somme des `communes[].n` = `region.commune` ; la liste a autant d'offres que `n` par commune (contrôlé par 07).
- **Champs publiés** : ni adresse, ni contact, ni compétences (contrôlé : aucune adresse électronique, aucun lien, aucun téléphone dans les intitulés). Les tirets longs du texte source sont écrits « - ».
- **Front** : `frontend/src/data/publicOffers.ts` (gardes `isPublicOffersFile`, `isPublicOffersList`, `astreOffers`), `components/proof/ProofPublicOffers.tsx`.

## `bmo.json` et `bmo_metiers.json` (publié le 04/11/2026 en V0) : projets de recrutement BMO par bassin d'emploi
Écrits par `scripts/06j_export_bmo.py` (`starway/bmo.py`), contrôlés par 07 (P0 « projets de recrutement BMO D-035 »). Fichiers **à part** de `meta.json` (non modifié) : le front charge `bmo.json` (23 Ko) à l'ouverture du bloc d'un astre rattaché à un bassin ; absent (404) ou page HTML de repli : le bloc dit « non disponible », jamais une valeur. Le ciel ne dépend jamais de ces fichiers. **Ce sont des intentions de recrutement déclarées par les employeurs (une tendance du bassin), pas des offres, pas des embauches, pas des postes salariés recensés par l'INSEE.**
```json
{ "contract": "bmo-1", "processing_version": "0.1.0", "decision": "D-035", "generated_at": "...", "year": 2026,
  "what": "projets de recrutement déclarés par les employeurs pour 2026 (...)", "sources": ["EMP03 - ...", "GEO04 - ..."],
  "unit": "...", "masked_rule": "case « * » de France Travail : non diffusée, non comptée ; ...", "geography": "...",
  "masked": { "symbol": "*", "label": "non diffusé par France Travail (vraisemblablement moins de 5 projets)",
              "status": "déduction de l'équipe : ...", "note": "Déduction de l'équipe : aucune valeur publiée n'est inférieure à 5 sur les 53 786 lignes ...",
              "evidence": { "rows": 53786, "scope": "...", "measures": ["met", "xmet", "smet"], "min_published": { "met": 5, "xmet": 5, "smet": 5 }, "published_below_threshold": 0, "threshold": 5 } },
  "families": [ { "code": "V", "label": "Fonctions liées à la vente, au tourisme et aux services" } ],
  "region": { "published": { "met": { "n": 386835, "masked": 645 }, "xmet": { "n": 0, "masked": 0 }, "smet": { "n": 0, "masked": 0 } },
             "official": { "source_id": "EMP03", "table": "Tableau 5 (...)", "page": 18, "projects": 388806 } },
  "bassins": { "1146": { "name": "T4 Paris Ouest La Défense",
                         "total": { "met": { "n": 32926, "masked": 22 }, "xmet": { "n": 0, "masked": 0 }, "smet": { "n": 0, "masked": 0 } },
                         "families": { "V": { "met": { "n": 0, "masked": 0 }, "xmet": {}, "smet": {} } } } } }
```
(valeurs de l'exemple : format seulement ; `xmet` et `smet` ont la même forme que `met`)
- **Clé** : code du bassin d'emploi France Travail 2026 (`BE26` du classeur = `code_bassin_2026` de GEO04) = `bassin.code` des astres de `poles.json` (jeu des 44 astres). Les 20 arrondissements de Paris portent le même code (`1107`) : le front annonce un bloc commun. Un astre sans `bassin` (ancien jeu de 15 pôles, `astres15/poles.json`) n'a **aucune donnée** : « non disponible pour cet astre ».
- **Mesures** : `met` projets de recrutement, `xmet` projets jugés difficiles, `smet` projets saisonniers. `{ n, masked }` : `n` somme des cases publiées par France Travail (**null** si aucune case n'est publiée : le front écrit « non diffusé », jamais 0) ; `masked` nombre de cases « * » (non diffusées) absentes de la somme. **`masked` > 0 : `n` est un minimum, le front écrit « au moins n »** et ne calcule jamais de part ni de total avec ces sommes.
- **`masked`** (ajout du 05/11, additif, le front le **exige** : un `bmo.json` sans lui est refusé) : `label` (texte affiché pour « * », écrit par le pipeline, lu tel quel par le front), `note` (« Déduction de l'équipe » : le sens de « * » n'est pas défini par la source), `evidence` (preuve chiffrée recalculée sur TOUTES les lignes du classeur : `rows` 53 786, plus petite valeur publiée de `met`, `xmet`, `smet` = 5, aucune valeur sous `threshold` 5). 06j et 07 échouent si une valeur publiée tombe sous le seuil.
- **Familles** : 8 (A, C, I, O, S, T, V, Z), dans l'ordre des projets publiés décroissants en Île-de-France ; libellés de France Travail recopiés. Une famille absente d'un bassin n'a pas d'entrée (le front : « non publié »).
- **`region.official`** : total officiel d'Île-de-France recopié du PDF ES 87 (tableau 5, page 18), vérifié par 06j et 07 (empreinte du PDF et ligne de la page) ; supérieur à `region.published.met.n` (écart non expliqué par la documentation).
- **`bmo_metiers.json`** (`bmo-metiers-1`, 118 Ko, chargé à la demande, **non lu par le front en V0**, prévu pour l'étape recrutement de la visite, désactivée) : `metiers: [{ code, name, family }]` (216, codes FAP/BMO) et `bassins[code_bassin][code_metier] = [met, met_masked, xmet, xmet_masked, smet, smet_masked]` ; mêmes règles (`null` = aucune case publiée). Les sommes par bassin recoupent `bmo.json` (contrôle 07). Exemple de la visite : `bassins["1107"]["S1X20"]` = 6 973 projets, dont 1 815 jugés difficiles.
- **Contrôles (07)** : empreintes du classeur et du PDF = manifeste ; fichiers = recalcul sur le classeur ; total = somme des familles ; détail par métier = totaux ; chaque astre à bassin retrouve ses données au libellé GEO04 ; somme publiée ≤ total officiel ; aucun tiret long.
- **Affichage** (V0) : panneau de preuve seulement, bloc « Projets de recrutement du bassin » (`components/recruit/ProofRecruit.tsx`), filtre par famille sans effet sur le ciel ni sur les compteurs de postes ; source (EMP03, GEO04) seulement quand le mode sources est actif (coupé par défaut).

## `sources.json`
Export de `data/sources_manifest.csv` (sans `fichier_local` ni `sha256`), affiché dans la page « Sources & limites ».
