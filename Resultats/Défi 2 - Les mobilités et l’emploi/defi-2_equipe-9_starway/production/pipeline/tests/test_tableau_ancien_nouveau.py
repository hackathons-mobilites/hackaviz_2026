"""Tableau ancien / nouveau : zéro écart sur un dossier comparé à lui-même, chaque catégorie d'écart détectée sur une copie modifiée.

Fixtures réduites construites ici (4 communes, 3 astres, fichiers SWOD réels mais minuscules) : aucun fichier lourd.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from starway import od_export as ox
from starway import tableau_ancien_nouveau as tan

CODES = ["75108", "78358", "78418", "78498"]
JOBS = [100000, 5000, 3000, 20000]
POLES = [
    {"id": "BE_1107_75108", "name": "Paris 8e", "communes": ["75108"], "jobs": 100000, "bassin": {"code": "1107"}},
    {"id": "BE_1125", "name": "Seine-Aval", "name_short_insee": "78498", "communes": ["78358", "78498"], "jobs": 25000, "bassin": {"code": "1125"}},
    {"id": "BE_1200", "name": "Boucle", "communes": ["78418"], "jobs": 3000, "bassin": {"code": "1200"}},
]
POLE_OF = [0, 1, 2, 1]
N_SLOTS = 288
NO_TRIP = 255
# minutes aller / retour (constantes toute la journée) : origine -> destination -> (aller, retour)
TRANSIT = {
    "78358": {"75108": (53, 53), "78418": (20, 22), "78498": (38, 50)},
    "78418": {"75108": (70, 80), "78358": (21, 23), "78498": (66, 66)},
    "75108": {"78358": (55, 57), "78418": (72, 75), "78498": (40, 41)},
    "78498": {"75108": (41, 42), "78358": (39, 51), "78418": (65, 64)},
}
CAR = {
    "78358": {"75108": (30, 31), "78418": (10, 11), "78498": (20, 21)},
    "78418": {"75108": (35, 36), "78358": (11, 10), "78498": (25, 24)},
    "75108": {"78358": (31, 30), "78418": (36, 35), "78498": (28, 28)},
    "78498": {"75108": (28, 29), "78358": (21, 20), "78418": (24, 25)},
}
MODES = [{"id": "transit", "label": "Transports en commun + marche"}, {"id": "bike_transit", "label": "Vélo + transports en commun"},
         {"id": "bike", "label": "Vélo"}, {"id": "walk", "label": "Marche"}, {"id": "car", "label": "Voiture (route vide)"},
         {"id": "car_traffic", "label": "Voiture (trafic moyen DiRIF)"}, {"id": "velib", "label": "Vélib'"}]


def ecrire(chemin: Path, contenu: object) -> None:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(json.dumps(contenu, ensure_ascii=False), encoding="utf-8")


def matrice(table: dict[str, tuple[int, int]], sens: int) -> np.ndarray:
    m = np.full((len(CODES), N_SLOTS), NO_TRIP, dtype=np.uint8)
    for code, valeurs in table.items():
        m[CODES.index(code), :] = valeurs[sens]
    return m


def ecrire_bin(racine: Path, origine: str, transit: dict, car: dict) -> None:
    i = CODES.index(origine)
    sections = [ox.series_section(0, i, matrice(transit, 0), matrice(transit, 1))]
    scal_out = np.array([car.get(c, (NO_TRIP, NO_TRIP))[0] for c in CODES], dtype=np.uint8)
    scal_ret = np.array([car.get(c, (NO_TRIP, NO_TRIP))[1] for c in CODES], dtype=np.uint8)
    vide = np.full(len(CODES), NO_TRIP, dtype=np.uint8)
    sections.append(ox.scalar_section(1, i, vide, vide))
    sections.append(ox.scalar_section(2, i, vide, vide))
    sections.append(ox.scalar_section(3, i, scal_out, scal_ret))
    p = racine / "od_walk3000" / "o" / f"{origine}.bin"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(ox.pack_file(i, 0, N_SLOTS, sections))


def access_de(origine: str) -> dict:
    """Vers les ancres d'astres (mêmes valeurs par journée) : du vélo + TC pour la seule commune de la visite."""
    ancres = ["75108", "78498", "78418"]
    t = TRANSIT[origine]
    serie = {"out": [t.get(a, (None, None))[0] for a in ancres], "ret": [t.get(a, (None, None))[1] for a in ancres], "reason": [None] * 3}
    modes: dict = {"transit": {"d06": serie, "d09": serie, "d14": serie}}
    if origine == "78358":
        # le vélo + TC allume aussi Boucle à 60 min ; rien ne se perd : gain d'un astre face aux TC... ici TC 20/22 déjà allumé, on enlève l'accès TC
        modes["transit"]["d14"] = {"out": [53, 38, 100], "ret": [53, 50, 100], "reason": [None] * 3}
        modes["bike_transit"] = {"d14": {"out": [50, 35, 30], "ret": [50, 45, 30], "reason": [None] * 3}}
    return {"insee": origine, "modes": modes}


