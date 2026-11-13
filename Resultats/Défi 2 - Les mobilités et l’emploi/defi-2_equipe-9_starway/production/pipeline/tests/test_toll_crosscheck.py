"""Tests de starway/toll_crosscheck.py : recoupement A5, relevés manuels A14 et Duplex A86, fenêtres du trajet.

Les grilles ci-dessous sont des FIXTURES (format des sources, valeurs de l'exemple), pas des résultats publiés.
"""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from starway import toll_crosscheck as cc
from starway import toll_publish as tp
from starway import toll_tariffs as tt
from tests.test_toll_tariffs import DUPLEX_TXT, JORF_CHAMBOURCY, JORF_MONTESSON

HEADER = ",".join(cc.MANUAL_COLUMNS)
PDF = {("FLEURY-EN-BIERE", "URY"): (12.0, 2.0, 3.0, 4.0, 5.0, 1.4),
       ("URY", "FLEURY-EN-BIERE"): (12.0, 2.0, 3.0, 4.0, 5.0, 1.4),
       ("LES EPRUNES", "ST-GERMAIN-LAXIS"): (16.3, 1.8, 3.1, 4.7, 6.5, 1.0),
       ("ST-GERMAIN-LAXIS", "LES EPRUNES"): (16.3, 1.8, 3.1, 4.7, 6.5, 1.0),
       ("ST-GERMAIN-LAXIS", "FORGES"): (24.5, 2.5, 3.7, 5.5, 7.8, 1.5)}


@pytest.fixture
def tariffs(tmp_path) -> pd.DataFrame:
    m, c, a = tmp_path / "m.xml", tmp_path / "c.xml", tmp_path / "a86.txt"
    m.write_text(JORF_MONTESSON, encoding="utf-8")
    c.write_text(JORF_CHAMBOURCY, encoding="utf-8")
    a.write_bytes(DUPLEX_TXT.encode("cp1252"))
    rows = (tt.a14_tariffs([m, c], ["m.xml", "c.xml"]) + tt.duplex_tariffs(a, "a86.txt")
            + tt.aprr_tariffs(PDF, "x.pdf"))
    return pd.DataFrame(rows, columns=tt.TARIFF_COLUMNS)


def _pdf_pairs(pdf=PDF, page=7):
    return {k: {"page": page, "values": v, "line": "x"} for k, v in pdf.items()}


def test_a5_all_sources_agree(tariffs) -> None:
    tj = tp.build_tolls_json(tariffs, date(2026, 11, 17), "test", [])
    rows = cc.a5_crosscheck(tariffs, tj, PDF, _pdf_pairs())
    # A5 seulement : le couple FLEURY / URY (A6) n'a aucune gare de l'A5
    assert {(r["entree_grille"], r["sortie_grille"]) for r in rows} == {
        ("LES EPRUNES", "ST-GERMAIN-LAXIS"), ("ST-GERMAIN-LAXIS", "LES EPRUNES"), ("ST-GERMAIN-LAXIS", "FORGES")}
    assert all(r["verdict"] == "concordant" and r["page_pdf"] == 7 for r in rows)
    assert cc.a5_summary(rows)["concordance_complete"] is True
    first = next(r for r in rows if r["entree_grille"] == "ST-GERMAIN-LAXIS" and r["sortie_grille"] == "FORGES"
                 and r["classe"] == 1)
    assert (first["site_csv_tarifs"], first["site_tolls_json"], first["data_gouv_csv"], first["pdf_officiel"]) == (
        2.5, 2.5, 2.5, 2.5)


