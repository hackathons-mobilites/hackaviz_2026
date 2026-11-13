"""04e - Matrice TC avec un réglage de marche (D-024) : R5 recompilé + plafond de marche à l'accès.

Réglages = CHOIX DE L'ÉQUIPE (D-024, pas une donnée) : `starway.config.WALK_SETTINGS_M`, « confort » 1 000 m,
« normal » 3 000 m. Pour un réglage de distance L :
- sortie (dernier arrêt vers le point d'arrivée) : jar R5 v7.5.1-r5py dont la seule modification est
  `TransitLayer.WALK_DISTANCE_LIMIT_METERS = L` (vérifiée DANS le jar avant tout calcul, puis dans la JVM) ;
- accès (point de départ vers le premier arrêt) : r5py `max_time_walking` = L / SPEED_WALKING_KMH, arrondi à la
  minute supérieure (`starway.r5jar.walk_time_limit_min`). Dans R5, ce plafond limite aussi le trajet tout à pied
  du même calcul et filtre les correspondances (sans effet ici : leur table s'arrête à 1 000 m, inchangée) ;
- tout le reste est la matrice publiée (15 pôles, points D-017, GTFS / OSM, journées, grille, vitesses).
Historique : D-022 (limite 7 200 m) abandonnée, mémoire insuffisante (docs/methodologie.md § 5 septies).
Provenance des jars : docs/methodologie.md § 5 octies, pipeline/r5/build_r5_walk.sh.

Réutilise 04_compute_matrix.py tel quel (comme 04b) mais :
- écrit dans des dossiers SÉPARÉS (défaut data/interim/matrix_walk{L}/ et data/interim/access_walk{L}/) ;
- passe le jar à r5py (`--r5-classpath`) et vérifie dans la JVM la constante chargée ;
- utilise un cache r5py SÉPARÉ (XDG_CACHE_HOME) : r5py indexe son cache par les seuls fichiers d'entrée, pas par
  le jar, et les tables de distances de R5 sont figées dans le réseau mis en cache ;
- enregistre réglage, jar, empreinte, version, limites dans run_params.json (une reprise différente est refusée) ;
- s'arrête proprement (exit 3) si la machine descend sous --min-free-gb de mémoire libre : les lots déjà écrits
  sont complets (écriture atomique de 04), la même commande reprend là où le calcul s'est arrêté.

Usage (VM de calcul, docs/deploiement-azure.md) :
    python scripts/04e_compute_walk_variant.py --setting normal --r5-jar ~/r5build/r5-v7.5.1-r5py-walk3000-all.jar \\
        --max-memory 32G --dry-run
    python scripts/04e_compute_walk_variant.py --setting comfort --r5-jar ~/r5build/r5-v7.5.1-r5py-walk1000-all.jar \\
        --max-memory 12G
"""

from __future__ import annotations

import argparse
import functools
import importlib.util
import json
import os
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import psutil

from starway import r5_transfers
from starway.config import (
    DAY_TYPES_BY_ID,
    INTERIM_DIR,
    PIPELINE_DIR,
    REPO_ROOT,
    SPEED_WALKING_KMH,
    WALK_SETTINGS_M,
)
from starway.r5jar import check_not_inside, jar_info, low_memory, walk_time_limit_min

UPSTREAM_TRANSFER_M, UPSTREAM_PARKRIDE_M = 1000, 500  # valeurs du jar r5py d'origine, à garder inchangées
# dossiers des autres calculs : 04 (publié), 04b (récit), 04c (D-019, table OD)
PROTECTED = [INTERIM_DIR / "matrix", INTERIM_DIR / "access", INTERIM_DIR / "matrix_story",
             INTERIM_DIR / "access_story", INTERIM_DIR / "od"]


def setting_dirs(limit_m: int, rules: str = "r5") -> tuple[Path, Path, Path]:
    """(matrice, access, XDG_CACHE_HOME) par défaut d'un réglage ; r5py ajoute « r5py/ » au cache. Avec les règles
    D-031 (jar corrigé) : dossiers suffixés (`_d031`, `_d031a1`) et cache séparé `starway-d031-walk{L}` (copie du
    réseau du réglage : le correctif ne touche pas aux classes du réseau, mais un cache n'est jamais partagé entre
    deux jars)."""
    sfx = r5_transfers.DIR_SUFFIX[rules]
    cache = Path.home() / ".cache" / (f"starway-walk{limit_m}" if rules == "r5" else f"starway-d031-walk{limit_m}")
    return (INTERIM_DIR / f"matrix_walk{limit_m}{sfx}", INTERIM_DIR / f"access_walk{limit_m}{sfx}", cache)


