"""Registre des sources, téléchargement et manifest de traçabilité (data/sources_manifest.csv)."""

from __future__ import annotations

import csv
import hashlib
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import requests

from starway.config import MANIFEST_PATH, RAW_DIR, REPO_ROOT

MANIFEST_COLUMNS = [
    "source_id", "titre", "url_source", "date_extraction", "millesime", "date_service_transport",
    "licence", "granularite", "geographie", "fichier_local", "sha256", "traitements", "controles", "limites",
]

GEO_FIELDS = "code,nom,codeDepartement,codeRegion,population,centre,surface"
USER_AGENT = "STARWAY-pipeline/0.1 (Hackathon Mobilites 2026 IDFM)"


@dataclass(frozen=True)
class Source:
    """Une ressource téléchargeable. `meta` = colonnes du manifest renseignées à la main (vérifiées)."""

    source_id: str
    url: str
    filename: str
    meta: dict[str, str] = field(default_factory=dict)
    user_agent: str | None = None  # certains sites (IDFM) refusent les clients non navigateurs
    # Adresse officielle vivante écrite dans `url_source` quand l'adresse de téléchargement (`url`, provenance du
    # fichier archivé) ne répond plus : relevé des liens du 09/11/2026 (docs/verif-liens-sources.md).
    public_url: str | None = None

    @property
    def manifest_url(self) -> str:
        """Adresse citée dans `url_source` du manifeste (lien cliquable du mode sources)."""
        return self.public_url or self.url

    @property
    def local_path(self) -> Path:
        return RAW_DIR / self.source_id / self.filename


_INSEE_FLORES_PAGE = "https://www.insee.fr/fr/statistiques/8266010"
_FLORES_COMMON = {
    "titre": "INSEE Flores - Nombre d'établissements et effectifs salariés fin 2023",
    "millesime": "2023 (postes salariés présents la dernière semaine de décembre 2023)",
    "licence": "Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)",
    "granularite": "commune / arrondissement municipal × secteur × tranche d'effectifs",
    "limites": (
        "Postes salariés recensés par l'INSEE au lieu de travail, PAS des offres d'emploi ; données communales non "
        "expertisées par l'INSEE (privilégier des agrégats de plusieurs milliers de postes) ; secret "
        "statistique possible ; comparaison entre millésimes non garantie"
    ),
}

_RP_COMMON = {
    "millesime": "RP 2023 (enquêtes annuelles de recensement 2021 à 2025)",
    "licence": "Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)",
    "geographie": "communes (COM) et arrondissements municipaux (ARM) : les 1 286 codes IDF sont identiques à GEO01 2026 (contrôle bloquant du pipeline)",
    "limites": "Estimations du recensement : imprécises pour les petites communes et les petits effectifs ; aucune causalité",
}

GEO01_LICENCE = (
    "ODbL 1.0 : jeu Etalab « Contours administratifs » (data.gouv.fr), « utilisé par l'API Découpage "
    "Administratif », constitué à partir d'IGN ADMIN EXPRESS (Licence Ouverte 2.0) ; attribution et partage à "
    "l'identique des bases dérivées (ex. geo/*.geojson)"
)

