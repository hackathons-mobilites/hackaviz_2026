"""Référentiel exhaustif des sources (docs/sources.md), généré à partir du manifeste data/sources_manifest.csv.

Le manifeste trace chaque fichier (une ligne par fichier). Ce module regroupe les lignes par code de source et
ajoute ce que le manifeste ne dit pas :
- le producteur, un nom court et le statut de la source (tables `SOURCE_INFO`, tenues à la main, ci-dessous) ;
- les obligations de licence, déduites du texte de la colonne `licence` (règles de `licence_kinds`) ;
- où la source est utilisée, déduit du code (pipeline et front) et des fichiers publiés (`frontend/public/data/`) ;
- le devenir des sources prévues par le référentiel d'origine de l'équipe (`CATALOGUE_FOLLOWUP`).

Le rendu ne dépend que de fichiers versionnés (manifeste, catalogue Excel, code, données publiées) : il est
identique sur tout clone du dépôt. Il ne lit pas `data/raw/` (non versionné) ; le contrôle des dossiers de
`data/raw/` est fait à part (`raw_dirs_without_manifest`, appelé par 07_quality_checks.py).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

# Script qui écrit docs/sources.md (cité dans l'en-tête du fichier généré et dans les messages des contrôles)
GENERATOR = "pipeline/scripts/06r_sources_registry.py"
DOC_PATH = "docs/sources.md"
CATALOGUE_PATH = "docs/reference/STARWAY_Referentiel_Donnees_FINAL_EQUIPE_2026.xlsx"

# Un code de source : 2 à 5 majuscules, 2 chiffres, une lettre facultative (EMP01, TOLL04, TRA02B), ou CO2-01.
CODE_PATTERN = r"CO2-01|[A-Z]{2,5}\d{2}[A-Z]?"
_CODE_RE = re.compile(rf"(?<![A-Za-z0-9-])({CODE_PATTERN})(?![A-Za-z0-9])")
_CODE_AT_START = re.compile(rf"^({CODE_PATTERN})(?![A-Za-z0-9])")
# Champ JSON dont le nom contient « source » : "jobs_source":"EMP01", "source_id":"COST08", "sources":["A01"]
_SOURCE_FIELD_STR = re.compile(r'"([^"\\]*source[^"\\]*)"\s*:\s*"((?:[^"\\]|\\.)*)"', re.IGNORECASE)
_SOURCE_FIELD_LIST = re.compile(r'"([^"\\]*source[^"\\]*)"\s*:\s*\[([^\]]*)\]', re.IGNORECASE)

STATUS_LABELS: dict[str, str] = {
    "publiee": "utilisée et publiée",
    "en_attente": "utilisée, résultat pas encore publié",
    "controle": "utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient)",
    "telechargee": "téléchargée, non utilisée",
    "ecartee": "écartée",
}


@dataclass(frozen=True)
class SourceInfo:
    """Ce que le manifeste ne dit pas : producteur, nom court, statut (clé de STATUS_LABELS) et précision."""

    producer: str
    name: str
    status: str
    note: str


# Statut au 04/11/2026, établi d'après le code, les fichiers publiés et docs/donnees-utilisees.md
# (TRA02B et TRA02C relus le 06/11/2026 : le recalcul D-031 est publié depuis le 05/11).
# Une source ajoutée au manifeste sans entrée ici apparaît « statut à renseigner » (contrôle P1 de 07).
SOURCE_INFO: dict[str, SourceInfo] = {
    "CO2-01": SourceInfo("ADEME (Datagir)", "API Impact CO2, facteurs du transport", "ecartee",
                         "évaluée pour le carbone des itinéraires, non retenue au profit des facteurs IDFM (ENV01), "
                         "methodologie.md § 5 duodecies ; gardée comme alternative"),
    "COST01": SourceInfo("Île-de-France Mobilités", "Forfait Navigo Mois (page tarifaire)", "publiee",
                         "prix du forfait, identique pour tous les pôles (context/{insee}.json, panneau de preuve)"),
    "COST02": SourceInfo("Île-de-France Mobilités", "Tarifs 2026 des titres à l'unité", "publiee",
                         "tickets et prix par sens des itinéraires détaillés (D-028, itineraries/{insee}.json)"),
    "COST06": SourceInfo("CRE et EDF", "Tarif réglementé de l'électricité (Tarif Bleu) au 1er août 2026", "publiee",
                         "prix du kWh de la voiture électrique (meta.vehicles, D-029) : 20,01 c€ TTC/kWh, grille EDF. "
                         "Acte qui fixe le tarif : décision du 29/07/2026, JORF n° 0177 du 31/07/2026, texte n° 33 "
                         "(https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470, 403 au robot, articles lus dans "
                         "l'archive JORF de la DILA : entrée en vigueur le 01/08/2026, prix hors taxes). Délibération "
                         "CRE n° 2026-147 du 15/07/2026 "
                         "(https://www.cre.fr/fileadmin/Documents/Deliberations/2026/260715_2026-147_TRVE.pdf). Écart "
                         "HT/TTC expliqué par l'accise et la TVA (D-029, limites.md « Coût »)"),
    "COST07": SourceInfo("Ministère de l'Économie", "Prix des carburants en France, flux instantané v2", "publiee",
                         "médiane des stations d'Île-de-France, SP95-E10 et gazole (meta.vehicles, D-029)"),
    "COST08": SourceInfo("SDES (ministère de la Transition écologique)", "Bilan annuel des transports en 2024",
                         "publiee", "consommations moyennes des voitures particulières (meta.vehicles, D-029)"),
    "CYC01": SourceInfo("Contributeurs d'OpenStreetMap (extrait Geofabrik)", "OpenStreetMap, extrait Île-de-France",
                        "publiee", "réseau des rues des calculs r5py (marche, vélo, voiture, accès aux arrêts) : "
                        "tous les temps publiés en dérivent"),
    "EMP01": SourceInfo("INSEE", "Flores 2023, postes salariés recensés par l'INSEE", "publiee",
                        "taille des astres et compteurs de postes (poles.json, access/)"),
    "EMP02": SourceInfo("INSEE", "Recensement 2023, flux domicile-travail", "publiee",
                        "habitants de la commune qui ont un emploi et travaillent déjà dans le pôle (context/{insee}.json, panneau de preuve)"),
    "EMP04": SourceInfo("DGAFP (Choisir le service public)", "Offres diffusées sur Choisir le service public", "publiee",
                        "bloc séparé « Service public » du panneau de preuve (D-036, service_public.json et "
                        "service_public_offres.json) : offres EN LIGNE au 11/10/2026 selon leurs dates de publication, "
                        "par commune quand le code postal le permet ; jamais ajoutées aux postes salariés recensés par l'INSEE, "
                        "jamais appelées « postes ouverts », aucun effet sur le ciel ni sur les verdicts"),
    "EMP03": SourceInfo("France Travail", "Besoins en Main-d'Oeuvre (BMO) 2026", "publiee",
                        "projets de recrutement déclarés par les employeurs, par bassin d'emploi et par famille de "
                        "métiers (bmo.json, bmo_metiers.json, bloc du panneau de preuve, D-035) ; tendance, jamais "
                        "des offres ni des postes"),
    "EMP05": SourceInfo("INSEE (Insee Références)", "Organisation du temps de travail, enquête Emploi 2024", "publiee",
                        "parts des salariés ayant travaillé le soir (20h-00h) et la nuit (00h-5h) sur quatre semaines "
                        "(territoire.json, lot T1, plan du 06/11) : valeurs nationales, jamais par territoire ni par poste ; "
                        "publié mais pas encore affiché (bulle de la journée-type prévue au lot T2) ; aucune source ouverte "
                        "pour le 6h-14h. Licence Ouverte 2.0 par défaut du site de l'Insee (page lue le 09/11/2026)"),
    "ENG01": SourceInfo("Conveyal (R5, licence MIT), recompilé par STARWAY",
                        "Jars R5 corrigés (limite de marche, règles de correspondance) et jar r5py d'origine",
                        "publiee",
                        "moteur de calcul de TOUS les temps TC publiés : l'empreinte du jar de chaque calcul est écrite dans "
                        "les run_params.json du dossier (r5_jar_sha256) ; les jars (64 Mo) ne sont pas publiés, "
                        "construits sur la VM par pipeline/r5/build_r5_walk.sh et build_r5_d031.sh"),
    "ENV01": SourceInfo("Île-de-France Mobilités", "Émission de CO2e par voyageur-kilomètre sur le réseau", "publiee",
                        "carbone des itinéraires détaillés (D-028, itineraries/{insee}.json, champ co2_g)"),
    "ENV02": SourceInfo("ADEME", "Base Carbone V23.6 (facteurs d'émission de la Base Empreinte)", "publiee",
                        "carbone par véhicule : facteur « combustion + amont » de l'essence, du gazole et de l'électricité "
                        "x consommation (meta.vehicles, bloc « Coût et carbone » du panneau de preuve, D-029)"),
    "GEN01": SourceInfo("INSEE", "Recensement 2023, actifs occupés par sexe et mode de transport", "publiee",
                        "halo « Derrière notre étoile » : modes domicile-travail par sexe (context/{insee}.json)"),
    "GEN04": SourceInfo("INSEE", "Recensement 2023, population par sexe et âge", "publiee",
                        "halo : âge des habitants ; la répartition par sexe est publiée mais pas affichée (choix du 03/11)"),
    "GEO01": SourceInfo("Etalab, API Géo (d'après IGN ADMIN EXPRESS)", "Communes et arrondissements d'Île-de-France",
                        "publiee", "1 285 origines, contours de la carte miroir (communes.json, geo/)"),
    "GEO02": SourceInfo("INSEE", "Filosofi 2021, carreaux de 200 m", "publiee",
                        "point de départ de chaque commune, centre de gravité de la population (D-017) : "
                        "tous les temps publiés en dérivent"),
    "GEO02B": SourceInfo("INSEE (Filosofi 2021) et Etalab (API Géo), fichier dérivé par STARWAY",
                         "Points d'origine des 1 285 communes et arrondissements (data/processed/communes_idf_2026.csv)",
                         "publiee",
                         "centre de gravité de la population de chaque commune (D-017), départ et arrivée de tous les "
                         "calculs r5py ; empreinte de contenu écrite dans les run_params.json (origin_points_sha256)"),
    "GEO04": SourceInfo("France Travail", "Bassins d'emploi 2026", "publiee",
                        "rattachement des origines aux bassins et noms des 44 astres de D-030 (poles.json du ciel, "
                        "publié depuis la bascule du 05/11)"),
    "GEO04B": SourceInfo("France Travail (bassins 2026), fichier dérivé par STARWAY",
                         "Fichier des 44 astres : bassins d'emploi, Paris en 20 arrondissements (data/processed/poles_d030.json)",
                         "publiee",
                         "poles.json du ciel des 44 astres (D-030) : postes Flores sommés, nom, arrêt d'ancrage, position ; "
                         "arrivée de tous les calculs r5py vers les astres (poles_json_sha256 des run_params.json)"),
    "GEO05": SourceInfo("INSEE, via la Région Île-de-France", "Zones d'emploi, composition communale au 01/01/2026",
                        "publiee",
                        "zone d'emploi de chacune des 1 285 communes de départ (territoire.json, lot T1, plan du 06/11), "
                        "les 20 arrondissements de Paris par la commune de Paris ; libellés des 15 zones ; publié mais pas "
                        "encore affiché (onglet « Chômage » prévu au lot T3). Une zone d'emploi n'est pas un bassin d'emploi "
                        "de France Travail (GEO04) ni un astre"),
    "GEO06": SourceInfo("Région Île-de-France et Institut Paris Region", "Polarités du SDRIF-E",
                        "publiee",
                        "polarité de la commune, par son nom résolu en code INSEE (7 noms mal écrits corrigés par une table "
                        "explicite) ; territoire.json (lot T1, plan du 06/11), publié mais pas encore affiché (lot T4) ; "
                        "ce n'est pas un classement d'accessibilité, aucun niveau 1 ou 2 publié"),
    "QS01": SourceInfo("SNCF Voyageurs", "Régularité mensuelle Transilien", "publiee",
                       "ponctualité mensuelle de chaque ligne RER et Transilien, avec le mois, sur chaque tronçon des "
                       "itinéraires détaillés (itineraries/{insee}.json.gz, champ punctuality ; ODbL, base dérivée publiée "
                       "sous la même licence)"),
    "ROAD01": SourceInfo("DRIEAT Île-de-France, DiRIF", "Baromètre trafic mensuel n° 41 (novembre 2025)", "publiee",
                         "coefficients du mode « Voiture (trafic moyen DiRIF) » (meta.car_congestion, D-029). Licence "
                         "écrite dans le pied de page du site (« Sauf mention contraire, tous les contenus de ce site "
                         "sont sous licence etalab-2.0 », page "
                         "https://www.dir.ile-de-france.developpement-durable.gouv.fr/barometre-trafic-mensuel-de-la-circulation-annee-a1804.html?lang=fr, "
                         "relue le 09/11/2026) ; la page de mentions légales du site reste illisible (réponse « Erreur »)"),
    "SOC01": SourceInfo("INSEE", "Filosofi 2023, revenus et pauvreté", "publiee",
                        "halo : niveau de vie médian et taux de pauvreté, secret statistique respecté (context/{insee}.json)"),
    "SOC02": SourceInfo("INSEE", "Taux de chômage localisés (zones d'emploi, départements, région) du 2e trimestre 2026",
                        "publiee",
                        "territoire.json (lot T1, plan du 06/11) : taux de chômage au lieu de résidence des 15 zones d'emploi "
                        "d'Île-de-France (série trimestrielle), des 8 départements et de la région, dernier trimestre "
                        "provisoire ; publié mais pas encore affiché (onglet « Chômage » prévu au lot T3) ; descriptif, "
                        "aucun taux sur un astre, aucun lien de cause. Licence Ouverte 2.0 par défaut du site de l'Insee (page lue le 09/11/2026)"),
    "SUB01": SourceInfo("Île-de-France Mobilités", "Description et tarif des titres de transport (jeu titres-et-tarifs)",
                        "publiee", "prix des abonnements de la zone « Mes abonnements » (D-032 proposée, "
                        "subscriptions.json)"),
    "SUB02": SourceInfo("Île-de-France Mobilités", "Conditions générales de vente et d'utilisation des forfaits",
                        "publiee", "lignes couvertes et conditions des abonnements, recopiées (D-032 proposée, "
                        "subscriptions.json) ; PDF des CGVU Navigo Mois et Semaine (version « Juin 2025 ») déposé à la "
                        "main le 05/11/2026, même version que la page HTML"),
    "SUB03": SourceInfo("Île-de-France Mobilités", "Pages des titres de transport (instantanés)", "publiee",
                        "prix, zones et exclusions des abonnements (D-032 proposée, subscriptions.json)"),
    "SUB04": SourceInfo("Vélib' Métropole", "Offres, grille tarifaire et CGAU Vélib'", "publiee",
                        "prix des offres et des courses Vélib' (D-032 proposée, subscriptions.json) ; page de l'AGEMOB "
                        "(https://agemob.fr/velib-metropole/le-velo-partage/, 05/11/2026) : Velib' Métropole, service "
                        "public exploité dans le cadre d'un marché public"),
    "SUB05": SourceInfo("Ministère du Travail, Service Public (DILA) et DGFiP (BOFiP)",
                        "Prise en charge des frais de transport par l'employeur (Code du travail)", "publiee",
                        "phrases sur la prise en charge employeur recopiées (D-032 proposée, subscriptions.json). "
                        "Textes lus le 05/11/2026 sur code.travail.gouv.fr, Légifrance refusant le robot (403) : L3261-2 "
                        "(https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000019950566), R3261-1, 50 % "
                        "(https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020080272), R3261-2 dont le 3° "
                        "(https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020080269), R3261-3 "
                        "(https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020080267). Doctrine fiscale "
                        "(BOFiP, pas la loi) : BOI-RSA-CHAMP-20-30-10-20-20260407, § 110 « service public de location "
                        "de vélos », Vélib' en exemple "
                        "(https://bofip.impots.gouv.fr/bofip/5601-PGP.html/identifiant=BOI-RSA-CHAMP-20-30-10-20-20260407)"),
    "TKT01": SourceInfo("Île-de-France Mobilités", "Conditions de vente et d'usage des tickets, liste des correspondances par la voie publique",
                        "publiee", "règles de comptage des tickets recopiées et retrouvées dans les pages gardées "
                        "(ticket_rules.py, contrôle P0 de 07) : prix au ticket et cas « coût non calculé » "
                        "(itineraries/{insee}.json, champ tickets)"),
    "TOLL01": SourceInfo("data.gouv.fr (jeu publié par un utilisateur)", "Autoroutes et péages en flux libre",
                         "publiee", "portiques de l'A14 (flux libre) du registre des péages (tolls.json, car_trip.toll, D-029)"),
    "TOLL02": SourceInfo("APRR", "Tarifs de péage APRR au 1er février 2026", "publiee",
                         "grilles des péages APRR (A6, A10...) de tolls.json, tarif de la classe du véhicule (D-029)"),
    "TOLL03": SourceInfo("Journal officiel (DILA) et Sanef (grilles déposées à la main)",
                         "Arrêté du 28 janvier 2026 (A14) et grilles Sanef et SAPN du 1er février 2026",
                         "publiee", "tarifs de l'A14 (Montesson, Chambourcy) et du couple Coutevroult avec Saint-Jean "
                         "et Montreuil-aux-Lions (A4, grille Sanef) de tolls.json ; A1 (Saint-Witz) et A13 (Buchelay, "
                         "Rosny-sur-Seine) : grilles lues, aucune case applicable, péage inconnu ; un trajet qui ne "
                         "traverse que la barrière de Coutevroult a aussi un péage inconnu"),
    "TOLL04": SourceInfo("VINCI Autoroutes", "Tarifs 2026 du Duplex A86 et de Cofiroute", "publiee",
                         "grilles du Duplex A86 et de Cofiroute de tolls.json (tarif badge affiché à part, D-029)"),
    "TOLL05": SourceInfo("Ministère de la Transition écologique", "Gares de péage du réseau routier national concédé",
                         "publiee", "registre des gares de péage rapproché des nœuds OSM (tolls.json, D-029)"),
    "TOLL06": SourceInfo("APRR (copie ouverte data.gouv.fr et PDF officiel)",
                         "Recoupement de l'A5 : grille APRR du 1er février 2026 retéléchargée le 05/11/2026",
                         "controle", "montants de l'A5 du site comparés au CSV ouvert et au PDF officiel (04k, "
                         "data/processed/toll_crosscheck.json) ; rien d'affiché n'en vient"),
    "TRA01": SourceInfo("Île-de-France Mobilités", "Horaires prévus des transports en commun (GTFS)", "publiee",
                        "horaires théoriques du mardi 17/11/2026, entrée de r5py : tous les temps TC publiés en dérivent"),
    "TRA01B": SourceInfo("Île-de-France Mobilités (fichier dérivé par STARWAY)",
                         "Horaires prévus des TC complétés des courses de la veille codées 24:00 et plus (réseau de nuit)",
                         "publiee",
                         "GTFS TRA01 + les courses du lundi 16/11 qui passent minuit, ajoutées au mardi 17/11 avec 24 h de "
                         "moins (D-040, 04m) : entrée de r5py des horaires de 0h à 6h55 (table du matin, publiée) et du "
                         "6h-14h (recalcul pas encore publié)"),
    "TRA01C": SourceInfo("Île-de-France Mobilités (fichier dérivé par STARWAY)",
                         "Horaires prévus des TC du réseau de nuit complétés des courses du mercredi parties avant 3h "
                         "(réseau du soir)", "publiee",
                         "TRA01B + les courses du mercredi 18/11 parties avant 3h, copiées au mardi 17/11 avec 24 h de plus "
                         "(D-040, 04n, starway/evening_gtfs.py) : entrée de r5py des horaires de 22h05 à 23h55 (table du soir, "
                         "publiée) ; le soir vient du même mardi type que le matin"),
    "TRA02": SourceInfo("Île-de-France Mobilités (PRIM)", "API IDFM Navitia, calculateur officiel (requêtes journeys)",
                        "publiee",
                        "requêtes journeys : contrôle seulement (recoupement des temps TC, statut des découvertes dans "
                        "insights.json), aucune durée de trajet affichée n'en vient ; les requêtes connections sont "
                        "TRA02B et TRA02C ; les relevés du 05/11 sont TRA02D (connections) et TRA02E (prix)"),
    "TRA02B": SourceInfo("Île-de-France Mobilités (PRIM)", "API IDFM Navitia, durées de correspondance au même arrêt "
                         "(requêtes connections)", "publiee",
                         "durées affichées dans le panneau de preuve comme minimum du calculateur d'IDFM "
                         "(D-031 c, meta.transfer_check) ; lues aussi par le moteur corrigé (D-031 a2), dont le "
                         "recalcul est publié depuis le 05/11/2026 (transfer_rules gtfs_navitia dans meta.json)"),
    "TRA02C": SourceInfo("Île-de-France Mobilités (PRIM)", "API IDFM Navitia, durées au même arrêt du recalcul des correspondances "
                         "de la VM (359 arrêts)", "publiee",
                         "copie exacte du fichier réellement appliqué au recalcul D-031, dont l'empreinte est dans "
                         "les run_params.json des dossiers *_d031 ; recalcul publié le 05/11/2026 (ciel à 44 astres)"),
    "TRA02D": SourceInfo("Île-de-France Mobilités (PRIM)", "API IDFM Navitia, durées de correspondance de 217 quais "
                         "sans ligne transfers.txt (relevé du 05/11)", "controle",
                         "217 quais, tous à 120 s au même quai, mêmes durées que transfers.txt sur 3 579 couples ; "
                         "non appliquées au moteur ni affichées"),
    "TRA02E": SourceInfo("Île-de-France Mobilités (PRIM)", "API IDFM Navitia, prix au ticket recoupés (échantillon de "
                         "48 trajets du 05/11)", "controle",
                         "bloc fare de requêtes journeys comparé au prix au ticket publié (D-028, 07k), rien "
                         "d'affiché n'en vient"),
    "TRA03": SourceInfo("Île-de-France Mobilités", "Référentiel des lignes de transport en commun", "publiee",
                        "climatisation déclarée de chaque ligne, sur chaque tronçon en TC des itinéraires détaillés "
                        "(itineraries/{insee}.json.gz, champ air_conditioning ; ODbL, base dérivée publiée sous la même "
                        "licence) ; accessibilité de la ligne, annonces sonores et informations visuelles à bord "
                        "recopiées dans le champ a11y du même fichier (06n, « Mes besoins »)"),
    "TRA04": SourceInfo("Île-de-France Mobilités", "Accessibilité en gare", "publiee",
                        "niveau de la gare ferrée de montée et de descente, recopié dans le champ a11y (st_from, "
                        "st_to) des tronçons ferrés des itinéraires détaillés (06n, « Mes besoins ») ; libellé exact "
                        "du jeu, jamais « trajet accessible »"),
    "VEH01": SourceInfo("ADEME", "Deux-roues motorisés : consommations et émissions (septembre 2023)", "publiee",
                        "consommation des 4 deux-roues thermiques du sélecteur « Véhicule » (meta.vehicles, D-029), lue "
                        "sur la figure (data/processed/ademe_2rm_conso_lecture.csv)"),
    "VEL01": SourceInfo("Vélib' Métropole", "Stations Vélib' (GBFS station_information)", "publiee",
                        "mode Vélib' pour les 88 origines qui ont une station (D-027, meta.velib)"),
}

# Dossiers de data/raw/ dont la ligne de manifeste arrive par une autre branche (pas de doublon à la fusion).
# Une fois la branche fusionnée, le code est dans le manifeste : retirer l'entrée (signalé par 07, P1).
PENDING_MANIFEST: dict[str, str] = {}

# Devenir des 22 sources du référentiel d'origine (onglet « Catalogue » de l'Excel de l'équipe). Attention : des
# codes du catalogue ont été réattribués depuis à une autre source (« Code réattribué » dans le texte, compté au rendu).
CATALOGUE_FOLLOWUP: dict[str, str] = {
    "EMP01": "retenue (même code)",
    "TRA01": "retenue (même code)",
    "TRA02": "retenue (même code) : contrôle des temps de trajet ; les durées de correspondance au même arrêt "
             "(affichées depuis D-031) sont dans TRA02B et TRA02C",
    "GEO01": "retenue (même code)",
    "EMP02": "retenue (même code)",
    "TRA03": "non retenue : routage local avec r5py, aucune API au runtime (D-002, D-004). Code réattribué au "
             "référentiel des lignes IDFM",
    "GEO02": "non retenue comme jeu à part : les arrêts et gares viennent du GTFS (TRA01). Code réattribué aux "
             "carreaux Filosofi 2021 de l'INSEE",
    "CYC01": "retenue (même code)",
    "CYC02": "non intégrée au 04/11 (aucune décision écrite)",
    "CYC03": "non intégrée au 04/11 (aucune décision écrite)",
    "CYC04": "non retenue : le vélo est calculé par r5py sur OpenStreetMap (D-002)",
    "VEL01": "retenue (même code)",
    "VEL02": "non retenue : disponibilité en temps réel seulement, aucune prévision possible (D-027, "
             "avertissement « vélo pas forcément disponible »)",
    "GEN01": "retenue (même code)",
    "GEN02": "non intégrée au 04/11 (aucune décision écrite)",
    "GEN03": "non intégrée : citée par le brief, optionnelle, pas intégrée avant le dépôt (donnees-utilisees.md)",
    "GEN04": "retenue (même code)",
    "SOC01": "retenue (même code)",
    "SOC02": "retenue (même code) : lot T1 du plan du 06/11 (docs/plan-contexte-territoire.md), données publiées, affichage prévu "
             "au lot T3 (taux de chômage au lieu de résidence, descriptif)",
    "EMP03": "non retenue (Sirene). Code réattribué à l'enquête BMO 2026 de France Travail",
    "EMP04": "écartée à l'origine (France Travail, offres d'emploi : ce ne sont pas des postes salariés recensés par l'INSEE ; accès "
             "suspendu). Code réattribué aux offres de Choisir le service public (DGAFP), intégrées à part (D-036)",
    "GEO03": "non retenue comme fond de carte (carte miroir en contours GEO01, sans tuiles) ; la page de droits "
             "d'auteur d'OpenStreetMap sert à l'attribution de CYC01",
}

# Pistes écartées ou non retenues sans code (docs/donnees-utilisees.md, docs/decisions.md)
OTHER_CONSIDERED: tuple[tuple[str, str], ...] = (
    ("Barème kilométrique fiscal (coût voiture)", "écarté (D-011) : barème des frais réels, pas un coût de trajet"),
    ("Offres d'emploi", "écartées : postes à pourvoir, pas emplois existants ; Flores (EMP01) répond à la question"),
    ("Horaires réels des salariés", "aucune source ouverte : 3 journées-types présentées comme des scénarios"),
    ("Validations IDFM, quartiers de gare", "cités par le brief, optionnels : pas intégrés avant le dépôt"),
    ("Climat (lignes climatisées, îlots de chaleur)", ("P3 hors MVP ; la climatisation par ligne est étudiée avec "
                                                     "TRA03 (proposition du panneau de preuve)")),
)

# Écran du front déduit du chemin d'un fichier de frontend/src (premier préfixe qui correspond)
SCREENS: tuple[tuple[str, str], ...] = (
    ("components/proof/", "panneau de preuve"),
    ("components/ProofPanel", "panneau de preuve"),
    ("data/proof", "panneau de preuve"),
    ("data/itineraries", "panneau de preuve (itinéraires)"),
    ("components/provenance/", "mode provenance"),
    ("data/provenance", "mode provenance"),
    ("components/SourcesDrawer", "Sources & limites"),
    ("components/Halo", "halo (profil de la commune)"),
    ("components/IncomeRanks", "halo (profil de la commune)"),
    ("data/halo", "halo (profil de la commune)"),
    ("data/incomeRank", "halo (profil de la commune)"),
    ("tour/", "visite guidée"),
    ("poster/", "affiche exportable"),
    ("components/MirrorMap", "carte miroir"),
    ("data/geo", "carte miroir"),
    ("components/CounterBlock", "compteur du ciel"),
    ("components/JobsCounter", "compteur du ciel"),
    ("components/Legend", "légende du ciel"),
    ("components/SkyCredit", "crédits du ciel"),
    ("data/attribution", "crédits du ciel et du panneau (D-060)"),
    ("data/panelCredits", "crédits du ciel et du panneau (D-060)"),
    ("sky/", "ciel"),
)

LICENCE_OBLIGATIONS: dict[str, str] = {
    "odbl": "ODbL : citer la source ; toute base dérivée publiée (nos fichiers de données) reste sous ODbL et le "
            "dit (partage à l'identique)",
    "mobilites": "Licence Mobilités (IDFM, inspirée de l'ODbL) : attribution ; partage à l'identique limité aux "
                 "données de même nature, granularité, période et emprise (communiqué GART et UTP du 08/03/2021) ; "
                 "texte officiel à relire",
    "lo": "Licence Ouverte : mentionner la paternité (producteur) et la date de dernière mise à jour",
    "odc-by": "ODC-BY : attribution",
    "mit": "MIT : conserver l'avis de copyright et le texte de la licence avec toute copie du code (jars R5 corrigés, "
           "jamais publiés par le site)",
    "cgu": "CGU PRIM : accès à l'API par clé personnelle (jamais publiée), quotas respectés",
    "crpa": "régime par défaut des informations publiques (CRPA, art. L321-1 et L322-1) : sans altération ni "
            "dénaturation, source et date de mise à jour citées",
    "cited": "document public cité, aucune licence affichée : citer la source sans reproduire le document",
    "accord": "réutilisation dans la dataviz autorisée par l'organisateur du hackathon (Île-de-France Mobilités, "
              "09/11/2026) à trois conditions : données obtenues par mise à disposition du producteur, jamais par "
              "scraping ; la dataviz ne permet pas de réexporter les données brutes ; le producteur est crédité dans "
              "la dataviz elle-même, à côté de chaque montant. Ne vaut pas licence de redistribution des données",
}
LICENCE_SHORT: dict[str, str] = {
    "odbl": "ODbL", "mobilites": "Licence Mobilités", "lo": "Licence Ouverte", "odc-by": "ODC-BY", "mit": "MIT",
    "cgu": "CGU PRIM", "crpa": "CRPA", "cited": "document cité", "accord": "accord de l'organisateur du hackathon",
}
_TO_CONFIRM = ("à confirmer", "à vérifier", "non indiquée", "aucune licence", "non affichée",
               "version non précisée", "non confirmée")
# Formule écrite par la bascule 06x (starway/licences_attente.py), décision de Nicolas : sans réponse, on écrit ce qui est
# constaté. Tant que 06x n'est pas lancé, aucune ligne du manifeste ne commence par ce texte.
NO_LICENCE_STATED = "licence non précisée par le producteur"
# Accord de l'organisateur du hackathon (D-060, 09/11/2026) écrit dans la colonne licence : la question de la
# réutilisation dans la dataviz est tranchée, la ligne n'est plus « à confirmer » (la suite cite ce qui a été lu).
ORGANIZER_AGREEMENT = "autorisée par l'organisateur du hackathon"


def licence_kinds(text: str) -> list[str]:
    """Familles de licence reconnues dans le texte libre de la colonne `licence` (ordre de LICENCE_OBLIGATIONS)."""
    t = text.lower().strip()
    if t.startswith(("non indiquée", "aucune licence", NO_LICENCE_STATED)):  # la suite décrit ce qui a été cherché
        return (["crpa"] if "crpa" in t else []) + ["cited"]
    found = {
        "odbl": "odbl" in t or "open database license" in t,
        "mobilites": "licence mobilit" in t,
        "lo": "licence ouverte" in t or "open licence" in t or "lov2" in t or "fr-lo" in t,
        "odc-by": "odc-by" in t,
        "mit": "licence mit" in t,
        "cgu": "cgu prim" in t,
        "crpa": "crpa" in t,
        "cited": any(k in t for k in ("page publique", "document public", "documents publics", "acte administratif",
                                      "non indiquée", "aucune licence")),
        "accord": ORGANIZER_AGREEMENT in t,
    }
    return [k for k in LICENCE_OBLIGATIONS if found[k]]


def licence_to_confirm(text: str) -> bool:
    """Vrai si la licence n'est pas établie (le texte du manifeste le dit, ou aucune famille reconnue)."""
    t = text.lower()
    if t.strip().startswith(NO_LICENCE_STATED):  # constat écrit par la bascule 06x : plus rien à attendre de la ligne
        return False
    if ORGANIZER_AGREEMENT in t:  # accord de l'organisateur reçu (D-060) : la suite cite ce qui a été lu
        return False
    return any(k in t for k in _TO_CONFIRM) or not licence_kinds(text)


