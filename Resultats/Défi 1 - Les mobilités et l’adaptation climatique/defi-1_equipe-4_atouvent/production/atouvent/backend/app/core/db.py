"""Connexion MongoDB et création des collections (dont les séries temporelles)."""
from pymongo import MongoClient, ASCENDING, DESCENDING, GEOSPHERE
from pymongo.database import Database

from .config import settings

# Séries temporelles : un document par relevé, « meta » identifie l'objet suivi
TIMESERIES = {
    "velib_status": {"timeField": "ts", "metaField": "meta", "granularity": "minutes"},
    "elevator_status": {"timeField": "ts", "metaField": "meta", "granularity": "hours"},
}


def get_db(uri: str | None = None) -> Database:
    client = MongoClient(uri or settings.mongo_uri, tz_aware=True)
    return client[settings.mongo_db]


def init_db(db: Database) -> None:
    existing = set(db.list_collection_names())
    for name, opts in TIMESERIES.items():
        if name not in existing:
            try:
                db.create_collection(name, timeseries=opts)
            except Exception:  # MongoDB < 5 ou base de test : collection classique
                db.create_collection(name)
    # Dernier état connu par objet (sert à ne stocker que les changements)
    db.velib_latest.create_index("station_id", unique=True)
    db.elevator_latest.create_index("elevator_id", unique=True)
    # Référentiels géolocalisés
    db.velib_stations.create_index([("location", GEOSPHERE)])
    db.velib_stations.create_index("station_id", unique=True)
    # Journal de collecte : permet de repérer les trous (absence de donnée ≠ zéro vélo)
    db.collection_runs.create_index([("source", ASCENDING), ("started_at", DESCENDING)])
    db.departures_cache.create_index("ref", unique=True)
    db.api_quota.create_index("day", unique=True)
    db.users.create_index("email", unique=True)
    # Caches des API externes (Open-Meteo, géocodage)
    db.weather_cache.create_index("key", unique=True)
    db.geocode_cache.create_index("q", unique=True)
    db.cool_cache.create_index("key", unique=True)
    db.hydro_cache.create_index("key", unique=True)
    db.traffic_cache.create_index("key", unique=True)
    db.flood_cache.create_index("key", unique=True)
    # Signalements des voyageurs : supprimés automatiquement à expiration
    db.reports.create_index("expires_at", expireAfterSeconds=0)
    db.traffic_history.create_index([("day", ASCENDING), ("line_id", ASCENDING), ("id", ASCENDING)], unique=True)
