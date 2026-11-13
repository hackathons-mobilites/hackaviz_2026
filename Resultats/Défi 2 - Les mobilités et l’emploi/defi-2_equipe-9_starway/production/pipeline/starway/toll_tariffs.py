"""Péages des trajets voiture et moto : inventaire des points de péage et tarifs officiels (classes 1 et 5).

Demande de Nicolas (03/11/2026, soir) : ajouter les péages au coût d'un trajet voiture, « le plus affiné possible »,
avec les tarifs modulés selon l'heure et le jour ; remises temporaires liées à des travaux ignorées (documentées) ;
classe 5 (motos) relevée partout où elle est publiée (complément du 03/11).

Ce module ne fait aucun calcul de chemin. Il :
- décrit les points de péage (registre `POINTS`, chaque point cite ses sources) et les rattache aux nœuds OSM extraits
  par 04i (`data/processed/osm_toll_points.json`, mêmes identifiants que ceux enregistrés par 04g) ;
- lit les grilles officielles téléchargées dans data/raw/TOLL01 à TOLL05 (aucune valeur saisie à la main) ;
- applique la règle de prix d'un passage (type de jour, tranche horaire, couple entrée-sortie), testée dans
  tests/test_toll_tariffs.py.

Sources (manifeste data/sources_manifest.csv) :
- TOLL01 : data.gouv.fr « Autoroutes et péages en flux libre » (portiques, 03/11/2026, Licence Ouverte 2.0) ;
- TOLL02 : APRR, grille « Réseau APRR - Classes 1 à 5, en vigueur au 1er février 2026 » (PDF officiel) et sa copie
  CSV data.gouv.fr « Tarifs autoroutes APRR » (Licence Ouverte 2.0), recoupées couple par couple ;
- TOLL03 : arrêté du 28 janvier 2026 relatif aux péages applicables sur les réseaux concédés à SANEF et SAPN
  (NOR TRAT2600882A, JORF du 30/01/2026, annexe A14), lu dans le flux ouvert JORF de la DILA ;
- TOLL04 : VINCI Autoroutes, fichiers « Tarifs A86 » et « Tarifs Cofiroute / Arcour » (.txt), guides tarifaires
  Duplex A86 2026 et Cofiroute 2026, communiqué Duplex A86 du 31/12/2025, page Ulys A86 ;
- TOLL05 : data.gouv.fr « Gares de péage du réseau routier national concédé » (Ministère, 2025, ODC-BY).
"""

from __future__ import annotations

import html
import itertools
import math
import os
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timedelta
from pathlib import Path

import pandas as pd

CLASSES = (1, 5)  # classe 1 : véhicules légers (voiture) ; classe 5 : motos, side-cars, trikes
BANNED_DASHES = {chr(0x2014): "-", chr(0x2013): "-"}  # CLAUDE.md règle 8 : remplacés dans les citations

TARIFF_COLUMNS = [
    "point_id", "systeme", "sens", "entree_point_id", "sortie_point_id", "entree_grille", "sortie_grille",
    "classe", "tarif", "libelle_source", "type_jour", "heure_debut", "heure_fin", "prix_ttc_eur", "statut",
    "raison", "date_effet", "source_id", "fichier_source", "citation",
]
POINT_COLUMNS = [
    "point_id", "systeme", "ouvrage", "autoroute", "exploitant", "type", "tarification", "sens", "cap_deg",
    "lon", "lat", "insee", "dans_idf", "osm_node_ids", "osm_way_ids", "nom_grille", "gares_ministere",
    "portiques_flux_libre", "paiement", "statut_tarif", "note", "sources",
]

STATUT_OK = "ok"
STATUT_NON_TROUVE = "non_trouve"
STATUT_INTERDIT = "interdit"
STATUT_HORS_PERIMETRE = "hors_perimetre"
STATUT_RETIRE = "retire_reutilisation"

# Interrupteur de retrait des péages VINCI Autoroutes (05/11/2026), DÉSACTIVÉ PAR DÉFAUT. Aucune décision de retrait
# n'est prise : les mentions légales de VINCI Autoroutes ne donnent que le droit de consulter (docs/limites.md, section
# Péages). Si Nicolas décide le retrait : lancer 04j, 06 (ou 06k) et 07 avec STARWAY_RETIRER_VINCI=1 ; chaque point des
# systèmes ci-dessous passe alors en statut « retire_reutilisation », prix `null`, raison « réutilisation non
# autorisée », et plus aucune grille de ces systèmes n'est publiée. Le site doit alors le dire (texte à écrire par
# Nicolas, hors du pipeline). L'A14 est un péage SAPN (arrêté du 28/01/2026) : elle n'est pas touchée.
RETRAIT_ENV = "STARWAY_RETIRER_VINCI"
RETRAIT_RAISON = "réutilisation non autorisée"
VINCI_SYSTEMES = ("DUPLEX_A86", "COFIROUTE", "COFIROUTE_DOURDAN")

WEEKDAYS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")


def clean(text: str) -> str:
    """Citation recopiée : espaces normalisés, tirets cadratin et demi-cadratin remplacés par « - » (règle 8)."""
    for k, v in BANNED_DASHES.items():
        text = text.replace(k, v)
    return re.sub(r"\s+", " ", text).strip()


@dataclass(frozen=True)
class TollPoint:
    point_id: str
    systeme: str  # système tarifaire : les couples entrée-sortie ne se forment qu'à l'intérieur d'un système
    ouvrage: str
    autoroute: str
    exploitant: str
    type: str  # barriere_pleine_voie | gare_echangeur | portique_flux_libre | gare_tunnel
    tarification: str  # prix_fixe | couple_entree_sortie | couple_entree_sortie_horaire
    paiement: str  # dans quel sens on paie, d'après la source citée
    nom_grille: str | None  # libellé exact dans la grille tarifaire (None : pas de grille lue)
    osm_nodes: tuple[int, ...]
    gares_ministere: tuple[str, ...] = ()  # nomGare dans TOLL05
    portiques_flux_libre: tuple[str, ...] = ()  # Nom dans TOLL01
    statut_tarif: str = STATUT_OK
    note: str = ""
    sources: tuple[str, ...] = ("CYC01",)


# --- Registre des points --------------------------------------------------------------------------------------
# Nœuds OSM : étiquettes barrier=toll_booth / highway=toll_gantry de l'extrait CYC01 (04i), choisis par leur nom,
# leur `highway:ref` et leur `operator` ; nœuds sans nom rattachés par le chemin OSM qui les porte (note du point).
SANEF_BLOCKED = ("grille Sanef / SAPN 2026 non téléchargeable automatiquement (site autoroutes.sanef.com protégé, "
                 "HTTP 403 le 03/11/2026) et absente de l'arrêté du 28/01/2026 (qui ne publie que l'A14) : "
                 "à déposer à la main dans data/raw/TOLL03/")
# Libellés de la grille Sanef du 01/02/2026 (TOLL03, déposée le 05/11/2026) pour l'A4
SANEF_A4_LABEL = {"SANEF_A4_COUTEVROULT": "PARIS / NOISY-LE-GRAND (péage de Coutevroult)",
                  "SANEF_A4_ST_JEAN": "ST-JEAN-LES-DEUX-JUMEAUX N°18", "SANEF_A4_MONTREUIL": "MONTREUIL-AUX-LIONS N°19"}
# Raisons des cases qui restent vides APRÈS lecture des grilles déposées le 05/11/2026 (jamais 0 €, jamais une estimation)
SAPN_A13_NOTE = ("Grille SAPN du 01/02/2026 lue (déposée le 05/11/2026) : elle ne nomme ni Buchelay ni Rosny-sur-Seine "
                 "et ne parle pas de flux libre ; elle regroupe « POISSY / ORGEVAL N°7 à MANTES-SUD N°12 » en une seule "
                 "station de système fermé, dont les cases ne donnent pas le prix d'un portique. Aucun prix retenu.")
