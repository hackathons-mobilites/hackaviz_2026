"""07d - Recoupement des temps de trajet TC de STARWAY avec Navitia (API PRIM d'IDFM).

CONTRÔLE seulement : aucune donnée affichée ne vient de Navitia, aucune durée STARWAY n'est corrigée. Lecture seule de
`frontend/public/data/` et de `frontend/public/tour/` ; ni r5py ni Java.

Échantillon (TC, déterministe) :
1. visite : tous les trajets (15 pôles x aller et retour) des scénarios TC joués par `tour.resolved.json`
   (constantes de `frontend/src/tour/tours/lea.tour.ts`, vérifiées ici) ;
2. découvertes (`insights.json`) et découvertes écartées parce que Navitia les contredit (`meta.insights.excluded`,
   cause `navitia_contradicted`, revérifiées à chaque lancement pour que l'écart reste fondé) : pour chaque
   découverte, le pôle qui pèse le plus dans son écart et les sens TC qui le décident (`starway.navitia.insight_trips`) ;
3. tirage aléatoire stratifié (graine `--seed`) de `--per-stratum` trajets par département x tranche de durée STARWAY
   (tranches dérivées de `meta.budgets` et `meta.max_trip_min`), parmi les trajets dont la durée est mesurée.

Requêtes : `GET https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys`, en-tête `apikey` lu dans
l'environnement (`PRIM_API_KEY`) ou dans `.env` à la racine ; la clé n'est jamais écrite ni affichée. Une requête par
seconde au plus, `--max-requests` au plus par lancement, arrêt au premier HTTP 429. Chaque réponse est mise en cache
dans `data/interim/navitia_cache/` (non versionné) : une relance ne refait que les requêtes manquantes.

Réglage de marche (D-024, `--walk-setting`, défaut = réglage publié dans `modes.transit`, « normal ») : les durées
STARWAY sont lues dans la série du réglage et les paramètres Navitia alignés dessus (accès <= max_time_walking, 50 min
en « normal » ; sortie <= distance du réglage / vitesse de marche, 3 000 s ; trajet tout à pied <= max_time_walking).

Sorties (suffixe `_walk{distance}`) : `data/processed/navitia_crosscheck_walk3000.csv` (un trajet par ligne),
`..._walk3000_summary.json` (dont `insight_checks`, lu par 06 pour écarter les découvertes contredites et publier le
statut `crosscheck` de chaque découverte) et `..._walk3000_diagnostics.csv` (diagnostic des plus gros écarts).
Historique : `navitia_crosscheck.csv` / `_summary.json` / `_diagnostics.csv` (sans suffixe) = recoupement du 03/11
13h17 UTC sur l'export d'avant D-024 (limite de marche de R5 d'origine : sortie 2 000 m, accès 120 min), non relancé.

Usage :
    python scripts/07d_navitia_crosscheck.py --dry-run     # plan de l'échantillon, aucune requête
    python scripts/07d_navitia_crosscheck.py               # requêtes manquantes + comparaison
    python scripts/07d_navitia_crosscheck.py --offline     # comparaison sur le cache seul
    python scripts/07d_navitia_crosscheck.py --groups tour,insight --no-diagnose --max-requests 150
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time as _time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from starway.config import (
    DAY_TYPES_BY_ID,
    FRONT_DATA_DIR,
    INTERIM_DIR,
    MAX_TRIP_MIN,
    OUTBOUND_LOOKBACK_MIN,
    OUTBOUND_STEP_MIN,
    PIPELINE_DIR,
    PROCESSED_DIR,
    REPO_ROOT,
    SERVICE_DATE,
    SKY_DEFAULT,
    SPEED_WALKING_KMH,
    WALK_SETTING_DEFAULT,
    WALK_SETTINGS_M,
    sky_front_dir,
)
from starway.gold import CommuneTransit
from starway.navitia import (
    Journey,
    LegCheck,
    Sample,
    Trip,
    aligned_settings,
    cache_key,
    compare_status,
    coord,
    day_bounds,
    describe_diffs,
    diff,
    duration_bins,
    inbound_value,
    insight_trips,
    insight_verdict,
    navitia_error,
    outbound_value,
    parse_journeys,
    pole_verdict,
    request_params,
    stratified_sample,
    tour_trips,
)
from starway.r5jar import walk_time_limit_min

BASE_URL = "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia"
CACHE_DIR = INTERIM_DIR / "navitia_cache"
GROUPS = ("tour", "insight", "random")
EXCLUDED_GROUP = "excluded"  # découvertes écartées (navitia_contradicted), revérifiées


def outputs(walk_setting: str, sky: str = "44") -> tuple[Path, Path, Path]:
    """(csv, résumé, diagnostics) du recoupement d'un réglage de marche D-024 (44 astres : suffixe `_b44`)."""
    stem = f"navitia_crosscheck_walk{WALK_SETTINGS_M[walk_setting]}_b44"
    return (PROCESSED_DIR / f"{stem}.csv", PROCESSED_DIR / f"{stem}_summary.json",
            PROCESSED_DIR / f"{stem}_diagnostics.csv")


TOUR_RESOLVED = REPO_ROOT / "frontend" / "public" / "tour" / "lea" / "tour.resolved.json"
TOUR_SOURCE = REPO_ROOT / "frontend" / "src" / "tour" / "tours" / "lea.tour.ts"
MIN_INTERVAL_S = 1.0  # au plus une requête par seconde (consigne de l'équipe, sous le quota PRIM par défaut de 5/s)
R5_MAX_PUBLIC_TRANSPORT_RIDES = 8  # défaut r5py conservé par la matrice (docs/methodologie.md § 3)
DEFAULT_SEED = 20261117  # graine du tirage : la date de service, pour la mémoriser (aucun effet sur les durées)
DEFAULT_PER_STRATUM = 6
DEFAULT_MAX_REQUESTS = 500
DIAG_GAP_MIN = 5  # seuil du résumé demandé par l'équipe (« part à +/-5 min ») ; au-delà, diagnostic à l'aller


