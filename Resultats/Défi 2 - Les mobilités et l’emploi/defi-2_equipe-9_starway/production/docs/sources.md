<!-- Fichier généré par pipeline/scripts/06r_sources_registry.py à partir de data/sources_manifest.csv, de starway/registry.py, 
     du catalogue docs/reference/STARWAY_Referentiel_Donnees_FINAL_EQUIPE_2026.xlsx, du code et de frontend/public/data/.
     NE PAS MODIFIER À LA MAIN : corriger la source puis relancer le script. 07_quality_checks.py vérifie
     que ce fichier est à jour. -->

# Référentiel des sources de STARWAY

**52 sources** (codes) et **134 fichiers** tracés dans [data/sources_manifest.csv](../data/sources_manifest.csv) (une ligne par fichier : adresse, date d'extraction, millésime, licence, empreinte sha256). Le texte explicatif (pourquoi chaque donnée, ce qu'elle dit et ne dit pas) est dans [donnees-utilisees.md](donnees-utilisees.md) ; la méthode dans [methodologie.md](methodologie.md) ; les limites dans [limites.md](limites.md). Le site affiche les mêmes sources dans « Sources & limites » (fichier publié `sources.json`, écrit depuis le manifeste).

Comment lire ce référentiel :
- **Statut** : « utilisée et publiée » ; « utilisée, résultat pas encore publié » ; « utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient) » ; « téléchargée, non utilisée » ; « écartée ». Il est tenu à la main dans `pipeline/starway/registry.py`.
- **Obligations** : déduites du texte de la licence du manifeste (règles de `licence_kinds`).
- **Où c'est utilisé** : déduit automatiquement. Fichiers publiés = champs « source » des fichiers de `frontend/public/data/` (`sources.json` cite toutes les sources et n'est pas répété) ; code du front et pipeline = fichiers qui citent le code de la source, tests exclus (un champ prévu mais pas encore publié compte aussi : le statut fait foi). Une source d'entrée du calcul (GTFS, OpenStreetMap, carreaux) n'est citée par aucun champ : ses résultats sont publiés sous forme de temps de trajet.

## Récapitulatif

