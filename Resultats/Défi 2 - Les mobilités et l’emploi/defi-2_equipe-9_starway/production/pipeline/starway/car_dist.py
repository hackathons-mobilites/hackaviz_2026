"""Distances routières voiture (04g) : commune (point D-017) <-> pôle (point d'ancrage), aller et retour.

Demande de Nicolas (03/11) : un coût carburant = distance routière x consommation moyenne x prix du carburant. r5py
`TravelTimeMatrix` ne donne que des minutes ; `DetailedItineraries` donne, pour un trajet voiture direct, la distance
du chemin trouvé par R5 (`StreetPath.getDistance()`, millimètres convertis en mètres par r5py) et sa durée.

Logique pure (sans r5py ni Java), testée dans tests/test_car_dist.py :
- `pair_frames` : couples d'un lot avec des identifiants uniques (r5py retrouve chaque point par son identifiant) ;
- `summarize_itineraries` : une ligne par couple (somme des segments de l'option 0), `null` + raison si aucun trajet ;
- `compare_minutes` : écart entre la durée de l'itinéraire et la minute de la matrice voiture publiée ;
- `estimate_hours` : durée totale extrapolée d'un banc d'essai (débit mesuré, pas une hypothèse).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

import pandas as pd

SEP = "|"  # identifiant de couple : "{insee}|{pole}|{sens}"
DIRECTIONS = ("out", "ret")  # out = commune vers pôle, ret = pôle vers commune
REASON_NO_ROUTE = "no_route"  # R5 n'a trouvé aucun chemin voiture (r5py : « Could not find route »)
REASON_NOT_SNAPPED = "origin_not_snapped"
COLUMNS = ["insee", "pole_id", "direction", "distance_m", "duration_s", "reason", "toll_checked", "toll_nodes",
           "toll_ways"]
BENCH_SEED = 20261117  # graine du tirage du banc d'essai (reproductibilité seulement, sans effet sur les résultats)


def pair_id(insee: str, pole: str, direction: str) -> str:
    if direction not in DIRECTIONS:
        raise ValueError(f"sens inconnu {direction!r}")
    return SEP.join((insee, pole, direction))


def split_pair_id(pid: str) -> tuple[str, str, str]:
    insee, pole, direction = pid.split(SEP)
    return insee, pole, direction


def pair_frames(lot: Sequence[str], communes: pd.DataFrame, poles: pd.DataFrame,
                lon: str, lat: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(origines, destinations) alignées ligne à ligne (routage un pour un de DetailedItineraries) : pour chaque
    commune du lot et chaque pôle, un couple aller (commune -> pôle) puis un couple retour (pôle -> commune).
    Colonnes id, lon, lat ; l'identifiant du couple est porté par les deux lignes."""
    c = communes.set_index("insee")
    o_rows: list[dict[str, Any]] = []
    d_rows: list[dict[str, Any]] = []
    for insee in lot:
        cx, cy = float(c.at[insee, lon]), float(c.at[insee, lat])
        for p in poles.itertuples(index=False):
            for direction in DIRECTIONS:
                pid = pair_id(insee, p.id, direction)
                a, b = ((cx, cy), (p.lon, p.lat)) if direction == "out" else ((p.lon, p.lat), (cx, cy))
                o_rows.append({"id": pid, "lon": a[0], "lat": a[1]})
                d_rows.append({"id": pid, "lon": b[0], "lat": b[1]})
    return pd.DataFrame(o_rows), pd.DataFrame(d_rows)


def bench_sample(communes: Sequence[str], poles: Sequence[str], n: int, commune: str | None) -> list[str]:
    """Couples du banc d'essai : `n` couples (commune, pôle, sens) tirés au hasard sans remise (graine fixe), plus
    tous les couples de `commune` (si elle fait partie des communes). Ordre : tirage, puis couples de `commune`."""
    import random

    every = [pair_id(c, p, d) for c in communes for p in poles for d in DIRECTIONS]
    drawn = random.Random(BENCH_SEED).sample(every, min(n, len(every)))
    extra = [pair_id(commune, p, d) for p in poles for d in DIRECTIONS] if commune in set(communes) else []
    return drawn + [x for x in extra if x not in set(drawn)]


