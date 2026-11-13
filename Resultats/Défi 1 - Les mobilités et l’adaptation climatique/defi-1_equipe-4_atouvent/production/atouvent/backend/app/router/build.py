"""Préparation du calculateur d'itinéraires à partir du GTFS officiel IDFM (métro, RER, Transilien, tram, bus)."""
from __future__ import annotations

import json
import sys
import tempfile
import zipfile
from pathlib import Path

import duckdb
import numpy as np

OUT = Path(__file__).resolve().parents[2] / "data"
RAIL_TYPES = ("0", "1", "2", "6", "7")  # tram, métro, train (RER, Transilien, TER), câble, funiculaire
BUS_TYPES = ("3",)
NEAR_M = 250        # correspondance à pied entre deux arrêts voisins sans correspondance déclarée
WALK_MS = 1.25 / 1.3


def _secs(col: str) -> str:
    # « 25:10:00 » → secondes depuis le début du jour de service (peut dépasser 24 h)
    return (f"(split_part({col}, ':', 1)::int * 3600 + split_part({col}, ':', 2)::int * 60 "
            f"+ split_part({col}, ':', 3)::int)")


def build(src: Path, bus: bool = True) -> dict:
    con = duckdb.connect()
    csv = lambda f: f"read_csv('{(src / f).as_posix()}', all_varchar=true, header=true)"
    types = RAIL_TYPES + (BUS_TYPES if bus else ())
    con.sql(f"""create table routes as select *, (row_number() over (order by route_id) - 1)::int ix
        from {csv('routes.txt')} where route_type in {types}""")
    con.sql(f"""create table trips as select t.*, (row_number() over (order by t.trip_id) - 1)::int ix
        from {csv('trips.txt')} t join (select route_id from routes) using (route_id)""")
    con.sql(f"""create table st as select trip_id, stop_id, stop_sequence::int seq,
        {_secs('arrival_time')} arr, {_secs('departure_time')} dep
        from {csv('stop_times.txt')} where trip_id in (select trip_id from trips)""")
    con.sql(f"""create table stops as select s.stop_id, s.stop_name, s.stop_lat::double lat, s.stop_lon::double lon,
        coalesce(s.parent_station, '') parent, coalesce(p.stop_name, s.stop_name) parent_name,
        coalesce(s.wheelchair_boarding, '0') wheelchair, (row_number() over (order by s.stop_id) - 1)::int ix
        from {csv('stops.txt')} s left join {csv('stops.txt')} p on p.stop_id = s.parent_station
        where s.stop_id in (select distinct stop_id from st)""")

    stops = con.sql("select stop_id, stop_name, lat, lon, parent, parent_name, wheelchair from stops order by ix").fetchall()
    routes = con.sql("""select route_id, route_short_name, route_long_name, route_type, coalesce(route_color, ''),
        coalesce(route_text_color, '') from routes order by ix""").fetchall()
    services = [s for (s,) in con.sql("select distinct service_id from trips order by 1").fetchall()]
    service_ix = {s: i for i, s in enumerate(services)}
    trips = con.sql(f"""select t.trip_id, r.ix, t.service_id, coalesce(t.trip_headsign, ''), coalesce(t.wheelchair_accessible, '0'),
        {"coalesce(t.shape_id, '')" if "shape_id" in con.sql("select * from trips limit 0").columns else "''"}
        from trips t join routes r using (route_id) order by t.ix""").fetchall()

    # Connexions : deux arrêts consécutifs d'une même course, triées par heure de départ (calcul vectorisé)
    c = con.sql("""select a.ix a, b.ix b, x.dep, x.nxt_arr, t.ix trip from (
            select trip_id, stop_id, lead(stop_id) over w nxt, dep, lead(arr) over w nxt_arr
            from st window w as (partition by trip_id order by seq)) x
        join stops a on a.stop_id = x.stop_id join stops b on b.stop_id = x.nxt join trips t on t.trip_id = x.trip_id
        order by x.dep, t.ix""").fetchnumpy()
    conns = np.stack([c[k].astype(np.int32) for k in ("a", "b", "dep", "nxt_arr", "trip")], axis=1)

    # Marche entre arrêts voisins (≤ 250 m, grille de cases d'environ 300 m), puis correspondances déclarées (transfers.txt) qui l'emportent ; l'API les lit dans cet ordre
    con.sql("create table sc as select ix, lat, lon, floor(lat / 0.0027)::int cy, floor(lon / 0.004)::int cx from stops")
    near = con.sql(f"""select a.ix, b.ix, (sqrt(pow(radians(b.lon - a.lon) * cos(radians(a.lat)), 2) + pow(radians(b.lat - a.lat), 2))
            * 6371000 / {WALK_MS} + 60)::int t
        from sc a, (select unnest([-1, 0, 1]) dy), (select unnest([-1, 0, 1]) dx)
        join sc b on b.cy = a.cy + dy and b.cx = a.cx + dx
        where a.ix <> b.ix and sqrt(pow(radians(b.lon - a.lon) * cos(radians(a.lat)), 2) + pow(radians(b.lat - a.lat), 2)) * 6371000 <= {NEAR_M}
        """).fetchall()
    tr = con.sql(f"""select a.ix, b.ix, coalesce(x.min_transfer_time, '120')::int from {csv('transfers.txt')} x
        join stops a on a.stop_id = x.from_stop_id join stops b on b.stop_id = x.to_stop_id where a.ix <> b.ix""").fetchall()
    foot = np.array(near + tr, dtype=np.int32).reshape(-1, 3)

    # Calendrier : services actifs par date (calendar + exceptions calendar_dates)
    days = {}
    for sid, mon, tue, wed, thu, fri, sat, sun, start, end in con.sql(
            f"select service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date from {csv('calendar.txt')}").fetchall():
        if sid in service_ix:
            days[sid] = {"week": [mon, tue, wed, thu, fri, sat, sun], "start": start, "end": end, "add": [], "remove": []}
    for sid, d, kind in con.sql(f"select service_id, date, exception_type from {csv('calendar_dates.txt')}").fetchall():
        if sid in service_ix:
            entry = days.setdefault(sid, {"week": ["0"] * 7, "start": d, "end": d, "add": [], "remove": []})
            entry["add" if kind == "1" else "remove"].append(d)

    shape_of, shape_ptr, shape_pts = _shapes(con, src, [t[5] for t in trips])

    OUT.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT / "router.npz", conns=conns, foot=foot,
                        trip_shape=shape_of, shape_ptr=shape_ptr, shape_pts=shape_pts,
                        stop_lat=np.array([s[2] for s in stops]), stop_lon=np.array([s[3] for s in stops]),
                        trip_route=np.array([t[1] for t in trips], dtype=np.int32),
                        trip_service=np.array([service_ix[t[2]] for t in trips], dtype=np.int32),
                        trip_wheelchair=np.array([int(t[4] or 0) for t in trips], dtype=np.int8),
                        stop_wheelchair=np.array([int(s[6] or 0) for s in stops], dtype=np.int8))
    meta = {
        "stops": [{"id": s[0], "name": s[5], "parent": s[4].replace("IDFM:", "")} for s in stops],
        "routes": [{"id": r[0].replace("IDFM:", ""), "line": r[1], "name": r[2], "type": r[3], "color": r[4], "text": r[5]} for r in routes],
        "headsigns": [t[3] for t in trips],
        "services": services, "calendar": days,
        "valid": con.sql(f"select min(start_date), max(end_date) from {csv('calendar.txt')}").fetchall()[0],
    }
    (OUT / "router.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"stops": len(stops), "routes": len(routes), "trips": len(trips), "connections": len(conns), "footpaths": len(foot),
            "shapes": len(shape_ptr) - 1, "shape_points": len(shape_pts)}


