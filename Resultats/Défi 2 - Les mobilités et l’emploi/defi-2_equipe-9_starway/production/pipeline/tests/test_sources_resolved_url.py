"""Adresse résolue au téléchargement (01) : notée dans `millesime`, jamais collée à `url_source` (audit du 10/11)."""

from __future__ import annotations

from starway.sources import resolved_url, with_resolved

SRC = "https://a.example/latest.pbf"
FINAL = "https://a.example/261101.pbf"


def test_redirection_notee() -> None:
    assert resolved_url(SRC, FINAL, None) == FINAL
    assert resolved_url(SRC, SRC, None) == ""


def test_sans_telechargement_garde_la_mention_existante() -> None:
    assert resolved_url(SRC, "", {"url_source": f"{SRC} (résolue : {FINAL})", "millesime": "m"}) == FINAL
    assert resolved_url(SRC, "", {"url_source": SRC, "millesime": f"m ; URL résolue : {FINAL}"}) == FINAL
    assert resolved_url(SRC, "", {"url_source": SRC, "millesime": "m"}) == ""
    assert resolved_url(SRC, "", None) == ""


def test_une_seule_mention() -> None:
    once = with_resolved("extrait du jour", FINAL)
    assert once == f"extrait du jour ; URL résolue : {FINAL}"
    assert with_resolved(once, FINAL) == once
    assert with_resolved(once, "https://a.example/261108.pbf") == "extrait du jour ; URL résolue : https://a.example/261108.pbf"
    assert with_resolved(once, "") == "extrait du jour"
    assert with_resolved("", FINAL) == f"URL résolue : {FINAL}"
