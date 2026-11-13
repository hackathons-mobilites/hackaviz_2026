"""Build the bilingual guided story app/static/story.html (served at /) from build_web + the GPE scenario."""
import json

import geopandas as gpd
from shapely.geometry import mapping

from build_web import make_data
from config import ROOT, PROCESSED, STATIC, CRS_M

WEB      = ROOT                          # story_template.html and ui_kit.html sit next to this script
TEMPLATE = WEB / "story_template.html"
OUT      = STATIC / "story.html"


def rnd(o):
    if isinstance(o, (list, tuple)):
        return [rnd(v) for v in o]
    return round(o, 4) if isinstance(o, float) else o


def dep_lines(zones_geojson):
    """Department boundaries as one MultiLineString, drawn over every story map."""
    g        = gpd.GeoDataFrame.from_features(zones_geojson["features"], crs=4326).to_crs(CRS_M)
    g        = g.set_geometry(g.geometry.make_valid().buffer(0))     # simplified shapes can self-intersect
    lines    = (g.dissolve("d").geometry
                  .buffer(60).buffer(-60)        # close slivers left by per-commune simplification
                  .simplify(150)
                  .boundary.to_crs(4326))
    geom     = mapping(lines.union_all())
    return {"type": "Feature", "properties": {}, "geometry": {"type": geom["type"], "coordinates": rnd(geom["coordinates"])}}


def main():
    data = make_data()
    scen = json.loads((PROCESSED / "scenario.json").read_text())
    hubs = gpd.read_file(PROCESSED / "hubs.gpkg")
    pts  = hubs.dissolve("hub", aggfunc={"jobs": "sum"}).reset_index()
    pts["geometry"] = pts.geometry.representative_point()
    pts  = pts.to_crs(4326)
    data["hubPoints"] = [{"hub": r.hub, "jobs": round(r.jobs), "lon": round(r.geometry.x, 4),
                          "lat": round(r.geometry.y, 4)} for r in pts.itertuples()]
    data["scenario"] = {k: scen[k] for k in ("hubs", "zones", "deps", "headlines")}
    data["equal"]    = json.loads((PROCESSED / "equal_access.json").read_text())
    data["stag"]     = json.loads((PROCESSED / "staggered.json").read_text())
    data["sol"]      = json.loads((PROCESSED / "solutions.json").read_text())
    data["prim"]     = json.loads((PROCESSED / "prim.json").read_text())   # Veasna RA, src/prim_service_cycling.py
    data["depLines"] = dep_lines(data["zones"])
    html = TEMPLATE.read_text().replace("<!--__UI__-->", (WEB / "ui_kit.html").read_text()).replace("/*__DATA__*/null",
                                        json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    OUT.write_text(html)
    print("wrote", OUT, f"{OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