def clean_text(value: object) -> str:
    """Texte d'une cellule : sans tiret cadratin ni demi-cadratin (règle de l'équipe), espaces normalisés."""
    s = "" if value is None else str(value)
    s = s.replace(chr(0x2014), "-").replace(chr(0x2013), "-")
    return " ".join(s.split())


def group_manifest(rows: Iterable[Mapping[str, str]]) -> dict[str, list[dict[str, str]]]:
    """Lignes du manifeste groupées par code, codes triés, fichiers triés dans chaque code."""
    out: dict[str, list[dict[str, str]]] = {}
    for r in rows:
        out.setdefault(r["source_id"], []).append(dict(r))
    return {k: sorted(v, key=lambda r: r.get("fichier_local", "")) for k, v in sorted(out.items())}


def codes_in_text(text: str) -> set[str]:
    return set(_CODE_RE.findall(text))


def cited_in_json_text(text: str) -> set[str]:
    """Codes cités par les champs JSON dont le nom contient « source » (sauf les URL) : valeur qui commence par un
    code (« COST01 - IDFM, page ... » compte pour COST01), ou liste de codes."""
    found: set[str] = set()
    for key, value in _SOURCE_FIELD_STR.findall(text):
        if "url" in key.lower():
            continue
        m = _CODE_AT_START.match(value)
        if m:
            found.add(m.group(1))
    for key, inner in _SOURCE_FIELD_LIST.findall(text):
        if "url" in key.lower():
            continue
        for item in re.findall(r'"((?:[^"\\]|\\.)*)"', inner):
            m = _CODE_AT_START.match(item)
            if m:
                found.add(m.group(1))
    return found


