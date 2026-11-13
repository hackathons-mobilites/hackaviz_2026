"""Réseau du soir (D-040, tables du soir v2) : le GTFS de nuit (TRA01B) complété des courses du MERCREDI 18/11 parties avant 3h.

Problème. Un départ du mardi 17/11 entre 22h05 et 23h55 doit voir ce que le service continue d'offrir après minuit. R5
charge un seul jour de service (le mardi 17/11/2026) et le GTFS de nuit (TRA01B) ne contient que les courses du LUNDI
prolongées après minuit (elles servent au MATIN) : un trajet parti à 23h le mardi ne voyait donc pas les courses codées
00:xx à 02:xx du mercredi. Banc de la VM du 05/11 (2 lots sur 13, aller seul, paires de 60 min ou moins) : inchangé à 23h00
et avant, 23h30 +7,8 %, 23h55 +15,0 % ; 90 min : 23h00 +4,0 %, 23h30 +25,4 %, 23h55 +32,9 %. Ces chiffres restent des
chiffres internes : ils ne sont publiés nulle part sans la validation de Nicolas.

Règle (celle du script de la VM, `~/b44/night/soir/make_gtfs_soir.py`, recopié tel quel dans `scripts/04n_make_gtfs_soir.py` :
sha256 c68dff78a0ec7f5746683754d7c9e3cd3978943ac08499aa1fb95acdb82d19aa) :
  1. les services actifs le MERCREDI 18/11 (calendar.txt : plage de dates et jour de semaine, puis calendar_dates.txt) ;
  2. chaque course de ces services dont le PREMIER départ est avant 03:00:00 et qui a au moins 2 arrêts est copiée EN ENTIER
     (tous ses arrêts), avec 24 h de PLUS sur toutes les heures (« 00:30:00 » devient « 24:30:00 ») ;
  3. elle entre dans trips.txt sous l'identifiant SOIR_<trip_id d'origine> et le service SOIR_20261117, SANS shape_id ;
     stop_times.txt reçoit ses arrêts ; calendar_dates.txt reçoit une ligne qui active ce service le mardi 17/11 ;
  4. tous les autres fichiers sont recopiés sans changement ; le GTFS de nuit n'est jamais modifié : le résultat est
     un autre fichier (`gtfs_soir.zip`, source TRA01C) = gtfs_nuit.zip + ces courses (1 248 courses et 32 326 arrêts sur le flux du 02/11 ; le nombre change avec le flux).

Ce qui en sort ne sert QUE les départs de 22:05 à 23:55 (tables `od_walk{3000,1000}_d031_nuit_soir_v2`). Le matin reste
sur TRA01B, le reste de la journée sur TRA01 : le contrôle 07 accepte chacune des trois empreintes là où elle est utilisée.

Limite (écrite dans docs/limites.md) : le soir vient du MÊME mardi type que le matin, avec les courses du mercredi après
minuit ; ce n'est pas une journée réelle continue.

Ce module ne construit rien (le script de la VM l'a fait) : il VÉRIFIE le fichier contre la règle (`verify_evening_gtfs`),
et sert au contrôle 07 et aux tests.
"""

from __future__ import annotations

import csv
import io
import zipfile
from collections import defaultdict
from collections.abc import Mapping
from datetime import date, timedelta
from pathlib import Path

from starway import flux
from starway.config import SERVICE_DATE
from starway.night_gtfs import MODIFIED_MEMBERS, _added_part, _header, active_services, hour_of

EVENING_TRIP_PREFIX = "SOIR_"
EVENING_SOURCE = "TRA01C"  # source du manifeste : son fichier est lu dans le manifeste (`flux.gtfs_path`)
EVENING_GTFS = flux.gtfs_path(EVENING_SOURCE)  # jamais un nom écrit en dur (flux du 06/11)
# Plus de nombre attendu écrit en dur (1 248 courses, 32 326 arrêts sur le flux du 02/11) : les courses du mercredi
# changent avec le flux. `verify_evening_gtfs` contrôle la RÈGLE (aucune course oubliée, rien d'autre ajouté) ; le nombre de
# courses ajoutées se lit dans le fichier, pas dans le code.
TARGET_DAY = SERVICE_DATE  # le mardi type, où les courses sont copiées
SOURCE_DAY = TARGET_DAY + timedelta(days=1)  # le mercredi, d'où elles viennent
EVENING_SERVICE_ID = f"{EVENING_TRIP_PREFIX}{TARGET_DAY:%Y%m%d}"
FIRST_DEPARTURE_BEFORE_S = 3 * 3600  # une course est copiée si elle part (premier arrêt) avant 03:00:00
DAY_HOURS = 24
_STOP_KEYS = ("stop_id", "stop_sequence", "pickup_type", "drop_off_type")