def contexte(origine: str, flux: int = 554, median: int = 42520) -> dict:
    return {"insee": origine, "income": {"median_living_standard_eur": median, "median_status": "ok", "status": "ok"},
            "flows_to_poles": {"poles": {"BE_1107_75108": {"flux": flux, "precision": "ok"}}}}


def insight(iid: str, kind: str, o: str, jobs: int, rang: int = 1, crosscheck: str = "not_checked") -> dict:
    return {"id": iid, "kind": kind, "scenario": {"o": o, "d": "d14", "b": 60, "m": "transit", "vs": None, "compare_day": "d09"},
            "metric": {"jobs": jobs, "jobs_ref": 100000, "jobs_delta": jobs - 100000, "poles_delta": -1}, "rank": rang, "robust": True, "crosscheck": crosscheck}


def creer(racine: Path) -> Path:
    data = racine / "data"
    ecrire(data / "poles.json", POLES)
    ecrire(data / "communes.json", [{"insee": c, "name": n, "dep": c[:2], "population": p} for c, n, p in
                                    zip(CODES, ["Paris 8e", "Maisons-Laffitte", "Montesson", "Poissy"], [36000, 24000, 15000, 40000], strict=True)])
    ecrire(data / "insights.json", [insight("eclipse_01", "eclipse", "78358", 55000), insight("late_return_01", "late_return", "78418", 7000)])
    ecrire(data / "meta.json", {
        "dataset_id": "jeu_a", "service_date": "2026-11-17", "gtfs_downloaded_at": "2026-11-02", "processing_version": "0.1.0",
        "day_types": [{"id": "d06", "label": "6h-14h", "start": "06:00", "end": "14:00"}, {"id": "d09", "label": "9h-17h", "start": "09:00", "end": "17:00"},
                      {"id": "d14", "label": "14h-22h", "start": "14:00", "end": "22:00"}],
        "budgets": [30, 45, 60], "modes": MODES, "access_communes": CODES, "itineraries_communes": CODES,
        "mode_coverage": {"bike_transit": ["78358"], "velib": []}, "velib": {"stations": 1520},
        "walk_settings": {"default": "normal", "settings": [{"id": "normal", "leg_limit_m": 3000}]},
        "car_congestion": {"periods": [{"id": "p16_20", "start": "16:00", "end": "20:00", "index": 1.95}]},
        "insights": {"excluded": []},
    })
    ecrire(data / "od_walk3000" / "index.json", {
        "communes": CODES, "jobs": JOBS, "pole_of": POLE_OF, "outbound_lookback_min": 120, "files": "all",
        "modes": [{"id": "transit", "code": 0, "kind": "series"}, {"id": "walk", "code": 1, "kind": "scalar"},
                  {"id": "bike", "code": 2, "kind": "scalar"}, {"id": "car", "code": 3, "kind": "scalar"}],
        "coverage": {m: {"complete": True} for m in ("transit", "walk", "bike", "car")},
    })
    for c in CODES:
        ecrire_bin(data, c, TRANSIT[c], CAR[c])
        ecrire(data / "access" / f"{c}.json", access_de(c))
        ecrire(data / "context" / f"{c}.json", contexte(c))
    ecrire(data / "bmo.json", {"year": 2026, "bassins": {"1107": {"families": {"V": {"met": {"n": 47307, "masked": 1}}}}}})
    ecrire(data / "bmo_metiers.json", {"metiers": [{"code": tan.METIER_VISITE, "name": "Aide de cuisine", "family": "V"}]})
    ecrire(data / "sources.json", [{"source_id": "EMP01"}])
    return data


@pytest.fixture()
def ancien(tmp_path: Path) -> Path:
    return creer(tmp_path / "a")


def copie(tmp_path: Path, ancien: Path) -> Path:
    b = tmp_path / "b" / "data"
    shutil.copytree(ancien, b)
    return b


