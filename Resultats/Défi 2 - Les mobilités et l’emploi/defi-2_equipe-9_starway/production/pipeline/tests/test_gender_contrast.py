"""Tests du contrôle du volet genre : marge combinée, valeurs absentes, aucun seuil inventé."""

from __future__ import annotations

import math

from starway import gender_contrast as gc


def test_ecart_au_dessus_de_la_marge_combinee() -> None:
    res = gc.mode_contrast(64.5, 57.8, 4.6, 4.1)
    assert res["diff"] == 6.7
    assert res["margin"] == round(math.sqrt(4.6**2 + 4.1**2), 2)  # 6,16
    assert res["verdict"] == "above_margin"


def test_ecart_dans_la_marge() -> None:
    res = gc.mode_contrast(5.0, 4.6, 0.8, 0.8)
    assert res["verdict"] == "within_margin"


def test_marge_absente_donne_non_evaluable_jamais_sans_ecart() -> None:
    res = gc.mode_contrast(2.1, 3.3, None, 1.0)
    assert res["verdict"] == "not_evaluable"
    assert res["diff"] == -1.2
    assert res["margin"] is None


def test_part_absente() -> None:
    assert gc.mode_contrast(None, 3.0, 1.0, 1.0)["verdict"] == "not_evaluable"


def _context(status: str = "ok") -> dict:
    return {
        "insee": "78358",
        "commute_mode_by_sex": {
            "status": status,
            "F": {"transit": 64.5, "car": 23.1, "bike": 2.1, "walk": 5.0, "other": 5.3},
            "H": {"transit": 57.8, "car": 27.4, "bike": 3.3, "walk": 4.6, "other": 6.9},
            "totals": {"F": 5655, "H": 5749},
            "margin95": {
                "F": {"transit": 4.6, "car": 2.2, "bike": None, "walk": 0.8, "other": 0.9},
                "H": {"transit": 4.1, "car": 2.6, "bike": None, "walk": 0.8, "other": 1.2},
            },
        },
    }


def test_commune_contrast_valeurs_du_fichier_publie() -> None:
    res = gc.commune_contrast(_context())
    assert res is not None
    assert res["modes"]["transit"]["verdict"] == "above_margin"
    assert res["modes"]["car"]["verdict"] == "above_margin"  # 4,3 points d'écart, marge combinée 3,41
    assert res["modes"]["walk"]["verdict"] == "within_margin"
    assert res["modes"]["bike"]["verdict"] == "not_evaluable"
    assert res["above_margin"] == ["transit", "car", "other"]
    assert (res["actifs_F"], res["actifs_H"]) == (5655, 5749)


def test_bloc_non_publie_ignore() -> None:
    assert gc.commune_contrast(_context("secret")) is None
    assert gc.commune_contrast({"insee": "1"}) is None


def test_summarize_compte_et_communes_du_recit() -> None:
    results = {"78358": gc.commune_contrast(_context())}
    s = gc.summarize(results, ["78358", "99999"])
    assert s["communes_evaluated"] == 1
    assert s["per_mode"]["transit"]["above_margin"] == 1
    assert s["per_mode"]["bike"]["not_evaluable"] == 1
    assert s["transit_above_margin_communes"] == 1
    assert s["transit_above_margin_direction"] == {"F_higher": 1, "H_higher": 0}
    assert list(s["focus"]) == ["78358"]
    assert s["focus_missing"] == ["99999"]
