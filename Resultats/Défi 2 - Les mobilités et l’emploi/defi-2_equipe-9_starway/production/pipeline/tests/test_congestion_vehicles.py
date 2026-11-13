"""Voiture avec trafic moyen DiRIF (rattachement aller / retour) et coût par véhicule (D-029), sans Java.

Les temps, distances et prix des cas de test sont des FIXTURES (pas des résultats publiés). Les cas `CASES` sont
recopiés dans frontend/src/data/congestion.test.ts : les deux implémentations doivent rendre les mêmes valeurs.
"""

from __future__ import annotations

import pytest

from starway import congestion as cg
from starway import vehicles as vh

# (sens, heure en minutes, temps route vide, attendu (période, statut, minutes avec trafic))
CASES = [
    ("out", 9 * 60, 40, ("p06_10", "ok", 70)),        # 40 x 1,75 = 70, départ 7h50 >= 6h
    ("out", 9 * 60, 103, ("p06_10", "outside_period", None)),  # 103 x 1,75 = 180,25 > 180 min depuis 6h
    ("out", 9 * 60, 102, ("p06_10", "ok", 179)),     # 178,5 -> 179 (demi-minute vers le haut)
    ("out", 6 * 60, 30, (None, "no_period", None)),  # arrivée 6h : aucune mesure avant 6h
    ("out", 10 * 60, 20, ("p06_10", "ok", 35)),      # arrivée 10h : fin incluse de 6h-10h
    ("out", 14 * 60, 50, ("p10_16", "ok", 70)),      # 50 x 1,39 = 69,5 -> 70
    ("ret", 17 * 60, 40, ("p16_20", "ok", 78)),      # 40 x 1,95 = 78 (exemple de la proposition)
    ("ret", 17 * 60, 93, ("p16_20", "outside_period", None)),  # 181,35 > 180
    ("ret", 14 * 60, 86, ("p10_16", "ok", 120)),     # 119,54 -> 120, arrivée avant 16h
    ("ret", 14 * 60, 87, ("p10_16", "outside_period", None)),
    ("ret", 22 * 60, 30, (None, "no_period", None)),  # départ 22h : aucune mesure après 20h
    ("ret", 20 * 60, 30, (None, "no_period", None)),  # départ 20h : fin exclue
    ("ret", 16 * 60, 10, ("p16_20", "ok", 20)),      # 19,5 -> 20
    ("out", 9 * 60, None, (None, None, None)),        # temps route vide inconnu : rien
]


@pytest.mark.parametrize(("leg", "clock", "free", "expected"), CASES)
def test_attach(leg: str, clock: int, free: int | None, expected: tuple) -> None:
    assert cg.attach(leg, clock, free) == expected


def test_day_types_match_proposal() -> None:
    assert cg.day_type_periods() == {
        "d06": {"out": None, "ret": "p10_16", "out_reason": "no_period"},
        "d09": {"out": "p06_10", "ret": "p16_20"},
        "d14": {"out": "p10_16", "ret": None, "ret_reason": "no_period"},
    }


def test_meta_block_and_check() -> None:
    b = cg.meta_block({"url_source": "https://exemple/x.pdf", "sha256": "ab", "date_extraction": "2026-11-03T22:00Z"})
    assert [p["index"] for p in b["periods"]] == [1.75, 1.39, 1.95]
    assert cg.check_block(b) == []
    bad = {**b, "periods": [{**b["periods"][0], "index": 0.9}] + b["periods"][1:]}
    assert any("hors de" in x for x in cg.check_block(bad))
    assert any("url" in x for x in cg.check_block({**b, "url": None}))


def test_modes_with_traffic() -> None:
    m = cg.modes_with_traffic([{"id": "walk", "label": "Marche"}, {"id": "car", "label": "Voiture (sans trafic)"}])
    assert m == [{"id": "walk", "label": "Marche"}, {"id": "car", "label": "Voiture (route vide)"},
                 {"id": "car_traffic", "label": "Voiture (trafic moyen DiRIF)"}]
    assert cg.modes_with_traffic(m) == m  # idempotent