def published_pattern(rel: PurePosixPath) -> str:
    """`context/93066.json` -> `context/{insee}.json` ; les autres chemins restent tels quels."""
    if rel.stem.isdigit() and len(rel.parts) > 1:
        return str(rel.with_name("{insee}" + rel.suffix))
    return str(rel)


def scan_published(front_data_dir: Path) -> dict[str, set[str]]:
    """Code -> motifs des fichiers publiés (.json, .geojson) qui le citent dans un champ « source »."""
    out: dict[str, set[str]] = {}
    for f in sorted(front_data_dir.rglob("*")):
        if f.suffix not in (".json", ".geojson") or not f.is_file():
            continue
        text = f.read_text(encoding="utf-8")
        if "source" not in text.lower():
            continue
        pattern = published_pattern(PurePosixPath(f.relative_to(front_data_dir).as_posix()))
        for code in cited_in_json_text(text):
            out.setdefault(code, set()).add(pattern)
    return out


_CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs"}
_SKIP_PARTS = {"__pycache__", "node_modules", ".venv", "dist", "tests"}


def scan_code(repo_root: Path, roots: Iterable[str], exclude: Iterable[str] = ()) -> dict[str, set[str]]:
    """Code de source -> fichiers de code (chemins relatifs au dépôt) qui le citent. Tests exclus."""
    skip = set(exclude)
    out: dict[str, set[str]] = {}
    for root in roots:
        base = repo_root / root
        if not base.exists():
            continue
        for f in sorted(base.rglob("*")):
            rel = f.relative_to(repo_root).as_posix()
            if (f.suffix not in _CODE_SUFFIXES or not f.is_file() or rel in skip
                    or _SKIP_PARTS & set(PurePosixPath(rel).parts) or ".test." in f.name):
                continue
            for code in codes_in_text(f.read_text(encoding="utf-8", errors="ignore")):
                out.setdefault(code, set()).add(rel)
    return out