SANEF_A1_NOTE = ("Grille Sanef du 01/02/2026 lue (déposée le 05/11/2026) : « SURVILLIERS / SAINT-WITZ N°7 » n'a qu'une "
                 "case isolée (1,0 € en classe 1, 0,5 € en classe 5). Lue sur le rendu de la page, cette case est dans "
                 "la même colonne que la case Chamant vers Senlis, donc le couple Saint-Witz / Senlis ; Senlis et "
                 "Chamant n'ont pas de nœud de péage au registre, et un trajet qui ne traverse que cette bretelle a "
                 "une autre extrémité inconnue : aucun couple du registre. La modulation horaire de l'A1 "
                 "(grille-modulee-01022026.pdf, classe 1, d'Arsy à Chamant) ne mentionne pas Saint-Witz et ne définit "
                 "pas les périodes normal, vert et rouge. Aucun prix retenu.")

def withdrawal_enabled(environ: Mapping[str, str] | None = None) -> bool:
    """Vrai si l'interrupteur de retrait des péages VINCI est activé (variable STARWAY_RETIRER_VINCI = 1, oui, true)."""
    env = os.environ if environ is None else environ
    return str(env.get(RETRAIT_ENV, "")).strip().lower() in ("1", "oui", "true", "yes")


def withdraw_vinci_points(points: Sequence[TollPoint]) -> tuple[TollPoint, ...]:
    """Points du registre avec les péages VINCI retirés : statut « retire_reutilisation », raison dans la note."""
    return tuple(replace(p, statut_tarif=STATUT_RETIRE,
                         note=f"{RETRAIT_RAISON} (mentions légales de VINCI Autoroutes, article 6)")
                 if p.systeme in VINCI_SYSTEMES else p for p in points)


