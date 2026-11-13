"""D-030 (proposée) : rattachement aux bassins d'emploi, groupes du ciel, portage de l'agrégation du front."""

import numpy as np
import pandas as pd
import pytest

from starway import od_export as ox
from starway import sky_groups as sg
from starway.config import PARIS_ARRONDISSEMENTS, PROCESSED_DIR


def test_clean_label_replaces_long_dashes_only():
    assert sg.clean_label(f"A {chr(0x2013)} B {chr(0x2014)} C") == ("A - B - C", True)
    assert sg.clean_label("Grand Roissy - Le Bourget") == ("Grand Roissy - Le Bourget", False)


@pytest.mark.parametrize("a,b,same", [
    ("PARIS 01", "Paris 1er Arrondissement", True),
    ("PARIS 12", "Paris 12e Arrondissement", True),
    ("CREVECOEUR EN BRIE", "Crèvecœur-en-Brie", True),
    ("L ETANG LA VILLE", "L'Étang-la-Ville", True),
    ("ST REMY LA VANNE", "Saint-Rémy-de-la-Vanne", False),
])
def test_norm_name(a, b, same):
    assert (sg.norm_name(a) == sg.norm_name(b)) is same


def _bassins(rows):
    return pd.DataFrame(rows, columns=["insee", "lib_commune", "dep", "bassin_code", "bassin_name"]).assign(
        name_dash_replaced=False)


def test_attach_origins_flags_delegated_and_unknown_codes():
    origins = pd.DataFrame({"insee": ["1", "2"], "name": ["Un", "Deux"]})
    bassins = _bassins([("1", "UN", "77", "10", "B10"), ("2", "DEUX", "77", "20", "B20"),
                        ("3", "TROIS", "77", "10", "B10"), ("4", "QUATRE", "77", "10", "B10"),
                        ("5", "CINQ", "77", "10", "B10")])
    att = sg.attach_origins(origins, bassins, {"3": "1", "4": "2"})
    assert att.bassin_of == {"1": "10", "2": "20"}
    rep = att.report.set_index("insee_geo04")
    assert rep.at["3", "status"] == "delegated_commune" and rep.at["3", "same_bassin_as_chef_lieu"] is True
    assert rep.at["4", "status"] == "delegated_commune" and rep.at["4", "same_bassin_as_chef_lieu"] is False
    assert rep.at["5", "status"] == "code_not_in_origins"


def test_attach_origins_never_guesses_a_missing_origin():
    origins = pd.DataFrame({"insee": ["1", "9"], "name": ["Un", "Neuf"]})
    with pytest.raises(ValueError, match="9"):
        sg.attach_origins(origins, _bassins([("1", "UN", "77", "10", "B10")]), {})


def _paris_attachment(extra: dict[str, str]) -> sg.Attachment:
    bassin_of = {c: sg.PARIS_BASSIN for c in PARIS_ARRONDISSEMENTS} | extra
    names = {sg.PARIS_BASSIN: "T1 Paris", "1200": "B1200", "1100": "B1100"}
    return sg.Attachment(bassin_of, names, pd.DataFrame())


def test_build_groups_paris_split_and_order():
    att = _paris_attachment({"77001": "1200", "77002": "1100", "77003": "1200"})
    jobs = {c: 10 for c in att.bassin_of}
    g3 = sg.build_groups(att, jobs, "poles3")
    assert [g.id for g in g3] == ["P_PARIS_QCA", "P_PARIS_RG", "P_PARIS_EST", "BE_1100", "BE_1200"]
    assert sum(len(g.communes) for g in g3[:3]) == 20
    assert g3[4].communes == ("77001", "77003") and g3[4].jobs == 20
    g20 = sg.build_groups(att, jobs, "arrondissements")
    assert len(g20) == 22 and g20[0].id == "BE_1107_75101" and g20[0].name == "T1 Paris - 1er arrondissement"
    assert g20[11].name == "T1 Paris - 12e arrondissement"
    assert sg.check_partition(g3, list(att.bassin_of)) == []
    assert sg.check_partition(g20, list(att.bassin_of)) == []


