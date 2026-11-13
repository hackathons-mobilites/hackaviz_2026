"""Lecture des lots TERMINÉS de la matrice r5py (calcul complet 04 et second calcul 04b), en lecture seule.

Pourquoi : pendant la nuit, 04 écrit ses lots au fil de l'eau (`batches/{mode}_{day}/batch_NNNN.csv`, écriture
atomique via un fichier `.part` renommé). Les fichiers consolidés `{mode}_{day}.csv` ne sont écrits qu'à la fin du
calcul (et ceux présents aujourd'hui sont les restes OBSOLÈTES du POC) : 06 et 07 lisent donc les lots.

Règles :
- seuls les fichiers `batch_NNNN.csv` sont lus (les `.part` en cours d'écriture sont ignorés) ; rien n'est écrit ;
- les paramètres du calcul (`run_params.json`) doivent correspondre aux sources du manifest (empreintes GTFS/OSM,
  version de traitement), sinon les lots sont refusés ;
- un lot doit contenir chaque origine × chaque pôle ; pour le calcul complet, ses origines doivent être exactement
  le lot k du découpage déterministe (origines triées, `batch_size`) ;
- toute durée > MAX_TRIP_MIN (120 min) est traitée comme « no_trip_within_120 » (cap_to_max_trip) ;
- une commune est PUBLIÉE pour un mode quand toutes ses journées requises sont présentes (d06, d09, d14 pour les
  modes à horaire ; `any` sinon). Une commune absente reste hors couverture : aucune valeur n'est inventée.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from starway import flux
from starway.config import DAY_TYPES, INTERIM_DIR, MAX_TRIP_MIN, PROCESSING_VERSION

TIME_DEPENDENT = frozenset({"transit", "bike_transit"})
BATCH_RE = re.compile(r"^batch_(\d{4})\.csv$")
COLUMNS = ["from_id", "to_id", "out", "dep", "ret", "reason"]
REASON_NO_TRIP = "no_trip_within_120"


def cap_to_max_trip(df: pd.DataFrame, max_min: int = MAX_TRIP_MIN) -> pd.DataFrame:
    """Durées au-delà de la durée maximale de recherche -> null + `no_trip_within_120` (copie ; le lot n'est pas
    modifié). Règle dérivée du paramètre de calcul MAX_TRIP_MIN : r5py peut rendre 121 ou 122 min alors que la
    recherche est bornée à 120 ; une telle valeur n'est pas un résultat dans la borne. Le départ retenu `dep` de
    l'aller est effacé avec la durée aller."""
    d = df.copy()
    for col in ("out", "ret"):
        over = d[col].notna() & (d[col] > max_min)
        d.loc[over, col] = pd.NA
        if col == "out" and "dep" in d:
            d.loc[over, "dep"] = pd.NA
    null = d["out"].isna() | d["ret"].isna()
    d.loc[null & d["reason"].isna(), "reason"] = REASON_NO_TRIP
    return d


def required_days(mode: str) -> list[str]:
    return [d.id for d in DAY_TYPES] if mode in TIME_DEPENDENT else ["any"]


@dataclass
class MatrixLoad:
    """Matrices publiables + diagnostic."""

    matrices: dict[tuple[str, str], pd.DataFrame] = field(default_factory=dict)
    coverage: dict[str, list[str]] = field(default_factory=dict)  # mode -> origines publiées (toutes journées)
    batches: dict[str, list[int]] = field(default_factory=dict)  # "{mode}_{day}" -> lots lus
    problems: list[str] = field(default_factory=list)


