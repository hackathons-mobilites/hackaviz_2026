"""`url_source` du manifeste = adresse déclarée par le pipeline (relevé des liens du 09/11/2026).

Quand l'adresse de téléchargement d'un fichier archivé ne répond plus, la source déclare une adresse officielle
vivante (`public_url`) : 01_download doit l'écrire dans `url_source`, sinon il remettrait le lien mort.
"""

from __future__ import annotations

from starway.config import REPO_ROOT
from starway.sources import SOURCES, Source, read_manifest
from starway.subscription_sources import SUBSCRIPTION_SOURCES
from starway.ticket_sources import TICKET_SOURCES

DILA_COST06 = "https://echanges.dila.gouv.fr/OPENDATA/JORF/JORF_20260731-003333.tar.gz"
LEGIFRANCE_COST06 = "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054569470"


def test_manifest_url_par_defaut_et_adresse_vivante() -> None:
    assert Source("X", "https://a.example/f.csv", "f.csv").manifest_url == "https://a.example/f.csv"
    vivante = Source("X", "https://a.example/f.csv", "f.csv", public_url="https://a.example/fiche")
    assert vivante.manifest_url == "https://a.example/fiche"
    assert vivante.url == "https://a.example/f.csv"  # le téléchargement garde l'adresse d'origine


def test_cost06_cite_legifrance_et_garde_la_provenance() -> None:
    src = next(s for s in SOURCES if s.source_id == "COST06" and s.url == DILA_COST06)
    assert src.manifest_url == LEGIFRANCE_COST06
    assert DILA_COST06 in src.meta["limites"]


def test_url_source_du_manifeste_identique_a_la_declaration() -> None:
    rows = {(r["source_id"], r["fichier_local"]): r for r in read_manifest()}
    compared = 0
    for src in SOURCES + SUBSCRIPTION_SOURCES + TICKET_SOURCES:
        row = rows.get((src.source_id, src.local_path.relative_to(REPO_ROOT).as_posix()))
        if row is None:
            continue
        compared += 1
        assert row["url_source"] == src.manifest_url, (src.source_id, src.filename)
    assert compared > 0
