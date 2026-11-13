"""Cache Mongo commun aux services qui interrogent une source externe (météo, crues, lieux, qualité de l'air…)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import httpx


def aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def remember(db, collection: str, key: str, ttl: timedelta, compute: Callable[[], Any], stale_ok: bool = True) -> Any:
    now = datetime.now(timezone.utc)
    coll = db[collection]
    doc = coll.find_one({"key": key})
    if doc and now - aware(doc["at"]) < ttl:
        return doc["data"]
    try:
        data = compute()
    except (httpx.HTTPError, ValueError, KeyError):
        if doc and stale_ok:
            return doc["data"]
        raise
    coll.update_one({"key": key}, {"$set": {"key": key, "data": data, "at": now}}, upsert=True)
    return data
