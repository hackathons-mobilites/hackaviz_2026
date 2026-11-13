"""07q - Recoupe avec Navitia (calculateur officiel d'IDFM, API PRIM) des trajets du 6h-14h recalculé avec le réseau de nuit (D-040).

CONTRÔLE seulement : rien d'affiché ne vient de Navitia, aucun chiffre d'écart n'est publié sans la validation de Nicolas.

Tirage déterministe (graine fixée, `starway.night_check`) de 10 trajets : 5 « gagnés » grâce aux courses de la veille codées
24:00 et plus (aller ou retour absent du calcul d'origine, possible aller ET retour dans le recalcul, budget 60 min) et 5 « inchangés »
(même durée aller et retour dans les deux calculs). Pour chacun, l'aller (arrivée à 6h, départ le plus tardif de la grille) et le
retour (départ à 14h, attente comprise) sont demandés à Navitia avec les réglages alignés sur le calcul (mêmes définitions que 07d et 07j).

Entrées : les matrices brutes du 6h-14h (`<dossier>/batches/transit_d06/batch_*.csv`) du calcul d'origine (`--old-matrix-dir`, ex.
matrix_walk3000_d031_b44) et du recalcul de nuit (`--new-matrix-dir`, ex. matrix_walk3000_d031_nuit_b44), rapatriées de la VM.

Règles PRIM : une requête par seconde au plus, tout en cache (data/interim/navitia_cache, partagé avec 07d), `--max-requests` au plus,
clé PRIM_API_KEY lue dans l'environnement ou un fichier .env (`--env-file`), jamais écrite ni affichée ; un seul agent PRIM à la fois :
le script prend le verrou `--lock` (créé en exclusif, retiré à la fin) et refuse de tourner s'il existe.

Sorties : data/processed/navitia_night_check.csv et navitia_night_check_summary.json.
Usage : python scripts/07q_navitia_night_check.py --old-matrix-dir ... --new-matrix-dir ... [--dry-run] [--offline] [--env-file ...]
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from starway import night_check as nc
from starway.config import (
    DAY_TYPES_BY_ID,
    FRONT_DATA_DIR,
    MAX_TRIP_MIN,
    OUTBOUND_LOOKBACK_MIN,
    OUTBOUND_STEP_MIN,
    PIPELINE_DIR,
    PROCESSED_DIR,
    REPO_ROOT,
    SERVICE_DATE,
    SPEED_WALKING_KMH,
    WALK_SETTINGS_M,
)
from starway.navitia import (
    Trip,
    aligned_settings,
    cache_key,
    coord,
    day_bounds,
    inbound_value,
    navitia_error,
    outbound_value,
    parse_journeys,
    request_params,
)
from starway.r5jar import walk_time_limit_min

DAY = "d06"
OUT_CSV = PROCESSED_DIR / "navitia_night_check.csv"
OUT_SUMMARY = PROCESSED_DIR / "navitia_night_check_summary.json"
DEFAULT_LOCK = REPO_ROOT.parent / ".prim.lock"


def load_07d():
    spec = importlib.util.spec_from_file_location("m07d", PIPELINE_DIR / "scripts" / "07d_navitia_crosscheck.py")
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules["m07d"] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def read_day(matrix_dir: Path, day: str = DAY, mode: str = "transit") -> pd.DataFrame:
    """Lots bruts d'une journée d'une matrice (04e) : from_id, to_id, out, ret, dep."""
    files = sorted((matrix_dir / "batches" / f"{mode}_{day}").glob("batch_*.csv"))
    if not files:
        raise SystemExit(f"{matrix_dir} : aucun lot {mode}_{day}")
    return pd.concat([pd.read_csv(f, dtype={"from_id": str, "to_id": str, "dep": str}) for f in files], ignore_index=True)


def load_env_key(env_file: Path | None) -> None:
    """Pose PRIM_API_KEY dans l'environnement DU PROCESSUS depuis un .env (jamais affichée, jamais écrite)."""
    if os.environ.get("PRIM_API_KEY") or env_file is None or not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("PRIM_API_KEY="):
            os.environ["PRIM_API_KEY"] = line.split("=", 1)[1].strip().strip('"').strip("'")


