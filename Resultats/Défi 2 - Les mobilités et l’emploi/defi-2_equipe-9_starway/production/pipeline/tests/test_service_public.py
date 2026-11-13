"""Tests de starway.service_public : offres EN LIGNE à la date du fichier, rattachement à une commune par code postal
vérifié, jamais d'invention (Choisir le service public, EMP04, D-036)."""

from datetime import date

import pandas as pd
import pytest

from starway import service_public as sp

EM = chr(0x2014)
EN = chr(0x2013)
AS_OF = date(2026, 10, 11)


def commune(code, nom, dep, cps):
    return {"code": code, "nom": nom, "codeDepartement": dep, "codesPostaux": cps}


@pytest.fixture
def index():
    communes = [
        commune("94028", "Créteil", "94", ["94000", "94010", "94011"]),
        commune("94022", "Choisy-le-Roi", "94", ["94600"]),
        commune("92044", "Levallois-Perret", "92", ["92300"]),
        commune("78646", "Versailles", "78", ["78000"]),
        commune("78498", "Poissy", "78", ["78300"]),
        commune("78686", "Villennes-sur-Seine", "78", ["78670"]),
        commune("78251", "Médan", "78", ["78670"]),  # deux communes pour 78670 (cas d'école)
        commune("77288", "Melun", "77", ["77000"]),
        commune("77122", "Dammarie-les-Lys", "77", ["77190"]),
        commune("93072", "Saint-Denis", "93", ["93200"]),
        commune("93059", "Les Pavillons-sous-Bois", "93", ["93320"]),
        commune("75056", "Paris", "75", ["75001", "75002", "75116"]),
    ]
    arr = [
        commune("75101", "Paris 1er Arrondissement", "75", ["75001"]),
        commune("75102", "Paris 2e Arrondissement", "75", ["75002"]),
        commune("75116", "Paris 16e Arrondissement", "75", ["75016", "75116"]),
    ]
    return sp.postal_index(communes, arr)


ASTRES = frozenset({"94028", "94022", "92044", "78646", "78498", "78686", "78251", "77288", "77122", "93072", "93059",
                    "75101", "75102", "75116"})


# --- en ligne ----------------------------------------------------------------------------------------------------
def frame(rows):
    cols = {sp.COL_START: [], sp.COL_END: []}
    for s, e in rows:
        cols[sp.COL_START].append(s)
        cols[sp.COL_END].append(e)
    return pd.DataFrame(cols)


def test_file_date_from_name():
    assert sp.file_date("offres-datagouv-20261011.csv") == date(2026, 10, 11)
    with pytest.raises(ValueError):
        sp.file_date("offres.csv")


def test_online_includes_both_bounds_and_excludes_outside():
    df = frame([
        ("11/10/2026", "11/10/2026"),  # début et fin = date du fichier : en ligne
        ("10/10/2026", "31/10/2026"),
        ("12/10/2026", "31/10/2026"),  # pas encore publiée
        ("01/09/2026", "10/10/2026"),  # expirée la veille
    ])
    assert sp.online_mask(df, AS_OF).tolist() == [True, True, False, False]


def test_missing_dates_are_not_online_and_are_counted_apart():
    df = frame([("", ""), ("01/10/2026", ""), ("", "31/12/2026")])
    assert sp.online_mask(df, AS_OF).tolist() == [False, False, False]
    assert sp.missing_dates_mask(df).tolist() == [True, True, True]


def test_open_ended_publication_counts_as_online():
    df = frame([("01/10/2026", "31/12/9999")])
    assert sp.online_mask(df, AS_OF).tolist() == [True]
    assert sp.open_end(df[sp.COL_END]).tolist() == [True]


# --- texte -------------------------------------------------------------------------------------------------------
def test_norm_and_saint_variants():
    assert sp.norm("Saint-Germain-en-Laye") == sp.norm("ST GERMAIN EN LAYE")
    assert sp.norm("Évry-Courcouronnes") == "evry courcouronnes"


def test_department_of():
    assert sp.department_of("Hauts-de-Seine (92)") == "92"
    assert sp.department_of("Corse du Sud (2A)") == "2A"
    assert sp.department_of("") is None


def test_five_digit_codes_ignores_longer_numbers():
    assert sp.five_digit_codes("CS 30704\n78000 VERSAILLES") == ["30704", "78000"]
    assert sp.five_digit_codes("123456 rue") == []


def test_clean_text_removes_dashes_and_spaces():
    assert sp.clean_text(f"Chargé {EN} de  mission\n(F/H) {EM} Paris") == "Chargé - de mission (F/H) - Paris"


# --- index des codes postaux -------------------------------------------------------------------------------------
def test_postal_index_uses_arrondissements_not_paris_commune(index):
    assert [c.insee for c in index["75001"]] == ["75101"]
    assert [c.insee for c in index["75116"]] == ["75116"]
    assert not any(c.insee == "75056" for cs in index.values() for c in cs)


