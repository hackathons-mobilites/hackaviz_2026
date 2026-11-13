"""Compte : inscription, connexion, mot de passe, préférences et droits RGPD (export, suppression)."""
import secrets
from datetime import datetime, timezone

import jwt
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response

from ..core import security as sec
from ..core.ratelimit import limit
from ..core.config import settings
from ..deps import SESSION_COOKIE, db_dep, limiter_dep, needs_verification, role_of, user_dep
from ..schemas import ChangePassword, ForgotPassword, Login, Preferences, Register, ResetPassword, SavedPlace, VerifyEmail
from ..services import mailer

router = APIRouter(tags=["compte"])

MAX_PLACES = 10


def profile_defaults(profile: list[str]) -> dict:
    """Réglages activés d'office selon le profil (l'usager peut ensuite les changer) : malvoyant → voix, contraste renforcé, grand texte ; malentendant → vibration."""
    p = set(profile)
    out = {}
    if "malvoyant" in p:
        out.update(voice=True, high_contrast=True, text_size=3)
    if "malentendant" in p:
        out.update(vibrate=True)
    if "lecture_difficile" in p:
        out.update(text_size=3)
    return out
DEFAULT_ALERTS = ["chaleur", "grand_froid", "neige_verglas", "orages_pluie", "vent_fort", "ascenseur"]


def public(user: dict) -> dict:
    profile = sec.decrypt_profile(user.get("profile_enc"))
    return {"email": user["email"], "role": role_of(user), "language": user.get("language", "fr"),
            "alerts": user.get("alerts", []), "places": user.get("places", []),
            "offline": user.get("offline", True), "text_size": user.get("text_size", 2),
            "high_contrast": user.get("high_contrast", False), "voice": user.get("voice", False),
            "vibrate": user.get("vibrate", True), "profile": profile,
            "profile_consent_at": user.get("profile_consent_at"),
            "settings": sec.settings_for(profile), "first_screen": sec.first_screen(profile)}


def session(user: dict, request: Request, response: Response) -> dict:
    """Ouvre une session."""
    token = sec.make_token(str(user["_id"]), user.get("token_version", 0))
    response.set_cookie(SESSION_COOKIE, token, max_age=settings.jwt_minutes * 60, httponly=True, samesite="strict",
                        secure=settings.secure_cookies, path="/api")
    out = {"user": public(user)}
    if request.headers.get("x-atouvent-client") == "native":
        out["token"] = token
    return out


def check(p: Preferences | Register) -> None:
    if p.language and p.language not in sec.LANGS:
        raise HTTPException(422, "unknown_language")
    if p.profile and not set(p.profile) <= sec.PROFILES:
        raise HTTPException(422, "unknown_profile")
    if p.profile and not p.profile_consent:
        raise HTTPException(422, "consent_required")
    if getattr(p, "alerts", None) and not set(p.alerts) <= sec.HAZARDS:
        raise HTTPException(422, "unknown_alert")


@router.post("/auth/register", dependencies=[Depends(limit("register"))])
def register(body: Register, request: Request, response: Response, tasks: BackgroundTasks, db=Depends(db_dep)):
    check(body)
    email = body.email.lower()
    if db.users.find_one({"email": email}):
        raise HTTPException(409, "email_taken")
    now = datetime.now(timezone.utc)
    verify = sec.verification_required()
    doc = {"email": email, "password": sec.hash_password(body.password), "language": body.language,
           "created_at": now, "alerts": DEFAULT_ALERTS if body.alerts_on else [], "offline": True, "role": "user",
           "token_version": 0, "email_verified": not verify}
    if body.profile:
        doc["profile_enc"] = sec.encrypt_profile(body.profile)
        doc["profile_consent_at"] = now
        doc.update(profile_defaults(body.profile))
    uid = db.users.insert_one(doc).inserted_id
    user = db.users.find_one({"_id": uid})
    if verify and needs_verification(user):
        # Pas de session : le compte s'ouvre en cliquant sur le lien reçu par e-mail
        tasks.add_task(send_verification, user)
        response.status_code = 202
        return {"verify": True, "email": email}
    return session(user, request, response)