def screen_of(front_rel: str) -> str:
    """`frontend/src/components/proof/ProofCost.tsx` -> « panneau de preuve » ; inconnu -> « autre »."""
    sub = front_rel.removeprefix("frontend/src/")
    for prefix, label in SCREENS:
        if sub.startswith(prefix):
            return label
    return "autre"


@dataclass(frozen=True)
class CatalogueEntry:
    code: str
    title: str
    producer: str
    priority: str
    validation: str
    link: str


def read_catalogue(xlsx: Path) -> list[CatalogueEntry]:
    """Onglet « Catalogue » du référentiel d'origine : une entrée par ligne dont la 1re colonne est un code."""
    import openpyxl

    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    try:
        rows = list(wb["Catalogue"].iter_rows(values_only=True))
    finally:
        wb.close()
    header_idx = next(i for i, r in enumerate(rows) if r and clean_text(r[0]) == "ID")
    header = [clean_text(c) for c in rows[header_idx]]

    def col(name: str) -> int:
        return header.index(name)

    out: list[CatalogueEntry] = []
    for r in rows[header_idx + 1:]:
        code = clean_text(r[0]) if r else ""
        if not re.fullmatch(CODE_PATTERN, code):
            continue
        out.append(CatalogueEntry(
            code, clean_text(r[col("Titre du jeu / service")]), clean_text(r[col("Producteur")]),
            clean_text(r[col("Priorité")]), clean_text(r[col("Statut de validation")]),
            clean_text(r[col("Lien direct / portail officiel")]),
        ))
    return out


