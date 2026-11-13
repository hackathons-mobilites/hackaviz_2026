"""Tests sans Java de starway.transfer_marks (D-031 c : marquage des correspondances trop courtes)."""

from __future__ import annotations

import pytest

from starway import transfer_marks as tm
from starway import transfer_times as tx


def row(k: int, available: int, official: int | None = None, navitia: int | None = None, name: str = "La Défense",
        arr: str = "17:32", dep: str = "17:35", a: str = "IDFM:1", b: str = "IDFM:2") -> tm.TransferRow:
    """Ligne de 07h : statuts dérivés comme dans transfer_times.TransferCheck."""
    gtfs = (tx.SHORT if available < official else tx.OK) if official is not None else (
        tx.SAME_STOP if a == b else tx.NO_LINE)
    ref_min = official if official is not None else navitia
    ref = gtfs if ref_min is None else (tx.SHORT if available < ref_min else tx.OK)
    return tm.TransferRow(k, name, name, arr, dep, available, official, navitia, gtfs, ref, a, b)


def leg(frm: str, to: str, dep: str, arr: str) -> dict:
    return {"m": "rer", "route_type": 2, "from": frm, "to": to, "dep": dep, "arr": arr}


def trip(*legs: dict, minutes: int = 55, matrix: int = 55) -> dict:
    walk = {"m": "walk", "role": "access", "dep": "17:00", "arr": "17:05", "from": None, "to": "X"}
    return {"status": "ok", "min": minutes, "matrix_min": matrix, "rides": len(legs), "legs": [walk, *legs]}


def test_status_by_rule() -> None:
    same_stop = row(0, 184, navitia=300, a="S", b="S")  # La Défense : aucune ligne transfers.txt, Navitia 300 s
    assert tm.trip_status([same_stop], "gtfs") == tx.TRIP_UNVERIFIED
    assert tm.trip_status([same_stop], "reference") == tx.TRIP_SHORT
    assert tm.trip_status([row(0, 400, official=300)], "gtfs") == tx.TRIP_VERIFIED
    assert tm.trip_status([], "reference") == tx.TRIP_NO_TRANSFER
    # sans minimum connu (ni ligne ni Navitia) : partly_unverified pour les deux règles
    assert tm.trip_status([row(0, 90, a="S", b="S")], "reference") == tx.TRIP_UNVERIFIED


def test_trip_mark_short_with_source_and_bound() -> None:
    rows = [row(1, 184, navitia=300, a="S", b="S"), row(0, 90, official=300, name="Auber")]
    m = tm.trip_mark(rows, "reference", 63, "forward")
    assert m == {"status": "short", "bound_min": 63, "short": [
        {"at": "Auber", "to": "Auber", "available_s": 90, "min_s": 300, "source": "gtfs"},
        {"at": "La Défense", "to": "La Défense", "available_s": 184, "min_s": 300, "source": "navitia"}]}
    assert tm.mark_errors(m) == []
    # règle gtfs : la durée Navitia n'est jamais utilisée ; la correspondance reste sans minimum
    g = tm.trip_mark(rows, "gtfs", 58, "backward")
    assert [s["source"] for s in g["short"]] == ["gtfs"] and g["unverified"] == 1


def test_trip_mark_without_bound_has_reason() -> None:
    m = tm.trip_mark([row(0, 90, official=300)], "gtfs", None, "over_lookback")
    assert m["bound_min"] is None and m["bound_reason"] == "over_lookback" and tm.mark_errors(m) == []
    with pytest.raises(ValueError):
        tm.trip_mark([row(0, 90, official=300)], "gtfs", None, None)  # jamais une borne absente sans raison
    with pytest.raises(ValueError):
        tm.trip_mark([row(0, 90, official=300)], "gtfs", 40, "no_run")


def test_trip_mark_verified_has_no_bound() -> None:
    m = tm.trip_mark([row(0, 400, official=300)], "reference", None, None)
    assert m == {"status": "verified"} and tm.mark_errors(m) == []
    u = tm.trip_mark([row(0, 400, official=300), row(1, 90, a="S", b="S")], "reference", None, None)
    assert u == {"status": "partly_unverified", "unverified": 1}


def test_long_dash_in_stop_name_published_as_simple_dash() -> None:
    name = "Saint-Denis " + chr(0x2013) + " Pleyel"  # tiret demi-cadratin du GTFS
    r = tm.TransferRow(0, name, name, "08:00", "08:01", 60, 300, None, tx.SHORT, tx.SHORT)
    m = tm.trip_mark([r], "gtfs", 30, "forward")
    assert m["short"][0]["at"] == "Saint-Denis - Pleyel"