class Lock:
    """Verrou PRIM : fichier créé en exclusif, retiré à la sortie. Refuse si un autre agent le tient."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.held = False

    def __enter__(self) -> Lock:  # noqa: PYI034 (retourne bien l'instance ; `Self` demanderait typing_extensions)
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise SystemExit(f"verrou PRIM {self.path} tenu par un autre agent : ne pas passer outre") from None
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(f"copilot 07q {datetime.now(UTC).isoformat(timespec='seconds')}\n")
        self.held = True
        return self

    def __exit__(self, *_: object) -> None:
        if self.held:
            self.path.unlink(missing_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--old-matrix-dir", type=Path, required=True)
    ap.add_argument("--new-matrix-dir", type=Path, required=True)
    ap.add_argument("--walk-setting", default="normal", choices=list(WALK_SETTINGS_M))
    ap.add_argument("--n-gained", type=int, default=5)
    ap.add_argument("--n-kept", type=int, default=5)
    ap.add_argument("--budget", type=int, default=MAX_TRIP_MIN,
                    help="durée aller et retour au plus, en minutes (défaut : la durée maximale du calcul, 120 : mesuré sur "
                         "les matrices du 6h-14h, 1 seul trajet gagné tient dans 60 min, ils sont tous longs)")
    ap.add_argument("--seed", type=int, default=1105)
    ap.add_argument("--max-requests", type=int, default=60)
    ap.add_argument("--offline", action="store_true", help="cache seulement, aucune requête")
    ap.add_argument("--dry-run", action="store_true", help="affiche le tirage, aucune requête")
    ap.add_argument("--env-file", type=Path, default=None)
    ap.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    args = ap.parse_args()

    joined = nc.join_matrices(read_day(args.old_matrix_dir), read_day(args.new_matrix_dir))
    trips = nc.pick_trips(joined, args.n_gained, args.n_kept, args.seed, args.budget)
    print(f"{len(joined)} couples (origine, astre) ; tirage : "
          f"{sum(t.kind == 'gained' for t in trips)} gagnés, {sum(t.kind == 'kept' for t in trips)} inchangés")
    for t in trips:
        print(f"  {t.kind:6s} {t.insee} vers {t.pole_id} : aller {t.old_out} -> {t.new_out} (départ {t.new_dep}), "
              f"retour {t.old_ret} -> {t.new_ret}")
    if args.dry_run:
        return 0

    load_env_key(args.env_file)
    communes = {c["insee"]: c for c in json.loads((FRONT_DATA_DIR / "communes.json").read_text(encoding="utf-8"))}
    poles = {p["id"]: p for p in json.loads((FRONT_DATA_DIR / "poles.json").read_text(encoding="utf-8"))}
    lim = WALK_SETTINGS_M[args.walk_setting]
    settings = aligned_settings(SPEED_WALKING_KMH, MAX_TRIP_MIN, lim, 8, walk_time_limit_min(lim, SPEED_WALKING_KMH))
    dt = DAY_TYPES_BY_ID[DAY]
    start, end = day_bounds(SERVICE_DATE, dt.start, dt.end)
    m07d = load_07d()
    rows = []
    with Lock(args.lock):
        client = m07d.Client(args.offline, args.max_requests)
        for t in trips:
            c, p = communes[t.insee], poles[t.pole_id]
            here, there = coord(c["origin"]["lon"], c["origin"]["lat"]), coord(p["point"]["lon"], p["point"]["lat"])
            for leg, sw in (("out", t.new_out), ("ret", t.new_ret)):
                trip = Trip(t.insee, t.pole_id, DAY, leg)
                params = (request_params(here, there, start, "arrival", "out", settings) if leg == "out"
                          else request_params(there, here, end, "departure", "ret", settings))
                rec = client.get("night_" + cache_key(trip, params), "/journeys", params)
                row = {"insee": t.insee, "pole": t.pole_id, "kind": t.kind, "leg": leg, "starway_min": sw,
                       "starway_old_min": t.old_out if leg == "out" else t.old_ret, "starway_dep": t.new_dep if leg == "out" else None}
                if rec is None:
                    row.update({"navitia_min": None, "status": "not_requested", "reason": client.stopped})
                else:
                    err = navitia_error(rec.get("body"), rec.get("status_code"))
                    js = parse_journeys(rec["body"]) if rec.get("body") and not err else []
                    nv = (outbound_value(js, start, OUTBOUND_STEP_MIN, OUTBOUND_LOOKBACK_MIN, MAX_TRIP_MIN) if leg == "out"
                          else inbound_value(js, end, MAX_TRIP_MIN))
                    row.update({"navitia_min": nv.minutes, "status": "ok" if nv.minutes is not None else "navitia_none",
                                "reason": err or nv.reason,
                                "navitia_dep": nv.journey.departure.strftime("%H:%M") if nv.journey else None})
                rows.append(row)
    df = pd.DataFrame(rows)
    df["diff_min"] = df["starway_min"] - df["navitia_min"]
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_CSV, index=False, encoding="utf-8")
    summary = {"generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "service_date": SERVICE_DATE.isoformat(),
               "day": DAY, "walk_setting": args.walk_setting, "seed": args.seed, "budget_min": args.budget,
               "old_matrix_dir": args.old_matrix_dir.name, "new_matrix_dir": args.new_matrix_dir.name,
               "by_kind": nc.summarize(df), "requests_sent_this_run": client.sent,
               "x_ratelimit_remaining_day": client.remaining_day, "stopped": client.stopped,
               "note": "contrôle seulement : rien d'affiché ne vient de Navitia ; aucun chiffre d'écart publié sans validation"}
    OUT_SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(summary["by_kind"], ensure_ascii=False, indent=1))
    print(f"{client.sent} requêtes envoyées ; restant du jour : {client.remaining_day} ; écrit {OUT_CSV.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
