"""06 - Export des JSON du front dans frontend/public/data/ (contrats de données STARWAY).

Écrit : meta.json (le poles.json des 44 astres est écrit par 03b --publish), communes.json, sources.json, access/{insee}.json, context/{insee}.json (copiés depuis
data/interim/context, produits par 05), insights.json (découvertes, seulement pour les types dont la couverture
permet un classement honnête ; sinon la raison est écrite dans meta.insights).

Matrice : lue dans les LOTS TERMINÉS du calcul (data/interim/matrix/batches et data/interim/matrix_story/batches),
en lecture seule, via starway.matrix_io. Peut donc être lancé pendant le calcul de nuit : une commune est publiée
pour un mode dès que toutes ses journées requises sont calculées ; la couverture partielle est décrite dans
meta.mode_coverage. Les fichiers consolidés {mode}_{day}.csv ne sont pas lus (ceux du POC sont obsolètes).
Lancer 07_quality_checks.py AVANT (le script refuse d'exporter si les contrôles P0 échouent, sauf --skip-checks).

Réglages de marche des TC (D-024, choix de l'équipe) : `modes.transit` = réglage par défaut (WALK_SETTING_DEFAULT,
« normal », lots de data/interim/matrix_walk3000/) ; les autres réglages sont publiés sous `variants.{id}.transit`
(« confort », data/interim/matrix_walk1000/) ; `meta.walk_settings` les décrit. La matrice TC de data/interim/matrix/
(limite cachée de R5, 2 000 m) n'est plus publiée, ni la raison `no_stop_within_walk_limit` de D-023.
Vélib' (D-027) : `modes.velib.any` pour les origines de data/interim/matrix_velib/ ; `meta.velib` (avertissement exact).
Voiture (D-029) : `meta.car_congestion` (indices DiRIF, ROAD01, règle aller / retour de starway/congestion.py ; le front
en déduit le mode `car_traffic`, sans fichier de plus), `meta.vehicles` (essence, diesel, électrique : consommation SDES,
prix de l'énergie, carbone, sources ; quatre deux-roues thermiques) et `meta.car_costs` ; `car_trip` (distances et
péages traversés) dans access/{insee}.json et tolls.json (registre et grilles des péages) SEULEMENT si les distances
corrigées de 04g (data/interim/car_dist_carspeed_v2/, carSpeed fixé, péages relevés avec la troncature de R5) sont
complètes et conformes au jeu publié (starway.car_dist.load_corrected) : jamais avec les anciennes distances.

Recoupement Navitia (07d, réglage de marche par défaut : data/processed/navitia_crosscheck_walk3000_summary.json) :
une découverte que Navitia contredit est écartée AVANT le classement (cause `navitia_contradicted` dans
`meta.insights.excluded`, les suivantes remontent) ; chaque découverte publiée porte `crosscheck` (`confirmed`,
`within_one_minute` ou `not_checked`) ; `meta.insights.crosscheck` décrit le fichier de recoupement. Un verdict n'est
repris que si les trajets décisifs et leurs durées STARWAY sont identiques à ceux recoupés (sinon `not_checked`) : après
un export qui fait remonter des découvertes nouvelles, relancer 07d (--groups insight) puis 06.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pandas as pd

from starway import car_dist as cdist
from starway import congestion as cong
from starway import flux, itin_meta
from starway import needs as needs_mod
from starway import night_network as nn
from starway import publication as pub
from starway import toll_publish as tpub
from starway import vehicles as veh
from starway.config import (
    BUDGETS_MIN,
    DAY_TYPES,
    FRONT_DATA_DIR,
    INTERIM_DIR,
    MAX_TRIP_MIN,
    MODES,
    OUTBOUND_STEP_MIN,
    PIPELINE_DIR,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    RAW_DIR,
    SERVICE_DATE,
    SKY_DEFAULT,
    SPEED_CYCLING_KMH,
    SPEED_WALKING_KMH,
    TRANSFER_WALK_LIMIT_M,
    VELIB_OUT_OF_ZONE,
    VELIB_WARNING,
    WALK_SETTING_DEFAULT,
    WALK_SETTING_LABELS,
    WALK_SETTINGS_M,
    sky_front_dir,
)
from starway.export import (
    build_access,
    build_communes,
    build_meta,
    build_poles,
    build_sources,
    gtfs_extraction_date,
    write_json,
)
from starway.insights import CAUSE_NAVITIA, compute_insights, kinds_status
from starway.matrix_io import MatrixLoad, load_published, load_velib, load_walk_setting, partial_coverage
from starway.navitia import CROSSCHECK_STATUSES, insight_scenario_key, published_crosscheck
from starway.needs import published_from_docs as needs_published
from starway.origin_points import METHOD_GRAVITY, METHOD_NEAREST, ORIGIN_LAT, ORIGIN_LON, origin_points_sha256
from starway.r5jar import walk_time_limit_min
from starway.runs import read_origins_file
from starway.sources import read_manifest, sha256_of

# communes.json : la méthode du point d'origine est publiée sous forme de code court (poids du fichier) ; le libellé
# complet de chaque code est dans meta.json (origin_methods) et dans le contrat.
ORIGIN_METHOD_CODES = {METHOD_GRAVITY: "gravity", METHOD_NEAREST: "nearest_inhabited"}


def compact_origin(rows: list[dict]) -> list[dict]:
    for r in rows:
        if "origin" in r:
            r["origin"]["method"] = ORIGIN_METHOD_CODES[r["origin"]["method"]]
    return rows


def dataset_identity(run_dir=INTERIM_DIR / "matrix") -> dict:
    """Identité du jeu de temps de trajet publié, dérivée de run_params.json (lecture seule) :
    dataset_id = « {service_date}_{12 premiers caractères de origin_points_sha256} ». Deux jeux calculés avec des
    points d'origine différents (D-017) ont des identifiants différents ; PROCESSING_VERSION ne change pas."""
    path = run_dir / "run_params.json"
    if not path.exists():
        return {"dataset_id": None, "origin_point_rule": None}
    rp = json.loads(path.read_text(encoding="utf-8"))
    sha = rp.get("origin_points_sha256")
    return {"dataset_id": f"{rp['service_date']}_{sha[:12]}" if sha else None,
            "origin_point_rule": rp.get("origin_point_rule")}


