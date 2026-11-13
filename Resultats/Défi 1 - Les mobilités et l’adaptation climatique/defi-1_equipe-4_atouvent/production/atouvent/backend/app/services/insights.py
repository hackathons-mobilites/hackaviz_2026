"""Synthèses pour les décideurs, à partir des données collectées par AtouVent et de jeux ouverts complémentaires."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from . import http
from ..collectors.ascenseurs import night_stop
from .cache import aware, remember

PARIS = ZoneInfo("Europe/Paris")

DATA = Path(__file__).resolve().parents[2] / "data"


def traffic_history(db, days: int = 30) -> dict:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    by_line: dict[str, dict] = {}
    by_day: Counter = Counter()
    first = None
    for d in db.traffic_history.find({"day": {"$gte": since}}):
        first = min(first or d["day"], d["day"])
        key = f"{d.get('mode')}|{d.get('line')}"
        row = by_line.setdefault(key, {"line": d.get("line"), "mode": d.get("mode"), "line_id": d.get("line_id"),
                                       "incidents": 0, "hours": 0.0, "tags": Counter(), "blocking": 0})
        row["incidents"] += 1
        row["hours"] += max(0.0, (aware(d["last_seen"]) - aware(d["first_seen"])).total_seconds() / 3600)
        row["tags"].update(d.get("tags") or ["autre"])
        row["blocking"] += d.get("severity") == "BLOQUANTE"
        by_day[d["day"]] += 1
    lines = sorted(by_line.values(), key=lambda r: (-r["incidents"], -r["hours"]))
    for r in lines:
        r["hours"] = round(r["hours"], 1)
        r["tags"] = dict(r["tags"])
    return {"since": first, "days": sorted(by_day.items()), "lines": lines[:30]}


def elevator_downtime(db, days: int = 30) -> list[dict]:
    """Part du temps hors service par ascenseur, d'après les changements d'état collectés (temps pondéré)."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    events = defaultdict(list)
    for e in db.elevator_status.find({"ts": {"$gte": since}}, {"ts": 1, "meta": 1, "station": 1, "status": 1, "status_updated": 1}).sort("ts", 1):
        status = e.get("status")
        # Relevés enregistrés avant la règle « arrêt de nuit » : reconnus à la lecture (même règle que la collecte)
        if status == "hors_service" and night_stop(status, e.get("status_updated"), aware(e["ts"]).astimezone(PARIS)):
            status = "ferme_nuit"
        events[e["meta"]["elevator_id"]].append((aware(e["ts"]), status, e.get("station")))
    out = []
    for eid, ev in events.items():
        total = down = 0.0
        for k, (t, status, _) in enumerate(ev):
            end = ev[k + 1][0] if k + 1 < len(ev) else now
            span = (end - t).total_seconds()
            total += span
            down += span if status == "hors_service" else 0
        if total >= 3600:
            out.append({"elevator_id": eid, "station": ev[-1][2], "share": round(down / total, 3), "hours_down": round(down / 3600, 1),
                        "breakdowns": sum(1 for k, x in enumerate(ev) if x[1] == "hors_service" and (k == 0 or ev[k - 1][1] != "hors_service"))})
    return out


