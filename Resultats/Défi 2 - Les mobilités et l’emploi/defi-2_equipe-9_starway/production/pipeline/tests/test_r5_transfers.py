"""Tests sans Java de starway.r5_transfers (chargement de transfers.txt dans un réseau R5, option (a) de D-031)."""

from __future__ import annotations

from starway import r5_transfers as rt

IDX = {"F:a": 0, "F:b": 1, "F:c": 2}


def test_pack_like_gtfs_transfer_loader() -> None:
    p = rt.pack([("a", "b", 377), ("b", "a", 120), ("a", "x", 300), ("a", "c", 5507), ("c", "c", 200)], IDX, "F:")
    assert p.by_from == {0: [1, 377 - 61], 1: [0, 120 - 61]}
    assert (p.loaded, p.missing_stop, p.over_limit, p.self_pairs) == (2, 1, 1, 1)


def test_without_targets_keeps_other_street_transfers() -> None:
    assert rt.without_targets([1, 500, 2, 900, 3, 100], {2}) == [1, 500, 3, 100]
    assert rt.without_targets([], {2}) == []


def test_detect_feed_prefix_single_feed() -> None:
    assert rt.detect_feed_prefix(["IDFM-gtfs:IDFM:1", "IDFM-gtfs:IDFM:monomodalStopPlace:2"], ["IDFM:1"]) == "IDFM-gtfs:"


def test_detect_feed_prefix_refuses_unknown() -> None:
    import pytest

    with pytest.raises(ValueError):
        rt.detect_feed_prefix(["F:x"], ["y"])


def test_same_stop_values_by_r5_index() -> None:
    sv = rt.same_stop_values({"a": 300, "c": 120, "zz": 900}, IDX, "F:", 4)
    assert sv.values == [300, 0, 120, 0]
    assert (sv.loaded, sv.missing_stop, sv.without_duration) == (2, 1, 2)


def test_required_gap_matches_r5_and_navitia_rules() -> None:
    # R5 d'origine : départ strictement plus de 60 s après l'arrivée, soit 61 s au moins
    assert rt.required_gap_s(False, 0) == 61
    assert rt.required_gap_s(True, 0) == 61  # arrêt sans durée relevée : règle d'origine
    # durée Navitia D au même arrêt après une arrivée en TC : départ >= arrivée + D exactement
    assert rt.required_gap_s(True, 300) == 300
    assert rt.required_gap_s(True, 120) == 120
    # accès ou correspondance à pied depuis un autre arrêt : la durée de l'arrêt ne s'applique pas
    assert rt.required_gap_s(False, 300) == 61
    # durée plus courte que la règle d'origine : la règle d'origine reste (jamais plus permissif)
    assert rt.required_gap_s(True, 30) == 61


def test_gtfs_line_plus_board_rule_is_exactly_the_minimum() -> None:
    # a1 : valeur chargée min - 61, puis la règle de montée (> 60 s) : écart exigé = min
    for m in (120, 377, 3600):
        loaded = rt.pack([("a", "b", m)], IDX, "F:").by_from[0][1]
        assert loaded + rt.required_gap_s(False, 0) == m


def test_run_params_original_engine_is_empty() -> None:
    assert rt.run_params("r5", None, None) == {}


def test_run_params_refuses_jar_without_patch(tmp_path) -> None:
    import zipfile

    import pytest

    jar = tmp_path / "r5.jar"
    with zipfile.ZipFile(jar, "w") as z:
        z.writestr("com/conveyal/r5/transit/TransitLayer.class", b"")
    with pytest.raises(SystemExit):
        rt.run_params("gtfs", jar, None)


