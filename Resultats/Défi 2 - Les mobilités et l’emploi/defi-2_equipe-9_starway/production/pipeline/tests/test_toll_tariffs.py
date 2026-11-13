"""Tests de starway/toll_tariffs.py : types de jour, tranches horaires, couples, lecture des grilles (fichiers
synthétiques au format des sources), registre des points."""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import pytest

from starway import toll_tariffs as tt

JORF_MONTESSON = """<?xml version="1.0" encoding="UTF-8"?><ARTICLE><BLOC_TEXTUEL><CONTENU>
<p><br/>ANNEXE</p><table border="1"><tr><th><br/>Gare de Montesson</th><th><br/>Classe 1</th><th><br/>Classe 2</th>
<th><br/>Classe 3</th><th><br/>Classe 4</th><th><br/>Classe 5</th></tr>
<tr><td><br/>Tarif de base</td><td><br/>10,8</td><td><br/>20,8</td><td><br/>37,2</td><td><br/>45,7</td><td><br/>5,5</td></tr>
<tr><td><br/>Tarif réduit (1)</td><td><br/>6,6</td><td><br/>13,6</td><td><br/>24,1</td><td><br/>36,3</td><td><br/>3,4</td></tr>
</table><p class="note"><br/>(1) Applicable du lundi au vendredi de 10 heures à 16 heures et de 21 heures à 6 heures
hors jours fériés.</p></CONTENU></BLOC_TEXTUEL></ARTICLE>"""
JORF_CHAMBOURCY = """<ARTICLE><BLOC_TEXTUEL><CONTENU><table><tr><th>Gare de Chambourcy</th><th>Classe 1</th>
<th>Classe 2</th><th>Classe 3</th><th>Classe 4</th><th>Classe 5</th></tr><tr><td>Tarif de base</td><td>2,6</td>
<td>5,2</td><td>9,4</td><td>12,4</td><td>1,3</td></tr></table></CONTENU></BLOC_TEXTUEL></ARTICLE>"""
DUPLEX_TXT = ("Type_jour;paiement_badge;Heure_début;heure_fin;Rueil_Vaucresson;Rueil_Vélizy;Vaucresson_Rueil;"
              "Vaucresson_Vélizy;Vélizy_Vaucresson;Vélizy_Rueil\n"
              "Mardi;oui;7H;7H30;8,2;11,4;8,9;8,9;8,6;14,3\n"
              "Mardi;non;7H;7H30;11,4;11,4;8,9;8,9;14,3;14,3\n"
              "Mardi;non;7H30;8H;11,4;11,4;9,5;9,5;14,9;14,9\n"
              "Dimanches+Fêtes;non;0H;1H30;2,0;2,0;1,7;1,7;2,0;2,0\n")
COFI_TXT = ("autoroute_entree;echangeur_entree;nom_entree;autoroute_sortie;echangeur_sortie;nom_sortie;classe1;classe2;"
            "classe3;classe4;classe5\n"
            "A11;1;ABLIS;A10;-;PARIS (LA FOLIE BESSIN);3.7;5.7;9.9;13.2;2.3\n"
            "A10;-;PARIS (LA FOLIE BESSIN);A11;1;ABLIS;3.7;5.7;9.9;13.2;2.3\n"
            "A10;10;DOURDAN;A10;10;PARIS (LA FOLIE BESSIN);1.7;4.1;4.8;6.4;1\n"
            "A10;11;ALLAINVILLE;A4;-;BARRIERE DE MONTREUIL AUX LIONS;62.3;94.3;152.4;197.4;34.5\n")


def _sanef_page(classe: int, a: str, b: str, c: str, d: str) -> str:
    """Page de la grille Sanef au format de `pdftotext -layout` (FIXTURE : format de la source, cases de l'exemple)."""
    return (f"TARIFS DE PEAGE TTC AU 01/02/2026 - TAUX DE TVA : 20%        {classe} CLASSE\n\n"
            "PARIS / NOISY-LE-GRAND (péage de Coutevroult)       AUTOROUTES A4 - A26 SUD\n"
            "          COUTEVROULT N°15\n\n"
            f"{a}  MEAUX (A140) / CRECY N°16\n\n"
            f"{b} 1,5 ST-JEAN-LES-DEUX-JUMEAUX N°18\n\n"
            f"{c} 2,1 MONTREUIL-AUX-LIONS N°19                 A4\n\n"
            f"{d} 4,6 2,1 CHÂTEAU-THIERRY N°20\n\n"
            "VALLÉE DE LA HEM N°2 1,3          SURVILLIERS / SAINT-WITZ N°7 1,0\n")


