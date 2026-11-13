"""Turn the IDFM GTFS into a compact, time-sorted connection table for CSA routing.

Output: data/processed/network.npz with
    stop_ids, stop_x, stop_y          stops (platform level) in Lambert-93
    c_dep_stop, c_arr_stop, c_dep, c_arr, c_trip   connections sorted by c_dep
    fp_from, fp_to, fp_dur            footpaths (CSR-friendly, sorted by fp_from)
    route_type per trip               for mode statistics
"""
import duckdb
import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree

from config import (GTFS_DIR, PROCESSED, SERVICE_DATE, WINDOW_START, WINDOW_END,
                    WALK_SPEED, DETOUR, FOOT_RADIUS)


def active_services(con, date: str) -> pd.DataFrame:
    weekday = pd.Timestamp(date).day_name().lower()
    return con.execute(f"""
        WITH base AS (
            SELECT service_id FROM read_csv_auto('{GTFS_DIR}/calendar.txt', all_varchar=true)
            WHERE {weekday} = '1' AND start_date <= '{date}' AND end_date >= '{date}'
        ),
        ex AS (
            SELECT service_id, exception_type
            FROM read_csv_auto('{GTFS_DIR}/calendar_dates.txt', all_varchar=true)
            WHERE date = '{date}'
        )
        SELECT service_id FROM base
        WHERE service_id NOT IN (SELECT service_id FROM ex WHERE exception_type = '2')
        UNION
        SELECT service_id FROM ex WHERE exception_type = '1'
    """).df()


def to_seconds(col: str) -> str:
    return (f"(CAST(split_part({col}, ':', 1) AS INT) * 3600 + "
            f" CAST(split_part({col}, ':', 2) AS INT) * 60 + "
            f" CAST(split_part({col}, ':', 3) AS INT))")