def rapport(ancien: Path, nouveau: Path, **kw: object) -> tan.Rapport:
    return tan.construire(ancien, nouveau, workers=1, **kw)  # type: ignore[arg-type]


def lire(chemin: Path) -> object:
    return json.loads(chemin.read_text(encoding="utf-8"))


def par_cle(lignes: list[tan.Ligne]) -> dict[str, tan.Ligne]:
    return {x.cle: x for x in lignes}


def test_dossier_compare_a_lui_meme_zero_ecart(ancien: Path) -> None:
    r = rapport(ancien, ancien)
    assert tan.ecarts_tries(r.lignes_principales()) == []
    assert tan.ecarts_tries(r.toutes_les_lignes()) == []
    assert all(i.differents == 0 and i.seulement_ancien == 0 and i.seulement_nouveau == 0 for i in r.inventaire)
    texte = tan.ecrire_markdown(r)
    assert "Aucun des" in texte and "Aucun écart." in texte
    assert chr(0x2014) not in texte and chr(0x2013) not in texte


def test_copie_identique_zero_ecart_avec_deux_calculs_separes(ancien: Path, tmp_path: Path) -> None:
    r = rapport(ancien, copie(tmp_path, ancien))
    assert tan.ecarts_tries(r.toutes_les_lignes()) == [] and all(i.differents == 0 for i in r.inventaire)


def test_visite_chiffres_lus_comme_le_site(ancien: Path) -> None:
    chiffres = {c.cle: c for c in tan.chiffres_visite(tan.Jeu.charger(ancien))}
    # 3 astres atteints à 60 min (Paris 8e, Seine-Aval par Poissy, Boucle par Montesson), commune de départ (5 000 postes) hors du total
    assert chiffres["ciel.etoiles"].valeur == 3 and chiffres["ciel.postes"].valeur == 123000
    assert chiffres["preuve.aller"].valeur == 53 and chiffres["preuve.retour"].valeur == 53
    assert chiffres["preuve.depart"].valeur == "08:05" and chiffres["preuve.depart"].oral == "8 heures 5"
    assert chiffres["soir.aller"].valeur == 38 and chiffres["soir.retour"].valeur == 50 and chiffres["soir.atteint"].valeur is True
    assert chiffres["preuve.flux"].oral == "plus de 550" and chiffres["bmo.projets"].oral == "au moins 47 000"
    assert chiffres["voisine.etoiles"].valeur == 1  # Montesson : seule Maisons-Laffitte (23 min) dans Seine-Aval est atteinte, Poissy à 66 min
    assert chiffres["velo.gagnes"].valeur == 1 and chiffres["velo.perdus"].valeur == 0
    # Voiture à 14h-22h : l'indice 16h-20h ne couvre ni 14h (aller) ni 22h (retour) : temps route vide
    assert chiffres["voiture.etoiles"].valeur == 3


def test_copie_modifiee_chiffre_de_visite_signale(ancien: Path, tmp_path: Path) -> None:
    b = copie(tmp_path, ancien)
    transit = {**TRANSIT["78358"], "75108": (60, 60)}
    ecrire_bin(b, "78358", transit, CAR["78358"])
    ecrire(b / "context" / "78358.json", contexte("78358", flux=800))
    r = rapport(ancien, b)
    visite = par_cle(r.visite)
    aller = visite["visite:preuve.aller"]
    assert (aller.ancien, aller.nouveau, aller.ecart) == (53, 60, 7) and aller.pct == pytest.approx(13.2, abs=0.1)
    assert aller.signal == "chiffre de la visite qui change"
    flux = visite["visite:preuve.flux"]
    assert flux.oral_ancien != flux.oral_nouveau
    texte = tan.ecrire_markdown(r)
    assert "chiffre de la visite qui change ; phrase prononcée différente" in texte
    assert "Visite guidée :" in texte