def load_04():
    spec = importlib.util.spec_from_file_location("compute_matrix_04", PIPELINE_DIR / "scripts" / "04_compute_matrix.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def heap_bytes(spec: str) -> int:
    units = {"K": 1 << 10, "M": 1 << 20, "G": 1 << 30}
    return int(float(spec[:-1]) * units[spec[-1].upper()]) if spec[-1].upper() in units else int(spec)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--setting", required=True, choices=list(WALK_SETTINGS_M),
                   help="réglage de marche D-024 (choix de l'équipe) : distance max de l'accès et de la sortie")
    p.add_argument("--r5-jar", type=Path, required=True, help="jar R5 recompilé (WALK_DISTANCE_LIMIT_METERS = réglage)")
    p.add_argument("--origins", nargs="*", default=["all"], help="codes INSEE ou 'all' (défaut : comme la matrice publiée)")
    p.add_argument("--days", nargs="*", default=["d06", "d09", "d14"], choices=list(DAY_TYPES_BY_ID))
    p.add_argument("--modes", nargs="*", default=["transit"], choices=["transit", "bike_transit"])
    p.add_argument("--out-dir", type=Path, default=None, help="défaut : data/interim/matrix_walk{L}")
    p.add_argument("--access-dir", type=Path, default=None, help="défaut : data/interim/access_walk{L}")
    p.add_argument("--cache-home", type=Path, default=None,
                   help="XDG_CACHE_HOME de ce calcul (défaut ~/.cache/starway-walk{L}), réseau construit avec le jar")
    p.add_argument("--batch-size", type=int, default=100, help="même valeur que la matrice publiée")
    p.add_argument("--max-memory", required=True, help="heap max de la JVM R5 (ex. 48G)")
    p.add_argument("--min-free-gb", type=float, default=20.0,
                   help="arrêt propre si la machine descend sous ce seuil de mémoire libre (garde-fou d'exploitation)")
    p.add_argument("--fresh", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    r5_transfers.add_cli(p)
    r5_transfers.add_poles_cli(p)
    args = p.parse_args()
    r5_transfers.require_explicit_dir(args.poles, args.out_dir, "--out-dir")
    r5_transfers.require_explicit_dir(args.poles, args.access_dir, "--access-dir")

    def absolute(x: Path) -> Path:
        x = x.expanduser()
        return x if x.is_absolute() else REPO_ROOT / x

    limit_m = WALK_SETTINGS_M[args.setting]
    walk_min = walk_time_limit_min(limit_m, SPEED_WALKING_KMH)
    rules = args.transfer_rules
    d_out, d_access, d_cache = setting_dirs(limit_m, rules)
    out_dir, access_dir, cache_home, jar = (absolute(x) for x in (args.out_dir or d_out, args.access_dir or d_access,
                                                                   args.cache_home or d_cache, args.r5_jar))
    # dossiers des autres réglages et des autres règles de correspondance (jamais écrits par ce calcul)
    others = [d for lim in WALK_SETTINGS_M.values() for r in r5_transfers.RULE_SETS
              if (lim, r) != (limit_m, rules) for d in setting_dirs(lim, r)[:2]]
    if rules != "r5":
        check_not_inside([cache_home / "r5py"], [setting_dirs(lim)[2] / "r5py" for lim in WALK_SETTINGS_M.values()])
    tr_params = r5_transfers.run_params(rules, jar, absolute(args.same_stop_csv))
    check_not_inside([out_dir, access_dir], PROTECTED + others)
    default_cache = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_CACHE_HOME")
                         or Path.home() / ".cache") / "r5py"
    check_not_inside([cache_home / "r5py"], [default_cache])

    info = jar_info(jar)
    if info["walk_distance_limit_meters"] != limit_m:
        raise SystemExit(f"{jar.name} : WALK_DISTANCE_LIMIT_METERS = {info['walk_distance_limit_meters']}, "
                         f"attendu {limit_m} (réglage {args.setting}, D-024)")
    limits = (info["transfer_distance_limit_meters"], info["parkride_distance_limit_meters"])
    if limits != (UPSTREAM_TRANSFER_M, UPSTREAM_PARKRIDE_M):
        raise SystemExit(f"{jar.name} : limites de correspondance ou de P+R modifiées {limits}, refus")
    print(f"réglage {args.setting} : {limit_m} m ; accès max {walk_min} min à {SPEED_WALKING_KMH} km/h")
    print(f"jar {info['r5_jar']} ({info['r5_version']}, commit {info['r5_commit']}), sha256 {info['r5_jar_sha256'][:12]} ;"
          f" sortie {info['walk_distance_limit_meters']} m, correspondances {info['transfer_distance_limit_meters']} m,"
          f" P+R {info['parkride_distance_limit_meters']} m")
    print(f"règles de correspondance D-031 : {rules} {tr_params or ''} ; sortie {out_dir} ; cache {cache_home}")

    if not args.dry_run:
        avail = psutil.virtual_memory().available
        need = heap_bytes(args.max_memory) + args.min_free_gb * 1e9
        if avail < need:
            raise SystemExit(f"{avail / 1e9:.1f} Go disponibles < heap {args.max_memory} + seuil {args.min_free_gb} Go")

    # cache r5py séparé : à fixer AVANT tout import de r5py (Config().CACHE_DIR lit LOCALAPPDATA puis XDG_CACHE_HOME)
    cache_home.mkdir(parents=True, exist_ok=True)
    os.environ["XDG_CACHE_HOME"] = str(cache_home)
    if "LOCALAPPDATA" in os.environ:
        os.environ["LOCALAPPDATA"] = str(cache_home)

    m04 = load_04()
    if args.poles is not None:
        m04.POLES_FILE = absolute(args.poles)
    m04.OUT_DIR = out_dir
    m04.BATCH_DIR = out_dir / "batches"
    m04.ACCESS_DIR = access_dir
    base_params = m04.run_params

    def run_params(a: argparse.Namespace, o: list[str], points_sha: str | None = None) -> dict:
        return {**base_params(a, o, points_sha), "run": "04e_walk_setting", **info,
                "walk_setting": args.setting, "walk_setting_nature": "choix de l'équipe (D-024), pas une donnée",
                "walk_leg_limit_m": limit_m, "max_time_walking_min": walk_min,
                "walk_limit_rule": "sortie : WALK_DISTANCE_LIMIT_METERS du jar ; accès : max_time_walking = "
                                   "distance / SPEED_WALKING_KMH, arrondi à la minute supérieure", **tr_params}
    m04.run_params = run_params
    r5_transfers.configure(rules, m04.GTFS, absolute(args.same_stop_csv), out_dir / "transfer_rules_log.jsonl")

    from starway import routing
    routing.WALK_LEG_MAX_MIN = walk_min
    m04.configure_java = functools.partial(routing.configure_java, r5_classpath=jar)
    orig_load = routing.load_network

    def checked_load_network(osm, gtfs):
        """Vérifie dans la JVM, avant le long build du réseau, le jar et le cache réellement utilisés."""
        import r5py  # noqa: F401  (démarre la mécanique r5py : classpath, JVM à la demande)
        from r5py.util.classpath import R5_CLASSPATH
        from r5py.util.config import Config

        if Path(R5_CLASSPATH).resolve() != jar.resolve():
            raise SystemExit(f"r5py utilise {R5_CLASSPATH} au lieu de {jar}")
        if Path(Config().CACHE_DIR).resolve() != (cache_home / "r5py").resolve():
            raise SystemExit(f"cache r5py {Config().CACHE_DIR} au lieu de {cache_home / 'r5py'}")
        from com.conveyal.r5.transit import TransitLayer  # type: ignore[import-not-found]

        jvm_limit = int(TransitLayer.WALK_DISTANCE_LIMIT_METERS)
        if jvm_limit != limit_m:
            raise SystemExit(f"constante chargée dans la JVM : {jvm_limit} m, attendu {limit_m} m")
        print(f"JVM : WALK_DISTANCE_LIMIT_METERS = {jvm_limit} m ; max_time_walking {routing.WALK_LEG_MAX_MIN} min ;"
              f" cache r5py {Config().CACHE_DIR}")
        return orig_load(osm, gtfs)
    routing.load_network = checked_load_network

    base_watch = m04.MemoryWatch
    min_free = args.min_free_gb

    class GuardedWatch(base_watch):
        """MemoryWatch de 04 + arrêt propre sous le seuil de mémoire libre (lots déjà écrits conservés)."""

        def __init__(self) -> None:
            super().__init__()
            threading.Thread(target=self._guard, daemon=True).start()

        def _guard(self) -> None:
            while True:
                avail = psutil.virtual_memory().available
                if low_memory(avail, min_free):
                    entry = {"at": datetime.now(UTC).isoformat(timespec="seconds"),
                             "event": "stopped_low_memory", "available_gb": round(avail / 1e9, 2),
                             "min_free_gb": min_free, **self.snapshot()}
                    out_dir.mkdir(parents=True, exist_ok=True)
                    with (out_dir / "run_log.jsonl").open("a", encoding="utf-8") as f:
                        f.write(json.dumps(entry) + "\n")
                    print(f"ARRÊT : {entry}", flush=True)
                    os._exit(3)
                time.sleep(2)
    m04.MemoryWatch = GuardedWatch

    sys.argv = ["04_compute_matrix.py", "--origins", *args.origins, "--days", *args.days, "--modes", *args.modes,
                "--batch-size", str(args.batch_size), "--max-memory", args.max_memory]
    sys.argv += ["--fresh"] if args.fresh else []
    sys.argv += ["--dry-run"] if args.dry_run else []
    return m04.main()


if __name__ == "__main__":
    raise SystemExit(main())
