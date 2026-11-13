"""Tests de starway.needs : chaque information d'accessibilité vient d'une source, une valeur absente reste None."""

import gzip
import json
from pathlib import Path

import pandas as pd
import pytest

from starway import needs as nd

EM = chr(0x2014)
EN = chr(0x2013)


def hhmm(s: int) -> str:
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}"


@pytest.fixture
def facts() -> nd.NeedsFacts:
    lines = nd.load_lines(pd.DataFrame({
        "id_line": ["C01742", "C01371", "C00001", None],
        "accessibility": ["true", "false", " TRUE ", "true"],
        "audiblesigns_available": ["true", "partial", "", "true"],
        "visualsigns_available": ["false", "unknown", "oui", "true"],
    }))
    stations, levels = nd.load_stations(pd.DataFrame({
        "stop_point_id": ["stop_point:IDFM:monomodalStopPlace:47915", "stop_point:IDFM:monomodalStopPlace:462398", None],
        "accessibility_level_id": ["1", "3", "2"],
        "accessibility_level_name": ["gare ou arrêt non accessible", f"train accessible {EN} AssistenGare",
                                     "x"],
        "commentaire": [None, "  quai 1 seulement  ", "y"],
    }))
    return nd.NeedsFacts(lines, stations, levels)


def test_route_line_id() -> None:
    assert nd.route_line_id("IDFM:C01742") == "C01742"
    assert nd.route_line_id("C01742") == "C01742"
    assert nd.route_line_id(None) is None
    assert nd.route_line_id("") is None


def test_load_lines_normalise_et_ignore_les_valeurs_hors_liste(facts: nd.NeedsFacts) -> None:
    assert facts.lines["C01742"] == ("true", "true", "false")
    assert facts.lines["C01371"] == ("false", "partial", "unknown")
    # vide ou hors liste = unknown, jamais une valeur devinée ; casse et espaces ignorés
    assert facts.lines["C00001"] == ("true", "unknown", "unknown")
    assert None not in facts.lines and len(facts.lines) == 3


def test_load_stations_prefixe_commentaire_et_tirets(facts: nd.NeedsFacts) -> None:
    assert facts.stations["IDFM:monomodalStopPlace:47915"] == nd.Station(1, None)
    assert facts.stations["IDFM:monomodalStopPlace:462398"] == nd.Station(3, "quai 1 seulement")
    # la ligne sans stop_point_id est ignorée (son niveau 2 n'apparaît pas)
    assert facts.levels == {1: "gare ou arrêt non accessible", 3: "train accessible - AssistenGare"}
    assert EM not in json.dumps(facts.levels) and EN not in json.dumps(facts.levels)


def test_load_stations_refuse_deux_libelles_pour_un_niveau() -> None:
    frame = pd.DataFrame({"stop_point_id": ["stop_point:a", "stop_point:b"], "accessibility_level_id": ["1", "1"],
                          "accessibility_level_name": ["non", "oui"], "commentaire": [None, None]})
    with pytest.raises(ValueError, match="plusieurs libellés"):
        nd.load_stations(frame)


def test_leg_a11y_metro_ligne_connue_sans_gare(facts: nd.NeedsFacts) -> None:
    a = facts.leg_a11y("metro", "IDFM:C01742", "A", "B")
    assert a == {"line": "true", "audio": "true", "visual": "false"}  # métro : pas de TRA04, clés de gare absentes


def test_leg_a11y_ligne_absente_du_referentiel_reste_none(facts: nd.NeedsFacts) -> None:
    a = facts.leg_a11y("bus", "IDFM:C99999", None, None)
    assert a == {"line": None, "audio": None, "visual": None}
    assert facts.seen["line_absent"] == 1


def test_leg_a11y_rer_publie_les_deux_gares_meme_absentes(facts: nd.NeedsFacts) -> None:
    a = facts.leg_a11y("rer", "IDFM:C01371", "IDFM:monomodalStopPlace:47915", "IDFM:monomodalStopPlace:inconnu")
    assert a["st_from"] == {"level": 1}
    assert a["st_to"] is None  # gare absente de TRA04 : None, pas un niveau deviné
    assert a["line"] == "false"


