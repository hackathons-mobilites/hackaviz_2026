"""Paramètres figés du pipeline STARWAY (chemins, date de service, journées-types, budgets, modes).

Toute modification d'un paramètre de méthode doit être reportée dans docs/methodologie.md.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, time
from pathlib import Path

PROCESSING_VERSION = "0.1.0"

# --- Chemins -----------------------------------------------------------------
PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
DATA_DIR = REPO_ROOT / "data"
# Données volumineuses non versionnées (data/raw, data/interim) : celles de l'arbre de travail, ou, si la variable
# d'environnement STARWAY_DATA_ROOT est posée (dossier `data` d'un autre arbre, en pratique celui de l'arbre principal),
# celles de ce dossier. Permet de lancer les contrôles depuis un arbre `hackaton-wt/<sujet>` sans jonction ni copie.
# `data/processed` et le manifeste restent ceux de l'arbre de travail (ce sont des fichiers versionnés).
DATA_ROOT = Path(os.environ["STARWAY_DATA_ROOT"]).resolve() if os.environ.get("STARWAY_DATA_ROOT") else DATA_DIR
RAW_DIR = DATA_ROOT / "raw"
INTERIM_DIR = DATA_ROOT / "interim"
PROCESSED_DIR = DATA_DIR / "processed"


def data_path(rel: str) -> Path:
    """Fichier de données écrit dans le manifeste (`data/raw/...`, `data/interim/...`, `data/processed/...`) : sous
    STARWAY_DATA_ROOT pour les deux premiers quand la variable est posée, sinon dans l'arbre."""
    parts = Path(rel).as_posix().split("/")
    if len(parts) > 2 and parts[0] == "data" and parts[1] in ("raw", "interim"):
        return DATA_ROOT.joinpath(*parts[1:])
    return REPO_ROOT / rel


def manifest_rel(path: Path) -> str:
    """Chemin d'un fichier de données tel qu'écrit dans le manifeste (`data/raw/<CODE>/x.xlsx`), qu'il soit dans l'arbre ou
    sous STARWAY_DATA_ROOT."""
    p = Path(path).resolve()
    for base in (REPO_ROOT, DATA_ROOT.parent):
        if p.is_relative_to(base.resolve()):
            return p.relative_to(base.resolve()).as_posix()
    raise ValueError(f"{path} n'est ni dans l'arbre ni sous STARWAY_DATA_ROOT")
MANIFEST_PATH = DATA_DIR / "sources_manifest.csv"
FRONT_DATA_DIR = REPO_ROOT / "frontend" / "public" / "data"
# Ciel unique (D-054) : les 44 astres (bassins d'emploi France Travail 2026, Paris en 20 arrondissements), publiés à la racine
# de FRONT_DATA_DIR. L'ancien ciel des 15 pôles est archivé (D-054) ; poles.json reste produit par 03 pour les contrôles.
SKY_DEFAULT = "44"
FRONT_SKY44_DIR = FRONT_DATA_DIR
POLES_D030_JSON = DATA_DIR / "processed" / "poles_d030.json"
POLES_15_JSON = DATA_DIR / "processed" / "poles.json"


def sky_front_dir(sky: str) -> Path:
    """Dossier publié des fichiers propres à un ciel : poles.json, et ce qui est calculé vers ses pôles (meta.json,
    access/, itineraries*/, subscriptions.json, tolls.json, insights.json). Un seul ciel : les 44 astres, à la racine."""
    if sky != "44":
        raise ValueError(f"ciel inconnu : {sky}")
    return FRONT_SKY44_DIR


def sky_poles_json(sky: str) -> Path:
    """Fichier de pôles (data/processed) du ciel : 44 astres (`poles_d030.json`)."""
    if sky != "44":
        raise ValueError(f"ciel inconnu : {sky}")
    return POLES_D030_JSON


JDK_DIR = REPO_ROOT / ".tools" / "jdk-21"  # JDK portable (non versionné), voir README