# --- localisation ------------------------------------------------------------------------------------------------
def loc(localisation, *addresses, index, astres=ASTRES):
    return sp.locate(localisation, addresses, index, astres)


def test_unique_postal_code_with_matching_name(index):
    r = loc("Yvelines (78)", "Place de la Mairie : 78300 Poissy", index=index)
    assert (r.insee, r.status, r.how) == ("78498", "commune", "cp_et_nom")


def test_unique_postal_code_without_name(index):
    r = loc("Paris (75)", "12 rue Portalis - 75001", index=index)
    assert (r.insee, r.how) == ("75101", "cp_seul")


def test_postal_code_with_another_commune_name_is_not_attached(index):
    # 94000 est le code de Créteil ; l'adresse écrit Choisy-le-Roi : on ne sait pas laquelle est juste
    r = loc("Val-de-Marne (94)", "CHOISY LE ROI : 94000 Choisy-le-Roi", index=index)
    assert (r.insee, r.status, r.reason) == (None, "departement", "cp_nom_discordant")


def test_unknown_five_digit_code_like_cedex_stays_at_department(index):
    r = loc("Val-d'Oise (95)", "Conseil départemental : 95032 Taverny", index=index)
    assert (r.insee, r.reason) == (None, "cp_cedex_ou_inconnu")
    r2 = loc("Yvelines (78)", "220 rue Mansart 78375 PLAISIR CEDEX", index=index)
    assert (r2.insee, r2.reason) == (None, "cp_cedex_ou_inconnu")
    r3 = loc("Yvelines (78)", "Mairie", "Poissy", index=index)
    assert (r3.insee, r3.reason) == (None, "cp_absent")


def test_shared_postal_code_needs_a_matching_name(index):
    assert loc("Yvelines (78)", "Rue X : 78670 Médan", index=index).insee == "78251"
    r = loc("Yvelines (78)", "Rue X 78670", index=index)
    assert (r.insee, r.reason) == (None, "cp_partage_sans_nom")
    r2 = loc("Yvelines (78)", "Rue X : 78670 Triel", index=index)
    assert (r2.insee, r2.reason) == (None, "cp_partage_sans_nom")


def test_two_different_postal_codes_are_not_attached(index):
    r = loc("Yvelines (78)", "78000 Versailles", "78300 Poissy", index=index)
    assert (r.insee, r.reason) == (None, "cp_multiples")


def test_postal_code_contradicting_the_department(index):
    r = loc("Hauts-de-Seine (92)", "78000 Versailles", index=index)
    assert (r.insee, r.reason) == (None, "cp_hors_departement")


def test_outside_ile_de_france_is_none(index):
    assert loc("Creuse (23)", "La Valette : 23320 Saint-Vaury", index=index) is None
    assert loc("Oise (60)", "78000 Versailles", index=index) is None  # le département du fichier prévaut


def test_department_missing_uses_a_single_postal_code(index):
    assert loc("", "75001 Paris", index=index).insee == "75101"
    assert loc("", "Montreuil", index=index) is None


def test_commune_without_astre_stays_at_department(index):
    r = loc("Yvelines (78)", "78000 Versailles", index=index, astres=frozenset({"75101"}))
    assert (r.insee, r.reason) == (None, "commune_hors_astres")


def test_cs_number_is_not_a_postal_code(index):
    r = loc("Yvelines (78)", "ROUTE DES DOCKS CS 30704\n78000 VERSAILLES", index=index)
    assert r.insee == "78646"


def test_name_before_the_postal_code_does_not_count(index):
    # le nom de la rue contient « Versailles » ; ce qui suit le code postal ne le contredit pas
    r = loc("Yvelines (78)", "168 rue de Versailles - 78300 POISSY", index=index)
    assert r.insee == "78498"


# --- offres ------------------------------------------------------------------------------------------------------
def offers_frame(rows):
    cols = [sp.COL_ORG, sp.COL_REF, sp.COL_VERSANT, sp.COL_TITLE, sp.COL_LOC, sp.COL_AFF, sp.COL_AFF_FREE, sp.COL_START,
            sp.COL_END, sp.COL_FIRST]
    return pd.DataFrame(rows, columns=cols)