def test_leg_a11y_gare_trouvee_sur_un_tronçon_non_ferre(facts: nd.NeedsFacts) -> None:
    a = facts.leg_a11y("tram", "IDFM:C01742", "IDFM:monomodalStopPlace:462398", "x")
    assert a["st_from"] == {"level": 3, "comment": "quai 1 seulement"} and a["st_to"] is None


def test_leg_a11y_comptes(facts: nd.NeedsFacts) -> None:
    facts.leg_a11y("rer", "IDFM:C01371", "IDFM:monomodalStopPlace:47915", "IDFM:monomodalStopPlace:462398")
    assert facts.seen["legs"] == 1 and facts.seen["legs_rer"] == 1
    assert facts.seen["station_1"] == 1 and facts.seen["station_3"] == 1 and facts.seen["stations"] == 2


def enriched(kind: str, line: str | None, dep: int, arr: int, route: str | None = None) -> dict:
    return {"kind": kind, "line": line, "dep_s": dep, "arr_s": arr, "route_id": route, "from_stop": None,
            "to_stop": None}


def test_leg_matches() -> None:
    pub = {"m": "metro", "dep": "05:51", "arr": "05:52", "line": "7"}
    assert nd.leg_matches(pub, enriched("metro", "7", 5 * 3600 + 51 * 60, 5 * 3600 + 52 * 60), hhmm)
    assert not nd.leg_matches(pub, enriched("metro", "8", 5 * 3600 + 51 * 60, 5 * 3600 + 52 * 60), hhmm)
    assert not nd.leg_matches(pub, enriched("bus", "7", 5 * 3600 + 51 * 60, 5 * 3600 + 52 * 60), hhmm)
    assert not nd.leg_matches(pub, enriched("metro", "7", 5 * 3600 + 51 * 60, 5 * 3600 + 53 * 60), hhmm)
    walk = {"m": "walk", "dep": "05:45", "arr": "05:50"}
    assert nd.leg_matches(walk, enriched("walk", None, 5 * 3600 + 45 * 60, 5 * 3600 + 50 * 60), hhmm)


def trip_fixture() -> tuple[dict, list[dict]]:
    pub = {"status": "ok", "legs": [
        {"m": "walk", "dep": "05:45", "arr": "05:50", "role": "access"},
        {"m": "metro", "dep": "05:51", "arr": "05:52", "line": "7", "wc_trip": False},
    ]}
    enr = [enriched("walk", None, 5 * 3600 + 45 * 60, 5 * 3600 + 50 * 60),
           enriched("metro", "7", 5 * 3600 + 51 * 60, 5 * 3600 + 52 * 60, "IDFM:C01742")]
    return pub, enr


def test_annotate_trip_ajoute_a11y_aux_seuls_troncons_en_tc(facts: nd.NeedsFacts) -> None:
    pub, enr = trip_fixture()
    out = nd.annotate_trip(pub, enr, facts, hhmm)
    assert "a11y" not in out["legs"][0]
    assert out["legs"][1]["a11y"] == {"line": "true", "audio": "true", "visual": "false"}
    assert out["legs"][1]["wc_trip"] is False  # champs existants intacts
    assert "a11y" not in pub["legs"][1]  # entrée non modifiée


def test_annotate_trip_idempotent(facts: nd.NeedsFacts) -> None:
    pub, enr = trip_fixture()
    once = nd.annotate_trip(pub, enr, facts, hhmm)
    twice = nd.annotate_trip(once, enr, facts, hhmm)
    assert once == twice


def test_annotate_trip_refuse_un_alignement_douteux(facts: nd.NeedsFacts) -> None:
    pub, enr = trip_fixture()
    with pytest.raises(ValueError, match="tronçons publiés"):
        nd.annotate_trip(pub, enr[:1], facts, hhmm)
    enr[1]["line"] = "8"
    with pytest.raises(ValueError, match="différent des lots"):
        nd.annotate_trip(pub, enr, facts, hhmm)


def test_with_meta_place_needs_meta_avant_days_et_remplace() -> None:
    doc = {"insee": "75101", "poles": ["a"], "days": {}, "offpeak": {}}
    out = nd.with_meta(doc, {"contract": nd.NEEDS_CONTRACT})
    assert list(out) == ["insee", "poles", "needs_meta", "days", "offpeak"]
    again = nd.with_meta(out, {"contract": "autre"})
    assert list(again) == list(out) and again["needs_meta"] == {"contract": "autre"}