def test_build_groups_jobs_null_never_zero_and_partition_errors():
    att = _paris_attachment({"77001": "1200"})
    jobs = {c: 10 for c in PARIS_ARRONDISSEMENTS}  # 77001 sans postes
    g = sg.build_groups(att, jobs, "poles3")
    assert g[-1].jobs is None and g[-1].missing_jobs == ("77001",)
    errs = sg.check_partition(g, list(att.bassin_of) + ["99999"])
    assert errs == ["99999 dans aucun groupe"]


def test_anchor_rows_same_rule_as_poles():
    located = pd.DataFrame({
        "stop_id": ["S2", "S1", "S3", "S4"], "stop_name": ["b", "a", "c", "d"], "insee": ["1", "1", "2", "3"],
        "lon": [2.0, 2.1, 2.2, 2.3], "lat": [48.0, 48.1, 48.2, 48.3], "departures": [50, 50, 70, 999]})
    groups = [sg.Group("G", "G", "10", "B", ("1", "2")), sg.Group("H", "H", "20", "C", ("9",))]
    rows = sg.anchor_rows(groups, located)
    assert rows[0]["stop_id"] == "S3" and rows[0]["second_stop_id"] == "S1"  # égalité : stop_id croissant
    assert rows[0]["candidates"] == 3
    assert rows[1] == {"group_id": "H", "stop_id": None, "candidates": 0}


def test_weighted_median_and_min_distance():
    assert sg.weighted_median([1, 2, 3], [1, 1, 10]) == 3
    assert sg.weighted_median([5, 1, 2], [1, 1, 1]) == 2
    assert sg.min_pair_distance(np.array([[0, 0], [3, 4], [10, 10]])) == 5


@pytest.mark.parametrize("out,ret,expected", [
    (ox.Leg(20, None), ox.Leg(30, None), "accessible"),
    (ox.Leg(20, None), ox.Leg(50, None), "out_only"),
    (ox.Leg(20, None), ox.Leg(None, "no_trip_within_120"), "out_only"),
    (ox.Leg(20, None), ox.Leg(None, "not_computed"), "unknown"),
    (ox.Leg(50, None), ox.Leg(None, "not_computed"), "none"),
    (ox.Leg(None, "no_trip_within_120"), ox.Leg(10, None), "none"),
    (ox.Leg(None, "origin_not_snapped"), ox.Leg(10, None), "unknown"),
    (ox.Leg(45, None), ox.Leg(45, None), "accessible"),
])
def test_dest_status_matches_front(out, ret, expected):
    assert sg.dest_status(out, ret, 45) == expected


def test_od_states_and_group_shares_on_a_swod_file():
    first, n_slots, n = 480, 40, 5
    out = np.full((n, n_slots), 255, dtype=np.uint8)
    ret = np.full((n, n_slots), 255, dtype=np.uint8)
    out[1], ret[1] = 20, 30  # accessible à 45 min
    out[2], ret[2] = 20, 50  # retour hors budget
    out[4], ret[4] = 254, 30  # aller : point non raccordé (enregistrement publié grâce au retour) : sans verdict
    buf = ox.pack_file(0, first, n_slots, [ox.series_section(0, 0, out, ret)])
    pf = ox.parse_file(buf)
    states = sg.od_states(pf, n, 0, start=600, end=660, budget=45, lookback=120)
    assert states == ["self", "accessible", "out_only", "none", "unknown"]
    shares = sg.group_shares(states, [10, 100, 200, 300, 400], [0, 0, 1, 1, 1], [110, 900])
    assert shares[0] == {"jobs": 110, "reached": 100, "not_reached": 0, "out_only": 0, "unknown": 0, "self": 10,
                         "share": 100 / 110}
    assert shares[1]["not_reached"] == 500 and shares[1]["out_only"] == 200 and shares[1]["unknown"] == 400
    assert shares[1]["share"] == 0
    # export partiel : destination absente dont le retour n'est pas calculé -> sans verdict seulement si l'aller...
    partial = sg.od_states(pf, n, 0, 600, 660, 45, 120, return_computed=[True, True, True, False, True])
    assert partial[3] == "none"  # ... est mesuré : aucun aller trouvé reste « non accessible » (règle du front)