def test_mark_errors_contract() -> None:
    assert tm.mark_errors(None) == ["transfer_check absent"]
    assert tm.mark_errors({"status": "short", "bound_min": 3})  # statut short sans correspondance
    assert tm.mark_errors({"status": "short", "short": [{"at": "A", "to": "A", "available_s": 300, "min_s": 300,
                                                         "source": "gtfs"}], "bound_min": 3})  # pas plus court
    assert tm.mark_errors({"status": "short", "short": [{"at": "A", "to": "A", "available_s": 30, "min_s": 300,
                                                         "source": "osm"}], "bound_min": 3})  # source inconnue
    assert tm.mark_errors({"status": "verified", "bound_min": 3})  # borne seulement pour un trajet trop court
    assert tm.mark_errors({"status": "partly_unverified"})  # sans le nombre de correspondances sans minimum


def test_alignment_with_published_legs() -> None:
    t = trip(leg("Versailles", "La Défense", "17:05", "17:32"), leg("La Défense", "Maisons-Laffitte", "17:35", "17:58"))
    r = [row(0, 184, navitia=300, a="S", b="S")]
    assert tm.alignment_errors(t, r, 55, 55, 1) == []
    assert tm.alignment_errors(t, r, 54, 55, 1)  # durée différente : 07h porte sur un autre fichier
    late = [row(0, 184, navitia=300, a="S", b="S", dep="17:36")]
    assert tm.alignment_errors(t, late, 55, 55, 1)  # heures différentes
    assert tm.alignment_errors(t, [], 55, 55, 1)  # correspondance manquante


def test_verdict_at_risk_follows_07h_rule() -> None:
    short_63 = {"status": "short", "short": [{}], "bound_min": 63}
    no_bound = {"status": "short", "short": [{}], "bound_min": None, "bound_reason": "no_run"}
    ok = {"status": "verified"}
    assert tm.verdict_at_risk(54, 55, ok, short_63, 60)  # Versailles : retour borné à 63 min > 60
    assert not tm.verdict_at_risk(54, 55, ok, short_63, 65)  # la borne tient dans le budget
    assert not tm.verdict_at_risk(54, 61, ok, short_63, 60)  # verdict déjà éteint : rien à marquer
    assert tm.verdict_at_risk(14, 14, no_bound, ok, 120)  # sans borne : à risque à tout budget
    assert not tm.verdict_at_risk(20, 20, None, None, 30)  # sens sans itinéraire publié


def test_annotate_is_idempotent_and_strip_restores() -> None:
    doc = {"insee": "78358", "contract": "itineraries-1", "processing_version": "0.1.0", "poles": ["P1", "P2"],
           "days": {"d09": {"out": [trip(leg("A", "B", "08:00", "08:20")), {"status": "no_trip_in_matrix",
                                                                          "reason": "no_trip_within_120"}],
                            "ret": [trip(leg("B", "A", "17:00", "17:20")), trip(leg("B", "A", "17:00", "17:20"))]}},
           "offpeak": {"dep": "11:00"}}
    marks = {("P1", "d09", "out"): {"status": "no_transfer"}, ("P1", "d09", "ret"): {"status": "no_transfer"},
             ("P2", "d09", "ret"): {"status": "no_transfer"}}
    block = tm.file_meta("reference", "2026-11-04T09:17:16Z", "2026-11-17", "normal")
    a = tm.annotate(doc, marks, block)
    assert a["contract"] == tm.CONTRACT_VERSION and a["transfer_check_meta"]["sources"] == ["TRA01", "TRA02B"]
    assert list(a)[-3:] == ["transfer_check_meta", "days", "offpeak"]
    assert "transfer_check" not in a["days"]["d09"]["out"][1]  # aucun itinéraire : rien à marquer
    assert tm.annotate(a, marks, block) == a
    assert tm.strip_marks(a) == doc
    with pytest.raises(KeyError):
        tm.annotate(doc, {}, block)  # un trajet publié sans contrôle 07h bloque l'export
    assert tm.published_meta([a, a]) == {**block, "contract": tm.CONTRACT_VERSION}
    assert tm.published_meta([a, doc]) is None


def test_file_meta_sources_by_rule() -> None:
    assert tm.file_meta("gtfs", "t", "d", "normal")["sources"] == ["TRA01"]
    with pytest.raises(ValueError):
        tm.file_meta("osm", "t", "d", "normal")


def test_source_errors() -> None:
    g = {("IDFM:1", "IDFM:2"): 300}
    n = {("S", "S"): 300}
    assert tm.source_errors([row(0, 90, official=300)], "reference", g, n) == []
    assert tm.source_errors([row(0, 184, navitia=300, a="S", b="S")], "reference", g, n) == []
    assert tm.source_errors([row(0, 90, official=360)], "reference", g, n)  # minimum absent de transfers.txt
    assert tm.source_errors([row(0, 184, navitia=240, a="S", b="S")], "reference", g, n)  # durée Navitia différente