def test_strip_needs_retire_a11y_et_meta(facts: nd.NeedsFacts) -> None:
    pub, enr = trip_fixture()
    doc = {"insee": "x", "days": {"d06": {"out": [nd.annotate_trip(pub, enr, facts, hhmm),
                                                  {"status": "no_option", "reason": None}], "ret": []}}}
    doc = nd.with_meta(doc, {"contract": nd.NEEDS_CONTRACT})
    stripped = nd.strip_needs(doc)
    assert "needs_meta" not in stripped
    assert all("a11y" not in lg for t in stripped["days"]["d06"]["out"] for lg in t.get("legs", []))
    assert stripped["days"]["d06"]["out"][1] == {"status": "no_option", "reason": None}


def test_published_from_docs_lit_tra04_seulement_si_applique(tmp_path) -> None:
    tra04 = tmp_path / "tra04.csv"
    tra04.write_text("stop_point_id;accessibility_level_id;accessibility_level_name;commentaire\n"
                     "stop_point:IDFM:monomodalStopPlace:1;1;non accessible;\n", encoding="utf-8")
    b = nd.file_meta("a", "b")
    assert nd.published_from_docs([{"days": {}}, {"days": {}}], tmp_path / "absent.csv") is None  # pas lu
    assert nd.published_from_docs([], tmp_path / "absent.csv") is None
    pm = nd.published_from_docs([{"needs_meta": b}, {"needs_meta": dict(b)}], tra04)
    assert pm is not None and pm["station_levels"] == {"1": "non accessible"}
    assert nd.published_from_docs([{"needs_meta": b}, {"days": {}}], tra04) is None  # fichiers mêlés : rien d'annoncé


def test_published_meta_commun_ou_none() -> None:
    b = nd.file_meta("a", "b")
    meta = nd.published_meta([b, dict(b)], {2: "x", 1: "y"})
    assert meta is not None and meta["needs"] == ["wc_trip", "wc_stops", "station", "audio", "visual"]
    assert meta["station_levels"] == {"1": "y", "2": "x"} and meta["contract"] == nd.NEEDS_CONTRACT
    assert "texts" not in meta  # les textes affichés sont ceux du front (version finale du 05/11)
    assert nd.published_meta([b, nd.file_meta("a", "c")], {}) is None
    assert nd.published_meta([b, None], {}) is None
    assert nd.published_meta([], {}) is None


def test_plus_de_classement_par_handicap() -> None:
    """Version finale du 05/11 : aucune case par handicap ni daltonisme dans les identifiants publiés."""
    assert set(nd.NEEDS).isdisjoint({"wheelchair", "visual_impairment", "hearing", "color"})
    assert nd.SKY_BOXES == ("wc_trip", "wc_stops", "station") and set(nd.SKY_BOXES) < set(nd.BOXES)
    assert "audio" not in nd.SKY_BOXES and "visual" not in nd.SKY_BOXES


# --- règle du ciel : cas partagés avec le front (frontend/src/data/needsRuleCases.json) ------------------------

REPO = Path(__file__).resolve().parents[2]
CASES = json.loads((REPO / "frontend" / "src" / "data" / "needsRuleCases.json").read_text(encoding="utf-8"))


def _legs(names: list[str] | None) -> list[dict] | None:
    return None if names is None else [CASES["legs"][n] for n in names]


@pytest.mark.parametrize("case", CASES["mark"], ids=[c["name"] for c in CASES["mark"]])
def test_star_marked_cas_partages(case: dict) -> None:
    assert nd.star_marked(_legs(case["out"]), _legs(case["ret"]), case["selected"]) is case["marked"]


@pytest.mark.parametrize("case", CASES["boxes"], ids=[c["name"] for c in CASES["boxes"]])
def test_box_state_cas_partages(case: dict) -> None:
    assert nd.box_state(case["box"], _legs(case["legs"])) == case["state"]


def test_box_state_refuse_une_case_inconnue() -> None:
    with pytest.raises(ValueError, match="case inconnue"):
        nd.box_state("wheelchair", [CASES["legs"]["bus_ok"]])


def test_la_marque_ne_depend_pas_de_l_ordre_ni_des_doublons_des_cases() -> None:
    legs = _legs(["bus_ok"])
    assert nd.star_marked(legs, legs, ["station", "wc_trip", "wc_trip", "audio"]) is True
    assert nd.star_marked(legs, legs, iter(["wc_stops"])) is True