| Code | Producteur | Source | Licence | Millésime | Statut | Fichiers |
|---|---|---|---|---|---|---|
| [CO2-01](#co2-01) | ADEME (Datagir) | API Impact CO2, facteurs du transport | Licence Ouverte (à confirmer) | valeurs de l'API au 03/11/2026 (millésime des facteurs non affiché par l'API) | écartée | 1 |
| [COST01](#cost01) | Île-de-France Mobilités | Forfait Navigo Mois (page tarifaire) | document cité | tarifs applicables au 1er janvier 2026 (mention de la page) | utilisée et publiée | 1 |
| [COST02](#cost02) | Île-de-France Mobilités | Tarifs 2026 des titres à l'unité | document cité | publiée le 10 décembre 2025, tarifs au 1er janvier 2026 (mentions de la page) | utilisée et publiée | 3 |
| [COST06](#cost06) | CRE et EDF | Tarif réglementé de l'électricité (Tarif Bleu) au 1er août 2026 | document cité + accord de l'organisateur du hackathon + Licence Ouverte | 15/07/2026 (mouvement au 1er août 2026) | utilisée et publiée | 3 |
| [COST07](#cost07) | Ministère de l'Économie | Prix des carburants en France, flux instantané v2 | Licence Ouverte | relevé instantané à la date d'extraction ; chaque prix porte sa date de mise à jour (colonnes *_maj) | utilisée et publiée | 1 |
| [COST08](#cost08) | SDES (ministère de la Transition écologique) | Bilan annuel des transports en 2024 | Licence Ouverte | 2024 (publié le 25/11/2025) | utilisée et publiée | 2 |
| [CYC01](#cyc01) | Contributeurs d'OpenStreetMap (extrait Geofabrik) | OpenStreetMap, extrait Île-de-France | ODbL | extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf | utilisée et publiée | 1 |
| [EMP01](#emp01) | INSEE | Flores 2023, postes salariés recensés par l'INSEE | Licence Ouverte | 2023 (postes salariés présents la dernière semaine de décembre 2023) | utilisée et publiée | 3 |
| [EMP02](#emp02) | INSEE | Recensement 2023, flux domicile-travail | Licence Ouverte | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) | utilisée et publiée | 3 |
| [EMP03](#emp03) | France Travail | Besoins en Main-d'Oeuvre (BMO) 2026 | Licence Ouverte + CRPA + accord de l'organisateur du hackathon | 2026 (enquête d'octobre à décembre 2025 ; ressource data.gouv.fr modifiée le 21/04/2026) | utilisée et publiée | 2 |
| [EMP04](#emp04) | DGAFP (Choisir le service public) | Offres diffusées sur Choisir le service public | Licence Ouverte | documentation du 10/01/2023 (ressource data.gouv.fr) | utilisée et publiée | 3 |
| [EMP05](#emp05) | INSEE (Insee Références) | Organisation du temps de travail, enquête Emploi 2024 | Licence Ouverte | enquêtes Emploi 2014 et 2024, paru le 26/06/2025 | utilisée et publiée | 1 |
| [ENG01](#eng01) | Conveyal (R5, licence MIT), recompilé par STARWAY | Jars R5 corrigés (limite de marche, règles de correspondance) et jar r5py d'origine | MIT | R5 v7.5.1 (tag v7.5.1-r5py ; Last-Modified HTTP du jar : 08/05/2026 15:27 GMT) | utilisée et publiée | 7 |
| [ENV01](#env01) | Île-de-France Mobilités | Émission de CO2e par voyageur-kilomètre sur le réseau | Licence Ouverte | facteurs opérateurs 2019 et Base Carbone ADEME ; jeu mis à jour le 26/02/2024 | utilisée et publiée | 1 |
| [ENV02](#env02) | ADEME | Base Carbone V23.6 (facteurs d'émission de la Base Empreinte) | Licence Ouverte | Base Carbone V23.6 (fichier du 03/07/2025) | utilisée et publiée | 2 |
| [GEN01](#gen01) | INSEE | Recensement 2023, actifs occupés par sexe et mode de transport | Licence Ouverte | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) | utilisée et publiée | 3 |
| [GEN04](#gen04) | INSEE | Recensement 2023, population par sexe et âge | Licence Ouverte | RP 2023 (enquêtes annuelles de recensement 2021 à 2025) | utilisée et publiée | 2 |
| [GEO01](#geo01) | Etalab, API Géo (d'après IGN ADMIN EXPRESS) | Communes et arrondissements d'Île-de-France | ODbL + Licence Ouverte | géographie (COG) en vigueur à la date d'extraction | utilisée et publiée | 7 |
| [GEO02](#geo02) | INSEE | Filosofi 2021, carreaux de 200 m | Licence Ouverte | revenus 2021, publié le 12/02/2026 (page 8735162) | utilisée et publiée | 2 |
| [GEO02B](#geo02b) | INSEE (Filosofi 2021) et Etalab (API Géo), fichier dérivé par STARWAY | Points d'origine des 1 285 communes et arrondissements (data/processed/communes_idf_2026.csv) | ODbL + Licence Ouverte | dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026) | utilisée et publiée | 1 |
| [GEO04](#geo04) | France Travail | Bassins d'emploi 2026 | Licence Ouverte + CRPA + accord de l'organisateur du hackathon | 2026 (bassins d'emploi 2026 ; Last-Modified HTTP : 17/04/2026 08:43 GMT) | utilisée et publiée | 1 |
| [GEO04B](#geo04b) | France Travail (bassins 2026), fichier dérivé par STARWAY | Fichier des 44 astres : bassins d'emploi, Paris en 20 arrondissements (data/processed/poles_d030.json) | ODbL + Licence Mobilités + Licence Ouverte + CRPA + accord de l'organisateur du hackathon | dérivé de GEO04 (bassins d'emploi 2026), EMP01 (Flores 2023, postes salariés recensés par l'INSEE), GEO01 (géographie des communes 2026) et TRA01 (arrêts les plus desservis le 17/11/2026) | utilisée et publiée | 1 |
| [GEO05](#geo05) | INSEE, via la Région Île-de-France | Zones d'emploi, composition communale au 01/01/2026 | Licence Ouverte | composition communale au 01/01/2026 (zones d'emploi en base 2020) | utilisée et publiée | 1 |
| [GEO06](#geo06) | Région Île-de-France et Institut Paris Region | Polarités du SDRIF-E | Licence Ouverte | polarités du SDRIF-E ; fichier lu le 06/11/2026 | utilisée et publiée | 1 |
| [QS01](#qs01) | SNCF Voyageurs | Régularité mensuelle Transilien | ODbL | janvier 2013 à septembre 2026 (jeu modifié le 08/10/2026) | utilisée et publiée | 1 |
| [ROAD01](#road01) | DRIEAT Île-de-France, DiRIF | Baromètre trafic mensuel n° 41 (novembre 2025) | Licence Ouverte | novembre 2025 (jours ouvrés, hors week-ends et jours fériés) | utilisée et publiée | 2 |
| [SOC01](#soc01) | INSEE | Filosofi 2023, revenus et pauvreté | Licence Ouverte | 2023 (revenus déclarés 2023) | utilisée et publiée | 2 |
| [SOC02](#soc02) | INSEE | Taux de chômage localisés (zones d'emploi, départements, région) du 2e trimestre 2026 | Licence Ouverte | 2e trimestre 2026 provisoire (« (p) » dans l'en-tête), paru le 18/09/2026 | utilisée et publiée | 2 |
| [SUB01](#sub01) | Île-de-France Mobilités | Description et tarif des titres de transport (jeu titres-et-tarifs) | Licence Ouverte | jeu modifié le 03/11/2026 à 19:00 UTC (champ modified des métadonnées) ; tarifs au 1er janvier 2026 selon les pages liées | utilisée et publiée | 2 |
| [SUB02](#sub02) | Île-de-France Mobilités | Conditions générales de vente et d'utilisation des forfaits | document cité | « Date d'entrée en vigueur : 24/06/2026 » (mention de la page) | utilisée et publiée | 5 |
| [SUB03](#sub03) | Île-de-France Mobilités | Pages des titres de transport (instantanés) | document cité | aucune date affichée | utilisée et publiée | 11 |
| [SUB04](#sub04) | Vélib' Métropole | Offres, grille tarifaire et CGAU Vélib' | document cité | « Pour toute souscription à partir du 12 août 2025 » | utilisée et publiée | 5 |
| [SUB05](#sub05) | Ministère du Travail, Service Public (DILA) et DGFiP (BOFiP) | Prise en charge des frais de transport par l'employeur (Code du travail) | Licence Ouverte + CRPA | version en vigueur à la date d'extraction (texte repris de Légifrance par le site) ; identifiant Légifrance LEGIARTI000019950566, « Mis à jour le : 19/12/2008 » (mention de la page) | utilisée et publiée | 6 |
| [TKT01](#tkt01) | Île-de-France Mobilités | Conditions de vente et d'usage des tickets, liste des correspondances par la voie publique | document cité | « Date de validité : à partir de juin 2026 » (mention de la page) | utilisée et publiée | 3 |
| [TOLL01](#toll01) | data.gouv.fr (jeu publié par un utilisateur) | Autoroutes et péages en flux libre | Licence Ouverte | version du 03/11/2026 (portiques) ; cartographie du 25/10/2025 | utilisée et publiée | 3 |
| [TOLL02](#toll02) | APRR | Tarifs de péage APRR au 1er février 2026 | Licence Ouverte + document cité + accord de l'organisateur du hackathon | en vigueur au 1er février 2026 | utilisée et publiée | 5 |
| [TOLL03](#toll03) | Journal officiel (DILA) et Sanef (grilles déposées à la main) | Arrêté du 28 janvier 2026 (A14) et grilles Sanef et SAPN du 1er février 2026 | document cité + accord de l'organisateur du hackathon + Licence Ouverte | en vigueur au 1er février 2026 | utilisée et publiée | 9 |
| [TOLL04](#toll04) | VINCI Autoroutes | Tarifs 2026 du Duplex A86 et de Cofiroute | document cité + accord de l'organisateur du hackathon | Duplex A86 : tarifs TTC au 01/01/2026 ; Cofiroute : tarifs au 1er février 2026 | utilisée et publiée | 7 |
| [TOLL05](#toll05) | Ministère de la Transition écologique | Gares de péage du réseau routier national concédé | ODC-BY | référentiel au 01/01/2025 | utilisée et publiée | 2 |
| [TOLL06](#toll06) | APRR (copie ouverte data.gouv.fr et PDF officiel) | Recoupement de l'A5 : grille APRR du 1er février 2026 retéléchargée le 05/11/2026 | document cité + accord de l'organisateur du hackathon + Licence Ouverte | en vigueur au 1er février 2026 | utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient) | 3 |
| [TRA01](#tra01) | Île-de-France Mobilités | Horaires prévus des transports en commun (GTFS) | Licence Mobilités | offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt) | utilisée et publiée | 1 |
| [TRA01B](#tra01b) | Île-de-France Mobilités (fichier dérivé par STARWAY) | Horaires prévus des TC complétés des courses de la veille codées 24:00 et plus (réseau de nuit) | Licence Mobilités | dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 | utilisée et publiée | 1 |
| [TRA01C](#tra01c) | Île-de-France Mobilités (fichier dérivé par STARWAY) | Horaires prévus des TC du réseau de nuit complétés des courses du mercredi parties avant 3h (réseau du soir) | Licence Mobilités | dérivé de TRA01B puis de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026 | utilisée et publiée | 1 |
| [TRA02](#tra02) | Île-de-France Mobilités (PRIM) | API IDFM Navitia, calculateur officiel (requêtes journeys) | Licence Mobilités + CGU PRIM | données Navitia chargées le 20261109T230555 (période de production 20261105-20261208) | utilisée et publiée | 1 |
| [TRA02B](#tra02b) | Île-de-France Mobilités (PRIM) | API IDFM Navitia, durées de correspondance au même arrêt (requêtes connections) | Licence Mobilités + CGU PRIM | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) | utilisée et publiée | 2 |
| [TRA02C](#tra02c) | Île-de-France Mobilités (PRIM) | API IDFM Navitia, durées au même arrêt du recalcul des correspondances de la VM (359 arrêts) | Licence Mobilités + CGU PRIM | données Navitia chargées le 20261104T081131 (période de production 20261031-20261203) | utilisée et publiée | 1 |
| [TRA02D](#tra02d) | Île-de-France Mobilités (PRIM) | API IDFM Navitia, durées de correspondance de 217 quais sans ligne transfers.txt (relevé du 05/11) | Licence Mobilités + CGU PRIM | données Navitia chargées le 20261104T081131 ou plus récentes (non relevé le 05/11) | utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient) | 1 |
| [TRA02E](#tra02e) | Île-de-France Mobilités (PRIM) | API IDFM Navitia, prix au ticket recoupés (échantillon de 48 trajets du 05/11) | Licence Mobilités + CGU PRIM | données Navitia du moment de la requête (horaires théoriques du 17/11/2026) | utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient) | 1 |
| [TRA03](#tra03) | Île-de-France Mobilités | Référentiel des lignes de transport en commun | ODbL | instantané du 03/11/2026 (jeu mis à jour chaque jour) | utilisée et publiée | 1 |
| [TRA04](#tra04) | Île-de-France Mobilités | Accessibilité en gare | Licence Ouverte | jeu modifié le 06/07/2026 | utilisée et publiée | 1 |
| [VEH01](#veh01) | ADEME | Deux-roues motorisés : consommations et émissions (septembre 2023) | document cité (à confirmer) | 2023 | utilisée et publiée | 1 |
| [VEL01](#vel01) | Vélib' Métropole | Stations Vélib' (GBFS station_information) | ODbL | instantané du flux à la date d'extraction (horodatage lastUpdatedOther dans le fichier) | utilisée et publiée | 1 |

Par statut : utilisée et publiée : 48 ; utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient) : 3 ; écartée : 1.

## Fiches

### CO2-01

**API Impact CO2, facteurs du transport** (ADEME (Datagir))

- **Statut** : écartée : évaluée pour le carbone des itinéraires, non retenue au profit des facteurs IDFM (ENV01), methodologie.md § 5 duodecies ; gardée comme alternative
- **Licence (manifeste)** : Licence Ouverte Etalab (documentation Datagir de l'ADEME, page « Cadre d'utilisation et licences » de docs.datagir.ademe.fr, lue le 09/11/2026 : « Les données sont proposées sous la Licence Ouverte Etalab », version non précisée) ; les mentions légales d'impactco2.fr (mises à jour le 29/05/2024, lues le 09/11/2026) réservent les droits à l'ADEME et autorisent « la réutilisation non commerciale et pédagogique des informations » : les deux textes ne disent pas la même chose ; code sous MIT
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour ; licence à confirmer (voir la colonne licence du manifeste)
- **Millésime** : valeurs de l'API au 03/11/2026 (millésime des facteurs non affiché par l'API)
- **Date d'extraction** : 2026-11-03T15:49Z
- **Granularité et géographie** : mode de transport (kg CO2e par personne et par km) ; France
- **Ce qu'on en fait** : évaluée pour le carbone des itinéraires, NON retenue au profit du jeu IDFM ENV01 ; gardée comme alternative (fourchette bus électrique / thermique)
- **Contrôles** : valeurs relues dans le fichier
- **Limites** : requête non authentifiée (l'API le signale) ; énergie des bus franciliens inconnue : fourchette bus électrique / thermique ; aucun facteur pour téléphérique, funiculaire, VAL ; facteurs différents de Base Impacts v23.5 ou des valeurs SNCF/RATP
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau
  - pipeline : `fares_carbon.py` ; `licences_attente.py`
- **À vérifier** : licence à confirmer

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/CO2-01/impactco2_transport_km1.json` | ADEME - API Impact CO2, transport (facteurs par personne et par km) | https://impactco2.fr/api/v1/transport?km=1&displayAll=1&ignoreRadiativeForcing=0&language=fr | `6e997eb5f0d1` |

### COST01

**Forfait Navigo Mois (page tarifaire)** (Île-de-France Mobilités)

- **Statut** : utilisée et publiée : prix du forfait, identique pour tous les pôles (context/{insee}.json, panneau de preuve)
- **Licence (manifeste)** : page publique IDFM, citée comme source d'un tarif (aucune réutilisation de contenu)
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document
- **Millésime** : tarifs applicables au 1er janvier 2026 (mention de la page)
- **Date d'extraction** : 2026-11-02T15:54Z
- **Granularité et géographie** : tarif régional ; Île-de-France
- **Ce qu'on en fait** : forfait Navigo Mois toutes zones (90,80 €) reporté dans le code du pipeline et vérifié à la construction du contexte ; aucun coût voiture n'est estimé (barème kilométrique fiscal écarté)
- **Contrôles** : le montant et la phrase « Tarifs du forfait applicables au 1er janvier 2026 » doivent figurer dans l'instantané HTML (contrôle bloquant du pipeline)
- **Limites** : Tarif plein ; forfaits zonés moins chers (2-3, 3-4, 4-5), tarifs réduits et prise en charge employeur (50 %) non modélisés ; identique pour toutes les communes
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `context/{insee}.json` ; `subscriptions.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance ; panneau de preuve
  - pipeline : `05_build_context.py` ; `06i_export_subscriptions.py` ; `config.py` ; `context.py` ; `sources.py` ; `subscription_catalog.py` ; `subscription_sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/COST01/forfait-navigo-mois.html` | IDFM - page tarifaire du forfait Navigo Mois (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-mois | `4d1f9dabff43` |

### COST02

**Tarifs 2026 des titres à l'unité** (Île-de-France Mobilités)

- **Statut** : utilisée et publiée : tickets et prix par sens des itinéraires détaillés (itineraries/{insee}.json)
- **Licence (manifeste)** : page publique IDFM, citée comme source d'un tarif (aucune réutilisation de contenu) ; page publique IDFM, citée comme source d'une règle tarifaire
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document
- **Millésime** : publiée le 10 décembre 2025, tarifs au 1er janvier 2026 (mentions de la page) ; page consultée le 03/11/2026 (pas de date de mise à jour affichée) ; tarifs applicables au 1er janvier 2026 (mention de la page)
- **Date d'extraction** : 2026-11-03T15:46Z, 2026-11-03T15:47Z
- **Granularité et géographie** : tarif régional ; règle tarifaire ; Île-de-France
- **Ce qu'on en fait** : prix plein tarif reportés dans le code du pipeline : Métro-Train-RER 2,55 €, Bus-Tram 2,05 €, Paris Région <> Aéroports 14,00 € ; règles reprises dans le code du pipeline : correspondances 2 h sans sortir du réseau, pas de bus ni tram, funiculaire sans correspondance, aéroports exclus ; ticket aéroport (14 €) pour un trajet ferré qui part d'Orly, de CDG 1 ou de CDG 2 TGV ou y arrive, ou qui emprunte OrlyVal
- **Contrôles** : prix relus dans l'instantané le 03/11/2026 ; phrases relues dans l'instantané
- **Limites** : prix d'un titre à l'unité : sans objet pour un abonné Navigo ; correspondances par la voie publique autorisées par IDFM non relevées (page en 403) ; page du Ticket Bus-Tram et CGVU Bus-Tram (juin 2026) en 403 depuis le poste : règles Bus-Tram lues via un moteur de recherche, à vérifier
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `subscriptions.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve
  - pipeline : `06h_export_itineraries.py` ; `06i_export_subscriptions.py` ; `fares_carbon.py` ; `itin_export.py` ; `subscription_catalog.py` ; `subscription_sources.py` ; `subscriptions.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/COST02/tarifs-2026.html` | IDFM - Les tarifs Île-de-France Mobilités 2026 (titres à l'unité, instantané HTML) | https://www.iledefrance-mobilites.fr/tarifs-titre-de-transport-en-commun-2026 | `0293caae1e39` |
| `data/raw/COST02/ticket-metro-train-rer.html` | IDFM - page du Ticket Métro-Train-RER (règles d'usage, instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/ticket-metro-train-rer | `558170e2ae8f` |
| `data/raw/COST02/ticket-paris-region-aeroports.html` | IDFM - page du Ticket Paris Région <> Aéroports (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/ticket-paris-region-aeroports | `0893170a27ec` |

### COST06

**Tarif réglementé de l'électricité (Tarif Bleu) au 1er août 2026** (CRE et EDF)

- **Statut** : utilisée et publiée : prix du kWh de la voiture électrique (meta.vehicles) : 20,01 c€ TTC/kWh, grille EDF. Acte qui fixe le tarif : décision du 29/07/2026, JORF n° 0177 du 31/07/2026, texte n° 33 (https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470, 403 au robot, articles lus dans l'archive JORF de la DILA : entrée en vigueur le 01/08/2026, prix hors taxes). Délibération CRE n° 2026-147 du 15/07/2026 (https://www.cre.fr/fileadmin/Documents/Deliberations/2026/260715_2026-147_TRVE.pdf). Écart HT/TTC expliqué par l'accise et la TVA (limites.md « Coût »)
- **Licence (manifeste)** : acte administratif publié, cité ; document public d'EDF (tarif réglementé fixé par les pouvoirs publics), cité comme source d'un prix ; le PDF n'affiche ni licence ni condition, les mentions légales de particulier.edf.fr (lues le 09/11/2026) disent : « Dans l'hypothèse où vous souhaiteriez utiliser un des contenus du site (texte, image…), vous devez obtenir l'autorisation écrite, expresse et préalable d'EDF » ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités) le 09/11/2026, à trois conditions : données obtenues par mise à disposition et non par scraping, la dataviz ne permet pas de réexporter les données brutes, producteur crédité dans la dataviz elle-même ; son message nomme VINCI : l'appliquer à cette source est la lecture de l'équipe (10/11/2026) ; Licence Ouverte (champ license « fr-lo » de la fiche data.gouv.fr du jeu JORF de la DILA, consulté le 05/11/2026) ; texte de l'acte cité
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités, 09/11/2026) à trois conditions : données obtenues par mise à disposition du producteur, jamais par scraping ; la dataviz ne permet pas de réexporter les données brutes ; le producteur est crédité dans la dataviz elle-même, à côté de chaque montant. Ne vaut pas licence de redistribution des données ; Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : 15/07/2026 (mouvement au 1er août 2026) ; tarif applicable au 1er août 2026 (mention du document) ; mouvement proposé par la CRE, délibération n° 2026-147 du 15/07/2026 ; décision du 29/07/2026, publiée le 31/07/2026, en vigueur le 01/08/2026 (article 2)
- **Date d'extraction** : 2026-11-03T22:08Z, 2026-11-05T11:00Z
- **Granularité et géographie** : évolution des tarifs (hors taxes), accise ; prix du kWh par option et puissance souscrite ; acte administratif : 3 articles et annexe B1 (barèmes) ; France métropolitaine continentale et zones non interconnectées ; France métropolitaine continentale
- **Ce qu'on en fait** : aucun : cité comme acte à l'origine du mouvement tarifaire de la grille EDF ; Option Base (TTC), 3 et 6 kVA : 20,01 cts € TTC/kWh, soit 0,2001 €/kWh, reporté dans le code du pipeline (voiture électrique) ; aucun chiffre repris dans un fichier publié : l'acte sert à vérifier la date d'effet, le caractère hors taxes des barèmes et l'ouverture de l'option Base pour 3 et 6 kVA
- **Contrôles** : accise « de 30,85 €/MWh à 30,62 €/MWh », cohérente avec les 3,062 cts €/kWh de la grille EDF ; valeur relue dans le texte de la page 1 de cette copie le 03/11 (lignes « 3 12,13 20,01 » et « 6 15,86 20,01 ») ; empreinte vérifiée par les contrôles du pipeline ; page 2 relue le 05/11 : l'accise est de 3,062 cts €/kWh HTVA et la TVA de 20 % sur les consommations : (13,61 + 3,062) x 1,20 = 20,006, donc le prix TTC est cohérent avec les 13,61 c€ hors taxes indiqués par l'équipe (voir la ligne COST06 du Journal officiel) ; l'écart HT/TTC s'explique par l'accise et la TVA, pas par un désaccord ; lu le 05/11/2026 dans l'archive (fichiers article/JORF/ARTI/.../JORFARTI000054569477, ...479, ...480 et ...482) : article 2 « La présente décision entre en vigueur le 1er août 2026. » ; annexe B1, IV « Les prix figurant dans les barèmes s'entendent hors taxes, redevances et contributions. » ; option Base « en extinction pour les puissances de 9, 12 et 15 kVA », 3 et 6 kVA non concernées ; rapprochement de calcul (pas une relecture du Journal officiel) : (13,61 c€ HT, valeur indiquée par l'équipe d'après une copie du JO, + accise 3,062 c€) x 1,20 de TVA = 20,006, soit les 20,01 c€ TTC/kWh de la grille EDF
- **Limites** : la délibération n'imprime pas la grille TTC (annexes B1 à B4 non incluses dans ce PDF) ; l'acte qui fixe le tarif est la décision du 29/07/2026 (JORF n° 0177 du 31/07/2026, texte n° 33, https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470, 403 au robot le 05/11), dont les articles sont gardés dans l'archive JORF de la ligne COST06 suivante ; la délibération elle-même : https://www.cre.fr/fileadmin/Documents/Deliberations/2026/260715_2026-147_TRVE.pdf ; prix au tarif réglementé, option Base, abonnement non compris ; option Heures creuses, offres de marché et recharge sur borne publique non couvertes ; choisir l'option Base est un choix de l'équipe ; l'URL est stable mais le contenu change à chaque mouvement tarifaire ; les barèmes chiffrés de l'annexe B1 sont des images du Journal officiel : absents de cette archive, donc la valeur de 13,61 c€ HT n'a pas été relue par nous dans l'acte ; la copie du JO de l'équipe n'est pas versée au dépôt ; Légifrance refuse le robot (403, 05/11/2026) : lien https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470 non lu ; archive quotidienne (la même décision figure aussi dans l'archive du 31/07 à 22h12) ; provenance, adresse datée d'origine : https://echanges.dila.gouv.fr/OPENDATA/JORF/JORF_20260731-003333.tar.gz ; cette adresse ne répond plus (HTTP 404 le 09/11/2026), l'empreinte sha256 porte sur le fichier archivé à la date d'extraction
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `06_export_front.py` ; `07_quality_checks.py` ; `licences_attente.py` ; `sources.py` ; `vehicles.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/COST06/260715_2026-147_TRVE.pdf` | CRE - Délibération n° 2026-147 du 15 juillet 2026 portant proposition des tarifs réglementés de vente d'électricité | https://www.cre.fr/fileadmin/Documents/Deliberations/2026/260715_2026-147_TRVE.pdf | `60947d14a51a` |
| `data/raw/COST06/Grille_prix_Tarif_Bleu.pdf` | EDF - Grille de prix de l'offre de fourniture d'électricité « Tarif Bleu », clients particuliers, applicable au 1er août 2026 | https://particulier.edf.fr/content/dam/2-Actifs/Documents/Offres/Grille_prix_Tarif_Bleu.pdf | `827c17c1ffcd` |
| `data/raw/COST06/JORF_20260731-003333.tar.gz` | Journal officiel (DILA, données ouvertes JORF) - Décision du 29 juillet 2026 relative aux tarifs réglementés de vente de l'électricité applicables aux consommateurs résidentiels en France métropolitaine continentale (JORF n° 0177 du 31/07/2026, texte n° 33, NOR ECOR2619295S, JORFTEXT000054569470), archive du 31/07/2026 | https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470 | `4524039663ff` |

### COST07

**Prix des carburants en France, flux instantané v2** (Ministère de l'Économie)

- **Statut** : utilisée et publiée : médiane des stations d'Île-de-France, SP95-E10 et gazole (meta.vehicles)
- **Licence (manifeste)** : Licence Ouverte v2.0 (champ license = lov2 de l'API data.gouv.fr, jeu 6407d088d4e23dc662022e2c)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : relevé instantané à la date d'extraction ; chaque prix porte sa date de mise à jour (colonnes *_maj)
- **Date d'extraction** : 2026-11-03T22:08Z
- **Granularité et géographie** : station, carburant ; France (filtré sur code_departement 75, 77, 78, 91, 92, 93, 94, 95 par le pipeline)
- **Ce qu'on en fait** : médiane non pondérée des prix des stations d'Île-de-France pour SP95-E10 (e10_prix) et gazole (gazole_prix) ; nombre de stations et dates de mise à jour publiés dans meta.vehicles
- **Contrôles** : aucune station n'a à la fois un prix et une rupture pour le même carburant (vérifié par les contrôles du pipeline)
- **Limites** : prix déclarés par les stations, non pondérés par les volumes vendus (aucune donnée de volume) ; instantané : la valeur n'est reproductible qu'avec ce fichier ; certaines dates de mise à jour sont anciennes (publiées telles quelles) ; l'heure des colonnes *_maj est publiée avec le suffixe +00:00 mais dépasse l'heure d'extraction : elle est recopiée sans conversion
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `06_export_front.py` ; `07_quality_checks.py` ; `sources.py` ; `vehicles.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/COST07/prix-carburants-flux-instantane-v2.csv` | Ministère de l'Économie - Prix des carburants en France, flux instantané v2 (export CSV, toutes les stations) | https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/csv?delimiter=%3B&use_labels=false | `4714b7dd6342` |

### COST08

**Bilan annuel des transports en 2024** (SDES (ministère de la Transition écologique))

- **Statut** : utilisée et publiée : consommations moyennes des voitures particulières (meta.vehicles)
- **Licence (manifeste)** : Licence Ouverte (décret n° 2017-638) ; Licence Ouverte (décret n° 2017-638), mentions légales du site du SDES lues le 03/11/2026
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : 2024 (publié le 25/11/2025) ; 2024 (données arrêtées au 25/11/2025, publication du 25/11/2025)
- **Date d'extraction** : 2026-11-03T22:06Z, 2026-11-03T22:05Z
- **Granularité et géographie** : rapport ; moyenne nationale par type de véhicule et motorisation, L/100 km ou kWh/100 km ; France métropolitaine ; véhicules immatriculés en France (champ de la figure G3-2 du rapport : France métropolitaine)
- **Ce qu'on en fait** : aucun : lu pour la définition des consommations unitaires (pages 187 à 189) ; voitures particulières 2024 : « dont essence » 6,7247 L/100 km, « dont Diesel » 5,9251 L/100 km, « Electrique » 17,5996 kWh/100 km, lues par le pipeline
- **Contrôles** : aucune définition de l'énergie électrique (réseau ou batterie) trouvée pages 179 à 215 ; libellés et colonne 2024 recherchés dans l'onglet (contrôle bloquant du pipeline)
- **Limites** : documentation seulement ; moyenne du parc, tous trajets, sans le véhicule de la personne ni la congestion ; le fichier ne précise pas si la consommation électrique est mesurée au réseau (recharge comprise) ou en sortie de batterie
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `06_export_front.py` ; `07_quality_checks.py` ; `sources.py` ; `vehicles.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/COST08/sdes_bilan_transports_2024.pdf` | SDES - Bilan annuel des transports en 2024 (rapport complet, 220 pages) | https://www.statistiques.developpement-durable.gouv.fr/media/8868/download?inline | `ecc775545f3b` |
| `data/raw/COST08/sdes_bilan_transports_2024_circulation.xlsx` | SDES - Bilan annuel des transports en 2024, « Bilan de la circulation et matériels de transport - Données » (onglet G3.b « Consommations unitaires des véhicules immatriculés en France ») | https://www.statistiques.developpement-durable.gouv.fr/media/8867/download?inline | `0adcff08b56a` |

### CYC01

**OpenStreetMap, extrait Île-de-France** (Contributeurs d'OpenStreetMap (extrait Geofabrik))

- **Statut** : utilisée et publiée : réseau des rues des calculs r5py (marche, vélo, voiture, accès aux arrêts) : tous les temps publiés en dérivent
- **Licence (manifeste)** : ODbL 1.0 - © les contributeurs d'OpenStreetMap
- **Obligations** : ODbL : citer la source ; toute base dérivée publiée (nos fichiers de données) reste sous ODbL et le dit (partage à l'identique)
- **Millésime** : extrait du jour indiqué dans l'URL résolue ; URL résolue : https://download.geofabrik.de/europe/france/ile-de-france-261101.osm.pbf
- **Date d'extraction** : 2026-11-02T14:20Z
- **Granularité et géographie** : réseau viaire ; Île-de-France
- **Ce qu'on en fait** : aucun (entrée directe de r5py : marche, vélo, voiture)
- **Contrôles** : build du réseau r5py
- **Limites** : Pas de trafic routier (voiture sans congestion) ; qualité OSM variable
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : affiche exportable ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve
  - pipeline : `04_compute_matrix.py` ; `04c_compute_od_table.py` ; `04d_compute_velib.py` ; `04f_probe_walk_tables.py` ; `04g_car_distances.py` ; `04h_transit_itineraries.py` ; `04i_osm_toll_points.py` ; `04j_toll_tariffs.py` ; `06_export_front.py` ; `06d_export_od.py` ; `07_quality_checks.py` ; `07b_egress_limit_analysis.py` ; `07p_ready_to_publish.py` ; `08_story_candidates.py` ; `car_dist.py` ; `licences_attente.py` ; `matrix_io.py` ; `publication.py` ; `sources.py` ; `toll_tariffs.py` ; `tolls.py` ; `traceability.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/CYC01/ile-de-france-latest.osm.pbf` | OpenStreetMap - extrait Île-de-France (Geofabrik) | https://download.geofabrik.de/europe/france/ile-de-france-latest.osm.pbf | `61589cc928ff` |

### EMP01

**Flores 2023, postes salariés recensés par l'INSEE** (INSEE)

- **Statut** : utilisée et publiée : taille des astres et compteurs de postes (poles.json, access/)
- **Licence (manifeste)** : Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : 2023 (postes salariés présents la dernière semaine de décembre 2023)
- **Date d'extraction** : 2026-11-02T14:14Z
- **Granularité et géographie** : commune / arrondissement municipal × secteur × tranche d'effectifs ; communes (COM) et arrondissements municipaux (ARM) ; géographie postérieure au 1/1/2025 (Pierrefitte-sur-Seine 93059 déjà fusionnée dans Saint-Denis 93066) : les 1 266 codes IDF sont identiques à ceux de GEO01 (2026), contrôle automatique du pipeline
- **Ce qu'on en fait** : fichier DS_FLORES_A5_2023_data.csv filtré : ACTIVITY=_T, NUMBER_EMPL=_T, LEGAL_FORM_WITH_PUBLIC=1T9X7 (ensemble hors particuliers employeurs), FLORES_MEASURE=EMPL3112 (postes présents la dernière semaine de décembre), GEO_OBJECT=COM (+ARM pour Paris) ; agrégation en pôles disjoints ; documentation, aucune donnée utilisée ; documentation des codes de modalités
- **Contrôles** : codes communes présents dans GEO01 ; pôles disjoints ; somme pôle = somme communes
- **Limites** : Postes salariés recensés par l'INSEE au lieu de travail, PAS des offres d'emploi ; données communales non expertisées par l'INSEE (privilégier des agrégats de plusieurs milliers de postes) ; secret statistique possible ; comparaison entre millésimes non garantie ; documentation seulement : aucune valeur publiée n'en vient ; elle sert à lire le fichier des postes salariés (EMP01) ; documentation seulement : aucune valeur publiée n'en vient ; elle sert à lire les codes de modalités du fichier des postes salariés (EMP01)
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `od_walk1000/index.json` ; `od_walk3000/index.json` ; `poles.json`
  - code du front qui la cite (écran déduit du chemin) : affiche exportable ; autre ; ciel ; compteur du ciel ; crédits du ciel et du panneau ; légende du ciel ; mode provenance ; panneau de preuve ; visite guidée
  - pipeline : `01_download.py` ; `03_build_jobs_poles.py` ; `03b_sky_groups.py` ; `06d_export_od.py` ; `06y_textes_publics_manifeste.py` ; `config.py` ; `poles.py` ; `service_public.py` ; `sky_groups.py` ; `sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/EMP01/DS_FLORES_2023_CSV_FR.zip` | INSEE Flores - Nombre d'établissements et effectifs salariés fin 2023 | https://www.insee.fr/fr/statistiques/fichier/8266010/DS_FLORES_2023_CSV_FR.zip | `ab6b5c9de823` |
| `data/raw/EMP01/aide_lecture_flores.zip` | INSEE Flores - aide à la lecture (documentation) | https://www.insee.fr/fr/statistiques/fichier/8266010/aide_lecture_flores.zip | `cd043ddabd2b` |
| `data/raw/EMP01/table_passage_flores.zip` | INSEE Flores - table de passage anciennes / nouvelles dimensions | https://www.insee.fr/fr/statistiques/fichier/8266010/table_passage_flores.zip | `69d76549e82e` |

### EMP02

**Recensement 2023, flux domicile-travail** (INSEE)

- **Statut** : utilisée et publiée : habitants de la commune qui ont un emploi et travaillent déjà dans le pôle (context/{insee}.json, panneau de preuve)
- **Licence (manifeste)** : Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : RP 2023 (enquêtes annuelles de recensement 2021 à 2025)
- **Date d'extraction** : 2026-11-02T15:50Z, 2026-11-02T18:53Z
- **Granularité et géographie** : couple commune de résidence × commune de travail ; documentation ; communes (COM) et arrondissements municipaux (ARM) : les 1 286 codes IDF sont identiques à GEO01 2026 (contrôle bloquant du pipeline)
- **Ce qu'on en fait** : flux des actifs occupés résidents vers les communes de chaque pôle, part des actifs occupés résidents ; exportés dans context/{insee}.json (flows_to_poles) avec la mention de précision INSEE (flux < 200 : ordre de grandeur) ; aide au choix des communes du récit ; documentation, aucune donnée utilisée ; règle de précision citée et appliquée aux flux vers les pôles : « compte tenu notamment du sondage, les flux faibles (moins de 200) devront être considérés comme des ordres de grandeur »
- **Contrôles** : codes communes contre GEO01 2026 ; part = flux / somme des flux sortants de la commune ; la phrase citée doit figurer dans l'instantané (contrôle bloquant du pipeline)
- **Limites** : Flux issus du RP (estimations sur 5 enquêtes annuelles) ; flux de moins de 200 à considérer comme des ordres de grandeur (INSEE) ; navettes déclarées, ne mesure pas l'accessibilité et n'en est pas la cause ; Estimations du recensement : imprécises pour les petites communes et les petits effectifs ; aucune causalité ; page publiée le 25/06/2026 ; le CSV contient l'ensemble des flux (le XLSX seulement ceux > 100)
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `context/{insee}.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve ; visite guidée
  - pipeline : `05_build_context.py` ; `07_quality_checks.py` ; `07p_ready_to_publish.py` ; `context.py` ; `sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/EMP02/base-flux-mobilite-domicile-lieu-travail-2023_csv.zip` | INSEE RP 2023 - Mobilités professionnelles : flux domicile - lieu de travail | https://www.insee.fr/fr/statistiques/fichier/8998300/base-flux-mobilite-domicile-lieu-travail-2023_csv.zip | `ab658d314dca` |
| `data/raw/EMP02/fiche-depl-dom-travail.pdf` | INSEE RP 2023 - fiche descriptive des flux domicile - lieu de travail (documentation) | https://www.insee.fr/fr/statistiques/fichier/8998300/fiche-depl-dom-travail.pdf | `dc04b079e310` |
| `data/raw/EMP02/page-8998300.html` | INSEE - page de diffusion « Mobilités professionnelles en 2023 : déplacements domicile - lieu de travail » (instantané HTML, documentation) | https://www.insee.fr/fr/statistiques/8998300 | `beda2bb83df1` |

### EMP03

**Besoins en Main-d'Oeuvre (BMO) 2026** (France Travail)

- **Statut** : utilisée et publiée : projets de recrutement déclarés par les employeurs, par bassin d'emploi et par famille de métiers (bmo.json, bmo_metiers.json, bloc du panneau de preuve) ; tendance, jamais des offres ni des postes
- **Licence (manifeste)** : Licence Ouverte / Open Licence (fr-lo), jeu data.gouv.fr 561fa564c751df4f2acdbb48 « Enquête Besoins en Main d'Oeuvre (BMO) » de France Travail (vérifié le 04/11/2026) ; non écrite dans la publication ni sur la page méthode BMO 2026 (lues le 04/11/2026) ; règle retenue par défaut, la même que GEO04 : un chiffre publié est cité avec sa source, son tableau et sa page, sans altération (information publique d'un établissement public, CRPA, art. L321-1 et L322-1) ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités) le 09/11/2026, à trois conditions : données obtenues par mise à disposition et non par scraping, la dataviz ne permet pas de réexporter les données brutes, producteur crédité dans la dataviz elle-même ; son message nomme VINCI : l'appliquer à cette source est la lecture de l'équipe (10/11/2026)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour ; régime par défaut des informations publiques (CRPA, art. L321-1 et L322-1) : sans altération ni dénaturation, source et date de mise à jour citées ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités, 09/11/2026) à trois conditions : données obtenues par mise à disposition du producteur, jamais par scraping ; la dataviz ne permet pas de réexporter les données brutes ; le producteur est crédité dans la dataviz elle-même, à côté de chaque montant. Ne vaut pas licence de redistribution des données
- **Millésime** : 2026 (enquête d'octobre à décembre 2025 ; ressource data.gouv.fr modifiée le 21/04/2026) ; 2026 (publication d'avril 2026 ; Last-Modified HTTP : 20/04/2026 15:16 GMT)
- **Date d'extraction** : 2026-11-03T15:38Z, 2026-11-04T21:24Z
- **Granularité et géographie** : métier BMO (FAP 2021) x bassin d'emploi x département ; région ; bassins d'emploi France Travail 2026 (25 en Île-de-France) ; France entière (18 régions)
- **Ce qu'on en fait** : onglet BMO_2026_open_data, lignes de l'Île-de-France (REG = 11) : somme de met, xmet et smet par (bassin d'emploi BE26, métier) puis par (bassin, famille de métiers) en sommant les lignes des CLPE et des départements d'un même bassin ; une case « * » n'est jamais comptée (chaque somme porte le nombre de cases « * » : « au moins n ») ; export bmo.json et bmo_metiers.json ; astres : clé = bassin.code de poles.json, projets non répartis entre les astres d'un même bassin ; un seul chiffre recopié : Île-de-France, 388 806 projets de recrutement en 2026 (tableau 5, page 18), publié à côté de la somme des cases publiées du classeur (bmo.json, region.official)
- **Contrôles** : onglet BMO_2026_open_data : 53 786 lignes dont 4 536 en Île-de-France (REG = 11), 25 bassins (BE26), 645 cases « * » dans la colonne met en Île-de-France (relu le 04/11/2026) ; classeur retéléchargé le 04/11/2026 (Last-Modified HTTP 21/04/2026) : même sha256 ; licence relue sur l'API data.gouv.fr (champ license = fr-lo, dataset 561fa564c751df4f2acdbb48, last_modified 21/04/2026) ; contrôle « projets de recrutement BMO » (sommes = recalcul, total = somme des familles, bassins = GEO04, astres rattachés) ; le PDF gardé a l'empreinte attendue et sa page 18 porte la ligne « Île-de-France 388 806 » ; la somme des cases publiées du classeur (386 835) ne dépasse pas ce total
- **Limites** : Intentions de recrutement déclarées par les employeurs pour 2026 (enquête d'octobre à décembre 2025), ni offres d'emploi ni embauches ni postes salariés recensés par l'INSEE ; hors administrations de l'État ; contrats courts et saisonniers inclus ; taux de retour de 18,6 % en Île-de-France ; « * » : case non publiée, son sens exact n'est pas écrit dans la documentation de l'open data (aucune valeur publiée sous 5) ; bassin d'emploi plus grand qu'un astre sauf à Paris où un seul bassin couvre les 20 arrondissements ; intérim et particuliers employeurs : champ non confirmé par la documentation lue ; Le total officiel est supérieur à la somme des cases publiées du classeur de 1 971 projets ; l'écart n'est pas expliqué dans la documentation lue (cases « * » probables, non prouvé)
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `bmo.json` ; `bmo_metiers.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance
  - pipeline : `06j_export_bmo.py` ; `07_quality_checks.py` ; `08c_tour_challenge_cases.py` ; `bmo.py` ; `licences_attente.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/EMP03/Base-open-data-BMO-2026.xlsx` | France Travail BMO - Enquête Besoins en Main-d'Oeuvre 2026, base open data | https://www.francetravail.org/files/live/sites/peorg/files/documents/Statistiques-et-analyses/Open-data/BMO/Base-open-data-BMO-2026.xlsx | `735d0443b799` |
| `data/raw/EMP03/Eclairages-et-syntheses-87-BMO-2026.pdf` | France Travail BMO - Éclairages et synthèses n° 87 (avril 2026) : « Les besoins en main-d'oeuvre par région », tableau 5 (total officiel des projets de recrutement par région, page 18) | https://statistiques.francetravail.org/bmo/Handlers/HTFile.ashx?FZD=RBuQGKn0ttDp%2bfieIDhK4Q%3d%3d&SITEKEY=620c8132-d522-44fa-8efa-27a62c26702c | `e7b7cc1a61b2` |

### EMP04

**Offres diffusées sur Choisir le service public** (DGAFP (Choisir le service public))

- **Statut** : utilisée et publiée : bloc séparé « Service public » du panneau de preuve (service_public.json et service_public_offres.json) : offres EN LIGNE au 11/10/2026 selon leurs dates de publication, par commune quand le code postal le permet ; jamais ajoutées aux postes salariés recensés par l'INSEE, jamais appelées « postes ouverts », aucun effet sur le ciel ni sur les verdicts
- **Licence (manifeste)** : Licence Ouverte / Open Licence 2.0 (lov2) ; Licence Ouverte / Open Licence 2.0 (lov2), jeu data.gouv.fr « Les offres diffusées sur Choisir le Service Public » de la DGAFP (vérifié le 05/11/2026)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : documentation du 10/01/2023 (ressource data.gouv.fr) ; fichier du 11/10/2026 (ressource data.gouv.fr déposée le 02/11/2026) ; la fiche du jeu annonce une couverture temporelle 2021-2023 alors que le fichier va jusqu'à 2026 (écart documenté dans les limites du projet) ; référentiels du 24/04/2023 (ressource data.gouv.fr)
- **Date d'extraction** : 2026-11-05T11:01Z
- **Granularité et géographie** : documentation ; une ligne par offre et par publication (290 382 lignes ; 287 432 références distinctes) ; référentiel ; France entière ; localisation en texte libre (département et adresse)
- **Ce qu'on en fait** : aucun : gardée comme documentation ; son texte n'est pas extractible par les outils du dépôt (page unique : à relire) ; offres EN LIGNE au 11/10/2026 (début de publication <= date du fichier <= fin de publication, dates « par défaut » du fichier), une par référence ; Île-de-France par le département de « Localisation du poste » ; commune seulement si le code postal de l'adresse (table API Géo, GEO01) désigne une commune sans ambiguïté et que le nom écrit après le code ne désigne pas une autre commune ; sinon connue au département, sans répartition ; champs publiés : référence, intitulé, versant, organisme de rattachement, commune, dates de publication ; aucun : documentation des listes de valeurs (catégories ; spécialités de diplôme ; métiers) ; non utilisé par le pipeline
- **Contrôles** : voir la méthodologie ; contrôle « service public » (sommes, clés de commune, aucun champ personnel, vocabulaire, empreinte, recalcul) ; relevé du 05/11/2026 : 290 382 lignes, 14 959 sans date de publication, 34 957 lignes en ligne au 11/10/2026 (34 669 références), 10 654 offres en Île-de-France dont 6 285 rattachées à une commune et 4 369 connues au département seulement
- **Limites** : Datée de 2023, antérieure au fichier de 2026 ; Des offres diffusées, pas des postes ouverts : une date de publication ne prouve pas que le poste est encore à pourvoir ; fichier cumulé de plusieurs dates (la plupart des lignes sont expirées) ; 14 959 lignes sans date de publication (non comptées) ; code postal Cedex ou contradictoire : offre connue au département seulement ; jamais ajouté aux postes salariés recensés par l'INSEE (Flores) ; provenance, adresse datée d'origine : https://static.data.gouv.fr/resources/les-offres-diffusees-sur-choisir-le-service-public/20261102-070124/offres-datagouv-20261011.csv ; cette adresse ne répond plus (HTTP 404 le 09/11/2026), l'empreinte sha256 porte sur le fichier archivé à la date d'extraction ; Daté de 2023
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `service_public.json` ; `service_public_offres.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve
  - pipeline : `06q_export_service_public.py` ; `07_quality_checks.py` ; `service_public.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/EMP04/documentation.pdf` | Choisir le service public (DGAFP) - documentation du jeu (PDF) | https://static.data.gouv.fr/resources/les-offres-diffusees-sur-la-place-de-lemploi-public/20230110-182631/documentation.pdf | `5c65f064f39b` |
| `data/raw/EMP04/offres-datagouv-20261011.csv` | Choisir le service public (DGAFP) - Les offres diffusées sur Choisir le Service Public (offres-datagouv-20261011.csv) | https://www.data.gouv.fr/datasets/les-offres-diffusees-sur-choisir-le-service-public | `5c6ec5c17eb6` |
| `data/raw/EMP04/referentiels-csp.xlsx` | Choisir le service public (DGAFP) - référentiels des métiers et spécialités (xlsx) | https://static.data.gouv.fr/resources/les-offres-diffusees-sur-la-place-de-lemploi-public/20220920-093438/referentiels-pep.xlsx | `4d35696c27da` |

### EMP05

**Organisation du temps de travail, enquête Emploi 2024** (INSEE (Insee Références))

- **Statut** : utilisée et publiée : parts des salariés ayant travaillé le soir (20h-00h) et la nuit (00h-5h) sur quatre semaines (territoire.json, lot T1, plan du 06/11) : valeurs nationales, jamais par territoire ni par poste ; publié mais pas encore affiché (bulle de la journée-type prévue au lot T2) ; aucune source ouverte pour le 6h-14h. Licence Ouverte 2.0 par défaut du site de l'Insee (page lue le 09/11/2026)
- **Licence (manifeste)** : Licence Ouverte / Open Licence version 2.0 (Etalab), licence par défaut du site de l'Insee (« Sauf mention contraire », page Mentions légales et crédits mise à jour le 13/04/2026, lue le 09/11/2026) ; aucune mention contraire sur la page du fichier ni dans le fichier, lus le 09/11/2026. Conditions : citer « Source : Insee », la date de parution (26/06/2025), ne pas altérer le sens des informations
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : enquêtes Emploi 2014 et 2024, paru le 26/06/2025
- **Date d'extraction** : 2026-11-06
- **Granularité et géographie** : France entière, ensemble des salariés ; part ayant travaillé au moins une fois le soir (20h-00h) ou la nuit (00h-5h) sur quatre semaines ; France hors Mayotte ; aucune valeur par territoire
- **Ce qu'on en fait** : figure 1, colonne de l'année la plus récente de l'en-tête, lignes Soir et Nuit, recoupées avec la ligne « Ensemble des salariés » de la figure 2 ; champ de la note « Champ » recopié ; publié dans territoire.json (temps_de_travail), bulle de la journée-type prévue (T2)
- **Contrôles** : contrôle « repères de territoire » : valeurs publiées = figures 1 et 2 du fichier brut ; empreinte = manifeste = note de téléchargement
- **Limites** : Niveau national : aucune valeur par territoire, par poste ni par horaire de ligne ; la source n'a pas de catégorie « tôt le matin » : aucun chiffre sur la journée-type 6h-14h ; les journées-types restent un choix de l'équipe ; enquête auprès de ménages, pas un recensement des postes
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `territoire.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `06v_export_territoire.py` ; `07_quality_checks.py` ; `territoire.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/EMP05/ECRT2025-F18.xlsx` | Insee Références - Organisation du temps de travail (ECRT2025-F18.xlsx) | https://www.insee.fr/fr/statistiques/fichier/8376856/ECRT2025-F18.xlsx | `1890307576d1` |

### ENG01

**Jars R5 corrigés (limite de marche, règles de correspondance) et jar r5py d'origine** (Conveyal (R5, licence MIT), recompilé par STARWAY)

- **Statut** : utilisée et publiée : moteur de calcul de TOUS les temps TC publiés : l'empreinte du jar de chaque calcul est écrite dans les run_params.json du dossier (r5_jar_sha256) ; les jars (64 Mo) ne sont pas publiés, construits sur la VM par pipeline/r5/build_r5_walk.sh et build_r5_d031.sh
- **Licence (manifeste)** : Licence MIT (fichier LICENSE du dépôt r5py/r5, Copyright (c) 2020-2025 Conveyal LLC)
- **Obligations** : MIT : conserver l'avis de copyright et le texte de la licence avec toute copie du code (jars R5 corrigés, jamais publiés par le site)
- **Millésime** : R5 v7.5.1 (tag v7.5.1-r5py ; Last-Modified HTTP du jar : 08/05/2026 15:27 GMT) ; R5 v7.5.1 (tag v7.5.1-r5py) + modification STARWAY ; commit de construction e0c007b6293d688cca059564618d4625b78e264e ; version écrite dans le jar : v7.5.1-r5py-walk1000 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction d4d8cc49167338b77e15d04ce838aab69b422620 ; version écrite dans le jar : v7.5.1-r5py-walk1000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; R5 v7.5.1 (tag v7.5.1-r5py) + modification STARWAY ; commit de construction 06248fabe98619b1f21f6f5c8b77189e2b257fbf ; version écrite dans le jar : v7.5.1-r5py-walk2000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; R5 v7.5.1 (tag v7.5.1-r5py) + modification STARWAY ; commit de construction b7c0b5b1437fd51c184cc959ba7e4830a06ae110 ; version écrite dans le jar : v7.5.1-r5py-walk3000 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; R5 v7.5.1 (tag v7.5.1-r5py) + modifications STARWAY ; commit de construction 3ea104d9912daa03a13911e2bf6a73e3a364328d ; version écrite dans le jar : v7.5.1-r5py-walk3000-d031 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3 ; R5 v7.5.1 (tag v7.5.1-r5py) + modification STARWAY ; commit de construction 07eb46b9d83038cbfb0f916b8a847d291650b320 ; version écrite dans le jar : v7.5.1-r5py-walk7200 ; code source : tag v7.5.1-r5py, commit 2255a29e9a196dd5079853bfdbb6ba1dacdb56b3
- **Date d'extraction** : 2026-11-03T09:12Z, 2026-11-03T12:02Z, 2026-11-04T09:54Z, 2026-11-04T12:21Z, 2026-11-03T10:57Z
- **Granularité et géographie** : logiciel (moteur de routage multimodal) ; sans objet (logiciel)
- **Ce qu'on en fait** : téléchargé par r5py (64 437 972 octets) ; limite de marche d'origine de R5 : 2 000 m ; entrée du calcul des distances voiture (empreinte du jar dans les paramètres de ces calculs) ; les calculs dont les paramètres n'écrivent aucun jar ont tourné avec le jar r5py par défaut de la machine : même empreinte sur le poste et sur la machine de calcul, mais le dossier ne le prouve pas ; construit sur la machine de calcul le 03/11/2026 par le script de construction du jar (sha256 8159effa8881cccd3cd09197b195f57df769e642b39b176b31b27751630b971e) : r5py/r5 au tag v7.5.1-r5py, seule modification TransitLayer.WALK_DISTANCE_LIMIT_METERS = 1000 au lieu de 2000 (patch de sources, sha256 17530f37e97d7ecc99a43feb3f446cb035d45678a4b41c9dab58e2fd4fe9e7b1) ; règles de correspondance d'origine de R5 (avant la correction des correspondances) ; calculs historiques vers les 15 pôles ; construit sur la machine de calcul le 04/11/2026 par le script de construction du jar (sha256 443610973d3a2777fba6e517a98f4886fd97ee85b59c94700e772df58468a276) : r5py/r5 au tag v7.5.1-r5py, TransitLayer.WALK_DISTANCE_LIMIT_METERS = 1000 (une ligne changée), puis le patch des règles de correspondance (sha256 d64297022cfa9c830ce23ce1433876ac2c9c321253a532592d1c5efe9bd369ce) : transfers.txt du GTFS appliqué aussi aux itinéraires détaillés, minimum de correspondance au même arrêt lu dans les durées Navitia (TRA02C, classe StarwayTransferRules) ; entrée de r5py des calculs TC « confort » ; construit sur la machine de calcul le 04/11/2026 par le script de construction du jar (sha256 443610973d3a2777fba6e517a98f4886fd97ee85b59c94700e772df58468a276) : limite de marche 2 000 m = valeur d'origine de R5 (aucune modification de cette limite), puis seulement le patch des règles de correspondance (sha256 d64297022cfa9c830ce23ce1433876ac2c9c321253a532592d1c5efe9bd369ce) ; entrée de r5py du vélo + TC des 12 communes du récit ; construit sur la machine de calcul le 03/11/2026 par le script de construction du jar (sha256 8159effa8881cccd3cd09197b195f57df769e642b39b176b31b27751630b971e) : r5py/r5 au tag v7.5.1-r5py, seule modification TransitLayer.WALK_DISTANCE_LIMIT_METERS = 3000 au lieu de 2000 (patch de sources, sha256 7a8f5ec3d08f3dbcd72afd7371565feccfc19023b31d6ee489e581efab6da2ba) ; règles de correspondance d'origine de R5 (avant la correction des correspondances) ; calculs historiques vers les 15 pôles ; construit sur la machine de calcul le 04/11/2026 par le script de construction du jar (sha256 443610973d3a2777fba6e517a98f4886fd97ee85b59c94700e772df58468a276) : r5py/r5 au tag v7.5.1-r5py, TransitLayer.WALK_DISTANCE_LIMIT_METERS = 3000 (une ligne changée), puis le patch des règles de correspondance (sha256 d64297022cfa9c830ce23ce1433876ac2c9c321253a532592d1c5efe9bd369ce) : transfers.txt du GTFS appliqué aussi aux itinéraires détaillés, minimum de correspondance au même arrêt lu dans les durées Navitia (TRA02C, classe StarwayTransferRules) ; entrée de r5py des calculs TC « normal » (dont le matin sur TRA01B et le soir sur TRA01C) ; construit sur la machine de calcul le 03/11/2026 par le script de construction du jar (sha256 8159effa8881cccd3cd09197b195f57df769e642b39b176b31b27751630b971e) : seule modification TransitLayer.WALK_DISTANCE_LIMIT_METERS = 7200 au lieu de 2000 (patch de sources, sha256 94dfb57efcaa56a9f60f096961aaaf9a0fd11e24f00117f68d4d732cadce3cd2) ; entrée d'une variante non retenue
- **Contrôles** : sha256 recalculé le 06/11/2026 sur le fichier du poste, sur celui de la machine de calcul (sha256sum, lecture seule) et sur le fichier téléchargé de l'URL officielle : trois valeurs identiques ; sha256 lu sur la machine de calcul le 06/11/2026 (sha256sum, lecture seule, rien lancé ni arrêté) ; égal à l'empreinte écrite dans les paramètres de ces calculs ; commit relu sur la machine de calcul (git rev-parse) égal à la version écrite dans les paramètres ; sha256 du patch sur la machine de calcul égal à celui du dépôt ; sha256 lu sur la machine de calcul le 06/11/2026 (sha256sum, lecture seule, rien lancé ni arrêté) ; égal à l'empreinte écrite dans les paramètres de ces calculs ; commit relu sur la machine de calcul (git rev-parse) égal à la version écrite dans les paramètres ; sha256 du patch sur la machine de calcul égal à celui du dépôt ; contrôle du pipeline : même jar pour la matrice, la table commune x commune et les itinéraires d'un réglage de marche ; sha256 lu sur la machine de calcul le 06/11/2026 (sha256sum, lecture seule, rien lancé ni arrêté) ; égal à l'empreinte écrite dans les paramètres de ces calculs ; commit relu sur la machine de calcul (git rev-parse HEAD) ; sha256 du patch sur la machine de calcul égal à celui du dépôt ; sha256 lu sur la machine de calcul le 06/11/2026 (sha256sum, lecture seule, rien lancé ni arrêté) ; égal à l'empreinte écrite dans les paramètres de ces calculs ; commit relu sur la machine de calcul (git rev-parse) égal à la version écrite dans les paramètres ; sha256 du patch sur la machine de calcul égal à celui du dépôt ; contrôle du pipeline : même jar pour la matrice, la table commune x commune et les itinéraires d'un réglage de marche et pour un dossier de nuit et son dossier de jour ; sha256 lu sur la machine de calcul le 06/11/2026 (sha256sum, lecture seule, rien lancé ni arrêté) ; égal à l'empreinte écrite dans les paramètres de ce calcul ; commit relu sur la machine de calcul égal à la version écrite dans les paramètres ; sha256 du patch sur la machine de calcul égal à celui du dépôt
- **Limites** : jar non publié ni redistribué par le site ; un autre jar r5py changerait des temps : ne jamais en changer sans le noter ici ; calculs historiques avant la correction des règles de correspondance, remplacés par les jars -d031 pour tout ce que le site publie ; jar non publié ; limite de marche choisie par l'équipe, pas une donnée ; reproductibilité octet pour octet de la construction Gradle non vérifiée ; jar non publié ; limite de marche choisie par l'équipe, pas une donnée ; reproductibilité octet pour octet de la construction Gradle non vérifiée ; le patch ne change que les correspondances, aucune autre règle de R5 ; jar non publié ; version du code non écrite dans les paramètres de ces calculs (relevé sur la machine de calcul le 06/11/2026) ; reproductibilité octet pour octet de la construction Gradle non vérifiée ; variante non retenue : aucun temps publié n'en vient ; jar non publié ; reproductibilité octet pour octet de la construction Gradle non vérifiée
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau
  - pipeline : `traceability.py`
- **À vérifier** : fichier hors data/raw (cache ou dossier)

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `%LOCALAPPDATA%\r5py\r5-v7.5.1-r5py-all.jar (poste) ; ~/.cache/r5py/r5-v7.5.1-r5py-all.jar (VM de calcul)` | Conveyal R5 (r5py/r5 v7.5.1-r5py) - jar d'origine r5-v7.5.1-r5py-all.jar utilisé sans modification | https://github.com/r5py/r5/releases/download/v7.5.1-r5py/r5-v7.5.1-r5py-all.jar | `d50be106cadd` |
| `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk1000-all.jar` | Conveyal R5 recompilé par STARWAY - jar r5-v7.5.1-r5py-walk1000-all.jar (limite de marche 1 000 m) | https://github.com/r5py/r5.git | `2bde3cc46175` |
| `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk1000-d031-all.jar` | Conveyal R5 recompilé par STARWAY - jar r5-v7.5.1-r5py-walk1000-d031-all.jar (marche 1 000 m + règles de correspondance corrigées) | https://github.com/r5py/r5.git | `da3035beee29` |
| `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk2000-d031-all.jar` | Conveyal R5 recompilé par STARWAY - jar r5-v7.5.1-r5py-walk2000-d031-all.jar (marche 2 000 m d'origine + règles de correspondance corrigées) | https://github.com/r5py/r5.git | `20f907e735ba` |
| `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk3000-all.jar` | Conveyal R5 recompilé par STARWAY - jar r5-v7.5.1-r5py-walk3000-all.jar (limite de marche 3 000 m) | https://github.com/r5py/r5.git | `3012caa6a51f` |
| `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar` | Conveyal R5 recompilé par STARWAY - jar r5-v7.5.1-r5py-walk3000-d031-all.jar (marche 3 000 m + règles de correspondance corrigées) | https://github.com/r5py/r5.git | `977adc231142` |
| `vm-de-calcul:~/r5build/r5-v7.5.1-r5py-walk7200-all.jar` | Conveyal R5 recompilé par STARWAY - jar r5-v7.5.1-r5py-walk7200-all.jar (variante non retenue) | https://github.com/r5py/r5.git | `996fae660e07` |

### ENV01

**Émission de CO2e par voyageur-kilomètre sur le réseau** (Île-de-France Mobilités)

- **Statut** : utilisée et publiée : carbone des itinéraires détaillés (itineraries/{insee}.json, champ co2_g)
- **Licence (manifeste)** : Licence Ouverte v2.0 (Etalab)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : facteurs opérateurs 2019 et Base Carbone ADEME ; jeu mis à jour le 26/02/2024
- **Date d'extraction** : 2026-11-03T15:44Z
- **Granularité et géographie** : ligne et mode ; Île-de-France
- **Ce qu'on en fait** : colonne co2e_voy_km_par_mode_de_transport_medias_idfm (valeur par mode du calculateur IDFM) lue pour la ligne du tronçon (id_line = route_id sans IDFM:), valeur du mode pour bus, métro, tram ; x distance du tronçon le long de shapes.txt ; somme des tronçons en TC par sens ; marche non comptée
- **Contrôles** : 54 / 59 routes guidées actives avec un facteur par ligne ; contrôle du pipeline : carbone entier ou null avec raison
- **Limites** : Facteurs moyens (remplissage moyen) ; bus = gazole (ADEME) ; ligne V, câble C1, funiculaire sans facteur (null + raison) ; facteurs de 2019
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve ; panneau de preuve (itinéraires) ; visite guidée
  - pipeline : `04q_transit_alternatives.py` ; `04q_transit_alternatives_confort.py` ; `06h_export_itineraries.py` ; `06w_export_alternatives.py` ; `07f_panel_sources_coverage.py` ; `fares_carbon.py` ; `panel_sources.py` ; `traceability.py` ; `vehicles.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/ENV01/emission-de-co2e-par-voyageur-kilometre-sur-le-reseau.csv` | IDFM - Émission de CO2e par voyageur kilomètre sur le réseau | https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/emission-de-co2e-par-voyageur-kilometre-sur-le-reseau/exports/csv?delimiter=%3B&use_labels=false | `fc8f273c0be9` |

### ENV02

**Base Carbone V23.6 (facteurs d'émission de la Base Empreinte)** (ADEME)

- **Statut** : utilisée et publiée : carbone par véhicule : facteur « combustion + amont » de l'essence, du gazole et de l'électricité x consommation (meta.vehicles, bloc « Coût et carbone » du panneau de preuve)
- **Licence (manifeste)** : Licence Ouverte / Open Licence (Etalab), champ license du jeu data.ademe.fr base-carboner
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : Base Carbone V23.6 (fichier du 03/07/2025)
- **Date d'extraction** : 2026-11-04T10:00Z
- **Granularité et géographie** : élément (facteur d'émission) et postes (combustion, amont, pertes) ; métadonnées ; France continentale (éléments retenus)
- **Ce qu'on en fait** : facteurs « combustion + amont » lus par identifiant d'élément : 13988 « Essence ; E10 » 2,69 kgCO2e/litre (combustion 2,19, amont 0,502) ; 25775 « Gazole routier ; B7 » 3,1 kgCO2e/litre (2,49 et 0,609) ; 43642 « Electricité ; 2024 - mix moyen ; consommation » 0,0519 kgCO2e/kWh (centrale 0,035, amont 0,0131, pertes 0,0038) ; x consommation des véhicules (COST08, VEH01) ; aucun : version (V23.6), licence et md5 du fichier relus
- **Contrôles** : md5 du fichier = md5 publié par data.ademe.fr (39583fac...) ; statut « Valide générique », unité et localisation vérifiés ; total = somme des postes à 1 % près ; contrôle du pipeline : carbone = distance x consommation x facteur à l'arrondi près ; md5 du fichier téléchargé identique au champ file.md5
- **Limites** : énergie seule : fabrication du véhicule et de sa batterie non comptées ; facteurs carburant de décembre 2020 (période de validité de la base) ; électricité : moyenne lissée 2021 à 2024 du mix (pas d'élément « usage : Transports » pour 2024 ; celui de 2023 vaut 0,0584) ; le périmètre des facteurs IDFM des TC (ENV01) n'est pas publié : comparaison en ordre de grandeur ; documentation seulement
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance
  - pipeline : `06_export_front.py` ; `07_quality_checks.py` ; `vehicles.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/ENV02/Base_Carbone_V23.6.csv` | ADEME - Base Carbone V23.6 (facteurs d'émission de la Base Empreinte), fichier complet | https://data.ademe.fr/data-fair/api/v1/datasets/base-carboner/data-files/Base_Carbone_V23.6.csv | `01472bc24743` |
| `data/raw/ENV02/dataset-metadata.json` | ADEME - Base Carbone, métadonnées du jeu data.ademe.fr (version, licence, fichier, md5) | https://data.ademe.fr/data-fair/api/v1/datasets/base-carboner | `4035b932c1aa` |

### GEN01

**Recensement 2023, actifs occupés par sexe et mode de transport** (INSEE)

- **Statut** : utilisée et publiée : halo « Derrière notre étoile » : modes domicile-travail par sexe (context/{insee}.json)
- **Licence (manifeste)** : Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : RP 2023 (enquêtes annuelles de recensement 2021 à 2025)
- **Date d'extraction** : 2026-11-02T15:50Z, 2026-11-02T17:05Z
- **Granularité et géographie** : commune / arrondissement municipal × sexe × mode de transport ; communes (COM) et arrondissements municipaux (ARM) : les 1 286 codes IDF sont identiques à GEO01 2026 (contrôle bloquant du pipeline)
- **Ce qu'on en fait** : documentation, aucune donnée utilisée ; parts des modes (TC, voiture, vélo, marche, autres) parmi les actifs occupés résidents de chaque sexe ; règle de diffusion des petits effectifs appliquée aux parts modales (voir la méthodologie)
- **Contrôles** : somme des parts = 100 % par sexe ; effectif minimal par sexe
- **Limites** : Estimations du recensement : imprécises pour les petites communes et les petits effectifs ; aucune causalité
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `context/{insee}.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; halo (profil de la commune) ; mode provenance
  - pipeline : `05_build_context.py` ; `07l_gender_contrast_check.py` ; `context.py` ; `gender_contrast.py` ; `sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/GEN01/Aide_lecture_rp_activite_navettes.pdf` | INSEE RP 2023 - aide à la lecture des fichiers activité / navettes (documentation) | https://www.insee.fr/fr/statistiques/fichier/8992172/Aide_lecture_rp_activite_navettes.pdf | `162cd6662b14` |
| `data/raw/GEN01/DS_RP_TD_NAVETTES_SEXTRANSPORT_COMP_2023_CSV_FR.zip` | INSEE RP 2023 - Actifs occupés selon le sexe et le mode de transport domicile-travail (NAV2A/NAV2B) | https://www.insee.fr/fr/statistiques/fichier/9004421/DS_RP_TD_NAVETTES_SEXTRANSPORT_COMP_2023_CSV_FR.zip | `5277f9616b3a` |
| `data/raw/GEN01/fiche-precision.pdf` | INSEE - fiche « La précision des résultats du recensement » (documentation) | https://www.insee.fr/fr/statistiques/fichier/2383177/fiche-precision.pdf | `176599c918bc` |

### GEN04

**Recensement 2023, population par sexe et âge** (INSEE)

- **Statut** : utilisée et publiée : halo : âge des habitants ; la répartition par sexe est publiée mais pas affichée (choix du 03/11)
- **Licence (manifeste)** : Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : RP 2023 (enquêtes annuelles de recensement 2021 à 2025)
- **Date d'extraction** : 2026-11-02T15:49Z, 2026-11-02T15:51Z
- **Granularité et géographie** : commune / arrondissement municipal × sexe × âge ; communes (COM) et arrondissements municipaux (ARM) : les 1 286 codes IDF sont identiques à GEO01 2026 (contrôle bloquant du pipeline)
- **Ce qu'on en fait** : documentation, aucune donnée utilisée ; parts par sexe et par tranche d'âge (0-14, 15-29, 30-44, 45-59, 60-74, 75+) de la population
- **Contrôles** : somme des parts = 100 % ; total = somme des modalités
- **Limites** : Estimations du recensement : imprécises pour les petites communes et les petits effectifs ; aucune causalité
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `context/{insee}.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; halo (profil de la commune) ; mode provenance
  - pipeline : `05_build_context.py` ; `context.py` ; `sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/GEN04/Aide_lecture_rp_population.pdf` | INSEE RP 2023 - aide à la lecture des fichiers population (documentation) | https://www.insee.fr/fr/statistiques/fichier/9005956/Aide_lecture_rp_population.pdf | `e6218ebbc2bc` |
| `data/raw/GEN04/DS_RP_TD_POPULATION_AGESEX_PRINC_2023_CSV_FR.zip` | INSEE RP 2023 - Population par sexe et âge (POP1, exploitation principale) | https://www.insee.fr/fr/statistiques/fichier/9006235/DS_RP_TD_POPULATION_AGESEX_PRINC_2023_CSV_FR.zip | `48e2c39b3fc4` |

### GEO01

**Communes et arrondissements d'Île-de-France** (Etalab, API Géo (d'après IGN ADMIN EXPRESS))

- **Statut** : utilisée et publiée : 1 285 origines, contours de la carte miroir (communes.json, geo/)
- **Licence (manifeste)** : ODbL 1.0 : jeu Etalab « Contours administratifs » (data.gouv.fr), « utilisé par l'API Découpage Administratif », constitué à partir d'IGN ADMIN EXPRESS (Licence Ouverte 2.0) ; attribution et partage à l'identique des bases dérivées (ex. geo/*.geojson) ; ODbL 1.0 pour les contours administratifs du jeu Etalab servi par l'API Géo (comme les autres lignes GEO01) ; champ codesPostaux : Licence Ouverte 2.0 pour sa source, la « Base officielle des codes postaux » de La Poste (champ license = lov2 de la fiche data.gouv.fr 545b55e1c751df52de9b6045, lu le 09/11/2026 ; le dépôt etalab/decoupage-administratif, dont dépend l'API Géo, écrit dans son README lu le 09/11/2026 : « issue des données La Poste. Antérieurement, sous licence ODBL, maintenant en LO ») ; table de correspondance seulement, fichier non redistribué
- **Obligations** : ODbL : citer la source ; toute base dérivée publiée (nos fichiers de données) reste sous ODbL et le dit (partage à l'identique) ; Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : géographie (COG) en vigueur à la date d'extraction
- **Date d'extraction** : 2026-11-02T14:26Z, 2026-11-05T11:14Z, 2026-11-02T22:05Z
- **Granularité et géographie** : arrondissement municipal ; arrondissement municipal (un point) ; commune associée / déléguée ; commune ; commune (un point) ; COG en vigueur à la date d'extraction (2026)
- **Ce qu'on en fait** : les 20 arrondissements servent d'origines à la place de 75056 ; 75001 à 75020 -> 75101 à 75120 et 75116 -> 75116 pour rattacher les offres de EMP04 ; analyse des points d'origine ; table de passage ancien code -> code 2026 (chefLieu) pour les sources en géographie antérieure ; filtre départements 75/77/78/91/92/93/94/95 ; Paris 75056 remplacé par ses 20 arrondissements ; table code postal -> communes pour rattacher les offres de EMP04 ; Paris 75056 écartée au profit des arrondissements ; analyse des points d'origine ; pas encore utilisé par le calcul
- **Contrôles** : 20 arrondissements 75101..75120 ; 20 arrondissements ; tout code source absent de la géographie 2026 doit être résolu, sinon échec ; nombre de communes, codes uniques, géométries valides ; 1 285 communes et arrondissements recoupent exactement les communes des 44 astres ; un point par commune
- **Limites** : Le centre de l'arrondissement n'est pas un lieu de domicile ; Le 16e porte deux codes postaux (75016 et 75116) ; Les 1er à 4e arrondissements partagent la mairie de Paris Centre (même point) ; ne couvre que les fusions avec communes associées/déléguées ; une scission ne serait pas détectée ; Le centre de la commune n'est pas un lieu de domicile ; population = population légale servie par l'API ; Un code postal peut désigner plusieurs communes ; les codes Cedex ne figurent pas dans le champ codesPostaux ; La mairie n'est pas un lieu de domicile ; position IGN ADMIN EXPRESS
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `geo/communes.geojson` ; `geo/poles.geojson`
  - code du front qui la cite (écran déduit du chemin) : affiche exportable ; carte miroir ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve
  - pipeline : `01_download.py` ; `02_build_geo.py` ; `02b_origin_points_analysis.py` ; `03b_sky_groups.py` ; `04j_toll_tariffs.py` ; `05_build_context.py` ; `05b_velib_coverage.py` ; `06b_export_geo.py` ; `06q_export_service_public.py` ; `07_quality_checks.py` ; `geo.py` ; `geo_export.py` ; `insights.py` ; `origin_points.py` ; `runs.py` ; `sources.py` ; `toll_tariffs.py` ; `traceability.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/GEO01/arrondissements_paris.json` | API Géo - arrondissements municipaux de Paris (contours, centre, population) | https://geo.api.gouv.fr/communes?codeDepartement=75&type=arrondissement-municipal&fields=code,nom,codeDepartement,codeRegion,population,centre,surface,contour&format=json | `22f4fc84f3ba` |
| `data/raw/GEO01/arrondissements_paris_codes_postaux.json` | API Géo - arrondissements de Paris, codes postaux (champ codesPostaux) | https://geo.api.gouv.fr/communes?codeDepartement=75&type=arrondissement-municipal&fields=code,nom,codesPostaux,codeDepartement&format=json | `351d4b8b975a` |
| `data/raw/GEO01/arrondissements_paris_mairie.json` | API Géo - position de la mairie des arrondissements de Paris (champ mairie) | https://geo.api.gouv.fr/communes?codeDepartement=75&type=arrondissement-municipal&fields=code,nom,centre,mairie&format=json | `85cc1bacb6b1` |
| `data/raw/GEO01/communes_associees_deleguees_idf.json` | API Géo - communes associées et déléguées d'Île-de-France (rattachement au chef-lieu) | https://geo.api.gouv.fr/communes_associees_deleguees?codeRegion=11&format=json | `1e4efc6a8f9b` |
| `data/raw/GEO01/communes_idf.json` | API Géo - communes de la région Île-de-France (contours, centre, population) | https://geo.api.gouv.fr/communes?codeRegion=11&fields=code,nom,codeDepartement,codeRegion,population,centre,surface,contour&format=json | `7971933dbbc5` |
| `data/raw/GEO01/communes_idf_codes_postaux.json` | API Géo - communes de la région Île-de-France, codes postaux (champ codesPostaux) | https://geo.api.gouv.fr/communes?codeRegion=11&fields=code,nom,codesPostaux,codeDepartement&format=json | `1549bbc6da98` |
| `data/raw/GEO01/communes_idf_mairie.json` | API Géo - position de la mairie des communes d'Île-de-France (champ mairie) | https://geo.api.gouv.fr/communes?codeRegion=11&fields=code,nom,codeDepartement,centre,mairie&format=json | `a820a43e50fd` |

### GEO02

**Filosofi 2021, carreaux de 200 m** (INSEE)

- **Statut** : utilisée et publiée : point de départ de chaque commune, centre de gravité de la population : tous les temps publiés en dérivent
- **Licence (manifeste)** : Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : revenus 2021, publié le 12/02/2026 (page 8735162) ; Filosofi 2021
- **Date d'extraction** : 2026-11-02T22:06Z
- **Granularité et géographie** : carreau de 200 m (grille Inspire, EPSG:3035) ; documentation ; France métropolitaine, Martinique, La Réunion ; lcog_geo en COG 2021 (non utilisé : rattachement spatial aux contours GEO01 2026)
- **Ce qu'on en fait** : point d'origine du routage : centre de gravité de la population (ind) par commune 2026, ou carreau habité le plus proche ; carreaux d'Île-de-France lus par morceaux ; définitions des variables idcar_200m, ind, i_est_200, lcog_geo
- **Contrôles** : somme de ind par commune comparée à la population légale
- **Limites** : carreaux de moins de 11 ménages fiscaux imputés (i_est_200 = 1) ; un carreau à cheval sur deux communes est rattaché à celle qui contient son centre ; population des ménages fiscaux (hors communautés) ; instantané d'une page web à la date d'extraction, la page a pu changer depuis ; documentation seulement : aucune valeur publiée n'en vient
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : affiche exportable ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve
  - pipeline : `02_build_geo.py` ; `02b_origin_points_analysis.py` ; `sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/GEO02/Filosofi2021_carreaux_200m_csv.zip` | INSEE Filosofi 2021 - données au carreau de 200 m (y compris données imputées), csv | https://www.insee.fr/fr/statistiques/fichier/8735162/Filosofi2021_carreaux_200m_csv.zip | `5935efb1b734` |
| `data/raw/GEO02/page-8735162.html` | INSEE - page « Données au carreau de 200m (y compris données imputées) » (instantané HTML, documentation et dictionnaire des variables) | https://www.insee.fr/fr/statistiques/8735162 | `1989858d4cf0` |

### GEO02B

**Points d'origine des 1 285 communes et arrondissements (data/processed/communes_idf_2026.csv)** (INSEE (Filosofi 2021) et Etalab (API Géo), fichier dérivé par STARWAY)

- **Statut** : utilisée et publiée : centre de gravité de la population de chaque commune, départ et arrivée de tous les calculs r5py ; empreinte de contenu écrite dans les run_params.json (origin_points_sha256)
- **Licence (manifeste)** : fichier dérivé : Licence Ouverte / Open Licence Etalab 2.0 (GEO02, conditions de réutilisation INSEE) et ODbL 1.0 (GEO01, contours Etalab d'après IGN ADMIN EXPRESS)
- **Obligations** : ODbL : citer la source ; toute base dérivée publiée (nos fichiers de données) reste sous ODbL et le dit (partage à l'identique) ; Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : dérivé de GEO02 (Filosofi 2021 carreaux de 200 m) et GEO01 (géographie des communes 2026)
- **Date d'extraction** : 2026-11-03T09:31Z
- **Granularité et géographie** : commune ou arrondissement (un point par origine) ; Île-de-France
- **Ce qu'on en fait** : entrées : carreaux Filosofi de 200 m (GEO02, https://www.insee.fr/fr/statistiques/8735162) et géographie des communes (GEO01, https://geo.api.gouv.fr) ; fichier dérivé versionné dans le dépôt du projet ; écrit par le pipeline : origin_lon et origin_lat = centre de gravité de la population (variable ind des carreaux Filosofi de 200 m) de la commune 2026, ou carreau habité le plus proche (colonne origin_method) ; 1 286 lignes (1 266 communes et 20 arrondissements de Paris), 1 285 origines (la commune de Paris 75056 n'est pas une origine : ses 20 arrondissements la remplacent) ; départ et arrivée de tous les calculs r5py
- **Contrôles** : origin_points_sha256 recalculé le 06/11/2026 par le pipeline sur les 1 285 origines = dc97ca710c6c539901e92f05003c8db4d1a3ed6bc15551ef48c55d6e5c4d89f9 = valeur écrite dans les paramètres des calculs (empreinte de CONTENU : identifiant et coordonnées arrondies à 6 décimales, pas du fichier) ; les contrôles refusent des lots calculés avec d'autres points ; sha256 du fichier en fins de ligne LF (index git) ; celui des fins de ligne CRLF du poste Windows est 92f8eec1b7cc932b7132719d99b759d5120cb8a7ba7e28a716cc418738343661, accepté aussi par les contrôles
- **Limites** : un point par commune (centre de gravité de la population), pas une adresse ; les trajets internes à une commune ne sont pas mesurés
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau
  - pipeline : `territoire.py` ; `traceability.py`
- **À vérifier** : fichier hors data/raw (cache ou dossier)

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/processed/communes_idf_2026.csv` | Points d'origine des 1 285 communes et arrondissements d'Île-de-France, fichier dérivé construit par STARWAY | https://www.insee.fr/fr/statistiques/8735162 | `a5ccd3bcbb8f` |

### GEO04

**Bassins d'emploi 2026** (France Travail)

- **Statut** : utilisée et publiée : rattachement des origines aux bassins et noms des 44 astres (poles.json du ciel, publié depuis la bascule du 05/11)
- **Licence (manifeste)** : non écrite par France Travail : ni sur la page méthode BMO 2026, ni sur francetravail.org/opendata, ni dans les informations légales (lues le 03/11/2026) ; le fichier n'est pas une ressource du jeu data.gouv BMO (Licence Ouverte 1.0). Règle retenue par défaut (choix de l'équipe du 04/11/2026) : réutilisation libre en citant la source (France Travail, bassins d'emploi 2026) et la date (fichier du 17/04/2026, lu le 03/11/2026), sans altération des libellés ; information publique d'un établissement public (CRPA, art. L321-1 et L322-1). Réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités) le 09/11/2026, à trois conditions : données obtenues par mise à disposition et non par scraping, la dataviz ne permet pas de réexporter les données brutes, producteur crédité dans la dataviz elle-même ; son message nomme VINCI : l'appliquer à cette source est la lecture de l'équipe (10/11/2026)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour ; régime par défaut des informations publiques (CRPA, art. L321-1 et L322-1) : sans altération ni dénaturation, source et date de mise à jour citées ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités, 09/11/2026) à trois conditions : données obtenues par mise à disposition du producteur, jamais par scraping ; la dataviz ne permet pas de réexporter les données brutes ; le producteur est crédité dans la dataviz elle-même, à côté de chaque montant. Ne vaut pas licence de redistribution des données
- **Millésime** : 2026 (bassins d'emploi 2026 ; Last-Modified HTTP : 17/04/2026 08:43 GMT)
- **Date d'extraction** : 2026-11-03T22:13Z
- **Granularité et géographie** : commune (code INSEE) -> bassin d'emploi France Travail ; 34 990 codes France entière ; IDF (region 11) : 1 289 codes, 25 bassins ; Paris par arrondissement (T1 Paris)
- **Ce qu'on en fait** : lecture openpyxl/pandas, filtre region = 11 ; libellés de bassin recopiés tels quels (aucun tiret U+2013/U+2014 présent) ; rattachement des 1 285 origines ; depuis le 04/11 : 44 astres (24 bassins + 20 arrondissements de T1 Paris), postes Flores sommés, nom du ciel = commune la plus pourvue en postes, nom du panneau = libellé GEO04 recopié, position = barycentre des postes
- **Contrôles** : en-tête des 6 colonnes contrôlé ; aucun code en double ; 1 285 origines sur 1 285 rattachées ; 3 communes déléguées (77170, 77299, 93059) dans le bassin de leur chef-lieu ; 1 code hors origines (95282 Gouzangrez, fusionné dans Commeny 95169 au 01/01/2024 selon l'INSEE, même bassin) ; nom de fichier d'origine Bassins_d'emploi_2026.xlsx (Content-Disposition), URL redirigée vers images.pr-rooms.com ; sha256 identique à la copie d'examen du 03/11 (proposition-panneau-preuve.md)
- **Limites** : découpage administratif de France Travail (territoire d'une ou plusieurs agences), pas une zone d'emploi INSEE ; Paris = un seul bassin ; 3 libellés de commune diffèrent de l'API Géo (orthographe), codes identiques
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `bmo.json` ; `bmo_metiers.json` ; `poles.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance
  - pipeline : `03b_sky_groups.py` ; `06j_export_bmo.py` ; `07_quality_checks.py` ; `08c_tour_challenge_cases.py` ; `bmo.py` ; `licences_attente.py` ; `sky_groups.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/GEO04/Bassins_d_emploi_2026_lu_2026-11-03.xlsx` | France Travail - Bassins d'emploi 2026 (table commune -> bassin d'emploi, fichier de la méthode BMO 2026) | https://statistiques.francetravail.org/bmo/Handlers/HTFile.ashx?MEDIAID=188096 | `3c7f5048491b` |

### GEO04B

**Fichier des 44 astres : bassins d'emploi, Paris en 20 arrondissements (data/processed/poles_d030.json)** (France Travail (bassins 2026), fichier dérivé par STARWAY)

- **Statut** : utilisée et publiée : poles.json du ciel des 44 astres : postes Flores sommés, nom, arrêt d'ancrage, position ; arrivée de tous les calculs r5py vers les astres (poles_json_sha256 des run_params.json)
- **Licence (manifeste)** : fichier dérivé : mêmes conditions que ses entrées ; GEO04 (France Travail) : licence non écrite, règle par défaut CRPA art. L321-1 et L322-1 (libellés recopiés sans altération), réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités) le 09/11/2026 sous conditions (lecture de l'équipe, voir GEO04) ; EMP01 : Licence Ouverte (Etalab) ; GEO01 : ODbL 1.0 ; TRA01 : Licence Mobilités (IDFM)
- **Obligations** : ODbL : citer la source ; toute base dérivée publiée (nos fichiers de données) reste sous ODbL et le dit (partage à l'identique) ; Licence Mobilités (IDFM, inspirée de l'ODbL) : attribution ; partage à l'identique limité aux données de même nature, granularité, période et emprise (communiqué GART et UTP du 08/03/2021) ; texte officiel à relire ; Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour ; régime par défaut des informations publiques (CRPA, art. L321-1 et L322-1) : sans altération ni dénaturation, source et date de mise à jour citées ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités, 09/11/2026) à trois conditions : données obtenues par mise à disposition du producteur, jamais par scraping ; la dataviz ne permet pas de réexporter les données brutes ; le producteur est crédité dans la dataviz elle-même, à côté de chaque montant. Ne vaut pas licence de redistribution des données
- **Millésime** : dérivé de GEO04 (bassins d'emploi 2026), EMP01 (Flores 2023, postes salariés recensés par l'INSEE), GEO01 (géographie des communes 2026) et TRA01 (arrêts les plus desservis le 17/11/2026)
- **Date d'extraction** : 2026-11-04T10:49Z
- **Date de service transport** : 2026-11-17
- **Granularité et géographie** : astre (bassin d'emploi ou arrondissement de Paris) ; Île-de-France
- **Ce qu'on en fait** : entrée principale : fichier des bassins d'emploi 2026 de France Travail (GEO04, adresse ci-dessus) ; fichier dérivé versionné dans le dépôt du projet ; construit par le pipeline (choix de l'équipe du 04/11/2026) : 44 astres = 24 bassins d'emploi France Travail d'Île-de-France hors Paris + les 20 arrondissements de Paris ; postes d'un astre = somme des postes Flores 2023 de ses communes (EMP01) ; nom court = commune qui compte le plus de postes, nom officiel = libellé GEO04 recopié ; arrêt d'affichage = arrêt parent le plus desservi le 17/11/2026 dans les communes de l'astre (règle du pipeline) ; position du ciel = barycentre des postes Flores (centres API Géo en Lambert-93, sky_project, sans relaxation) ; copie publiée : poles.json du front, écrit par le pipeline
- **Contrôles** : le contrôle du pipeline recalcule les règles depuis GEO04, EMP01 et GEO01 : nombre d'astres, positions, tailles, noms, arrêts ; empreinte des astres écrite dans les paramètres des calculs = cette empreinte (octets du fichier lu par les calculs, fins de ligne CRLF du poste Windows) ; les mêmes données en fins de ligne LF ont pour sha256 ed979ad44ec813032d1908b6bb75a392f781ca5af2373e0b5411f79c0bfe4111, accepté aussi par les contrôles
- **Limites** : dépend de la licence de GEO04, non écrite par France Travail ; le découpage en astres, les noms courts et la position sont un choix de l'équipe, pas une donnée officielle ; un bassin d'emploi est un découpage administratif de France Travail, pas une zone d'emploi INSEE
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau
  - pipeline : `licences_attente.py` ; `traceability.py`
- **À vérifier** : fichier hors data/raw (cache ou dossier)

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/processed/poles_d030.json` | France Travail - Bassins d'emploi 2026 (GEO04) et postes Flores 2023 (EMP01) : fichier des 44 astres, fichier dérivé construit par STARWAY | https://statistiques.francetravail.org/bmo/Handlers/HTFile.ashx?MEDIAID=188096 | `92fa117feb2a` |

### GEO05

**Zones d'emploi, composition communale au 01/01/2026** (INSEE, via la Région Île-de-France)

- **Statut** : utilisée et publiée : zone d'emploi de chacune des 1 285 communes de départ (territoire.json, lot T1, plan du 06/11), les 20 arrondissements de Paris par la commune de Paris ; libellés des 15 zones ; publié mais pas encore affiché (onglet « Chômage » prévu au lot T3). Une zone d'emploi n'est pas un bassin d'emploi de France Travail (GEO04) ni un astre
- **Licence (manifeste)** : Licence Ouverte v2.0 (notée au téléchargement : « Insee via la Région, Licence Ouverte v2.0 ») ; mentionner la source (Insee, via la Région Île-de-France) et la date (composition au 01/01/2026, fichier lu le 06/11/2026)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : composition communale au 01/01/2026 (zones d'emploi en base 2020)
- **Date d'extraction** : 2026-11-06
- **Granularité et géographie** : commune -> zone d'emploi 2020 (code et libellé) ; Île-de-France (région 11) : 1 266 communes dont Paris (75056)
- **Ce qu'on en fait** : zone d'emploi de chaque commune de départ ; les 20 arrondissements de Paris prennent la zone de la commune 75056 ; libellé de zone recopié (territoire.json, chomage.zones et communes)
- **Contrôles** : contrôle « repères de territoire » : chaque commune de départ a une zone, chaque zone a un taux (SOC02), noms publiés = fichier brut ; empreinte = manifeste = note de téléchargement
- **Limites** : Les libellés de zone diffèrent un peu de ceux du fichier des taux (SOC02 écrit Evry et Etampes) ; une zone d'emploi n'est pas un bassin d'emploi de France Travail (GEO04) ni un astre
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `territoire.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `06v_export_territoire.py` ; `07_quality_checks.py` ; `territoire.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/GEO05/ze.json` | Insee via la Région Île-de-France - Base des zones d'emploi : composition communale au 01/01/2026 (ze.json) | https://data.iledefrance.fr/api/explore/v2.1/catalog/datasets/base-des-zones-demploi/exports/json?select=codgeo,libgeo,dep,reg,ze2020,libze2020 | `ab79adda6746` |

### GEO06

**Polarités du SDRIF-E** (Région Île-de-France et Institut Paris Region)

- **Statut** : utilisée et publiée : polarité de la commune, par son nom résolu en code INSEE (7 noms mal écrits corrigés par une table explicite) ; territoire.json (lot T1, plan du 06/11), publié mais pas encore affiché (lot T4) ; ce n'est pas un classement d'accessibilité, aucun niveau 1 ou 2 publié
- **Licence (manifeste)** : Licence Ouverte v2.0 (notée au téléchargement : « Région Île-de-France et Institut Paris Region, Licence Ouverte v2.0 ») ; mentionner la source (Région Île-de-France, Institut Paris Region) et la date (fichier lu le 06/11/2026)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : polarités du SDRIF-E ; fichier lu le 06/11/2026
- **Date d'extraction** : 2026-11-06
- **Granularité et géographie** : polarité : une ou plusieurs communes citées par leur NOM (aucun code), niveau d'importance 1 ou 2 que la source ne définit pas ; Île-de-France ; polarités avec un point et la liste des communes
- **Ce qu'on en fait** : chaque nom de commune résolu en code INSEE sur communes_idf_2026.csv ; 7 noms mal écrits corrigés par une table explicite (NAME_FIXES) ; la polarité « Paris » vaut pour les 20 arrondissements ; niveau d'importance non publié ; publié dans territoire.json (communes, polarity)
- **Contrôles** : contrôle « repères de territoire » : chaque nom de polarité publié se retrouve dans le fichier brut ; export en échec si un nom reste sans code, si une commune est citée par deux polarités ou si une correction n'est plus utilisée ; empreinte = manifeste = note de téléchargement
- **Limites** : Polarités existantes ou en devenir : ce n'est pas un classement d'accessibilité ; niveaux 1 et 2 non définis par la source donc non affichés ; liaison par le nom, 7 fautes d'écriture corrigées à la main ; une commune sans polarité n'est pas une commune sans équipements
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `territoire.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `06v_export_territoire.py` ; `07_quality_checks.py` ; `territoire.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/GEO06/polarites.csv` | Région Île-de-France et Institut Paris Region - Polarités du SDRIF-E constituées d'une ou plusieurs communes (polarites.csv) | https://data.iledefrance.fr/api/explore/v2.1/catalog/datasets/polarites-sdrif-e/exports/csv?use_labels=true | `be69ad9c6ab3` |

### QS01

**Régularité mensuelle Transilien** (SNCF Voyageurs)

- **Statut** : utilisée et publiée : ponctualité mensuelle de chaque ligne RER et Transilien, avec le mois, sur chaque tronçon des itinéraires détaillés (itineraries/{insee}.json.gz, champ punctuality ; ODbL, base dérivée publiée sous la même licence)
- **Licence (manifeste)** : ODbL (Open Database License), métadonnées du jeu sur ressources.data.sncf.com (vérifié le 04/11/2026) ; attribution et partage à l'identique des bases dérivées
- **Obligations** : ODbL : citer la source ; toute base dérivée publiée (nos fichiers de données) reste sous ODbL et le dit (partage à l'identique)
- **Millésime** : janvier 2013 à septembre 2026 (jeu modifié le 08/10/2026)
- **Date d'extraction** : 2026-11-03T15:44Z
- **Granularité et géographie** : ligne x mois ; 13 lignes RER et Transilien
- **Ce qu'on en fait** : analyse de couverture seulement ; rien de publié
- **Contrôles** : 13 / 24 routes train actives couvertes
- **Limites** : Ponctualité de la ligne, pas du trajet ; pas de métro, tram, bus ni ligne V ; RER A et B : périmètre RATP + SNCF à vérifier
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve ; panneau de preuve (itinéraires)
  - pipeline : `06h_export_itineraries.py` ; `07_quality_checks.py` ; `07f_panel_sources_coverage.py` ; `itin_export.py` ; `line_facts.py` ; `panel_sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/QS01/ponctualite-mensuelle-transilien.csv` | SNCF Voyageurs - Régularité mensuelle Transilien (ponctualité voyageurs) | https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/ponctualite-mensuelle-transilien/exports/csv?delimiter=%3B&use_labels=false | `f382c5238e0e` |

### ROAD01

**Baromètre trafic mensuel n° 41 (novembre 2025)** (DRIEAT Île-de-France, DiRIF)

- **Statut** : utilisée et publiée : coefficients du mode « Voiture (trafic moyen DiRIF) » (meta.car_congestion). Licence écrite dans le pied de page du site (« Sauf mention contraire, tous les contenus de ce site sont sous licence etalab-2.0 », page https://www.dir.ile-de-france.developpement-durable.gouv.fr/barometre-trafic-mensuel-de-la-circulation-annee-a1804.html?lang=fr, relue le 09/11/2026) ; la page de mentions légales du site reste illisible (réponse « Erreur »)
- **Licence (manifeste)** : Licence Ouverte 2.0 (etalab-2.0) : pied de page du site, « Sauf mention contraire, tous les contenus de ce site sont sous licence etalab-2.0 » (lien vers le texte de la Licence Ouverte, github.com/etalab/licence-ouverte), relu le 09/11/2026 sur la page du baromètre ; aucune mention contraire sur cette page ni dans le PDF (lus le 09/11/2026) ; la page Mentions légales du site reste illisible (mentions-legales-a1546.html, réponse « Erreur » le 09/11/2026) : le pied de page est la seule mention du producteur
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : novembre 2025 (jours ouvrés, hors week-ends et jours fériés) ; page consultée le 05/11/2026 (liste des numéros de l'année 2025)
- **Date d'extraction** : 2026-11-03T22:00Z, 2026-11-05T11:06Z
- **Granularité et géographie** : moyenne mensuelle, 3 périodes horaires (6h-10h, 10h-16h, 16h-20h) ; page web (liste de fichiers PDF) ; voies structurantes du réseau routier national non concédé d'Île-de-France (ex. A86, A1, N118, N104), hors boulevard périphérique et axes bidirectionnels ; Île-de-France
- **Ce qu'on en fait** : indices lus sur le graphique mensuel de la page 2 (image JPEG, numérisée par pixels : graduations détectées, centre du trait par couleur), arrondis à 0,01 : 6h-10h 1,75 ; 10h-16h 1,39 ; 16h-20h 1,95 ; reportés dans le code du pipeline et publiés dans les données du site ; aucun chiffre repris : la page prouve seulement le numéro et l'adresse du PDF utilisé (lien « Baromètre trafic mensuel de la circulation - Novembre 2025 », IMG/pdf/barometre_mensuel_no41-_novembre_2025.pdf, 1.7 Mio) et la mention de licence du pied de page
- **Contrôles** : relecture du 03/11 au soir sur cette copie : 1,744 à 1,760 ; 1,383 à 1,387 ; 1,951 à 1,955 selon la colonne de pixels ; concordance avec la moyenne des barres journalières (écart <= 0,012) et avec les numéros de décembre 2025 et juillet 2026 (écart <= 0,006) ; le lien « Mentions légales » du pied de page (mentions-legales-a1546.html) répond 200 avec un corps de 15 octets (« <!-- Erreur --> ») le 05/11/2026 : page cassée, aucune mention légale lisible
- **Limites** : valeurs lues sur un graphique (± 0,02), la DiRIF ne publie pas les nombres ; moyenne sur 4 h, un mois et tout le réseau ; voies rapides seulement ; aucune mesure avant 6h ni après 20h ; pondération des tronçons non publiée ; l'appliquer à tout un trajet est un choix de l'équipe, pas une mesure ; la mention « sauf mention contraire » vaut pour les contenus du site, pas pour une mention propre au PDF (le PDF n'en affiche aucune) ; la licence est donc déduite, non établie par un texte de mentions légales
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance ; panneau de preuve
  - pipeline : `06_export_front.py` ; `07_quality_checks.py` ; `congestion.py` ; `sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/ROAD01/barometre_mensuel_no41-_novembre_2025.pdf` | DRIEAT Île-de-France, DiRIF - Baromètre trafic mensuel de la circulation, novembre 2025 (n° 41), page 2 « Temps de parcours les jours ouvrés » | https://www.dir.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/barometre_mensuel_no41-_novembre_2025.pdf | `9018fb3bdf78` |
| `data/raw/ROAD01/barometre_mensuel_page-liste-2025.html` | DRIEAT Île-de-France, DiRIF - page « Baromètre trafic mensuel de la circulation - Année 2025 » (liste des numéros, pied de page : licence du site), instantané HTML | https://www.dir.ile-de-france.developpement-durable.gouv.fr/barometre-trafic-mensuel-de-la-circulation-annee-a1804.html?lang=fr | `e42e0b9bf08c` |

### SOC01

**Filosofi 2023, revenus et pauvreté** (INSEE)

- **Statut** : utilisée et publiée : halo : niveau de vie médian et taux de pauvreté, secret statistique respecté (context/{insee}.json)
- **Licence (manifeste)** : Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE) ; Licence Ouverte / Open Licence Etalab 2.0
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : 2023 (revenus déclarés 2023) ; 2023
- **Date d'extraction** : 2026-11-02T15:50Z
- **Granularité et géographie** : commune / arrondissement municipal ; communes (COM) et arrondissements municipaux (ARM) : les 1 286 codes IDF sont identiques à GEO01 2026 (contrôle bloquant du pipeline)
- **Ce qu'on en fait** : niveau de vie médian (€/an) et taux de pauvreté au seuil de 60 % (%) ; documentation, aucune donnée utilisée
- **Contrôles** : valeurs absentes = secret statistique (status secret)
- **Limites** : Indicateurs descriptifs, aucune causalité avec l'accessibilité ; secret statistique pour les petites communes ; documentation seulement : aucune valeur publiée n'en vient
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `context/{insee}.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; halo (profil de la commune) ; mode provenance ; visite guidée
  - pipeline : `05_build_context.py` ; `context.py` ; `sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/SOC01/FILOSOFI_CC_csv.zip` | INSEE Filosofi 2023 - Indicateurs sur les revenus et la pauvreté au niveau local | https://www.insee.fr/fr/statistiques/fichier/8984752/FILOSOFI_CC_csv.zip | `f3822a78e3f5` |
| `data/raw/SOC01/Note_accompagnement_Filosofi_2023.pdf` | INSEE Filosofi 2023 - note d'accompagnement (documentation) | https://www.insee.fr/fr/statistiques/fichier/8984752/Note_accompagnement_Filosofi_2023.pdf | `3979fbbc67ae` |

### SOC02

**Taux de chômage localisés (zones d'emploi, départements, région) du 2e trimestre 2026** (INSEE)

- **Statut** : utilisée et publiée : territoire.json (lot T1, plan du 06/11) : taux de chômage au lieu de résidence des 15 zones d'emploi d'Île-de-France (série trimestrielle), des 8 départements et de la région, dernier trimestre provisoire ; publié mais pas encore affiché (onglet « Chômage » prévu au lot T3) ; descriptif, aucun taux sur un astre, aucun lien de cause. Licence Ouverte 2.0 par défaut du site de l'Insee (page lue le 09/11/2026)
- **Licence (manifeste)** : Licence Ouverte / Open Licence version 2.0 (Etalab), licence par défaut du site de l'Insee (« Sauf mention contraire », page Mentions légales et crédits mise à jour le 13/04/2026, lue le 09/11/2026) ; aucune mention contraire sur la page du fichier ni dans le fichier, lus le 09/11/2026. Conditions : citer « Source : Insee », la date de parution (18/09/2026), ne pas altérer le sens des informations
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : 2e trimestre 2026 provisoire (« (p) » dans l'en-tête), paru le 18/09/2026 ; série trimestrielle du 1er trimestre 2003 au 2e trimestre 2026, paru le 18/09/2026 ; zones d'emploi en base 2020 ; dernier trimestre provisoire d'après l'en-tête du fichier des départements et de la région (TCRD_025)
- **Date d'extraction** : 2026-11-06
- **Granularité et géographie** : département et région ; taux de chômage trimestriel CVS, au lieu de résidence ; zone d'emploi ; taux de chômage trimestriel CVS, au lieu de résidence, une colonne par trimestre ; France ; Île-de-France : les 8 départements (feuille DEP) et la région (feuille REG) ; France hors Mayotte et Guyane (302 zones d'emploi et 28 parties régionales de zones interrégionales d'après la documentation du fichier) ; Île-de-France : lignes de code de région 11
- **Ce qu'on en fait** : lecture du XML du classeur TCRD_025.xlsx contenu dans le zip (openpyxl échoue dessus : dessin manquant dans le classeur) ; chaque code est lu dans sa feuille (le code 11 est l'Aude en DEP, 75 la Nouvelle-Aquitaine en REG) ; colonne du dernier trimestre ; publié dans territoire.json (chomage.departments, chomage.region) ; feuille txcho_ze, lignes dont le CODE de région est 11 (pas un filtre par texte, qui attraperait aussi Creusot-Montceau), série complète de chaque zone, aucune valeur modifiée ; le libellé publié de la zone vient de GEO05 ; publié dans territoire.json (chomage.zones), onglet « Chômage » prévu (prévu au plan)
- **Contrôles** : contrôle « repères de territoire » : taux publiés = fichier brut (relecture indépendante) ; trimestre du fichier = dernier trimestre de la série des zones ; empreinte du fichier = manifeste = note de téléchargement ; contrôle « repères de territoire » : chaque taux publié se retrouve dans le fichier brut (relecture indépendante), toutes les zones ont une série complète, aucune valeur absente ; empreinte du fichier = manifeste = note de téléchargement
- **Limites** : Taux mesuré au lieu de résidence, descriptif, aucun lien de cause avec l'accessibilité ; dernier trimestre provisoire ; un seul trimestre publié (pas de série) ; Maille de la zone d'emploi, plus large que la commune et différente des bassins d'emploi des astres ; taux mesuré au lieu de résidence, descriptif, aucun lien de cause avec l'accessibilité ; dernier trimestre provisoire ; séries dessinées dans le découpage 2020 des zones
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `territoire.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance
  - pipeline : `06v_export_territoire.py` ; `07_quality_checks.py` ; `territoire.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/SOC02/TCRD_025.zip` | Insee - Taux de chômage localisés, comparaisons départementales et régionales (TCRD_025.zip) | https://www.insee.fr/fr/statistiques/fichier/2012804/TCRD_025.zip | `545f2d5b22f5` |
| `data/raw/SOC02/chomage-zone-t1-2003-t2-2026.xlsx` | Insee - Taux de chômage par zone d'emploi (chomage-zone-t1-2003-t2-2026.xlsx) | https://www.insee.fr/fr/statistiques/fichier/1893230/chomage-zone-t1-2003-t2-2026.xlsx | `0662c648e68f` |

### SUB01

**Description et tarif des titres de transport (jeu titres-et-tarifs)** (Île-de-France Mobilités)

- **Statut** : utilisée et publiée : prix des abonnements de la zone « Mes abonnements » (subscriptions.json)
- **Licence (manifeste)** : Licence Ouverte v2.0 (Etalab), champ license des métadonnées du jeu ; Licence Ouverte v2.0 (Etalab)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : jeu modifié le 03/11/2026 à 19:00 UTC (champ modified des métadonnées) ; tarifs au 1er janvier 2026 selon les pages liées ; métadonnées à la date d'extraction
- **Date d'extraction** : 2026-11-04T10:05Z
- **Granularité et géographie** : titre de transport (30 lignes : nom, prix en texte, période, mention, lien) ; métadonnées ; Île-de-France
- **Ce qu'on en fait** : prix des titres retenus lus dans le champ price (texte « 90,80€ ») par le pipeline, sans rien deviner : un prix en pourcentage (« -50% ») ou « dès » n'est pas un prix, la page du titre le donne ; ligne de test et titres retirés écartés ; licence et date de modification recopiées dans subscriptions.json
- **Contrôles** : le prix lu doit être identique à celui de la page du titre (SUB03, COST01) ; titres retenus présents une seule fois ; champ license = « Licence Ouverte v2.0 (Etalab) »
- **Limites** : prix en texte libre ; aucune règle d'usage (lignes, aéroports) : elles viennent des pages et des CGVU ; documentation seulement
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `subscriptions.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance
  - pipeline : `06i_export_subscriptions.py` ; `subscription_catalog.py` ; `subscription_sources.py` ; `subscriptions.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/SUB01/titres-et-tarifs.json` | IDFM - Description et tarif des titres de transport en Ile-de-France (jeu titres-et-tarifs, export JSON complet) | https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/titres-et-tarifs/exports/json | `919c90f90436` |
| `data/raw/SUB01/titres-et-tarifs_dataset.json` | IDFM - métadonnées du jeu titres-et-tarifs (licence, date de modification) | https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/titres-et-tarifs | `e5533660c830` |

### SUB02

**Conditions générales de vente et d'utilisation des forfaits** (Île-de-France Mobilités)

- **Statut** : utilisée et publiée : lignes couvertes et conditions des abonnements, recopiées (subscriptions.json) ; PDF des CGVU Navigo Mois et Semaine (version « Juin 2025 ») déposé à la main le 05/11/2026, même version que la page HTML
- **Licence (manifeste)** : page publique IDFM, citée comme source d'un tarif ou d'une règle (aucune réutilisation de contenu)
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document
- **Millésime** : « Date d'entrée en vigueur : 24/06/2026 » (mention de la page) ; version « Juin 2025 » (mention de la page, publiée le 30/12/2019 et mise à jour) ; saison 2026-2027 (publiée le 09/10/2026) ; « Date de validité : à partir de juin 2026 » (mention de la page) ; version « Juin 2025 » (mention du document, nom de fichier v062025) ; PDF de 12 pages, métadonnées : créé le 23/07/2025 ; déposé le 05/11/2026
- **Date d'extraction** : 2026-11-04T10:10Z, 2026-11-04T10:05Z, 2026-11-05T08:29Z
- **Granularité et géographie** : règles d'usage ; règles de tarification ; Île-de-France
- **Ce qu'on en fait** : article 2 (lignes couvertes, TER et Intercités, non valable sur Orlyval) et 2.2.1 (Senior uniquement toutes zones) recopiés dans subscriptions.json ; article 2.2 (lignes couvertes : RoissyBus, TER et Intercités en Île-de-France ; non valable sur Orlyval) et 2.3 (zones) recopiés dans subscriptions.json ; article 1.1 (lignes couvertes, TER et Intercités, non valable sur Orlyval) et 1.2 (conditions) recopiés dans subscriptions.json ; règles des trajets et des correspondances (articles 2.3 à 3.8) lues : différentes de celles des tickets, donc Liberté + n'est pas calculé par trajet (V0) ; prix publiés à titre d'information ; aucune citation nouvelle : mêmes règles que la version HTML (article 2 « Utilisation » : lignes couvertes, TER et Intercités en Île-de-France, non valable sur Orlyval ; « Zonage »)
- **Contrôles** : phrases citées retrouvées dans le texte de l'instantané ; déposé à la main par l'équipe le 05/11/2026 (le téléchargement automatique est refusé, 403) ; l'adresse du lien PDF de la page HTML gardée est la même (…/medias/portail-idfm/aIEBglGsbswqTLlC_CGVU_NMS_v062025.pdf, « PDF - 238.1 KB » = 243 765 octets, la taille du fichier) ; comparaison mot à mot avec la page HTML : 97,7 % de mots identiques, écarts = numérotation des articles, espaces de l'extraction, un paragraphe sur les données personnelles présent dans le PDF seulement
- **Limites** : forfaits deux zones non calculés ; le PDF des CGVU (fichier cgvu-navigo-mois-semaine-v062025.pdf, ligne suivante) a été déposé à la main le 05/11/2026, même version que cette page ; la règle d'application des forfaits deux zones à un trajet (arrêts de montée et de descente ou arrêts traversés) n'y est pas écrite ; imagine R Scolaire : page refusée au robot le 04/11, non proposé ; calcul par trajet non fait : il demande les arrêts et les heures de validation de chaque trajet (règles 3.4 à 3.7) et les tarifs de proximité de Roissy ; texte extrait avec pypdf (la numérotation des articles n'y figure pas) ; les règles de Navigo Liberté + (articles 3.4 à 3.8) ne sont pas dans ce document : elles sont dans les CGVU Navigo Liberté + (ligne SUB02 « cgvu-navigo-liberte.html »)
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `subscriptions.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `subscription_catalog.py` ; `subscription_sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/SUB02/cgvu-du-forfait-navigo-annuel.html` | IDFM - Conditions générales de vente et d'utilisation du forfait Navigo Annuel (et de la Tarification Senior), version HTML | https://www.iledefrance-mobilites.fr/cgvu-du-forfait-navigo-annuel | `fab1efc589bf` |
| `data/raw/SUB02/cgvu-forfaits-navigo-mois-navigo-semaine.html` | IDFM - Conditions générales de vente et d'utilisation des forfaits Navigo Mois et Navigo Semaine (version HTML) | https://www.iledefrance-mobilites.fr/cgvu-forfaits-navigo-mois-navigo-semaine | `afb738abbcbe` |
| `data/raw/SUB02/cgvu-imagine-r-etudiant-2026-2027.html` | IDFM - Conditions générales de vente et d'utilisation du forfait imagine R Étudiant (saison 2026-2027), version HTML | https://www.iledefrance-mobilites.fr/cgvu-imagine-r-etudiant-2026-2027 | `bf4236afa13c` |
| `data/raw/SUB02/cgvu-navigo-liberte.html` | IDFM - Conditions générales de vente et d'utilisation du contrat Navigo Liberté + sur passe (version HTML) | https://www.iledefrance-mobilites.fr/cgvu-navigo-liberte | `344c9f99ea1d` |
| `data/raw/SUB02/cgvu-navigo-mois-semaine-v062025.pdf` | IDFM - Conditions générales de vente et d'utilisation des forfaits Navigo Mois et Navigo Semaine (PDF, fichier d'origine aIEBglGsbswqTLlC_CGVU_NMS_v062025.pdf) | https://www.iledefrance-mobilites.fr/medias/portail-idfm/aIEBglGsbswqTLlC_CGVU_NMS_v062025.pdf | `5841b6147e31` |

### SUB03

**Pages des titres de transport (instantanés)** (Île-de-France Mobilités)

- **Statut** : utilisée et publiée : prix, zones et exclusions des abonnements (subscriptions.json)
- **Licence (manifeste)** : page publique IDFM, citée comme source d'un tarif ou d'une règle (aucune réutilisation de contenu)
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document
- **Millésime** : aucune date affichée ; année 2026-2027 (mention) ; tarifs applicables au 1er janvier 2026 (mention) ; aucune date affichée ; prix identique au jeu SUB01
- **Date d'extraction** : 2026-11-04T10:05Z
- **Granularité et géographie** : titre de transport (tarif régional et règles d'usage) ; Île-de-France
- **Ce qu'on en fait** : zones par département, exclusions ; prix annuel frais de dossier inclus, exclusions ; prix par mois, exclusions ; prix par mois, 12e mois offert, Parkings Vélos offert, exclusions ; prix et exclusion des dessertes aéroportuaires ; prix toutes zones et exclusions (« Ne sont pas inclus : Orlyval ... ») ; gratuité et exclusions ; prix des trajets et plafond du Navigo Jour, publiés à titre d'information ; prix Navigo Mois et Semaine Solidarité 75 % toutes zones ; page du ticket gardée (règles déjà appliquées par le pipeline, lues le 03/11)
- **Contrôles** : chaque phrase reprise par le pipeline doit figurer dans le texte de l'instantané (contrôle bloquant « abonnements »)
- **Limites** : prix fixé par chaque département (participation possible) : non publié ; conditions d'âge et de statut (étudiant) ; moins de 11 ans ; 62 ans ou plus, sans activité ou moins d'un mi-temps ; Orlyval non cité (couverture non affirmée) ; forfaits deux zones non calculés ; titre d'une journée, pas un abonnement ; 16 à 25 ans, stagiaires de dispositifs régionaux ; non calculé par trajet ; conditions de ressources ; la liste des modes de la page ne cite pas les aéroports (couverture des aéroports non affirmée) ; documentation
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `subscriptions.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `subscription_catalog.py` ; `subscription_sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/SUB03/forfait-amethyste.html` | IDFM - page du titre « Forfait Améthyste » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-amethyste | `f93748dc8a0d` |
| `data/raw/SUB03/forfait-imagine-r-etudiant.html` | IDFM - page du titre « Forfait imagine R Étudiant » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-imagine-r-etudiant | `ef46fa22b200` |
| `data/raw/SUB03/forfait-imagine-r-junior.html` | IDFM - page du titre « Forfait imagine R Junior » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-imagine-r-junior | `2af7a373dce4` |
| `data/raw/SUB03/forfait-navigo-annuel-tarification-senior.html` | IDFM - page du titre « Forfait Navigo Annuel Tarification Senior » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-annuel-tarification-senior | `162c697564eb` |
| `data/raw/SUB03/forfait-navigo-annuel.html` | IDFM - page du titre « Forfait Navigo Annuel » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-annuel | `9916a9ac4d18` |
| `data/raw/SUB03/forfait-navigo-jour.html` | IDFM - page du titre « Forfait Navigo Jour » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-jour | `682850824cf4` |
| `data/raw/SUB03/forfait-navigo-semaine.html` | IDFM - page du titre « Forfait Navigo Semaine » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-semaine | `3e1864b579a2` |
| `data/raw/SUB03/le-forfait-gratuite-jeunes-en-insertion.html` | IDFM - page du titre « Forfait Gratuité jeunes en insertion » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/le-forfait-gratuite-jeunes-en-insertion | `bf62a96ce3aa` |
| `data/raw/SUB03/liberte-plus.html` | IDFM - page du titre « Navigo Liberté + » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/liberte-plus | `18270af51b5f` |
| `data/raw/SUB03/solidarite-75.html` | IDFM - page du titre « Solidarité 75% » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/solidarite-75 | `d4622ef0cfec` |
| `data/raw/SUB03/ticket-bus-tram.html` | IDFM - page du titre « Ticket Bus-Tram » (instantané HTML) | https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/ticket-bus-tram | `c636d888a953` |

### SUB04

**Offres, grille tarifaire et CGAU Vélib'** (Vélib' Métropole)

- **Statut** : utilisée et publiée : prix des offres et des courses Vélib' (subscriptions.json) ; page de l'AGEMOB (https://agemob.fr/velib-metropole/le-velo-partage/, 05/11/2026) : Velib' Métropole, service public exploité dans le cadre d'un marché public
- **Licence (manifeste)** : document public de Vélib' Métropole, cité ; page publique de l'AGEMOB, citée ; conditions de réutilisation non relues ; page publique de Vélib' Métropole (service public, Smovengo), citée comme source d'un tarif
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document
- **Millésime** : « Pour toute souscription à partir du 12 août 2025 » ; « Pour toute souscription à partir du 12 août 2025 », « DATE DE DERNIERE MISE A JOUR : 28 juillet 2025 » ; page consultée le 05/11/2026 (aucune date de mise à jour affichée) ; « Tarifs valables pour toute souscription à partir du 12 août 2025 » ; tarifs pour toute souscription à partir du 12 août 2025 (grille et CGAU)
- **Date d'extraction** : 2026-11-04T10:00Z, 2026-11-05T11:22Z, 2026-11-04T09:59Z
- **Granularité et géographie** : règles de tarification ; page de présentation du service ; grille tarifaire ; offre (prix mensuel, minutes incluses, prix au-delà) ; zone Vélib' Métropole ; Métropole du Grand Paris
- **Ce qu'on en fait** : Ticket-V : « une seule et unique course », 45 premières minutes gratuites ; fichier téléchargé avec curl le 04/11/2026 (le client requests de 01_download reçoit HTTP 403 de ce site) ; règle des tranches (« inférieure ou égale à 29 min 59 sec ») et plafond de 18 euros par course en vélo mécanique ; fichier téléchargé avec curl le 04/11/2026 (le client requests de 01_download reçoit HTTP 403 de ce site) ; aucun chiffre repris ; passages cités : « Le service public Velib' Métropole a pour aire géographique d'implantation le territoire de la Métropole du Grand Paris » et « exploité dans le cadre d'un marché public » (prestataire : Smovengo) ; prix mensuels V-Plus et V-Max (plein, Jeune, Senior, Solidaire) recoupés avec la page Offres ; fichier téléchargé avec curl le 04/11/2026 (le client requests de 01_download reçoit HTTP 403 de ce site) ; prix des offres et prix au-delà des minutes incluses (vélo mécanique) recopiés ; fichier téléchargé avec curl le 04/11/2026 (le client requests de 01_download reçoit HTTP 403 de ce site)
- **Contrôles** : citations liées à l'empreinte sha256 du fichier lu le 04/11 ; phrases retrouvées dans le texte de l'instantané ; phrases et montants retrouvés dans le texte de l'instantané
- **Limites** : le prix au-delà de 45 min du Ticket-V est ambigu sur la page Offres (1 € ou 2 € par 30 min) : non calculé ; lu avec pdftotext (colonnes) ; aucune extraction automatique ; la page présente Vélib' comme un service public exploité dans le cadre d'un marché public ; elle ne cite pas l'article R3261-2 du Code du travail : le rapprochement avec « service public de location de vélos » vient du BOFiP (SUB05, doctrine fiscale), pas de cette page ; mise en page en colonnes : texte extrait avec pdftotext pour la lecture, aucune extraction automatique dans le pipeline ; vélo électrique non calculé (nos durées sont celles du vélo de r5py) ; Minutes Bonus ignorées
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `subscriptions.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `licences_attente.py` ; `subscription_catalog.py` ; `subscription_sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/SUB04/CGAU_CD_Ocotbre_2026.pdf` | Vélib' Métropole - CGAU des utilisateurs courte durée (Ticket-V, Pass) | https://www.velib-metropole.fr/media/1046/download/CGAU_CD_Ocotbre_2026.pdf?v=1&inline=1 | `bca3c8cca597` |
| `data/raw/SUB04/CGAU_LD_Octobre_2026.pdf` | Vélib' Métropole - CGAU des utilisateurs longue durée (abonnements V-Libre, V-Plus, V-Max) | https://www.velib-metropole.fr/media/1045/download/CGAU_LD_Octobre_2026.pdf?v=1&inline=1 | `61ea4f8ded5d` |
| `data/raw/SUB04/agemob-velib-le-velo-partage.html` | AGEMOB (Syndicat Autolib' Vélib' Métropole) - page « Le vélo partagé accessible à tous : le service public Velib' Métropole » | https://agemob.fr/velib-metropole/le-velo-partage/ | `c83be924fc4f` |
| `data/raw/SUB04/velib-grille-tarifaire.pdf` | Vélib' Métropole - Grille tarifaire « refonte tarifaire » (PDF) | https://www.velib-metropole.fr/media/914/download/Grille%20tarifaire%20V%C3%A9lib%27%20refonte%20tarifaire.pdf?v=1 | `490ab129bf71` |
| `data/raw/SUB04/velib-offers.html` | Vélib' Métropole - page « Offres » (tarifs des abonnements et des courses, instantané HTML) | https://www.velib-metropole.fr/fr/offers | `4279a4a0ac3f` |

### SUB05

**Prise en charge des frais de transport par l'employeur (Code du travail)** (Ministère du Travail, Service Public (DILA) et DGFiP (BOFiP))

- **Statut** : utilisée et publiée : phrases sur la prise en charge employeur recopiées (subscriptions.json). Textes lus le 05/11/2026 sur code.travail.gouv.fr, Légifrance refusant le robot (403) : L3261-2 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000019950566), R3261-1, 50 % (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020080272), R3261-2 dont le 3° (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020080269), R3261-3 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020080267). Doctrine fiscale (BOFiP, pas la loi) : BOI-RSA-CHAMP-20-30-10-20-20260407, § 110 « service public de location de vélos », Vélib' en exemple (https://bofip.impots.gouv.fr/bofip/5601-PGP.html/identifiant=BOI-RSA-CHAMP-20-30-10-20-20260407)
- **Licence (manifeste)** : Licence Ouverte 2.0 (etalab-2.0) : pied de page du Code du travail numérique, « Sauf mention explicite de propriété intellectuelle détenue par des tiers, les contenus de ce site sont proposés sous licence etalab-2.0 » (page Mentions légales lue le 09/11/2026, même mention dans la page de l'article conservée) ; texte de loi cité ; Licence Ouverte 2.0 (etalab-2.0) : pied de page de BOFiP-Impôts, « Sauf mention contraire, tous les contenus de ce site sont sous licence etalab-2.0 » (page lue le 09/11/2026) ; mentions légales lues le 09/11/2026 : article XIV, reproduction des commentaires autorisée conformément au CRPA « à condition d'en indiquer la source » (« BOFiP-Impôts ») et la date de publication ; article XII, droit sui generis du producteur de base de données ; Licence Ouverte 2.0 (etalab-2.0) : pied de page de Service Public, « Sauf mention contraire, tous les contenus de ce site sont sous licence etalab-2.0 » (page lue le 09/11/2026, même mention dans la fiche conservée) ; les mentions légales (P10025, lues le 09/11/2026) réservent les marques « Service Public » et les photos de la page d'accueil
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour ; régime par défaut des informations publiques (CRPA, art. L321-1 et L322-1) : sans altération ni dénaturation, source et date de mise à jour citées
- **Millésime** : version en vigueur à la date d'extraction (texte repris de Légifrance par le site) ; identifiant Légifrance LEGIARTI000019950566, « Mis à jour le : 19/12/2008 » (mention de la page) ; version en vigueur à la date d'extraction (texte repris de Légifrance par le site) ; identifiant Légifrance LEGIARTI000020080272, « Mis à jour le : 01/01/2009 » (mention de la page) ; version en vigueur à la date d'extraction (texte repris de Légifrance par le site) ; identifiant Légifrance LEGIARTI000020080269, « Mis à jour le : 01/01/2009 » (mention de la page) ; version en vigueur à la date d'extraction (texte repris de Légifrance par le site) ; identifiant Légifrance LEGIARTI000020080267, « Mis à jour le : 01/01/2009 » (mention de la page) ; version du 07/04/2026 (identifiant du document) ; consultée le 05/11/2026 ; « Vérifié le 28 octobre 2026 » (mention de la page)
- **Date d'extraction** : 2026-11-04T10:08Z, 2026-11-05T11:22Z
- **Granularité et géographie** : article de loi ; doctrine fiscale (paragraphes 50 à 190 : prise en charge obligatoire par l'employeur) ; fiche pratique ; France (salariés du secteur privé) ; France (employeurs de droit privé et leurs salariés) ; France
- **Ce qu'on en fait** : phrase de prise en charge par l'employeur recopiée dans subscriptions.json ; aucun chiffre repris ; deux passages cités : définition des « abonnements à un service public de location de vélos » (§ 110, qui donne Vélib' en exemple) et prorata sous un mi-temps (§ 170) ; « Les titres de transport achetés à l'unité ne sont pas remboursables. » recopiée
- **Contrôles** : phrase retrouvée dans le texte de l'instantané ; relu le 05/11/2026 sur le site (texte identique) ; l'identifiant LEGIARTI de la page est celui du lien Légifrance ci-contre : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000019950566 ; phrase retrouvée dans le texte de l'instantané ; relu le 05/11/2026 sur le site (texte identique) ; l'identifiant LEGIARTI de la page est celui du lien Légifrance ci-contre : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020080272 ; phrase retrouvée dans le texte de l'instantané ; relu le 05/11/2026 sur le site (texte identique) ; l'identifiant LEGIARTI de la page est celui du lien Légifrance ci-contre : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020080269 ; phrase retrouvée dans le texte de l'instantané ; relu le 05/11/2026 sur le site (texte identique) ; l'identifiant LEGIARTI de la page est celui du lien Légifrance ci-contre : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020080267 ; phrases retrouvées dans le texte de l'instantané ; le BOFiP renvoie lui-même à L3261-2 (LEGIARTI000019950566, version du 19/12/2008) et R3261-1 (LEGIARTI000020080272, version du 01/01/2009) ; phrase retrouvée dans le texte de l'instantané
- **Limites** : lu sur le Code du travail numérique, pas sur Légifrance : Légifrance refuse le robot (HTTP 403, 04 et 05/11/2026), la page Légifrance elle-même n'a donc pas été lue ; un humain peut la relire ; doctrine fiscale : elle commente l'exonération d'impôt sur le revenu et reprend les règles du Code du travail ; ce n'est ni la loi ni un avis juridique ; elle ne dit pas quelles offres Vélib' sont des « abonnements » ; secteur privé seulement ; agents publics : autre texte, non lu
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `subscriptions.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `06i_export_subscriptions.py` ; `subscription_catalog.py` ; `subscription_sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/SUB05/code-travail-l3261-2.html` | Code du travail numérique (ministère du Travail) - article L3261-2 | https://code.travail.gouv.fr/code-du-travail/l3261-2 | `054c4d4e7ac0` |
| `data/raw/SUB05/code-travail-r3261-1.html` | Code du travail numérique (ministère du Travail) - article R3261-1 | https://code.travail.gouv.fr/code-du-travail/r3261-1 | `1056aaa9f3ee` |
| `data/raw/SUB05/code-travail-r3261-2.html` | Code du travail numérique (ministère du Travail) - article R3261-2 | https://code.travail.gouv.fr/code-du-travail/r3261-2 | `c8e5709311ef` |
| `data/raw/SUB05/code-travail-r3261-3.html` | Code du travail numérique (ministère du Travail) - article R3261-3 | https://code.travail.gouv.fr/code-du-travail/r3261-3 | `ca19fd3ebe82` |
| `data/raw/SUB05/doctrine-bofip-BOI-RSA-CHAMP-20-30-10-20-20260407.html` | BOFiP-Impôts - BOI-RSA-CHAMP-20-30-10-20-20260407 : frais de transport domicile-travail, prise en charge obligatoire des titres d'abonnement (doctrine fiscale) | https://bofip.impots.gouv.fr/bofip/5601-PGP.html/identifiant=BOI-RSA-CHAMP-20-30-10-20-20260407 | `1c95bb5e47c8` |
| `data/raw/SUB05/service-public-F19846.html` | Service Public - Remboursement des frais de transport domicile-travail d'un salarié du secteur privé (fiche F19846) | https://www.service-public.gouv.fr/particuliers/vosdroits/F19846 | `d708aa283bbd` |

### TKT01

**Conditions de vente et d'usage des tickets, liste des correspondances par la voie publique** (Île-de-France Mobilités)

- **Statut** : utilisée et publiée : règles de comptage des tickets recopiées et retrouvées dans les pages gardées (ticket_rules.py, contrôle P0 de 07) : prix au ticket et cas « coût non calculé » (itineraries/{insee}.json, champ tickets)
- **Licence (manifeste)** : page publique IDFM, citée comme source d'une règle tarifaire (aucune réutilisation de contenu)
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document
- **Millésime** : « Date de validité : à partir de juin 2026 » (mention de la page) ; « Published on 2024 October 30 - Updated on 2026 February 20 » (mention de la page)
- **Date d'extraction** : 2026-11-04T12:20Z, 2026-11-04T12:27Z
- **Granularité et géographie** : règles d'usage ; liste des correspondances par la voie publique ; Île-de-France
- **Ce qu'on en fait** : art. 2.1 (bus de tarification francilienne), 2.2 (pas de métro, RER, train), 2.3 (voyage de 1h30 sans sortie, correspondances entre modes autorisés) appliqués par le pipeline ; fichier téléchargé avec curl le 04/11/2026 ; art. 2.3 : correspondances par la voie publique autorisées selon la liste officielle ; fichier téléchargé avec curl le 04/11/2026 ; 24 lignes de la liste recopiées ; stations rattachées à la main aux stations parentes du GTFS IDFM (ticket_rules.STREET_GROUPS, noms contrôlés) ; fichier téléchargé avec curl le 04/11/2026
- **Contrôles** : phrases citées par le pipeline retrouvées dans le texte de l'instantané (contrôle bloquant) ; phrases citées par le pipeline retrouvées dans le texte de l'instantané (contrôle bloquant) ; nom GTFS de chaque station parente contrôlé
- **Limites** : règles pour le support sans contact (passe Navigo Easy, téléphone) ; renvoie à la liste de la page correspondance-voie-publique ; version anglaise traduite automatiquement (noms de stations traduits, ex. « Bleach » pour Javel) ; la version française répond HTTP 403 au robot
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau
  - pipeline : `fares_carbon.py` ; `ticket_rules.py` ; `ticket_sources.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TKT01/cgvu-tickets-bus-tram.html` | IDFM - Conditions générales de vente et d'utilisation des tickets Bus-Tram (version HTML) | https://www.iledefrance-mobilites.fr/cgvu-tickets-bus-tram | `778aa67d12ef` |
| `data/raw/TKT01/cgvu-tickets-metro-train-rer.html` | IDFM - Conditions générales de vente et d'utilisation des tickets Métro-Train-RER (version HTML) | https://www.iledefrance-mobilites.fr/cgvu-tickets-metro-train-rer | `c80df2cb12e3` |
| `data/raw/TKT01/correspondance-voie-publique-en.html` | IDFM - Rules for correspondence and correspondence by public highway (version anglaise de la page « Règles de correspondances et correspondances par la voie publique ») | https://www.iledefrance-mobilites.fr/en/correspondance-voie-publique | `f78d15dca594` |

### TOLL01

**Autoroutes et péages en flux libre** (data.gouv.fr (jeu publié par un utilisateur))

- **Statut** : utilisée et publiée : portiques de l'A14 (flux libre) du registre des péages (tolls.json, car_trip.toll)
- **Licence (manifeste)** : Licence Ouverte v2.0 (Etalab), champ license = lov2 de l'API data.gouv.fr
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : version du 03/11/2026 (portiques) ; cartographie du 25/10/2025
- **Date d'extraction** : 2026-11-03T21:46Z
- **Granularité et géographie** : portique de péage ; France (autoroutes en flux libre)
- **Ce qu'on en fait** : présence des portiques nommés dans le registre, aucun tarif
- **Contrôles** : chaque nom de portique du registre existe dans le CSV (arrêt sinon)
- **Limites** : Buchelay FL placé à l'ancienne barrière (écart avec l'OSM du 01/11/2026) ; producteur non identifié (pas d'organisation sur data.gouv.fr) ; Buchelay FL placé à l'ancienne barrière (écart avec l'OSM du 01/11/2026) ; producteur non identifié (pas d'organisation sur data.gouv.fr) ; provenance, adresse datée d'origine : https://static.data.gouv.fr/resources/autoroutes-et-peages-en-flux-libre/20261103-171041/portiques-free-flow-03-11-2026.csv ; cette adresse ne répond plus (HTTP 404 le 09/11/2026), l'empreinte sha256 porte sur le fichier archivé à la date d'extraction
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `tolls.json`
  - code du front qui la cite (écran déduit du chemin) : mode provenance
  - pipeline : `04j_toll_tariffs.py` ; `06_export_front.py` ; `toll_tariffs.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TOLL01/autoroutes-free-flow-fr-25-10-2025.geojson` | data.gouv.fr - Autoroutes et péages en flux libre (portiques free flow) | https://static.data.gouv.fr/resources/autoroutes-et-peages-en-flux-libre/20251025-160302/autoroutes-free-flow-fr.geojson | `00a58136f5c1` |
| `data/raw/TOLL01/dataset-metadata.json` | data.gouv.fr - Autoroutes et péages en flux libre (portiques free flow) | https://www.data.gouv.fr/api/1/datasets/68f7f6e2cb331a47613d7778/ | `2d974e16fc2f` |
| `data/raw/TOLL01/portiques-free-flow-03-11-2026.csv` | data.gouv.fr - Autoroutes et péages en flux libre (portiques free flow) | https://www.data.gouv.fr/datasets/autoroutes-et-peages-en-flux-libre | `e59032121e97` |

### TOLL02

**Tarifs de péage APRR au 1er février 2026** (APRR)

- **Statut** : utilisée et publiée : grilles des péages APRR (A6, A10...) de tolls.json, tarif de la classe du véhicule
- **Licence (manifeste)** : PDF et page : documents publics APRR mis à disposition sur son site (PDF téléchargés, page lue une fois), cités comme source d'un tarif, réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités) le 09/11/2026, à trois conditions : données obtenues par mise à disposition et non par scraping, la dataviz ne permet pas de réexporter les données brutes, producteur crédité dans la dataviz elle-même ; son message nomme VINCI : l'appliquer à cette source est la lecture de l'équipe (10/11/2026) ; CSV data.gouv.fr : Licence Ouverte v2.0 (Etalab), champ license = lov2 de l'API data.gouv.fr
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour ; document public cité, aucune licence affichée : citer la source sans reproduire le document ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités, 09/11/2026) à trois conditions : données obtenues par mise à disposition du producteur, jamais par scraping ; la dataviz ne permet pas de réexporter les données brutes ; le producteur est crédité dans la dataviz elle-même, à côté de chaque montant. Ne vaut pas licence de redistribution des données
- **Millésime** : en vigueur au 1er février 2026
- **Date d'extraction** : 2026-11-03T21:47Z, 2026-11-03T21:46Z
- **Granularité et géographie** : couple gare d'entrée - gare de sortie, classes 1 à 5 ; réseau APRR (A5, A6, A77 en Seine-et-Marne retenus)
- **Ce qu'on en fait** : couples entre gares du registre lus sur le PDF officiel (pdftotext -table), classes 1 et 5 ; Dordives (système ouvert) transcrit à la main depuis le PDF image
- **Contrôles** : recoupement couple par couple PDF / CSV : 68 couples identiques, 9 couples seulement dans le PDF
- **Limites** : tarif de base, hors abonnements ; couple absent de la grille = case vide
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `tolls.json`
  - code du front qui la cite (écran déduit du chemin) : mode provenance
  - pipeline : `04j_toll_tariffs.py` ; `06_export_front.py` ; `toll_publish.py` ; `toll_tariffs.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TOLL02/TARIFS_APRR-2026-02.pdf` | APRR - Tarifs de péage, réseau APRR classes 1 à 5 (PDF officiel) et copie CSV data.gouv.fr « Tarifs autoroutes APRR » | https://voyage.aprr.fr/sites/default/files/2026-02/TARIFS_APRR.pdf | `f05dfa58cb4f` |
| `data/raw/TOLL02/aprr-systemes-ouverts-2026.pdf` | APRR - Tarifs de péage, réseau APRR classes 1 à 5 (PDF officiel) et copie CSV data.gouv.fr « Tarifs autoroutes APRR » | https://voyage.aprr.fr/sites/default/files/2026-02/2026-%20Syst%C3%A8mes%20Ouverts%20APRR-AREA.pdf | `bb8b8bf52e0a` |
| `data/raw/TOLL02/aprr-tarifs-2026-02.csv` | APRR - Tarifs de péage, réseau APRR classes 1 à 5 (PDF officiel) et copie CSV data.gouv.fr « Tarifs autoroutes APRR » | https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131933/2026-02.csv | `29557dd81452` |
| `data/raw/TOLL02/aprr-tarifs-de-peage.html` | APRR - Tarifs de péage, réseau APRR classes 1 à 5 (PDF officiel) et copie CSV data.gouv.fr « Tarifs autoroutes APRR » | https://voyage.aprr.fr/tarifs-de-peage | `65f848601784` |
| `data/raw/TOLL02/dataset-metadata.json` | APRR - Tarifs de péage, réseau APRR classes 1 à 5 (PDF officiel) et copie CSV data.gouv.fr « Tarifs autoroutes APRR » | https://www.data.gouv.fr/api/1/datasets/tarifs-autoroutes-aprr/ | `7dd5f6ac09d7` |

### TOLL03

**Arrêté du 28 janvier 2026 (A14) et grilles Sanef et SAPN du 1er février 2026** (Journal officiel (DILA) et Sanef (grilles déposées à la main))

- **Statut** : utilisée et publiée : tarifs de l'A14 (Montesson, Chambourcy) et du couple Coutevroult avec Saint-Jean et Montreuil-aux-Lions (A4, grille Sanef) de tolls.json ; A1 (Saint-Witz) et A13 (Buchelay, Rosny-sur-Seine) : grilles lues, aucune case applicable, péage inconnu ; un trajet qui ne traverse que la barrière de Coutevroult a aussi un péage inconnu
- **Licence (manifeste)** : document public de l'exploitant, obtenu à la main par l'équipe le 05/11/2026 depuis la page des grilles de Sanef (le site refuse les téléchargements automatiques, HTTP 403 : aucun contournement), lu (aucun montant publié n'en vient) ; pas de licence écrite sur le document ; mentions légales de Sanef non lues (site protégé, HTTP 403 le 05/11/2026) ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités) le 09/11/2026, à trois conditions : données obtenues par mise à disposition et non par scraping, la dataviz ne permet pas de réexporter les données brutes, producteur crédité dans la dataviz elle-même ; son message nomme VINCI Autoroutes : l'extension à Sanef et SAPN, aux mêmes conditions, est la lecture de l'équipe (10/11/2026) ; document public de l'exploitant, obtenu à la main par l'équipe le 05/11/2026 depuis la page des grilles de Sanef (le site refuse les téléchargements automatiques, HTTP 403 : aucun contournement), cité comme source d'un tarif ; pas de licence écrite sur le document ; mentions légales de Sanef non lues (site protégé, HTTP 403 le 05/11/2026) ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités) le 09/11/2026, à trois conditions : données obtenues par mise à disposition et non par scraping, la dataviz ne permet pas de réexporter les données brutes, producteur crédité dans la dataviz elle-même ; son message nomme VINCI Autoroutes : l'extension à Sanef et SAPN, aux mêmes conditions, est la lecture de l'équipe (10/11/2026) ; Licence Ouverte (fr-lo), jeu data.gouv.fr « JORF : les données de l'édition Lois et décrets du Journal officiel » (Premier ministre, DILA)
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités, 09/11/2026) à trois conditions : données obtenues par mise à disposition du producteur, jamais par scraping ; la dataviz ne permet pas de réexporter les données brutes ; le producteur est crédité dans la dataviz elle-même, à côté de chaque montant. Ne vaut pas licence de redistribution des données ; Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : en vigueur au 1er février 2026 ; JORF n° 0025 du 30/01/2026, tarifs à compter du 1er février 2026
- **Date d'extraction** : 2026-11-05T08:47Z, 2026-11-03T22:13Z, 2026-11-03T22:22Z, 2026-11-05T08:53Z
- **Granularité et géographie** : couple gare d'entrée - gare de sortie, triangle par autoroute, classes 1 à 5 ; gare (Montesson, Chambourcy), classes 1 à 5, tarif de base et tarif réduit horaire ; tranche horaire, couple gare d'entrée - gare de sortie, classe 1 ; réseau SAPN (A13, A14, A29...) ; réseau Sanef (A1, A4, A26, A29...) ; A14 (SAPN) ; A1 (Sanef)
- **Ce qu'on en fait** : lue pour l'A13 (Buchelay, Rosny-sur-Seine) et recoupée avec l'arrêté du 28/01/2026 pour l'A14 ; cases A4 (Coutevroult, Saint-Jean-les-Deux-Jumeaux, Montreuil-aux-Lions) et A1 (Survilliers / Saint-Witz) lues avec les coordonnées des mots du PDF (pdftotext -bbox), classes 1 et 5 ; tableaux de l'annexe lus dans le XML (articles JORFARTI000053417658 et 659), note (1) du tarif réduit convertie en tranches horaires ; voir la méthodologie (lecture de la modulation de l'A1)
- **Contrôles** : voir la méthodologie ; A14 (Montesson 10,80 et 6,60 €, Chambourcy 2,60 €, classe 1 ; 5,50, 3,40 et 1,30 € en classe 5) relu sur le rendu image des pages 2 et 6 (05/11/2026) et comparé au site : concordant ; A13 : ni Buchelay ni Rosny sur le rendu de la page 2, la grille ne nomme que « POISSY / ORGEVAL N°7 à MANTES-SUD N°12 » ; chaque tarif retenu est contrôlé contre le texte de la page et la position de sa case (test sur les valeurs lues) ; 05/11/2026 : pages 2 et 6 rendues en image (PyMuPDF, hors dépôt) et A4 relu sur le rendu (Coutevroult vers Saint-Jean 3,9 et 2,6, vers Montreuil 4,5 et 2,7) ; Saint-Witz : même colonne que Chamant vers Senlis (positions des mots), sans nœud Senlis ni Chamant au registre ; en-têtes « Classe 1 » à « Classe 5 » vérifiés ; tranches de chaque jour sans trou (tests) ; voir la méthodologie ; 05/11/2026 : page rendue en image, trois grilles (normal, vert, rouge), colonnes d'Arsy à Chamant (Arsy, Chevrières, Senlis, Chamant) ; le document ne définit NI les heures NI les jours des périodes normal, vert et rouge (aucune légende, aucune note) ; aucun prix n'en est retenu : les stations Arsy, Chevrières, Senlis et Chamant n'ont pas de nœud de péage au registre et Saint-Witz n'y figure pas
- **Limites** : URL exacte du PDF non relevée ; copie déposée le 05/11/2026 à 09h47 (heure de Paris), retraitée par iLovePDF ; tarif de base, hors abonnements ; URL exacte du PDF non relevée (la page des grilles répond 403 aux outils automatiques) ; copie déposée le 05/11/2026 à 09h47 (heure de Paris), le PDF a été retraité par iLovePDF (métadonnées) : contenu non comparé à l'original ; tarif de base, hors abonnements et modulations ; seule l'A14 a une grille dans l'arrêté ; A13 (SAPN), A4 et A1 (Sanef) : grille non lue (site Sanef protégé, HTTP 403) ; provenance, adresse datée d'origine : https://echanges.dila.gouv.fr/OPENDATA/JORF/JORF_20260130-002723.tar.gz ; cette adresse ne répond plus (HTTP 404 le 09/11/2026), l'empreinte sha256 porte sur le fichier archivé à la date d'extraction ; seule l'A14 a une grille dans l'arrêté ; A13 (SAPN), A4 et A1 (Sanef) : grille non lue (site Sanef protégé, HTTP 403) ; URL exacte du PDF non relevée ; PDF créé par « Microsoft: Print To PDF » depuis un classeur Sanef (« grilles tarifaires 2026 V2 janvier 26 »), une seule page ; seule l'A14 a une grille dans l'arrêté ; A13 (SAPN), A4 et A1 (Sanef) : grille non lue (site Sanef protégé, HTTP 403) ; provenance, adresse datée d'origine : extrait de l'archive https://echanges.dila.gouv.fr/OPENDATA/JORF/JORF_20260130-002723.tar.gz (article 3) ; cette adresse ne répond plus (HTTP 404 le 09/11/2026), l'empreinte sha256 porte sur le fichier archivé à la date d'extraction ; seule l'A14 a une grille dans l'arrêté ; A13 (SAPN), A4 et A1 (Sanef) : grille non lue (site Sanef protégé, HTTP 403) ; provenance, adresse datée d'origine : extrait de l'archive https://echanges.dila.gouv.fr/OPENDATA/JORF/JORF_20260130-002723.tar.gz (annexe, gare de Montesson) ; cette adresse ne répond plus (HTTP 404 le 09/11/2026), l'empreinte sha256 porte sur le fichier archivé à la date d'extraction ; seule l'A14 a une grille dans l'arrêté ; A13 (SAPN), A4 et A1 (Sanef) : grille non lue (site Sanef protégé, HTTP 403) ; provenance, adresse datée d'origine : extrait de l'archive https://echanges.dila.gouv.fr/OPENDATA/JORF/JORF_20260130-002723.tar.gz (annexe, gare de Chambourcy) ; cette adresse ne répond plus (HTTP 404 le 09/11/2026), l'empreinte sha256 porte sur le fichier archivé à la date d'extraction ; seule l'A14 a une grille dans l'arrêté ; A13 (SAPN), A4 et A1 (Sanef) : grille non lue (site Sanef protégé, HTTP 403) ; provenance, adresse datée d'origine : extrait de l'archive https://echanges.dila.gouv.fr/OPENDATA/JORF/JORF_20260130-002723.tar.gz (texte ; ELI https://www.legifrance.gouv.fr/eli/arrete/2026/1/28/TRAT2600882A/jo/texte) ; cette adresse ne répond plus (HTTP 404 le 09/11/2026), l'empreinte sha256 porte sur le fichier archivé à la date d'extraction
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `tolls.json`
  - code du front qui la cite (écran déduit du chemin) : mode provenance
  - pipeline : `04j_toll_tariffs.py` ; `06_export_front.py` ; `licences_attente.py` ; `toll_publish.py` ; `toll_tariffs.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TOLL03/2026_02-Grille-SAPN.pdf` | Sapn - Tarifs de péage 2026, grille TTC au 01/02/2026, réseau SAPN (classes 1 à 5), déposée à la main par l'équipe | https://www.autoroutes.sanef.com/fr/grilles-tarifs-de-peage | `f8a7468306f5` |
| `data/raw/TOLL03/2026_02-Grille-Sanef.pdf` | Sanef - Tarifs de péage 2026, grille TTC au 01/02/2026, réseau Sanef (classes 1 à 5, une page par classe), déposée à la main par l'équipe | https://www.autoroutes.sanef.com/fr/grilles-tarifs-de-peage | `373b55bd4f4f` |
| `data/raw/TOLL03/JORF_20260130-002723.tar.gz` | Arrêté du 28 janvier 2026 relatif aux péages applicables sur les réseaux autoroutiers concédés à SANEF et SAPN (NOR TRAT2600882A), flux JORF de la DILA | https://www.legifrance.gouv.fr/eli/arrete/2026/1/28/TRAT2600882A/jo/texte | `fa3d131c05b1` |
| `data/raw/TOLL03/dataset-metadata-jorf.json` | Arrêté du 28 janvier 2026 relatif aux péages applicables sur les réseaux autoroutiers concédés à SANEF et SAPN (NOR TRAT2600882A), flux JORF de la DILA | https://www.data.gouv.fr/api/1/datasets/53ca3560a3a7294a1ddd784e/ | `e6c2c1c8abcb` |
| `data/raw/TOLL03/grille-modulee-01022026.pdf` | Sanef - Modulation horaire des tarifs sur l'A1, classe 1, au 01/02/2026 (fichier « grille-modulee-01022026.pdf »), déposée à la main par l'équipe | https://www.autoroutes.sanef.com/fr/grilles-tarifs-de-peage | `5cf0e4221c14` |
| `data/raw/TOLL03/jorf_TRAT2600882A/JORFARTI000053417655.xml` | Arrêté du 28 janvier 2026 relatif aux péages applicables sur les réseaux autoroutiers concédés à SANEF et SAPN (NOR TRAT2600882A), flux JORF de la DILA | https://www.legifrance.gouv.fr/eli/arrete/2026/1/28/TRAT2600882A/jo/texte | `99802586fb26` |
| `data/raw/TOLL03/jorf_TRAT2600882A/JORFARTI000053417658.xml` | Arrêté du 28 janvier 2026 relatif aux péages applicables sur les réseaux autoroutiers concédés à SANEF et SAPN (NOR TRAT2600882A), flux JORF de la DILA | https://www.legifrance.gouv.fr/eli/arrete/2026/1/28/TRAT2600882A/jo/texte | `3aa28274ce92` |
| `data/raw/TOLL03/jorf_TRAT2600882A/JORFARTI000053417659.xml` | Arrêté du 28 janvier 2026 relatif aux péages applicables sur les réseaux autoroutiers concédés à SANEF et SAPN (NOR TRAT2600882A), flux JORF de la DILA | https://www.legifrance.gouv.fr/eli/arrete/2026/1/28/TRAT2600882A/jo/texte | `7be20138b6f3` |
| `data/raw/TOLL03/jorf_TRAT2600882A/JORFTEXT000053417647.xml` | Arrêté du 28 janvier 2026 relatif aux péages applicables sur les réseaux autoroutiers concédés à SANEF et SAPN (NOR TRAT2600882A), flux JORF de la DILA | https://www.legifrance.gouv.fr/eli/arrete/2026/1/28/TRAT2600882A/jo/texte | `527d69e61fcf` |

### TOLL04

**Tarifs 2026 du Duplex A86 et de Cofiroute** (VINCI Autoroutes)

- **Statut** : utilisée et publiée : grilles du Duplex A86 et de Cofiroute de tolls.json (tarif badge affiché à part)
- **Licence (manifeste)** : documents publics VINCI Autoroutes mis à disposition sur ses sites (fichiers .txt, guides PDF et communiqué proposés au téléchargement ; page des tarifs et page Ulys lues une fois chacune), cités comme source d'un tarif ; pas de licence écrite sur ces documents ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités) le 09/11/2026, à trois conditions : données obtenues par mise à disposition et non par scraping, la dataviz ne permet pas de réexporter les données brutes, producteur crédité dans la dataviz elle-même ; mentions légales du site (article 6, consultées le 05/11/2026) : « aucune licence, ni aucun autre droit, sauf celui de consulter les informations, n'est conféré à quiconque »
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités, 09/11/2026) à trois conditions : données obtenues par mise à disposition du producteur, jamais par scraping ; la dataviz ne permet pas de réexporter les données brutes ; le producteur est crédité dans la dataviz elle-même, à côté de chaque montant. Ne vaut pas licence de redistribution des données
- **Millésime** : Duplex A86 : tarifs TTC au 01/01/2026 ; Cofiroute : tarifs au 1er février 2026
- **Date d'extraction** : 2026-11-03T21:54Z, 2026-11-03T22:02Z, 2026-11-03T22:03Z
- **Granularité et géographie** : Duplex : couple x type de jour x demi-heure x paiement badge (classe 1) ; Cofiroute : couple, classes 1 à 5 ; Duplex A86 (Rueil, Vaucresson, Vélizy) ; A10 et A11 (Saint-Arnoult, Dourdan, Allainville, Ablis)
- **Ce qu'on en fait** : Tarifs_A86.txt (cp1252) et Tarifs_Cofiroute_Arcour.txt lus tels quels ; classe 5 du Duplex = interdit (page Ulys) ; Tarifs_A86.txt (cp1252) et Tarifs_Cofiroute_Arcour.txt lus tels quels ; classe 5 du Duplex = interdit (page Ulys) ; cette page (une requête le 03/11/2026) ne donne aucun montant : une seule phrase citée, deux-roues interdits dans le Duplex A86 ; Tarifs_A86.txt (cp1252) et Tarifs_Cofiroute_Arcour.txt lus tels quels ; classe 5 du Duplex = interdit (page Ulys) ; ce fichier (contenu de la page des tarifs du site, une requête le 03/11/2026) n'a servi qu'à trouver les liens de téléchargement des fichiers .txt et des guides : aucun script ne le lit, aucun montant n'en vient
- **Contrôles** : valeurs du .txt Duplex relues sur le guide PDF pour le mardi (7h-7h30 Rueil-Vaucresson : 11,4 et 8,2 en télépéage ; 10h-16h Rueil-Vélizy : 9,9) ; valeurs du .txt Duplex relues sur le guide PDF pour le mardi (7h-7h30 Rueil-Vaucresson : 11,4 et 8,2 en télépéage ; 10h-16h Rueil-Vélizy : 9,9) ; 05/11/2026 : page 2 rendue en image (PyMuPDF, hors dépôt, cellules fusionnées lues sur le rendu) : Rueil vers Vélizy, ligne « Lundi au jeudi », 4h30-6h 3,1 ; 6h-6h30 8,3 ; 7h-8h 11,4 ; 8h-9h 11,7 ; 9h-10h 11,4 ; 10h-16h 9,9 (9 relevés dans data/peages_releves_manuels.csv, concordants avec le site)
- **Limites** : abonnements Activi-t A86 et Duo A86 (-20 % à -50 %) non appliqués ; heure de passage = heure d'entrée, à confirmer
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `tolls.json`
  - code du front qui la cite (écran déduit du chemin) : mode provenance
  - pipeline : `04j_toll_tariffs.py` ; `06_export_front.py` ; `licences_attente.py` ; `toll_publish.py` ; `toll_tariffs.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TOLL04/Cofiroute-Guide-tarifaire-2026.pdf` | VINCI Autoroutes - tarifs Duplex A86 2026 et Cofiroute 2026 (fichiers .txt, guides PDF, communiqué), page Ulys A86 | https://public-content.vinci-autoroutes.com/PDF/Tarifs-peage-Cofiroute/Cofiroute-Guide-tarifaire-2026.pdf | `d8443adcc6f0` |
| `data/raw/TOLL04/Tarifs-Duplex-2026.pdf` | VINCI Autoroutes - tarifs Duplex A86 2026 et Cofiroute 2026 (fichiers .txt, guides PDF, communiqué), page Ulys A86 | https://public-content.vinci-autoroutes.com/PDF/Tarifs-Duplex-A86/Tarifs-Duplex-2026.pdf | `88b776f5562e` |
| `data/raw/TOLL04/Tarifs_A86.txt` | VINCI Autoroutes - tarifs Duplex A86 2026 et Cofiroute 2026 (fichiers .txt, guides PDF, communiqué), page Ulys A86 | https://public-content.vinci-autoroutes.com/PDF/Tarifs-Duplex-A86/Tarifs_A86.txt | `5fc381b5392c` |
| `data/raw/TOLL04/Tarifs_Cofiroute_Arcour.txt` | VINCI Autoroutes - tarifs Duplex A86 2026 et Cofiroute 2026 (fichiers .txt, guides PDF, communiqué), page Ulys A86 | https://public-content.vinci-autoroutes.com/PDF/Tarifs-peage-Cofiroute/Tarifs_Cofiroute_Arcour.txt | `4bb7c667e5c9` |
| `data/raw/TOLL04/communique-de-presse_evolution-tarifs-duplex-a86-2026_vdef2.pdf` | VINCI Autoroutes - tarifs Duplex A86 2026 et Cofiroute 2026 (fichiers .txt, guides PDF, communiqué), page Ulys A86 | https://www.vinci-autoroutes.com/static/fa7085ca079a7543df509fc7d85a33b8/communique-de-presse_evolution-tarifs-duplex-a86-2026_vdef2.pdf | `b3a268594f8c` |
| `data/raw/TOLL04/ulys-autoroute-a86.html` | VINCI Autoroutes - tarifs Duplex A86 2026 et Cofiroute 2026 (fichiers .txt, guides PDF, communiqué), page Ulys A86 | https://ulys.com/autoroute/a86/ | `f39d3db9bd31` |
| `data/raw/TOLL04/vinci-tarifs-page-data.json` | VINCI Autoroutes - tarifs Duplex A86 2026 et Cofiroute 2026 (fichiers .txt, guides PDF, communiqué), page Ulys A86 | https://www.vinci-autoroutes.com/page-data/fr/conseils/autoroute-mode-demploi/tarifs-peage-vinci-autoroutes/page-data.json | `ab3dff50d238` |

### TOLL05

**Gares de péage du réseau routier national concédé** (Ministère de la Transition écologique)

- **Statut** : utilisée et publiée : registre des gares de péage rapproché des nœuds OSM (tolls.json)
- **Licence (manifeste)** : ODC-BY (Open Data Commons Attribution), champ license = odc-by de l'API data.gouv.fr
- **Obligations** : ODC-BY : attribution
- **Millésime** : référentiel au 01/01/2025
- **Date d'extraction** : 2026-11-03T21:52Z
- **Granularité et géographie** : gare de péage (type, côté, nombre de voies) ; France (réseau concédé)
- **Ce qu'on en fait** : type (pleine voie, échangeur) et côté des gares nommées dans le registre
- **Contrôles** : chaque nom de gare du registre existe dans le CSV (arrêt sinon)
- **Limites** : 2025 : Montesson et Buchelay y sont encore des barrières (passés en flux libre depuis)
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `tolls.json`
  - code du front qui la cite (écran déduit du chemin) : mode provenance
  - pipeline : `04j_toll_tariffs.py` ; `06_export_front.py` ; `toll_tariffs.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TOLL05/dataset-metadata.json` | Ministère de la Transition écologique - Gares de péage du réseau routier national concédé | https://www.data.gouv.fr/api/1/datasets/59a0416ec751df23aa4d2736/ | `c1ae3339c111` |
| `data/raw/TOLL05/gares-peage-2025.csv` | Ministère de la Transition écologique - Gares de péage du réseau routier national concédé | https://static.data.gouv.fr/resources/gares-de-peage-du-reseau-routier-national-concede/20250728-140859/gares-peage-2025.csv | `e70ebf3d57c5` |

### TOLL06

**Recoupement de l'A5 : grille APRR du 1er février 2026 retéléchargée le 05/11/2026** (APRR (copie ouverte data.gouv.fr et PDF officiel))

- **Statut** : utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient) : montants de l'A5 du site comparés au CSV ouvert et au PDF officiel (04k, data/processed/toll_crosscheck.json) ; rien d'affiché n'en vient
- **Licence (manifeste)** : document public APRR cité comme source d'un tarif (pas de licence affichée) ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités) le 09/11/2026, à trois conditions : données obtenues par mise à disposition et non par scraping, la dataviz ne permet pas de réexporter les données brutes, producteur crédité dans la dataviz elle-même ; son message nomme VINCI : l'appliquer à cette source est la lecture de l'équipe (10/11/2026) ; Licence Ouverte v2.0 (Etalab), champ license = lov2 de l'API data.gouv.fr (fiche https://www.data.gouv.fr/datasets/tarifs-autoroutes-aprr) ; Licence Ouverte v2.0 (Etalab), champ license = lov2
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités, 09/11/2026) à trois conditions : données obtenues par mise à disposition du producteur, jamais par scraping ; la dataviz ne permet pas de réexporter les données brutes ; le producteur est crédité dans la dataviz elle-même, à côté de chaque montant. Ne vaut pas licence de redistribution des données ; Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : en vigueur au 1er février 2026 ; fiche modifiée le 02/08/2026
- **Date d'extraction** : 2026-11-05T09:26Z
- **Granularité et géographie** : couple gare d'entrée - gare de sortie, classes 1 à 5 ; métadonnées du jeu ; réseau APRR ; réseau APRR (A5, A6, A77 retenus)
- **Ce qu'on en fait** : lu avec pdftotext -table, une page à la fois, numéro de page du PDF noté pour chaque tarif de l'A5 ; octets identiques à TOLL02 ; montants de l'A5 du site (toll_tariffs.csv et tolls.json) comparés couple par couple et classe par classe, classes 1 et 5 ; octets identiques à TOLL02 (même sha256), le sha1 recalculé (f709ee05...) est celui que publie data.gouv.fr ; licence, date de mise à jour et empreinte sha1 de la ressource 2026-02 (f709ee05893ef5176b9a613b1076462d43c4fe31)
- **Contrôles** : tarifs de l'A5 (classes 1 et 5) et classes 2 à 4 du PDF contre le CSV TOLL06 ; concordance site / CSV / PDF officiel ; sha1 de la ressource APRR 2026-02 = sha1 du fichier téléchargé
- **Limites** : numéro de page = rang de la page dans le PDF, pas le numéro imprimé ; tarif de base, hors abonnements ; extraits des PDF d'APRR par le producteur du jeu : 9 couples du PDF absents du CSV ; tarif de base, hors abonnements ; aucune
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : aucun fichier du front ne la cite
  - pipeline : `04k_toll_crosscheck.py` ; `licences_attente.py` ; `toll_crosscheck.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TOLL06/TARIFS_APRR-2026-02.pdf` | APRR - Tarifs de péage, réseau APRR classes 1 à 5 (PDF officiel, retéléchargé le 05/11/2026 pour le recoupement de l'A5) | https://voyage.aprr.fr/sites/default/files/2026-02/TARIFS_APRR.pdf | `f05dfa58cb4f` |
| `data/raw/TOLL06/aprr-tarifs-2026-02.csv` | APRR - Tarifs autoroutes APRR 2026-02, copie ouverte data.gouv.fr (recoupement indépendant de l'A5, retéléchargée le 05/11/2026) | https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131933/2026-02.csv | `29557dd81452` |
| `data/raw/TOLL06/dataset-metadata.json` | APRR - Tarifs autoroutes APRR : fiche data.gouv.fr (métadonnées du jeu, du 05/11/2026) | https://www.data.gouv.fr/api/1/datasets/tarifs-autoroutes-aprr/ | `6da835a822ba` |

### TRA01

**Horaires prévus des transports en commun (GTFS)** (Île-de-France Mobilités)

- **Statut** : utilisée et publiée : horaires théoriques du mardi 17/11/2026, entrée de r5py : tous les temps TC publiés en dérivent
- **Licence (manifeste)** : Licence Mobilités (IDFM) - https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm
- **Obligations** : Licence Mobilités (IDFM, inspirée de l'ODbL) : attribution ; partage à l'identique limité aux données de même nature, granularité, période et emprise (communiqué GART et UTP du 08/03/2021) ; texte officiel à relire
- **Millésime** : offre prévue sur les 30 jours suivant le 06/11/2026 (flux figé le 06/11/2026 à 16h11, heure de Paris) ; remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt)
- **Date d'extraction** : 2026-11-06T15:11Z
- **Date de service transport** : 2026-11-17 (mardi ordinaire, 144948 courses actives)
- **Granularité et géographie** : arrêt / course ; Île-de-France
- **Ce qu'on en fait** : aucun (entrée directe de r5py) ; transfers.txt lu pour le contrôle des correspondances : minimums des correspondances trop courtes publiés dans les itinéraires (04/11/2026) ; chargé dans le moteur R5 corrigé (04/11/2026) ; entrée du calcul des autres trajets du panneau (le moins cher et le moins de correspondances ; en 9h-17h et 14h-22h ; 10/11/2026)
- **Contrôles** : date de service comprise dans calendar / calendar_dates ; contrôle du pipeline : aucune ligne du flux sans service le 17/11/2026 sans être listée et justifiée
- **Limites** : Offre théorique (ni retards ni perturbations) ; validité ~30 jours glissants
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `geo/poles.geojson` ; `meta.json` ; `od_walk1000/index.json` ; `od_walk3000/index.json`
  - code du front qui la cite (écran déduit du chemin) : affiche exportable ; autre ; carte miroir ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve
  - pipeline : `01_download.py` ; `03_build_jobs_poles.py` ; `04_compute_matrix.py` ; `04c_compute_od_table.py` ; `04d_compute_velib.py` ; `04f_probe_walk_tables.py` ; `04g_car_distances.py` ; `04h_transit_itineraries.py` ; `04m_build_night_gtfs.py` ; `04o_update_flux_manifest.py` ; `06_export_front.py` ; `06b_export_geo.py` ; `06d_export_od.py` ; `06h_export_itineraries.py` ; `06n_export_needs.py` ; `06t_export_transfer_check.py` ; `06w_export_alternatives.py` ; `07_quality_checks.py` ; `07b_egress_limit_analysis.py` ; `07d_navitia_crosscheck.py` ; `07f_panel_sources_coverage.py` ; `07h_transfer_times_check.py` ; `07i_navitia_connections.py` ; `07p_ready_to_publish.py` ; `07r_gtfs_reference_day.py` ; `08_story_candidates.py` ; `08c_tour_challenge_cases.py` ; `car_dist.py` ; `evening_gtfs.py` ; `export.py` ; `f06_delivery.py` ; `fares_carbon.py` ; `flux.py` ; `flux_manifest.py` ; `gtfs.py` ; `matrix_io.py` ; `needs.py` ; `night_gtfs.py` ; `night_network.py` ; `od_night.py` ; `panel_sources.py` ; `poles.py` ; `publication.py` ; `sources.py` ; `traceability.py` ; `transfer_marks.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TRA01/IDFM-gtfs-0611.zip` | IDFM - Horaires prévus sur les lignes de TC d'Île-de-France (GTFS Datahub, jeu offre-horaires-tc-gtfs-idfm) | https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip | `e990debabf77` |

### TRA01B

**Horaires prévus des TC complétés des courses de la veille codées 24:00 et plus (réseau de nuit)** (Île-de-France Mobilités (fichier dérivé par STARWAY))

- **Statut** : utilisée et publiée : GTFS TRA01 + les courses du lundi 16/11 qui passent minuit, ajoutées au mardi 17/11 avec 24 h de moins (04m) : entrée de r5py des horaires de 0h à 6h55 (table du matin, publiée) et du 6h-14h (recalcul pas encore publié)
- **Licence (manifeste)** : Licence Mobilités (IDFM) - https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm (fichier dérivé de TRA01 : mêmes conditions)
- **Obligations** : Licence Mobilités (IDFM, inspirée de l'ODbL) : attribution ; partage à l'identique limité aux données de même nature, granularité, période et emprise (communiqué GART et UTP du 08/03/2021) ; texte officiel à relire
- **Millésime** : dérivé de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026
- **Date d'extraction** : 2026-11-06T15:52Z
- **Date de service transport** : 2026-11-17 (mardi type) complété des courses du lundi 16/11/2026 qui passent minuit
- **Granularité et géographie** : arrêt / course ; Île-de-France
- **Ce qu'on en fait** : les courses des services actifs le lundi 16/11 (calendar.txt puis calendar_dates.txt) dont des arrêts sont codés 24:00 et plus sont ajoutées au mardi 17/11 (service NUIT_20261117, identifiants NUIT_<trip_id>) avec 24 h de moins, SEULEMENT les arrêts à partir de 24:00, sans shape_id ; tous les autres fichiers du GTFS sont recopiés sans changement ; entrée de r5py des tables du matin (0h à 6h55), du 6h-14h recalculé et, depuis le flux du 06/11, du vélo + TC des trois journées-types et des autres trajets du panneau en 6h-14h (10/11/2026) ; mesuré dans le fichier livré : 2768 courses et 56847 arrêts copiés (journal de construction sur la machine de calcul)
- **Contrôles** : contrôle du pipeline : GTFS de nuit = TRA01 + lignes ajoutées conformes à la règle ; empreinte complète au manifeste ; dossiers de nuit et vélo + TC calculés sur cette empreinte
- **Limites** : les courses ajoutées ne couvrent que ce que le lundi 16/11 prolonge après minuit ; le matin et le soir viennent du même mardi type ; offre théorique (ni retards ni perturbations) ; le zip lui-même n'est pas reproductible octet pour octet (compression), son contenu l'est ; le vélo + TC utilise ce réseau pour les trois journées-types, les courses ajoutées ne roulant qu'avant 7h
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json` ; `od_walk1000/index.json` ; `od_walk3000/index.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance ; panneau de preuve
  - pipeline : `04m_build_night_gtfs.py` ; `04o_update_flux_manifest.py` ; `06_export_front.py` ; `06d_export_od.py` ; `06h_export_itineraries.py` ; `06w_export_alternatives.py` ; `06y_textes_publics_manifeste.py` ; `07_quality_checks.py` ; `07h_transfer_times_check.py` ; `07p_ready_to_publish.py` ; `evening_gtfs.py` ; `f06_delivery.py` ; `flux.py` ; `flux_manifest.py` ; `matrix_io.py` ; `night_network.py` ; `od_night.py` ; `publication.py` ; `traceability.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TRA01B/gtfs_nuit-0611.zip` | IDFM - GTFS TRA01 (flux du 06/11/2026) complété des courses de la veille codées 24:00 et plus (réseau de nuit), fichier dérivé construit par STARWAY | https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip | `3e38b7975e7b` |

### TRA01C

**Horaires prévus des TC du réseau de nuit complétés des courses du mercredi parties avant 3h (réseau du soir)** (Île-de-France Mobilités (fichier dérivé par STARWAY))

- **Statut** : utilisée et publiée : TRA01B + les courses du mercredi 18/11 parties avant 3h, copiées au mardi 17/11 avec 24 h de plus (04n, starway/evening_gtfs.py) : entrée de r5py des horaires de 22h05 à 23h55 (table du soir, publiée) ; le soir vient du même mardi type que le matin
- **Licence (manifeste)** : Licence Mobilités (IDFM) - https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm (fichier dérivé de TRA01 : mêmes conditions)
- **Obligations** : Licence Mobilités (IDFM, inspirée de l'ODbL) : attribution ; partage à l'identique limité aux données de même nature, granularité, période et emprise (communiqué GART et UTP du 08/03/2021) ; texte officiel à relire
- **Millésime** : dérivé de TRA01B puis de TRA01 (flux du 06/11/2026) : offre prévue sur les 30 jours suivant le 06/11/2026
- **Date d'extraction** : 2026-11-06T15:52Z
- **Date de service transport** : 2026-11-17 (mardi type) complété des courses du mercredi 18/11/2026 parties avant 3h et recodées 24h plus tard
- **Granularité et géographie** : arrêt / course ; Île-de-France
- **Ce qu'on en fait** : les courses des services actifs le mercredi 18/11 (calendar.txt puis calendar_dates.txt) dont le PREMIER départ est avant 03:00:00 et qui ont au moins 2 arrêts sont copiées EN ENTIER au mardi 17/11 avec 24 h de PLUS sur toutes les heures (service SOIR_20261117, identifiants SOIR_<trip_id d'origine>, sans shape_id) ; tous les autres fichiers sont recopiés sans changement ; entrée de r5py de la table commune x commune du soir seulement (départs de 22h05 à 23h55) ; mesuré dans le fichier livré : 1348 courses et 34905 arrêts copiés (journal de construction sur la machine de calcul)
- **Contrôles** : contrôle du pipeline : GTFS du soir = GTFS de nuit + courses du mercredi parties avant 3h conformes à la règle, aucune oubliée (aucun nombre attendu écrit en dur) ; empreinte complète au manifeste
- **Limites** : le soir vient du MÊME mardi type que le matin, avec les courses du mercredi après minuit (pas d'une journée réelle continue) ; offre théorique (ni retards ni perturbations) ; le zip lui-même n'est pas reproductible octet pour octet (compression), son contenu l'est ; sert uniquement aux départs de 22h05 à 23h55
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `od_walk1000/index.json` ; `od_walk3000/index.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance ; panneau de preuve
  - pipeline : `04o_update_flux_manifest.py` ; `06_export_front.py` ; `06d_export_od.py` ; `07_quality_checks.py` ; `07p_ready_to_publish.py` ; `evening_gtfs.py` ; `f06_delivery.py` ; `flux.py` ; `flux_manifest.py` ; `od_night.py` ; `publication.py` ; `traceability.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TRA01C/gtfs_soir-0611.zip` | IDFM - GTFS de nuit TRA01B (flux du 06/11/2026) complété des courses du mercredi 18/11 parties avant 3h (réseau du soir), fichier dérivé construit par STARWAY | https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip | `bf02daf3b8c0` |

### TRA02

**API IDFM Navitia, calculateur officiel (requêtes journeys)** (Île-de-France Mobilités (PRIM))

- **Statut** : utilisée et publiée : requêtes journeys : contrôle seulement (recoupement des temps TC, statut des découvertes dans insights.json), aucune durée de trajet affichée n'en vient ; les requêtes connections sont TRA02B et TRA02C ; les relevés du 05/11 sont TRA02D (connections) et TRA02E (prix)
- **Licence (manifeste)** : CGU PRIM (juillet 2022) ; données sous Licence Mobilités (page de l'API PRIM vérifiée le 03/11/2026)
- **Obligations** : Licence Mobilités (IDFM, inspirée de l'ODbL) : attribution ; partage à l'identique limité aux données de même nature, granularité, période et emprise (communiqué GART et UTP du 08/03/2021) ; texte officiel à relire ; CGU PRIM : accès à l'API par clé personnelle (jamais publiée), quotas respectés
- **Millésime** : données Navitia chargées le 20261109T230555 (période de production 20261105-20261208)
- **Date d'extraction** : 2026-11-10T03:17Z
- **Date de service transport** : 2026-11-17
- **Granularité et géographie** : trajet (point origine - point destination, horaire) ; Île-de-France
- **Ce qu'on en fait** : 303 réponses JSON en cache (une par requête, clé API jamais écrite) ; sha256 = empreinte de la liste triée « nom sha256 » des fichiers ; comparaison par le contrôle Navitia du pipeline (réglage de marche publié et, historique, réglage R5 d'origine), sonde de la limite d'accès, durées de correspondance (API connections) par le pipeline, tirage stratifié par statut de correspondance par le pipeline
- **Contrôles** : date de service dans la période de production Navitia (bloquant) ; réponses en erreur conservées
- **Limites** : contrôle seulement, rien d'affiché n'en vient, sauf le statut de recoupement des découvertes (confirmée, à une minute près, ou écartée si contredite) ; quota PRIM par défaut 5 requêtes/s et 1 000/jour ; horaires théoriques (base_schedule) ; voir la méthodologie
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau
  - pipeline : `06y_textes_publics_manifeste.py` ; `07d_navitia_crosscheck.py` ; `transfer_marks.py`
- **À vérifier** : fichier hors data/raw (cache ou dossier)

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/interim/navitia_cache/` | IDFM Navitia (API PRIM « IDFM Navitia », requêtes journeys) - contrôle des temps de trajet TC | https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys | `425b6239d1f0` |

### TRA02B

**API IDFM Navitia, durées de correspondance au même arrêt (requêtes connections)** (Île-de-France Mobilités (PRIM))

- **Statut** : utilisée et publiée : durées affichées dans le panneau de preuve comme minimum du calculateur d'IDFM (meta.transfer_check) ; lues aussi par le moteur corrigé, dont le recalcul est publié depuis le 05/11/2026 (transfer_rules gtfs_navitia dans meta.json)
- **Licence (manifeste)** : CGU PRIM (juillet 2022) ; données sous Licence Mobilités (page de l'API PRIM vérifiée le 03/11/2026)
- **Obligations** : Licence Mobilités (IDFM, inspirée de l'ODbL) : attribution ; partage à l'identique limité aux données de même nature, granularité, période et emprise (communiqué GART et UTP du 08/03/2021) ; texte officiel à relire ; CGU PRIM : accès à l'API par clé personnelle (jamais publiée), quotas respectés
- **Millésime** : données Navitia chargées le 20261104T081131 (période de production 20261031-20261203)
- **Date d'extraction** : 2026-11-04T10:02Z
- **Date de service transport** : 2026-11-17
- **Granularité et géographie** : connexion (arrêt demandé, quai d'origine, quai de destination, durée) ; arrêt (stop_point = arrêt du GTFS IDFM) ; Île-de-France
- **Ce qu'on en fait** : les 638 réponses « connections » de la ligne précédente (TRA02B), une ligne par connexion (8 356, dont 638 d'un arrêt vers lui-même) : arrêt demandé, origine, destination, durée et durée affichée ; lu pour le contrôle des correspondances trop courtes des itinéraires publiés : minimum Navitia d'une correspondance sans ligne transfers.txt ; sha256 = fichier (fins de ligne LF, celles de l'index git) ; 638 réponses « connections » (249 et 110 requêtes le 04/11, puis 279 requêtes le 04/11 pour les arrêts monomodalStopPlace à une seule ligne ; une requête par seconde, clé API jamais écrite) ; connexion d'un arrêt vers lui-même -> durée minimum au même arrêt (541 à 120 s, 96 à 300 s, 1 à 900 s) ; fichier dérivé lu par le moteur R5 corrigé ; sha256 = fichier dérivé (fins de ligne LF, celles de l'index git) ; ajoute 279 arrêts à la version de 359 arrêts (TRA02C), sans changer aucune des 359 durées ; le recalcul de la machine de calcul utilise la version de 359 arrêts, pas celle-ci
- **Contrôles** : 638 arrêts demandés, 638 réponses ; durée Navitia égale au min_transfer_time du GTFS pour 7 697 couples sur 7 712 comparés ; chaque minimum Navitia publié dans les itinéraires est retrouvé dans ce fichier (contrôle bloquant) ; durée Navitia égale au min_transfer_time du GTFS pour 5 567 couples sur 5 576 comparés (9 écarts : Gare de l'Est, Aéroport CDG 2 ; le moteur garde le GTFS) ; banc des correspondances recoupé avec les trajets Navitia (voir la méthodologie)
- **Limites** : API et non fichier ouvert daté ; seulement les arrêts relevés le 04/11 (les quais relevés le 05/11, TRA02D, n'y sont pas) ; une correspondance sans ligne transfers.txt ni connexion relevée n'a aucun minimum connu : son statut le dit, aucune valeur supposée ; quota PRIM 1 000 requêtes par jour ; API et non fichier ouvert daté ; 638 arrêts sur 53 412 du réseau, dont les 471 arrêts monomodalStopPlace (TRA02C : 359 arrêts) ; les quais de bus, tram et métro ne sont pas relevés ; un arrêt sans durée relevée garde la règle d'origine du moteur (plus de 60 s), aucune valeur supposée ; quota PRIM 1 000 requêtes par jour
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance
  - pipeline : `06y_textes_publics_manifeste.py` ; `traceability.py` ; `transfer_marks.py`
- **À vérifier** : fichier hors data/raw (cache ou dossier)

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/processed/navitia_connections.csv` | IDFM Navitia (API PRIM « IDFM Navitia », stop_points/{id}/connections) - toutes les connexions des 638 arrêts relevés le 04/11 : minimums Navitia du contrôle des correspondances trop courtes | https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/stop_points/{stop_point}/connections | `04503f9b2a44` |
| `data/processed/navitia_same_stop_min.csv (réponses : data/interim/navitia_cache/connections_*.json)` | IDFM Navitia (API PRIM « IDFM Navitia », requêtes stop_points/{id}/connections) - durées de correspondance au même arrêt, source du moteur corrigé | https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/stop_points/{stop_point}/connections | `2d57acd36149` |

### TRA02C

**API IDFM Navitia, durées au même arrêt du recalcul des correspondances de la VM (359 arrêts)** (Île-de-France Mobilités (PRIM))

- **Statut** : utilisée et publiée : copie exacte du fichier réellement appliqué au recalcul, dont l'empreinte est dans les run_params.json des dossiers *_d031 ; recalcul publié le 05/11/2026 (ciel à 44 astres)
- **Licence (manifeste)** : CGU PRIM (juillet 2022) ; données sous Licence Mobilités (page de l'API PRIM vérifiée le 03/11/2026)
- **Obligations** : Licence Mobilités (IDFM, inspirée de l'ODbL) : attribution ; partage à l'identique limité aux données de même nature, granularité, période et emprise (communiqué GART et UTP du 08/03/2021) ; texte officiel à relire ; CGU PRIM : accès à l'API par clé personnelle (jamais publiée), quotas respectés
- **Millésime** : données Navitia chargées le 20261104T081131 (période de production 20261031-20261203)
- **Date d'extraction** : 2026-11-04T10:02Z
- **Date de service transport** : 2026-11-17
- **Granularité et géographie** : arrêt (stop_point = arrêt du GTFS IDFM) ; Île-de-France
- **Ce qu'on en fait** : copie rapatriée de la machine de calcul le 04/11 (scp) ; 359 arrêts (276 à 120 s, 82 à 300 s, 1 à 900 s) ; c'est le fichier dont l'empreinte est dans les paramètres des calculs de temps de trajet, des tables commune par commune et des itinéraires ; les 359 lignes sont identiques dans la version de 638 arrêts (TRA02B)
- **Contrôles** : les 359 durées sont les mêmes que dans la version de 638 arrêts (comparaison ligne à ligne le 04/11, 0 écart)
- **Limites** : c'est le jeu de règles réellement appliqué au recalcul publié ; les 279 arrêts monomodalStopPlace à une seule ligne ajoutés ensuite (TRA02B) n'y sont pas appliqués : ils gardent la règle d'origine du moteur ; quota PRIM 1 000 requêtes par jour
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau
  - pipeline : `traceability.py`
- **À vérifier** : fichier hors data/raw (cache ou dossier)

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/processed/navitia_same_stop_min_recalc_d031.csv (réponses : data/interim/navitia_cache/connections_*.json)` | IDFM Navitia (API PRIM « IDFM Navitia », stop_points/{id}/connections) - version de 359 arrêts du fichier de durées au même arrêt, celle du recalcul de la machine de calcul (copie exacte du fichier de la machine de calcul) | https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/stop_points/{stop_point}/connections | `9535e60e0888` |

### TRA02D

**API IDFM Navitia, durées de correspondance de 217 quais sans ligne transfers.txt (relevé du 05/11)** (Île-de-France Mobilités (PRIM))

- **Statut** : utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient) : 217 quais, tous à 120 s au même quai, mêmes durées que transfers.txt sur 3 579 couples ; non appliquées au moteur ni affichées
- **Licence (manifeste)** : CGU PRIM (juillet 2022) ; données sous Licence Mobilités (page de l'API PRIM vérifiée le 03/11/2026)
- **Obligations** : Licence Mobilités (IDFM, inspirée de l'ODbL) : attribution ; partage à l'identique limité aux données de même nature, granularité, période et emprise (communiqué GART et UTP du 08/03/2021) ; texte officiel à relire ; CGU PRIM : accès à l'API par clé personnelle (jamais publiée), quotas respectés
- **Millésime** : données Navitia chargées le 20261104T081131 ou plus récentes (non relevé le 05/11)
- **Date d'extraction** : 2026-11-05T01:17Z
- **Date de service transport** : 2026-11-17
- **Granularité et géographie** : arrêt (stop_point = quai du GTFS IDFM) ; Île-de-France
- **Ce qu'on en fait** : 217 réponses « connections » (217 requêtes le 05/11, une requête par seconde, clé API jamais écrite) ; une ligne par connexion (3 876) ; sha256 = fichier (fins de ligne LF)
- **Contrôles** : 217 arrêts demandés, 217 réponses ; 217 connexions d'un quai vers lui-même, toutes à 120 s ; 3 579 couples retrouvés dans transfers.txt, durée identique pour les 3 579
- **Limites** : données Navitia datées par fetched_at de chaque ligne (la date de chargement des données Navitia n'a pas été relue le 05/11) ; durées non appliquées au moteur R5 corrigé (hors navitia_same_stop_min.csv) ; ne couvre pas les 638 arrêts relevés le 04/11 (TRA02B, leur cache brut est perdu)
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau
  - pipeline : aucun fichier du pipeline ne la cite
- **À vérifier** : fichier hors data/raw (cache ou dossier)

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/processed/navitia_connections_no_line_05_11.csv (réponses : cache-prim/connections_*.json de l'arbre prim-releves, non versionné)` | IDFM Navitia (API PRIM « IDFM Navitia », stop_points/{id}/connections) - 217 quais « sans ligne transfers.txt » relevés le 05/11 (durée de correspondance au même quai) | https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/stop_points/{stop_point}/connections | `b326d26475fd` |

### TRA02E

**API IDFM Navitia, prix au ticket recoupés (échantillon de 48 trajets du 05/11)** (Île-de-France Mobilités (PRIM))

- **Statut** : utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient) : bloc fare de requêtes journeys comparé au prix au ticket publié (07k), rien d'affiché n'en vient
- **Licence (manifeste)** : CGU PRIM (juillet 2022) ; données sous Licence Mobilités (page de l'API PRIM vérifiée le 03/11/2026)
- **Obligations** : Licence Mobilités (IDFM, inspirée de l'ODbL) : attribution ; partage à l'identique limité aux données de même nature, granularité, période et emprise (communiqué GART et UTP du 08/03/2021) ; texte officiel à relire ; CGU PRIM : accès à l'API par clé personnelle (jamais publiée), quotas respectés
- **Millésime** : données Navitia du moment de la requête (horaires théoriques du 17/11/2026)
- **Date d'extraction** : 2026-11-05T01:19Z
- **Date de service transport** : 2026-11-17
- **Granularité et géographie** : trajet (commune, pôle, journée-type, sens) ; Île-de-France
- **Ce qu'on en fait** : 50 requêtes (5 familles de prix x 10 trajets), 48 réponses exploitables ; trajet Navitia aux mêmes lignes dans le même ordre, prix plein tarif fare.total contre tickets.cost_eur ; sha256 = fichier (fins de ligne LF)
- **Contrôles** : 26 même prix, 3 prix différents, 16 sans trajet aux mêmes lignes, 3 sans prix Navitia (TER)
- **Limites** : contrôle seulement, rien d'affiché ne vient de Navitia ; échantillon de 48 trajets, pas représentatif ; s'ajoute aux 603 trajets de navitia_fares_check.csv (TRA02) dont le cache brut est perdu
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : aucun champ « source »
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau
  - pipeline : aucun fichier du pipeline ne la cite
- **À vérifier** : fichier hors data/raw (cache ou dossier)

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/processed/navitia_fares_check_05_11.csv (réponses : cache-prim/ de l'arbre prim-releves, non versionné)` | IDFM Navitia (API PRIM « IDFM Navitia », requêtes journeys avec bloc fare) - 48 trajets recoupés avec les prix au ticket, échantillon du 05/11 | https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys | `3bd23d39b7d7` |

### TRA03

**Référentiel des lignes de transport en commun** (Île-de-France Mobilités)

- **Statut** : utilisée et publiée : climatisation déclarée de chaque ligne, sur chaque tronçon en TC des itinéraires détaillés (itineraries/{insee}.json.gz, champ air_conditioning ; ODbL, base dérivée publiée sous la même licence) ; accessibilité de la ligne, annonces sonores et informations visuelles à bord recopiées dans le champ a11y du même fichier (06n, « Mes besoins »)
- **Licence (manifeste)** : ODbL, version française (« Licence ODbL Version Française », métadonnées du jeu sur data.iledefrance-mobilites.fr, vérifié le 04/11/2026) ; attribution et partage à l'identique des bases dérivées
- **Obligations** : ODbL : citer la source ; toute base dérivée publiée (nos fichiers de données) reste sous ODbL et le dit (partage à l'identique)
- **Millésime** : instantané du 03/11/2026 (jeu mis à jour chaque jour)
- **Date d'extraction** : 2026-11-03T15:44Z
- **Granularité et géographie** : ligne commerciale ; Île-de-France
- **Ce qu'on en fait** : analyse de couverture seulement : champs air_conditioning et accessibility ; rien de publié ; champs accessibility, audiblesigns_available et visualsigns_available recopiés tels quels (true, false, partial pour les deux derniers, unknown ; vide ou hors liste = unknown) dans le champ a11y de chaque tronçon en TC des itinéraires publiés ; ligne absente = null (affiché « non renseigné ») ; sens de audiblesigns_available (informations sonores à bord) et visualsigns_available (informations dynamiques à bord) lu dans la documentation PDF des référentiels (PDF de 2023, page 25, sha256 369971e341a099e1f5865a42236775a8c0fbdc893705abc23327100ab02e5992), la description de la page du jeu les inverse
- **Contrôles** : jointure route_id du GTFS TRA01 (service du 17/11/2026) -> ID_Line : 1 966 / 1 966 routes actives ; chaque tronçon publié aligné sur les lots du calcul des itinéraires (famille, heures, ligne) ; contrôle du pipeline : a11y dans les valeurs permises et présent dans le référentiel
- **Limites** : air_conditioning et accessibility déclarés par ligne, pas par véhicule ; « partial » non défini ; libellés audiblesigns / visualsigns inversés dans la description du jeu (sens retenu : la documentation PDF) ; pour un bus, ligne accessible = au moins 70 % des arrêts accessibles, véhicules équipés, personnel formé ; les arrêts d'une ligne accessible ne le sont pas tous ; informations sonores et dynamiques décrites « peu renseigné » (environ trois quarts des tronçons publiés en unknown) ; état des ascenseurs non couvert
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve ; panneau de preuve (itinéraires) ; visite guidée
  - pipeline : `06h_export_itineraries.py` ; `06n_export_needs.py` ; `06w_export_alternatives.py` ; `06y_textes_publics_manifeste.py` ; `07_quality_checks.py` ; `07f_panel_sources_coverage.py` ; `07n_needs_measure.py` ; `itin_export.py` ; `line_facts.py` ; `needs.py` ; `panel_sources.py` ; `traceability.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TRA03/referentiel-des-lignes.csv` | IDFM - Référentiel des lignes de transport en commun d'Île-de-France (lignes actives et prochainement actives) | https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/referentiel-des-lignes/exports/csv?delimiter=%3B&use_labels=false | `4ae8d76054ac` |

### TRA04

**Accessibilité en gare** (Île-de-France Mobilités)

- **Statut** : utilisée et publiée : niveau de la gare ferrée de montée et de descente, recopié dans le champ a11y (st_from, st_to) des tronçons ferrés des itinéraires détaillés (06n, « Mes besoins ») ; libellé exact du jeu, jamais « trajet accessible »
- **Licence (manifeste)** : Licence Ouverte v2.0 (Etalab), métadonnées du jeu sur data.iledefrance-mobilites.fr (vérifié le 04/11/2026)
- **Obligations** : Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour
- **Millésime** : jeu modifié le 06/07/2026
- **Date d'extraction** : 2026-11-03T15:44Z
- **Granularité et géographie** : gare ferrée (zone d'arrêt monomodale) ; Île-de-France
- **Ce qu'on en fait** : analyse de couverture seulement ; niveau (accessibility_level_id, libellé exact du jeu) et commentaire recopiés dans st_from / st_to des tronçons ferrés ou des quais présents dans le jeu ; jointure stop_point_id sans stop_point: = stop_id du GTFS ; gare absente = null (affiché « non renseigné »)
- **Contrôles** : 455 / 459 gares retrouvées dans le GTFS ; 6 gares absentes du jeu sur 239 786 gares de tronçons, un niveau a un seul libellé (test)
- **Limites** : Niveau de la gare, pas de l'itinéraire ; 209 gares de niveau 1 non renseignées dans le GTFS ; niveau 3 : obligation de moyens sans réservation, de résultat avec Assist'enGare (description du jeu) ; gares ferrées seulement (ni métro, ni tram, ni bus) ; correspondances, ascenseurs et leur état absents
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : autre ; crédits du ciel et du panneau ; mode provenance ; panneau de preuve (itinéraires)
  - pipeline : `06_export_front.py` ; `06n_export_needs.py` ; `06w_export_alternatives.py` ; `07_quality_checks.py` ; `07f_panel_sources_coverage.py` ; `needs.py` ; `panel_sources.py` ; `traceability.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/TRA04/accessibilite-en-gare.csv` | IDFM - Accessibilité en gare | https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/accessibilite-en-gare/exports/csv?delimiter=%3B&use_labels=false | `931a00848e20` |

### VEH01

**Deux-roues motorisés : consommations et émissions (septembre 2023)** (ADEME)

- **Statut** : utilisée et publiée : consommation des 4 deux-roues thermiques du sélecteur « Véhicule » (meta.vehicles), lue sur la figure (data/processed/ademe_2rm_conso_lecture.csv)
- **Licence (manifeste)** : non indiquée dans le document (publication ADEME relayée par un service de l'État) : citer la source et la date ; mentions légales de la Librairie ADEME (mises à jour le 01/09/2024, lues le 09/11/2026) : « L'ADEME autorise la réutilisation non commerciale et pédagogique des informations disponibles sur son site », en respectant leur intégrité et en citant l'ADEME, sans licence nommée
- **Obligations** : document public cité, aucune licence affichée : citer la source sans reproduire le document ; licence à confirmer (voir la colonne licence du manifeste)
- **Millésime** : 2023
- **Date d'extraction** : 2026-11-04
- **Granularité et géographie** : 11 deux-roues thermiques d'essai, 4 catégories ; France (essais ADEME)
- **Ce qu'on en fait** : lecture des barres de la figure « CO2 et conso de carburant en usage réel ADEME » (§ 4, page 6) sur une capture, moyenne par catégorie ; catégories d'après le tableau de la page 5 et la figure de la page 7
- **Contrôles** : recoupement avec les points Euro4 et Euro5 de la figure de la page 7 ; cohérence CO2 et consommation (environ 2,3 kg de CO2 par litre brûlé) ; texte de la page 6 : « moins de 3 l/100 et 64 gCO2/km pour les 125cm3, moins de 4 l/100 et 85 gCO2/km pour les motos de cylindrée moyenne »
- **Limites** : usage réel sur un trajet de référence, petit échantillon (2 à 4 véhicules par catégorie) ; valeurs lues sur une figure, précision environ 0,05 L/100 km ; CO2 à l'échappement seulement ; aucune donnée sur les deux-roues électriques jugée probante
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau ; mode provenance
  - pipeline : `06_export_front.py` ; `07_quality_checks.py` ; `licences_attente.py` ; `vehicles.py`
- **À vérifier** : licence à confirmer

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/VEH01/2023-09_ademe-2rm-maj-connaissances-consommations-emissions-echappement.pdf` | ADEME, 2RM : mise à jour des connaissances sur les consommations et les émissions à l'échappement (septembre 2023), copie publiée par la préfecture de la Vienne | https://www.vienne.gouv.fr/contenu/telechargement/39557/248972/file/2023-09_ademe-2rm-maj-connaissances-consommations-emissions-echappement.pdf | `b15abe376703` |

### VEL01

**Stations Vélib' (GBFS station_information)** (Vélib' Métropole)

- **Statut** : utilisée et publiée : mode Vélib' pour les 88 origines qui ont une station (meta.velib)
- **Licence (manifeste)** : ODbL 1.0 (Open Data Commons Open Database License), licence déclarée sur data.gouv.fr pour le jeu « Vélib' - Localisation et caractéristique des stations » (diffuseur Ville de Paris, créateur Autolib Vélib' Métropole) dont ce flux est une ressource
- **Obligations** : ODbL : citer la source ; toute base dérivée publiée (nos fichiers de données) reste sous ODbL et le dit (partage à l'identique)
- **Millésime** : instantané du flux à la date d'extraction (horodatage lastUpdatedOther dans le fichier)
- **Date d'extraction** : 2026-11-03T11:12Z
- **Granularité et géographie** : station (position, capacité déclarée) ; zone de service Vélib' Métropole
- **Ce qu'on en fait** : comptage de couverture ; temps Vélib' (marche, vélo, marche) calculés par le pipeline et publiés dans le mode Vélib' du site
- **Contrôles** : stations jointes aux contours GEO01 des 1 285 origines
- **Limites** : Positions et capacités seulement : aucune information sur la disponibilité d'un vélo ou d'une place à une heure donnée (station_status est un instantané temps réel) ; temps Vélib' publiés seulement pour les 88 origines qui ont au moins une station
- **Où c'est utilisé** :
  - fichiers publiés qui la citent : `meta.json`
  - code du front qui la cite (écran déduit du chemin) : crédits du ciel et du panneau
  - pipeline : `04d_compute_velib.py` ; `05b_velib_coverage.py` ; `06_export_front.py` ; `07_quality_checks.py` ; `licences_attente.py` ; `matrix_io.py` ; `sources.py` ; `traceability.py` ; `velib.py`

| Fichier | Titre | Adresse | sha256 (début) |
|---|---|---|---|
| `data/raw/VEL01/station_information.json` | Vélib' Métropole - localisation et caractéristiques des stations (flux GBFS station_information) | https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_information.json | `060688f84cb1` |

## Points à vérifier

- [CO2-01](#co2-01) : licence à confirmer
- [ENG01](#eng01) : fichier hors data/raw (cache ou dossier)
- [GEO02B](#geo02b) : fichier hors data/raw (cache ou dossier)
- [GEO04B](#geo04b) : fichier hors data/raw (cache ou dossier)
- [TRA02](#tra02) : fichier hors data/raw (cache ou dossier)
- [TRA02B](#tra02b) : fichier hors data/raw (cache ou dossier)
- [TRA02C](#tra02c) : fichier hors data/raw (cache ou dossier)
- [TRA02D](#tra02d) : fichier hors data/raw (cache ou dossier)
- [TRA02E](#tra02e) : fichier hors data/raw (cache ou dossier)
- [VEH01](#veh01) : licence à confirmer

## Sources prévues par le référentiel d'origine

Onglet « Catalogue » de [STARWAY_Referentiel_Donnees_FINAL_EQUIPE_2026.xlsx](reference/STARWAY_Referentiel_Donnees_FINAL_EQUIPE_2026.xlsx) (référentiel de l'équipe avant la production). **4 codes ont été réattribués** depuis à une autre source (colonne « Devenir ») : le code du catalogue ne désigne pas toujours la même donnée que le manifeste.

| Code du catalogue | Source prévue | Producteur | Priorité | Devenir |
|---|---|---|---|---|
| EMP01 | INSEE Flores - postes salariés | INSEE | P0 | retenue (même code) |
| TRA01 | IDFM GTFS - offre théorique | IDFM | P0 | retenue (même code) |
| TRA02 | IDFM PRIM - Navitia / itinéraires | IDFM | P0 | retenue (même code) : contrôle des temps de trajet ; les durées de correspondance au même arrêt (affichées depuis le recalcul des correspondances) sont dans TRA02B et TRA02C |
| GEO01 | API Géo - communes | État | P0 | retenue (même code) |
| EMP02 | INSEE - Flux domicile-travail 2023 | INSEE | P1 | retenue (même code) |
| TRA03 | IDFM - API isochrones | IDFM | P2 | non retenue : routage local avec r5py, aucune API au runtime. Code réattribué au référentiel des lignes IDFM |
| GEO02 | IDFM - arrêts et gares | IDFM | P1 | non retenue comme jeu à part : les arrêts et gares viennent du GTFS (TRA01). Code réattribué aux carreaux Filosofi 2021 de l'INSEE |
| CYC01 | OpenStreetMap - extrait Île-de-France | OpenStreetMap / Geofabrik | P1 | retenue (même code) |
| CYC02 | Base nationale des aménagements cyclables | Transport.data.gouv / Geovelo | P1 | non intégrée au 04/11 (aucune décision écrite) |
| CYC03 | Base nationale stationnements vélos | Transport.data.gouv / OSM | P2 | non intégrée au 04/11 (aucune décision écrite) |
| CYC04 | Géovélo / calcul d'itinéraire vélo | Géovélo / PRIM | P1 | non retenue : le vélo est calculé par r5py sur OpenStreetMap |
| VEL01 | Vélib’ Métropole - stations (GBFS) | Vélib' Métropole | P2 | retenue (même code) |
| VEL02 | Vélib’ - statut vélos et bornettes GBFS | Vélib' Métropole | P2 | non retenue : disponibilité en temps réel seulement, aucune prévision possible (avertissement « vélo pas forcément disponible ») |
| GEN01 | INSEE NAV2A/NAV2B - sexe × mode de transport | INSEE | P1 | retenue (même code) |
| GEN02 | INSEE NAV1 - sexe × âge × lieu de travail | INSEE | P2 | non intégrée au 04/11 (aucune décision écrite) |
| GEN03 | INSEE - Activité des résidents (ACT1/ACT2) | INSEE | P1 | non intégrée : citée par le brief, optionnelle, pas intégrée avant le dépôt (donnees-utilisees.md) |
| GEN04 | INSEE - Population par sexe et âge | INSEE | P2 | retenue (même code) |
| SOC01 | INSEE Filosofi 2 - pauvreté / niveau de vie | INSEE | P2 | retenue (même code) |
| SOC02 | INSEE - chômage localisé | INSEE | P2 | retenue (même code) : lot T1 du plan du 06/11 (docs/plan-contexte-territoire.md), données publiées, affichage prévu au lot T3 (taux de chômage au lieu de résidence, descriptif) |
| EMP03 | INSEE Sirene - établissements | INSEE | P2 | non retenue (Sirene). Code réattribué à l'enquête BMO 2026 de France Travail |
| EMP04 | France Travail - API offres d'emploi | France Travail | P3 | écartée à l'origine (France Travail, offres d'emploi : ce ne sont pas des postes salariés recensés par l'INSEE ; accès suspendu). Code réattribué aux offres de Choisir le service public (DGAFP), intégrées à part |
| GEO03 | OpenStreetMap / tuiles géographiques | OpenStreetMap | P2 | non retenue comme fond de carte (carte miroir en contours GEO01, sans tuiles) ; la page de droits d'auteur d'OpenStreetMap sert à l'attribution de CYC01 |

Autres pistes écartées ou non retenues, sans code :

- Barème kilométrique fiscal (coût voiture) : écarté : barème des frais réels, pas un coût de trajet
- Offres d'emploi : écartées : postes à pourvoir, pas emplois existants ; Flores (EMP01) répond à la question
- Horaires réels des salariés : aucune source ouverte : 3 journées-types présentées comme des scénarios
- Validations IDFM, quartiers de gare : cités par le brief, optionnels : pas intégrés avant le dépôt
- Climat (lignes climatisées, îlots de chaleur) : P3 hors MVP ; la climatisation par ligne est étudiée avec TRA03 (proposition du panneau de preuve)

## Hors fichiers : services et logiciels

- **OpenStreetMap** : la donnée est CYC01 (fichier tracé) ; l'attribution « © les contributeurs d'OpenStreetMap » est affichée par le site.
- **API PRIM IDFM Navitia** : TRA02 (requêtes journeys et connections ; réponses gardées en cache local, non versionné ; clé jamais écrite).
- **Azure AI Speech** : service qui génère la voix de la visite guidée (aucune donnée affichée n'en vient) : voir le [README](../README.md), § 5 « Stack technique », « Visite guidée narrée ».
- **Logiciels et bibliothèques** (r5py, R5, pandas, PixiJS, D3, etc.) : registre de la stack, versions et licences dans le [README](../README.md), § 5 « Stack technique ».