@pytest.mark.skipif(not sg.GEO04_XLSX.exists() or not (PROCESSED_DIR / "communes_idf_2026.csv").exists(),
                    reason="GEO04 ou communes_idf_2026.csv absent (données non versionnées)")
def test_real_bassins_cover_all_origins():
    from starway.geo import load_passage_table
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    origins = communes[communes["is_origin"]]
    bassins = sg.read_bassins()
    att = sg.attach_origins(origins[["insee", "name"]], bassins, load_passage_table())
    assert len(att.bassin_of) == 1285 and len(set(att.bassin_of.values())) == 25
    deleg = att.report[att.report["status"] == "delegated_commune"]
    assert deleg["same_bassin_as_chef_lieu"].all()
    jobs_df = pd.read_csv(PROCESSED_DIR / "jobs_by_commune_2023.csv", dtype={"insee": str})
    jobs = dict(zip(jobs_df["insee"], jobs_df["jobs"].astype(int)))
    total = int(jobs_df.loc[jobs_df["geo_object"] == "COM", "jobs"].sum())
    for split, n_groups in (("poles3", 27), ("arrondissements", 44)):
        groups = sg.build_groups(att, jobs, split)
        assert len(groups) == n_groups
        assert sg.check_partition(groups, origins["insee"].tolist()) == []
        assert sum(g.jobs for g in groups) == total


def test_ordinal_and_short_name_rule():
    assert [sg.ordinal_fr(n) for n in (1, 2, 20)] == ["1er", "2e", "20e"]
    names = {"77001": "Alpha", "77002": "Bêta", "77003": "Gamma", "75112": "Paris 12e Arrondissement"}
    jobs = {"77001": 10, "77002": 30, "77003": 30, "75112": 5}
    g = sg.Group("BE_1200", "B1200", "1200", "B1200", ("77001", "77002", "77003"))
    assert sg.short_name(g, names, jobs) == ("Bêta", "77002")  # égalité : code INSEE croissant
    arr = sg.Group("BE_1107_75112", "x", sg.PARIS_BASSIN, "T1 Paris", ("75112",))
    assert sg.short_name(arr, names, jobs) == ("12e", "75112")
    assert sg.official_name(arr, names) == "Paris 12e Arrondissement"
    assert sg.official_name(g, names) == "B1200"


def test_expected_group_count_is_derived_from_bassins():
    att = _paris_attachment({"77001": "1200", "77002": "1100"})
    assert sg.expected_group_count(att, "arrondissements") == 3 - 1 + 20
    assert sg.expected_group_count(att, "poles3") == 3 - 1 + 3


def test_jobs_barycentre_weights_by_jobs():
    lonlat = {"a": (2.0, 48.0), "b": (3.0, 48.0)}
    g = sg.Group("G", "G", "1", "B", ("a", "b"))
    one = sg.jobs_barycentre([g], lonlat, {"a": 1, "b": 0})[0]
    assert one == pytest.approx((2.0, 48.0), abs=1e-6)
    mid = sg.jobs_barycentre([g], lonlat, {"a": 1, "b": 1})[0]
    assert 2.0 < mid[0] < 3.0
    with pytest.raises(ValueError):
        sg.jobs_barycentre([g], lonlat, {"a": 0, "b": 0})


