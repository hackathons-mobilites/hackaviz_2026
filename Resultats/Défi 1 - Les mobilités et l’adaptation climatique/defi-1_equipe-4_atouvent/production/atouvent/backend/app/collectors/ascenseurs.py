"""Collecte de l'état des ascenseurs (IDFM, jeu « etat-des-ascenseurs »).
python -m app.collectors.ascenseurs --inspect"""
from __future__ import annotations

import sys
from datetime import timedelta

import httpx
from pymongo import UpdateOne

from ..core.config import settings
from ..services import http
from .common import select_changes, utcnow, run_logged, log

FIELD_CANDIDATES = {
    "elevator_id": ["liftid", "lift_id", "id_ascenseur", "idascenseur", "equipmentid", "equipment_id", "id"],
    "status": ["liftstatus", "lift_status", "etat", "statut", "status", "etat_ascenseur"],
    "zdc_id": ["zdcid", "zdc_id", "id_zdc", "idrefazdc", "id_ref_zdc"],
    "station": ["zdcname", "zdc_name", "nom_zdc", "stationname", "nom_station", "nom_gare"],
    "situation": ["liftsituation", "situation", "localisation", "lift_situation"],
    "status_updated": ["liftstateupdate", "liftstatusupdatetime", "date_maj", "datemaj", "updatedate", "date_etat"],
}
STATE_FIELDS = ["status"]

# Normalisation des états vers trois valeurs claires
STATUS_MAP = {
    # Valeurs du jeu IDFM « État des ascenseurs » (liftstatus) : available, notavailable, unknown
    "available": "en_service", "notavailable": "hors_service", "unknown": "inconnu", "disponible": "en_service", "en service": "en_service", "ok": "en_service", "fonctionne": "en_service",
    "unavailable": "hors_service", "indisponible": "hors_service", "hors service": "hors_service", "en panne": "hors_service",
    "maintenance": "maintenance", "en maintenance": "maintenance", "travaux": "maintenance",
}


def pick(record: dict, names: list[str]):
    low = {k.lower(): v for k, v in record.items()}
    for n in names:
        if n in low and low[n] not in (None, ""):
            return low[n]
    return None


def normalize_status(raw) -> str:
    if raw is None:
        return "inconnu"
    return STATUS_MAP.get(str(raw).strip().lower(), "inconnu")


NIGHT_END = (6, 30)  # heure de Paris : au-delà, un ascenseur arrêté dans la nuit et pas reparti est une vraie panne


def night_stop(status: str, updated, now_local) -> bool:
    """Arrêt de nuit, pas une panne : IDFM publie « notavailable / liftFailure » pour les ascenseurs coupés à la fermeture des stations (constaté : ~270 entre 0 h et 3 h)."""
    if status != "hors_service" or not updated or len(str(updated)) < 13:
        return False
    try:
        changed_hour = int(str(updated)[11:13])
    except ValueError:
        return False
    in_night = now_local.hour < NIGHT_END[0] or (now_local.hour == NIGHT_END[0] and now_local.minute < NIGHT_END[1])
    return 0 <= changed_hour < 6 and in_night and str(updated)[:10] == now_local.date().isoformat()


def normalize(records: list[dict], now_local=None) -> tuple[list[dict], list[str]]:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    now_local = now_local or datetime.now(ZoneInfo("Europe/Paris"))
    rows, missing = [], set()
    for rec in records:
        row = {k: pick(rec, names) for k, names in FIELD_CANDIDATES.items()}
        for k in ("elevator_id", "status"):
            if row[k] is None:
                missing.add(k)
        if row["elevator_id"] is None:
            continue
        row["elevator_id"] = str(row["elevator_id"])
        row["status_raw"] = row["status"]
        row["status"] = normalize_status(row["status"])
        if night_stop(row["status"], row.get("status_updated"), now_local):
            row["status"] = "ferme_nuit"
        row["raw"] = rec
        rows.append(row)
    return rows, sorted(missing)


def store(db, rows: list[dict], now) -> dict:
    latest = {d["elevator_id"]: d for d in db.elevator_latest.find({}, {"_id": 0})}
    changes = select_changes(rows, latest, "elevator_id", STATE_FIELDS, now, timedelta(minutes=settings.elevators_heartbeat_min))
    if changes:
        db.elevator_status.insert_many([
            {"ts": now, "meta": {"elevator_id": c["elevator_id"], "zdc_id": c["zdc_id"], "source": "idfm_temps_reel"},
             "status": c["status"], "status_raw": c["status_raw"], "station": c["station"], "situation": c["situation"],
             "status_updated": c["status_updated"], "reason": c["_reason"], "raw": c["raw"]} for c in changes])
        db.elevator_latest.bulk_write([
            UpdateOne({"elevator_id": c["elevator_id"]},
                      {"$set": {"elevator_id": c["elevator_id"], "zdc_id": c["zdc_id"], "station": c["station"],
                                "situation": c["situation"], "status": c["status"], "hash": c["_hash"], "written_at": now}},
                      upsert=True) for c in changes])
    return {"n_fetched": len(rows), "n_written": len(changes)}


def fetch(client: httpx.Client | None = None) -> list[dict]:
    c = client or http.shared()
    headers = {"Authorization": f"Apikey {settings.idfm_api_key}"} if settings.idfm_api_key else {}
    r = c.get(settings.elevators_url, headers=headers, timeout=60)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else data.get("results", [])


class EmptyFeed(RuntimeError):
    """Le portail répond 200 mais sans aucun ascenseur : jeu restreint ou clé absente/invalide."""


def collect(db, client: httpx.Client | None = None) -> dict:
    def job():
        records = fetch(client)
        # Une réponse vide n'est jamais un succès : sinon la supervision affiche « OK » sans aucune donnée
        if not records:
            raise EmptyFeed("0 ascenseur reçu : jeu en accès restreint, renseigner IDFM_API_KEY dans .env")
        rows, missing = normalize(records)
        if missing:
            log.warning("Ascenseurs : champs non reconnus %s, compléter FIELD_CANDIDATES (--inspect)", missing)
        stats = store(db, rows, utcnow())
        stats["unknown_fields"] = missing
        return stats
    return run_logged(db, "elevators", job)


if __name__ == "__main__":
    if "--inspect" in sys.argv:
        recs = fetch()
        print(f"{len(recs)} enregistrements. Champs du premier :")
        for k, v in (recs[0] if recs else {}).items():
            print(f"  {k!r}: {v!r}")
        rows, missing = normalize(recs[:50])
        print("Champs non reconnus :", missing or "aucun")
    else:
        from ..core.db import get_db, init_db
        d = get_db(); init_db(d); print(collect(d))
