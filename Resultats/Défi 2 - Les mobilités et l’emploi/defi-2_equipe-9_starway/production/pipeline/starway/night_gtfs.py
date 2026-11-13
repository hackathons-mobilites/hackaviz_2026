"""Réseau de nuit (D-040) : le GTFS IDFM (TRA01) complété des courses de la veille codées 24:00 et plus.

Problème. Dans un GTFS, une course qui passe minuit garde son service de la veille et ses heures au-delà de 24:00
(« 25:10:00 » = 1h10 le lendemain). R5 charge un seul jour de service, le mardi 17/11/2026 : il ne voit donc aucune des
courses du LUNDI 16/11 dont la fin de parcours tombe après minuit. Les premières heures du mardi (0h à 6h environ) sont
alors privées de leurs derniers métros, RER, noctiliens et premiers bus de la nuit, ce qui retire des trajets possibles
(banc de la VM du 05/11, aller seul, 60 min : début à 6h, 2 036 paires dans la table actuelle contre 2 161 avec ces
courses, soit +6,1 % ; début à 5h +21,6 % ; début à 6h30 +0,7 % ; à 9h, 1 trajet sur 24 896 change d'1 min).

Règle (la même que celle du script de la VM, ~/b44/night/make_gtfs.py, reportée ici avec ses tests) :
  1. les services actifs le LUNDI 16/11 (calendar.txt : plage de dates et jour de semaine, puis calendar_dates.txt :
     ajouts et retraits de ce jour) ;
  2. pour chaque course de ces services, SEULS les arrêts dont l'heure de départ est 24:00 ou plus sont gardés, avec
     24 h de moins (« 25:10:00 » devient « 01:10:00 ») ; si l'heure d'arrivée de cet arrêt est avant 24:00, elle est
     ramenée à l'heure de départ ; une course qui garde moins de 2 arrêts est écartée ;
  3. ces courses entrent dans trips.txt sous l'identifiant NUIT_<trip_id> et le service NUIT_<AAAAMMJJ> (le mardi),
     SANS shape_id (le tracé couvre toute la course d'origine, pas le fragment gardé) ; stop_times.txt reçoit leurs
     arrêts ; calendar_dates.txt reçoit une ligne qui active ce service le mardi (exception_type 1) ;
  4. tous les autres fichiers sont recopiés à l'identique, le GTFS d'origine n'est jamais modifié.

Ce que la règle ne fait pas : elle ne crée aucune course qui n'existe pas dans le GTFS d'IDFM (le mardi 17/11 ne reçoit
que ce que le lundi 16/11 prolonge après minuit) ; le lundi 16/11 sert de veille du mardi type, un lundi ordinaire,
comme le mardi est un mardi ordinaire (starway/config.py, SERVICE_DATE).
"""

from __future__ import annotations

import csv
import hashlib
import io
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from starway.config import SERVICE_DATE

NIGHT_TRIP_PREFIX = "NUIT_"
TARGET_DAY = SERVICE_DATE  # le mardi type
SOURCE_DAY = TARGET_DAY - timedelta(days=1)  # sa veille : le lundi
NIGHT_SERVICE_ID = f"{NIGHT_TRIP_PREFIX}{TARGET_DAY:%Y%m%d}"
MODIFIED_MEMBERS = ("trips.txt", "stop_times.txt", "calendar_dates.txt")
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
DAY_SECONDS_HOURS = 24
_CHUNK = 1 << 20
_BOM = b"\xef\xbb\xbf"
# Date des fichiers recopiés : celle de l'archive d'origine (sinon deux exécutions donneraient deux fichiers différents)
_STAMP = (2026, 11, 5, 0, 0, 0)


@dataclass
class NightStats:
    """Ce que la construction a fait (écrit à côté du zip, et dans le manifeste)."""

    source_day: str
    target_day: str
    service_id: str
    source_sha256: str
    monday_services: int
    trips_copied: int
    stop_times_copied: int
    trips_dropped_single_stop: int
    night_zip_sha256: str | None = None
    members_modified: list[str] = field(default_factory=lambda: list(MODIFIED_MEMBERS))

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


# --------------------------------------------------------------------------- règles élémentaires
def hour_of(t: str) -> int:
    """Heure GTFS (pas forcément < 24) : « 25:10:00 » -> 25."""
    return int(t.split(":")[0])


