"""Dépendances partagées par les routes : base, garde-fou PRIM, limiteur, utilisateur connecté, rôles."""
from __future__ import annotations

import jwt
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, Header, HTTPException, Request

from .core import security as sec
from .core.config import settings
from .core.db import get_db, init_db
from .core.ratelimit import RateLimiter
from .services.prim import QuotaGuard

_state: dict = {}


def db_dep():
    if "db" not in _state:
        _state["db"] = get_db()
        init_db(_state["db"])
    return _state["db"]


def guard_dep(db=Depends(db_dep)) -> QuotaGuard:
    if "guard" not in _state:
        _state["guard"] = QuotaGuard(db, settings.prim_daily_quota, settings.prim_per_second)
    return _state["guard"]


def limiter_dep() -> RateLimiter:
    if "limiter" not in _state:
        _state["limiter"] = RateLimiter()
    return _state["limiter"]


SESSION_COOKIE = "atv_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def session_token(request: Request, authorization: str = "") -> str | None:
    """Jeton de session : en-tête « Authorization: Bearer » (application Android) ou cookie HttpOnly (site web)."""
    if authorization.startswith("Bearer "):
        return authorization[7:]
    token = request.cookies.get(SESSION_COOKIE)
    if token and request.method not in SAFE_METHODS and request.headers.get("x-requested-with") != "AtouVent":
        raise HTTPException(403, "csrf")
    return token


def user_dep(request: Request, authorization: str = Header(default=""), db=Depends(db_dep)) -> dict:
    token = session_token(request, authorization)
    if not token:
        raise HTTPException(401, "auth_required")
    try:
        claims = sec.read_token(token)
        uid = ObjectId(claims["sub"])
    except (jwt.InvalidTokenError, InvalidId, TypeError):
        raise HTTPException(401, "session_expired")
    user = db.users.find_one({"_id": uid})
    if not user:
        raise HTTPException(401, "account_not_found")
    # Mot de passe changé depuis : toutes les anciennes sessions sont fermées
    if claims.get("tv", 0) != user.get("token_version", 0):
        raise HTTPException(401, "session_expired")
    # Adresse e-mail pas encore confirmée : aucune session ne vaut (y compris une session ouverte avant la règle)
    if needs_verification(user):
        raise HTTPException(401, "email_not_verified")
    return user


def role_of(user: dict) -> str:
    if user.get("email") in settings.superadmin_emails:
        return "superadmin"
    return user.get("role", "user")


def needs_verification(user: dict) -> bool:
    """Vrai tant que l'adresse e-mail n'est pas confirmée (le super admin défini dans SUPERADMIN_EMAILS en est dispensé)."""
    return sec.verification_required() and not user.get("email_verified") and role_of(user) != "superadmin"


def optional_user_dep(request: Request, authorization: str = Header(default=""), db=Depends(db_dep)) -> dict | None:
    """Utilisateur connecté s'il y en a un, sinon None (routes ouvertes aussi aux visiteurs)."""
    try:
        return user_dep(request, authorization, db)
    except HTTPException:
        return None


def admin_dep(user=Depends(user_dep)) -> dict:
    if role_of(user) not in ("admin", "superadmin"):
        raise HTTPException(403, "forbidden")
    return user


def superadmin_dep(user=Depends(user_dep)) -> dict:
    if role_of(user) != "superadmin":
        raise HTTPException(403, "forbidden")
    return user


def clean(doc: dict) -> dict:
    """Retire les champs internes avant de renvoyer un document."""
    return {k: (str(v) if k == "_id" else v) for k, v in doc.items() if k not in ("raw", "hash")}
