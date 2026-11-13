"""Historique de l'info trafic : chaque perturbation ferrée vue est gardée (une fois par jour), avec ses étiquettes."""
from __future__ import annotations

from pymongo import UpdateOne

from ..services import traffic
from .common import run_logged, utcnow


def collect(db, client=None) -> dict:
    def job():
        now = utcnow()
        data = traffic.parse(traffic.fetch(client), now.astimezone(traffic.PARIS))
        day = now.astimezone(traffic.PARIS).date().isoformat()
        ops = [UpdateOne({"id": x["id"], "line_id": x["line_id"], "day": day},
                         {"$setOnInsert": {**x, "day": day, "first_seen": now}, "$set": {"last_seen": now}}, upsert=True)
               for x in data["items"]]
        if ops:
            db.traffic_history.bulk_write(ops)
        return {"n_fetched": len(data["items"]), "n_written": len(ops), "bus": data["bus"]}
    return run_logged(db, "traffic", job)
