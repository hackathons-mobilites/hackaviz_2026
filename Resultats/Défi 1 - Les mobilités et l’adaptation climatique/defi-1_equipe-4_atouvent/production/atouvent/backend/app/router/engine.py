"""Calcul d'itinéraires sur les horaires GTFS IDFM (métro, RER, Transilien, tram, bus), algorithme « Connection Scan »."""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

from ..services.geo import distance_m
from ..services.geo import distances_m as _dist  # distance en mètres (tableaux numpy)

DATA = Path(__file__).resolve().parents[2] / "data"
PARIS = ZoneInfo("Europe/Paris")
WALK_MS = 1.25 / 1.3      # 4,5 km/h, avec 30 % de détour par rapport à la ligne droite
WALK_MAX_M = 1000          # marche au départ et à l'arrivée
# Zone peu desservie (grande couronne) : sans arrêt à 1 km, on élargit jusqu'à 2 puis 3 km plutôt que de ne rien proposer ; sans gare à 1 km, les gares jusqu'à 3 km sont ajoutées (les bus de campagne ne roulent souvent pas le soir ni le dimanche)
WALK_RADII = (WALK_MAX_M, 2000, 3000)
RAIL_REACH_M = 3000
BOARD_S = 60               # temps minimal pour changer de train sur un même quai
PLATFORM_S = 60            # rejoindre le quai depuis la rue ou un autre quai
BUS_S = 60                 # bus : arrêt à trouver, passage parfois en avance
SLOW = 1.5                 # marche lente (fauteuil, marche difficile) : 3 km/h
INF = 10 ** 9
MODE = {"0": "TRAM", "1": "SUBWAY", "2": "RAIL", "3": "BUS", "6": "TRAM", "7": "SUBWAY"}
HORIZON_S = 4 * 3600       # on ne cherche pas au-delà de 4 h après le départ
RER = {"A", "B", "C", "D", "E"}
# Le RER n'est souterrain que dans Paris : hors de ce rayon autour de Châtelet, il roule en plein air
RER_TUNNEL = ((48.8584, 2.3470), 5000)


class RouterUnavailable(Exception):
    pass