POINTS: tuple[TollPoint, ...] = (
    # A14 (SAPN) : flux libre, tarifs fixés par l'annexe de l'arrêté du 28/01/2026 (TOLL03)
    TollPoint("SAPN_A14_MONTESSON", "SAPN_A14", "A14 - gare de Montesson", "A14", "SAPN", "portique_flux_libre",
              "prix_fixe", "dans les deux sens (TOLL01 : sens « 1+2 »)", "Gare de Montesson",
              (12120628914, 12120628915), ("Montesson BPV Sens 1", "Montesson BPV Sens 2"), ("Montesson FL",),
              note=("Ancienne barrière désaffectée dans l'OSM (nœud 12174781051, disused:highway=toll_gantry), non "
                    "retenue. TOLL05 (2025) décrit encore une barrière pleine voie ; TOLL01 (03/11/2026) un "
                    "portique en flux libre. Remise de 50 % et gratuité en semaine annoncées pour la fermeture du "
                    "tunnel de Saint-Cloud (travaux) : ignorées (docs/limites.md)."),
              sources=("CYC01", "TOLL01", "TOLL03", "TOLL05")),
    TollPoint("SAPN_A14_CHAMBOURCY", "SAPN_A14", "A14 - bretelles de Chambourcy", "A14", "SAPN",
              "portique_flux_libre", "prix_fixe",
              "sur les bretelles : sortie en sens 1, entrée en sens 2 (TOLL01 « Bretelle de sortie » / « Bretelle »)",
              "Gare de Chambourcy", (1131546232, 1831379876), ("Chambourcy Entree", "Chambourcy Sortie"),
              ("Chambourcy",), note="Ancien portique désaffecté dans l'OSM (nœud 12636063020), non retenu.",
              sources=("CYC01", "TOLL01", "TOLL03", "TOLL05")),
    # A13 (SAPN) : flux libre ; la grille SAPN du 01/02/2026 (déposée le 05/11/2026) n'a aucune case pour ces portiques
    TollPoint("SAPN_A13_BUCHELAY", "SAPN_A13", "A13 - portique de Buchelay", "A13", "SAPN", "portique_flux_libre",
              "prix_fixe", "dans les deux sens (TOLL01 : sens « 1+2 »)", None, (12636038008, 12636038009),
              ("Buchelay BPV Sens 1", "Buchelay BPV Sens 2"), ("Buchelay FL",), statut_tarif=STATUT_NON_TROUVE,
              note=SAPN_A13_NOTE + (" Écart de position : TOLL01 place « Buchelay FL » à l'ancienne barrière (1,6812 E ; "
                                    "48,9837 N, nœuds OSM désaffectés 13519634392 et 13519634393), l'OSM du 01/11/2026 "
                                    "place les portiques actifs environ 3 km plus à l'ouest."),
              sources=("CYC01", "TOLL01", "TOLL03", "TOLL05")),
    TollPoint("SAPN_A13_ROSNY", "SAPN_A13", "A13 - portique de Rosny-sur-Seine", "A13", "SAPN",
              "portique_flux_libre", "prix_fixe", "non publié dans les sources lues", None, (12636038010, 12636038011),
              statut_tarif=STATUT_NON_TROUVE,
              note=SAPN_A13_NOTE + " Portique présent dans l'OSM, absent de TOLL01 et de TOLL05.",
              sources=("CYC01", "TOLL03")),
    # A4 (Sanef) : triangle « AUTOROUTES A4 - A26 SUD » de la grille Sanef du 01/02/2026 (TOLL03). La première colonne est
    # « PARIS / NOISY-LE-GRAND (péage de Coutevroult) » : la barrière est l'origine du système, pas un prix fixe.
    TollPoint("SANEF_A4_COUTEVROULT", "SANEF_A4", "A4 - barrière de Coutevroult", "A4", "Sanef",
              "barriere_pleine_voie", "couple_entree_sortie", "système fermé : la barrière est la première colonne du "
              "triangle de la grille (« PARIS / NOISY-LE-GRAND (péage de Coutevroult) »)",
              SANEF_A4_LABEL["SANEF_A4_COUTEVROULT"], (25196607, 264140281),
              ("Coutevroult BPV sens 1", "Coutevroult BPV sens 2"),
              note=("Seuls les couples avec Saint-Jean-les-Deux-Jumeaux et Montreuil-aux-Lions sont chiffrés : un trajet "
                    "qui ne traverse que la barrière (sortie à Meaux / Crécy ou ailleurs, sans nœud de péage dans "
                    "l'OSM) a un péage inconnu."),
              sources=("CYC01", "TOLL03", "TOLL05")),
    TollPoint("SANEF_A4_ST_JEAN", "SANEF_A4", "A4 - échangeur 18 Saint-Jean-les-Deux-Jumeaux", "A4", "Sanef",
              "gare_echangeur", "couple_entree_sortie", "gares d'entrée et de sortie (TOLL05)",
              SANEF_A4_LABEL["SANEF_A4_ST_JEAN"],
              (259083764, 4421111789, 4421111790, 12298881387, 12298881388, 12298881390),
              ("Saint Jean les Deux Jumeaux Sortie", "Saint Jean les Deux Jumeaux Entree"),
              note=("Nœuds 12298881387, 12298881388 et 12298881390 sans nom : retenus parce qu'ils sont sur des "
                    "bretelles SANEF de cet échangeur (chemins OSM 1329310533, 1329310534, 665154316), à vérifier. "
                    "Dans la grille, Saint-Jean et Montreuil partagent la même colonne vers l'est : aucun prix entre "
                    "les deux."),
              sources=("CYC01", "TOLL03", "TOLL05")),
    TollPoint("SANEF_A4_MONTREUIL", "SANEF_A4", "A4 - barrière et échangeur de Montreuil-aux-Lions", "A4", "Sanef",
              "barriere_pleine_voie", "couple_entree_sortie", "barrière pleine voie dans les deux sens (TOLL05)",
              SANEF_A4_LABEL["SANEF_A4_MONTREUIL"],
              (635884768, 635884770, 5702872138, 13719126553, 4390079353, 4390079354, 4390079355, 4390079356),
              ("Montreuil BPV sens 1", "Montreuil BPV Sens 2"),
              note=("À l'extrémité est de la Seine-et-Marne (barrière et bretelles de l'échangeur 19) : peu de trajets "
                    "entre deux communes d'IDF y passent. Relevé 04g du 04/11 : les 269 sens concernés traversent les "
                    "bretelles de l'échangeur (nœuds 4390079353 à 4390079356), jamais la barrière."),
              sources=("CYC01", "TOLL03", "TOLL05")),
    # A1 (Sanef)
    TollPoint("SANEF_A1_SAINT_WITZ", "SANEF_A1", "A1 - échangeur 7 Survilliers / Saint-Witz", "A1", "Sanef",
              "gare_echangeur", "couple_entree_sortie", "bretelles d'entrée et de sortie (TOLL05)", None,
              (344943470, 344945338), ("Saint Witz Entree", "Saint Witz Sortie"), statut_tarif=STATUT_NON_TROUVE,
              note=SANEF_A1_NOTE, sources=("CYC01", "TOLL03", "TOLL05")),
    # A10 / A11 (Cofiroute) : système fermé, grille « Tarifs Cofiroute / Arcour » (TOLL04)
    TollPoint("COFI_A10_ST_ARNOULT", "COFIROUTE", "A10 - barrière de Saint-Arnoult", "A10", "Cofiroute",
              "barriere_pleine_voie", "couple_entree_sortie",
              "système fermé : ticket (ou badge) à l'entrée, paiement à la sortie (guide Cofiroute 2026)",
              "PARIS (LA FOLIE BESSIN)", (26209736, 26210039, 4127019592, 4127019613, 8394699087),
              ("Saint-Arnoult Bpv",),
              note=("Libellé de grille « PARIS (LA FOLIE BESSIN) », échangeur « - » (barrière). Rattachement au nom : "
                    "lecture de la grille et de TOLL05, à confirmer."),
              sources=("CYC01", "TOLL04", "TOLL05")),
    TollPoint("COFI_A10_DOURDAN", "COFIROUTE_DOURDAN", "A10 - échangeur 10 Dourdan", "A10", "Cofiroute",
              "gare_echangeur", "prix_fixe",
              "la grille ne tarife que les trajets entre Dourdan et Paris (couples DOURDAN / PARIS (LA FOLIE BESSIN), "
              "échangeur 10, dans les deux sens)", "DOURDAN", (2814507717, 2814507720), ("Dourdan Nord", "Dourdan Sud"),
              sources=("CYC01", "TOLL04", "TOLL05")),
    TollPoint("COFI_A10_ALLAINVILLE", "COFIROUTE", "A10 - échangeur 11 Allainville", "A10", "Cofiroute",
              "gare_echangeur", "couple_entree_sortie", "système fermé (guide Cofiroute 2026)", "ALLAINVILLE",
              (292944726, 292944753, 5702872167), ("Allainville",), sources=("CYC01", "TOLL04", "TOLL05")),
    TollPoint("COFI_A11_ABLIS", "COFIROUTE", "A11 - échangeur 1 Ablis", "A11", "Cofiroute", "gare_echangeur",
              "couple_entree_sortie", "système fermé (guide Cofiroute 2026)", "ABLIS", (3321275857, 3321280179),
              ("Ablis",), sources=("CYC01", "TOLL04", "TOLL05")),
    # Duplex A86 (Cofiroute, VINCI Autoroutes) : prix par gare d'entrée, couple et demi-heure (TOLL04)
    TollPoint("DUPLEX_RUEIL", "DUPLEX_A86", "Duplex A86 - gare de Rueil", "A86", "Cofiroute (VINCI Autoroutes)",
              "gare_tunnel", "couple_entree_sortie_horaire",
              "prix fixé par la gare d'entrée, le couple, le jour et l'heure (guide Duplex A86 2026)", "Rueil",
              (137501371,), ("Rueil-Malmaison Bpv",), statut_tarif=STATUT_OK,
              note="Motos et deux-roues interdits dans le tunnel (Ulys, TOLL04) : classe 5 = interdit.",
              sources=("CYC01", "TOLL04", "TOLL05")),
    TollPoint("DUPLEX_VAUCRESSON", "DUPLEX_A86", "Duplex A86 - gare de Vaucresson", "A86",
              "Cofiroute (VINCI Autoroutes)", "gare_tunnel", "couple_entree_sortie_horaire",
              "gare intermédiaire ; TOLL01 : « sortie intermédiaire Vaucresson ; utilisé uniquement en télépéage »",
              "Vaucresson", (1200571098,), ("Vaucresson Le Chesnay Bpv", "Vaucresson Le Chesnay BPV"),
              ("Vaucresson",), note="Un seul nœud OSM de péage à Vaucresson (bretelle, chemin 104030625).",
              sources=("CYC01", "TOLL01", "TOLL04", "TOLL05")),
    TollPoint("DUPLEX_VELIZY", "DUPLEX_A86", "Duplex A86 - gare de Vélizy (Pont-Colbert)", "A86",
              "Cofiroute (VINCI Autoroutes)", "gare_tunnel", "couple_entree_sortie_horaire",
              "prix fixé par la gare d'entrée, le couple, le jour et l'heure (guide Duplex A86 2026)", "Vélizy",
              (1238723845,), ("Pont-Colbert Bpv", "Pont-Colbert BPV"), sources=("CYC01", "TOLL04", "TOLL05")),
    # A6 (APRR) : système fermé, grille APRR (TOLL02)
    TollPoint("APRR_A6_FLEURY", "APRR", "A6 - barrière de Fleury-en-Bière", "A6", "APRR", "barriere_pleine_voie",
              "couple_entree_sortie", "système fermé : ticket à l'entrée, paiement à la sortie", "FLEURY-EN-BIERE",
              (35675144, 1801078049, 1883772392), ("Fleury-En-Biere",), sources=("CYC01", "TOLL02", "TOLL05")),
    TollPoint("APRR_A6_URY", "APRR", "A6 - échangeur 14 Ury", "A6", "APRR", "gare_echangeur",
              "couple_entree_sortie", "système fermé", "URY", (28870546, 28870547), ("Ury",),
              sources=("CYC01", "TOLL02", "TOLL05")),
    TollPoint("APRR_A6_FONTAINEBLEAU", "APRR", "A6 - échangeur 15 Fontainebleau", "A6", "APRR", "gare_echangeur",
              "couple_entree_sortie", "système fermé", "FONTAINEBLEAU", (456955619, 650926914), ("Fontainebleau",),
              note="Les couples FONTAINEBLEAU / FLEURY-EN-BIERE et FONTAINEBLEAU / URY n'existent pas dans la grille.",
              sources=("CYC01", "TOLL02", "TOLL05")),
    TollPoint("APRR_A6_NEMOURS", "APRR", "A6 - échangeur 16 Nemours", "A6", "APRR", "gare_echangeur",
              "couple_entree_sortie", "système fermé", "NEMOURS", (649150142, 649587072), ("Nemours",),
              sources=("CYC01", "TOLL02", "TOLL05")),
    # A5 (APRR)
    TollPoint("APRR_A5_EPRUNES", "APRR", "A5 - barrière des Éprunes", "A5", "APRR", "barriere_pleine_voie",
              "couple_entree_sortie", "système fermé : ticket à l'entrée, paiement à la sortie", "LES EPRUNES",
              (1389350279, 1389350280), ("Les Eprunes",), sources=("CYC01", "TOLL02", "TOLL05")),
    TollPoint("APRR_A5_ST_GERMAIN_LAXIS", "APRR", "A5 - échangeur 15 Saint-Germain-Laxis", "A5", "APRR",
              "gare_echangeur", "couple_entree_sortie", "système fermé", "ST-GERMAIN-LAXIS", (690686570, 1477388127),
              ("St-Germain-Laxis",), sources=("CYC01", "TOLL02", "TOLL05")),
    TollPoint("APRR_A5_CHATILLON", "APRR", "A5 - échangeur 16 Châtillon-la-Borde", "A5", "APRR", "gare_echangeur",
              "couple_entree_sortie", "système fermé", "CHATILLON-LABORDE", (131854822, 261058618),
              ("Chatillon-Laborde",), sources=("CYC01", "TOLL02", "TOLL05")),
    TollPoint("APRR_A5_FORGES", "APRR", "A5 - échangeur 17 Forges", "A5", "APRR", "gare_echangeur",
              "couple_entree_sortie", "système fermé", "FORGES", (323144666, 324391958), ("Forges",),
              sources=("CYC01", "TOLL02", "TOLL05")),
    TollPoint("APRR_A5_MAROLLES", "APRR", "A5 - échangeur 18 Marolles-sur-Seine", "A5", "APRR", "gare_echangeur",
              "couple_entree_sortie", "système fermé", "MAROLLES-SUR-SEINE", (317670287, 317670314),
              ("Marolles-Sur-Seine",), sources=("CYC01", "TOLL02", "TOLL05")),
    # A77 (APRR) : extrémité sud de la Seine-et-Marne (Souppes-sur-Loing, Dordives)
    TollPoint("APRR_A77_SOUPPES", "APRR", "A77 - échangeur 17 Val-de-Loing - Souppes", "A77", "APRR",
              "gare_echangeur", "couple_entree_sortie", "système fermé", "VAL DE LOING-SOUPPES", (35665218, 35665220),
              ("Val De Loing-Souppes",), sources=("CYC01", "TOLL02", "TOLL05")),
    TollPoint("APRR_A77_VAL_DE_LOING", "APRR", "A77 - barrière du Val-de-Loing", "A77", "APRR",
              "barriere_pleine_voie", "couple_entree_sortie", "système fermé", "VAL DE LOING-BARRIERE",
              (247393077, 247393080),
              note=("Libellé de grille « VAL DE LOING-BARRIERE » (distance tarifaire 120,30 km depuis Fleury-en-Bière, "
                    "contre 58,34 km pour VAL DE LOING-SOUPPES) : rattaché aux nœuds OSM « Val-de-Loing Barrière » "
                    "par le nom, sens exact à vérifier."), sources=("CYC01", "TOLL02")),
    TollPoint("APRR_A77_DORDIVES", "APRR_DORDIVES", "A77 - gare de Dordives (système ouvert)", "A77", "APRR",
              "gare_echangeur", "prix_fixe", "système ouvert : prix fixe à la gare (grille APRR « Péage à système "
              "ouvert »)", "DORDIVES", (242800246, 242800358), ("Dordives Ouest", "Dordives Est"),
              note=("Prix transcrit à la main depuis le PDF image « Péage à système ouvert, tarifs au 1er février "
                    "2026 » (aucun texte extractible) : à relire."), sources=("CYC01", "TOLL02", "TOLL05")),
)
if withdrawal_enabled():
    POINTS = withdraw_vinci_points(POINTS)
