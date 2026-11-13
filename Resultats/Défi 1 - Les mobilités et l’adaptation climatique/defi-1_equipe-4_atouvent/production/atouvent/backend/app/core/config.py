"""Configuration lue dans les variables d'environnement (voir .env.example)."""
import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Lit backend/.env sans écraser les variables déjà définies (Docker, système, tests)."""
    if os.environ.get("ATOUVENT_NO_DOTENV") == "1" or not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


_load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


@dataclass(frozen=True)
class Settings:
    mongo_uri: str = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
    mongo_db: str = os.environ.get("MONGO_DB", "atouvent")

    # Sécurité : secrets obligatoires en production
    jwt_secret: str = os.environ.get("JWT_SECRET", "")
    jwt_minutes: int = _int("JWT_MINUTES", 60 * 24 * 7)
    # Clé Fernet (base64 32 octets) pour chiffrer le profil de déplacement (donnée de santé)
    profile_key: str = os.environ.get("PROFILE_ENCRYPTION_KEY", "")

    # Vélib' Métropole, flux GBFS publics (Licence Ouverte selon le producteur)
    velib_status_url: str = os.environ.get(
        "VELIB_STATUS_URL", "https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_status.json")
    velib_info_url: str = os.environ.get(
        "VELIB_INFO_URL", "https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_information.json")
    velib_every_min: int = _int("VELIB_EVERY_MIN", 1)          # le flux GBFS change chaque minute : on suit son rythme
    velib_heartbeat_min: int = _int("VELIB_HEARTBEAT_MIN", 60)  # on réécrit une station inchangée toutes les heures

    # État des ascenseurs IDFM : publié 3 fois par jour, inutile d'interroger plus souvent que toutes les 30 min
    elevators_url: str = os.environ.get(
        "ELEVATORS_URL",
        "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/etat-des-ascenseurs/exports/json")
    elevators_every_min: int = _int("ELEVATORS_EVERY_MIN", 5)
    # Le jeu est en accès restreint depuis 2026 : clé API du portail data.iledefrance-mobilites.fr (« Mon compte » > « Clés d'API »)
    idfm_api_key: str = os.environ.get("IDFM_API_KEY", "")
    elevators_heartbeat_min: int = _int("ELEVATORS_HEARTBEAT_MIN", 360)

    # PRIM (prochains passages). Vérifier l'URL et le nom d'en-tête dans la documentation PRIM.
    prim_url: str = os.environ.get("PRIM_URL", "https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring")
    prim_api_key: str = os.environ.get("PRIM_API_KEY", "")
    prim_daily_quota: int = _int("PRIM_DAILY_QUOTA", 1000)   # quota des jetons récents : à vérifier dans « My API Usage »
    prim_per_second: int = _int("PRIM_PER_SECOND", 5)
    departures_cache_s: int = _int("DEPARTURES_CACHE_S", 60)

    # Open-Meteo : sans clé, 10 000 appels/jour en usage non commercial (CC BY 4.0)
    open_meteo_url: str = os.environ.get("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast")
    weather_cache_min: int = _int("WEATHER_CACHE_MIN", 30)
    # Vigilance officielle Météo-France (facultatif) : clé gratuite sur portail-api.meteofrance.fr, API « DPVigilance »
    meteofrance_api_key: str = os.environ.get("METEOFRANCE_API_KEY", "")

    # Calcul d'itinéraire : OpenTripPlanner (facultatif) ; sinon calculateur intégré sur le GTFS IDFM (app/router)
    otp_url: str = os.environ.get("OTP_URL", "")

    # Géocodage IGN Géoplateforme (ex API Adresse), sans clé
    geocode_url: str = os.environ.get("GEOCODE_URL", "https://data.geopf.fr/geocodage/search/")

    # Origines autorisées : site web + application Android (Capacitor : https://localhost et capacitor://localhost)
    cors_origins: list = field(default_factory=lambda: os.environ.get(
        "CORS_ORIGINS", "http://localhost:5174,https://localhost,capacitor://localhost,http://localhost").split(","))
    # Derrière un proxy inverse (nginx, Caddy) : lire l'IP réelle dans X-Forwarded-For
    trust_proxy: bool = os.environ.get("TRUST_PROXY", "0") == "1"
    # Documentation interactive (/docs) : désactivée par défaut en production
    enable_docs: bool = os.environ.get("ENABLE_DOCS", "0") == "1"

    # Envoi des e-mails (réinitialisation du mot de passe, création du compte super admin)
    smtp_host: str = os.environ.get("SMTP_HOST", "")
    smtp_port: int = _int("SMTP_PORT", 465)
    smtp_ssl: bool = os.environ.get("SMTP_SSL", "1") == "1"   # 465 = SSL direct ; 587 = STARTTLS (SMTP_SSL=0)
    smtp_user: str = os.environ.get("SMTP_USER", "")
    smtp_password: str = os.environ.get("SMTP_PASSWORD", "")
    smtp_from: str = os.environ.get("SMTP_FROM", "") or os.environ.get("SMTP_USER", "")
    # Adresse publique de l'application, utilisée dans les liens envoyés par e-mail
    app_url: str = os.environ.get("APP_URL", "http://localhost:5174").rstrip("/")
    # Cookie de session « Secure » (HTTPS seulement) dès que le site est servi en HTTPS
    secure_cookies: bool = os.environ.get("SECURE_COOKIES", "1" if os.environ.get("APP_URL", "").startswith("https") else "0") == "1"
    reset_token_minutes: int = _int("RESET_TOKEN_MINUTES", 30)

    # Comptes super admin : rôle attribué automatiquement à ces adresses
    superadmin_emails: list = field(default_factory=lambda: [
        e.strip().lower() for e in os.environ.get("SUPERADMIN_EMAILS", "").split(",") if e.strip()])


settings = Settings()

# Valeurs d'exemple qui ne doivent jamais servir de secret
_PLACEHOLDERS = {"", "a-changer-en-production", "remplacer-par-une-longue-chaine-aleatoire"}


def check_secrets(s: Settings = settings) -> None:
    """Refuse de démarrer avec des secrets absents, d'exemple ou trop faibles."""
    from cryptography.fernet import Fernet

    problems = []
    if s.jwt_secret in _PLACEHOLDERS or len(s.jwt_secret) < 32:
        problems.append("JWT_SECRET doit faire au moins 32 caractères aléatoires "
                        "(python -c \"import secrets; print(secrets.token_urlsafe(48))\")")
    try:
        Fernet(s.profile_key.encode())
    except Exception:
        problems.append("PROFILE_ENCRYPTION_KEY absente ou invalide "
                        "(python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\")")
    if problems:
        raise RuntimeError("Configuration non sûre :\n- " + "\n- ".join(problems))
