"""Destinations enregistrées : ajout, doublon au même endroit, limite, suppression."""


def _token(client):
    r = client.post("/api/v1/auth/register", json={"email": "places@example.org", "password": "motdepasse-solide-42"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_places_add_rename_remove(client):
    h = _token(client)
    r = client.post("/api/v1/me/places", json={"name": "Travail", "label": "La Défense", "lat": 48.892, "lon": 2.236}, headers=h)
    assert r.status_code == 200 and [p["name"] for p in r.json()["places"]] == ["Travail"]
    r = client.post("/api/v1/me/places", json={"name": "Bureau", "lat": 48.892, "lon": 2.236}, headers=h)
    places = r.json()["places"]
    assert [p["name"] for p in places] == ["Bureau"]
    r = client.delete(f"/api/v1/me/places/{places[0]['id']}", headers=h)
    assert r.json()["places"] == []


def test_places_limits(client):
    h = _token(client)
    assert client.post("/api/v1/me/places", json={"name": "Loin", "lat": 45.0, "lon": 2.3}, headers=h).status_code == 422
    for i in range(10):
        assert client.post("/api/v1/me/places", json={"name": f"P{i}", "lat": 48.8 + i / 100, "lon": 2.3}, headers=h).status_code == 200
    assert client.post("/api/v1/me/places", json={"name": "P10", "lat": 48.95, "lon": 2.4}, headers=h).status_code == 409
    client.cookies.clear()  # sans session du tout (ni en-tête ni cookie)
    assert client.post("/api/v1/me/places", json={"name": "x", "lat": 48.8, "lon": 2.3}).status_code == 401