def summarize_itineraries(details: pd.DataFrame, pair_ids: Sequence[str],
                          unsnapped: Sequence[str] = (),
                          tolls_by_pair: dict[str, tuple[list[int], list[int]]] | None = None,
                          toll_checked: bool = False) -> pd.DataFrame:
    """Une ligne par couple demandé. `details` : sortie de DetailedItineraries (from_id, to_id, option, distance en
    mètres, travel_time timedelta), un pour un (from_id = to_id = identifiant du couple). Option 0 seulement (le seul
    trajet direct voiture que rend r5py) ; distance et durée = somme de ses segments. Couple absent : `null` +
    `no_route` ; couple dont un point n'est pas accroché au réseau : `null` + `origin_not_snapped`.
    Péages : `toll_checked` dit si le relevé a été fait ; `toll_nodes` / `toll_ways` = identifiants OSM séparés par
    « ; », vides si aucun (ou si non relevé, ou sans trajet)."""
    rows: list[dict[str, Any]] = []
    got: dict[str, tuple[float, float]] = {}
    if len(details):
        d = details[details["option"] == 0]
        bad = d[d["from_id"] != d["to_id"]]
        if len(bad):
            raise ValueError(f"routage un pour un attendu : {len(bad)} segments entre deux couples différents")
        secs = d["travel_time"].map(lambda t: t.total_seconds() if hasattr(t, "total_seconds") else float(t))
        agg = pd.DataFrame({"id": d["from_id"], "m": d["distance"].astype(float), "s": secs}).groupby("id").sum()
        got = {str(k): (float(r.m), float(r.s)) for k, r in agg.iterrows()}
    skip = set(unsnapped)
    for pid in pair_ids:
        insee, pole, direction = split_pair_id(pid)
        if pid in skip:
            rows.append({"insee": insee, "pole_id": pole, "direction": direction, "distance_m": None,
                         "duration_s": None, "reason": REASON_NOT_SNAPPED, "toll_checked": False})
        elif pid in got and not any(math.isnan(v) for v in got[pid]):
            m, s = got[pid]
            tn, tw = (tolls_by_pair or {}).get(pid, ([], []))
            rows.append({"insee": insee, "pole_id": pole, "direction": direction, "distance_m": round(m),
                         "duration_s": round(s), "reason": None, "toll_checked": bool(toll_checked),
                         "toll_nodes": ";".join(map(str, tn)) or None, "toll_ways": ";".join(map(str, tw)) or None})
        else:
            rows.append({"insee": insee, "pole_id": pole, "direction": direction, "distance_m": None,
                         "duration_s": None, "reason": REASON_NO_ROUTE, "toll_checked": False})
    out = pd.DataFrame(rows, columns=COLUMNS)
    out["distance_m"] = out["distance_m"].astype("Int64")
    out["duration_s"] = out["duration_s"].astype("Int64")
    return out


def compare_minutes(dist: pd.DataFrame, matrix: pd.DataFrame) -> dict[str, Any]:
    """Durée de l'itinéraire (s) contre la minute de la matrice voiture publiée (`car_any.csv` : from_id, to_id, out,
    ret). Écart = minutes de la matrice - durée / 60. Rend la distribution des écarts (couples connus des deux côtés)."""
    m = matrix.set_index(["from_id", "to_id"])
    diffs: list[float] = []
    ratios: list[float] = []
    missing = 0
    for r in dist.itertuples(index=False):
        if pd.isna(r.duration_s):
            continue
        key = (r.insee, r.pole_id)
        v = m.at[key, r.direction] if key in m.index else None
        if v is None or pd.isna(v):
            missing += 1
            continue
        diffs.append(float(v) - float(r.duration_s) / 60)
        if float(v) > 0:
            ratios.append(float(r.duration_s) / 60 / float(v))
    if not diffs:
        return {"pairs": 0, "matrix_missing": missing}
    s = pd.Series(diffs)
    return {"pairs": len(diffs), "matrix_missing": missing, "diff_min_median": round(float(s.median()), 2),
            "diff_min_min": round(float(s.min()), 2), "diff_min_max": round(float(s.max()), 2),
            "abs_diff_le_1_min_share": round(float((s.abs() <= 1).mean()), 4),
            "ratio_itinerary_over_matrix_median": round(float(pd.Series(ratios).median()), 4) if ratios else None,
            "ratio_itinerary_over_matrix_p05": round(float(pd.Series(ratios).quantile(0.05)), 4) if ratios else None,
            "ratio_itinerary_over_matrix_p95": round(float(pd.Series(ratios).quantile(0.95)), 4) if ratios else None,
            "rule": "écart = minutes de la matrice voiture publiée - durée de l'itinéraire / 60"}


def estimate_hours(seconds: float, pairs_measured: int, pairs_total: int) -> float:
    """Durée totale (h) au débit mesuré par le banc d'essai (mêmes fils, même charge de la machine)."""
    if pairs_measured <= 0 or seconds <= 0:
        raise ValueError("banc d'essai vide")
    return seconds / pairs_measured * pairs_total / 3600


CORRECTED_DIR_NAME = "car_dist_carspeed_v2"  # 04g, carSpeed fixé, péages relevés avec la troncature de R5 (04/11)
FIRST_CARSPEED_DIR_NAME = "car_dist_carspeed"  # 04g du 03/11 : distances justes, péages sous-relevés (jamais publié)