SANEF_LAYOUT = "\f".join([
    "Tarifs de péage\n\n2026\n",
    _sanef_page(1, "2,4", "3,9", "4,5", "7,0"),
    _sanef_page(2, "3,8", "5,9", "7,1", "10,8"),
    _sanef_page(5, "1,5", "2,6", "2,7", "4,4")])


@pytest.fixture
def a14(tmp_path):
    m, c = tmp_path / "m.xml", tmp_path / "c.xml"
    m.write_text(JORF_MONTESSON, encoding="utf-8")
    c.write_text(JORF_CHAMBOURCY, encoding="utf-8")
    return pd.DataFrame(tt.a14_tariffs([m, c], ["m.xml", "c.xml"]), columns=tt.TARIFF_COLUMNS)


@pytest.fixture
def duplex(tmp_path):
    f = tmp_path / "a86.txt"
    f.write_bytes(DUPLEX_TXT.encode("cp1252"))
    return pd.DataFrame(tt.duplex_tariffs(f, "a86.txt"), columns=tt.TARIFF_COLUMNS)


def test_day_types_service_date_and_holidays():
    assert tt.day_type("DUPLEX_A86", date(2026, 11, 17)) == "mardi"
    assert tt.day_type("SAPN_A14", date(2026, 11, 17)) == "mardi"
    assert tt.day_type("APRR", date(2026, 11, 17)) == "tous"
    assert tt.day_type("DUPLEX_A86", date(2026, 11, 10)) == "veille_ferie"  # mardi, veille du 11 novembre
    assert tt.day_type("DUPLEX_A86", date(2026, 11, 11)) == "dimanche_ferie"
    assert tt.day_type("SAPN_A14", date(2026, 11, 11)) == "ferie"
    assert tt.day_type("DUPLEX_A86", date(2026, 8, 4)) == "aout_ouvrable"
    assert tt.day_type("DUPLEX_A86", date(2026, 8, 14)) == "aout_ouvrable"  # veille du 15 août, mais en août
    assert tt.day_type("DUPLEX_A86", date(2026, 11, 14)) == "samedi"
    assert tt.day_type("DUPLEX_A86", date(2026, 11, 15)) == "dimanche_ferie"
    with pytest.raises(ValueError):
        tt.day_type("SAPN_A14", date(2027, 1, 5))  # jours fériés non sourcés hors 2026


def test_clean_replaces_long_dashes():
    assert tt.clean("Celles" + chr(0x2013) + "ci  sont " + chr(0x2014) + " là") == "Celles-ci sont - là"


def test_a14_montesson_time_modulation(a14):
    at = lambda h, m=0: datetime(2026, 11, 17, h, m)
    p = lambda t, c=1: tt.prices_in_window(a14, "SAPN_A14_MONTESSON", "SAPN_A14_MONTESSON", c, t, t)
    assert p(at(8)) == ([10.8], "ok")
    assert p(at(10)) == ([6.6], "ok")
    assert p(at(15, 59)) == ([6.6], "ok")
    assert p(at(16)) == ([10.8], "ok")
    assert p(at(21)) == ([6.6], "ok")
    assert p(at(5, 59)) == ([6.6], "ok")
    assert p(at(8), 5) == ([5.5], "ok")
    assert p(at(11), 5) == ([3.4], "ok")
    sat = datetime(2026, 11, 14, 11, 0)
    assert p(sat) == ([10.8], "ok")
    hol = datetime(2026, 11, 11, 11, 0)
    assert p(hol) == ([10.8], "ok")
    # fenêtre qui franchit 10 h : heure de passage inconnue -> fourchette
    assert tt.prices_in_window(a14, "SAPN_A14_MONTESSON", "SAPN_A14_MONTESSON", 1, at(9, 40), at(10, 20)) == (
        [6.6, 10.8], "fourchette")
    # aller qui arrive à 6 h (journée 6h-14h) : passage avant 6 h, tarif réduit seul
    assert tt.prices_in_window(a14, "SAPN_A14_MONTESSON", "SAPN_A14_MONTESSON", 1, at(5, 35), at(6)) == ([6.6], "ok")
    # retour qui part à 16 h : tarif de base seul
    assert tt.prices_in_window(a14, "SAPN_A14_MONTESSON", "SAPN_A14_MONTESSON", 1, at(16), at(16, 30)) == ([10.8], "ok")
    cham = tt.prices_in_window(a14, "SAPN_A14_CHAMBOURCY", "SAPN_A14_CHAMBOURCY", 5, at(8), at(8))
    assert cham == ([1.3], "ok")


