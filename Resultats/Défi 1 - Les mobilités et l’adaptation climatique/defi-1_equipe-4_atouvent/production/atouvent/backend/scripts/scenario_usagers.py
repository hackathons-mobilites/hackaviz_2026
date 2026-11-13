"""Test de bout en bout de l'API en fonctionnement, avec quatre usagers types.
Lancer (API démarrée, depuis backend/) :
python scripts/scenario_usagers.py            → teste puis supprime les comptes
python scripts/scenario_usagers.py --keep     → garde les comptes et écrit leurs jetons dans scripts/.jetons.json
python scripts/scenario_usagers.py --cleanup  → supprime les comptes gardés"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# Console Windows : on force l'UTF-8 pour les accents et les flèches
sys.stdout.reconfigure(encoding="utf-8")
from app.core import security as sec  # noqa: E402
from app.core.config import settings  # noqa: E402

API = "http://127.0.0.1:8000/api/v1"
PW = "Scenario-quatre-usagers-2026!"
USERS = {
    "lea": {"email": "scenario-lea@exemple.fr", "body": {}},
    "karim": {"email": "scenario-karim@exemple.fr", "body": {"profile_consent": True, "profile": ["fauteuil", "sensible_climat"]}},
    "nadia": {"email": "scenario-nadia@exemple.fr", "body": {"profile_consent": True, "profile": ["malvoyant"]}},
    "ines": {"email": "scenario-ines@exemple.fr", "body": {}},
}
JETONS = Path(__file__).with_name(".jetons.json")
NATION = {"lat": 48.8484, "lon": 2.3959, "name": "Nation"}
GDL = {"lat": 48.8448, "lon": 2.3735, "name": "Gare de Lyon"}
DEFENSE = {"lat": 48.8919, "lon": 2.2379, "name": "La Defense"}
BOBIGNY = {"lat": 48.9078, "lon": 2.4396}

db = MongoClient(settings.mongo_uri)[settings.mongo_db]
native = httpx.Client(timeout=90, headers={"X-AtouVent-Client": "native"})  # comme l'application Android
results: list[tuple[str, str, bool, str]] = []


def check(who: str, what: str, ok, detail="") -> None:
    results.append((who, what, bool(ok), str(detail)))
    print(f"[{'OK' if ok else 'ÉCHEC'}] {who:6} {what}{' — ' + str(detail) if detail != '' else ''}")


def call(method: str, path: str, token: str | None = None, client: httpx.Client = native, **kw):
    headers = {**({"Authorization": f"Bearer {token}"} if token else {}), **kw.pop("headers", {})}
    t = time.time()
    r = client.request(method, API + path, headers=headers, **kw)
    return r, round(time.time() - t, 2)


def cleanup() -> None:
    n = db.users.delete_many({"email": {"$in": [u["email"] for u in USERS.values()]}}).deleted_count
    db.reports.delete_many({"stop": "Scénario"})
    JETONS.unlink(missing_ok=True)
    print(f"{n} compte(s) temporaire(s) supprimé(s)")


def main(keep: bool) -> int:
    cleanup()
    tok: dict[str, str] = {}

    # ---------- Inscriptions (vraie route) ----------
    for who, u in USERS.items():
        r, _ = call("POST", "/auth/register", json={"email": u["email"], "password": PW, "language": "fr", **u["body"]})
        check(who, "inscription", r.status_code == 200, r.status_code)
        if r.status_code == 429:
            print("Limite d'inscriptions atteinte (5 par heure et par adresse) : relancer plus tard.")
            return 1
        tok[who] = r.json()["token"]
        u["me"] = r.json()["user"]
    check("lea", "compte classique : aucun profil, réglages par défaut", not USERS["lea"]["me"]["profile"] and not USERS["lea"]["me"]["voice"])
    check("karim", "fauteuil : « sans marche » et premier écran trajet accessible",
          USERS["karim"]["me"]["settings"]["sans_marche"] and USERS["karim"]["me"]["first_screen"] == "trajet_accessible")
    n = USERS["nadia"]["me"]
    check("nadia", "malvoyante : voix, contraste renforcé, grand texte d'office", n["voice"] and n["high_contrast"] and n["text_size"] == 3)
    for who in ("karim", "nadia"):
        raw = json.dumps(db.users.find_one({"email": USERS[who]["email"]}), default=str)
        check(who, "profil de santé chiffré en base", "fauteuil" not in raw and "malvoyant" not in raw and "profile_enc" in raw)
    r, _ = call("POST", "/auth/register", json={"email": "scenario-x@exemple.fr", "password": PW, "profile": ["fauteuil"]})
    check("karim", "profil refusé sans consentement", r.status_code in (422, 429), r.status_code)

    # ---------- Session web : cookie HttpOnly, jamais de jeton lisible ----------
    web = httpx.Client(timeout=30)
    r, _ = call("POST", "/auth/login", client=web, json={"email": USERS["lea"]["email"], "password": PW})
    cookie = r.headers.get("set-cookie", "").lower()
    check("lea", "connexion web : cookie HttpOnly SameSite=Strict, pas de jeton dans la réponse",
          r.status_code == 200 and "token" not in r.json() and "httponly" in cookie and "samesite=strict" in cookie)
    r, _ = call("PUT", "/me/preferences", client=web, json={"alerts": ["chaleur"]})
    check("lea", "modification sans en-tête anti-falsification refusée (CSRF)", r.status_code == 403, r.status_code)
    r, _ = call("PUT", "/me/preferences", client=web, json={"alerts": ["chaleur", "orages_pluie", "pollution"]},
                headers={"X-Requested-With": "AtouVent"})
    check("lea", "modification avec l'en-tête : acceptée", r.status_code == 200, r.status_code)
    r, _ = call("POST", "/auth/logout", client=web, headers={"X-Requested-With": "AtouVent"})
    check("lea", "déconnexion : session web fermée", call("GET", "/me", client=web)[0].status_code == 401)
    r, _ = call("POST", "/auth/login", json={"email": USERS["lea"]["email"], "password": "mauvais"})
    check("lea", "mauvais mot de passe refusé", r.status_code == 401, r.status_code)

    # ---------- Léa : usage courant ----------
    T = tok["lea"]
    r, _ = call("POST", "/me/places", T, json={"name": "Travail", "label": "Gare de Lyon", "lat": GDL["lat"], "lon": GDL["lon"]})
    check("lea", "enregistrer une destination", r.status_code == 200, r.status_code)
    r, _ = call("GET", "/geo/search", T, params={"q": "gare de lion"})
    check("lea", "recherche tolérante : « gare de lion » → Gare de Lyon", "Gare de Lyon" in (r.json() or [{}])[0].get("label", ""))
    r, dt = call("GET", "/weather", T, params={"lat": NATION["lat"], "lon": NATION["lon"]})
    check("lea", "climat de l'heure", r.status_code == 200 and r.json()["now"]["temperature"] is not None, f"{dt}s")
    later = (datetime.now(timezone.utc) + timedelta(days=2)).replace(hour=7, minute=30, second=0, microsecond=0)
    r, _ = call("GET", "/weather", T, params={"lat": GDL["lat"], "lon": GDL["lon"], "at": later.isoformat()})
    check("lea", "météo prévue au départ d'un trajet dans 2 jours", (r.json().get("at") or {}).get("temperature") is not None)
    r, dt = call("POST", "/trips/plan", T, json={"origin": NATION, "destination": GDL})
    its = r.json().get("itineraries", [])
    check("lea", "itinéraires Nation → Gare de Lyon (transports, vélo, marche)", len(its) >= 3, f"{len(its)} trajets, {dt}s")
    check("lea", "bilan CO2 sur chaque trajet", all((it.get("carbon") or {}).get("co2_g") is not None for it in its))
    check("lea", "horaires cohérents", all(it["start"] <= it["end"] for it in its))
    r, _ = call("POST", "/trips/plan", T, json={"origin": NATION, "destination": GDL, "depart_at": later.isoformat()})
    fut = r.json().get("itineraries", [])
    check("lea", "itinéraire à venir calculé à l'heure demandée", fut and fut[0]["start"][:10] == later.astimezone().date().isoformat(),
          fut[0]["start"][:16] if fut else "")
    transit = next((it for it in its if any(l["mode"] not in ("WALK", "BICYCLE") for l in it["legs"])), None)
    r, _ = call("POST", "/trips/bundle", T, json={"trip": transit})
    check("lea", "trajet préparé pour le hors-ligne", r.status_code == 200, r.status_code)
    r, dt = call("POST", "/trips/live", T, json={"trip": transit, "next_leg": 0})
    check("lea", "suivi en direct du trajet", r.status_code == 200, f"{dt}s")
    air = [(l["from"].get("info") or {}).get("air") for it in its for l in it["legs"] if l["mode"] in ("SUBWAY", "RAIL")]
    check("lea", "air des quais indiqué sur les étapes en métro ou RER", any(air), sorted({a for a in air if a}))
    r, _ = call("POST", "/reports", T, json={"kind": "hot", "lat": NATION["lat"], "lon": NATION["lon"], "stop": "Scénario"})
    rid = r.json().get("id")
    check("lea", "signaler une rame trop chaude", r.status_code == 200 and rid, r.status_code)
    r, _ = call("POST", f"/reports/{rid}/vote", json={"still": True})
    check("lea", "confirmer un signalement", r.status_code == 200, r.status_code)
    for path in ("/admin/stats", "/admin/analysis", "/admin/users", "/admin/log", "/collect/status"):
        r, _ = call("GET", path, T)
        check("lea", f"accès refusé à {path}", r.status_code == 403, r.status_code)
    r, _ = call("GET", "/me/export", T)
    check("lea", "export de ses données (RGPD)", r.status_code == 200, r.status_code)

    # ---------- Karim : fauteuil, sensible au climat ----------
    T = tok["karim"]
    r, dt = call("POST", "/trips/plan", T, json={"origin": NATION, "destination": DEFENSE, "accessible": True, "walk": "slow"})
    its = r.json().get("itineraries", [])
    check("karim", "trajets sans marche Nation → La Défense", its, f"{len(its)} trajets, {dt}s")
    check("karim", "ni vélo ni marche seule proposés", all(it.get("source") not in ("bike", "velib", "walk") for it in its))
    out = [bool(it.get("elevators_out")) for it in its]
    check("karim", "trajets avec ascenseur en panne en dernier", out == sorted(out), out)
    if its and all(it.get("elevators_out") for it in its if it.get("source") != "avoid_lift"):
        check("karim", "solution qui évite la gare en panne proposée", its[0].get("source") == "avoid_lift", its[0].get("avoids"))
    r, _ = call("GET", "/stops/near", T, params={"lat": NATION["lat"], "lon": NATION["lon"]})
    check("karim", "arrêts proches : accessibilité et air du quai", any("air" in (s.get("info") or {}) for s in r.json()))
    r, _ = call("GET", "/places/near", T, params={"group": "cool", **BOBIGNY})
    check("karim", "lieux frais en banlieue (Bobigny, Institut Paris Region)", r.status_code == 200 and r.json(),
          (r.json() or [{}])[0].get("name"))
    r, _ = call("GET", "/elevators/summary", T)
    check("karim", "ascenseurs : pannes et arrêts de nuit distingués", r.status_code == 200 and "night" in r.json())

    # ---------- Nadia : malvoyante ----------
    T = tok["nadia"]
    r, _ = call("POST", "/trips/plan", T, json={"origin": NATION, "destination": GDL, "walk": "slow"})
    check("nadia", "itinéraires en marche lente (3 km/h)", r.json().get("itineraries"))
    r, _ = call("PUT", "/me/preferences", T, json={"voice": True, "text_size": 3, "high_contrast": True, "alerts": ["chaleur", "pollution"]})
    check("nadia", "réglages d'accessibilité enregistrés", r.status_code == 200 and r.json()["high_contrast"], r.status_code)
    r, _ = call("PUT", "/me/preferences", T, json={"profile": ["inconnu"], "profile_consent": True})
    check("nadia", "profil inconnu refusé", r.status_code == 422, r.status_code)

    # ---------- Inès : décideuse ----------
    sup = db.users.find_one({"email": {"$in": list(settings.superadmin_emails)}})
    S = sec.make_token(str(sup["_id"]), sup.get("token_version", 0)) if sup else None
    iid = str(db.users.find_one({"email": USERS["ines"]["email"]})["_id"])
    r, _ = call("PUT", f"/admin/users/{iid}/role", tok["lea"], json={"role": "admin"})
    check("ines", "un usager ne peut pas donner le rôle admin", r.status_code == 403, r.status_code)
    if S:
        r, _ = call("PUT", f"/admin/users/{iid}/role", S, json={"role": "admin"})
        check("ines", "promue administratrice par le super admin", r.status_code == 200 and r.json()["role"] == "admin")
        log = call("GET", "/admin/log", S)[0].json()
        check("ines", "promotion inscrite au journal d'administration", log and log[0]["target"] == USERS["ines"]["email"], log[0]["detail"] if log else "")
    T = tok["ines"]
    for path in ("/admin/stats", "/admin/analysis", "/admin/data-health", "/admin/collect", "/collect/status"):
        r, dt = call("GET", path, T)
        check("ines", f"espace décideurs : {path}", r.status_code == 200, f"{dt}s")
    p = call("GET", "/admin/analysis", T)[0].json().get("projections") or {}
    check("ines", "chaleur à venir (TRACC) disponible", p.get("summaries"), list(p.get("summaries", {}))[:3])
    states = {k: v["state"] for k, v in call("GET", "/admin/collect", T)[0].json().items()}
    check("ines", "collectes de données à jour", all(s == "ok" for s in states.values()), states)
    for topic in ("traffic", "elevators", "reports", "pmr", "bike"):
        r, _ = call("GET", f"/admin/insights/{topic}", T)
        check("ines", f"synthèse « {topic} »", r.status_code == 200, r.status_code)
    for path, method in (("/admin/users", "GET"), ("/admin/log", "GET"), ("/admin/gtfs-refresh", "POST")):
        r, _ = call(method, path, T)
        check("ines", f"réservé au super admin : {path}", r.status_code == 403, r.status_code)

    # ---------- Fin ----------
    if keep:
        JETONS.write_text(json.dumps(tok), encoding="utf-8")
        print(f"Comptes gardés ; jetons dans {JETONS} (lancer --cleanup ensuite)")
    else:
        for who in USERS:
            r, _ = call("DELETE", "/me", tok[who])
            check(who, "suppression de son compte (RGPD)", r.status_code == 200 and call("GET", "/me", tok[who])[0].status_code == 401)
        cleanup()
    ko = [x for x in results if not x[2]]
    print(f"\nTotal : {len(results)} contrôles, {len(results) - len(ko)} réussis, {len(ko)} en échec")
    return 1 if ko else 0


if __name__ == "__main__":
    if "--cleanup" in sys.argv:
        cleanup()
        sys.exit(0)
    sys.exit(main(keep="--keep" in sys.argv))