# --------------------------------------------------------------------------- données STARWAY (lecture seule)

def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


class Starway:
    def __init__(self, walk_setting: str = WALK_SETTING_DEFAULT, sky: str = SKY_DEFAULT) -> None:
        # série TC du réglage : modes.transit pour le défaut, variants.{id}.transit sinon (contrat access, D-024)
        self.variant = None if walk_setting == WALK_SETTING_DEFAULT else walk_setting
        self.sky = sky  # 44 astres (racine ; seul ciel depuis D-054)
        self.front = sky_front_dir(sky)
        self.meta = load_json(self.front / "meta.json")
        self.poles = load_json(self.front / "poles.json")
        self.communes = {c["insee"]: c for c in load_json(FRONT_DATA_DIR / "communes.json")}
        self.pole_ids = [p["id"] for p in self.poles]
        self.pole_by_id = {p["id"]: p for p in self.poles}
        self.jobs = [int(p["jobs"]) for p in self.poles]
        self._access: dict[str, dict] = {}
        table = CommuneTransit.from_front(self.front)  # part TC commune par commune de la règle de l'or (D-056)
        self.commune_parts = table.parts if table is not None else None
        if self.meta["service_date"] != SERVICE_DATE.isoformat():
            sys.exit(f"meta.service_date {self.meta['service_date']} != SERVICE_DATE {SERVICE_DATE}")

    def access(self, insee: str) -> dict | None:
        if insee not in self._access:
            p = self.front / "access" / f"{insee}.json"
            self._access[insee] = load_json(p) if p.exists() else None
        return self._access[insee]

    def series(self, insee: str, mode: str, day: str) -> dict | None:
        a = self.access(insee) or {}
        modes = a.get("modes", {})
        if mode == "transit" and self.variant:
            modes = (a.get("variants") or {}).get(self.variant) or {}
        return (modes.get(mode) or {}).get(day)

    def value(self, trip: Trip) -> tuple[int | None, str | None, str | None]:
        """(durée, raison publiée si elle décrit ce sens, départ aller « HH:MM »)."""
        s = self.series(trip.insee, "transit", trip.day)
        if s is None:
            return None, "not_published", None
        i = self.pole_ids.index(trip.pole_id)
        v = s[trip.leg][i]
        reason = None
        if v is None:
            r = s["reason"][i]
            # La raison publiée décrit le premier sens nul (contrat access) : l'aller s'il est nul.
            reason = r if (trip.leg == "out" or s["out"][i] is not None) else f"{r} (raison publiée pour l'aller)"
        dep = s.get("dep", [None] * len(self.pole_ids))[i] if trip.leg == "out" else None
        return v, reason, dep


# --------------------------------------------------------------------------- échantillon

def tour_scenarios(sw: Starway) -> list[tuple[str, str]]:
    """Scénarios TC (commune, journée) joués par la visite, depuis lea.tour.ts, contrôlés contre tour.resolved.json."""
    src = TOUR_SOURCE.read_text(encoding="utf-8")

    def const(name: str) -> str:
        m = re.search(rf"const {name}(?::[^=]+)? = '([^']+)'", src)
        if not m:
            sys.exit(f"constante {name} introuvable dans {TOUR_SOURCE}")
        return m.group(1)

    lea, horizon_b, eclipse_day = const("LEA_ORIGIN"), const("HORIZON_B"), const("ECLIPSE_DAY")
    m = re.search(r"state: \{ origin: LEA_ORIGIN, day: '(d\d\d)'", src)
    if not m:
        sys.exit("journée du prologue introuvable dans lea.tour.ts")
    first_day = m.group(1)
    steps = {s["id"] for s in load_json(TOUR_RESOLVED)["steps"]}
    scen = [(lea, first_day), (lea, eclipse_day)]
    if "acte3-horizons" in steps:
        # acte 3 joué : la voisine. Depuis le script v3.3 (03/11), l'acte 3 se joue avant l'éclipse, donc dans la
        # journée du prologue ; la journée de l'éclipse, recoupée le 03/11, est gardée (comparaison 14h-22h).
        scen += [(horizon_b, first_day), (horizon_b, eclipse_day)]
    for insee, _ in scen:
        if insee not in sw.communes:
            sys.exit(f"commune de la visite inconnue : {insee}")
    return scen