def test_a14_rows_cover_each_day_without_gap(a14):
    m = a14[(a14["point_id"] == "SAPN_A14_MONTESSON") & (a14["classe"] == 1)]
    for tj, g in m.groupby("type_jour"):
        g = g.sort_values("heure_debut")
        assert g["heure_debut"].iloc[0] == "00:00" and g["heure_fin"].iloc[-1] == "24:00", tj
        assert (g["heure_fin"].iloc[:-1].values == g["heure_debut"].iloc[1:].values).all(), tj
    assert set(m["type_jour"]) == set(tt.WEEKDAYS) | {"ferie"}


def test_duplex_parsing_and_badge(duplex):
    t = datetime(2026, 11, 17, 7, 10)
    std = tt.prices_in_window(duplex, "DUPLEX_RUEIL", "DUPLEX_VAUCRESSON", 1, t, t)
    badge = tt.prices_in_window(duplex, "DUPLEX_RUEIL", "DUPLEX_VAUCRESSON", 1, t, t, tarif="telepeage")
    assert std == ([11.4], "ok") and badge == ([8.2], "ok")
    assert tt.prices_in_window(duplex, "DUPLEX_VELIZY", "DUPLEX_RUEIL", 1, t, t) == ([14.3], "ok")
    span = tt.prices_in_window(duplex, "DUPLEX_VELIZY", "DUPLEX_RUEIL", 1, t, datetime(2026, 11, 17, 7, 40))
    assert span == ([14.3, 14.9], "fourchette")
    assert tt.prices_in_window(duplex, "DUPLEX_RUEIL", "DUPLEX_VELIZY", 5, t, t) == ([], "interdit")
    row = duplex[(duplex["type_jour"] == "dimanche_ferie")].iloc[0]
    assert (row["heure_debut"], row["heure_fin"]) == ("00:00", "01:30")


def test_cofiroute_parsing(tmp_path):
    f = tmp_path / "cofi.txt"
    f.write_text(COFI_TXT, encoding="utf-8")
    rows = pd.DataFrame(tt.cofiroute_tariffs(f, "cofi.txt"), columns=tt.TARIFF_COLUMNS)
    assert len(rows) == 6  # 3 lignes IDF x 2 classes ; la ligne vers Montreuil-aux-Lions (A4) est hors registre
    dourdan = rows[rows["point_id"] == "COFI_A10_DOURDAN"]
    assert set(dourdan["prix_ttc_eur"]) == {1.7, 1.0} and set(dourdan["sens"]) == {"vers Paris"}
    ablis = rows[(rows["entree_point_id"] == "COFI_A11_ABLIS") & (rows["classe"] == 5)]
    assert ablis["prix_ttc_eur"].tolist() == [2.3] and ablis["sortie_point_id"].tolist() == ["COFI_A10_ST_ARNOULT"]


def test_parse_aprr_pdf_table():
    text = ("FLEURY-EN-BIERE  URY                      34,07         2,00 €    3,40 €    4,70 €    6,20 €    1,40 €\n"
            "ALLAINES                  URY  168,19  30,10 €  45,50 €  75,30 €  96,70 €  15,60 €\n")
    out = tt.parse_aprr_pdf_table(text, ["FLEURY-EN-BIERE", "URY"])
    assert out == {("FLEURY-EN-BIERE", "URY"): (34.07, 2.0, 3.4, 4.7, 6.2, 1.4)}
    rows = tt.aprr_tariffs(out, "x.pdf")
    assert [(r["classe"], r["prix_ttc_eur"]) for r in rows] == [(1, 2.0), (5, 1.4)]
    assert rows[0]["entree_point_id"] == "APRR_A6_FLEURY" and rows[0]["sortie_point_id"] == "APRR_A6_URY"


def test_couples_from_points():
    assert tt.couples_from_points([]) == ([], "ok")
    assert tt.couples_from_points(["SAPN_A14_MONTESSON"]) == ([("SAPN_A14_MONTESSON", "SAPN_A14_MONTESSON")], "ok")
    assert tt.couples_from_points(["APRR_A6_FLEURY", "APRR_A6_URY"]) == ([("APRR_A6_FLEURY", "APRR_A6_URY")], "ok")
    assert tt.couples_from_points(["APRR_A6_FLEURY"])[1] == "couple_indetermine"
    assert tt.couples_from_points(["APRR_A6_FLEURY", "APRR_A6_URY", "APRR_A6_NEMOURS"])[1] == "couple_indetermine"
    assert tt.duplex_couple(["DUPLEX_RUEIL"]) == ("DUPLEX_RUEIL", "DUPLEX_VELIZY")
    assert tt.duplex_couple(["DUPLEX_VAUCRESSON", "DUPLEX_RUEIL"]) == ("DUPLEX_RUEIL", "DUPLEX_VAUCRESSON")
    assert tt.duplex_couple(["DUPLEX_VELIZY"]) == ("DUPLEX_VELIZY", "DUPLEX_RUEIL")
    assert tt.duplex_couple(["DUPLEX_VAUCRESSON"]) is None
    assert tt.couples_from_points(["DUPLEX_VAUCRESSON"])[1] == "sens_requis"