POINTS_BY_ID = {p.point_id: p for p in POINTS}


# --- Jours fériés et types de jour -------------------------------------------------------------------------------
# Liste publiée par le guide Duplex A86 2026 (TOLL04, page 2) : « Jours fériés 2026 : 1er janvier, 6 avril, 1er mai,
# 8 mai, 14 mai, 25 mai, 14 juillet, 15 août, 1er novembre, 11 novembre, 25 décembre. »
HOLIDAYS_2026 = frozenset(date(2026, m, d) for m, d in (
    (1, 1), (4, 6), (5, 1), (5, 8), (5, 14), (5, 25), (7, 14), (8, 15), (11, 1), (11, 11), (12, 25)))


def _is_holiday(d: date) -> bool:
    if d.year != 2026:
        raise ValueError(f"jours fériés sourcés pour 2026 seulement (guide Duplex A86) : {d}")
    return d in HOLIDAYS_2026


def day_type(systeme: str, d: date) -> str:
    """Type de jour de la grille du système pour la date `d` (vocabulaire de toll_tariffs.csv).

    DUPLEX_A86 (guide 2026, notes * ** *** et fichier Tarifs_A86.txt) : dimanche ou férié -> « dimanche_ferie » ;
    jour ouvrable d'août (lundi au samedi, hors férié) -> « aout_ouvrable » ; samedi -> « samedi » (veille de férié
    comprise) ; veille de férié du lundi au vendredi -> « veille_ferie » ; sinon le nom du jour.
    SAPN_A14 (annexe de l'arrêté) : férié -> « ferie », sinon le nom du jour.
    Autres systèmes : « tous » (grille sans modulation).
    """
    wd = WEEKDAYS[d.weekday()]
    if systeme == "DUPLEX_A86":
        if wd == "dimanche" or _is_holiday(d):
            return "dimanche_ferie"
        if d.month == 8:
            return "aout_ouvrable"
        if wd == "samedi":
            return "samedi"
        if _is_holiday(d + timedelta(days=1)):
            return "veille_ferie"
        return wd
    if systeme == "SAPN_A14":
        return "ferie" if _is_holiday(d) else wd
    return "tous"


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


# --- Lecture des grilles -----------------------------------------------------------------------------------------
def _row(point: str, systeme: str, entree: str, sortie: str, classe: int, prix: float | None, *,
         sens: str = "", entree_grille: str = "", sortie_grille: str = "", tarif: str = "standard",
         libelle: str = "", type_jour: str = "tous", debut: str = "00:00", fin: str = "24:00",
         statut: str = STATUT_OK, raison: str = "", date_effet: str = "", source_id: str = "",
         fichier: str = "", citation: str = "") -> dict:
    return {"point_id": point, "systeme": systeme, "sens": sens, "entree_point_id": entree,
            "sortie_point_id": sortie, "entree_grille": entree_grille, "sortie_grille": sortie_grille,
            "classe": classe, "tarif": tarif, "libelle_source": libelle, "type_jour": type_jour,
            "heure_debut": debut, "heure_fin": fin, "prix_ttc_eur": prix, "statut": statut, "raison": raison,
            "date_effet": date_effet, "source_id": source_id, "fichier_source": fichier,
            "citation": clean(citation)}


def _grid_points(systeme: str) -> dict[str, str]:
    return {p.nom_grille: p.point_id for p in POINTS if p.systeme == systeme and p.nom_grille}


APRR_CITATION = ("Réseau APRR - Classes 1 à 5 En vigueur au 1er février 2026 ; APRR - Tarifs de péage en euros TTC "
                 "en vigueur au 1er février 2026")