SOURCES: tuple[Source, ...] = (
    Source(
        "GEO01",
        "https://geo.api.gouv.fr/communes?codeRegion=11&fields=" + GEO_FIELDS + ",contour&format=json",
        "communes_idf.json",
        {
            "titre": "API Géo - communes de la région Île-de-France (contours, centre, population)",
            "millesime": "géographie (COG) en vigueur à la date d'extraction",
            "licence": GEO01_LICENCE,
            "granularite": "commune",
            "geographie": "COG en vigueur à la date d'extraction (2026)",
            "traitements": "filtre départements 75/77/78/91/92/93/94/95 ; Paris 75056 remplacé par ses 20 arrondissements",
            "controles": "nombre de communes, codes uniques, géométries valides",
            "limites": "Le centre de la commune n'est pas un lieu de domicile ; population = population légale servie par l'API",
        },
    ),
    Source(
        "GEO01",
        "https://geo.api.gouv.fr/communes?codeDepartement=75&type=arrondissement-municipal&fields="
        + GEO_FIELDS + ",contour&format=json",
        "arrondissements_paris.json",
        {
            "titre": "API Géo - arrondissements municipaux de Paris (contours, centre, population)",
            "millesime": "géographie (COG) en vigueur à la date d'extraction",
            "licence": GEO01_LICENCE,
            "granularite": "arrondissement municipal",
            "geographie": "COG en vigueur à la date d'extraction (2026)",
            "traitements": "les 20 arrondissements servent d'origines à la place de 75056",
            "controles": "20 arrondissements 75101..75120",
            "limites": "Le centre de l'arrondissement n'est pas un lieu de domicile",
        },
    ),
    Source(
        "GEO01",
        "https://geo.api.gouv.fr/communes_associees_deleguees?codeRegion=11&format=json",
        "communes_associees_deleguees_idf.json",
        {
            "titre": "API Géo - communes associées et déléguées d'Île-de-France (rattachement au chef-lieu)",
            "millesime": "géographie (COG) en vigueur à la date d'extraction",
            "licence": GEO01_LICENCE,
            "granularite": "commune associée / déléguée",
            "geographie": "COG en vigueur à la date d'extraction (2026)",
            "traitements": "table de passage ancien code -> code 2026 (chefLieu) pour les sources en géographie antérieure",
            "controles": "tout code source absent de la géographie 2026 doit être résolu, sinon échec",
            "limites": "ne couvre que les fusions avec communes associées/déléguées ; une scission ne serait pas détectée",
        },
    ),
    Source(
        "GEO01",
        "https://geo.api.gouv.fr/communes?codeRegion=11&fields=code,nom,codeDepartement,centre,mairie&format=json",
        "communes_idf_mairie.json",
        {
            "titre": "API Géo - position de la mairie des communes d'Île-de-France (champ mairie)",
            "millesime": "géographie (COG) en vigueur à la date d'extraction",
            "licence": GEO01_LICENCE,
            "granularite": "commune (un point)",
            "geographie": "COG en vigueur à la date d'extraction (2026)",
            "traitements": "analyse des points d'origine ; pas encore utilisé par le calcul",
            "controles": "un point par commune",
            "limites": "La mairie n'est pas un lieu de domicile ; position IGN ADMIN EXPRESS",
        },
    ),
    Source(
        "GEO01",
        "https://geo.api.gouv.fr/communes?codeDepartement=75&type=arrondissement-municipal"
        "&fields=code,nom,centre,mairie&format=json",
        "arrondissements_paris_mairie.json",
        {
            "titre": "API Géo - position de la mairie des arrondissements de Paris (champ mairie)",
            "millesime": "géographie (COG) en vigueur à la date d'extraction",
            "licence": GEO01_LICENCE,
            "granularite": "arrondissement municipal (un point)",
            "geographie": "COG en vigueur à la date d'extraction (2026)",
            "traitements": "analyse des points d'origine",
            "controles": "20 arrondissements",
            "limites": "Les 1er à 4e arrondissements partagent la mairie de Paris Centre (même point)",
        },
    ),
    Source(
        "GEO02",
        "https://www.insee.fr/fr/statistiques/fichier/8735162/Filosofi2021_carreaux_200m_csv.zip",
        "Filosofi2021_carreaux_200m_csv.zip",
        {
            "titre": "INSEE Filosofi 2021 - données au carreau de 200 m (y compris données imputées), csv",
            "millesime": "revenus 2021, publié le 12/02/2026 (page 8735162)",
            "licence": "Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)",
            "granularite": "carreau de 200 m (grille Inspire, EPSG:3035)",
            "geographie": "France métropolitaine, Martinique, La Réunion ; lcog_geo en COG 2021 (non utilisé : "
                          "rattachement spatial aux contours GEO01 2026)",
            "traitements": "point d'origine du routage : centre de gravité de la population (ind) par "
                           "commune 2026, ou carreau habité le plus proche ; carreaux d'Île-de-France lus par "
                           "morceaux",
            "controles": "somme de ind par commune comparée à la population légale",
            "limites": "carreaux de moins de 11 ménages fiscaux imputés (i_est_200 = 1) ; un carreau à cheval sur "
                       "deux communes est rattaché à celle qui contient son centre ; population des ménages fiscaux "
                       "(hors communautés)",
        },
    ),
    Source(
        "GEO02",
        "https://www.insee.fr/fr/statistiques/8735162",
        "page-8735162.html",
        {
            "titre": "INSEE - page « Données au carreau de 200m (y compris données imputées) » (instantané HTML, "
                     "documentation et dictionnaire des variables)",
            "millesime": "Filosofi 2021",
            "licence": "Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)",
            "granularite": "documentation",
            "traitements": "définitions des variables idcar_200m, ind, i_est_200, lcog_geo",
            "limites": "instantané d'une page web à la date d'extraction, la page a pu changer depuis ; documentation "
                       "seulement : aucune valeur publiée n'en vient",
        },
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    ),
    Source(
        "EMP01",
        "https://www.insee.fr/fr/statistiques/fichier/8266010/DS_FLORES_2023_CSV_FR.zip",
        "DS_FLORES_2023_CSV_FR.zip",
        {
            **_FLORES_COMMON,
            "geographie": "communes (COM) et arrondissements municipaux (ARM) ; géographie postérieure au 1/1/2025 (Pierrefitte-sur-Seine 93059 déjà fusionnée dans Saint-Denis 93066) : les 1 266 codes IDF sont identiques à ceux de GEO01 (2026), contrôle automatique du pipeline",
            "traitements": "fichier DS_FLORES_A5_2023_data.csv filtré : ACTIVITY=_T, NUMBER_EMPL=_T, LEGAL_FORM_WITH_PUBLIC=1T9X7 (ensemble hors particuliers employeurs), FLORES_MEASURE=EMPL3112 (postes présents la dernière semaine de décembre), GEO_OBJECT=COM (+ARM pour Paris) ; agrégation en pôles disjoints",
            "controles": "codes communes présents dans GEO01 ; pôles disjoints ; somme pôle = somme communes",
        },
    ),
    Source(
        "EMP01",
        "https://www.insee.fr/fr/statistiques/fichier/8266010/aide_lecture_flores.zip",
        "aide_lecture_flores.zip",
        {**_FLORES_COMMON, "titre": "INSEE Flores - aide à la lecture (documentation)", "geographie": "",
         "traitements": "documentation, aucune donnée utilisée", "controles": "",
         "limites": "documentation seulement : aucune valeur publiée n'en vient ; elle sert à lire le fichier des postes "
                    "salariés (EMP01)"},
    ),
    Source(
        "EMP01",
        "https://www.insee.fr/fr/statistiques/fichier/8266010/table_passage_flores.zip",
        "table_passage_flores.zip",
        {**_FLORES_COMMON, "titre": "INSEE Flores - table de passage anciennes / nouvelles dimensions",
         "geographie": "", "traitements": "documentation des codes de modalités", "controles": "",
         "limites": "documentation seulement : aucune valeur publiée n'en vient ; elle sert à lire les codes de modalités "
                    "du fichier des postes salariés (EMP01)"},
    ),
    # --- Contexte communal (étape 05) -----------------------------------------------------------
    Source(
        "GEN04",
        "https://www.insee.fr/fr/statistiques/fichier/9006235/DS_RP_TD_POPULATION_AGESEX_PRINC_2023_CSV_FR.zip",
        "DS_RP_TD_POPULATION_AGESEX_PRINC_2023_CSV_FR.zip",
        {**_RP_COMMON, "titre": "INSEE RP 2023 - Population par sexe et âge (POP1, exploitation principale)",
         "granularite": "commune / arrondissement municipal × sexe × âge",
         "traitements": "parts par sexe et par tranche d'âge (0-14, 15-29, 30-44, 45-59, 60-74, 75+) de la population",
         "controles": "somme des parts = 100 % ; total = somme des modalités"},
    ),
    Source(
        "GEN04",
        "https://www.insee.fr/fr/statistiques/fichier/9005956/Aide_lecture_rp_population.pdf",
        "Aide_lecture_rp_population.pdf",
        {**_RP_COMMON, "titre": "INSEE RP 2023 - aide à la lecture des fichiers population (documentation)",
         "traitements": "documentation, aucune donnée utilisée"},
    ),
    Source(
        "GEN01",
        "https://www.insee.fr/fr/statistiques/fichier/9004421/DS_RP_TD_NAVETTES_SEXTRANSPORT_COMP_2023_CSV_FR.zip",
        "DS_RP_TD_NAVETTES_SEXTRANSPORT_COMP_2023_CSV_FR.zip",
        {**_RP_COMMON, "titre": "INSEE RP 2023 - Actifs occupés selon le sexe et le mode de transport domicile-travail (NAV2A/NAV2B)",
         "granularite": "commune / arrondissement municipal × sexe × mode de transport",
         "traitements": "parts des modes (TC, voiture, vélo, marche, autres) parmi les actifs occupés résidents de chaque sexe",
         "controles": "somme des parts = 100 % par sexe ; effectif minimal par sexe"},
    ),
    Source(
        "GEN01",
        "https://www.insee.fr/fr/statistiques/fichier/8992172/Aide_lecture_rp_activite_navettes.pdf",
        "Aide_lecture_rp_activite_navettes.pdf",
        {**_RP_COMMON, "titre": "INSEE RP 2023 - aide à la lecture des fichiers activité / navettes (documentation)",
         "traitements": "documentation, aucune donnée utilisée"},
    ),
    Source(
        "GEN01",
        "https://www.insee.fr/fr/statistiques/fichier/2383177/fiche-precision.pdf",
        "fiche-precision.pdf",
        {**_RP_COMMON, "titre": "INSEE - fiche « La précision des résultats du recensement » (documentation)",
         "traitements": "règle de diffusion des petits effectifs appliquée aux parts modales (voir la méthodologie)"},
    ),
    Source(
        "SOC01",
        "https://www.insee.fr/fr/statistiques/fichier/8984752/FILOSOFI_CC_csv.zip",
        "FILOSOFI_CC_csv.zip",
        {"titre": "INSEE Filosofi 2023 - Indicateurs sur les revenus et la pauvreté au niveau local",
         "millesime": "2023 (revenus déclarés 2023)",
         "licence": "Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)",
         "granularite": "commune / arrondissement municipal",
         "geographie": "communes (COM) et arrondissements municipaux (ARM) : les 1 286 codes IDF sont identiques à GEO01 2026 (contrôle bloquant du pipeline)",
         "traitements": "niveau de vie médian (€/an) et taux de pauvreté au seuil de 60 % (%)",
         "controles": "valeurs absentes = secret statistique (status secret)",
         "limites": "Indicateurs descriptifs, aucune causalité avec l'accessibilité ; secret statistique pour les petites communes"},
    ),
    Source(
        "SOC01",
        "https://www.insee.fr/fr/statistiques/fichier/8984752/Note_accompagnement_Filosofi_2023.pdf",
        "Note_accompagnement_Filosofi_2023.pdf",
        {"titre": "INSEE Filosofi 2023 - note d'accompagnement (documentation)", "millesime": "2023",
         "licence": "Licence Ouverte / Open Licence Etalab 2.0", "traitements": "documentation, aucune donnée utilisée",
         "limites": "documentation seulement : aucune valeur publiée n'en vient"},
    ),
    Source(
        "EMP02",
        "https://www.insee.fr/fr/statistiques/fichier/8998300/base-flux-mobilite-domicile-lieu-travail-2023_csv.zip",
        "base-flux-mobilite-domicile-lieu-travail-2023_csv.zip",
        {**_RP_COMMON, "titre": "INSEE RP 2023 - Mobilités professionnelles : flux domicile - lieu de travail",
         "granularite": "couple commune de résidence × commune de travail",
         "traitements": "flux des actifs occupés résidents vers les communes de chaque pôle, part des actifs occupés "
                        "résidents ; exportés dans context/{insee}.json (flows_to_poles) avec la mention de précision "
                        "INSEE (flux < 200 : ordre de grandeur) ; aide au choix des communes du récit",
         "controles": "codes communes contre GEO01 2026 ; part = flux / somme des flux sortants de la commune",
         "limites": "Flux issus du RP (estimations sur 5 enquêtes annuelles) ; flux de moins de 200 à considérer "
                    "comme des ordres de grandeur (INSEE) ; navettes déclarées, ne mesure pas l'accessibilité et "
                    "n'en est pas la cause"},
    ),
    Source(
        "EMP02",
        "https://www.insee.fr/fr/statistiques/fichier/8998300/fiche-depl-dom-travail.pdf",
        "fiche-depl-dom-travail.pdf",
        {**_RP_COMMON, "titre": "INSEE RP 2023 - fiche descriptive des flux domicile - lieu de travail (documentation)",
         "traitements": "documentation, aucune donnée utilisée"},
    ),
    Source(
        "EMP02",
        "https://www.insee.fr/fr/statistiques/8998300",
        "page-8998300.html",
        {**_RP_COMMON, "titre": "INSEE - page de diffusion « Mobilités professionnelles en 2023 : déplacements "
                                "domicile - lieu de travail » (instantané HTML, documentation)",
         "granularite": "documentation",
         "traitements": "règle de précision citée et appliquée aux flux vers les pôles : « compte tenu notamment du "
                        "sondage, les flux faibles (moins de 200) devront être considérés comme des ordres de "
                        "grandeur »",
         "controles": "la phrase citée doit figurer dans l'instantané (contrôle bloquant du pipeline)",
         "limites": "page publiée le 25/06/2026 ; le CSV contient l'ensemble des flux (le XLSX seulement ceux > 100)"},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    ),
    Source(
        "COST01",
        "https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-mois",
        "forfait-navigo-mois.html",
        {"titre": "IDFM - page tarifaire du forfait Navigo Mois (instantané HTML)",
         "millesime": "tarifs applicables au 1er janvier 2026 (mention de la page)",
         "licence": "page publique IDFM, citée comme source d'un tarif (aucune réutilisation de contenu)",
         "granularite": "tarif régional", "geographie": "Île-de-France",
         "traitements": "forfait Navigo Mois toutes zones (90,80 €) reporté dans le code du pipeline et vérifié à la construction du contexte ; "
                        "aucun coût voiture n'est estimé (barème kilométrique fiscal écarté)",
         "controles": "le montant et la phrase « Tarifs du forfait applicables au 1er janvier 2026 » doivent figurer "
                      "dans l'instantané HTML (contrôle bloquant du pipeline)",
         "limites": "Tarif plein ; forfaits zonés moins chers (2-3, 3-4, 4-5), tarifs réduits et prise en charge "
                    "employeur (50 %) non modélisés ; identique pour toutes les communes"},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    ),
    Source(
        "TRA01",
        "https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip",
        "IDFM-gtfs.zip",
        {
            "titre": "IDFM - Horaires prévus sur les lignes de TC d'Île-de-France (GTFS Datahub, jeu offre-horaires-tc-gtfs-idfm)",
            "millesime": "offre prévue sur les 30 jours suivant la date d'extraction (mise à jour 3 fois par jour)",
            "licence": "Licence Mobilités (IDFM) - https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm",
            "granularite": "arrêt / course",
            "geographie": "Île-de-France",
            "date_service_transport": "2026-11-17 (mardi ordinaire, 139 563 courses actives)",
            "traitements": "aucun (entrée directe de r5py)",
            "controles": "date de service comprise dans calendar / calendar_dates",
            "limites": "Offre théorique (ni retards ni perturbations) ; validité ~30 jours glissants",
        },
    ),
    Source(
        "CYC01",
        "https://download.geofabrik.de/europe/france/ile-de-france-latest.osm.pbf",
        "ile-de-france-latest.osm.pbf",
        {
            "titre": "OpenStreetMap - extrait Île-de-France (Geofabrik)",
            "millesime": "extrait du jour indiqué dans l'URL résolue",
            "licence": "ODbL 1.0 - © les contributeurs d'OpenStreetMap",
            "granularite": "réseau viaire",
            "geographie": "Île-de-France",
            "traitements": "aucun (entrée directe de r5py : marche, vélo, voiture)",
            "controles": "build du réseau r5py",
            "limites": "Pas de trafic routier (voiture sans congestion) ; qualité OSM variable",
        },
    ),
    Source(
        "VEL01",
        "https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_information.json",
        "station_information.json",
        {
            "titre": "Vélib' Métropole - localisation et caractéristiques des stations (flux GBFS station_information)",
            "millesime": "instantané du flux à la date d'extraction (horodatage lastUpdatedOther dans le fichier)",
            "licence": "ODbL 1.0 (Open Data Commons Open Database License), licence déclarée sur data.gouv.fr pour le "
                       "jeu « Vélib' - Localisation et caractéristique des stations » (diffuseur Ville de Paris, "
                       "créateur Autolib Vélib' Métropole) dont ce flux est une ressource",
            "granularite": "station (position, capacité déclarée)",
            "geographie": "zone de service Vélib' Métropole",
            "traitements": "comptage de couverture ; temps Vélib' (marche, vélo, marche) calculés par le pipeline et publiés "
                           "dans le mode Vélib' du site",
            "controles": "stations jointes aux contours GEO01 des 1 285 origines",
            "limites": "Positions et capacités seulement : aucune information sur la disponibilité d'un vélo ou "
                       "d'une place à une heure donnée (station_status est un instantané temps réel) ; temps "
                       "Vélib' publiés seulement pour les 88 origines qui ont au moins une station",
        },
    ),
    # --- D-029 (demande de Nicolas du 03/11) : voiture avec trafic moyen DiRIF, coût par véhicule ---------------
    Source(
        "ROAD01",
        "https://www.dir.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/barometre_mensuel_no41-_novembre_2025.pdf",
        "barometre_mensuel_no41-_novembre_2025.pdf",
        {"titre": "DRIEAT Île-de-France, DiRIF - Baromètre trafic mensuel de la circulation, novembre 2025 (n° 41), "
                  "page 2 « Temps de parcours les jours ouvrés »",
         "millesime": "novembre 2025 (jours ouvrés, hors week-ends et jours fériés)",
         "licence": "licence ouverte Etalab 2.0 d'après la mention du pied de page du site (« Sauf mention "
                    "contraire, tous les contenus de ce site sont sous licence etalab-2.0 », relevée le 05/11/2026, "
                    "page ROAD01 gardée) : licence déduite d'une mention de pied de page, pas d'une page de mentions "
                    "légales lisible (la page « Mentions légales » du site renvoie une erreur, 05/11/2026) ; le PDF "
                    "lui-même n'affiche aucune licence ; licence à confirmer",
         "granularite": "moyenne mensuelle, 3 périodes horaires (6h-10h, 10h-16h, 16h-20h)",
         "geographie": "voies structurantes du réseau routier national non concédé d'Île-de-France (ex. A86, A1, "
                       "N118, N104), hors boulevard périphérique et axes bidirectionnels",
         "traitements": "indices lus sur le graphique mensuel de la page 2 (image JPEG, numérisée par pixels : "
                        "graduations détectées, centre du trait par couleur), arrondis à 0,01 : 6h-10h 1,75 ; "
                        "10h-16h 1,39 ; 16h-20h 1,95 ; reportés dans le code du pipeline et publiés dans les "
                        "données du site",
         "controles": "relecture du 03/11 au soir sur cette copie : 1,744 à 1,760 ; 1,383 à 1,387 ; 1,951 à 1,955 "
                      "selon la colonne de pixels ; concordance avec la moyenne des barres journalières (écart <= "
                      "0,012) et avec les numéros de décembre 2025 et juillet 2026 (écart <= 0,006)",
         "limites": "valeurs lues sur un graphique (± 0,02), la DiRIF ne publie pas les nombres ; moyenne sur 4 h, "
                    "un mois et tout le réseau ; voies rapides seulement ; aucune mesure avant 6h ni après 20h ; "
                    "pondération des tronçons non publiée ; l'appliquer à tout un trajet est un choix de l'équipe, "
                    "pas une mesure"},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    ),
    Source(
        "ROAD01",
        "https://www.dir.ile-de-france.developpement-durable.gouv.fr/barometre-trafic-mensuel-de-la-circulation-annee-a1804.html?lang=fr",
        "barometre_mensuel_page-liste-2025.html",
        {"titre": "DRIEAT Île-de-France, DiRIF - page « Baromètre trafic mensuel de la circulation - Année 2025 » "
                  "(liste des numéros, pied de page : licence du site), instantané HTML",
         "millesime": "page consultée le 05/11/2026 (liste des numéros de l'année 2025)",
         "licence": "pied de page du site : « Sauf mention contraire, tous les contenus de ce site sont sous licence "
                    "etalab-2.0 » (lien vers le texte de la Licence Ouverte, github.com/etalab/licence-ouverte) ; "
                    "niveau de preuve : mention de pied de page, pas une page de mentions légales lisible ; "
                    "licence à confirmer",
         "granularite": "page web (liste de fichiers PDF)", "geographie": "Île-de-France",
         "traitements": "aucun chiffre repris : la page prouve seulement le numéro et l'adresse du PDF utilisé (lien « "
                        "Baromètre trafic mensuel de la circulation - Novembre 2025 », IMG/pdf/barometre_mensuel_no41-_"
                        "novembre_2025.pdf, 1.7 Mio) et la mention de licence du pied de page",
         "controles": "le lien « Mentions légales » du pied de page (mentions-legales-a1546.html) répond 200 avec un "
                      "corps de 15 octets (« <!-- Erreur --> ») le 05/11/2026 : page cassée, aucune mention légale lisible",
         "limites": "la mention « sauf mention contraire » vaut pour les contenus du site, pas pour une mention "
                    "propre au PDF (le PDF n'en affiche aucune) ; la licence est donc déduite, non établie par un "
                    "texte de mentions légales"},
    ),
    Source(
        "COST06",
        "https://particulier.edf.fr/content/dam/2-Actifs/Documents/Offres/Grille_prix_Tarif_Bleu.pdf",
        "Grille_prix_Tarif_Bleu.pdf",
        {"titre": "EDF - Grille de prix de l'offre de fourniture d'électricité « Tarif Bleu », clients particuliers, "
                  "applicable au 1er août 2026",
         "millesime": "tarif applicable au 1er août 2026 (mention du document) ; mouvement proposé par la CRE, "
                      "délibération n° 2026-147 du 15/07/2026",
         "licence": "document public d'EDF (tarif réglementé fixé par les pouvoirs publics), cité comme source d'un "
                    "prix ; licence à confirmer",
         "granularite": "prix du kWh par option et puissance souscrite",
         "geographie": "France métropolitaine continentale",
         "traitements": "Option Base (TTC), 3 et 6 kVA : 20,01 cts € TTC/kWh, soit 0,2001 €/kWh, reporté dans "
                        "le code du pipeline (voiture électrique)",
         "controles": "valeur relue dans le texte de la page 1 de cette copie le 03/11 (lignes « 3 12,13 20,01 » et "
                      "« 6 15,86 20,01 ») ; empreinte vérifiée par les contrôles du pipeline ; page 2 relue le 05/11 : l'accise est de "
                      "3,062 cts €/kWh HTVA et la TVA de 20 % sur les consommations : (13,61 + 3,062) x 1,20 = "
                      "20,006, donc le prix TTC est cohérent avec les 13,61 c€ hors taxes indiqués par l'équipe (voir "
                      "la ligne COST06 du Journal officiel) ; l'écart HT/TTC s'explique par l'accise et la TVA, pas "
                      "par un désaccord",
         "limites": "prix au tarif réglementé, option Base, abonnement non compris ; option Heures creuses, offres "
                    "de marché et recharge sur borne publique non couvertes ; choisir l'option Base est un choix de "
                    "l'équipe ; l'URL est stable mais le contenu change à chaque mouvement tarifaire"},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    ),
    Source(
        "COST06",
        "https://www.cre.fr/fileadmin/Documents/Deliberations/2026/260715_2026-147_TRVE.pdf",
        "260715_2026-147_TRVE.pdf",
        {"titre": "CRE - Délibération n° 2026-147 du 15 juillet 2026 portant proposition des tarifs réglementés de "
                  "vente d'électricité",
         "millesime": "15/07/2026 (mouvement au 1er août 2026)",
         "licence": "acte administratif publié, cité",
         "granularite": "évolution des tarifs (hors taxes), accise",
         "geographie": "France métropolitaine continentale et zones non interconnectées",
         "traitements": "aucun : cité comme acte à l'origine du mouvement tarifaire de la grille EDF",
         "controles": "accise « de 30,85 €/MWh à 30,62 €/MWh », cohérente avec les 3,062 cts €/kWh de la grille EDF",
         "limites": "la délibération n'imprime pas la grille TTC (annexes B1 à B4 non incluses dans ce PDF) ; l'acte qui "
                    "fixe le tarif est la décision du 29/07/2026 (JORF n° 0177 du 31/07/2026, texte n° 33, "
                    "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470, 403 au robot le 05/11), dont les "
                    "articles sont gardés dans l'archive JORF de la ligne COST06 suivante ; la délibération "
                    "elle-même : https://www.cre.fr/fileadmin/Documents/Deliberations/2026/260715_2026-147_TRVE.pdf"},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    ),
    Source(
        "COST06",
        "https://echanges.dila.gouv.fr/OPENDATA/JORF/JORF_20260731-003333.tar.gz",
        "JORF_20260731-003333.tar.gz",
        {"titre": "Journal officiel (DILA, données ouvertes JORF) - Décision du 29 juillet 2026 relative aux tarifs "
                  "réglementés de vente de l'électricité applicables aux consommateurs résidentiels en France "
                  "métropolitaine continentale (JORF n° 0177 du 31/07/2026, texte n° 33, NOR ECOR2619295S, "
                  "JORFTEXT000054569470), archive du 31/07/2026",
         "millesime": "décision du 29/07/2026, publiée le 31/07/2026, en vigueur le 01/08/2026 (article 2)",
         "licence": "Licence Ouverte (champ license « fr-lo » de la fiche data.gouv.fr du jeu JORF de la DILA, "
                    "consulté le 05/11/2026) ; texte de l'acte cité",
         "granularite": "acte administratif : 3 articles et annexe B1 (barèmes)",
         "geographie": "France métropolitaine continentale",
         "traitements": "aucun chiffre repris dans un fichier publié : l'acte sert à vérifier la date d'effet, le "
                        "caractère hors taxes des barèmes et l'ouverture de l'option Base pour 3 et 6 kVA",
         "controles": "lu le 05/11/2026 dans l'archive (fichiers article/JORF/ARTI/.../JORFARTI000054569477, "
                      "...479, ...480 et ...482) : article 2 « La présente décision entre en vigueur le 1er août "
                      "2026. » ; annexe B1, IV « Les prix figurant dans les barèmes s'entendent hors taxes, "
                      "redevances et contributions. » ; option Base « en extinction pour les puissances de 9, 12 et "
                      "15 kVA », 3 et 6 kVA non concernées ; rapprochement de calcul (pas une relecture du Journal "
                      "officiel) : (13,61 c€ HT, valeur indiquée par l'équipe d'après une copie du JO, + accise "
                      "3,062 c€) x 1,20 de TVA = 20,006, soit les 20,01 c€ TTC/kWh de la grille EDF",
         "limites": "les barèmes chiffrés de l'annexe B1 sont des images du Journal officiel : absents de cette "
                    "archive, donc la valeur de 13,61 c€ HT n'a pas été relue par nous dans l'acte ; la copie du JO "
                    "de l'équipe n'est pas versée au dépôt ; Légifrance refuse le robot (403, 05/11/2026) : lien "
                    "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470 non lu ; archive quotidienne "
                    "(la même décision figure aussi dans l'archive du 31/07 à 22h12) ; "
                    "provenance, adresse datée d'origine : https://echanges.dila.gouv.fr/OPENDATA/JORF/JORF_20260731-003333.tar.gz ; cette adresse ne répond plus (HTTP 404 le 09/11/2026), l'empreinte sha256 porte sur le fichier archivé à la date d'extraction"},
        public_url="https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470",
    ),
    Source(
        "COST07",
        "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2"
        "/exports/csv?delimiter=%3B&use_labels=false",
        "prix-carburants-flux-instantane-v2.csv",
        {"titre": "Ministère de l'Économie - Prix des carburants en France, flux instantané v2 (export CSV, toutes "
                  "les stations)",
         "millesime": "relevé instantané à la date d'extraction ; chaque prix porte sa date de mise à jour "
                      "(colonnes *_maj)",
         "licence": "Licence Ouverte v2.0 (champ license = lov2 de l'API data.gouv.fr, jeu 6407d088d4e23dc662022e2c)",
         "granularite": "station, carburant",
         "geographie": "France (filtré sur code_departement 75, 77, 78, 91, 92, 93, 94, 95 par le pipeline)",
         "traitements": "médiane non pondérée des prix des stations d'Île-de-France pour SP95-E10 (e10_prix) et "
                        "gazole (gazole_prix) ; nombre de stations et dates de mise à jour publiés dans "
                        "meta.vehicles",
         "controles": "aucune station n'a à la fois un prix et une rupture pour le même carburant (vérifié par les contrôles du pipeline)",
         "limites": "prix déclarés par les stations, non pondérés par les volumes vendus (aucune donnée de "
                    "volume) ; instantané : la valeur n'est reproductible qu'avec ce fichier ; certaines dates de "
                    "mise à jour sont anciennes (publiées telles quelles) ; l'heure des colonnes *_maj est publiée "
                    "avec le suffixe +00:00 mais dépasse l'heure d'extraction : elle est recopiée sans conversion"},
    ),
    Source(
        "COST08",
        "https://www.statistiques.developpement-durable.gouv.fr/media/8867/download?inline",
        "sdes_bilan_transports_2024_circulation.xlsx",
        {"titre": "SDES - Bilan annuel des transports en 2024, « Bilan de la circulation et matériels de transport "
                  "- Données » (onglet G3.b « Consommations unitaires des véhicules immatriculés en France »)",
         "millesime": "2024 (données arrêtées au 25/11/2025, publication du 25/11/2025)",
         "licence": "Licence Ouverte (décret n° 2017-638), mentions légales du site du SDES lues le 03/11/2026",
         "granularite": "moyenne nationale par type de véhicule et motorisation, L/100 km ou kWh/100 km",
         "geographie": "véhicules immatriculés en France (champ de la figure G3-2 du rapport : France "
                       "métropolitaine)",
         "traitements": "voitures particulières 2024 : « dont essence » 6,7247 L/100 km, « dont Diesel » "
                        "5,9251 L/100 km, « Electrique » 17,5996 kWh/100 km, lues par le pipeline",
         "controles": "libellés et colonne 2024 recherchés dans l'onglet (contrôle bloquant du pipeline)",
         "limites": "moyenne du parc, tous trajets, sans le véhicule de la personne ni la congestion ; le fichier "
                    "ne précise pas si la consommation électrique est mesurée au réseau (recharge comprise) ou en "
                    "sortie de batterie"},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    ),
    Source(
        "COST08",
        "https://www.statistiques.developpement-durable.gouv.fr/media/8868/download?inline",
        "sdes_bilan_transports_2024.pdf",
        {"titre": "SDES - Bilan annuel des transports en 2024 (rapport complet, 220 pages)",
         "millesime": "2024 (publié le 25/11/2025)",
         "licence": "Licence Ouverte (décret n° 2017-638)",
         "granularite": "rapport",
         "geographie": "France métropolitaine",
         "traitements": "aucun : lu pour la définition des consommations unitaires (pages 187 à 189)",
         "controles": "aucune définition de l'énergie électrique (réseau ou batterie) trouvée pages 179 à 215",
         "limites": "documentation seulement"},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    ),
)


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(source: Source, force: bool = False, timeout: int = 600, retries: int = 3) -> tuple[Path, str]:
    """Télécharge `source` (sauf si déjà présent). Renvoie (chemin local, URL finale après redirections)."""
    dest = source.local_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        return dest, ""
    tmp = dest.with_suffix(dest.suffix + ".part")
    headers = {"User-Agent": source.user_agent or USER_AGENT, "Accept-Language": "fr-FR"}
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with requests.get(source.url, stream=True, timeout=timeout, headers=headers) as r:
                r.raise_for_status()
                final_url = r.url
                with tmp.open("wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        f.write(chunk)
            tmp.replace(dest)
            return dest, final_url
        except requests.RequestException as exc:  # coupure réseau : on réessaie
            last_exc = exc
            time.sleep(5 * attempt)
    raise RuntimeError(f"échec après {retries} tentatives : {last_exc}")


def read_manifest(path: Path = MANIFEST_PATH) -> list[dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def write_manifest(rows: list[dict[str, str]], path: Path = MANIFEST_PATH, *, keep_order: bool = False) -> None:
    """`keep_order` : garde l'ordre des lignes (04o). L'ordre compte : la première ligne d'une source est celle que citent
    certains exports (par exemple les sources de tolls.json)."""
    if not keep_order:
        rows = sorted(rows, key=lambda r: (r["source_id"], r["fichier_local"]))
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=MANIFEST_COLUMNS, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in MANIFEST_COLUMNS})


