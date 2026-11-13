"""06d - Export front de la table origine-destination D-019 (PROPOSÉE) : horaires de poste libres, destinations
commune par commune. N'écrit rien dans frontend/public/data/access/ ni dans meta.json (jeu publié inchangé).

Lit les lots de 04c (data/interim/od/ par défaut, ou une copie partielle avec --od-dir), en lecture seule, et écrit :
    {out}/index.json        communes (ordre des destinations), postes Flores, pôle de chaque commune, grille,
                            sentinelles, couverture par mode, règle des trajets vers soi-même, volume
    {out}/o/{insee}.bin     un fichier binaire SWOD v1 par commune d'origine (contrat D-019)
Sortie par défaut : frontend/public/data/od/ si la table est complète ; data/interim/od_export_partial/ si elle ne
l'est pas (un export partiel n'est jamais écrit dans frontend/ sans --out explicite).

Réglage de marche D-024 (choix de l'équipe, pas une donnée) : --walk-setting normal|comfort exporte une variante
AUTONOME : TC lus dans data/interim/od_walk{L}/ (04c --walk-setting), marche / vélo / voiture lus dans od/ (ils ne
dépendent pas du réglage) après contrôle que les deux calculs ne diffèrent que par la marche (od_variant.base_compatible).
Sortie : frontend/public/data/od_walk{L}/ (complet) ou data/interim/od_export_partial_walk{L}/ ; index.walk_setting dit
le réglage, son jar et ses limites. Sans --walk-setting : réglage d'origine de R5 (index.walk_setting.id = r5_default).

--transit-only : n'exporte que le TC (la table de base od/ n'est pas lue). Marche, vélo, voiture sont annoncés « non
calculés » dans index.coverage (origins 0, computed [], status not_computed) et absents de index.modes : aucune valeur
n'est publiée pour eux. complete vaut false ; l'export n'est donc écrit dans frontend/ qu'avec --out explicite. Relancer
sans --transit-only quand od/ est complète : le même dossier est réécrit (idempotent), avec les quatre modes.

Usage :
    python scripts/06d_export_od.py                                    # table complète, data/interim/od/
    python scripts/06d_export_od.py --od-dir ../data/interim/od_partial  # lots copiés depuis la VM (partiel)
    python scripts/06d_export_od.py --od-dir ../data/interim/od_partial --out ../frontend/public/data/od
    python scripts/06d_export_od.py --od-dir ../data/interim/od_partial --measure   # volume seulement, rien d'écrit
    python scripts/06d_export_od.py --walk-setting normal       # TC od_walk3000/ + autres modes od/ -> od_walk3000/
    # D-040 : trois tables TC assemblées (matin 00:00-06:55 sur le réseau de nuit TRA01B, jour 07:00-22:00 sur TRA01, soir
    # 22:05-23:55 sur le réseau du soir TRA01C : tables _nuit_soir_v2, PAS les anciennes _nuit_soir)
    python scripts/06d_export_od.py --walk-setting normal --transit-only --od-dir ../data/interim/od_walk3000_d031 \
        --night-morning-dir ../data/interim/od_walk3000_d031_nuit_matin \
        --night-evening-dir ../data/interim/od_walk3000_d031_nuit_soir_v2 --out ../data/interim/od_export_nuit_walk3000
    (un seul des deux --night-* suffit : l'autre vaut <od-dir>_nuit_matin ou <od-dir>_nuit_soir_v2, voir od_night.default_night_dirs)
    python scripts/06d_export_od.py --walk-setting normal --transit-only --out ../frontend/public/data/od_walk3000
    # Ciel des 44 astres (D-030, seul ciel depuis D-054) : index seul (03b), réécrit à la racine ; --index-from accepte un
    # index déjà publié si besoin (voir --help)
    (même commande pour od_walk1000 ; --index-only refait l'index depuis les lots, plus long et plus gourmand)

Contrôles avant écriture (abandon au premier écart, aucun lot ignoré en silence) : empreintes GTFS / OSM = manifest,
points d'origine et de destination = communes_idf_2026.csv, découpage des lots = celui de 04c, grille = run_params,
postes = total Flores IDF, pôles = poles.json ; puis relecture de chaque fichier écrit (décodage = table plafonnée).
Ensuite : python scripts/07_quality_checks.py (contrôle « table OD D-019 »).
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import statistics
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from starway import flux
from starway import od_export as ox
from starway import od_night as on
from starway import od_table as od
from starway import od_variant as ov
from starway.config import (
    DATA_ROOT,
    FRONT_DATA_DIR,
    FRONT_SKY44_DIR,
    INTERIM_DIR,
    JOBS_YEAR,
    MAX_TRIP_MIN,
    OUTBOUND_LOOKBACK_MIN,
    OUTBOUND_STEP_MIN,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    REPO_ROOT,
    WALK_SETTINGS_M,
)
from starway.origin_points import origin_points_sha256
from starway.sources import read_manifest

DEFAULT_OUT_FULL = FRONT_DATA_DIR / "od"
DEFAULT_OUT_PARTIAL = INTERIM_DIR / "od_export_partial"
PREVIEW_ROOT = FRONT_SKY44_DIR  # D-030 : dossier du ciel des 44 astres (preview-d030/ avant la bascule ; index seul)
MODE_ORDER = ("transit", "walk", "bike", "car")  # codes de mode du format = position dans cette liste
SWA_FREE_LIMIT = {"bytes": 250 * 10**6, "files": 15000,
                  "source": "Microsoft Learn, quotas Azure Static Web Apps (plan Free), consultés le 03/11/2026"}


# --------------------------------------------------------------------------- entrées
def load_inputs(poles_path: Path | None = None) -> tuple[pd.DataFrame, pd.DataFrame, list[dict], pd.DataFrame]:
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    communes = communes[communes["is_origin"]].sort_values("insee").reset_index(drop=True)
    jobs = pd.read_csv(PROCESSED_DIR / f"jobs_by_commune_{JOBS_YEAR}.csv", dtype={"insee": str})
    poles = json.loads((poles_path or PROCESSED_DIR / "poles.json").read_text(encoding="utf-8"))
    return communes, od.destination_points(communes), poles, jobs


def commune_jobs(codes: list[str], jobs: pd.DataFrame) -> list[int]:
    """Postes EMP01 de chaque destination (arrondissements pour Paris, jamais 75056 en plus : pas de double compte).
    Contrôle : la somme des destinations = la somme des communes (COM, dont 75056), soit le total Flores IDF."""
    j = jobs.set_index("insee")["jobs"]
    missing = [c for c in codes if c not in j.index or pd.isna(j[c])]
    if missing:
        raise SystemExit(f"postes Flores absents pour {missing[:5]}")
    vals = [int(j[c]) for c in codes]
    total_com = int(jobs.loc[jobs["geo_object"] == "COM", "jobs"].sum())
    if sum(vals) != total_com:
        raise SystemExit(f"somme des postes des destinations {sum(vals)} != total des communes {total_com}")
    return vals


def check_run_params(rp: dict[str, Any], communes: pd.DataFrame, dests: pd.DataFrame,
                     gtfs_source: str = "TRA01", non_transit: bool = False) -> list[str]:
    """`gtfs_source` : source du GTFS attendu dans les run_params. TRA01 (GTFS d'IDFM tel que téléchargé) partout ; TRA01B
    (le même GTFS + les courses de la veille codées 24:00 et plus, D-040) SEULEMENT pour la table du matin ; TRA01C (TRA01B + les
    courses du mercredi parties avant 3h) SEULEMENT pour la table du soir (`od_night.NETWORKS`). Une table calculée sur un
    autre réseau que le sien est refusée. `non_transit` : table `od` d'origine (marche, vélo, voiture, sans transport en
    commun), non relancée avec le flux du 06/11 : le flux précédent (`data/flux_gtfs_precedents.csv`) reste accepté."""
    sha = flux.manifest_sha() | {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] == "CYC01"}
    want = {"osm_sha256": sha.get("CYC01"), "processing_version": PROCESSING_VERSION,
            "origin_points_sha256": origin_points_sha256(communes), "dest_points_sha256": od.points_sha256(dests),
            "departure_step_min": OUTBOUND_STEP_MIN, "outbound_lookback_min": OUTBOUND_LOOKBACK_MIN,
            "max_trip_min": MAX_TRIP_MIN, "n_origins": len(communes), "n_destinations": len(dests)}
    errs = [f"{k} : run_params {rp.get(k)!r} != attendu {v!r}" for k, v in want.items() if rp.get(k) != v]
    ok_gtfs = flux.accepted_gtfs_shas(gtfs_source, sha, non_transit=non_transit)
    if rp.get("gtfs_sha256") not in ok_gtfs:
        errs.append(f"gtfs_sha256 : run_params {rp.get('gtfs_sha256')!r} != attendu ({gtfs_source}) {sorted(ok_gtfs)!r}")
    for m in rp.get("modes", []):
        legs = rp["mode_legs"][m]
        if legs["out"] != legs["ret"]:
            errs.append(f"mode {m} : modes r5py différents à l'aller et au retour (une table ne suffit pas)")
    return errs


def load_mode(od_dir: Path, mode: str, lots: list[list[str]], dest_ids: list[str],
              deps: np.ndarray) -> tuple[np.ndarray, list[int]]:
    """Table (origines, destinations, départs) ; lignes des lots absents = 253 (non calculé). Erreur si un lot présent
    ne correspond pas au découpage, aux destinations ou à la grille (jamais ignoré en silence)."""
    n = len(dest_ids)
    full = np.full((n, n, len(deps)), ox.SENTINEL_NOT_COMPUTED, dtype=np.uint8)
    done: list[int] = []
    for k, lot_ids in enumerate(lots):
        p = od.lot_path(od_dir, mode, k)
        if not p.exists():
            continue
        lot = od.read_lot(p)
        if lot.from_ids != lot_ids or lot.to_ids != dest_ids or not np.array_equal(lot.departures, deps):
            raise SystemExit(f"{p} : identifiants ou départs différents du découpage de 04c")
        if (lot.tt == ox.SENTINEL_NOT_COMPUTED).any():
            raise SystemExit(f"{p} : valeur 253 dans la table (réservée à « non calculé » à l'export)")
        i0 = k * len(lots[0])
        full[i0:i0 + len(lot_ids)] = lot.tt
        done += list(range(i0, i0 + len(lot_ids)))
    return full, done


def load_assembled_transit(dirs: dict[str, Path], plans: list[on.SegmentPlan], lots: list[list[str]],
                           dest_ids: list[str], grid: np.ndarray) -> tuple[np.ndarray, list[int]]:
    """TC assemblé des trois tables (D-040, `od_night`) : un lot compte comme calculé si les TROIS dossiers l'ont. Même
    contrôle que `load_mode` (jamais de 253 dans les lots)."""
    n = len(dest_ids)
    full = np.full((n, n, len(grid)), ox.SENTINEL_NOT_COMPUTED, dtype=np.uint8)
    done: list[int] = []
    for k, lot_ids in enumerate(lots):
        try:
            tt = on.load_assembled_lot(dirs, k, plans, lot_ids, dest_ids)
        except ValueError as e:
            raise SystemExit(str(e)) from e
        if tt is None:
            continue
        if (tt == ox.SENTINEL_NOT_COMPUTED).any():
            raise SystemExit(f"lot {k} : valeur 253 dans la table (réservée à « non calculé » à l'export)")
        i0 = k * len(lots[0])
        full[i0:i0 + len(lot_ids)] = tt
        done += list(range(i0, i0 + len(lot_ids)))
    return full, done


# --------------------------------------------------------------------------- export
def build_file(x: int, tables: dict[str, np.ndarray], computed: dict[str, set[int]], first: int,
               n_slots: int) -> bytes:
    sections = []
    for code, mode in enumerate(MODE_ORDER):
        if mode not in tables or x not in computed[mode]:
            continue
        t = tables[mode]
        if mode in od.TIME_DEPENDENT:
            sections.append(ox.series_section(code, x, t[x], t[:, x, :]))
        else:
            sections.append(ox.scalar_section(code, x, t[x, :, 0], t[:, x, 0]))
    return ox.pack_file(x, first, n_slots, sections)


def verify_file(buf: bytes, x: int, tables: dict[str, np.ndarray], computed: dict[str, set[int]]) -> ox.ParsedFile:
    """Relecture : chaque série décodée = table plafonnée ; destinations omises = aucune durée dans les deux sens."""
    pf = ox.parse_file(buf)
    if pf.origin != x:
        raise SystemExit(f"origine {pf.origin} != {x}")
    for code, mode in enumerate(MODE_ORDER):
        if mode not in tables or x not in computed[mode]:
            continue
        t = tables[mode]
        out_c = ox.cap_series(t[x].reshape(t.shape[1], -1))
        ret_c = ox.cap_series(t[:, x, :].reshape(t.shape[0], -1))
        keep = ox.has_trip(out_c) | ox.has_trip(ret_c)
        keep[x] = False
        got = pf.series.get(code, {}) if mode in od.TIME_DEPENDENT else pf.scalars.get(code, {})
        if sorted(got) != [int(y) for y in np.flatnonzero(keep)]:
            raise SystemExit(f"{mode} origine {x} : destinations publiées différentes de la règle du format creux")
        for y, val in got.items():
            o, r = (val if mode in od.TIME_DEPENDENT else (np.array([val[0]]), np.array([val[1]])))
            if not (np.array_equal(o, out_c[y]) and np.array_equal(r, ret_c[y])):
                raise SystemExit(f"{mode} {x} vers {y} : série décodée différente de la table")
    return pf


def repo_relative(path: Path) -> str:
    """Chemin relatif au dépôt, ou au dossier parent de STARWAY_DATA_ROOT (données d'un autre arbre) : jamais un chemin du
    poste dans les fichiers publiés (D4). Sur la VM, data/ est un lien vers un autre dossier : chemin complet en dernier recours."""
    p = path.resolve()
    for base in (REPO_ROOT, DATA_ROOT.parent):
        if p.is_relative_to(base.resolve()):
            return p.relative_to(base.resolve()).as_posix()
    return p.as_posix()


def write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def retarget_index(src: Path, out_dir: Path, poles_path: Path, poles: list[dict], codes: list[str],
                   jobs_v: list[int]) -> int:
    """Index publié réécrit pour un autre jeu de pôles (aperçu D-030). Les fichiers o/{insee}.bin ne contiennent
    aucun pôle : ceux du dossier publié restent valables. Contrôles : mêmes communes et mêmes postes que l'index
    source, partition complète, somme des postes par pôle = poles.json."""
    import hashlib

    raw = src.read_bytes()
    index = json.loads(raw)
    if index["communes"] != codes or index["jobs"] != jobs_v:
        raise SystemExit(f"{src} : communes ou postes différents des données traitées")
    pole_idx = ox.pole_of(codes, poles)
    for i, pl in enumerate(poles):
        if sum(j for j, q in zip(jobs_v, pole_idx, strict=True) if q == i) != pl["jobs"]:
            raise SystemExit(f"{pl['id']} : somme des postes des communes != poles.json")
    index.update({
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "pole_of": pole_idx,
        "poles": [{"id": pl["id"], "jobs": pl["jobs"]} for pl in poles],
        "preview": {
            "decision": "D-030 : astres = bassins d'emploi France Travail 2026, Paris en 20 arrondissements",
            "poles_source": repo_relative(poles_path),
            "index_source": repo_relative(src),
            "index_source_sha256": hashlib.sha256(raw).hexdigest(),
            "bin_files": (f"ceux de {repo_relative(src.parent)}/o/ (inchangés : ils ne contiennent aucun pôle) ; "
                          "seuls pole_of, poles, generated_at et preview diffèrent de l'index source"),
            "published": FRONT_SKY44_DIR.resolve() == FRONT_DATA_DIR.resolve(),  # vrai depuis la bascule (SKY_DEFAULT = 44)
        },
    })
    out_dir.mkdir(parents=True, exist_ok=True)
    data = json.dumps(index, ensure_ascii=False, separators=(",", ":")).encode()
    write_atomic(out_dir / "index.json", data)
    print(f"{out_dir / 'index.json'} : {len(poles)} pôles, {sum(q is None for q in pole_idx)} communes hors pôle, "
          f"{len(data) / 1024:.1f} Ko")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--od-dir", type=Path, default=None,
                   help="dossier des lots de 04c (lecture seule) ; défaut od/ ou, avec --walk-setting, od_walk{L}/")
    p.add_argument("--walk-setting", choices=list(WALK_SETTINGS_M),
                   help="variante de marche D-024 : TC de od_walk{L}/, autres modes de --base-od-dir")
    p.add_argument("--base-od-dir", type=Path, default=None,
                   help="avec --walk-setting : lots marche / vélo / voiture (défaut od/, lecture seule)")
    p.add_argument("--out", type=Path, help="dossier de sortie (défaut : voir l'aide)")
    p.add_argument("--transit-only", action="store_true",
                   help="TC seul, sans lire od/ : marche, vélo, voiture annoncés « non calculés » (voir l'aide)")
    p.add_argument("--measure", action="store_true", help="mesure le volume sans rien écrire")
    p.add_argument("--origins", nargs="*", help="restreint l'export à ces codes INSEE (essai)")
    p.add_argument("--no-gzip", action="store_true",
                   help="écrit les fichiers non compressés (par défaut : gzip -9, décompressé par le front)")
    p.add_argument("--poles", type=Path, default=None,
                   help="aperçu D-030 : autre jeu de pôles (ex. data/processed/poles_d030.json) ; exige --out hors "
                        "de frontend/public/data/, sauf dans preview-d030/ (le jeu en ligne n'est jamais écrasé)")
    p.add_argument("--index-only", action="store_true",
                   help="n'écrit que index.json : les fichiers o/{insee}.bin ne dépendent pas des pôles (ils sont "
                        "construits et relus, pas écrits)")
    p.add_argument("--index-from", type=Path, default=None,
                   help="avec --poles : réécrit l'index publié donné (ex. frontend/public/data/od_walk3000/index.json) "
                        "pour un autre jeu de pôles, sans lire les lots (seuls pole_of, poles, generated_at et preview "
                        "changent ; quelques secondes et peu de mémoire)")
    p.add_argument("--night-morning-dir", type=Path, default=None,
                   help="D-040 : lots TC du matin (réseau de nuit TRA01B, départs 00:00 à 06:55), ex. data/interim/"
                        "od_walk3000_d031_nuit_matin ; défaut (si --night-evening-dir est donné) : <od-dir>_nuit_matin ; "
                        "--od-dir reste la table du jour")
    p.add_argument("--night-evening-dir", type=Path, default=None,
                   help="D-040 : lots TC du soir (réseau du soir TRA01C, départs 22:05 à 23:55), ex. data/interim/"
                        "od_walk3000_d031_nuit_soir_v2 (PAS _nuit_soir : anciennes tables, jamais publiées) ; défaut (si "
                        "--night-morning-dir est donné) : <od-dir>_nuit_soir_v2")
    args = p.parse_args()
    if args.night_morning_dir is not None or args.night_evening_dir is not None:
        if args.index_only or args.index_from is not None or args.poles is not None:
            raise SystemExit("--night-* : export complet seulement (pas avec --index-only, --index-from ni --poles)")
        base_od = args.od_dir or (od.OD_DIR if args.walk_setting is None else ov.variant_dir(ov.setting_limit_m(args.walk_setting)))
        dm, de = on.default_night_dirs(base_od)
        args.night_morning_dir = args.night_morning_dir or dm
        args.night_evening_dir = args.night_evening_dir or de
        for d in (args.night_morning_dir, args.night_evening_dir):
            if not (d / "run_params.json").exists():
                raise SystemExit(f"{d} : table de nuit absente (run_params.json introuvable)")
    if args.poles is not None or args.index_only or args.index_from is not None:
        if args.out is None:
            raise SystemExit("--poles / --index-only / --index-from exigent --out (dossier d'aperçu)")
        out_r = args.out.resolve()
        if out_r.is_relative_to(FRONT_DATA_DIR.resolve()) and not out_r.is_relative_to(PREVIEW_ROOT.resolve()):
            raise SystemExit("aperçu refusé dans frontend/public/data/ hors de preview-d030/ : le jeu en ligne "
                             "ne change pas tant que le front ne lit pas le nouveau format")
    if args.index_from is not None and args.poles is None:
        raise SystemExit("--index-from exige --poles")

    t0 = time.time()
    communes, dests, poles, jobs = load_inputs(args.poles)
    codes = dests["id"].tolist()
    if communes["insee"].tolist() != codes:
        raise SystemExit("origines et destinations dans un ordre différent")
    if args.index_from is not None:
        return retarget_index(args.index_from, args.out, args.poles, poles, codes, commune_jobs(codes, jobs))
    limit_m = None if args.walk_setting is None else ov.setting_limit_m(args.walk_setting)
    args.od_dir = args.od_dir or (od.OD_DIR if limit_m is None else ov.variant_dir(limit_m))
    rp = json.loads((args.od_dir / "run_params.json").read_text(encoding="utf-8"))
    errs = check_run_params(rp, communes, dests, non_transit=flux.is_non_transit_dir(args.od_dir.name))
    rp_base: dict[str, Any] | None = None
    if limit_m is None and "walk_setting" in rp:
        errs.append(f"{args.od_dir} est une variante ({rp['walk_setting']}) : relancer avec --walk-setting")
    if limit_m is not None:
        if rp.get("walk_setting") != args.walk_setting or rp.get("walk_leg_limit_m") != limit_m:
            errs.append(f"{args.od_dir} : réglage {rp.get('walk_setting')} / {rp.get('walk_leg_limit_m')} m, "
                        f"attendu {args.walk_setting} / {limit_m} m")
        if rp.get("modes") != list(ov.VARIANT_MODES):
            errs.append(f"{args.od_dir} : modes {rp.get('modes')}, attendu {list(ov.VARIANT_MODES)}")
    if limit_m is not None and (not args.transit_only or args.base_od_dir is not None):
        # --transit-only avec --base-od-dir : contrôle de compatibilité seul, aucun lot de la base n'est lu
        base_dir = args.base_od_dir or od.OD_DIR
        rp_base = json.loads((base_dir / "run_params.json").read_text(encoding="utf-8"))
        errs += [f"base {base_dir} : {e}" for e in check_run_params(rp_base, communes, dests,
                                                                    non_transit=flux.is_non_transit_dir(base_dir.name))]
        errs += ov.base_compatible(rp_base, rp, ignore_gtfs=flux.is_non_transit_dir(base_dir.name))
    night = args.night_morning_dir is not None
    seg_dirs: dict[str, Path] = {}
    seg_rp: dict[str, dict[str, Any]] = {}
    if night:  # D-040 : matin sur TRA01B, soir sur TRA01C, jour sur le GTFS d'origine (TRA01) : trois empreintes
        seg_dirs = on.segment_dirs(args.od_dir, args.night_morning_dir, args.night_evening_dir)
        seg_rp = {on.DAY: rp}
        for name in (on.MORNING, on.EVENING):
            seg_rp[name] = json.loads((seg_dirs[name] / "run_params.json").read_text(encoding="utf-8"))
            errs += [f"table {name} : {e}" for e in check_run_params(seg_rp[name], communes, dests, on.NETWORKS[name])]
        manifest_sha = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] in on.NETWORK_SOURCES}
        errs += on.check_segments_params(seg_rp, *(manifest_sha.get(on.NETWORKS[n]) for n in (on.DAY, on.MORNING, on.EVENING)))
    if errs:
        raise SystemExit("run_params.json incompatible :\n  " + "\n  ".join(errs))
    grid = od.departure_grid(od.parse_hhmm(rp["departures"]["first"]), od.parse_hhmm(rp["departures"]["last"]))
    if len(grid) != rp["departures"]["count"]:
        raise SystemExit("grille de départs incohérente avec run_params.json")
    plans: list[on.SegmentPlan] = []
    if night:
        grids = {}
        for name, r in seg_rp.items():
            grids[name] = od.departure_grid(od.parse_hhmm(r["departures"]["first"]), od.parse_hhmm(r["departures"]["last"]))
            if len(grids[name]) != r["departures"]["count"]:
                raise SystemExit(f"table {name} : grille de départs incohérente avec run_params.json")
        try:
            plans = on.plan_segments(grids[on.MORNING], grids[on.DAY], grids[on.EVENING])
        except ValueError as e:
            raise SystemExit(f"tables de départs non assemblables : {e}") from e
        grid = on.assembled_grid(plans)
        print("grille assemblée : " + " + ".join(f"{p.name} {od.format_hhmm(p.first)}-{od.format_hhmm(p.last)}"
                                                  for p in plans) + f" = {len(grid)} départs")
    lots = od.batches_of(codes, rp["batch_size"])
    jobs_v = commune_jobs(codes, jobs)
    pole_idx = ox.pole_of(codes, poles)
    for i, pl in enumerate(poles):
        s = sum(jobs_v[y] for y, q in enumerate(pole_idx) if q == i)
        if s != pl["jobs"]:
            raise SystemExit(f"{pl['id']} : somme des postes des communes {s} != poles.json {pl['jobs']}")

    tables: dict[str, np.ndarray] = {}
    computed: dict[str, set[int]] = {}
    sources: dict[str, str] = {}
    for mode in MODE_ORDER:
        if args.transit_only and mode != "transit":
            continue
        src_dir, src_rp = args.od_dir, rp
        if rp_base is not None and base_dir is not None and mode not in ov.VARIANT_MODES:
            src_dir, src_rp = base_dir, rp_base  # mode sans TC : indépendant du réglage de marche, lu dans od/
        if mode not in src_rp["modes"]:
            continue
        deps = grid if mode in od.TIME_DEPENDENT else np.array([od.parse_hhmm(src_rp["direct_reference_departure"])],
                                                                dtype=np.int32)
        if night and mode == "transit":
            tables[mode], done = load_assembled_transit(seg_dirs, plans, lots, codes, grid)
            sources[mode] = repo_relative(src_dir)  # table du jour ; matin et soir : index.time_segments
        else:
            tables[mode], done = load_mode(src_dir, mode, lots, codes, deps)
            sources[mode] = repo_relative(src_dir)
        computed[mode] = set(done)
        print(f"{mode:8s} : {len(done)}/{len(codes)} origines calculées ({sources[mode]})")
    complete = all(len(v) == len(codes) for v in computed.values()) and set(computed) == set(MODE_ORDER)

    # une commune a un fichier si elle est calculée en TC (le mode de référence) ; ses autres modes s'y ajoutent
    targets = sorted(computed.get("transit", set()))
    if args.origins:
        want = set(args.origins)
        targets = [x for x in targets if codes[x] in want]
    if not targets:
        raise SystemExit("aucune origine calculée en TC à exporter")
    first, n_slots = int(grid[0]), len(grid)

    if limit_m is None:
        out_dir = args.out or (DEFAULT_OUT_FULL if complete else DEFAULT_OUT_PARTIAL)
    else:
        out_dir = args.out or (FRONT_DATA_DIR / f"od_walk{limit_m}" if complete
                               else INTERIM_DIR / f"od_export_partial_walk{limit_m}")
    files_dir = out_dir / "o"
    write_bins = not args.measure and not args.index_only
    if write_bins:
        files_dir.mkdir(parents=True, exist_ok=True)
    elif not args.measure:
        out_dir.mkdir(parents=True, exist_ok=True)
    sizes, gz_sizes, n_rec = [], [], {m: [] for m in tables}
    for x in targets:
        buf = build_file(x, tables, computed, first, n_slots)
        pf = verify_file(buf, x, tables, computed)
        for code, mode in enumerate(MODE_ORDER):
            if mode in tables and x in computed[mode]:
                n_rec[mode].append(len(pf.series.get(code, pf.scalars.get(code, {}))))
        sizes.append(len(buf))
        gz = gzip.compress(buf, compresslevel=9, mtime=0)
        gz_sizes.append(len(gz))
        if write_bins:
            write_atomic(files_dir / f"{codes[x]}.bin", buf if args.no_gzip else gz)
    if write_bins and not args.origins:  # idempotent : retire les fichiers d'origines qui ne sont plus exportées
        keep = {f"{codes[x]}.bin" for x in targets}
        for f in files_dir.glob("*.bin"):
            if f.name not in keep:
                f.unlink()

    volume = {"files": len(sizes), "bytes_total": sum(sizes), "bytes_median": int(statistics.median(sizes)),
              "bytes_max": max(sizes), "gzip9_bytes_total": sum(gz_sizes), "gzip9_bytes_max": max(gz_sizes),
              "published_bytes_total": sum(sizes) if args.no_gzip else sum(gz_sizes),
              "records_per_origin_median": {m: (int(statistics.median(v)) if v else None) for m, v in n_rec.items()},
              "swa_free_limit": SWA_FREE_LIMIT}
    print(f"{len(sizes)} fichiers : {sum(sizes) / 1e6:.1f} Mo ({sum(gz_sizes) / 1e6:.1f} Mo après gzip -9) ; "
          f"par fichier : médiane {statistics.median(sizes) / 1e3:.0f} Ko, maximum {max(sizes) / 1e3:.0f} Ko ; "
          f"destinations publiées par origine (médiane) : {volume['records_per_origin_median']}")
    if args.measure:
        print(f"--measure : rien d'écrit ({time.time() - t0:.0f} s)")
        return 0

    index = {
        "processing_version": PROCESSING_VERSION,
        "decision": "D-019 (proposée, non adoptée)",
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "dataset_id": f"{rp['service_date']}_{rp['origin_points_sha256'][:12]}",
        "service_date": rp["service_date"],
        "complete": complete,
        "format": {"name": "SWOD", "version": ox.FORMAT_VERSION, "path": "o/{insee}.bin", "endianness": "little",
                   "compression": "none" if args.no_gzip else "gzip"},
        "grid": {"first": od.format_hhmm(first), "last": od.format_hhmm(int(grid[-1])), "step_min": OUTBOUND_STEP_MIN,
                 "n_slots": n_slots},
        "starts": {"first": od.format_hhmm(od.servable_starts(grid)[0]),
                   "last": od.format_hhmm(od.servable_starts(grid)[-1])},
        "ends": {"first": od.format_hhmm(od.servable_ends(grid)[0]), "last": od.format_hhmm(od.servable_ends(grid)[-1])},
        "outbound_lookback_min": OUTBOUND_LOOKBACK_MIN, "max_trip_min": MAX_TRIP_MIN,
        "sentinels": {str(k): v for k, v in sorted(ox.SENTINELS.items())},
        "modes": [{"id": m, "code": i, "kind": "series" if m in od.TIME_DEPENDENT else "scalar"}
                  for i, m in enumerate(MODE_ORDER) if m in tables],
        "coverage": ox.coverage_block(computed, codes, MODE_ORDER),
        "files": [codes[x] for x in targets] if len(targets) != len(codes) else "all",
        "communes": codes,
        "jobs": jobs_v,
        "jobs_source": f"EMP01, INSEE Flores {JOBS_YEAR}, postes salariés (arrondissements pour Paris)",
        "pole_of": pole_idx,
        "poles": [{"id": pl["id"], "jobs": pl["jobs"]} for pl in poles],
        "self_pair": ox.SELF_PAIR_RULE,
        "source_od_dir": repo_relative(args.od_dir),
        "source_by_mode": sources,
        "walk_setting": ov.walk_setting_block(rp),
        "dest_point_rule": rp["dest_point_rule"],
        "origin_point_rule": rp["origin_point_rule"],
        "walk_limit": ({"status": "not_applied", "limit_m": 2000,
                        "detail": ("R5 ne relie un arrêt au point d'arrivée que par 2 000 m de marche au plus (D-023). "
                                   "Dans cette table, le point d'arrivée est celui d'une commune dans les deux sens : "
                                   "un « aucun trajet » peut venir de cette limite, à l'aller comme au retour. Le "
                                   "marquage no_stop_within_walk_limit de access/ (3 fins de poste, 15 pôles) n'est "
                                   "pas transposable à des horaires libres : il n'est pas appliqué ici.")}
                       if limit_m is None else
                       {"status": "setting", "limit_m": limit_m,
                        "detail": (f"Réglage de marche « {args.walk_setting} » (D-024, choix de l'équipe) : chaque "
                                   f"trajet à pied d'un trajet TC (accès, sortie) est limité à {limit_m} m ; un "
                                   "« aucun trajet » TC peut venir de cette limite, voulue par le réglage.")}),
        "volume": volume,
    }
    if night:
        index["time_segments"] = on.segments_block(
            plans, {k: repo_relative(v) for k, v in seg_dirs.items()}, seg_rp, rp["service_date"])
        index["decision"] = "D-019 (proposée, non adoptée) ; départs de nuit D-040"
        index["preview"] = {
            "decision": "D-030 : astres = bassins d'emploi France Travail 2026, Paris en 20 arrondissements",
            "poles_source": repo_relative(args.poles or PROCESSED_DIR / "poles.json"),
            "bin_files": ("non écrits (--index-only) : ceux du dossier publié du même réglage "
                          f"(frontend/public/data/{out_dir.name}/o/), identiques car ils ne contiennent aucun pôle"
                          if args.index_only else "écrits dans o/"),
            "published": FRONT_SKY44_DIR.resolve() == FRONT_DATA_DIR.resolve(),  # vrai depuis la bascule (SKY_DEFAULT = 44)
        }
    write_atomic(out_dir / "index.json", json.dumps(index, ensure_ascii=False, separators=(",", ":")).encode())
    print(f"écrit dans {out_dir} ({'complet' if complete else 'PARTIEL'}) en {time.time() - t0:.0f} s ; "
          "lancer 07_quality_checks.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
