"""Graphe de transport à fréquences (heure de pointe 7 h-9 h 30, mardi 10 novembre 2026, GTFS IDFM).
Nœuds : zones d'arrêt (17 458) + nœuds de ligne (ligne, sens, zone).
Arcs : monter (attente = 1/2 intervalle), descendre, rouler (temps médian GTFS), marcher (zones à ≤ 400 m).
Chaque arc garde ses composantes (minutes à bord, d'attente, de marche), l'aléa chaleur et la climatisation,
pour recalculer le temps ressenti à n'importe quelle température.
Sortie : data/processed/graph.npz"""
import json, time
import numpy as np, pandas as pd, duckdb, geopandas as gpd

RAW, OUT, G = "data/raw/", "data/processed/", "data/raw/gtfs/"
DAY, DOW = "20261110", "tuesday"
T0, T1 = 7 * 3600, 9 * 3600 + 1800
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
con = duckdb.connect()
rd = lambda f: f"read_csv('{G}{f}', header=true, all_varchar=true)"

# ---------- Services actifs le jour choisi ----------
svc = con.sql(f"""
  with base as (select service_id from {rd('calendar.txt')} where {DOW}='1' and start_date<='{DAY}' and end_date>='{DAY}'),
       add as (select service_id from {rd('calendar_dates.txt')} where date='{DAY}' and exception_type='1'),
       rem as (select service_id from {rd('calendar_dates.txt')} where date='{DAY}' and exception_type='2')
  select service_id from (select * from base union select * from add) where service_id not in (select * from rem)""").df()
con.register("svc", svc)
log("services actifs", len(svc))

# ---------- Horaires de la fenêtre ----------
def secs(col): return f"(cast(split_part({col},':',1) as int)*3600+cast(split_part({col},':',2) as int)*60+cast(split_part({col},':',3) as int))"
st = con.sql(f"""
  with tr as (select t.trip_id, t.route_id, t.direction_id from {rd('trips.txt')} t join svc using(service_id))
  select tr.route_id, tr.direction_id, s.trip_id, cast(s.stop_sequence as int) seq, s.stop_id,
         {secs('s.departure_time')} dep, {secs('s.arrival_time')} arr
  from {rd('stop_times.txt')} s join tr using(trip_id)
""").df()
st = st[(st.dep >= T0 - 3600) & (st.dep <= T1 + 3600)]
log("passages lus", len(st))

# arrêt GTFS (IDFM:<arrid>) → zone d'arrêt de nos indicateurs
arr = pd.read_parquet(RAW + "arrets.parquet", columns=["arrid", "zdaid"])
zmap = dict(zip("IDFM:" + arr.arrid.astype(str), arr.zdaid.astype(str)))
# trains et RER : l'horaire cite directement la zone d'arrêt (IDFM:monomodalStopPlace:<zdaid>)
zmap.update({"IDFM:monomodalStopPlace:" + z: z for z in arr.zdaid.astype(str).unique()})
stops = pd.read_parquet(OUT + "stops.parquet")
zid = {z: i for i, z in enumerate(stops.id_zone_arret)}
NZ = len(stops)
st["z"] = st.stop_id.map(zmap).map(zid)
st = st.dropna(subset=["z"]); st["z"] = st.z.astype(int)
log("passages rattachés à une zone", len(st))

# ---------- Arcs « rouler » : temps médian entre zones consécutives ----------
st = st.sort_values(["trip_id", "seq"])
nxt = st.groupby("trip_id").shift(-1)
ride = pd.DataFrame({"route": st.route_id, "dir": st.direction_id, "zf": st.z, "zt": nxt.z, "dep": st.dep, "arr2": nxt.arr})
ride = ride.dropna(); ride["zt"] = ride.zt.astype(int)
ride = ride[(ride.dep >= T0) & (ride.dep <= T1) & (ride.zf != ride.zt)]
ride["t"] = ((ride.arr2 - ride.dep) / 60).clip(lower=0.3)
rides = ride.groupby(["route", "dir", "zf", "zt"])["t"].median().reset_index()
log("arcs rouler", len(rides))

