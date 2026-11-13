"""Règles officielles du comptage des tickets à l'unité (D-028, corrigé le 04/11/2026 après le recoupement 07k).

Chaque règle porte la phrase IDFM recopiée qui la fonde (`Quote`, retrouvée dans le fichier gardé par
`check_rule_quotes`, contrôle P0 de 07). Un cas sans règle écrite donne `null` et une raison, jamais un prix deviné.

Sources (manifeste TKT01, pages HTML téléchargées le 04/11/2026) :
- CGVU des tickets Bus-Tram et Métro-Train-RER (« Date de validité : à partir de juin 2026 ») ;
- page « Règles de correspondances et correspondances par la voie publique » (« Updated on 2026 February 20 »), en
  version anglaise : la version française (`/correspondance-voie-publique`) répond HTTP 403 au robot. Le texte anglais
  est une traduction automatique des noms (« Bleach » pour Javel, « Cardinet Bridge » pour Pont Cardinet) : chaque
  station est rattachée à sa station parente du GTFS IDFM à la main, par son nom et ses lignes, et le contrôle
  `check_station_names` vérifie le nom GTFS de chaque identifiant.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from pathlib import Path

from starway.subscriptions import Quote, quote_found

BT = "TKT01/cgvu-tickets-bus-tram.html"
MTR = "TKT01/cgvu-tickets-metro-train-rer.html"
VP = "TKT01/correspondance-voie-publique-en.html"


def q(file: str, text: str) -> Quote:
    return Quote("TKT01", file, text)


# --- Ticket Bus-Tram -------------------------------------------------------------------------------------------
BT_LINES = q(BT, "Le ticket Bus-Tram permet de voyager sur : Les lignes de bus faisant l’objet d’une convention avec "
                 "Île-de-France Mobilités et pour lesquelles la tarification francilienne est applicable.")
BT_NOT_RAIL = q(BT, "2.2 Le ticket Bus-Tram ne permet pas de voyager sur : Les lignes de métro en Île-de-France Les "
                    "lignes de RER et train en Île-de-France")
BT_JOURNEY = q(BT, "Le Ticket Bus-Tram permet un voyage d’une durée de 1h30 à partir de la validation d’entrée et sans "
                   "effectuer de sortie. Les correspondances entre les modes de transport autorisés, cité précédemment, "
                   "sont autorisées dans la limite de 1h30 à compter de la première validation d’entrée.")
# Règle tirée : un trajet en métro, RER ou train (mode non autorisé pour ce ticket) interrompt le voyage Bus-Tram ;
# le bus ou le tram suivant demande un nouveau ticket Bus-Tram (le calculateur d'IDFM compte de même, 07k).

# --- Ticket Métro-Train-RER : correspondances par la voie publique ----------------------------------------------
MTR_STREET = q(MTR, "Les correspondances entre le métro, le RER et le Train par la voie publique, via les cheminements "
                    "signalés sont autorisées : cf liste de Correspondance par la Voie Publique")
VP_DATE = q(VP, "Published on 2024 October 30 - Updated on 2026 February 20")
VP_INTRO = q(VP, "The public connections listed below allow you to go through the public road without being charged a "
                 "second ticket:")

# Une ligne de la liste officielle = un ensemble de stations entre lesquelles la correspondance par la voie publique
# est autorisée (lecture de la liste : chaque ligne nomme un pôle de correspondance). Stations parentes du GTFS IDFM
# (stops.txt, location_type = 1) ; une ligne dont toutes les stations sont une seule station parente du GTFS ne change
# rien (la correspondance s'y fait déjà dans la même station).
STREET_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Porte de Clichy (L13, L14) / Porte de Clichy (C)", ("IDFM:71545",)),
    ("St Michel (L4) / St Michel Notre Dame (B, C)", ("IDFM:73620",)),
    ("Austerlitz (L5, L10) / Austerlitz (C)", ("IDFM:71135",)),
    ("Porte Dauphine (L2) / Avenue Foch (C)", ("IDFM:474152", "IDFM:71321")),
    ("Alma Marceau (L9) / Pont de l'Alma (C)", ("IDFM:71290", "IDFM:492980")),
    ("Solférino (L12) / Musée d'Orsay (C)", ("IDFM:71270", "IDFM:71269")),
    ("Bleach (M10) / Bleach (C)", ("IDFM:71150",)),
    ("Neuilly Porte Maillot (C) - Neuilly Porte Maillot (E) - Porte Maillot (L1)", ("IDFM:71379",)),
    ("Gare du Nord (L4, L5, B, D, H, K) - Magenta (E) - Poissonnière (L7)",
     ("IDFM:71410", "IDFM:478733", "IDFM:71363")),
    ("Châtelet / Les Halles (A, B, D) / Les Halles (L 4)", ("IDFM:474151", "IDFM:73794")),
    ("Haussmann Saint Lazare (E) - Gare Saint Lazare (J, L) - Saint-Lazare (L3, L12, L13, L14) - Saint Augustin (L9)",
     ("IDFM:73688", "IDFM:71370", "IDFM:73690")),
    ("Haussmann Saint Lazare (E) - Gare Saint Lazare (J, L) - Saint-Lazare (L3, L12, L13, L14) - Havre Caumartin "
     "(L3, L9)", ("IDFM:73688", "IDFM:71370", "IDFM:482368")),
    ("Haussmann Saint Lazare (E) - Gare Saint Lazare (J, L) - Saint-Lazare (L3, L12, L13, L14) - Auber (A)",
     ("IDFM:73688", "IDFM:71370", "IDFM:478926")),
    ("Cardinet Bridge (L 14) - Cardinet Bridge (L)", ("IDFM:71475",)),
    ("Paris Montparnasse (N) - Montparnasse welcome (L4, L6, L12, L13)", ("IDFM:71139",)),
    ("Paris Gare de l'Est (P) - Gare de l'Est (L4, L5, L7) - Château Landon (L7)", ("IDFM:71359", "IDFM:474149")),
    ("Paris Gare de l'Est (P) - Gare de l'Est (L4, L5, L7) - Gare du Nord (L4, L5, B, D, H, K) - Magenta (E)",
     ("IDFM:71359", "IDFM:71410", "IDFM:478733")),
    ("Massy Palaiseau (B) - Massy Palaiseau (C) - Massy Palaiseau (L18)", ("IDFM:63244",)),
    ("La Défense (L, U) - La Défense (A, L1)", ("IDFM:71517",)),
    ("Gare de Lyon (L1, L14, A, D) - Paris Gare de Lyon (R)", ("IDFM:73626",)),
    ("Rungis Bridge (L14) - Rungis Bridge (C)", ("IDFM:69677",)),
    ("Saint-Denis Pleyel (L14) - Saint Denis Stade de France (D)", ("IDFM:490784", "IDFM:72206")),
    ("Rosny Bois Perrier (L11) - Rosny Bois Perrier (E)", ("IDFM:426280",)),
    ("Nanterre-Préfecture (A) - Nanterre La Folie (E)", ("IDFM:70945", "IDFM:488087")),
)
# nom GTFS attendu de chaque station parente (contrôle du rattachement fait à la main)
STATION_NAMES = {
    "IDFM:71545": "Porte de Clichy", "IDFM:73620": "Saint-Michel Notre-Dame", "IDFM:71135": "Gare d'Austerlitz",
    "IDFM:474152": "Porte Dauphine", "IDFM:71321": "Avenue Foch", "IDFM:71290": "Alma - Marceau",
    "IDFM:492980": "Pont de l'Alma", "IDFM:71270": "Solférino", "IDFM:71269": "Musée d'Orsay",
    "IDFM:71150": "Javel", "IDFM:71379": "Neuilly - Porte Maillot", "IDFM:71410": "Gare du Nord",
    "IDFM:478733": "Magenta", "IDFM:71363": "Poissonnière", "IDFM:474151": "Châtelet - Les Halles",
    "IDFM:73794": "Les Halles", "IDFM:73688": "Haussmann Saint-Lazare", "IDFM:71370": "Gare Saint-Lazare",
    "IDFM:73690": "Saint-Augustin", "IDFM:482368": "Havre - Caumartin", "IDFM:478926": "Auber",
    "IDFM:71475": "Pont Cardinet", "IDFM:71139": "Gare Montparnasse", "IDFM:71359": "Gare de l'Est",
    "IDFM:474149": "Château Landon", "IDFM:63244": "Massy - Palaiseau", "IDFM:71517": "La Défense",
    "IDFM:73626": "Gare de Lyon", "IDFM:69677": "Thiais - Orly (Pont de Rungis)", "IDFM:490784": "Saint-Denis - Pleyel",
    "IDFM:72206": "Stade de France Saint-Denis", "IDFM:426280": "Rosny Bois Perrier",
    "IDFM:70945": "Nanterre - Préfecture", "IDFM:488087": "Nanterre-La-Folie",
}


def street_pairs() -> frozenset[tuple[str, str]]:
    """Couples ordonnés (station parente d'arrivée, station parente de départ) autorisés par la voie publique."""
    out: set[tuple[str, str]] = set()
    for _, ids in STREET_GROUPS:
        out |= {(a, b) for a in ids for b in ids if a != b}
    return frozenset(out)


# --- Cas sans règle écrite : prix non calculé --------------------------------------------------------------------
# Exploitant du GTFS (agency_name) dont aucune page IDFM relevée ne dit qu'il applique la tarification francilienne.
UNKNOWN_FARE_AGENCIES = {
    "Magical Shuttle": "navette Magical Shuttle : le ticket Bus-Tram ne vaut que sur les bus « pour lesquelles la "
                       "tarification francilienne est applicable » (CGVU, art. 2.1) et aucune page IDFM relevée ne le "
                       "dit pour cette navette (le calculateur d'IDFM lui applique un autre prix) : prix non calculé",
}
UNKNOWN_FARE_AGENCIES_QUOTES = (BT_LINES,)
# Bus de remplacement d'une ligne ferrée : route_type 3 (bus), route_long_name « Remplacement RER A » (GTFS IDFM).
SUBSTITUTION_PREFIX = "Remplacement "
SUBSTITUTION_REASON = ("bus de remplacement de la ligne {line} : aucune page IDFM relevée ne dit quel ticket y est "
                       "valable : prix non calculé")


def is_substitution_bus(leg: Mapping[str, object]) -> bool:
    return leg.get("kind") == "bus" and str(leg.get("line_long") or "").startswith(SUBSTITUTION_PREFIX)


def all_rule_quotes() -> list[Quote]:
    return [BT_LINES, BT_NOT_RAIL, BT_JOURNEY, MTR_STREET, VP_DATE, VP_INTRO] + [q(VP, line) for line, _ in STREET_GROUPS]


def check_rule_quotes(raw_dir: Path, sha256_of: Callable[[Path], str]) -> list[str]:
    bad = []
    for qt in all_rule_quotes():
        ok, detail = quote_found(qt, raw_dir, sha256_of)
        if not ok:
            bad.append(f"{detail} : « {qt.text[:70]} »")
    return bad


def check_station_names(stop_name: Callable[[str], str | None]) -> list[str]:
    """Écarts entre le nom GTFS des stations parentes rattachées et le nom attendu (liste vide = conforme)."""
    ids = {i for _, g in STREET_GROUPS for i in g}
    bad = [f"{i} : nom attendu manquant" for i in sorted(ids - set(STATION_NAMES))]
    bad += [f"{i} : GTFS « {stop_name(i)} », attendu « {n} »" for i, n in STATION_NAMES.items() if stop_name(i) != n]
    return bad
