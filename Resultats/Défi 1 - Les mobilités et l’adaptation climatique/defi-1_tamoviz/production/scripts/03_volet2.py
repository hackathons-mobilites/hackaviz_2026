"""Volet 2 à l'échelle régionale : vigilance par département, météo par département, validations de toutes les gares
et lignes, indices par rapport à un jour ordinaire, fréquentation estimée par zone d'arrêt.
Entrée : data/raw/, data/processed/stops.parquet, per_line.parquet · Sortie : data/processed/volet2.json, flow.parquet"""
import json, gzip, csv, statistics, datetime as dt, time
from collections import defaultdict
import numpy as np, pandas as pd, geopandas as gpd

RAW, OUT, L93 = "data/raw/", "data/processed/", 2154
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
load = lambda f: json.load(open(RAW + f, encoding="utf-8"))
DEPTS = ["75", "77", "78", "91", "92", "93", "94", "95"]
DEPT_NOM = {"75": "Paris", "77": "Seine-et-Marne", "78": "Yvelines", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise"}

# ---------- Vigilance ----------
vig = load("vigilance_idf.json")

# ---------- Météo : une station par département (la plus complète en juin 2026) ----------
meteo, stations_meteo = {}, {}
for d in DEPTS:
    by = defaultdict(lambda: defaultdict(list)); names = {}
    with gzip.open(RAW + f"H_{d}_latest-2025-2026.csv.gz", "rt", encoding="utf-8") as f:
        r = csv.reader(f, delimiter=";"); h = next(r); I = {k: h.index(k) for k in ["NUM_POSTE", "NOM_USUEL", "LAT", "LON", "AAAAMMJJHH", "T"]}
        for x in r:
            k = x[I["AAAAMMJJHH"]]
            if "2026051800" <= k < "2026070100" and x[I["T"]]:
                by[x[I["NUM_POSTE"]]][k[:8]].append(float(x[I["T"]])); names[x[I["NUM_POSTE"]]] = (x[I["NOM_USUEL"]], float(x[I["LAT"]]), float(x[I["LON"]]))
    pref = {"75": "75114001"}
    best = pref.get(d) if pref.get(d) in by else max(by, key=lambda s: sum(len(v) for v in by[s].values()))
    stations_meteo[d] = dict(id=best, nom=names[best][0], lat=names[best][1], lon=names[best][2])
    meteo[d] = {f"{k[:4]}-{k[4:6]}-{k[6:]}": dict(tx=max(v), tn=min(v)) for k, v in by[best].items() if len(v) >= 20}
    log("météo", d, stations_meteo[d]["nom"])

# ---------- Validations ----------
vf = load("valid_ferre_2eme.json"); vb = load("valid_bus_2eme.json")
lignes = {l["id_line"]: l for l in load("lignes.json")}
gol_clim = {}
for l in lignes.values():
    if l.get("id_groupoflines") and l["transportmode"] in ("bus", "tram"):
        gol_clim[l["id_groupoflines"]] = l.get("air_conditioning") or "unknown"
gares = load("gares.json")
st_pts = defaultdict(list)
for g in gares: st_pts[int(g["id_ref_zdc"])].append(g)
com = gpd.read_file(RAW + "communes.geojson")[["code", "geometry"]]

fer_st = defaultdict(lambda: defaultdict(float)); st_name = {}
for r in vf:
    if r.get("id_zdc") is None: continue
    z = int(r["id_zdc"]); fer_st[z][r["jour"][:10]] += r["nb_vald"]; st_name[z] = r["libelle_arret"]
bus_line = defaultdict(lambda: defaultdict(float)); bus_name = {}
for r in vb:
    if not r.get("id_groupoflines"): continue
    bus_line[r["id_groupoflines"]][r["jour"][:10]] += r["nb_vald"]; bus_name[r["id_groupoflines"]] = r["libelle_ligne"]

FERIES = {"2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-15", "2026-05-25"}
VAC = {(dt.date(2026, 4, 18) + dt.timedelta(i)).isoformat() for i in range(17)}
def is_ref(d):
    return d < "2026-06-01" and d not in FERIES and d not in VAC and max(vig.get(d, {"x": 1}).values()) == 1 if d in vig else (d < "2026-06-01" and d not in FERIES and d not in VAC)
def ref_index(series):
    byw = defaultdict(list)
    for d, v in series.items():
        if is_ref(d): byw[dt.date.fromisoformat(d).weekday()].append(v)
    med = {k: statistics.median(v) for k, v in byw.items() if v}
    return {d: 100 * v / med[dt.date.fromisoformat(d).weekday()] for d, v in series.items() if med.get(dt.date.fromisoformat(d).weekday())}, med
days = sorted(d for d in set().union(*[set(s) for s in fer_st.values()]) if d >= "2026-05-18")

# gares : position, département
stations = []
for z, s in fer_st.items():
    if z not in st_pts: continue
    pts = st_pts[z]; lon = float(np.mean([p["geo_point_2d"]["lon"] for p in pts])); lat = float(np.mean([p["geo_point_2d"]["lat"] for p in pts]))
    idx, med = ref_index(s)
    if not med: continue
    stations.append(dict(id=z, n=pts[0]["nom_zdc"], lon=round(lon, 5), lat=round(lat, 5), modes=sorted({p["mode"] for p in pts}),
                         lig=sorted({p["indice_lig"] for p in pts}), med=round(statistics.mean(med.values())),
                         i=[None if idx.get(d) is None else round(idx[d]) for d in days], v=[round(s.get(d, 0)) for d in days]))
sg = gpd.GeoDataFrame(stations, geometry=gpd.points_from_xy([s["lon"] for s in stations], [s["lat"] for s in stations]), crs=4326)
jj = gpd.sjoin(sg[["geometry"]], com, how="left", predicate="within"); jj = jj[~jj.index.duplicated()]
for s, c in zip(stations, jj["code"]): s["dep"] = (str(c)[:2] if isinstance(c, str) else None)
log("gares", len(stations))
buslines = []
for gol, s in bus_line.items():
    idx, med = ref_index(s)
    if not med: continue
    buslines.append(dict(gol=gol, n=bus_name[gol], clim=gol_clim.get(gol, "unknown"), med=round(statistics.mean(med.values())),
                         i=[None if idx.get(d) is None else round(idx[d]) for d in days]))
log("lignes de surface", len(buslines))

# séries régionales et départementales (ferré par département des gares)
def series(keys):
    out = {}
    for name, ser in keys.items():
        idx, _ = ref_index(ser); out[name] = [None if idx.get(d) is None else round(idx[d], 1) for d in days]
    return out
fer_idf = defaultdict(float); fer_dep = defaultdict(lambda: defaultdict(float))
for s in stations:
    for d, v in zip(days, s["v"]): fer_idf[d] += v; fer_dep[s["dep"]][d] += v
for z, ser in fer_st.items():                     # inclure aussi les jours avant le 18 mai pour la référence
    pass
# la référence a besoin d'avril-mai : on recalcule avec toutes les dates
fer_all = defaultdict(float); fer_dep_all = defaultdict(lambda: defaultdict(float))
dep_of = {s["id"]: s["dep"] for s in stations}
for z, ser in fer_st.items():
    if z not in dep_of: continue
    for d, v in ser.items(): fer_all[d] += v; fer_dep_all[dep_of[z]][d] += v
bus_all = defaultdict(lambda: defaultdict(float))
for gol, ser in bus_line.items():
    c = gol_clim.get(gol, "unknown"); grp = "clim" if c == "true" else "nonclim" if c in ("false", "partial") else "inconnu"
    for d, v in ser.items(): bus_all[grp][d] += v
S_IDF = series({"fer": fer_all, "bc": bus_all["clim"], "bn": bus_all["nonclim"]})
S_DEP = {dep: series({"fer": fer_dep_all[dep]})["fer"] for dep in DEPTS}
serie = []
for k, d in enumerate(days):
    serie.append(dict(d=d, wd=dt.date.fromisoformat(d).weekday(), ferie=d in FERIES,
                      vig={dep: vig.get(d, {}).get(dep) for dep in DEPTS},
                      met={dep: meteo[dep].get(d) for dep in DEPTS},
                      fer_i=S_IDF["fer"][k], bc_i=S_IDF["bc"][k], bn_i=S_IDF["bn"][k],
                      dep_i={dep: S_DEP[dep][k] for dep in DEPTS}))

# ---------- Fréquentation estimée par zone d'arrêt ----------
st = pd.read_parquet(OUT + "stops.parquet"); pl = pd.read_parquet(OUT + "per_line.parquet")
tot = {r["id_ligne_commerciale"]: r["tot"] for r in load("line_totals.json")}
line_gol = {l: lignes[l]["id_groupoflines"] for l in tot if l in lignes}
zi = {z: i for i, z in enumerate(st.id_zone_arret)}
all_days = sorted(set(fer_all) | set(bus_all["clim"]))
E = np.zeros((len(st), len(all_days))); di = {d: k for k, d in enumerate(all_days)}
src = [set() for _ in range(len(st))]
bus_mat = {g: np.array([ser.get(d, 0) for d in all_days]) for g, ser in bus_line.items()}
for r in pl[pl["mode"].isin(["bus", "tram", "cable"])].itertuples():
    g = line_gol.get(r.id_ligne_commerciale); k = zi.get(r.id_zone_arret)
    if k is None or g not in bus_mat or not tot.get(r.id_ligne_commerciale): continue
    E[k] += r.j / tot[r.id_ligne_commerciale] * bus_mat[g]; src[k].add("surface")
gst = gpd.GeoDataFrame(st[["id_zone_arret", "m"]], geometry=gpd.points_from_xy(st.lon, st.lat), crs=4326).to_crs(L93)
heavy = gst[gst.m.isin(["metro", "rer", "train", "tram"])]
sgl = sg.to_crs(L93)
nn = gpd.sjoin_nearest(sgl[["geometry"]], heavy[["geometry"]], how="left", max_distance=300, distance_col="dist")
nn = nn[~nn.index.duplicated()]
for (si, row) in nn.iterrows():
    if pd.isna(row["index_right"]): continue
    k = int(row["index_right"]); z = stations[si]["id"]
    E[k] += np.array([fer_st[z].get(d, 0) for d in all_days]); src[k].add("ferré")
vref, I = [], []
for k in range(len(st)):
    ser = {d: E[k, di[d]] for d in all_days}
    if E[k].sum() == 0: vref.append(0); I.append(None); continue
    idx, med = ref_index(ser)
    vref.append(round(statistics.mean(med.values())) if med else 0)
    I.append([None if idx.get(d) is None else int(round(idx[d])) for d in days])
flow = pd.DataFrame(dict(id_zone_arret=st.id_zone_arret, vref=vref, src=[",".join(sorted(s)) for s in src]))
flow["i"] = [json.dumps(x) for x in I]
flow.to_parquet(OUT + "flow.parquet")
log("fréquentation estimée", int((flow.vref > 0).sum()), "zones sur", len(flow))

json.dump(dict(days=days, serie=serie, stations=stations, buslines=buslines, meteo_stations=stations_meteo, dept_nom=DEPT_NOM),
          open(OUT + "volet2.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
red = [k for k, d in enumerate(days) if "2026-06-22" <= d <= "2026-06-26"]
log("semaine rouge IDF : ferré", round(np.mean([S_IDF["fer"][k] for k in red]), 1), "bus clim", round(np.mean([S_IDF["bc"][k] for k in red]), 1), "bus non clim", round(np.mean([S_IDF["bn"][k] for k in red]), 1))
