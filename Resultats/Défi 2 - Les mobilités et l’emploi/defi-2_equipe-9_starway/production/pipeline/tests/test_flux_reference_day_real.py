"""Non-régression du contrôle « aucune ligne sans service le jour de référence sans justification » sur les vrais flux.

Le contrôle doit ÉCHOUER sur le flux du premier calcul (02/11, c0798a28) et PASSER sur le flux figé du 06/11 (e990deba).
Fichiers lus en lecture seule ; test sauté si un fichier est absent ou n'est pas celui attendu (empreinte vérifiée).
Aucune valeur d'effet n'est écrite ni comparée : seulement « des lignes sans justification existent » ou « aucune ».

Emplacements : STARWAY_FLUX_ANCIEN (défaut : data/raw/TRA01/IDFM-gtfs.zip du dossier de données) et STARWAY_FLUX_FIGE (défaut :
<RACINE_DU_DEPOT>-sauvegarde-vm\\flux-gtfs-2026-11-06\\IDFM-gtfs-0611.zip).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from starway import flux
from starway import gtfs_reference_day as gr
from starway.config import RAW_DIR, SERVICE_DATE
from starway.sources import sha256_of

OLD_SHA256 = "c0798a28cceb6182094ff9270f12f0e66b39a70e816696bc95fbd201bb38cece"  # flux téléchargé le 02/11
OLD = Path(os.environ.get("STARWAY_FLUX_ANCIEN") or RAW_DIR / "TRA01" / "IDFM-gtfs.zip")
FROZEN = Path(os.environ.get("STARWAY_FLUX_FIGE")
              or r"<RACINE_DU_DEPOT>-sauvegarde-vm\flux-gtfs-2026-11-06\IDFM-gtfs-0611.zip")


def checked(path: Path, sha: str) -> str:
    if not path.is_file():
        pytest.skip(f"{path} absent")
    digest = sha256_of(path)
    if digest != sha:
        pytest.skip(f"{path} : empreinte {digest[:8]}, attendue {sha[:8]}")
    return digest


@pytest.fixture(scope="module")
def old_rows():
    digest = checked(OLD, OLD_SHA256)
    return digest, gr.route_services(OLD, SERVICE_DATE)


@pytest.fixture(scope="module")
def frozen_rows():
    digest = checked(FROZEN, flux.F06_TRA01_SHA256)
    return digest, gr.route_services(FROZEN, SERVICE_DATE)


def test_the_check_fails_on_the_flux_of_the_first_calculation(old_rows) -> None:
    digest, rows = old_rows
    bad = gr.unjustified(rows, digest, gr.read_allowlist())
    assert bad, "le contrôle aurait dû échouer sur le flux du 02/11 (calendriers arrêtés avant le jour de référence)"
    assert any(r.status == gr.ENDED and r.last_day is not None and r.last_day < 20261117 for r in bad)


def test_the_justifications_of_the_new_flux_do_not_apply_to_the_old_one(old_rows) -> None:
    digest, _rows = old_rows
    assert not [j for j in gr.read_allowlist() if j.flux_sha256 == digest]


def test_the_check_passes_on_the_frozen_flux_of_06_11(frozen_rows) -> None:
    digest, rows = frozen_rows
    bad = gr.unjustified(rows, digest, gr.read_allowlist())
    assert not bad, [(r.route_id, r.short_name, r.status, r.first_day, r.last_day) for r in bad]
    assert not gr.unused_entries(rows, digest, gr.read_allowlist()), "justification écrite sans ligne correspondante"
    # toute ligne sans service est listée dans le rapport, avec une justification (jamais « AUCUNE »)
    assert all(x["justification"] != "AUCUNE" for x in gr.report(rows, digest, gr.read_allowlist()))