def seconds(t: str) -> int:
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def plus_24h(t: str) -> str:
    """« 00:30:00 » -> « 24:30:00 » (24 h de plus, forme du script de la VM : heure sur au moins 2 chiffres)."""
    h, m, s = t.split(":")
    return f"{int(h) + DAY_HOURS:02d}:{m}:{s}"


def _rows(text: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text.decode("utf-8"), newline="")))


def verify_evening_gtfs(night_zip: Path, evening_zip: Path, target_day: date = TARGET_DAY,
                        source_day: date | None = None, expected: Mapping[str, int] | None = None) -> list[str]:
    """Écarts entre le GTFS du soir et le GTFS de nuit (liste vide = le soir est bien le GTFS de nuit plus les courses
    du mercredi parties avant 3h, rien d'autre) :
      - mêmes fichiers ; tous ceux qui ne sont pas dans `MODIFIED_MEMBERS` identiques (CRC et taille) ;
      - dans les trois autres, le contenu d'origine est conservé tel quel au début, suivi de lignes AJOUTÉES seulement ;
      - courses SOIR_ : une seule fois chacune, course d'origine existante d'un service actif le mercredi, sans shape_id,
        même ligne que l'origine hors identifiant, service et tracé, au service SOIR_<mardi> ;
      - arrêts : exactement ceux de la course d'origine, toutes heures +24 h ; au moins 2 arrêts ; premier départ
        d'origine avant 03:00:00 ;
      - COMPLET : aucune course de ces services, partie avant 3h avec 2 arrêts ou plus, n'a été oubliée ;
      - une ligne de calendar_dates.txt : le service SOIR_ le mardi, ajout ;
      - `expected` (facultatif) : {"trips": n, "stop_times": n} (sur le flux du 02/11 : 1 248 et 32 326 ; plus utilisé par 07,
        car ces nombres changent avec le flux)."""
    source_day = source_day or target_day + timedelta(days=1)
    service_id = f"{EVENING_TRIP_PREFIX}{target_day:%Y%m%d}"
    problems: list[str] = []
    added: dict[str, bytes] = {}
    with zipfile.ZipFile(night_zip) as zn, zipfile.ZipFile(evening_zip) as ze:
        if zn.namelist() != ze.namelist():
            return [f"fichiers différents : {sorted(set(zn.namelist()) ^ set(ze.namelist()))[:5] or 'ordre'}"]
        for i in zn.infolist():
            j = ze.getinfo(i.filename)
            if i.filename not in MODIFIED_MEMBERS and (i.CRC, i.file_size) != (j.CRC, j.file_size):
                problems.append(f"{i.filename} : modifié (il ne devrait pas l'être)")
        for name in MODIFIED_MEMBERS:
            part = _added_part(zn, ze, name)
            if part is None:
                problems.append(f"{name} : le contenu du GTFS de nuit n'est pas conservé au début")
            else:
                added[name] = part
        if problems:
            return problems
        h_tr, h_st, h_cd = (_header(ze, n) for n in MODIFIED_MEMBERS)
        h_cal = _header(zn, "calendar.txt")
        cal = [dict(zip(h_cal, r, strict=False)) for r in csv.reader(
            io.TextIOWrapper(zn.open("calendar.txt"), encoding="utf-8-sig", newline="")) if r][1:]
        cds = [dict(zip(h_cd, r, strict=False)) for r in csv.reader(
            io.TextIOWrapper(zn.open("calendar_dates.txt"), encoding="utf-8-sig", newline="")) if r][1:]
        wed = active_services(cal, cds, source_day)
        orig_trips = {r[h_tr.index("trip_id")]: r for r in csv.reader(
            io.TextIOWrapper(zn.open("trips.txt"), encoding="utf-8-sig", newline="")) if r}
        orig_trips.pop("trip_id", None)
        add_tr, add_st, add_cd = (_rows(added[n]) for n in MODIFIED_MEMBERS)
        add_tr, add_st = [r for r in add_tr if r], [r for r in add_st if r]
        i_tid, i_sid = h_tr.index("trip_id"), h_tr.index("service_id")
        i_shape = h_tr.index("shape_id") if "shape_id" in h_tr else None
        ids = [r[i_tid] for r in add_tr]
        if len(set(ids)) != len(ids):
            problems.append("courses ajoutées en double")
        sources = {}
        for r in add_tr:
            tid = r[i_tid]
            if not tid.startswith(EVENING_TRIP_PREFIX):
                problems.append(f"course ajoutée sans le préfixe {EVENING_TRIP_PREFIX} : {tid}")
                break
            src = orig_trips.get(tid[len(EVENING_TRIP_PREFIX):])
            if src is None:
                problems.append(f"{tid} : course d'origine absente du GTFS de nuit")
                break
            sources[tid] = src[i_tid]
            if src[i_sid] not in wed:
                problems.append(f"{tid} : service d'origine non actif le {source_day:%d/%m/%Y}")
                break
            if r[i_sid] != service_id:
                problems.append(f"{tid} : hors du service {service_id}")
                break
            if i_shape is not None and r[i_shape]:
                problems.append(f"{tid} : shape_id présent (le tracé couvre la course d'origine)")
                break
            keep = [k for k in range(len(r)) if k not in (i_tid, i_sid, i_shape)]
            if any(r[k] != src[k] for k in keep):
                problems.append(f"{tid} : champs différents de la course d'origine")
                break
        if len(add_cd) != 1 or not add_cd[0]:
            problems.append(f"{len(add_cd)} lignes ajoutées à calendar_dates.txt (une attendue)")
        else:
            want = {"service_id": service_id, "date": f"{target_day:%Y%m%d}", "exception_type": "1"}
            got = dict(zip(h_cd, add_cd[0], strict=False))
            if any(got.get(k) != v for k, v in want.items()):
                problems.append(f"ligne de calendar_dates.txt inattendue : {add_cd[0]}")
        if problems:
            return problems
        # arrêts : relus dans le GTFS de nuit, comparés ligne à ligne ; complétude sur les services du mercredi
        j_tid = h_st.index("trip_id")
        j_dep, j_arr = h_st.index("departure_time"), h_st.index("arrival_time")
        trip_service = {t: r[i_sid] for t, r in orig_trips.items()}
        got_stops: dict[str, list[list[str]]] = defaultdict(list)
        for r in add_st:
            got_stops[r[j_tid]].append(r)
        want_stops: dict[str, list[list[str]]] = defaultdict(list)
        first_dep: dict[str, int] = {}
        n_rows: dict[str, int] = defaultdict(int)
        in_added = set(sources.values())
        with zn.open("stop_times.txt") as f:
            rd = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))
            next(rd)
            for r in rd:
                if not r:
                    continue
                t = r[j_tid]
                if trip_service.get(t) not in wed:
                    continue
                n_rows[t] += 1
                if r[j_dep]:
                    s = seconds(r[j_dep])
                    if s < first_dep.get(t, 10 ** 9):
                        first_dep[t] = s
                if t in in_added:
                    y = list(r)
                    y[j_tid] = EVENING_TRIP_PREFIX + t
                    for k in (j_dep, j_arr):
                        if y[k]:
                            y[k] = plus_24h(y[k])
                    want_stops[EVENING_TRIP_PREFIX + t].append(y)
    for tid in ids:
        if got_stops.get(tid) != want_stops.get(tid):
            problems.append(f"{tid} : arrêts différents de ceux de la course d'origine (+24 h)")
            break
        if len(got_stops[tid]) < 2:
            problems.append(f"{tid} : moins de 2 arrêts")
            break
        if first_dep.get(tid[len(EVENING_TRIP_PREFIX):], 10 ** 9) >= FIRST_DEPARTURE_BEFORE_S:
            problems.append(f"{tid} : premier départ d'origine à 03:00 ou après")
            break
    if set(got_stops) != set(ids):
        problems.append("courses de trips.txt et de stop_times.txt différentes parmi les lignes ajoutées")
    due = {t for t, s in first_dep.items() if s < FIRST_DEPARTURE_BEFORE_S and n_rows[t] >= 2}
    missing = due - set(sources.values())
    if missing:
        problems.append(f"{len(missing)} courses du mercredi parties avant 3h absentes du GTFS du soir")
    if any(hour_of(r[j_dep]) < DAY_HOURS for r in add_st if r[j_dep]):
        problems.append("arrêt ajouté à une heure avant 24:00 (24 h de plus attendues)")
    if expected is not None:
        got = {"trips": len(add_tr), "stop_times": len(add_st)}
        for k, v in expected.items():
            if got.get(k) != v:
                problems.append(f"{k} ajoutés : {got.get(k)} au lieu de {v}")
    return problems
