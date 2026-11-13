"""Base Mongo en mémoire (mongomock) et client de test FastAPI."""
import os

from cryptography.fernet import Fernet

os.environ["ATOUVENT_NO_DOTENV"] = "1"  # jamais le vrai .env (ni le vrai SMTP) pendant les tests
os.environ["SMTP_HOST"] = ""
os.environ["SUPERADMIN_EMAILS"] = "chef@exemple.fr"
os.environ["REQUIRE_EMAIL_VERIFICATION"] = "0"  # tests existants : comptes ouverts tout de suite (la confirmation a ses propres tests)
os.environ.setdefault("PROFILE_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("JWT_SECRET", "secret-de-test-assez-long-pour-hs256-ok")

import mongomock
import pytest
from fastapi.testclient import TestClient

from app import deps
from app.core.db import init_db
from app.main import create_app


@pytest.fixture
def db():
    d = mongomock.MongoClient(tz_aware=True)["atouvent_test"]
    init_db(d)
    return d


@pytest.fixture
def client(db):
    deps._state.clear()
    deps._state["db"] = db
    # Client « application Android » : jeton dans la réponse (le mode cookie du site web a ses propres tests)
    yield TestClient(create_app(), headers={"X-AtouVent-Client": "native"})
    deps._state.clear()


def sample_trip(when=None, accessible=False):
    """Trajet type Gare de Lyon → Charles de Gaulle-Étoile en RER A, au format renvoyé par le calculateur."""
    from datetime import datetime, timedelta, timezone
    t0 = (when or datetime.now(timezone.utc)).replace(second=0, microsecond=0)
    at = lambda m: (t0 + timedelta(minutes=m)).isoformat()
    home = {"name": "12 rue de Lyon, Paris", "lat": 48.8478, "lon": 2.3721, "stop_id": None}
    gdl = {"name": "Gare de Lyon", "lat": 48.8443, "lon": 2.3740, "stop_id": "STIF:StopArea:SP:73626:"}
    cdg = {"name": "Charles de Gaulle-Étoile", "lat": 48.8738, "lon": 2.2950, "stop_id": "STIF:StopArea:SP:71347:"}
    work = {"name": "30 avenue de Wagram, Paris", "lat": 48.8774, "lon": 2.2985, "stop_id": None}
    return {"start": at(0), "end": at(24), "accessible": accessible, "accessible_requested": accessible, "source": "gtfs", "legs": [
        {"mode": "WALK", "line": None, "headsign": None, "start": at(0), "end": at(5), "from": home, "to": gdl, "stops": [], "underground": False},
        {"mode": "RAIL", "line": "A", "headsign": "Saint-Germain-en-Laye", "start": at(8), "end": at(17), "from": gdl, "to": cdg,
         "underground": True, "stops": [
             {"name": "Châtelet-Les Halles", "lat": 48.8619, "lon": 2.3470, "stop_id": "STIF:StopArea:SP:474151:", "time": at(11)},
             {"name": "Auber", "lat": 48.8722, "lon": 2.3296, "stop_id": "STIF:StopArea:SP:71299:", "time": at(14)}]},
        {"mode": "WALK", "line": None, "headsign": None, "start": at(17), "end": at(24), "from": cdg, "to": work, "stops": [], "underground": False},
    ]}
