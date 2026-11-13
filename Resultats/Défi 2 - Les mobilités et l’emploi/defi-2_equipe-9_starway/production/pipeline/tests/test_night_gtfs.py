"""Réseau de nuit (D-040) : règle de construction du GTFS de nuit et sa vérification, sur un GTFS minimal synthétique.

Les horaires ci-dessous sont des FIXTURES de test, pas des données IDFM.
"""

from __future__ import annotations

import hashlib
import zipfile
from datetime import date
from pathlib import Path

import pytest

from starway import night_gtfs as ng

MONDAY = date(2026, 11, 16)
TUESDAY = date(2026, 11, 17)

CALENDAR = (
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
    "LUN,1,0,0,0,0,0,0,20261101,20261231\n"  # actif le lundi 16
    "MAR,0,1,0,0,0,0,0,20261101,20261231\n"  # mardi seulement
    "LUN_PASSE,1,0,0,0,0,0,0,20260101,20261001\n"  # lundi, mais plage de dates terminée
    "LUN_RETIRE,1,0,0,0,0,0,0,20261101,20261231\n"  # lundi, retiré le 16 par exception
)
CALENDAR_DATES = (
    "service_id,date,exception_type\n"
    "AJOUT,20261116,1\n"  # ajouté le 16 (n'est pas dans calendar.txt)
    "LUN_RETIRE,20261116,2\n"
    "MAR,20261116,2\n"
)
TRIPS = (
    "route_id,service_id,trip_id,trip_headsign,shape_id,wheelchair_accessible\n"
    "R1,LUN,T_NUIT,Nord,SH1,1\n"  # passe minuit, service lundi
    "R1,LUN,T_JOUR,Nord,SH1,1\n"  # aucun arrêt à 24:00 ou plus
    "R2,LUN,T_UN_ARRET,Sud,SH2,0\n"  # un seul arrêt à 24:00 ou plus : écartée
    "R3,AJOUT,T_AJOUT,Est,SH3,1\n"  # service ajouté par calendar_dates
    "R1,MAR,T_MARDI,Nord,SH1,1\n"  # service du mardi : ne compte pas
    "R1,LUN_PASSE,T_PASSE,Nord,SH1,1\n"
    "R1,LUN_RETIRE,T_RETIRE,Nord,SH1,1\n"
)
STOP_TIMES = (
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n"
    "T_NUIT,23:50:00,23:51:00,A,1,0,0\n"
    "T_NUIT,24:05:00,24:06:00,B,2,0,0\n"
    "T_NUIT,25:10:00,25:10:30,C,3,0,0\n"
    "T_NUIT,26:00:00,26:00:00,D,4,1,0\n"
    "T_JOUR,10:00:00,10:01:00,A,1,0,0\n"
    "T_JOUR,10:20:00,10:21:00,B,2,0,0\n"
    "T_UN_ARRET,23:00:00,23:00:00,A,1,0,0\n"
    "T_UN_ARRET,24:30:00,24:30:00,B,2,0,0\n"
    "T_AJOUT,23:58:00,24:00:00,A,1,0,0\n"  # arrivée avant 24:00, départ à 24:00 pile
    "T_AJOUT,24:20:00,24:21:00,B,2,0,0\n"
    "T_MARDI,24:10:00,24:11:00,A,1,0,0\n"
    "T_MARDI,24:30:00,24:31:00,B,2,0,0\n"
    "T_PASSE,24:10:00,24:11:00,A,1,0,0\n"
    "T_PASSE,24:30:00,24:31:00,B,2,0,0\n"
    "T_RETIRE,24:10:00,24:11:00,A,1,0,0\n"
    "T_RETIRE,24:30:00,24:31:00,B,2,0,0\n"
)
STOPS = "stop_id,stop_name\nA,Alpha\nB,Bravo\nC,Charlie\nD,Delta\n"
BOM = "\ufeff"