def load_corrected(out_dir, pole_ids: Sequence[str], origin_ids: Sequence[str], manifest_sha: dict[str, str],
                   points_sha: str, matrix: pd.DataFrame | None = None,
                   tolls_sha: str | None = None) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Distances corrigées de 04g pour 06 : (par commune {dist_*, reason_*, toll_nodes_*, toll_ways_*, dur_*},
    description). Rien n'est rendu (statut `pending` ou `refused`) si le calcul n'est pas complet, si ses empreintes ne
    sont pas celles du jeu publié, si `carSpeed` n'a pas été fixé (anciennes distances) ou si les péages ont été relevés
    sans la troncature de R5 (`toll_key_rule` absent : relevé du 03/11)."""
    import json
    from pathlib import Path

    d = Path(out_dir)
    rp_path = d / "run_params.json"
    if not rp_path.exists():
        return {}, {"status": "pending", "reason": f"{CORRECTED_DIR_NAME}/run_params.json absent : calcul 04g corrigé "
                                                  "pas encore rapatrié"}
    rp = json.loads(rp_path.read_text(encoding="utf-8"))
    problems = []
    if not rp.get("car_speed_mps"):
        problems.append("carSpeed non fixé (anciennes distances)")
    from starway import flux  # voiture : aucun transport en commun, non relancée avec le flux du 06/11

    if rp.get("gtfs_sha256") not in flux.accepted_gtfs_shas("TRA01", manifest_sha, non_transit=True):
        problems.append("gtfs_sha256 différent du manifeste TRA01 (ni le flux courant ni un flux précédent)")
    if rp.get("osm_sha256") != manifest_sha.get("CYC01"):
        problems.append("osm_sha256 différent du manifeste CYC01")
    if rp.get("origin_points_sha256") != points_sha:
        problems.append("points d'origine différents (D-017)")
    if not rp.get("toll_key_rule"):
        problems.append("péages relevés sans la troncature de R5 (relevé du 03/11, 28 nœuds sur 152 jamais reconnus)")
    if tolls_sha is not None and rp.get("tolls_sha256") != tolls_sha:
        problems.append("osm_toll_points.json (04i) différent de celui du calcul")
    files = sorted((d / "batches").glob("batch_*.csv"))
    df = pd.concat([pd.read_csv(f, dtype={"insee": str, "pole_id": str}) for f in files]) if files else pd.DataFrame(
        columns=COLUMNS)
    want = len(origin_ids) * len(pole_ids) * len(DIRECTIONS)
    if len(df) != want or df.duplicated(["insee", "pole_id", "direction"]).any():
        problems.append(f"{len(df)} couples dans les lots, {want} attendus (ou doublons)")
    if problems:
        return {}, {"status": "refused" if rp.get("car_speed_mps") is None else "pending", "reason": " ; ".join(
            problems)}
    idx = {p: i for i, p in enumerate(pole_ids)}
    res: dict[str, dict[str, Any]] = {}
    for insee, g in df.groupby("insee"):
        e: dict[str, Any] = {f"{k}_{dr}": [None] * len(pole_ids) for k in ("dist", "reason", "toll_nodes",
                                                                         "toll_ways", "dur") for dr in DIRECTIONS}
        for r in g.itertuples(index=False):
            i, dr = idx[r.pole_id], r.direction
            e[f"dist_{dr}"][i] = None if pd.isna(r.distance_m) else int(r.distance_m)
            e[f"dur_{dr}"][i] = None if pd.isna(r.duration_s) else int(r.duration_s)
            e[f"reason_{dr}"][i] = None if pd.isna(r.reason) else str(r.reason)
            tn = getattr(r, "toll_nodes", None)
            e[f"toll_nodes_{dr}"][i] = [] if tn is None or pd.isna(tn) else [int(x) for x in str(tn).split(";")]
            tw = getattr(r, "toll_ways", None)
            e[f"toll_ways_{dr}"][i] = [] if tw is None or pd.isna(tw) else [int(x) for x in str(tw).split(";")]
        res[str(insee)] = e
    info: dict[str, Any] = {"status": "ok", "run": CORRECTED_DIR_NAME, "car_speed_mps": rp["car_speed_mps"],
                            "car_speed_rule": rp.get("car_speed_rule"), "pairs": len(df),
                            "no_route": int(df["reason"].eq(REASON_NO_ROUTE).sum()),
                            "distance_rule": rp.get("distance_rule"), "toll_rule": rp.get("toll_rule"),
                            "toll_key_rule": rp.get("toll_key_rule"),
                            "tolls_checked": bool(df.get("toll_checked", pd.Series([False])).fillna(False).all())}
    if matrix is not None:
        info["agreement_with_car_matrix"] = compare_minutes(df, matrix)
    return res, info
