"""Planificateur de collecte : à lancer dès maintenant et sans interruption.
Lancer : python -m app.worker"""
import logging
import os

from apscheduler.schedulers.blocking import BlockingScheduler

from .core.config import settings
from .core.db import get_db, init_db
from .collectors import ascenseurs, traffic, velib
from .router import refresh
from .services import flood, hydro

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def _safe(source: str, fn) -> None:
    """Tâche lourde : un échec est enregistré (santé des données) sans arrêter le planificateur."""
    from datetime import datetime, timezone
    db = get_db()
    started = datetime.now(timezone.utc)
    try:
        res = fn()
        db.collection_runs.insert_one({"source": source, "started_at": started, "ok": True, "detail": str(res)[:500],
                                       "finished_at": datetime.now(timezone.utc)})
    except Exception as exc:  # noqa: BLE001 — on garde la trace de toute erreur
        logging.getLogger("atouvent.worker").exception("Échec %s", source)
        db.collection_runs.insert_one({"source": source, "started_at": started, "ok": False, "error": f"{type(exc).__name__}: {exc}"[:500]})


def main():
    db = get_db()
    init_db(db)
    sched = BlockingScheduler(timezone="UTC", job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 120})
    # Ne jamais passer next_run_time=None : APScheduler ajouterait la tâche en pause
    sched.add_job(lambda: velib.collect_status(db), "interval", minutes=settings.velib_every_min, id="velib_status")
    sched.add_job(lambda: velib.collect_information(db), "cron", hour=3, id="velib_information")
    sched.add_job(lambda: ascenseurs.collect(db), "interval", minutes=settings.elevators_every_min, id="elevators")
    # Horaires IDFM : vérifiés chaque nuit, téléchargés et reconstruits seulement s'ils ont changé (ou expirent bientôt)
    # GTFS_BUILD=0 (petit serveur) : reconstruction faite sur un autre poste, ici simple vérification de validité
    gtfs_job = refresh.refresh if os.environ.get("GTFS_BUILD", "1") != "0" else refresh.check_sent
    sched.add_job(lambda: _safe("gtfs", gtfs_job), "cron", hour=2, minute=30, id="gtfs_refresh")
    # Crue (Vigicrues) et hauteur des rivières (Hub'Eau) : rafraîchies même sans visite, pour des données toujours à jour
    sched.add_job(lambda: _safe("flood", lambda: flood.vigilance(db)["level"]), "interval", minutes=15, id="flood")
    sched.add_job(lambda: _safe("rivers", lambda: len(hydro.rivers(db))), "interval", minutes=15, id="rivers")
    if settings.prim_api_key:  # historique de l'info trafic (une requête toutes les 15 min)
        sched.add_job(lambda: traffic.collect(db), "interval", minutes=5, id="traffic")
    # premier passage immédiat
    velib.collect_information(db); velib.collect_status(db); ascenseurs.collect(db)
    _safe("flood", lambda: flood.vigilance(db)["level"]); _safe("rivers", lambda: len(hydro.rivers(db)))
    if settings.prim_api_key:
        traffic.collect(db)
    sched.start()


if __name__ == "__main__":
    main()