def aprr_tariffs(pairs: dict[tuple[str, str], tuple[float, ...]], fichier: str) -> list[dict]:
    """Couples entrée-sortie APRR dont les deux gares sont au registre (A5, A6), classes 1 et 5.

    `pairs` : (entrée, sortie) -> (distance tarifaire km, classe 1, ..., classe 5), lu sur la grille officielle
    (`parse_aprr_pdf_table`) ; la copie CSV de data.gouv.fr sert de recoupement (`aprr_csv_pairs`)."""
    names = _grid_points("APRR")
    rows = []
    for (e, s), vals in sorted(pairs.items()):
        if e not in names or s not in names:
            continue
        km, prices = vals[0], vals[1:]
        for c in CLASSES:
            rows.append(_row(names[s], "APRR", names[e], names[s], c, prices[c - 1], sens="entree_vers_sortie",
                             entree_grille=e, sortie_grille=s, date_effet="2026-02-01", source_id="TOLL02",
                             fichier=fichier,
                             citation=f"{APRR_CITATION} : gare d'entrée {e}, gare de sortie {s}, distance tarifaire "
                                      f"{km:.2f} km, classe {c} {prices[c - 1]:.2f} €".replace(".", ",")))
    return rows


def aprr_csv_pairs(csv_path: Path) -> dict[tuple[str, str], tuple[float, ...]]:
    """Copie CSV data.gouv.fr « Tarifs autoroutes APRR » (2026-02), même forme que `parse_aprr_pdf_table`."""
    d = pd.read_csv(csv_path)
    expected = ["gare_entree", "gare_sortie", "distance_tarifaire_km"] + [f"tarif_classe_{c}" for c in range(1, 6)]
    if list(d.columns) != expected:
        raise ValueError(f"colonnes APRR inattendues : {list(d.columns)}")
    return {(r[0], r[1]): tuple(float(x) for x in r[2:]) for r in d.itertuples(index=False, name=None)}


def parse_aprr_pdf_table(text: str, names: Iterable[str]) -> dict[tuple[str, str], tuple[float, ...]]:
    """Lignes « ENTREE  SORTIE  km  c1 € ... c5 € » de `pdftotext -table` sur la grille APRR officielle, limitées
    aux gares `names` ; valeur : (distance tarifaire km, classe 1, ..., classe 5)."""
    alt = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
    pat = re.compile(rf"^\s*({alt})\s+({alt})\s+([\d,]+)\s+" + r"\s+".join([r"([\d,]+) €"] * 5) + r"\s*$")
    out = {}
    for line in text.splitlines():
        m = pat.match(line)
        if m:
            out[(m.group(1), m.group(2))] = tuple(float(x.replace(",", ".")) for x in m.groups()[2:])
    return out


COFI_CITATION = "TARIFS DE PEAGE AU 1ER FEVRIER 2026 (€TTC) CLASSE 1 CLASSE 2 CLASSE 3 CLASSE 4 CLASSE 5"


def cofiroute_tariffs(txt_path: Path, fichier: str) -> list[dict]:
    """Couples du fichier « Tarifs Cofiroute / Arcour » entre les gares IDF du registre (A10, A11)."""
    d = pd.read_csv(txt_path, sep=";", dtype=str)
    expected = ["autoroute_entree", "echangeur_entree", "nom_entree", "autoroute_sortie", "echangeur_sortie",
                "nom_sortie", "classe1", "classe2", "classe3", "classe4", "classe5"]
    if list(d.columns) != expected:
        raise ValueError(f"colonnes Cofiroute inattendues : {list(d.columns)}")
    # (autoroute, échangeur, nom) -> point ; « PARIS (LA FOLIE BESSIN) » échangeur « - » = barrière de Saint-Arnoult,
    # échangeur « 10 » = côté Paris de la gare de Dourdan (seul couple de DOURDAN dans la grille).
    keys = {("A10", "-", "PARIS (LA FOLIE BESSIN)"): "COFI_A10_ST_ARNOULT",
            ("A10", "11", "ALLAINVILLE"): "COFI_A10_ALLAINVILLE",
            ("A11", "1", "ABLIS"): "COFI_A11_ABLIS",
            ("A10", "10", "DOURDAN"): "COFI_A10_DOURDAN",
            ("A10", "10", "PARIS (LA FOLIE BESSIN)"): "COFI_A10_DOURDAN"}
    rows = []
    for r in d.itertuples(index=False):
        ke = (r.autoroute_entree, r.echangeur_entree, r.nom_entree)
        ks = (r.autoroute_sortie, r.echangeur_sortie, r.nom_sortie)
        if ke not in keys or ks not in keys:
            continue
        pe, ps = keys[ke], keys[ks]
        fixed = pe == ps == "COFI_A10_DOURDAN"
        sens = ("vers Paris" if r.nom_sortie.startswith("PARIS") else "depuis Paris") if fixed else "entree_vers_sortie"
        for c in CLASSES:
            rows.append(_row("COFI_A10_DOURDAN" if fixed else ps, "COFIROUTE_DOURDAN" if fixed else "COFIROUTE",
                             pe, ps, c, float(getattr(r, f"classe{c}")), sens=sens,
                             entree_grille=f"{r.autoroute_entree} {r.echangeur_entree} {r.nom_entree}",
                             sortie_grille=f"{r.autoroute_sortie} {r.echangeur_sortie} {r.nom_sortie}",
                             date_effet="2026-02-01", source_id="TOLL04", fichier=fichier,
                             citation=f"{COFI_CITATION} (guide Cofiroute 2026) ; ligne du fichier : "
                                      f"{';'.join(map(str, r))}"))
    return rows


DUPLEX_DAY = {"Lundi": "lundi", "Mardi": "mardi", "Mercredi": "mercredi", "Jeudi": "jeudi", "Vendredi": "vendredi",
              "Samedi": "samedi", "Dimanches+Fêtes": "dimanche_ferie", "Veilles de fêtes": "veille_ferie",
              "Jours ouvrables août": "aout_ouvrable"}
DUPLEX_GARE = {"Rueil": "DUPLEX_RUEIL", "Vaucresson": "DUPLEX_VAUCRESSON", "Vélizy": "DUPLEX_VELIZY"}
DUPLEX_CITATION = ("Ces tarifs ont la spécificité d'être modulés en fonction de l'heure, du jour de passage et de la "
                   "gare d'entrée. (communiqué VINCI Autoroutes du 31 décembre 2025) ; Tarifs TTC en vigueur au "
                   "01/01/2026 en euros. (guide Duplex A86 2026)")
DUPLEX_BADGE = ("(3) Tarif applicable pour tout trajet réalisé avec un badge détecté en entrée et sortie du tunnel "
                "(quelle que soit la société émettrice).")


def _duplex_hour(text: str) -> str:
    m = re.fullmatch(r"(\d{1,2})H(\d{2})?", text.strip())
    if not m:
        raise ValueError(f"heure Duplex illisible : {text!r}")
    return _hhmm(int(m.group(1)) * 60 + int(m.group(2) or 0))


