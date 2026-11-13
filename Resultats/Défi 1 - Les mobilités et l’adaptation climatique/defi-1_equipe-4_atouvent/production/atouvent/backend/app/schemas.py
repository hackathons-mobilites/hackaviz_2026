"""Modèles d'entrée de l'API (validation Pydantic)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

# Boîte englobant l'Île-de-France (avec une marge)
LAT = {"ge": 48.0, "le": 49.5}
LON = {"ge": 1.4, "le": 3.6}
# Référence d'arrêt IDFM / PRIM (ex. STIF:StopPoint:Q:41322:, IDFM:monomodalStopPlace:47900)
STOP_REF = r"^(STIF|IDFM):[A-Za-z0-9:_.\-]{1,100}$"


def _password():
    # max : évite un calcul scrypt sur un texte énorme
    return Field(min_length=12, max_length=128)


class Register(BaseModel):
    email: EmailStr  # email-validator limite déjà la longueur
    password: str = _password()
    language: str = "fr"
    profile_consent: bool = False
    profile: list[str] = Field(default=[], max_length=10)  # vide = « non » ou « je préfère ne pas répondre »
    alerts_on: bool = True  # alertes météo choisies à l'inscription (pas de session avant la confirmation de l'adresse)


class VerifyEmail(BaseModel):
    token: str = Field(max_length=2000)


class Login(BaseModel):
    email: EmailStr  # email-validator limite déjà la longueur
    password: str = Field(max_length=128)


class ForgotPassword(BaseModel):
    email: EmailStr  # email-validator limite déjà la longueur


class ResetPassword(BaseModel):
    token: str = Field(max_length=2000)
    password: str = _password()


class ChangePassword(BaseModel):
    current_password: str = Field(max_length=128)
    password: str = _password()


class Preferences(BaseModel):
    language: str | None = None
    alerts: list[str] | None = Field(default=None, max_length=20)
    offline: bool | None = None
    text_size: int | None = Field(default=None, ge=1, le=3)
    high_contrast: bool | None = None
    voice: bool | None = None
    vibrate: bool | None = None
    profile_consent: bool | None = None
    profile: list[str] | None = Field(default=None, max_length=10)


class SavedPlace(BaseModel):
    """Destination enregistrée (« Travail », « Chez ma mère »…) : le départ reste la position du moment."""
    name: str = Field(min_length=1, max_length=80)
    label: str = Field(default="", max_length=200)
    lat: float = Field(**LAT)
    lon: float = Field(**LON)


class RoleUpdate(BaseModel):
    role: str


class Point(BaseModel):
    lat: float = Field(**LAT)
    lon: float = Field(**LON)
    name: str | None = Field(default=None, max_length=200)


class PlanRequest(BaseModel):
    origin: Point
    destination: Point
    accessible: bool = False
    # rail : métro, RER, train, tram · bus · bike : Vélib' ou vélo personnel · walk : à pied
    modes: list[Literal["rail", "bus", "bike", "walk"]] = Field(default=["rail", "bus", "bike", "walk"], min_length=1, max_length=4)
    # slow : fauteuil, marche difficile, malvoyant (3 km/h au lieu de 4,5)
    walk: Literal["normal", "slow"] = "normal"
    # Trajet à venir : heure de départ souhaitée (au plus 30 jours à l'avance, horaires publiés) ; absent = maintenant
    depart_at: datetime | None = None

    @field_validator("depart_at")
    @classmethod
    def _future(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return None
        v = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        if v < now - timedelta(minutes=15) or v > now + timedelta(days=30):
            raise ValueError("depart_at_out_of_range")
        return v


# Trajet renvoyé par /trips/plan, que le téléphone renvoie tel quel à /trips/bundle
class Place(BaseModel):
    name: str = Field(max_length=200)
    lat: float = Field(**LAT)
    lon: float = Field(**LON)
    stop_id: str | None = Field(default=None, pattern=STOP_REF)
    quay_id: str | None = Field(default=None, pattern=STOP_REF)
    # Équipements de l'arrêt (abri, annonces, accessibilité…) : nombres ou textes courts
    info: dict[str, float | str] | None = Field(default=None, max_length=20)


class Stop(Place):
    time: datetime | None = None


class Leg(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    mode: str = Field(pattern=r"^[A-Z_]{2,20}$")
    line: str | None = Field(default=None, max_length=40)
    headsign: str | None = Field(default=None, max_length=200)
    direction: str | None = Field(default=None, max_length=200)  # terminus de la course (lisible, contrairement aux codes de mission RER)
    start: datetime
    end: datetime
    from_: Place = Field(alias="from")
    to: Place
    stops: list[Stop] = Field(default=[], max_length=80)
    underground: bool = False
    route_id: str | None = Field(default=None, max_length=40)
    shade: float | None = Field(default=None, ge=0, le=1)  # ombre des arbres sur une étape à pied
    wheelchair: int | None = Field(default=None, ge=0, le=2)  # véhicule accessible (GTFS) : 1 oui, 2 non, 0 inconnu
    geometry: list[list[float]] | None = Field(default=None, max_length=2000)  # tracé réel [[lon, lat], …]
    entrance: str | None = Field(default=None, max_length=200)  # entrée de gare conseillée
    distance_m: float | None = None
    color: str | None = Field(default=None, max_length=8)
    text_color: str | None = Field(default=None, max_length=8)


class Trip(BaseModel):
    start: datetime
    end: datetime
    accessible: bool = False
    accessible_requested: bool = False
    source: str | None = Field(default=None, max_length=20)
    legs: list[Leg] = Field(min_length=1, max_length=20)
    velib: dict[str, int | None] | None = None
    works: list[dict[str, str | float | bool | None]] | None = Field(default=None, max_length=20)
    access: dict | None = None
    hotspots: list[dict] | None = Field(default=None, max_length=10)
    disruptions: list[dict] | None = Field(default=None, max_length=10)
    carbon: dict[str, float] | None = None
    reports: list[dict] | None = Field(default=None, max_length=50)
    lifts_unreliable: list[dict] | None = Field(default=None, max_length=10)
    flood_stations: list[str] | None = Field(default=None, max_length=20)


class LiveRequest(BaseModel):
    trip: Trip
    next_leg: int = Field(default=0, ge=0, le=20)


class ReportRequest(BaseModel):
    kind: Literal["delay", "crowded", "hot", "elevator", "not_served", "works", "obstacle"]
    lat: float = Field(**LAT)
    lon: float = Field(**LON)
    line: str | None = Field(default=None, max_length=40)
    stop: str | None = Field(default=None, max_length=200)


class VoteRequest(BaseModel):
    still: bool


class BundleRequest(BaseModel):
    trip: Trip
