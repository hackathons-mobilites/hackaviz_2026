# Traçabilité : d'où vient chaque donnée affichée, et comment elle est calculée

<!-- Fichier généré par pipeline/scripts/06u_tracabilite.py depuis le registre du front (frontend/src/data/provenanceCoverage.ts), le manifeste
     (data/sources_manifest.csv), les run_params.json des dossiers de calcul et le code. NE PAS MODIFIER À LA MAIN :
     relancer `python scripts/06u_tracabilite.py` (contrôle : `--check`, et le P0 « traçabilité » de 07). -->

Une ligne par composant du site qui montre un chiffre (le registre du mode sources), regroupés en blocs, plus la visite guidée. Pour chaque bloc : source (identifiant du manifeste), fichier exact et sha256, date ou millésime, licence, formule (lue dans le code), dossiers de calcul avec l'empreinte de leur `run_params.json`, scripts, tests et ligne du mode sources. Rien n'est écrit à la main ni estimé : une donnée qui ne peut pas être sourcée est retirée du site ou signalée à la coordination (section 4).

Le contrôle P0 de `07_quality_checks.py` échoue si un composant affiché n'a pas de ligne ici, si un code de source n'est pas au manifeste, si un sha256 du manifeste ne correspond pas au fichier, ou si ce document n'est pas à jour.

## 1. Index des composants affichés

| Composant | Bloc | Genre | Sources affichées | Ligne du mode sources |
|---|---|---|---|---|
| `SkyCredit.tsx` | B01 | notes | EMP01, TRA01, CYC01, GEO04 | ProvenanceParts |
| `SkyList.tsx` | B01 | notes | EMP01, TRA01, CYC01, GEO04 | SkySourceNote, CalcMethodNote |
| `SkySummary.tsx` | B01 | covered | EMP01, TRA01, CYC01 | couverte par la ligne de SkyCredit.tsx |
| `Legend.tsx` | B01 | covered | EMP01, TRA01, CYC01 | couverte par la ligne de SkyCredit.tsx |
| `SizeKey.tsx` | B01 | covered | EMP01 | couverte par la ligne de SkyCredit.tsx |
| `CounterBlock.tsx` | B02 | covered | EMP01, TRA01, CYC01 | couverte par la ligne de SkyCredit.tsx |
| `JobsCounter.tsx` | B02 | covered | EMP01 | couverte par la ligne de SkyCredit.tsx |
| `MirrorMap.tsx` | B03 | notes | GEO01, TRA01, EMP01, CYC01 | MapSourceNote |
| `ProofPanel.tsx` | B04 | notes | TRA01, TRA01B, TRA01C, CYC01, GEO02, EMP01, GEO04 | TravelSourceNote, BassinSourceNote, StopSourceNote |
| `proof/ProofTimes.tsx` | B04 | covered | TRA01, CYC01 | couverte par la ligne de ProofPanel.tsx |
| `proof/ProofOd.tsx` | B04 | covered | TRA01, TRA01B, TRA01C, CYC01, EMP01 | couverte par la ligne de ProofPanel.tsx |
| `proof/ProofBadgeLine.tsx` | B04 | covered | TRA01, CYC01 | couverte par la ligne de ProofPanel.tsx |
| `proof/ProofOffpeak.tsx` | B04 | notes | TRA01, CYC01 | OffpeakSourceNote |
| `proof/ProofModes.tsx` | B04 | notes | TRA01, CYC01, COST02, ENV01 | ModesSourceNote |
| `proof/ProofTransports.tsx` | B05 | notes | TRA01, CYC01, TRA03, TRA04, QS01 | TripFactsSourceNote, TravelSourceNote |
| `proof/ProofTransferCheck.tsx` | B05 | notes | TRA01, TRA02B | ProvenanceNote |
| `proof/TripBlock.tsx` | B06 | notes | TRA01, CYC01, COST02, ENV01 | CodeSourceNote(COST02 ; méthode METHODS.tickets), CodeSourceNote(ENV01 ; méthode METHODS.carbon), AlternativesSourceNote |
| `subscriptions/ProofSubscriptions.tsx` | B06 | notes | SUB01, SUB02, SUB03, SUB04, SUB05, COST01, COST02 | RecordsSourceNote |
| `subscriptions/SubscriptionsDialog.tsx` | B06 | notes | SUB01, SUB02, SUB03, SUB04, SUB05, COST01, COST02 | RecordsSourceNote |
| `subscriptions/SubscriptionsButton.tsx` | B06 | exempt | aucune | aucune ligne (exemptée : Bouton qui ouvre « Mes abonnements » : aucun chiffre ni donnée affichés (les prix sont dans le dialogue et le panneau de preuve).) |
| `proof/ProofCarCost.tsx` | B08 | notes | COST08, VEH01, COST06, COST07, ENV02, CYC01, TOLL01, TOLL02, TOLL03, TOLL04, TOLL05 | ProvenanceNote |
| `proof/ProofTraffic.tsx` | B08 | notes | ROAD01 | CodeSourceNote |
| `proof/ModeTripBlock.tsx` | B08 | covered | COST08, VEH01, COST06, COST07, ENV02, CYC01, TOLL01, TOLL02, TOLL03, TOLL04, TOLL05 | couverte par la ligne de proof/ProofCarCost.tsx |
| `proof/ProofNeeds.tsx` | B09 | notes | TRA01, TRA03, TRA04 | NeedsSourceNote, NeedsMethodNote |
| `needs/NeedsMarks.tsx` | B09 | exempt | aucune | aucune ligne (exemptée : Calque décoratif (losanges au bord des astres, aria-hidden) : aucun chiffre ni donnée affichés. Ce que déclarent les sources (GTFS IDFM, référentiel des lignes, accessibilité en gare) est cité par la légende et par le panneau de preuve (ProofNeeds.tsx), avec leurs dates.) |
| `recruit/ProofRecruit.tsx` | B10 | notes | EMP03, GEO04 | CodeSourceNote(EMP03), BassinSourceNote, BmoMethodNote |
| `proof/ProofPublicOffers.tsx` | B11 | notes | EMP04 | CodeSourceNote(EMP04) |
| `proof/ProofJobs.tsx` | B12 | notes | EMP01, EMP02 | JobsSourceNote, FlowsSourceNote |
| `Insights.tsx` | B13 | notes | EMP01, TRA01, CYC01, GEO04 | SkySourceNote |
| `ContrastOfTheDay.tsx` | B13 | notes | EMP01, TRA01, CYC01, GEO04 | SkySourceNote |
| `HaloPanel.tsx` | B14 | notes | GEN04, GEN01, SOC01 | HaloSourceNote |
| `HaloAstrolabe.tsx` | B14 | covered | GEN04, GEN01, SOC01 | couverte par la ligne de HaloPanel.tsx |
| `HaloDotPlot.tsx` | B14 | covered | GEN04, GEN01, SOC01 | couverte par la ligne de HaloPanel.tsx |
| `IncomeRanks.tsx` | B14 | covered | SOC01 | couverte par la ligne de HaloPanel.tsx |
| `territoire/UnemploymentTab.tsx` | B16 | notes | SOC02, GEO05 | ChomageSourceNote(méthode METHODS.chomage) |
| `territoire/WorkTime.tsx` | B16 | notes | EMP05 | WorkTimeSourceNote(méthode METHODS.workTime) |
| `territoire/Polarity.tsx` | B16 | notes | GEO06 | PolaritySourceNote(méthode METHODS.polarity) |
| `visite guidée (tour/lea.tour.ts)` | B15 | visite | GEO01, EMP01, TRA01, CYC01, GEO04, EMP03, EMP02, GEN04, GEN01, SOC01 | mode sources coupé par défaut, visite comprise ; les blocs montrés portent leurs notes |

## 2. Fiches par bloc

### B01 : Le ciel : astres, tailles, états allumé ou éteint, liste, résumé, légende, crédits

- **Composants** : `SkyCredit.tsx`, `SkyList.tsx`, `SkySummary.tsx`, `Legend.tsx`, `SizeKey.tsx`
- **Nature** : calcul r5py (aller ET retour) agrégé par astre ; taille de l'astre = postes salariés recensés par l'INSEE (Flores)
- **Ligne du mode sources** :
  - `SkyCredit.tsx` : ProvenanceParts
  - `SkyList.tsx` : SkySourceNote, CalcMethodNote
  - `SkySummary.tsx` : couverte par la ligne de SkyCredit.tsx
  - `Legend.tsx` : couverte par la ligne de SkyCredit.tsx
  - `SizeKey.tsx` : couverte par la ligne de SkyCredit.tsx
- **Formule (lue dans le code)** :
  - `frontend/src/data/accessibility.ts:isAccessible` : Accessible pour un budget B ⇔ out ≤ B && ret ≤ B (null = non accessible).
  - `frontend/src/data/accessibility.ts:computePoleStates` : État de chaque pôle (même ordre que poles.json). `walkKey` : voir getSeries.
  - `frontend/src/data/od/texts.ts:calcMethodText` : Mode sources (méthode) et page « Sources & limites » : comment sont calculés les postes atteints (question et réponse de l'équipe, 05/11 ; point 4.7). Texte de méthode, aucune donnée : aucun chiffre. - aller : le départ le plus tardif qui arrive avant le début du poste ; - retour : compté à partir de la fin du poste, attente comprise (point 4.6, à la demande de l'équipe) ; - une commune est comptée en entier si l'aller et le retour tiennent chacun dans le temps choisi ; - Part = Atteints / Postes, la commune de départ (trajet non mesuré) étant hors du total (point 4.1). Sans horaire (marche, vélo, voiture), les deux premières phrases laissent place à « durées indépendantes de l'heure ».
  - `pipeline/starway/sky_groups.py` : astres du ciel = bassins d'emploi France Travail 2026 (GEO04), Paris en 20 arrondissements.
  - `pipeline/starway/od_table.py` : Table origine-destination de la proposition (statut : proposée, non adoptée).
  - `pipeline/starway/export.py:build_access` : matrices[(mode, day)] = DataFrame from_id,to_id,out,ret,reason[,dep] ; `day` = 'any' pour les modes sans horaire.
