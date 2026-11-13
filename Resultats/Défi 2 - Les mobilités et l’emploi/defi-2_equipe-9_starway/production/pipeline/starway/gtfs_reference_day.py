"""Lignes du flux GTFS sans service le jour de référence (17/11/2026), et leur justification.

Pourquoi : le flux du premier calcul (02/11) avait, pour 31 lignes de bus d'un exploitant, un calendrier arrêté au 05/11.
Aucune de ces lignes ne roulait le 17/11 dans les calculs, sans que rien ne le signale. Ce module rend l'oubli impossible :
le contrôle P0 de `07_quality_checks.py` échoue tant qu'une ligne du flux sans service le jour de référence n'est pas
LISTÉE et JUSTIFIÉE.

Une ligne (`route_id` de routes.txt) est « avec service » si au moins une de ses courses est active le jour de référence
(calendar.txt, jour de la semaine et période, puis calendar_dates.txt : ajouts type 1, retraits type 2). Sinon elle reçoit
un statut :

  - `autre_jour_de_semaine` : une période de son calendrier contient le jour de référence mais ne roule pas ce jour de la
    semaine (ligne du samedi, du dimanche, des vacances...). JUSTIFIÉE AUTOMATIQUEMENT, mais toujours listée ;
  - `calendrier_termine_avant` : tous ses services finissent avant le jour de référence (le cas des 31 lignes) ;
  - `calendrier_commence_apres` : tous ses services commencent après ;
  - `trou_dans_le_calendrier` : des services avant et après, aucun autour du jour de référence ;
  - `retire_par_exception` : le calendrier roule ce jour de la semaine mais un retrait (calendar_dates) l'enlève ;
  - `sans_calendrier` : aucune course, ou des courses dont le service n'est défini nulle part.

Tous les autres statuts n'ont AUCUNE justification automatique : chaque ligne doit figurer, avec sa période et une
justification écrite, dans `data/gtfs_lignes_sans_service.csv`, pour l'empreinte exacte du flux contrôlé (une
justification ne vaut jamais pour un autre flux ni pour une autre période).

Aucune valeur de temps ou d'effet n'est calculée ici : seulement des listes de lignes.
"""

from __future__ import annotations

import csv
import zipfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pandas as pd

from starway.config import DATA_DIR, SERVICE_DATE

ALLOWLIST_PATH = DATA_DIR / "gtfs_lignes_sans_service.csv"
ALLOWLIST_COLUMNS = ["flux_sha256", "route_id", "route_short_name", "statut", "premier_jour", "dernier_jour", "justification"]
MIN_JUSTIFICATION_CHARS = 30

SERVED = "service"
OTHER_WEEKDAY = "autre_jour_de_semaine"
ENDED = "calendrier_termine_avant"
NOT_STARTED = "calendrier_commence_apres"
GAP = "trou_dans_le_calendrier"
REMOVED = "retire_par_exception"
NO_CALENDAR = "sans_calendrier"
AUTO_JUSTIFIED = frozenset({OTHER_WEEKDAY})
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


@dataclass(frozen=True)
class RouteDay:
    """Une ligne du flux et son état le jour de référence."""

    route_id: str
    short_name: str
    long_name: str
    route_type: str
    agency: str
    status: str
    trips_on_day: int
    first_day: int | None  # premier jour couvert par un de ses services (AAAAMMJJ)
    last_day: int | None  # dernier jour couvert par un de ses services

    @property
    def served(self) -> bool:
        return self.status == SERVED


@dataclass(frozen=True)
class Justification:
    flux_sha256: str
    route_id: str
    short_name: str
    status: str
    first_day: str
    last_day: str
    text: str

    @property
    def key(self) -> tuple[str, str, str, str, str]:
        return (self.flux_sha256, self.route_id, self.status, self.first_day, self.last_day)


def _read(z: zipfile.ZipFile, name: str, columns: list[str]) -> pd.DataFrame:
    if name not in z.namelist():
        return pd.DataFrame(columns=columns)
    with z.open(name) as f:
        return pd.read_csv(f, usecols=lambda c: c in columns, dtype=str, encoding="utf-8-sig")


