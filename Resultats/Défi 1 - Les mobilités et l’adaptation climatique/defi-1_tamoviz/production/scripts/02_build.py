"""Indicateurs par zone d'arrêt pour toute l'Île-de-France (même méthode que la zone test).
Entrée : data/raw/  ·  Sortie : data/processed/stops.parquet (+ fichiers intermédiaires)"""
import json, time, gc
import numpy as np, pandas as pd, geopandas as gpd, shapely, shapely.ops
from shapely.geometry import Point

RAW, OUT, L93 = "data/raw/", "data/processed/", 2154
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
load = lambda f: json.load(open(RAW + f, encoding="utf-8"))

# ---------- Offre ----------
cols = ["libelle_mode_ligne", "id_ligne_commerciale", "nom_ligne_commerciale", "id_zone_arret", "id_arret", "nom_arret",
        "tranche_horaire", "nb_courses_mardi", "nom_commune", "longitude_arret", "latitude_arret"]
of = pd.read_parquet(RAW + "offre.parquet", columns=cols)
# trains et RER : l'offre n'a pas de coordonnées ; on les prend dans le GTFS (zone d'arrêt = monomodalStopPlace)
gs = pd.read_csv(RAW + "gtfs/stops.txt", usecols=["stop_id", "stop_lon", "stop_lat"], dtype={"stop_id": str})
gs = gs[gs.stop_id.str.startswith("IDFM:monomodalStopPlace:")]
gs["z"] = gs.stop_id.str.split(":").str[-1]
zlon = gs.groupby("z").stop_lon.mean(); zlat = gs.groupby("z").stop_lat.mean()
miss = of.longitude_arret.isna()
of.loc[miss, "longitude_arret"] = of.loc[miss, "id_zone_arret"].astype(str).map(zlon)
of.loc[miss, "latitude_arret"] = of.loc[miss, "id_zone_arret"].astype(str).map(zlat)
log("coordonnées complétées par le GTFS :", int(miss.sum() - of.longitude_arret.isna().sum()), "lignes d'offre")
of = of.dropna(subset=["id_zone_arret", "longitude_arret"])
of["id_zone_arret"] = of["id_zone_arret"].astype(str)
lignes = {l["id_line"]: l for l in load("lignes.json")}
clim = lambda l: (lignes.get(l, {}).get("air_conditioning") or "unknown")
of["clim"] = of["id_ligne_commerciale"].map(clim)
MODE = {"Bus": "bus", "Métro": "metro", "Tramway": "tram", "RER": "rer", "Train": "train", "Câble": "cable", "Funiculaire": "cable", "Navette": "bus"}
of["mode"] = of["libelle_mode_ligne"].map(MODE).fillna("cable")
log("offre", len(of), "lignes ·", of.id_zone_arret.nunique(), "zones ·", sorted(of.libelle_mode_ligne.dropna().unique()))

zones = of.groupby("id_zone_arret").agg(n=("nom_arret", "first"), lon=("longitude_arret", "mean"), lat=("latitude_arret", "mean"),
                                        cn=("nom_commune", "first")).reset_index()
pointe = of[of.tranche_horaire.isin([7, 8])].groupby("id_zone_arret")["nb_courses_mardi"].sum() / 2
mid = of[of.tranche_horaire.between(12, 18)].copy()
mid["w"] = mid["clim"].map({"false": 1.0, "partial": 0.5, "true": 0.0})
mk = mid[mid.w.notna()]
nc = (mk.w * mk.nb_courses_mardi).groupby(mk.id_zone_arret).sum() / mk.groupby("id_zone_arret")["nb_courses_mardi"].sum()
RANK = ["train", "rer", "metro", "tram", "cable", "bus"]
mmode = of.groupby("id_zone_arret")["mode"].agg(lambda s: min(set(s), key=RANK.index))
pl = of.groupby(["id_zone_arret", "id_ligne_commerciale", "nom_ligne_commerciale", "mode", "clim"]).apply(lambda g: pd.Series({
    "p": g[g.tranche_horaire.isin([7, 8])].nb_courses_mardi.sum() / 2,
    "m": g[g.tranche_horaire.between(12, 18)].nb_courses_mardi.sum(),
    "j": g.nb_courses_mardi.sum()}), include_groups=False).reset_index()