def check_run_params(params: dict, manifest_sha: dict[str, str], gtfs_source: str = "TRA01",
                     non_transit: bool = False) -> list[str]:
    """Écarts entre le calcul qui a produit les lots et les sources actuelles (liste vide = cohérent).

    `gtfs_source` : source du GTFS attendu. TRA01 par défaut (le GTFS d'IDFM tel que téléchargé). TRA01B (le même GTFS
    + les courses de la veille codées 24:00 et plus, D-040) ne s'accepte QUE là où le réseau de nuit est utilisé
    (`starway.night_network` : 6h-14h corrigé, tables du matin et du soir, et, depuis le flux du 06/11, le vélo + TC :
    `starway.flux.bike_transit_source`) ; un calcul de jour sur TRA01B ou un calcul de nuit sur TRA01 est refusé.
    `non_transit` : calcul sans transport en commun (marche, vélo, voiture, Vélib'), non relancé avec le flux du 06/11 :
    l'empreinte du flux précédent (`data/flux_gtfs_precedents.csv`) reste acceptée, et elle seule."""
    errs = []
    if params.get("processing_version") != PROCESSING_VERSION:
        errs.append(f"processing_version {params.get('processing_version')} != {PROCESSING_VERSION}")
    if params.get("gtfs_sha256") not in flux.accepted_gtfs_shas(gtfs_source, manifest_sha, non_transit=non_transit):
        errs.append(f"gtfs_sha256 différent du manifest ({gtfs_source})")
    if params.get("osm_sha256") != manifest_sha.get("CYC01"):
        errs.append("osm_sha256 différent du manifest (CYC01)")
    return errs


def expected_lots(origins: Sequence[str], size: int) -> list[list[str]]:
    """Même découpage que 04_compute_matrix.batches_of (origines triées, lots de `size`)."""
    o = sorted(origins)
    return [o[i:i + size] for i in range(0, len(o), size)]


def read_batches(run_dir: Path, pole_ids: Sequence[str], all_origins: Sequence[str] | None) -> MatrixLoad:
    """Lit les lots terminés d'un dossier de calcul (`matrix/` ou `matrix_story/`).

    `all_origins` : ensemble des origines du calcul si on veut vérifier la composition de chaque lot (calcul
    complet) ; None pour le second calcul (04b), dont seul le contenu est contrôlé."""
    res = MatrixLoad()
    bdir = run_dir / "batches"
    if not bdir.exists():
        return res
    params = json.loads((run_dir / "run_params.json").read_text(encoding="utf-8"))
    lots = expected_lots(all_origins, int(params["batch_size"])) if all_origins is not None else None
    if lots is not None and int(params.get("n_origins", -1)) != len(all_origins):
        lots = None  # calcul sur un autre ensemble d'origines (ex. POC) : composition non vérifiable ici
        res.problems.append(f"{run_dir.name} : n_origins {params.get('n_origins')} != {len(all_origins)}")
    poles = list(pole_ids)
    for sub in sorted(p for p in bdir.iterdir() if p.is_dir()):
        mode, _, day = sub.name.rpartition("_")
        parts = []
        for f in sorted(sub.iterdir()):
            m = BATCH_RE.match(f.name)
            if not m:
                continue  # .part en cours d'écriture, ou autre fichier : ignoré
            k = int(m.group(1))
            df = pd.read_csv(f, dtype={"from_id": str, "to_id": str, "reason": str, "dep": str},
                             usecols=lambda c: c in COLUMNS)
            if "dep" not in df:
                df["dep"] = pd.NA
            df = cap_to_max_trip(df)
            ids = sorted(df["from_id"].unique())
            full = len(df) == len(ids) * len(poles) and set(df["to_id"]) == set(poles) \
                and not df.duplicated(["from_id", "to_id"]).any()
            if not full:
                res.problems.append(f"{sub.name}/{f.name} incomplet : lot ignoré")
                continue
            if lots is not None and (k >= len(lots) or ids != lots[k]):
                res.problems.append(f"{sub.name}/{f.name} : origines différentes du lot {k} attendu : lot ignoré")
                continue
            parts.append(df)
            res.batches.setdefault(sub.name, []).append(k)
        if parts:
            res.matrices[(mode, day)] = pd.concat(parts, ignore_index=True)
    return res


def published(load: MatrixLoad) -> MatrixLoad:
    """Ne garde, pour chaque mode, que les origines présentes dans TOUTES les journées requises."""
    modes = {m for m, _ in load.matrices}
    out = MatrixLoad(batches=load.batches, problems=list(load.problems))
    for mode in sorted(modes):
        days = required_days(mode)
        sets = [set(load.matrices[(mode, d)]["from_id"]) if (mode, d) in load.matrices else set() for d in days]
        ok = set.intersection(*sets) if sets else set()
        out.coverage[mode] = sorted(ok)
        if not ok:
            continue
        for d in days:
            m = load.matrices[(mode, d)]
            out.matrices[(mode, d)] = m[m["from_id"].isin(ok)].reset_index(drop=True)
    return out