def test_copie_modifiee_decouvertes_apparues_disparues_modifiees(ancien: Path, tmp_path: Path) -> None:
    b = copie(tmp_path, ancien)
    items = lire(b / "insights.json")
    items[0]["metric"]["jobs"] = 50000
    items[0]["metric"]["jobs_delta"] = -50000
    items[1] = insight("late_return_01", "late_return", "78498", 9000)  # l'identifiant reste, le scénario change : autre découverte
    ecrire(b / "insights.json", items)
    r = rapport(ancien, b)
    d = r.decouvertes
    assert d.modifiees == 1 and d.inchangees == 0 and len(d.disparues) == 1 and len(d.apparues) == 1
    assert "Montesson" in d.disparues[0] and "Poissy" in d.apparues[0]
    jobs = next(x for x in d.lignes if x.cle.endswith(":jobs") and "eclipse" in x.cle)
    assert (jobs.ancien, jobs.nouveau, jobs.ecart) == (55000, 50000, -5000)
    assert sum(x.absent_un_cote and x.cle.endswith(":presence") for x in d.lignes) == 2
    assert sum(x.categorie == "decouvertes" for x in r.absences()) == 2  # une découverte apparue ou disparue compte une fois
    assert "Découvertes : 0 inchangées, 1 avec un chiffre modifié, 1 disparaissent, 1 apparaissent." in tan.ecrire_markdown(r)


def test_copie_modifiee_compteurs_modes_et_communes(ancien: Path, tmp_path: Path) -> None:
    b = copie(tmp_path, ancien)
    meta = lire(b / "meta.json")
    meta["dataset_id"], meta["service_date"] = "jeu_b", "2026-11-24"
    meta["mode_coverage"]["bike_transit"] = ["78358", "78418", "75108"]
    ecrire(b / "meta.json", meta)
    poles = lire(b / "poles.json")
    poles[0]["jobs"] = 90000
    ecrire(b / "poles.json", poles)
    # Depuis Montesson, Paris 8e devient atteignable : une étoile de plus
    ecrire_bin(b, "78418", {**TRANSIT["78418"], "75108": (40, 40)}, CAR["78418"])
    r = rapport(ancien, b)
    compteurs = par_cle(r.compteurs)
    assert compteurs["compteur:service_date"].nouveau == "2026-11-24" and not compteurs["compteur:service_date"].identique
    assert (compteurs["compteur:postes_astres"].ancien, compteurs["compteur:postes_astres"].nouveau) == (128000, 118000)
    assert compteurs["compteur:communes_velo_tc"].ecart == 2
    modes = par_cle(r.modes)
    moyenne = modes["mode:transit:d09:60:e"]
    assert moyenne.ancien != moyenne.nouveau and moyenne.ecart == pytest.approx(0.25)
    selection = par_cle(r.selection)
    etoiles = selection["commune:78418:transit:d09:60:etoiles"]
    assert (etoiles.ancien, etoiles.nouveau, etoiles.ecart) == (1, 2, 1)
    assert selection["commune:78418:transit:d09:60:postes"].ecart == 100000
    texte = tan.ecrire_markdown(r)
    assert "1 -> 2 (+1)" in texte and "jeu_a" in texte and "jeu_b" in texte
    assert "Étoiles allumées, communes de référence : 1 commune changerait" in texte


def test_copie_modifiee_donnee_absente_d_un_cote(ancien: Path, tmp_path: Path) -> None:
    b = copie(tmp_path, ancien)
    (b / "bmo.json").unlink()
    r = rapport(ancien, b)
    compteurs = par_cle(r.compteurs)
    assert compteurs["compteur:bassins_bmo"].nouveau is tan.ABSENT and compteurs["compteur:bassins_bmo"].absent_un_cote
    assert compteurs["compteur:bassins_bmo"].signal == "donnée absente d'un côté"
    bmo = par_cle(r.visite)["visite:bmo.projets"]
    assert bmo.absent_un_cote and "chiffre de la visite qui change" in bmo.signal
    assert any(i.dossier == "(racine)" and i.seulement_ancien == 1 for i in r.inventaire)
    # la suppression d'un fichier d'origine rend l'étoile non calculable, jamais 0
    (b / "od_walk3000" / "o" / "78358.bin").unlink()
    r2 = rapport(ancien, b)
    etoiles = par_cle(r2.selection)["commune:78358:transit:d09:60:etoiles"]
    assert etoiles.nouveau is tan.ABSENT and etoiles.ancien == 3