def test_a5_detects_a_gap_and_a_missing_csv_pair(tariffs) -> None:
    tj = tp.build_tolls_json(tariffs, date(2026, 11, 17), "test", [])
    csv = {k: v for k, v in PDF.items() if k != ("LES EPRUNES", "ST-GERMAIN-LAXIS")}
    csv[("ST-GERMAIN-LAXIS", "FORGES")] = (24.5, 2.6, 3.7, 5.5, 7.8, 1.5)  # le CSV dit 2,6 au lieu de 2,5 (classe 1)
    rows = cc.a5_crosscheck(tariffs, tj, csv, _pdf_pairs())
    by = {(r["entree_grille"], r["sortie_grille"], r["classe"]): r["verdict"] for r in rows}
    assert by[("ST-GERMAIN-LAXIS", "FORGES", 1)] == "ecart"
    assert by[("ST-GERMAIN-LAXIS", "FORGES", 5)] == "concordant"
    # couple publié par le site et le PDF mais pas par le CSV : ce n'est pas un écart de montant
    assert by[("LES EPRUNES", "ST-GERMAIN-LAXIS", 1)] == "concordant_absent_data_gouv_csv"
    s = cc.a5_summary(rows)
    assert s["concordance_complete"] is False and len(s["ecarts"]) == 1


def test_pdf_pages_keep_the_page_number() -> None:
    text = ["intro", "ligne sans tarif", "FLEURY-EN-BIERE     URY     12,00   2,00 €   3,00 €   4,00 €   5,00 €   1,40 €"]
    pairs = cc.parse_pdf_pairs_by_page(text, ["FLEURY-EN-BIERE", "URY"])
    assert pairs[("FLEURY-EN-BIERE", "URY")]["page"] == 3
    assert pairs[("FLEURY-EN-BIERE", "URY")]["values"] == (12.0, 2.0, 3.0, 4.0, 5.0, 1.4)
    assert "FLEURY-EN-BIERE URY 12,00" in pairs[("FLEURY-EN-BIERE", "URY")]["line"]
    dup = cc.parse_pdf_pairs_by_page(text + [text[2]], ["FLEURY-EN-BIERE", "URY"])
    assert dup[("FLEURY-EN-BIERE", "URY")]["page"] == 3 and dup[("FLEURY-EN-BIERE", "URY")]["doublons_pages"] == [4]


def test_pdf_against_csv_all_classes() -> None:
    csv = dict(PDF)
    csv[("URY", "FLEURY-EN-BIERE")] = (12.0, 2.0, 3.0, 4.1, 5.0, 1.4)  # classe 3 différente
    out = cc.pdf_csv_all_classes(csv, _pdf_pairs())
    assert len(out["couples_avec_ecart"]) == 1 and out["couples_avec_ecart"][0]["entree"] == "URY"
    assert out["seulement_csv"] == []


def _write(tmp_path, *lines: str):
    p = tmp_path / "releves.csv"
    p.write_text("\n".join([HEADER, *lines]) + "\n", encoding="utf-8")
    return p


def test_manual_file_empty_means_not_verified(tmp_path, tariffs) -> None:
    for path in (tmp_path / "absent.csv", _write(tmp_path)):
        records, errors = cc.read_manual(path)
        status = cc.manual_status(cc.compare_manual(tariffs, records), errors)
        assert records == [] and errors == []
        assert status["A14"]["etat"] == cc.NOT_VERIFIED == "non vérifié" and status["A86"]["etat"] == "non vérifié"


def test_manual_records_are_compared_with_the_published_grid(tmp_path, tariffs) -> None:
    p = _write(tmp_path,
               "A14,Montesson,1,standard,mardi,11:00,6.6,https://exemple.invalid/doc,p. 2,2026-11-06",
               "A14,Montesson,1,standard,mardi,09:00,6.5,https://exemple.invalid/doc,p. 2,2026-11-06",
               "A86,Rueil > Vélizy,1,standard,mardi,07:10,\"11,4\",doc papier,p. 5,2026-11-06",
               "A86,Vélizy>Rueil,1,telepeage,mardi,07:10,14.3,doc papier,p. 5,2026-11-06")
    records, errors = cc.read_manual(p)
    assert errors == [] and len(records) == 4
    by = {(c["autoroute"], c["heure"], c["tarif"]): c for c in cc.compare_manual(tariffs, records)}
    assert by[("A14", "11:00", "standard")]["verdict"] == "concordant"
    assert by[("A14", "11:00", "standard")]["montant_site_eur"] == 6.6
    assert by[("A14", "09:00", "standard")]["verdict"] == "ecart" and by[("A14", "09:00", "standard")]["montant_site_eur"] == 10.8
    assert by[("A86", "07:10", "standard")]["verdict"] == "concordant"
    assert by[("A86", "07:10", "telepeage")]["verdict"] == "concordant"
    status = cc.manual_status(cc.compare_manual(tariffs, records), errors)
    assert status["A14"]["ecarts"] == 1 and "écart" in status["A14"]["etat"]
    assert status["A86"]["concordants"] >= 1