def make_gtfs(path: Path, *, bom: bool = False, trailing_newline: bool = True) -> Path:
    members = {"calendar.txt": CALENDAR, "calendar_dates.txt": CALENDAR_DATES, "trips.txt": TRIPS,
               "stop_times.txt": STOP_TIMES, "stops.txt": STOPS}
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in members.items():
            if not trailing_newline and name == "stop_times.txt":
                text = text.rstrip("\n")
            z.writestr(name, (BOM if bom else "") + text)
    return path


def read(path: Path, name: str) -> list[str]:
    with zipfile.ZipFile(path) as z:
        return z.read(name).decode("utf-8").splitlines()


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture()
def built(tmp_path: Path) -> tuple[Path, Path, ng.NightStats]:
    src = make_gtfs(tmp_path / "IDFM-gtfs.zip")
    dst = tmp_path / "out" / "gtfs_nuit.zip"
    return src, dst, ng.build_night_gtfs(src, dst, MONDAY, TUESDAY)


# --------------------------------------------------------------------------- règles élémentaires
def test_the_night_belongs_to_the_eve_of_the_typical_tuesday() -> None:
    assert ng.TARGET_DAY == date(2026, 11, 17) and ng.SOURCE_DAY == date(2026, 11, 16)
    assert ng.NIGHT_SERVICE_ID == "NUIT_20261117"


def test_minus_24h_and_hours_past_midnight() -> None:
    assert ng.hour_of("25:10:00") == 25 and ng.hour_of("5:00:00") == 5
    assert ng.minus_24h("25:10:30") == "01:10:30"
    assert ng.minus_24h("24:00:00") == "00:00:00"
    with pytest.raises(ValueError):
        ng.minus_24h("23:59:00")


def test_active_services_use_range_weekday_then_exceptions() -> None:
    import csv
    import io

    cal = list(csv.DictReader(io.StringIO(CALENDAR)))
    cd = list(csv.DictReader(io.StringIO(CALENDAR_DATES)))
    assert ng.active_services(cal, cd, MONDAY) == {"LUN", "AJOUT"}
    assert ng.active_services(cal, cd, TUESDAY) == {"MAR"}


def test_split_trip_ids() -> None:
    assert ng.split_trip_ids(["A", "NUIT_B", "C", "NUIT_D"]) == (["A", "C"], ["NUIT_B", "NUIT_D"])


# --------------------------------------------------------------------------- construction
def test_only_courses_of_monday_services_crossing_midnight_are_added(built) -> None:
    _, dst, stats = built
    trips = read(dst, "trips.txt")
    added = trips[len(TRIPS.splitlines()):]
    assert sorted(r.split(",")[2] for r in added) == ["NUIT_T_AJOUT", "NUIT_T_NUIT"]
    assert stats.trips_copied == 2 and stats.trips_dropped_single_stop == 1
    assert stats.monday_services == 2 and stats.source_day == "2026-11-16" and stats.target_day == "2026-11-17"


def test_added_courses_use_the_night_service_and_have_no_shape(built) -> None:
    _, dst, _ = built
    added = read(dst, "trips.txt")[len(TRIPS.splitlines()):]
    for row in added:
        r = row.split(",")
        assert r[1] == "NUIT_20261117"  # service
        assert r[4] == ""  # shape_id vidé : le tracé couvre toute la course d'origine
    nuit = next(r for r in added if "NUIT_T_NUIT" in r).split(",")
    assert nuit[0] == "R1" and nuit[3] == "Nord" and nuit[5] == "1"  # le reste est celui de la course d'origine


def test_only_stops_from_24h_are_kept_minus_24h(built) -> None:
    _, dst, _ = built
    added = [r.split(",") for r in read(dst, "stop_times.txt")[len(STOP_TIMES.splitlines()):] if "NUIT_T_NUIT" in r]
    assert [(r[1], r[2], r[3]) for r in added] == [("00:05:00", "00:06:00", "B"), ("01:10:00", "01:10:30", "C"),
                                                  ("02:00:00", "02:00:00", "D")]
    # l'arrêt A (23:50 / 23:51) n'est pas copié : il appartient à la soirée du lundi
    assert all(r[3] != "A" for r in added)
    assert [r[4] for r in added] == ["2", "3", "4"]  # stop_sequence d'origine conservé
    assert [r[5] for r in added] == ["0", "0", "1"]  # pickup_type conservé


