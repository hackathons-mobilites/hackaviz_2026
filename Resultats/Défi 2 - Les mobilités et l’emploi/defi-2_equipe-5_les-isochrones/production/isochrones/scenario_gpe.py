"""Planned-network scenario: today's IDFM timetable + Grand Paris Express lines 15, 16, 17, 18.

None of these four lines is in the current GTFS, so their timetables are synthetic:
    - stations and order: Société des grands projets station file (data.gouv.fr, 2016 names)
    - running time between stations: straight-line distance x 1.15 / average commercial speed
    - frequency: one train every HEADWAY minutes each way, all morning (06:00-11:00)
    - transfers: walk to any existing stop within 400 m, plus 3 min to reach the deep platforms
Line 14 extensions are already open and in the GTFS, so they are not added again.

Output: data/processed/network_gpe.npz (same layout as network.npz)
"""
import geopandas as gpd
import numpy as np
from scipy.spatial import cKDTree

from config import RAW, PROCESSED, WINDOW_START, WINDOW_END, WALK_SPEED, DETOUR, CRS_M

# Station codes in running order (see GPE_GARE_LOCALISATION.shp)
LINES = {
    "15": ["GA23", "GA22", "GA21", "GA20", "GA19", "GA18", "GA17", "GA16", "GA15", "GA14",   # 15 Sud
           "GA13", "GA12", "GA11", "GA10", "GA09", "GA08"],
    "15W": ["GA23", "GA24", "GA25", "GA26", "GA27", "GA28", "GA29", "GA30", "GA31", "GA32",  # 15 Ouest
            "GA33"],
    "15E": ["GA33", "GA64", "GA65", "GA66", "GA67", "GA68", "GA69", "GA70", "GA71", "GA73",  # 15 Est
            "GA74", "GA10"],
    "16": ["GA33", "GA34", "GA01", "GA02", "GA03", "GA04", "GA05", "GA06", "GA07", "GA08"],
    "17": ["GA33", "GA34", "GA01", "GA35", "GA36", "GA37", "GA38", "GA39", "GA40"],
    "18": ["GA46", "GA47", "GA48", "GA49", "GA50", "GA51", "GA52", "GA53", "GA55", "GA56"],
}
# Average commercial speed (km/h, dwell included) and peak headway (min): planning assumptions
SPEED   = {"15": 55, "15W": 55, "15E": 55, "16": 60, "17": 60, "18": 65}
HEADWAY = {"15": 3,  "15W": 3,  "15E": 3,  "16": 4,  "17": 6,  "18": 5}
DETOUR_RAIL   = 1.15
LINK_RADIUS   = 400        # m, GPE station <-> existing stop
DEEP_PENALTY  = 180        # s, extra time to reach / leave the deep GPE platforms
ROUTE_TYPE    = 1          # metro


