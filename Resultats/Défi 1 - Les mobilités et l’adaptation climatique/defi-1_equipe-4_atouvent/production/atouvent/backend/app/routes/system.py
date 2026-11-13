"""Santé du service et suivi de la collecte (un trou de collecte = donnée inconnue, jamais zéro)."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from ..core.config import settings
from ..deps import admin_dep, db_dep

router = APIRouter(tags=["système"])

# Fréquence attendue de chaque collecte (minutes) : au-delà de 3 fois, la source est « en retard »
EXPECTED = {"velib_status": settings.velib_every_min, "elevators": settings.elevators_every_min, "traffic": 5,
            "flood": 15, "rivers": 15, "velib_information": 24 * 60, "gtfs": 24 * 60}


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@router.get("/health")
def health():
    return {"ok": True, "time": datetime.now(timezone.utc)}


def collect_report(db, days: int, with_errors: bool = False) -> dict:
    days = max(1, min(days, 90))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out = {}
    for source, every in EXPECTED.items():
        runs = list(db.collection_runs.find({"source": source, "started_at": {"$gte": since}},
                                            {"started_at": 1, "ok": 1, "error": 1}).sort("started_at", 1))
        ok = [r["started_at"] for r in runs if r.get("ok")]
        gaps = [{"from": a, "to": b, "minutes": round((b - a).total_seconds() / 60)}
                for a, b in zip(ok, ok[1:]) if (b - a) > timedelta(minutes=3 * every)]
        if not runs:
            continue  # source pas encore lancée sur la période (ex. horaires, vérifiés la nuit)
        failed = next((r for r in reversed(runs) if not r.get("ok")), None)
        last_ok = ok[-1] if ok else None
        now = datetime.now(timezone.utc)
        late = last_ok is None or now - _aware(last_ok) > timedelta(minutes=3 * every)
        # État lisible : en échec (dernier passage raté), en retard (plus de relevé réussi depuis longtemps), à jour
        state = "failing" if not runs[-1].get("ok") else "late" if late else "ok"
        out[source] = {"runs": len(runs), "ok": len(ok), "failed": len(runs) - len(ok),
                       "success_rate": round(100 * len(ok) / len(runs), 1), "state": state,
                       "last_ok": last_ok, "last_run": runs[-1]["started_at"], "gaps": gaps,
                       "last_error_at": failed["started_at"] if failed else None,
                       # Erreur passée dont la source s'est remise depuis : « rétablie », pas un problème en cours
                       "recovered": bool(failed) and runs[-1].get("ok", False),
                       # Le détail technique de l'erreur est réservé aux admins (/admin/collect)
                       "last_error": (failed or {}).get("error") if with_errors else bool(failed)}
    return out


@router.get("/collect/status", dependencies=[Depends(admin_dep)])  # fonctionnement interne : admins seulement
def collect_status(days: int = Query(7, ge=1, le=90), db=Depends(db_dep)):
    return collect_report(db, days)