def test_arrival_before_24h_with_departure_at_24h_is_aligned_on_the_departure(built) -> None:
    _, dst, _ = built
    rows = [r.split(",") for r in read(dst, "stop_times.txt") if r.startswith("NUIT_T_AJOUT")]
    assert rows[0][1:4] == ["00:00:00", "00:00:00", "A"]  # arrivée 23:58 ramenée au départ 24:00 - 24 h
    assert rows[1][1:4] == ["00:20:00", "00:21:00", "B"]


def test_a_course_keeping_a_single_stop_is_dropped(built) -> None:
    _, dst, _ = built
    assert not any("NUIT_T_UN_ARRET" in r for r in read(dst, "stop_times.txt"))
    assert not any("NUIT_T_UN_ARRET" in r for r in read(dst, "trips.txt"))


def test_services_of_other_days_or_withdrawn_are_ignored(built) -> None:
    _, dst, _ = built
    text = "\n".join(read(dst, "trips.txt") + read(dst, "stop_times.txt"))
    for t in ("T_MARDI", "T_PASSE", "T_RETIRE"):
        assert f"NUIT_{t}" not in text


def test_calendar_dates_activates_the_night_service_on_the_tuesday(built) -> None:
    _, dst, _ = built
    assert read(dst, "calendar_dates.txt")[len(CALENDAR_DATES.splitlines()):] == ["NUIT_20261117,20261117,1"]


def test_other_files_are_copied_unchanged_and_original_is_untouched(tmp_path: Path) -> None:
    src = make_gtfs(tmp_path / "in.zip")
    before = sha(src)
    dst = tmp_path / "out.zip"
    ng.build_night_gtfs(src, dst, MONDAY, TUESDAY)
    assert sha(src) == before
    assert read(dst, "stops.txt") == STOPS.splitlines() and read(dst, "calendar.txt") == CALENDAR.splitlines()
    # début des fichiers modifiés = contenu d'origine, ligne à ligne
    assert read(dst, "trips.txt")[:len(TRIPS.splitlines())] == TRIPS.splitlines()
    assert read(dst, "stop_times.txt")[:len(STOP_TIMES.splitlines())] == STOP_TIMES.splitlines()


def test_output_must_not_be_the_source(tmp_path: Path) -> None:
    src = make_gtfs(tmp_path / "in.zip")
    with pytest.raises(ValueError):
        ng.build_night_gtfs(src, src, MONDAY, TUESDAY)


def test_two_builds_give_the_same_bytes(tmp_path: Path) -> None:
    src = make_gtfs(tmp_path / "in.zip")
    ng.build_night_gtfs(src, tmp_path / "a.zip", MONDAY, TUESDAY)
    ng.build_night_gtfs(src, tmp_path / "b.zip", MONDAY, TUESDAY)
    assert sha(tmp_path / "a.zip") == sha(tmp_path / "b.zip")


def test_stats_carry_the_hashes(built) -> None:
    src, dst, stats = built
    assert stats.source_sha256 == sha(src) and stats.night_zip_sha256 == sha(dst)
    assert stats.stop_times_copied == 5  # 3 (NUIT_T_NUIT) + 2 (NUIT_T_AJOUT)


def test_bom_and_missing_final_newline_are_handled(tmp_path: Path) -> None:
    src = make_gtfs(tmp_path / "in.zip", bom=True, trailing_newline=False)
    dst = tmp_path / "out.zip"
    ng.build_night_gtfs(src, dst, MONDAY, TUESDAY)
    lines = read(dst, "stop_times.txt")
    assert lines[0].startswith("trip_id")  # BOM retiré
    assert lines[len(STOP_TIMES.splitlines())].startswith("NUIT_T_NUIT")  # la dernière ligne d'origine n'est pas collée
    assert ng.verify_night_gtfs(src, dst, TUESDAY) == []


