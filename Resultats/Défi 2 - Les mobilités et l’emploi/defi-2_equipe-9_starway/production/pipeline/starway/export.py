"""Écriture des JSON consommés par le front (contrats : skill starway-data-pipeline/references/contrats-donnees.md)."""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from starway.config import BUDGETS_MIN, DAY_TYPES, MODES, PROCESSING_VERSION, SERVICE_DATE
from starway.egress import MARKED_MODE, mark_reason
from starway.sources import read_manifest


def _clean(o: Any) -> Any:
    """NaN / NA -> None (null JSON explicite), récursivement."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if o is pd.NA or o is None:
        return None
    if isinstance(o, float) and math.isnan(o):
        return None
    if hasattr(o, "item"):  # numpy scalars
        return _clean(o.item())
    return o


def write_json(path: Path, obj: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(_clean(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def build_meta(gtfs_downloaded_at: str | None, access_communes: list[str], story_communes: list[str]) -> dict:
    return {
        "processing_version": PROCESSING_VERSION,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "service_date": SERVICE_DATE.isoformat(),
        "gtfs_downloaded_at": gtfs_downloaded_at,
        "day_types": [
            {"id": d.id, "label": d.label, "start": d.start.strftime("%H:%M"), "end": d.end.strftime("%H:%M")}
            for d in DAY_TYPES
        ],
        "budgets": list(BUDGETS_MIN),
        "modes": [{"id": i, "label": label} for i, label in MODES],
        "story_communes": story_communes,
        "access_communes": access_communes,
        "sources": "sources.json",
    }


def build_poles(poles: list[dict]) -> list[dict]:
    keys = ("id", "name", "communes", "jobs", "jobs_year", "jobs_source", "point", "sky")
    optional = ("name_short", "name_official", "name_short_insee", "bassin")  # champs D-030, s'ils existent
    return [{k: p[k] for k in keys} | {k: p[k] for k in optional if k in p} for p in poles]


def build_communes(communes: pd.DataFrame) -> list[dict]:
    rows = []
    for r in communes.sort_values("insee").itertuples():
        pop = None if pd.isna(r.population) else int(r.population)
        row = {"insee": r.insee, "name": r.name, "dep": r.dep, "lon": round(float(r.lon), 5),
               "lat": round(float(r.lat), 5), "population": pop,
               "sky": {"x": float(r.sky_x), "y": float(r.sky_y)}}
        # point de départ du routage (D-017), champ optionnel : absent si la colonne n'existe pas
        if hasattr(r, "origin_lon") and not pd.isna(r.origin_lon):
            row["origin"] = {"lon": round(float(r.origin_lon), 5), "lat": round(float(r.origin_lat), 5),
                             "method": str(r.origin_method)}
        rows.append(row)
    return rows


def build_sources() -> list[dict]:
    drop = {"fichier_local", "sha256"}
    return [{k: (v if v != "" else None) for k, v in r.items() if k not in drop} for r in read_manifest()]


def gtfs_extraction_date() -> str | None:
    for r in read_manifest():
        if r["source_id"] == "TRA01":
            return r["date_extraction"][:10]
    return None


def dep_hhmm(value: object) -> str | None:
    """Départ retenu de l'aller ('2026-11-17 05:45:00', horodatage ISO ou 'HH:MM') -> 'HH:MM' ; None si absent."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    text = str(value).strip()
    if not text:
        return None
    t = pd.Timestamp(text) if len(text) > 5 else pd.Timestamp(f"2000-01-01 {text}")
    return f"{t.hour:02d}:{t.minute:02d}"


def build_access(insee: str, pole_ids: list[str], matrices: dict[tuple[str, str], pd.DataFrame],
                 walk_limit: Mapping[tuple[str, str], str] | None = None) -> dict:
    """matrices[(mode, day)] = DataFrame from_id,to_id,out,ret,reason[,dep] ; `day` = 'any' pour les modes sans horaire.

    `dep` (modes à horaire seulement) : heure de départ de l'aller retenue, « HH:MM », = départ le plus tardif de la
    grille de 5 min qui arrive avant le début du poste ; null si l'aller est null. Pas de champ pour le retour : il
    part à l'heure de fin de la journée-type.

    `walk_limit[(insee, day)]` = base du marquage (`crow` | `network`, starway.egress.walk_limit_marks) : pour le mode
    TC de cette journée, un retour nul avec aller trouvé porte `no_stop_within_walk_limit` (mark_reason), et la série
    porte `walk_limit` = base si au moins un retour y est nul."""
    modes: dict[str, dict] = {}
    marks = walk_limit or {}
    for (mode, day), m in sorted(matrices.items()):
        sub = m[m["from_id"] == insee].set_index("to_id")
        if sub.empty:
            continue
        basis = marks.get((insee, day)) if mode == MARKED_MODE else None
        with_dep = day != "any" and "dep" in sub.columns
        out, ret, reason, dep = [], [], [], []
        for pid in pole_ids:
            if pid not in sub.index:
                out.append(None)
                ret.append(None)
                reason.append("not_computed")
                dep.append(None)
                continue
            row = sub.loc[pid]
            o = None if pd.isna(row["out"]) else int(row["out"])
            r = None if pd.isna(row["ret"]) else int(row["ret"])
            rs = None if pd.isna(row["reason"]) else str(row["reason"])
            if (o is None or r is None) and rs is None:
                raise ValueError(f"{insee}/{pid}/{mode}/{day} : valeur nulle sans raison")
            out.append(o)
            ret.append(r)
            reason.append(mark_reason(o, r, rs, basis is not None))
            dep.append(dep_hhmm(row["dep"]) if with_dep and o is not None else None)
        series: dict[str, Any] = {"out": out, "ret": ret, "reason": reason}
        if with_dep:
            series["dep"] = dep
        if basis is not None and any(r is None for r in ret):
            series["walk_limit"] = basis
        modes.setdefault(mode, {})[day] = series
    return {"insee": insee, "processing_version": PROCESSING_VERSION, "modes": modes}
