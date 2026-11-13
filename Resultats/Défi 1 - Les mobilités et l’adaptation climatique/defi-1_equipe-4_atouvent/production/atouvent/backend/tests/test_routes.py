API = "/api/v1"


def _register(client, **extra):
    body = {"email": "test@exemple.fr", "password": "un-mot-de-passe-long", "language": "fr", **extra}
    return client.post(f"{API}/auth/register", json=body)


def test_health(client):
    assert client.get(f"{API}/health").json()["ok"] is True


def test_register_with_profile_redirects_to_accessible_trip(client, db):
    r = _register(client, profile=["fauteuil"], profile_consent=True)
    assert r.status_code == 200
    user = r.json()["user"]
    assert user["first_screen"] == "trajet_accessible" and user["settings"]["sans_marche"]
    assert "fauteuil" not in str(db.users.find_one())  # profil chiffré en base


def test_profile_needs_consent(client):
    assert _register(client, profile=["malvoyant"]).json()["detail"] == "consent_required"


def test_login_preferences_export_delete(client):
    _register(client)
    token = client.post(f"{API}/auth/login", json={"email": "TEST@exemple.fr", "password": "un-mot-de-passe-long"}).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.put(f"{API}/me/preferences", json={"language": "zh", "voice": True}, headers=h).json()["language"] == "zh"
    assert client.get(f"{API}/me/export", headers=h).json()["voice"] is True
    assert client.delete(f"{API}/me", headers=h).json() == {"deleted": True}
    assert client.get(f"{API}/me", headers=h).status_code == 401


def test_plan_and_bundle(client, monkeypatch):
    from app.services import planner, trips
    from tests.conftest import sample_trip
    monkeypatch.setattr(trips.open_meteo, "get_forecast", lambda *a, **k: (_ for _ in ()).throw(RuntimeError()))
    monkeypatch.setattr(planner.engine, "plan", lambda *a, **k: [sample_trip()])
    pt = {"lat": 48.85, "lon": 2.35}
    its = client.post(f"{API}/trips/plan", json={"origin": pt, "destination": pt}).json()["itineraries"]
    assert its[0]["source"] == "gtfs"
    b = client.post(f"{API}/trips/bundle", json={"trip": its[0]}).json()
    assert b["trip"]["legs"] and any(w["code"] == "underground" for w in b["warnings"])


def test_plan_without_router_data_is_503(client, monkeypatch):
    from app.services import planner
    def missing(*a, **k):
        raise planner.engine.RouterUnavailable("router.npz absent")
    monkeypatch.setattr(planner.engine, "plan", missing)
    pt = {"lat": 48.85, "lon": 2.35}
    assert client.post(f"{API}/trips/plan", json={"origin": pt, "destination": pt}).json()["detail"] == "planner_unavailable"


def test_plan_rejects_outside_ile_de_france(client):
    pt = {"lat": 43.3, "lon": 5.4}
    assert client.post(f"{API}/trips/plan", json={"origin": pt, "destination": pt}).status_code == 422


def test_velib_summary(client, db):
    db.velib_latest.insert_many([{"station_id": "1", "bikes": 5, "renting": True}, {"station_id": "2", "bikes": 0, "renting": True}])
    assert client.get(f"{API}/velib/summary").json() | {"at": None} == {"bikes": 5, "stations": 2, "empty": 1, "at": None}


def test_elevator_summary(client, db):
    db.elevator_latest.insert_many([{"elevator_id": "1", "status": "hors_service"}, {"elevator_id": "2", "status": "en_service"}])
    assert client.get(f"{API}/elevators/summary").json() | {"at": None} == {"out": 1, "total": 2, "unknown": 0, "night": 0, "at": None}


def test_decider_analysis_is_admin_only(client):
    r = _register(client)
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    client.cookies.clear()  # sans session du tout (ni en-tête ni cookie)
    assert client.get(f"{API}/admin/analysis").status_code == 401
    assert client.get(f"{API}/admin/analysis", headers=h).status_code == 403


def test_profile_turns_on_matching_settings(client):
    # Malvoyant : voix, contraste renforcé et grand texte activés d'office (modifiables ensuite)
    u = _register(client, profile=["malvoyant"], profile_consent=True).json()["user"]
    assert (u["voice"], u["high_contrast"], u["text_size"]) == (True, True, 3)
    # Compte classique : réglages par défaut
    v = client.post(f"{API}/auth/register", json={"email": "classique@exemple.fr", "password": "motdepasse-solide-42"}).json()["user"]
    assert (v["voice"], v["high_contrast"], v["settings"]["sans_marche"]) == (False, False, False)


def test_security_headers(client):
    r = client.get(f"{API}/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["X-Frame-Options"] == "DENY"
    assert client.get(f"{API}/me").headers["Cache-Control"] == "no-store"
