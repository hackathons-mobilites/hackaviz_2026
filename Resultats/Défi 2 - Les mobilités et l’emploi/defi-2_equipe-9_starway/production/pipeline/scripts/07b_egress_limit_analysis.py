"""07b - Limite de marche finale de R5 (2 000 m) : combien de verdicts « aucun retour TC » peut-elle expliquer ?

Lecture et analyse seulement : ni r5py ni Java, la matrice, `frontend/` et `insights.json` ne sont pas modifiés.

Pour chaque commune (point D-017) et chaque fin de poste E (14:00, 17:00, 22:00 le jour de service) :
- arrêts « desservis » = quais GTFS (location_type 0) où une course active ce jour-là permet de DESCENDRE avec une
  heure d'arrivée dans [E, E + 120 min] (règle de descente de R5 : `drop_off_type` différent de 1) ;
- distance à vol d'oiseau (Lambert-93, EPSG:2154) du point de la commune au plus proche de ces quais ;
- les verdicts publiés (`frontend/public/data/access/{insee}.json`, mode transit) dont `ret` est null sont classés :
  moins de 2 km / entre 2 km et la portée à pied en 120 min / au-delà (voir starway.egress) ;
- indice relais (starway.egress.relay_returns) : retour publié vers une autre commune + marche à vol d'oiseau.
Option `--network` : distance sur un réseau piéton OSM approché (`walk_graph`) pour un échantillon (`default_sample`).
Option `--diagnose INSEE DAY` : quais desservis près d'une commune, avec lignes et heures d'arrivée.

Sorties : data/processed/egress_limit_2026.csv (commune x fin de poste), data/processed/egress_limit_insights.csv,
data/interim/egress_limit_pairs.csv (commune x pôle x fin de poste, non versionné),
data/processed/egress_limit_network_sample.csv (si --network), data/processed/egress_limit_diag_{insee}_{day}.csv
(si --diagnose) ; résumé imprimé, repris dans docs/analyse-limite-marche-r5.md.
Mémoire : stop_times.txt lu par morceaux ; attente tant que la mémoire libre est sous 3 000 Mo avant chaque lecture
lourde.
"""

from __future__ import annotations

import argparse
import json
import time
import zipfile
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import psutil
from pyproj import Transformer
from scipy.spatial import cKDTree

from starway.config import (
    BUDGETS_MIN,
    DAY_TYPES,
    FRONT_DATA_DIR,
    POLES_15_JSON,
    INTERIM_DIR,
    MAX_TRIP_MIN,
    PROCESSED_DIR,
    RAW_DIR,
    SERVICE_DATE,
    SPEED_WALKING_KMH,
)
from starway.egress import (
    CAT_NEAR,
    CATEGORIES,
    R5_WALK_EGRESS_LIMIT_M,
    alighting_allowed,
    classify,
    gtfs_seconds,
    relay_returns,
    walk_reach_m,
)
from starway.gtfs import active_trip_ids

GTFS = RAW_DIR / "TRA01" / "IDFM-gtfs.zip"
OSM = RAW_DIR / "CYC01" / "ile-de-france-latest.osm.pbf"
OUT_CSV = PROCESSED_DIR / "egress_limit_2026.csv"
OUT_INSIGHTS = PROCESSED_DIR / "egress_limit_insights.csv"
OUT_NETWORK = PROCESSED_DIR / "egress_limit_network_sample.csv"
OUT_PAIRS = INTERIM_DIR / "egress_limit_pairs.csv"  # commune x pôle x journée (audit, non versionné)
MIN_FREE_MB = 3000
TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
WALK_REACH_M = walk_reach_m(MAX_TRIP_MIN, SPEED_WALKING_KMH)  # 7 200 m


