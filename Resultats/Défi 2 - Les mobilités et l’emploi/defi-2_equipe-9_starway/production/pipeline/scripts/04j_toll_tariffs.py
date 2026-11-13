"""04j - Points de péage et tarifs officiels (voiture classe 1, moto classe 5), sans calcul de chemin.

Entrées (téléchargées le 03/11/2026, tracées dans data/sources_manifest.csv) :
- data/processed/osm_toll_points.json (04i : nœuds de péage et chemins toll=yes de l'OSM CYC01 utilisé par R5) ;
- data/raw/TOLL01/portiques-free-flow-03-11-2026.csv (portiques en flux libre, data.gouv.fr) ;
- data/raw/TOLL02/TARIFS_APRR-2026-02.pdf (grille APRR officielle au 1er février 2026, lue par pdftotext) et
  aprr-tarifs-2026-02.csv (copie data.gouv.fr, recoupement) ;
- data/raw/TOLL03/jorf_TRAT2600882A/ (arrêté SANEF et SAPN du 28/01/2026, annexe A14, flux JORF de la DILA) ;
- data/raw/TOLL03/2026_02-Grille-Sanef.pdf (grille Sanef du 01/02/2026, déposée à la main le 05/11/2026 : triangle de
  l'A4 lu par pdftotext -layout), 2026_02-Grille-SAPN.pdf et grille-modulee-01022026.pdf (lues, aucun prix retenu pour
  l'A13 ni pour Saint-Witz : raisons dans le registre) ;
- data/raw/TOLL04/Tarifs_A86.txt et Tarifs_Cofiroute_Arcour.txt (VINCI Autoroutes) ;
- data/raw/TOLL05/gares-peage-2025.csv (gares de péage du réseau concédé, Ministère) ;
- data/interim/communes_idf_2026.gpkg (GEO01 : commune de chaque point, centre de Paris pour l'étiquette de sens).

Sorties :
- data/processed/toll_points.csv : un point par ligne et par sens de chaussée (nœuds OSM groupés) ;
- data/processed/toll_tariffs.csv : un prix par ligne (couple, classe, tarif, type de jour, tranche horaire), ou une
  case vide avec statut et raison ;
- data/processed/toll_tariffs_meta.json : empreintes des entrées, recoupements (APRR CSV / PDF officiel, nœuds OSM).

Règle d'application : docs/methodologie.md § Péages ; logique testée dans tests/test_toll_tariffs.py.
Interrupteur de retrait des péages VINCI (désactivé par défaut) : variable d'environnement STARWAY_RETIRER_VINCI=1
(docs/limites.md, section Péages) ; à positionner de la même façon pour 04j, 06, 06k et 07.
Usage : python scripts/04j_toll_tariffs.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
from datetime import UTC, datetime

import geopandas as gpd
import pandas as pd

from starway import toll_tariffs as tt
from starway.config import INTERIM_DIR, PROCESSED_DIR, PROCESSING_VERSION, RAW_DIR, REPO_ROOT
from starway.sources import read_manifest, sha256_of

OSM_JSON = PROCESSED_DIR / "osm_toll_points.json"
FREE_FLOW = RAW_DIR / "TOLL01" / "portiques-free-flow-03-11-2026.csv"
APRR_CSV = RAW_DIR / "TOLL02" / "aprr-tarifs-2026-02.csv"
APRR_PDF = RAW_DIR / "TOLL02" / "TARIFS_APRR-2026-02.pdf"
APRR_OPEN = RAW_DIR / "TOLL02" / "aprr-systemes-ouverts-2026.pdf"
A14_DIR = RAW_DIR / "TOLL03" / "jorf_TRAT2600882A"
A14_ARTICLES = [A14_DIR / "JORFARTI000053417658.xml", A14_DIR / "JORFARTI000053417659.xml"]
DUPLEX_TXT = RAW_DIR / "TOLL04" / "Tarifs_A86.txt"
COFI_TXT = RAW_DIR / "TOLL04" / "Tarifs_Cofiroute_Arcour.txt"
GARES = RAW_DIR / "TOLL05" / "gares-peage-2025.csv"
SANEF_PDF = RAW_DIR / "TOLL03" / "2026_02-Grille-Sanef.pdf"
SAPN_PDF = RAW_DIR / "TOLL03" / "2026_02-Grille-SAPN.pdf"
SANEF_MODULEE_PDF = RAW_DIR / "TOLL03" / "grille-modulee-01022026.pdf"
COMMUNES = INTERIM_DIR / "communes_idf_2026.gpkg"
OUT_POINTS = PROCESSED_DIR / "toll_points.csv"
OUT_TARIFFS = PROCESSED_DIR / "toll_tariffs.csv"
OUT_META = PROCESSED_DIR / "toll_tariffs_meta.json"


def rel(p) -> str:
    return p.relative_to(REPO_ROOT).as_posix()


def check_manifest(files: list) -> dict[str, str]:
    """sha256 de chaque fichier source = celui du manifeste (sinon arrêt : la copie a changé)."""
    known = {r["fichier_local"]: r["sha256"] for r in read_manifest()}
    shas = {}
    for f in files:
        sha = sha256_of(f)
        if known.get(rel(f)) not in (None, sha):
            raise SystemExit(f"{rel(f)} : empreinte {sha[:12]} différente du manifeste {known[rel(f)][:12]}")
        if rel(f) not in known:
            print(f"  attention : {rel(f)} absent du manifeste")
        shas[rel(f)] = sha
    return shas


def aprr_pairs() -> tuple[dict, dict]:
    """Grille APRR officielle (PDF lu par `pdftotext -table`, outil xpdf fourni avec Git for Windows) et recoupement
    couple par couple avec la copie CSV de data.gouv.fr."""
    exe = shutil.which("pdftotext")
    if not exe:
        raise SystemExit("pdftotext introuvable : il lit la grille APRR officielle (Git for Windows : /mingw64/bin)")
    text = subprocess.run([exe, "-table", "-enc", "UTF-8", str(APRR_PDF), "-"], capture_output=True, check=True,
                          ).stdout.decode("utf-8", errors="replace")
    names = [p.nom_grille for p in tt.POINTS if p.systeme == "APRR"]
    pdf = tt.parse_aprr_pdf_table(text, names)
    csv = {k: v for k, v in tt.aprr_csv_pairs(APRR_CSV).items() if k[0] in names and k[1] in names}
    diffs = [[e, s, list(pdf[(e, s)]), list(csv[(e, s)])] for (e, s) in sorted(set(pdf) & set(csv))
             if any(abs(x - y) > 1e-9 for x, y in zip(pdf[(e, s)], csv[(e, s)], strict=True))]
    check = {"tool": "pdftotext -table (xpdf)", "pairs_pdf": len(pdf), "pairs_csv": len(csv),
             "pairs_with_different_values": diffs, "pairs_only_in_pdf": [list(k) for k in sorted(set(pdf) - set(csv))],
             "pairs_only_in_csv": [list(k) for k in sorted(set(csv) - set(pdf))]}
    return pdf, check


def build_points(osm: dict, communes: gpd.GeoDataFrame, ministere: pd.DataFrame, flux: pd.DataFrame) -> pd.DataFrame:
    paris = communes.loc[communes["insee"] == "75056", ["lon", "lat"]].iloc[0]
    located = tt.locate_nodes(osm, (float(paris["lon"]), float(paris["lat"])))
    osm_ids = {int(n["osm_id"]) for n in osm["nodes"]}
    rows = []
    for p in tt.POINTS:
        missing = [n for n in p.osm_nodes if n not in osm_ids]
        if missing:
            raise SystemExit(f"{p.point_id} : nœuds OSM absents de {rel(OSM_JSON)} : {missing}")
        groups: dict[str, list[tt.NodeOnWay]] = {}
        for n in p.osm_nodes:
            nw = located[n]
            label = {True: "vers Paris", False: "depuis Paris", None: "indetermine"}[nw.vers_paris]
            groups.setdefault(label, []).append(nw)
        mins = [g for g in p.gares_ministere if g not in set(ministere["nomGare"])]
        if mins:
            raise SystemExit(f"{p.point_id} : gares absentes de TOLL05 : {mins}")
        ffs = [g for g in p.portiques_flux_libre if g not in set(flux["Nom"].str.strip())]
        if ffs:
            raise SystemExit(f"{p.point_id} : portiques absents de TOLL01 : {ffs}")
        for sens, nodes in sorted(groups.items()):
            lon = sum(n.lon for n in nodes) / len(nodes)
            lat = sum(n.lat for n in nodes) / len(nodes)
            caps = [n.cap_deg for n in nodes if n.cap_deg is not None]
            rows.append({
                "point_id": p.point_id, "systeme": p.systeme, "ouvrage": p.ouvrage, "autoroute": p.autoroute,
                "exploitant": p.exploitant, "type": p.type, "tarification": p.tarification, "sens": sens,
                "cap_deg": caps[0] if caps else None, "lon": round(lon, 7), "lat": round(lat, 7),
                "osm_node_ids": ";".join(str(n.node_id) for n in nodes),
                "osm_way_ids": ";".join(str(w) for n in nodes for w in n.way_ids) or None,
                "nom_grille": p.nom_grille, "gares_ministere": ";".join(p.gares_ministere) or None,
                "portiques_flux_libre": ";".join(p.portiques_flux_libre) or None, "paiement": tt.clean(p.paiement),
                "statut_tarif": p.statut_tarif, "note": tt.clean(p.note) or None, "sources": ";".join(p.sources)})
    df = pd.DataFrame(rows)
    pts = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df["lon"], df["lat"]), crs="EPSG:4326")
    joined = gpd.sjoin(pts, communes[["insee", "geometry"]], how="left", predicate="within")
    df["insee"] = joined["insee"].values
    df["dans_idf"] = df["insee"].notna()
    return df[tt.POINT_COLUMNS]


def sanef_layout_text() -> str:
    """Grille Sanef déposée à la main (TOLL03) lue par `pdftotext -layout` : le texte de chaque page garde la position
    des cases du triangle (l'outil est le même que pour la grille APRR)."""
    exe = shutil.which("pdftotext")
    if not exe:
        raise SystemExit("pdftotext introuvable : il lit la grille Sanef (Git for Windows : /mingw64/bin)")
    return subprocess.run([exe, "-layout", "-enc", "UTF-8", str(SANEF_PDF), "-"], capture_output=True,
                          check=True).stdout.decode("utf-8", errors="replace")


def main() -> int:
    inputs = [FREE_FLOW, APRR_CSV, APRR_PDF, APRR_OPEN, *A14_ARTICLES, DUPLEX_TXT, COFI_TXT, GARES,
              SANEF_PDF, SAPN_PDF, SANEF_MODULEE_PDF]
    shas = check_manifest(inputs)
    osm = json.loads(OSM_JSON.read_text(encoding="utf-8"))
    communes = gpd.read_file(COMMUNES)
    ministere = pd.read_csv(GARES, sep=";", dtype=str, encoding="utf-8")
    flux = pd.read_csv(FREE_FLOW, sep=";", dtype=str, encoding="cp1252")

    points = build_points(osm, communes, ministere, flux)

    pdf_pairs, crosscheck = aprr_pairs()
    aprr = tt.aprr_tariffs(pdf_pairs, rel(APRR_PDF))
    cofi = tt.cofiroute_tariffs(COFI_TXT, rel(COFI_TXT))
    duplex = tt.duplex_tariffs(DUPLEX_TXT, rel(DUPLEX_TXT))
    if tt.withdrawal_enabled():  # interrupteur STARWAY_RETIRER_VINCI (désactivé par défaut) : aucun prix VINCI gardé
        print(f"RETRAIT VINCI ACTIVÉ ({tt.RETRAIT_ENV}) : {len(cofi) + len(duplex)} lignes de prix Cofiroute et "
              f"Duplex A86 remplacées par des cases vides, raison « {tt.RETRAIT_RAISON} »")
        cofi, duplex = [], []
    a14 = tt.a14_tariffs(A14_ARTICLES, [rel(f) for f in A14_ARTICLES])
    a4 = tt.sanef_a4_tariffs(sanef_layout_text(), rel(SANEF_PDF))
    missing = tt.missing_tariffs() + tt.aprr_open_tariffs(rel(APRR_OPEN))
    tariffs = pd.DataFrame(aprr + cofi + duplex + a14 + a4 + missing, columns=tt.TARIFF_COLUMNS)
    tariffs["classe"] = tariffs["classe"].astype(int)

    registered = {n for p in tt.POINTS for n in p.osm_nodes}
    motorway_way_ids = {int(w["osm_id"]) for w in osm["ways"] if w.get("highway") in ("motorway", "motorway_link")}
    located = tt.locate_nodes(osm, (0.0, 0.0))
    unregistered_on_motorway = sorted(n for n, nw in located.items()
                                      if n not in registered and set(nw.way_ids) & motorway_way_ids)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    points.to_csv(OUT_POINTS, index=False, encoding="utf-8")
    tariffs.to_csv(OUT_TARIFFS, index=False, encoding="utf-8")
    meta = {
        "processing_version": PROCESSING_VERSION, "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "inputs_sha256": shas | {rel(OSM_JSON): sha256_of(OSM_JSON)},
        "osm_pbf_sha256": osm.get("osm_pbf_sha256"),
        "classes": list(tt.CLASSES), "service_date_day_types": {
            s: tt.day_type(s, datetime(2026, 11, 17).date()) for s in ("DUPLEX_A86", "SAPN_A14", "APRR")},
        "holidays_2026": sorted(d.isoformat() for d in tt.HOLIDAYS_2026),
        "aprr_pdf_crosscheck": crosscheck,
        "osm_nodes_on_motorway_not_registered": unregistered_on_motorway,
        "counts": {"points": int(points["point_id"].nunique()), "point_rows": len(points),
                   "tariff_rows": len(tariffs), "tariff_rows_ok": int((tariffs["statut"] == tt.STATUT_OK).sum()),
                   "by_systeme": tariffs.groupby("systeme").size().to_dict()},
    }
    OUT_META.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"{rel(OUT_POINTS)} : {points['point_id'].nunique()} points, {len(points)} lignes "
          f"({int(points['dans_idf'].sum())} lignes en IDF)")
    print(f"{rel(OUT_TARIFFS)} : {len(tariffs)} lignes, dont {meta['counts']['tariff_rows_ok']} prix")
    print(tariffs.groupby(["systeme", "classe", "statut"]).size().to_string())
    print(f"recoupement APRR CSV / PDF : {crosscheck}")
    print(f"nœuds OSM sur autoroute hors registre : {unregistered_on_motorway}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