@pytest.mark.parametrize("line", [
    "A14,Montesson,1,standard,mardi,11:00,6.6,,p. 2,2026-11-06",  # sans source
    "A14,Montesson,1,standard,mardi,11:00,6.6,doc,,2026-11-06",  # sans page
    "A14,Montesson,1,standard,mardi,11:00,6.6,doc,p. 2,",  # sans date
    "A14,Montesson,1,standard,mardi,11:00,0,doc,p. 2,2026-11-06",  # montant nul
    "A14,Montesson,2,standard,mardi,11:00,6.6,doc,p. 2,2026-11-06",  # classe hors périmètre
    "A14,Montesson,1,standard,jour férié,11:00,6.6,doc,p. 2,2026-11-06",  # jour hors vocabulaire
    "A14,Rueil > Vélizy,1,standard,mardi,11:00,6.6,doc,p. 2,2026-11-06",  # tronçon pour l'A14
    "A86,Rueil > Rueil,1,standard,mardi,11:00,6.6,doc,p. 2,2026-11-06",  # entrée = sortie
    "A86,Rueil > Vélizy,1,standard,mardi,25:00,6.6,doc,p. 2,2026-11-06",  # heure impossible
    "A86,Rueil > Vélizy,1,standard,mardi,11:00,6.6,doc \u2013 note,p. 2,2026-11-06",  # demi-cadratin
    "A7,Orange,1,standard,mardi,11:00,6.6,doc,p. 2,2026-11-06",  # autoroute hors périmètre
])
def test_manual_record_without_source_page_date_or_valid_fields_is_refused(tmp_path, line) -> None:
    records, errors = cc.read_manual(_write(tmp_path, line))
    assert records == [] and len(errors) == 1 and errors[0].startswith("ligne 2")


def test_manual_wrong_header_is_an_error(tmp_path) -> None:
    p = tmp_path / "x.csv"
    p.write_text("autoroute,montant\nA14,3\n", encoding="utf-8")
    records, errors = cc.read_manual(p)
    assert records == [] and "colonnes attendues" in errors[0]


def test_manual_cell_missing_from_site_is_not_comparable(tmp_path, tariffs) -> None:
    p = _write(tmp_path, "A86,Rueil > Vélizy,1,standard,mardi,15:00,9.9,doc,p. 5,2026-11-06")
    records, _ = cc.read_manual(p)
    out = cc.compare_manual(tariffs, records)  # la fixture ne couvre que 7h-8h : aucune tranche à 15h
    assert out[0]["verdict"] == "non_comparable" and out[0]["montant_site_eur"] is None


def test_merge_slots_and_trip_windows() -> None:
    merged = cc.merge_slots([[0, 60, 2.0], [60, 120, 2.0], [120, 180, 3.0], [240, 300, 3.0]])
    assert merged == [{"debut": "00:00", "fin": "02:00", "prix_eur": 2.0},
                      {"debut": "02:00", "fin": "03:00", "prix_eur": 3.0},
                      {"debut": "04:00", "fin": "05:00", "prix_eur": 3.0}]
    w = {x["journee_type"]: x for x in cc.trip_windows(46)}
    # 6h-14h : l'arrivée à 6h est hors des tranches mesurées, temps route vide gardé
    assert w["d06"]["fenetre_route_vide"] == ["05:14", "06:00"] and w["d06"]["duree_trafic_min"] is None
    # 9h-17h : indice 1,75 sur 46 min = 80,5 -> 81 min (demi-minute vers le haut)
    assert w["d09"]["duree_trafic_min"] == 81 and w["d09"]["fenetre_trafic"] == ["07:39", "09:00"]
    # 14h-22h : indice 1,39 sur 46 min = 63,94 -> 64 min
    assert w["d14"]["duree_trafic_min"] == 64 and w["d14"]["fenetre_trafic"] == ["12:56", "14:00"]
