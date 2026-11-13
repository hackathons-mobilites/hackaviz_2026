"""Tests du tableau des données du README officiel : seules les sources publiées, un lien tiré du manifeste."""

from __future__ import annotations

from starway import depot_sources as ds
from starway import registry as reg


def _group(code: str, licence: str, url: str, millesime: str = "2023") -> dict[str, list[dict[str, str]]]:
    return {code: [{"source_id": code, "licence": licence, "url_source": url, "millesime": millesime,
                    "fichier_local": f"data/raw/{code}/x.csv", "titre": "t"}]}


def test_first_url_prend_la_premiere_adresse_et_ignore_le_texte() -> None:
    assert ds.first_url("https://a.example/x (résolue : https://b.example/y)") == "https://a.example/x"
    assert ds.first_url("pas d'adresse") == ""


def test_seules_les_sources_publiees_sont_listees() -> None:
    groups = {**_group("EMP01", "Licence Ouverte 2.0", "https://www.insee.fr/fr/statistiques/8266010"),
              **_group("CO2-01", "Licence Ouverte Etalab", "https://impactco2.fr/api")}
    assert reg.SOURCE_INFO["EMP01"].status == "publiee"
    assert reg.SOURCE_INFO["CO2-01"].status == "ecartee"
    rows = ds.readme_rows(groups)
    assert [r[0] for r in rows] == ["EMP01"]
    assert rows[0][4] == "https://www.insee.fr/fr/statistiques/8266010"


def test_code_sans_entree_au_registre_est_ignore() -> None:
    assert ds.readme_rows(_group("ZZZ99", "Licence Ouverte", "https://x.example")) == []


def test_render_table_entete_et_cellules_echappees() -> None:
    groups = _group("EMP01", "Licence Ouverte 2.0", "https://www.insee.fr/fr/statistiques/8266010")
    text = ds.render_table(groups)
    assert text.splitlines()[0].startswith("| Code | Producteur")
    assert "| EMP01 | INSEE |" in text
    assert "\u2014" not in text and "\u2013" not in text