def main():
    base = dict(np.load(PROCESSED / "network.npz"))
    gpe  = gpd.read_file(RAW / "gpe" / "GPE_GARE_LOCALISATION.shp").to_crs(CRS_M)
    gpe  = gpe.set_index("CODE")

    n0       = len(base["stop_ids"])
    codes    = sorted({c for seq in LINES.values() for c in seq})
    new_idx  = {c: n0 + i for i, c in enumerate(codes)}
    new_x    = np.array([gpe.geometry[c].x for c in codes])
    new_y    = np.array([gpe.geometry[c].y for c in codes])

    dep_s, arr_s, dep_t, arr_t, trip = [], [], [], [], []
    trip_rtype, trip_route = [], []
    t_id = len(base["trip_rtype"])
    for line, seq in LINES.items():
        v   = SPEED[line] / 3.6
        hop = []
        for a, b in zip(seq[:-1], seq[1:]):
            d = gpe.geometry[a].distance(gpe.geometry[b])
            hop.append(int(round(d * DETOUR_RAIL / v)))
        for direction in (seq, seq[::-1]):
            hops = hop if direction is seq else hop[::-1]
            for start in range(WINDOW_START - 3600, WINDOW_END, HEADWAY[line] * 60):
                t = start
                for (a, b), h in zip(zip(direction[:-1], direction[1:]), hops):
                    if WINDOW_START <= t <= WINDOW_END:
                        dep_s.append(new_idx[a]); arr_s.append(new_idx[b])
                        dep_t.append(t); arr_t.append(t + h); trip.append(t_id)
                    t += h
                trip_rtype.append(ROUTE_TYPE); trip_route.append(line.rstrip("WE"))
                t_id += 1

    # footpaths: new station <-> existing stops, and between new stations sharing a site
    old_xy  = np.c_[base["stop_x"], base["stop_y"]]
    new_xy  = np.c_[new_x, new_y]
    tree    = cKDTree(old_xy)
    fa, fb, ft = [], [], []
    for i, lst in enumerate(tree.query_ball_point(new_xy, LINK_RADIUS)):
        for j in lst:
            w = int(np.hypot(*(old_xy[j] - new_xy[i])) * DETOUR / WALK_SPEED) + DEEP_PENALTY
            fa += [n0 + i, j]; fb += [j, n0 + i]; ft += [w, w]

    c_dep_stop = np.concatenate([base["c_dep_stop"], dep_s]).astype(np.int32)
    c_arr_stop = np.concatenate([base["c_arr_stop"], arr_s]).astype(np.int32)
    c_dep      = np.concatenate([base["c_dep"], dep_t]).astype(np.int32)
    c_arr      = np.concatenate([base["c_arr"], arr_t]).astype(np.int32)
    c_trip     = np.concatenate([base["c_trip"], trip]).astype(np.int32)
    c_board    = np.concatenate([base["c_board"], np.ones(len(dep_s), bool)])
    c_alight   = np.concatenate([base["c_alight"], np.ones(len(dep_s), bool)])
    order      = np.lexsort((c_arr, c_dep))

    fp_from = np.concatenate([base["fp_from"], fa]).astype(np.int32)
    fp_to   = np.concatenate([base["fp_to"], fb]).astype(np.int32)
    fp_dur  = np.concatenate([base["fp_dur"], ft]).astype(np.int32)
    fo      = np.argsort(fp_from, kind="stable")

    names = np.array([str(gpe.LIBELLE[c]) for c in codes], dtype="U")
    out = dict(base)
    out.update(
        stop_ids   = np.concatenate([base["stop_ids"], np.array([f"GPE:{c}" for c in codes], dtype="U")]),
        stop_names = np.concatenate([base["stop_names"], names]),
        stop_x     = np.concatenate([base["stop_x"], new_x]),
        stop_y     = np.concatenate([base["stop_y"], new_y]),
        c_dep_stop = c_dep_stop[order], c_arr_stop = c_arr_stop[order],
        c_dep      = c_dep[order],      c_arr      = c_arr[order],
        c_trip     = c_trip[order],     c_board    = c_board[order], c_alight = c_alight[order],
        trip_rtype = np.concatenate([base["trip_rtype"], trip_rtype]).astype(np.int16),
        trip_route = np.concatenate([base["trip_route"], np.array(trip_route, dtype="U")]),
        fp_from    = fp_from[fo], fp_to = fp_to[fo], fp_dur = fp_dur[fo],
    )
    np.savez_compressed(PROCESSED / "network_gpe.npz", **out)
    print(f"added {len(codes)} stations, {len(dep_s):,} connections, {len(fa):,} transfer links")
    for line, seq in LINES.items():
        v = SPEED[line] / 3.6
        tot = sum(gpe.geometry[a].distance(gpe.geometry[b]) for a, b in zip(seq[:-1], seq[1:])) * DETOUR_RAIL / v
        print(f"  line {line}: {len(seq)} stations, end to end {tot / 60:.0f} min, every {HEADWAY[line]} min")


if __name__ == "__main__":
    main()