class Network:
    def __init__(self, folder: Path = DATA):
        if not (folder / "router.npz").exists():
            raise RouterUnavailable("router.npz absent : lancer python -m app.router.build <IDFM-gtfs.zip>")
        z = np.load(folder / "router.npz")
        self.meta = json.loads((folder / "router.json").read_text(encoding="utf-8"))
        c = z["conns"]
        self.cs, self.ca, self.cd, self.cr, self.ct = (c[:, i] for i in range(5))
        self.lat, self.lon = z["stop_lat"], z["stop_lon"]
        self.trip_route, self.trip_service = z["trip_route"], z["trip_service"]
        self.trip_wc, self.stop_wc = z["trip_wheelchair"], z["stop_wheelchair"]
        # Tracés réels (shapes.txt) : absents d'un ancien router.npz
        self.trip_shape = z["trip_shape"] if "trip_shape" in z else None
        self.shape_ptr, self.shape_pts = (z["shape_ptr"], z["shape_pts"]) if "shape_ptr" in z else (None, None)
        self.stops, self.routes, self.headsigns = self.meta["stops"], self.meta["routes"], self.meta["headsigns"]
        # Équipements des arrêts (abri, annonces, accessibilité…), produits par app.router.amenities
        extra = folder / "stop_info.json"
        self.info = json.loads(extra.read_text(encoding="utf-8"))["stops"] if extra.exists() else [{}] * len(self.stops)
        self.foot = self._footpaths(z["foot"])
        self.stop_rail = np.array([i.get("kind") in ("rail", "metro", "tram") for i in self.info], dtype=bool)
        # Courses de bus (exclues quand l'usager ne veut que le ferré)
        self.trip_bus = np.array([r["type"] == "3" for r in self.routes], dtype=bool)[self.trip_route]

    def terminus(self, trip: int) -> str | None:
        """Nom du terminus d'une course (« direction » lisible : les RER n'ont qu'un code de mission comme ROPO)."""
        if not hasattr(self, "_last_stop"):
            # Liaisons triées par heure : la dernière liaison de chaque course arrive au terminus
            rev = self.ct[::-1]
            trips, first = np.unique(rev, return_index=True)
            self._last_stop = np.full(len(self.trip_route), -1, dtype=np.int64)
            self._last_stop[trips] = self.ca[len(rev) - 1 - first]
        i = int(self._last_stop[trip])
        return self.stops[i]["name"] if i >= 0 else None

    def _footpaths(self, foot):
        # Arrêts voisins puis correspondances déclarées (transfers.txt), qui remplacent la marche estimée
        out: dict[int, dict[int, int]] = {}
        for a, b, t in foot.tolist():
            out.setdefault(a, {})[b] = t
        return {a: list(v.items()) for a, v in out.items()}

    def active_services(self, day: date) -> np.ndarray:
        """Services qui roulent ce jour-là (calendar.txt et exceptions calendar_dates.txt)."""
        key, wd = day.strftime("%Y%m%d"), day.weekday()
        ok = np.zeros(len(self.meta["services"]), dtype=bool)
        for i, sid in enumerate(self.meta["services"]):
            c = self.meta["calendar"].get(sid)
            if not c:
                continue
            on = c["start"] <= key <= c["end"] and c["week"][wd] == "1"
            ok[i] = (on or key in c["add"]) and key not in c["remove"]
        return ok

    @lru_cache(maxsize=4)
    def day_connections(self, day: date, wheelchair: bool, bus: bool = True, rail: bool = True):
        """Liaisons du jour, plus celles de la veille après minuit (horaires GTFS > 24 h), triées par départ."""
        def pick(d, shift):
            trips_ok = self.active_services(d)[self.trip_service]
            if wheelchair:
                trips_ok &= self.trip_wc == 1
            if not bus:
                trips_ok &= ~self.trip_bus
            if not rail:
                trips_ok &= self.trip_bus
            m = trips_ok[self.ct]
            if shift:
                m &= self.cd >= 86400
            return np.nonzero(m)[0], shift
        today, _ = pick(day, 0)
        prev, _ = pick(day - timedelta(days=1), 86400)
        idx = np.concatenate([today, prev])
        dep = np.concatenate([self.cd[today], self.cd[prev] - 86400])
        arr = np.concatenate([self.cr[today], self.cr[prev] - 86400])
        order = np.argsort(dep, kind="stable")
        return idx[order], dep[order], arr[order]

    def near(self, lat: float, lon: float, wheelchair: bool, factor: float = 1.0, blocked=None):
        d = _dist(lat, lon, self.lat, self.lon)
        usable = self.stop_wc == 1 if wheelchair else np.ones(len(d), dtype=bool)
        if blocked is not None:
            usable = usable & ~blocked
        for radius in WALK_RADII:
            ok = usable & (d <= radius)
            if ok.any():
                break
        if not (ok & self.stop_rail).any():
            ok |= usable & self.stop_rail & (d <= RAIL_REACH_M)
        return {int(i): self.access(int(i), lat, lon, float(d[i]), factor)[0] for i in np.nonzero(ok)[0]}

    def access(self, i: int, lat: float, lon: float, dist: float, factor: float = 1.0) -> tuple[int, str | None]:
        """Temps pour rejoindre le quai i depuis un point : par l'entrée la plus rapide (couloirs IDFM, pathways.txt) quand la gare en a, sinon en ligne droite jusqu'au quai."""
        best, name = int(dist / WALK_MS * factor), None
        for e_name, e_lat, e_lon, secs in self.info[i].get("entrances", ()):
            t = int((distance_m((lat, lon), (e_lat, e_lon)) / WALK_MS + secs) * factor)
            if name is None or t < best:
                best, name = t, e_name
        return best, name

    def geometry(self, trip: int, a: int, b: int) -> list[list[float]] | None:
        """Tracé réel de la course entre deux arrêts (portion du shape la plus proche de chacun)."""
        if self.trip_shape is None or self.trip_shape[trip] < 0:
            return None
        s = int(self.trip_shape[trip])
        pts = self.shape_pts[self.shape_ptr[s]:self.shape_ptr[s + 1]]
        if len(pts) < 2:
            return None
        da = (pts[:, 0] - self.lat[a]) ** 2 + ((pts[:, 1] - self.lon[a]) * 0.66) ** 2
        db = (pts[:, 0] - self.lat[b]) ** 2 + ((pts[:, 1] - self.lon[b]) * 0.66) ** 2
        i = int(np.argmin(da))
        j = i + int(np.argmin(db[i:])) if i < len(pts) - 1 else i
        seg = pts[i:j + 1]
        if len(seg) < 2:
            return None
        return [[round(float(lon), 5), round(float(lat), 5)] for lat, lon in seg]

    def earliest(self, origin, dest, t0: int, day: date, wheelchair: bool, bus: bool = False, rail: bool = True,
                 factor: float = 1.0, blocked=None):
        """Une recherche : arrivée la plus tôt en partant à t0 (secondes depuis minuit, heure de Paris)."""
        idx, dep, arr = self.day_connections(day, wheelchair, bus, rail)
        start, goal = self.near(*origin, wheelchair, factor, blocked), self.near(*dest, wheelchair, factor, blocked)
        if not start or not goal:
            return None
        S = np.full(len(self.lat), INF, dtype=np.int64)
        J: dict[int, tuple] = {}
        for s, w in start.items():
            S[s], J[s] = t0 + w, ("walk", w)
        board: dict[int, int] = {}
        best, best_stop = INF, None
        k0 = int(np.searchsorted(dep, t0))
        k1 = int(np.searchsorted(dep, t0 + HORIZON_S))
        win = idx[k0:k1]
        L_dep, L_arr = dep[k0:k1].tolist(), arr[k0:k1].tolist()
        L_s, L_a, L_t = self.cs[win].tolist(), self.ca[win].tolist(), self.ct[win].tolist()
        wc = self.stop_wc if blocked is None else np.where(blocked, 0, self.stop_wc if wheelchair else 1)
        wheelchair = wheelchair or blocked is not None  # même contrôle « peut monter / descendre ici »
        Sl = S.tolist()
        foot = self.foot
        trip_bus = self.trip_bus
        for j in range(k1 - k0):
            d = L_dep[j]
            if d >= best:
                break
            trip = L_t[j]
            if trip not in board:
                s = L_s[j]
                # Rester dans la même rame : 1 min ; sinon rejoindre le quai (1 min) ; bus : 1 min de plus
                margin = BOARD_S if J.get(s, ("",))[0] == "trip" else PLATFORM_S
                if trip_bus[trip]:
                    margin += BUS_S
                if Sl[s] + margin > d or (wheelchair and wc[s] != 1):
                    continue
                board[trip] = k0 + j
            a, r = L_a[j], L_arr[j]
            if r < Sl[a] and (not wheelchair or wc[a] == 1):
                Sl[a], J[a] = r, ("trip", board[trip], k0 + j)
                if a in goal and r + goal[a] < best:
                    best, best_stop = r + goal[a], a
                for b, w in foot.get(a, ()):
                    w = int(w * factor)
                    if r + w < Sl[b]:
                        Sl[b], J[b] = r + w, ("foot", a, w)
                        if b in goal and r + w + goal[b] < best:
                            best, best_stop = r + w + goal[b], b
        if best_stop is None:
            return None
        return self._legs(J, best_stop, goal[best_stop], idx, dep, arr, t0)

    def _legs(self, J, last, walk_end, idx, dep, arr, t0):
        legs, s = [], last
        while J[s][0] != "walk":
            kind = J[s]
            if kind[0] == "trip":
                k0, k1 = kind[1], kind[2]
                legs.append(("trip", k0, k1))
                s = int(self.cs[idx[k0]])
            else:
                legs.append(("foot", kind[1], s, kind[2]))
                s = kind[1]
        return {"first_stop": s, "walk_start": J[s][1], "legs": legs[::-1], "last_stop": last, "walk_end": walk_end,
                "idx": idx, "dep": dep, "arr": arr}


