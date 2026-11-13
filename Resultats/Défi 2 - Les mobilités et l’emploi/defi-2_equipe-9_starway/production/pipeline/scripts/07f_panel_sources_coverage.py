"""07f - Couverture des sources candidates du panneau de preuve (proposition, docs/proposition-panneau-preuve.md).

Lecture et mesure seulement : rien n'est exporté vers frontend/, aucune matrice n'est modifiée.

Mesures (jour de service SERVICE_DATE pour les courses) :
- GTFS TRA01 : `wheelchair_boarding` (stops.txt) par `location_type` ; `wheelchair_accessible` (trips.txt) des courses
  actives par `route_type` ;
- référentiel des lignes IDFM (TRA03) : part des routes GTFS actives retrouvées par ID_Line, valeurs de
  `air_conditioning` et `accessibility` par mode ;
- accessibilité en gare IDFM (TRA04) : part des gares retrouvées dans le GTFS, croisement niveau x `wheelchair_boarding` ;
- CO2e par voyageur.km IDFM (ENV01) : routes ferrées, métro et tram actives avec un facteur par ligne ;
- ponctualité mensuelle Transilien (QS01) : lignes couvertes, dernier mois publié.

Sortie : data/processed/panel_sources_coverage.csv (item, mesure, périmètre, valeur) ; résumé imprimé.
"""

from __future__ import annotations

import zipfile

import pandas as pd

from starway import flux
from starway.config import PROCESSED_DIR, RAW_DIR, SERVICE_DATE
from starway.gtfs import active_service_ids
from starway.panel_sources import ROUTE_TYPE_LABEL, gtfs_route_to_id_line, gtfs_stop_point_id, value_shares

GTFS = flux.gtfs_path("TRA01")  # fichier du manifeste (starway.flux), jamais un nom écrit en dur
REF_LINES = RAW_DIR / "TRA03" / "referentiel-des-lignes.csv"
STATION_ACC = RAW_DIR / "TRA04" / "accessibilite-en-gare.csv"
CO2 = RAW_DIR / "ENV01" / "emission-de-co2e-par-voyageur-kilometre-sur-le-reseau.csv"
PUNCT = RAW_DIR / "QS01" / "ponctualite-mensuelle-transilien.csv"
OUT = PROCESSED_DIR / "panel_sources_coverage.csv"

RAIL_TYPES = {"0", "1", "2", "6", "7"}  # tram, métro, train (RER, Transilien, TER), téléphérique, funiculaire


def read_csv(path, **kw) -> pd.DataFrame:
    return pd.read_csv(path, sep=";", dtype=str, encoding="utf-8-sig", **kw)


def main() -> None:
    rows: list[dict] = []

    def add(item: str, measure: str, scope: str, value) -> None:
        rows.append({"item": item, "measure": measure, "scope": scope, "value": value})

    with zipfile.ZipFile(GTFS) as z:
        routes = pd.read_csv(z.open("routes.txt"), dtype=str)
        stops = pd.read_csv(z.open("stops.txt"), dtype=str)
        trips = pd.read_csv(z.open("trips.txt"), dtype=str,
                            usecols=["route_id", "service_id", "trip_id", "wheelchair_accessible"])
    services = active_service_ids(GTFS, SERVICE_DATE)
    trips = trips[trips["service_id"].isin(services)].merge(routes[["route_id", "route_type", "route_short_name"]])
    add("gtfs", "courses actives", SERVICE_DATE.isoformat(), len(trips))

    # 1. Fauteuil : GTFS
    for lt, g in stops.groupby(stops["location_type"].fillna("0")):
        for k, v in value_shares(g["wheelchair_boarding"], {"1", "2"}).items():
            add("fauteuil_gtfs_stops", k, f"location_type={lt}", v)
    for rt, g in trips.groupby("route_type"):
        for k, v in value_shares(g["wheelchair_accessible"], {"1", "2"}).items():
            add("fauteuil_gtfs_trips", k, f"route_type={rt} ({ROUTE_TYPE_LABEL.get(rt, '?')})", v)

    # 2. Référentiel des lignes : clim, accessibilité de la ligne
    ref = read_csv(REF_LINES)
    active_routes = routes[routes["route_id"].isin(trips["route_id"])].copy()
    active_routes["id_line"] = active_routes["route_id"].map(gtfs_route_to_id_line)
    j = active_routes.merge(ref[["id_line", "air_conditioning", "accessibility", "transportmode"]],
                            on="id_line", how="left")
    for rt, g in j.groupby("route_type"):
        scope = f"route_type={rt} ({ROUTE_TYPE_LABEL.get(rt, '?')})"
        add("referentiel_lignes", "routes actives", scope, len(g))
        add("referentiel_lignes", "routes retrouvées (ID_Line)", scope, int(g["transportmode"].notna().sum()))
        for col in ("air_conditioning", "accessibility"):
            for k, v in value_shares(g[col], {"true", "false", "partial"}).items():
                add(f"referentiel_{col}", k, scope, v)

    # 3. Accessibilité en gare
    acc = read_csv(STATION_ACC)
    acc["stop_id"] = acc["stop_point_id"].map(gtfs_stop_point_id)
    m = acc.merge(stops[["stop_id", "wheelchair_boarding"]], on="stop_id", how="left", indicator=True)
    add("accessibilite_gare", "gares du jeu", "IDFM", len(acc))
    add("accessibilite_gare", "gares retrouvées dans le GTFS (stop_id)", "IDFM", int((m["_merge"] == "both").sum()))
    for (lvl, wb), c in m.groupby([m["accessibility_level_id"], m["wheelchair_boarding"].fillna("absent")]).size().items():
        add("accessibilite_gare", f"niveau {lvl} x wheelchair_boarding {wb}", "gares", int(c))

    # 4. Carbone : facteur par ligne pour les modes guidés
    co2 = read_csv(CO2)
    has_line = set(co2.loc[co2["co2e_voy_km"].fillna("NA") != "NA", "id_line"])
    rail = j[j["route_type"].isin(RAIL_TYPES)]
    add("co2_ligne", "routes guidées actives", "tram/métro/train/câble", len(rail))
    add("co2_ligne", "routes guidées avec facteur par ligne", "tram/métro/train/câble",
        int(rail["id_line"].isin(has_line).sum()))
    add("co2_ligne", "routes guidées sans facteur par ligne", "tram/métro/train/câble",
        " ".join(sorted(rail.loc[~rail["id_line"].isin(has_line), "route_short_name"].astype(str))))

    # 5. Ponctualité Transilien / RER
    p = read_csv(PUNCT)
    add("ponctualite", "lignes publiées", "SNCF Voyageurs", " ".join(sorted(p["ligne"].unique())))
    add("ponctualite", "dernier mois", "SNCF Voyageurs", p["date"].max())
    trains = j[j["route_type"] == "2"]
    covered = trains["route_short_name"].isin(set(p["ligne"]))
    add("ponctualite", "routes train actives couvertes", "route_type=2", f"{int(covered.sum())}/{len(trains)}")
    add("ponctualite", "routes train actives non couvertes", "route_type=2",
        " ".join(sorted(trains.loc[~covered, "route_short_name"].astype(str))))

    out = pd.DataFrame(rows)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT, index=False)
    with pd.option_context("display.max_rows", 500, "display.width", 200, "display.max_colwidth", 120):
        print(out.to_string(index=False))
    print(f"\n-> {OUT} ({len(out)} lignes)")


if __name__ == "__main__":
    main()