def elevator_reliability(db, days: int = 30) -> dict:
    """Par gare : pannes récentes (collecte AtouVent) et part historique hors service (Dispotrains 2013-2023)."""
    recent = defaultdict(lambda: {"elevators": 0, "down_hours": 0.0, "breakdowns": 0, "share_sum": 0.0})
    for e in elevator_downtime(db, days):
        r = recent[e["station"]]
        r["elevators"] += 1
        r["down_hours"] += e["hours_down"]
        r["breakdowns"] += e["breakdowns"]
        r["share_sum"] += e["share"]
    hist = {}
    info = DATA / "stop_info.json"
    meta = DATA / "router.json"
    if info.exists() and meta.exists():
        names = [s["name"] for s in json.loads(meta.read_text(encoding="utf-8"))["stops"]]
        for name, x in zip(names, json.loads(info.read_text(encoding="utf-8"))["stops"]):
            if "lift_downtime" in x:
                hist[name] = x["lift_downtime"]
    rows = [{"station": s, "elevators": r["elevators"], "share": round(r["share_sum"] / r["elevators"], 3),
             "down_hours": round(r["down_hours"], 1), "breakdowns": r["breakdowns"], "historic_share": hist.get(s)}
            for s, r in recent.items() if s]
    rows.sort(key=lambda r: (-r["share"], -r["down_hours"]))
    first = db.elevator_status.find_one({}, {"ts": 1}, sort=[("ts", 1)])
    since = max(aware(first["ts"]), datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat() if first else None
    return {"days": days, "since": since, "stations": rows[:25], "historic_worst": sorted(({"station": k, "share": v} for k, v in hist.items()),
                                                                         key=lambda r: -r["share"])[:10]}


def reports_stats(db, days: int = 7) -> dict:
    """Signalements (y compris expirés : on lit l'historique gardé dans reports_log)."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = list(db.reports_log.find({"created_at": {"$gte": since}}, {"_id": 0, "kind": 1, "line": 1, "stop": 1, "created_at": 1}))
    by_kind = Counter(r["kind"] for r in rows)
    by_line = Counter(r["line"] for r in rows if r.get("line"))
    by_stop = Counter(r["stop"] for r in rows if r.get("stop"))
    return {"days": days, "total": len(rows), "by_kind": by_kind.most_common(), "by_line": by_line.most_common(10),
            "by_stop": by_stop.most_common(10)}


SNCF_PMR = "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/accompagnement-pmr-gares/records"


def pmr_assistance(db, client: httpx.Client | None = None) -> dict:
    """Demandes d'assistance SNCF (Accès Plus) sur les 12 derniers mois publiés, gares d'Île-de-France."""
    def compute():
        c = client or http.shared()
        last = c.get(SNCF_PMR, params={"select": "max(datemensuel) as m"}, timeout=20).json()["results"][0]["m"]
        last = last[:7]
        y, m = (int(x) for x in last.split("-"))
        start = f"{y - 1}-{m + 1:02d}" if m < 12 else f"{y}-01"
        r = c.get(SNCF_PMR, params={"select": "gare, uic, sum(total) as total, sum(fauteuil) + sum(rampe_fauteuil) as fauteuil",
                                    "where": f"datemensuel >= date'{start}-01'", "group_by": "gare, uic", "order_by": "total desc", "limit": 5000}, timeout=30)
        r.raise_for_status()
        return {"from": start, "to": last, "rows": r.json().get("results", [])}
    data = remember(db, "insights_cache", "pmr", timedelta(days=7), compute)
    # Gares d'Île-de-France : celles du référentiel AtouVent (gares.json)
    gares = DATA.parents[1] / "frontend" / "public" / "data" / "gares.json"
    # Seulement les gares ferroviaires (RER, Transilien) : évite les homonymes (station de métro « Rennes »…)
    idf = {g["name"].lower() for g in json.loads(gares.read_text(encoding="utf-8"))
           if any(line["mode"] in ("RapidTransit", "LocalTrain") for line in g["lines"])} if gares.exists() else set()
    rows = [r for r in data["rows"] if not idf or (r.get("gare") or "").lower() in idf]
    return {"from": data["from"], "to": data["to"], "stations": rows[:20], "total": sum(r["total"] or 0 for r in rows)}


PARIS_BIKE = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptage-velo-donnees-compteurs/records"


def bike_counts(db, client: httpx.Client | None = None) -> dict:
    """Passages vélo à Paris, total par jour sur les 5 dernières semaines (compteurs permanents, données de la veille)."""
    def compute():
        expr = "date_format(date, 'yyyy-MM-dd')"
        r = (client or http.shared()).get(PARIS_BIKE, params={
            "select": f"{expr} as jour, sum(sum_counts) as n", "timezone": "Europe/Paris",
            "where": f"date >= date'{(datetime.now() - timedelta(days=36)).date().isoformat()}'",
            "group_by": expr, "order_by": expr, "limit": 100}, timeout=30)
        r.raise_for_status()
        return [{"day": x.get(expr) or x.get(expr.replace(" ", "")), "n": int(x["n"] or 0)} for x in r.json().get("results", [])]
    days = remember(db, "insights_cache", "bike", timedelta(hours=6), compute)
    # Jours incomplets (compteurs pas encore remontés, panne de collecte) : écartés
    if days:
        med = sorted(d["n"] for d in days)[len(days) // 2]
        days = [d for d in days if d["day"] and d["n"] >= 0.3 * med]
    if not days:
        return {"days": [], "last": None}
    last = days[-1]
    wd = datetime.fromisoformat(last["day"]).weekday()
    same = [d["n"] for d in days[:-1] if datetime.fromisoformat(d["day"]).weekday() == wd]
    ref = sum(same) / len(same) if same else None
    return {"days": days, "last": last, "reference": round(ref) if ref else None,
            "change": round(100 * (last["n"] / ref - 1), 1) if ref else None}
