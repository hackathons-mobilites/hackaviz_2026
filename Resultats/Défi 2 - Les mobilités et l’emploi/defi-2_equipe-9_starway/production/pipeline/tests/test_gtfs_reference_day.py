"""Lignes du flux GTFS sans service le jour de référence : petit GTFS synthétique, aucune valeur de transport réelle."""

from __future__ import annotations

import csv
import io
import zipfile
from datetime import date
from pathlib import Path

import pytest

from starway import gtfs_reference_day as gr

DAY = date(2026, 11, 17)  # un mardi


def write_gtfs(path: Path, routes, trips, calendar, calendar_dates=()) -> Path:
    def table(header, rows):
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
        return buf.getvalue()

    cal_h = ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"]
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("agency.txt", table(["agency_id", "agency_name"], [["A1", "Exploitant un"], ["A2", "Exploitant deux"]]))
        z.writestr("routes.txt", table(["route_id", "route_short_name", "route_long_name", "route_type", "agency_id"], routes))
        z.writestr("trips.txt", table(["route_id", "service_id", "trip_id"], trips))
        z.writestr("calendar.txt", table(cal_h, calendar))
        z.writestr("calendar_dates.txt", table(["service_id", "date", "exception_type"], calendar_dates))
    return path


def svc(sid, days, start, end):
    """Ligne de calendar.txt ; `days` = 'lmmjvsd' avec 1 ou 0 (lundi à dimanche)."""
    return [sid, *list(days), start, end]


@pytest.fixture
def gtfs(tmp_path: Path) -> Path:
    routes = [[f"R{i}", f"L{i}", f"Ligne {i}", "3", "A1" if i % 2 else "A2"] for i in range(1, 9)]
    trips = [
        ["R1", "S_OK", "t1"], ["R1", "S_OK", "t2"],            # R1 : service le 17/11
        ["R2", "S_SAT", "t3"],                                 # R2 : samedi seulement, période qui contient le 17/11
        ["R3", "S_END", "t4"],                                 # R3 : calendrier arrêté avant le 17/11
        ["R4", "S_NEXT", "t5"],                                # R4 : commence après
        ["R5", "S_EARLY", "t6"], ["R5", "S_LATE", "t7"],       # R5 : des services avant et après, aucun autour du 17/11
        ["R6", "S_TUE_REMOVED", "t8"],                         # R6 : roule le mardi mais retiré ce jour-là
        ["R7", "S_UNDEFINED", "t9"],                           # R7 : service défini nulle part
        # R8 : aucune course
    ]
    cal = [
        svc("S_OK", "0111110", "20261102", "20261130"),
        svc("S_SAT", "0000010", "20261102", "20261130"),
        svc("S_END", "1111111", "20261102", "20261105"),
        svc("S_NEXT", "1111111", "20261118", "20261202"),
        svc("S_EARLY", "1111111", "20261102", "20261110"),
        svc("S_LATE", "1111111", "20261123", "20261128"),
        svc("S_TUE_REMOVED", "0111110", "20261102", "20261130"),
    ]
    dates = [["S_TUE_REMOVED", "20261117", "2"]]
    return write_gtfs(tmp_path / "gtfs.zip", routes, trips, cal, dates)


def by_route(rows):
    return {r.route_id: r for r in rows}


def test_each_status_and_the_trip_count(gtfs: Path) -> None:
    rows = by_route(gr.route_services(gtfs, DAY))
    assert {k: v.status for k, v in rows.items()} == {
        "R1": gr.SERVED, "R2": gr.OTHER_WEEKDAY, "R3": gr.ENDED, "R4": gr.NOT_STARTED, "R5": gr.GAP,
        "R6": gr.REMOVED, "R7": gr.NO_CALENDAR, "R8": gr.NO_CALENDAR}
    assert rows["R1"].trips_on_day == 2  # deux courses distinctes d'un même service : comptées toutes les deux
    assert rows["R3"].last_day == 20261105
    assert rows["R4"].first_day == 20261118
    assert rows["R1"].agency == "Exploitant un"