ROWS = [
    ("Communes", "A1", "Fonction Publique Territoriale", "Jardinier", "Yvelines (78)", "Mairie : 78300 Poissy", "",
     "01/10/2026", "31/10/2026", "01/10/2026"),
    ("Communes", "A1", "Fonction Publique Territoriale", "Jardinier", "Yvelines (78)", "Mairie : 78300 Poissy", "",
     "01/10/2026", "31/10/2026", "01/10/2026"),  # même référence répétée
    ("Ministère", "B2", "Fonction Publique de l'Etat", f"Chargé {EN} d'études", "Paris (75)", "", "75001 Paris",
     "01/10/2026", "31/12/9999", "01/10/2026"),
    ("Hôpital", "C3", "", "Infirmier", "Val-de-Marne (94)", "Hôpital : 94000 Choisy-le-Roi", "", "01/10/2026",
     "31/10/2026", "01/10/2026"),
    ("Communes", "D4", "Fonction Publique Territoriale", "Expiré", "Yvelines (78)", "78300 Poissy", "", "01/01/2026",
     "31/01/2026", "01/01/2026"),
    ("Ministère", "E5", "Fonction Publique de l'Etat", "Sans dates", "Paris (75)", "75001 Paris", "", "", "",
     "05/10/2026"),
    ("Communes", "F6", "Fonction Publique Territoriale", "Hors IDF", "Creuse (23)", "23320 Saint-Vaury", "", "01/10/2026",
     "31/10/2026", "01/10/2026"),
]


def test_build_offers_counts_one_offer_per_reference_and_keeps_the_rest_apart(index):
    offers, stats = sp.build_offers(offers_frame(ROWS), AS_OF, index, ASTRES)
    by_ref = {o.ref: o for o in offers}
    assert set(by_ref) == {"A1", "B2", "C3"}  # D4 expirée, E5 sans dates, F6 hors Île-de-France
    assert by_ref["A1"].insee == "78498" and by_ref["B2"].insee == "75101"
    assert by_ref["C3"].insee is None and by_ref["C3"].status == "departement" and by_ref["C3"].versant == "n/c"
    assert by_ref["B2"].end is None and by_ref["B2"].title == "Chargé - d'études"
    assert stats["lignes"] == 7 and stats["lignes_sans_date"] == 1 and stats["lignes_en_ligne"] == 5
    assert stats["refs_en_ligne"] == 4 and stats["lignes_hors_idf"] == 1 and stats["offres_idf"] == 3


def test_same_reference_on_two_places_goes_to_the_department(index):
    rows = [ROWS[0], (*ROWS[0][:5], "Mairie : 78000 Versailles", *ROWS[0][6:])]
    offers, stats = sp.build_offers(offers_frame(rows), AS_OF, index, ASTRES)
    assert len(offers) == 1 and offers[0].insee is None and offers[0].reason == "cp_multiples"
    assert stats["ref_lieux_differents"] == 1


# --- export ------------------------------------------------------------------------------------------------------
def export(index, rows=ROWS):
    offers, stats = sp.build_offers(offers_frame(rows), AS_OF, index, ASTRES)
    return sp.build_export(offers, stats, as_of=AS_OF, file_name="offres-datagouv-20261011.csv", file_sha256="ab" * 32,
                           extracted_at="2026-11-05T11:01Z", span={"first_publication_min": "2021-06-23",
                                                                  "first_publication_max": "2026-10-10"},
                           processing_version="0.1.0", generated_at="2026-11-05T12:00:00Z")


def test_export_sums_and_contract(index):
    main, detail = export(index)
    assert main["contract"] == "service-public-1" and detail["contract"] == "service-public-offres-1"
    assert main["region"]["offers"] == 3 and main["region"]["commune"] == 2 and main["region"]["departement"] == 1
    assert main["communes"] == {"75101": {"n": 1, "v": {"FPE": 1}}, "78498": {"n": 1, "v": {"FPT": 1}}}
    assert main["region"]["departement_reasons"] == {"cp_nom_discordant": 1}
    assert main["departements"]["94"] == {"name": "Val-de-Marne", "offers": 1, "commune": 0, "departement": 1}
    assert main["counts"]["online_references"] == 4
    assert sp.check_export(main, detail, ASTRES) == []


def test_export_has_the_metadata_gap_and_no_personal_field(index):
    main, detail = export(index)
    assert main["metadata_gap"]["fiche_temporal_coverage"] == {"start": "2021-01-01", "end": "2023-12-31"}
    assert "10/10/2026" in main["metadata_gap"]["note"]
    assert "à pourvoir" in main["method"]  # la méthode dit ce que ce n'est pas : une date de publication ne prouve rien
    for o in detail["communes"]["78498"]:
        assert set(o) == {"r", "t", "v", "e", "d", "f"}  # ni adresse, ni contact, ni compétences


def test_check_export_catches_a_stray_commune_and_personal_data(index):
    main, detail = export(index)
    assert sp.check_export(main, detail, {"75101"}) != []  # 78498 n'est dans aucun astre
    detail["communes"]["78498"][0]["t"] = "Contact prenom.nom@mairie.fr"
    assert any("suspect" in e for e in sp.check_export(main, detail, ASTRES))


def test_published_text_has_no_long_dash(index):
    main, detail = export(index)
    import json

    txt = json.dumps([main, detail], ensure_ascii=False)
    assert EM not in txt and EN not in txt
