# Limite de marche finale de R5 (2 km) : impact sur les verdicts « aucun retour »

Analyse du 03/11/2026 (chantier G du plan de dépôt). Lecture et analyse seulement : ni r5py ni Java n'ont été relancés, la matrice, `frontend/` et `insights.json` ne sont pas modifiés. Script : `pipeline/scripts/07b_egress_limit_analysis.py` (logique pure dans `pipeline/starway/egress.py`, tests dans `pipeline/tests/test_egress.py`).

## 1. Mécanisme (confirmé dans le code de R5)

Source : code de R5 au tag `v7.5.1-r5py` du dépôt `r5py/r5` sur GitHub (fork de `conveyal/r5` utilisé par r5py pour publier `r5-v7.5.1-r5py-all.jar`), lu le 03/11/2026, et recoupé par `javap -c` sur le jar installé (`%LOCALAPPDATA%/r5py/r5-v7.5.1-r5py-all.jar`, JDK de `.tools/jdk-21`).

| Où | Ce qu'on lit | Effet |
|---|---|---|
| `com/conveyal/r5/transit/TransitLayer.java` l. 69-81 | `/** Maximum distance to record in distance tables, in meters. */ public static final int WALK_DISTANCE_LIMIT_METERS = 2000;` puis `TRANSFER_DISTANCE_LIMIT_METERS = 1000` et `PARKRIDE_DISTANCE_LIMIT_METERS = 500` | constantes |
| `TransitLayer.buildOneDistanceTable(int stop)` l. 586-598 | `router.distanceLimitMeters = WALK_DISTANCE_LIMIT_METERS;` et `router.quantityToMinimize = ...DISTANCE_MILLIMETERS;` ; bytecode : `sipush 2000` puis `putfield StreetRouter.distanceLimitMeters` | depuis **chaque arrêt**, la table des distances à pied vers les sommets du réseau s'arrête à 2 000 m (distance sur le réseau, pas à vol d'oiseau) |
| `com/conveyal/r5/streets/EgressCostTable.java` l. 172-173 et 264-271 | `if (streetMode == StreetMode.WALK) { linkingDistanceLimitMeters = WALK_DISTANCE_LIMIT_METERS; }` puis, en marche, la table arrêt vers points de destination est **prolongée** depuis la table ci-dessus (`linkedPointSet.extendDistanceTableToPoints(distanceTableToVertices, envelopeAroundStop)`) ; bytecode : `sipush 2000` (marche), `sipush 5000` (`BICYCLE_DISTANCE_LINKING_LIMIT_METERS`) | la **sortie** d'un trajet en TC (dernier arrêt vers le point d'arrivée) ne peut dépasser environ 2 000 m de marche ; un point d'arrivée plus loin de tout arrêt n'a aucune entrée dans la table |
| `com/conveyal/r5/profile/PerTargetPropagater.java` l. 351-383 | la propagation vers chaque destination ne parcourt que `egressCostTable.getCostTableForPoint(targetIndex)` (les arrêts de la table), puis compare le temps de marche à `request.getMaxTimeSeconds(streetMode)` | aucun autre chemin TC n'atteint la destination |
| `com/conveyal/r5/analyst/TravelTimeComputer.java` l. 156-163 | accès : `limitSeconds = request.maxTripDurationMinutes * 60` puis `Math.min(limitSeconds, request.getMaxTimeSeconds(accessMode))` ; `sr.timeLimitSeconds = limitSeconds` (aucune limite de distance) | l'**accès** depuis le point de départ n'est limité qu'en **temps** |
| r5py 1.1.7, `r5py/r5/regional_task.py` l. 141-143 et 417-420 | `self.max_time_walking = max_time_walking if max_time_walking is not None else max_time` puis `self._regional_task.maxWalkTime = ...` | `max_time_walking` n'est pas fixé par STARWAY, il vaut `max_time` = 120 min : l'accès peut aller jusqu'à 120 min de marche (7,2 km à 3,6 km/h) |