def stops_near(lat: float, lon: float, radius: float = 400, limit: int = 12) -> list[dict]:
    """Arrêts proches (bus, tram, gares), regroupés par nom et par mode, avec leurs lignes et équipements."""
    net = network()
    d = _dist(lat, lon, net.lat, net.lon)
    out: dict[tuple, dict] = {}
    for i in np.argsort(d)[:300]:
        if d[i] > radius:
            break
        info = net.info[int(i)]
        key = (net.stops[int(i)]["name"], info.get("kind"))
        if key not in out:
            out[key] = {"name": key[0], "kind": key[1] or "bus", "lat": round(float(net.lat[i]), 6), "lon": round(float(net.lon[i]), 6),
                        "distance_m": int(d[i]), "lines": [], "info": {k: v for k, v in info.items() if k not in ("lines", "kind")}}
        for line in info.get("lines", []):
            if line not in out[key]["lines"]:
                out[key]["lines"].append(line)
    return [x for x in out.values() if x["lines"]][:limit]


_NET: dict = {}


def _norm(text: str) -> list[str]:
    """Mots sans accents ni ponctuation, en minuscules (« Saint-Lazare » → ["saint", "lazare"])."""
    flat = unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", flat).split()


def _close(a: str, b: str) -> bool:
    """Mot tapé a proche du mot b : début de mot (« lazar ») ou une faute de frappe (« lion » pour « lyon »)."""
    if b.startswith(a):
        return True
    if len(a) < 4 or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) <= 1
    short, long_ = sorted((a, b), key=len)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


