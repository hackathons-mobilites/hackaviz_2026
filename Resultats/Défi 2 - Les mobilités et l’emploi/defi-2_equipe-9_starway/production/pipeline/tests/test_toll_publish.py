"""Péages publiés (starway/toll_publish.py) : cellules `car_trip.toll`, tolls.json, péage d'un sens dans sa fenêtre.

Les grilles et les chemins ci-dessous sont des FIXTURES (format des sources, valeurs de l'exemple), pas des résultats
publiés. Les cas `LEG_CASES` sont recopiés dans frontend/src/data/tolls.test.ts : les deux implémentations doivent
rendre les mêmes valeurs.
"""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from starway import toll_publish as tp
from starway import toll_tariffs as tt
from tests.test_toll_tariffs import DUPLEX_TXT, JORF_CHAMBOURCY, JORF_MONTESSON, SANEF_LAYOUT

IDX = {p.point_id: i for i, p in enumerate(tt.POINTS)}
M, R, V, Z = IDX["SAPN_A14_MONTESSON"], IDX["DUPLEX_RUEIL"], IDX["DUPLEX_VAUCRESSON"], IDX["DUPLEX_VELIZY"]

# Chemins « Duplex A86 » (sens, latitudes) au format de duplex_ways ; Vaucresson à 48,8324
DWAYS = {1: {"dir": "S", "lat_min": 48.8601, "lat_max": 48.8699},  # sud, au nord de Vaucresson
         2: {"dir": "S", "lat_min": 48.8276, "lat_max": 48.8296},  # sud, au-delà de Vaucresson
         3: {"dir": "N", "lat_min": 48.8309, "lat_max": 48.8600},  # nord, commence avant Vaucresson
         4: {"dir": "N", "lat_min": 48.8600, "lat_max": 48.8668}}  # nord, au-delà de Vaucresson
V_LAT = 48.8324


@pytest.fixture
def tariffs(tmp_path) -> pd.DataFrame:
    m, c, a = tmp_path / "m.xml", tmp_path / "c.xml", tmp_path / "a86.txt"
    m.write_text(JORF_MONTESSON, encoding="utf-8")
    c.write_text(JORF_CHAMBOURCY, encoding="utf-8")
    a.write_bytes(DUPLEX_TXT.encode("cp1252"))
    rows = (tt.a14_tariffs([m, c], ["m.xml", "c.xml"]) + tt.duplex_tariffs(a, "a86.txt") + tt.missing_tariffs()
            + tt.sanef_a4_tariffs(SANEF_LAYOUT, "s.pdf")
            + tt.aprr_tariffs({("FLEURY-EN-BIERE", "URY"): (12.0, 2.0, 3.0, 4.0, 5.0, 1.4),
                               ("URY", "FLEURY-EN-BIERE"): (12.0, 2.0, 3.0, 4.0, 5.0, 1.4),
                               ("URY", "NEMOURS"): (20.0, 2.5, 3.0, 4.0, 5.0, 1.5)}, "x.pdf"))
    return pd.DataFrame(rows, columns=tt.TARIFF_COLUMNS)


@pytest.fixture
def tj(tariffs) -> dict:
    return tp.build_tolls_json(tariffs, date(2026, 11, 17), "test", [])


def test_duplex_passage_from_ways() -> None:
    assert tp.duplex_passage(["DUPLEX_RUEIL"], [1, 2], DWAYS, V_LAT) == ("DUPLEX_RUEIL", "DUPLEX_VELIZY")
    assert tp.duplex_passage(["DUPLEX_RUEIL"], [1], DWAYS, V_LAT) == ("DUPLEX_RUEIL", "DUPLEX_VAUCRESSON")
    assert tp.duplex_passage(["DUPLEX_VAUCRESSON"], [2], DWAYS, V_LAT) == ("DUPLEX_VAUCRESSON", "DUPLEX_VELIZY")
    assert tp.duplex_passage(["DUPLEX_VAUCRESSON"], [3, 4], DWAYS, V_LAT) == ("DUPLEX_VAUCRESSON", "DUPLEX_RUEIL")
    assert tp.duplex_passage(["DUPLEX_VELIZY"], [3, 4], DWAYS, V_LAT) == ("DUPLEX_VELIZY", "DUPLEX_RUEIL")
    assert tp.duplex_passage(["DUPLEX_VAUCRESSON"], [3], DWAYS, V_LAT) is None  # entrée et sortie à Vaucresson
    assert tp.duplex_passage(["DUPLEX_RUEIL"], [3, 4], DWAYS, V_LAT) is None  # Rueil est sur la chaussée sud
    assert tp.duplex_passage(["DUPLEX_VAUCRESSON"], [], DWAYS, V_LAT) is None  # aucun chemin du tunnel : sens inconnu
    assert tp.duplex_passage(["DUPLEX_RUEIL"], [1, 4], DWAYS, V_LAT) is None  # deux sens : incohérent