def wait_for_memory(label: str) -> None:
    """Attend que la mémoire disponible dépasse MIN_FREE_MB (consigne : 60 s entre deux essais)."""
    while (free := psutil.virtual_memory().available // 2**20) < MIN_FREE_MB:
        print(f"[{label}] mémoire libre {free} Mo < {MIN_FREE_MB} Mo : attente 60 s")
        time.sleep(60)
    print(f"[{label}] mémoire libre {free} Mo")


def windows() -> dict[str, tuple[int, int]]:
    """Fenêtres d'arrivée [E, E + 120 min] (retour) en secondes depuis minuit, par journée-type."""
    out = {}
    for d in DAY_TYPES:
        e = d.end.hour * 3600 + d.end.minute * 60
        out[d.id] = (e, e + MAX_TRIP_MIN * 60)
    return out


def served_quays(chunksize: int = 1_000_000) -> tuple[pd.DataFrame, dict[str, pd.Series]]:
    """Quais (location_type 0) et, par journée-type, première arrivée (s) avec descente possible dans la fenêtre.
    Lignes sans heure d'arrivée ni de départ (transport à la demande à fenêtre) ignorées : aucune heure à tester."""
    wait_for_memory("trips")
    trips = active_trip_ids(GTFS, SERVICE_DATE)
    win = windows()
    first: dict[str, pd.Series] = {}
    first_regular: dict[str, set[str]] = {k: set() for k in win}
    wait_for_memory("stop_times")
    n = 0
    with zipfile.ZipFile(GTFS) as z:
        stops = pd.read_csv(z.open("stops.txt"), dtype=str)
        with z.open("stop_times.txt") as f:
            cols = ["trip_id", "arrival_time", "departure_time", "stop_id", "drop_off_type"]
            for ch in pd.read_csv(f, dtype=str, usecols=cols, chunksize=chunksize):
                n += len(ch)
                ch = ch[ch["trip_id"].isin(trips)]
                t = gtfs_seconds(ch["arrival_time"].fillna(ch["departure_time"]))
                ok = alighting_allowed(ch["drop_off_type"]) & t.notna()
                regular = ch["drop_off_type"].fillna("0").str.strip().isin(["0", ""])
                for k, (a, b) in win.items():
                    m = ok & (t >= a) & (t <= b)
                    s = t[m].groupby(ch.loc[m, "stop_id"]).min()
                    first[k] = s if k not in first else pd.concat([first[k], s]).groupby(level=0).min()
                    first_regular[k] |= set(ch.loc[m & regular, "stop_id"])
                if n % 10_000_000 < chunksize:
                    print(f"  stop_times : {n:,} lignes lues")
    quays = stops[stops["location_type"].fillna("0").isin(["0", ""])].copy()
    quays["lon"] = quays["stop_lon"].astype(float)
    quays["lat"] = quays["stop_lat"].astype(float)
    quays["x"], quays["y"] = TO_L93.transform(quays["lon"].to_numpy(), quays["lat"].to_numpy())
    parents = stops.set_index("stop_id")["stop_name"]
    quays["parent_name"] = quays["parent_station"].map(parents).fillna(quays["stop_name"])
    quays = quays.set_index("stop_id")[["stop_name", "parent_station", "parent_name", "lon", "lat", "x", "y"]]
    for k in win:
        quays[f"first_{k}"] = first[k].reindex(quays.index)
        quays[f"regular_{k}"] = quays.index.isin(first_regular[k])
    print(f"stop_times : {n:,} lignes ; {len(trips):,} courses actives le {SERVICE_DATE}")
    return quays, first


def hhmm(sec: float) -> str | None:
    if pd.isna(sec):
        return None
    sec = int(sec)
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}"


def load_communes() -> pd.DataFrame:
    c = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str, "dep": str})
    c = c[c["is_origin"]].copy()
    c["x"], c["y"] = TO_L93.transform(c["origin_lon"].to_numpy(), c["origin_lat"].to_numpy())
    return c[["insee", "name", "dep", "population", "origin_lon", "origin_lat", "x", "y"]].reset_index(drop=True)


def load_access(insees: list[str]) -> dict[str, dict]:
    out = {}
    for i in insees:
        out[i] = json.loads((FRONT_DATA_DIR / "access" / f"{i}.json").read_text(encoding="utf-8"))["modes"]
    return out


