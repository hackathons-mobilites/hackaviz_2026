"""Référentiel des sources (starway/registry.py) : licences, codes cités, motifs publiés, rendu de docs/sources.md."""

from __future__ import annotations

from pathlib import Path, PurePosixPath

import pytest

from starway import registry as reg
from starway.config import REPO_ROOT


def row(code: str, fichier: str, **kw: str) -> dict[str, str]:
    base = {"source_id": code, "titre": f"Titre {code}", "url_source": "https://exemple.org/x",
            "date_extraction": "2026-11-03T10:00Z", "millesime": "2025", "date_service_transport": "",
            "licence": "Licence Ouverte v2.0 (Etalab)", "granularite": "commune", "geographie": "Île-de-France",
            "fichier_local": fichier, "sha256": "a" * 64, "traitements": "aucun", "controles": "relu",
            "limites": "aucune"}
    base.update(kw)
    return base


@pytest.mark.parametrize(("text", "kinds", "confirm"), [
    ("ODbL 1.0 - © les contributeurs d'OpenStreetMap", ["odbl"], False),
    ("Licence Ouverte / Open Licence Etalab 2.0 (conditions de réutilisation INSEE)", ["lo"], False),
    ("Licence Mobilités (IDFM) - https://cloud.fabmob.io/s/x", ["mobilites"], False),
    ("CGU PRIM (juillet 2022) ; données sous Licence Mobilités", ["mobilites", "cgu"], False),
    ("ODC-BY (Open Data Commons Attribution), champ license = odc-by", ["odc-by"], False),
    ("page publique IDFM, citée comme source d'un tarif", ["cited"], False),
    ("documents publics VINCI Autoroutes cités (aucune licence affichée) ; à confirmer par un humain", ["cited"], True),
    # « non indiquée » en tête : la suite décrit ce qui a été cherché (ici la licence d'un autre jeu), pas la licence
    ("non indiquée : le fichier n'est pas une ressource du jeu BMO (Licence Ouverte 1.0). CRPA L321-1", ["crpa", "cited"],
     True),
    ("texte libre sans licence connue", [], True),
    # bascule 06x : le constat n'est plus « à confirmer », et la suite ne compte pas comme une licence
    ("licence non précisée par le producteur pour ces documents ; « aucune licence, ni aucun autre droit »", ["cited"],
     False),
    # accord de l'organisateur du hackathon (D-060) : tranché, même si la suite cite « aucune licence »
    ("documents publics VINCI Autoroutes ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon "
     "le 09/11/2026 ; mentions légales : « aucune licence, ni aucun autre droit »", ["cited", "accord"], False),
])
def test_licence_kinds(text: str, kinds: list[str], confirm: bool) -> None:
    assert reg.licence_kinds(text) == kinds
    assert reg.licence_to_confirm(text) is confirm


def test_codes_in_text_respects_boundaries() -> None:
    text = "TRA02B et TRA02 ; CO2-01 ; EMP01x ; xEMP02 ; (GEO01) ; TOLL04."
    assert reg.codes_in_text(text) == {"TRA02B", "TRA02", "CO2-01", "GEO01", "TOLL04"}


def test_cited_in_json_text_reads_source_fields_only() -> None:
    text = ('{"jobs_source":"EMP01","transit_source":"COST01 - IDFM, page","transit_source_url":"https://x/EMP09",'
            '"url_source":"https://x/GEO09","precision_source":"INSEE, fiche","label":"VEL01",'
            '"consumption_source":{"source_id":"COST08","text":"SDES"},"sources":["GEN01","GEN04"],'
            '"source":"Microsoft Learn"}')
    assert reg.cited_in_json_text(text) == {"EMP01", "COST01", "COST08", "GEN01", "GEN04"}


@pytest.mark.parametrize(("path", "pattern"), [
    ("context/93066.json", "context/{insee}.json"),
    ("od_walk1000/index.json", "od_walk1000/index.json"),
    ("meta.json", "meta.json"),
    ("geo/poles.geojson", "geo/poles.geojson"),
])
def test_published_pattern(path: str, pattern: str) -> None:
    assert reg.published_pattern(PurePosixPath(path)) == pattern


def test_scan_published(tmp_path: Path) -> None:
    (tmp_path / "context").mkdir()
    (tmp_path / "context" / "75101.json").write_text('{"source":"GEN01"}', encoding="utf-8")
    (tmp_path / "context" / "75102.json").write_text('{"source":"GEN01"}', encoding="utf-8")
    (tmp_path / "poles.json").write_text('[{"jobs_source":"EMP01"}]', encoding="utf-8")
    (tmp_path / "x.bin").write_bytes(b'"source":"ZZ01"')
    assert reg.scan_published(tmp_path) == {"GEN01": {"context/{insee}.json"}, "EMP01": {"poles.json"}}


