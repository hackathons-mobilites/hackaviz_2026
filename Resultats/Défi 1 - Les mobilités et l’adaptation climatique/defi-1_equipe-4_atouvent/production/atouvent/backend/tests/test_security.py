"""Correctifs de l'audit : secrets, bornes, quotas, mot de passe, rôles."""
import dataclasses

import pytest

from app.core import config
from app.core.ratelimit import RateLimiter
from app.services import mailer

API = "/api/v1"
PW = "un-mot-de-passe-long"


def _register(client, email="test@exemple.fr"):
    return client.post(f"{API}/auth/register", json={"email": email, "password": PW})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send", lambda to, subject, body, lang="fr": sent.append((to, subject, body)) or True)
    return sent


def test_worker_jobs_are_not_paused(monkeypatch):
    from app import worker
    jobs = {}

    class FakeScheduler:
        def __init__(self, **_):
            pass

        def add_job(self, fn, trigger, **kw):
            jobs[kw["id"]] = kw

        def start(self):
            pass

    monkeypatch.setattr(worker, "BlockingScheduler", FakeScheduler)
    monkeypatch.setattr(worker, "get_db", lambda: None)
    monkeypatch.setattr(worker, "init_db", lambda db: None)
    for mod in (worker.velib, worker.ascenseurs):
        for name in ("collect_status", "collect_information", "collect"):
            monkeypatch.setattr(mod, name, lambda db: None, raising=False)
    monkeypatch.setattr(worker, "_safe", lambda source, fn: None)  # crue et rivières : appels réseau
    worker.main()
    assert {"flood", "rivers"} <= set(jobs)
    assert all("next_run_time" not in kw for kw in jobs.values())


@pytest.mark.parametrize("secret,key", [("", "ok"), ("a-changer-en-production", "ok"), ("court", "ok"), ("x" * 40, "")])
def test_refuses_weak_secrets(secret, key):
    from cryptography.fernet import Fernet
    s = dataclasses.replace(config.settings, jwt_secret=secret,
                            profile_key=Fernet.generate_key().decode() if key else "")
    with pytest.raises(RuntimeError):
        config.check_secrets(s)


def test_history_rejects_zero_step_and_huge_ranges(client):
    q = {"station_id": "1", "start": "2026-07-01T00:00:00Z", "end": "2026-07-02T00:00:00Z"}
    assert client.get(f"{API}/velib/history", params={**q, "step_min": 0}).status_code == 422
    assert client.get(f"{API}/velib/history", params={**q, "end": "2030-01-01T00:00:00Z", "step_min": 5}).status_code == 422
    assert client.get(f"{API}/velib/history", params={**q, "step_min": 60}).status_code == 200


def test_bad_inputs_are_422_not_500(client):
    assert client.get(f"{API}/elevators/daily-outages", params={"start": "pas-une-date", "end": "2026-01-01"}).status_code == 422
    assert client.get(f"{API}/weather", params={"lat": 1000, "lon": 2}).status_code == 422
    assert client.post(f"{API}/trips/bundle", json={"trip": {"legs": [{"mode": "RAIL"}]}}).status_code == 422
    assert client.get(f"{API}/departures/n'importe-quoi").status_code == 422