def nearest(communes: pd.DataFrame, quays: pd.DataFrame, day: str, regular_only: bool = False) -> pd.DataFrame:
    """Plus proche quai desservi dans la fenêtre de `day` (vol d'oiseau, Lambert-93) et nombre de quais desservis
    à moins de 2 km."""
    q = quays[quays[f"first_{day}"].notna()]
    if regular_only:
        q = q[q[f"regular_{day}"]]
    tree = cKDTree(q[["x", "y"]].to_numpy())
    pts = communes[["x", "y"]].to_numpy()
    dist, idx = tree.query(pts, k=1)
    n2 = np.array([len(v) for v in tree.query_ball_point(pts, r=R5_WALK_EGRESS_LIMIT_M)])
    rows = q.iloc[idx]
    return pd.DataFrame({
        "nearest_stop_id": rows.index.to_numpy(),
        "nearest_stop_name": rows["parent_name"].to_numpy(),
        "nearest_first_arrival": [hhmm(s) for s in rows[f"first_{day}"]],
        "nearest_m": dist.round().astype(int),
        "served_quays_lt_2km": n2,
    })


def build_table(communes: pd.DataFrame, quays: pd.DataFrame, access: dict[str, dict],
                pole_ids: list[str]) -> pd.DataFrame:
    parts = []
    for d in DAY_TYPES:
        near = nearest(communes, quays, d.id)
        near_reg = nearest(communes, quays, d.id, regular_only=True)
        df = pd.concat([communes[["insee", "name", "dep", "population"]], near], axis=1)
        df.insert(4, "day", d.id)
        df.insert(5, "end", d.end.strftime("%H:%M"))
        df["nearest_regular_m"] = near_reg["nearest_m"]
        ret_null, ret_null_out_ok, ret_eq_walk, ret_found = [], [], [], []
        for insee in df["insee"]:
            t = access[insee]["transit"][d.id]
            w = access[insee].get("walk", {}).get("any", {}).get("ret") or [None] * len(pole_ids)
            ret_null.append(sum(r is None for r in t["ret"]))
            ret_null_out_ok.append(sum(r is None and o is not None for o, r in zip(t["out"], t["ret"], strict=True)))
            found = [(r, wr) for r, wr in zip(t["ret"], w, strict=True) if r is not None]
            ret_found.append(len(found))
            # retour trouvé égal (à 1 min près) au retour tout à pied : trajet direct à pied, sans TC
            ret_eq_walk.append(sum(wr is not None and abs(r - wr) <= 1 for r, wr in found))
        df["poles"] = len(pole_ids)
        df["ret_null"] = ret_null
        df["ret_null_out_found"] = ret_null_out_ok
        df["ret_found"] = ret_found
        df["ret_found_equal_walk"] = ret_eq_walk
        df["category"] = [classify(float(m), WALK_REACH_M) for m in df["nearest_m"]]
        parts.append(df)
    return pd.concat(parts, ignore_index=True)


def relay_pairs(communes: pd.DataFrame, access: dict[str, dict], pole_ids: list[str]) -> pd.DataFrame:
    """Couples commune x pôle x journée : out, ret publiés et indice de retour par commune relais."""
    insees = np.array(communes["insee"].tolist())
    xy = communes[["x", "y"]].to_numpy()
    dist = np.hypot(xy[:, None, 0] - xy[None, :, 0], xy[:, None, 1] - xy[None, :, 1])
    parts = []
    for d in DAY_TYPES:
        def grid(key: str, day: str = d.id) -> np.ndarray:
            return np.array([[np.nan if v is None else v for v in access[i]["transit"][day][key]]
                             for i in insees], dtype=float).T  # [pôle, commune]
        out, ret = grid("out"), grid("ret")
        relay, via = relay_returns(ret, dist, SPEED_WALKING_KMH)
        pi, ci = np.meshgrid(np.arange(len(pole_ids)), np.arange(len(insees)), indexing="ij")
        pi, ci, vi = pi.ravel(), ci.ravel(), via.ravel()
        vk = np.maximum(vi, 0)
        parts.append(pd.DataFrame({
            "insee": insees[ci], "day": d.id, "pole_id": np.array(pole_ids)[pi],
            "out": out.ravel(), "ret": ret.ravel(), "relay": np.round(relay.ravel()),
            "via_insee": np.where(vi >= 0, insees[vk], None),
            "via_dist_m": np.where(vi >= 0, dist[vk, ci].round(), np.nan),
            "via_ret": np.where(vi >= 0, ret[pi, vk], np.nan),
        }))
    return pd.concat(parts, ignore_index=True)


