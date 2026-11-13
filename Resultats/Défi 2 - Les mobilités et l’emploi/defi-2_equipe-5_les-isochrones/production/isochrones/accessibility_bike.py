"""Intermodality scenario (track 6): bike to a rail / metro / tram stop, then public transport.

Same as accessibility.py, but each origin can also reach any rail, metro or tram stop within
BIKE_RADIUS by bike (16 km/h, x1.25 detour, +2 min to park). The last leg stays on foot.
Output: data/processed/tt_pt_bike_peak.npz
"""
import sys
import time
from multiprocessing import Pool

import geopandas as gpd
import numpy as np
from scipy.spatial import cKDTree

import accessibility as acc
from config import PROCESSED, DEPARTURES
from csa import Network, INF

BIKE_RADIUS = 4000
BIKE_SPEED  = 16 / 3.6
BIKE_DETOUR = 1.25
PARK_S      = 120


def main(workers=8):
    zones = gpd.read_file(PROCESSED / "zones.gpkg")
    net   = Network(PROCESSED / "network.npz")
    lz, ls, lw, poor = acc.build_links(zones.px.values, zones.py.values, net.stop_x, net.stop_y)

    rail = np.zeros(net.n_stops, bool)
    rail[net.c_dep_stop[net.trip_rtype[net.c_trip] <= 2]] = True
    ridx = np.flatnonzero(rail)
    tree = cKDTree(np.c_[net.stop_x[ridx], net.stop_y[ridx]])
    pts  = np.c_[zones.px.values, zones.py.values]
    bz, bs, bw = [], [], []
    for z, lst in enumerate(tree.query_ball_point(pts, BIKE_RADIUS)):
        if not lst:
            continue
        s = ridx[np.asarray(lst)]
        d = np.hypot(net.stop_x[s] - pts[z, 0], net.stop_y[s] - pts[z, 1])
        bz.append(np.full(len(s), z)); bs.append(s); bw.append((d * BIKE_DETOUR / BIKE_SPEED + PARK_S).astype(np.int32))
    # origin links = walk links + bike links (min per stop); egress links stay walk-only
    oz = np.concatenate([lz] + bz).astype(np.int32)
    os_ = np.concatenate([ls] + bs).astype(np.int32)
    ow = np.concatenate([lw] + bw).astype(np.int32)

    order  = np.argsort(lz, kind="stable")
    starts = np.r_[0, np.flatnonzero(np.diff(lz[order])) + 1]
    d      = np.hypot(pts[:, None, 0] - pts[None, :, 0], pts[:, None, 1] - pts[None, :, 1])
    walk_direct = acc.walk_s(d).astype(np.int64)
    walk_direct[walk_direct > 3600] = INF

    n   = len(zones)
    tt  = np.full((n, n), -1, dtype=np.int16)
    t0  = time.time()
    ctx = (lz, ls, lw, order, starts, walk_direct, n, list(DEPARTURES), oz, os_, ow)
    with Pool(workers, initializer=acc._init, initargs=(str(PROCESSED / "network.npz"), ctx)) as pool:
        for i, (o, row) in enumerate(pool.imap_unordered(_origin_bike, range(n), chunksize=4)):
            tt[o] = row
    np.savez_compressed(PROCESSED / "tt_pt_bike_peak.npz", tt=tt, codes=zones.code.to_numpy().astype("U"))
    print("saved tt_pt_bike_peak.npz", f"{time.time() - t0:.0f}s")


def _origin_bike(o):
    lz, ls, lw, order, starts, walk_direct, n, departures, oz, os_, ow = acc._ctx
    sel = oz == o
    src_s, src_w = os_[sel], ow[sel]
    out = np.full((len(departures), n), INF, dtype=np.int64)
    ez, es, ew = lz[order], ls[order], lw[order]
    if len(src_s):
        for k, dep in enumerate(departures):
            arr  = acc._net.earliest_arrival(dep, src_s, src_w, acc.MAX_TRIP_S, acc.CHANGE_SLACK).astype(np.int64)
            cand = arr[es] + ew
            cand[arr[es] >= INF] = INF
            best = np.minimum.reduceat(cand, starts)
            zz   = ez[starts]
            out[k, zz] = np.minimum(out[k, zz], best - dep)
    out = np.minimum(out, walk_direct[o][None, :])
    med = np.median(out, axis=0)
    med[med > acc.MAX_TRIP_S] = -60
    return o, (med / 60).round().astype(np.int16)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8)