SEARCH_SKIP = {"gare", "station", "de", "du", "des", "la", "le", "les", "d", "l", "metro", "rer"}
KIND_LABEL = {"rail": "Train", "metro": "Métro", "tram": "Tram"}


def _station_index(net: Network) -> list[tuple[int, str, list[str], str]]:
    """Noms des gares déjà découpés en mots, calculés une fois par réseau (la recherche passe de 0,2 s à quelques ms)."""
    if getattr(net, "_stations", None) is None:
        net._stations = [(i, s["name"], _norm(s["name"]), net.info[i].get("kind"))
                         for i, s in enumerate(net.stops) if net.info[i].get("kind") in KIND_LABEL]
    return net._stations


def find_stations(q: str, limit: int = 3) -> list[dict]:
    """Gares et stations (métro, RER, train, tram) dont le nom correspond à la recherche, avec leurs lignes."""
    words = [w for w in _norm(q) if w not in SEARCH_SKIP] or _norm(q)
    if not words:
        return []
    net = network()
    found: dict[str, dict] = {}
    for i, name, name_words, kind in _station_index(net):
        if not all(any(_close(w, n) for n in name_words) for w in words):
            continue
        st = found.setdefault(name, {"name": name, "pts": [], "lines": {}, "exact": 0})
        st["pts"].append((float(net.lat[i]), float(net.lon[i])))
        st["exact"] = max(st["exact"], sum(w in name_words for w in words))
        for line in net.info[i].get("lines", []):
            label = "RER" if kind == "rail" and line in RER else KIND_LABEL[kind]
            st["lines"].setdefault(label, set()).add(line)
    order = {"RER": 0, "Train": 1, "Métro": 2, "Tram": 3}
    out = []
    for st in found.values():
        lat = sum(p[0] for p in st["pts"]) / len(st["pts"])
        lon = sum(p[1] for p in st["pts"]) / len(st["pts"])
        lines = " · ".join(f"{k} {', '.join(sorted(v, key=lambda x: (len(x), x)))}" for k, v in sorted(st["lines"].items(), key=lambda kv: order[kv[0]]))
        out.append({"label": f"{st['name']} ({lines})", "name": st["name"], "city": None, "lat": round(lat, 6), "lon": round(lon, 6), "type": "station",
                    "_rank": (-st["exact"], -len(st["pts"]), distance_m((lat, lon), (48.8566, 2.3522)))})
    out.sort(key=lambda x: x["_rank"])
    return [{k: v for k, v in x.items() if k != "_rank"} for x in out[:limit]]


