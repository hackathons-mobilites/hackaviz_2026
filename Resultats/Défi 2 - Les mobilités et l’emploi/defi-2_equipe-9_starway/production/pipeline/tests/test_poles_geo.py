"""Agrégation des pôles, harmonisation géographique, projection du ciel, export."""

import math

import numpy as np
import pandas as pd

from starway.export import _clean, build_access
from starway.geo import SKY_MIN_POLE_GAP, harmonize, relax_min_gap, sky_project
from starway.poles import POLE_DEFS, PoleDef, aggregate_poles, check_disjoint


def test_real_pole_definitions_are_disjoint_and_sized():
    assert check_disjoint() == []
    assert len(POLE_DEFS) == 15  # D-030 (44 astres) a ses propres contrôles (test_sky_groups.py)
    assert len({p.id for p in POLE_DEFS}) == len(POLE_DEFS)


def test_check_disjoint_detects_duplicates():
    defs = (PoleDef("A", "A", ("1", "2")), PoleDef("B", "B", ("2", "3")))
    assert check_disjoint(defs) == ["2 (A, B)"]


def test_aggregate_poles_sums_members_and_never_substitutes_zero():
    jobs = pd.DataFrame({"insee": ["1", "2", "3"], "jobs": [100.0, 50.0, float("nan")]})
    defs = (PoleDef("A", "A", ("1", "2")), PoleDef("B", "B", ("3",)), PoleDef("C", "C", ("4",)))
    out = aggregate_poles(jobs, defs).set_index("id")
    assert out.loc["A", "jobs"] == 150
    assert out.loc["B", "jobs"] is None and out.loc["B", "missing"] == ["3"]
    assert out.loc["C", "jobs"] is None and out.loc["C", "missing"] == ["4"]


def test_harmonize_maps_merged_communes_and_reports_orphans():
    mapping, orphans = harmonize(["93066", "93059", "99999"], {"93059": "93066"}, {"93066"})
    assert mapping == {"93066": "93066", "93059": "93066"}
    assert orphans == ["99999"]


def test_sky_projection_orientation_and_bounds():
    # Paris centre ~ milieu ; nord (Roissy) en haut (y plus petit) ; est (Meaux) à droite.
    px, py = sky_project(2.34880, 48.85341)
    _rx, ry = sky_project(2.5601, 49.0103)
    mx, _my = sky_project(2.8786, 48.9601)
    assert math.isclose(float(px), 0.5, abs_tol=1e-6) and math.isclose(float(py), 0.5, abs_tol=1e-6)
    assert ry < py and mx > px
    xs, ys = sky_project(np.array([1.45, 3.56]), np.array([48.12, 49.24]))
    assert ((xs >= 0) & (xs <= 1) & (ys >= 0) & (ys <= 1)).all()


def test_relax_min_gap_separates_and_is_deterministic():
    pts = np.array([[0.5, 0.5], [0.51, 0.5], [0.9, 0.9]])
    a = relax_min_gap(pts)
    b = relax_min_gap(pts)
    assert np.array_equal(a, b)
    assert np.hypot(*(a[0] - a[1])) >= SKY_MIN_POLE_GAP - 1e-6
    assert np.allclose(a[2], pts[2])  # un point isolé ne bouge pas


def test_clean_turns_nan_into_null():
    assert _clean({"a": float("nan"), "b": [1, pd.NA]}) == {"a": None, "b": [1, None]}


def test_build_access_follows_pole_order_and_requires_reasons():
    m = pd.DataFrame({
        "from_id": ["93048", "93048"], "to_id": ["P2", "P1"],
        "out": pd.array([30, pd.NA], dtype="Int64"), "ret": pd.array([35, 40], dtype="Int64"),
        "reason": [None, "no_trip_within_120"],
    })
    a = build_access("93048", ["P1", "P2", "P3"], {("transit", "d09"): m})
    v = a["modes"]["transit"]["d09"]
    assert v["out"] == [None, 30, None]
    assert v["ret"] == [40, 35, None]
    assert v["reason"] == ["no_trip_within_120", None, "not_computed"]


def test_build_poles_keeps_d030_fields_only_when_present():
    from starway.export import build_poles
    base = {"id": "A", "name": "A", "communes": ["1"], "jobs": 1, "jobs_year": 2023, "jobs_source": "EMP01",
            "point": {"lon": 2.0, "lat": 48.0, "method": "m"}, "sky": {"x": 0.5, "y": 0.5}, "sky_shift": 0.0}
    assert build_poles([base]) == [{k: v for k, v in base.items() if k != "sky_shift"}]
    d030 = base | {"name_short": "a", "name_official": "A", "name_short_insee": "1", "bassin": {"code": "1"}}
    assert set(build_poles([d030])[0]) == set(base) - {"sky_shift"} | {"name_short", "name_official",
                                                                      "name_short_insee", "bassin"}