def test_scan_code_excludes_tests_and_listed_files(tmp_path: Path) -> None:
    (tmp_path / "pipeline" / "starway").mkdir(parents=True)
    (tmp_path / "pipeline" / "tests").mkdir()
    (tmp_path / "frontend" / "src").mkdir(parents=True)
    (tmp_path / "pipeline" / "starway" / "a.py").write_text("# EMP01", encoding="utf-8")
    (tmp_path / "pipeline" / "starway" / "registry.py").write_text("# EMP01 TRA01", encoding="utf-8")
    (tmp_path / "pipeline" / "tests" / "test_a.py").write_text("# TRA01", encoding="utf-8")
    (tmp_path / "frontend" / "src" / "x.test.ts").write_text("// TRA01", encoding="utf-8")
    (tmp_path / "frontend" / "src" / "y.ts").write_text("// GEO01", encoding="utf-8")
    got = reg.scan_code(tmp_path, ("pipeline", "frontend/src"), ("pipeline/starway/registry.py",))
    assert got == {"EMP01": {"pipeline/starway/a.py"}, "GEO01": {"frontend/src/y.ts"}}


def test_screen_of() -> None:
    assert reg.screen_of("frontend/src/components/proof/ProofCost.tsx") == "panneau de preuve"
    assert reg.screen_of("frontend/src/components/SourcesDrawer.tsx") == "Sources & limites"
    assert reg.screen_of("frontend/src/tour/variables.ts") == "visite guidée"
    assert reg.screen_of("frontend/src/inconnu.ts") == "autre"


def test_raw_dirs_without_manifest() -> None:
    missing, waiting = reg.raw_dirs_without_manifest(
        ["EMP01", "SUB01", "NEW01", "QS01"], {"EMP01", "QS01"}, {"SUB01": "data/abonnements"})
    assert missing == ["NEW01"]
    assert waiting == ["SUB01"]


def test_group_manifest_sorts_codes_and_files() -> None:
    rows = [row("TRA01", "data/raw/TRA01/b"), row("EMP01", "data/raw/EMP01/z"), row("EMP01", "data/raw/EMP01/a")]
    groups = reg.group_manifest(rows)
    assert list(groups) == ["EMP01", "TRA01"]
    assert [r["fichier_local"] for r in groups["EMP01"]] == ["data/raw/EMP01/a", "data/raw/EMP01/z"]


def test_source_gaps() -> None:
    ok = [row("EMP01", "data/raw/EMP01/a")]
    assert reg.source_gaps("EMP01", ok) == []
    bad = [row("ZZ99", "data/interim/cache/", licence="aucune licence affichée", millesime="")]
    gaps = reg.source_gaps("ZZ99", bad)
    assert "licence à confirmer" in gaps
    assert "fichier hors data/raw (cache ou dossier)" in gaps
    assert "millésime vide sur au moins une ligne" in gaps
    assert "statut à renseigner (starway/registry.py)" in gaps


def test_render_is_deterministic_and_complete() -> None:
    rows = [row("EMP01", "data/raw/EMP01/a", titre="Titre | avec barre"), row("ZZ99", "data/raw/ZZ99/b")]
    usage = reg.Usage(published={"EMP01": {"poles.json", "sources.json"}},
                      code={"EMP01": {"pipeline/starway/poles.py", "frontend/src/components/Legend.tsx"}})
    cat = [reg.CatalogueEntry("EMP04", "API offres", "France Travail", "P3", "suspendu", "https://x")]
    text = reg.render(rows, usage, cat)
    assert text == reg.render(rows, usage, cat)
    assert "NE PAS MODIFIER À LA MAIN" in text.splitlines()[2]
    assert "### EMP01" in text and "### ZZ99" in text
    assert "Titre \\| avec barre" in text  # barre échappée dans les tableaux
    assert "fichiers publiés qui la citent : `poles.json`\n" in text  # sources.json (toutes les sources) non répété
    assert "légende du ciel" in text and "`poles.py`" in text
    assert "statut à renseigner" in text  # ZZ99 n'a pas d'entrée dans SOURCE_INFO
    assert "| EMP04 | API offres |" in text
    assert chr(0x2014) not in text and chr(0x2013) not in text


def test_tables_are_consistent() -> None:
    assert all(i.status in reg.STATUS_LABELS for i in reg.SOURCE_INFO.values())
    texts = [*reg.CATALOGUE_FOLLOWUP.values(), *(i.note for i in reg.SOURCE_INFO.values()),
             *(w for _, w in reg.OTHER_CONSIDERED), *reg.LICENCE_OBLIGATIONS.values()]
    assert not any(chr(0x2014) in t or chr(0x2013) in t for t in texts)


def test_read_catalogue_of_the_team() -> None:
    entries = reg.read_catalogue(REPO_ROOT / reg.CATALOGUE_PATH)
    codes = [e.code for e in entries]
    assert len(codes) == 22 and len(set(codes)) == 22
    assert {"EMP01", "TRA01", "GEO03", "EMP04"} <= set(codes)
    assert set(codes) <= set(reg.CATALOGUE_FOLLOWUP)
    assert not any(chr(0x2014) in e.title for e in entries)