SHAPE_STEP_M = 25  # tracé simplifié : un point tous les 25 m au moins (lisible sur la carte, fichier léger)


def _shapes(con, src: Path, trip_shapes: list[str]):
    """Tracés réels des lignes (shapes.txt) : un tracé par shape_id utilisé, simplifié ; trip_shape[i] = indice ou -1."""
    if not (src / "shapes.txt").exists():
        return np.full(len(trip_shapes), -1, dtype=np.int32), np.zeros(1, dtype=np.int64), np.zeros((0, 2), dtype=np.float32)
    used = sorted({s for s in trip_shapes if s})
    ix = {s: i for i, s in enumerate(used)}
    con.sql(f"""create table sh as select shape_id, shape_pt_lat::double lat, shape_pt_lon::double lon, shape_pt_sequence::int seq
        from read_csv('{(src / "shapes.txt").as_posix()}', all_varchar=true, header=true)""")
    con.execute("create table used as select unnest(?) shape_id", [used])
    rows = con.sql("select shape_id, lat, lon from sh join used using (shape_id) order by shape_id, seq").fetchnumpy()
    ptr, pts, cur, last = [0], [], None, None
    ids, lats, lons = rows["shape_id"], rows["lat"], rows["lon"]
    order = [ix[s] for s in ids]
    # Les lignes arrivent triées par shape_id : on découpe et on simplifie
    for k in range(len(ids)):
        if ids[k] != cur:
            if cur is not None:
                pts.append(last)  # dernier point du tracé précédent, toujours gardé
                ptr.append(len(pts))
            cur, last_kept = ids[k], None
        p = (lats[k], lons[k])
        if last_kept is None or abs(p[0] - last_kept[0]) * 111_000 + abs(p[1] - last_kept[1]) * 73_000 >= SHAPE_STEP_M:
            pts.append(p)
            last_kept = p
        last = p
    if cur is not None:
        pts.append(last)
        ptr.append(len(pts))
    assert len(ptr) - 1 == len(used), "tracés : ordre inattendu"
    del order
    trip_shape = np.array([ix.get(s, -1) for s in trip_shapes], dtype=np.int32)
    return trip_shape, np.array(ptr, dtype=np.int64), np.array(pts, dtype=np.float32).reshape(-1, 2)


def main(path: str, bus: bool = True) -> None:
    src = Path(path)
    if src.suffix == ".zip":
        with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(src) as z:
            z.extractall(tmp, [n for n in z.namelist() if n in
                                {"routes.txt", "trips.txt", "stop_times.txt", "stops.txt", "transfers.txt", "calendar.txt", "calendar_dates.txt"}])
            print(build(Path(tmp), bus))
    else:
        print(build(src, bus))


if __name__ == "__main__":
    main(sys.argv[1], "--sans-bus" not in sys.argv)