def duplex_tariffs(txt_path: Path, fichier: str) -> list[dict]:
    """Fichier « Tarifs A86 » : type de jour x paiement badge x demi-heure x couple ; classe 1 seule publiée."""
    d = pd.read_csv(txt_path, sep=";", dtype=str, encoding="cp1252")
    if list(d.columns[:4]) != ["Type_jour", "paiement_badge", "Heure_début", "heure_fin"]:
        raise ValueError(f"colonnes Duplex inattendues : {list(d.columns)}")
    couples = []
    for col in d.columns[4:]:
        a, b = col.split("_")
        couples.append((col, DUPLEX_GARE[a], DUPLEX_GARE[b]))
    rows = []
    for r in d.to_dict("records"):
        tj = DUPLEX_DAY[r["Type_jour"]]
        badge = {"oui": True, "non": False}[r["paiement_badge"]]
        debut, fin = _duplex_hour(r["Heure_début"]), _duplex_hour(r["heure_fin"])
        for col, pe, ps in couples:
            rows.append(_row(pe, "DUPLEX_A86", pe, ps, 1, float(r[col].replace(",", ".")),
                             sens="entree_vers_sortie", entree_grille=col.split("_")[0],
                             sortie_grille=col.split("_")[1], tarif="telepeage" if badge else "standard",
                             libelle=f"paiement_badge={r['paiement_badge']}", type_jour=tj, debut=debut, fin=fin,
                             date_effet="2026-01-01", source_id="TOLL04", fichier=fichier,
                             citation=DUPLEX_CITATION + (" ; " + DUPLEX_BADGE if badge else "")))
    for pe, ps in sorted({(pe, ps) for _, pe, ps in couples}):
        rows.append(_row(pe, "DUPLEX_A86", pe, ps, 5, None, sens="entree_vers_sortie", statut=STATUT_INTERDIT,
                         raison="deux-roues interdits dans le Duplex A86 (classe 5 sans objet)", source_id="TOLL04",
                         fichier="data/raw/TOLL04/ulys-autoroute-a86.html",
                         citation=("À noter que les poids lourds, les véhicules utilitaires et les deux-roues, ne "
                                   "peuvent pas emprunter ce tunnel de l'autoroute, puisque la hauteur de son plafond "
                                   "(2,50 mètres) en limite l'accès. (ulys.com/autoroute/a86/)")))
    return rows


def _jorf_table(xml_text: str) -> tuple[list[list[str]], str]:
    """Cellules du tableau HTML d'un article JORF (XML DILA) et texte de la note éventuelle."""
    content = re.search(r"<CONTENU>(.*?)</CONTENU>", xml_text, re.DOTALL).group(1)
    cells = []
    for tr in re.findall(r"<tr>(.*?)</tr>", content, re.DOTALL):
        cells.append([clean(html.unescape(re.sub(r"<[^>]+>", " ", c)))
                      for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.DOTALL)])
    note = re.search(r'<p class="note">(.*?)</p>', content, re.DOTALL)
    return cells, clean(html.unescape(re.sub(r"<[^>]+>", " ", note.group(1)))) if note else ""


# Annexe : « (1) Applicable du lundi au vendredi de 10 heures à 16 heures et de 21 heures à 6 heures hors jours
# fériés. » Lecture retenue : chaque jour du lundi au vendredi (non férié), 00:00-06:00, 10:00-16:00 et 21:00-24:00.
# Lundi 00:00-06:00 et samedi 00:00-06:00 dépendent de la lecture (nuit rattachée au jour où elle commence ou au jour
# civil) : marqués dans `raison` (docs/limites.md). Le jour de service (mardi 17/11/2026) n'est pas concerné.
A14_REDUCED_SLOTS = (("00:00", "06:00"), ("10:00", "16:00"), ("21:00", "24:00"))
A14_AMBIGUOUS_MON = ("lecture de la note (1) : la nuit du dimanche au lundi avant 6 h est comptée au tarif réduit "
                     "(jour civil lundi) ; si la nuit se rattache au jour où elle commence (dimanche), tarif de base")
A14_AMBIGUOUS_SAT = ("lecture de la note (1) : la nuit du vendredi au samedi après minuit est comptée au tarif de "
                     "base (jour civil samedi) ; si la nuit se rattache au jour où elle commence (vendredi), tarif réduit")


def _fr(x: float) -> str:
    return f"{x:g}".replace(".", ",")


def a14_tariffs(articles: Sequence[Path], fichiers: Sequence[str]) -> list[dict]:
    rows = []
    title = "Arrêté du 28 janvier 2026 relatif aux péages applicables sur les réseaux autoroutiers concédés à SANEF et SAPN"
    for path, fichier in zip(articles, fichiers, strict=True):
        cells, note = _jorf_table(path.read_text(encoding="utf-8"))
        head = cells[0]
        gare = head[0]
        point = {"Gare de Montesson": "SAPN_A14_MONTESSON", "Gare de Chambourcy": "SAPN_A14_CHAMBOURCY"}[gare]
        if head[1:] != [f"Classe {c}" for c in range(1, 6)]:
            raise ValueError(f"en-tête inattendu dans {path.name} : {head}")
        prices = {r[0]: {c: float(r[c].replace(",", ".")) for c in range(1, 6)} for r in cells[1:]}
        base = prices["Tarif de base"]
        reduced = prices.get("Tarif réduit (1)")
        for c in CLASSES:
            cite = f"{title} (NOR TRAT2600882A), annexe : {gare}, Classe {c}, Tarif de base {_fr(base[c])}"
            if reduced is None:
                rows.append(_row(point, "SAPN_A14", point, point, c, base[c], sens="les_deux", libelle="Tarif de base",
                                 date_effet="2026-02-01", source_id="TOLL03", fichier=fichier, citation=cite))
                continue
            cite_r = f"{cite} ; Tarif réduit (1) {_fr(reduced[c])} ; {note}"
            for wd in WEEKDAYS + ("ferie",):
                if wd in ("dimanche", "ferie"):
                    rows.append(_row(point, "SAPN_A14", point, point, c, base[c], sens="les_deux",
                                     libelle="Tarif de base", type_jour=wd, date_effet="2026-02-01",
                                     source_id="TOLL03", fichier=fichier, citation=cite_r))
                    continue
                if wd == "samedi":  # tarif de base ; 00:00-06:00 dépend de la lecture de la note (1)
                    for a, b, amb in ((0, 360, True), (360, 1440, False)):
                        rows.append(_row(point, "SAPN_A14", point, point, c, base[c], sens="les_deux",
                                         libelle="Tarif de base", type_jour=wd, debut=_hhmm(a), fin=_hhmm(b),
                                         raison=A14_AMBIGUOUS_SAT if amb else "", date_effet="2026-02-01",
                                         source_id="TOLL03", fichier=fichier, citation=cite_r))
                    continue
                cuts = sorted({0, 1440} | {_minutes(x) for s in A14_REDUCED_SLOTS for x in s})
                for a, b in itertools.pairwise(cuts):
                    red = any(_minutes(s) <= a and b <= _minutes(e) for s, e in A14_REDUCED_SLOTS)
                    amb = red and a == 0 and wd == "lundi"
                    rows.append(_row(point, "SAPN_A14", point, point, c, reduced[c] if red else base[c],
                                     sens="les_deux", libelle="Tarif réduit (1)" if red else "Tarif de base",
                                     type_jour=wd, debut=_hhmm(a), fin=_hhmm(b), date_effet="2026-02-01",
                                     raison=A14_AMBIGUOUS_MON if amb else "",
                                     source_id="TOLL03", fichier=fichier, citation=cite_r))
    return rows


# --- Grille Sanef (TOLL03, PDF déposé à la main le 05/11/2026) : triangle de l'A4 -------------------------------
SANEF_CITATION = "Sanef - Tarifs de péage TTC au 01/02/2026 - taux de TVA : 20 %"
SANEF_A4_MEAUX = "MEAUX (A140) / CRECY N°16"


def sanef_pages(layout_text: str) -> dict[int, str]:
    """Pages de la grille Sanef (`pdftotext -layout`, pages séparées par un saut de page) par classe : l'en-tête de
    chaque page se termine par « <classe> CLASSE »."""
    out: dict[int, str] = {}
    for page in layout_text.split("\f"):
        m = re.search(r"(\d)\s+CLASSE\s*$", page, flags=re.MULTILINE)
        if m and "TARIFS DE PEAGE TTC AU 01/02/2026" in page:
            out[int(m.group(1))] = page
    return out