def send_verification(user: dict) -> bool:
    lang = user.get("language", "fr")
    link = mailer.verify_link(sec.make_verify_token(user))
    return mailer.send(user["email"], mailer.text(lang, "verify_subject"), mailer.text(lang, "verify_body", link=link, hours=48),
                       lang, button="verify")


@router.post("/auth/verify-email", dependencies=[Depends(limit("login"))])
def verify_email(body: VerifyEmail, request: Request, response: Response, db=Depends(db_dep)):
    """Lien reçu par e-mail : l'adresse est confirmée et le compte s'ouvre."""
    try:
        claims = sec.read_verify_token(body.token)
        user = db.users.find_one({"_id": ObjectId(claims["sub"])})
    except (jwt.InvalidTokenError, InvalidId, TypeError):
        raise HTTPException(400, "verify_invalid")
    if not user or claims.get("em") != user["email"]:
        raise HTTPException(400, "verify_invalid")
    now = datetime.now(timezone.utc)
    if not user.get("email_verified"):
        db.users.update_one({"_id": user["_id"]}, {"$set": {"email_verified": True, "email_verified_at": now}})
    db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": now}})
    return session(db.users.find_one({"_id": user["_id"]}), request, response)


@router.post("/auth/resend-verification", dependencies=[Depends(limit("email"))])
def resend_verification(body: ForgotPassword, tasks: BackgroundTasks, db=Depends(db_dep)):
    """Renvoie le lien de confirmation. Réponse identique que le compte existe ou non."""
    user = db.users.find_one({"email": body.email.lower()})
    if user and needs_verification(user):
        tasks.add_task(send_verification, user)
    return {"sent": True}


@router.post("/auth/login", dependencies=[Depends(limit("login"))])
def login(body: Login, request: Request, response: Response, db=Depends(db_dep)):
    # En plus de la limite par adresse IP : 20 essais par heure et par compte (essais répartis sur plusieurs adresses)
    if limiter_dep().hit("login_account", body.email.lower()) is not None:
        raise HTTPException(429, "too_many_requests")
    user = db.users.find_one({"email": body.email.lower()})
    # Même coût de calcul que l'adresse existe ou non
    if not sec.check_password_or_dummy(body.password, (user or {}).get("password")):
        raise HTTPException(401, "bad_credentials")
    # Bon mot de passe mais adresse pas encore confirmée : pas de connexion
    if needs_verification(user):
        raise HTTPException(403, "email_not_verified")
    db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": datetime.now(timezone.utc)}})
    return session(user, request, response)


@router.post("/auth/logout")
def logout(response: Response):
    """Déconnexion de cet appareil : le cookie de session est effacé (les autres appareils restent connectés)."""
    response.delete_cookie(SESSION_COOKIE, path="/api", httponly=True, samesite="strict", secure=settings.secure_cookies)
    return {"ok": True}


@router.post("/auth/forgot-password", dependencies=[Depends(limit("email"))])
def forgot_password(body: ForgotPassword, tasks: BackgroundTasks, db=Depends(db_dep)):
    """Envoie un lien de réinitialisation. Réponse identique que le compte existe ou non."""
    user = db.users.find_one({"email": body.email.lower()})
    if user:
        token = sec.make_reset_token(user)
        lang = user.get("language", "fr")
        tasks.add_task(mailer.send, user["email"], mailer.text(lang, "reset_subject"),
                       mailer.text(lang, "reset_body", link=mailer.reset_link(token),
                                   minutes=sec.settings.reset_token_minutes), lang)
    return {"sent": True}


