"""Zone-to-zone public transport travel times for the weekday morning peak.

For every origin zone and every departure in config.DEPARTURES:
    walk home point -> stops within ACCESS_RADIUS -> CSA -> stops within ACCESS_RADIUS -> walk to work point
The zone-to-zone time is the median over departures (as in R5 / Conveyal),
so it includes the initial wait for the next service. Pure walking is also
allowed when it beats public transport.

Output: data/processed/tt_pt_peak.npz  (minutes, int16, -1 = not reachable within MAX_TRIP_S)
"""
import os
import sys
import time
from multiprocessing import Pool

import geopandas as gpd
import numpy as np
from scipy.spatial import cKDTree

from config import (PROCESSED, DEPARTURES, MAX_TRIP_S, WALK_SPEED, DETOUR,
                    ACCESS_RADIUS, CHANGE_SLACK)
from csa import Network, INF

FALLBACK_RADIUS = 3000      # m, poorly served zones: allow a longer walk to the nearest stops
FALLBACK_K      = 3

_net = None
_ctx = None


def walk_s(d):
    return (d * DETOUR / WALK_SPEED).astype(np.int32)


def build_links(zx, zy, sx, sy):
    """Stops within ACCESS_RADIUS of each zone point (fallback: K nearest within 3 km)."""
    tree   = cKDTree(np.c_[sx, sy])
    pts    = np.c_[zx, zy]
    near   = tree.query_ball_point(pts, ACCESS_RADIUS)
    z_idx, s_idx, w = [], [], []
    poor   = np.zeros(len(pts), dtype=bool)
    for z, lst in enumerate(near):
        if not lst:
            poor[z] = True
            d, j = tree.query(pts[z], k=FALLBACK_K, distance_upper_bound=FALLBACK_RADIUS)
            lst  = [int(x) for x, dd in zip(np.atleast_1d(j), np.atleast_1d(d)) if np.isfinite(dd)]
        if not lst:
            continue
        lst = np.asarray(lst)
        d   = np.hypot(sx[lst] - pts[z, 0], sy[lst] - pts[z, 1])
        z_idx.append(np.full(len(lst), z)); s_idx.append(lst); w.append(walk_s(d))
    return (np.concatenate(z_idx).astype(np.int32), np.concatenate(s_idx).astype(np.int32),
            np.concatenate(w).astype(np.int32), poor)


def _init(net_path, ctx):
    global _net, _ctx
    _net = Network(net_path)
    _ctx = ctx


def _origin(o):
    lz, ls, lw, order, starts, walk_direct, n_zones, departures = _ctx
    sel   = lz == o
    src_s = ls[sel]
    src_w = lw[sel]
    out   = np.full((len(departures), n_zones), INF, dtype=np.int64)
    if len(src_s):
        # egress: arrival at each linked stop + walk, min per destination zone
        ez = lz[order]; es = ls[order]; ew = lw[order]
        for k, dep in enumerate(departures):
            arr  = _net.earliest_arrival(dep, src_s, src_w, MAX_TRIP_S, CHANGE_SLACK).astype(np.int64)
            cand = arr[es] + ew
            cand[arr[es] >= INF] = INF
            best = np.minimum.reduceat(cand, starts)
            zz   = ez[starts]
            out[k, zz] = np.minimum(out[k, zz], best - dep)
    out = np.minimum(out, walk_direct[o][None, :])
    med = np.median(out, axis=0)
    med[med > MAX_TRIP_S] = -60
    return o, (med / 60).round().astype(np.int16)


def main(workers=None, network="network.npz", out="tt_pt_peak.npz", departures=None):
    departures = departures or DEPARTURES
    zones = gpd.read_file(PROCESSED / "zones.gpkg")
    net   = Network(PROCESSED / network)
    lz, ls, lw, poor = build_links(zones.px.values, zones.py.values, net.stop_x, net.stop_y)

    order  = np.argsort(lz, kind="stable")
    ez     = lz[order]
    starts = np.r_[0, np.flatnonzero(np.diff(ez)) + 1]

    pts         = np.c_[zones.px.values, zones.py.values]
    d           = np.hypot(pts[:, None, 0] - pts[None, :, 0], pts[:, None, 1] - pts[None, :, 1])
    walk_direct = walk_s(d).astype(np.int64)
    walk_direct[walk_direct > 3600] = INF        # walking only counted up to 1 h

    n   = len(zones)
    ctx = (lz, ls, lw, order, starts, walk_direct, n, list(departures))
    tt  = np.full((n, n), -1, dtype=np.int16)
    t0  = time.time()
    workers = workers or max(1, (os.cpu_count() or 2) - 2)
    with Pool(workers, initializer=_init, initargs=(str(PROCESSED / network), ctx)) as pool:
        for i, (o, row) in enumerate(pool.imap_unordered(_origin, range(n), chunksize=4)):
            tt[o] = row
            if i % 100 == 0:
                print(f"{i}/{n} origins  {time.time() - t0:.0f}s", flush=True)

    np.savez_compressed(PROCESSED / out, tt=tt, codes=zones.code.to_numpy().astype("U"),
                        poorly_served=poor)
    print("saved", out, f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    # usage: accessibility.py [workers] [network.npz] [output.npz] [HH:MM-HH:MM/step_min]
    a = sys.argv[1:]
    deps = None
    if len(a) > 3:
        win, step = a[3].split("/")
        s0, s1 = [int(x.split(":")[0]) * 3600 + int(x.split(":")[1]) * 60 for x in win.split("-")]
        deps = list(range(s0, s1 + 1, int(step) * 60))
    main(int(a[0]) if a else None, *(a[1:3]), departures=deps)
