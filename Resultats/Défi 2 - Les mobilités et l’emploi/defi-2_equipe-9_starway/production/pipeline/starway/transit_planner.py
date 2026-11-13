"""Itinéraires TC détaillés avec R5 (côté Java), pour 04h_transit_itineraries.py.

On n'utilise pas `r5py.DetailedItineraries` tel quel : trois de ses réglages ne sont pas ceux de la matrice publiée
(`TravelTimeMatrix`, réglage de marche D-024), lecture du code r5py 1.1.7 et R5 v7.5.1-r5py, 03/11/2026 :
- accès et sortie à pied bornés à 60 min (`TripPlanner.MAX_ACCESS_TIME`) et aux 200 arrêts les plus proches
  (`transitStopSearch`, `PointToPointQuery.MAX_ACCESS_STOPS`), au lieu de `max_time_walking` (50 min) sans plafond
  d'arrêts dans la matrice (`TravelTimeComputer`) ;
- fenêtre de départ : `McRaptorSuboptimalPathProfileRouter` tire `monteCarloDraws` (60 dans r5py) départs dans la
  fenêtre ; avec la fenêtre de 1 min de la matrice, le pas moyen vaut 1 s et le pas minimal 0 s : la boucle de tirage
  ne se termine pas. On demande 1 tirage dans une fenêtre de 2 s : départ à t ou t + 1 s (graine fixée par R5 sur la
  latitude d'origine, donc reproductible) ; la durée est comptée depuis t, comme la matrice ;
- trajets directs (marche, voiture) : `StreetRouter` avec destination, donc recherche A* dont l'heuristique divise la
  distance à vol d'oiseau par `ProfileRequest.getSpeedForMode`. Pour la voiture, r5py ne fixe pas `carSpeed`, qui vaut
  2,22 m/s (8 km/h) par défaut : l'heuristique surestime le temps restant (elle n'est plus minorante) et la recherche
  rend un chemin qui file vers la destination au lieu du plus rapide. C'est la cause des durées voiture 2,15 fois plus
  longues que la matrice (04g). Pour la marche, la vitesse de la requête est celle des arêtes : heuristique exacte.

Ce module reprend donc la logique de `r5py.r5.trip_planner.TripPlanner` avec les réglages de la matrice, et lit
directement les états McRAPTOR (course `trip`, positions dans la mission) pour retrouver le `trip_id` GTFS.
Aucune géométrie n'est produite (l'étoile filante n'est pas un tracé) : seulement les distances (marche : longueur du
chemin R5 ; TC : longueur géodésique des tronçons de `shapes.txt` découpés par R5 entre les arrêts).

Tout appel ici suppose la JVM démarrée par r5py (import de r5py fait par l'appelant après `configure_java`).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any

from pyproj import Geod

GEOD = Geod(ellps="WGS84")
FIXED_FACTOR = 1e7  # VertexStore.FIXED_FACTOR de R5 (coordonnées entières en 1e-7 degré)


@dataclass
class StopSearch:
    """Résultat d'une recherche à pied vers (ou depuis) les arrêts : temps (s) et distance (m) par arrêt R5."""

    times: dict[int, int]
    dists: dict[int, float]
    jmap: Any  # TIntIntHashMap passé à McRAPTOR