def minus_24h(t: str) -> str:
    """« 25:10:00 » -> « 01:10:00 » (24 h de moins)."""
    h, m, s = t.split(":")
    if int(h) < DAY_SECONDS_HOURS:
        raise ValueError(f"heure {t!r} avant 24:00 : rien à retrancher")
    return f"{int(h) - DAY_SECONDS_HOURS:02d}:{m}:{s}"


def active_services(calendar: Iterable[Mapping[str, str]], calendar_dates: Iterable[Mapping[str, str]],
                    day: date = SOURCE_DAY) -> set[str]:
    """Services actifs le jour `day` : plage de dates ET jour de semaine de calendar.txt, puis les exceptions du jour
    (calendar_dates.txt : 1 = ajout, 2 = retrait)."""
    ymd, weekday = f"{day:%Y%m%d}", WEEKDAYS[day.weekday()]
    out = {c["service_id"] for c in calendar if c["start_date"] <= ymd <= c["end_date"] and c[weekday] == "1"}
    for c in calendar_dates:
        if c["date"] != ymd:
            continue
        if c["exception_type"] == "1":
            out.add(c["service_id"])
        elif c["exception_type"] == "2":
            out.discard(c["service_id"])
    return out


def night_rows(stop_times: Iterable[Sequence[str]], header: Sequence[str], trip_service: Mapping[str, str],
               services: set[str]) -> tuple[dict[str, list[list[str]]], int]:
    """Arrêts à garder, par course (ordre de première apparition dans stop_times.txt) : départ à 24:00 ou plus, de
    24 h de moins. Rend aussi le nombre de courses écartées (moins de 2 arrêts gardés)."""
    i_trip, i_dep, i_arr = header.index("trip_id"), header.index("departure_time"), header.index("arrival_time")
    keep: dict[str, list[list[str]]] = defaultdict(list)
    for row in stop_times:
        if not row:
            continue
        trip = row[i_trip]
        if trip_service.get(trip) not in services:
            continue
        dep = row[i_dep]
        if dep and hour_of(dep) >= DAY_SECONDS_HOURS:
            r = list(row)
            arr = r[i_arr]
            r[i_dep] = minus_24h(dep)
            r[i_arr] = minus_24h(arr) if arr and hour_of(arr) >= DAY_SECONDS_HOURS else r[i_dep]
            keep[trip].append(r)
    kept = {k: v for k, v in keep.items() if len(v) >= 2}
    return kept, len(keep) - len(kept)


# --------------------------------------------------------------------------- lecture et écriture des archives
def _text_rows(z: zipfile.ZipFile, name: str) -> tuple[list[str], Iterator[list[str]]]:
    f = io.TextIOWrapper(z.open(name), encoding="utf-8-sig", newline="")
    reader = csv.reader(f)
    return next(reader), reader


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def _csv_text(rows: Iterable[Sequence[str]]) -> bytes:
    b = io.StringIO(newline="")
    w = csv.writer(b, lineterminator="\n")
    for r in rows:
        w.writerow(r)
    return b.getvalue().encode("utf-8")


def _copy_member(src: zipfile.ZipFile, dst: zipfile.ZipFile, info: zipfile.ZipInfo,
                 extra: bytes | None = None) -> None:
    """Recopie un membre octet pour octet. Un membre modifié (`extra` donné) perd son BOM UTF-8 éventuel, reçoit les lignes
    ajoutées, et une fin de ligne si l'original n'en a pas ; un autre membre est recopié sans aucun changement."""
    zi = zipfile.ZipInfo(info.filename, date_time=_STAMP)
    zi.compress_type = zipfile.ZIP_DEFLATED
    with src.open(info) as fin, dst.open(zi, "w", force_zip64=True) as fout:
        first, last = True, b"\n"
        for chunk in iter(lambda: fin.read(_CHUNK), b""):
            if first and extra is not None and chunk.startswith(_BOM):
                chunk = chunk[len(_BOM):]
            first = False
            if chunk:
                fout.write(chunk)
                last = chunk[-1:]
        if extra is not None:
            if last != b"\n":
                fout.write(b"\n")
            fout.write(extra)