VELIB_DIR = INTERIM_DIR / "matrix_velib"
STORY_FILE = PROCESSED_DIR / "story_communes.txt"
REPO_ROOT = PIPELINE_DIR.parent
# dossiers de calcul lus pour le ciel exporté (starway.publication) ; main() les fixe selon --astres et --transfer-rules
INPUTS = pub.sky_inputs("44", "gtfs_navitia")
_PUBLISHED_DIR = FRONT_DATA_DIR.resolve()  # FRONT_DATA_DIR est remplacé par --out-dir (essai) dans main()


def crosscheck_summary_path():
    """Résumé 07d du réglage de marche publié dans modes.transit (même nom que 07d.outputs)."""
    return PROCESSED_DIR / f"navitia_crosscheck_walk{WALK_SETTINGS_M[WALK_SETTING_DEFAULT]}_summary.json"


def load_crosscheck() -> tuple[dict[tuple, dict], dict | None]:
    """(recoupements indexés par scénario, description pour meta.insights.crosscheck) ; vide si 07d n'a pas tourné."""
    path = crosscheck_summary_path()
    if not path.exists():
        return {}, None
    summ = json.loads(path.read_text(encoding="utf-8"))
    checks: dict[tuple, dict] = {}
    for c in summ.get("insight_checks", []):
        checks[insight_scenario_key(c)] = c
    cov = summ.get("navitia_coverage") or {}
    info = {"file": path.relative_to(REPO_ROOT).as_posix(), "generated_at": summ.get("generated_at"),
            "walk_setting": (summ.get("walk_setting") or {}).get("id"),
            "navitia_last_load_at": cov.get("last_load_at"), "service_date": summ.get("service_date"),
            "statuses": list(CROSSCHECK_STATUSES),
            "method": "contrôle seulement (rien d'affiché ne vient de Navitia) : pour chaque découverte, le pôle qui "
                      "pèse le plus dans son écart et les sens TC qui le décident, recoupés avec l'API Navitia d'IDFM "
                      "(PRIM, horaires théoriques, réglages alignés sur le réglage de marche) ; verdict repris "
                      "seulement si les trajets et les durées STARWAY sont ceux recoupés (docs/methodologie.md § 5)"}
    return checks, info