def relay_summary(pairs: pd.DataFrame, t: pd.DataFrame) -> pd.DataFrame:
    """Ajoute à la table commune x journée le nombre de retours nuls dont l'indice relais est <= 120 min."""
    nul = pairs[pairs["ret"].isna()]
    k = nul[nul["relay"] <= MAX_TRIP_MIN].groupby(["insee", "day"]).size().rename("ret_null_relay_le_120")
    t = t.join(k, on=["insee", "day"])
    t["ret_null_relay_le_120"] = t["ret_null_relay_le_120"].fillna(0).astype(int)
    return t


def print_relay(pairs: pd.DataFrame, t: pd.DataFrame) -> None:
    print(f"\nIndice relais (retour publié vers une autre commune + marche à vol d'oiseau à {SPEED_WALKING_KMH} km/h) :")
    pairs = pairs.merge(t[["insee", "day", "category"]], on=["insee", "day"])
    for d in DAY_TYPES:
        x = pairs[pairs["day"] == d.id]
        nul = x[x["ret"].isna()]
        hit = nul[nul["relay"] <= MAX_TRIP_MIN]
        tt = t[t["day"] == d.id]
        allnull = tt[tt["ret_null"] == tt["poles"]]
        allnull_hit = allnull[allnull["ret_null_relay_le_120"] > 0]
        found = x[x["ret"].notna()]
        optimistic = found[found["relay"] < found["ret"]]
        print(f"  {d.id} : couples ret null {len(nul)} ; indice relais <= {MAX_TRIP_MIN} min : {len(hit)} "
              f"{hit['category'].value_counts().to_dict()} ; communes sans aucun retour : {len(allnull)}, dont "
              f"{len(allnull_hit)} avec au moins un indice relais <= {MAX_TRIP_MIN} min "
              f"(pop. {int(allnull_hit['population'].sum()):,}) {allnull_hit['category'].value_counts().to_dict()}")
        gap = (optimistic["ret"] - optimistic["relay"]).median()
        print(f"       contrôle d'optimisme : couples à retour publié dont l'indice relais est plus court : "
              f"{len(optimistic)} sur {len(found)} (écart médian {gap} min)")
        for b in BUDGETS_MIN:
            fail = x[(x["out"] <= b) & ~(x["ret"] <= b)]
            flip = fail[fail["relay"] <= b]
            print(f"       budget {b} min : aller <= budget mais retour nul ou > budget : {len(fail)} couples ; "
                  f"dont indice relais <= budget : {len(flip)} ({int(flip['ret'].isna().sum())} à retour nul)")