def test_fichiers_et_cases_listes(ancien: Path, tmp_path: Path) -> None:
    b = copie(tmp_path, ancien)
    meta = lire(b / "meta.json")
    meta["velib"]["stations"] = 1600
    ecrire(b / "meta.json", meta)
    access = lire(b / "access" / "78358.json")
    access["modes"]["transit"]["d09"]["out"][0] = 55
    ecrire(b / "access" / "78358.json", access)
    r = rapport(ancien, b)
    assert any(x.cle == "meta.json.velib.stations" and x.ecart == 80 for x in r.fichiers)
    case = next(x for x in r.cases.lignes)
    assert case.ecart == 2 and "78358" in case.cle and "BE_1107_75108" in case.cle
    assert r.cases.comparees[("transit", "d09", "out")] > 0
    n = tan.ecrire_csv(r, tmp_path / "s.ecarts.csv")
    assert n >= 2
    contenu = (tmp_path / "s.ecarts.csv").read_text(encoding="utf-8")
    assert "access:78358" in contenu and "meta.json.velib.stations" in contenu
    assert "3.4" in tan.ecrire_markdown(r) and "Cases différentes" in tan.ecrire_markdown(r)


def test_navitia_contredit_est_signale_et_trajets_tries(ancien: Path, tmp_path: Path) -> None:
    b = copie(tmp_path, ancien)
    resume = {"insight_checks": [{"id": "eclipse_01", "label": "eclipse_01", "kind": "eclipse", "scenario": lire(b / "insights.json")[0]["scenario"], "verdict": "contradicted"},
                                 {"id": "x", "label": "x", "kind": "late_return", "scenario": {"o": "78418", "d": "d14", "b": 60, "m": "transit"}, "verdict": "confirmed"}]}
    json_nav = tmp_path / "nav.json"
    ecrire(json_nav, resume)
    csv_nav = tmp_path / "nav.csv"
    csv_nav.write_text("origin,dest,day,leg,starway_min,navitia_min,status\nA,B,d09,aller,50,52,ok\nC,D,d09,aller,40,70,ok\nE,F,d09,aller,40,,ok\n", encoding="utf-8")
    r = rapport(ancien, b, navitia=[json_nav, csv_nav])
    assert len(r.contradictions) == 1 and r.contradictions[0]["etat"] == "encore publiée"
    texte = tan.ecrire_markdown(r)
    assert "Découvertes contredites par Navitia : 1" in texte and "contredite" in tan.resume(r)[-1]
    assert "**Contredites par Navitia** :" in texte
    lignes = [li for li in texte.splitlines() if li.startswith(("| A vers", "| C vers", "| E vers"))]
    assert lignes[0].startswith("| E vers") and lignes[1].startswith("| C vers") and lignes[2].startswith("| A vers")
    # une découverte écartée dans meta.insights.excluded compte aussi, sans fichier fourni
    meta = lire(b / "meta.json")
    meta["insights"]["excluded"] = [{"kind": "eclipse", "scenario": {"o": "78418", "d": "d14", "b": 60, "m": "transit"}, "cause": "navitia_contradicted"}]
    ecrire(b / "meta.json", meta)
    assert len(rapport(ancien, b).contradictions) == 1


def test_points_du_plan_trente_et_une_lignes_et_eclipse_01(ancien: Path, tmp_path: Path) -> None:
    b = copie(tmp_path, ancien)
    texte = tan.ecrire_markdown(rapport(ancien, b))
    assert "31 lignes de bus" in texte and "`07r_gtfs_reference_day.py`" in texte
    assert "toujours publiée (rang 1, identifiant eclipse_01)" in texte and "Verdict Navitia sur le nouveau calcul : non fourni." in texte
    # la découverte disparaît : le tableau le dit ; le trajet décisif reste comparé, le verdict fourni est repris
    items = lire(b / "insights.json")
    scenario = items[0]["scenario"]
    ecrire(b / "insights.json", items[1:])
    ecrire_bin(b, "78358", {**TRANSIT["78358"], "75108": (53, 65)}, CAR["78358"])
    nav = tmp_path / "nav.json"
    ecrire(nav, {"insight_checks": [{"label": "eclipse_01", "kind": "eclipse", "scenario": scenario, "verdict": "contradicted"}]})
    r = rapport(ancien, b, navitia=[nav])
    assert "disparue du nouveau jeu. Verdict Navitia sur le nouveau calcul : contradicted." in r.etat_eclipse
    retour = par_cle(r.suivis)["suivi:retour"]
    assert (retour.ancien, retour.nouveau) == (53, 65) and par_cle(r.suivis)["suivi:atteint"].nouveau is False


def test_navitia_non_fourni_est_ecrit(ancien: Path) -> None:
    r = rapport(ancien, ancien)
    assert "Résultats Navitia non fournis" in tan.ecrire_markdown(r) and tan.resume(r)[-1] == "Navitia : résultats non fournis."


