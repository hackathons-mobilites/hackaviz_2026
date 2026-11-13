"""Téléchargement des données ouvertes (une seule fois, gardées dans analyse/raw/)."""
from __future__ import annotations

import json
from pathlib import Path

import httpx

RAW = Path(__file__).parent / "raw"

IDF = "https://data.iledefrance.fr/api/explore/v2.1/catalog/datasets"
IDFM = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets"
METEO = "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT"
PARIS = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets"

# Période étudiée : une année complète, de juillet 2025 à juin 2026 (été, hiver, canicule de juin 2026)
PERIOD = ("2025-07-01", "2026-06-30")

# Validations par jour et par gare, réseau ferré (IDFM, publication trimestrielle).
_V = f"{IDF}/validations-sur-le-reseau-ferre-nombre-de-validations-par-jour-{{}}-trimestre-2025/exports/csv?delimiter=%3B"
VALIDATIONS = {"2025T3": _V.format("3eme"), "2025T4": _V.format("4eme"), "2026T1": _V.format("1er"), "2026T2": _V.format("2eme")}
SOURCES = {
    # Référentiel des lignes : champ air_conditioning (true, partial, false, unknown)
    "lignes.csv": f"{IDFM}/referentiel-des-lignes/exports/csv?delimiter=%3B",
    # Arrêts desservis par chaque ligne (hors bus : seul le réseau ferré a des validations par gare)
    "arrets_lignes.csv": f"{IDFM}/arrets-lignes/exports/csv?delimiter=%3B&where=mode%20!%3D%20%22Bus%22",
    "arrets.csv": f"{IDFM}/arrets/exports/csv?delimiter=%3B",
    "zones_arret.csv": f"{IDFM}/zones-d-arrets/exports/csv?delimiter=%3B",
    # Météo-France quotidienne, Paris (75) : Paris-Montsouris = poste 75114001
    "meteo_75.csv.gz": f"{METEO}/Q_75_latest-2025-2026_RR-T-Vent.csv.gz",
    "meteo_75_autres.csv.gz": f"{METEO}/Q_75_latest-2025-2026_autres-parametres.csv.gz",  # neige (NEIG, NEIGETOTX)
    # Historiques pour les accidents (2021-2024) et les ascenseurs (2013-2023)
    "meteo_75_previous.csv.gz": f"{METEO}/Q_75_previous-1950-2024_RR-T-Vent.csv.gz",
    "meteo_75_previous_autres.csv.gz": f"{METEO}/Q_75_previous-1950-2024_autres-parametres.csv.gz",
    "meteo_75_horaire_previous.csv.gz": "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/HOR/H_75_previous-2020-2024.csv.gz",
    "feries_2025.json": "https://calendrier.api.gouv.fr/jours-feries/metropole/2025.json",
    "feries_2026.json": "https://calendrier.api.gouv.fr/jours-feries/metropole/2026.json",
    # Compteurs vélo de Paris (13 mois glissants) : agrégés par compteur, jour et heure côté serveur
    "velo_annee.json": f"{PARIS}/comptage-velo-donnees-compteurs/exports/json?"
                 "select=id_compteur,sum(sum_counts)%20as%20n"
                 "&group_by=id_compteur,date_format(date,%22yyyy-MM-dd%22)%20as%20jour,date_format(date,%22HH%22)%20as%20heure"
                 f"&where=date%3E%3D%22{PERIOD[0]}%22%20and%20date%3C%3D%22{PERIOD[1]}T23:59:59%22&timezone=Europe%2FParis",
    # Comptages routiers permanents de Paris : débit horaire q, agrégé par tronçon et par jour
    "routier_annee.json": f"{PARIS}/comptages-routiers-permanents/exports/json?"
                    "select=iu_ac,sum(q)%20as%20q,count(q)%20as%20h"
                    "&group_by=iu_ac,date_format(t_1h,%22yyyy-MM-dd%22)%20as%20jour"
                    f"&where=t_1h%3E%3D%22{PERIOD[0]}%22%20and%20t_1h%3C%3D%22{PERIOD[1]}T23:59:59%22&timezone=Europe%2FParis",
}


def fetch(name: str, url: str, force: bool = False) -> Path:
    path = RAW / name
    if path.exists() and path.stat().st_size > 0 and not force:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Téléchargement {name}…")
    with httpx.stream("GET", url, timeout=600, follow_redirects=True) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    return path


def fetch_all(force: bool = False) -> dict[str, Path]:
    files = {name: fetch(name, url, force) for name, url in SOURCES.items()}
    files.update({f"validations_{k}.csv": fetch(f"validations_{k}.csv", url, force) for k, url in VALIDATIONS.items()})
    return files


# Accidents corporels (ONISR, fichiers « caractéristiques ») et historique des ascenseurs (Dispotrains)
BAAC = {2021: "https://static.data.gouv.fr/resources/bases-de-donnees-annuelles-des-accidents-corporels-de-la-circulation-routiere-annees-de-2005-a-2020/20221024-113743/carcteristiques-2021.csv",
        2022: "https://static.data.gouv.fr/resources/bases-de-donnees-annuelles-des-accidents-corporels-de-la-circulation-routiere-annees-de-2005-a-2021/20231005-093927/carcteristiques-2022.csv",
        2023: "https://static.data.gouv.fr/resources/bases-de-donnees-annuelles-des-accidents-corporels-de-la-circulation-routiere-annees-de-2005-a-2023/20241028-103125/caract-2023.csv",
        2024: "https://static.data.gouv.fr/resources/bases-de-donnees-annuelles-des-accidents-corporels-de-la-circulation-routiere-annees-de-2005-a-2024/20251021-115900/caract-2024.csv"}
DISPOTRAINS = "https://dispotrains.membrives.fr/static/data/dump.tar.bz2"


def fetch_history() -> None:
    """Accidents et historique des ascenseurs (gros fichiers, téléchargés une fois)."""
    for year, url in BAAC.items():
        fetch(f"baac/caract_{year}.csv", url)
    if not (RAW / "dispotrains" / "x" / "statistics.json").exists():
        import tarfile
        archive = fetch("dispotrains/dump.tar.bz2", DISPOTRAINS)
        with tarfile.open(archive) as t:
            t.extract("statistics.json", RAW / "dispotrains" / "x")


def holidays(path: Path) -> set[str]:
    return set(json.loads(path.read_text(encoding="utf-8")))
