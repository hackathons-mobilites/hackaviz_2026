"""Variante D-022 : limite dérivée, lecture des constantes d'un .class, garde-fous de 04e (sans Java)."""

import struct
import zipfile
from pathlib import Path

import pytest

from starway.config import MAX_TRIP_MIN, SPEED_WALKING_KMH
from starway.r5jar import (
    TRANSIT_LAYER_CLASS,
    VERSION_PROPERTIES,
    check_not_inside,
    class_static_int_constants,
    derived_walk_limit_m,
    jar_info,
    low_memory,
    parse_properties,
)
from starway.routing import r5py_argv

ACC_STATIC_FINAL = 0x0008 | 0x0010


def _utf8(s: str) -> bytes:
    b = s.encode()
    return b"\x01" + struct.pack(">H", len(b)) + b


def make_class(fields: list[tuple[str, int, int]]) -> bytes:
    """Fichier .class minimal : champs (nom, drapeaux, valeur int en ConstantValue). Contient aussi un Long
    (2 index) et un Double pour tester la numérotation du constant pool."""
    cp: list[bytes] = [_utf8("Foo"), b"\x07" + struct.pack(">H", 1), _utf8("java/lang/Object"),
                       b"\x07" + struct.pack(">H", 3), _utf8("I"), _utf8("ConstantValue")]
    idx = len(cp) + 1  # prochain index (le pool commence à 1)
    cp.append(b"\x05" + struct.pack(">q", 123456789012))  # Long : index idx et idx+1
    idx += 2
    cp.append(b"\x06" + struct.pack(">d", 1.5))  # Double
    idx += 2
    field_bytes = b""
    for name, flags, value in fields:
        cp.append(_utf8(name))
        name_i = idx
        cp.append(b"\x03" + struct.pack(">i", value))
        val_i = idx + 1
        idx += 2
        field_bytes += struct.pack(">HHHH", flags, name_i, 5, 1) + struct.pack(">HIH", 6, 2, val_i)
    body = b"".join(cp)
    return (b"\xca\xfe\xba\xbe" + struct.pack(">HH", 0, 65) + struct.pack(">H", idx) + body
            + struct.pack(">HHHH", 0x21, 2, 4, 0) + struct.pack(">H", len(fields)) + field_bytes
            + struct.pack(">HH", 0, 0))


def test_derived_limit_is_7200_with_pipeline_parameters():
    assert derived_walk_limit_m(MAX_TRIP_MIN, SPEED_WALKING_KMH) == 7200
    assert derived_walk_limit_m(60, 4.0) == 4000


def test_derived_limit_refuses_non_integer_or_zero():
    with pytest.raises(ValueError):
        derived_walk_limit_m(1, 3.65)  # 60,83 m : arrondi silencieux interdit
    with pytest.raises(ValueError):
        derived_walk_limit_m(0, 3.6)


def test_class_constants_reads_static_final_ints_only():
    data = make_class([("WALK_DISTANCE_LIMIT_METERS", ACC_STATIC_FINAL, 7200),
                       ("TRANSFER_DISTANCE_LIMIT_METERS", ACC_STATIC_FINAL, 1000),
                       ("NOT_FINAL", 0x0008, 42)])
    assert class_static_int_constants(data) == {"WALK_DISTANCE_LIMIT_METERS": 7200,
                                                "TRANSFER_DISTANCE_LIMIT_METERS": 1000}


def test_class_constants_rejects_non_class():
    with pytest.raises(ValueError):
        class_static_int_constants(b"PK\x03\x04")


def test_jar_info_reads_constants_and_version(tmp_path: Path):
    jar = tmp_path / "r5-test-all.jar"
    with zipfile.ZipFile(jar, "w") as z:
        z.writestr(TRANSIT_LAYER_CLASS, make_class([("WALK_DISTANCE_LIMIT_METERS", ACC_STATIC_FINAL, 7200),
                                                    ("TRANSFER_DISTANCE_LIMIT_METERS", ACC_STATIC_FINAL, 1000),
                                                    ("PARKRIDE_DISTANCE_LIMIT_METERS", ACC_STATIC_FINAL, 500)]))
        z.writestr(VERSION_PROPERTIES, "#date\nbranch=NONE\ncommit=abc123\nversion=v7.5.1-r5py-walk7200\n")
    info = jar_info(jar)
    assert info["walk_distance_limit_meters"] == 7200
    assert info["transfer_distance_limit_meters"] == 1000
    assert info["parkride_distance_limit_meters"] == 500
    assert info["r5_version"] == "v7.5.1-r5py-walk7200" and info["r5_commit"] == "abc123"
    assert len(info["r5_jar_sha256"]) == 64