def test_resolve_cell(tariffs) -> None:
    def cell(nodes, ways=()):
        return tp.resolve_cell(nodes, list(ways), tariffs, DWAYS, V_LAT, IDX)
    assert cell([]) == [] and cell([999]) == []  # nœud hors registre (parking) : ignoré
    assert cell([12120628914]) == [[M, M]]
    assert cell([137501371], [1, 2]) == [[R, Z]]
    # barrière de Coutevroult seule : la sortie n'est pas connue ; avec Saint-Jean ou Montreuil : prix de la grille Sanef
    assert cell([25196607]) == {"s": "couple_indetermine", "p": [IDX["SANEF_A4_COUTEVROULT"]]}
    cout, sj, mt = IDX["SANEF_A4_COUTEVROULT"], IDX["SANEF_A4_ST_JEAN"], IDX["SANEF_A4_MONTREUIL"]
    assert cell([25196607, 259083764]) == [[cout, sj]] and cell([264140281, 4390079353]) == [[cout, mt]]
    assert cell([259083764, 4390079353]) == {"s": "couple_absent", "p": [sj, mt]}  # aucun prix entre les deux
    assert cell([344943470]) == {"s": "non_trouve", "p": [IDX["SANEF_A1_SAINT_WITZ"]]}  # A1 : aucune case retenue
    fleury, ury, nemours = 35675144, 28870546, 649150142
    assert cell([fleury, ury]) == [[IDX["APRR_A6_FLEURY"], IDX["APRR_A6_URY"]]]
    assert cell([ury, nemours])["s"] == "couple_absent"  # un seul sens dans la grille : ordre inconnu
    assert cell([fleury, ury, nemours])["s"] == "couple_indetermine"
    assert cell([1200571098])["s"] == "sens_requis"


def test_tolls_json(tj) -> None:
    assert [p["id"] for p in tj["points"]] == [p.point_id for p in tt.POINTS]
    assert tj["days"]["0"]["weekday"] == "mardi" and tj["days"]["-1"]["types"]["DUPLEX_A86"] == "lundi"
    assert "notice" in tj["points"][M] and tj["points"][IDX["SANEF_A4_COUTEVROULT"]]["status"] == "ok"
    a1 = tj["points"][IDX["SANEF_A1_SAINT_WITZ"]]
    assert a1["status"] == "non_trouve" and "case isolée" in a1["reason"]
    a4 = [x for x in tj["grids"] if x["e"] == IDX["SANEF_A4_COUTEVROULT"] and x["s"] == IDX["SANEF_A4_ST_JEAN"]
          and x["c"] == 1 and x.get("d") == 0]
    assert a4 and a4[0]["slots"] == [[0, 1440, 3.9]]
    g = [x for x in tj["grids"] if x["e"] == R and x["s"] == Z and x["c"] == 5]
    assert g and g[0]["status"] == "interdit"
    m0 = next(x for x in tj["grids"] if x["e"] == M and x["c"] == 1 and x.get("d") == 0)
    assert m0["slots"][0] == [0, 360, 6.6] and [10 * 60, 16 * 60, 6.6] in m0["slots"]
    for x in tj["grids"]:
        for text in (x.get("reason") or "",):
            assert chr(0x2014) not in text and chr(0x2013) not in text