def test_rate_limit_on_login(client):
    _register(client)
    codes = [client.post(f"{API}/auth/login", json={"email": "test@exemple.fr", "password": "mauvais-mot-de-passe"}).status_code
             for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429


def test_rate_limiter_window():
    rl = RateLimiter({"x": (2, 60)})
    assert rl.hit("x", "ip") is None and rl.hit("x", "ip") is None
    assert rl.hit("x", "ip") > 0
    assert rl.hit("x", "autre-ip") is None


def test_elevator_outage_removes_step_free(client, db, monkeypatch):
    from app.services import planner
    from tests.conftest import sample_trip
    monkeypatch.setattr(planner, "plan", lambda *a, **k: [sample_trip(accessible=True)])
    asked = {}

    def detour(*a, avoid=None, **k):  # trajet de remplacement qui évite la gare en panne
        asked["avoid"] = avoid
        trip = sample_trip(accessible=True)
        trip["legs"][1]["from"] = {**trip["legs"][1]["from"], "name": "Bercy"}
        return [trip]
    monkeypatch.setattr(planner, "transit", detour)
    db.elevator_latest.insert_one({"elevator_id": "e1", "station": "Gare de Lyon", "status": "hors_service"})
    pt = {"lat": 48.85, "lon": 2.35}
    its = client.post(f"{API}/trips/plan", json={"origin": pt, "destination": pt, "accessible": True}).json()["itineraries"]
    broken = next(it for it in its if it["elevators_out"])
    assert broken["accessible"] is False and [(e["station"], e["count"]) for e in broken["elevators_out"]] == [("Gare de Lyon", 1)]
    # Sans marche : une solution qui évite la gare est proposée, et passe en premier
    assert asked["avoid"] == {"Gare de Lyon"} and its[0]["source"] == "avoid_lift" and its[0]["avoids"] == ["Gare de Lyon"]


def test_forgot_and_reset_password(client, outbox):
    _register(client)
    old_token = client.post(f"{API}/auth/login", json={"email": "test@exemple.fr", "password": PW}).json()["token"]
    # Même réponse pour une adresse inconnue (pas d'énumération des comptes)
    assert client.post(f"{API}/auth/forgot-password", json={"email": "inconnu@exemple.fr"}).json() == {"sent": True}
    assert client.post(f"{API}/auth/forgot-password", json={"email": "test@exemple.fr"}).json() == {"sent": True}
    assert len(outbox) == 1
    token = outbox[0][2].split("#", 1)[1].split()[0]
    r = client.post(f"{API}/auth/reset-password", json={"token": token, "password": "nouveau-mot-de-passe"})
    assert r.status_code == 200
    # Lien à usage unique, anciennes sessions fermées
    assert client.post(f"{API}/auth/reset-password", json={"token": token, "password": "encore-un-autre-mdp"}).status_code == 400
    assert client.get(f"{API}/me", headers=_auth(old_token)).status_code == 401
    assert client.post(f"{API}/auth/login", json={"email": "test@exemple.fr", "password": "nouveau-mot-de-passe"}).status_code == 200


def test_change_password(client):
    token = _register(client).json()["token"]
    r = client.post(f"{API}/me/password", json={"current_password": PW, "password": "nouveau-mot-de-passe"}, headers=_auth(token))
    assert r.status_code == 200
    assert client.get(f"{API}/me", headers=_auth(token)).status_code == 401
    assert client.get(f"{API}/me", headers=_auth(r.json()["token"])).status_code == 200


def test_roles(client, db):
    user = _register(client).json()["token"]
    boss = _register(client, "chef@exemple.fr").json()  # adresse de SUPERADMIN_EMAILS (conftest)
    assert boss["user"]["role"] == "superadmin"
    assert client.get(f"{API}/admin/stats", headers=_auth(user)).status_code == 403
    assert client.get(f"{API}/admin/users", headers=_auth(user)).status_code == 403
    users = client.get(f"{API}/admin/users", headers=_auth(boss["token"])).json()
    assert users["total"] == 2 and "profile" not in str(users["items"][0].keys()).replace("has_profile", "")
    uid = next(u["id"] for u in users["items"] if u["email"] == "test@exemple.fr")
    assert client.put(f"{API}/admin/users/{uid}/role", json={"role": "admin"}, headers=_auth(boss["token"])).json()["role"] == "admin"
    assert client.get(f"{API}/admin/stats", headers=_auth(user)).status_code == 200
    assert client.get(f"{API}/admin/users", headers=_auth(user)).status_code == 403  # admin ≠ super admin
    assert client.delete(f"{API}/me", headers=_auth(boss["token"])).status_code == 409


def test_collect_status_hides_error_detail(db):
    """/collect/status (admins) ne donne que « une erreur a eu lieu » ; le détail technique reste dans /admin/collect."""
    from datetime import datetime, timezone
    from app.routes.system import collect_report
    db.collection_runs.insert_one({"source": "elevators", "started_at": datetime.now(timezone.utc), "ok": False,
                                   "error": "ConnectError: https://secret.interne"})
    assert collect_report(db, 7)["elevators"]["last_error"] is True


def test_create_superadmin_cli(db, outbox):
    from app.admin_cli import create_superadmin
    msg = create_superadmin(db, "Admin@Exemple.fr")
    assert "envoyé" in msg and outbox[0][0] == "admin@exemple.fr"
    assert db.users.find_one({"email": "admin@exemple.fr"})["role"] == "superadmin"


def test_collect_status_is_admin_only(client):
    assert client.get(f"{API}/collect/status").status_code == 401


def test_oversized_request_is_refused(client):
    pt = {"lat": 48.85, "lon": 2.35, "name": "x" * 1_100_000}
    assert client.post(f"{API}/trips/plan", json={"origin": pt, "destination": pt}).status_code == 413


def test_global_rate_limit_covers_unlimited_routes(client, monkeypatch):
    from app.core import ratelimit
    from app.deps import _state
    _state["limiter"] = ratelimit.RateLimiter({**ratelimit.LIMITS, "global": (3, 60)})
    codes = [client.get(f"{API}/health").status_code for _ in range(4)]
    _state.pop("limiter")
    assert codes == [200, 200, 200, 429]


def test_login_limited_per_account_across_addresses(client):
    from app.core import ratelimit
    from app.deps import _state
    _state["limiter"] = ratelimit.RateLimiter({**ratelimit.LIMITS, "login_account": (2, 3600)})
    body = {"email": "cible@exemple.fr", "password": "mauvais-mot-de-passe"}
    codes = [client.post(f"{API}/auth/login", json=body).status_code for _ in range(3)]
    _state.pop("limiter")
    assert codes == [401, 401, 429]


def test_admin_actions_are_logged_and_stats_complete(client):
    _register(client)
    boss = _register(client, "chef@exemple.fr").json()["token"]
    client.post(f"{API}/auth/login", json={"email": "test@exemple.fr", "password": PW})
    uid = next(u["id"] for u in client.get(f"{API}/admin/users", headers=_auth(boss)).json()["items"] if u["email"] == "test@exemple.fr")
    client.put(f"{API}/admin/users/{uid}/role", json={"role": "admin"}, headers=_auth(boss))
    log = client.get(f"{API}/admin/log", headers=_auth(boss)).json()
    assert log[0]["by"] == "chef@exemple.fr" and log[0]["target"] == "test@exemple.fr" and log[0]["detail"] == "user → admin"
    s = client.get(f"{API}/admin/stats", headers=_auth(boss)).json()
    assert s["new_7d"] == 2 and s["active_30d"] == 1 and "reports_24h" in s


def test_collect_report_marks_recovered_source(db):
    from datetime import datetime, timedelta, timezone
    from app.routes.system import collect_report
    now = datetime.now(timezone.utc)
    db.collection_runs.insert_many([
        {"source": "velib_status", "started_at": now - timedelta(minutes=2), "ok": False, "error": "ConnectTimeout: timed out"},
        {"source": "velib_status", "started_at": now - timedelta(minutes=1), "ok": True}])
    r = collect_report(db, 7, with_errors=True)["velib_status"]
    assert r["state"] == "ok" and r["recovered"] and r["success_rate"] == 50.0 and r["last_error"].startswith("ConnectTimeout")


def test_web_session_uses_httponly_cookie_and_csrf_header(db):
    """Site web : jeton seulement dans un cookie HttpOnly/SameSite=Strict, jamais lisible ni dans la réponse ; toute modification exige l'en-tête X-Requested-With ; la déconnexion efface le cookie."""
    from fastapi.testclient import TestClient
    from app import deps
    from app.main import create_app
    deps._state.clear()
    deps._state["db"] = db
    web = TestClient(create_app())  # navigateur : pas d'en-tête « native »
    r = web.post(f"{API}/auth/register", json={"email": "web@exemple.fr", "password": PW})
    cookie = r.headers["set-cookie"].lower()
    assert r.status_code == 200 and "token" not in r.json()
    assert "atv_session=" in cookie and "httponly" in cookie and "samesite=strict" in cookie and "path=/api" in cookie
    assert web.get(f"{API}/me").json()["email"] == "web@exemple.fr"
    body = {"alerts": ["chaleur"]}
    assert web.put(f"{API}/me/preferences", json=body).status_code == 403  # sans l'en-tête : refusé (CSRF)
    assert web.put(f"{API}/me/preferences", json=body, headers={"X-Requested-With": "AtouVent"}).status_code == 200
    assert web.post(f"{API}/auth/logout", headers={"X-Requested-With": "AtouVent"}).status_code == 200
    assert web.get(f"{API}/me").status_code == 401
    deps._state.clear()