zones["pointe"] = zones.id_zone_arret.map(pointe).fillna(0).round(1)
zones["nc"] = zones.id_zone_arret.map(nc).round(3)
zones["m"] = zones.id_zone_arret.map(mmode)
arr_by_zone = of.groupby("id_zone_arret")["id_arret"].agg(lambda s: sorted(set(map(str, s))))
del of, mid, mk; gc.collect()
gz = gpd.GeoDataFrame(zones, geometry=gpd.points_from_xy(zones.lon, zones.lat), crs=4326).to_crs(L93)
log("zones", len(gz))

# ---------- Commune et IRIS ----------
com = gpd.read_file(RAW + "communes.geojson").to_crs(L93)[["code", "nom", "geometry"]]
iris = gpd.read_file(RAW + "iris.geojson").to_crs(L93)[["code_iris", "nom_iris", "nom_commune", "code_insee", "geometry"]]
j = gpd.sjoin(gz[["geometry"]], com, how="left", predicate="within"); j = j[~j.index.duplicated()]
gz["co"] = j["code"]; gz["c"] = j["nom"].fillna(gz["cn"]).str.replace(" Arrondissement", "", regex=False)
j = gpd.sjoin(gz[["geometry"]], iris[["code_iris", "geometry"]], how="left", predicate="within"); j = j[~j.index.duplicated()]
gz["ir"] = j["code_iris"]
gz = gz[gz.co.notna()].reset_index(drop=True)          # hors Île-de-France : écarté
log("zones en IDF", len(gz))

# ---------- Critère chaleur : ICU, tampon 50 m ----------
icu = gpd.read_file(RAW + "icu.geojson", columns=["objectid", "aleaj_note", "alean_note"]).to_crs(L93)
icu = icu[icu.aleaj_note >= 0].reset_index(drop=True)
icu["geometry"] = shapely.make_valid(icu.geometry.values)
icu = icu[icu.geom_type.isin(["Polygon", "MultiPolygon", "GeometryCollection"])].reset_index(drop=True)
buf = gpd.GeoDataFrame({"z": gz.index}, geometry=gz.buffer(50), crs=L93)
pairs = gpd.sjoin(buf, icu, how="inner", predicate="intersects")[["z", "index_right"]]
a = shapely.intersection(buf.geometry.values[pairs.z.values], icu.geometry.values[pairs.index_right.values])
pairs["a"] = shapely.area(a); pairs["note"] = icu.aleaj_note.values[pairs.index_right.values]; pairs["nn"] = icu.alean_note.values[pairs.index_right.values]
pairs["oid"] = icu.objectid.values[pairs.index_right.values]
g = pairs.groupby("z")
gz["aj"] = (g.apply(lambda d: (d.note * d.a).sum() / d.a.sum(), include_groups=False)).round(1)
gz["an"] = (g.apply(lambda d: (d.nn * d.a).sum() / d.a.sum(), include_groups=False)).round(1)
ii = g.apply(lambda d: [[int(o), int(round(x))] for o, x in zip(d.oid, d.a)], include_groups=False)
gz["ii"] = gz.index.map(ii)
del pairs, a, buf; gc.collect(); log("chaleur ok", gz.aj.notna().sum())

# ---------- Critère fraîcheur : Ville de Paris + OSM ----------
fe = gpd.read_file(RAW + "ilots-de-fraicheur-equipements-activites.geojson")[["nom", "type", "geometry"]].assign(src="Paris")
fv = gpd.read_file(RAW + "ilots-de-fraicheur-espaces-verts-frais.geojson")[["nom", "type", "geometry"]].assign(src="Paris")
osm = load("osm_parcs.json")["elements"]
rows = []
for e in osm:
    if "geometry" not in e and "members" not in e: continue
    t = e.get("tags", {})
    try:
        if e["type"] == "way":
            pts = [(p["lon"], p["lat"]) for p in e["geometry"]]
            if len(pts) < 4: continue
            geom = shapely.Polygon(pts)
        else:
            outers = [m for m in e.get("members", []) if m.get("role") == "outer" and "geometry" in m]
            lines = [shapely.LineString([(p["lon"], p["lat"]) for p in m["geometry"]]) for m in outers if len(m["geometry"]) > 1]
            geom = shapely.ops.unary_union(list(shapely.ops.polygonize(lines))) if lines else None
        if geom is None or geom.is_empty: continue
        typ = t.get("leisure") or t.get("landuse") or t.get("natural")
        rows.append(dict(nom=t.get("name", ""), type={"park": "parc", "garden": "jardin", "forest": "bois", "wood": "bois", "recreation_ground": "espace de loisirs"}.get(typ, typ), geometry=geom.buffer(0), src="OSM"))
    except Exception:
        continue