Conséquences pour la matrice actuelle (mode `transit` : accès et sortie à pied, `pipeline/starway/routing.py`, `MODE_LEGS`) :
- **Aller** (point de la commune vers l'arrêt d'ancrage du pôle) : l'accès depuis la commune n'a pas de limite de distance (120 min) ; la sortie se fait vers l'arrêt d'ancrage, desservi par construction (arrêt le plus desservi du pôle), donc sans marche finale. **L'aller n'est pas concerné en pratique.**
- **Retour** (arrêt d'ancrage vers le point de la commune, centre de gravité de la population) : l'accès depuis l'arrêt d'ancrage est limité en temps seulement ; la **sortie vers le point de la commune est limitée à 2 000 m de marche sur le réseau**. Si aucun arrêt où l'on peut descendre dans la fenêtre n'est à moins de 2 000 m du point, aucun trajet TC n'est trouvé ; il ne reste que le trajet tout à pied (direct, limité à 120 min).
- **Asymétrie** : à l'aller, une commune peut rejoindre à pied une gare à 3 km ; au retour, non. Les correspondances à pied sont limitées à 1 000 m dans les deux sens.
- Avec la table commune par commune (destinations = points des communes), la même limite s'appliquerait **aussi à l'aller** (point de la commune de destination), donc à tous les trajets.
- **Itinéraires détaillés** (`r5py.DetailedItineraries`, prévus pour recouper les trajets du récit) : leur routeur, `profile/McRaptorSuboptimalPathProfileRouter.java` l. 245 au même tag, fixe `streetRouter.distanceLimitMeters = TransitLayer.WALK_DISTANCE_LIMIT_METERS; // FIXME arbitrary, ...` pour la recherche d'**accès**. Un itinéraire détaillé peut donc ne pas retrouver un aller de la matrice qui commence par plus de 2 km de marche. Non vérifié par un calcul (r5py interdit pour cette tâche).

## 2. Méthode

Pour chaque commune (centre de gravité de la population, `origin_lon` / `origin_lat` de `data/processed/communes_idf_2026.csv`, non accroché au réseau) et chaque fin de poste E (14:00, 17:00, 22:00, mardi 17/11/2026) :
1. **Quais desservis** : quais GTFS (`location_type` 0) où une course active ce jour-là (`calendar` + `calendar_dates`, fonction `starway.gtfs.active_trip_ids`) permet de **descendre** avec une heure d'arrivée dans [E, E + 120 min]. Règle de descente de R5 (`TripPattern`, `PickDropType`) : seul `drop_off_type` = 1 l'interdit (2 et 3, sur réservation, sont acceptés par R5). Lignes sans heure (transport à la demande à fenêtre) ignorées. `stop_times.txt` (8 598 293 lignes, 139 563 courses actives) lu par morceaux d'un million de lignes, mémoire libre vérifiée avant chaque lecture lourde.
2. **Distance à vol d'oiseau** (Lambert-93, EPSG:2154) du point de la commune au plus proche de ces quais.
3. **Verdicts publiés** : `frontend/public/data/access/{insee}.json`, mode `transit`, valeurs `ret` nulles (raison `no_trip_within_120`). Les chiffres de départ sont retrouvés : 533 communes sans aucun retour à 14h, 329 à 17h, 741 à 22h.
4. **Classement** des verdicts « retour nul » d'une commune et d'une fin de poste :
   - **A** « arrêt desservi à moins de 2 km » : la limite n'explique pas tout (mais un détour du réseau peut porter la marche réelle au-delà de 2 km, voir § 4) ;
   - **B** « plus proche arrêt desservi entre 2 km et 7,2 km » : **suspect**, R5 ne pouvait trouver aucun retour en TC ;
   - **C** « aucun arrêt desservi à moins de 7,2 km » : robuste vis-à-vis de la limite.
   - X = 7,2 km est **dérivé** : distance parcourue à pied en `MAX_TRIP_MIN` = 120 min (horizon de recherche) à `SPEED_WALKING_KMH` = 3,6 km/h (vitesse du calcul, valeur par défaut de r5py). Aucun retour plus long n'est publié.
5. **Indice relais** (sans nouveau calcul de trajet) : pour un pôle p et une commune c, `relais = min sur c' ≠ c de [ret(p, c') + distance à vol d'oiseau(c', c) / 3,6 km/h]`, avec les retours publiés vers les autres communes. Si l'indice est fini alors que R5 n'a rien trouvé pour c, le trajet relais finit forcément par plus de 2 000 m de marche depuis son dernier arrêt (sinon R5 l'aurait trouvé). Ce n'est **ni un minorant ni un majorant** : la marche à vol d'oiseau est optimiste, le détour par le point de c' est pessimiste. Contrôle : sur les retours publiés, l'indice n'est plus court que dans 80 cas sur 7 729 à 14h, 73 sur 10 066 à 17h et 109 sur 5 018 à 22h (écart médian 4 à 6 min) : il est rarement optimiste.
6. **Réseau piéton** (échantillon) : voir § 4.

Contrôle du mécanisme : pour toute commune à 2 km ou plus (vol d'oiseau, donc aussi par le réseau) de tout quai desservi, un retour publié devrait être le trajet tout à pied. Résultat : **0 exception** sur les trois journées-types (aucune de ces communes n'a de retour publié différent du retour à pied, et aucune n'a de retour publié du tout). Les données sont donc cohérentes avec le mécanisme lu dans le code.

## 3. Chiffres par journée-type

Couples = (commune, pôle) ; 1 285 communes x 15 pôles = 19 275 couples par journée-type.

| Fin de poste | Catégorie | Communes | Couples ret nul | dont aller trouvé | Communes sans aucun retour | Population de ces communes |
|---|---|---|---|---|---|---|
| 14:00 (d06) | A, arrêt desservi à moins de 2 km | 1 034 | 7 781 | 113 | 282 | 308 973 |
| | **B, entre 2 et 7,2 km (suspect)** | **220** | **3 300** | 12 | **220** | 123 284 |
| | C, aucun arrêt à moins de 7,2 km | 31 | 465 | 0 | 31 | 13 321 |
| 17:00 (d09) | A | 1 281 | 9 149 | 1 174 | 325 | 260 619 |
| | **B (suspect)** | **4** | **60** | 0 | **4** | 1 642 |
| | C | 0 | 0 | 0 | 0 | 0 |
| 22:00 (d14) | A | 725 | 5 857 | 2 200 | 181 | 475 103 |
| | **B (suspect)** | **437** | **6 555** | 494 | **437** | 385 132 |
| | C | 123 | 1 845 | 15 | 123 | 86 013 |

Population : INSEE (colonne `population` de `communes_idf_2026.csv`), pour situer l'ampleur ; ce n'est pas le nombre de personnes concernées par un horaire.

Lecture : **à 22h, 437 des 741 communes sans aucun retour (59 %) n'ont aucun quai desservi à moins de 2 km de leur point** ; pour elles, l'absence de retour est une conséquence mécanique du moteur, pas une mesure de la desserte. À 14h, c'est 220 sur 533 ; à 17h, 4 sur 329. Dans la catégorie A, un retour nul peut venir d'une vraie absence de correspondance, d'un trajet de plus de 120 min, ou d'une marche réelle de plus de 2 km vers le seul arrêt utile (cas du Mesnil-le-Roi, § 5).

Indice relais (§ 2, point 5) :

| Fin de poste | Couples ret nul | Indice relais ≤ 120 min | dont A / B | Communes sans aucun retour avec au moins un indice ≤ 120 min |
|---|---|---|---|---|
| 14:00 | 11 546 | 176 | 154 / 22 | 55 (41 A, 14 B) |
| 17:00 | 9 209 | 62 | 62 / 0 | 16 (16 A) |
| 22:00 | 14 257 | 305 | 214 / 91 | 107 (46 A, 61 B) |

Effet possible sur l'accessibilité (aller ≤ budget, retour publié nul ou > budget, indice relais ≤ budget), en couples :

| Budget | 14:00 | 17:00 | 22:00 |
|---|---|---|---|
| 30, 45 min | 0 | 0 | 0 |
| 60 min | 0 | 0 | 2 (retours publiés de plus de 60 min, aucun retour nul) |
| 75 min | 1 | 2 | 7 |
| 90 min | 5 | 4 | 40 |
| 105 min | 26 | 23 | 103 |
| 120 min | 47 | 40 | 257 (123 communes) |

Lecture : aux budgets des découvertes (30, 45, 60 min), l'indice ne fait basculer **aucun** verdict « retour nul » : une marche de plus de 2 km coûte déjà plus de 33 min à 3,6 km/h. Avec la jauge continue (jusqu'à 120 min), des verdicts peuvent changer au-delà de 75 min, surtout à 22h. L'indice ne voit que les trajets qui passent près du point d'une autre commune : il peut manquer des retours (par exemple une gare entre deux communes, loin des deux points).

## 4. Réseau piéton (échantillon)

La distance à vol d'oiseau sous-estime la marche réelle. Option `--network` de 07b : distance sur un **réseau piéton OSM approché**, construit en Python à partir de la couche `lines` du pbf Geofabrik (CYC01) lue par le pilote GDAL OSM (pyogrio) : voies `highway` sauf autoroutes, voies en projet ou abandonnées, sans `foot=no` ni `access=no|private` (sauf `foot=yes|designated|permissive`) ; plus court chemin par Dijkstra (scipy). **Ce n'est pas le réseau de R5** (R5 a ses propres règles de permission et d'accrochage) : c'est un ordre de grandeur. Seuls les quais à moins de 2 000 m à vol d'oiseau sont testés (un quai plus loin l'est aussi par le réseau).

Échantillon (choix d'échantillon, n'entre dans aucune valeur publiée) : 104 communes, 312 lignes (commune x fin de poste) = les communes des découvertes et les communes de catégorie A **sans aucun retour** à 14h ou à 22h dont le quai desservi le plus proche est à 1 500 m ou plus à vol d'oiseau (dernier quart de la limite). Fichier : `data/processed/egress_limit_network_sample.csv`.

Résultats :
- **communes « limites »** : sur 87 lignes (41 à 14h, 46 à 22h), **74 n'ont aucun quai desservi à moins de 2 000 m par le réseau** (35 à 14h, 39 à 22h) : elles passent en pratique de A à B. Sur toutes les lignes A de l'échantillon, 77 basculent (37 à 14h, 40 à 22h), dont 75 sont des communes sans aucun retour (36 à 14h, 39 à 22h) ;
- rapport réseau / vol d'oiseau, quand les deux existent et que le quai est à 200 m ou plus : médiane 1,32, 3e quartile 1,46, maximum 3,30 (71 mesures) ;
- **communes des découvertes** : toutes gardent un quai desservi à moins de 2 000 m par le réseau (de 29 m à 835 m).

Conséquence : les chiffres B du § 3 sont des **minima**. À 22h, au moins 437 + 39 = **476 des 741 communes sans aucun retour** n'ont aucun quai desservi à moins de 2 km de marche ; à 14h, au moins 220 + 36 = **256 sur 533**. Les communes A dont le plus proche quai est entre 1 et 1,5 km à vol d'oiseau n'ont pas été mesurées (43 à 22h, 25 à 14h, parmi celles sans aucun retour) ; avec le rapport médian de 1,32, une partie dépasse sans doute aussi 2 km, mais ce n'est pas mesuré.

## 5. Cas d'appel : Le Mesnil-le-Roi (78396), 14h-22h, TC

Diagnostic (`07b --diagnose 78396 d14`, `data/processed/egress_limit_diag_78396_d14.csv`, colonnes `crow_m` à vol d'oiseau et `network_m` par le réseau piéton approché du § 4) :
- à 22h, les quais desservis à moins de 2 km du point de la commune sont **tous des arrêts du bus 6412** (et des lignes 6417 et 6429 de l'autre côté de la Seine, à plus de 5 km par le réseau) ; le dernier passage du 6412 à ces arrêts est entre **22h27 et 22h49** ; l'arrêt Marronniers est à 79 m (vol d'oiseau), 95 m (réseau approché), dernier passage 22h44 ;
- la gare de **Maisons-Laffitte**, desservie jusqu'à 23h40 (RER A et ligne L, quai `IDFM:monomodalStopPlace:473109`, 8 arrivées entre 22h08 et 23h40) et par un bus nommé « A » (quai `IDFM:480704`, 6 arrivées entre 22h09 et 23h39 ; le GTFS contient une ligne `Remplacement RER A`), est à **1 904 m à vol d'oiseau et environ 2 112 m par le réseau piéton approché** (2 150 m pour l'arrêt du bus « A ») ;
- donc : le Mesnil-le-Roi est en catégorie A (un bus passe à 79 m après 22h), mais **les seuls arrêts utiles après le dernier 6412 sont juste au-delà des 2 000 m** : le verdict « aucun retour » est très probablement un effet de la limite de R5, pas une absence de desserte. C'est cohérent avec l'indice relais : retour publié vers Maisons-Laffitte (2 257 m entre les deux points) puis marche, de 87 min (La Défense) à 144 min ; 11 des 15 pôles ont un indice de 120 min ou moins ;
- à 14h et 17h, le Mesnil-le-Roi a des retours publiés (35 à 108 min) : le bus 6412 circule encore.

Ce qui reste incertain : le réseau piéton approché n'est pas celui de R5 (2 112 m pourrait être un peu en dessous ou au-dessus pour R5) ; le vrai temps de retour avec une marche plus longue n'est pas calculé (r5py interdit pour cette tâche).

## 6. Découvertes `insights.json` concernées

Fichier : `data/processed/egress_limit_insights.csv` (côté `o`, côté `vs` et journée de comparaison de chaque découverte).

| Découverte | Scénario | Catégorie (vol d'oiseau / réseau) | Retours nuls | Indice relais ≤ 120 min | Basculement possible au budget de la découverte |
|---|---|---|---|---|---|
| **`late_return_01`** | Le Mesnil-le-Roi, 14h-22h, 60 min | A / A (bus 6412 à 95 m), mais gare à environ 2,1 km | 15 sur 15 | **11 pôles** | aucun (indice de 87 min au mieux) |
| les 29 autres | | A / A (quai desservi de 29 m à 835 m par le réseau) | 0 à 8 | 0 | aucun |

Lecture :
- **`late_return_01` est suspecte** : son chiffre (0 poste accessible aller et retour en 60 min) reste plausible d'après l'indice relais (aucun retour estimé sous 87 min), mais la phrase « aucun retour possible après 22h » n'est **pas** établie : un retour avec environ 2,1 km de marche depuis Maisons-Laffitte existe probablement. À ne pas raconter comme « aucun retour » ; à recouper avec l'application IDFM ou Navitia avant tout usage.
- **Maisons-Laffitte** (`eclipse_01`, `late_return_07`, option A de choix-lea.md) n'est pas concernée : point à 382 m (réseau approché) d'un quai desservi après 22h, aucun retour nul à 22h ; ses retours de 76 min viennent d'autre chose (goulet signalé dans `choix-lea.md`). Observé dans le GTFS : la ligne `Remplacement RER A` (bus) dessert Maisons-Laffitte ce soir-là, ce qui va dans le sens d'un chantier de soirée sur le RER A, à confirmer.
- Les autres découvertes à 22h avec des retours nuls (Cormeilles-en-Parisis, Conflans-Sainte-Honorine, La Frette-sur-Seine : 8 pôles ; Brétigny-sur-Orge, Ville-d'Avray, Ablon-sur-Seine, Villeneuve-le-Roi, Le Pecq : 3) ont un quai desservi à moins de 850 m par le réseau et aucun indice relais : rien n'indique que la limite y joue. Cela ne prouve pas que leurs retours nuls soient vrais (seul un recalcul le dirait).
- Les découvertes ne sont calculées qu'à 30, 45 et 60 min. Avec la jauge continue, un utilisateur qui pousse le budget au-delà de 75 min à 22h peut tomber sur des verdicts suspects (§ 3).

## 7. Options pour corriger (à trancher par l'équipe)

Aucune option n'est appliquée. Chacune est décrite avec son coût et son effet sur la table commune par commune (où les destinations deviendraient les points des communes, donc où la limite toucherait **aussi l'aller**).

### Option 1 : retour vers les arrêts, puis marche calculée à part
- **Principe** : on calcule le retour TC du pôle vers chaque **quai** desservi dans la fenêtre à moins de 7,2 km d'une commune (le quai est la destination : pas de marche finale), puis la marche quai vers point de la commune avec r5py en mode marche seul (limité en temps, pas en distance). Retour = min sur les quais de [TC jusqu'au quai + marche], comparé au retour actuel (on garde le plus court). Aucun paramètre nouveau : 7,2 km et 3,6 km/h sont déjà ceux du calcul.
- **Coût (matrice actuelle)** : r5py (donc les 10 Go de mémoire du réseau, poste ou VM) ; retour = 15 pôles x 3 fins de poste, vers quelques dizaines de milliers de quais au lieu de 1 285 points (temps de propagation plus long, à mesurer) ; marche = 1 285 communes vers les quais proches (recherches à pied seules, légères). Nouveau script (04d), contrôle dans 07 ; contrat inchangé (`ret` garde son sens, la marche est comptée).
- **Effet sur la table commune par commune** : il faudrait le même traitement **dans les deux sens et à chaque départ de la grille** (1 285 origines x quais x départs) : la table devient beaucoup plus lourde à calculer ; on peut réduire au fil de l'eau (min sur les quais par commune avant d'écrire), mais le temps de calcul est à mesurer avec le banc d'essai de 04c avant de promettre quoi que ce soit.

### Option 2 : R5 recompilé avec une limite dérivée
- **Principe** : R5 est sous licence MIT (dépôts `conveyal/r5` et `r5py/r5`) et r5py accepte un jar externe (option `--r5-classpath`, `r5py/util/classpath.py`). On recompile R5 v7.5.1 avec `WALK_DISTANCE_LIMIT_METERS` = 7 200 (portée à pied en 120 min à 3,6 km/h, valeur dérivée). Tous les scripts restent identiques.
- **Coût** : compilation Gradle avec le JDK 21 ; reconstruction du réseau (environ 30 min) ; **risque mémoire fort** : la table de distances de chaque arrêt couvre une surface environ 13 fois plus grande (7,2² / 2²), pour 35 000 quais, alors que le build actuel touche déjà 10 Go. À tester sur une VM avant tout. La constante sert aussi ailleurs dans R5 (recherche de code GitHub sur la branche principale de `conveyal/r5`, 03/11/2026 : `analyst/scenario/Scenario.java`, scénarios non utilisés ici, et `profile/McRaptorSuboptimalPathProfileRouter.java`, routeur des itinéraires détaillés) : la recompilation change donc aussi `DetailedItineraries`. Il faut documenter ce fork (licence, version, modification) et relancer toute la matrice TC (et vélo + TC).
- **Effet sur la table commune par commune** : corrige l'aller et le retour d'un coup, sans changer la méthode ; mais cette table est déjà au bord des capacités du poste : un réseau plus lourd rend la VM obligatoire.

### Option 3 : changer de point d'arrivée
- **Principe** : au retour, arriver à l'arrêt le plus desservi de la commune (même règle que l'ancrage des pôles, sans choix manuel) au lieu du centre de gravité de la population.
- **Coût** : relancer la partie retour de 04 (r5py) ; règle déjà codée pour les pôles (`starway.gtfs`).
- **Biais** : la marche de l'arrêt au domicile n'est plus comptée (temps sous-estimé, surtout pour les communes dont l'arrêt principal est loin des habitants) ; le point de départ de l'aller (centre de gravité de la population) et le point d'arrivée du retour diffèrent, ce qui casse la symétrie aller-retour revendiquée par la méthode ; une commune sans arrêt desservi le soir reste sans point.
- **Effet sur la table commune par commune** : c'est l'un des points ouverts de cette table (point d'arrivée dans chaque commune de destination). Avec un arrêt comme point d'arrivée des deux côtés, la limite ne joue plus que pour les communes sans arrêt ; mais on retombe sur la sensibilité au choix de l'arrêt que cette table voulait supprimer (avec une autre règle d'ancrage, l'arrêt ferré le plus desservi, 5 pôles sur 15 changeaient d'arrêt).

### Option 4 : documenter et marquer, sans recalcul
- **Principe** : distinguer, dans les données publiées, un retour nul « aucun trajet trouvé » d'un retour nul « non calculable : aucun arrêt desservi à moins de 2 km de marche du point de la commune » (catégorie B, mesurée par 07b), et le dire dans le panneau de preuve. Les découvertes dont la commune tombe en catégorie B, ou dont les pôles éteints ont un indice relais ≤ 120 min, sont retirées ou portent la mention.
- **Coût** : faible (07b existe ; 06 lirait `egress_limit_2026.csv`), pas de r5py. **Changement de contrat** : nouvelle valeur de `reason` (par exemple `no_stop_within_walk_limit`) dans `access/{insee}.json` et dans `REASONS` de `config.py` : le front doit suivre (texte du panneau de preuve, liste du ciel).
- **Limite** : le verdict reste « non accessible » ; on dit seulement qu'il n'est pas mesuré. Les catégories A avec indice relais (cas du Mesnil-le-Roi) restent ambiguës.
- **Effet sur la table commune par commune** : le marquage devrait être calculé pour chaque départ de la grille et dans les deux sens (distance du point de la commune de destination au plus proche quai desservi dans la fenêtre) ; c'est une lecture du GTFS par tranches de 5 min, sans r5py, donc peu coûteux.

Ces options peuvent se combiner : par exemple 4 tout de suite pour le dépôt, puis 1 ou 2 si la table commune par commune est lancée sur une VM.
