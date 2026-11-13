"""Scénario MATSim Île-de-France (heure locale, Lambert 93) à partir du GTFS IDFM et du recensement (MOBPRO 2021).
- réseau artificiel de transport en commun (une boucle par arrêt, un lien par paire d'arrêts consécutifs), comme pt2matsim
- horaires : courses du mardi 10 novembre 2026 entre 5 h et 22 h, motifs = même ligne et même suite de zones
- modes de route : rail, subway, tram, bus_ac (climatisé), bus_noac (non ou partiellement climatisé), cable
- population : échantillon de navetteurs TC (MOBPRO), domicile tiré dans les carreaux habités de la commune,
  travail près des arrêts de la commune d'emploi ; deux plans : aller travailler, ou télétravailler (jambe « stay »)
- deux configurations : ordinaire et canicule (notation plus sévère pour l'attente, la marche et les bus non climatisés)
Sortie : matsim/scenario/*.xml.gz, config_ordinaire.xml, config_canicule.xml"""
import gzip, json, math, os, sys, time
from xml.sax.saxutils import escape
import numpy as np, pandas as pd, geopandas as gpd, duckdb

RAW, OUT, G, SC = "data/raw/", "data/processed/", "data/raw/gtfs/", "matsim/scenario/"
SAMPLE = float(sys.argv[1]) if len(sys.argv) > 1 else 0.01
DAY, DOW, T0, T1 = "20261110", "tuesday", 5 * 3600, 22 * 3600
os.makedirs(SC, exist_ok=True)
rng = np.random.default_rng(42)
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
def hms(s): s = int(round(s)); return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"

# ---------- horaires du jour ----------
con = duckdb.connect(); rd = lambda f: f"read_csv('{G}{f}', header=true, all_varchar=true)"
svc = con.sql(f"""
  with base as (select service_id from {rd('calendar.txt')} where {DOW}='1' and start_date<='{DAY}' and end_date>='{DAY}'),
       add as (select service_id from {rd('calendar_dates.txt')} where date='{DAY}' and exception_type='1'),
       rem as (select service_id from {rd('calendar_dates.txt')} where date='{DAY}' and exception_type='2')
  select service_id from (select * from base union select * from add) where service_id not in (select * from rem)""").df()
con.register("svc", svc)
def secs(c): return f"(cast(split_part({c},':',1) as int)*3600+cast(split_part({c},':',2) as int)*60+cast(split_part({c},':',3) as int))"
st = con.sql(f"""with tr as (select t.trip_id, t.route_id from {rd('trips.txt')} t join svc using(service_id))
  select tr.route_id, s.trip_id, cast(s.stop_sequence as int) seq, s.stop_id, {secs('s.departure_time')} dep, {secs('s.arrival_time')} arr
  from {rd('stop_times.txt')} s join tr using(trip_id)""").df()
arr = pd.read_parquet(RAW + "arrets.parquet", columns=["arrid", "zdaid"])
zmap = dict(zip("IDFM:" + arr.arrid.astype(str), arr.zdaid.astype(str)))
zmap.update({"IDFM:monomodalStopPlace:" + z: z for z in arr.zdaid.astype(str).unique()})
stops = pd.read_parquet(OUT + "stops.parquet"); zid = {z: i for i, z in enumerate(stops.id_zone_arret)}
st["z"] = st.stop_id.map(zmap).map(zid); st = st.dropna(subset=["z"]); st["z"] = st.z.astype(int)
st = st.sort_values(["trip_id", "seq"]); st = st[st.z != st.groupby("trip_id").z.shift()]
# heures manquantes : l'une remplace l'autre ; les courses encore incomplètes sont écartées
st["dep"] = st.dep.fillna(st.arr); st["arr"] = st.arr.fillna(st.dep)
bad = st[st.dep.isna() | st.arr.isna()].trip_id.unique(); st = st[~st.trip_id.isin(bad)]
st["dep"] = st.dep.astype(float); st["arr"] = st.arr.astype(float)
first = st.groupby("trip_id").dep.min(); keep = first[(first >= T0) & (first <= T1)].index
st = st[st.trip_id.isin(keep)]
log("courses", len(keep), "· passages", len(st))
zg = gpd.GeoDataFrame(geometry=gpd.points_from_xy(stops.lon, stops.lat), crs=4326).to_crs(2154)
ZX, ZY = zg.geometry.x.values, zg.geometry.y.values

lig = {l["id_line"]: l for l in json.load(open(RAW + "lignes.json", encoding="utf-8"))}
routes = pd.read_csv(G + "routes.txt", dtype=str)
rtype = dict(zip(routes.route_id, routes.route_type)); rname = dict(zip(routes.route_id, routes.route_short_name))
def mode_of(r):
    t = rtype.get(r, "3")
    if t == "2": return "rail"
    if t == "1": return "subway"
    if t == "0": return "tram"
    if t in ("6", "7"): return "cable"
    ac = (lig.get(r.replace("IDFM:", ""), {}).get("air_conditioning") or "unknown")
    return "bus_ac" if ac == "true" else "bus_noac"
