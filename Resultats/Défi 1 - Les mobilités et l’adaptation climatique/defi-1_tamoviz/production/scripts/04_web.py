"""Export pour la page web régionale.
web/data/core.js     arrêts (colonnes compactes), lignes par arrêt, échantillons, compteurs
web/data/flow.js     fréquentation estimée par arrêt (référence + indice par jour)
web/data/layers.js   communes et IRIS (frontières partagées simplifiées), tracés des lignes
web/data/volet2.js   vigilance, météo, validations
web/tiles/*.js       tuiles 0,05° : îlots de chaleur, carreaux Filosofi, lieux frais (chargées à la demande)"""
import json, math, os, time
from collections import defaultdict
import numpy as np, pandas as pd, geopandas as gpd, shapely

RAW, OUT, WEB, L93 = "data/raw/", "data/processed/", "web/", 2154
TS = 0.05
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
def js(path, var, obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=lambda o: None if (isinstance(o, float) and math.isnan(o)) else (o.item() if hasattr(o, "item") else str(o)))
    open(path, "w", encoding="utf-8").write(f"window.{var}=" + s.replace("</", "<\\/") + ";")
    return round(len(s) / 1e6, 2)
def nan(v): return None if v is None or (isinstance(v, float) and math.isnan(v)) else v
def rnd(c, p=5):
    if isinstance(c[0], (int, float)): return [round(c[0], p), round(c[1], p)]
    return [rnd(x, p) for x in c]
def gj(gdf, props, prec=5):
    g = gdf.to_crs(4326); feats = []
    for r in g.itertuples():
        m = shapely.geometry.mapping(r.geometry)
        feats.append({"type": "Feature", "properties": {k: nan(getattr(r, k)) for k in props}, "geometry": {"type": m["type"], "coordinates": rnd(m["coordinates"], prec)}})
    return {"type": "FeatureCollection", "features": feats}
os.makedirs(WEB + "data", exist_ok=True); os.makedirs(WEB + "tiles", exist_ok=True)

# ---------- Arrêts ----------
st = pd.read_parquet(OUT + "stops.parquet"); pl = pd.read_parquet(OUT + "per_line.parquet"); fl = pd.read_parquet(OUT + "flow.parquet")
lines = {z: [[r.nom_ligne_commerciale, r.mode, r.clim, r.p, r.m] for r in g.itertuples()] for z, g in pl.groupby("id_zone_arret")}
cols = dict(id=st.id_zone_arret.tolist(), n=st.n.tolist(), c=st.c.tolist(), co=st.co.tolist(), ir=st.ir.tolist(),
            lon=st.lon.round(5).tolist(), lat=st.lat.round(5).tolist(), m=st.m.tolist(),
            pointe=st.pointe.tolist(), pp=st.pp.tolist(), nc=st.nc.tolist(), aj=st.aj.tolist(), an=st.an.tolist(),
            df=st.df.tolist(), fr=[None if pd.isna(x) else int(x) for x in st.fr], frp=st.frp.tolist(), nv=st.nv.tolist(), nvp=st.nvp.tolist(), pauv=st.pauv.tolist(), pop=st["pop"].tolist(),
            acc=st.acc.tolist(), ii=[list(x) if x is not None else [] for x in st.ii], fi=[list(x) if x is not None else [] for x in st.fi],
            pl=[lines.get(z, []) for z in st.id_zone_arret])
cols = {k: [nan(x) if not isinstance(x, (list, np.ndarray)) else (x.tolist() if isinstance(x, np.ndarray) else x) for x in v] for k, v in cols.items()}
cols["ii"] = [[list(map(int, p)) for p in x] for x in cols["ii"]]; cols["fi"] = [list(map(int, x)) for x in cols["fi"]]
cols["frp"] = [list(x) if x is not None else None for x in cols["frp"]]
cols["pl"] = [[[a, b, c, float(d), float(e)] for a, b, c, d, e in x] for x in cols["pl"]]
fl = fl.set_index("id_zone_arret").reindex(st.id_zone_arret)
flow = dict(vref=fl.vref.fillna(0).astype(int).tolist(), i=[json.loads(x) if isinstance(x, str) else None for x in fl.i], src=fl.src.fillna("").tolist())

# ---------- Échantillons et compteurs ----------
of = pd.read_parquet(RAW + "offre.parquet")
samp_of = of[(of.nom_ligne_commerciale == "26") & of.tranche_horaire.isin([7, 8, 13])].head(6)
icu_s = gpd.read_file(RAW + "icu.geojson", rows=slice(1000, 1006), columns=["code_imu", "type_lcz", "aleaj_note", "alea_j_cl", "alean_note", "vulnj_note"])
filo_s = gpd.read_file(RAW + "filosofi.geojson", rows=slice(40000, 40006), columns=["id_inspire", "nom_com", "ind", "men", "ind_snv", "men_pauv"])
lignes = json.load(open(RAW + "lignes.json", encoding="utf-8"))
arr = pd.read_parquet(RAW + "arrets.parquet")
frais = pd.read_parquet(OUT + "frais.parquet")
samples = dict(
    offre=samp_of[["id_ligne_commerciale", "nom_ligne_commerciale", "id_zone_arret", "id_arret", "nom_arret", "tranche_horaire", "nb_courses_mardi", "longitude_arret", "latitude_arret"]].to_dict("records"),
    lignes=[{k: l.get(k) for k in ["id_line", "shortname_line", "transportmode", "air_conditioning", "id_groupoflines", "operatorname"]} for l in lignes if l["id_line"] in ("C01094", "C01100", "C01123", "C01742", "C01743", "C02528")],
    arrets=arr[["arrid", "arrname", "arrtype", "arrtown", "arraccessibility", "zdaid"]].sample(6, random_state=3).to_dict("records"),
    icu=icu_s.drop(columns="geometry").to_dict("records"), filo=filo_s.drop(columns="geometry").to_dict("records"),
    frais=pd.concat([frais[frais.src == "Paris"].head(3), frais[frais.src == "OSM"].sample(3, random_state=1)])[["nom", "type", "src"]].to_dict("records"),
    access=json.load(open(RAW + "access.json", encoding="utf-8"))[:6])