def _row_numbers(page: str, label: str) -> list[float]:
    """Nombres écrits à gauche d'un libellé de station sur sa ligne (cases du triangle de cette ligne, de gauche à
    droite). Le libellé doit être unique sur la page et précédé de nombres seulement."""
    hits = [ln for ln in page.splitlines() if label in ln]
    if len(hits) != 1:
        raise ValueError(f"libellé {label!r} : {len(hits)} lignes sur la page (une attendue)")
    left = hits[0].split(label)[0]
    nums = re.findall(r"\d+,\d+", left)
    if re.sub(r"[\d,\s]", "", left):
        raise ValueError(f"libellé {label!r} : texte inattendu à gauche des cases : {left!r}")
    return [float(x.replace(",", ".")) for x in nums]


def sanef_a4_pairs(layout_text: str) -> dict[tuple[str, str], dict[int, float]]:
    """Prix du triangle « AUTOROUTES A4 - A26 SUD » entre la barrière de Coutevroult (colonne « PARIS / NOISY-LE-GRAND
    (péage de Coutevroult) », première colonne du triangle) et les échangeurs 18 (Saint-Jean-les-Deux-Jumeaux) et 19
    (Montreuil-aux-Lions), par classe : {(libellé entrée, libellé sortie): {classe: prix}}.

    Contrôles de position faits sur chaque page : la ligne « COUTEVROULT N°15 » n'a aucune case, la ligne Meaux en a
    une seule, les lignes Saint-Jean et Montreuil en ont exactement deux (première colonne = Coutevroult, seconde =
    Meaux). Un triangle n'a qu'une case par couple : elle vaut pour les deux sens (lecture écrite dans la raison)."""
    pages = sanef_pages(layout_text)
    pairs: dict[tuple[str, str], dict[int, float]] = {}
    for c in CLASSES:
        if c not in pages:
            raise ValueError(f"page de la classe {c} introuvable dans la grille Sanef")
        page = pages[c]
        if _row_numbers(page, "COUTEVROULT N°15") or len(_row_numbers(page, SANEF_A4_MEAUX)) != 1:
            raise ValueError(f"classe {c} : forme inattendue du début du triangle A4")
        for pid in ("SANEF_A4_ST_JEAN", "SANEF_A4_MONTREUIL"):
            nums = _row_numbers(page, SANEF_A4_LABEL[pid])
            if len(nums) != 2:
                raise ValueError(f"classe {c}, {SANEF_A4_LABEL[pid]} : {len(nums)} cases (deux attendues)")
            pairs.setdefault((SANEF_A4_LABEL["SANEF_A4_COUTEVROULT"], SANEF_A4_LABEL[pid]), {})[c] = nums[0]
    return pairs


def sanef_a4_tariffs(layout_text: str, fichier: str) -> list[dict]:
    """Lignes de toll_tariffs.csv de l'A4 : les deux sens de chaque couple de `sanef_a4_pairs`, classes 1 et 5."""
    by_label = {v: k for k, v in SANEF_A4_LABEL.items()}
    rows = []
    for (e_lab, s_lab), prices in sorted(sanef_a4_pairs(layout_text).items()):
        for a_lab, b_lab, sens in ((e_lab, s_lab, "les_deux"), (s_lab, e_lab, "les_deux")):
            for c in CLASSES:
                rows.append(_row(by_label[b_lab], "SANEF_A4", by_label[a_lab], by_label[b_lab], c, prices[c],
                                 sens=sens, entree_grille=a_lab, sortie_grille=b_lab, date_effet="2026-02-01",
                                 raison="triangle de la grille : une case par couple, lue pour les deux sens",
                                 source_id="TOLL03", fichier=fichier,
                                 citation=f"{SANEF_CITATION} ; classe {c} ; autoroutes A4 - A26 sud ; couple {e_lab} / "
                                          f"{s_lab} : {prices[c]:.1f} €".replace(".", ",")))
    return rows


# Grille « PÉAGE À SYSTÈME OUVERT - TARIFS AU 1ER FÉVRIER 2026 » (APRR-AREA, PDF image, TOLL02) : ligne lue à
# l'écran le 03/11/2026 et transcrite ici (seule valeur saisie à la main du module, signalée dans la citation).
DORDIVES_ROW = {"autoroute": "A77", "gare": "09403", "nom": "DORDIVES", 1: 6.00, 5: 3.70, "km": 62}


def aprr_open_tariffs(fichier: str) -> list[dict]:
    r = DORDIVES_ROW
    cite = (f"PÉAGE À SYSTÈME OUVERT - TARIFS AU 1ER FÉVRIER 2026 ; {r['autoroute']} | {r['gare']} | {r['nom']} | "
            f"Classe 1 6,00 € | Classe 5 3,70 € | {r['km']} Kilomètres (transcription manuelle du PDF image)")
    return [_row("APRR_A77_DORDIVES", "APRR_DORDIVES", "APRR_A77_DORDIVES", "APRR_A77_DORDIVES", c, r[c],
                 sens="les_deux", libelle="transcription manuelle", date_effet="2026-02-01", source_id="TOLL02",
                 fichier=fichier, citation=cite) for c in CLASSES]


def missing_tariffs() -> list[dict]:
    """Une ligne vide (prix null + raison) par point du registre sans grille lue, et par classe."""
    rows = []
    for p in POINTS:
        if p.statut_tarif == STATUT_OK:
            continue
        reason = p.note or SANEF_BLOCKED
        for c in CLASSES:
            rows.append(_row(p.point_id, p.systeme, p.point_id if p.tarification == "prix_fixe" else "",
                             p.point_id if p.tarification == "prix_fixe" else "", c, None, statut=p.statut_tarif,
                             raison=clean(reason)))
    return rows


# --- Rattachement OSM ------------------------------------------------------------------------------------------
def _key(lon: float, lat: float) -> tuple[float, float]:
    return (round(float(lon), 7), round(float(lat), 7))


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Cap (degrés, 0 = nord, sens horaire) du segment a -> b (lon, lat)."""
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dlon = math.radians(b[0] - a[0])
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


@dataclass
class NodeOnWay:
    node_id: int
    lon: float
    lat: float
    way_ids: list[int] = field(default_factory=list)
    cap_deg: float | None = None  # cap de la chaussée au nœud (premier chemin, sens de numérisation OSM)
    vers_paris: bool | None = None  # la chaussée se rapproche-t-elle du centre de Paris (75056, GEO01) ?


def locate_nodes(osm: dict, paris: tuple[float, float]) -> dict[int, NodeOnWay]:
    """Chemins `toll=yes` qui portent chaque nœud de péage (coordonnées exactes) et sens de la chaussée.

    Le sens « vers Paris » compare la distance au centre de Paris (API Géo, commune 75056) des deux extrémités du
    chemin : c'est une étiquette de lecture, jamais une donnée de calcul."""
    vert: dict[tuple[float, float], list[dict]] = {}
    for w in osm["ways"]:
        for c in w["coords"]:
            vert.setdefault(_key(*c), []).append(w)
    out = {}
    for n in osm["nodes"]:
        k = _key(n["lon"], n["lat"])
        nw = NodeOnWay(int(n["osm_id"]), k[0], k[1])
        for w in vert.get(k, []):
            nw.way_ids.append(int(w["osm_id"]))
        ways = vert.get(k, [])
        if ways:
            pts = [_key(*c) for c in ways[0]["coords"]]
            i = pts.index(k)
            a, b = (pts[i - 1], pts[i]) if i > 0 else (pts[i], pts[i + 1])
            nw.cap_deg = round(bearing(a, b), 1)
            d0 = math.dist(pts[0], paris)
            d1 = math.dist(pts[-1], paris)
            nw.vers_paris = d1 < d0
        out[nw.node_id] = nw
    return out