def build_night_gtfs(src_zip: Path, dst_zip: Path, source_day: date = SOURCE_DAY,
                     target_day: date = TARGET_DAY) -> NightStats:
    """Écrit `dst_zip` (le GTFS d'origine + les courses de la veille codées 24:00 et plus, règle du module).
    `src_zip` n'est jamais modifié ; `dst_zip` est écrit sous un nom provisoire puis renommé (jamais à moitié écrit)."""
    service_id = f"{NIGHT_TRIP_PREFIX}{target_day:%Y%m%d}"
    if src_zip.resolve() == dst_zip.resolve():
        raise ValueError("la sortie ne doit pas être le GTFS d'origine")
    with zipfile.ZipFile(src_zip) as z:
        names = z.namelist()
        for need in ("calendar.txt", "calendar_dates.txt", "trips.txt", "stop_times.txt"):
            if need not in names:
                raise ValueError(f"{src_zip.name} : {need} absent")
        h_cal, cal = _text_rows(z, "calendar.txt")
        cal_rows = [dict(zip(h_cal, r, strict=False)) for r in cal]
        h_cd, cd = _text_rows(z, "calendar_dates.txt")
        cd_rows = [dict(zip(h_cd, r, strict=False)) for r in cd]
        services = active_services(cal_rows, cd_rows, source_day)
        h_tr, tr = _text_rows(z, "trips.txt")
        trips = [r for r in tr if r]
        i_tid, i_sid = h_tr.index("trip_id"), h_tr.index("service_id")
        trip_service = {r[i_tid]: r[i_sid] for r in trips}
        h_st, st = _text_rows(z, "stop_times.txt")
        kept, dropped = night_rows(st, h_st, trip_service, services)
        trip_by_id = {r[i_tid]: r for r in trips}
        add_trips = []
        for tid in kept:
            r = list(trip_by_id[tid])
            r[i_tid], r[i_sid] = NIGHT_TRIP_PREFIX + tid, service_id
            if "shape_id" in h_tr:
                r[h_tr.index("shape_id")] = ""
            add_trips.append(r)
        add_stops = []
        i_st_trip = h_st.index("trip_id")
        for tid, rows in kept.items():
            for r in rows:
                r = list(r)
                r[i_st_trip] = NIGHT_TRIP_PREFIX + tid
                add_stops.append(r)
        cd_new = {k: "" for k in h_cd}
        cd_new.update({"service_id": service_id, "date": f"{target_day:%Y%m%d}", "exception_type": "1"})
        add_cd = [[cd_new.get(k, "") for k in h_cd]]
        extra = {"trips.txt": _csv_text(add_trips), "stop_times.txt": _csv_text(add_stops),
                 "calendar_dates.txt": _csv_text(add_cd)}
        tmp = dst_zip.with_name(dst_zip.name + ".part")
        dst_zip.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
            for info in z.infolist():
                _copy_member(z, out, info, extra.get(info.filename))
    tmp.replace(dst_zip)
    stats = NightStats(
        source_day=f"{source_day:%Y-%m-%d}", target_day=f"{target_day:%Y-%m-%d}", service_id=service_id,
        source_sha256=sha256_file(src_zip), monday_services=len(services), trips_copied=len(kept),
        stop_times_copied=len(add_stops), trips_dropped_single_stop=dropped, night_zip_sha256=sha256_file(dst_zip))
    return stats


# --------------------------------------------------------------------------- vérification (07 et banc)
def _stream(z: zipfile.ZipFile, name: str) -> Iterator[bytes]:
    """Contenu d'un membre par morceaux, sans le BOM UTF-8 éventuel."""
    with z.open(name) as f:
        first = True
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            if first:
                chunk = chunk.removeprefix(_BOM)
                first = False
            if chunk:
                yield chunk