def test_resume_au_plus_dix_lignes(ancien: Path, tmp_path: Path) -> None:
    b = copie(tmp_path, ancien)
    meta = lire(b / "meta.json")
    meta["dataset_id"], meta["service_date"] = "z", "2026-11-24"
    ecrire(b / "meta.json", meta)
    ecrire_bin(b, "78358", {**TRANSIT["78358"], "75108": (61, 61)}, CAR["78358"])
    (b / "sources.json").unlink()
    assert 1 <= len(tan.resume(rapport(ancien, b))) <= 10


def test_tri_absent_puis_ancien_a_zero_puis_pourcentage_puis_texte() -> None:
    lignes = [tan.Ligne("c", "t", "t", "", "a", "b"), tan.Ligne("c", "petit", "p", "", 100, 101), tan.Ligne("c", "grand", "g", "", 100, 200),
              tan.Ligne("c", "zero", "z", "", 0, 5), tan.Ligne("c", "abs", "a", "", tan.ABSENT, 5), tan.Ligne("c", "egal", "e", "", 3, 3),
              tan.Ligne("c", "nul", "n", "", 7, None)]
    tries = [x.cle for x in tan.ecarts_tries(lignes)]
    assert tries[:2] == ["abs", "nul"] and tries[2:] == ["zero", "grand", "petit", "t"]
    assert all(x.cle != "egal" for x in tan.ecarts_tries(lignes))


def test_valeurs_absentes_et_non_calculables_ne_sont_jamais_zero() -> None:
    assert tan.fr_valeur(tan.ABSENT) == "absent" and tan.fr_valeur(None) == "non calculable"
    x = tan.Ligne("c", "k", "l", "", None, 4)
    assert x.absent_un_cote and x.ecart is None and x.pct is None and tan.fr_ecart(x) == "n/c"
    assert tan.Ligne("c", "k", "l", "", None, None).identique


def test_regles_orales_memes_que_le_front() -> None:
    # valeurs publiées par la visite le 08/11 (tour.resolved.json) et règles de oral.ts
    assert tan.oral_postes(2580329) == "près de 2,6 millions de postes"
    assert tan.oral_postes(4216000) == "plus de 4,2 millions de postes"
    assert tan.oral_postes(87512) == "près de 88 000 postes" and tan.oral_postes(87400) == "plus de 87 000 postes"
    assert tan.oral_postes(1000000) == "1 million de postes"
    assert tan.oral_etoiles(1) == "une étoile" and tan.oral_etoiles(0) == "aucune étoile" and tan.oral_etoiles(29) == "29 étoiles"
    assert tan.oral_personnes(554) == "plus de 550" and tan.oral_personnes(556) == "près de 560" and tan.oral_personnes(163, True) == "environ 160"
    assert tan.oral_projets(47307, 1) == "au moins 47 000" and tan.oral_projets(47307, 0) == "plus de 47 000"
    assert tan.oral_euros(42520) == "42 500 euros" and tan.oral_heure(485) == "8 heures 5" and tan.oral_heure(60) == "1 heure"


def test_controle_visite_detecte_un_nombre_non_suivi_et_un_chiffre_introuvable(ancien: Path) -> None:
    jeu = tan.Jeu.charger(ancien)
    chiffres = tan.chiffres_visite(jeu)
    par_etape: dict[str, list[str]] = {}
    for c in chiffres:
        if c.oral:
            par_etape.setdefault(c.etape, []).append(c.oral.replace(" ", " "))
    textes = [{"id": e, "text": " ".join(v)} for e, v in par_etape.items()]
    assert tan.controle_visite(chiffres, {"steps": textes}) == []
    textes[0]["text"] += " Et 999 autres."
    assert any("999" in p for p in tan.controle_visite(chiffres, {"steps": textes}))
    assert tan.controle_visite(chiffres, tan.ABSENT) == ["texte résolu de la visite introuvable : contrôle non fait"]
    bad = [{"id": e, "text": "rien"} for e in par_etape]
    assert any("introuvable" in p for p in tan.controle_visite(chiffres, {"steps": bad}))


def test_mode_absent_de_la_couverture_est_publie_partout() -> None:
    communes = ["75101", "75102", "75103"]
    assert tan._couverture({"mode_coverage": {"velib": ["75101"]}}, "bike_transit", communes) == 3
    assert tan._couverture({"mode_coverage": {"velib": ["75101"]}}, "velib", communes) == 1
    assert tan._couverture({}, "bike_transit", communes) is tan.ABSENT