def raw_dirs_without_manifest(raw_dirs: Iterable[str], manifest_codes: set[str],
                              pending: Mapping[str, str] = PENDING_MANIFEST) -> tuple[list[str], list[str]]:
    """(dossiers sans ligne de manifeste ni branche annoncée, dossiers en attente d'une branche annoncée)."""
    missing, waiting = [], []
    for d in sorted(raw_dirs):
        if d in manifest_codes:
            continue
        (waiting if d in pending else missing).append(d)
    return missing, waiting


# ----------------------------------------------------------------------------- rendu Markdown
def _cell(value: str) -> str:
    return clean_text(value).replace("|", "\\|") or "-"


def _distinct(rows: list[dict[str, str]], key: str) -> list[str]:
    seen: list[str] = []
    for r in rows:
        v = clean_text(r.get(key, ""))
        if v and v not in seen:
            seen.append(v)
    return seen


def _join(values: Iterable[str], sep: str = " ; ") -> str:
    return sep.join(values) or "-"


@dataclass(frozen=True)
class Usage:
    published: dict[str, set[str]]  # code -> motifs de fichiers publiés
    code: dict[str, set[str]]  # code -> fichiers de code (pipeline et front)


def source_gaps(code: str, rows: list[dict[str, str]]) -> list[str]:
    """Trous d'une source : licence à confirmer, fichier hors data/raw, colonnes vides, statut absent."""
    gaps: list[str] = []
    if any(licence_to_confirm(r.get("licence", "")) for r in rows):
        gaps.append("licence à confirmer")
    if any(not r.get("fichier_local", "").startswith("data/raw/") for r in rows):
        gaps.append("fichier hors data/raw (cache ou dossier)")
    for col, label in (("url_source", "adresse"), ("date_extraction", "date d'extraction"),
                       ("millesime", "millésime"), ("sha256", "empreinte")):
        if any(not r.get(col, "").strip() for r in rows):
            gaps.append(f"{label} vide sur au moins une ligne")
    if code not in SOURCE_INFO:
        gaps.append("statut à renseigner (starway/registry.py)")
    return gaps