- **Scripts** : `pipeline/scripts/03_build_jobs_poles.py`, `pipeline/scripts/03b_sky_groups.py`, `pipeline/scripts/04_compute_matrix_b44.py`, `pipeline/scripts/04e_compute_walk_variant.py`, `pipeline/scripts/04c_compute_od_table.py`, `pipeline/scripts/06_export_front.py`, `pipeline/scripts/06d_export_od.py`
- **Tests** : `pipeline/tests/test_sky_groups.py`, `pipeline/tests/test_od_table.py`, `pipeline/tests/test_matrix_io.py`, `frontend/src/data/accessibility.test.ts`, `frontend/src/data/od/sky.test.ts`, `frontend/src/data/astreBassin.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| EMP01 | `data/raw/EMP01/DS_FLORES_2023_CSV_FR.zip` | `ab6b5c9de823439e8815e426e9a44adf79bd8d9c33c6c5645437ce3d279dfc5c` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/aide_lecture_flores.zip` | `cd043ddabd2bc361a5faeaf71c943182753db9e74b91a89f51ecb9a0008afb95` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/table_passage_flores.zip` | `69d76549e82ef88a453c7411736c3cd658d33c59e46c392c72e72d978c4fedf7` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| TRA01 | `data/raw/TRA01/IDFM-gtfs-0611.zip` | `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt) ; service 2026-11-17 (mardi ordinaire, 144948 courses actives) ; relevé 2026-11-06T15:11Z | Licence Mobilités (fiche : docs/sources.md#tra01) |
| CYC01 | `data/raw/CYC01/ile-de-france-latest.osm.pbf` | `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf ; relevé 2026-11-02T14:20Z | ODbL (fiche : docs/sources.md#cyc01) |
| GEO04 | `data/raw/GEO04/Bassins_d_emploi_2026_lu_2026-11-03.xlsx` | `3c7f5048491b90d21cfb16afdacb98f60b03a127b34bc871fd09fa41c09da455` | 2026 (bassins d'emploi 2026 ; Last-Modified HTTP : 17/04/2026 08:43 GMT) ; relevé 2026-11-03T22:13Z | Licence Ouverte + CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#geo04) |

Dossiers de calcul (empreinte du `run_params.json`, détail des autres empreintes en section 3) :

| dossier | état | sha256 du run_params.json |
|---|---|---|
| `matrix_modes_b44` | complet (13 lots x 3 scénarios) | `7a4a3c910fd4dc95269aa6784680ee2aced06f26868a35337b1d63b9eecc10e3` |
| `matrix_walk1000_d031_b44` | complet (13 lots x 3 scénarios) | `f711ba85f2612b0c13d9244358f007407a2e47146192e3f249975e0edc5582be` |
| `matrix_walk3000_d031_b44` | complet (13 lots x 3 scénarios) | `b023b3da19859902875b0fb50f92ddf01a9ae989c74273135290989819590b9b` |
| `matrix_velib_b44` | complet (88 origines) | `717e7c91c364d39e6abdc0b9e18aaea73d82b4120496e8692bfc9b69030a5a2a` |
| `matrix_story_d031_b44` | complet (1 lots x 3 scénarios) | `cc88695d31fb890ce784bf6eec73965e812eb222865b16f5482265436dba81b1` |
| `matrix_bike_transit_all_d031_b44_a` | complet (26 lots x 3 scénarios) | `632f5cb07d85013fb48a3c4cd1b3e4bd296ba92f428cddc2d9b6a6a410e632f0` |
| `matrix_bike_transit_all_d031_b44_b1` | complet (6 lots x 3 scénarios) | `fe874ee01637386c52b2045f70a89b61291dc7fe584fa7f248efae91ab0be538` |
| `matrix_bike_transit_all_d031_b44_b2` | complet (6 lots x 3 scénarios) | `26b19e3b25d6f040fa5281ffb456113e24e2e52fd3fa386eb677e26e85af1e17` |
| `matrix_bike_transit_all_d031_b44_b3` | complet (6 lots x 3 scénarios) | `060cb88f78c0c80bf0b6fded592d9744da7849b834157af0ec9885cbd4c40dbd` |
| `matrix_bike_transit_all_d031_b44_b4` | complet (6 lots x 3 scénarios) | `169ebca8314dc8bab04765a60138702d6425f5599fcf37d201e529b4846f7b2c` |
| `matrix_bike_transit_all_d031_b44_b5` | complet (6 lots x 3 scénarios) | `6101bbe26ab3ad847d03f02f070193ece4b3644dab67e25b8a5988b4b3cf041d` |
| `car_dist_carspeed_v2_b44` | complet (13 lots sur 13) | `bf78c98e365cfc3b4c2c30ed12987a8591d228c8c6f8d8f1b1db8bb83c0faa47` |
| `od_walk3000_d031` | complet (run_params.json présent) | `cad45fe04d54e5731ed357e0669c73d737289a41b52ff9620a6ef26dec7ed97e` |
| `od_walk1000_d031` | complet (run_params.json présent) | `4c033d14312cda1d99922e773e5c52bfc86fb269e7ad67d0cd800a39e04dabf2` |
| `matrix_walk1000_d031_nuit_b44` | complet (13 lots x 1 scénarios) | `ccc95e55d32211b34e3f8806e4c41270363539fd3e97316681a9b1a061c6e1e1` |
| `od_walk1000_d031_nuit_matin` | complet (run_params.json présent) | `d3370f63fd3f8fd74fd68ae62629bf29e5e6eff3a8bc93fbe0920a82fb8c1afd` |
| `od_walk1000_d031_nuit_soir_v2` | complet (run_params.json présent) | `ab57613dc6a498b122f202a6d3b5342bfb87ee12478d5a8d24c5a0cee7e3879a` |
| `matrix_walk3000_d031_nuit_b44` | complet (13 lots x 1 scénarios) | `16f75c421cbe18eb397ab15f956514906fdf538a017b7c7e9ecf66e7541d8d12` |
| `od_walk3000_d031_nuit_matin` | complet (run_params.json présent) | `6a8c6d1da0b7061d0877b2ff21af020b381fb17523c31aa352c1954b8cc5f240` |
| `od_walk3000_d031_nuit_soir_v2` | complet (run_params.json présent) | `f2eb87168a66e187b0d63a429e772e3925bed31e152306a4c0c308baf7b89d35` |

Sources du calcul (lues dans les `run_params.json` ci-dessus, rapprochées du manifeste par sha256) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| ENG01 | `%LOCALAPPDATA%\r5py\r5-v7.5.1-r5py-all.jar (poste) ; ~/.cache/r5py/r5-v7.5.1-r5py-all.jar (VM de calcul)` | `d50be106cadd7b636cfc0e209052767d7df570629f79fdf98ecd5cf5d2d89be7` | R5 v7.5.1 (tag v7.5.1-r5py ; Last-Modified HTTP du jar : 08/05/2026 15:27 GMT) ; relevé 2026-11-03T09:12Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk1000-d031-all.jar` | `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction d4d8cc49167338b77e15d04ce838aab69b422620 ; version écrite dans le jar : v7.5.1-r5py-walk1000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk2000-d031-all.jar` | `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | R5 v7.5.1 (tag v7.5.1-r5py) + modification STARWAY ; commit de construction 06248fabe98619b1f21f6f5c8b77189e2b257fbf ; version écrite dans le jar : v7.5.1-r5py-walk2000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T12:21Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar` | `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction 3ea104d9912daa03a13911e2bf6a73e3a364328d ; version écrite dans le jar : v7.5.1-r5py-walk3000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| GEO02B | `data/processed/communes_idf_2026.csv` | `a5ccd3bcbb8febb313c3a0c55adcd5091d5223f5c8490a8e386c416bd2b15fc1` | dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026) ; relevé 2026-11-03T09:31Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo02b) |
| GEO04B | `data/processed/poles_d030.json` | `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | dérivé de GEO04 (bassins d'emploi 2026), EMP01 (Flores 2023, postes salariés recensés par l'INSEE), GEO01 (géographie des communes 2026) et TRA01 (arrêts les plus desservis le 17/11/2026) ; service 2026-11-17 ; relevé 2026-11-04T10:49Z | ODbL + Licence Mobilités + Licence Ouverte + CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#geo04b) |
| TRA01B | `data/raw/TRA01B/gtfs_nuit-0611.zip` | `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du lundi 16/11/2026 qui passent minuit ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01b) |
| TRA01C | `data/raw/TRA01C/gtfs_soir-0611.zip` | `bf02daf3b8c051b6e0d3446a7b905c66140ba0938eb21f9b2e16a6a4a85c2feb` | dérivé de TRA01B puis de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du mercredi 18/11/2026 parties avant 3h et recodées 24h plus tard ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01c) |
| TRA02C | `data/processed/navitia_same_stop_min_recalc_d031.csv (réponses : data/interim/navitia_cache/connections_*.json)` | `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) ; service 2026-11-17 ; relevé 2026-11-04T10:02Z | Licence Mobilités + CGU PRIM (fiche : docs/sources.md#tra02c) |
| VEL01 | `data/raw/VEL01/station_information.json` | `060688f84cb162bd8902d7a63831177434aaa77312d77e62ae8d93d8bc82147b` | instantané du flux à la date d'extraction (horodatage lastUpdatedOther dans le fichier) ; relevé 2026-11-03T11:12Z | ODbL (fiche : docs/sources.md#vel01) |

### B02 : Compteur de postes salariés (INSEE) atteints et d'astres allumés

- **Composants** : `CounterBlock.tsx`, `JobsCounter.tsx`
- **Nature** : somme des postes des astres accessibles du ciel affiché (aller ET retour dans le temps choisi)
- **Ligne du mode sources** :
  - `CounterBlock.tsx` : couverte par la ligne de SkyCredit.tsx
  - `JobsCounter.tsx` : couverte par la ligne de SkyCredit.tsx
- **Formule (lue dans le code)** :
  - `frontend/src/data/accessibility.ts:computeTotals` : Totaux de postes salariés (INSEE) atteignables.
  - `frontend/src/data/accessibility.ts:isAccessible` : Accessible pour un budget B ⇔ out ≤ B && ret ≤ B (null = non accessible).
  - `frontend/src/data/od/texts.ts:calcMethodText` : Mode sources (méthode) et page « Sources & limites » : comment sont calculés les postes atteints (question et réponse de l'équipe, 05/11 ; point 4.7). Texte de méthode, aucune donnée : aucun chiffre. - aller : le départ le plus tardif qui arrive avant le début du poste ; - retour : compté à partir de la fin du poste, attente comprise (point 4.6, à la demande de l'équipe) ; - une commune est comptée en entier si l'aller et le retour tiennent chacun dans le temps choisi ; - Part = Atteints / Postes, la commune de départ (trajet non mesuré) étant hors du total (point 4.1). Sans horaire (marche, vélo, voiture), les deux premières phrases laissent place à « durées indépendantes de l'heure ».
- **Scripts** : `pipeline/scripts/06_export_front.py`, `pipeline/scripts/06d_export_od.py`
- **Tests** : `frontend/src/data/accessibility.test.ts`, `frontend/src/data/od/compute.test.ts`, `frontend/src/data/coverage.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| EMP01 | `data/raw/EMP01/DS_FLORES_2023_CSV_FR.zip` | `ab6b5c9de823439e8815e426e9a44adf79bd8d9c33c6c5645437ce3d279dfc5c` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/aide_lecture_flores.zip` | `cd043ddabd2bc361a5faeaf71c943182753db9e74b91a89f51ecb9a0008afb95` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/table_passage_flores.zip` | `69d76549e82ef88a453c7411736c3cd658d33c59e46c392c72e72d978c4fedf7` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| TRA01 | `data/raw/TRA01/IDFM-gtfs-0611.zip` | `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt) ; service 2026-11-17 (mardi ordinaire, 144948 courses actives) ; relevé 2026-11-06T15:11Z | Licence Mobilités (fiche : docs/sources.md#tra01) |
| CYC01 | `data/raw/CYC01/ile-de-france-latest.osm.pbf` | `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf ; relevé 2026-11-02T14:20Z | ODbL (fiche : docs/sources.md#cyc01) |

Dossiers de calcul (empreinte du `run_params.json`, détail des autres empreintes en section 3) :

| dossier | état | sha256 du run_params.json |
|---|---|---|
| `matrix_modes_b44` | complet (13 lots x 3 scénarios) | `7a4a3c910fd4dc95269aa6784680ee2aced06f26868a35337b1d63b9eecc10e3` |
| `matrix_walk1000_d031_b44` | complet (13 lots x 3 scénarios) | `f711ba85f2612b0c13d9244358f007407a2e47146192e3f249975e0edc5582be` |
| `matrix_walk3000_d031_b44` | complet (13 lots x 3 scénarios) | `b023b3da19859902875b0fb50f92ddf01a9ae989c74273135290989819590b9b` |
| `matrix_velib_b44` | complet (88 origines) | `717e7c91c364d39e6abdc0b9e18aaea73d82b4120496e8692bfc9b69030a5a2a` |
| `matrix_story_d031_b44` | complet (1 lots x 3 scénarios) | `cc88695d31fb890ce784bf6eec73965e812eb222865b16f5482265436dba81b1` |
| `matrix_bike_transit_all_d031_b44_a` | complet (26 lots x 3 scénarios) | `632f5cb07d85013fb48a3c4cd1b3e4bd296ba92f428cddc2d9b6a6a410e632f0` |
| `matrix_bike_transit_all_d031_b44_b1` | complet (6 lots x 3 scénarios) | `fe874ee01637386c52b2045f70a89b61291dc7fe584fa7f248efae91ab0be538` |
| `matrix_bike_transit_all_d031_b44_b2` | complet (6 lots x 3 scénarios) | `26b19e3b25d6f040fa5281ffb456113e24e2e52fd3fa386eb677e26e85af1e17` |
| `matrix_bike_transit_all_d031_b44_b3` | complet (6 lots x 3 scénarios) | `060cb88f78c0c80bf0b6fded592d9744da7849b834157af0ec9885cbd4c40dbd` |
| `matrix_bike_transit_all_d031_b44_b4` | complet (6 lots x 3 scénarios) | `169ebca8314dc8bab04765a60138702d6425f5599fcf37d201e529b4846f7b2c` |
| `matrix_bike_transit_all_d031_b44_b5` | complet (6 lots x 3 scénarios) | `6101bbe26ab3ad847d03f02f070193ece4b3644dab67e25b8a5988b4b3cf041d` |
| `car_dist_carspeed_v2_b44` | complet (13 lots sur 13) | `bf78c98e365cfc3b4c2c30ed12987a8591d228c8c6f8d8f1b1db8bb83c0faa47` |
| `od_walk3000_d031` | complet (run_params.json présent) | `cad45fe04d54e5731ed357e0669c73d737289a41b52ff9620a6ef26dec7ed97e` |
| `od_walk1000_d031` | complet (run_params.json présent) | `4c033d14312cda1d99922e773e5c52bfc86fb269e7ad67d0cd800a39e04dabf2` |
| `matrix_walk1000_d031_nuit_b44` | complet (13 lots x 1 scénarios) | `ccc95e55d32211b34e3f8806e4c41270363539fd3e97316681a9b1a061c6e1e1` |
| `od_walk1000_d031_nuit_matin` | complet (run_params.json présent) | `d3370f63fd3f8fd74fd68ae62629bf29e5e6eff3a8bc93fbe0920a82fb8c1afd` |
| `od_walk1000_d031_nuit_soir_v2` | complet (run_params.json présent) | `ab57613dc6a498b122f202a6d3b5342bfb87ee12478d5a8d24c5a0cee7e3879a` |
| `matrix_walk3000_d031_nuit_b44` | complet (13 lots x 1 scénarios) | `16f75c421cbe18eb397ab15f956514906fdf538a017b7c7e9ecf66e7541d8d12` |
| `od_walk3000_d031_nuit_matin` | complet (run_params.json présent) | `6a8c6d1da0b7061d0877b2ff21af020b381fb17523c31aa352c1954b8cc5f240` |
| `od_walk3000_d031_nuit_soir_v2` | complet (run_params.json présent) | `f2eb87168a66e187b0d63a429e772e3925bed31e152306a4c0c308baf7b89d35` |

Sources du calcul (lues dans les `run_params.json` ci-dessus, rapprochées du manifeste par sha256) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| ENG01 | `%LOCALAPPDATA%\r5py\r5-v7.5.1-r5py-all.jar (poste) ; ~/.cache/r5py/r5-v7.5.1-r5py-all.jar (VM de calcul)` | `d50be106cadd7b636cfc0e209052767d7df570629f79fdf98ecd5cf5d2d89be7` | R5 v7.5.1 (tag v7.5.1-r5py ; Last-Modified HTTP du jar : 08/05/2026 15:27 GMT) ; relevé 2026-11-03T09:12Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk1000-d031-all.jar` | `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction d4d8cc49167338b77e15d04ce838aab69b422620 ; version écrite dans le jar : v7.5.1-r5py-walk1000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk2000-d031-all.jar` | `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | R5 v7.5.1 (tag v7.5.1-r5py) + modification STARWAY ; commit de construction 06248fabe98619b1f21f6f5c8b77189e2b257fbf ; version écrite dans le jar : v7.5.1-r5py-walk2000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T12:21Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar` | `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction 3ea104d9912daa03a13911e2bf6a73e3a364328d ; version écrite dans le jar : v7.5.1-r5py-walk3000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| GEO02B | `data/processed/communes_idf_2026.csv` | `a5ccd3bcbb8febb313c3a0c55adcd5091d5223f5c8490a8e386c416bd2b15fc1` | dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026) ; relevé 2026-11-03T09:31Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo02b) |
| GEO04B | `data/processed/poles_d030.json` | `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | dérivé de GEO04 (bassins d'emploi 2026), EMP01 (Flores 2023, postes salariés recensés par l'INSEE), GEO01 (géographie des communes 2026) et TRA01 (arrêts les plus desservis le 17/11/2026) ; service 2026-11-17 ; relevé 2026-11-04T10:49Z | ODbL + Licence Mobilités + Licence Ouverte + CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#geo04b) |
| TRA01B | `data/raw/TRA01B/gtfs_nuit-0611.zip` | `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du lundi 16/11/2026 qui passent minuit ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01b) |
| TRA01C | `data/raw/TRA01C/gtfs_soir-0611.zip` | `bf02daf3b8c051b6e0d3446a7b905c66140ba0938eb21f9b2e16a6a4a85c2feb` | dérivé de TRA01B puis de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du mercredi 18/11/2026 parties avant 3h et recodées 24h plus tard ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01c) |
| TRA02C | `data/processed/navitia_same_stop_min_recalc_d031.csv (réponses : data/interim/navitia_cache/connections_*.json)` | `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) ; service 2026-11-17 ; relevé 2026-11-04T10:02Z | Licence Mobilités + CGU PRIM (fiche : docs/sources.md#tra02c) |
| VEL01 | `data/raw/VEL01/station_information.json` | `060688f84cb162bd8902d7a63831177434aaa77312d77e62ae8d93d8bc82147b` | instantané du flux à la date d'extraction (horodatage lastUpdatedOther dans le fichier) ; relevé 2026-11-03T11:12Z | ODbL (fiche : docs/sources.md#vel01) |

### B03 : Carte miroir : contours, astres posés sur leur arrêt, communes

- **Composants** : `MirrorMap.tsx`
- **Nature** : géométries et positions, aucun temps de trajet propre
- **Ligne du mode sources** :
  - `MirrorMap.tsx` : MapSourceNote
- **Formule (lue dans le code)** :
  - `pipeline/starway/geo_export.py` : Géométries simplifiées pour la « carte miroir » (plan § 15) : contours des communes, des pôles et arrêts d'ancrage.
  - `pipeline/starway/geo.py` : Communes d'Île-de-France (géographie 2026), arrondissements de Paris, harmonisation, projection du ciel.
- **Scripts** : `pipeline/scripts/02_build_geo.py`, `pipeline/scripts/06b_export_geo.py`
- **Tests** : `pipeline/tests/test_geo_export.py`, `frontend/src/data/geo.test.ts`, `frontend/src/data/mirrorAstres.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| GEO01 | `data/raw/GEO01/arrondissements_paris.json` | `22f4fc84f3baa717a84ec9ca32fb77637496fd3d63e57f88189dfc2e24d6079f` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-02T14:26Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/arrondissements_paris_codes_postaux.json` | `351d4b8b975a41224ab1baf1b86c297a0fc58b9a597be5c1ad585c43c2a530c6` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-05T11:14Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/arrondissements_paris_mairie.json` | `85cc1bacb6b1c66ea2f1ff33d1cc2f78e129ac51a191b2d78d25251eae19e390` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-02T22:05Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/communes_associees_deleguees_idf.json` | `1e4efc6a8f9b0707ba44de74383037980bea108c1938495c54eda907368076be` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-02T14:26Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/communes_idf.json` | `7971933dbbc55b1665707c1f3a9c3cf840b3bbc6a8722826c74c74f18f28a3c3` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-02T14:26Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/communes_idf_codes_postaux.json` | `1549bbc6da98af8107a9db841d7ca4434a2ac8f67827f9fa942ff9812d3f18fd` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-05T11:14Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/communes_idf_mairie.json` | `a820a43e50fdbface1c30e5f4dcd72ce4d6e3090651b7d4b7349c542fea1679e` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-02T22:05Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| TRA01 | `data/raw/TRA01/IDFM-gtfs-0611.zip` | `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt) ; service 2026-11-17 (mardi ordinaire, 144948 courses actives) ; relevé 2026-11-06T15:11Z | Licence Mobilités (fiche : docs/sources.md#tra01) |
| EMP01 | `data/raw/EMP01/DS_FLORES_2023_CSV_FR.zip` | `ab6b5c9de823439e8815e426e9a44adf79bd8d9c33c6c5645437ce3d279dfc5c` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/aide_lecture_flores.zip` | `cd043ddabd2bc361a5faeaf71c943182753db9e74b91a89f51ecb9a0008afb95` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/table_passage_flores.zip` | `69d76549e82ef88a453c7411736c3cd658d33c59e46c392c72e72d978c4fedf7` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| CYC01 | `data/raw/CYC01/ile-de-france-latest.osm.pbf` | `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf ; relevé 2026-11-02T14:20Z | ODbL (fiche : docs/sources.md#cyc01) |

Aucun dossier de calcul r5py : donnée statistique ou géographique lue directement dans les sources ci-dessus.

### B04 : Panneau de preuve : temps aller et retour, postes atteints, modes, heure creuse, horaires libres

- **Composants** : `ProofPanel.tsx`, `proof/ProofTimes.tsx`, `proof/ProofOd.tsx`, `proof/ProofBadgeLine.tsx`, `proof/ProofOffpeak.tsx`, `proof/ProofModes.tsx`
- **Nature** : calcul r5py sur les horaires IDFM (TRA01, TRA01B pour le matin, TRA01C pour le soir) et le réseau OSM
- **Ligne du mode sources** :
  - `ProofPanel.tsx` : TravelSourceNote, BassinSourceNote, StopSourceNote
  - `proof/ProofTimes.tsx` : couverte par la ligne de ProofPanel.tsx
  - `proof/ProofOd.tsx` : couverte par la ligne de ProofPanel.tsx
  - `proof/ProofBadgeLine.tsx` : couverte par la ligne de ProofPanel.tsx
  - `proof/ProofOffpeak.tsx` : OffpeakSourceNote
  - `proof/ProofModes.tsx` : ModesSourceNote
- **Formule (lue dans le code)** :
  - `frontend/src/data/od/texts.ts:calcMethodText` : Mode sources (méthode) et page « Sources & limites » : comment sont calculés les postes atteints (question et réponse de l'équipe, 05/11 ; point 4.7). Texte de méthode, aucune donnée : aucun chiffre. - aller : le départ le plus tardif qui arrive avant le début du poste ; - retour : compté à partir de la fin du poste, attente comprise (point 4.6, à la demande de l'équipe) ; - une commune est comptée en entier si l'aller et le retour tiennent chacun dans le temps choisi ; - Part = Atteints / Postes, la commune de départ (trajet non mesuré) étant hors du total (point 4.1). Sans horaire (marche, vélo, voiture), les deux premières phrases laissent place à « durées indépendantes de l'heure ».
  - `frontend/src/data/od/texts.ts:nightNetworkMethodText` : Mode sources (méthode) : sur quels horaires sont calculées les plages du matin et du soir de la grille (`index.time_segments`). Plages, jour et date lus dans les données ; aucune durée ni aucun code de source écrit ici (la source est citée par sa note, `CodeSourceNote`). Le matin reçoit les courses de la veille passées après minuit, le soir celles du lendemain parties avant 3h : les deux viennent du même mardi type. null sans `time_segments` (ancien export) ou sans plage de nuit.
  - `frontend/src/data/od/texts.ts:nightReturnMethodText` : Mode sources (méthode) : le retour du matin d'un poste de nuit, avec le jour et la date de service lus dans meta.json.
  - `pipeline/starway/od_night.py` : table commune x commune assemblée de TROIS tables de départs, sans doublon.
  - `pipeline/starway/itineraries.py` : Itinéraires TC détaillés (04h) : logique pure, testable sans Java.
- **Scripts** : `pipeline/scripts/04c_compute_od_table.py`, `pipeline/scripts/04e_compute_walk_variant.py`, `pipeline/scripts/04h_transit_itineraries.py`, `pipeline/scripts/06d_export_od.py`, `pipeline/scripts/06h_export_itineraries.py`
- **Tests** : `pipeline/tests/test_od_table.py`, `pipeline/tests/test_od_night.py`, `pipeline/tests/test_od_export.py`, `pipeline/tests/test_itineraries.py`, `frontend/src/data/proofPanel.test.ts`, `frontend/src/data/proof.test.ts`, `frontend/src/data/od/texts.test.ts`, `frontend/src/data/od/shift.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| TRA01 | `data/raw/TRA01/IDFM-gtfs-0611.zip` | `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt) ; service 2026-11-17 (mardi ordinaire, 144948 courses actives) ; relevé 2026-11-06T15:11Z | Licence Mobilités (fiche : docs/sources.md#tra01) |
| TRA01B | `data/raw/TRA01B/gtfs_nuit-0611.zip` | `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du lundi 16/11/2026 qui passent minuit ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01b) |
| TRA01C | `data/raw/TRA01C/gtfs_soir-0611.zip` | `bf02daf3b8c051b6e0d3446a7b905c66140ba0938eb21f9b2e16a6a4a85c2feb` | dérivé de TRA01B puis de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du mercredi 18/11/2026 parties avant 3h et recodées 24h plus tard ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01c) |
| CYC01 | `data/raw/CYC01/ile-de-france-latest.osm.pbf` | `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf ; relevé 2026-11-02T14:20Z | ODbL (fiche : docs/sources.md#cyc01) |
| GEO02 | `data/raw/GEO02/Filosofi2021_carreaux_200m_csv.zip` | `5935efb1b734ee49e2335bd546b18b8086cd718ebb8e6edc4cf70a89554ea8a3` | revenus 2021, publié le 12/02/2026 (page 8735162) ; relevé 2026-11-02T22:06Z | Licence Ouverte (fiche : docs/sources.md#geo02) |
| GEO02 | `data/raw/GEO02/page-8735162.html` | `1989858d4cf09aeae68bb9907e28d57a8b63f18e3d6b5cfc2965668242ec142d` | Filosofi 2021 ; relevé 2026-11-02T22:06Z | Licence Ouverte (fiche : docs/sources.md#geo02) |
| EMP01 | `data/raw/EMP01/DS_FLORES_2023_CSV_FR.zip` | `ab6b5c9de823439e8815e426e9a44adf79bd8d9c33c6c5645437ce3d279dfc5c` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/aide_lecture_flores.zip` | `cd043ddabd2bc361a5faeaf71c943182753db9e74b91a89f51ecb9a0008afb95` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/table_passage_flores.zip` | `69d76549e82ef88a453c7411736c3cd658d33c59e46c392c72e72d978c4fedf7` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| GEO04 | `data/raw/GEO04/Bassins_d_emploi_2026_lu_2026-11-03.xlsx` | `3c7f5048491b90d21cfb16afdacb98f60b03a127b34bc871fd09fa41c09da455` | 2026 (bassins d'emploi 2026 ; Last-Modified HTTP : 17/04/2026 08:43 GMT) ; relevé 2026-11-03T22:13Z | Licence Ouverte + CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#geo04) |
| COST02 | `data/raw/COST02/tarifs-2026.html` | `0293caae1e39b2cf2c36a0fd10459911b907e08149f3969ee2ddf0520c98e655` | publiée le 10 décembre 2025, tarifs au 1er janvier 2026 (mentions de la page) ; relevé 2026-11-03T15:46Z | document cité (fiche : docs/sources.md#cost02) |
| COST02 | `data/raw/COST02/ticket-metro-train-rer.html` | `558170e2ae8fb9812030f4d2b2cfc326bb8516f3a524264070808d5d583d7d0e` | page consultée le 03/11/2026 (pas de date de mise à jour affichée) ; relevé 2026-11-03T15:47Z | document cité (fiche : docs/sources.md#cost02) |
| COST02 | `data/raw/COST02/ticket-paris-region-aeroports.html` | `0893170a27ec48369e810d961192528719fc0f2f5317710e2abbdd7230721a05` | tarifs applicables au 1er janvier 2026 (mention de la page) ; relevé 2026-11-03T15:47Z | document cité (fiche : docs/sources.md#cost02) |
| ENV01 | `data/raw/ENV01/emission-de-co2e-par-voyageur-kilometre-sur-le-reseau.csv` | `fc8f273c0be98ff7fbfeb55365508e31d83ac224eedf36c062889350b00bf7f9` | facteurs opérateurs 2019 et Base Carbone ADEME ; jeu mis à jour le 26/02/2024 ; relevé 2026-11-03T15:44Z | Licence Ouverte (fiche : docs/sources.md#env01) |

Dossiers de calcul (empreinte du `run_params.json`, détail des autres empreintes en section 3) :

| dossier | état | sha256 du run_params.json |
|---|---|---|
| `matrix_modes_b44` | complet (13 lots x 3 scénarios) | `7a4a3c910fd4dc95269aa6784680ee2aced06f26868a35337b1d63b9eecc10e3` |
| `matrix_walk1000_d031_b44` | complet (13 lots x 3 scénarios) | `f711ba85f2612b0c13d9244358f007407a2e47146192e3f249975e0edc5582be` |
| `matrix_walk3000_d031_b44` | complet (13 lots x 3 scénarios) | `b023b3da19859902875b0fb50f92ddf01a9ae989c74273135290989819590b9b` |
| `matrix_velib_b44` | complet (88 origines) | `717e7c91c364d39e6abdc0b9e18aaea73d82b4120496e8692bfc9b69030a5a2a` |
| `matrix_story_d031_b44` | complet (1 lots x 3 scénarios) | `cc88695d31fb890ce784bf6eec73965e812eb222865b16f5482265436dba81b1` |
| `matrix_bike_transit_all_d031_b44_a` | complet (26 lots x 3 scénarios) | `632f5cb07d85013fb48a3c4cd1b3e4bd296ba92f428cddc2d9b6a6a410e632f0` |
| `matrix_bike_transit_all_d031_b44_b1` | complet (6 lots x 3 scénarios) | `fe874ee01637386c52b2045f70a89b61291dc7fe584fa7f248efae91ab0be538` |
| `matrix_bike_transit_all_d031_b44_b2` | complet (6 lots x 3 scénarios) | `26b19e3b25d6f040fa5281ffb456113e24e2e52fd3fa386eb677e26e85af1e17` |
| `matrix_bike_transit_all_d031_b44_b3` | complet (6 lots x 3 scénarios) | `060cb88f78c0c80bf0b6fded592d9744da7849b834157af0ec9885cbd4c40dbd` |
| `matrix_bike_transit_all_d031_b44_b4` | complet (6 lots x 3 scénarios) | `169ebca8314dc8bab04765a60138702d6425f5599fcf37d201e529b4846f7b2c` |
| `matrix_bike_transit_all_d031_b44_b5` | complet (6 lots x 3 scénarios) | `6101bbe26ab3ad847d03f02f070193ece4b3644dab67e25b8a5988b4b3cf041d` |
| `car_dist_carspeed_v2_b44` | complet (13 lots sur 13) | `bf78c98e365cfc3b4c2c30ed12987a8591d228c8c6f8d8f1b1db8bb83c0faa47` |
| `itineraries_walk3000_d031_b44` | complet (52 lots) | `b07c5731411069591371ae4b160f30810c244645804b1ed0578b2288cd989468` |
| `itineraries_walk1000_d031_b44` | complet (52 lots) | `732fda8b1abd2fca11cc612096b23881da6d4b5f16cc2287385baa2ce7866c17` |
| `od_walk3000_d031` | complet (run_params.json présent) | `cad45fe04d54e5731ed357e0669c73d737289a41b52ff9620a6ef26dec7ed97e` |
| `od_walk1000_d031` | complet (run_params.json présent) | `4c033d14312cda1d99922e773e5c52bfc86fb269e7ad67d0cd800a39e04dabf2` |
| `matrix_walk1000_d031_nuit_b44` | complet (13 lots x 1 scénarios) | `ccc95e55d32211b34e3f8806e4c41270363539fd3e97316681a9b1a061c6e1e1` |
| `itineraries_walk1000_d031_nuit_b44` | complet (52 lots) | `2755c418ca176d34e254d1086906d04e7c16ea7294bc18143a582f916681c5d0` |
| `od_walk1000_d031_nuit_matin` | complet (run_params.json présent) | `d3370f63fd3f8fd74fd68ae62629bf29e5e6eff3a8bc93fbe0920a82fb8c1afd` |
| `od_walk1000_d031_nuit_soir_v2` | complet (run_params.json présent) | `ab57613dc6a498b122f202a6d3b5342bfb87ee12478d5a8d24c5a0cee7e3879a` |
| `matrix_walk3000_d031_nuit_b44` | complet (13 lots x 1 scénarios) | `16f75c421cbe18eb397ab15f956514906fdf538a017b7c7e9ecf66e7541d8d12` |
| `itineraries_walk3000_d031_nuit_b44` | complet (52 lots) | `791d1ee951ea5feec6349c6806249a5578d897f7f5a033d70590900c015c4c8e` |
| `od_walk3000_d031_nuit_matin` | complet (run_params.json présent) | `6a8c6d1da0b7061d0877b2ff21af020b381fb17523c31aa352c1954b8cc5f240` |
| `od_walk3000_d031_nuit_soir_v2` | complet (run_params.json présent) | `f2eb87168a66e187b0d63a429e772e3925bed31e152306a4c0c308baf7b89d35` |

Sources du calcul (lues dans les `run_params.json` ci-dessus, rapprochées du manifeste par sha256) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| ENG01 | `%LOCALAPPDATA%\r5py\r5-v7.5.1-r5py-all.jar (poste) ; ~/.cache/r5py/r5-v7.5.1-r5py-all.jar (VM de calcul)` | `d50be106cadd7b636cfc0e209052767d7df570629f79fdf98ecd5cf5d2d89be7` | R5 v7.5.1 (tag v7.5.1-r5py ; Last-Modified HTTP du jar : 08/05/2026 15:27 GMT) ; relevé 2026-11-03T09:12Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk1000-d031-all.jar` | `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction d4d8cc49167338b77e15d04ce838aab69b422620 ; version écrite dans le jar : v7.5.1-r5py-walk1000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk2000-d031-all.jar` | `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | R5 v7.5.1 (tag v7.5.1-r5py) + modification STARWAY ; commit de construction 06248fabe98619b1f21f6f5c8b77189e2b257fbf ; version écrite dans le jar : v7.5.1-r5py-walk2000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T12:21Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar` | `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction 3ea104d9912daa03a13911e2bf6a73e3a364328d ; version écrite dans le jar : v7.5.1-r5py-walk3000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| GEO02B | `data/processed/communes_idf_2026.csv` | `a5ccd3bcbb8febb313c3a0c55adcd5091d5223f5c8490a8e386c416bd2b15fc1` | dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026) ; relevé 2026-11-03T09:31Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo02b) |
| GEO04B | `data/processed/poles_d030.json` | `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | dérivé de GEO04 (bassins d'emploi 2026), EMP01 (Flores 2023, postes salariés recensés par l'INSEE), GEO01 (géographie des communes 2026) et TRA01 (arrêts les plus desservis le 17/11/2026) ; service 2026-11-17 ; relevé 2026-11-04T10:49Z | ODbL + Licence Mobilités + Licence Ouverte + CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#geo04b) |
| TRA02C | `data/processed/navitia_same_stop_min_recalc_d031.csv (réponses : data/interim/navitia_cache/connections_*.json)` | `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) ; service 2026-11-17 ; relevé 2026-11-04T10:02Z | Licence Mobilités + CGU PRIM (fiche : docs/sources.md#tra02c) |
| VEL01 | `data/raw/VEL01/station_information.json` | `060688f84cb162bd8902d7a63831177434aaa77312d77e62ae8d93d8bc82147b` | instantané du flux à la date d'extraction (horodatage lastUpdatedOther dans le fichier) ; relevé 2026-11-03T11:12Z | ODbL (fiche : docs/sources.md#vel01) |

### B05 : Lignes et correspondances : climatisation, ponctualité, accessibilité en gare, correspondances trop courtes

- **Composants** : `proof/ProofTransports.tsx`, `proof/ProofTransferCheck.tsx`
- **Nature** : faits relevés par ligne dans les fichiers ouverts, recopiés sur chaque tronçon des itinéraires
- **Ligne du mode sources** :
  - `proof/ProofTransports.tsx` : TripFactsSourceNote, TravelSourceNote
  - `proof/ProofTransferCheck.tsx` : ProvenanceNote
- **Formule (lue dans le code)** :
  - `pipeline/starway/line_facts.py` : Faits publiés par ligne pour les tronçons en TC des itinéraires (panneau de preuve, 04/11/2026).
  - `pipeline/starway/transfer_times.py` : Temps de correspondance officiels (GTFS IDFM `transfers.txt`) et itinéraires TC détaillés.
  - `pipeline/starway/transfer_marks.py` : Marquage des correspondances trop courtes dans les itinéraires publiés (option c, 04/11/2026).
- **Scripts** : `pipeline/scripts/04h_transit_itineraries.py`, `pipeline/scripts/06h_export_itineraries.py`, `pipeline/scripts/06t_export_transfer_check.py`, `pipeline/scripts/07h_transfer_times_check.py`
- **Tests** : `pipeline/tests/test_line_facts.py`, `pipeline/tests/test_transfer_times.py`, `pipeline/tests/test_transfer_marks.py`, `frontend/src/data/transferCheck.test.ts`, `frontend/src/data/panneauLignes.test.ts`, `frontend/src/data/provenancePanneauLignes.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| TRA01 | `data/raw/TRA01/IDFM-gtfs-0611.zip` | `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt) ; service 2026-11-17 (mardi ordinaire, 144948 courses actives) ; relevé 2026-11-06T15:11Z | Licence Mobilités (fiche : docs/sources.md#tra01) |
| CYC01 | `data/raw/CYC01/ile-de-france-latest.osm.pbf` | `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf ; relevé 2026-11-02T14:20Z | ODbL (fiche : docs/sources.md#cyc01) |
| TRA03 | `data/raw/TRA03/referentiel-des-lignes.csv` | `4ae8d76054aca4924ee44a4ea45ccade257f1d13b3c26c626473bac1d67ed603` | instantané du 03/11/2026 (jeu mis à jour chaque jour) ; relevé 2026-11-03T15:44Z | ODbL (fiche : docs/sources.md#tra03) |
| TRA04 | `data/raw/TRA04/accessibilite-en-gare.csv` | `931a00848e2079f64adab7651bab43bd4ee32e685d2d5865763ebf7a61480c3c` | jeu modifié le 06/07/2026 ; relevé 2026-11-03T15:44Z | Licence Ouverte (fiche : docs/sources.md#tra04) |
| QS01 | `data/raw/QS01/ponctualite-mensuelle-transilien.csv` | `f382c5238e0e354b7a22e4db72fd0cda0f8ef7ea312b016ffab47d362462c451` | janvier 2013 à septembre 2026 (jeu modifié le 08/10/2026) ; relevé 2026-11-03T15:44Z | ODbL (fiche : docs/sources.md#qs01) |
| TRA02B | `data/processed/navitia_connections.csv` | `04503f9b2a4478e938a285a5cd97159498197794c083e82fe276507c8bc2b066` | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) ; service 2026-11-17 ; relevé 2026-11-04T10:02Z | Licence Mobilités + CGU PRIM (fiche : docs/sources.md#tra02b) |
| TRA02B | `data/processed/navitia_same_stop_min.csv (réponses : data/interim/navitia_cache/connections_*.json)` | `2d57acd36149b67797f72c8ca81766600e727c13d2969912c42ab94d8360673d` | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) ; service 2026-11-17 ; relevé 2026-11-04T10:02Z | Licence Mobilités + CGU PRIM (fiche : docs/sources.md#tra02b) |

Dossiers de calcul (empreinte du `run_params.json`, détail des autres empreintes en section 3) :

| dossier | état | sha256 du run_params.json |
|---|---|---|
| `itineraries_walk3000_d031_b44` | complet (52 lots) | `b07c5731411069591371ae4b160f30810c244645804b1ed0578b2288cd989468` |
| `itineraries_walk1000_d031_b44` | complet (52 lots) | `732fda8b1abd2fca11cc612096b23881da6d4b5f16cc2287385baa2ce7866c17` |
| `itineraries_walk1000_d031_nuit_b44` | complet (52 lots) | `2755c418ca176d34e254d1086906d04e7c16ea7294bc18143a582f916681c5d0` |
| `itineraries_walk3000_d031_nuit_b44` | complet (52 lots) | `791d1ee951ea5feec6349c6806249a5578d897f7f5a033d70590900c015c4c8e` |

Sources du calcul (lues dans les `run_params.json` ci-dessus, rapprochées du manifeste par sha256) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk1000-d031-all.jar` | `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction d4d8cc49167338b77e15d04ce838aab69b422620 ; version écrite dans le jar : v7.5.1-r5py-walk1000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar` | `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction 3ea104d9912daa03a13911e2bf6a73e3a364328d ; version écrite dans le jar : v7.5.1-r5py-walk3000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| GEO02B | `data/processed/communes_idf_2026.csv` | `a5ccd3bcbb8febb313c3a0c55adcd5091d5223f5c8490a8e386c416bd2b15fc1` | dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026) ; relevé 2026-11-03T09:31Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo02b) |
| TRA01B | `data/raw/TRA01B/gtfs_nuit-0611.zip` | `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du lundi 16/11/2026 qui passent minuit ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01b) |
| TRA02C | `data/processed/navitia_same_stop_min_recalc_d031.csv (réponses : data/interim/navitia_cache/connections_*.json)` | `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) ; service 2026-11-17 ; relevé 2026-11-04T10:02Z | Licence Mobilités + CGU PRIM (fiche : docs/sources.md#tra02c) |

### B06 : Trajet en transports en commun : coût au ticket et part de chaque ticket, abonnements, Vélib', carbone, trajets alternatifs

- **Composants** : `proof/TripBlock.tsx`, `subscriptions/ProofSubscriptions.tsx`, `subscriptions/SubscriptionsDialog.tsx`, `subscriptions/SubscriptionsButton.tsx`
- **Nature** : prix publiés par IDFM et Vélib', comptés sur les tronçons des itinéraires ; aucun prix n'est estimé ; la part de chaque ticket est son nombre x le prix à l'unité publié (subscriptions.json, unit_tickets) et n'est dessinée que si la somme retombe sur le coût ; carbone : distance de chaque tronçon x facteur d'émission publié par IDFM pour sa ligne ou son mode ; autres trajets : calcul r5py (04q) sur le même réseau que les itinéraires publiés, largeur de recherche de 15 min (réglage de l'équipe), le plus rapide est l'itinéraire publié, une case non calculée reste « pas encore calculé »
- **Ligne du mode sources** :
  - `proof/TripBlock.tsx` : CodeSourceNote(COST02 ; méthode METHODS.tickets), CodeSourceNote(ENV01 ; méthode METHODS.carbon), AlternativesSourceNote
  - `subscriptions/ProofSubscriptions.tsx` : RecordsSourceNote
  - `subscriptions/SubscriptionsDialog.tsx` : RecordsSourceNote
  - `subscriptions/SubscriptionsButton.tsx` : aucune ligne (exemptée : Bouton qui ouvre « Mes abonnements » : aucun chiffre ni donnée affichés (les prix sont dans le dialogue et le panneau de preuve).)
- **Formule (lue dans le code)** :
  - `pipeline/starway/ticket_rules.py` : Règles officielles du comptage des tickets à l'unité (corrigé le 04/11/2026 après le recoupement 07k).
  - `pipeline/starway/fares_carbon.py:count_tickets` : Tickets à l'unité nécessaires pour un sens (plein tarif). `legs` = tronçons enrichis (`enrich_leg`) dans l'ordre ; `parents` = stop_id -> parent_station (GTFS) ; `declared_transfers` = couples (from_stop, to_stop) de transfers.txt (correspondances déclarées par IDFM).
  - `pipeline/starway/subscriptions.py:transit_round_trip` : Aller et retour d'une même journée-type. `total_eur` = ce que la personne paie pour cet aller-retour EN PLUS de son abonnement ; pour un titre d'un jour (`kind` = `day`), le prix du titre est ajouté une fois (il couvre la journée) ; pour un abonnement, son prix n'est jamais ajouté ni divisé (il est affiché à côté). `None` si un sens manque ou n'est pas sourcé.
  - `pipeline/starway/subscriptions.py:velib_effects` : Courses Vélib' publiées (aller et retour) : combien sont incluses dans chaque offre, combien coûtent un supplément, aller-retour dont les deux courses sont incluses.
  - `pipeline/starway/fares_carbon.py:trip_co2` : Carbone d'un sens : somme des tronçons en TC ; None si un tronçon n'a pas de facteur (jamais un total partiel).
  - `pipeline/starway/fares_carbon.py:leg_co2_g` : (g CO2e, raison) pour un tronçon en TC ; None + raison si aucun facteur publié ou distance inconnue.
  - `pipeline/starway/alternatives.py:select_abc` : A parmi toutes les options (règle de 04h), B et C parmi les options qui tiennent les horaires et la limite de durée.
  - `pipeline/starway/alternatives_export.py:a_wins` : A bat-il B (prix connu puis durée) ou C (montées puis durée), avec les clés de `alternatives.select_abc` ?
  - `pipeline/starway/alternatives_export.py:coverage_doc` : Toutes les communes : `null` = aucune case calculée ; sinon une lettre par astre, dans l'ordre de `poles`.
  - `frontend/src/components/proof/alternatives/alternatives.ts:resolveAlternatives` : Règle de vérité : un seul chemin mène à « plusieurs trajets » ou à « pas d'autre trajet », celui où la couverture, la case et l'itinéraire A publié racontent la même chose. Case calculée (lettre et état de la case d'accord) dont le trajet A n'est pas l'itinéraire publié : « Calcul fait, non affiché », avec sa raison. Dans tous les autres cas : « Pas encore calculé ».
  - `frontend/src/data/costBreakdown.ts:ticketBreakdown` : Transports en commun, au ticket : une part par type de ticket (nombre x prix à l'unité). null si le sens n'a pas de prix sûr, si un prix à l'unité manque, si le trajet est entièrement à pied (aucun ticket) ou si la somme ne retombe pas sur le coût publié.
  - texte affiché (`METHODS.tickets`, frontend/src/data/provenance.ts) : tickets à l'unité au plein tarif, un par suite de tronçons dans la fenêtre de correspondance de 2 h ; ticket aéroport pour les trajets qui y arrivent ou en partent ; aucun forfait
  - texte affiché (`METHODS.carbon`, frontend/src/data/provenance.ts) : distance de chaque tronçon en transport en commun multipliée par le facteur d'émission publié pour sa ligne ou son mode, somme par sens ; la marche n'est pas comptée
- **Scripts** : `pipeline/scripts/04h_transit_itineraries.py`, `pipeline/scripts/06h_export_itineraries.py`, `pipeline/scripts/06i_export_subscriptions.py`, `pipeline/scripts/01_download.py`, `pipeline/scripts/04q_transit_alternatives.py`, `pipeline/scripts/04q_transit_alternatives_confort.py`, `pipeline/scripts/04r_alternatives_priority.py`, `pipeline/scripts/06w_export_alternatives.py`
- **Tests** : `pipeline/tests/test_ticket_rules.py`, `pipeline/tests/test_subscriptions.py`, `pipeline/tests/test_itineraries.py`, `pipeline/tests/test_itin_export.py`, `pipeline/tests/test_line_facts.py`, `pipeline/tests/test_alternatives.py`, `pipeline/tests/test_alternatives_export.py`, `frontend/src/data/subscriptions.test.ts`, `frontend/src/data/costBreakdown.test.ts`, `frontend/src/data/tripTiles.test.ts`, `frontend/src/components/proof/alternatives/alternatives.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| TRA01 | `data/raw/TRA01/IDFM-gtfs-0611.zip` | `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt) ; service 2026-11-17 (mardi ordinaire, 144948 courses actives) ; relevé 2026-11-06T15:11Z | Licence Mobilités (fiche : docs/sources.md#tra01) |
| CYC01 | `data/raw/CYC01/ile-de-france-latest.osm.pbf` | `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf ; relevé 2026-11-02T14:20Z | ODbL (fiche : docs/sources.md#cyc01) |
| COST02 | `data/raw/COST02/tarifs-2026.html` | `0293caae1e39b2cf2c36a0fd10459911b907e08149f3969ee2ddf0520c98e655` | publiée le 10 décembre 2025, tarifs au 1er janvier 2026 (mentions de la page) ; relevé 2026-11-03T15:46Z | document cité (fiche : docs/sources.md#cost02) |
| COST02 | `data/raw/COST02/ticket-metro-train-rer.html` | `558170e2ae8fb9812030f4d2b2cfc326bb8516f3a524264070808d5d583d7d0e` | page consultée le 03/11/2026 (pas de date de mise à jour affichée) ; relevé 2026-11-03T15:47Z | document cité (fiche : docs/sources.md#cost02) |
| COST02 | `data/raw/COST02/ticket-paris-region-aeroports.html` | `0893170a27ec48369e810d961192528719fc0f2f5317710e2abbdd7230721a05` | tarifs applicables au 1er janvier 2026 (mention de la page) ; relevé 2026-11-03T15:47Z | document cité (fiche : docs/sources.md#cost02) |
| ENV01 | `data/raw/ENV01/emission-de-co2e-par-voyageur-kilometre-sur-le-reseau.csv` | `fc8f273c0be98ff7fbfeb55365508e31d83ac224eedf36c062889350b00bf7f9` | facteurs opérateurs 2019 et Base Carbone ADEME ; jeu mis à jour le 26/02/2024 ; relevé 2026-11-03T15:44Z | Licence Ouverte (fiche : docs/sources.md#env01) |
| SUB01 | `data/raw/SUB01/titres-et-tarifs.json` | `919c90f9043691bd8932f01f7727e61393242b02942dbeacc4571fba72e1fd12` | jeu modifié le 03/11/2026 à 19:00 UTC (champ modified des métadonnées) ; tarifs au 1er janvier 2026 selon les pages liées ; relevé 2026-11-04T10:05Z | Licence Ouverte (fiche : docs/sources.md#sub01) |
| SUB01 | `data/raw/SUB01/titres-et-tarifs_dataset.json` | `e5533660c83015e39c043b4b4010656cdc18a198c4fbac5357a3d8c78e8db80c` | métadonnées à la date d'extraction ; relevé 2026-11-04T10:05Z | Licence Ouverte (fiche : docs/sources.md#sub01) |
| SUB02 | `data/raw/SUB02/cgvu-du-forfait-navigo-annuel.html` | `fab1efc589bfdd5dc3ea34331fad1ccb2d23e4ee9dff4eba732ed014bd7952e3` | « Date d'entrée en vigueur : 24/06/2026 » (mention de la page) ; relevé 2026-11-04T10:10Z | document cité (fiche : docs/sources.md#sub02) |
| SUB02 | `data/raw/SUB02/cgvu-forfaits-navigo-mois-navigo-semaine.html` | `afb738abbcbe32ab617edab3732e4d703e4bb1a1abd4fd972e4523976cd14fa5` | version « Juin 2025 » (mention de la page, publiée le 30/12/2019 et mise à jour) ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub02) |
| SUB02 | `data/raw/SUB02/cgvu-imagine-r-etudiant-2026-2027.html` | `bf4236afa13c90c0793af54e2a977f822404f0b9d6b010ed502b80621c5c4ebd` | saison 2026-2027 (publiée le 09/10/2026) ; relevé 2026-11-04T10:10Z | document cité (fiche : docs/sources.md#sub02) |
| SUB02 | `data/raw/SUB02/cgvu-navigo-liberte.html` | `344c9f99ea1d8b23f04cc9c5b1978455eb26f796c4fa6eaa61a254ffa99e4a86` | « Date de validité : à partir de juin 2026 » (mention de la page) ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub02) |
| SUB02 | `data/raw/SUB02/cgvu-navigo-mois-semaine-v062025.pdf` | `5841b6147e318e25f340f8fd505f2878f5fff3bf38d6b22f2b53b0508aad410e` | version « Juin 2025 » (mention du document, nom de fichier v062025) ; PDF de 12 pages, métadonnées : créé le 23/07/2025 ; déposé le 05/11/2026 ; relevé 2026-11-05T08:29Z | document cité (fiche : docs/sources.md#sub02) |
| SUB03 | `data/raw/SUB03/forfait-amethyste.html` | `f93748dc8a0d96d72efa1b04ab2cd28916194232800f1fb41ce57b71605812ab` | aucune date affichée ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB03 | `data/raw/SUB03/forfait-imagine-r-etudiant.html` | `ef46fa22b200f1beb6e5eeb1a20cc027f27f241f65aec8678d2622078addefe1` | année 2026-2027 (mention) ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB03 | `data/raw/SUB03/forfait-imagine-r-junior.html` | `2af7a373dce481b5d78393167c9b6d5dc575a572f23d083a785ebb1bdf7620c2` | année 2026-2027 (mention) ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB03 | `data/raw/SUB03/forfait-navigo-annuel-tarification-senior.html` | `162c697564ebb864fdb31b2d35369cb28d2f85bb4d34395ee1624b5fcb837ff3` | tarifs applicables au 1er janvier 2026 (mention) ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB03 | `data/raw/SUB03/forfait-navigo-annuel.html` | `9916a9ac4d18f3f519d66ea8e82bac5c7ea24abbc69dc8801305752ab1e21af2` | tarifs applicables au 1er janvier 2026 (mention) ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB03 | `data/raw/SUB03/forfait-navigo-jour.html` | `682850824cf485e502529cf3082da0c82e09a0898622a98189629b44a82adc49` | aucune date affichée ; prix identique au jeu SUB01 ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB03 | `data/raw/SUB03/forfait-navigo-semaine.html` | `3e1864b579a2511d1234ed6ffc2950d77807d4998138712664678018548bd344` | tarifs applicables au 1er janvier 2026 (mention) ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB03 | `data/raw/SUB03/le-forfait-gratuite-jeunes-en-insertion.html` | `bf62a96ce3aa319ff294177b4387a5756ca9dd110d8fa92e85d25cac6ea6cb50` | aucune date affichée ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB03 | `data/raw/SUB03/liberte-plus.html` | `18270af51b5f70536c6bfce41100390f15dce26b79bb10eff863230a3cc87c3f` | tarifs applicables au 1er janvier 2026 (mention) ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB03 | `data/raw/SUB03/solidarite-75.html` | `d4622ef0cfec99c4cf1c857b649aa624dab8a170dc01ae568b2b5afe3c3b4244` | tarifs applicables au 1er janvier 2026 (mention) ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB03 | `data/raw/SUB03/ticket-bus-tram.html` | `c636d888a9530009506019a45e3e97acd1d23c6ac7673e6e286f13dd0565efec` | aucune date affichée ; relevé 2026-11-04T10:05Z | document cité (fiche : docs/sources.md#sub03) |
| SUB04 | `data/raw/SUB04/CGAU_CD_Ocotbre_2026.pdf` | `bca3c8cca597fff053eabe0773ed97deb6ab9c231c5c629fbd1d9f795c96cdda` | « Pour toute souscription à partir du 12 août 2025 » ; relevé 2026-11-04T10:00Z | document cité (fiche : docs/sources.md#sub04) |
| SUB04 | `data/raw/SUB04/CGAU_LD_Octobre_2026.pdf` | `61ea4f8ded5d27487d8b03c4fab2bc4c7a111ab88c4d02b0955e25172feaad3d` | « Pour toute souscription à partir du 12 août 2025 », « DATE DE DERNIERE MISE A JOUR : 28 juillet 2025 » ; relevé 2026-11-04T10:00Z | document cité (fiche : docs/sources.md#sub04) |
| SUB04 | `data/raw/SUB04/agemob-velib-le-velo-partage.html` | `c83be924fc4ff1787dcf0fac9a98357f2f375cbded2e99849118355de229f5ec` | page consultée le 05/11/2026 (aucune date de mise à jour affichée) ; relevé 2026-11-05T11:22Z | document cité (fiche : docs/sources.md#sub04) |
| SUB04 | `data/raw/SUB04/velib-grille-tarifaire.pdf` | `490ab129bf716cb1ddf397cce73790476fac537b200556e039cd5cba01a168ca` | « Tarifs valables pour toute souscription à partir du 12 août 2025 » ; relevé 2026-11-04T10:00Z | document cité (fiche : docs/sources.md#sub04) |
| SUB04 | `data/raw/SUB04/velib-offers.html` | `4279a4a0ac3f9d0b3809a0bb5cdec3e577f4d0051b1df313a67f3601dd02fab9` | tarifs pour toute souscription à partir du 12 août 2025 (grille et CGAU) ; relevé 2026-11-04T09:59Z | document cité (fiche : docs/sources.md#sub04) |
| SUB05 | `data/raw/SUB05/code-travail-l3261-2.html` | `054c4d4e7ac03a4b39a67fe65e0706989c62ee8b7baba753d1da0be014714b8b` | version en vigueur à la date d'extraction (texte repris de Légifrance par le site) ; identifiant Légifrance LEGIARTI000019950566, « Mis à jour le : 19/12/2008 » (mention de la page) ; relevé 2026-11-04T10:08Z | Licence Ouverte (fiche : docs/sources.md#sub05) |
| SUB05 | `data/raw/SUB05/code-travail-r3261-1.html` | `1056aaa9f3eed7c2ca496342b598db413e41a318ec7e77513b2a11eb06255d83` | version en vigueur à la date d'extraction (texte repris de Légifrance par le site) ; identifiant Légifrance LEGIARTI000020080272, « Mis à jour le : 01/01/2009 » (mention de la page) ; relevé 2026-11-04T10:08Z | Licence Ouverte (fiche : docs/sources.md#sub05) |
| SUB05 | `data/raw/SUB05/code-travail-r3261-2.html` | `c8e5709311ef718c7de47fad0b2a0612793959ec4dead63892720608eb0bb1a2` | version en vigueur à la date d'extraction (texte repris de Légifrance par le site) ; identifiant Légifrance LEGIARTI000020080269, « Mis à jour le : 01/01/2009 » (mention de la page) ; relevé 2026-11-04T10:08Z | Licence Ouverte (fiche : docs/sources.md#sub05) |
| SUB05 | `data/raw/SUB05/code-travail-r3261-3.html` | `ca19fd3ebe82149d2cb0a31f3764f98699f9955eb9d6d6389088239840b16d79` | version en vigueur à la date d'extraction (texte repris de Légifrance par le site) ; identifiant Légifrance LEGIARTI000020080267, « Mis à jour le : 01/01/2009 » (mention de la page) ; relevé 2026-11-04T10:08Z | Licence Ouverte (fiche : docs/sources.md#sub05) |
| SUB05 | `data/raw/SUB05/doctrine-bofip-BOI-RSA-CHAMP-20-30-10-20-20260407.html` | `1c95bb5e47c803c71bccd25d1f8f0fb8891d4fa01c7a22db75009faa7ebce202` | version du 07/04/2026 (identifiant du document) ; consultée le 05/11/2026 ; relevé 2026-11-05T11:22Z | Licence Ouverte + CRPA (fiche : docs/sources.md#sub05) |
| SUB05 | `data/raw/SUB05/service-public-F19846.html` | `d708aa283bbdcfcbd185441657345be413e171b102f984a39183aa169765e766` | « Vérifié le 28 octobre 2026 » (mention de la page) ; relevé 2026-11-04T10:08Z | Licence Ouverte (fiche : docs/sources.md#sub05) |
| COST01 | `data/raw/COST01/forfait-navigo-mois.html` | `4d1f9dabff437fbfd61fcdcde4109908327b78e78857ef90cfcd2d9194ee383a` | tarifs applicables au 1er janvier 2026 (mention de la page) ; relevé 2026-11-02T15:54Z | document cité (fiche : docs/sources.md#cost01) |

Dossiers de calcul (empreinte du `run_params.json`, détail des autres empreintes en section 3) :

| dossier | état | sha256 du run_params.json |
|---|---|---|
| `itineraries_walk3000_d031_b44` | complet (52 lots) | `b07c5731411069591371ae4b160f30810c244645804b1ed0578b2288cd989468` |
| `itineraries_walk1000_d031_b44` | complet (52 lots) | `732fda8b1abd2fca11cc612096b23881da6d4b5f16cc2287385baa2ce7866c17` |
| `itineraries_walk1000_d031_nuit_b44` | complet (52 lots) | `2755c418ca176d34e254d1086906d04e7c16ea7294bc18143a582f916681c5d0` |
| `itineraries_walk3000_d031_nuit_b44` | complet (52 lots) | `791d1ee951ea5feec6349c6806249a5578d897f7f5a033d70590900c015c4c8e` |

Sources du calcul (lues dans les `run_params.json` ci-dessus, rapprochées du manifeste par sha256) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk1000-d031-all.jar` | `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction d4d8cc49167338b77e15d04ce838aab69b422620 ; version écrite dans le jar : v7.5.1-r5py-walk1000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar` | `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction 3ea104d9912daa03a13911e2bf6a73e3a364328d ; version écrite dans le jar : v7.5.1-r5py-walk3000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| GEO02B | `data/processed/communes_idf_2026.csv` | `a5ccd3bcbb8febb313c3a0c55adcd5091d5223f5c8490a8e386c416bd2b15fc1` | dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026) ; relevé 2026-11-03T09:31Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo02b) |
| TRA01B | `data/raw/TRA01B/gtfs_nuit-0611.zip` | `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du lundi 16/11/2026 qui passent minuit ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01b) |
| TRA02C | `data/processed/navitia_same_stop_min_recalc_d031.csv (réponses : data/interim/navitia_cache/connections_*.json)` | `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) ; service 2026-11-17 ; relevé 2026-11-04T10:02Z | Licence Mobilités + CGU PRIM (fiche : docs/sources.md#tra02c) |

### B08 : Voiture et deux-roues : coût d'énergie, carbone, péages, trafic moyen

- **Composants** : `proof/ProofCarCost.tsx`, `proof/ProofTraffic.tsx`, `proof/ModeTripBlock.tsx`
- **Nature** : distance routière r5py (OSM) x consommation et prix publiés ; péages lus dans les tarifs officiels
- **Ligne du mode sources** :
  - `proof/ProofCarCost.tsx` : ProvenanceNote
  - `proof/ProofTraffic.tsx` : CodeSourceNote
  - `proof/ModeTripBlock.tsx` : couverte par la ligne de proof/ProofCarCost.tsx
- **Formule (lue dans le code)** :
  - `pipeline/starway/vehicles.py` : Coût d'énergie et carbone d'un trajet motorisé par véhicule (demandes de l'équipe du 03 et du 04/11/2026).
  - `pipeline/starway/congestion.py` : Voiture avec le trafic moyen mesuré par la DiRIF (demande de l'équipe du 03/11/2026).
  - `pipeline/starway/toll_publish.py` : Péages des trajets voiture et deux-roues publiés pour le front (tolls.json et `car_trip.toll`).
  - `pipeline/starway/tolls.py` : Points et tronçons de péage de l'OSM (CYC01) traversés par un chemin voiture R5 (04g, préparation du coût péage).
  - `pipeline/starway/car_dist.py` : Distances routières voiture (04g) : commune (point) <-> pôle (point d'ancrage), aller et retour.
- **Scripts** : `pipeline/scripts/04g_car_distances.py`, `pipeline/scripts/04i_osm_toll_points.py`, `pipeline/scripts/04j_toll_tariffs.py`, `pipeline/scripts/04k_toll_crosscheck.py`, `pipeline/scripts/06k_export_tolls.py`
- **Tests** : `pipeline/tests/test_car_dist.py`, `pipeline/tests/test_tolls.py`, `pipeline/tests/test_toll_publish.py`, `pipeline/tests/test_toll_crosscheck.py`, `pipeline/tests/test_congestion_vehicles.py`, `frontend/src/data/congestion.test.ts`, `frontend/src/data/tolls.test.ts`, `frontend/src/components/proof/ProofCarCost.test.ts`, `frontend/src/data/costBreakdown.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| COST08 | `data/raw/COST08/sdes_bilan_transports_2024.pdf` | `ecc775545f3b036ef9ccc6a15c9db816bf341c456118480976dd712008223d05` | 2024 (publié le 25/11/2025) ; relevé 2026-11-03T22:06Z | Licence Ouverte (fiche : docs/sources.md#cost08) |
| COST08 | `data/raw/COST08/sdes_bilan_transports_2024_circulation.xlsx` | `0adcff08b56a6d6373bf911ac09bfeaf2b66151f55a204e606f1416f4124bbb0` | 2024 (données arrêtées au 25/11/2025, publication du 25/11/2025) ; relevé 2026-11-03T22:05Z | Licence Ouverte (fiche : docs/sources.md#cost08) |
| VEH01 | `data/raw/VEH01/2023-09_ademe-2rm-maj-connaissances-consommations-emissions-echappement.pdf` | `b15abe37670367ed3e440f5ddee55988ec4c6b1e8885ecbc5d8bc72223d73a31` | 2023 ; relevé 2026-11-04 | document cité (à confirmer) (fiche : docs/sources.md#veh01) |
| COST06 | `data/raw/COST06/260715_2026-147_TRVE.pdf` | `60947d14a51a54476cb159696ba8d96fbb1fdaeee6c06d6c674b14eb5c141605` | 15/07/2026 (mouvement au 1er août 2026) ; relevé 2026-11-03T22:08Z | document cité (fiche : docs/sources.md#cost06) |
| COST06 | `data/raw/COST06/Grille_prix_Tarif_Bleu.pdf` | `827c17c1ffcd66cce5611a0673a03a27c07a0c82d0cbd4560fa1f4cdbcd23494` | tarif applicable au 1er août 2026 (mention du document) ; mouvement proposé par la CRE, délibération n° 2026-147 du 15/07/2026 ; relevé 2026-11-03T22:08Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#cost06) |
| COST06 | `data/raw/COST06/JORF_20260731-003333.tar.gz` | `4524039663ff25ed7edd660be239cf1ecc583b2ceb87e4464e43f25ad837ab5b` | décision du 29/07/2026, publiée le 31/07/2026, en vigueur le 01/08/2026 (article 2) ; relevé 2026-11-05T11:00Z | Licence Ouverte (fiche : docs/sources.md#cost06) |
| COST07 | `data/raw/COST07/prix-carburants-flux-instantane-v2.csv` | `4714b7dd63420734091653df995a25796ad6e5e7c95769f656aec8e18b615c03` | relevé instantané à la date d'extraction ; chaque prix porte sa date de mise à jour (colonnes *_maj) ; relevé 2026-11-03T22:08Z | Licence Ouverte (fiche : docs/sources.md#cost07) |
| ENV02 | `data/raw/ENV02/Base_Carbone_V23.6.csv` | `01472bc24743c0265b649407508dfce896f15a5c11c0f612f6b47a5625b02653` | Base Carbone V23.6 (fichier du 03/07/2025) ; relevé 2026-11-04T10:00Z | Licence Ouverte (fiche : docs/sources.md#env02) |
| ENV02 | `data/raw/ENV02/dataset-metadata.json` | `4035b932c1aa7c911632b45b44a8c845fc166c6994dfd65122e842c5d7f0f28e` | Base Carbone V23.6 (fichier du 03/07/2025) ; relevé 2026-11-04T10:00Z | Licence Ouverte (fiche : docs/sources.md#env02) |
| CYC01 | `data/raw/CYC01/ile-de-france-latest.osm.pbf` | `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf ; relevé 2026-11-02T14:20Z | ODbL (fiche : docs/sources.md#cyc01) |
| TOLL01 | `data/raw/TOLL01/autoroutes-free-flow-fr-25-10-2025.geojson` | `00a58136f5c142d5fa37f0faca177472142496f996bafda07aee7301bc368a6b` | version du 03/11/2026 (portiques) ; cartographie du 25/10/2025 ; relevé 2026-11-03T21:46Z | Licence Ouverte (fiche : docs/sources.md#toll01) |
| TOLL01 | `data/raw/TOLL01/dataset-metadata.json` | `2d974e16fc2f91e3c53298b978ee4329ff941d7a383cad427290ea0428129409` | version du 03/11/2026 (portiques) ; cartographie du 25/10/2025 ; relevé 2026-11-03T21:46Z | Licence Ouverte (fiche : docs/sources.md#toll01) |
| TOLL01 | `data/raw/TOLL01/portiques-free-flow-03-11-2026.csv` | `e59032121e97123ff855646a204760c213fd1dac83dcca6ba2151795aa9261d4` | version du 03/11/2026 (portiques) ; cartographie du 25/10/2025 ; relevé 2026-11-03T21:46Z | Licence Ouverte (fiche : docs/sources.md#toll01) |
| TOLL02 | `data/raw/TOLL02/TARIFS_APRR-2026-02.pdf` | `f05dfa58cb4ffba8b940b95319186fbf60f86d3791dce6a9df0919946b635d14` | en vigueur au 1er février 2026 ; relevé 2026-11-03T21:47Z | Licence Ouverte + document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll02) |
| TOLL02 | `data/raw/TOLL02/aprr-systemes-ouverts-2026.pdf` | `bb8b8bf52e0a4383df659453db80c187c60a76738fffbce316618d5af7768e9b` | en vigueur au 1er février 2026 ; relevé 2026-11-03T21:47Z | Licence Ouverte + document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll02) |
| TOLL02 | `data/raw/TOLL02/aprr-tarifs-2026-02.csv` | `29557dd814525a36313c5794b8cdc2a60ac3b894f3929912553a81d74054a4fe` | en vigueur au 1er février 2026 ; relevé 2026-11-03T21:46Z | Licence Ouverte + document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll02) |
| TOLL02 | `data/raw/TOLL02/aprr-tarifs-de-peage.html` | `65f84860178411daa7311c34408b60695a5a8d2a3c9f350b8ba734404271b9ac` | en vigueur au 1er février 2026 ; relevé 2026-11-03T21:47Z | Licence Ouverte + document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll02) |
| TOLL02 | `data/raw/TOLL02/dataset-metadata.json` | `7dd5f6ac09d74bde3a96f66df5b5c65533de420658e858858e8475d11e607f73` | en vigueur au 1er février 2026 ; relevé 2026-11-03T21:46Z | Licence Ouverte + document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll02) |
| TOLL03 | `data/raw/TOLL03/2026_02-Grille-SAPN.pdf` | `f8a7468306f5c9979040c40c04db3ce6f910d4e7cb0c79311b447465c08a58d4` | en vigueur au 1er février 2026 ; relevé 2026-11-05T08:47Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll03) |
| TOLL03 | `data/raw/TOLL03/2026_02-Grille-Sanef.pdf` | `373b55bd4f4ff77d995f8ff26c543807478252fc13d79cb9f73b024fbd17bc66` | en vigueur au 1er février 2026 ; relevé 2026-11-05T08:47Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll03) |
| TOLL03 | `data/raw/TOLL03/JORF_20260130-002723.tar.gz` | `fa3d131c05b1b6775c0b711f266f24513f392659b354df7f47b33c4e09e4c59d` | JORF n° 0025 du 30/01/2026, tarifs à compter du 1er février 2026 ; relevé 2026-11-03T22:13Z | Licence Ouverte (fiche : docs/sources.md#toll03) |
| TOLL03 | `data/raw/TOLL03/dataset-metadata-jorf.json` | `e6c2c1c8abcbb60307a64e722ec3c42785bc1e327275aea1c1fd8e0c1f3c3ffc` | JORF n° 0025 du 30/01/2026, tarifs à compter du 1er février 2026 ; relevé 2026-11-03T22:22Z | Licence Ouverte (fiche : docs/sources.md#toll03) |
| TOLL03 | `data/raw/TOLL03/grille-modulee-01022026.pdf` | `5cf0e4221c149a441f530e108c006b24d002f24ec83b244c27560221b49bd87c` | en vigueur au 1er février 2026 ; relevé 2026-11-05T08:53Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll03) |
| TOLL03 | `data/raw/TOLL03/jorf_TRAT2600882A/JORFARTI000053417655.xml` | `99802586fb26819b715740524552fa765dadafefafb6a8519fc994a00dcf2ab7` | JORF n° 0025 du 30/01/2026, tarifs à compter du 1er février 2026 ; relevé 2026-11-03T22:13Z | Licence Ouverte (fiche : docs/sources.md#toll03) |
| TOLL03 | `data/raw/TOLL03/jorf_TRAT2600882A/JORFARTI000053417658.xml` | `3aa28274ce9200a20047341f0c20893e00d5ba5981ddf144d2a5132f0b3df808` | JORF n° 0025 du 30/01/2026, tarifs à compter du 1er février 2026 ; relevé 2026-11-03T22:13Z | Licence Ouverte (fiche : docs/sources.md#toll03) |
| TOLL03 | `data/raw/TOLL03/jorf_TRAT2600882A/JORFARTI000053417659.xml` | `7be20138b6f34e266df5aa82fd680515fe3ac7586e6ca085b9527876b5b0a218` | JORF n° 0025 du 30/01/2026, tarifs à compter du 1er février 2026 ; relevé 2026-11-03T22:13Z | Licence Ouverte (fiche : docs/sources.md#toll03) |
| TOLL03 | `data/raw/TOLL03/jorf_TRAT2600882A/JORFTEXT000053417647.xml` | `527d69e61fcfeb1f7a75f8e97c825f61a3fe2ff969f7320afcf750ae52d8dac2` | JORF n° 0025 du 30/01/2026, tarifs à compter du 1er février 2026 ; relevé 2026-11-03T22:13Z | Licence Ouverte (fiche : docs/sources.md#toll03) |
| TOLL04 | `data/raw/TOLL04/Cofiroute-Guide-tarifaire-2026.pdf` | `d8443adcc6f037e87a7f1b5c42730081e7ef45d78b45bffa0d72edd7c3ee433a` | Duplex A86 : tarifs TTC au 01/01/2026 ; Cofiroute : tarifs au 1er février 2026 ; relevé 2026-11-03T21:54Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll04) |
| TOLL04 | `data/raw/TOLL04/Tarifs-Duplex-2026.pdf` | `88b776f5562ee71ed51cb9f73fa32703aa0d174890b7e1a56a4f727c149e2c0c` | Duplex A86 : tarifs TTC au 01/01/2026 ; Cofiroute : tarifs au 1er février 2026 ; relevé 2026-11-03T21:54Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll04) |
| TOLL04 | `data/raw/TOLL04/Tarifs_A86.txt` | `5fc381b5392c17afc205deb1c49812491113c81a829b90584c66c2cff48c1ab6` | Duplex A86 : tarifs TTC au 01/01/2026 ; Cofiroute : tarifs au 1er février 2026 ; relevé 2026-11-03T21:54Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll04) |
| TOLL04 | `data/raw/TOLL04/Tarifs_Cofiroute_Arcour.txt` | `4bb7c667e5c99218931cf6b81f3ebc13d9ee477543772cf251229ff32bad646c` | Duplex A86 : tarifs TTC au 01/01/2026 ; Cofiroute : tarifs au 1er février 2026 ; relevé 2026-11-03T21:54Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll04) |
| TOLL04 | `data/raw/TOLL04/communique-de-presse_evolution-tarifs-duplex-a86-2026_vdef2.pdf` | `b3a268594f8c69fb0d89cd75e6933eebf2f403b7834121822788fdcfecac3444` | Duplex A86 : tarifs TTC au 01/01/2026 ; Cofiroute : tarifs au 1er février 2026 ; relevé 2026-11-03T22:02Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll04) |
| TOLL04 | `data/raw/TOLL04/ulys-autoroute-a86.html` | `f39d3db9bd314fd2d5537e7604d289d6caf98b67091aa7020091edca3b994a83` | Duplex A86 : tarifs TTC au 01/01/2026 ; Cofiroute : tarifs au 1er février 2026 ; relevé 2026-11-03T22:03Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll04) |
| TOLL04 | `data/raw/TOLL04/vinci-tarifs-page-data.json` | `ab3dff50d23834292bc9933c7c67700d9d4f7b6fe180f157b41cbc0ee78981b0` | Duplex A86 : tarifs TTC au 01/01/2026 ; Cofiroute : tarifs au 1er février 2026 ; relevé 2026-11-03T21:54Z | document cité + accord de l'organisateur du hackathon (fiche : docs/sources.md#toll04) |
| TOLL05 | `data/raw/TOLL05/dataset-metadata.json` | `c1ae3339c111d9a042f8d4641a312e5f24f1cea53d5c1b7fc3ca528489d7ffe2` | référentiel au 01/01/2025 ; relevé 2026-11-03T21:52Z | ODC-BY (fiche : docs/sources.md#toll05) |
| TOLL05 | `data/raw/TOLL05/gares-peage-2025.csv` | `e70ebf3d57c550eb8e0b9583aba697273b6089d72bdfd2515a595248e18937ec` | référentiel au 01/01/2025 ; relevé 2026-11-03T21:52Z | ODC-BY (fiche : docs/sources.md#toll05) |
| ROAD01 | `data/raw/ROAD01/barometre_mensuel_no41-_novembre_2025.pdf` | `9018fb3bdf78d816e062a67dfb9e5e6fc6006339e5d5da78daac10883870f800` | novembre 2025 (jours ouvrés, hors week-ends et jours fériés) ; relevé 2026-11-03T22:00Z | Licence Ouverte (fiche : docs/sources.md#road01) |
| ROAD01 | `data/raw/ROAD01/barometre_mensuel_page-liste-2025.html` | `e42e0b9bf08c695e527d0c5be9ff428a21ba191182efe485f7e0ff5ede672c2c` | page consultée le 05/11/2026 (liste des numéros de l'année 2025) ; relevé 2026-11-05T11:06Z | Licence Ouverte (fiche : docs/sources.md#road01) |

Dossiers de calcul (empreinte du `run_params.json`, détail des autres empreintes en section 3) :

| dossier | état | sha256 du run_params.json |
|---|---|---|
| `matrix_modes_b44` | complet (13 lots x 3 scénarios) | `7a4a3c910fd4dc95269aa6784680ee2aced06f26868a35337b1d63b9eecc10e3` |
| `car_dist_carspeed_v2_b44` | complet (13 lots sur 13) | `bf78c98e365cfc3b4c2c30ed12987a8591d228c8c6f8d8f1b1db8bb83c0faa47` |

Sources du calcul (lues dans les `run_params.json` ci-dessus, rapprochées du manifeste par sha256) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| ENG01 | `%LOCALAPPDATA%\r5py\r5-v7.5.1-r5py-all.jar (poste) ; ~/.cache/r5py/r5-v7.5.1-r5py-all.jar (VM de calcul)` | `d50be106cadd7b636cfc0e209052767d7df570629f79fdf98ecd5cf5d2d89be7` | R5 v7.5.1 (tag v7.5.1-r5py ; Last-Modified HTTP du jar : 08/05/2026 15:27 GMT) ; relevé 2026-11-03T09:12Z | MIT (fiche : docs/sources.md#eng01) |
| GEO02B | `data/processed/communes_idf_2026.csv` | `a5ccd3bcbb8febb313c3a0c55adcd5091d5223f5c8490a8e386c416bd2b15fc1` | dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026) ; relevé 2026-11-03T09:31Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo02b) |
| GEO04B | `data/processed/poles_d030.json` | `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | dérivé de GEO04 (bassins d'emploi 2026), EMP01 (Flores 2023, postes salariés recensés par l'INSEE), GEO01 (géographie des communes 2026) et TRA01 (arrêts les plus desservis le 17/11/2026) ; service 2026-11-17 ; relevé 2026-11-04T10:49Z | ODbL + Licence Mobilités + Licence Ouverte + CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#geo04b) |
| TRA01 | (aucune ligne au manifeste) | - | - | - |

### B09 : Mes besoins : accessibilité déclarée par les sources sur le trajet, marque sur le ciel

- **Composants** : `proof/ProofNeeds.tsx`, `needs/NeedsMarks.tsx`
- **Nature** : recopie de ce que déclarent TRA03 et TRA04 ; jamais « trajet accessible »
- **Ligne du mode sources** :
  - `proof/ProofNeeds.tsx` : NeedsSourceNote, NeedsMethodNote
  - `needs/NeedsMarks.tsx` : aucune ligne (exemptée : Calque décoratif (losanges au bord des astres, aria-hidden) : aucun chiffre ni donnée affichés. Ce que déclarent les sources (GTFS IDFM, référentiel des lignes, accessibilité en gare) est cité par la légende et par le panneau de preuve (ProofNeeds.tsx), avec leurs dates.)
- **Formule (lue dans le code)** :
  - `pipeline/starway/needs.py` : Réglage « Mes besoins » (04/11/2026) : ce que disent les sources ouvertes sur l'accessibilité de chaque tronçon en TC des itinéraires publiés. Logique pure, testée dans tests/test_needs.py ; appliquée par 06n.
  - `pipeline/starway/needs.py:star_marked` : L'astre est-il marqué ? Seulement si, parmi les cases cochées 1, 2 et 3 (`SKY_BOXES`), TOUTES sont déclarées remplies sur tout le trajet le plus rapide, ALLER ET RETOUR. Aucune case 1 à 3 cochée (seulement 4 et 5, ou rien) : jamais de marque. Un sens sans tronçon en TC (marche seule) ou absent : pas de marque. Sans gare ferrée, la case 3 n'empêche pas la marque.
- **Scripts** : `pipeline/scripts/06n_export_needs.py`, `pipeline/scripts/07n_needs_measure.py`
- **Tests** : `pipeline/tests/test_needs.py`, `frontend/src/data/needs.test.ts`, `frontend/src/data/needsSky.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| TRA01 | `data/raw/TRA01/IDFM-gtfs-0611.zip` | `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt) ; service 2026-11-17 (mardi ordinaire, 144948 courses actives) ; relevé 2026-11-06T15:11Z | Licence Mobilités (fiche : docs/sources.md#tra01) |
| TRA03 | `data/raw/TRA03/referentiel-des-lignes.csv` | `4ae8d76054aca4924ee44a4ea45ccade257f1d13b3c26c626473bac1d67ed603` | instantané du 03/11/2026 (jeu mis à jour chaque jour) ; relevé 2026-11-03T15:44Z | ODbL (fiche : docs/sources.md#tra03) |
| TRA04 | `data/raw/TRA04/accessibilite-en-gare.csv` | `931a00848e2079f64adab7651bab43bd4ee32e685d2d5865763ebf7a61480c3c` | jeu modifié le 06/07/2026 ; relevé 2026-11-03T15:44Z | Licence Ouverte (fiche : docs/sources.md#tra04) |

Dossiers de calcul (empreinte du `run_params.json`, détail des autres empreintes en section 3) :

| dossier | état | sha256 du run_params.json |
|---|---|---|
| `itineraries_walk3000_d031_b44` | complet (52 lots) | `b07c5731411069591371ae4b160f30810c244645804b1ed0578b2288cd989468` |
| `itineraries_walk1000_d031_b44` | complet (52 lots) | `732fda8b1abd2fca11cc612096b23881da6d4b5f16cc2287385baa2ce7866c17` |
| `itineraries_walk1000_d031_nuit_b44` | complet (52 lots) | `2755c418ca176d34e254d1086906d04e7c16ea7294bc18143a582f916681c5d0` |
| `itineraries_walk3000_d031_nuit_b44` | complet (52 lots) | `791d1ee951ea5feec6349c6806249a5578d897f7f5a033d70590900c015c4c8e` |

Sources du calcul (lues dans les `run_params.json` ci-dessus, rapprochées du manifeste par sha256) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| CYC01 | `data/raw/CYC01/ile-de-france-latest.osm.pbf` | `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf ; relevé 2026-11-02T14:20Z | ODbL (fiche : docs/sources.md#cyc01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk1000-d031-all.jar` | `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction d4d8cc49167338b77e15d04ce838aab69b422620 ; version écrite dans le jar : v7.5.1-r5py-walk1000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar` | `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction 3ea104d9912daa03a13911e2bf6a73e3a364328d ; version écrite dans le jar : v7.5.1-r5py-walk3000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| GEO02B | `data/processed/communes_idf_2026.csv` | `a5ccd3bcbb8febb313c3a0c55adcd5091d5223f5c8490a8e386c416bd2b15fc1` | dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026) ; relevé 2026-11-03T09:31Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo02b) |
| TRA01B | `data/raw/TRA01B/gtfs_nuit-0611.zip` | `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du lundi 16/11/2026 qui passent minuit ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01b) |
| TRA02C | `data/processed/navitia_same_stop_min_recalc_d031.csv (réponses : data/interim/navitia_cache/connections_*.json)` | `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) ; service 2026-11-17 ; relevé 2026-11-04T10:02Z | Licence Mobilités + CGU PRIM (fiche : docs/sources.md#tra02c) |

### B10 : Projets de recrutement BMO du bassin d'emploi (tendance, jamais des offres)

- **Composants** : `recruit/ProofRecruit.tsx`
- **Nature** : statistique de l'enquête BMO 2026 de France Travail, aucun calcul de trajet
- **Ligne du mode sources** :
  - `recruit/ProofRecruit.tsx` : CodeSourceNote(EMP03), BassinSourceNote, BmoMethodNote
- **Formule (lue dans le code)** :
  - `pipeline/starway/bmo.py` : Projets de recrutement de l'enquête BMO 2026 de France Travail (EMP03), par bassin d'emploi (GEO04).
  - `pipeline/starway/bmo.py:build_export` : Contrats `bmo-1` (familles et totaux par bassin, chargé par le panneau de preuve) et `bmo-metiers-1` (détail par métier, chargé à la demande : visite guidée, étape recrutement non activée). `evidence` : `mask_evidence()`.
- **Scripts** : `pipeline/scripts/06j_export_bmo.py`
- **Tests** : `pipeline/tests/test_bmo.py`, `frontend/src/components/recruit/ProofRecruit.test.ts`, `frontend/src/data/bmo.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| EMP03 | `data/raw/EMP03/Base-open-data-BMO-2026.xlsx` | `735d0443b799b4c18c145055f87244a355a48b6286ee98ddbab272491d9792e0` | 2026 (enquête d'octobre à décembre 2025 ; ressource data.gouv.fr modifiée le 21/04/2026) ; relevé 2026-11-03T15:38Z | Licence Ouverte (fiche : docs/sources.md#emp03) |
| EMP03 | `data/raw/EMP03/Eclairages-et-syntheses-87-BMO-2026.pdf` | `e7b7cc1a61b265d759be07c9405be15acd3ac2c05fb513c4eae9873c9b4526b8` | 2026 (publication d'avril 2026 ; Last-Modified HTTP : 20/04/2026 15:16 GMT) ; relevé 2026-11-04T21:24Z | CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#emp03) |
| GEO04 | `data/raw/GEO04/Bassins_d_emploi_2026_lu_2026-11-03.xlsx` | `3c7f5048491b90d21cfb16afdacb98f60b03a127b34bc871fd09fa41c09da455` | 2026 (bassins d'emploi 2026 ; Last-Modified HTTP : 17/04/2026 08:43 GMT) ; relevé 2026-11-03T22:13Z | Licence Ouverte + CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#geo04) |

Aucun dossier de calcul r5py : donnée statistique ou géographique lue directement dans les sources ci-dessus.

### B11 : Offres diffusées sur « Choisir le service public » (bloc à part)

- **Composants** : `proof/ProofPublicOffers.tsx`
- **Nature** : offres en ligne à la date du fichier DGAFP, jamais ajoutées aux postes salariés recensés par l'INSEE
- **Ligne du mode sources** :
  - `proof/ProofPublicOffers.tsx` : CodeSourceNote(EMP04)
- **Formule (lue dans le code)** :
  - `pipeline/starway/service_public.py` : Offres diffusées sur « Choisir le service public » (DGAFP, EMP04) : offres EN LIGNE à la date du fichier, rattachées à une commune quand le code postal le permet sans ambiguïté. Logique pure, testée dans tests/test_service_public.py ; appliquée par scripts/06q_export_service_public.py.
  - `pipeline/starway/service_public.py:build_offers` : Offres en ligne d'Île-de-France, UNE par référence, et le détail des comptes.
- **Scripts** : `pipeline/scripts/06q_export_service_public.py`
- **Tests** : `pipeline/tests/test_service_public.py`, `frontend/src/components/proof/ProofPublicOffers.test.ts`, `frontend/src/data/publicOffers.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| EMP04 | `data/raw/EMP04/documentation.pdf` | `5c65f064f39b37be05423363f122d553b2f4f28aafe5f1221df18ca3b3104fe9` | documentation du 10/01/2023 (ressource data.gouv.fr) ; relevé 2026-11-05T11:01Z | Licence Ouverte (fiche : docs/sources.md#emp04) |
| EMP04 | `data/raw/EMP04/offres-datagouv-20261011.csv` | `5c6ec5c17eb6e6ce537bcf180ffd91a0fbfbee58ed655f46467a407dde87570c` | fichier du 11/10/2026 (ressource data.gouv.fr déposée le 02/11/2026) ; la fiche du jeu annonce une couverture temporelle 2021-2023 alors que le fichier va jusqu'à 2026 (écart documenté dans les limites du projet) ; relevé 2026-11-05T11:01Z | Licence Ouverte (fiche : docs/sources.md#emp04) |
| EMP04 | `data/raw/EMP04/referentiels-csp.xlsx` | `4d35696c27da914169077f83e6bbc5f0c850a9ab8f7e3f16b59a3fedf1ad7ad0` | référentiels du 24/04/2023 (ressource data.gouv.fr) ; relevé 2026-11-05T11:01Z | Licence Ouverte (fiche : docs/sources.md#emp04) |

Aucun dossier de calcul r5py : donnée statistique ou géographique lue directement dans les sources ci-dessus.

### B12 : Postes salariés (INSEE) et flux domicile-travail du recensement vers l'astre

- **Composants** : `proof/ProofJobs.tsx`
- **Nature** : statistique INSEE (Flores, recensement par sondage), aucun calcul de trajet
- **Ligne du mode sources** :
  - `proof/ProofJobs.tsx` : JobsSourceNote, FlowsSourceNote
- **Formule (lue dans le code)** :
  - `pipeline/starway/context.py:flows_block` : Bloc `flows_to_poles` du contrat context/{insee}.json : `poles` = objet indexé par id de pôle (ordre de poles.json), chaque entrée {flux, share_pct, precision}.
  - `frontend/src/data/proof.ts:flowToPole` : Actifs occupés de la commune qui travaillent déjà dans le pôle (clé `flows_to_poles` de context/{insee}.json). Lecture tolérante (objet par pôle ou liste) ; null si absent ou non diffusable.
- **Scripts** : `pipeline/scripts/03_build_jobs_poles.py`, `pipeline/scripts/05_build_context.py`
- **Tests** : `pipeline/tests/test_context.py`, `frontend/src/data/context.test.ts`, `frontend/src/data/flows44.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| EMP01 | `data/raw/EMP01/DS_FLORES_2023_CSV_FR.zip` | `ab6b5c9de823439e8815e426e9a44adf79bd8d9c33c6c5645437ce3d279dfc5c` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/aide_lecture_flores.zip` | `cd043ddabd2bc361a5faeaf71c943182753db9e74b91a89f51ecb9a0008afb95` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/table_passage_flores.zip` | `69d76549e82ef88a453c7411736c3cd658d33c59e46c392c72e72d978c4fedf7` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP02 | `data/raw/EMP02/base-flux-mobilite-domicile-lieu-travail-2023_csv.zip` | `ab658d314dca0ad7e15aa21cf50deca8153c29d86c8a9adb95cb4b5a8d68a25c` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#emp02) |
| EMP02 | `data/raw/EMP02/fiche-depl-dom-travail.pdf` | `dc04b079e3100d6ee9d3d050fbd5abe8a7eb25f98e705914512f5db89277ca3e` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#emp02) |
| EMP02 | `data/raw/EMP02/page-8998300.html` | `beda2bb83df1fdb28e51f271766c03cce9eb29607f02a46a3e224a4269103088` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T18:53Z | Licence Ouverte (fiche : docs/sources.md#emp02) |

Aucun dossier de calcul r5py : donnée statistique ou géographique lue directement dans les sources ci-dessus.

### B13 : Découvertes du jour et contraste

- **Composants** : `Insights.tsx`, `ContrastOfTheDay.tsx`
- **Nature** : scénarios remarquables détectés dans la table commune x commune agrégée par astre
- **Ligne du mode sources** :
  - `Insights.tsx` : SkySourceNote
  - `ContrastOfTheDay.tsx` : SkySourceNote
- **Formule (lue dans le code)** :
  - `pipeline/starway/insights_astres.py` : Découvertes (insights.json) des 44 astres, calculées sur la table commune x commune.
  - `pipeline/starway/insights.py` : Découvertes (insights.json) : scénarios remarquables détectés dans la matrice calculée.
- **Scripts** : `pipeline/scripts/08e_insights_astres.py`, `pipeline/scripts/07d_navitia_crosscheck.py`
- **Tests** : `pipeline/tests/test_insights_astres.py`, `pipeline/tests/test_insights.py`, `frontend/src/data/insights.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| EMP01 | `data/raw/EMP01/DS_FLORES_2023_CSV_FR.zip` | `ab6b5c9de823439e8815e426e9a44adf79bd8d9c33c6c5645437ce3d279dfc5c` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/aide_lecture_flores.zip` | `cd043ddabd2bc361a5faeaf71c943182753db9e74b91a89f51ecb9a0008afb95` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/table_passage_flores.zip` | `69d76549e82ef88a453c7411736c3cd658d33c59e46c392c72e72d978c4fedf7` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| TRA01 | `data/raw/TRA01/IDFM-gtfs-0611.zip` | `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt) ; service 2026-11-17 (mardi ordinaire, 144948 courses actives) ; relevé 2026-11-06T15:11Z | Licence Mobilités (fiche : docs/sources.md#tra01) |
| CYC01 | `data/raw/CYC01/ile-de-france-latest.osm.pbf` | `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf ; relevé 2026-11-02T14:20Z | ODbL (fiche : docs/sources.md#cyc01) |
| GEO04 | `data/raw/GEO04/Bassins_d_emploi_2026_lu_2026-11-03.xlsx` | `3c7f5048491b90d21cfb16afdacb98f60b03a127b34bc871fd09fa41c09da455` | 2026 (bassins d'emploi 2026 ; Last-Modified HTTP : 17/04/2026 08:43 GMT) ; relevé 2026-11-03T22:13Z | Licence Ouverte + CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#geo04) |

Dossiers de calcul (empreinte du `run_params.json`, détail des autres empreintes en section 3) :

| dossier | état | sha256 du run_params.json |
|---|---|---|
| `od_walk3000_d031` | complet (run_params.json présent) | `cad45fe04d54e5731ed357e0669c73d737289a41b52ff9620a6ef26dec7ed97e` |
| `od_walk1000_d031` | complet (run_params.json présent) | `4c033d14312cda1d99922e773e5c52bfc86fb269e7ad67d0cd800a39e04dabf2` |
| `od_walk1000_d031_nuit_matin` | complet (run_params.json présent) | `d3370f63fd3f8fd74fd68ae62629bf29e5e6eff3a8bc93fbe0920a82fb8c1afd` |
| `od_walk1000_d031_nuit_soir_v2` | complet (run_params.json présent) | `ab57613dc6a498b122f202a6d3b5342bfb87ee12478d5a8d24c5a0cee7e3879a` |
| `od_walk3000_d031_nuit_matin` | complet (run_params.json présent) | `6a8c6d1da0b7061d0877b2ff21af020b381fb17523c31aa352c1954b8cc5f240` |
| `od_walk3000_d031_nuit_soir_v2` | complet (run_params.json présent) | `f2eb87168a66e187b0d63a429e772e3925bed31e152306a4c0c308baf7b89d35` |

Sources du calcul (lues dans les `run_params.json` ci-dessus, rapprochées du manifeste par sha256) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk1000-d031-all.jar` | `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction d4d8cc49167338b77e15d04ce838aab69b422620 ; version écrite dans le jar : v7.5.1-r5py-walk1000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar` | `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction 3ea104d9912daa03a13911e2bf6a73e3a364328d ; version écrite dans le jar : v7.5.1-r5py-walk3000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| GEO02B | `data/processed/communes_idf_2026.csv` | `a5ccd3bcbb8febb313c3a0c55adcd5091d5223f5c8490a8e386c416bd2b15fc1` | dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026) ; relevé 2026-11-03T09:31Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo02b) |
| TRA01B | `data/raw/TRA01B/gtfs_nuit-0611.zip` | `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du lundi 16/11/2026 qui passent minuit ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01b) |
| TRA01C | `data/raw/TRA01C/gtfs_soir-0611.zip` | `bf02daf3b8c051b6e0d3446a7b905c66140ba0938eb21f9b2e16a6a4a85c2feb` | dérivé de TRA01B puis de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du mercredi 18/11/2026 parties avant 3h et recodées 24h plus tard ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01c) |
| TRA02C | `data/processed/navitia_same_stop_min_recalc_d031.csv (réponses : data/interim/navitia_cache/connections_*.json)` | `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) ; service 2026-11-17 ; relevé 2026-11-04T10:02Z | Licence Mobilités + CGU PRIM (fiche : docs/sources.md#tra02c) |

### B14 : Halo « Derrière notre étoile » : âge, modes de transport par sexe, niveau de vie

- **Composants** : `HaloPanel.tsx`, `HaloAstrolabe.tsx`, `HaloDotPlot.tsx`, `IncomeRanks.tsx`
- **Nature** : statistique INSEE (recensement, Filosofi) de la commune, secret statistique respecté
- **Ligne du mode sources** :
  - `HaloPanel.tsx` : HaloSourceNote
  - `HaloAstrolabe.tsx` : couverte par la ligne de HaloPanel.tsx
  - `HaloDotPlot.tsx` : couverte par la ligne de HaloPanel.tsx
  - `IncomeRanks.tsx` : couverte par la ligne de HaloPanel.tsx
- **Formule (lue dans le code)** :
  - `pipeline/starway/context.py` : Contexte communal descriptif (halo « Derrière notre étoile » et volet « Derrière le ciel »).
  - `pipeline/starway/context.py:income_blocks` : Filosofi (MED_SL, PR_MD60). CONF_STATUS=C (confidentiel) ou valeur absente -> null + statut `secret`.
- **Scripts** : `pipeline/scripts/05_build_context.py`
- **Tests** : `pipeline/tests/test_context.py`, `pipeline/tests/test_gender_contrast.py`, `frontend/src/data/halo.test.ts`, `frontend/src/data/incomeRank.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| GEN04 | `data/raw/GEN04/Aide_lecture_rp_population.pdf` | `e6218ebbc2bc13da1a85b26aa57c1556533acc10c9af54aed0e313db788f3e38` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:49Z | Licence Ouverte (fiche : docs/sources.md#gen04) |
| GEN04 | `data/raw/GEN04/DS_RP_TD_POPULATION_AGESEX_PRINC_2023_CSV_FR.zip` | `48e2c39b3fc44b33cd5a72101dd5b2562969c63b4f22e1bda99b150964480fa7` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:51Z | Licence Ouverte (fiche : docs/sources.md#gen04) |
| GEN01 | `data/raw/GEN01/Aide_lecture_rp_activite_navettes.pdf` | `162cd6662b14ab5c975feb686ec262c82cda8c59f5ba8a08e5074b9c59eceae0` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#gen01) |
| GEN01 | `data/raw/GEN01/DS_RP_TD_NAVETTES_SEXTRANSPORT_COMP_2023_CSV_FR.zip` | `5277f9616b3a5b8473bc64d469fc0bac048c6daa7b5bb58591918a56ab12199d` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#gen01) |
| GEN01 | `data/raw/GEN01/fiche-precision.pdf` | `176599c918bc6e6e14725ccec9065698972999eeed2c994d30747b589a4042fc` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T17:05Z | Licence Ouverte (fiche : docs/sources.md#gen01) |
| SOC01 | `data/raw/SOC01/FILOSOFI_CC_csv.zip` | `f3822a78e3f55fa842a2dd9b0f155d4341057f986eec38048c74a20486979b78` | 2023 (revenus déclarés 2023) ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#soc01) |
| SOC01 | `data/raw/SOC01/Note_accompagnement_Filosofi_2023.pdf` | `3979fbbc67ae9ac5af977c952aa960ef3ce8e170568512c18acf14b66fae87b2` | 2023 ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#soc01) |

Aucun dossier de calcul r5py : donnée statistique ou géographique lue directement dans les sources ci-dessus.

### B16 : Repères de territoire : chômage de la zone d'emploi, du département et de la région, temps de travail, polarité SDRIF-E

- **Composants** : `territoire/UnemploymentTab.tsx`, `territoire/WorkTime.tsx`, `territoire/Polarity.tsx`
- **Nature** : statistique Insee et Région Île-de-France lue telle quelle, aucun calcul de trajet ; descriptive, sur la commune de départ, jamais sur un astre
- **Ligne du mode sources** :
  - `territoire/UnemploymentTab.tsx` : ChomageSourceNote(méthode METHODS.chomage)
  - `territoire/WorkTime.tsx` : WorkTimeSourceNote(méthode METHODS.workTime)
  - `territoire/Polarity.tsx` : PolaritySourceNote(méthode METHODS.polarity)
- **Formule (lue dans le code)** :
  - `pipeline/starway/territoire.py` : Repères de territoire (lot T1 du plan docs/plan-contexte-territoire.md) : chômage de la zone d'emploi, du département et de la région, part des salariés qui travaillent le soir et la nuit, polarité SDRIF-E de la commune. Logique pure, testée dans tests/test_territoire.py ; appliquée par scripts/06v_export_territoire.py, qui écrit frontend/public/data/territoire.json (contrat `territoire-1`, docs de contrat dans le plan).
  - `frontend/src/data/territoire.ts` : Repères de territoire (plan docs/plan-contexte-territoire.md) : chômage de la zone d'emploi, du département et de la région, temps de travail (soir et nuit) et polarité SDRIF-E de la commune de départ. Fonctions PURES au-dessus de `territoire.json` (contrat `territoire-1`, publié par `pipeline/scripts/06v_export_territoire.py`). Aucun chiffre n'est écrit ici : tout vient du fichier. Descriptif seulement : aucun lien de cause avec l'accessibilité, aucun seuil, aucun verdict. Le taux de chômage est mesuré au lieu de RÉSIDENCE : il parle des habitants de la commune de départ, jamais d'un astre. La part du soir et de la nuit est nationale (enquête Emploi) : aucune valeur par territoire.
  - `frontend/src/data/territoire.ts:zoneRank` : Rang d'une zone parmi les zones d'emploi publiées : comptes seulement, aucun seuil.
  - texte affiché (`METHODS.chomage`, frontend/src/data/provenance.ts) : taux du dernier trimestre lus tels quels dans les fichiers de l'Insee, sans calcul ; la zone d'emploi de la commune de départ est celle de la composition communale ; taux mesuré au lieu de résidence, descriptif
  - texte affiché (`METHODS.workTime`, frontend/src/data/provenance.ts) : part lue telle quelle dans le tableau de l'enquête Emploi, au niveau national, sur quatre semaines ; aucune valeur par territoire ; aucune catégorie « tôt le matin », donc aucun chiffre pour la journée-type 6h-14h
  - texte affiché (`METHODS.polarity`, frontend/src/data/provenance.ts) : commune repérée par son nom dans la liste des polarités du SDRIF-E ; les noms mal écrits dans ce fichier sont corrigés par une table explicite du pipeline ; descriptif, pas un classement d'accessibilité
- **Scripts** : `pipeline/scripts/06v_export_territoire.py`
- **Tests** : `pipeline/tests/test_territoire.py`, `frontend/src/data/territoire.test.ts`

Sources affichées (registre du front) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| SOC02 | `data/raw/SOC02/TCRD_025.zip` | `545f2d5b22f58c527542da19585adc50bd6e82cb768f6ce9dd79ad63b39de095` | 2e trimestre 2026 provisoire (« (p) » dans l'en-tête), paru le 18/09/2026 ; relevé 2026-11-06 | Licence Ouverte (fiche : docs/sources.md#soc02) |
| SOC02 | `data/raw/SOC02/chomage-zone-t1-2003-t2-2026.xlsx` | `0662c648e68feec0fd1901bd11fe9a084043e03ead3103f526b19c35de588db7` | série trimestrielle du 1er trimestre 2003 au 2e trimestre 2026, paru le 18/09/2026 ; zones d'emploi en base 2020 ; dernier trimestre provisoire d'après l'en-tête du fichier des départements et de la région (TCRD_025) ; relevé 2026-11-06 | Licence Ouverte (fiche : docs/sources.md#soc02) |
| GEO05 | `data/raw/GEO05/ze.json` | `ab79adda67463afe62afb66312d0fedd081c3da8a7d84b3c4963b65a45cfa90b` | composition communale au 01/01/2026 (zones d'emploi en base 2020) ; relevé 2026-11-06 | Licence Ouverte (fiche : docs/sources.md#geo05) |
| EMP05 | `data/raw/EMP05/ECRT2025-F18.xlsx` | `1890307576d1e74aea8314cd1cd49f04f4642b989bf8541f7a0014fac6764d73` | enquêtes Emploi 2014 et 2024, paru le 26/06/2025 ; relevé 2026-11-06 | Licence Ouverte (fiche : docs/sources.md#emp05) |
| GEO06 | `data/raw/GEO06/polarites.csv` | `be69ad9c6ab3c371188fad1dc744e4af04b0a6de24da8955da6471e2f7fdad3e` | polarités du SDRIF-E ; fichier lu le 06/11/2026 ; relevé 2026-11-06 | Licence Ouverte (fiche : docs/sources.md#geo06) |

Aucun dossier de calcul r5py : donnée statistique ou géographique lue directement dans les sources ci-dessus.

### B15 : Visite guidée narrée (cas de Léa)

- **Composants** : `frontend/src/tour/tours/lea.tour.ts` et le lecteur `frontend/src/tour/`
- **Nature** : les chiffres prononcés sont des variables de narration résolues au moment de la lecture depuis les MÊMES données et fonctions que l'interface (en-tête de `tour/variables.ts`) ; une variable absente n'est jamais prononcée.
- **Variables utilisées par le script** (25) : `access.jobsCount`, `access.jobsOral`, `access.jobsOralCap`, `access.stars`, `anchor.oralName`, `anchor.out`, `anchor.ret`, `bmo.bassinOral`, `bmo.familyOral`, `bmo.familyProjectsOral`, `bmo.yearOral`, `budget`, `compare.jobsOral`, `compare.oralName`, `compare.stars`, `day.endOral`, `day.startOral`, `flow.peopleOral`, `halo.compareIncomeMedianOral`, `halo.incomeMedianOral`, `origin.oralName`, `pole.oralName`, `region.populationOral`, `trip.out`, `trip.ret`
- **Blocs dont viennent ces variables** : B01, B10, B12, B14 (préfixes `region.` : population des communes, GEO01)
- **Formule (lue dans le code)** : `frontend/src/tour/variables.ts` : Variables de narration résolues depuis les MÊMES données et fonctions que l'interface. Une variable null n'est jamais prononcée : elle est signalée comme manquante.
- **Voix enregistrée** : `frontend/public/tour/lea/tour.resolved.json` (sha256 `0d6eb189059060a956003a7e91ccb76dcbe3f77102aacc66d2313d8b31134f5a`, 13 étapes, enregistrée le 2026-11-13T01:13:55.574Z, jeu `2026-11-17_dc97ca710c6c`) ; une voix n'est lue que si le texte résolu à l'écran est identique, mot pour mot, au texte enregistré (`stepAudio`, `frontend/src/tour/vtt.ts`).
- **Scripts** : `pipeline/scripts/06_export_front.py`
- **Tests** : `frontend/src/tour/tours/lea.test.ts`, `frontend/src/tour/variables.test.ts`, `frontend/src/tour/resolve.test.ts`, `frontend/src/tour/vtt.test.ts`, `frontend/src/tour/siteFigures.test.ts`

Sources affichées pendant la visite (union de celles des blocs ci-dessus) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| GEO01 | `data/raw/GEO01/arrondissements_paris.json` | `22f4fc84f3baa717a84ec9ca32fb77637496fd3d63e57f88189dfc2e24d6079f` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-02T14:26Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/arrondissements_paris_codes_postaux.json` | `351d4b8b975a41224ab1baf1b86c297a0fc58b9a597be5c1ad585c43c2a530c6` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-05T11:14Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/arrondissements_paris_mairie.json` | `85cc1bacb6b1c66ea2f1ff33d1cc2f78e129ac51a191b2d78d25251eae19e390` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-02T22:05Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/communes_associees_deleguees_idf.json` | `1e4efc6a8f9b0707ba44de74383037980bea108c1938495c54eda907368076be` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-02T14:26Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/communes_idf.json` | `7971933dbbc55b1665707c1f3a9c3cf840b3bbc6a8722826c74c74f18f28a3c3` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-02T14:26Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/communes_idf_codes_postaux.json` | `1549bbc6da98af8107a9db841d7ca4434a2ac8f67827f9fa942ff9812d3f18fd` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-05T11:14Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| GEO01 | `data/raw/GEO01/communes_idf_mairie.json` | `a820a43e50fdbface1c30e5f4dcd72ce4d6e3090651b7d4b7349c542fea1679e` | géographie (COG) en vigueur à la date d'extraction ; relevé 2026-11-02T22:05Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo01) |
| EMP01 | `data/raw/EMP01/DS_FLORES_2023_CSV_FR.zip` | `ab6b5c9de823439e8815e426e9a44adf79bd8d9c33c6c5645437ce3d279dfc5c` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/aide_lecture_flores.zip` | `cd043ddabd2bc361a5faeaf71c943182753db9e74b91a89f51ecb9a0008afb95` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| EMP01 | `data/raw/EMP01/table_passage_flores.zip` | `69d76549e82ef88a453c7411736c3cd658d33c59e46c392c72e72d978c4fedf7` | 2023 (postes salariés présents la dernière semaine de décembre 2023) ; relevé 2026-11-02T14:14Z | Licence Ouverte (fiche : docs/sources.md#emp01) |
| TRA01 | `data/raw/TRA01/IDFM-gtfs-0611.zip` | `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt) ; service 2026-11-17 (mardi ordinaire, 144948 courses actives) ; relevé 2026-11-06T15:11Z | Licence Mobilités (fiche : docs/sources.md#tra01) |
| CYC01 | `data/raw/CYC01/ile-de-france-latest.osm.pbf` | `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf ; relevé 2026-11-02T14:20Z | ODbL (fiche : docs/sources.md#cyc01) |
| GEO04 | `data/raw/GEO04/Bassins_d_emploi_2026_lu_2026-11-03.xlsx` | `3c7f5048491b90d21cfb16afdacb98f60b03a127b34bc871fd09fa41c09da455` | 2026 (bassins d'emploi 2026 ; Last-Modified HTTP : 17/04/2026 08:43 GMT) ; relevé 2026-11-03T22:13Z | Licence Ouverte + CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#geo04) |
| EMP03 | `data/raw/EMP03/Base-open-data-BMO-2026.xlsx` | `735d0443b799b4c18c145055f87244a355a48b6286ee98ddbab272491d9792e0` | 2026 (enquête d'octobre à décembre 2025 ; ressource data.gouv.fr modifiée le 21/04/2026) ; relevé 2026-11-03T15:38Z | Licence Ouverte (fiche : docs/sources.md#emp03) |
| EMP03 | `data/raw/EMP03/Eclairages-et-syntheses-87-BMO-2026.pdf` | `e7b7cc1a61b265d759be07c9405be15acd3ac2c05fb513c4eae9873c9b4526b8` | 2026 (publication d'avril 2026 ; Last-Modified HTTP : 20/04/2026 15:16 GMT) ; relevé 2026-11-04T21:24Z | CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#emp03) |
| EMP02 | `data/raw/EMP02/base-flux-mobilite-domicile-lieu-travail-2023_csv.zip` | `ab658d314dca0ad7e15aa21cf50deca8153c29d86c8a9adb95cb4b5a8d68a25c` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#emp02) |
| EMP02 | `data/raw/EMP02/fiche-depl-dom-travail.pdf` | `dc04b079e3100d6ee9d3d050fbd5abe8a7eb25f98e705914512f5db89277ca3e` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#emp02) |
| EMP02 | `data/raw/EMP02/page-8998300.html` | `beda2bb83df1fdb28e51f271766c03cce9eb29607f02a46a3e224a4269103088` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T18:53Z | Licence Ouverte (fiche : docs/sources.md#emp02) |
| GEN04 | `data/raw/GEN04/Aide_lecture_rp_population.pdf` | `e6218ebbc2bc13da1a85b26aa57c1556533acc10c9af54aed0e313db788f3e38` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:49Z | Licence Ouverte (fiche : docs/sources.md#gen04) |
| GEN04 | `data/raw/GEN04/DS_RP_TD_POPULATION_AGESEX_PRINC_2023_CSV_FR.zip` | `48e2c39b3fc44b33cd5a72101dd5b2562969c63b4f22e1bda99b150964480fa7` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:51Z | Licence Ouverte (fiche : docs/sources.md#gen04) |
| GEN01 | `data/raw/GEN01/Aide_lecture_rp_activite_navettes.pdf` | `162cd6662b14ab5c975feb686ec262c82cda8c59f5ba8a08e5074b9c59eceae0` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#gen01) |
| GEN01 | `data/raw/GEN01/DS_RP_TD_NAVETTES_SEXTRANSPORT_COMP_2023_CSV_FR.zip` | `5277f9616b3a5b8473bc64d469fc0bac048c6daa7b5bb58591918a56ab12199d` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#gen01) |
| GEN01 | `data/raw/GEN01/fiche-precision.pdf` | `176599c918bc6e6e14725ccec9065698972999eeed2c994d30747b589a4042fc` | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) ; relevé 2026-11-02T17:05Z | Licence Ouverte (fiche : docs/sources.md#gen01) |
| SOC01 | `data/raw/SOC01/FILOSOFI_CC_csv.zip` | `f3822a78e3f55fa842a2dd9b0f155d4341057f986eec38048c74a20486979b78` | 2023 (revenus déclarés 2023) ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#soc01) |
| SOC01 | `data/raw/SOC01/Note_accompagnement_Filosofi_2023.pdf` | `3979fbbc67ae9ac5af977c952aa960ef3ce8e170568512c18acf14b66fae87b2` | 2023 ; relevé 2026-11-02T15:50Z | Licence Ouverte (fiche : docs/sources.md#soc01) |

Dossiers de calcul (empreinte du `run_params.json`, détail des autres empreintes en section 3) :

| dossier | état | sha256 du run_params.json |
|---|---|---|
| `matrix_modes_b44` | complet (13 lots x 3 scénarios) | `7a4a3c910fd4dc95269aa6784680ee2aced06f26868a35337b1d63b9eecc10e3` |
| `matrix_walk1000_d031_b44` | complet (13 lots x 3 scénarios) | `f711ba85f2612b0c13d9244358f007407a2e47146192e3f249975e0edc5582be` |
| `matrix_walk3000_d031_b44` | complet (13 lots x 3 scénarios) | `b023b3da19859902875b0fb50f92ddf01a9ae989c74273135290989819590b9b` |
| `matrix_velib_b44` | complet (88 origines) | `717e7c91c364d39e6abdc0b9e18aaea73d82b4120496e8692bfc9b69030a5a2a` |
| `matrix_story_d031_b44` | complet (1 lots x 3 scénarios) | `cc88695d31fb890ce784bf6eec73965e812eb222865b16f5482265436dba81b1` |
| `matrix_bike_transit_all_d031_b44_a` | complet (26 lots x 3 scénarios) | `632f5cb07d85013fb48a3c4cd1b3e4bd296ba92f428cddc2d9b6a6a410e632f0` |
| `matrix_bike_transit_all_d031_b44_b1` | complet (6 lots x 3 scénarios) | `fe874ee01637386c52b2045f70a89b61291dc7fe584fa7f248efae91ab0be538` |
| `matrix_bike_transit_all_d031_b44_b2` | complet (6 lots x 3 scénarios) | `26b19e3b25d6f040fa5281ffb456113e24e2e52fd3fa386eb677e26e85af1e17` |
| `matrix_bike_transit_all_d031_b44_b3` | complet (6 lots x 3 scénarios) | `060cb88f78c0c80bf0b6fded592d9744da7849b834157af0ec9885cbd4c40dbd` |
| `matrix_bike_transit_all_d031_b44_b4` | complet (6 lots x 3 scénarios) | `169ebca8314dc8bab04765a60138702d6425f5599fcf37d201e529b4846f7b2c` |
| `matrix_bike_transit_all_d031_b44_b5` | complet (6 lots x 3 scénarios) | `6101bbe26ab3ad847d03f02f070193ece4b3644dab67e25b8a5988b4b3cf041d` |
| `car_dist_carspeed_v2_b44` | complet (13 lots sur 13) | `bf78c98e365cfc3b4c2c30ed12987a8591d228c8c6f8d8f1b1db8bb83c0faa47` |
| `od_walk3000_d031` | complet (run_params.json présent) | `cad45fe04d54e5731ed357e0669c73d737289a41b52ff9620a6ef26dec7ed97e` |
| `od_walk1000_d031` | complet (run_params.json présent) | `4c033d14312cda1d99922e773e5c52bfc86fb269e7ad67d0cd800a39e04dabf2` |
| `matrix_walk1000_d031_nuit_b44` | complet (13 lots x 1 scénarios) | `ccc95e55d32211b34e3f8806e4c41270363539fd3e97316681a9b1a061c6e1e1` |
| `od_walk1000_d031_nuit_matin` | complet (run_params.json présent) | `d3370f63fd3f8fd74fd68ae62629bf29e5e6eff3a8bc93fbe0920a82fb8c1afd` |
| `od_walk1000_d031_nuit_soir_v2` | complet (run_params.json présent) | `ab57613dc6a498b122f202a6d3b5342bfb87ee12478d5a8d24c5a0cee7e3879a` |
| `matrix_walk3000_d031_nuit_b44` | complet (13 lots x 1 scénarios) | `16f75c421cbe18eb397ab15f956514906fdf538a017b7c7e9ecf66e7541d8d12` |
| `od_walk3000_d031_nuit_matin` | complet (run_params.json présent) | `6a8c6d1da0b7061d0877b2ff21af020b381fb17523c31aa352c1954b8cc5f240` |
| `od_walk3000_d031_nuit_soir_v2` | complet (run_params.json présent) | `f2eb87168a66e187b0d63a429e772e3925bed31e152306a4c0c308baf7b89d35` |

Sources du calcul (lues dans les `run_params.json` ci-dessus, rapprochées du manifeste par sha256) :

| source_id | fichier exact | sha256 | date ou millésime | licence |
|---|---|---|---|---|
| ENG01 | `%LOCALAPPDATA%\r5py\r5-v7.5.1-r5py-all.jar (poste) ; ~/.cache/r5py/r5-v7.5.1-r5py-all.jar (VM de calcul)` | `d50be106cadd7b636cfc0e209052767d7df570629f79fdf98ecd5cf5d2d89be7` | R5 v7.5.1 (tag v7.5.1-r5py ; Last-Modified HTTP du jar : 08/05/2026 15:27 GMT) ; relevé 2026-11-03T09:12Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk1000-d031-all.jar` | `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction d4d8cc49167338b77e15d04ce838aab69b422620 ; version écrite dans le jar : v7.5.1-r5py-walk1000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk2000-d031-all.jar` | `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | R5 v7.5.1 (tag v7.5.1-r5py) + modification STARWAY ; commit de construction 06248fabe98619b1f21f6f5c8b77189e2b257fbf ; version écrite dans le jar : v7.5.1-r5py-walk2000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T12:21Z | MIT (fiche : docs/sources.md#eng01) |
| ENG01 | `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar` | `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction 3ea104d9912daa03a13911e2bf6a73e3a364328d ; version écrite dans le jar : v7.5.1-r5py-walk3000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; relevé 2026-11-04T09:54Z | MIT (fiche : docs/sources.md#eng01) |
| GEO02B | `data/processed/communes_idf_2026.csv` | `a5ccd3bcbb8febb313c3a0c55adcd5091d5223f5c8490a8e386c416bd2b15fc1` | dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026) ; relevé 2026-11-03T09:31Z | ODbL + Licence Ouverte (fiche : docs/sources.md#geo02b) |
| GEO04B | `data/processed/poles_d030.json` | `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | dérivé de GEO04 (bassins d'emploi 2026), EMP01 (Flores 2023, postes salariés recensés par l'INSEE), GEO01 (géographie des communes 2026) et TRA01 (arrêts les plus desservis le 17/11/2026) ; service 2026-11-17 ; relevé 2026-11-04T10:49Z | ODbL + Licence Mobilités + Licence Ouverte + CRPA + accord de l'organisateur du hackathon (fiche : docs/sources.md#geo04b) |
| TRA01B | `data/raw/TRA01B/gtfs_nuit-0611.zip` | `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du lundi 16/11/2026 qui passent minuit ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01b) |
| TRA01C | `data/raw/TRA01C/gtfs_soir-0611.zip` | `bf02daf3b8c051b6e0d3446a7b905c66140ba0938eb21f9b2e16a6a4a85c2feb` | dérivé de TRA01B puis de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 ; service 2026-11-17 (mardi type) complété des courses du mercredi 18/11/2026 parties avant 3h et recodées 24h plus tard ; relevé 2026-11-06T15:52Z | Licence Mobilités (fiche : docs/sources.md#tra01c) |
| TRA02C | `data/processed/navitia_same_stop_min_recalc_d031.csv (réponses : data/interim/navitia_cache/connections_*.json)` | `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) ; service 2026-11-17 ; relevé 2026-11-04T10:02Z | Licence Mobilités + CGU PRIM (fiche : docs/sources.md#tra02c) |
| VEL01 | `data/raw/VEL01/station_information.json` | `060688f84cb162bd8902d7a63831177434aaa77312d77e62ae8d93d8bc82147b` | instantané du flux à la date d'extraction (horodatage lastUpdatedOther dans le fichier) ; relevé 2026-11-03T11:12Z | ODbL (fiche : docs/sources.md#vel01) |

## 3. Dossiers de calcul et empreintes des `run_params.json`

Dossiers lus par la publication du ciel des 44 astres (`starway.publication.dir_states`). Chaque empreinte est rapprochée de la ligne du manifeste de même sha256 ; « non enregistré » : le `run_params.json` ne l'écrit pas (traçabilité incomplète, jamais estimée).

| dossier | état | sha256 du run_params.json | jar R5 | GTFS | OSM | fichier des astres | durées au même arrêt | points d'origine | stations Vélib' |
|---|---|---|---|---|---|---|---|---|---|
| `matrix_modes_b44` | complet (13 lots x 3 scénarios) | `7a4a3c910fd4dc95269aa6784680ee2aced06f26868a35337b1d63b9eecc10e3` | ENG01 (r5-v7.5.1-r5py-all.jar) `d50be106cadd7b636cfc0e209052767d7df570629f79fdf98ecd5cf5d2d89be7` | TRA01 (IDFM-gtfs.zip) `c0798a28cceb6182094ff9270f12f0e66b39a70e816696bc95fbd201bb38cece` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | - | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `matrix_walk1000_d031_b44` | complet (13 lots x 3 scénarios) | `f711ba85f2612b0c13d9244358f007407a2e47146192e3f249975e0edc5582be` | ENG01 (r5-v7.5.1-r5py-walk1000-d031-all.jar) `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | TRA01 (IDFM-gtfs-0611.zip) `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `matrix_walk3000_d031_b44` | complet (13 lots x 3 scénarios) | `b023b3da19859902875b0fb50f92ddf01a9ae989c74273135290989819590b9b` | ENG01 (r5-v7.5.1-r5py-walk3000-d031-all.jar) `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | TRA01 (IDFM-gtfs-0611.zip) `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `matrix_velib_b44` | complet (88 origines) | `717e7c91c364d39e6abdc0b9e18aaea73d82b4120496e8692bfc9b69030a5a2a` | ENG01 (r5-v7.5.1-r5py-all.jar) `d50be106cadd7b636cfc0e209052767d7df570629f79fdf98ecd5cf5d2d89be7` | TRA01 (IDFM-gtfs.zip) `c0798a28cceb6182094ff9270f12f0e66b39a70e816696bc95fbd201bb38cece` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | - | sous-ensemble de 88 origines `5f090260f7b129c6c8241bf192fd775016fb3d3a34607954d169ae94644bf9a6` | VEL01 (station_information.json) `060688f84cb162bd8902d7a63831177434aaa77312d77e62ae8d93d8bc82147b` |
| `matrix_story_d031_b44` | complet (1 lots x 3 scénarios) | `cc88695d31fb890ce784bf6eec73965e812eb222865b16f5482265436dba81b1` | ENG01 (r5-v7.5.1-r5py-walk2000-d031-all.jar) `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | sous-ensemble de 12 origines `28f5850016a9b958115cfab173e7feb8c59c3036fded3af0dd7b6aea31bb0699` | - |
| `matrix_bike_transit_all_d031_b44_a` | complet (26 lots x 3 scénarios) | `632f5cb07d85013fb48a3c4cd1b3e4bd296ba92f428cddc2d9b6a6a410e632f0` | ENG01 (r5-v7.5.1-r5py-walk2000-d031-all.jar) `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | sous-ensemble de 643 origines `72d958851c0223790a0223968a87fcddaebd8895dbe05cae5411a5831368b8bf` | - |
| `matrix_bike_transit_all_d031_b44_b1` | complet (6 lots x 3 scénarios) | `fe874ee01637386c52b2045f70a89b61291dc7fe584fa7f248efae91ab0be538` | ENG01 (r5-v7.5.1-r5py-walk2000-d031-all.jar) `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | sous-ensemble de 129 origines `2a31ebf95013aa204d20dcdaf1d0ab1d2b3a37b4733922ca41f8685941ca0823` | - |
| `matrix_bike_transit_all_d031_b44_b2` | complet (6 lots x 3 scénarios) | `26b19e3b25d6f040fa5281ffb456113e24e2e52fd3fa386eb677e26e85af1e17` | ENG01 (r5-v7.5.1-r5py-walk2000-d031-all.jar) `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | sous-ensemble de 128 origines `2d3eef265a633d61f433880dbc13d57cceff600fc75e543141dc11c76bb428b5` | - |
| `matrix_bike_transit_all_d031_b44_b3` | complet (6 lots x 3 scénarios) | `060cb88f78c0c80bf0b6fded592d9744da7849b834157af0ec9885cbd4c40dbd` | ENG01 (r5-v7.5.1-r5py-walk2000-d031-all.jar) `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | sous-ensemble de 129 origines `41ea0deaf833bf79c19fca034d029dc08d83ec3ceacaf3f0410e4e4eaf1e6074` | - |
| `matrix_bike_transit_all_d031_b44_b4` | complet (6 lots x 3 scénarios) | `169ebca8314dc8bab04765a60138702d6425f5599fcf37d201e529b4846f7b2c` | ENG01 (r5-v7.5.1-r5py-walk2000-d031-all.jar) `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | sous-ensemble de 128 origines `4ed9fc73926f0bb706398ea7c2fdf16dd9177990a2d34a6fe90a444c2bea2113` | - |
| `matrix_bike_transit_all_d031_b44_b5` | complet (6 lots x 3 scénarios) | `6101bbe26ab3ad847d03f02f070193ece4b3644dab67e25b8a5988b4b3cf041d` | ENG01 (r5-v7.5.1-r5py-walk2000-d031-all.jar) `20f907e735ba2ecefb643accbb80254da6fa8a5fafce4a8a81d2ea5f6c49c17d` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | sous-ensemble de 128 origines `75738ee07f590cf6f8688f18f6d93af1ef9e377fbea8545aee0886ac4c3f47ba` | - |
| `car_dist_carspeed_v2_b44` | complet (13 lots sur 13) | `bf78c98e365cfc3b4c2c30ed12987a8591d228c8c6f8d8f1b1db8bb83c0faa47` | ENG01 (r5-v7.5.1-r5py-all.jar) `d50be106cadd7b636cfc0e209052767d7df570629f79fdf98ecd5cf5d2d89be7` | TRA01 (IDFM-gtfs.zip) `c0798a28cceb6182094ff9270f12f0e66b39a70e816696bc95fbd201bb38cece` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | - | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `itineraries_walk3000_d031_b44` | complet (52 lots) | `b07c5731411069591371ae4b160f30810c244645804b1ed0578b2288cd989468` | ENG01 (r5-v7.5.1-r5py-walk3000-d031-all.jar) `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | TRA01 (IDFM-gtfs-0611.zip) `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `itineraries_walk1000_d031_b44` | complet (52 lots) | `732fda8b1abd2fca11cc612096b23881da6d4b5f16cc2287385baa2ce7866c17` | ENG01 (r5-v7.5.1-r5py-walk1000-d031-all.jar) `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | TRA01 (IDFM-gtfs-0611.zip) `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `od_walk3000_d031` | complet (run_params.json présent) | `cad45fe04d54e5731ed357e0669c73d737289a41b52ff9620a6ef26dec7ed97e` | ENG01 (r5-v7.5.1-r5py-walk3000-d031-all.jar) `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | TRA01 (IDFM-gtfs-0611.zip) `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `od_walk1000_d031` | complet (run_params.json présent) | `4c033d14312cda1d99922e773e5c52bfc86fb269e7ad67d0cd800a39e04dabf2` | ENG01 (r5-v7.5.1-r5py-walk1000-d031-all.jar) `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | TRA01 (IDFM-gtfs-0611.zip) `e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `matrix_walk1000_d031_nuit_b44` | complet (13 lots x 1 scénarios) | `ccc95e55d32211b34e3f8806e4c41270363539fd3e97316681a9b1a061c6e1e1` | ENG01 (r5-v7.5.1-r5py-walk1000-d031-all.jar) `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `itineraries_walk1000_d031_nuit_b44` | complet (52 lots) | `2755c418ca176d34e254d1086906d04e7c16ea7294bc18143a582f916681c5d0` | ENG01 (r5-v7.5.1-r5py-walk1000-d031-all.jar) `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `od_walk1000_d031_nuit_matin` | complet (run_params.json présent) | `d3370f63fd3f8fd74fd68ae62629bf29e5e6eff3a8bc93fbe0920a82fb8c1afd` | ENG01 (r5-v7.5.1-r5py-walk1000-d031-all.jar) `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `od_walk1000_d031_nuit_soir_v2` | complet (run_params.json présent) | `ab57613dc6a498b122f202a6d3b5342bfb87ee12478d5a8d24c5a0cee7e3879a` | ENG01 (r5-v7.5.1-r5py-walk1000-d031-all.jar) `da3035beee298be2fb78dd636dc4f750ae94d591ebd496cdff92eb14f43d8496` | TRA01C (gtfs_soir-0611.zip) `bf02daf3b8c051b6e0d3446a7b905c66140ba0938eb21f9b2e16a6a4a85c2feb` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `matrix_walk3000_d031_nuit_b44` | complet (13 lots x 1 scénarios) | `16f75c421cbe18eb397ab15f956514906fdf538a017b7c7e9ecf66e7541d8d12` | ENG01 (r5-v7.5.1-r5py-walk3000-d031-all.jar) `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | GEO04B (poles_d030.json) `92fa117feb2aa7bca7d883d953244e0ab9124c9721b5d801a4cede37c36ab516` | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `itineraries_walk3000_d031_nuit_b44` | complet (52 lots) | `791d1ee951ea5feec6349c6806249a5578d897f7f5a033d70590900c015c4c8e` | ENG01 (r5-v7.5.1-r5py-walk3000-d031-all.jar) `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `od_walk3000_d031_nuit_matin` | complet (run_params.json présent) | `6a8c6d1da0b7061d0877b2ff21af020b381fb17523c31aa352c1954b8cc5f240` | ENG01 (r5-v7.5.1-r5py-walk3000-d031-all.jar) `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | TRA01B (gtfs_nuit-0611.zip) `3e38b7975e7ba317831164df2c1d9f56950a6dbbd3fd540cd79af379edae0be2` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |
| `od_walk3000_d031_nuit_soir_v2` | complet (run_params.json présent) | `f2eb87168a66e187b0d63a429e772e3925bed31e152306a4c0c308baf7b89d35` | ENG01 (r5-v7.5.1-r5py-walk3000-d031-all.jar) `977adc23114234c73c7545149f1407aaa2627e4b328095e54b43031456a4cd7a` | TRA01C (gtfs_soir-0611.zip) `bf02daf3b8c051b6e0d3446a7b905c66140ba0938eb21f9b2e16a6a4a85c2feb` | CYC01 (ile-de-france-latest.osm.pbf) `61589cc928ff1f76ebec76f5123bd5e9466cf226b99cbde78988779209c12557` | - | TRA02C (navitia_same_stop_min_recalc_d031.csv) `9535e60e0888b8cefc86cce8c5952bcab8db7a82a9d6c56868b181abbdf3c235` | GEO02B (communes_idf_2026.csv) `dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9` | - |

## 4. Écarts connus et ce qui n'a pas pu être sourcé

- Fichiers du manifeste hors du dépôt (jars R5 de la VM et du poste) : sha256 relevé à la source (`sha256sum` en lecture seule sur la VM) et retrouvé dans les `run_params.json` ; non rechargeables ici : ENG01 `%LOCALAPPDATA%\r5py\r5-v7.5.1-r5py-all.jar`, ENG01 `r5-v7.5.1-r5py-walk1000-all.jar`, ENG01 `r5-v7.5.1-r5py-walk1000-d031-all.jar`, ENG01 `r5-v7.5.1-r5py-walk2000-d031-all.jar`, ENG01 `r5-v7.5.1-r5py-walk3000-all.jar`, ENG01 `r5-v7.5.1-r5py-walk3000-d031-all.jar`, ENG01 `r5-v7.5.1-r5py-walk7200-all.jar`.
- TRA02 `data/interim/navitia_cache/` : l'empreinte est celle d'une liste de fichiers (répertoire de réponses d'API), non recalculée par 07.