def test_station_niveaux_4_et_6_remplis_3_et_1_non_remplis() -> None:
    assert nd.STATION_FILLED_LEVELS == (4, 6) and nd.STATION_NOT_FILLED_LEVELS == (1, 3)
    for level, state in ((4, "filled"), (6, "filled"), (3, "not_filled"), (1, "not_filled"), (2, "not_stated")):
        leg = {"m": "rer", "a11y": {"line": "true", "audio": "true", "visual": "true", "st_from": {"level": level},
                                    "st_to": {"level": 6}}}
        assert nd.box_state("station", [leg]) == state


def test_cas_partages_sans_tiret_long() -> None:
    raw = (REPO / "frontend" / "src" / "data" / "needsRuleCases.json").read_text(encoding="utf-8")
    assert EM not in raw and EN not in raw


def test_mesure_07n_compte_les_couples_aller_retour() -> None:
    import importlib.util
    from collections import Counter

    spec = importlib.util.spec_from_file_location("needs_measure", REPO / "pipeline" / "scripts" / "07n_needs_measure.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    L = CASES["legs"]

    def trip(names: list[str], minutes: int) -> dict:
        return {"status": "ok", "matrix_min": minutes, "legs": [L[n] for n in names]}

    doc = {"days": {"d09": {
        "out": [trip(["bus_ok"], 30), trip(["bus_ok"], 30), trip(["walk"], 5), {"status": "no_trip_in_matrix"}],
        "ret": [trip(["bus_ok"], 30), trip(["bus_vehicule_non"], 90), trip(["walk"], 5), trip(["bus_ok"], 30)]}}}
    acc = {"all": Counter(), "budget": Counter()}
    mod.measure_doc(doc, 60, acc)
    assert acc["all"]["pairs"] == 3 and acc["all"]["walk_only"] == 1  # le 4e couple n'a pas d'aller détaillé
    assert acc["all"]["marked_1_2_3"] == 1 and acc["all"]["box_wc_trip"] == 1
    assert acc["budget"]["pairs"] == 2  # le 2e couple dépasse le budget au retour
    s = mod.summarize(acc["all"])
    assert s["pct"]["1_wc_trip"] == 33.3 and s["pct"]["marked_1_2_3"] == 33.3

def test_a11y_errors() -> None:
    ok = {"m": "metro", "a11y": {"line": "true", "audio": None, "visual": "partial"}}
    assert nd.a11y_errors(ok, True) == []
    assert nd.a11y_errors({"m": "walk"}, True) == []
    assert nd.a11y_errors({"m": "walk", "a11y": {}}, True) == ["a11y sur un tronçon à pied"]
    assert nd.a11y_errors({"m": "bus"}, True) == ["a11y absent d'un tronçon en TC"]
    assert nd.a11y_errors(ok, False) == ["a11y sans needs_meta"]
    assert nd.a11y_errors({"m": "bus"}, False) == []
    bad = {"m": "rer", "a11y": {"line": "oui", "audio": "x", "visual": None, "st_from": {"level": "1"}}}
    errs = nd.a11y_errors(bad, True)
    assert "line 'oui'" in errs and "audio 'x'" in errs and "gare absente d'un tronçon ferré" in errs
    assert any(e.startswith("st_from") for e in errs)


def test_lecture_ecriture_json_et_gz_idempotente(tmp_path) -> None:
    doc = {"insee": "75101", "txt": "é"}
    for name in ("75101.json", "75101.json.gz"):
        p = tmp_path / name
        n = nd.write_doc(p, doc)
        assert n == p.stat().st_size and nd.read_doc(p) == doc
        mtime = p.stat().st_mtime_ns
        nd.write_doc(p, doc)
        assert p.stat().st_mtime_ns == mtime  # contenu identique : pas réécrit
    assert gzip.decompress((tmp_path / "75101.json.gz").read_bytes()).decode() == '{"insee":"75101","txt":"é"}'
    assert nd.insee_of(tmp_path / "75101.json.gz") == "75101"
    assert [f.name for f in nd.doc_files(tmp_path)] == ["75101.json.gz"]  # .gz prioritaire
    assert nd.doc_files(tmp_path / "absent") == []