TO_FILL = "à renseigner"


def _kinds_of(rows: list[dict[str, str]]) -> list[str]:
    kinds: list[str] = []
    for r in rows:
        kinds += [k for k in licence_kinds(r.get("licence", "")) if k not in kinds]
    return kinds


def _any_to_confirm(rows: list[dict[str, str]]) -> bool:
    return any(licence_to_confirm(r.get("licence", "")) for r in rows)


def _status_key(code: str) -> str:
    return SOURCE_INFO[code].status if code in SOURCE_INFO else TO_FILL


def _render_intro(n_codes: int, n_files: int) -> list[str]:
    return [
        f"<!-- Fichier généré par {GENERATOR} à partir de data/sources_manifest.csv, de starway/registry.py, ",
        f"     du catalogue {CATALOGUE_PATH}, du code et de frontend/public/data/.",
        "     NE PAS MODIFIER À LA MAIN : corriger la source puis relancer le script. 07_quality_checks.py vérifie",
        "     que ce fichier est à jour. -->",
        "",
        "# Référentiel des sources de STARWAY",
        "",
        (f"**{n_codes} sources** (codes) et **{n_files} fichiers** tracés dans "
        "[data/sources_manifest.csv](../data/sources_manifest.csv) (une ligne par fichier : adresse, date "
        "d'extraction, millésime, licence, empreinte sha256). Le texte explicatif (pourquoi chaque donnée, ce "
        "qu'elle dit et ne dit pas) est dans [donnees-utilisees.md](donnees-utilisees.md) ; la méthode dans "
        "[methodologie.md](methodologie.md) ; les limites dans [limites.md](limites.md). Le site affiche les mêmes "
        "sources dans « Sources & limites » (fichier publié `sources.json`, écrit depuis le manifeste)."),
        "",
        "Comment lire ce référentiel :",
        "- **Statut** : " + " ; ".join(f"« {v} »" for v in STATUS_LABELS.values())
        + ". Il est tenu à la main dans `pipeline/starway/registry.py`.",
        "- **Obligations** : déduites du texte de la licence du manifeste (règles de `licence_kinds`).",
        ("- **Où c'est utilisé** : déduit automatiquement. Fichiers publiés = champs « source » des fichiers de "
        "`frontend/public/data/` (`sources.json` cite toutes les sources et n'est pas répété) ; code du front et "
        "pipeline = fichiers qui citent le code de la source, tests exclus (un champ prévu mais pas encore publié "
        "compte aussi : le statut fait foi). Une source d'entrée du calcul (GTFS, "
        "OpenStreetMap, carreaux) n'est citée par aucun champ : ses résultats sont publiés sous forme de temps de "
        "trajet."),
        "",
    ]