samples["access"] = [{k: a.get(k) for k in ["stop_point_id", "stop_name", "accessibility_level_id", "accessibility_level_name"]} for a in samples["access"]]
v2 = json.load(open(OUT + "volet2.json", encoding="utf-8"))
counts = dict(offre=len(of), zones=len(st), lignes=int(of.id_ligne_commerciale.nunique()), arrets=len(arr), icu=261050,
              filo=94000, frais=len(frais), frais_osm=int((frais.src == "OSM").sum()), gares=len(v2["stations"]), bus=len(v2["buslines"]))
del of
log("core :", js(WEB + "data/core.js", "IDF", dict(cols=cols, samples=samples, counts=counts)), "Mo")
log("flow :", js(WEB + "data/flow.js", "FLOW", flow), "Mo")
log("volet2 :", js(WEB + "data/volet2.js", "V2", v2), "Mo")

# ---------- Couches globales ----------
com = gpd.read_file(RAW + "communes.geojson").to_crs(L93)
com["geometry"] = shapely.coverage_simplify(com.geometry.values, 60)
iris = gpd.read_file(RAW + "iris.geojson").to_crs(L93)
iris["geometry"] = shapely.coverage_simplify(iris.geometry.values, 25)
tr = gpd.read_file(RAW + "traces.geojson").to_crs(L93)
def _clean(g, bus):
    if g is None: return None
    q = 80 if bus else 40           # grille : les deux sens de circulation se superposent, puis fusion
    return shapely.line_merge(shapely.unary_union(shapely.set_precision(shapely.simplify(g, q / 2), q))).simplify(q)
tr["geometry"] = [_clean(g, rt == "Bus") for g, rt in zip(tr.geometry, tr.route_type)]
tr["id_line"] = tr.route_id.str.replace("IDFM:", "", regex=False)
lk = {l["id_line"]: l for l in lignes}
tr["clim"] = tr.id_line.map(lambda l: (lk.get(l, {}).get("air_conditioning") or "unknown"))
tr["gol"] = tr.id_line.map(lambda l: lk.get(l, {}).get("id_groupoflines"))
tr = tr[tr.geometry.notna() & ~tr.geometry.is_empty]
layers = dict(communes=gj(com, ["code", "nom", "population"], prec=4), iris=gj(iris, ["code_iris", "nom_iris", "nom_commune"]),
              traces=gj(tr, ["route_short_name", "route_type", "route_color", "clim", "gol"], prec=4))
log("layers :", js(WEB + "data/layers.js", "LAYERS", layers), "Mo")

# ---------- Tuiles ----------
def tile_of(lon, lat): return f"{int(math.floor(lon / TS))}_{int(math.floor(lat / TS))}"
def write_tiles(kind, items):
    by = defaultdict(list)
    for t, it in items: by[t].append(it)
    for t, v in by.items(): js(WEB + f"tiles/{kind}_{t}.js", f"__T_{kind}_{t}", v)
    return len(by)
icu = gpd.read_file(RAW + "icu.geojson", columns=["objectid", "aleaj_note"]).to_crs(L93)
icu["geometry"] = icu.simplify(1.5)
icu = icu.to_crs(4326)
rp = icu.geometry.representative_point()
items = []
for oid, note, geom, p in zip(icu.objectid, icu.aleaj_note, icu.geometry, rp):
    m = shapely.geometry.mapping(geom)
    items.append((tile_of(p.x, p.y), [int(oid), int(note), m["type"][0], rnd(m["coordinates"], 5)]))
log("tuiles ICU", write_tiles("icu", items)); del icu, items
fi = gpd.read_parquet(OUT + "filo.parquet")
fi = fi.to_crs(4326); c = fi.geometry.centroid
items = [(tile_of(p.x, p.y), [int(k), nan(r.ind), nan(r.nv), round(100 * r.men_pauv / r.men, 1) if r.men else None, r.ir, r.co, int(r.ns), rnd(shapely.geometry.mapping(r.geometry)["coordinates"][0], 5)])
         for k, (r, p) in enumerate(zip(fi.itertuples(), c))]
log("tuiles Filosofi", write_tiles("filo", items))
# table compacte des carreaux pour les agrégats (sans géométrie)
js(WEB + "data/carreaux.js", "CARS", dict(ind=[nan(x) for x in fi.ind.round(1)], nv=[nan(x) for x in fi.nv], ir=fi.ir.tolist(), co=fi.co.tolist(), ns=fi.ns.astype(int).tolist()))
fr = gpd.read_parquet(OUT + "frais.parquet").to_crs(4326)
rp = fr.geometry.representative_point()
items = [(tile_of(p.x, p.y), [k, r.nom or "", r.type or "", r.src, round(p.x, 5), round(p.y, 5)]) for k, (r, p) in enumerate(zip(fr.itertuples(), rp))]
log("tuiles lieux frais", write_tiles("frais", items))
js(WEB + "data/frais_names.js", "FRAIS", [[r.nom or "", r.type or "", r.src] for r in fr.itertuples()])
log("terminé")
