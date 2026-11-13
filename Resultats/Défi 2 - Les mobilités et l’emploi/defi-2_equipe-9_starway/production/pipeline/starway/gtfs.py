"""Lecture du GTFS IDFM (TRA01) : services actifs à une date, départs par arrêt parent.

« Départ » = ligne de stop_times.txt d'une course active ce jour-là dont `pickup_type` vaut 0 ou est vide
(montée possible sans réservation). Les montées sur réservation (pickup_type 2 ou 3, transport à la demande)
et l'absence de montée (1, ex. terminus) ne sont pas comptées.
"""

from __future__ import annotations

import zipfile
from datetime import date
from pathlib import Path

import pandas as pd


def active_service_ids(gtfs_zip: Path, day: date) -> set[str]:
    ds = day.strftime("%Y%m%d")
    wd = day.strftime("%A").lower()
    with zipfile.ZipFile(gtfs_zip) as z:
        cal = pd.read_csv(z.open("calendar.txt"), dtype=str)
        cd = pd.read_csv(z.open("calendar_dates.txt"), dtype=str)
    active = set(cal[(cal.start_date <= ds) & (cal.end_date >= ds) & (cal[wd] == "1")].service_id)
    active |= set(cd[(cd.date == ds) & (cd.exception_type == "1")].service_id)
    active -= set(cd[(cd.date == ds) & (cd.exception_type == "2")].service_id)
    return active


def active_trip_ids(gtfs_zip: Path, day: date) -> set[str]:
    services = active_service_ids(gtfs_zip, day)
    with zipfile.ZipFile(gtfs_zip) as z:
        trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["trip_id", "service_id"])
    return set(trips.loc[trips["service_id"].isin(services), "trip_id"])


def departures_by_parent_stop(gtfs_zip: Path, day: date, chunksize: int = 2_000_000) -> pd.DataFrame:
    """Nombre de départs par arrêt parent (location_type=1) le jour `day`. stop_times.txt est lu par morceaux.
    Colonnes : stop_id, stop_name, lon, lat, departures."""
    trips = active_trip_ids(gtfs_zip, day)
    counts: pd.Series | None = None
    with zipfile.ZipFile(gtfs_zip) as z:
        stops = pd.read_csv(z.open("stops.txt"), dtype=str)
        with z.open("stop_times.txt") as f:
            for ch in pd.read_csv(f, dtype=str, usecols=["trip_id", "stop_id", "pickup_type"], chunksize=chunksize):
                pt = ch["pickup_type"].fillna("0")
                ch = ch[ch["trip_id"].isin(trips) & (pt == "0")]
                c = ch["stop_id"].value_counts()
                counts = c if counts is None else counts.add(c, fill_value=0)
    assert counts is not None
    quay_parent = stops.set_index("stop_id")["parent_station"]
    by_parent = counts.groupby(counts.index.map(lambda s: quay_parent.get(s) or s)).sum()
    parents = stops[stops["location_type"] == "1"].set_index("stop_id")
    out = pd.DataFrame({"departures": by_parent.astype(int)})
    out = out.join(parents[["stop_name", "stop_lon", "stop_lat"]], how="inner")
    out = out.rename(columns={"stop_lon": "lon", "stop_lat": "lat"}).reset_index(names="stop_id")
    out["lon"] = out["lon"].astype(float)
    out["lat"] = out["lat"].astype(float)
    return out.sort_values(["departures", "stop_id"], ascending=[False, True]).reset_index(drop=True)


def most_served_in(stops: pd.DataFrame, n: int = 2) -> pd.DataFrame:
    """Les `n` arrêts les plus desservis (égalité : stop_id croissant, déterministe)."""
    return stops.sort_values(["departures", "stop_id"], ascending=[False, True]).head(n)
