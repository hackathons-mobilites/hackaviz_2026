"""Postes salariés par commune (EMP01, INSEE Flores) et pôles d'emploi disjoints.

Les pôles sont une SÉLECTION documentée des principales concentrations de postes salariés recensés par l'INSEE,
validée contre le classement Flores 2023 (voir docs/methodologie.md § Pôles). Ils ne couvrent pas toute l'IDF.
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from starway.config import IDF_DEPS, RAW_DIR

FLORES_OUTER_ZIP = RAW_DIR / "EMP01" / "DS_FLORES_2023_CSV_FR.zip"
FLORES_INNER_ZIP = "DS_FLORES_A5_2023_CSV_FR.zip"
FLORES_DATA_CSV = "DS_FLORES_A5_2023_data.csv"

# Filtres vérifiés dans DS_FLORES_A5_2023_metadata.csv et aide_lecture_flores.pdf
FLORES_FILTER = {
    "ACTIVITY": "_T",  # Total
    "NUMBER_EMPL": "_T",  # Total
    "LEGAL_FORM_WITH_PUBLIC": "1T9X7",  # Ensemble hors particuliers employeurs
    "FLORES_MEASURE": "EMPL3112",  # Effectifs (postes) présents la dernière semaine de décembre
}


@dataclass(frozen=True)
class PoleDef:
    id: str
    name: str
    communes: tuple[str, ...]
    # Point représentatif : règle unique, dérivée de TRA01 (voir scripts/03 et starway/gtfs.py) : l'arrêt
    # parent du GTFS qui a le plus de départs à SERVICE_DATE parmi ceux situés dans les communes du pôle.


POLE_DEFS: tuple[PoleDef, ...] = (
    # Paris : 3 pôles qui couvrent les 20 arrondissements (les 12e, 16e et 17e sont dans le top 10 Flores).
    PoleDef("P_PARIS_QCA", "Paris - Quartier central des affaires et ouest (1er, 2e, 8e, 9e, 16e, 17e)",
            ("75101", "75102", "75108", "75109", "75116", "75117")),
    PoleDef("P_PARIS_RG", "Paris - Rive gauche (5e, 6e, 7e, 13e, 14e, 15e)",
            ("75105", "75106", "75107", "75113", "75114", "75115")),
    PoleDef("P_PARIS_EST", "Paris - Centre-est et nord-est (3e, 4e, 10e, 11e, 12e, 18e, 19e, 20e)",
            ("75103", "75104", "75110", "75111", "75112", "75118", "75119", "75120")),
    PoleDef("P_DEFENSE", "La Défense", ("92026", "92050", "92062")),
    PoleDef("P_BOULOGNE", "Boulogne / Issy", ("92012", "92040")),
    PoleDef("P_PLAINE", "Saint-Denis / Plaine Commune", ("93001", "93066", "93070")),
    PoleDef("P_ROISSY", "Roissy-CDG", ("77291", "93073", "95527")),
    PoleDef("P_ORLY", "Orly / Rungis", ("91479", "94054", "94065")),
    PoleDef("P_CRETEIL", "Créteil", ("94028",)),
    PoleDef("P_SACLAY", "Massy / Saclay", ("91377", "91471", "91477", "91534")),
    PoleDef("P_VERSAILLES", "Versailles / Vélizy", ("78640", "78646")),
    PoleDef("P_SQY", "Saint-Quentin-en-Yvelines", ("78297", "78423")),
    PoleDef("P_MARNE", "Marne-la-Vallée - Noisy / Champs", ("77083", "93051")),
    PoleDef("P_CERGY", "Cergy-Pontoise", ("95127", "95500", "95572")),
    PoleDef("P_EVRY", "Évry-Courcouronnes", ("91228",)),
)


def read_flores_totals(outer_zip: Path = FLORES_OUTER_ZIP) -> pd.DataFrame:
    """Postes salariés totaux par territoire (toutes les GEO_OBJECT). Colonnes : GEO, GEO_OBJECT, jobs."""
    with zipfile.ZipFile(outer_zip) as outer, outer.open(FLORES_INNER_ZIP) as inner_f:
        with zipfile.ZipFile(inner_f) as inner, inner.open(FLORES_DATA_CSV) as f:
            chunks = []
            for chunk in pd.read_csv(f, sep=";", dtype=str, chunksize=1_000_000):
                m = pd.Series(True, index=chunk.index)
                for col, val in FLORES_FILTER.items():
                    m &= chunk[col] == val
                chunks.append(chunk.loc[m, ["GEO", "GEO_OBJECT", "TIME_PERIOD", "OBS_VALUE"]])
    df = pd.concat(chunks, ignore_index=True)
    df["jobs"] = pd.to_numeric(df["OBS_VALUE"], errors="coerce")
    return df.drop(columns="OBS_VALUE")


def jobs_by_commune(totals: pd.DataFrame) -> pd.DataFrame:
    """Communes IDF (COM, dont 75056) + arrondissements de Paris (ARM 751xx). Colonnes : insee, jobs, geo_object."""
    com = totals[(totals["GEO_OBJECT"] == "COM") & totals["GEO"].str[:2].isin(IDF_DEPS)]
    arm = totals[(totals["GEO_OBJECT"] == "ARM") & totals["GEO"].str.startswith("751")]
    out = pd.concat([com, arm]).rename(columns={"GEO": "insee", "GEO_OBJECT": "geo_object"})
    return out[["insee", "geo_object", "jobs"]].sort_values("insee").reset_index(drop=True)


def check_disjoint(defs: tuple[PoleDef, ...] = POLE_DEFS) -> list[str]:
    """Communes présentes dans plus d'un pôle (doit être vide)."""
    seen: dict[str, str] = {}
    dup: list[str] = []
    for p in defs:
        for c in p.communes:
            if c in seen:
                dup.append(f"{c} ({seen[c]}, {p.id})")
            seen[c] = p.id
    return dup


def aggregate_poles(jobs: pd.DataFrame, defs: tuple[PoleDef, ...] = POLE_DEFS) -> pd.DataFrame:
    """Somme des postes par pôle. `jobs` null si une commune membre est absente ou null (jamais 0)."""
    j = jobs.set_index("insee")["jobs"]
    rows = []
    for p in defs:
        vals = [j.get(c) for c in p.communes]
        missing = [c for c, v in zip(p.communes, vals) if v is None or pd.isna(v)]
        total = None if missing else int(sum(int(v) for v in vals))
        rows.append({"id": p.id, "name": p.name, "communes": list(p.communes), "jobs": total, "missing": missing})
    df = pd.DataFrame(rows)
    df["jobs"] = pd.Series([r["jobs"] for r in rows], dtype=object)  # None reste None (jamais NaN ni 0)
    return df