def build_sample(sw: Starway, per_stratum: int, seed: int,
                 groups: tuple[str, ...] = GROUPS, origins: set[str] | None = None) -> tuple[Sample, dict[str, Any]]:
    sample = Sample()
    info: dict[str, Any] = {"groups": list(groups)}
    # 44 astres (D-054) : la visite joue la table commune x commune, recoupée par tools/prim/recoupement_6h14_visite_06_11.py ;
    # les découvertes sont recoupées ici, premier niveau de preuve : pour chacune, l'astre qui pèse le plus dans son écart,
    # lu dans access/ (trajet vers l'arrêt de l'astre). Une découverte contredite est revue sur la table commune x commune,
    # sa base réelle, avant toute décision (décision du 10/11).
    scen: list[tuple[str, str]] = []
    info["tour_scenarios"] = [{"insee": o, "day": d} for o, d in scen]
    if "tour" in groups:
        for t in tour_trips(scen, sw.pole_ids):
            sample.add(t, "tour")

    insights = load_json(sw.front / "insights.json") if "insight" in groups else []
    excluded = [e for e in (sw.meta.get("insights", {}).get("excluded") or []) if isinstance(e, dict)]
    # écartées par Navitia : revérifiées (libellé « excluded:<would_be_id> », l'id publié a pu être réattribué)
    rechecked = ([{"id": e["would_be_id"], "kind": e["kind"], "scenario": e["scenario"]} for e in excluded
                  if e.get("cause") == "navitia_contradicted"] if "insight" in groups else [])
    skipped = {}
    plan = {}
    for label, ins, published in ([(x["id"], x, True) for x in insights]
                                  + [(f"{EXCLUDED_GROUP}:{x['id']}", x, False) for x in rechecked]):
        trips, why = insight_trips(ins, sw.series, sw.pole_ids, sw.jobs, sw.commune_parts)
        if why:
            skipped[label] = why
        plan[label] = {"id": ins["id"], "published": published, "kind": ins["kind"], "scenario": ins["scenario"],
                       "budget": int(ins["scenario"]["b"]),
                       "trips": [[t.insee, t.pole_id, t.day, t.leg] for t in trips]}
        for t in trips:
            sample.add(t, f"insight:{label}" if published else label)
    info["insights_used"] = len(insights) - len([k for k in skipped if not k.startswith(EXCLUDED_GROUP)])
    info["excluded_rechecked"] = len(rechecked)
    info["insight_plan"] = plan
    info["insights_skipped"] = skipped
    info["insights_excluded_by_meta"] = sorted(e.get("would_be_id") for e in excluded if e.get("would_be_id"))

    if "random" not in groups:
        info["random"] = None
        return sample, info
    bins = duration_bins(sw.meta["budgets"], sw.meta["max_trip_min"])
    cands = []
    for insee in sorted(sw.communes):
        if origins is not None and insee not in origins:  # --origins-file : tirage restreint à ces communes
            continue
        dep = sw.communes[insee]["dep"]
        for day in DAY_TYPES_BY_ID:
            s = sw.series(insee, "transit", day)
            if s is None:
                continue
            for i, pid in enumerate(sw.pole_ids):
                for leg in ("out", "ret"):
                    v = s[leg][i]
                    if v is not None:
                        cands.append((Trip(insee, pid, day, leg), dep, int(v)))
    picked, sizes = stratified_sample(cands, bins, per_stratum, seed)
    for t, stratum in picked:
        sample.add(t, "random", stratum)
    info["random"] = {"seed": seed, "per_stratum": per_stratum, "bins": [b[0] for b in bins],
                      "population": len(cands), "strata_sizes": sizes, "drawn": len(picked)}
    return sample, info


# --------------------------------------------------------------------------- Navitia (réseau + cache)

