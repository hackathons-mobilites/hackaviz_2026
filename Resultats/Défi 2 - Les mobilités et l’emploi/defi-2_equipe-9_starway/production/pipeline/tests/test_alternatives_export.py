"""Export `alternatives-1` : trois états stricts, couverture, contrôle de cohérence."""

from __future__ import annotations

from starway import alternatives as alt
from starway import alternatives_export as ax


def option(*lines: str) -> dict:
    return {"dep_s": 0, "arr_s": 1800, "legs": [{"kind": "transit", "route_id": x, "from_stop": "a", "to_stop": "b"} for x in lines]}


def rec(a: tuple, b: tuple | None = None, c: tuple | None = None, palier: int = 1) -> dict:
    make = lambda k: None if k is None else {"option": option(*k), "lines": list(k)}  # noqa: E731
    return {"pole": "P1", "day": "d09", "dir": "out", "palier": palier, "status": "ok", "A": make(a), "B": make(b), "C": make(c)}


def jsonify(_o: dict) -> dict:
    return {k: 1 for k in ax.TRIP_FIELDS}


def test_non_calcule_jamais_presente_comme_sans_alternative():
    assert ax.cell(None, jsonify) == {"state": alt.NOT_YET}


def test_memes_lignes_que_a_donne_null_et_etat_sans_alternative():
    c = ax.cell(rec(("L1",), ("L1",), ("L1",)), jsonify)
    assert c["state"] == alt.CALCULATED_WITHOUT and c["B"] is None and c["C"] is None and c["a_lines"] == ["L1"]


def test_b_different_et_c_identique_a_b():
    c = ax.cell(rec(("L1",), ("L2",), ("L2",)), jsonify)
    assert c["state"] == alt.CALCULATED_WITH and c["B"]["min"] == 1 and c["C"] == {"same_as": "B"}


def test_trajet_sans_a_est_calcule_sans_alternative_avec_son_statut():
    r = {"pole": "P1", "day": "d09", "dir": "out", "palier": 1, "status": "no_trip_in_matrix", "A": None, "B": None, "C": None}
    assert ax.cell(r, jsonify) == {"state": alt.CALCULATED_WITHOUT, "status": "no_trip_in_matrix"}


def test_palier_avec_departs_plus_tot_remplace_le_palier_sans():
    merged = ax.merge_paliers([rec(("L1",), palier=2), rec(("L9",), palier=1)])
    assert merged[("P1", "d09", "out")]["palier"] == 2


def rated(lines: tuple, cost: float | None, minutes: int, rides: int) -> dict:
    return {"option": option(*lines), "lines": list(lines), "cost_eur": cost, "min": minutes, "rides": rides}


def test_a_moins_cher_que_b_donne_b_null():
    # B est pris parmi les options à l'heure, A parmi toutes : si A coûte moins, « le moins cher » est A lui-même
    r = rec(("L1",)) | {"A": rated(("L1",), 2.05, 66, 2), "B": rated(("L2",), 4.6, 62, 2), "C": None}
    c = ax.cell(r, jsonify)
    assert c["B"] is None and c["state"] == alt.CALCULATED_WITHOUT


def test_a_meme_prix_et_plus_court_donne_b_null_mais_egalite_stricte_garde_b():
    r = rec(("L1",)) | {"A": rated(("L1",), 4.6, 60, 2), "B": rated(("L2",), 4.6, 70, 2), "C": None}
    assert ax.cell(r, jsonify)["B"] is None
    r = rec(("L1",)) | {"A": rated(("L1",), 4.6, 60, 2), "B": rated(("L2",), 4.6, 60, 2), "C": None}
    assert ax.cell(r, jsonify)["B"] is not None


def test_prix_de_a_inconnu_ne_bat_jamais_b():
    r = rec(("L1",)) | {"A": rated(("L1",), None, 60, 2), "B": rated(("L2",), 4.6, 70, 2), "C": None}
    assert ax.cell(r, jsonify)["state"] == alt.CALCULATED_WITH


def test_a_moins_de_montees_que_c_donne_c_null_et_c_ne_renvoie_pas_a_un_b_ecarte():
    r = rec(("L1",)) | {"A": rated(("L1",), 2.0, 60, 1), "B": rated(("L2",), 4.6, 62, 2), "C": rated(("L3",), 3.0, 61, 2)}
    c = ax.cell(r, jsonify)
    assert c["B"] is None and c["C"] is None and c["state"] == alt.CALCULATED_WITHOUT
    r = rec(("L1",)) | {"A": rated(("L1",), 2.0, 60, 2), "B": rated(("L2",), 4.6, 62, 1), "C": rated(("L2",), 4.6, 62, 1)}
    c = ax.cell(r, jsonify)
    assert c["B"] is None and c["C"]["min"] == 1 and c["state"] == alt.CALCULATED_WITH


def docs_and_coverage() -> tuple[dict, dict]:
    doc = ax.commune_doc("75101", [rec(("L1",), ("L2",))], ["P1", "P2"], ["d09"], jsonify, {})
    return {"75101": doc}, ax.coverage_doc(["75101", "75102"], {"75101": doc}, ["P1", "P2"], ["d09"], {})


def test_couverture_coherente_et_commune_sans_fichier_a_null():
    docs, cov = docs_and_coverage()
    assert cov["communes"]["75102"] is None
    assert cov["communes"]["75101"]["d09"]["out"] == "an"
    assert cov["communes"]["75101"]["d09"]["ret"] == "nn"
    assert cov["counts"][alt.CALCULATED_WITH] == 1
    assert ax.check_published(cov, docs, ["75101", "75102"]) == []


def test_controle_detecte_les_incoherences():
    docs, cov = docs_and_coverage()
    cov["communes"]["75101"]["d09"]["out"] = "sn"
    assert any("différent de la couverture" in e for e in ax.check_published(cov, docs, ["75101", "75102"]))
    docs, cov = docs_and_coverage()
    del docs["75101"]
    assert any("sans fichier" in e for e in ax.check_published(cov, docs, ["75101", "75102"]))
    docs, cov = docs_and_coverage()
    assert any("écart" in e for e in ax.check_published(cov, docs, ["75101"]))
