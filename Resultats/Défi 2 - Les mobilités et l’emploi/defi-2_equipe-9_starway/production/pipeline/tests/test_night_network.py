"""Réseau de nuit (D-040) : dossiers du 6h-14h, écarts de moteur, recherche d'une course NUIT_ dans le GTFS de nuit.

Les durées et horaires sont des FIXTURES de test, pas des résultats r5py ni des horaires IDFM.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest
from test_night_gtfs import MONDAY, TUESDAY, make_gtfs

from starway import matrix_io as mio
from starway import night_gtfs as ng
from starway import night_network as nn
from starway.config import PROCESSING_VERSION


@pytest.fixture()
def zips(tmp_path: Path) -> tuple[Path, Path]:
    base = make_gtfs(tmp_path / "base.zip")
    night = tmp_path / "night.zip"
    ng.build_night_gtfs(base, night, MONDAY, TUESDAY)
    return base, night


def test_night_dir_names() -> None:
    assert nn.night_dir(Path("x/matrix_walk3000_d031_b44")).name == "matrix_walk3000_d031_nuit_b44"
    assert nn.night_dir(Path("x/itineraries_walk1000_d031_b44")).name == "itineraries_walk1000_d031_nuit_b44"
    assert nn.night_dir(Path("x/access_walk3000_d031_b44")).name == "access_walk3000_d031_nuit_b44"
    with pytest.raises(ValueError):
        nn.night_dir(Path("x/matrix_walk3000_d031_nuit_b44"))
    with pytest.raises(ValueError):
        nn.night_dir(Path("x/matrix_walk3000"))


# --------------------------------------------------------------------------- accepter le réseau de nuit là où il est utilisé
SHA = {"TRA01": "G1", "TRA01B": "G2", "CYC01": "O"}


def rp(gtfs: str) -> dict:
    return {"processing_version": PROCESSING_VERSION, "gtfs_sha256": gtfs, "osm_sha256": "O"}


def test_night_network_is_accepted_only_where_it_is_declared() -> None:
    assert mio.check_run_params(rp("G1"), SHA) == []
    assert mio.check_run_params(rp("G2"), SHA, gtfs_source="TRA01B") == []
    # sans le déclarer, le GTFS de nuit reste refusé : le contrôle n'est pas affaibli
    assert mio.check_run_params(rp("G2"), SHA) == ["gtfs_sha256 différent du manifest (TRA01)"]
    # et un calcul de nuit sur le GTFS d'origine est refusé là où la nuit est attendue
    assert mio.check_run_params(rp("G1"), SHA, gtfs_source="TRA01B") == ["gtfs_sha256 différent du manifest (TRA01B)"]


def test_engine_diff_same_engine_only_gtfs_and_days_differ() -> None:
    base = {"gtfs_sha256": "G1", "r5_jar_sha256": "j", "transfer_rules": "gtfs_navitia", "same_stop_csv_sha256": "c",
            "walk_setting": "normal", "days": ["d06", "d09", "d14"]}
    night = {**base, "gtfs_sha256": "G2", "days": ["d06"]}
    assert nn.engine_diff(base, night) == []


@pytest.mark.parametrize("key, value", [("r5_jar_sha256", "x"), ("transfer_rules", "gtfs"), ("same_stop_csv_sha256", "y"),
                                        ("osm_sha256", "z"), ("walk_leg_limit_m", 1000)])
def test_engine_diff_flags_any_engine_difference(key: str, value) -> None:
    base = {"gtfs_sha256": "G1", "r5_jar_sha256": "j", "transfer_rules": "gtfs_navitia", "same_stop_csv_sha256": "c",
            "osm_sha256": "o", "walk_leg_limit_m": 3000}
    assert any(key in e for e in nn.engine_diff(base, {**base, "gtfs_sha256": "G2", key: value}))
    missing = {k: v for k, v in base.items() if k != key}
    assert any(key in e for e in nn.engine_diff(base, {**missing, "gtfs_sha256": "G2"}))


def test_engine_diff_refuses_the_same_gtfs() -> None:
    base = {"gtfs_sha256": "G1", "r5_jar_sha256": "j"}
    assert any("même GTFS" in e for e in nn.engine_diff(base, dict(base)))


def matrix(day: str, origins: list[str]) -> pd.DataFrame:
    return pd.DataFrame({"from_id": origins, "to_id": "P1", "out": 10, "ret": 12, "reason": None, "dep": None, "day": day})


def test_merge_takes_d06_from_the_night_recalculation_and_keeps_other_days() -> None:
    base = mio.MatrixLoad(matrices={("transit", d): matrix(d, ["75101", "75102"]) for d in ("d06", "d09", "d14")},
                          batches={"transit_d06": [0], "transit_d09": [0], "transit_d14": [0]})
    new = matrix("nuit", ["75101", "75102"])
    new["out"] = 99
    night = mio.MatrixLoad(matrices={("transit", "d06"): new}, batches={"transit_d06": [0]})
    merged = nn.merge_d06(base, night)
    assert {k[1] for k in merged.matrices} == {"d06", "d09", "d14"}
    assert (merged.matrices[("transit", "d06")]["out"] == 99).all()
    assert (merged.matrices[("transit", "d09")]["out"] == 10).all()


def test_merge_does_not_publish_an_origin_not_yet_recalculated_for_d06() -> None:
    base = mio.MatrixLoad(matrices={("transit", d): matrix(d, ["75101", "75102"]) for d in ("d06", "d09", "d14")})
    night = mio.MatrixLoad(matrices={("transit", "d06"): matrix("nuit", ["75101"])})
    merged = nn.merge_d06(base, night)
    for d in ("d06", "d09", "d14"):
        assert merged.matrices[("transit", d)]["from_id"].unique().tolist() == ["75101"]
    with pytest.raises(ValueError):
        nn.merge_d06(base, mio.MatrixLoad())


# --------------------------------------------------------------------------- recherche d'une course
def test_a_night_trip_is_read_from_the_night_gtfs_not_from_the_original(zips) -> None:
    base, night = zips
    df = nn.read_trips(["T_JOUR", "NUIT_T_NUIT"], ["route_id", "wheelchair_accessible"], base, night)
    assert sorted(df["trip_id"]) == ["NUIT_T_NUIT", "T_JOUR"]
    # la course d'origine du lundi, pas dans le GTFS d'origine sous son nom NUIT_ :
    with pytest.raises(KeyError):
        nn.read_trips(["NUIT_T_NUIT"], ["route_id"], base, base)


def test_missing_trip_is_an_error_never_silently_dropped(zips) -> None:
    base, night = zips
    with pytest.raises(KeyError, match="T_ABSENT"):
        nn.read_trips(["T_ABSENT"], ["route_id"], base, night)
    with pytest.raises(KeyError):
        nn.read_trips(["NUIT_T_ABSENT"], ["route_id"], base, night)


def test_stop_times_of_a_night_trip_are_the_kept_stops_shifted(zips) -> None:
    base, night = zips
    df = nn.read_stop_times(["NUIT_T_NUIT", "T_JOUR"], ["stop_id", "departure_time"], base, night)
    nuit = df[df["trip_id"] == "NUIT_T_NUIT"]
    assert nuit["stop_id"].tolist() == ["B", "C", "D"]  # seulement les arrêts à partir de 24:00
    assert nuit["departure_time"].tolist() == ["00:06:00", "01:10:30", "02:00:00"]
    assert df[df["trip_id"] == "T_JOUR"]["stop_id"].tolist() == ["A", "B"]


def test_original_trip_id_and_detection() -> None:
    assert nn.original_trip_id("NUIT_T1") == "T1" and nn.original_trip_id("T1") == "T1"
    assert nn.has_night_trips(["A", "NUIT_B"]) and not nn.has_night_trips(["A", "B"])


# --------------------------------------------------------------------------- brancher le 6h-14h recalculé (D-040)
from starway import publication as pub


def _state(name: str, **params) -> pub.DirState:
    return pub.DirState(name, "test", False, "complet", "", {"gtfs_sha256": "G1", "osm_sha256": "O", "r5_jar_sha256": "j",
                                                              "transfer_rules": "gtfs_navitia", **params})


def test_engine_problems_accept_night_dirs_on_tra01b_and_day_dirs_on_tra01() -> None:
    sha = {"TRA01": "G1", "TRA01B": "G2", "TRA01C": "G3", "CYC01": "O"}
    states = [_state("matrix_walk3000_d031_b44"), _state("matrix_walk3000_d031_nuit_b44", gtfs_sha256="G2")]
    assert pub.engine_problems(states, None, None, sha) == []


def test_engine_problems_accept_three_networks_each_where_it_is_used() -> None:
    """TRA01 (jour), TRA01B (matin, 6h-14h), TRA01C (soir) : trois empreintes dans un même contrôle."""
    sha = {"TRA01": "G1", "TRA01B": "G2", "TRA01C": "G3", "CYC01": "O"}
    states = [_state("od_walk3000_d031"), _state("od_walk3000_d031_nuit_matin", gtfs_sha256="G2"),
              _state("od_walk3000_d031_nuit_soir_v2", gtfs_sha256="G3"),
              _state("matrix_walk3000_d031_nuit_b44", gtfs_sha256="G2")]
    assert pub.engine_problems(states, None, None, sha) == []
    assert [pub.gtfs_source_of(s.name) for s in states] == ["TRA01", "TRA01B", "TRA01C", "TRA01B"]


def test_engine_problems_refuse_each_network_outside_its_own_place() -> None:
    sha = {"TRA01": "G1", "TRA01B": "G2", "TRA01C": "G3", "CYC01": "O"}
    evening_on_night = [_state("od_walk3000_d031_nuit_soir_v2", gtfs_sha256="G2")]
    assert any("TRA01C" in e for e in pub.engine_problems(evening_on_night, None, None, sha))
    morning_on_evening = [_state("od_walk3000_d031_nuit_matin", gtfs_sha256="G3")]
    assert any("TRA01B" in e for e in pub.engine_problems(morning_on_evening, None, None, sha))
    day_on_evening = [_state("od_walk3000_d031", gtfs_sha256="G3")]
    assert any("TRA01" in e for e in pub.engine_problems(day_on_evening, None, None, sha))


def test_engine_problems_refuse_night_network_in_a_day_dir_and_the_original_in_a_night_dir() -> None:
    sha = {"TRA01": "G1", "TRA01B": "G2", "TRA01C": "G3", "CYC01": "O"}
    day_on_night = [_state("matrix_walk3000_d031_b44", gtfs_sha256="G2")]
    assert any("TRA01" in e for e in pub.engine_problems(day_on_night, None, None, sha))
    night_on_origin = [_state("matrix_walk3000_d031_nuit_b44", gtfs_sha256="G1")]
    assert any("TRA01B" in e for e in pub.engine_problems(night_on_origin, None, None, sha))


def test_engine_problems_refuse_another_engine_in_the_night_dir() -> None:
    sha = {"TRA01": "G1", "TRA01B": "G2", "TRA01C": "G3", "CYC01": "O"}
    states = [_state("od_walk3000_d031"), _state("od_walk3000_d031_nuit_matin", gtfs_sha256="G2", r5_jar_sha256="autre")]
    assert any("r5_jar_sha256" in e for e in pub.engine_problems(states, None, None, sha))
    evening = [_state("od_walk3000_d031"), _state("od_walk3000_d031_nuit_soir_v2", gtfs_sha256="G3", r5_jar_sha256="autre")]
    assert any("r5_jar_sha256" in e and "soir_v2" in e for e in pub.engine_problems(evening, None, None, sha))


def test_day_counterpart_names() -> None:
    assert pub.day_counterpart("od_walk3000_d031_nuit_matin") == "od_walk3000_d031"
    assert pub.day_counterpart("od_walk1000_d031_nuit_soir_v2") == "od_walk1000_d031"
    assert pub.day_counterpart("od_walk1000_d031_nuit_soir") == "od_walk1000_d031"  # ancien nom : jamais publié
    assert pub.day_counterpart("matrix_walk3000_d031_nuit_b44") == "matrix_walk3000_d031_b44"
    assert pub.day_counterpart("itineraries_walk1000_d031_nuit_b44") == "itineraries_walk1000_d031_b44"


def test_dir_states_list_the_night_dirs_as_optional() -> None:
    inp = pub.sky_inputs("44", "gtfs_navitia")
    night = [s for s in pub.dir_states(inp) if "_nuit" in s.name]
    assert len(night) == 8 and not any(s.required for s in night)  # matrice, itinéraires, matin, soir x 2 réglages
    assert sorted(s.name for s in night if "od_walk" in s.name) == [
        "od_walk1000_d031_nuit_matin", "od_walk1000_d031_nuit_soir_v2",
        "od_walk3000_d031_nuit_matin", "od_walk3000_d031_nuit_soir_v2"]  # plus jamais l'ancien _nuit_soir


def rec(insee: str, pole: str, day: str, direction: str, tag: str, trip: str = "T") -> dict:
    return {"insee": insee, "pole": pole, "day": day, "dir": direction, "tag": tag,
            "option": {"legs": [{"kind": "transit", "trip": trip}]}}


def full(communes, poles, days, tag, trip="T"):
    return [rec(c, p, d, s, tag, trip) for c in communes for p in poles for d in days for s in ("out", "ret")]


def test_itinerary_records_take_d06_from_the_night_recalculation_when_complete() -> None:
    base = full(["a", "b"], ["P1", "P2"], ["d06", "d09", "d14"], "jour")
    night = full(["a", "b"], ["P1", "P2"], ["d06"], "nuit", "feed:NUIT_x")
    out, info, why = nn.merge_itinerary_records(base, night, ["P1", "P2"])
    assert info is not None and "d06" in why
    assert {r["tag"] for r in out if r["day"] == "d06"} == {"nuit"}
    assert {r["tag"] for r in out if r["day"] in ("d09", "d14")} == {"jour"}
    assert len(out) == len(base)


def test_incomplete_night_recalculation_keeps_the_original_entirely() -> None:
    base = full(["a", "b"], ["P1"], ["d06", "d09", "d14"], "jour")
    night = full(["a"], ["P1"], ["d06"], "nuit")  # la commune b manque
    out, info, why = nn.merge_itinerary_records(base, night, ["P1"])
    assert info is None and out == base and "1 communes sur 2" in why
    assert nn.merge_itinerary_records(base, [], ["P1"])[1] is None


def test_gtfs_to_read_is_the_night_one_as_soon_as_a_night_trip_is_used(tmp_path) -> None:
    night_zip, base_zip = tmp_path / "n.zip", tmp_path / "b.zip"
    assert nn.gtfs_zip_for([rec("a", "P", "d06", "out", "x", "IDFM:TRIP:1")], night_zip, base_zip) == base_zip
    assert nn.gtfs_zip_for([rec("a", "P", "d06", "out", "x", "feed:NUIT_IDFM:TRIP:1")], night_zip, base_zip) == night_zip
    assert nn.gtfs_zip_for([rec("a", "P", "d06", "out", "x", "NUIT_IDFM:TRIP:1")], night_zip, base_zip) == night_zip


def test_itineraries_engine_problems() -> None:
    base = {"gtfs_sha256": "G1", "r5_jar_sha256": "j", "walk_setting": "normal"}
    ok = {**base, "gtfs_sha256": "G2"}
    assert nn.itineraries_engine_problems(base, ok, {"TRA01B": "G2"}) == []
    assert nn.itineraries_engine_problems(base, ok, {"TRA01B": "autre"})
    assert nn.itineraries_engine_problems(base, {**ok, "r5_jar_sha256": "x"}, {"TRA01B": "G2"})


def test_night_trips_complete_the_trip_table(zips) -> None:
    base, night = zips
    df = nn.read_night_trips(["wheelchair_accessible"], night)
    assert df["trip_id"].tolist() == ["NUIT_T_NUIT", "NUIT_T_AJOUT"] or sorted(df["trip_id"]) == ["NUIT_T_AJOUT", "NUIT_T_NUIT"]
    assert set(df["wheelchair_accessible"]) == {"1"}  # repris de la course d'origine
    st = nn.read_stop_times(["NUIT_T_NUIT", "T_ABSENT"], ["stop_id"], base, night, strict=False)
    assert st["trip_id"].unique().tolist() == ["NUIT_T_NUIT"]