def test_vehicles_costs() -> None:
    cons = {"petrol": 6.0, "diesel": 5.0, "electric": 20.0}
    fuels = {"petrol": {"median": 2.0, "stations_with_price": 10}, "diesel": {"median": 1.5, "stations_with_price": 9}}
    vs = vh.vehicles_meta(cons, fuels, {})
    assert [v["id"] for v in vs] == ["petrol", "diesel", "electric"]
    assert vs[0]["cost_eur_per_km"] == pytest.approx(0.12) and vs[2]["price_eur_per_unit"] == vh.ELEC_PRICE_EUR_KWH
    assert all(v["toll_class"] == 1 and v["family"] == "car" and v["co2_kg_per_km"] is None for v in vs)
    c = vh.trip_costs([10_000, None], [12_345, 5_000], vs)
    assert c["petrol"]["out"] == [1.2, None]  # jamais 0 pour une distance absente
    assert c["petrol"]["ret"] == [1.48, 0.6]  # 1,4814 -> 1,48
    assert c["petrol"]["total"] == [2.68, None]
    assert vh.round_eur(0.125) == 0.13


def test_fuel_stats_median_and_rupture() -> None:
    import pandas as pd

    idf = pd.DataFrame({"e10_prix": [2.0, 2.2, None, 2.1], "e10_rupture_type": [None, None, "definitive", None],
                        "e10_maj": ["2026-11-01T10:00:00+00:00", "2026-10-01T10:00:00+00:00", None,
                                    "2026-11-02T10:00:00+00:00"]})
    s = vh.fuel_stats(idf, "e10")
    assert s["stations_with_price"] == 3 and s["median"] == 2.1 and s["price_and_rupture"] == 0
    assert s["updated_by_month"] == {"2026-10": 1, "2026-11": 2}


def test_two_wheelers_and_carbon() -> None:
    cons = {"petrol": 6.0, "diesel": 5.0, "electric": 20.0}
    fuels = {"petrol": {"median": 2.0, "stations_with_price": 10}, "diesel": {"median": 1.5, "stations_with_price": 9}}
    tw = {k: {"value": x, "n": 2, "vehicles": ["1", "2"], "co2_exhaust_g_km": [50.0, 60.0]}
          for k, x in (("moto_125", 2.66), ("maxiscooter", 3.91), ("moto_mid", 3.62), ("moto_900", 4.65))}
    co2 = {"SP95-E10": {"total": 2.69}, "gazole": {"total": 3.1}, "électricité": {"total": 0.0519}}
    vs = {v["id"]: v for v in vh.vehicles_meta(cons, fuels, {}, tw, co2)}
    assert list(vs) == ["petrol", "diesel", "electric", "moto_125", "maxiscooter", "moto_mid", "moto_900"]
    m = vs["moto_125"]
    assert m["toll_class"] == 5 and m["family"] == "two_wheeler" and m["price_eur_per_unit"] == 2.0
    assert m["cost_eur_per_km"] == pytest.approx(0.0532) and m["co2_kg_per_km"] == pytest.approx(0.071554)
    assert "décret" not in m["time"]["text"].lower() and "source_url" not in m["time"]  # aucune référence juridique (retrait confirmé le 05/11)
    assert vs["electric"]["co2_kg_per_km"] == pytest.approx(0.01038)
    c = vh.trip_co2([10_000, None], [12_345, 0], [vs["petrol"]])["petrol"]  # 6 L/100 km x 2,69 = 0,1614 kg/km
    assert c["out"] == [1614, None] and c["ret"] == [1992, 0] and c["total"] == [3606, None]
    assert vh.round_g(0.5) == 1 and vh.round_g(1.49) == 1


def test_read_2rm_consumption(tmp_path) -> None:
    f = tmp_path / "lecture.csv"
    rows = ["# commentaire", "vehicule_n,categorie,conso_l_100km,co2_g_km", "1,125 cm3,2.3,48", "2,125 cm3,3.0,63",
            "3,maxiscooter,4.0,90", "4,moto moyenne cylindrée,3.6,80", "5,moto plus de 900 cm3,4.6,104",
            "6,moto plus de 900 cm3,4.7,107"]
    f.write_text(chr(10).join(rows) + chr(10), encoding="utf-8")
    r = vh.read_2rm_consumption(f)
    assert r["moto_125"]["value"] == 2.65 and r["moto_125"]["vehicles"] == ["1", "2"]
    assert r["moto_900"]["value"] == 4.65 and r["moto_900"]["co2_exhaust_g_km"] == [104.0, 107.0]
    f.write_text(chr(10).join(rows[1:3]) + chr(10), encoding="utf-8")
    with pytest.raises(ValueError):
        vh.read_2rm_consumption(f)
