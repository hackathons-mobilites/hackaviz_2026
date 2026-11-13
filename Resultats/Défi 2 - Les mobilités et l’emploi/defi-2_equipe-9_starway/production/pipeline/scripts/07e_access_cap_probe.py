"""07e - Allers TC perdus par le réglage « normal » (D-024) : la marche d'accès plafonnée à 50 min en est-elle la cause ?

Lecture seule de data/interim/matrix/ (réglage R5 d'origine, accès borné par la durée maximale de 120 min, sortie
2 000 m) et de data/interim/matrix_walk3000/ (« normal » : accès borné à max_time_walking = 50 min, sortie 3 000 m).
Aucun r5py, aucune donnée publiée modifiée.

1. Bilan (sans réseau) : allers trouvés avec le réglage d'origine et perdus en « normal » (null après la règle d'export
   de 06), par journée-type ; durée d'origine ; distance à vol d'oiseau du point d'origine à l'arrêt le plus proche
   qui a au moins un départ le jour de service (data/interim/gtfs_departures_20261117.csv) ; retours perdus.
2. Sonde Navitia (`--probe N`, N allers perdus par journée-type, tirés dans l'ordre (commune, pôle), 2 requêtes par
   aller, cache de 07d) : même requête que 07d, une fois avec l'accès borné à 50 min (« normal ») et une fois à
   120 min (réglage d'origine). Si Navitia ne trouve l'aller qu'avec 120 min et que son trajet marche plus de 50 min,
   le plafond d'accès explique la perte pour cet aller.

Sortie : data/processed/access_cap_losses_walk3000.csv (un aller perdu par ligne, colonnes de la sonde si demandée).
Usage :
    python scripts/07e_access_cap_probe.py               # bilan seul
    python scripts/07e_access_cap_probe.py --probe 2     # + sonde Navitia (au plus 2 x 3 x 2 = 12 requêtes)
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math

import numpy as np
import pandas as pd

from starway.config import (
    DAY_TYPES_BY_ID,
    FRONT_DATA_DIR,
    POLES_15_JSON,
    INTERIM_DIR,
    MAX_TRIP_MIN,
    OUTBOUND_LOOKBACK_MIN,
    OUTBOUND_STEP_MIN,
    PIPELINE_DIR,
    PROCESSED_DIR,
    SERVICE_DATE,
    SPEED_WALKING_KMH,
    WALK_SETTINGS_M,
)
from starway.matrix_io import cap_to_max_trip
from starway.navitia import (
    Trip,
    aligned_settings,
    cache_key,
    coord,
    day_bounds,
    navitia_error,
    outbound_value,
    parse_journeys,
    request_params,
)
from starway.r5jar import walk_time_limit_min
from starway.variant_compare import paired

SETTING = "normal"
OUT = PROCESSED_DIR / f"access_cap_losses_walk{WALK_SETTINGS_M[SETTING]}.csv"
R5_ORIGINAL_EGRESS_M = 2000  # constante de R5 v7.5.1 (starway.egress.R5_WALK_EGRESS_LIMIT_M)
EARTH_RADIUS_M = 6_371_000


def load(run: str, day: str) -> pd.DataFrame:
    df = pd.read_csv(INTERIM_DIR / run / f"transit_{day}.csv", dtype={"from_id": str, "to_id": str, "reason": str})
    return cap_to_max_trip(df)


def nearest_stop_m(lon: float, lat: float, slon: np.ndarray, slat: np.ndarray) -> int:
    """Distance à vol d'oiseau (haversine) du point à l'arrêt le plus proche (radians pour slon / slat)."""
    la, lo = math.radians(lat), math.radians(lon)
    a = np.sin((slat - la) / 2) ** 2 + math.cos(la) * np.cos(slat) * np.sin((slon - lo) / 2) ** 2
    return round(float((2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(a))).min()))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--probe", type=int, default=0, help="allers perdus sondés avec Navitia, par journée-type")
    args = ap.parse_args()

    communes = {c["insee"]: c for c in json.loads((FRONT_DATA_DIR / "communes.json").read_text(encoding="utf-8"))}
    poles = {p["id"]: p for p in json.loads(POLES_15_JSON.read_text(encoding="utf-8"))}
    stops = pd.read_csv(INTERIM_DIR / "gtfs_departures_20261117.csv")
    stops = stops[stops["departures"] > 0]
    slon, slat = np.radians(stops["lon"].to_numpy()), np.radians(stops["lat"].to_numpy())

    rows = []
    for day in DAY_TYPES_BY_ID:
        m = paired(load("matrix", day), load(f"matrix_walk{WALK_SETTINGS_M[SETTING]}", day))
        lost = m[m["out_pub"].notna() & m["out_var"].isna()].sort_values(["from_id", "to_id"])
        ret_lost = int((m["ret_pub"].notna() & m["ret_var"].isna()).sum())
        longer = int((m["out_pub"].notna() & m["out_var"].notna() & (m["out_var"] > m["out_pub"])).sum())
        print(f"{day} : {len(lost)} allers perdus ({lost['from_id'].nunique()} communes), durée d'origine "
              f"{lost['out_pub'].min()} à {lost['out_pub'].max()} min (médiane {lost['out_pub'].median():g}) ; "
              f"{longer} allers plus longs ; {ret_lost} retours perdus")
        for _, r in lost.iterrows():
            c = communes[r["from_id"]]
            rows.append({"day": day, "insee": r["from_id"], "commune": c["name"], "pole_id": r["to_id"],
                         "out_r5_original": int(r["out_pub"]), "dep_r5_original": r["dep_pub"],
                         "nearest_served_stop_m": nearest_stop_m(c["origin"]["lon"], c["origin"]["lat"], slon, slat)})
    df = pd.DataFrame(rows)
    near = df.groupby(["day", "insee"])["nearest_served_stop_m"].first()
    print(f"arrêt desservi le plus proche (vol d'oiseau) : médiane {near.median():g} m, maximum {near.max()} m, "
          f"{int((near > WALK_SETTINGS_M[SETTING]).sum())} commune-journées au-delà de {WALK_SETTINGS_M[SETTING]} m")

    if args.probe:
        spec = importlib.util.spec_from_file_location("crosscheck", PIPELINE_DIR / "scripts" / "07d_navitia_crosscheck.py")
        cc = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cc)
        client = cc.Client(offline=False, max_requests=args.probe * len(DAY_TYPES_BY_ID) * 2)
        lim = WALK_SETTINGS_M[SETTING]
        cap = aligned_settings(SPEED_WALKING_KMH, MAX_TRIP_MIN, lim, cc.R5_MAX_PUBLIC_TRANSPORT_RIDES,
                               walk_time_limit_min(lim, SPEED_WALKING_KMH))
        # même sortie que « normal » (3 000 m), accès et marche seule à la durée maximale : seul l'accès change
        nocap = aligned_settings(SPEED_WALKING_KMH, MAX_TRIP_MIN, lim, cc.R5_MAX_PUBLIC_TRANSPORT_RIDES)
        picked = df.groupby("day", group_keys=False).head(args.probe).index
        for i in picked:
            r = df.loc[i]
            dt = DAY_TYPES_BY_ID[r["day"]]
            start, _ = day_bounds(SERVICE_DATE, dt.start, dt.end)
            c, p = communes[r["insee"]], poles[r["pole_id"]]
            here, there = coord(c["origin"]["lon"], c["origin"]["lat"]), coord(p["point"]["lon"], p["point"]["lat"])
            t = Trip(r["insee"], r["pole_id"], r["day"], "out")
            for tag, s in (("cap50", cap), ("cap120", nocap)):
                params = request_params(here, there, start, "arrival", "out", s)
                rec = client.get(f"probe_{tag}_{cache_key(t, params)}", "/journeys", params)
                err = navitia_error(rec.get("body"), rec.get("status_code")) if rec else "not_requested"
                js = parse_journeys(rec["body"]) if rec and rec.get("body") and not err else []
                nv = outbound_value(js, start, OUTBOUND_STEP_MIN, OUTBOUND_LOOKBACK_MIN, MAX_TRIP_MIN)
                df.loc[i, f"navitia_{tag}_min"] = nv.minutes
                df.loc[i, f"navitia_{tag}_walking_min"] = round(nv.journey.walking_s / 60, 1) if nv.journey else None
                df.loc[i, f"navitia_{tag}_lines"] = " > ".join(nv.journey.lines) if nv.journey else (err or nv.reason)
        print(f"sonde Navitia : {client.sent} requêtes envoyées"
              + (f" ; arrêt : {client.stopped}" if client.stopped else ""))
        cols = ["day", "insee", "commune", "pole_id", "out_r5_original", "navitia_cap50_min", "navitia_cap120_min",
                "navitia_cap120_walking_min", "navitia_cap120_lines"]
        print(df.loc[picked, cols].to_string(index=False))
    elif OUT.exists():  # garde les colonnes d'une sonde précédente (idempotent)
        old = pd.read_csv(OUT, dtype={"insee": str})
        extra = [c for c in old.columns if c.startswith("navitia_")]
        if extra:
            df = df.merge(old[["day", "insee", "pole_id", *extra]], on=["day", "insee", "pole_id"], how="left")
    df.to_csv(OUT, index=False, encoding="utf-8")
    print(f"Écrit : {OUT} ({len(df)} lignes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