# --- Périmètre géographique ----------------------------------------------------
IDF_REGION = "11"
IDF_DEPS = ("75", "77", "78", "91", "92", "93", "94", "95")
PARIS_COMMUNE = "75056"
PARIS_ARRONDISSEMENTS = tuple(f"751{i:02d}" for i in range(1, 21))

# --- Emploi (EMP01) ------------------------------------------------------------
JOBS_YEAR = 2023  # millésime Flores retenu (postes salariés fin d'année)

# --- Transport ------------------------------------------------------------------
# Date de service : un mardi ordinaire (hors vacances scolaires zone C, hors férié)
# dans la fenêtre de validité du GTFS IDFM téléchargé. Vérifiée par 04_compute_matrix.py.
SERVICE_DATE = date(2026, 11, 17)


@dataclass(frozen=True)
class DayType:
    id: str
    label: str
    start: time
    end: time


DAY_TYPES: tuple[DayType, ...] = (
    DayType("d06", "6h-14h", time(6, 0), time(14, 0)),
    DayType("d09", "9h-17h", time(9, 0), time(17, 0)),
    DayType("d14", "14h-22h", time(14, 0), time(22, 0)),
)
DAY_TYPES_BY_ID = {d.id: d for d in DAY_TYPES}

BUDGETS_MIN = (30, 45, 60)

MODES: tuple[tuple[str, str], ...] = (
    ("transit", "Transports en commun + marche"),
    ("bike_transit", "Vélo + transports en commun"),
    ("bike", "Vélo"),
    ("walk", "Marche"),
    ("car", "Voiture (sans trafic)"),
    ("velib", "Vélib' (vélo en libre-service)"),  # D-027 : communes avec au moins une station seulement
)

# Routage (voir skill starway-routing-r5py et docs/methodologie.md)
OUTBOUND_STEP_MIN = 5  # grille des départs aller
OUTBOUND_LOOKBACK_MIN = 120  # fenêtre de recherche avant la prise de poste
MAX_TRIP_MIN = 120  # durée max de recherche r5py
DEPARTURE_WINDOW_MIN = 1  # fenêtre r5py : 1 min (pas de lissage de l'attente)
SPEED_WALKING_KMH = 3.6
SPEED_CYCLING_KMH = 12.0
R5_MAX_MEMORY = "10G"

# Réglages de marche des TC (D-024) : CHOIX DE L'ÉQUIPE (Nicolas, 03/11/2026), PAS UNE DONNÉE, au même titre que les
# journées-types. Distance maximale de chaque trajet à pied d'un trajet TC : accès depuis le point de départ et sortie
# vers le point d'arrivée (un trajet tout à pied compte comme un seul trajet à pied, voir methodologie.md § 5 octies).
# Les correspondances à pied restent à la limite de R5 (TRANSFER_DISTANCE_LIMIT_METERS = 1 000 m), inchangée.
# Calcul : jar R5 recompilé avec WALK_DISTANCE_LIMIT_METERS = la distance (sortie) et max_time_walking = distance /
# SPEED_WALKING_KMH arrondi à la minute supérieure (accès ; r5py ne transmet que des minutes entières).
# Depuis l'export du 03/11/2026 (D-024), modes.transit publie le réglage par défaut (WALK_SETTING_DEFAULT, matrice
# data/interim/matrix_walk3000/) et variants.comfort l'autre ; la matrice à la limite de R5 d'origine (sortie 2 000 m,
# accès limité à MAX_TRIP_MIN, data/interim/matrix/) n'est plus publiée.
WALK_SETTINGS_M: dict[str, int] = {
    "comfort": 1000,  # « confort » : on ne marche pas plus de 1 km
    "normal": 3000,  # « normal » : on marche jusqu'à 3 km
}
WALK_SETTING_DEFAULT = "normal"  # défaut validé par Nicolas le 03/11 (D-024) : publié dans modes.transit
WALK_SETTING_LABELS = {"normal": "normal : jusqu'à 3 km à pied", "comfort": "confort : pas plus de 1 km à pied"}
TRANSFER_WALK_LIMIT_M = 1000  # correspondances à pied : constante TransitLayer.TRANSFER_DISTANCE_LIMIT_METERS de R5,
#                               inchangée dans les jars D-024 (vérifiée par 04e), publiée pour le front

