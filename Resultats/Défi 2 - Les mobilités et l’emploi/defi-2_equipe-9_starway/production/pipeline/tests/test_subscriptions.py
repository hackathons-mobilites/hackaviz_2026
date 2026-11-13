"""Coût d'un trajet selon les abonnements (D-032) : cas partagés avec le front + catalogue publié."""

from __future__ import annotations

import json

import pytest

from starway.config import FRONT_DATA_DIR, RAW_DIR, REPO_ROOT
from starway.subscriptions import (
    leg_counts,
    normalize,
    parse_price,
    slices_beyond,
    transit_leg_cost,
    transit_round_trip,
    velib_ride_cost,
    velib_round_trip,
)

CASES = json.loads((REPO_ROOT / "frontend" / "src" / "data" / "subscriptionCases.json").read_text(encoding="utf-8"))


def _opt(key):
    return None if key is None else CASES["options"][key]


@pytest.mark.parametrize("case", CASES["leg_cases"], ids=lambda c: f"{c['trip']}-{c['option']}")
def test_leg_cases(case):
    got = transit_leg_cost(CASES["trips"][case["trip"]], _opt(case["option"]), CASES["extra_titles"],
                           CASES["unpriced_agencies"])
    for k, v in case["expect"].items():
        assert got[k] == v, (k, got)


@pytest.mark.parametrize("case", CASES["round_trip_cases"], ids=lambda c: f"{c['out']}-{c['ret']}-{c['option']}")
def test_round_trip_cases(case):
    got = transit_round_trip(CASES["trips"][case["out"]], CASES["trips"][case["ret"]], _opt(case["option"]),
                             CASES["extra_titles"])
    assert got["total_eur"] == case["expect"]["total_eur"]


@pytest.mark.parametrize("case", CASES["slice_cases"], ids=lambda c: f"{c['ride']}-{c['included']}")
def test_slices(case):
    assert slices_beyond(case["ride"], case["included"]) == case["expect"]


@pytest.mark.parametrize("case", CASES["ride_cases"], ids=lambda c: f"{c['ride']}-{c['offer']}")
def test_ride_cases(case):
    got = velib_ride_cost(case["ride"], CASES["velib_offers"][case["offer"]])
    assert (got["status"], got["eur"]) == (case["expect"]["status"], case["expect"]["eur"])


@pytest.mark.parametrize("case", CASES["velib_round_trip_cases"], ids=lambda c: f"{c['out']}-{c['ret']}-{c['offer']}")
def test_velib_round_trip_cases(case):
    got = velib_round_trip(case["out"], case["ret"], CASES["velib_offers"][case["offer"]])
    assert got["total_eur"] == case["expect"]["total_eur"]


def test_slices_negative():
    with pytest.raises(ValueError):
        slices_beyond(-1, 30)


def test_parse_price_only_unique_prices():
    assert parse_price("90,80€") == 90.8
    assert parse_price("14€") == 14.0
    assert parse_price("2,5 €") == 2.5
    for text in ("dès 1,64€", "-50%", "Gratuit", "Prix variable", None, "dès 30,60€"):
        assert parse_price(text) is None


def test_normalize_removes_long_dashes_and_nbsp():
    s = "Paris" + chr(0x2013) + "Charles" + chr(0xA0) + "de  Gaulle" + chr(0x2014) + "x"
    assert normalize(s) == "Paris-Charles de Gaulle-x"


def test_leg_counts():
    legs = [{"m": "walk"}, {"m": "tram", "line": "ORLYVAL"}, {"m": "ter", "line": "TER"}, {"m": "ter"}]
    assert leg_counts(legs) == {"orlyval": 1, "ter": 2}


def test_never_divides_subscription_price():
    """Le prix d'un abonnement n'est jamais ajouté à un aller-retour (seul un titre d'un jour l'est)."""
    navigo = CASES["options"]["navigo"]
    got = transit_round_trip(CASES["trips"]["metro"], CASES["trips"]["metro"], navigo, CASES["extra_titles"])
    assert got["total_eur"] == 0


@pytest.mark.skipif(not (FRONT_DATA_DIR / "subscriptions.json").exists(), reason="subscriptions.json non publié")
def test_published_catalog_contract():
    d = json.loads((FRONT_DATA_DIR / "subscriptions.json").read_text(encoding="utf-8"))
    assert d["contract"] == "subscriptions-1"
    ids = [o["id"] for o in d["transit"]["options"]]
    assert len(ids) == len(set(ids))
    for o in d["transit"]["options"]:
        assert set(o["covers"]) == {"rail", "surface", "ter", "airport_rail", "orlyval"}
        assert all(v in ("yes", "no", "unknown") for v in o["covers"].values())
        for fam, v in o["covers"].items():
            if v == "unknown" and fam in ("ter", "airport_rail", "orlyval"):
                assert o["unknown_reasons"].get(fam), (o["id"], fam)
        assert o["price"]["eur"] is not None or o["price"].get("reason"), o["id"]
    text = json.dumps(d, ensure_ascii=False)
    assert chr(0x2013) not in text and chr(0x2014) not in text


@pytest.mark.skipif(not (RAW_DIR / "SUB01" / "titres-et-tarifs.json").exists(), reason="sources SUB non téléchargées")
def test_catalog_quotes_found():
    from starway.sources import sha256_of
    from starway.subscription_catalog import build_catalog, check_quotes
    assert check_quotes(build_catalog(RAW_DIR), RAW_DIR, sha256_of) == []


def test_unit_tickets_same_prices_as_the_itinerary_export():
    """Les prix à l'unité publiés au front (part de chaque ticket dans le coût d'un sens) sont ceux qui servent à chiffrer les itinéraires."""
    from starway import fares_carbon
    from starway.subscription_catalog import UNIT_TICKETS

    assert {k: v["eur"] for k, v in UNIT_TICKETS.items()} == fares_carbon.TICKET_PRICES_EUR
    assert {k: v["label"] for k, v in UNIT_TICKETS.items()} == fares_carbon.TICKET_LABELS