def summarize(t: pd.DataFrame) -> None:
    print(f"\nPortée à pied en {MAX_TRIP_MIN} min à {SPEED_WALKING_KMH} km/h : {WALK_REACH_M:.0f} m")
    for d in DAY_TYPES:
        x = t[t["day"] == d.id]
        allnull = x[x["ret_null"] == x["poles"]]
        print(f"\n{d.id} (fin {d.end:%H:%M}) : {len(x)} communes ; {int(x['ret_null'].sum())} couples ret null ; "
              f"{len(allnull)} communes sans aucun retour")
        for cat in CATEGORIES:
            c = x[x["category"] == cat]
            ca = allnull[allnull["category"] == cat]
            print(f"  {cat:34s} communes {len(c):4d} | couples ret null {int(c['ret_null'].sum()):5d} "
                  f"(dont aller trouvé {int(c['ret_null_out_found'].sum()):5d}) | communes sans aucun retour "
                  f"{len(ca):4d} (pop. {int(ca['population'].sum()):,})")
        # Contrôle du mécanisme : à 2 km ou plus de tout quai desservi, R5 ne peut finir aucun trajet en TC ;
        # un retour trouvé doit donc être le trajet tout à pied.
        far = x[x["nearest_m"] >= R5_WALK_EGRESS_LIMIT_M]
        bad = far[far["ret_found"] != far["ret_found_equal_walk"]]
        print(f"  contrôle : communes à >= 2 km d'un quai desservi avec un retour trouvé : "
              f"{int((far['ret_found'] > 0).sum())} ; retours trouvés différents du trajet à pied : "
              f"{int((bad['ret_found'] - bad['ret_found_equal_walk']).sum())} ({len(bad)} communes)")
        reg = x[(x["category"] == CAT_NEAR) & (x["nearest_regular_m"] >= R5_WALK_EGRESS_LIMIT_M)]
        print(f"  communes « < 2 km » grâce à un quai à descente sur réservation seulement : {len(reg)}")


def insights_check(t: pd.DataFrame, pairs: pd.DataFrame, jobs: dict[str, int]) -> pd.DataFrame:
    items = json.loads((FRONT_DATA_DIR / "insights.json").read_text(encoding="utf-8"))
    idx = t.set_index(["insee", "day"])
    pidx = pairs.set_index(["insee", "day"]).sort_index()
    rows = []
    for it in items:
        s = it["scenario"]
        for role, insee, day in (("o", s["o"], s["d"]), ("vs", s.get("vs"), s["d"]),
                                 ("compare_day", s["o"], s.get("compare_day"))):
            if not insee or not day:
                continue
            r = idx.loc[(insee, day)]
            b = s["b"]
            pp = pidx.loc[(insee, day)]
            fail = pp[(pp["out"] <= b) & ~(pp["ret"] <= b)]
            flip = fail[fail["relay"] <= b]
            rows.append({"insight": it["id"], "kind": it["kind"], "role": role, "insee": insee, "name": r["name"],
                         "day": day, "budget": b, "category": r["category"], "nearest_m": int(r["nearest_m"]),
                         "nearest_stop_name": r["nearest_stop_name"], "ret_null": int(r["ret_null"]),
                         "ret_null_out_found": int(r["ret_null_out_found"]),
                         "ret_null_relay_le_120": int(r["ret_null_relay_le_120"]),
                         "poles_out_ok_ret_fail": len(fail), "poles_relay_le_budget": len(flip),
                         "jobs_relay_le_budget": int(sum(jobs[p] for p in flip["pole_id"])),
                         "relay_poles": " ".join(f"{p}:{int(v)}" for p, v in zip(flip["pole_id"], flip["relay"],
                                                                                 strict=True))})
    df = pd.DataFrame(rows)
    print("\nDécouvertes (insights.json), côté du scénario :")
    print(df.to_string(index=False))
    return df


# --------------------------------------------------------------------------- réseau piéton OSM (échantillon)
EXCLUDED_HIGHWAYS = {"motorway", "motorway_link", "construction", "proposed", "raceway", "bus_guideway",
                     "abandoned", "platform"}


def _tag(other: str | float | None, key: str) -> str | None:
    if not isinstance(other, str):
        return None
    needle = f'"{key}"=>"'
    i = other.find(needle)
    if i < 0:
        return None
    j = other.find('"', i + len(needle))
    return other[i + len(needle):j]


