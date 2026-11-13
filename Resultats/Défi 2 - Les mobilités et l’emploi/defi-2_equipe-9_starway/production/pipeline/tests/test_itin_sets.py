"""Tests sans Java : jeux d'itinéraires par réglage de marche, fichiers gzip et annonces de meta.json (04/11/2026)."""

from __future__ import annotations

import gzip
import json

from starway import itin_meta
from starway import itin_sets as iss
from starway.config import sky_front_dir


def test_sets_paths_by_walk_setting(tmp_path):
    """Lots `itineraries_walk{m}_d031_b44` (44 astres)."""
    normal, comfort = iss.all_sets(tmp_path, sky="44")
    assert (normal.walk_setting, normal.dir_name, normal.variant_key) == ("normal", "itineraries", None)
    assert (comfort.walk_setting, comfort.dir_name, comfort.variant_key) == ("comfort", "itineraries_walk1000",
                                                                             "comfort")
    assert normal.src.name == "itineraries_walk3000_d031_b44" and comfort.src.name == "itineraries_walk1000_d031_b44"
    assert normal.summary.name == "transfer_check_walk3000_b44_summary.json"
    assert comfort.short_csv.name == "transfer_check_walk1000_short.csv.gz"
    assert normal.check_dir != comfort.check_dir


def test_sets_paths_by_sky(tmp_path):
    n44, c44 = iss.all_sets(sky="44")
    assert (n44.src.name, c44.src.name) == ("itineraries_walk3000_d031_b44", "itineraries_walk1000_d031_b44")
    assert n44.summary.name == "transfer_check_walk3000_b44_summary.json"
    assert n44.check_dir.name == "transfer_check_b44" and c44.check_dir.name == "transfer_check_walk1000_b44"
    assert n44.out_dir == sky_front_dir("44") / "itineraries"
    assert iss.all_sets()[0].src == n44.src  # défaut = les 44 astres


def test_gzip_round_trip_is_reproducible(tmp_path):
    doc = {"insee": "75101", "name": "Gare de l'Est", "days": {}}
    p = iss.doc_path(tmp_path, "75101")
    assert p.name == "75101.json.gz"
    n = iss.write_doc(p, doc)
    first = p.read_bytes()
    assert n == len(first) and first[:2] == b"\x1f\x8b"
    assert iss.read_doc(p) == doc
    assert json.loads(gzip.decompress(first)) == doc
    iss.write_doc(p, doc)
    assert p.read_bytes() == first  # en-tête sans date : mêmes octets
    assert iss.json_size(doc) == len(json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode())


def test_transit_series_picks_the_variant():
    acc = {"modes": {"transit": {"d09": "normal"}}, "variants": {"comfort": {"transit": {"d09": "confort"}}}}
    normal, comfort = iss.all_sets()
    assert iss.transit_series(acc, normal) == {"d09": "normal"}
    assert iss.transit_series(acc, comfort) == {"d09": "confort"}
    assert iss.transit_series({"modes": {}}, comfort) is None


def test_stale_files_include_old_format_and_unpublished(tmp_path):
    iss.write_doc(iss.doc_path(tmp_path, "75101"), {})
    iss.write_doc(iss.doc_path(tmp_path, "75102"), {})
    (tmp_path / "75101.json").write_text("{}", encoding="utf-8")
    names = sorted(p.name for p in iss.stale_files(tmp_path, {"75101"}))
    assert names == ["75101.json", "75102.json.gz"]


def test_meta_announces_each_published_set(tmp_path):
    normal, comfort = iss.all_sets(tmp_path)
    block = {"sources": ["TRA03", "QS01"], "tra03_snapshot": "2026-11-03", "punctuality_month": "2026-09",
             "qs01_updated": "2026-11-03"}
    for s in (normal, comfort):
        s.out_dir.mkdir()
        iss.write_doc(iss.doc_path(s.out_dir, "75101"), {"insee": "75101", "line_facts_meta": block})
    got = itin_meta.build(tmp_path)
    assert got["itineraries_communes"] == ["75101"]
    assert got["itineraries_variants"] == {"comfort": {"dir": "itineraries_walk1000", "walk_setting": "comfort",
                                                       "communes": ["75101"]}}
    assert got["itineraries_format"] == {"suffix": ".json.gz", "encoding": "gzip"}
    assert got["line_facts"]["punctuality_month"] == "2026-09" and "texts" in got["line_facts"]
    assert "transfer_check" not in got  # aucun fichier marqué
    meta = {"service_date": "2026-11-17", "transfer_check": {"old": True}, "itineraries_communes": ["x"]}
    itin_meta.apply(meta, tmp_path)
    assert meta["service_date"] == "2026-11-17" and "transfer_check" not in meta
    # un fichier sans faits par ligne : plus d'annonce line_facts
    iss.write_doc(iss.doc_path(comfort.out_dir, "75102"), {"insee": "75102"})
    assert "line_facts" not in itin_meta.build(tmp_path)


def test_meta_without_any_file(tmp_path):
    assert itin_meta.build(tmp_path) == {"itineraries_communes": []}
