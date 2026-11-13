"""Horaires au format RAPTOR (Delling et al. 2012) pour les isochrones calculées dans le navigateur.
Mardi 10 novembre 2026, départs entre 6 h 30 et 10 h 30, arrêts = zones d'arrêt.
Motifs (routes RAPTOR) = courses d'une même ligne qui desservent la même suite de zones.
Sortie : web/data/raptor.js  →  window.RP = {ns, pat:[{s:[zones], t:[départs aplatis, en secondes]}], fp:[[voisin, mètres]...]}"""
import json, time
import numpy as np, pandas as pd, duckdb, geopandas as gpd

RAW, OUT, G = "data/raw/", "data/processed/", "data/raw/gtfs/"
DAY, DOW = "20261110", "tuesday"
T0, T1 = 6 * 3600 + 1800, 10 * 3600 + 1800
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
con = duckdb.connect()
rd = lambda f: f"read_csv('{G}{f}', header=true, all_varchar=true)"
svc = con.sql(f"""
  with base as (select service_id from {rd('calendar.txt')} where {DOW}='1' and start_date<='{DAY}' and end_date>='{DAY}'),
       add as (select service_id from {rd('calendar_dates.txt')} where date='{DAY}' and exception_type='1'),
       rem as (select service_id from {rd('calendar_dates.txt')} where date='{DAY}' and exception_type='2')
  select service_id from (select * from base union select * from add) where service_id not in (select * from rem)""").df()
con.register("svc", svc)
def secs(col): return f"(cast(split_part({col},':',1) as int)*3600+cast(split_part({col},':',2) as int)*60+cast(split_part({col},':',3) as int))"
st = con.sql(f"""
  with tr as (select t.trip_id, t.route_id from {rd('trips.txt')} t join svc using(service_id))
  select tr.route_id, s.trip_id, cast(s.stop_sequence as int) seq, s.stop_id, {secs('s.departure_time')} dep, {secs('s.arrival_time')} arr
  from {rd('stop_times.txt')} s join tr using(trip_id)""").df()
arr = pd.read_parquet(RAW + "arrets.parquet", columns=["arrid", "zdaid"])
zmap = dict(zip("IDFM:" + arr.arrid.astype(str), arr.zdaid.astype(str)))
zmap.update({"IDFM:monomodalStopPlace:" + z: z for z in arr.zdaid.astype(str).unique()})
stops = pd.read_parquet(OUT + "stops.parquet"); zid = {z: i for i, z in enumerate(stops.id_zone_arret)}
st["z"] = st.stop_id.map(zmap).map(zid); st = st.dropna(subset=["z"]); st["z"] = st.z.astype(int)
st = st.sort_values(["trip_id", "seq"])
# garder les courses qui roulent dans la fenêtre
span = st.groupby("trip_id").agg(a=("dep", "min"), b=("arr", "max"))
keep = span[(span.b >= T0) & (span.a <= T1)].index
st = st[st.trip_id.isin(keep)]
log("courses dans la fenêtre", len(keep), "· passages", len(st))
# une zone répétée consécutivement (deux quais) : on garde un seul passage
st = st[st.z != st.groupby("trip_id").z.shift()]
trips = st.groupby("trip_id").agg(route=("route_id", "first"), zs=("z", lambda s: tuple(s)), deps=("dep", lambda s: list(s)), arrs=("arr", lambda s: list(s)))
trips = trips[trips.zs.map(len) >= 2]
pats = []
for (route, zs), g in trips.groupby(["route", "zs"]):
    g = g.assign(first=g.deps.map(lambda d: d[0])).sort_values("first")
    D = np.array(g.deps.tolist()); A = np.array(g.arrs.tolist())
    # RAPTOR suppose qu'aucune course n'en double une autre : on impose des horaires croissants par arrêt
    D = np.maximum.accumulate(D, axis=0); A = np.maximum.accumulate(A, axis=0)
    pats.append(dict(r=route, s=list(map(int, zs)), t=D.ravel().astype(int).tolist(), a=A.ravel().astype(int).tolist(), n=len(g)))
log("motifs", len(pats))
# correspondances à pied entre zones (≤ 400 m, détour 1,25)
g = gpd.GeoDataFrame(geometry=gpd.points_from_xy(stops.lon, stops.lat), crs=4326).to_crs(2154)
pairs = gpd.sjoin(g, gpd.GeoDataFrame(geometry=g.buffer(400), crs=2154), predicate="within")
pairs = pairs[pairs.index != pairs.index_right]
x, y = g.geometry.x.values, g.geometry.y.values
fp = [[] for _ in range(len(stops))]
for i, j in zip(pairs.index.values, pairs.index_right.values):
    fp[i].append([int(j), int(round(np.hypot(x[i] - x[j], y[i] - y[j]) * 1.25))])
lig = {l["id_line"]: l for l in json.load(open(RAW + "lignes.json", encoding="utf-8"))}
routes = pd.read_csv(G + "routes.txt", dtype=str)
rname = dict(zip(routes.route_id, routes.route_short_name)); rtype = dict(zip(routes.route_id, routes.route_type))
out = dict(ns=len(stops), t0=T0, t1=T1,
           pat=[dict(s=p["s"], t=p["t"], a=p["a"], n=p["n"], nm=rname.get(p["r"], "?"), ty=int(rtype.get(p["r"], 3)),
                     cl={"true": 0, "partial": 1, "false": 2}.get(lig.get(p["r"].replace("IDFM:", ""), {}).get("air_conditioning") or "unknown", 1)) for p in pats],
           fp=fp)
s = json.dumps(out, separators=(",", ":"))
open("web/data/raptor.js", "w", encoding="utf-8").write("window.RP=" + s + ";")
log("raptor.js", round(len(s) / 1e6, 1), "Mo")