def test_trip_toll(a14, duplex):
    tariffs = pd.concat([a14, duplex, pd.DataFrame(tt.missing_tariffs(), columns=tt.TARIFF_COLUMNS)])
    t0, t1 = datetime(2026, 11, 17, 7, 0), datetime(2026, 11, 17, 7, 25)
    assert tt.trip_toll(tariffs, [], 1, t0, t1)["statut"] == "sans_peage"
    both = tt.trip_toll(tariffs, ["SAPN_A14_MONTESSON", "DUPLEX_RUEIL"], 1, t0, t1)
    assert both["min_eur"] == pytest.approx(10.8 + 11.4) and both["statut"] == "ok"
    assert tt.trip_toll(tariffs, ["SANEF_A4_COUTEVROULT"], 1, t0, t1)["min_eur"] is None
    assert tt.trip_toll(tariffs, ["DUPLEX_RUEIL"], 5, t0, t1)["statut"] == "interdit"
    # retour à 17 h 00 - 17 h 20 : autre tranche, autre prix (aller et retour calculés séparément)
    back = tt.trip_toll(tariffs, ["SAPN_A14_MONTESSON"], 1, datetime(2026, 11, 17, 17), datetime(2026, 11, 17, 17, 20))
    assert back["min_eur"] == 10.8
    night = tt.trip_toll(tariffs, ["SAPN_A14_MONTESSON"], 1, datetime(2026, 11, 17, 22), datetime(2026, 11, 17, 22, 30))
    assert night["min_eur"] == 6.6


def test_trip_toll_closed_system_needs_both_directions():
    rows = tt.aprr_tariffs({("URY", "VAL DE LOING-SOUPPES"): (24.27, 2.3, 4.0, 6.1, 8.4, 1.3)}, "x.pdf")
    tariffs = pd.DataFrame(rows, columns=tt.TARIFF_COLUMNS)
    t = datetime(2026, 11, 17, 8)
    out = tt.trip_toll(tariffs, ["APRR_A6_URY", "APRR_A77_SOUPPES"], 1, t, t)
    assert out["min_eur"] is None and out["statut"] == "couple_un_seul_sens"


def test_sanef_a4_reads_the_triangle_first_column():
    rows = tt.sanef_a4_tariffs(SANEF_LAYOUT, "s.pdf")
    got = {(r["entree_point_id"], r["sortie_point_id"], r["classe"]): r["prix_ttc_eur"] for r in rows}
    assert len(rows) == 8 and set(r["statut"] for r in rows) == {"ok"}
    assert got[("SANEF_A4_COUTEVROULT", "SANEF_A4_ST_JEAN", 1)] == 3.9
    assert got[("SANEF_A4_COUTEVROULT", "SANEF_A4_MONTREUIL", 1)] == 4.5
    assert got[("SANEF_A4_COUTEVROULT", "SANEF_A4_ST_JEAN", 5)] == 2.6
    assert got[("SANEF_A4_COUTEVROULT", "SANEF_A4_MONTREUIL", 5)] == 2.7
    # triangle : une case par couple, lue pour les deux sens ; aucun prix entre Saint-Jean et Montreuil
    assert got[("SANEF_A4_ST_JEAN", "SANEF_A4_COUTEVROULT", 1)] == 3.9
    assert not [k for k in got if "SANEF_A4_ST_JEAN" in k[:2] and "SANEF_A4_MONTREUIL" in k[:2]]
    assert all("une case par couple" in r["raison"] and r["source_id"] == "TOLL03" for r in rows)


def test_sanef_a4_refuses_an_unexpected_layout():
    # Saint-Jean avec trois cases au lieu de deux : la première colonne ne serait plus Coutevroult
    bad = SANEF_LAYOUT.replace("3,9 1,5 ST-JEAN", "9,9 3,9 1,5 ST-JEAN")
    with pytest.raises(ValueError, match="deux attendues"):
        tt.sanef_a4_tariffs(bad, "s.pdf")
    with pytest.raises(ValueError, match="introuvable"):
        tt.sanef_a4_tariffs(SANEF_LAYOUT.split("\f")[0], "s.pdf")
    with pytest.raises(ValueError, match="une attendue"):
        tt.sanef_a4_tariffs(SANEF_LAYOUT.replace("ST-JEAN-LES-DEUX-JUMEAUX N°18", "XX"), "s.pdf")