def test_jar_info_refuses_missing_constant(tmp_path: Path):
    jar = tmp_path / "r5.jar"
    with zipfile.ZipFile(jar, "w") as z:
        z.writestr(TRANSIT_LAYER_CLASS, make_class([("WALK_DISTANCE_LIMIT_METERS", ACC_STATIC_FINAL, 7200)]))
    with pytest.raises(ValueError):
        jar_info(jar)


def test_parse_properties():
    assert parse_properties("#c\na=1\n b = x=y \n\n") == {"a": "1", "b": "x=y"}


def test_low_memory_threshold_in_decimal_gb():
    assert low_memory(19_999_999_999, 20)
    assert not low_memory(20_000_000_000, 20)


def test_check_not_inside_refuses_protected_and_parents(tmp_path: Path):
    prot = tmp_path / "interim" / "od"
    prot.mkdir(parents=True)
    with pytest.raises(SystemExit):
        check_not_inside([prot], [prot])
    with pytest.raises(SystemExit):
        check_not_inside([prot / "sub"], [prot])
    with pytest.raises(SystemExit):
        check_not_inside([tmp_path / "interim"], [prot])
    check_not_inside([tmp_path / "interim" / "matrix_walk7200"], [prot])


def test_r5py_argv_unchanged_without_jar_and_checks_jar(tmp_path: Path):
    assert r5py_argv("x.py", "10G") == ["x.py", "--max-memory", "10G"]
    with pytest.raises(FileNotFoundError):
        r5py_argv("x.py", "10G", tmp_path / "absent.jar")
    jar = tmp_path / "r5.jar"
    jar.write_bytes(b"")
    assert r5py_argv("x.py", "48G", jar) == ["x.py", "--max-memory", "48G", "--r5-classpath", str(jar)]


@pytest.mark.skipif(not (Path.home() / ".cache" / "r5py" / "r5-v7.5.1-r5py-all.jar").exists(),
                    reason="jar r5py amont absent (poste Windows : %LOCALAPPDATA%/r5py)")
def test_upstream_jar_has_2000_m():
    info = jar_info(Path.home() / ".cache" / "r5py" / "r5-v7.5.1-r5py-all.jar")
    assert info["walk_distance_limit_meters"] == 2000


def test_estimate_total_exact_when_sample_is_population():
    from starway.r5jar import estimate_total

    e = estimate_total([1.0, 2.0, 3.0], 3)
    assert e["total"] == 6.0 and e["low95"] == 6.0 and e["high95"] == 6.0


def test_estimate_total_interval_contains_total():
    from starway.r5jar import estimate_total

    e = estimate_total([10.0, 20.0, 30.0, 40.0], 100)
    assert e["total"] == 2500.0
    assert e["low95"] < 2500.0 < e["high95"]
    with pytest.raises(ValueError):
        estimate_total([1.0], 10)


def test_walk_time_limit_rounds_up_to_minute():
    from starway.r5jar import walk_time_limit_min

    assert walk_time_limit_min(1000, 3.6) == 17  # 16,67 min
    assert walk_time_limit_min(3000, 3.6) == 50  # exactement 50 min, pas 51
    with pytest.raises(ValueError):
        walk_time_limit_min(0, 3.6)


def test_walk_leg_kwargs_only_for_transit_modes():
    from datetime import timedelta

    from starway.routing import walk_leg_kwargs

    assert walk_leg_kwargs("transit", "ret", 50) == {"max_time_walking": timedelta(minutes=50)}
    assert walk_leg_kwargs("bike_transit", "out", 17) == {"max_time_walking": timedelta(minutes=17)}
    assert walk_leg_kwargs("walk", "out", 50) == {}
    assert walk_leg_kwargs("transit", "out", None) == {}


def test_walk_settings_are_team_choices():
    from starway.config import WALK_SETTING_DEFAULT, WALK_SETTINGS_M

    assert WALK_SETTINGS_M == {"comfort": 1000, "normal": 3000}
    assert WALK_SETTING_DEFAULT in WALK_SETTINGS_M