# Mode Vélib' (D-027) : avertissement EXACT de docs/proposition-velib.md § 6 (validé par Nicolas le 03/11), publié tel
# quel dans meta.velib ; texte hors zone de service.
VELIB_WARNING = ("Vélib' : vélo pas forcément disponible. Ce temps suppose qu'un vélo vous attend à la station de "
                 "départ et qu'une place est libre à l'arrivée. Personne ne peut le garantir à l'avance : les données "
                 "ouvertes ne donnent la disponibilité qu'en temps réel. Le temps pour prendre et rendre le vélo n'est "
                 "pas compté.")
VELIB_OUT_OF_ZONE = "Pas de station Vélib' dans cette commune"

# Raisons autorisées quand out/ret est null (contrat access/{insee}.json). `no_stop_within_walk_limit` (D-023, retour
# non mesuré à cause de la limite de marche cachée de R5) n'est plus publiée depuis D-024 : la limite de marche est le
# réglage annoncé, un retour nul est un résultat mesuré (no_trip_within_120).
REASONS = ("no_trip_within_120", "no_service_at_hour", "origin_not_snapped", "not_computed")

# Communes du POC r5py (PAS le choix du récit) : contraste de desserte plausible.
POC_COMMUNES = ("93048", "77284", "77222")  # Montreuil, Meaux, Guignes

# --- Carte miroir (06b) : CHOIX DE RENDU, pas des données --------------------------
# Tolérance de simplification des contours (Lambert-93, mètres) et précision des coordonnées WGS84 (4 décimales,
# soit environ 11 m en latitude et 7 m en longitude à Paris). Retenues pour que geo/communes.geojson pèse moins
# de 600 Ko (objectif de poids fixé par l'équipe pour le front). N'interviennent dans aucun calcul.
GEO_SIMPLIFY_TOLERANCE_M = 250
GEO_COORD_DECIMALS = 4
GEO_MAX_COMMUNES_KB = 600

# --- Contexte communal (05) ------------------------------------------------------
RP_YEAR = 2023
FILOSOFI_YEAR = 2023
AGE_BINS: tuple[tuple[str, int, int | None], ...] = (
    ("0-14", 0, 14), ("15-29", 15, 29), ("30-44", 30, 44), ("45-59", 45, 59), ("60-74", 60, 74), ("75+", 75, None),
)
# Coût TC : forfait Navigo Mois toutes zones, « tarifs applicables au 1er janvier 2026 » (source COST01,
# page IDFM consultée le 2026-11-02). Identique pour toutes les communes.
NAVIGO_MONTH_EUR = 90.80
NAVIGO_PRICE_LABEL = "90,80 €"
NAVIGO_SOURCE_URL = "https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-mois"
NAVIGO_VALIDITY_LABEL = "Tarifs du forfait applicables au 1er janvier 2026"  # phrase vérifiée dans l'instantané par 05
# Coût voiture : RETIRÉ (D-011). Le barème kilométrique fiscal sert à évaluer des frais réels déductibles de l'impôt
# sur le revenu ; il n'est pas publié comme le coût d'un trajet. Aucune source officielle de coût par trajet n'a été
# retenue, donc aucune estimation.
CAR_COST_REASON = ("non estimé (décision D-011) : aucune source officielle retenue ne publie le coût d'un trajet en "
                   "voiture ; le barème kilométrique fiscal évalue forfaitairement des frais de véhicule déductibles "
                   "de l'impôt sur le revenu (frais réels), ce n'est pas le coût d'un trajet")