def test_a4_trip_toll_with_sanef_grid():
    tariffs = pd.DataFrame(tt.sanef_a4_tariffs(SANEF_LAYOUT, "s.pdf") + tt.missing_tariffs(), columns=tt.TARIFF_COLUMNS)
    t = datetime(2026, 11, 17, 8)
    ok = tt.trip_toll(tariffs, ["SANEF_A4_COUTEVROULT", "SANEF_A4_ST_JEAN"], 1, t, t)
    assert ok["min_eur"] == 3.9 and ok["statut"] == "ok"
    # la barrière seule : l'échangeur de sortie n'est pas connu, donc le péage non plus (jamais 0 EUR)
    alone = tt.trip_toll(tariffs, ["SANEF_A4_COUTEVROULT"], 1, t, t)
    assert alone["min_eur"] is None and alone["statut"] == "couple_indetermine"
    # Saint-Jean et Montreuil ensemble : aucun prix dans la grille
    assert tt.trip_toll(tariffs, ["SANEF_A4_ST_JEAN", "SANEF_A4_MONTREUIL"], 1, t, t)["min_eur"] is None
    # A1 et A13 : cases vides avec la raison de la lecture des grilles, jamais un prix
    a1 = tt.trip_toll(tariffs, ["SANEF_A1_SAINT_WITZ"], 1, t, t)
    assert a1["min_eur"] is None and a1["statut"] == "non_trouve"
    reasons = {r["point_id"]: r["raison"] for r in tt.missing_tariffs()}
    assert "case isolée" in reasons["SANEF_A1_SAINT_WITZ"] and "ne nomme ni Buchelay ni Rosny" in reasons["SAPN_A13_ROSNY"]


def test_registry_integrity():
    ids = [p.point_id for p in tt.POINTS]
    assert len(ids) == len(set(ids))
    nodes = [n for p in tt.POINTS for n in p.osm_nodes]
    assert len(nodes) == len(set(nodes)), "un nœud OSM rattaché à deux points"
    assert {p.statut_tarif for p in tt.POINTS} <= {tt.STATUT_OK, tt.STATUT_NON_TROUVE, tt.STATUT_HORS_PERIMETRE}
    assert {p.tarification for p in tt.POINTS} <= {"prix_fixe", "couple_entree_sortie", "couple_entree_sortie_horaire"}
    for p in tt.POINTS:
        for text in (p.note, p.paiement, p.ouvrage):
            assert chr(0x2014) not in text and chr(0x2013) not in text, p.point_id
        if p.statut_tarif == tt.STATUT_OK and p.systeme != "APRR_DORDIVES":
            assert p.nom_grille, p.point_id
    assert tt.points_from_osm_nodes([12120628914, 999, 137501371]) == ["SAPN_A14_MONTESSON", "DUPLEX_RUEIL"]


def test_withdrawal_switch_is_off_by_default_and_targets_only_vinci() -> None:
    """Interrupteur de retrait VINCI : désactivé sans variable, jamais activé par un autre texte ; actif = VINCI seul."""
    assert tt.withdrawal_enabled({}) is False
    assert tt.withdrawal_enabled({tt.RETRAIT_ENV: "0"}) is False and tt.withdrawal_enabled({tt.RETRAIT_ENV: ""}) is False
    assert tt.withdrawal_enabled({tt.RETRAIT_ENV: "1"}) and tt.withdrawal_enabled({tt.RETRAIT_ENV: "oui"})
    assert not any(p.statut_tarif == tt.STATUT_RETIRE for p in tt.POINTS)  # rien n'est retiré par défaut
    out = {p.point_id: p for p in tt.withdraw_vinci_points(tt.POINTS)}
    assert len(out) == len(tt.POINTS)
    for p in tt.POINTS:
        if p.systeme in tt.VINCI_SYSTEMES:
            assert out[p.point_id].statut_tarif == tt.STATUT_RETIRE
            assert out[p.point_id].note.startswith("réutilisation non autorisée")
        else:  # A14 (SAPN), A5 et A6 (APRR), A4 (Sanef) : inchangés
            assert out[p.point_id] == p
    assert {p.systeme for p in tt.POINTS if p.exploitant.startswith("Cofiroute")} <= set(tt.VINCI_SYSTEMES)
    assert out["SAPN_A14_MONTESSON"].statut_tarif == tt.STATUT_OK
