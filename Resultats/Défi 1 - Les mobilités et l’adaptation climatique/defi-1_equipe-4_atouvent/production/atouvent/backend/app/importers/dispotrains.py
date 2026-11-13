"""Import de l'historique public des ascenseurs (Dispotrains, 2013 à 2018, data.gouv.fr).
python -m app.importers.dispotrains fichier.csv --inspect   # voir les colonnes
python -m app.importers.dispotrains fichier.csv             # importer"""
from __future__ import annotations

import csv
import sys
from datetime import datetime, timezone

from ..collectors.ascenseurs import pick, normalize_status

FIELDS = {
    "elevator_id": ["id", "elevator", "ascenseur", "id_ascenseur", "equipment", "liftid"],
    "station": ["station", "gare", "station_name", "nom"],
    "status": ["status", "etat", "state", "statut"],
    "ts": ["date", "datetime", "timestamp", "time", "horodatage", "lastupdate"],
}


def parse_ts(value: str) -> datetime | None:
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(value.strip(), fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            continue
    return None


def read_rows(path: str):
    with open(path, encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096); f.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t")
        yield from csv.DictReader(f, dialect=dialect)


def to_docs(rows) -> tuple[list[dict], int]:
    docs, rejected = [], 0
    for r in rows:
        eid, ts = pick(r, FIELDS["elevator_id"]), parse_ts(pick(r, FIELDS["ts"]) or "")
        if not eid or not ts:
            rejected += 1
            continue
        raw_status = pick(r, FIELDS["status"])
        docs.append({"ts": ts, "meta": {"elevator_id": str(eid), "source": "dispotrains_2013_2018"},
                     "status": normalize_status(raw_status), "status_raw": raw_status, "station": pick(r, FIELDS["station"])})
    return docs, rejected


def import_file(db, path: str, batch: int = 5000) -> dict:
    buf, n, rejected_total = [], 0, 0
    for r in read_rows(path):
        buf.append(r)
        if len(buf) >= batch:
            docs, rej = to_docs(buf); rejected_total += rej
            if docs:
                db.elevator_status.insert_many(docs); n += len(docs)
            buf = []
    docs, rej = to_docs(buf); rejected_total += rej
    if docs:
        db.elevator_status.insert_many(docs); n += len(docs)
    return {"inserted": n, "rejected": rejected_total}


if __name__ == "__main__":
    path = sys.argv[1]
    if "--inspect" in sys.argv:
        rows = read_rows(path)
        first = next(rows)
        print("Colonnes :", list(first.keys()))
        print("Exemple :", first)
    else:
        from ..core.db import get_db, init_db
        d = get_db(); init_db(d); print(import_file(d, path))