# ---------- Fréquences : départs par (ligne, sens, zone) dans la fenêtre ----------
dep = st[(st.dep >= T0) & (st.dep <= T1)].groupby(["route_id", "direction_id", "z"]).size().reset_index(name="n")
dep["wait"] = np.minimum(30.0, 60.0 / (2 * dep.n / ((T1 - T0) / 3600)))     # 1/2 intervalle, plafonné à 30 min
dep = dep.rename(columns={"route_id": "route", "direction_id": "dir"})

# ---------- Nœuds de ligne ----------
rn = pd.concat([rides[["route", "dir", "zf"]].rename(columns={"zf": "z"}), rides[["route", "dir", "zt"]].rename(columns={"zt": "z"})]).drop_duplicates().reset_index(drop=True)
rn["node"] = NZ + np.arange(len(rn))
key = {(r.route, r.dir, r.z): r.node for r in rn.itertuples()}
lignes = {l["id_line"]: l for l in json.load(open(RAW + "lignes.json", encoding="utf-8"))}
routes = pd.read_csv(G + "routes.txt", dtype=str)
rinfo = {r.route_id: (r.route_short_name, int(r.route_type)) for r in routes.itertuples()}
CL = {"true": 0, "partial": 1, "false": 2}
def clim_of(route): return CL.get((lignes.get(route.replace("IDFM:", ""), {}).get("air_conditioning") or "unknown"), 1)

aj = stops.aj.fillna(stops.aj.median()).values.astype(np.float32)
E = []   # src, dst, type, ivt, wait, walk, aj, clim, route_index
route_ids = sorted(rn.route.unique()); ridx = {r: i for i, r in enumerate(route_ids)}
w = dep.set_index(["route", "dir", "z"])["wait"].to_dict()
for r in rn.itertuples():
    wt = w.get((r.route, r.dir, r.z))
    if wt is not None:  # on ne peut monter que là où la ligne marque l'arrêt dans la fenêtre
        E.append((r.z, r.node, 1, 0.0, wt, 0.0, aj[r.z], 0, ridx[r.route]))
    E.append((r.node, r.z, 2, 0.0, 0.0, 0.0, aj[r.z], 0, ridx[r.route]))
for r in rides.itertuples():
    E.append((key[(r.route, r.dir, r.zf)], key[(r.route, r.dir, r.zt)], 3, r.t, 0.0, 0.0, 0.0, clim_of(r.route), ridx[r.route]))
log("arcs monter/descendre/rouler", len(E))

# ---------- Marche entre zones (≤ 400 m, détour 1,25, 4,5 km/h) ----------
g = gpd.GeoDataFrame(geometry=gpd.points_from_xy(stops.lon, stops.lat), crs=4326).to_crs(2154)
pairs = gpd.sjoin(g, gpd.GeoDataFrame(geometry=g.buffer(400), crs=2154), predicate="within")
pairs = pairs[pairs.index != pairs.index_right]
dx = g.geometry.x.values; dy = g.geometry.y.values
a, b = pairs.index.values, pairs.index_right.values
d = np.hypot(dx[a] - dx[b], dy[a] - dy[b])
for i, j, dd in zip(a, b, d):
    E.append((i, j, 4, 0.0, 0.0, dd * 1.25 / 75.0, (aj[i] + aj[j]) / 2, 0, -1))
E = np.array(E, dtype=np.float64)
log("arcs au total", len(E), "· nœuds", NZ + len(rn))
np.savez_compressed(OUT + "graph.npz", E=E, NZ=NZ, NN=NZ + len(rn),
                    rn_route=rn.route.map(ridx).values, rn_z=rn.z.values,
                    route_ids=np.array(route_ids), route_names=np.array([rinfo.get(r, ("?", 3))[0] for r in route_ids]),
                    route_types=np.array([rinfo.get(r, ("?", 3))[1] for r in route_ids]))
log("graphe écrit")