def test_tolls_json_duplicate_directions_make_one_slot(tariffs) -> None:
    """Barrière à plein tarif : une ligne par sens (même point, même tranche, même prix) = une seule tranche."""
    row = dict(zip(tt.TARIFF_COLUMNS, [None] * len(tt.TARIFF_COLUMNS), strict=True))
    row.update(point_id="DUPLEX_RUEIL", systeme="DUPLEX_A86", entree_point_id="DUPLEX_RUEIL", sortie_point_id="DUPLEX_RUEIL",
               classe=1, tarif="standard", type_jour="tous", heure_debut="00:00", heure_fin="24:00", prix_ttc_eur=1.7, statut="ok")
    twin = {**row, "sens": "vers Paris"}
    rows = pd.concat([tariffs, pd.DataFrame([{**twin}, {**twin, "sens": "depuis Paris"}], columns=tt.TARIFF_COLUMNS)], ignore_index=True)
    out = tp.build_tolls_json(rows, date(2026, 11, 17), "test", [])
    g = [x for x in out["grids"] if x["e"] == R and x["s"] == R and x["c"] == 1 and x.get("d") == 0]
    assert g and g[0]["slots"] == [[0, 1440, 1.7]]


# (cellule, classe, début, fin, tarif, attendu (min, max, statut)) ; minutes depuis minuit du mardi 17/11/2026
LEG_CASES = [
    ([], 1, 480, 520, "standard", (0.0, 0.0, "sans_peage")),
    ([[M, M]], 1, 480, 520, "standard", (10.8, 10.8, "ok")),  # 8h00-8h40 : tarif de base
    ([[M, M]], 1, 570, 620, "standard", (6.6, 10.8, "fourchette")),  # 9h30-10h20 : chevauche 10h
    ([[M, M]], 5, 660, 700, "standard", (3.4, 3.4, "ok")),  # classe 5, tarif réduit
    ([[M, M]], 1, -30, 20, "standard", (6.6, 6.6, "ok")),  # lundi 23h30 - mardi 0h20 : réduit les deux jours
    ([[M, M]], 1, 600, 600, "standard", (6.6, 6.6, "ok")),  # instant : la tranche qui contient 10h00
    ([[R, Z]], 1, 420, 440, "standard", (11.4, 11.4, "ok")),
    ([[R, Z]], 1, 420, 440, "telepeage", (11.4, 11.4, "ok")),
    ([[Z, R]], 1, 430, 460, "standard", (14.3, 14.9, "fourchette")),
    ([[R, Z]], 5, 420, 440, "standard", (None, None, "interdit")),
    ([[R, Z]], 1, 600, 620, "standard", (None, None, "tranche_absente")),  # fixture : grille partielle
    ([[M, M], [R, Z]], 1, 420, 440, "standard", (22.2, 22.2, "ok")),
    ({"s": "non_trouve", "p": [IDX["SANEF_A4_COUTEVROULT"]]}, 1, 420, 440, "standard", (None, None, "non_trouve")),
    (None, 1, 420, 440, "standard", (None, None, "no_route")),
    ([[M, M]], 1, 1430, 1450, "standard", (6.6, 6.6, "ok")),  # mardi 23h50 - mercredi 0h10
]


@pytest.mark.parametrize(("cell", "classe", "lo", "hi", "tarif", "expected"), LEG_CASES)
def test_toll_leg(tj, cell, classe, lo, hi, tarif, expected) -> None:
    r = tp.toll_leg(tj, cell, classe, lo, hi, tarif)
    assert (r["min"], r["max"], r["status"]) == (pytest.approx(expected[0]) if expected[0] is not None else None,
                                                  pytest.approx(expected[1]) if expected[1] is not None else None,
                                                  expected[2])


def test_window_prices_rejects_inverted() -> None:
    with pytest.raises(ValueError):
        tp.window_prices({0: [[0, 1440, 1.0]]}, 10, 5)
    assert tp.window_prices({0: [[0, 1440, 1.0]]}, 1430, 1450) == ([], "jour_absent")


