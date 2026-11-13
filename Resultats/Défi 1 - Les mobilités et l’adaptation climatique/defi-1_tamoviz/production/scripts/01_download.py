"""Téléchargement de toutes les sources pour l'Île-de-France entière.
Usage : python scripts/01_download.py   (depuis la racine du projet)
Reprise possible : un fichier déjà présent n'est pas retéléchargé."""
import json, os, re, subprocess, sys, time, urllib.parse, gzip, csv
from concurrent.futures import ThreadPoolExecutor, as_completed

RAW = "data/raw/"
CURL = r"C:\Windows\System32\curl.exe"
IDFM = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/"
DEPTS = ["75", "77", "78", "91", "92", "93", "94", "95"]
os.makedirs(RAW, exist_ok=True)

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
def get(url, params=None, out=None, compressed=True, tries=4):
    if params: url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    for k in range(tries):
        cmd = [CURL, "-s", "-L", "--ssl-no-revoke", "--max-time", "900", "-A", "hackaviz-idfm-2026/1.0"]
        if compressed: cmd.append("--compressed")
        if out: cmd += ["-o", out]
        r = subprocess.run(cmd + [url], capture_output=True)
        if r.returncode == 0 and (out is None or os.path.getsize(out) > 0):
            return r.stdout if out is None else out
        time.sleep(3 * (k + 1))
    raise RuntimeError("échec " + url[:120])
def have(f): return os.path.exists(RAW + f) and os.path.getsize(RAW + f) > 100

# ---------- IDFM : exports complets (parquet quand possible) ----------
def idfm_exports():
    jobs = {
        "offre.parquet": ("offre_hebdomadaire_moyenne_hors_vacances", "parquet", None),
        "arrets.parquet": ("arrets", "parquet", None),
        "lignes.json": ("referentiel-des-lignes", "json", None),
        "access.json": ("accessibilite-en-gare", "json", None),
        "fontaines.json": ("fontaines-arrets-de-transport-en-commun-didf", "json", None),
        "gares.json": ("emplacement-des-gares-idf", "json", None),
        "traces.geojson": ("traces-des-lignes-de-transport-en-commun-idfm", "geojson", None),
    }
    for f, (ds, fmt, w) in jobs.items():
        if have(f): continue
        log("IDFM", ds); get(IDFM + ds + "/exports/" + fmt, {"where": w} if w else None, RAW + f)
    if not have("line_totals.json"):
        get(IDFM + "offre_hebdomadaire_moyenne_hors_vacances/exports/json",
            {"select": "id_ligne_commerciale,sum(nb_courses_mardi) as tot", "group_by": "id_ligne_commerciale"}, RAW + "line_totals.json")
    for q in ["2eme"]:
        f = f"valid_ferre_{q}.json"
        if not have(f):
            log("validations ferré", q)
            get(IDFM + f"validations-reseau-ferre-nombre-validations-par-jour-{q}-trimestre/exports/json",
                {"select": "jour,id_zdc,libelle_arret,sum(nb_vald) as nb_vald", "group_by": "jour,id_zdc,libelle_arret"}, RAW + f)
        f = f"valid_bus_{q}.json"
        if not have(f):
            log("validations surface", q)
            get(IDFM + f"validations-reseau-surface-nombre-validations-par-jour-{q}-trimestre/exports/json",
                {"select": "jour,id_groupoflines,libelle_ligne,sum(nb_vald) as nb_vald", "group_by": "jour,id_groupoflines,libelle_ligne"}, RAW + f)
    log("IDFM terminé")

# ---------- Îlots de chaleur (IPR), paginé et parallèle ----------
def icu():
    if have("icu.geojson"): return
    base = "https://geoweb.iau-idf.fr/agsmap1/rest/services/OPENDATA/OpendataIAU4/MapServer/13/query"
    ids = json.loads(get(base, {"where": "1=1", "returnIdsOnly": "true", "f": "json"}))["objectIds"]
    ids.sort(); chunks = [ids[i:i + 1000] for i in range(0, len(ids), 1000)]
    log("ICU", len(ids), "îlots en", len(chunks), "lots")
    os.makedirs(RAW + "icu_parts", exist_ok=True)
    def one(k):
        f = RAW + f"icu_parts/{k:04d}.geojson"
        if os.path.exists(f) and os.path.getsize(f) > 100: return k
        c = chunks[k]
        get(base, {"where": f"objectid>={c[0]} AND objectid<={c[-1]}", "outFields": "objectid,code_imu,type_lcz,aleaj_note,alean_note,alea_j_cl,vulnj_note,hauteurmoy",
                   "outSR": "4326", "f": "geojson", "geometryPrecision": "5", "resultRecordCount": "1000"}, f)
        return k
    done = 0
    with ThreadPoolExecutor(8) as ex:
        for _ in as_completed([ex.submit(one, k) for k in range(len(chunks))]):
            done += 1
            if done % 25 == 0: log("ICU", done, "/", len(chunks))
    feats = []
    for k in range(len(chunks)):
        feats += json.load(open(RAW + f"icu_parts/{k:04d}.geojson", encoding="utf-8"))["features"]
    json.dump({"type": "FeatureCollection", "features": feats}, open(RAW + "icu.geojson", "w", encoding="utf-8"))
    log("ICU terminé", len(feats))