# --- Règle de prix ----------------------------------------------------------------------------------------------
def prices_in_window(tariffs: pd.DataFrame, entree: str, sortie: str, classe: int, start: datetime,
                     end: datetime, tarif: str = "standard") -> tuple[list[float], str]:
    """Prix possibles d'un passage dans [start, end) (heure de passage inconnue à l'intérieur de la fenêtre).

    Renvoie (prix distincts triés, statut). Statuts : « ok » (un prix), « fourchette » (la fenêtre chevauche
    plusieurs tranches), ou le statut de la grille (« non_trouve », « interdit »...), « couple_absent »."""
    if end < start:
        raise ValueError("fenêtre de passage inversée")
    sel = tariffs[(tariffs["entree_point_id"] == entree) & (tariffs["sortie_point_id"] == sortie)
                  & (tariffs["classe"] == classe)]
    if sel.empty:
        return [], "couple_absent"
    bad = sel[sel["statut"] != STATUT_OK]
    if not bad.empty:
        return [], str(bad["statut"].iloc[0])
    sel = sel[sel["tarif"] == tarif]
    if sel.empty:
        return [], "tarif_absent"
    systeme = str(sel["systeme"].iloc[0])
    found: set[float] = set()
    t = start
    while True:  # parcours jour par jour de la fenêtre
        tj = day_type(systeme, t.date())
        day = sel[sel["type_jour"] == tj]
        if day.empty:  # grille sans modulation pour ce point (ex. Chambourcy) : lignes « tous »
            day = sel[sel["type_jour"] == "tous"]
        if day.empty:
            return [], "type_jour_absent"
        lo = t.hour * 60 + t.minute if t.date() == start.date() else 0
        hi = end.hour * 60 + end.minute if t.date() == end.date() else 1440
        for r in day.itertuples(index=False):
            a, b = _minutes(r.heure_debut), _minutes(r.heure_fin)
            # tranche [a, b) et fenêtre semi-ouverte [lo, hi) : à l'aller, le péage est franchi avant l'arrivée ;
            # fenêtre réduite à un instant (lo == hi) : la tranche qui le contient
            if (a < hi and lo < b) or (lo == hi and a <= lo < b):
                found.add(float(r.prix_ttc_eur))
        if t.date() >= end.date():
            break
        t = datetime.combine(t.date() + timedelta(days=1), time(0, 0))
    if not found:
        return [], "tranche_absente"
    return sorted(found), "ok" if len(found) == 1 else "fourchette"


def duplex_couple(pids: Sequence[str]) -> tuple[str, str] | None:
    """Couple (entrée, sortie) du Duplex A86 d'après les gares traversées.

    L'OSM porte une gare de péage par extrémité, sur la chaussée qui entre dans le tunnel (Rueil : cap 144°, vers le
    sud ; Vélizy / Pont-Colbert : cap 317°, vers le nord, toll_points.csv), ce que confirme TOLL05 (une seule
    barrière par extrémité, côtés G et D). Un nœud de Rueil traversé vaut donc entrée à Rueil, un nœud de Vélizy
    entrée à Vélizy ; la sortie est Vaucresson si son nœud (bretelle) est aussi traversé, sinon l'autre extrémité.
    Vaucresson seul (entrée à Vaucresson, sortie inconnue) ou Rueil et Vélizy ensemble : None (sens à préciser)."""
    s = set(pids)
    r, v, z = "DUPLEX_RUEIL" in s, "DUPLEX_VAUCRESSON" in s, "DUPLEX_VELIZY" in s
    if r and not z:
        return ("DUPLEX_RUEIL", "DUPLEX_VAUCRESSON" if v else "DUPLEX_VELIZY")
    if z and not r:
        return ("DUPLEX_VELIZY", "DUPLEX_VAUCRESSON" if v else "DUPLEX_RUEIL")
    return None


def couples_from_points(points: Sequence[str]) -> tuple[list[tuple[str, str]], str]:
    """Passages tarifés à partir des points traversés par un chemin (ensemble, sans ordre, comme 04g).

    - point à prix fixe : un passage (point, point) ;
    - système fermé symétrique (APRR, Cofiroute : même prix dans les deux sens, contrôlé par 07) : exactement deux
      points du système -> un couple ; un seul ou plus de deux -> statut « couple_indetermine » ;
    - Duplex A86 (prix non symétrique) : `duplex_couple` ; indéterminé -> « sens_requis ».
    """
    by_sys: dict[str, list[str]] = {}
    for pid in dict.fromkeys(points):
        p = POINTS_BY_ID[pid]
        by_sys.setdefault(p.systeme, []).append(pid)
    out: list[tuple[str, str]] = []
    status = "ok"
    for systeme, pids in by_sys.items():
        kinds = {POINTS_BY_ID[x].tarification for x in pids}
        if kinds == {"prix_fixe"}:
            out += [(x, x) for x in pids]
        elif systeme == "DUPLEX_A86":
            couple = duplex_couple(pids)
            if couple is None:
                status = "sens_requis"
            else:
                out.append(couple)
        elif len(pids) == 2:
            out.append((pids[0], pids[1]))
        else:
            status = "couple_indetermine"
    return out, status


def points_from_osm_nodes(node_ids: Iterable[int]) -> list[str]:
    """Points du registre correspondant aux nœuds OSM traversés (colonne `toll_nodes` de 04g). Un nœud de péage
    absent du registre (parking, parc, gare hors autoroute) est ignoré : 07 vérifie que tout nœud situé sur un
    chemin autoroutier `toll=yes` est au registre."""
    index = {n: p.point_id for p in POINTS for n in p.osm_nodes}
    return list(dict.fromkeys(index[int(n)] for n in node_ids if int(n) in index))


def trip_toll(tariffs: pd.DataFrame, points: Sequence[str], classe: int, start: datetime, end: datetime,
              tarif: str = "standard") -> dict:
    """Péage d'un trajet dans un sens : somme des passages, avec une fourchette quand l'heure de passage n'est connue
    qu'à la fenêtre [départ, arrivée] près. Aucun point traversé : 0 € sûr (statut « sans_peage »). Toute case vide
    de la grille rend le total inconnu (None) : jamais de total partiel présenté comme complet."""
    if not points:
        return {"min_eur": 0.0, "max_eur": 0.0, "statut": "sans_peage", "detail": ""}
    for pid in points:
        st = POINTS_BY_ID[pid].statut_tarif
        if st != STATUT_OK:
            return {"min_eur": None, "max_eur": None, "statut": st, "detail": pid}
    couples, st = couples_from_points(points)
    if st != "ok":
        return {"min_eur": None, "max_eur": None, "statut": st, "detail": ";".join(points)}
    lo = hi = 0.0
    detail = []
    for e, s in couples:
        prices, pst = prices_in_window(tariffs, e, s, classe, start, end, tarif)
        p = POINTS_BY_ID[e]
        if p.tarification == "couple_entree_sortie" and e != s:  # ordre inconnu (04g) : les deux sens doivent concorder
            back, bst = prices_in_window(tariffs, s, e, classe, start, end, tarif)
            if pst != bst or prices != back:
                return {"min_eur": None, "max_eur": None, "statut": "couple_un_seul_sens" if "couple_absent"
                        in (pst, bst) else "couple_asymetrique", "detail": f"{e}<>{s}"}
        if pst not in ("ok", "fourchette"):
            return {"min_eur": None, "max_eur": None, "statut": pst, "detail": f"{e}>{s}"}
        lo += prices[0]
        hi += prices[-1]
        detail.append(f"{e}>{s}:{'/'.join(f'{p:.2f}' for p in prices)}")
    return {"min_eur": round(lo, 2), "max_eur": round(hi, 2), "statut": "ok" if lo == hi else "fourchette",
            "detail": ";".join(detail)}