def _same_rows(a: pd.DataFrame, b: pd.DataFrame) -> bool:
    cols = [c for c in COLUMNS if c in a and c in b]
    key = ["from_id", "to_id"]
    x = a[cols].sort_values(key).reset_index(drop=True).astype(object).where(lambda d: d.notna(), "<NA>").astype(str)
    y = b[cols].sort_values(key).reset_index(drop=True).astype(object).where(lambda d: d.notna(), "<NA>").astype(str)
    return x.shape == y.shape and bool((x == y).all().all())


def merge(loads: Iterable[MatrixLoad]) -> MatrixLoad:
    """Fusionne calcul complet, second calcul et parties d'un même calcul (vélo + TC toutes communes, parties `_a` et `_b`,
    récit) ; une origine présente dans deux calculs pour un même (mode, journée) doit avoir exactement les mêmes lignes
    (même moteur, même réseau : le calcul est déterministe), sinon refus. Les doublons identiques ne sont gardés qu'une fois."""
    out = MatrixLoad()
    for ld in loads:
        out.problems += ld.problems
        out.batches.update(ld.batches)
        for key, m in ld.matrices.items():
            if key in out.matrices:
                have = out.matrices[key]
                both = set(have["from_id"]) & set(m["from_id"])
                if both:
                    if not _same_rows(have[have["from_id"].isin(both)], m[m["from_id"].isin(both)]):
                        raise ValueError(f"{key} : origines présentes dans deux calculs avec des durées différentes "
                                         f"{sorted(both)[:5]}")
                    m = m[~m["from_id"].isin(both)]
                m = pd.concat([have, m], ignore_index=True)
            out.matrices[key] = m
        for mode, ids in ld.coverage.items():
            out.coverage[mode] = sorted(set(out.coverage.get(mode, [])) | set(ids))
    return out


def partial_coverage(coverage: dict[str, list[str]], modes: Iterable[str], origins: Iterable[str]) -> dict[str, list[str]]:
    """`meta.mode_coverage` : pour chaque mode du contrat qui n'est PAS publié pour toutes les origines, la liste des
    origines publiées (éventuellement vide). Un mode absent de ce dictionnaire est publié partout."""
    all_o = set(origins)
    return {m: coverage.get(m, []) for m in modes if set(coverage.get(m, [])) != all_o}


def load_published(pole_ids: Sequence[str], all_origins: Sequence[str], manifest_sha: dict[str, str],
                   main_dir: Path = INTERIM_DIR / "matrix", story_dir: Path = INTERIM_DIR / "matrix_story",
                   points_sha: str | None = None, story_dirs: Sequence[Path] | None = None) -> MatrixLoad:
    """Point d'entrée de 06 et 07 : lots terminés du calcul complet et du second calcul, publiés par commune.
    `story_dirs` (44 astres : récit, puis vélo + TC toutes communes en deux parties) remplace `story_dir` ; leurs origines
    se recoupent au plus en lignes identiques (voir `merge`).

    Réseau attendu de chaque dossier (`starway.flux`) : marche, vélo, voiture (`main_dir`) : le flux du manifeste ou le flux
    précédent (aucun transport) ; récit et vélo + TC : `flux.bike_transit_source` (TRA01B dès le flux du 06/11)."""
    loads = []
    bt_source = flux.bike_transit_source(manifest_sha)
    for d, origins in ((main_dir, all_origins), *((s, None) for s in (story_dirs or [story_dir]))):
        if not (d / "batches").exists():
            continue
        params = json.loads((d / "run_params.json").read_text(encoding="utf-8"))
        if flux.is_bike_transit_dir(d.name):
            errs = check_run_params(params, manifest_sha, bt_source)
        else:
            errs = check_run_params(params, manifest_sha, non_transit=flux.is_non_transit_dir(d.name))
        # calcul complet : les points d'origine doivent être ceux de communes_idf_2026.csv (D-017). Le second calcul
        # (04b) fige l'empreinte de ses seules origines : contrôlée au lancement de 04b, pas ici.
        if points_sha is not None and d == main_dir and params.get("origin_points_sha256") != points_sha:
            errs.append("lots calculés avec d'autres points d'origine (origin_points_sha256)")
        if errs:
            raise ValueError(f"{d.name}/run_params.json incohérent avec les sources : {errs}")
        loads.append(published(read_batches(d, pole_ids, origins)))
    return merge(loads)