def _render_summary(groups: dict[str, list[dict[str, str]]]) -> list[str]:
    lines = ["## Récapitulatif", "",
             "| Code | Producteur | Source | Licence | Millésime | Statut | Fichiers |",
             "|---|---|---|---|---|---|---|"]
    for code, rows in groups.items():
        info = SOURCE_INFO.get(code)
        lic = " + ".join(LICENCE_SHORT[k] for k in _kinds_of(rows)) or "non reconnue"
        if _any_to_confirm(rows):
            lic += " (à confirmer)"
        status = STATUS_LABELS.get(info.status, info.status) if info else TO_FILL
        lines.append(
            f"| [{code}](#{code.lower()}) | {_cell(info.producer if info else '')} | "
            f"{_cell(info.name if info else rows[0].get('titre', ''))} | {_cell(lic)} | "
            f"{_cell(rows[0].get('millesime', ''))} | {_cell(status)} | {len(rows)} |"
        )
    counts: dict[str, int] = {}
    for code in groups:
        counts[_status_key(code)] = counts.get(_status_key(code), 0) + 1
    lines += ["", "Par statut : " + " ; ".join(
        f"{STATUS_LABELS.get(k, k)} : {counts[k]}" for k in [*STATUS_LABELS, TO_FILL] if k in counts) + ".", ""]
    return lines