def test_read_same_stop_minimums(tmp_path) -> None:
    import pytest

    f = tmp_path / "s.csv"
    f.write_text("stop_id,same_stop_min_s,source,fetched_at\nIDFM:1,300,navitia_connections,x\n", encoding="utf-8")
    assert rt.read_same_stop_minimums(f) == {"IDFM:1": 300}
    f.write_text("stop_id,same_stop_min_s,source,fetched_at\nIDFM:1,0,navitia_connections,x\n", encoding="utf-8")
    with pytest.raises(ValueError):
        rt.read_same_stop_minimums(f)


def _load_07k():
    import importlib.util
    from pathlib import Path

    p = Path(__file__).resolve().parents[1] / "scripts" / "07k_d031_bench_compare.py"
    spec = importlib.util.spec_from_file_location("m07k", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_07k_compare_values_counts_changes() -> None:
    import pandas as pd

    m = _load_07k()
    base = pd.Series([10, 20, None, 30, 40], dtype="Int64")
    new = pd.Series([10, 25, 5, None, 38], dtype="Int64")
    r = m.compare_values(base, new)
    assert (r["both"], r["changed"], r["longer"], r["shorter"], r["lost"], r["gained"]) == (3, 2, 1, 1, 1, 1)
    assert r["delta_max_min"] == 5.0 and r["delta_min_min"] == -2.0


def test_07k_verdicts_need_both_legs() -> None:
    import pandas as pd

    m = _load_07k()
    df = pd.DataFrame({"out_base": [20, 40, 50], "ret_base": [25, 44, 70],
                       "out_new": [20, 47, 50], "ret_new": [31, 44, 59]}).astype("Int64")
    v = m.verdict_changes(df, budgets=(30, 45, 60))
    assert v["30"] == {"lit_before": 1, "lit_after": 0, "lost": 1, "gained": 0}
    assert v["45"] == {"lit_before": 2, "lit_after": 1, "lost": 1, "gained": 0}
    assert v["60"] == {"lit_before": 2, "lit_after": 3, "lost": 0, "gained": 1}


def test_poles_params_default_adds_no_key(tmp_path) -> None:
    import pytest

    assert rt.poles_params(None) == {}
    assert rt.poles_params(rt.default_poles_file()) == {}
    f = tmp_path / "poles_d030.json"
    f.write_text("[]", encoding="utf-8")
    p = rt.poles_params(f)
    assert p["poles_file"] == "poles_d030.json" and len(p["poles_sha256"]) == 64
    with pytest.raises(SystemExit):
        rt.require_explicit_dir(f, None, "--out-dir")
    rt.require_explicit_dir(f, tmp_path / "out", "--out-dir")
    rt.require_explicit_dir(None, None, "--out-dir")


def test_reconcile_poles_params_legacy_keys_and_missing_keys() -> None:
    """Reprise d'un calcul de la première version 44 astres (STARWAY_POLES_JSON) avec le code de `--poles`."""
    new = {"poles_file": "poles_d030.json", "poles_sha256": "aa", "pole_points_sha256": "pp", "n_poles": 44}
    # 04, 04e, 04d : seul le nom des clés change
    old = {"poles_json": "poles_d030.json", "poles_json_sha256": "aa", "n_poles": 44, "pole_points_sha256": "pp"}
    assert rt.reconcile_poles_params(old, new) == new
    # un autre fichier de pôles reste refusé (empreinte différente)
    other = {**old, "poles_json_sha256": "bb"}
    assert rt.reconcile_poles_params(other, new)["poles_sha256"] == "bb" != new["poles_sha256"]
    # 04h de la première version : aucune clé de pôles, identité prouvée par les points
    h_old = {"n_poles": 44, "pole_points_sha256": "pp"}
    assert rt.reconcile_poles_params(h_old, new) == new
    # points différents : rien n'est complété (la reprise est refusée par la comparaison)
    assert rt.reconcile_poles_params({"n_poles": 44, "pole_points_sha256": "zz"}, new) != new
    # 15 pôles publiés : aucune clé attendue, rien ne change
    assert rt.reconcile_poles_params({"n_poles": 15}, {"n_poles": 15}) == {"n_poles": 15}
