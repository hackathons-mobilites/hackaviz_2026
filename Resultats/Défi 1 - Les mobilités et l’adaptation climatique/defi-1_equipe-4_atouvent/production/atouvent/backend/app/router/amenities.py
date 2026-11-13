"""Équipements et conditions de chaque arrêt du calculateur : abri, banc, éclairage, annonces sonores et visuelles, accessibilité, bande podotactile, toilettes et fontaine à proximité, chaleur du quartier et des quais."""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import numpy as np

from ..services.geo import distances_m as _dist  # distance en mètres (tableaux numpy)

DATA = Path(__file__).resolve().parents[2] / "data"
RAW = DATA / "raw"
IDFM = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/{}/exports/json"
OVERPASS = "https://overpass-api.de/api/interpreter"
OSM_QUERY = ('[out:json][timeout:240][bbox:48.12,1.44,49.24,3.56];'
             '(node["highway"="bus_stop"];node["railway"="tram_stop"];);out body;')
NEAR_OSM_M = 25     # arrêt OSM sans référence IDFM : rattaché à l'arrêt le plus proche à 25 m
NEAR_POI_M = 150    # toilettes, fontaine : « à proximité »
YES = {"true": 1, "yes": 1, "partial": 0.5, "limited": 0.5, "false": 0, "no": 0}


def _get(name: str, url: str, **kw) -> list | dict:
    path = RAW / name
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        r = httpx.request(kw.pop("method", "GET"), url, timeout=400, headers={"User-Agent": "AtouVent/1.0"}, **kw)
        r.raise_for_status()
        path.write_bytes(r.content)
    return json.loads(path.read_text(encoding="utf-8"))