fo = gpd.GeoDataFrame(rows, crs=4326)
frais = pd.concat([fe.to_crs(L93), fv.to_crs(L93), fo.to_crs(L93)], ignore_index=True)
frais = frais[frais.geometry.notna() & ~frais.geometry.is_empty].reset_index(drop=True)
frais = frais[(frais.src == "Paris") | (frais.area >= 2000)].reset_index(drop=True)     # OSM : au moins 0,2 ha
log("lieux frais", len(frais), "dont OSM", (frais.src == "OSM").sum())
nn = gpd.sjoin_nearest(gz[["geometry"]], frais[["geometry"]], how="left", max_distance=3000, distance_col="d")
nn = nn[~nn.index.duplicated()]
gz["df"] = nn["d"].round(0); gz["fr"] = nn["index_right"]
sl = shapely.shortest_line(gz.geometry.values, frais.geometry.values[gz.fr.fillna(0).astype(int).values])
endp = gpd.GeoSeries(shapely.get_point(sl, 1), crs=L93).to_crs(4326)
gz["frp"] = [[round(p.x, 6), round(p.y, 6)] if not np.isnan(f) else None for p, f in zip(endp, gz.fr)]
log("fraîcheur ok")

# ---------- Critère revenus : Filosofi 200 m à 400 m ----------
fi = gpd.read_file(RAW + "filosofi.geojson", columns=["id_inspire", "ind", "men", "ind_snv", "men_pauv", "depcom"]).to_crs(L93)
fi = fi.reset_index(drop=True)
fc = gpd.GeoDataFrame(fi.drop(columns="geometry"), geometry=fi.centroid, crs=L93)
pr = gpd.sjoin(gpd.GeoDataFrame({"z": gz.index}, geometry=gz.buffer(400), crs=L93), fc[["ind", "ind_snv", "men", "men_pauv", "geometry"]], how="inner", predicate="contains")
g = pr.groupby("z")
gz["nv"] = (g.ind_snv.sum() / g.ind.sum()).round(0)
gz["pauv"] = (100 * g.men_pauv.sum() / g.men.sum()).round(1)
gz["pop"] = g.ind.sum().round(0)
gz["fi"] = gz.index.map(g.apply(lambda d: [int(x) for x in d.index_right], include_groups=False))
log("revenus ok", gz.nv.notna().sum())

# ---------- Critère accessibilité ----------
arr = pd.read_parquet(RAW + "arrets.parquet", columns=["arrid", "arraccessibility"])
acc_by = dict(zip(arr.arrid.astype(str), arr.arraccessibility))
def acc(z):
    v = [acc_by.get(a) for a in arr_by_zone.get(z, []) if acc_by.get(a)]
    if not v: return "unknown"
    if all(x == "true" for x in v): return "true"
    if any(x == "false" for x in v): return "false"
    return "partial"
gz["acc"] = gz.id_zone_arret.map(acc)

# ---------- Rangs centiles ----------
gz["pp"] = gz.groupby("m")["pointe"].rank(pct=True).mul(100).round(0)
gz["nvp"] = gz["nv"].rank(pct=True).mul(100).round(0)

# ---------- Carreaux : IRIS, commune, arrêt le plus proche ----------
j = gpd.sjoin(fc[["geometry"]], iris[["code_iris", "geometry"]], how="left", predicate="within"); j = j[~j.index.duplicated()]
fc["ir"] = j["code_iris"]
j = gpd.sjoin(fc[["geometry"]], com[["code", "geometry"]], how="left", predicate="within"); j = j[~j.index.duplicated()]
fc["co"] = j["code"]
nn = gpd.sjoin_nearest(fc[["geometry"]], gz[["geometry"]], how="left", distance_col="d"); nn = nn[~nn.index.duplicated()]
fc["ns"] = nn["index_right"].astype(int); fc["nd"] = nn["d"].round(0)
fc["nv"] = (fc.ind_snv / fc.ind).round(0)

pl["p"] = pl.p.round(1); pl["m"] = pl.m.round(0); pl["j"] = pl.j.round(1)
gz.drop(columns="geometry").to_parquet(OUT + "stops.parquet")
pl.to_parquet(OUT + "per_line.parquet")
fc.assign(geometry=fi.geometry).to_parquet(OUT + "filo.parquet")
frais.to_parquet(OUT + "frais.parquet")
log("écrit : stops", len(gz), "· carreaux", len(fc), "· lieux frais", len(frais))