def route_services(gtfs_zip: Path, day: date = SERVICE_DATE) -> list[RouteDay]:
    """État de chaque ligne du flux `gtfs_zip` le jour `day` (lecture seule : routes, trips, calendar, calendar_dates,
    agency ; stop_times.txt n'est pas lu)."""
    d = int(day.strftime("%Y%m%d"))
    wd = WEEKDAYS[day.weekday()]
    with zipfile.ZipFile(gtfs_zip) as z:
        cal = _read(z, "calendar.txt", ["service_id", *WEEKDAYS, "start_date", "end_date"])
        cdates = _read(z, "calendar_dates.txt", ["service_id", "date", "exception_type"])
        trips = _read(z, "trips.txt", ["trip_id", "route_id", "service_id"])
        routes = _read(z, "routes.txt", ["route_id", "route_short_name", "route_long_name", "route_type", "agency_id"])
        agency = _read(z, "agency.txt", ["agency_id", "agency_name"])
    for col in ("start_date", "end_date"):
        cal[col] = cal[col].astype(int)
    cdates["date"] = cdates["date"].astype(int)
    adds = cdates[cdates["exception_type"] == "1"]
    removes = cdates[cdates["exception_type"] == "2"]

    runs_weekday = cal[(cal[wd] == "1") & (cal["start_date"] <= d) & (cal["end_date"] >= d)]
    active = set(runs_weekday["service_id"]) | set(adds.loc[adds["date"] == d, "service_id"])
    active -= set(removes.loc[removes["date"] == d, "service_id"])
    removed_on_day = set(removes.loc[removes["date"] == d, "service_id"]) & set(runs_weekday["service_id"])
    covers_day = set(cal.loc[(cal["start_date"] <= d) & (cal["end_date"] >= d), "service_id"])

    first = pd.concat([cal.set_index("service_id")["start_date"],
                       adds.groupby("service_id")["date"].min()], axis=1).min(axis=1)
    last = pd.concat([cal.set_index("service_id")["end_date"],
                      adds.groupby("service_id")["date"].max()], axis=1).max(axis=1)
    defined = set(first.index)

    per_route = {rid: g["service_id"].tolist()
                 for rid, g in trips[["route_id", "service_id"]].drop_duplicates().groupby("route_id")}
    n_on_day = trips[trips["service_id"].isin(active)].groupby("route_id").size().to_dict()
    names = routes.merge(agency, on="agency_id", how="left")
    out: list[RouteDay] = []
    for r in names.itertuples(index=False):
        services = per_route.get(r.route_id, [])
        known = [s for s in services if s in defined]
        lo = int(min(first[s] for s in known)) if known else None
        hi = int(max(last[s] for s in known)) if known else None
        n = int(n_on_day.get(r.route_id, 0))
        if n > 0:
            status = SERVED
        elif not known:
            status = NO_CALENDAR
        elif any(s in removed_on_day for s in known):
            status = REMOVED
        elif any(s in covers_day for s in known):
            status = OTHER_WEEKDAY
        elif hi is not None and hi < d:
            status = ENDED
        elif lo is not None and lo > d:
            status = NOT_STARTED
        else:
            status = GAP
        out.append(RouteDay(str(r.route_id), str(r.route_short_name), str(r.route_long_name), str(r.route_type),
                            "" if pd.isna(r.agency_name) else str(r.agency_name), status, n, lo, hi))
    return out


# --------------------------------------------------------------------------- justifications écrites
def read_allowlist(path: Path = ALLOWLIST_PATH) -> list[Justification]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    return [Justification(r["flux_sha256"].strip().lower(), r["route_id"].strip(), r["route_short_name"].strip(),
                          r["statut"].strip(), r["premier_jour"].strip(), r["dernier_jour"].strip(),
                          r["justification"].strip()) for r in rows]


def _day(v: int | None) -> str:
    return "" if v is None else str(v)


def unjustified(rows: list[RouteDay], flux_sha256: str, allowlist: list[Justification]) -> list[RouteDay]:
    """Lignes sans service le jour de référence qui ne sont ni justifiées automatiquement ni écrites dans la liste pour CE
    flux (même empreinte, même statut, même période) avec une justification assez détaillée."""
    ok = {j.key for j in allowlist if len(j.text) >= MIN_JUSTIFICATION_CHARS}
    return [r for r in rows if not r.served and r.status not in AUTO_JUSTIFIED
            and (flux_sha256.lower(), r.route_id, r.status, _day(r.first_day), _day(r.last_day)) not in ok]


def unused_entries(rows: list[RouteDay], flux_sha256: str, allowlist: list[Justification]) -> list[Justification]:
    """Justifications écrites pour ce flux qui ne correspondent plus à aucune ligne sans service (à retirer)."""
    live = {(flux_sha256.lower(), r.route_id, r.status, _day(r.first_day), _day(r.last_day))
            for r in rows if not r.served}
    return [j for j in allowlist if j.flux_sha256 == flux_sha256.lower() and j.key not in live]


def report(rows: list[RouteDay], flux_sha256: str, allowlist: list[Justification]) -> list[dict[str, str]]:
    """Toutes les lignes sans service le jour de référence, avec leur justification (liste écrite) ou `automatique`, ou
    `AUCUNE` (le contrôle échoue). Aucune ligne n'est omise."""
    texts = {j.key: j.text for j in allowlist}
    out = []
    for r in sorted((x for x in rows if not x.served), key=lambda x: (x.status, x.agency, x.short_name, x.route_id)):
        key = (flux_sha256.lower(), r.route_id, r.status, _day(r.first_day), _day(r.last_day))
        if r.status in AUTO_JUSTIFIED:
            why = "automatique : une période du calendrier contient le jour de référence, mais pas ce jour de la semaine"
        else:
            why = texts.get(key) or "AUCUNE"
        out.append({"route_id": r.route_id, "ligne": r.short_name, "nom": r.long_name, "type": r.route_type,
                    "exploitant": r.agency, "statut": r.status, "premier_jour": _day(r.first_day),
                    "dernier_jour": _day(r.last_day), "justification": why})
    return out


def summary(rows: list[RouteDay]) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in rows:
        out[r.status] = out.get(r.status, 0) + 1
    return dict(sorted(out.items()))
