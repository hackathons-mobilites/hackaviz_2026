"""Règles officielles du comptage des tickets (TKT01) : citations retrouvées, stations rattachées au GTFS."""

from __future__ import annotations

import zipfile

import pandas as pd
import pytest

from starway import ticket_rules as tr
from starway.config import RAW_DIR
from starway.sources import sha256_of

GTFS = RAW_DIR / "TRA01" / "IDFM-gtfs.zip"


@pytest.mark.skipif(not (RAW_DIR / "TKT01").exists(), reason="sources TKT01 non téléchargées")
def test_rule_quotes_found():
    assert tr.check_rule_quotes(RAW_DIR, sha256_of) == []


@pytest.mark.skipif(not GTFS.exists(), reason="GTFS absent")
def test_station_names_match_gtfs():
    with zipfile.ZipFile(GTFS) as z:
        s = pd.read_csv(z.open("stops.txt"), dtype=str, usecols=["stop_id", "stop_name"])
    names = dict(zip(s["stop_id"], s["stop_name"], strict=True))
    assert tr.check_station_names(names.get) == []


def test_substitution_bus_rule():
    assert tr.is_substitution_bus({"kind": "bus", "line_long": "Remplacement RER A"})
    assert not tr.is_substitution_bus({"kind": "rer", "line_long": "Remplacement RER A"})
    assert not tr.is_substitution_bus({"kind": "bus", "line_long": "RER A"})
