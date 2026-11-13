"""Comptes, mots de passe, jetons et chiffrement du profil de déplacement."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.fernet import Fernet

from .config import settings

LANGS = {"fr", "en", "es", "it", "zh"}
PROFILES = {"fauteuil", "marche_difficile", "malvoyant", "malentendant", "lecture_difficile", "sensible_climat"}
HAZARDS = {"chaleur", "grand_froid", "neige_verglas", "orages_pluie", "vent_fort", "crue", "ascenseur", "pollution"}
ROLES = {"user", "admin", "superadmin"}


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1)
    return base64.b64encode(salt + h).decode()


def check_password(pw: str, stored: str) -> bool:
    try:
        raw = base64.b64decode(stored)
    except ValueError:
        return False
    salt, h = raw[:16], raw[16:]
    return hmac.compare_digest(h, hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1))


# Empreinte factice : une connexion avec une adresse inconnue coûte le même temps qu'avec une vraie (sinon le temps de réponse révèle quelles adresses ont un compte)
_DUMMY_HASH = hash_password("mot-de-passe-factice")


def check_password_or_dummy(pw: str, stored: str | None) -> bool:
    if not stored:
        check_password(pw, _DUMMY_HASH)
        return False
    return check_password(pw, stored)


def make_token(user_id: str, token_version: int = 0) -> str:
    """Jeton de session. « tv » permet de révoquer toutes les sessions (changement de mot de passe)."""
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_minutes)
    return jwt.encode({"sub": user_id, "exp": exp, "tv": token_version, "use": "session"},
                      settings.jwt_secret, algorithm="HS256")


def read_token(token: str) -> dict:
    claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
    if claims.get("use", "session") != "session":
        raise jwt.InvalidTokenError("wrong_use")
    return claims


def _pw_fingerprint(stored_hash: str) -> str:
    # Change dès que le mot de passe change : le lien de réinitialisation ne sert qu'une fois
    return hashlib.sha256(stored_hash.encode()).hexdigest()[:16]


def make_reset_token(user: dict, minutes: int | None = None) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes or settings.reset_token_minutes)
    return jwt.encode({"sub": str(user["_id"]), "exp": exp, "use": "reset", "pw": _pw_fingerprint(user.get("password", ""))},
                      settings.jwt_secret, algorithm="HS256")


def read_reset_token(token: str) -> dict:
    claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
    if claims.get("use") != "reset":
        raise jwt.InvalidTokenError("wrong_use")
    return claims


def reset_token_matches(claims: dict, user: dict) -> bool:
    return hmac.compare_digest(claims.get("pw", ""), _pw_fingerprint(user.get("password", "")))


def verification_required() -> bool:
    """Adresse e-mail confirmée exigée avant toute connexion (désactivable seulement pour les tests)."""
    return os.environ.get("REQUIRE_EMAIL_VERIFICATION", "1") != "0"


def make_verify_token(user: dict, hours: int = 48) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=hours)
    return jwt.encode({"sub": str(user["_id"]), "exp": exp, "use": "verify", "em": user["email"]},
                      settings.jwt_secret, algorithm="HS256")


def read_verify_token(token: str) -> dict:
    claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
    if claims.get("use") != "verify":
        raise jwt.InvalidTokenError("wrong_use")
    return claims


def _fernet() -> Fernet:
    key = settings.profile_key or os.environ.get("PROFILE_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError("PROFILE_ENCRYPTION_KEY manquante : générer avec Fernet.generate_key()")
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_profile(profile: list[str]) -> str:
    return _fernet().encrypt(json.dumps(sorted(profile)).encode()).decode()


def decrypt_profile(blob: str | None) -> list[str]:
    return json.loads(_fernet().decrypt(blob.encode())) if blob else []


def first_screen(profile: list[str]) -> str:
    """Premier écran après l'inscription (cf. écran 02c de la maquette)."""
    if {"fauteuil", "marche_difficile", "malvoyant"} & set(profile):
        return "trajet_accessible"
    return "autour_de_moi"


def settings_for(profile: list[str]) -> dict:
    p = set(profile)
    return {
        "sans_marche": bool({"fauteuil", "marche_difficile"} & p),
        "contraste_eleve": "malvoyant" in p,
        "lecture_vocale": "malvoyant" in p,
        "alertes_visuelles": "malentendant" in p,
        "mode_simplifie": "lecture_difficile" in p,
        "alertes_meteo_renforcees": "sensible_climat" in p,
    }