def main(date=SERVICE_DATE, start=WINDOW_START, end=WINDOW_END, out="network.npz"):
    con = duckdb.connect()
    services = active_services(con, date)
    con.register("services", services)
    print(f"active services on {date}: {len(services)}")

    con.execute(f"""
        CREATE TABLE trips AS
        SELECT t.trip_id, t.route_id, r.route_type, r.route_short_name
        FROM read_csv_auto('{GTFS_DIR}/trips.txt', all_varchar=true) t
        JOIN services s USING (service_id)
        JOIN read_csv_auto('{GTFS_DIR}/routes.txt', all_varchar=true) r USING (route_id)
    """)
    print("active trips:", con.execute("SELECT count(*) FROM trips").fetchone()[0])

    # Consecutive stop pairs of each trip -> elementary connections
    st = con.execute(f"""
        WITH st AS (
            SELECT trip_id, stop_id,
                   CAST(stop_sequence AS INT)       AS seq,
                   {to_seconds('arrival_time')}     AS arr,
                   {to_seconds('departure_time')}   AS dep,
                   pickup_type, drop_off_type
            FROM read_csv_auto('{GTFS_DIR}/stop_times.txt', all_varchar=true)
            WHERE trip_id IN (SELECT trip_id FROM trips)
              AND arrival_time IS NOT NULL AND arrival_time <> ''
        ),
        pairs AS (
            SELECT trip_id, stop_id AS dep_stop, dep, pickup_type,
                   lead(stop_id)       OVER w AS arr_stop,
                   lead(arr)           OVER w AS arr,
                   lead(drop_off_type) OVER w AS drop_type
            FROM st
            WINDOW w AS (PARTITION BY trip_id ORDER BY seq)
        )
        SELECT * FROM pairs
        WHERE arr_stop IS NOT NULL
          AND dep >= {start} AND dep <= {end}
          AND arr >= dep
    """).df()
    # pickup/drop-off flags: 1 = not available. Keep the connection (vehicle still
    # passes) but it can only be boarded / alighted where allowed.
    st["can_board"]  = st["pickup_type"].fillna("0") != "1"
    st["can_alight"] = st["drop_type"].fillna("0")   != "1"
    print("connections in window:", len(st))

    stops = con.execute(f"""
        SELECT stop_id, stop_name, CAST(stop_lon AS DOUBLE) lon, CAST(stop_lat AS DOUBLE) lat,
               parent_station
        FROM read_csv_auto('{GTFS_DIR}/stops.txt', all_varchar=true)
        WHERE location_type IS NULL OR location_type IN ('', '0')
    """).df()
    used = pd.unique(np.concatenate([st.dep_stop.values, st.arr_stop.values]))
    stops = stops[stops.stop_id.isin(used)].reset_index(drop=True)
    tr = Transformer.from_crs(4326, 2154, always_xy=True)
    stops["x"], stops["y"] = tr.transform(stops.lon.values, stops.lat.values)
    idx = pd.Series(np.arange(len(stops)), index=stops.stop_id)

    trips = con.execute("SELECT * FROM trips").df()
    trips = trips[trips.trip_id.isin(st.trip_id.unique())].reset_index(drop=True)
    tidx = pd.Series(np.arange(len(trips)), index=trips.trip_id)

    st = st[st.dep_stop.isin(idx.index) & st.arr_stop.isin(idx.index)]
    st = st.sort_values(["dep", "arr"]).reset_index(drop=True)

    # Footpaths: GTFS transfers.txt + straight-line pairs within FOOT_RADIUS
    tf = con.execute(f"""
        SELECT from_stop_id, to_stop_id, CAST(min_transfer_time AS INT) t
        FROM read_csv_auto('{GTFS_DIR}/transfers.txt', all_varchar=true)
        WHERE from_stop_id <> to_stop_id AND min_transfer_time IS NOT NULL
    """).df()
    tf = tf[tf.from_stop_id.isin(idx.index) & tf.to_stop_id.isin(idx.index)]
    a = idx[tf.from_stop_id].values
    b = idx[tf.to_stop_id].values
    t = tf.t.values

    xy   = stops[["x", "y"]].values
    tree = cKDTree(xy)
    pairs = tree.query_pairs(FOOT_RADIUS, output_type="ndarray")
    d  = np.linalg.norm(xy[pairs[:, 0]] - xy[pairs[:, 1]], axis=1)
    wt = (d * DETOUR / WALK_SPEED).astype(np.int64)
    fa = np.concatenate([a, pairs[:, 0], pairs[:, 1]])
    fb = np.concatenate([b, pairs[:, 1], pairs[:, 0]])
    ft = np.concatenate([t, wt, wt])
    fp = (pd.DataFrame({"a": fa, "b": fb, "t": ft})
            .groupby(["a", "b"], as_index=False).t.min()
            .sort_values("a"))
    print("footpaths:", len(fp))

    np.savez_compressed(
        PROCESSED / out,
        stop_ids    = stops.stop_id.to_numpy().astype("U"),
        stop_names  = stops.stop_name.to_numpy().astype("U"),
        stop_x      = stops.x.values,
        stop_y      = stops.y.values,
        c_dep_stop  = idx[st.dep_stop].values.astype(np.int32),
        c_arr_stop  = idx[st.arr_stop].values.astype(np.int32),
        c_dep       = st.dep.values.astype(np.int32),
        c_arr       = st.arr.values.astype(np.int32),
        c_trip      = tidx[st.trip_id].values.astype(np.int32),
        c_board     = st.can_board.values,
        c_alight    = st.can_alight.values,
        trip_rtype  = trips.route_type.astype(int).values.astype(np.int16),
        trip_route  = trips.route_short_name.fillna("").to_numpy().astype("U"),
        fp_from     = fp.a.values.astype(np.int32),
        fp_to       = fp.b.values.astype(np.int32),
        fp_dur      = fp.t.values.astype(np.int32),
    )
    print("saved", PROCESSED / out)


def hhmm(s):
    h, m = s.split(":")
    return int(h) * 3600 + int(m) * 60


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="GTFS -> connection table for one service date and time window")
    ap.add_argument("--date",  default=SERVICE_DATE, help="YYYYMMDD")
    ap.add_argument("--start", default=None, help="HH:MM, window start (default 06:00)")
    ap.add_argument("--end",   default=None, help="HH:MM, window end (default 11:00; >24:00 allowed)")
    ap.add_argument("--out",   default="network.npz")
    a = ap.parse_args()
    main(a.date, hhmm(a.start) if a.start else WINDOW_START, hhmm(a.end) if a.end else WINDOW_END, a.out)
