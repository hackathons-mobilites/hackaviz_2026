"""Analyse de la limite de marche finale de R5 (logique pure, sans Java)."""

import math

import pandas as pd

from starway.egress import (
    CAT_FAR,
    CAT_NEAR,
    CAT_SUSPECT,
    R5_WALK_EGRESS_LIMIT_M,
    alighting_allowed,
    classify,
    gtfs_seconds,
    walk_reach_m,
)


def test_gtfs_seconds_after_midnight_and_empty():
    s = gtfs_seconds(pd.Series(["22:00:00", "24:10:30", "", None]))
    assert s.iloc[0] == 79200
    assert s.iloc[1] == 24 * 3600 + 10 * 60 + 30
    assert math.isnan(s.iloc[2]) and math.isnan(s.iloc[3])


def test_alighting_follows_r5_rule():
    # R5 (PickDropType) : seule la valeur 1 interdit la descente ; vide = 0
    s = alighting_allowed(pd.Series(["0", "1", "2", "3", None, ""]))
    assert s.tolist() == [True, False, True, True, True, True]


def test_walk_reach_is_derived_from_time_and_speed():
    assert walk_reach_m(120, 3.6) == 7200


def test_classify_bounds():
    reach = walk_reach_m(120, 3.6)
    assert classify(1999.0, reach) == CAT_NEAR
    assert classify(float(R5_WALK_EGRESS_LIMIT_M), reach) == CAT_SUSPECT  # 2 000 m n'est plus « moins de 2 km »
    assert classify(7200.0, reach) == CAT_SUSPECT
    assert classify(7201.0, reach) == CAT_FAR
    assert classify(None, reach) == CAT_FAR
    assert classify(float("nan"), reach) == CAT_FAR


def test_relay_returns_uses_other_commune_plus_walk():
    import numpy as np

    from starway.egress import relay_returns

    # 1 pôle, 3 communes ; la commune 2 n'a pas de retour ; la commune 0 est à 1 200 m (20 min à 3,6 km/h)
    ret = np.array([[50.0, 30.0, np.nan]])
    dist = np.array([[0, 6000, 1200], [6000, 0, 3000], [1200, 3000, 0]], dtype=float)
    relay, via = relay_returns(ret, dist, 3.6)
    assert relay[0, 2] == 50 + 20  # via 0 (70) plutôt que via 1 (30 + 50 = 80)
    assert via[0, 2] == 0
    assert relay[0, 0] == 30 + 100  # jamais la commune elle-même
    assert via[0, 0] == 1


def test_relay_returns_nan_when_no_relay():
    import numpy as np

    from starway.egress import relay_returns

    relay, via = relay_returns(np.array([[np.nan, np.nan]]), np.array([[0, 10.0], [10.0, 0]]), 3.6)
    assert np.isnan(relay).all() and (via == -1).all()