# `url_source` = une seule adresse (lien cliquable du mode sources, audit du 10/11) : l'adresse résolue au
# téléchargement (redirection, par exemple « latest » de Geofabrik vers l'extrait daté) va dans `millesime`.
RESOLVED_PREFIX = "URL résolue : "
_LEGACY_RESOLVED = re.compile(r" \(résolue : (\S+?)\)$")
_NOTE_RESOLVED = re.compile(r"(?:^| ; )URL résolue : (\S+)")


def resolved_url(source_url: str, final_url: str, existing: dict[str, str] | None) -> str:
    """Adresse résolue à noter ("" si aucune) : celle du téléchargement, sinon celle déjà notée dans la ligne existante
    (ancienne forme « url (résolue : ...) » comprise)."""
    if final_url:
        return final_url if final_url != source_url else ""
    if not existing:
        return ""
    m = _LEGACY_RESOLVED.search(existing.get("url_source", "")) or _NOTE_RESOLVED.search(existing.get("millesime", ""))
    return m.group(1) if m else ""


def with_resolved(millesime: str, resolved: str) -> str:
    """`millesime` avec une seule mention « URL résolue : ... » (remplacée, jamais doublée)."""
    base = _NOTE_RESOLVED.sub("", millesime).strip()
    if not resolved:
        return base
    return f"{base} ; {RESOLVED_PREFIX}{resolved}" if base else f"{RESOLVED_PREFIX}{resolved}"