# --------------------------------------------------------------------------- réglages de marche (D-024), Vélib' (D-027)
def walk_setting_errors(params: dict, manifest_sha: dict[str, str], points_sha: str | None, limit_m: int,
                        gtfs_source: str = "TRA01") -> list[str]:
    """Écarts d'un calcul 04e (réglage de marche) : sources, points D-017, réglage et jar cohérents."""
    errs = check_run_params(params, manifest_sha, gtfs_source)
    if points_sha is not None and params.get("origin_points_sha256") != points_sha:
        errs.append("lots calculés avec d'autres points d'origine (origin_points_sha256)")
    if params.get("walk_leg_limit_m") != limit_m:
        errs.append(f"réglage {params.get('walk_leg_limit_m')} m != {limit_m} m")
    if params.get("walk_distance_limit_meters") != limit_m:
        errs.append(f"jar : WALK_DISTANCE_LIMIT_METERS {params.get('walk_distance_limit_meters')} != {limit_m}")
    if params.get("transfer_distance_limit_meters") != 1000:
        errs.append("jar : limite des correspondances modifiée")
    return errs


def load_walk_setting(run_dir: Path, pole_ids: Sequence[str], all_origins: Sequence[str],
                      manifest_sha: dict[str, str], points_sha: str | None, limit_m: int,
                      gtfs_source: str = "TRA01") -> tuple[MatrixLoad, dict]:
    """Lots TC d'un réglage de marche (data/interim/matrix_walk{L}/), publiés par commune ; refus si incohérent."""
    params = json.loads((run_dir / "run_params.json").read_text(encoding="utf-8"))
    errs = walk_setting_errors(params, manifest_sha, points_sha, limit_m, gtfs_source)
    if errs:
        raise ValueError(f"{run_dir.name}/run_params.json incohérent : {errs}")
    ld = published(read_batches(run_dir, pole_ids, all_origins))
    if {m for m, _ in ld.matrices} - {"transit"}:
        raise ValueError(f"{run_dir.name} : modes inattendus {sorted({m for m, _ in ld.matrices})}")
    return ld, params


def load_velib(run_dir: Path, pole_ids: Sequence[str], manifest_sha: dict[str, str]) -> tuple[MatrixLoad, dict]:
    """Matrice Vélib' V1 (04d, data/interim/matrix_velib/velib_any.csv), mode `velib`, clé `any`."""
    params = json.loads((run_dir / "run_params.json").read_text(encoding="utf-8"))
    errs = []
    if params.get("processing_version") != PROCESSING_VERSION:
        errs.append("processing_version")
    for key, sid in (("osm_sha256", "CYC01"), ("vel01_sha256", "VEL01")):
        if params.get(key) != manifest_sha.get(sid):
            errs.append(f"{key} différent du manifest ({sid})")
    # Vélib' : aucun transport en commun, non relancé avec le flux du 06/11 (flux précédent accepté)
    if params.get("gtfs_sha256") not in flux.accepted_gtfs_shas("TRA01", manifest_sha, non_transit=True):
        errs.append("gtfs_sha256 différent du manifest (TRA01)")
    if errs:
        raise ValueError(f"{run_dir.name}/run_params.json incohérent : {errs}")
    df = pd.read_csv(run_dir / "velib_any.csv", dtype={"from_id": str, "to_id": str, "reason": str},
                     usecols=lambda c: c in COLUMNS)
    df["dep"] = pd.NA
    df = cap_to_max_trip(df)
    ids = sorted(df["from_id"].unique())
    if len(df) != len(ids) * len(pole_ids) or set(df["to_id"]) != set(pole_ids) or df.duplicated(["from_id", "to_id"]).any():
        raise ValueError("velib_any.csv incomplet")
    if len(ids) != params.get("n_origins"):
        raise ValueError(f"velib_any.csv : {len(ids)} origines != n_origins {params.get('n_origins')}")
    return MatrixLoad(matrices={("velib", "any"): df}, coverage={"velib": ids}), params
