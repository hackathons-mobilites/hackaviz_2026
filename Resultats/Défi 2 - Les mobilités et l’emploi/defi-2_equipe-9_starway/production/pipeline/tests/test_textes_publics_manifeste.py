"""Textes publics du manifeste (06y) : aucun jargon interne dans les colonnes reprises par sources.json, données intactes."""

from __future__ import annotations

import csv
import importlib.util
from pathlib import Path

import pytest

from starway.config import MANIFEST_PATH
from starway.sources import SOURCES
from starway.subscription_sources import SUBSCRIPTION_SOURCES
from starway.ticket_sources import TICKET_SOURCES

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "06y_textes_publics_manifeste.py"


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location("textes_publics", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(("avant", "apres"), [
    ("réseau de nuit, D-040), fichier", "réseau de nuit), fichier"),
    ("point d'origine du routage (D-017) : centre", "point d'origine du routage : centre"),
    ("source d'un tarif ; à confirmer par un humain", "source d'un tarif ; licence à confirmer"),
    ("export (scripts/06j_export_bmo.py, starway/bmo.py, D-035) ; astres", "export ; astres"),
    ("04j : couples entre gares", "couples entre gares"),
    ("le moins de correspondances : 04q en 9h-17h et 14h-22h puis export 06w ; 10/11/2026)",
     "le moins de correspondances ; en 9h-17h et 14h-22h ; 10/11/2026)"),
    ("panneau en 6h-14h (04q, export 06w, 10/11/2026) ; mesuré", "panneau en 6h-14h (10/11/2026) ; mesuré"),
    ("phrases citées retrouvées dans le texte de l'instantané (07)", "phrases citées retrouvées dans le texte de l'instantané"),
    ("07 : carbone entier", "contrôle du pipeline : carbone entier"),
    ("trois journées-types (matrix_story_d031_b44 et matrix_bike_transit_all_d031_b44_*) ; x", "trois journées-types ; x"),
    # audit du 10/11 (C2) : machine de calcul, notes de téléchargement, licence France Travail, millésime et date de service
    ("sha256 lu sur la VM le 06/11/2026", "sha256 lu sur la machine de calcul le 06/11/2026"),
    ("Licence Ouverte v2.0 (écrite dans la PROVENANCE.txt : « Insee", "Licence Ouverte v2.0 (notée au téléchargement : « Insee"),
    ("sans altération), à confirmer auprès de France Travail avant le dépôt ; EMP01",
     "sans altération), licence non confirmée par France Travail ; EMP01"),
    ("2026-11-17 (mardi ordinaire, 144948 courses actives ; voir starway/config.py)",
     "2026-11-17 (mardi ordinaire, 144948 courses actives)"),
    ("remplace le flux du 02/11/2026, conservé dans data/flux_gtfs_precedents.csv",
     "remplace le flux du 02/11/2026 (empreinte et date de l'ancien flux conservées dans le dépôt)"),
])
def test_reformulations(mod, avant: str, apres: str) -> None:
    assert mod.clean(avant) == apres
    assert mod.clean(apres) == apres


def test_textes_de_07d_deja_publics(mod) -> None:
    """La ligne TRA02 réécrite par 07d passe par le même nettoyage et ne garde aucun motif (audit du 10/11, C1)."""
    spec = importlib.util.spec_from_file_location("m07d", SCRIPT.parent / "07d_navitia_crosscheck.py")
    assert spec and spec.loader
    m07d = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m07d)
    row = {"source_id": "TRA02", "titre": "t", "traitements": "comparaison par scripts/07d_navitia_crosscheck.py (réglage "
           "de marche publié D-024 et", "limites": "x ; voir docs/methodologie.md § 5", "url_source": "https://a/b.py"}
    out = m07d.public_texts(row)
    assert out["url_source"] == row["url_source"]
    assert not any(mod.RESIDUE.search(out[c]) for c in ("titre", "traitements", "limites"))


def test_ne_touche_que_les_colonnes_publiques(mod) -> None:
    entete = "source_id,titre,url_source,licence,sha256,traitements,controles,limites"
    ligne = "X,titre (D-040),https://exemple.fr/D-040/a.py,CC (D-030),scripts/ab,lu par starway/x.py,relu (07),ok"
    lignes, changees, restes = mod.clean_lines(entete + chr(10) + ligne + chr(10))
    valeurs = next(csv.reader([lignes[1]]))
    assert lignes[0] == entete and changees == 1
    assert valeurs[2] == "https://exemple.fr/D-040/a.py" and valeurs[4] == "scripts/ab"
    assert valeurs[1] == "titre" and valeurs[3] == "CC"
    assert restes  # « starway/x.py » n'a pas de règle : il est signalé, jamais passé sous silence


def test_manifeste_sans_motif_restant(mod) -> None:
    lignes, _, restes = mod.clean_lines(MANIFEST_PATH.read_bytes().decode("utf-8").replace("\r\n", "\n"))
    assert restes == []
    assert len(lignes) > 100


def test_le_code_n_ecrit_plus_ces_textes(mod) -> None:
    """01 réécrit ces colonnes depuis le code : sans cette garde, le jargon reviendrait au prochain téléchargement."""
    restes = [(s.source_id, col, m.group(0)) for s in (*SOURCES, *SUBSCRIPTION_SOURCES, *TICKET_SOURCES) for col in mod.COLS
              for m in mod.RESIDUE.finditer(s.meta.get(col, ""))]
    assert restes == []


@pytest.mark.parametrize(("url", "millesime", "attendu"), [
    # audit du 10/11 : lien du mode sources = une seule adresse, le texte qui suivait passe dans `millesime`
    ("https://a.example/latest.pbf (résolue : https://a.example/261101.pbf)", "extrait du jour indiqué dans l'URL résolue",
     ("https://a.example/latest.pbf", "extrait du jour indiqué dans l'URL résolue ; URL résolue : https://a.example/261101.pbf")),
    ("https://g.example/r5.git (tag v1, commit abc)", "R5 v1 (tag v1)",
     ("https://g.example/r5.git", "R5 v1 (tag v1) ; code source : tag v1, commit abc")),
    ("https://g.example/r5.git", "R5 v1 ; code source : tag v1, commit abc",
     ("https://g.example/r5.git", "R5 v1 ; code source : tag v1, commit abc")),
    ("https://a.example/x.csv", "2024", ("https://a.example/x.csv", "2024")),
])
def test_url_source_une_seule_adresse(mod, url: str, millesime: str, attendu: tuple[str, str]) -> None:
    assert mod.public_url(url, millesime) == attendu
    # idempotent : une seconde passe ne change rien
    assert mod.public_url(*attendu) == attendu


def test_manifeste_url_source_sans_texte_apres_l_adresse() -> None:
    with MANIFEST_PATH.open(encoding="utf-8", newline="") as f:
        restes = [(r["source_id"], r["url_source"]) for r in csv.DictReader(f) if " " in r["url_source"].strip()]
    assert restes == []
