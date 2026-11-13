"""Table de base `od` (sans transport en commun) et variante calculée sur un flux plus récent."""

from __future__ import annotations

from starway import od_variant as ov


def test_seul_le_gtfs_peut_differer_et_seulement_sur_demande() -> None:
    base = {"gtfs_sha256": "ancien", "osm_sha256": "o"}
    variant = {"gtfs_sha256": "nouveau", "osm_sha256": "o", "walk_setting": "normal"}
    assert any(e.startswith("gtfs_sha256") for e in ov.base_compatible(base, variant))
    assert not any(e.startswith("gtfs_sha256") for e in ov.base_compatible(base, variant, ignore_gtfs=True))
    assert any(e.startswith("osm_sha256") for e in ov.base_compatible(base, {**variant, "osm_sha256": "x"}, ignore_gtfs=True))