def upsert_manifest(source: Source, local: Path, final_url: str, extra: dict[str, str] | None = None) -> dict[str, str]:
    """Met à jour la ligne (source_id, fichier_local) du manifest. Idempotent si le fichier n'a pas changé."""
    rows = read_manifest()
    rel = local.relative_to(REPO_ROOT).as_posix()
    digest = sha256_of(local)
    existing = next((r for r in rows if r["source_id"] == source.source_id and r["fichier_local"] == rel), None)
    if existing and existing.get("sha256") == digest:
        date_extraction = existing["date_extraction"]
    else:
        date_extraction = datetime.fromtimestamp(local.stat().st_mtime, tz=UTC).strftime("%Y-%m-%dT%H:%MZ")
    resolved = resolved_url(source.url, final_url, existing)
    row = {c: "" for c in MANIFEST_COLUMNS}
    if existing:
        row.update(existing)
    row.update(source.meta)
    row.update({
        "source_id": source.source_id, "url_source": source.manifest_url, "date_extraction": date_extraction,
        "fichier_local": rel, "sha256": digest, "millesime": with_resolved(row.get("millesime", ""), resolved),
    })
    if extra:
        row.update(extra)
    rows = [r for r in rows if r is not existing] + [row]
    write_manifest(rows, keep_order=True)  # ajoute ou remplace sans réordonner (sources de tolls.json)
    return row
