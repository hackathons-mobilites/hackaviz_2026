"""Bascule préparée, pas activée : lignes du manifeste qui passeraient à « licence non précisée par le producteur ».

Décision de Nicolas (09/11/2026) : sans réponse le mercredi 11/11 à 18h, les sources en attente passent à ce texte. La
commande est `python scripts/06x_licences_non_precisees.py --appliquer` ; sans ce drapeau, rien n'est écrit.

Une ligne n'est changée que si son texte contient exactement ce qui est attendu : une ligne déjà mise à jour (réponse
reçue entre-temps) est laissée telle quelle et signalée. Ce module ne dit rien de la portée juridique : il décrit ce
qui est écrit par le producteur, ou le fait qu'on n'a rien pu lire.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Collection
from dataclasses import dataclass

from starway.registry import NO_LICENCE_STATED

GROUPE_PEAGES = "peages"
GROUPE_FRANCE_TRAVAIL = "france-travail"
GROUPES = (GROUPE_PEAGES, GROUPE_FRANCE_TRAVAIL)


@dataclass(frozen=True)
class Bascule:
    source_id: str
    groupe: str
    remplacements: tuple[tuple[str, str], ...]  # (texte attendu dans la colonne licence, texte qui le remplace)


_SANEF_NON_LU = "mentions légales de Sanef non lues"

# Réponse reçue : accord de l'organisateur du hackathon du 09/11/2026 (D-060), écrit dans le manifeste le 10/11/2026 pour
# les péages (TOLL03 grilles Sanef, TOLL04, TOLL06 PDF APRR) et, par lecture de Nicolas, pour France Travail (GEO04,
# GEO04B, PDF EMP03) et EDF (COST06). Leurs lignes ne contiennent plus le texte attendu : la bascule les laisse telles
# quelles et le signale (« texte déjà différent »). Les entrées restent pour l'historique.
BASCULES: tuple[Bascule, ...] = (
    Bascule("TOLL03", GROUPE_PEAGES, ((
        f"non vérifiée : {_SANEF_NON_LU} (site protégé, HTTP 403 le 05/11/2026) ; document public de l'exploitant cité "
        "comme source d'un tarif ; licence à confirmer",
        f"{NO_LICENCE_STATED} ({_SANEF_NON_LU} : site protégé, HTTP 403 le 05/11/2026) ; document public de l'exploitant "
        "cité comme source d'un tarif",
    ),)),
    Bascule("TOLL03", GROUPE_PEAGES, ((
        f"non vérifiée : {_SANEF_NON_LU} (site protégé, HTTP 403 le 05/11/2026) ; licence à confirmer",
        f"{NO_LICENCE_STATED} ({_SANEF_NON_LU} : site protégé, HTTP 403 le 05/11/2026)",
    ),)),
    # VINCI : le producteur écrit quelque chose sur son site, la suite du texte le cite pour ne pas laisser croire le contraire.
    Bascule("TOLL04", GROUPE_PEAGES, ((
        "documents publics VINCI Autoroutes cités comme source d'un tarif (aucune licence affichée) ; licence à "
        "confirmer",
        f"{NO_LICENCE_STATED} pour ces documents, qui n'en affichent pas ; documents publics VINCI Autoroutes cités comme "
        "source d'un tarif ; mentions légales du site (article 6, consultées le 05/11/2026) : « aucune licence, ni aucun "
        "autre droit, sauf celui de consulter les informations, n'est conféré à quiconque »",
    ),)),
    Bascule("TOLL06", GROUPE_PEAGES, ((
        "document public APRR cité comme source d'un tarif (aucune licence affichée) ; licence à confirmer",
        f"{NO_LICENCE_STATED} pour ce document, qui n'en affiche pas ; document public APRR cité comme source d'un tarif",
    ),)),
    # France Travail : pages relues le 09/11/2026, rien d'écrit ; groupe à demander explicitement (--groupes).
    Bascule("EMP03", GROUPE_FRANCE_TRAVAIL, (
        ("non écrite dans la publication", f"{NO_LICENCE_STATED} : non écrite dans la publication"),
        (" ; licence non confirmée par France Travail", ""),  # texte public reformulé par 06y le 10/11
    )),
    Bascule("GEO04", GROUPE_FRANCE_TRAVAIL, (
        ("non écrite par France Travail : ni sur", f"{NO_LICENCE_STATED} : ni sur"),
        (". Licence non confirmée par France Travail", "."),
    )),
    Bascule("GEO04B", GROUPE_FRANCE_TRAVAIL, (
        ("licence non écrite, règle", f"{NO_LICENCE_STATED}, règle"),
        (", licence non confirmée par France Travail", ""),
    )),
)

# Pas dans la bascule : leur texte ne serait pas exact avec cette formule, ou la décision revient à un humain.
HORS_BASCULE: dict[str, str] = {
    "VEL01": "Vélib' : licence ODbL 1.0 écrite sur data.gouv.fr, en attente de réponse humaine, formule inexacte",
    "SUB04": "Vélib' et AGEMOB : en attente de réponse humaine ; les mentions de l'AGEMOB posent des conditions écrites",
    "CYC01": "OSM : licence ODbL 1.0 écrite, en attente de réponse humaine, formule inexacte",
    "COST06": "EDF : accord de l'organisateur du hackathon du 09/11/2026 (D-060), ligne du manifeste mise à jour le 10/11",
    "CO2-01": "ADEME : deux textes différents (documentation Datagir, mentions légales d'impactco2.fr), à trancher",
    "VEH01": "ADEME : mentions légales de la Librairie, réutilisation non commerciale et pédagogique, à trancher",
}


@dataclass(frozen=True)
class Changement:
    source_id: str
    groupe: str
    fichier_local: str
    ancien: str
    nouveau: str


def _champ_csv(valeur: str) -> str:
    tampon = io.StringIO()
    csv.writer(tampon, lineterminator="").writerow([valeur])
    return tampon.getvalue()


def _champ_csv_guillemets(valeur: str) -> str:
    return '"' + valeur.replace('"', '""') + '"'


def _nouvelle_licence(bascule: Bascule, licence: str) -> str | None:
    """Texte après remplacement, ou None si un des textes attendus manque (ligne déjà mise à jour)."""
    texte = licence
    for attendu, remplacement in bascule.remplacements:
        if attendu not in texte:
            return None
        texte = texte.replace(attendu, remplacement, 1)
    return texte


def basculer(contenu: str, groupes: Collection[str]) -> tuple[str, list[Changement], list[Bascule]]:
    """Applique la bascule au texte du manifeste. Renvoie (nouveau texte, changements, entrées sans ligne à changer)."""
    fin = "\r\n" if "\r\n" in contenu else "\n"
    lignes = contenu.split(fin)
    entete = next(csv.reader([lignes[0]]))
    i_id, i_licence, i_fichier = (entete.index(c) for c in ("source_id", "licence", "fichier_local"))
    choisies = [b for b in BASCULES if b.groupe in groupes]
    changements: list[Changement] = []
    utilisees: set[int] = set()
    for n, ligne in enumerate(lignes[1:], start=1):
        if not ligne:
            continue
        champs = next(csv.reader([ligne]))
        for k, bascule in enumerate(choisies):
            if champs[i_id] != bascule.source_id:
                continue
            nouveau = _nouvelle_licence(bascule, champs[i_licence])
            if nouveau is None:
                continue
            formes = (_champ_csv, _champ_csv_guillemets)  # le manifeste contient les deux écritures d'un même champ
            forme = next((f for f in formes if ligne.count(f",{f(champs[i_licence])},") == 1), None)
            if forme is None:
                raise ValueError(f"ligne {n + 1} ({bascule.source_id}) : licence introuvable telle quelle dans la ligne")
            lignes[n] = ligne.replace(f",{forme(champs[i_licence])},", f",{forme(nouveau)},", 1)
            changements.append(Changement(bascule.source_id, bascule.groupe, champs[i_fichier], champs[i_licence], nouveau))
            utilisees.add(k)
            break
    non_trouvees = [b for k, b in enumerate(choisies) if k not in utilisees]
    return fin.join(lignes), changements, non_trouvees