def test_build_sky_poles_is_deterministic_and_complete():
    att = _paris_attachment({"77001": "1200", "77002": "1200", "77003": "1100"})
    codes = sorted(att.bassin_of)
    origins = pd.DataFrame({"insee": codes, "name": [f"N{c}" for c in codes],
                            "lon": [2.3 + 0.01 * i for i in range(len(codes))], "lat": [48.85] * len(codes)})
    jobs = {c: 100 + i for i, c in enumerate(codes)}
    located = pd.DataFrame({"stop_id": [f"S{c}" for c in codes], "stop_name": [f"Arrêt {c}" for c in codes],
                            "insee": codes, "lon": origins["lon"], "lat": origins["lat"],
                            "departures": list(range(len(codes)))})
    a = sg.build_sky_poles(att, origins, jobs, located, 2023, "17/11/2026")
    b = sg.build_sky_poles(att, origins, jobs, located, 2023, "17/11/2026")
    assert a == b and len(a) == sg.expected_group_count(att, "arrondissements") == 22
    assert sum(p["jobs"] for p in a) == sum(jobs.values())
    assert a[0]["id"] == "BE_1107_75101" and a[0]["name_short"] == "1er" and a[0]["name"] == "N75101"
    b1200 = next(p for p in a if p["id"] == "BE_1200")
    assert b1200["name_short"] == "N77002" and b1200["point"]["stop_id"] == "S77002"  # plus de postes, plus desservi
    assert b1200["bassin"] == {"code": "1200", "name": "B1200", "source": sg.GEO04_SOURCE}
    # astre d'une seule commune : barycentre = centre de la commune, même projection que les communes
    from starway.geo import round_sky, sky_project
    x, y = sky_project(origins.lon.iloc[0], origins.lat.iloc[0])
    assert a[0]["sky"] == {"x": round_sky(x), "y": round_sky(y)}
    with pytest.raises(ValueError, match="partition"):
        sg.build_sky_poles(att, origins[origins.insee != "77003"], jobs, located, 2023, "17/11/2026")


def test_pole_set_kind():
    from starway.poles import POLE_DEFS
    assert sg.pole_set_kind([{"id": d.id} for d in POLE_DEFS]) == "pole_defs"
    assert sg.pole_set_kind([{"id": "BE_1107_75101", "bassin": {"code": "1107"}}]) == "d030"
    assert sg.d030_split([{"id": "BE_1107_75101"}]) == "arrondissements"
    assert sg.d030_split([{"id": "P_PARIS_QCA"}, {"id": "BE_1108"}]) == "poles3"
    assert sg.pole_set_kind([{"id": "X"}]) == "unknown"


def test_screen_geometry_mirrors_front_radius_rule():
    xy = np.array([[0.4, 0.5], [0.6, 0.5]])
    bounds = np.array([[0.0, 0.0], [1.0, 1.0]])
    pxy, r = sg.screen_geometry(xy, [100, 25], bounds, 1600, 900)
    # aire ∝ postes : rapport des rayons = racine du rapport des postes
    assert r[0] / r[1] == pytest.approx(2.0)
    h = 900 - 104 - 190
    assert r[0] == pytest.approx(max(14, h * 0.05, 4 * 2))
    assert pxy[0, 1] == pytest.approx(pxy[1, 1])


def test_overlaps_and_zoom_to_separate():
    xy = np.array([[0.0, 0.0], [10.0, 0.0], [100.0, 0.0]])
    r = np.array([8.0, 8.0, 1.0])
    assert [(i, j) for i, j, _, _ in sg.overlapping_pairs(xy, r)] == [(0, 1)]
    assert sg.zoom_to_separate(xy, r, "constant") == pytest.approx(1.6)
    assert sg.zoom_to_separate(xy, r, "sqrt") == pytest.approx(2.56)
    assert sg.zoom_to_separate(xy, r, "linear") == float("inf")
    assert sg.zoom_to_separate(xy[[0, 2]], r[[0, 2]], "constant") == 1.0