def network() -> Network:
    """Réseau en mémoire, rechargé si router.npz ou stop_info.json ont été remplacés (mise à jour des horaires)."""
    stamp = tuple(p.stat().st_mtime if p.exists() else 0 for p in (DATA / "router.npz", DATA / "stop_info.json"))
    if _NET.get("stamp") != stamp:
        _NET["net"], _NET["stamp"] = Network(), stamp
    return _NET["net"]


def _iso(day: date, secs: int) -> str:
    base = datetime.combine(day, datetime.min.time(), PARIS)
    return (base + timedelta(seconds=int(secs))).isoformat()


def _place(net: Network, i: int) -> dict:
    s = net.stops[i]
    return {"name": s["name"], "lat": round(float(net.lat[i]), 6), "lon": round(float(net.lon[i]), 6),
            "stop_id": f"STIF:StopArea:SP:{s['parent']}:" if s["parent"] else None,
            # Quai ou poteau précis (prochains passages en direct) et équipements de l'arrêt
            "quay_id": f"STIF:StopPoint:Q:{s['id'].replace('IDFM:', '')}:",
            "info": {k: v for k, v in net.info[i].items() if k not in ("lines", "entrances")} or None}


def _walk(name_from, a, name_to, b, t_start, secs, day):
    return {"mode": "WALK", "line": None, "headsign": None, "start": _iso(day, t_start), "end": _iso(day, t_start + secs),
            "from": {"name": name_from, "lat": a[0], "lon": a[1], "stop_id": None},
            "to": {"name": name_to, "lat": b[0], "lon": b[1], "stop_id": None}, "stops": [], "underground": False}


def to_itinerary(net: Network, raw: dict, origin, dest, day: date, origin_name: str, dest_name: str, wheelchair: bool) -> dict:
    """Format commun back/front (le même qu'OTP) : liste d'étapes avec arrêts et horaires."""
    idx, dep, arr = raw["idx"], raw["dep"], raw["arr"]
    first_dep = next(int(dep[l[1]]) for l in raw["legs"] if l[0] == "trip")
    p0 = _place(net, raw["first_stop"])
    legs = [_walk(origin_name, origin, p0["name"], (p0["lat"], p0["lon"]), first_dep - raw["walk_start"], raw["walk_start"], day)]
    # Entrée de gare conseillée (la plus rapide) au départ et à l'arrivée
    legs[0]["entrance"] = net.access(raw["first_stop"], *origin, 0)[1]
    t, accessible = first_dep, True  # t : heure courante (secondes depuis minuit)
    for leg in raw["legs"]:
        if leg[0] == "foot":  # correspondance à pied, dès l'arrivée du train précédent
            _, a, b, secs = leg
            pa, pb = _place(net, a), _place(net, b)
            legs.append(_walk(pa["name"], (pa["lat"], pa["lon"]), pb["name"], (pb["lat"], pb["lon"]), t, secs, day))
            t += secs
            continue
        _, k0, k1 = leg
        c0, c1 = int(idx[k0]), int(idx[k1])
        trip = int(net.ct[c0])
        route = net.routes[int(net.trip_route[trip])]
        # Arrêts intermédiaires : liaisons de la même course entre la montée et la descente
        ks = [k for k in range(k0, k1 + 1) if int(net.ct[idx[k]]) == trip]
        # Arrêts intermédiaires : sans le détail des équipements (allège le paquet hors ligne)
        stops = [{**{k: v for k, v in _place(net, int(net.cs[idx[k]])).items() if k != "info"}, "time": _iso(day, int(dep[k]))}
                 for k in ks[1:]]
        mode = MODE.get(route["type"], "RAIL")
        accessible &= bool(net.trip_wc[trip] == 1 and net.stop_wc[net.cs[c0]] == 1 and net.stop_wc[net.ca[c1]] == 1)
        tunnel = mode == "RAIL" and route["line"] in RER and all(
            distance_m((float(net.lat[i]), float(net.lon[i])), RER_TUNNEL[0]) <= RER_TUNNEL[1]
            for i in [int(net.cs[c0])] + [int(net.ca[idx[k]]) for k in ks])
        legs.append({"mode": mode, "line": route["line"], "headsign": net.headsigns[trip] or None, "direction": net.terminus(trip),
                     "start": _iso(day, int(dep[k0])), "end": _iso(day, int(arr[k1])),
                     "from": _place(net, int(net.cs[c0])), "to": _place(net, int(net.ca[c1])), "stops": stops,
                     "underground": mode == "SUBWAY" or tunnel, "route_id": route["id"],
                     "color": route.get("color") or None, "text_color": route.get("text") or None,
                     # Accessibilité fauteuil du véhicule déclarée dans le GTFS : 1 oui, 2 non, 0 non renseigné
                     "wheelchair": int(net.trip_wc[trip]),
                     "geometry": net.geometry(trip, int(net.cs[c0]), int(net.ca[c1]))})
        t = int(arr[k1])
    pl = _place(net, raw["last_stop"])
    legs.append(_walk(pl["name"], (pl["lat"], pl["lon"]), dest_name, dest, t, raw["walk_end"], day))
    legs[-1]["entrance"] = net.access(raw["last_stop"], *dest, 0)[1]
    legs = [l for l in legs if not (l["mode"] == "WALK" and l["start"] == l["end"])]
    return {"start": legs[0]["start"], "end": legs[-1]["end"], "accessible": accessible, "accessible_requested": wheelchair,
            "legs": legs, "source": "gtfs"}


