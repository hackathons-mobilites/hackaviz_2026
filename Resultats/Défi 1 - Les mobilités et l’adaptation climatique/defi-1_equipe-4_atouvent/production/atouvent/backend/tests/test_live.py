"""Suivi en direct : signalements des voyageurs et synthèse du trajet."""
API = "/api/v1"
TRIP = {"start": "2026-10-16T08:00:00+02:00", "end": "2026-10-16T08:20:00+02:00", "legs": [
    {"mode": "BUS", "line": "29", "start": "2026-10-16T08:00:00+02:00", "end": "2026-10-16T08:20:00+02:00", "route_id": "C01100",
     "from": {"name": "Nation", "lat": 48.848, "lon": 2.396}, "to": {"name": "Bastille", "lat": 48.853, "lon": 2.369}}]}


def test_report_vote_and_live(client, monkeypatch):
    from app.services import live
    monkeypatch.setattr(live.traffic, "current", lambda db: {"items": [{"line_id": "C01100", "title": "Bus 29 dévié"},
                                                                       {"line_id": "C09999", "title": "Autre ligne"}]})
    r = client.post(f"{API}/reports", json={"kind": "crowded", "lat": 48.8481, "lon": 2.3961, "stop": "Nation"})
    assert r.status_code == 200 and r.json()["kind"] == "crowded"
    rid = r.json()["id"]
    assert client.post(f"{API}/reports", json={"kind": "invente", "lat": 48.85, "lon": 2.39}).status_code == 422
    out = client.post(f"{API}/trips/live", json={"trip": TRIP}).json()
    assert [d["title"] for d in out["disruptions"]] == ["Bus 29 dévié"]
    assert [x["id"] for x in out["reports"]] == [rid]
    # Deux « plus là » retirent le signalement
    client.post(f"{API}/reports/{rid}/vote", json={"still": False})
    assert client.post(f"{API}/reports/{rid}/vote", json={"still": False}).json() == {"removed": True}
    assert client.get(f"{API}/reports/near", params={"lat": 48.848, "lon": 2.396}).json() == []



def test_trip_context_before_departure(db, monkeypatch):
    from app.services import live
    monkeypatch.setattr(live.traffic, "current", lambda db: {"items": [
        {"id": "1", "line_id": "C01100", "line": "29", "title": "Bus 29 dévié", "severity": "BLOQUANTE", "tags": ["travaux"]},
        {"id": "2", "line_id": "C09999", "line": "X", "title": "Autre"}]})
    live.add_report(db, "hot", 48.8481, 2.3961, "29", "Nation", None)
    its = [{"legs": TRIP["legs"]}]
    live.trip_context(db, its)
    assert [d["title"] for d in its[0]["disruptions"]] == ["Bus 29 dévié"]
    assert [r["kind"] for r in its[0]["reports"]] == ["hot"]



def test_stream_versions_and_payloads(db, monkeypatch):
    import asyncio
    from app.services import stream
    monkeypatch.setattr(stream.traffic, "current", lambda db: {"items": [{"line_id": "C01100", "title": "Bus 29 dévié"}, {"line_id": "X", "title": "Autre"}]})
    monkeypatch.setattr(stream.flood, "vigilance", lambda db: {"level": 1, "color": "vert", "watch": []})
    v1 = stream.versions(db)
    stream.live.add_report(db, "crowded", 48.8481, 2.3961, "29", "Nation", None)
    assert stream.versions(db)["reports"] != v1["reports"]          # un signalement change la version
    assert [x["title"] for x in stream.payload(db, "traffic", 48.85, 2.39, {"C01100"})["items"]] == ["Bus 29 dévié"]
    assert len(stream.payload(db, "reports", 48.848, 2.396, set())["items"]) == 1

    async def first_events():
        calls = {"n": 0}

        async def disconnected():
            calls["n"] += 1
            return calls["n"] > 1
        return [e async for e in stream.events(db, 48.848, 2.396, set(), disconnected)]
    out = asyncio.run(first_events())
    kinds = [e.split("\n")[0] for e in out if e.startswith("event:")]
    assert "event: reports" in kinds and "event: climate" in kinds
