"""Prochains passages (PRIM via cache), itinéraires (OTP) et paquet hors ligne du trajet."""
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request

from ..core.ratelimit import limit
from bson import ObjectId
from bson.errors import InvalidId

from ..deps import db_dep, guard_dep, optional_user_dep
from ..schemas import LAT, LON, STOP_REF, BundleRequest, LiveRequest, PlanRequest, ReportRequest, VoteRequest
from ..services import carbon, geocode, live, planner, station_air, traffic, trips, walking
from ..services.prim import get_departures
from ..router import engine

router = APIRouter(tags=["transport"])


@router.get("/departures/{ref}", dependencies=[Depends(limit("departures"))])
def departures(ref: str = Path(pattern=STOP_REF), db=Depends(db_dep), guard=Depends(guard_dep)):
    try:
        return get_departures(db, ref, guard)
    except httpx.HTTPError:
        raise HTTPException(503, "departures_unavailable")


@router.get("/traffic")
def traffic_now(db=Depends(db_dep)):
    """Perturbations en cours sur le réseau ferré (PRIM), étiquetées météo, accessibilité, travaux."""
    try:
        return traffic.current(db)
    except traffic.TrafficUnavailable:
        raise HTTPException(503, "traffic_key_missing")
    except httpx.HTTPError:
        raise HTTPException(503, "traffic_unavailable")


@router.get("/geo/search", dependencies=[Depends(limit("geocode"))])
def geo_search(q: str = Query(max_length=200), db=Depends(db_dep)):
    if len(q.strip()) < 3:
        return []
    try:
        return geocode.search(db, q)
    except httpx.HTTPError:
        raise HTTPException(503, "geocode_unavailable")


def _enrich(db, its: list[dict]) -> None:
    """Ce que le voyageur doit savoir sur chaque trajet : chemins à pied réels, ascenseurs, accessibilité, crue, direct, CO2."""
    walking.enrich(db, its)  # vrais chemins à pied (IGN) avant l'ombre, les chantiers et les points noirs
    for it in its:
        trips.mark_elevators(db, it)
        trips.annotate_walks(db, it)
        it["lifts_unreliable"] = trips.unreliable_lifts(it)
        trips.verify_access(it)
        it["flood_stations"] = trips.flood_exposure(it)
    live.trip_context(db, its)
    carbon.annotate(db, its)  # empreinte CO2 (ADEME) et comparaison avec la voiture
    station_air.annotate(db, its)  # pollution aux particules sur les quais (Airparif via IDFM)


@router.post("/trips/plan", dependencies=[Depends(limit("plan"))])
def plan(body: PlanRequest, db=Depends(db_dep)):
    try:
        its = planner.plan((body.origin.lat, body.origin.lon), (body.destination.lat, body.destination.lon), body.accessible,
                           when=body.depart_at, names=(body.origin.name or "Départ", body.destination.name or "Arrivée"),
                           modes=body.modes, db=db, walk=body.walk)
    except planner.PlannerUnavailable:
        raise HTTPException(503, "planner_unavailable")
    except httpx.HTTPError:
        raise HTTPException(502, "planner_error")
    _enrich(db, its)
    if body.accessible and its and all(it["elevators_out"] for it in its if it["source"] not in ("walk", "bike", "velib")):
        # Sans marche, et toutes les solutions passent par un ascenseur en panne : on cherche un trajet qui évite ces gares
        avoid = {e["station"] for it in its for e in it["elevators_out"]}
        try:
            alt = planner.transit((body.origin.lat, body.origin.lon), (body.destination.lat, body.destination.lon), True,
                                  (body.depart_at or datetime.now(timezone.utc)).astimezone(engine.PARIS),
                                  names=(body.origin.name or "Départ", body.destination.name or "Arrivée"),
                                  rail="rail" in body.modes, bus="bus" in body.modes, slow=True, avoid=avoid)
        except planner.PlannerUnavailable:
            alt = []
        for it in alt:
            it["source"], it["avoids"] = "avoid_lift", sorted(avoid)
        _enrich(db, alt)
        its += alt
    if body.accessible:
        # Les trajets touchés par une panne d'ascenseur passent en dernier
        its.sort(key=lambda it: bool(it["elevators_out"]))
    return {"itineraries": its, "depart_at": body.depart_at}


