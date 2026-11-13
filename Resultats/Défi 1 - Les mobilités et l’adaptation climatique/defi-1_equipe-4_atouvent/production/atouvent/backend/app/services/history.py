"""Reconstruction de séries régulières à partir de données stockées « au changement »."""
from __future__ import annotations

from bisect import bisect_left
from datetime import datetime, timedelta, timezone


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def covered(t: datetime, ok_runs: list[datetime], tolerance: timedelta) -> bool:
    """Vrai si un passage de collecte réussi a eu lieu dans la fenêtre [t - tolérance, t] (ok_runs trié)."""
    i = bisect_left(ok_runs, t - tolerance)
    return i < len(ok_runs) and ok_runs[i] <= t


def reconstruct(docs: list[dict], ok_runs: list[datetime], start: datetime, end: datetime,
                step: timedelta, field: str, tolerance: timedelta) -> list[dict]:
    if step <= timedelta(0):
        raise ValueError("step doit être positif")
    docs = sorted(({**d, "ts": _aware(d["ts"])} for d in docs), key=lambda d: d["ts"])
    runs = sorted(_aware(r) for r in ok_runs)
    out, i, current = [], 0, None
    t = _aware(start)
    while t <= _aware(end):
        while i < len(docs) and docs[i]["ts"] <= t:
            current = docs[i].get(field); i += 1
        out.append({"t": t, "value": current if covered(t, runs, tolerance) else None})
        t += step
    return out