def test_a_calendar_date_addition_gives_service(tmp_path: Path) -> None:
    g = write_gtfs(tmp_path / "g.zip", [["R1", "1", "Une", "3", "A1"]], [["R1", "S", "t1"]],
                   [svc("S", "0000000", "20261101", "20261130")], [["S", "20261117", "1"]])
    assert gr.route_services(g, DAY)[0].status == gr.SERVED


def test_only_the_weekday_status_is_justified_automatically(gtfs: Path) -> None:
    rows = gr.route_services(gtfs, DAY)
    bad = gr.unjustified(rows, "f" * 64, [])
    assert {r.route_id for r in bad} == {"R3", "R4", "R5", "R6", "R7", "R8"}  # ni R1 (service) ni R2 (autre jour)


def test_a_written_justification_is_tied_to_the_flux_the_status_and_the_period(gtfs: Path) -> None:
    rows = gr.route_services(gtfs, DAY)
    sha = "a" * 64
    why = "Ligne temporaire d'après son calendrier, vérifiée dans le flux synthétique du test."
    ok = gr.Justification(sha, "R3", "L3", gr.ENDED, "20261102", "20261105", why)
    assert "R3" not in {r.route_id for r in gr.unjustified(rows, sha, [ok])}
    # un autre flux, une autre période, un autre statut ou un texte trop court : la justification ne vaut plus
    for other in (gr.Justification("b" * 64, "R3", "L3", gr.ENDED, "20261102", "20261105", why),
                  gr.Justification(sha, "R3", "L3", gr.ENDED, "20261102", "20261106", why),
                  gr.Justification(sha, "R3", "L3", gr.GAP, "20261102", "20261105", why),
                  gr.Justification(sha, "R3", "L3", gr.ENDED, "20261102", "20261105", "ok")):
        assert "R3" in {r.route_id for r in gr.unjustified(rows, sha, [other])}


def test_report_lists_every_line_without_service_with_its_justification(gtfs: Path) -> None:
    rows = gr.route_services(gtfs, DAY)
    sha = "a" * 64
    why = "Justification écrite assez détaillée pour le test, ligne de remplacement."
    lines = gr.report(rows, sha, [gr.Justification(sha, "R3", "L3", gr.ENDED, "20261102", "20261105", why)])
    got = {x["route_id"]: x["justification"] for x in lines}
    assert set(got) == {"R2", "R3", "R4", "R5", "R6", "R7", "R8"}  # R1 a du service : absente de la liste
    assert got["R3"] == why and got["R4"] == "AUCUNE" and got["R2"].startswith("automatique")
    assert gr.summary(rows)[gr.SERVED] == 1


def test_unused_entries_are_reported(gtfs: Path) -> None:
    rows = gr.route_services(gtfs, DAY)
    sha = "a" * 64
    stale = gr.Justification(sha, "R9", "L9", gr.ENDED, "20261101", "20261102", "Entrée qui ne correspond plus à rien.")
    assert gr.unused_entries(rows, sha, [stale]) == [stale]


def test_the_allowlist_file_is_read_with_its_columns(tmp_path: Path) -> None:
    f = tmp_path / "l.csv"
    f.write_text(",".join(gr.ALLOWLIST_COLUMNS) + "\n" + f'{"a" * 64},R1,L1,{gr.ENDED},20261102,20261105,"Texte, avec virgule"\n',
                 encoding="utf-8")
    (j,) = gr.read_allowlist(f)
    assert j.key == ("a" * 64, "R1", gr.ENDED, "20261102", "20261105") and j.text == "Texte, avec virgule"
    assert gr.read_allowlist(tmp_path / "absent.csv") == []


def test_the_versioned_allowlist_is_well_formed() -> None:
    """Chaque justification écrite du dépôt : empreinte complète, statut connu à justifier, texte détaillé."""
    entries = gr.read_allowlist()
    keys = [j.key for j in entries]
    assert len(keys) == len(set(keys)), "justification en double"
    for j in entries:
        assert len(j.flux_sha256) == 64 and set(j.flux_sha256) <= set("0123456789abcdef"), j
        assert j.status in {gr.ENDED, gr.NOT_STARTED, gr.GAP, gr.REMOVED, gr.NO_CALENDAR}, j
        assert len(j.text) >= gr.MIN_JUSTIFICATION_CHARS, j
        assert not {chr(0x2014), chr(0x2013)} & set(j.text), "aucun tiret long"