@router.post("/trips/bundle", dependencies=[Depends(limit("bundle"))])
def bundle(body: BundleRequest, db=Depends(db_dep), guard=Depends(guard_dep)):
    """À appeler au départ : le téléphone garde ce paquet pour la partie sans réseau."""
    return trips.build_bundle(db, body.trip.model_dump(mode="json", by_alias=True), guard)


@router.post("/trips/live", dependencies=[Depends(limit("live"))])
def trip_live(body: LiveRequest, db=Depends(db_dep), guard=Depends(guard_dep)):
    """Pendant le trajet (toutes les minutes) : perturbations des lignes, passage en temps réel à la prochaine montée, ascenseurs en panne et signalements des autres voyageurs."""
    return live.live(db, body.trip.model_dump(mode="json", by_alias=True), body.next_leg, guard)


@router.get("/reports/near", dependencies=[Depends(limit("nearby"))])
def reports_near(lat: float = Query(**LAT), lon: float = Query(**LON), radius_m: int = Query(800, ge=50, le=3000), db=Depends(db_dep)):
    return live.reports_near(db, [(lat, lon)], radius=radius_m)


@router.post("/reports", dependencies=[Depends(limit("report"))])
def add_report(body: ReportRequest, db=Depends(db_dep), user=Depends(optional_user_dep)):
    """Signalement d'un voyageur (ouvert sans compte, limité à 10 par tranche de 10 minutes)."""
    return live.add_report(db, body.kind, body.lat, body.lon, body.line, body.stop, str(user["_id"]) if user else None)


@router.post("/reports/{report_id}/vote", dependencies=[Depends(limit("vote"))])
def vote_report(report_id: str, body: VoteRequest, db=Depends(db_dep)):
    try:
        rid = ObjectId(report_id)
    except (InvalidId, TypeError):
        raise HTTPException(404, "report_not_found")
    out = live.vote(db, rid, body.still)
    if out is None:
        raise HTTPException(404, "report_not_found")
    return out


@router.get("/stops/near", dependencies=[Depends(limit("nearby"))])
def stops_near(lat: float = Query(**LAT), lon: float = Query(**LON), radius_m: int = Query(400, ge=50, le=1500), db=Depends(db_dep)):
    """Arrêts de bus, tram et gares à proximité : pictogramme, lignes, abri, accessibilité, annonces."""
    from ..router import engine
    try:
        stops = engine.stops_near(lat, lon, radius_m)
    except engine.RouterUnavailable:
        raise HTTPException(503, "planner_unavailable")
    # Gares et stations : qualité de l'air sur les quais (la ligne la plus défavorable de la gare)
    try:
        air = station_air.load(db)
    except httpx.HTTPError:
        air = []
    for s in stops:
        if s["kind"] in ("metro", "rail") and (found := station_air.for_stop(air, s["lat"], s["lon"])):
            s["info"].update(found)
    return stops



@router.get("/stream")
async def stream(request: Request, lat: float = Query(**LAT), lon: float = Query(**LON),
                 lines: str = Query("", max_length=400, pattern=r"^[A-Za-z0-9,]*$"), db=Depends(db_dep)):
    """Flux en direct (Server-Sent Events) : climat, perturbations des lignes suivies, ascenseurs, Vélib', signalements."""
    from fastapi.responses import StreamingResponse
    from ..services import stream as live_stream
    wanted = {x for x in lines.split(",") if x}
    return StreamingResponse(live_stream.events(db, lat, lon, wanted, request.is_disconnected), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})