@router.post("/auth/reset-password", dependencies=[Depends(limit("login"))])
def reset_password(body: ResetPassword, request: Request, response: Response, db=Depends(db_dep)):
    try:
        claims = sec.read_reset_token(body.token)
        user = db.users.find_one({"_id": ObjectId(claims["sub"])})
    except (jwt.InvalidTokenError, InvalidId, TypeError):
        raise HTTPException(400, "reset_invalid")
    if not user or not sec.reset_token_matches(claims, user):
        raise HTTPException(400, "reset_invalid")
    # Le lien est arrivé dans la boîte de l'usager : l'adresse est confirmée du même coup
    db.users.update_one({"_id": user["_id"]}, {"$set": {"password": sec.hash_password(body.password), "email_verified": True},
                                               "$inc": {"token_version": 1}})
    return session(db.users.find_one({"_id": user["_id"]}), request, response)


@router.post("/me/password", dependencies=[Depends(limit("login"))])
def change_password(body: ChangePassword, request: Request, response: Response, user=Depends(user_dep),
                    db=Depends(db_dep)):
    if not sec.check_password(body.current_password, user["password"]):
        raise HTTPException(401, "bad_credentials")
    # Le lien est arrivé dans la boîte de l'usager : l'adresse est confirmée du même coup
    db.users.update_one({"_id": user["_id"]}, {"$set": {"password": sec.hash_password(body.password), "email_verified": True},
                                               "$inc": {"token_version": 1}})
    # Les autres appareils sont déconnectés ; celui-ci reçoit un nouveau jeton
    return session(db.users.find_one({"_id": user["_id"]}), request, response)


@router.get("/me")
def me(user=Depends(user_dep)):
    return public(user)


@router.put("/me/preferences")
def update_preferences(body: Preferences, user=Depends(user_dep), db=Depends(db_dep)):
    check(body)
    upd = {k: v for k, v in body.model_dump().items() if v is not None and k not in ("profile", "profile_consent")}
    ops: dict = {}
    if body.profile is not None:
        if body.profile:
            upd["profile_enc"] = sec.encrypt_profile(body.profile)
            upd["profile_consent_at"] = datetime.now(timezone.utc)
            # Réglages du profil, sauf ceux que l'usager envoie lui-même dans la même requête
            upd = {**profile_defaults(body.profile), **upd}
        else:  # retrait du consentement : on efface le profil
            ops["$unset"] = {"profile_enc": "", "profile_consent_at": ""}
    if upd:
        ops["$set"] = upd
    if ops:
        db.users.update_one({"_id": user["_id"]}, ops)
    return public(db.users.find_one({"_id": user["_id"]}))


@router.post("/me/places")
def add_place(body: SavedPlace, user=Depends(user_dep), db=Depends(db_dep)):
    """Enregistre une destination (10 au plus) ; une destination déjà enregistrée au même endroit est renommée."""
    places = [p for p in user.get("places", []) if (round(p["lat"], 5), round(p["lon"], 5)) != (round(body.lat, 5), round(body.lon, 5))]
    if len(places) >= MAX_PLACES:
        raise HTTPException(409, "too_many_places")
    places.append({"id": secrets.token_hex(6), **body.model_dump()})
    db.users.update_one({"_id": user["_id"]}, {"$set": {"places": places}})
    return public(db.users.find_one({"_id": user["_id"]}))


@router.delete("/me/places/{place_id}")
def remove_place(place_id: str, user=Depends(user_dep), db=Depends(db_dep)):
    db.users.update_one({"_id": user["_id"]}, {"$pull": {"places": {"id": place_id}}})
    return public(db.users.find_one({"_id": user["_id"]}))


@router.get("/me/export")
def export(user=Depends(user_dep)):
    return {**public(user), "created_at": user.get("created_at")}


@router.delete("/me")
def delete_me(response: Response, user=Depends(user_dep), db=Depends(db_dep)):
    if role_of(user) == "superadmin":
        # Le super admin défini dans SUPERADMIN_EMAILS serait recréé : on le retire d'abord de la configuration
        raise HTTPException(409, "superadmin_cannot_delete")
    db.users.delete_one({"_id": user["_id"]})
    response.delete_cookie(SESSION_COOKIE, path="/api")
    return {"deleted": True}