def api_key() -> str:
    key = os.environ.get("PRIM_API_KEY")
    env = REPO_ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("PRIM_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        sys.exit("PRIM_API_KEY absente (environnement ou .env à la racine)")
    return key


class Client:
    def __init__(self, offline: bool, max_requests: int) -> None:
        self.offline = offline
        self.max_requests = max_requests
        self.sent = 0
        self.last = 0.0
        self.stopped: str | None = None
        self.remaining_day: str | None = None
        self._key = None if offline else api_key()
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def get(self, name: str, path: str, params: dict[str, str] | None) -> dict | None:
        """Réponse en cache, sinon requête (si permise). Rend {status_code, body, fetched_at, params} ou None."""
        f = CACHE_DIR / f"{name}.json"
        if f.exists():
            return load_json(f)
        if self.offline or self.stopped:
            return None
        if self.sent >= self.max_requests:
            self.stopped = f"max_requests ({self.max_requests}) atteint"
            return None
        wait = MIN_INTERVAL_S - (_time.monotonic() - self.last)
        if wait > 0:
            _time.sleep(wait)
        for attempt in range(3):
            self.last = _time.monotonic()
            self.sent += 1
            try:
                r = requests.get(BASE_URL + path, params=params, headers={"apikey": self._key}, timeout=90)
            except requests.RequestException as e:
                if attempt == 2:
                    return {"status_code": None, "body": None, "error": type(e).__name__, "params": params}
                _time.sleep(5)
                continue
            self.remaining_day = r.headers.get("x-ratelimit-remaining-day", self.remaining_day)
            if r.status_code == 429:
                self.stopped = "HTTP 429 (quota PRIM atteint)"
                return None
            if r.status_code >= 500 and attempt < 2:
                _time.sleep(5)
                continue
            text = r.text.replace(self._key, "***") if self._key else r.text
            try:
                body = json.loads(text)
            except ValueError:
                body = None
            rec = {"status_code": r.status_code, "fetched_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "params": params, "body": body}
            if r.status_code < 500:
                f.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            return rec
        return None


# --------------------------------------------------------------------------- comparaison

def journey_cols(j: Journey | None) -> dict[str, Any]:
    if j is None:
        return {"nav_departure": None, "nav_arrival": None, "nav_transfers": None, "nav_walking_min": None,
                "nav_waiting_min": None, "nav_lines": None, "nav_stops": None}
    return {"nav_departure": j.departure.strftime("%H:%M:%S"), "nav_arrival": j.arrival.strftime("%H:%M:%S"),
            "nav_transfers": j.nb_transfers, "nav_walking_min": round(j.walking_s / 60, 1),
            "nav_waiting_min": round(j.waiting_s / 60, 1), "nav_lines": " > ".join(j.lines) or "marche seule",
            "nav_stops": " > ".join(j.stops)}


def run(args: argparse.Namespace) -> int:
    groups = tuple(g for g in GROUPS if g in args.groups.split(","))
    # 44 astres : tirage aléatoire et découvertes (décision du 10/11) ; la visite se recoupe commune à commune par
    # tools/prim/recoupement_6h14_visite_06_11.py (voir build_sample)
    groups = tuple(g for g in groups if g in ("random", "insight"))
    sw = Starway(args.walk_setting, args.astres)
    out_csv, out_summary, out_diag = outputs(args.walk_setting, args.astres)
    origins = None
    if args.origins_file is not None:
        origins = set(args.origins_file.read_text(encoding="utf-8").split())
        tag = f"_{args.origins_file.stem}"  # sorties à part : le tirage général n'est jamais écrasé
        out_csv, out_summary, out_diag = (p_.with_name(p_.stem + tag + p_.suffix) for p_ in (out_csv, out_summary, out_diag))
    sample, info = build_sample(sw, args.per_stratum, args.seed, groups, origins)
    trips = sample.trips()
    n_groups = {g: sum(1 for t in trips if any(x == g or x.startswith(g + ":") for x in sample.groups[t]))
                for g in (*GROUPS, EXCLUDED_GROUP)}
    rnd = info["random"]
    print(f"Réglage de marche : {args.walk_setting} ; échantillon : {len(trips)} trajets uniques ; visite "
          f"{n_groups['tour']}, découvertes {n_groups['insight']}, écartées revérifiées {n_groups[EXCLUDED_GROUP]}, "
          f"tirage {n_groups['random']}"
          + (f" (graine {args.seed}, {args.per_stratum} par strate, {len(rnd['strata_sizes'])} strates)" if rnd else ""))
    if info["insights_skipped"]:
        print("Découvertes sans trajet TC à recouper :", info["insights_skipped"])
    if args.dry_run:
        return 0

    lim = WALK_SETTINGS_M[args.walk_setting]
    access_min = walk_time_limit_min(lim, SPEED_WALKING_KMH)
    settings = aligned_settings(SPEED_WALKING_KMH, MAX_TRIP_MIN, lim, R5_MAX_PUBLIC_TRANSPORT_RIDES, access_min)
    client = Client(args.offline, args.max_requests)
    cov = client.get("coverage", "/", None)
    coverage = None
    if cov and cov.get("body"):
        reg = (cov["body"].get("regions") or [{}])[0]
        coverage = {k: reg.get(k) for k in ("id", "start_production_date", "end_production_date", "last_load_at")}
        coverage["fetched_at"] = cov.get("fetched_at")
        d = SERVICE_DATE.strftime("%Y%m%d")
        if not (coverage["start_production_date"] <= d <= coverage["end_production_date"]):
            sys.exit(f"Navitia ne couvre pas la date de service {d} : {coverage} ; choisir un autre mardi et le documenter")

    rows = []
    for k, t in enumerate(trips, 1):
        dt = DAY_TYPES_BY_ID[t.day]
        start, end = day_bounds(SERVICE_DATE, dt.start, dt.end)
        c, p = sw.communes[t.insee], sw.pole_by_id[t.pole_id]
        here, there = coord(c["origin"]["lon"], c["origin"]["lat"]), coord(p["point"]["lon"], p["point"]["lat"])
        if t.leg == "out":
            params = request_params(here, there, start, "arrival", "out", settings)
        else:
            params = request_params(there, here, end, "departure", "ret", settings)
        name = cache_key(t, params)
        rec = client.get(name, "/journeys", params)
        sw_min, sw_reason, sw_dep = sw.value(t)
        row: dict[str, Any] = {
            "insee": t.insee, "commune": c["name"], "dep": c["dep"], "pole_id": t.pole_id, "pole": p["name"],
            "day": t.day, "leg": "aller" if t.leg == "out" else "retour", "samples": ";".join(sample.groups[t]),
            "stratum": sample.strata.get(t), "starway_min": sw_min, "starway_dep": sw_dep, "starway_reason": sw_reason,
        }
        if rec is None:
            row.update({"navitia_min": None, "navitia_native_min": None, "navitia_over_max_min": None,
                        "navitia_grid_dep": None,
                        "diff_min": None, "status": "not_requested",
                        "reason": client.stopped or ("hors cache (--offline)" if args.offline else "requête échouée")})
            row.update(journey_cols(None))
            rows.append(row)
            continue
        err = navitia_error(rec.get("body"), rec.get("status_code"))
        journeys = parse_journeys(rec["body"]) if rec.get("body") and not err else []
        if t.leg == "out":
            nv = outbound_value(journeys, start, OUTBOUND_STEP_MIN, OUTBOUND_LOOKBACK_MIN, MAX_TRIP_MIN)
        else:
            nv = inbound_value(journeys, end, MAX_TRIP_MIN)
        status = compare_status(sw_min, nv.minutes)
        reasons = [r for r in (sw_reason and f"STARWAY : {sw_reason}", err or (nv.reason and f"Navitia : {nv.reason}"))
                   if r and status != "both"]
        row.update({"navitia_min": nv.minutes, "navitia_native_min": nv.native_minutes,
                    "navitia_over_max_min": nv.uncapped_minutes,
                    "navitia_grid_dep": nv.grid_departure.strftime("%H:%M") if nv.grid_departure else None,
                    "diff_min": diff(sw_min, nv.minutes), "status": status, "reason": " ; ".join(reasons) or None})
        row.update(journey_cols(nv.journey))
        rows.append(row)
        if k % 25 == 0:
            print(f"  {k}/{len(trips)} trajets, {client.sent} requêtes envoyées")

    df = pd.DataFrame(rows)
    df = df.sort_values(["insee", "pole_id", "day", "leg"], kind="stable")
    for col in ("starway_min", "nav_transfers"):
        df[col] = df[col].astype("Int64")
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_csv, index=False, encoding="utf-8")
    diag = None if args.no_diagnose else diagnose(df, sw, client, settings)
    if diag is not None:
        diag.to_csv(out_diag, index=False, encoding="utf-8")
        print(f"Diagnostics : {out_diag} ({len(diag)} lignes)")

    summary = summarize(df, info, sample)
    summary["verdicts"] = verdicts(df, info, sw)
    summary["tour_counts"] = tour_counts(df, info, sw)
    summary["insight_checks"] = insight_checks(df, info, summary["verdicts"]["insights"])
    summary.update({
        "walk_setting": {"id": args.walk_setting, "leg_limit_m": lim, "max_time_walking_min": access_min},
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "service_date": SERVICE_DATE.isoformat(),
        "dataset_id": sw.meta.get("dataset_id"),
        "navitia_coverage": coverage,
        "navitia_settings": {"walking_speed_ms": settings.walking_speed_ms,
                             "max_walking_duration_to_pt_s": {"aller": settings.access_s,
                                                              "retour": settings.egress_limit_s},
                             "max_walking_direct_path_duration_s": settings.access_s,
                             "max_nb_transfers": settings.max_nb_transfers, "max_duration_s": settings.max_trip_s,
                             "data_freshness": "base_schedule", "min_nb_journeys": 3},
        "requests_sent_this_run": client.sent,
        "x_ratelimit_remaining_day": client.remaining_day,
        "stopped": client.stopped,
        "cache_files": len(list(CACHE_DIR.glob("*.json"))),
    })
    out_summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    update_manifest(coverage)
    print_summary(summary)
    print(f"Écrit : {out_csv} ({len(df)} lignes), {out_summary}")
    return 0


def insight_checks(df: pd.DataFrame, info: dict[str, Any], verdict_of: dict[str, str]) -> list[dict[str, Any]]:
    """Recoupement de chaque découverte, publiée ou écartée, avec ses trajets décisifs (lu par 06 : le verdict
    n'est repris que si les trajets et les durées STARWAY sont restés les mêmes, `starway.navitia.published_crosscheck`)."""
    leg_of = {"aller": "out", "retour": "ret"}
    val = {(r.insee, r.pole_id, r.day, leg_of[r.leg]): r for r in df.itertuples()}
    out = []
    for label, p in info["insight_plan"].items():
        trips = []
        for insee, pid, day, leg in p["trips"]:
            r = val.get((insee, pid, day, leg))
            trips.append({"insee": insee, "pole_id": pid, "day": day, "leg": leg,
                          "starway_min": None if r is None or pd.isna(r.starway_min) else int(r.starway_min),
                          "navitia_min": None if r is None or pd.isna(r.navitia_min) else float(r.navitia_min),
                          "status": None if r is None else r.status,
                          "nav_lines": None if r is None or pd.isna(r.nav_lines) else r.nav_lines})
        out.append({"label": label, "id": p["id"], "published": p["published"], "kind": p["kind"],
                    "scenario": p["scenario"], "budget": p["budget"], "verdict": verdict_of.get(label, "unknown"),
                    "trips": trips})
    return out


def diagnose(df: pd.DataFrame, sw: Starway, client: Client, settings) -> pd.DataFrame:
    """Requêtes de diagnostic (cache comme les autres), pour expliquer les écarts sans rien corriger.

    - `no_max_duration` : trajets sans réponse Navitia (erreur ou aucun trajet) : même requête sans `max_duration` ;
    - `depart_at_starway_dep` : allers dont l'écart dépasse 5 min (seuil du résumé « part à +/-5 min ») : Navitia,
      au départ de l'heure retenue par STARWAY (`dep`), arrive-t-il avant le début du poste, et en combien de temps ?
    """
    out = []
    one = df[df["status"].isin(["starway_only", "navitia_only"]) & df["nav_lines"].isna()]
    both = df[df["status"] == "both"]
    aller = both[(both["leg"] == "aller") & (both["diff_min"].abs() > DIAG_GAP_MIN)]
    for check, sub in (("no_max_duration", one), ("depart_at_starway_dep", aller)):
        for _, r in sub.iterrows():
            t = Trip(r["insee"], r["pole_id"], r["day"], "out" if r["leg"] == "aller" else "ret")
            dt = DAY_TYPES_BY_ID[t.day]
            start, end = day_bounds(SERVICE_DATE, dt.start, dt.end)
            c, p = sw.communes[t.insee], sw.pole_by_id[t.pole_id]
            here, there = coord(c["origin"]["lon"], c["origin"]["lat"]), coord(p["point"]["lon"], p["point"]["lat"])
            if check == "no_max_duration":
                params = (request_params(here, there, start, "arrival", "out", settings) if t.leg == "out"
                          else request_params(there, here, end, "departure", "ret", settings))
                params.pop("max_duration")
                when = start if t.leg == "out" else end
            else:
                h, m = (int(x) for x in str(r["starway_dep"]).split(":"))
                when = start.replace(hour=h, minute=m)
                params = request_params(here, there, when, "departure", "out", settings)
            rec = client.get(f"diag_{check}_{cache_key(t, params)}", "/journeys", params)
            err = navitia_error(rec.get("body"), rec.get("status_code")) if rec else "not_requested"
            js = parse_journeys(rec["body"]) if rec and rec.get("body") and not err else []
            if check == "no_max_duration":
                nv = (outbound_value(js, start, OUTBOUND_STEP_MIN, OUTBOUND_LOOKBACK_MIN, 24 * 60) if t.leg == "out"
                      else inbound_value(js, end, 24 * 60))
                res, j = nv.minutes, nv.journey
            else:
                ok = [x for x in js if x.departure >= when]
                j = min(ok, key=lambda x: x.arrival) if ok else None
                res = round((j.arrival - when).total_seconds() / 60, 2) if j else None
            row = {"check": check, "insee": t.insee, "commune": r["commune"], "pole_id": t.pole_id, "day": t.day,
                   "leg": r["leg"], "starway_min": r["starway_min"], "starway_dep": r["starway_dep"],
                   "navitia_min_in_crosscheck": r["navitia_min"], "query_datetime": when.strftime("%H:%M"),
                   "navitia_result_min": res, "error": err,
                   "arrives_before_start": (j.arrival <= start) if (j and check == "depart_at_starway_dep") else None}
            row.update(journey_cols(j))
            out.append(row)
    return pd.DataFrame(out)


def verdicts(df: pd.DataFrame, info: dict[str, Any], sw: Starway) -> dict[str, Any]:
    """Même verdict (allumé / éteint) avec les durées Navitia ? Visite : chaque pôle, aux budgets publiés ;
    découvertes : les sens qui décident de la découverte (`starway.navitia.insight_verdict`)."""
    leg_of = {"aller": "out", "retour": "ret"}
    val = {(r.insee, r.pole_id, r.day, leg_of[r.leg]): r for r in df.itertuples()}

    def check(insee: str, pid: str, day: str, leg: str) -> LegCheck | None:
        r = val.get((insee, pid, day, leg))
        if r is None or r.status == "not_requested":
            return None
        return LegCheck((insee, day), leg, None if pd.isna(r.starway_min) else int(r.starway_min),
                        None if pd.isna(r.navitia_min) else float(r.navitia_min))

    tour = {}
    for sc in (info["tour_scenarios"] if "tour" in info["groups"] else []):
        key = f"{sc['insee']}_{sc['day']}"
        tour[key] = {}
        for b in sorted(sw.meta["budgets"]):
            res: dict[str, list[str]] = {"different": [], "within_one_minute": [], "unknown": []}
            for pid in sw.pole_ids:
                o, r = check(sc["insee"], pid, sc["day"], "out"), check(sc["insee"], pid, sc["day"], "ret")
                v = "unknown" if o is None or r is None else pole_verdict(o, r, b)
                if v != "same":
                    res[v].append(pid)
            tour[key][str(b)] = {"poles": len(sw.pole_ids), **res}
    ins = {}
    for iid, p in info["insight_plan"].items():
        checks = [check(*t) for t in p["trips"]]
        ins[iid] = ("unknown" if not checks or any(c is None for c in checks)
                    else insight_verdict(p["kind"], p["budget"], checks))
    counts = pd.Series(list(ins.values())).value_counts().to_dict()
    return {"tour": tour, "insights": ins, "insights_counts": {k: int(v) for k, v in counts.items()}}


def tour_counts(df: pd.DataFrame, info: dict[str, Any], sw: Starway) -> dict[str, Any]:
    """Pour chaque scénario TC de la visite (les 15 pôles recoupés, aller et retour) et chaque budget publié : pôles
    allumés et postes avec les durées STARWAY, puis avec les durées Navitia (calculateur officiel ; un sens sans durée
    Navitia en 120 min est éteint). Sert aux phrases de la visite (docs/a-faire.md, section visite) ; rien n'est
    publié. `within_one_minute` : pôles dont l'état Navitia dépend de l'arrondi à la minute."""
    leg_of = {"aller": "out", "retour": "ret"}
    val = {(r.insee, r.pole_id, r.day, leg_of[r.leg]): r for r in df.itertuples()}
    jobs = dict(zip(sw.pole_ids, sw.jobs, strict=True))
    out: dict[str, Any] = {}
    for sc in (info["tour_scenarios"] if "tour" in info["groups"] else []):
        key = f"{sc['insee']}_{sc['day']}"
        out[key] = {}
        for b in sorted(sw.meta["budgets"]):
            s_lit, n_lit, near, missing = [], [], [], []
            for pid in sw.pole_ids:
                o, r = val.get((sc["insee"], pid, sc["day"], "out")), val.get((sc["insee"], pid, sc["day"], "ret"))
                if o is None or r is None or "not_requested" in (o.status, r.status):
                    missing.append(pid)
                    continue
                so, sr = (None if pd.isna(x) else int(x) for x in (o.starway_min, r.starway_min))
                no, nr = (None if pd.isna(x) else float(x) for x in (o.navitia_min, r.navitia_min))
                if so is not None and sr is not None and so <= b and sr <= b:
                    s_lit.append(pid)
                if no is not None and nr is not None and no <= b and nr <= b:
                    n_lit.append(pid)
                fl = [None if v is None else math.floor(v) for v in (no, nr)]
                ce = [None if v is None else math.ceil(v) for v in (no, nr)]
                if all(v is not None and v <= b for v in fl) != all(v is not None and v <= b for v in ce):
                    near.append(pid)
            out[key][str(b)] = {
                "starway": {"poles": s_lit, "stars": len(s_lit), "jobs": sum(jobs[p] for p in s_lit)},
                "navitia": {"poles": n_lit, "stars": len(n_lit), "jobs": sum(jobs[p] for p in n_lit)},
                "only_starway": [p for p in s_lit if p not in n_lit], "only_navitia": [p for p in n_lit if p not in s_lit],
                "within_one_minute": near, "not_checked": missing}
    return out


def summarize(df: pd.DataFrame, info: dict[str, Any], sample: Sample) -> dict[str, Any]:
    both = df[df["status"] == "both"]
    res: dict[str, Any] = {"sample": info, "trips": len(df),
                           "status_counts": {k: int(v) for k, v in df["status"].value_counts().items()}}
    res["all"] = describe_diffs(list(both["diff_min"]))
    res["by_leg"] = {leg: describe_diffs(list(both.loc[both["leg"] == leg, "diff_min"])) for leg in ("aller", "retour")}
    groups = {}
    for g in (*GROUPS, EXCLUDED_GROUP):
        mask = both["samples"].str.split(";").apply(lambda xs, g=g: any(x == g or x.startswith(g + ":") for x in xs))
        sub = both[mask]
        weights = None
        if g == "random" and info["random"]:
            sizes = info["random"]["strata_sizes"]
            drawn = df["stratum"].value_counts().to_dict()
            weights = [sizes[s] / drawn[s] for s in sub["stratum"]]
        groups[g] = describe_diffs(list(sub["diff_min"]), weights)
        gm = df["samples"].str.split(";").apply(lambda xs, g=g: any(x == g or x.startswith(g + ":") for x in xs))
        groups[g]["status_counts"] = {k: int(v) for k, v in df.loc[gm, "status"].value_counts().items()}
    res["by_group"] = groups
    # Aller : effet de la définition (durée propre de Navitia, sans l'attente de la grille de 5 min)
    out = both[both["leg"] == "aller"]
    res["aller_native"] = describe_diffs(list((out["starway_min"] - out["navitia_native_min"]).round(2)))
    top = both.reindex(both["diff_min"].abs().sort_values(ascending=False).index).head(10)
    res["largest_gaps"] = json.loads(top.to_json(orient="records", force_ascii=False))
    one_side = df[df["status"].isin(["starway_only", "navitia_only"])]
    res["one_side"] = json.loads(one_side.to_json(orient="records", force_ascii=False))
    return res


def print_summary(s: dict[str, Any]) -> None:
    print("Statuts :", s["status_counts"])
    for name, d in [("tous", s["all"]), ("aller", s["by_leg"]["aller"]), ("retour", s["by_leg"]["retour"]),
                    *[(f"groupe {g}", v) for g, v in s["by_group"].items()],
                    ("aller, durée propre Navitia", s["aller_native"])]:
        if d.get("n"):
            print(f"  {name:30s} n={d['n']:4d}  médiane signée {d['median_signed_min']:+.1f}  "
                  f"médiane |écart| {d['median_abs_min']:.1f}  P90 {d['p90_abs_min']:.1f}  "
                  f"<=5 min {100 * d['share_within_5_min']:.0f} %")
    v = s.get("verdicts", {})
    for k, by_b in v.get("tour", {}).items():
        print(f"  visite {k} : pôles au verdict différent (à une minute près) par budget",
              {b: (x["different"], x["within_one_minute"]) for b, x in by_b.items()})
    print("  découvertes :", v.get("insights_counts"))
    print(f"Requêtes envoyées : {s['requests_sent_this_run']} ; restant du jour (PRIM) : {s['x_ratelimit_remaining_day']}"
          + (f" ; arrêt : {s['stopped']}" if s["stopped"] else ""))


def cache_digest() -> tuple[int, str]:
    """Empreinte du cache : sha256 de la liste triée « nom sha256 » des réponses (un fichier par requête)."""
    import hashlib

    lines = []
    for f in sorted(CACHE_DIR.glob("*.json")):
        lines.append(f"{f.name} {hashlib.sha256(f.read_bytes()).hexdigest()}")
    return len(lines), hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def last_fetch() -> str:
    """Date de la requête la plus récente du cache (idempotent : une relance --offline ne la change pas)."""
    dates = [load_json(f).get("fetched_at") or "" for f in CACHE_DIR.glob("*.json")]
    last = max(dates, default="")
    return last[:16] + "Z" if last else ""


def update_manifest(coverage: dict | None) -> None:
    """Ligne TRA02 du manifest (réponses Navitia en cache, non versionnées), mise à jour à chaque lancement."""
    from starway.sources import read_manifest, write_manifest

    n, digest = cache_digest()
    rel = CACHE_DIR.relative_to(REPO_ROOT).as_posix() + "/"
    rows = [r for r in read_manifest() if not (r["source_id"] == "TRA02" and r["fichier_local"] == rel)]
    cov = coverage or {}
    rows.append({
        "source_id": "TRA02",
        "titre": "IDFM Navitia (API PRIM « IDFM Navitia », requêtes journeys) - contrôle des temps de trajet TC",
        "url_source": BASE_URL + "/journeys",
        "date_extraction": last_fetch(),
        "millesime": f"données Navitia chargées le {cov.get('last_load_at', '?')} (période de production "
                     f"{cov.get('start_production_date', '?')}-{cov.get('end_production_date', '?')})",
        "date_service_transport": SERVICE_DATE.isoformat(),
        "licence": "CGU PRIM (juillet 2022) ; données sous Licence Mobilités (page de l'API PRIM vérifiée le 03/11/2026)",
        "granularite": "trajet (point origine - point destination, horaire)",
        "geographie": "Île-de-France",
        "fichier_local": rel,
        "sha256": digest,
        # textes publics (sources.json) : ni nom de script, ni renvoi de décision, ni chemin (audit du 10/11, C1)
        "traitements": f"{n} réponses JSON en cache (une par requête, clé API jamais écrite) ; sha256 = empreinte de la "
                       "liste triée « nom sha256 » des fichiers ; comparaison par le contrôle Navitia du pipeline (réglage "
                       "de marche publié et, historique, réglage R5 d'origine), sonde de la limite d'accès, "
                       "durées de correspondance (API connections) par le pipeline, tirage stratifié par "
                       "statut de correspondance par le pipeline",
        "controles": "date de service dans la période de production Navitia (bloquant) ; réponses en erreur conservées",
        "limites": "contrôle seulement, rien d'affiché n'en vient, sauf le statut de recoupement des découvertes "
                   "(confirmée, à une minute près, ou écartée si contredite) ; quota PRIM par défaut 5 requêtes/s et "
                   "1 000/jour ; horaires théoriques (base_schedule) ; voir la méthodologie",
    })
    rows[-1] = public_texts(rows[-1])
    write_manifest(rows, keep_order=True)  # l'ordre du manifeste ne change pas (sources de tolls.json)


def public_texts(row: dict[str, str]) -> dict[str, str]:
    """Applique à une ligne du manifeste le nettoyage des textes publics de 06y (mêmes règles, mêmes colonnes) et refuse
    d'écrire s'il reste un motif interne : la ligne TRA02 ne réintroduit plus de jargon après 06y (audit du 10/11, C1)."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("m06y", PIPELINE_DIR / "scripts" / "06y_textes_publics_manifeste.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    out = {k: (mod.clean(v) if k in mod.COLS else v) for k, v in row.items()}
    left = [f"{k} : {m.group(0)}" for k in mod.COLS for m in mod.RESIDUE.finditer(out.get(k, ""))]
    if left:
        raise SystemExit(f"ligne {row['source_id']} du manifeste : motifs internes restants {left} (règle à ajouter à 06y)")
    return out


def gtfs_check(queries: list[str]) -> int:
    """Courses du GTFS STARWAY (TRA01, jour de service) qui desservent A puis B, départ de A dans [h1, h2].

    Requête « A|B|HH:MM|HH:MM » (noms d'arrêts exacts de stops.txt). Sert à expliquer un écart avec Navitia en
    vérifiant si un passage vu par Navitia existe dans nos horaires. stop_times.txt est lu par morceaux.
    """
    import zipfile

    from starway import flux
    from starway.gtfs import active_trip_ids

    gtfs = flux.gtfs_path("TRA01")
    qs = [q.split("|") for q in queries]
    trips = active_trip_ids(gtfs, SERVICE_DATE)
    with zipfile.ZipFile(gtfs) as z:
        stops = pd.read_csv(z.open("stops.txt"), dtype=str, usecols=["stop_id", "stop_name"])
        tr = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["trip_id", "route_id", "trip_headsign"])
        routes = pd.read_csv(z.open("routes.txt"), dtype=str, usecols=["route_id", "route_short_name"])
        names = {n for q in qs for n in q[:2]}
        ids = stops[stops["stop_name"].isin(names)]
        name_of = dict(zip(ids["stop_id"], ids["stop_name"], strict=True))
        parts = []
        with z.open("stop_times.txt") as f:
            cols = ["trip_id", "stop_id", "arrival_time", "departure_time", "stop_sequence"]
            for ch in pd.read_csv(f, dtype=str, usecols=cols, chunksize=2_000_000):
                parts.append(ch[ch["stop_id"].isin(name_of) & ch["trip_id"].isin(trips)])
    st = pd.concat(parts)
    st["name"] = st["stop_id"].map(name_of)
    st["seq"] = st["stop_sequence"].astype(int)
    tr = tr.merge(routes, on="route_id", how="left").set_index("trip_id")
    for a, b, h1, h2 in qs:
        sa, sb = st[st["name"] == a], st[st["name"] == b]
        m = sa.merge(sb, on="trip_id", suffixes=("_a", "_b"))
        m = m[(m["seq_a"] < m["seq_b"]) & (m["departure_time_a"] >= f"{h1}:00") & (m["departure_time_a"] <= f"{h2}:59")]
        print(f"== {a} -> {b}, départ entre {h1} et {h2} le {SERVICE_DATE} (GTFS STARWAY)")
        for _, r in m.sort_values("departure_time_a").iterrows():
            info = tr.loc[r["trip_id"]]
            print(f"   {r['departure_time_a']} -> {r['arrival_time_b']}  ligne {info['route_short_name']}  "
                  f"vers {info['trip_headsign']}  ({r['trip_id']})")
        if m.empty:
            print("   aucune course")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--origins-file", type=Path, default=None,
                    help="codes INSEE (séparés par des blancs) : tirage restreint à ces communes, sorties suffixées du nom du fichier")
    ap.add_argument("--per-stratum", type=int, default=DEFAULT_PER_STRATUM)
    ap.add_argument("--max-requests", type=int, default=DEFAULT_MAX_REQUESTS)
    ap.add_argument("--walk-setting", choices=list(WALK_SETTINGS_M), default=WALK_SETTING_DEFAULT,
                    help="réglage de marche D-024 recoupé (défaut : celui publié dans modes.transit)")
    ap.add_argument("--astres", choices=["44"], default=SKY_DEFAULT,
                    help="ciel des pôles recoupé : 44 astres (racine ; seul le tirage aléatoire s'applique ; seul ciel depuis D-054)")
    ap.add_argument("--groups", default=",".join(GROUPS),
                    help="groupes de l'échantillon, séparés par des virgules (tour, insight, random)")
    ap.add_argument("--no-diagnose", action="store_true", help="pas de requêtes de diagnostic")
    ap.add_argument("--offline", action="store_true", help="cache seul, aucune requête")
    ap.add_argument("--dry-run", action="store_true", help="plan de l'échantillon seulement")
    ap.add_argument("--gtfs-check", nargs="+", metavar="A|B|HH:MM|HH:MM",
                    help="courses du GTFS STARWAY de A vers B (aucune requête Navitia)")
    args = ap.parse_args()
    return gtfs_check(args.gtfs_check) if args.gtfs_check else run(args)


if __name__ == "__main__":
    raise SystemExit(main())