def walk_graph(bbox_l93: tuple[float, float, float, float]):
    """Graphe piéton approché (couche `lines` du pbf OSM, pilote GDAL OSM) dans une emprise Lambert-93.

    Voies `highway` hors autoroutes et voies en projet, sans `foot=no` ni `access=no|private` (sauf
    `foot=yes|designated|permissive`). Approximation du réseau piéton de R5, pas sa copie : R5 a ses propres règles
    de permission. Sommets = sommets des géométries OSM (les nœuds partagés ont les mêmes coordonnées)."""
    import pyogrio
    from scipy.sparse import coo_matrix

    to_wgs = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)
    x0, y0, x1, y1 = bbox_l93
    lon0, lat0 = to_wgs.transform(x0, y0)
    lon1, lat1 = to_wgs.transform(x1, y1)
    wait_for_memory("osm")
    g = pyogrio.read_dataframe(OSM, layer="lines", bbox=(lon0, lat0, lon1, lat1),
                               columns=["highway", "other_tags"], where="highway IS NOT NULL")
    foot = g["other_tags"].map(lambda o: _tag(o, "foot"))
    access = g["other_tags"].map(lambda o: _tag(o, "access"))
    keep = ~g["highway"].isin(EXCLUDED_HIGHWAYS) & (foot != "no")
    keep &= ~(access.isin(["no", "private"]) & ~foot.isin(["yes", "designated", "permissive"]))
    g = g[keep].to_crs("EPSG:2154").explode(index_parts=False)
    coords = [np.asarray(geom.coords)[:, :2] for geom in g.geometry if geom is not None and not geom.is_empty]
    seg_a = np.vstack([c[:-1] for c in coords])
    seg_b = np.vstack([c[1:] for c in coords])
    uniq, inv = np.unique(np.round(np.vstack([seg_a, seg_b]), 2), axis=0, return_inverse=True)
    inv = inv.ravel()
    a, b = inv[: len(seg_a)], inv[len(seg_a):]
    w = np.hypot(*(seg_a - seg_b).T)
    graph = coo_matrix((np.r_[w, w], (np.r_[a, b], np.r_[b, a])), shape=(len(uniq), len(uniq))).tocsr()
    return graph, cKDTree(uniq), len(g)