trips = st.groupby("trip_id").agg(route=("route_id", "first"), zs=("z", lambda s: tuple(s)), deps=("dep", list), arrs=("arr", list))
trips = trips[trips.zs.map(len) >= 2]

# ---------- réseau artificiel ----------
used = sorted({z for zs in trips.zs for z in zs})
links = {}                                           # (a, b) -> id
def link_id(a, b):
    k = (a, b)
    if k not in links: links[k] = f"pt_{a}_{b}"
    return links[k]
for z in used: link_id(z, z)
for zs in set(trips.zs):
    for a, b in zip(zs[:-1], zs[1:]): link_id(a, b)
with gzip.open(SC + "network.xml.gz", "wt", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE network SYSTEM "http://www.matsim.org/files/dtd/network_v2.dtd">\n<network>\n<nodes>\n')
    for z in used: f.write(f'<node id="n{z}" x="{ZX[z]:.1f}" y="{ZY[z]:.1f}"/>\n')
    f.write('</nodes>\n<links capperiod="01:00:00" effectivecellsize="7.5" effectivelanewidth="3.75">\n')
    for (a, b), lid in links.items():
        L = 10.0 if a == b else max(10.0, float(math.hypot(ZX[a] - ZX[b], ZY[a] - ZY[b])))
        f.write(f'<link id="{lid}" from="n{a}" to="n{b}" length="{L:.1f}" freespeed="40.0" capacity="100000" permlanes="1" oneway="1" modes="pt"/>\n')
    f.write('</links>\n</network>\n')
log("réseau :", len(used), "nœuds,", len(links), "liens")

# ---------- horaires MATSim et véhicules ----------
nveh = 0
with gzip.open(SC + "transitSchedule.xml.gz", "wt", encoding="utf-8") as f, gzip.open(SC + "transitVehicles.xml.gz", "wt", encoding="utf-8") as fv:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE transitSchedule SYSTEM "http://www.matsim.org/files/dtd/transitSchedule_v2.dtd">\n<transitSchedule>\n<transitStops>\n')
    for z in used:
        f.write(f'<stopFacility id="s{z}" x="{ZX[z]:.1f}" y="{ZY[z]:.1f}" linkRefId="pt_{z}_{z}" name="{escape(str(stops.n.iloc[z]))}" isBlocking="false"/>\n')
    f.write('</transitStops>\n')
    fv.write('<?xml version="1.0" encoding="UTF-8"?>\n<vehicleDefinitions xmlns="http://www.matsim.org/files/dtd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.matsim.org/files/dtd http://www.matsim.org/files/dtd/vehicleDefinitions_v2.0.xsd">\n')
    for vt, seats, standing, length in [("bus", 35, 65, 12), ("rail", 500, 1000, 200), ("tram", 80, 180, 40)]:
        fv.write(f'<vehicleType id="{vt}"><capacity seats="{seats}" standingRoomInPersons="{standing}"/><length meter="{length}"/><width meter="2.5"/>'
                 f'<passengerCarEquivalents pce="0"/><networkMode networkMode="pt"/><flowEfficiencyFactor factor="1.0"/></vehicleType>\n')
    vlist = []
    for route, g in trips.groupby("route"):
        m = mode_of(route); vt = "rail" if m in ("rail", "subway") else ("tram" if m in ("tram", "cable") else "bus")
        f.write(f'<transitLine id="{escape(route)}" name="{escape(str(rname.get(route, route)))}">\n')
        for pk, (zs, gg) in enumerate(g.groupby("zs")):
            D = np.array(gg.deps.tolist(), float); A = np.array(gg.arrs.tolist(), float)
            off_d = np.median(D - D[:, :1], axis=0); off_a = np.median(A - D[:, :1], axis=0)
            off_d = np.maximum.accumulate(off_d); off_a = np.maximum(np.maximum.accumulate(off_a), 0)
            f.write(f'<transitRoute id="{escape(route)}_{pk}">\n<transportMode>{m}</transportMode>\n<routeProfile>\n')
            for i, z in enumerate(zs):
                a_ = f' arrivalOffset="{hms(off_a[i])}"' if i > 0 else ""
                d_ = f' departureOffset="{hms(max(off_d[i], off_a[i]))}"' if i < len(zs) - 1 else ""
                f.write(f'<stop refId="s{z}"{a_}{d_} awaitDeparture="true"/>\n')
            f.write('</routeProfile>\n<route>\n')
            seq = []
            for i, z in enumerate(zs):
                seq.append(f"pt_{z}_{z}")
                if i < len(zs) - 1: seq.append(f"pt_{z}_{zs[i + 1]}")
            f.write("".join(f'<link refId="{l}"/>' for l in seq) + "\n</route>\n<departures>\n")
            for j, t in enumerate(sorted(D[:, 0])):
                vid = f"v{nveh}"; nveh += 1; vlist.append((vid, vt))
                f.write(f'<departure id="{j}" departureTime="{hms(t)}" vehicleRefId="{vid}"/>\n')
            f.write('</departures>\n</transitRoute>\n')
        f.write('</transitLine>\n')
    f.write('</transitSchedule>\n')
    for vid, vt in vlist: fv.write(f'<vehicle id="{vid}" type="{vt}"/>\n')
    fv.write('</vehicleDefinitions>\n')
log("horaires et véhicules :", nveh, "départs")

# ---------- population (MOBPRO) ----------
IDF = "('75','77','78','91','92','93','94','95')"
mp = con.sql(f"""select case when COMMUNE='75056' then ARM else COMMUNE end o, DCLT d, CS1 cs, AGEREVQ age, IPONDI w
                 from '{RAW}RP2021_mobpro.parquet' where TRANS='6' and substr(COMMUNE,1,2) in {IDF} and substr(DCLT,1,2) in {IDF}""").df()
n_target = int(round(mp.w.sum() * SAMPLE))
pick = rng.choice(len(mp), size=n_target, replace=True, p=mp.w.values / mp.w.sum())
P = mp.iloc[pick].reset_index(drop=True)
fi = gpd.read_parquet(OUT + "filo.parquet"); fc = fi.to_crs(2154).geometry.centroid
fi["x"], fi["y"] = fc.x.values, fc.y.values
cars_by_com = {c: (g.x.values, g.y.values, (g.ind.fillna(0).values + 1e-6) / (g.ind.fillna(0).values + 1e-6).sum()) for c, g in fi.groupby(fi.co.astype(str))}
nb = st[(st.dep >= 7 * 3600) & (st.dep <= 9 * 3600)].groupby("z").size()
stops["com"] = stops.co.astype(str)
zs_by_com = {c: (g.index.values, (nb.reindex(g.index).fillna(0).values + 1) / (nb.reindex(g.index).fillna(0).values + 1).sum()) for c, g in stops.groupby("com")}
def home_xy(c):
    t = cars_by_com.get(c)
    if t is None: return None
    k = rng.choice(len(t[0]), p=t[2]); return t[0][k] + rng.uniform(-100, 100), t[1][k] + rng.uniform(-100, 100)
def work_xy(c):
    t = zs_by_com.get(c)
    if t is None: return None
    k = rng.choice(t[0], p=t[1]); return ZX[k] + rng.normal(0, 150), ZY[k] + rng.normal(0, 150)
CSN = {"1": "agri", "2": "indep", "3": "cadre", "4": "inter", "5": "employe", "6": "ouvrier"}
nok = 0
with gzip.open(SC + "population.xml.gz", "wt", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE population SYSTEM "http://www.matsim.org/files/dtd/population_v6.dtd">\n<population>\n')
    for i, r in P.iterrows():
        h = home_xy(r.o); w = work_xy(r.d)
        if h is None or w is None: continue
        dep = float(np.clip(rng.normal(7.75 * 3600, 2700), 5.5 * 3600, 10.5 * 3600)); dur = float(np.clip(rng.normal(8.5 * 3600, 3600), 5 * 3600, 11 * 3600))
        sub = "cadre" if r.cs == "3" else ("essentiel" if r.cs in ("5", "6") else "autre")
        f.write(f'<person id="p{i}"><attributes><attribute name="subpopulation" class="java.lang.String">{sub}</attribute>'
                f'<attribute name="cs" class="java.lang.String">{CSN.get(r.cs, "autre")}</attribute>'
                f'<attribute name="home_com" class="java.lang.String">{r.o}</attribute><attribute name="work_com" class="java.lang.String">{r.d}</attribute></attributes>\n')
        f.write(f'<plan selected="yes"><activity type="home" x="{h[0]:.1f}" y="{h[1]:.1f}" end_time="{hms(dep)}"/><leg mode="pt"/>'
                f'<activity type="work" x="{w[0]:.1f}" y="{w[1]:.1f}" end_time="{hms(dep + dur + 2400)}"/><leg mode="pt"/>'
                f'<activity type="home" x="{h[0]:.1f}" y="{h[1]:.1f}"/></plan>\n')
        f.write(f'<plan selected="no"><activity type="home" x="{h[0]:.1f}" y="{h[1]:.1f}" end_time="{hms(dep)}"/><leg mode="stay"/>'
                f'<activity type="telework" x="{h[0]:.1f}" y="{h[1]:.1f}" end_time="{hms(dep + dur)}"/><leg mode="stay"/>'
                f'<activity type="home" x="{h[0]:.1f}" y="{h[1]:.1f}"/></plan>\n</person>\n')
        nok += 1
    f.write('</population>\n')
log("population :", nok, "agents (échantillon", SAMPLE * 100, "%)")
json.dump(dict(sample=SAMPLE, agents=nok, departures=nveh, stops=len(used), links=len(links)), open(SC + "meta.json", "w"))