def doubles_back(it: dict) -> bool:
    """Aller-retour : le trajet repasse par une gare déjà traversée (ex. RER D vers le nord pour reprendre un D vers le sud)."""
    seen: set[str] = set()
    for l in it["legs"]:
        if l["mode"] in ("WALK", "BICYCLE"):
            continue
        names = [l["from"]["name"], *(s["name"] for s in l.get("stops") or []), l["to"]["name"]]
        # La gare de correspondance (montée de cette étape) est forcément déjà vue : on ne la compte pas
        if any(n in seen for n in names[1:]):
            return True
        seen.update(names)
    return False


def plan(origin, dest, when: datetime, wheelchair: bool = False, count: int = 3,
         origin_name: str = "Départ", dest_name: str = "Arrivée", bus: bool = True, rail: bool = True,
         slow: bool = False, avoid: set[str] | None = None) -> list[dict]:
    """Jusqu'à `count` itinéraires : le plus tôt, puis en partant après le premier train de chaque solution."""
    net = network()
    blocked = np.array([s["name"] in avoid for s in net.stops], dtype=bool) if avoid else None
    local = when.astimezone(PARIS)
    day, t0 = local.date(), local.hour * 3600 + local.minute * 60 + local.second
    out, seen, kept, back = [], set(), [], []
    for _ in range(count + 2):
        raw = net.earliest(origin, dest, t0, day, wheelchair, bus, rail, SLOW if slow or wheelchair else 1.0, blocked)
        if not raw or not any(l[0] == "trip" for l in raw["legs"]):
            break
        it = to_itinerary(net, raw, origin, dest, day, origin_name, dest_name, wheelchair)
        key = tuple((l["mode"], l["line"], l["start"]) for l in it["legs"] if l["mode"] != "WALK")
        rides = len(key)
        # Écarte les détours : plus de correspondances que la meilleure solution pour arriver plus tard
        detour = out and rides > min(r for r, _ in kept) and it["end"] > out[0]["end"]
        if key not in seen and doubles_back(it):
            # Aller-retour gardé de côté : proposé seulement s'il n'y a rien d'autre
            seen.add(key)
            back.append(it)
        elif key not in seen and not detour:
            seen.add(key)
            kept.append((rides, it["end"]))
            out.append(it)
        # Solution suivante : partir une minute après le premier train de celle-ci
        first = next(l for l in raw["legs"] if l[0] == "trip")
        t0 = int(raw["dep"][first[1]]) + 60 - raw["walk_start"]
        if len(out) >= count:
            break
    return out or back[:1]
