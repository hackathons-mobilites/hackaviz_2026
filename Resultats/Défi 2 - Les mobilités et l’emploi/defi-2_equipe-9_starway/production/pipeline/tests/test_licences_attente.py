"""Bascule préparée vers « licence non précisée par le producteur » (starway/licences_attente.py, script 06x)."""

from __future__ import annotations

import csv
import io

from starway import licences_attente as la
from starway import registry as reg

ENTETE = ["source_id", "titre", "licence", "fichier_local"]
TOLL04 = ("documents publics VINCI Autoroutes cités comme source d'un tarif (aucune licence affichée) ; licence à "
          "confirmer")
GEO04 = ("non écrite par France Travail : ni sur la page ; choix de l'équipe ; Licence Ouverte 1.0. Licence non "
         "confirmée par France Travail")


def manifeste(lignes: list[list[str]], fin: str = "\r\n") -> str:
    tampon = io.StringIO()
    w = csv.writer(tampon, lineterminator=fin)
    w.writerow(ENTETE)
    w.writerows(lignes)
    return tampon.getvalue().rstrip("\r\n")


def licences(contenu: str) -> dict[str, str]:
    return {r["fichier_local"]: r["licence"] for r in csv.DictReader(io.StringIO(contenu, newline=""))}


def test_peages_seuls_par_defaut_et_reste_intact() -> None:
    avant = manifeste([["TOLL04", "a, b", TOLL04, "a.pdf"], ["TOLL04", "c", TOLL04, "c.txt"],
                       ["GEO04", "d", GEO04, "d.xlsx"], ["EMP01", "e", "Licence Ouverte", "e.csv"]])
    apres, changements, _ = la.basculer(avant, [la.GROUPE_PEAGES])
    lu = licences(apres)
    assert len(changements) == 2
    assert lu["a.pdf"].startswith(reg.NO_LICENCE_STATED) and lu["c.txt"] == lu["a.pdf"]
    assert lu["d.xlsx"] == GEO04 and lu["e.csv"] == "Licence Ouverte"
    assert apres.count("\r\n") == avant.count("\r\n")


def test_ligne_deja_mise_a_jour_gardee_et_signalee() -> None:
    avant = manifeste([["TOLL04", "a", "accord écrit de VINCI Autoroutes du 11/11/2026", "a.pdf"]])
    apres, changements, non_trouvees = la.basculer(avant, [la.GROUPE_PEAGES])
    assert apres == avant and not changements
    assert "TOLL04" in {b.source_id for b in non_trouvees}


def test_champ_entre_guillemets_sans_virgule() -> None:
    avant = "\r\n".join([",".join(ENTETE), f'TOLL04,a,"{TOLL04}",a.pdf'])
    apres, changements, _ = la.basculer(avant, [la.GROUPE_PEAGES])
    assert len(changements) == 1 and licences(apres)["a.pdf"].startswith(reg.NO_LICENCE_STATED)


def test_idempotent() -> None:
    avant = manifeste([["TOLL04", "a", TOLL04, "a.pdf"], ["GEO04", "d", GEO04, "d.xlsx"]])
    une_fois, _, _ = la.basculer(avant, la.GROUPES)
    deux_fois, changements, _ = la.basculer(une_fois, la.GROUPES)
    assert deux_fois == une_fois and not changements


def test_france_travail_garde_le_reste_du_texte() -> None:
    avant = manifeste([["GEO04", "d", GEO04, "d.xlsx"]])
    apres, changements, _ = la.basculer(avant, [la.GROUPE_FRANCE_TRAVAIL])
    assert len(changements) == 1
    nouveau = licences(apres)["d.xlsx"]
    assert "choix de l'équipe" in nouveau and "non confirmée" not in nouveau
    assert not reg.licence_to_confirm(nouveau) and reg.licence_kinds(nouveau) == ["cited"]


def test_textes_sans_tiret_long() -> None:
    tirets = {chr(0x2014), chr(0x2013)}
    for b in la.BASCULES:
        for attendu, remplacement in b.remplacements:
            assert not tirets & set(attendu + remplacement)
    for raison in la.HORS_BASCULE.values():
        assert not tirets & set(raison)