def build() -> dict:
    meta = json.loads((DATA / "router.json").read_text(encoding="utf-8"))
    z = np.load(DATA / "router.npz")
    lat, lon = z["stop_lat"], z["stop_lon"]
    stops = meta["stops"]
    ix = {s["id"].replace("IDFM:", ""): i for i, s in enumerate(stops)}
    info: list[dict] = [{} for _ in stops]

    # 1. Référentiel IDFM des arrêts
    for r in _get("arrets.json", IDFM.format("arrets"), params={
            "select": "arrid,arrtype,arraccessibility,arraudiblesignals,arrvisualsigns,zdaid,arrgeopoint"}):
        i = ix.get(str(r["arrid"]))
        if i is None:
            continue
        for key, field in (("access", "arraccessibility"), ("audio", "arraudiblesignals"), ("visual", "arrvisualsigns")):
            v = YES.get(str(r.get(field)))
            if v is not None:
                info[i][key] = v

    # 2. OpenStreetMap : abri, banc, éclairage, afficheur, bande podotactile
    osm = _get("osm_stops.json", OVERPASS, method="POST", data={"data": OSM_QUERY})["elements"]
    matched = 0
    for e in osm:
        tags = e.get("tags", {})
        i = ix.get(str(tags.get("ref:FR:STIF", "")).split(";")[0])
        if i is None:
            d = _dist(e["lat"], e["lon"], lat, lon)
            k = int(np.argmin(d))
            if d[k] > NEAR_OSM_M:
                continue
            i = k
        matched += 1
        for key, tag in (("shelter", "shelter"), ("bench", "bench"), ("lit", "lit"), ("tactile", "tactile_paving")):
            v = YES.get(str(tags.get(tag)).split(";")[0])
            if v is not None:
                info[i][key] = v
        board = tags.get("departures_board")
        if board in ("realtime", "timetable", "yes"):
            info[i]["board"] = "realtime" if board == "realtime" else "timetable"
        if "access" not in info[i] and (v := YES.get(str(tags.get("wheelchair")))) is not None:
            info[i]["access"] = v

    # 3. Gares : niveau d'accessibilité (assistance sur réservation, agent en station, autonomie)
    levels = {"véhicule accessible en toute autonomie": "autonomie", "train accessible sur demande auprès d'un agent en station": "agent",
              "train accessible sur réservation préalable auprès du service AssistenGare": "reservation",
              "gare ou arrêt non accessible": "non"}
    for r in _get("accessibilite-en-gare.json", IDFM.format("accessibilite-en-gare")):
        g = r.get("stop_point_geopoint") or {}
        if "lat" not in g:
            continue
        for i in np.nonzero(_dist(g["lat"], g["lon"], lat, lon) <= NEAR_POI_M)[0]:
            info[int(i)]["station_access"] = levels.get(r["accessibility_level_name"], "non")

    # 4. Toilettes et fontaines à proximité
    for name, ds, key, geo in (("sanitaires-reseau-ratp.json", "sanitaires-reseau-ratp", "toilets", "coord_geo"),
                               ("fontaines-arrets-de-transport-en-commun-didf.json", "fontaines-arrets-de-transport-en-commun-didf", "fountain", "pointgeo")):
        for r in _get(name, IDFM.format(ds)):
            g = r.get(geo) or {}
            if "lat" in g:
                for i in np.nonzero(_dist(g["lat"], g["lon"], lat, lon) <= NEAR_POI_M)[0]:
                    info[int(i)][key] = 1

    # 5. Chaleur : vulnérabilité du quartier (1 à 9) et quais mesurés, issus de l'analyse
    heat = DATA / "chaleur.json"
    if heat.exists():
        a = json.loads(heat.read_text(encoding="utf-8"))
        by_zdc = {s["id"]: s for s in a.get("stations", [])}
        platforms = {p["station"].split(" (")[0].lower(): p for p in a.get("platforms", {}).get("stations", []) if p.get("quai_hot")}
        for i, s in enumerate(stops):
            st = by_zdc.get(s["parent"])
            if st and st.get("vuln_day") is not None:
                info[i]["heat_area"] = st["vuln_day"]
            p = platforms.get(s["name"].lower())
            if p:
                info[i]["platform_hot"] = p["quai_hot"]

    # 5 bis. Entrées de gare et temps de couloir jusqu'au quai (GTFS IDFM : pathways.txt, entrées de stops.txt)
    gtfs = next((p for p in (DATA / "raw" / "gtfs", Path(__file__).resolve().parents[3] / "analyse" / "raw" / "gtfs")
                 if (p / "pathways.txt").exists()), DATA / "raw" / "gtfs")
    if (gtfs / "pathways.txt").exists():
        import csv
        with open(gtfs / "stops.txt", encoding="utf-8-sig") as f:
            entrances = {r["stop_id"]: r for r in csv.DictReader(f) if r.get("location_type") == "2"}
        with open(gtfs / "pathways.txt", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                e, q = entrances.get(r["from_stop_id"]), ix.get(r["to_stop_id"].replace("IDFM:", ""))
                if e is None or q is None or not r.get("traversal_time"):
                    continue
                info[q].setdefault("entrances", []).append(
                    [e["stop_name"], round(float(e["stop_lat"]), 6), round(float(e["stop_lon"]), 6), int(float(r["traversal_time"]))])

    # 5 ter. Fiabilité historique des ascenseurs par gare (Dispotrains 2013-2023) : part du temps hors service
    dispo = Path(__file__).resolve().parents[3] / "analyse" / "raw" / "dispotrains" / "x"
    if (dispo / "statistics.json").exists():
        import duckdb
        con = duckdb.connect()
        con.sql(f"""create table st as select replace(code, 'stop_area:IDFM:', '') zdc, unnest(elevators).id elevator
            from read_json('{(dispo / "stations.json").as_posix()}', format='newline_delimited') where code like 'stop_area:IDFM:%'""")
        rel = dict(con.sql(f"""select st.zdc, sum(epoch(e - b)) filter (where state <> 'Disponible') / sum(epoch(e - b))
            from (select elevator, state, (begin['$date'])::timestamptz b, ("end"['$date'])::timestamptz e
                  from read_json('{(dispo / "statistics.json").as_posix()}', format='newline_delimited')
                  where begin is not null and "end" is not null) s
            join st using (elevator) group by 1 having sum(epoch(e - b)) > 365 * 86400""").fetchall())
        for i, st in enumerate(stops):
            if st["parent"] in rel and rel[st["parent"]] is not None:
                info[i]["lift_downtime"] = round(float(rel[st["parent"]]), 3)

    # 6. Lignes et mode de chaque arrêt (pictogramme sur les cartes, liste des lignes)
    c, tr = z["conns"][:, 0], z["trip_route"][z["conns"][:, 4]]
    pairs = np.unique(np.stack([c, tr], axis=1), axis=0)
    routes = meta["routes"]
    order = {"1": 0, "2": 1, "0": 2, "6": 2, "7": 0, "3": 3}  # métro, train/RER, tram, bus
    kind = {"1": "metro", "7": "metro", "2": "rail", "0": "tram", "6": "tram", "3": "bus"}
    for st, r in pairs.tolist():
        ro = routes[r]
        lines = info[st].setdefault("lines", [])
        if ro["line"] not in lines and len(lines) < 12:
            lines.append(ro["line"])
        cur = info[st].get("kind")
        if cur is None or order[ro["type"]] < order[{"metro": "1", "rail": "2", "tram": "0", "bus": "3"}[cur]]:
            info[st]["kind"] = kind[ro["type"]]

    out = {"stops": info, "sources": ["IDFM Arrêts", "OpenStreetMap (ODbL)", "IDFM Accessibilité en gare",
                                       "IDFM Fontaines aux arrêts", "RATP Sanitaires", "Analyse AtouVent (chaleur)"]}
    (DATA / "stop_info.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    known = lambda k: sum(1 for x in info if k in x)
    return {"stops": len(info), "osm_matched": matched, **{k: known(k) for k in
            ("access", "audio", "visual", "shelter", "bench", "board", "station_access", "toilets", "fountain", "heat_area", "platform_hot", "entrances", "lift_downtime")}}


if __name__ == "__main__":
    print(build())