# D-031 : suffixe des matrices recalculées avec les temps de correspondance officiels (« » = moteur d'origine) ;
# conservé pour les appelants (06d, tests) : les dossiers lus par 06 viennent de INPUTS (starway.publication)
WALK_DIR_SUFFIX = ""


def walk_dir(limit_m: int):
    return INPUTS.walk_dirs[limit_m]


def walk_settings_meta(params: dict[str, dict], points_sha: str) -> dict:
    """Bloc meta.walk_settings (D-024) : réglages choisis par l'équipe, défaut publié dans modes.transit."""
    settings = []
    for sid in [WALK_SETTING_DEFAULT] + [k for k in WALK_SETTINGS_M if k != WALK_SETTING_DEFAULT]:
        if sid not in params:  # réglage pas encore calculé : absent de la liste, jamais décrit sans ses empreintes
            continue
        lim, rp = WALK_SETTINGS_M[sid], params[sid]
        settings.append({"id": sid, "label": WALK_SETTING_LABELS[sid], "leg_limit_m": lim,
                         "max_time_walking_min": walk_time_limit_min(lim, SPEED_WALKING_KMH),
                         "key": None if sid == WALK_SETTING_DEFAULT else sid,
                         "r5_version": rp.get("r5_version"), "r5_jar_sha256": rp.get("r5_jar_sha256"),
                         "transfer_rules": rp.get("transfer_rules", "r5"),
                         **({"night_network": rp["night_network"]} if rp.get("night_network") else {}),
                         "dataset_id": f"{rp['service_date']}_{points_sha[:12]}_walk{lim}"})
    return {"nature": "choix de l'équipe (D-024), pas une donnée", "default": WALK_SETTING_DEFAULT,
            "mode": "transit", "legs": ["accès depuis le point de départ", "sortie vers le point d'arrivée"],
            "transfer_limit_m": TRANSFER_WALK_LIMIT_M,
            "all_walk_trip": "un trajet tout à pied compte comme un seul trajet à pied : il est limité de même",
            "settings": settings}


def velib_meta(params: dict, n_origins: int) -> dict:
    """Bloc meta.velib (D-027) : avertissement exact, texte hors zone, source et méthode."""
    vel = next((r for r in read_manifest() if r["source_id"] == "VEL01"), {})
    return {"warning": VELIB_WARNING, "out_of_zone": VELIB_OUT_OF_ZONE, "source": "VEL01",
            "snapshot": (vel.get("date_extraction") or "")[:10] or None, "licence": vel.get("licence") or None,
            "stations": params.get("n_stations"), "origins": n_origins,
            "method": "marche jusqu'à une station, Vélib' jusqu'à une autre station, marche jusqu'à l'arrivée ; "
                      "meilleur couple de stations ; temps minimal (prise et dépose du vélo non comptées)"}


def manifest_row(source_id: str, filename: str) -> dict[str, str]:
    """Ligne du manifeste d'un fichier précis (plusieurs fichiers par source : COST06, COST08)."""
    return next((r for r in read_manifest() if r["source_id"] == source_id
                 and r["fichier_local"].endswith("/" + filename)), {})


TOLL_SOURCES = ("TOLL01", "TOLL02", "TOLL03", "TOLL04", "TOLL05")
VEH01_PDF = "2023-09_ademe-2rm-maj-connaissances-consommations-emissions-echappement.pdf"