def _render_usage(code: str, usage: Usage) -> list[str]:
    pub = sorted(p for p in usage.published.get(code, set()) if p != "sources.json")
    files = sorted(usage.code.get(code, set()))
    front = [f for f in files if f.startswith("frontend/")]
    pipe = [f for f in files if f.startswith("pipeline/")]
    screens = sorted({screen_of(f) for f in front})
    pub_txt = _join(f"`{p}`" for p in pub) if pub else "aucun champ « source »"
    front_txt = _join(screens) if screens else "aucun fichier du front ne la cite"
    pipe_txt = _join(f"`{PurePosixPath(p).name}`" for p in pipe) if pipe else "aucun fichier du pipeline ne la cite"
    return [
        "- **Où c'est utilisé** :",
        f"  - fichiers publiés qui la citent : {pub_txt}",
        f"  - code du front qui la cite (écran déduit du chemin) : {front_txt}",
        f"  - pipeline : {pipe_txt}",
    ]


def _render_fiche(code: str, rows: list[dict[str, str]], usage: Usage) -> list[str]:
    info = SOURCE_INFO.get(code)
    title = clean_text(info.name) if info else clean_text(rows[0].get("titre", ""))
    lines = [f"### {code}", "", f"**{title}**" + (f" ({clean_text(info.producer)})" if info else ""), ""]
    status_txt = (f"{STATUS_LABELS.get(info.status, info.status)} : {clean_text(info.note)}" if info
                  else "à renseigner dans pipeline/starway/registry.py")
    obligations = [LICENCE_OBLIGATIONS[k] for k in _kinds_of(rows)]
    if _any_to_confirm(rows):
        obligations.append("licence à confirmer (voir la colonne licence du manifeste)")
    lines += [
        f"- **Statut** : {status_txt}",
        f"- **Licence (manifeste)** : {_join(_distinct(rows, 'licence'))}",
        f"- **Obligations** : {_join(obligations)}",
        f"- **Millésime** : {_join(_distinct(rows, 'millesime'))}",
        f"- **Date d'extraction** : {_join(_distinct(rows, 'date_extraction'), ', ')}",
    ]
    service = _distinct(rows, "date_service_transport")
    if service:
        lines.append(f"- **Date de service transport** : {_join(service)}")
    geo = _distinct(rows, "geographie")
    lines += [
        f"- **Granularité et géographie** : {_join(_distinct(rows, 'granularite'))}"
        + (f" ; {_join(geo)}" if geo else ""),
        f"- **Ce qu'on en fait** : {_join(_distinct(rows, 'traitements'))}",
        f"- **Contrôles** : {_join(_distinct(rows, 'controles'))}",
        f"- **Limites** : {_join(_distinct(rows, 'limites'))}",
        *_render_usage(code, usage),
    ]
    gaps = source_gaps(code, rows)
    if gaps:
        lines.append(f"- **À vérifier** : {_join(gaps)}")
    lines += ["", "| Fichier | Titre | Adresse | sha256 (début) |", "|---|---|---|---|"]
    lines += [f"| `{_cell(r.get('fichier_local', ''))}` | {_cell(r.get('titre', ''))} | "
              f"{_cell(r.get('url_source', ''))} | `{_cell(r.get('sha256', '')[:12])}` |" for r in rows]
    return [*lines, ""]


def _render_gaps(groups: dict[str, list[dict[str, str]]]) -> list[str]:
    lines = ["## Points à vérifier", ""]
    gap_lines = [f"- [{code}](#{code.lower()}) : {_join(gaps)}"
                 for code, rows in groups.items() if (gaps := source_gaps(code, rows))]
    lines += gap_lines or ["- aucun"]
    if PENDING_MANIFEST:
        lines += ["", ("Dossiers de `data/raw/` dont la ligne de manifeste arrive par une autre branche "
                      "(liste `PENDING_MANIFEST`) :"), ""]
        for code, branch in sorted(PENDING_MANIFEST.items()):
            state = "ligne présente, entrée à retirer" if code in groups else "en attente"
            lines.append(f"- {code} : branche `{branch}` ({state})")
    return lines


def _render_catalogue(catalogue: list[CatalogueEntry]) -> list[str]:
    reassigned = sum("Code réattribué" in CATALOGUE_FOLLOWUP.get(e.code, "") for e in catalogue)
    name = PurePosixPath(CATALOGUE_PATH).name
    lines = [
        "",
        "## Sources prévues par le référentiel d'origine",
        "",
        (f"Onglet « Catalogue » de [{name}](reference/{name}) "
        f"(référentiel de l'équipe avant la production). **{reassigned} codes ont été réattribués** depuis à une "
        "autre source (colonne « Devenir ») : le code du catalogue ne désigne pas toujours la même donnée que le "
        "manifeste."),
        "",
        "| Code du catalogue | Source prévue | Producteur | Priorité | Devenir |",
        "|---|---|---|---|---|",
    ]
    lines += [f"| {e.code} | {_cell(e.title)} | {_cell(e.producer)} | {_cell(e.priority)} | "
              f"{_cell(CATALOGUE_FOLLOWUP.get(e.code, 'devenir à renseigner'))} |" for e in catalogue]
    lines += ["", "Autres pistes écartées ou non retenues, sans code :", ""]
    lines += [f"- {n} : {why}" for n, why in OTHER_CONSIDERED]
    return lines


SERVICES_SECTION: tuple[str, ...] = (
    "",
    "## Hors fichiers : services et logiciels",
    "",
    ("- **OpenStreetMap** : la donnée est CYC01 (fichier tracé) ; l'attribution « © les contributeurs "
    "d'OpenStreetMap » est affichée par le site."),
    ("- **API PRIM IDFM Navitia** : TRA02 (requêtes journeys et connections ; réponses gardées en cache local, non "
    "versionné ; clé jamais écrite)."),
    ("- **Azure AI Speech** : service qui génère la voix de la visite guidée (aucune donnée affichée n'en vient) : "
    "voir le [README](../README.md), § 5 « Stack technique », « Visite guidée narrée »."),
    ("- **Logiciels et bibliothèques** (r5py, R5, pandas, PixiJS, D3, etc.) : registre de la stack, versions et "
    "licences dans le [README](../README.md), § 5 « Stack technique »."),
    "",
)


def render(manifest_rows: list[dict[str, str]], usage: Usage, catalogue: list[CatalogueEntry]) -> str:
    """Contenu de docs/sources.md (déterministe : mêmes entrées, même texte)."""
    groups = group_manifest(manifest_rows)
    lines = _render_intro(len(groups), sum(len(v) for v in groups.values()))
    lines += _render_summary(groups)
    lines += ["## Fiches", ""]
    for code, rows in groups.items():
        lines += _render_fiche(code, rows, usage)
    lines += _render_gaps(groups)
    lines += _render_catalogue(catalogue)
    lines += SERVICES_SECTION
    return "\n".join(lines)