def test_missing_member_is_refused(tmp_path: Path) -> None:
    p = tmp_path / "in.zip"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("trips.txt", TRIPS)
    with pytest.raises(ValueError, match="calendar.txt"):
        ng.build_night_gtfs(p, tmp_path / "o.zip", MONDAY, TUESDAY)


# --------------------------------------------------------------------------- vérification
def test_verify_accepts_what_the_builder_wrote(built) -> None:
    src, dst, _ = built
    assert ng.verify_night_gtfs(src, dst, TUESDAY) == []


def _rewrite(src: Path, dst: Path, changes: dict[str, str]) -> None:
    with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zo:
        for info in zi.infolist():
            data = zi.read(info.filename).decode("utf-8")
            zo.writestr(info.filename, changes.get(info.filename, data))


def test_verify_refuses_a_modified_unrelated_file(built, tmp_path: Path) -> None:
    src, dst, _ = built
    bad = tmp_path / "bad.zip"
    _rewrite(dst, bad, {"stops.txt": STOPS + "Z,Zulu\n"})
    assert any("stops.txt" in p for p in ng.verify_night_gtfs(src, bad, TUESDAY))


def test_verify_refuses_an_altered_original_line(built, tmp_path: Path) -> None:
    src, dst, _ = built
    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(dst) as z:
        text = z.read("stop_times.txt").decode("utf-8").replace("T_JOUR,10:00:00", "T_JOUR,10:05:00")
    _rewrite(dst, bad, {"stop_times.txt": text})
    assert any("stop_times.txt" in p and "conservé" in p for p in ng.verify_night_gtfs(src, bad, TUESDAY))


def test_verify_refuses_a_time_still_coded_past_24h(built, tmp_path: Path) -> None:
    src, dst, _ = built
    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(dst) as z:
        text = z.read("stop_times.txt").decode("utf-8").replace("00:05:00,00:06:00", "24:05:00,24:06:00")
    _rewrite(dst, bad, {"stop_times.txt": text})
    assert any("24:00" in p for p in ng.verify_night_gtfs(src, bad, TUESDAY))


def test_verify_refuses_a_shape_or_a_wrong_service_on_an_added_course(built, tmp_path: Path) -> None:
    src, dst, _ = built
    with zipfile.ZipFile(dst) as z:
        trips = z.read("trips.txt").decode("utf-8")
    shaped = tmp_path / "shaped.zip"
    _rewrite(dst, shaped, {"trips.txt": trips.replace("NUIT_T_NUIT,Nord,,", "NUIT_T_NUIT,Nord,SH1,")})
    assert any("shape_id" in p for p in ng.verify_night_gtfs(src, shaped, TUESDAY))
    other = tmp_path / "other.zip"
    _rewrite(dst, other, {"trips.txt": trips.replace("R1,NUIT_20261117,NUIT_T_NUIT", "R1,LUN,NUIT_T_NUIT")})
    assert any("service" in p for p in ng.verify_night_gtfs(src, other, TUESDAY))


def test_verify_refuses_a_trip_without_stops_and_extra_calendar_lines(built, tmp_path: Path) -> None:
    src, dst, _ = built
    with zipfile.ZipFile(dst) as z:
        trips = z.read("trips.txt").decode("utf-8")
        cd = z.read("calendar_dates.txt").decode("utf-8")
    bad = tmp_path / "bad.zip"
    _rewrite(dst, bad, {"trips.txt": trips + "R9,NUIT_20261117,NUIT_SANS_ARRET,X,,0\n",
                        "calendar_dates.txt": cd + "NUIT_20261117,20261118,1\n"})
    problems = ng.verify_night_gtfs(src, bad, TUESDAY)
    assert any("différentes parmi les lignes ajoutées" in p for p in problems)
    assert any("calendar_dates.txt" in p for p in problems)