@dataclass
class Planner:
    network: Any  # r5py.TransportNetwork
    walk_limit_s: int  # max_time_walking du réglage (D-024), en secondes
    speed_walking_kmh: float
    max_trip_min: int
    max_rides: int
    service_date: date
    # Banc fauteuil (04l) : active `ProfileRequest.wheelchair` du jar R5 (arêtes `ALLOWS_WHEELCHAIR`, arrêts
    # `wheelchair_boarding` = 1, courses `wheelchair_accessible` = 1) pour McRAPTOR ; faux par défaut = calcul publié.
    wheelchair: bool = False
    _hop_cache: dict[int, list[float]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def __post_init__(self) -> None:
        import com.conveyal.r5  # type: ignore[import-not-found]
        import r5py

        self.r5 = com.conveyal.r5
        self.jnet = self.network._transport_network
        self.jsl = self.jnet.streetLayer
        self.jtl = self.jnet.transitLayer
        self.TM = r5py.TransportMode
        self.base = r5py.RegionalTask(
            self.network, origin=None, destinations=None, departure=datetime.combine(self.service_date, time(0, 0)),
            departure_time_window=timedelta(minutes=1), percentiles=[50],
            transport_modes=[self.TM.TRANSIT, self.TM.WALK], access_modes=[self.TM.WALK], egress_modes=[self.TM.WALK],
            max_time=timedelta(minutes=self.max_trip_min), max_time_walking=timedelta(seconds=self.walk_limit_s),
            speed_walking=self.speed_walking_kmh, max_public_transport_rides=self.max_rides,
        )._regional_task
        if self.wheelchair:  # champ public Java de ProfileRequest, copié par clone() dans chaque recherche
            self.base.wheelchair = True
        import jpype

        rv = jpype.JClass("com.conveyal.r5.streets.StreetRouter$State$RoutingVariable")
        self.DURATION, self.DISTANCE = rv.DURATION_SECONDS, rv.DISTANCE_MILLIMETERS
        self.walk_mps = self.speed_walking_kmh / 3.6
        self.n_stops = int(self.jtl.getStopCount())

    # ------------------------------------------------------------------ recherches à pied
    def _task(self) -> Any:
        return self.base.clone()

    def stop_search(self, lat: float, lon: float, reverse: bool) -> StopSearch | None:
        """Accès (reverse=False, depuis le point) ou sortie (reverse=True, vers le point), comme la matrice :
        - accès (`TravelTimeComputer`) : recherche à pied qui minimise la durée, bornée à `walk_limit_s` (inégalité
          stricte de R5), tous les arrêts atteints ;
        - sortie (`EgressCostTable` + `PerTargetPropagater`) : distance à pied minimale, bornée à la limite de distance
          du jar (`WALK_DISTANCE_LIMIT_METERS`), convertie en secondes par division entière par la vitesse de marche
          (mm/s), gardée si strictement inférieure à `walk_limit_s`."""
        import gnu.trove.map.hash  # type: ignore[import-not-found]

        r5 = self.r5
        req = self._task()
        req.reverseSearch = bool(reverse)
        sr = r5.streets.StreetRouter(self.jsl)
        sr.profileRequest = req
        sr.streetMode = r5.profile.StreetMode.WALK
        if reverse:
            sr.quantityToMinimize = self.DISTANCE
            sr.distanceLimitMeters = int(self.r5.transit.TransitLayer.WALK_DISTANCE_LIMIT_METERS)
        else:
            sr.quantityToMinimize = self.DURATION
            sr.timeLimitSeconds = int(self.walk_limit_s)
        if not sr.setOrigin(float(lat), float(lon)):
            return None
        sr.route()
        reached = sr.getReachedStops()
        speed_mm_s = int(req.getSpeedForMode(r5.profile.StreetMode.WALK) * 1000)
        times: dict[int, int] = {}
        dists: dict[int, float] = {}
        jmap = reached if not reverse else gnu.trove.map.hash.TIntIntHashMap()
        it = reached.iterator()
        while it.hasNext():
            it.advance()
            stop, v = int(it.key()), int(it.value())
            if reverse:
                t = v // speed_mm_s
                if t >= self.walk_limit_s:
                    continue
                jmap.put(stop, t)
                times[stop], dists[stop] = t, v / 1000.0
            else:
                times[stop] = v
                st = sr.getStateAtVertex(int(self.jtl.streetVertexForStop.get(stop)))
                dists[stop] = float(st.distance) / 1000.0 if st is not None else float("nan")
        return StopSearch(times=times, dists=dists, jmap=jmap)

    def direct_walk(self, o: tuple[float, float], d: tuple[float, float]) -> tuple[int, float] | None:
        """Trajet tout à pied (inclus dans le mode TC de la matrice, borné à `walk_limit_s`) : (durée s, distance m).
        Sauté si la distance à vol d'oiseau dépasse déjà la limite (la marche sur le réseau est plus longue)."""
        crow = GEOD.inv(o[1], o[0], d[1], d[0])[2]
        if crow / self.walk_mps >= self.walk_limit_s:
            return None
        r5 = self.r5
        sr = r5.streets.StreetRouter(self.jsl)
        sr.profileRequest = self._task()
        sr.streetMode = r5.profile.StreetMode.WALK
        sr.timeLimitSeconds = int(self.walk_limit_s)
        if not sr.setOrigin(float(o[0]), float(o[1])) or not sr.setDestination(float(d[0]), float(d[1])):
            return None
        sr.route()
        st = sr.getState(sr.getDestinationSplit())
        if st is None:
            return None
        return int(st.getDurationSeconds()), float(st.distance) / 1000.0

    # ------------------------------------------------------------------ distances TC
    def hop_cumulative_m(self, pattern_index: int) -> list[float]:
        """Distances cumulées (m) le long d'une mission R5, arrêt par arrêt (géométrie `shapes.txt` découpée par R5,
        ou segments droits entre arrêts si la mission n'a pas de forme). Mis en cache par mission."""
        cached = self._hop_cache.get(pattern_index)
        if cached is not None:
            return cached
        pattern = self.jtl.tripPatterns.get(pattern_index)
        cum = [0.0]
        for ls in pattern.getHopGeometries(self.jtl):
            coords = ls.getCoordinates()
            lons = [float(c.x) for c in coords]
            lats = [float(c.y) for c in coords]
            cum.append(cum[-1] + (GEOD.line_length(lons, lats) if len(lons) > 1 else 0.0))
        with self._lock:
            self._hop_cache[pattern_index] = cum
        return cum

    def has_shape(self, pattern_index: int) -> bool:
        return self.jtl.tripPatterns.get(pattern_index).shape is not None

    # ------------------------------------------------------------------ McRAPTOR
    def transit_options(self, o: tuple[float, float], d: tuple[float, float], departure_s: int,
                        access: StopSearch, egress: StopSearch) -> list[dict[str, Any]]:
        """Options McRAPTOR (dans `suboptimalMinutes` du meilleur, défaut R5 : 5 min) pour un départ à `departure_s`
        (secondes depuis minuit du jour de service, date de la requête de base fixée par l'appelant)."""
        r5 = self.r5
        import java.util  # type: ignore[import-not-found]

        if not access.times or not egress.times:
            return []
        req = self._task()
        req.fromLat, req.fromLon = float(o[0]), float(o[1])
        req.toLat, req.toLon = float(d[0]), float(d[1])
        req.fromTime = int(departure_s)
        req.toTime = int(departure_s) + 2  # 1 tirage, départ à t ou t + 1 s (voir le docstring du module)
        req.monteCarloDraws = 1
        walk = r5.api.util.LegMode.WALK
        acc = java.util.HashMap()
        acc.put(walk, access.jmap)
        egr = java.util.HashMap()
        egr.put(walk, egress.jmap)
        sub = max(int(req.suboptimalMinutes), 0)

        def supplier(_dep):
            return r5.profile.SuboptimalDominatingList(sub)

        router = r5.profile.McRaptorSuboptimalPathProfileRouter(self.jnet, req, acc, egr, supplier, None, True)
        states = router.route()
        options: list[dict[str, Any]] = []
        seen: set[tuple] = set()
        for final in states:
            legs = self._legs_from_state(final, departure_s, access, egress)
            key = tuple((lg["kind"], lg.get("trip"), lg.get("from_stop"), lg.get("to_stop"), lg["dep_s"], lg["arr_s"])
                        for lg in legs)
            if key in seen:
                continue
            seen.add(key)
            options.append({"dep_s": departure_s, "arr_s": int(final.time), "legs": legs})
        return options

    def _legs_from_state(self, final: Any, departure_s: int, access: StopSearch,
                         egress: StopSearch) -> list[dict[str, Any]]:
        legs: list[dict[str, Any]] = []
        s = final
        while s is not None:
            back = s.back
            if int(s.stop) == -1:  # sortie à pied vers le point d'arrivée
                stop = int(back.stop)
                legs.append({"kind": "walk", "role": "egress", "from_stop": self.stop_id(stop), "to_stop": None,
                             "dep_s": int(back.time), "arr_s": int(s.time), "dist_m": egress.dists.get(stop)})
            elif back is None:  # accès à pied depuis le point de départ
                stop = int(s.stop)
                legs.append({"kind": "walk", "role": "access", "from_stop": None, "to_stop": self.stop_id(stop),
                             "dep_s": int(s.time) - access.times[stop], "arr_s": int(s.time),
                             "dist_m": access.dists.get(stop)})
            elif int(s.pattern) == -1:  # correspondance à pied entre deux arrêts
                a, b = int(back.stop), int(s.stop)
                legs.append({"kind": "walk", "role": "transfer", "from_stop": self.stop_id(a),
                             "to_stop": self.stop_id(b), "dep_s": int(back.time), "arr_s": int(s.time),
                             "dist_m": self.transfer_distance_m(a, b)})
            else:  # tronçon en TC
                p = int(s.pattern)
                pattern = self.jtl.tripPatterns.get(p)
                route = self.jtl.routes.get(int(pattern.routeIndex))
                trip = pattern.tripSchedules.get(int(s.trip))
                cum = self.hop_cumulative_m(p)
                bp, ap = int(s.boardStopPosition), int(s.alightStopPosition)
                legs.append({"kind": "transit", "route_id": str(route.route_id), "trip": str(trip.tripId),
                             "route_type": int(route.route_type), "from_stop": self.stop_id(int(back.stop)),
                             "to_stop": self.stop_id(int(s.stop)), "ready_s": int(back.time),
                             "dep_s": int(s.boardTime), "arr_s": int(s.time), "dist_m": cum[ap] - cum[bp],
                             "n_hops": ap - bp, "shape": pattern.shape is not None})
            s = back
        legs.reverse()
        return legs

    def stop_id(self, stop: int) -> str:
        return str(self.jtl.stopIdForIndex.get(int(stop)))

    def transfer_distance_m(self, a: int, b: int) -> float | None:
        """Distance de correspondance (m) précalculée par R5 (`streetTransfers`, même table que McRAPTOR)."""
        lst = self.jtl.streetTransfers.get(int(a))
        if lst is None:
            return None
        for i in range(0, int(lst.size()), 2):
            if int(lst.get(i)) == b:
                return int(lst.get(i + 1)) / 1000.0
        return None

    # ------------------------------------------------------------------ voiture (recoupement de la cause 04g)
    def max_car_speed_mps(self) -> float:
        import numpy as np

        speeds = np.asarray(self.jsl.edgeStore.speeds.toArray(), dtype=np.int64)
        return float(speeds.max()) / 100.0  # EdgeStore : vitesses voiture en cm/s

    def car_path(self, o: tuple[float, float], d: tuple[float, float], car_speed_mps: float | None
                 ) -> tuple[int, float] | None:
        """Chemin voiture point à point comme r5py (`StreetRouter` + destination) ; `car_speed_mps` fixe
        `ProfileRequest.carSpeed` (None : défaut R5 2,22 m/s, comportement de r5py)."""
        r5 = self.r5
        req = self._task()
        if car_speed_mps is not None:
            req.carSpeed = float(car_speed_mps)
        sr = r5.streets.StreetRouter(self.jsl)
        sr.profileRequest = req
        sr.streetMode = r5.profile.StreetMode.CAR
        if not sr.setOrigin(float(o[0]), float(o[1])) or not sr.setDestination(float(d[0]), float(d[1])):
            return None
        sr.route()
        st = sr.getState(sr.getDestinationSplit())
        if st is None:
            return None
        return int(st.getDurationSeconds()), float(st.distance) / 1000.0