def _header(z: zipfile.ZipFile, name: str) -> list[str]:
    return next(csv.reader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig", newline="")))


def _added_part(zb: zipfile.ZipFile, zn: zipfile.ZipFile, name: str) -> bytes | None:
    """Ce que `zn` ajoute à la fin de `zb` pour le membre `name` ; None si le contenu d'origine n'est pas conservé tel
    quel au début (lecture par morceaux : stop_times.txt dépasse 700 Mo)."""
    nb = _stream(zn, name)
    buf, last = b"", b"\n"
    for cb in _stream(zb, name):
        last = cb[-1:]
        while len(buf) < len(cb):
            nxt = next(nb, None)
            if nxt is None:
                return None
            buf += nxt
        if buf[:len(cb)] != cb:
            return None
        buf = buf[len(cb):]
    if last != b"\n":
        if not buf:
            buf = next(nb, b"")
        if not buf.startswith(b"\n"):
            return None
        buf = buf[1:]
    return buf + b"".join(nb)


def verify_night_gtfs(base_zip: Path, night_zip: Path, target_day: date = TARGET_DAY) -> list[str]:
    """Écarts entre le GTFS de nuit et le GTFS d'origine (liste vide = le réseau de nuit est bien l'origine plus les
    courses ajoutées, rien d'autre) :
      - mêmes fichiers ; tous les fichiers non listés dans `MODIFIED_MEMBERS` identiques (somme de contrôle CRC et taille) ;
      - dans les trois autres, tout le contenu d'origine est conservé tel quel au début, suivi de lignes AJOUTÉES seulement :
        courses NUIT_ au service de nuit, sans shape_id, arrêts de ces courses à une heure avant 24:00 (24 h retranchées),
        au moins 2 arrêts par course, une seule ligne de calendrier (le mardi, ajout)."""
    problems: list[str] = []
    service_id = f"{NIGHT_TRIP_PREFIX}{target_day:%Y%m%d}"
    added: dict[str, bytes] = {}
    with zipfile.ZipFile(base_zip) as zb, zipfile.ZipFile(night_zip) as zn:
        if zb.namelist() != zn.namelist():
            return [f"fichiers différents : {sorted(set(zb.namelist()) ^ set(zn.namelist()))[:5] or 'ordre'}"]
        for ib in zb.infolist():
            inn = zn.getinfo(ib.filename)
            if ib.filename not in MODIFIED_MEMBERS and (ib.CRC, ib.file_size) != (inn.CRC, inn.file_size):
                problems.append(f"{ib.filename} : modifié (il ne devrait pas l'être)")
        for name in MODIFIED_MEMBERS:
            part = _added_part(zb, zn, name)
            if part is None:
                problems.append(f"{name} : le contenu d'origine n'est pas conservé au début")
            else:
                added[name] = part
        if problems:
            return problems
        h_trips, h_st, h_cd = (_header(zn, n) for n in MODIFIED_MEMBERS)
    rows = {n: list(csv.reader(io.StringIO(added[n].decode("utf-8"), newline=""))) for n in MODIFIED_MEMBERS}
    rows_trips, rows_st, rows_cd = (rows[n] for n in MODIFIED_MEMBERS)
    i_tid, i_sid = h_trips.index("trip_id"), h_trips.index("service_id")
    ids = [r[i_tid] for r in rows_trips]
    if len(set(ids)) != len(ids):
        problems.append("courses ajoutées en double")
    if any(not i.startswith(NIGHT_TRIP_PREFIX) for i in ids):
        problems.append(f"course ajoutée sans le préfixe {NIGHT_TRIP_PREFIX}")
    if any(r[i_sid] != service_id for r in rows_trips):
        problems.append(f"course ajoutée hors du service {service_id}")
    if "shape_id" in h_trips and any(r[h_trips.index("shape_id")] for r in rows_trips):
        problems.append("course ajoutée avec un shape_id (le tracé couvre toute la course d'origine)")
    j_tid, j_dep, j_arr = h_st.index("trip_id"), h_st.index("departure_time"), h_st.index("arrival_time")
    per_trip: dict[str, int] = defaultdict(int)
    for r in rows_st:
        per_trip[r[j_tid]] += 1
        if hour_of(r[j_dep]) >= DAY_SECONDS_HOURS or (r[j_arr] and hour_of(r[j_arr]) >= DAY_SECONDS_HOURS):
            problems.append(f"arrêt de {r[j_tid]} encore codé 24:00 ou plus")
            break
    if set(per_trip) != set(ids):
        problems.append("courses de trips.txt et de stop_times.txt différentes parmi les lignes ajoutées")
    if any(n < 2 for n in per_trip.values()):
        problems.append("course ajoutée avec moins de 2 arrêts")
    if len(rows_cd) != 1:
        problems.append(f"{len(rows_cd)} lignes ajoutées à calendar_dates.txt (une attendue)")
    else:
        want = {"service_id": service_id, "date": f"{target_day:%Y%m%d}", "exception_type": "1"}
        got = dict(zip(h_cd, rows_cd[0], strict=False))
        if any(got.get(k) != v for k, v in want.items()):
            problems.append(f"ligne de calendar_dates.txt inattendue : {rows_cd[0]}")
    return problems


def split_trip_ids(trip_ids: Iterable[str]) -> tuple[list[str], list[str]]:
    """(courses du GTFS d'origine, courses ajoutées NUIT_) : une course NUIT_ n'est pas dans TRA01, elle se cherche dans
    le GTFS de nuit (starway.night_network)."""
    regular, night = [], []
    for t in trip_ids:
        (night if t.startswith(NIGHT_TRIP_PREFIX) else regular).append(t)
    return regular, night