# ---------- Géoplateforme : Filosofi 200 m et IRIS ----------
def wfs(layer, out, cql=None, bbox=None, page=5000):
    if have(out): return
    p = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": layer, "SRSNAME": "EPSG:4326", "OUTPUTFORMAT": "application/json"}
    if cql: p["CQL_FILTER"] = cql
    if bbox: p["BBOX"] = bbox
    feats, start = [], 0
    while True:
        d = json.loads(get("https://data.geopf.fr/wfs/ows", {**p, "COUNT": page, "STARTINDEX": start, "SORTBY": "gml_id" if False else None} if False else {**p, "COUNT": page, "STARTINDEX": start}))
        feats += d["features"]; start += page
        log(layer, len(feats), "/", d.get("numberMatched"))
        if len(d["features"]) < page: break
    json.dump({"type": "FeatureCollection", "features": feats}, open(RAW + out, "w", encoding="utf-8"))
def geopf():
    cql = " OR ".join(f"code_insee LIKE '{d}%'" for d in DEPTS)
    wfs("STATISTICALUNITS.IRIS:contours_iris", "iris.geojson", cql=cql)
    wfs("INSEE.FILOSOFI.INDICATORS:carreaux_200m", "filosofi.geojson", bbox="48.12,1.44,49.24,3.56,urn:ogc:def:crs:EPSG::4326")
    log("Géoplateforme terminé")

# ---------- Communes ----------
def communes():
    if have("communes.geojson"): return
    feats = []
    for d in DEPTS:
        g = json.loads(get(f"https://geo.api.gouv.fr/departements/{d}/communes", {"format": "geojson", "geometry": "contour", "fields": "nom,code,population"}))
        feats += g["features"]
    # Paris en arrondissements
    arr = json.loads(get("https://geo.api.gouv.fr/communes", {"type": "arrondissement-municipal", "codeDepartement": "75", "format": "geojson", "geometry": "contour", "fields": "nom,code,population"}))
    assert len(arr["features"]) == 20, "arrondissements de Paris manquants"
    feats = [f for f in feats if f["properties"]["code"] != "75056"] + arr["features"]
    json.dump({"type": "FeatureCollection", "features": feats}, open(RAW + "communes.geojson", "w", encoding="utf-8"))
    log("communes", len(feats))

# ---------- Lieux frais : Ville de Paris + OSM (parcs, jardins, bois) ----------
def frais():
    for ds in ["ilots-de-fraicheur-equipements-activites", "ilots-de-fraicheur-espaces-verts-frais"]:
        if not have(ds + ".geojson"):
            get(f"https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/{ds}/exports/geojson", out=RAW + ds + ".geojson")
    if not have("osm_parcs.json"):
        q = ('[out:json][timeout:900][maxsize:1073741824];area["ref:INSEE"="11"]["admin_level"="4"]->.a;'
             '(way["leisure"~"^(park|garden)$"](area.a);relation["leisure"="park"](area.a);'
             'way["landuse"~"^(forest|recreation_ground)$"](area.a);way["natural"="wood"](area.a););out geom;')
        log("OSM parcs et bois (long)")
        get("https://overpass-api.de/api/interpreter", {"data": q}, RAW + "osm_parcs.json", compressed=False)
    log("lieux frais terminé")

# ---------- Météo horaire (8 départements) ----------
def meteo():
    for d in DEPTS:
        f = f"H_{d}_latest-2025-2026.csv.gz"
        if not have(f):
            get(f"https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/HOR/{f}", out=RAW + f, compressed=False)
    log("météo terminé")

# ---------- Vigilance canicule par département, 18 mai - 30 juin 2026 ----------
def vigilance():
    if have("vigilance_idf.json"): return
    base = "https://files.data.gouv.fr/meteofrance/data/vigilance/metropole/2026/"
    days = [(5, d) for d in range(18, 32)] + [(6, d) for d in range(1, 31)]
    res = {}
    def one(md):
        m, d = md; p = f"{base}{m:02d}/{d:02d}/"
        stamps = re.findall(r'href="[^"]*/(\d{6})/"', get(p, compressed=False).decode())
        for s in stamps:
            if s < "055000": continue
            if "CDP_CARTE_EXTERNE" not in get(p + s + "/", compressed=False).decode(): continue
            j = json.loads(get(p + s + "/CDP_CARTE_EXTERNE.json", compressed=False))
            out = {}
            for per in j["product"]["periods"]:
                if per["echeance"] != "J": continue
                for dm in per["timelaps"]["domain_ids"]:
                    if dm["domain_id"] in DEPTS:
                        out[dm["domain_id"]] = max([int(x["phenomenon_max_color_id"]) for x in dm["phenomenon_items"] if x["phenomenon_id"] == "6"] or [1])
            return f"2026-{m:02d}-{d:02d}", out
        return f"2026-{m:02d}-{d:02d}", {}
    with ThreadPoolExecutor(6) as ex:
        for k, v in ex.map(one, days): res[k] = v
    json.dump(res, open(RAW + "vigilance_idf.json", "w"), indent=0)
    log("vigilance terminé", len(res))

if __name__ == "__main__":
    steps = sys.argv[1:] or ["idfm", "geopf", "communes", "meteo", "vigilance", "frais", "icu"]
    F = dict(idfm=idfm_exports, geopf=geopf, communes=communes, meteo=meteo, vigilance=vigilance, frais=frais, icu=icu)
    with ThreadPoolExecutor(4) as ex:
        futs = {ex.submit(F[s]): s for s in steps}
        for f in as_completed(futs):
            try: f.result(); log("OK", futs[f])
            except Exception as e: log("ERREUR", futs[f], e)
    log("fin des téléchargements")