def test_passage_order_for_one_way_grid(tariffs) -> None:
    """Grille qui ne publie qu'un sens (URY vers NEMOURS, fixture) : l'ordre vient des extrémités du trajet."""
    coords = {"APRR_A6_URY": (2.60, 48.33), "APRR_A6_NEMOURS": (2.70, 48.25)}
    north, south = (2.55, 48.40), (2.75, 48.20)
    assert tp.passage_order("APRR_A6_URY", "APRR_A6_NEMOURS", (north, south), coords) == ("APRR_A6_URY",
                                                                                         "APRR_A6_NEMOURS")
    assert tp.passage_order("APRR_A6_URY", "APRR_A6_NEMOURS", (south, north), coords) == ("APRR_A6_NEMOURS",
                                                                                         "APRR_A6_URY")
    assert tp.passage_order("APRR_A6_URY", "APRR_A6_NEMOURS", ((2.65, 48.29), (2.65, 48.29)), coords) is None
    ury, nemours = 28870546, 649150142
    i_u, i_n = IDX["APRR_A6_URY"], IDX["APRR_A6_NEMOURS"]
    cell = tp.resolve_cell([ury, nemours], [], tariffs, DWAYS, V_LAT, IDX, (north, south), coords)
    assert cell == [[i_u, i_n]]
    back = tp.resolve_cell([ury, nemours], [], tariffs, DWAYS, V_LAT, IDX, (south, north), coords)
    assert back == {"s": "couple_absent", "p": [i_n, i_u]}  # sens absent de la grille : inconnu, jamais deviné


def test_withdrawal_switch_removes_vinci_prices_everywhere(tariffs, monkeypatch) -> None:
    """Interrupteur de retrait VINCI actif : Duplex A86 et Cofiroute passent à `null` avec la raison, aucune grille VINCI
    n'est publiée ; l'A14 (SAPN) et l'A4 (Sanef) ne changent pas."""
    before = tp.build_tolls_json(tariffs, date(2026, 11, 17), "test", [])
    assert before["points"][R]["status"] == "ok" and before["grids"]  # sans interrupteur : les prix sont publiés
    withdrawn = tt.withdraw_vinci_points(tt.POINTS)
    monkeypatch.setattr(tt, "POINTS", withdrawn)
    monkeypatch.setattr(tt, "POINTS_BY_ID", {p.point_id: p for p in withdrawn})
    rows = [r for r in tariffs.to_dict("records") if r["systeme"] != "DUPLEX_A86"] + tt.missing_tariffs()
    tj2 = tp.build_tolls_json(pd.DataFrame(rows, columns=tt.TARIFF_COLUMNS), date(2026, 11, 17), "test", [])
    assert tj2["points"][R]["status"] == tt.STATUT_RETIRE and tj2["points"][R]["reason"].startswith(
        "réutilisation non autorisée")
    assert tj2["points"][M]["status"] == "ok"  # A14 : non touchée
    assert tj2["status_texts"][tt.STATUT_RETIRE]
    assert not [g for g in tj2["grids"] if g["e"] in (R, V, Z) or g["s"] in (R, V, Z)]
    assert [g for g in tj2["grids"] if g["e"] == M]  # la grille de l'A14 reste publiée
    assert tp.resolve_cell([137501371], [1, 2], tariffs, DWAYS, V_LAT, IDX) == {"s": tt.STATUT_RETIRE, "p": [R]}
    assert tp.resolve_cell([12120628914], [], tariffs, DWAYS, V_LAT, IDX) == [[M, M]]

def test_credit_beside_each_priced_point(tj) -> None:
    """Accord de l'organisateur du hackathon du 09/11/2026 (D-060) : chaque point qui a un prix porte le crédit de son
    producteur, année tirée de la date d'effet de la grille ; un point sans prix n'en a pas (rien n'est affiché)."""
    pts = {p["id"]: p for p in tj["points"]}
    assert pts["DUPLEX_RUEIL"]["credit"] == "tarif © VINCI Autoroutes 2026"
    assert pts["SANEF_A4_COUTEVROULT"]["credit"] == "tarif © Sanef 2026"
    assert pts["SAPN_A14_MONTESSON"]["credit"] == "tarif SAPN 2026 (Journal officiel)"
    assert pts["APRR_A6_URY"]["credit"] == "tarif APRR 2026"
    assert "credit" not in pts["SAPN_A13_BUCHELAY"]
    assert all(chr(0x2014) not in p.get("credit", "") and chr(0x2013) not in p.get("credit", "") for p in tj["points"])