def network_sample(t: pd.DataFrame, quays: pd.DataFrame, communes: pd.DataFrame, codes: list[str],
                   tile_m: float = 20_000) -> pd.DataFrame:
    """Distance piétonne approchée du point de chaque commune au plus proche quai desservi, parmi les quais à moins
    de 2 000 m à vol d'oiseau (un quai plus loin à vol d'oiseau est forcément à plus de 2 000 m par le réseau).
    Un chemin de 2 000 m au plus reste dans le disque de 2 000 m : l'emprise lue est donc le point +/- 2 000 m.
    Les communes sont groupées par carreaux de `tile_m` (regroupement de lecture, sans effet sur les distances)
    pour ne lire le pbf qu'une fois par carreau (lecture séquentielle d'environ 80 s quelle que soit l'emprise)."""
    from scipy.sparse.csgraph import dijkstra

    lim = R5_WALK_EGRESS_LIMIT_M
    c = communes[communes["insee"].isin(codes)].copy()
    c["tile"] = list(zip((c["x"] // tile_m).astype(int), (c["y"] // tile_m).astype(int), strict=True))
    rows = []
    n_tiles = c["tile"].nunique()
    for k, (_, grp) in enumerate(c.groupby("tile")):
        bbox = (grp["x"].min() - lim, grp["y"].min() - lim, grp["x"].max() + lim, grp["y"].max() + lim)
        graph, tree, nways = walk_graph(bbox)
        print(f"  carreau {k + 1}/{n_tiles} : {len(grp)} communes, {nways} voies OSM")
        for _, r in grp.iterrows():
            d0, s0 = tree.query([r["x"], r["y"]])
            dist = dijkstra(graph, indices=int(s0), limit=lim)
            for d in DAY_TYPES:
                q = quays[quays[f"first_{d.id}"].notna()]
                crow = np.hypot(q["x"] - r["x"], q["y"] - r["y"])
                q = q[crow < lim]
                row = {"insee": r["insee"], "name": r["name"], "day": d.id, "network_m": None, "stop_name": None,
                       "snap_m": round(float(d0))}
                if not q.empty:
                    dt, st = tree.query(q[["x", "y"]].to_numpy())
                    net = dist[st] + dt + d0
                    i = int(np.argmin(net))
                    if np.isfinite(net[i]) and net[i] < lim:
                        row["network_m"] = round(float(net[i]))
                        row["stop_name"] = q.iloc[i]["parent_name"]
                rows.append(row)
    df = pd.DataFrame(rows)
    tt = t.set_index(["insee", "day"])
    keys = list(zip(df["insee"], df["day"], strict=True))
    df["crow_m"] = [int(tt.loc[k, "nearest_m"]) for k in keys]
    df["category_crow"] = [tt.loc[k, "category"] for k in keys]
    df["ret_null"] = [int(tt.loc[k, "ret_null"]) for k in keys]
    # network_m vide = aucun quai desservi à moins de 2 000 m par le réseau : la catégorie « < 2 km » tombe
    df["network_lt_2km"] = df["network_m"].notna()
    return df


def diagnose(insee: str, day: str, communes: pd.DataFrame, quays: pd.DataFrame, chunksize: int = 1_000_000
             ) -> pd.DataFrame:
    """Cas d'appel : quais desservis dans la fenêtre de retour près d'une commune, avec lignes et heures d'arrivée.
    Quais retenus : ceux à moins de 2 000 m à vol d'oiseau, et, pour les modes ferrés (route_type 0, 1, 2), ceux
    à portée de marche en 120 min. Distance réseau : réseau piéton approché (walk_graph)."""
    c = communes.set_index("insee").loc[insee]
    a, b = windows()[day]
    q = quays[quays[f"first_{day}"].notna()].copy()
    q["crow_m"] = np.hypot(q["x"] - c["x"], q["y"] - c["y"]).round()
    q = q[q["crow_m"] <= WALK_REACH_M]
    wait_for_memory("diagnose")
    trips = active_trip_ids(GTFS, SERVICE_DATE)
    keep = set(q.index)
    hits = []
    with zipfile.ZipFile(GTFS) as z:
        tr = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["trip_id", "route_id"])
        ro = pd.read_csv(z.open("routes.txt"), dtype=str, usecols=["route_id", "route_short_name", "route_type"])
        with z.open("stop_times.txt") as f:
            cols = ["trip_id", "arrival_time", "departure_time", "stop_id", "drop_off_type"]
            for ch in pd.read_csv(f, dtype=str, usecols=cols, chunksize=chunksize):
                ch = ch[ch["stop_id"].isin(keep) & ch["trip_id"].isin(trips)]
                tsec = gtfs_seconds(ch["arrival_time"].fillna(ch["departure_time"]))
                m = alighting_allowed(ch["drop_off_type"]) & (tsec >= a) & (tsec <= b)
                hits.append(ch.loc[m, ["trip_id", "stop_id"]].assign(t=tsec[m]))
    h = pd.concat(hits).merge(tr, on="trip_id").merge(ro, on="route_id")
    g = h.groupby("stop_id").agg(lines=("route_short_name", lambda s: " ".join(sorted(set(s)))),
                                 route_types=("route_type", lambda s: " ".join(sorted(set(s)))),
                                 arrivals=("t", "size"), first=("t", "min"), last=("t", "max"))
    out = q.join(g, how="inner")
    rail = out["route_types"].str.contains(r"\b[012]\b", regex=True)
    out = out[(out["crow_m"] < R5_WALK_EGRESS_LIMIT_M) | rail].copy()
    out["first"] = out["first"].map(hhmm)
    out["last"] = out["last"].map(hhmm)
    # distance par le réseau piéton approché (walk_graph), dans le carré de demi-côté = portée à pied en 120 min
    from scipy.sparse.csgraph import dijkstra

    r = WALK_REACH_M
    graph, tree, _ = walk_graph((c["x"] - r, c["y"] - r, c["x"] + r, c["y"] + r))
    d0, s0 = tree.query([c["x"], c["y"]])
    dist = dijkstra(graph, indices=int(s0), limit=r)
    dt, st = tree.query(out[["x", "y"]].to_numpy())
    net = dist[st] + dt + d0
    out["network_m"] = np.where(np.isfinite(net), net.round(), np.nan)
    out = out.reset_index(names="stop_id")[["stop_id", "parent_name", "crow_m", "network_m", "lines", "route_types",
                                             "arrivals", "first", "last"]].sort_values("crow_m")
    return out


def default_sample(t: pd.DataFrame, ins: pd.DataFrame) -> list[str]:
    """Échantillon (choix d'échantillon, n'entre dans aucune valeur publiée) : communes des découvertes, et communes
    « < 2 km » à vol d'oiseau sans aucun retour à 14h ou à 22h dont le quai desservi le plus proche est dans le
    dernier quart de la limite (1 500 m ou plus) : là où un détour du réseau peut faire passer au-dessus de 2 000 m."""
    border = t[(t["category"] == CAT_NEAR) & (t["ret_null"] == t["poles"])
               & (t["nearest_m"] >= 0.75 * R5_WALK_EGRESS_LIMIT_M) & t["day"].isin(["d06", "d14"])]
    return sorted(set(ins["insee"]) | set(border["insee"]))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--network", nargs="*", default=None,
                    help="distance réseau piéton OSM ; sans code : échantillon par défaut (default_sample)")
    ap.add_argument("--diagnose", nargs=2, metavar=("INSEE", "DAY"), default=None,
                    help="quais desservis, lignes et heures près d'une commune (ex. 78396 d14)")
    args = ap.parse_args()
    t0 = time.time()
    poles = json.loads(POLES_15_JSON.read_text(encoding="utf-8"))
    pole_ids = [p["id"] for p in poles]
    jobs = {p["id"]: int(p["jobs"]) for p in poles}
    communes = load_communes()
    access = load_access(communes["insee"].tolist())
    quays, _ = served_quays()
    t = build_table(communes, quays, access, pole_ids)
    pairs = relay_pairs(communes, access, pole_ids)
    t = relay_summary(pairs, t)
    t.to_csv(OUT_CSV, index=False)
    pairs.to_csv(OUT_PAIRS, index=False)
    print(f"écrit {OUT_CSV} ({len(t)} lignes) et {OUT_PAIRS} ({len(pairs)} lignes)")
    summarize(t)
    print_relay(pairs, t)
    ins = insights_check(t, pairs, jobs)
    ins.to_csv(OUT_INSIGHTS, index=False)
    print(f"écrit {OUT_INSIGHTS} ({len(ins)} lignes)")
    if args.diagnose is not None:
        dg = diagnose(args.diagnose[0], args.diagnose[1], communes, quays)
        path = PROCESSED_DIR / f"egress_limit_diag_{args.diagnose[0]}_{args.diagnose[1]}.csv"
        dg.to_csv(path, index=False)
        print(dg.to_string(index=False))
        print(f"écrit {path} ({len(dg)} lignes)")
    if args.network is not None:
        codes = args.network or default_sample(t, ins)
        ns = network_sample(t, quays, communes, codes)
        ns.to_csv(OUT_NETWORK, index=False)
        lost = ns[(ns["category_crow"] == CAT_NEAR) & ~ns["network_lt_2km"]]
        print(f"échantillon réseau : {ns['insee'].nunique()} communes, {len(ns)} lignes ; « < 2 km » à vol d'oiseau "
              f"mais pas par le réseau : {len(lost)} lignes {lost['day'].value_counts().to_dict()}")
        print(lost.to_string(index=False))
        print(f"écrit {OUT_NETWORK} ({len(ns)} lignes)")
    print(f"terminé en {timedelta(seconds=round(time.time() - t0))} ({datetime.now():%H:%M})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
