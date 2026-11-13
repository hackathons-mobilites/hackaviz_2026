"""Adresse e-mail confirmée exigée avant toute connexion (sauf super admin et comptes marqués confirmés)."""
import re

import pytest

from app.core import security as sec
from app.services import mailer

API = "/api/v1"
PW = "motdepasse-solide-42"


@pytest.fixture
def sent(monkeypatch):
    monkeypatch.setenv("REQUIRE_EMAIL_VERIFICATION", "1")
    box = []
    monkeypatch.setattr(mailer, "send", lambda to, subject, body, lang="fr", button="password": box.append((to, body, button)) or True)
    return box


def link_token(body: str) -> str:
    return re.search(r"#(\S+)", body).group(1)


def test_inscription_sans_session_puis_confirmation(client, sent):
    r = client.post(f"{API}/auth/register", json={"email": "Lea@Exemple.fr", "password": PW, "alerts_on": False})
    assert r.status_code == 202 and r.json() == {"verify": True, "email": "lea@exemple.fr"} and "token" not in r.json()
    assert sent[0][0] == "lea@exemple.fr" and "/confirmer-email#" in sent[0][1] and sent[0][2] == "verify"
    # Bon mot de passe mais adresse non confirmée : refus
    r = client.post(f"{API}/auth/login", json={"email": "lea@exemple.fr", "password": PW})
    assert r.status_code == 403 and r.json()["detail"] == "email_not_verified"
    # Le lien ouvre le compte
    r = client.post(f"{API}/auth/verify-email", json={"token": link_token(sent[0][1])})
    assert r.status_code == 200 and r.json()["token"] and r.json()["user"]["alerts"] == []
    assert client.post(f"{API}/auth/login", json={"email": "lea@exemple.fr", "password": PW}).status_code == 200


def test_mauvais_mot_de_passe_ne_revele_pas_le_compte(client, sent):
    client.post(f"{API}/auth/register", json={"email": "x@exemple.fr", "password": PW})
    r = client.post(f"{API}/auth/login", json={"email": "x@exemple.fr", "password": "mauvais-mot-de-passe"})
    assert r.status_code == 401 and r.json()["detail"] == "bad_credentials"


def test_lien_invalide_ou_autre_usage(client, db, sent):
    assert client.post(f"{API}/auth/verify-email", json={"token": "nimporte.quoi.ici"}).status_code == 400
    client.post(f"{API}/auth/register", json={"email": "y@exemple.fr", "password": PW})
    user = db.users.find_one({"email": "y@exemple.fr"})
    # Un lien de mot de passe ne confirme pas l'adresse par cette route
    assert client.post(f"{API}/auth/verify-email", json={"token": sec.make_reset_token(user)}).status_code == 400


def test_renvoi_du_lien(client, sent):
    client.post(f"{API}/auth/register", json={"email": "z@exemple.fr", "password": PW})
    assert client.post(f"{API}/auth/resend-verification", json={"email": "z@exemple.fr"}).json() == {"sent": True}
    assert client.post(f"{API}/auth/resend-verification", json={"email": "inconnu@exemple.fr"}).json() == {"sent": True}
    assert [s[0] for s in sent] == ["z@exemple.fr", "z@exemple.fr"]


def test_comptes_dispenses(client, db, sent):
    # Super admin (SUPERADMIN_EMAILS) : ouvert tout de suite
    r = client.post(f"{API}/auth/register", json={"email": "chef@exemple.fr", "password": PW})
    assert r.status_code == 200 and r.json()["token"]
    # Compte marqué confirmé (compte du jury) : connexion directe
    client.post(f"{API}/auth/register", json={"email": "jury@exemple.fr", "password": PW})
    db.users.update_one({"email": "jury@exemple.fr"}, {"$set": {"email_verified": True}})
    assert client.post(f"{API}/auth/login", json={"email": "jury@exemple.fr", "password": PW}).status_code == 200


def test_ancienne_session_refusee_et_nouveau_mot_de_passe_confirme(client, db, sent):
    client.post(f"{API}/auth/register", json={"email": "w@exemple.fr", "password": PW})
    user = db.users.find_one({"email": "w@exemple.fr"})
    old = sec.make_token(str(user["_id"]), 0)
    r = client.get(f"{API}/me", headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 401 and r.json()["detail"] == "email_not_verified"
    # Le lien « nouveau mot de passe » arrive dans la même boîte : l'adresse est confirmée
    r = client.post(f"{API}/auth/reset-password", json={"token": sec.make_reset_token(user), "password": "un-autre-mot-de-passe-42"})
    assert r.status_code == 200 and db.users.find_one({"email": "w@exemple.fr"})["email_verified"] is True