def toll_sources() -> list[dict]:
    """Sources des péages (manifeste) recopiées dans tolls.json : identifiant, titre, URL, date, licence."""
    seen: dict[str, dict] = {}
    for r in read_manifest():
        if r["source_id"] in TOLL_SOURCES and r["source_id"] not in seen:
            seen[r["source_id"]] = {"source_id": r["source_id"], "title": r["titre"], "url": r["url_source"],
                                    "read_at": r["date_extraction"], "licence": r["licence"]}
    return [seen[k] for k in TOLL_SOURCES if k in seen]


def car_blocks(load_dist: bool, pole_ids: list[str], origin_ids: list[str], msha: dict[str, str],
               points_sha: str) -> tuple[dict, list[dict], dict, dict[str, dict], dict | None]:
    """(meta.car_congestion, meta.vehicles, meta.car_costs, car_trip par commune, tolls.json) - D-029."""
    block = cong.meta_block(manifest_row("ROAD01", "barometre_mensuel_no41-_novembre_2025.pdf"))
    consumption = veh.read_sdes_consumption(RAW_DIR / "COST08" / "sdes_bilan_transports_2024_circulation.xlsx")
    idf = veh.read_fuel_prices(RAW_DIR / "COST07" / "prix-carburants-flux-instantane-v2.csv")
    fuels = {vid: veh.fuel_stats(idf, f) for vid, (f, _) in veh.FUELS.items()}
    rows = {"COST07": manifest_row("COST07", "prix-carburants-flux-instantane-v2.csv"),
            "COST08": manifest_row("COST08", "sdes_bilan_transports_2024_circulation.xlsx"),
            "COST06": manifest_row("COST06", "Grille_prix_Tarif_Bleu.pdf"),
            "VEH01": manifest_row("VEH01", VEH01_PDF), "ENV02": manifest_row("ENV02", veh.BASE_CARBONE_FILE)}
    two_wheelers = veh.read_2rm_consumption(PROCESSED_DIR / "ademe_2rm_conso_lecture.csv")
    co2 = veh.read_co2_factors(RAW_DIR / "ENV02" / veh.BASE_CARBONE_FILE)
    vehicles = veh.vehicles_meta(consumption, fuels, rows, two_wheelers, co2)
    trips: dict[str, dict] = {}
    info = None
    tolls_json = None
    tolls_info = None
    if load_dist:
        matrix_csv = INPUTS.main_dir / "car_any.csv"
        matrix = pd.read_csv(matrix_csv, dtype={"from_id": str}) if matrix_csv.exists() else None
        osm_tolls = PROCESSED_DIR / "osm_toll_points.json"
        dist, info = cdist.load_corrected(INPUTS.car_dir, pole_ids, origin_ids, msha,
                                          points_sha, matrix, tolls_sha=sha256_of(osm_tolls))
        print(f"distances voiture corrigées : {info['status']} ({info.get('reason') or info.get('pairs')})")
        if info["status"] == "ok":
            tariffs = pd.read_csv(PROCESSED_DIR / "toll_tariffs.csv", dtype={"heure_debut": str, "heure_fin": str},
                                  keep_default_na=False, na_values=[""])
            osm = json.loads(osm_tolls.read_text(encoding="utf-8"))
            com = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str}).set_index("insee")
            pole_pts = {x["id"]: (x["point"]["lon"], x["point"]["lat"]) for x in
                        json.loads(INPUTS.poles_file.read_text(encoding="utf-8"))}
            tolls_json = tpub.build_tolls_json(tariffs, SERVICE_DATE, PROCESSING_VERSION, toll_sources())
            index = {p["id"]: i for i, p in enumerate(tolls_json["points"])}
            origin_pts = {insee: (float(com.at[insee, ORIGIN_LON]), float(com.at[insee, ORIGIN_LAT]))
                          for insee in dist}
            cells_all, counts = tpub.trip_cells(dist, tariffs, osm, index, origin_pts, pole_pts, pole_ids,
                                                cdist.DIRECTIONS)
            for insee, e in dist.items():
                trips[insee] = car_trip(e, cells_all[insee])
            tolls_info = {"status": "ok", "file": "tolls.json", "contract": tpub.CONTRACT, "cells": counts,
                          "rule": "péages traversés par le chemin R5 de chaque sens (04g, nœuds OSM relevés avec la "
                                  "troncature de R5), tarifés au jour de service par le front (tolls.json)"}
            print("péages par sens : " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    return block, vehicles, veh.costs_meta(info, tolls_info), trips, tolls_json


def car_trip(e: dict, toll_cells: dict[str, list]) -> dict:
    """Bloc car_trip de access/{insee}.json : distances (m) et péages traversés (cellules de tolls.json) de chaque
    sens. Le coût d'énergie et le carbone se déduisent des distances et de meta.vehicles (front et 07)."""
    return {"dist_m": {"out": e["dist_out"], "ret": e["dist_ret"]},
            "reason": {"out": e["reason_out"], "ret": e["reason_ret"]},
            "toll": toll_cells}


def manifest_sha() -> dict[str, str]:
    return {r["source_id"]: r["sha256"] for r in read_manifest()
            if r["source_id"] in ("TRA01", "TRA01B", "TRA01C", "CYC01", "VEL01")}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--skip-checks", action="store_true")
    p.add_argument("--no-access", action="store_true",
                   help="n'exporte ni access/ ni insights.json (supprime les fichiers existants, access_communes vide)")
    p.add_argument("--transfer-rules", choices=["r5", "gtfs_navitia"], default=None,
                   help="D-031 : r5 = matrices du moteur d'origine (matrix_walk{L}) ; gtfs_navitia = matrices "
                        "recalculées avec les temps de correspondance officiels (matrix_walk{L}_d031, et le vélo + TC "
                        "du récit matrix_story_d031). Défaut : gtfs_navitia pour les 44 astres, r5 pour les 15 pôles")
    p.add_argument("--astres", choices=list(pub.SKIES), default=SKY_DEFAULT,
                   help="ciel des pôles du calcul exporté : 44 (défaut = SKY_DEFAULT : dossiers `_b44` : "
                        "matrix_modes_b44, matrix_walk{L}_d031_b44, matrix_velib_b44, matrix_story_d031_b44 et vélo + "
                        "TC toutes communes `_a`, `_b1` à `_b5` réunis, car_dist_carspeed_v2_b44 ; exporté à la racine de "
                        "frontend/public/data) ; exige gtfs_navitia")
    p.add_argument("--out-dir", type=Path, default=None,
                   help="écrit dans ce dossier au lieu de frontend/public/data (essai : rien du site publié n'est touché ; "
                        "le poles.json des 44 astres reste celui de 03b --publish)")
    p.add_argument("--interim", type=Path, default=None,
                   help="dossier des calculs rapatriés (défaut data/interim) ; utile pour un essai dans un arbre à part")
    args = p.parse_args()
    if args.transfer_rules is None:
        args.transfer_rules = "gtfs_navitia"
    global WALK_DIR_SUFFIX, INPUTS, FRONT_DATA_DIR
    WALK_DIR_SUFFIX = "" if args.transfer_rules == "r5" else "_d031"
    INPUTS = pub.sky_inputs(args.astres, args.transfer_rules, args.interim or INTERIM_DIR)
    if args.out_dir is not None:
        FRONT_DATA_DIR = args.out_dir.resolve()
        if FRONT_DATA_DIR == _PUBLISHED_DIR:
            raise SystemExit("--out-dir : ne pas viser frontend/public/data ; l'omettre pour publier")
    # dossier des fichiers calculés vers les pôles du ciel (meta.json, access/, tolls.json, insights.json) : la racine
    # ; communes.json, sources.json et context/ restent à la racine
    calc_dir = FRONT_DATA_DIR if args.out_dir is not None else sky_front_dir(args.astres)
    if not args.skip_checks:
        rc = subprocess.call([sys.executable, str(PIPELINE_DIR / "scripts" / "07_quality_checks.py")])
        if rc != 0:
            print("Contrôles qualité en échec : export annulé.", file=sys.stderr)
            return 1

    poles = json.loads(INPUTS.poles_file.read_text(encoding="utf-8"))
    pole_ids = [x["id"] for x in poles]
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str, "dep": str})
    origins = communes[communes["is_origin"]]
    origin_ids = origins["insee"].tolist()

    points_sha = origin_points_sha256(origins)
    msha = manifest_sha()
    # flux GTFS (décision du 06/11) : empreintes complètes au manifeste, même avec --skip-checks ; le vélo + TC est lu sur le
    # réseau que la méthode impose (TRA01B depuis le flux du 06/11, `starway.flux.bike_transit_source`)
    flux_errs = flux.incomplete_problems(msha) + flux.f06_problems(msha)
    if flux_errs:
        raise SystemExit("manifeste des flux GTFS incohérent : " + " ; ".join(flux_errs))
    print(f"[flux] TRA01 {msha['TRA01'][:8]}, TRA01B {msha['TRA01B'][:8]}, TRA01C {msha['TRA01C'][:8]} ; "
          f"vélo + TC lu sur {flux.bike_transit_source(msha)} (trois journées-types)")
    load = MatrixLoad() if args.no_access else load_published(
        pole_ids, origin_ids, msha, main_dir=INPUTS.main_dir, story_dirs=list(INPUTS.story_dirs), points_sha=points_sha)
    for pb in load.problems:
        print(f"[lots] {pb}")
    # D-024 : la matrice TC publiée est celle du réglage par défaut ; les autres réglages vont dans variants
    walk_params: dict[str, dict] = {}
    variants: dict[str, MatrixLoad] = {}
    vel_params: dict = {}
    if not args.no_access:
        for sid, lim in WALK_SETTINGS_M.items():
            if not (walk_dir(lim) / "run_params.json").exists():  # calcul pas rapatrié ou pas lancé : mode non publié
                print(f"[lots {sid}] {walk_dir(lim).name} absent : TC {sid} en cours de calcul (non publié)")
                if sid == WALK_SETTING_DEFAULT:
                    load.matrices = {k: v for k, v in load.matrices.items() if k[0] != "transit"}
                    load.coverage["transit"] = []
                continue
            ld, walk_params[sid] = load_walk_setting(walk_dir(lim), pole_ids, origin_ids, msha, points_sha, lim)
            for pb in ld.problems:
                print(f"[lots {sid}] {pb}")
            # D-040 : le 6h-14h vient du recalcul sur le réseau de nuit s'il existe et couvre toutes les origines
            try:
                ld, night_info, why = nn.apply_night_d06(ld, walk_params[sid], walk_dir(lim), pole_ids, origin_ids,
                                                         msha, points_sha, lim)
            except ValueError as e:
                raise SystemExit(str(e)) from e
            print(f"[lots {sid}] 6h-14h : {why}")
            if night_info is not None:
                walk_params[sid] = {**walk_params[sid], "night_network": night_info}
            if sid == WALK_SETTING_DEFAULT:
                load.matrices = {k: v for k, v in load.matrices.items() if k[0] != "transit"} | ld.matrices
                load.coverage["transit"] = ld.coverage.get("transit", [])
            else:
                variants[sid] = ld
        if (INPUTS.velib_dir / "velib_any.csv").exists():
            vel, vel_params = load_velib(INPUTS.velib_dir, pole_ids, msha)
            load.matrices.update(vel.matrices)
            load.coverage["velib"] = vel.coverage["velib"]
        else:
            print(f"[velib] {INPUTS.velib_dir.name} absent : Vélib' en cours de calcul (non publié)")
    matrices = load.matrices
    access_ids = sorted({i for ids in load.coverage.values() for i in ids})
    coverage = partial_coverage(load.coverage, [m for m, _ in MODES], origin_ids)
    status = kinds_status(load.coverage, origin_ids)

    FRONT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    access_dir = calc_dir / "access"
    if access_dir.exists():
        shutil.rmtree(access_dir)
    sizes: dict[str, int] = {}
    access_all: dict[str, dict] = {}
    car_cong, vehicles, car_costs, car_trips, tolls_json = car_blocks(not args.no_access, pole_ids, origin_ids, msha,
                                                                      points_sha)
    tolls_path = calc_dir / "tolls.json"
    if tolls_json is not None:
        sizes["tolls.json"] = write_json(tolls_path, tolls_json)
    elif tolls_path.exists():
        tolls_path.unlink()
    for insee in access_ids:
        a = build_access(insee, pole_ids, matrices)
        if insee in car_trips and "car" in a["modes"]:
            a["car_trip"] = car_trips[insee]
        var = {sid: build_access(insee, pole_ids, ld.matrices)["modes"] for sid, ld in variants.items()
               if insee in ld.coverage.get("transit", [])}
        if var:
            a["variants"] = var
        access_all[insee] = a["modes"]
        sizes[f"access/{insee}.json"] = write_json(access_dir / f"{insee}.json", a)

    # Découvertes : seulement les types dont la couverture est suffisante (kinds_status), jamais un classement
    # biaisé par l'ordre du calcul. Les autres types sont absents et leur raison est dans meta.insights.
    insights_path = calc_dir / "insights.json"
    # Les découvertes des 44 astres sont écrites par 08e (table commune x commune) ; 06 n'en écrit aucune. Le statut de
    # couverture de chaque type reste dans meta.insights.kinds
    ok_kinds: set[str] = set()
    ins: list[dict] = []
    excluded: list[dict] = []
    checks, crosscheck_info = load_crosscheck()
    jobs_list = [int(x["jobs"]) for x in poles]

    def series_of(insee: str, mode: str, day: str):
        return ((access_all.get(insee) or {}).get(mode) or {}).get(day)

    def crosscheck_of(item) -> tuple[str, dict | None]:
        return published_crosscheck(item, checks, series_of, pole_ids, jobs_list)

    def navitia_cause(item) -> str | None:
        return CAUSE_NAVITIA if crosscheck_of(item)[0] == "contradicted" else None

    if ok_kinds:
        adj = pd.read_csv(PROCESSED_DIR / "adjacency_2026.csv", dtype=str)
        neighbours = list(zip(adj["insee_a"], adj["insee_b"], strict=True))
        days = [d.id for d in DAY_TYPES]
        ins = [x for x in compute_insights(access_all, jobs_list, list(BUDGETS_MIN), days,
                                           neighbours, excluded=excluded, extra_cause=navitia_cause)
               if x["kind"] in ok_kinds]
        for x in ins:
            x["crosscheck"] = crosscheck_of(x)[0]
        excluded = [x for x in excluded if x["kind"] in ok_kinds]
        for x in excluded:
            print(f"découverte écartée ({x['excluded_cause']}) : {x['id']} {x['scenario']}")
        n_cc = pd.Series([x["crosscheck"] for x in ins]).value_counts().to_dict() if ins else {}
        print("recoupement Navitia des découvertes publiées : " + ", ".join(f"{k} {v}" for k, v in n_cc.items()))
        if crosscheck_info is not None:
            crosscheck_info["published_counts"] = {k: int(n_cc.get(k, 0)) for k in CROSSCHECK_STATUSES}

    def excluded_entry(x: dict) -> dict:
        e = {"would_be_id": x["id"], "kind": x["kind"], "scenario": x["scenario"], "cause": x["excluded_cause"]}
        if x["excluded_cause"] == CAUSE_NAVITIA and crosscheck_info is not None:
            chk = crosscheck_of(x)[1] or {}
            e["crosscheck_file"] = crosscheck_info["file"]
            e["crosscheck_generated_at"] = crosscheck_info["generated_at"]
            e["trips"] = [{k: t.get(k) for k in ("insee", "pole_id", "day", "leg", "starway_min", "navitia_min")}
                          for t in chk.get("trips", [])]
        return e
    if ins:
        sizes["insights.json"] = write_json(insights_path, ins)
    elif insights_path.exists():
        insights_path.unlink()

    story = read_origins_file(STORY_FILE) if STORY_FILE.exists() else []
    meta = {**build_meta(gtfs_extraction_date(), access_ids, story),
            "mode_coverage": coverage | ({cong.MODE_ID: coverage[cong.BASE_MODE]} if cong.BASE_MODE in coverage else {}),
            "car_congestion": car_cong, "vehicles": vehicles, "car_costs": car_costs,
            # D-028 : communes qui ont un fichier itineraries*/{insee}.json.gz (06h --publish), par réglage de marche ;
            # D-031 (c) : marquage des correspondances écrit par 06t (absent : non marqués) ; faits par ligne (06h)
            **itin_meta.build(calc_dir),
            # « Mes besoins » : textes, libellés des niveaux de gare et sources écrits par 06n (absent : non appliqué)
            **({"needs": nm} if (nm := needs_published(
                (needs_mod.read_doc(f) for f in needs_mod.doc_files(calc_dir / "itineraries")),
                RAW_DIR / "TRA04" / "accessibilite-en-gare.csv")) else {}),
            "insights": {"written": bool(ins), "kinds": status,
                         "excluded": [excluded_entry(x) for x in excluded],
                         **({"crosscheck": crosscheck_info} if crosscheck_info else {})},
            **({"walk_settings": walk_settings_meta(walk_params, points_sha)} if walk_params else {}),
            **({"velib": velib_meta(vel_params, len(load.coverage.get("velib", [])))} if vel_params else {}),
            "speeds": {"walk_kmh": SPEED_WALKING_KMH, "bike_kmh": SPEED_CYCLING_KMH},
            "origin_methods": {code: label for label, code in ORIGIN_METHOD_CODES.items()},
            "max_trip_min": MAX_TRIP_MIN,
            "outbound_step_min": OUTBOUND_STEP_MIN,
            # ciel des pôles de access/ (contrat meta.access_sky) : le front compare au ciel affiché avant d'indexer
            "access_sky": {"sky": INPUTS.sky, "poles": len(poles), "poles_file": INPUTS.poles_file.name,
                           "poles_sha256": sha256_of(INPUTS.poles_file), "transfer_rules": args.transfer_rules},
            **dataset_identity(INPUTS.main_dir)}
    meta["modes"] = cong.modes_with_traffic(meta["modes"])
    sizes["meta.json"] = write_json(calc_dir / "meta.json", meta)
    sizes["communes.json"] = write_json(FRONT_DATA_DIR / "communes.json", compact_origin(build_communes(origins)))
    sizes["sources.json"] = write_json(FRONT_DATA_DIR / "sources.json", build_sources())

    ctx_src = INTERIM_DIR / "context"
    ctx_dst = FRONT_DATA_DIR / "context"
    if ctx_dst.exists():
        shutil.rmtree(ctx_dst)
    if ctx_src.exists():
        ctx_dst.mkdir(parents=True)
        n_ctx = 0
        for f in sorted(ctx_src.glob("*.json")):
            shutil.copyfile(f, ctx_dst / f.name)
            n_ctx += 1
        sizes[f"context/ ({n_ctx} fichiers)"] = sum(f.stat().st_size for f in ctx_dst.glob("*.json"))

    n_access = sum(1 for k in sizes if k.startswith("access/"))
    for k, v in sizes.items():
        if not k.startswith("access/"):
            print(f"{k:28} {v / 1024:8.1f} Ko")
    print(f"access/ : {n_access} fichiers ({sum(v for k, v in sizes.items() if k.startswith('access/')) / 1024:.1f} Ko)")
    print("couverture publiée : " + ", ".join(f"{m} {len(load.coverage.get(m, []))}/{len(origin_ids)}"
                                              for m, _ in MODES))
    print("découvertes : " + ", ".join(f"{k} {v['status']}" for k, v in status.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
