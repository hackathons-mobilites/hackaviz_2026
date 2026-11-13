"""Catalogue des abonnements publié dans subscriptions.json (D-032 proposée) : chaque prix et chaque règle de couverture
porte la phrase recopiée qui le fonde (`Quote`), retrouvée dans le fichier gardé par `check_quotes` (contrôle 07).

Prix : lus dans le jeu IDFM titres-et-tarifs (SUB01, source principale) quand il donne un prix unique ; sinon (prix en
pourcentage, « Gratuit ») la page du titre le donne. Couverture (vocabulaire des itinéraires, `starway.subscriptions.
FAMILIES`) : `yes` / `no` seulement avec une citation, sinon `unknown` et une raison affichable.
Tarifs au 1er janvier 2026 (IDFM) et à partir du 12 août 2025 (Vélib') : en vigueur le jour de service (17/11/2026).
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from starway.subscriptions import FAMILIES, Quote, parse_price, quote_found, record_of

GRILLE_SHA = "490ab129bf716cb1ddf397cce73790476fac537b200556e039cd5cba01a168ca"
CGAU_LD_SHA = "61ea4f8ded5d27487d8b03c4fab2bc4c7a111ab88c4d02b0955e25172feaad3d"
CGAU_CD_SHA = "bca3c8cca597fff053eabe0773ed97deb6ab9c231c5c629fbd1d9f795c96cdda"

MOIS = "COST01/forfait-navigo-mois.html"
TARIFS = "COST02/tarifs-2026.html"
CGVU_MS = "SUB02/cgvu-forfaits-navigo-mois-navigo-semaine.html"
CGVU_AN = "SUB02/cgvu-du-forfait-navigo-annuel.html"
CGVU_IR = "SUB02/cgvu-imagine-r-etudiant-2026-2027.html"
CGVU_LP = "SUB02/cgvu-navigo-liberte.html"
PAGE = "SUB03/{}.html"
VELIB = "SUB04/velib-offers.html"


def q(source_id: str, file: str, text: str, pdf_sha256: str | None = None) -> Quote:
    return Quote(source_id, file, text, pdf_sha256)


def p(slug: str, text: str) -> Quote:
    return q("SUB03", PAGE.format(slug), text)


AIRPORT_MODES = "Train Aéroports Câble C1"  # liste « Modes de Transport (7) » des pages qui citent les aéroports
REGULAR_LINES = q("SUB02", CGVU_MS, "Les lignes régulières de transport en commun des Transporteurs.")
MS_TER = q("SUB02", CGVU_MS, "Les trains TER ou Intercités (hors réservation obligatoire) en 2ème classe. "
                             "Les parcours doivent être intégralement réalisés en Île-de-France.")
MS_ORLYVAL = q("SUB02", CGVU_MS, "Il n’est pas valable sur : Orlyval.")
AN_LINES = q("SUB02", CGVU_AN, "le forfait Navigo Annuel permet de voyager sur les lignes régulières de transport en "
                               "commun des Transporteurs")
AN_TER = q("SUB02", CGVU_AN, "les trains TER ou Intercités (hors réservation obligatoire) en 2ème classe. Les parcours "
                             "doivent être intégralement réalisés en Île-de-France.")
AN_ORLYVAL = q("SUB02", CGVU_AN, "Il n’est pas valable sur Orlyval, le TGV")
IR_LINES = q("SUB02", CGVU_IR, "le forfait imagine R Étudiant permet de voyager sur les lignes régulières de transport "
                               "en commun des Transporteurs")
IR_TER = q("SUB02", CGVU_IR, "les trains TER ou Intercités (hors réservation obligatoire) en 2ème classe. Les parcours "
                             "doivent être intégralement réalisés en Île-de-France.")
IR_ORLYVAL = q("SUB02", CGVU_IR, "Il n’est pas valable sur Orlyval, le TGV")
PARKING = "Parkings Vélos : une place offerte fermée et sécurisée."

UNKNOWN_TER = "TER : la page de ce titre ne cite pas les TER, et ses conditions générales n'ont pas été lues"
UNKNOWN_AIRPORT = "aéroports (RER B, métro 14) : la page de ce titre ne les cite pas parmi ses modes"
UNKNOWN_ORLYVAL = "Orlyval : la page de ce titre ne dit pas s'il est couvert"


def _cover(rail: str, surface: str, ter: str, airport_rail: str, orlyval: str) -> dict[str, str]:
    return {"rail": rail, "surface": surface, "ter": ter, "airport_rail": airport_rail, "orlyval": orlyval}


def transit_options(records: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Abonnements TC proposés, dans l'ordre d'affichage. `price.eur` : prix publié (None si fixé ailleurs)."""

    def sub01(name: str, price_text: str, period: str) -> tuple[float, dict[str, Any]]:
        r = record_of(records, name)
        if r.get("price") != price_text or r.get("price_period") != period:
            raise ValueError(f"SUB01 « {name} » : prix {r.get('price')!r} / {r.get('price_period')!r}, attendus "
                             f"{price_text!r} / {period!r}")
        value = parse_price(price_text)
        if value is None:
            raise ValueError(f"SUB01 « {name} » : prix illisible {price_text!r}")
        return value, {"source_id": "SUB01", "file": "SUB01/titres-et-tarifs.json", "record": name,
                       "field": "price", "value": price_text, "period": period}

    navigo_cover = _cover("yes", "yes", "yes", "yes", "no")
    out: list[dict[str, Any]] = []

    eur, src = sub01("Forfait Navigo Mois", "90,80€", "par mois")
    out.append({
        "id": "navigo_month", "label": "Navigo Mois", "kind": "pass", "audience": "all", "zones": "1-5",
        "price": {"eur": eur, "per": "month", "text": "90,80 € par mois, toutes zones", "record": src,
                  "quotes": [q("COST01", MOIS, "Tarifs du forfait applicables au 1er janvier 2026.")]},
        "covers": navigo_cover,
        "cover_quotes": [REGULAR_LINES, MS_TER, MS_ORLYVAL, q("COST01", MOIS, AIRPORT_MODES),
                         q("COST01", MOIS, "Ne sont pas inclus : Orlyval, Bus Direct Paris-Aéroport (ex-Cars Air "
                                           "France), les navettes VEA Disney et les bus touristiques (OpenTour, Cars "
                                           "Rouges).")],
        "employer": True, "bike_parking": False, "conditions": None})

    eur, src = sub01("Forfait Navigo Semaine", "32,40€", "par semaine")
    out.append({
        "id": "navigo_week", "label": "Navigo Semaine", "kind": "pass", "audience": "all", "zones": "1-5",
        "price": {"eur": eur, "per": "week", "text": "32,40 € par semaine (du lundi au dimanche), toutes zones",
                  "record": src,
                  "quotes": [p("forfait-navigo-semaine", "Tarifs du forfait applicables au 1er janvier 2026"),
                             p("forfait-navigo-semaine", "Le forfait est valable pendant une semaine fixe, du lundi "
                                                         "au dimanche .")]},
        "covers": navigo_cover,
        "cover_quotes": [REGULAR_LINES, MS_TER, MS_ORLYVAL, p("forfait-navigo-semaine", AIRPORT_MODES)],
        "employer": True, "bike_parking": False, "conditions": None})

    eur, src = sub01("Forfait Navigo Annuel", "90,80€", "par mois")
    out.append({
        "id": "navigo_annual", "label": "Navigo Annuel", "kind": "pass", "audience": "all", "zones": "1-5",
        "price": {"eur": eur, "per": "month",
                  "text": "90,80 € par mois, 12e mois consécutif offert (998,80 € par an au comptant), toutes zones ; "
                          "frais de dossier 7,60 €",
                  "year_eur": 998.8, "record": src,
                  "quotes": [p("forfait-navigo-annuel", "Au comptant : vous ne paierez que les 11 mensualités, pour "
                                                        "12 mois d'utilisation."),
                             p("forfait-navigo-annuel", "Frais de dossier : 7,60€"),
                             q("COST02", TARIFS, "Tarifs Navigo Annuel Zones Tarif annuel Toutes zones 998,80 €")]},
        "covers": navigo_cover,
        "cover_quotes": [AN_LINES, AN_TER, AN_ORLYVAL, p("forfait-navigo-annuel", AIRPORT_MODES)],
        "employer": True, "bike_parking": True,
        "bike_parking_quote": p("forfait-navigo-annuel", PARKING), "conditions": None})

    out.append({
        "id": "navigo_senior", "label": "Navigo Annuel Tarification Senior", "kind": "pass", "audience": "conditions",
        "zones": "1-5",
        "price": {"eur": 45.4, "per": "month", "text": "45,40 € par mois (544,80 € par an), toutes zones ; frais de "
                                                       "dossier 7,60 €",
                  "year_eur": 544.8, "record": None,
                  "quotes": [p("forfait-navigo-annuel-tarification-senior",
                               "Toutes zones 1 à 5 45,40 € Tarifs applicables au 1er janvier 2026."),
                             q("COST02", TARIFS, "Senior : 544,80 € par an")]},
        "covers": navigo_cover,
        "cover_quotes": [AN_LINES, AN_TER, AN_ORLYVAL,
                         q("SUB02", CGVU_AN, "2.2.1 La souscription au forfait « Navigo Annuel Tarification Senior » "
                                             "est uniquement « toutes zones », donc valable sur les zones 1-5."),
                         p("forfait-navigo-annuel-tarification-senior", AIRPORT_MODES)],
        "employer": True, "bike_parking": True,
        "bike_parking_quote": p("forfait-navigo-annuel-tarification-senior", PARKING),
        "conditions": "62 ans ou plus, sans activité professionnelle ou à moins d'un mi-temps",
        "condition_quotes": [p("forfait-navigo-annuel-tarification-senior", "Vous avez 62 ans ou plus"),
                             p("forfait-navigo-annuel-tarification-senior",
                               "Vous n’exercez pas d’activité professionnelle ou travaillez strictement moins qu’à "
                               "mi-temps")]})

    eur, src = sub01("Forfait imagine R Étudiant", "401,30€", "par an")
    out.append({
        "id": "imagine_r_student", "label": "imagine R Étudiant", "kind": "pass", "audience": "conditions",
        "zones": "1-5",
        "price": {"eur": eur, "per": "year", "text": "401,30 € par an, frais de dossier inclus (payable en 9 "
                                                     "mensualités ou en une fois), toutes zones",
                  "record": src,
                  "quotes": [p("forfait-imagine-r-etudiant", "Payable en 9 mensualités ou en une seule fois.")]},
        "covers": navigo_cover,
        "cover_quotes": [IR_LINES, IR_TER, IR_ORLYVAL, p("forfait-imagine-r-etudiant", AIRPORT_MODES)],
        "employer": True, "employer_note": "stage ou alternance : remboursé à 50 % au moins par l'employeur",
        "employer_quote": p("forfait-imagine-r-etudiant",
                            "Stage ou alternance ? Remboursement de 50 % minimum par votre employeur."),
        "bike_parking": True, "bike_parking_quote": p("forfait-imagine-r-etudiant", PARKING),
        "conditions": "étudiant de moins de 26 ans résidant en Île-de-France",
        "condition_quotes": [p("forfait-imagine-r-etudiant", "Vous êtes étudiant et avez moins de 26 ans")]})

    sol_cond = ("bénéficiaires de la Complémentaire santé solidaire sans participation financière et leur foyer, ou "
                "demandeurs d'emploi bénéficiaires de l'Allocation de solidarité spécifique (ASS)")
    sol_q = [p("solidarite-75", "Les bénéficiaires de la Couverture Maladie Universelle Complémentaire CMU-C / "
                                "Complémentaire Santé Solidaire (CSS) sans participation financière, ainsi que les "
                                "membres de leur foyer"),
             p("solidarite-75", "Les demandeurs d’emploi bénéficiaires de l’ Allocation de Solidarité Spécifique "
                                "(ASS)")]
    sol_price_q = [p("solidarite-75", "1 à 5 (Toutes zones) 8,10 € 22,70 €"),
                   p("solidarite-75", "Tarifs applicables au 1er janvier 2026")]
    out.append({
        "id": "solidarity75_month", "label": "Navigo Mois Solidarité 75 %", "kind": "pass", "audience": "conditions",
        "zones": "1-5",
        "price": {"eur": 22.7, "per": "month", "text": "22,70 € par mois, toutes zones", "record": None,
                  "quotes": sol_price_q},
        "covers": _cover("yes", "yes", "unknown", "unknown", "unknown"),
        "unknown_reasons": {"ter": UNKNOWN_TER, "airport_rail": UNKNOWN_AIRPORT, "orlyval": UNKNOWN_ORLYVAL},
        "cover_quotes": [p("solidarite-75", "Modes de Transport (6) Métro RER Bus Tram Train Câble C1")],
        "employer": True, "bike_parking": False, "conditions": sol_cond, "condition_quotes": sol_q})
    out.append({
        "id": "solidarity75_week", "label": "Navigo Semaine Solidarité 75 %", "kind": "pass",
        "audience": "conditions", "zones": "1-5",
        "price": {"eur": 8.1, "per": "week", "text": "8,10 € par semaine, toutes zones", "record": None,
                  "quotes": sol_price_q},
        "covers": navigo_cover,
        "cover_quotes": [p("solidarite-75", "Le Forfait Navigo Solidarité 75% Semaine a les mêmes caractéristiques "
                                            "que le forfait Navigo correspondant (réseaux accessibles, remboursement "
                                            "employeur)."), REGULAR_LINES, MS_TER, MS_ORLYVAL,
                         p("forfait-navigo-semaine", AIRPORT_MODES)],
        "employer": True, "bike_parking": False, "conditions": sol_cond, "condition_quotes": sol_q})

    r = record_of(records, "Solidarité Gratuité")
    if (r.get("price"), r.get("price_indication")) != ("Gratuit", "toutes zones"):
        raise ValueError(f"SUB01 « Solidarité Gratuité » : {r.get('price')!r} / {r.get('price_indication')!r}")
    out.append({
        "id": "solidarity_free", "label": "Solidarité Gratuité", "kind": "pass", "audience": "conditions",
        "zones": "1-5",
        "price": {"eur": 0.0, "per": "month", "text": "gratuit, toutes zones (droits attribués tous les 3 mois)",
                  "record": {"source_id": "SUB01", "file": "SUB01/titres-et-tarifs.json",
                             "record": "Solidarité Gratuité", "field": "price", "value": "Gratuit",
                             "period": r.get("price_period")},
                  "quotes": []},
        "covers": _cover("yes", "yes", "unknown", "unknown", "unknown"),
        "unknown_reasons": {"ter": "TER : la page de ce titre n'a pas pu être lue (refusée au robot le 04/11)",
                            "airport_rail": "aéroports : la page de ce titre n'a pas pu être lue (refusée au robot "
                                            "le 04/11)",
                            "orlyval": "Orlyval : la page de ce titre n'a pas pu être lue (refusée au robot le "
                                       "04/11)"},
        "cover_quotes": [], "cover_records": {"short_description": r.get("short_description"),
                                              "selling_arguments": r.get("selling_arguments")},
        "employer": False, "bike_parking": False,
        "conditions": "bénéficiaires d'aides sociales (conditions sur la page IDFM du titre)", "condition_quotes": []})

    r = record_of(records, "Forfait Gratuité jeunes en insertion")
    if (r.get("price"), r.get("price_period")) != ("Gratuit", "par mois"):
        raise ValueError(f"SUB01 « Forfait Gratuité jeunes en insertion » : {r.get('price')!r}")
    ins_q = p("le-forfait-gratuite-jeunes-en-insertion",
              "Il est valable sur tous les modes de transport (métro, bus, train, RER, tram), à l’exception de "
              "certaines dessertes directes d’aéroports (Orlyval, Bus Direct Paris-Aéroport ex-Cars Air France, "
              "navettes VEA Disney) et des bus touristiques (OpenTour, Cars Rouges).")
    out.append({
        "id": "insertion_free", "label": "Gratuité jeunes en insertion", "kind": "pass", "audience": "conditions",
        "zones": "1-5",
        "price": {"eur": 0.0, "per": "month", "text": "gratuit, rechargeable chaque mois jusqu'à la fin du stage",
                  "record": {"source_id": "SUB01", "file": "SUB01/titres-et-tarifs.json",
                             "record": "Forfait Gratuité jeunes en insertion", "field": "price", "value": "Gratuit",
                             "period": "par mois"},
                  "quotes": [p("le-forfait-gratuite-jeunes-en-insertion",
                               "Ce forfait permet de voyager gratuitement dans toute l’Île-de-France.")]},
        "covers": _cover("yes", "yes", "unknown", "yes", "no"),
        "unknown_reasons": {"ter": "TER : la page de ce titre cite le train sans nommer les TER"},
        "cover_quotes": [ins_q], "employer": False, "bike_parking": False,
        "conditions": "16 à 25 ans, stagiaire de la formation professionnelle (Avenir Jeunes, Programme Compétences, "
                      "École de la Deuxième chance)",
        "condition_quotes": [p("le-forfait-gratuite-jeunes-en-insertion", "avoir entre 16 et 25 ans")]})

    am_q = p("forfait-amethyste",
             "À l’intérieur des zones de validité, le forfait Améthyste est valable sur tous les modes de transport "
             "(métro, bus, train, RER, tram), à l’exception de certaines dessertes directes d’aéroports (Orlyval, Bus "
             "Direct Paris-Aéroport ex-Cars Air France, navettes VEA Disney)")
    out.append({
        "id": "amethyste_1_5", "label": "Améthyste zones 1 à 5", "kind": "pass", "audience": "conditions",
        "zones": "1-5",
        "price": {"eur": None, "per": "year", "text": "prix fixé par votre département (gratuit ou avec une "
                                                     "participation)", "record": None,
                  "reason": "chaque département fixe les conditions, les zones et une éventuelle participation",
                  "quotes": [p("forfait-amethyste", "Il est financé par les Départements d’Île-de-France, qui "
                                                    "décident des conditions d’éligibilité et des zonages de validité "
                                                    "attribués. Ils peuvent également demander une participation "
                                                    "financière aux bénéficiaires.")]},
        "covers": _cover("yes", "yes", "unknown", "yes", "no"),
        "unknown_reasons": {"ter": "TER : la page de ce titre cite le train sans nommer les TER"},
        "cover_quotes": [am_q], "employer": False, "bike_parking": False,
        "conditions": "personnes âgées ou handicapées sous conditions, selon le département (le Val-de-Marne n'est "
                      "pas dans la liste de la page)",
        "condition_quotes": [p("forfait-amethyste", "Le Forfait Améthyste est réservé aux personnes âgées ou "
                                                    "handicapées sous conditions de ressources ou de statut, "
                                                    "résidant en Île-de-France."),
                             p("forfait-amethyste", "Ville de Paris : Améthyste Émeraude zones 1-5. Seine-et-Marne : "
                                                    "Améthyste zones 1-5 ou 4-5. Yvelines : Améthyste zones 1-5 ou "
                                                    "3-5. Essonne : Améthyste zones 1-5 ou 3-5. Hauts-de-Seine : "
                                                    "Améthyste zones 1-5. Seine-Saint-Denis : Améthyste zones 1-5, "
                                                    "2-5 ou 3-5. Val d’Oise : Améthyste zones 1-5, 3-5 ou 4-5.")]})

    eur, src = sub01("Forfait Navigo Jour", "12,30€", "par jour")
    out.append({
        "id": "navigo_day", "label": "Navigo Jour", "kind": "day", "audience": "all", "zones": "1-5",
        "price": {"eur": eur, "per": "day", "text": "12,30 € par jour, toutes zones, hors aéroports", "record": src,
                  "quotes": [p("forfait-navigo-jour", "Tarif valable dans les zones 1 à 5 , hors dessertes "
                                                      "aéroportuaires .")]},
        "covers": _cover("yes", "yes", "unknown", "no", "no"),
        "unknown_reasons": {"ter": "TER : la page du Navigo Jour cite le train sans nommer les TER"},
        "cover_quotes": [p("forfait-navigo-jour", "Voyagez en illimité pendant une journée dans les zones 1 à 5 , sur "
                                                  "le métro, le train, le RER, le tramway et les bus, y compris "
                                                  "Filéo."),
                         p("forfait-navigo-jour", "Ne sont pas inclus : les trajets vers les aéroports avec la ligne "
                                                  "14 vers Orly ou le RER B vers Paris-Charles de Gaulle ; Orlyval ;")],
        "employer": False, "bike_parking": False, "conditions": None})
    for o in out:
        o.setdefault("unknown_reasons", {})
    return out


EXTRA_TITLES = {
    "orlyval_ticket": {"label": "Ticket Orlyval", "eur": 14.0,
                       "quote": q("COST02", TARIFS, "Ticket Orlyval (plein tarif) 14,00 €")},
    "airport_ticket": {"label": "Ticket Paris Région <> Aéroports", "eur": 14.0,
                       "quote": q("COST02", TARIFS, "Ticket Paris Région ↔ Aéroports à l’unité (plein tarif) 14,00 €")},
}

# Prix à l'unité (plein tarif) des tickets que le pipeline compte dans `tickets` d'un itinéraire (fares_carbon.TICKET_PRICES_EUR) :
# le site en tire la part de chaque ticket dans le coût d'un sens (anneau du « i » du coût, 12/11). Mêmes montants, mêmes citations.
UNIT_TICKETS = {
    "metro_train_rer": {"label": "Ticket Métro-Train-RER", "eur": 2.55,
                        "quote": q("COST02", TARIFS, "Ticket Métro -Train-RER à l’unité (plein tarif) 2,55 €")},
    "bus_tram": {"label": "Ticket Bus-Tram", "eur": 2.05,
                 "quote": q("COST02", TARIFS, "Ticket Bus-Tram à l’unité (plein tarif) 2,05 €")},
    "airport": {"label": "Ticket Paris Région <> Aéroports", "eur": 14.0,
                "quote": q("COST02", TARIFS, "Ticket Paris Région ↔ Aéroports à l’unité (plein tarif) 14,00 €")},
}


UNPRICED_AGENCIES = {
    "Magical Shuttle": "navette Magical Shuttle (vers les aéroports) : aucune page IDFM relevée ne donne son titre, et le "
                       "calculateur d'IDFM lui applique un prix à part : coût non calculé",
}


def not_proposed(ter_legs: int | None) -> list[dict[str, Any]]:
    """Titres écartés, avec la raison affichable (rien n'est proposé sans donnée)."""
    ter = (f"{ter_legs:,} tronçons en TER dans les itinéraires publiés : ".replace(",", " ") if ter_legs is not None else "")
    return [
        {"id": "navigo_zones", "label": "Navigo Mois, Semaine ou Annuel deux zones (2-3, 3-4, 4-5)",
         "reason": "Les zones des arrêts existent (GTFS IDFM, champ zone_id), mais les conditions générales lues "
                   "disent seulement « valable sur les zones souscrites » : elles ne disent pas si l'on compte les "
                   "arrêts de montée et de descente ou tous les arrêts traversés, ni ce qu'il en est des bus. Prix "
                   "publiés : Navigo Mois 2-3 88,80 €, 3-4 86,40 €, 4-5 84,40 €.",
         "quotes": [q("SUB02", CGVU_MS, "valable sur les zones souscrites, parmi les couples de zones 2-3, 3-4 et 4-5."),
                    q("COST02", TARIFS, "Zone 2-3 88,80 € Zone 3-4 86,40 € Zone 4-5 84,40 €")]},
        {"id": "liberte_plus", "label": "Navigo Liberté + (paiement au trajet)",
         "reason": "Ses règles ne sont pas celles des tickets : une correspondance entre métro, RER ou train et bus ou "
                   "tram est offerte pendant 1h30, les trajets de Roissy ont un tarif selon la gare, et le total "
                   "d'une journée est plafonné au prix du Navigo Jour. Pas encore calculé trajet par trajet. Prix : "
                   "2,04 € (métro, train, RER), 1,64 € (bus, tram, câble), 14 € (aéroports).",
         "quotes": [p("liberte-plus", "Metro-Train-RER 2,04 € 1,02 € Bus-Tram-Câble 1,64 € 0,82 €"),
                    p("liberte-plus", "Une fois le tarif d’un Navigo Jour atteint dans la même journée , le reste de "
                                      "vos déplacements est offert (hors trajets vers les aéroports)."),
                    q("SUB02", CGVU_LP, "3.7 Les correspondances entre le réseau ferré (Métro, RER, Train) et de "
                                        "surface (Bus, Tramway, Tzen et Câble) sont offertes (trajet surface non "
                                        "facturé) dans les conditions suivantes")]},
        {"id": "ter_subscription", "label": "Abonnement TER (SNCF, hors Île-de-France Mobilités)",
         "reason": ter + "en Île-de-France, les TER se prennent avec les tickets et forfaits d'Île-de-France "
                   "Mobilités. Un abonnement TER de la SNCF sert pour un trajet dont un bout est hors de la région ; "
                   "toutes les communes et tous les pôles de STARWAY sont en Île-de-France.",
         "quotes": [MS_TER, q("SUB02", CGVU_MS, "pour les parcours entre une gare située hors Île-de-France et une gare "
                                                "en Île-de-France")]},
        {"id": "imagine_r_scolaire", "label": "imagine R Scolaire (élèves et apprentis)",
         "reason": "Page du titre refusée au robot le 04/11 : ce qu'il couvre n'a pas été lu. Prix du jeu IDFM : "
                   "401,30 € par an, frais de dossier inclus."},
        {"id": "imagine_r_junior", "label": "imagine R Junior",
         "reason": "Réservé aux moins de 11 ans : sans objet pour un trajet domicile-travail."},
        {"id": "reductions", "label": "Réduction 50 % (Aide médicale d'État, Service civique), titres pour personnes "
                                     "en situation de handicap et accompagnants",
         "reason": "Tarifs réduits sous conditions : pages non relues pour ce chantier. Prix publié par IDFM pour le "
                   "Navigo Mois Réduction 50 % toutes zones : 45,40 €.",
         "quotes": [q("COST02", TARIFS, "Tarif Forfait Navigo Réduction 50 % Mois Zones Tarif Toutes zones 45,40 €")]},
        {"id": "tourism_events", "label": "Paris Visite, forfait antipollution, Fête de la musique",
         "reason": "Titres touristiques ou d'un jour d'événement, pas des abonnements de trajet domicile-travail."},
        {"id": "school", "label": "Carte Scol'R, carte scolaire bus",
         "reason": "Circuits et trajets scolaires seulement."},
        {"id": "withdrawn", "label": "Ticket t+, billet Origine-Destination",
         "reason": "Plus vendus (jeu IDFM : « Ce titre n’est plus vendu », « Ces titres ne sont plus vendus »)."},
        {"id": "onboard", "label": "Ticket d'accès à bord (SMS, carte bancaire)",
         "reason": "Ticket de bus acheté à bord : un titre à l'unité, pas un abonnement."},
    ]


# ----------------------------------------------------------------------------- Vélib'

def velib_offers() -> list[dict[str, Any]]:
    """Offres Vélib' (vélo mécanique : nos durées sont celles du vélo de r5py). `ride` : minutes incluses, prix par
    course, prix par tranche de 30 min au-delà ; règle des tranches et plafond : CGAU (PDF, citations liées à
    l'empreinte)."""
    slice_rule = q("SUB04", "SUB04/CGAU_LD_Octobre_2026.pdf",
                   "Les 30 premières minutes concernent les courses d'une durée inférieure ou égale à 29 min 59 sec. "
                   "Ce raisonnement s'applique à chaque tranche de 30 min.", CGAU_LD_SHA)
    cap = q("SUB04", "SUB04/CGAU_LD_Octobre_2026.pdf",
            "Un plafond de facturation des usages d'une course est fixé à 18 euros TTC pour un trajet effectué à "
            "Velib' mécanique quelle que soit l'offre souscrite", CGAU_LD_SHA)
    reduced = q("SUB04", "SUB04/velib-grille-tarifaire.pdf",
                "Jeune : tarif réservé aux moins de 27 ans. Senior : tarif réservé aux 60 ans et plus. Solidaire : "
                "boursiers, jeunes en insertion et bénéficiaires de la gratuité transport Ile-de-France Mobilité.",
                GRILLE_SHA)
    return [
        {"id": "ticket_v", "label": "Ticket-V (sans abonnement)", "kind": "ride", "audience": "all",
         "price": {"eur": 3.0, "per": "ride", "text": "3 € la course, 45 minutes incluses"},
         "ride": {"included_min": 45, "step_min": 30, "per_ride_eur": 3.0, "beyond_eur": None, "cap_eur": 18.0,
                  "beyond_reason": "au-delà de 45 min, la page Offres affiche deux prix (1 € et 2 € par 30 min) "
                                   "sans dire lequel vaut pour le vélo mécanique : non calculé"},
         "quotes": [q("SUB04", VELIB, "Ticket-V 3 € Un trajet en Vélib’ mécanique ou électrique (au choix) Inclus 45 "
                                      "minutes"),
                    q("SUB04", "SUB04/CGAU_CD_Ocotbre_2026.pdf",
                      "Le Ticket-V ne permet qu'une seule et unique location de Vélo.", CGAU_CD_SHA), cap],
         "employer": False},
        {"id": "v_libre", "label": "V-Libre", "kind": "subscription", "audience": "all",
         "price": {"eur": 0.0, "per": "month", "text": "0 € par mois (engagement 12 mois), frais d'inscription 6 €"},
         "ride": {"included_min": 0, "step_min": 30, "per_ride_eur": 0.0, "beyond_eur": 1.0, "cap_eur": 18.0},
         "quotes": [q("SUB04", VELIB, "V-Libre 0 € / mois* *Frais d’inscription : 6 €"),
                    q("SUB04", VELIB, "V-Libre Pour les utilisateurs occasionnels 0-30 min Au-delà 1 € 1 € / 30min"),
                    slice_rule, cap],
         "employer": True},
        {"id": "v_plus", "label": "V-Plus", "kind": "subscription", "audience": "all",
         "price": {"eur": 4.3, "per": "month", "text": "4,30 € par mois (51,60 € par an), 30 minutes incluses par course",
                   "variants": [{"label": "Jeune", "eur": 3.22}, {"label": "Senior", "eur": 3.22},
                                {"label": "Solidaire", "eur": 2.15}]},
         "ride": {"included_min": 30, "step_min": 30, "per_ride_eur": 0.0, "beyond_eur": 1.0, "cap_eur": 18.0},
         "quotes": [q("SUB04", VELIB, "V-Plus 4,30 € / mois Pour les utilisateurs réguliers (plus de 4 trajets par "
                                      "mois) Inclus 30 minutes en Vélib’ mécanique"),
                    q("SUB04", VELIB, "0-30 min Au-delà gratuit 1 € / 30min"), slice_rule, cap, reduced],
         "employer": True},
        {"id": "v_max", "label": "V-Max", "kind": "subscription", "audience": "all",
         "price": {"eur": 9.3, "per": "month", "text": "9,30 € par mois (111,60 € par an), 60 minutes incluses par "
                                                       "course",
                   "variants": [{"label": "Jeune", "eur": 7.0}, {"label": "Senior", "eur": 7.0},
                                {"label": "Solidaire", "eur": 4.65}]},
         "ride": {"included_min": 60, "step_min": 30, "per_ride_eur": 0.0, "beyond_eur": 1.0, "cap_eur": 18.0},
         "quotes": [q("SUB04", VELIB, "V-Max 9,30 € / mois Idéal pour les trajets en électrique Inclus 60 minutes en "
                                      "Vélib’ mécanique"),
                    q("SUB04", VELIB, "V-Max Idéal pour les trajets en électrique 0-60 min Au-delà gratuit 1 € / 30min"),
                    cap, reduced],
         "employer": True},
        {"id": "pass_24h", "label": "Pass 24h classique", "kind": "day", "audience": "all",
         "price": {"eur": 5.0, "per": "day", "text": "5 € pour 24 heures, 30 minutes incluses par course"},
         "ride": {"included_min": 30, "step_min": 30, "per_ride_eur": 0.0, "beyond_eur": 1.0, "cap_eur": 18.0},
         "quotes": [q("SUB04", VELIB, "Pass 24h Classique 5 € 24 heures à Vélib’ (électrique en supplément) Inclus 30 "
                                      "minutes en Vélib’ mécanique"),
                    q("SUB04", VELIB, "Pass 24h Classique 24 heures à Vélib’ (électrique en supplément) 0-30 min "
                                      "Au-delà gratuit 1 € / 30min"), cap],
         "employer": False},
    ]


EMPLOYER = {
    "text": "Salarié du secteur privé : l'employeur prend en charge 50 % du prix de l'abonnement (transports publics "
            "ou Vélib'), sur la base de l'abonnement qui suffit pour le trajet. Les tickets à l'unité ne sont pas "
            "remboursés.",
    "scope": "salariés du secteur privé (sous un mi-temps, la prise en charge est proportionnelle aux heures "
             "travaillées) ; agents publics : autre texte, non lu ; une personne qui cherche un emploi n'a pas encore "
             "d'employeur",
    "to_verify": "les quatre articles (L3261-2, R3261-1, R3261-2, R3261-3) ont été lus le 05/11/2026 sur le Code du "
                 "travail numérique (identifiants Légifrance identiques), pas sur Légifrance (403 au robot) : un humain "
                 "peut les relire ; Vélib' : d'après le BOFiP (doctrine fiscale, § 110), les abonnements d'une "
                 "location de vélos en libre service mise en place par une personne publique, « Vélib' » en exemple, "
                 "sont des abonnements à un service public de location de vélos ; l'AGEMOB présente Velib' Métropole "
                 "comme un service public exploité dans le cadre d'un marché public ; ni l'un ni l'autre n'est un avis "
                 "juridique",
    "quotes": [q("SUB05", "SUB05/code-travail-r3261-1.html",
                 "La prise en charge par l'employeur des titres d'abonnement, prévue à l'article L. 3261-2 , est égale à "
                 "50 % du coût de ces titres pour le salarié."),
               q("SUB05", "SUB05/code-travail-l3261-2.html",
                 "au moyen de transports publics de personnes ou de services publics de location de vélos."),
               q("SUB05", "SUB05/code-travail-r3261-2.html", "3° Les abonnements à un service public de location de "
                                                             "vélos."),
               q("SUB05", "SUB05/code-travail-r3261-3.html",
                 "la prise en charge est effectuée sur la base de l'abonnement qui permet strictement de faire ce "
                 "dernier trajet."),
               q("SUB05", "SUB05/service-public-F19846.html",
                 "Les titres de transport achetés à l'unité ne sont pas remboursables."),
               q("SUB05", "SUB05/doctrine-bofip-BOI-RSA-CHAMP-20-30-10-20-20260407.html",
                 "les abonnements à un service public de location de vélos, qui s’entendent des abonnements mis en "
                 "place par une personne publique, en régie ou dans le cadre d’une convention de délégation de "
                 "service public comme les locations de vélos en libre service mises en place par plusieurs grandes "
                 "villes (par exemple : « Vélib ’» à Paris)."),
               q("SUB05", "SUB05/doctrine-bofip-BOI-RSA-CHAMP-20-30-10-20-20260407.html",
                 "Les salariés dont le temps de travail est inférieur à un mi-temps bénéficient d’une prise en charge "
                 "obligatoire à due proportion du nombre d’heures travaillées par rapport au mi-temps."),
               q("SUB04", "SUB04/agemob-velib-le-velo-partage.html",
                 "Le service public Velib’ Métropole a pour aire géographique d’implantation le territoire de la "
                 "Métropole du Grand Paris."),
               q("SUB04", "SUB04/agemob-velib-le-velo-partage.html",
                 "Depuis 2018, le service de vélos en libre-service Velib’ Métropole est exploité dans le cadre d’un "
                 "marché public."),
               q("SUB04", "SUB04/CGAU_CD_Ocotbre_2026.pdf", "au titre de l'exploitation du service public Velib'",
                 CGAU_CD_SHA)],
}

BIKE = {
    "personal": {"text": "Vélo personnel : aucun titre de transport."},
    "parking": {"text": "Parkings Vélos IDFM en gare : une place offerte, fermée et sécurisée, avec un Navigo Annuel "
                        "(y compris Tarification Senior) ou un imagine R Étudiant.",
                "scope": "Information générale : le calcul vélo + TC ne dit pas à quelle gare le vélo est garé ni si "
                         "elle a un Parking Vélos",
                "without": "Sans ces forfaits : conditions sur la page IDFM « Parkings Vélos » (non relue, refusée au "
                           "robot le 04/11).",
                "options": ["navigo_annual", "navigo_senior", "imagine_r_student"]},
}

CAR = {"options": [],
       "status": "not_proposed",
       "reason": "Pas d'abonnement voiture. Badge télépéage du Duplex A86 : chantier « coût voiture » ; il sera proposé "
                 "ici quand son tarif sera publié avec les véhicules (meta.vehicles[].tolls), pas avant."}

TEXTS = {
    "no_subscription": "hors abonnement",
    "ticket_scope": "prix au ticket à l'unité, plein tarif (tarifs au 1er janvier 2026)",
    "never_divided": "Le prix d'un abonnement n'est pas divisé par un nombre de trajets : nous ne connaissons pas "
                     "votre nombre de jours de travail.",
    "velib_ride": "Coût d'une course en Vélib' mécanique, d'après la durée de la partie vélo calculée (prise et dépose "
                  "du vélo non comptées). Vélo électrique et Minutes Bonus non calculés.",
    "would_cover": "Ces titres couvriraient ce trajet",
}


def all_quotes(catalog: Mapping[str, Any]) -> list[Quote]:
    """Toutes les citations d'un catalogue (objets Quote, avant sérialisation)."""
    found: list[Quote] = []

    def walk(x: Any) -> None:
        if isinstance(x, Quote):
            found.append(x)
        elif isinstance(x, Mapping):
            for v in x.values():
                walk(v)
        elif isinstance(x, list | tuple):
            for v in x:
                walk(v)
    walk(catalog)
    return found


def check_quotes(catalog: Mapping[str, Any], raw_dir: Path, sha256_of: Callable[[Path], str]) -> list[str]:
    """Citations introuvables (liste vide = tout est fondé)."""
    bad = []
    for qt in all_quotes(catalog):
        ok, detail = quote_found(qt, raw_dir, sha256_of)
        if not ok:
            bad.append(f"{qt.source_id} {detail} : « {qt.text[:80]} »")
    return bad


def to_json(x: Any) -> Any:
    """Sérialise le catalogue (les Quote deviennent {source_id, file, quote})."""
    if isinstance(x, Quote):
        return x.as_json()
    if isinstance(x, Mapping):
        return {k: to_json(v) for k, v in x.items()}
    if isinstance(x, list | tuple):
        return [to_json(v) for v in x]
    return x


def build_catalog(raw_dir: Path, ter_legs: int | None = None) -> dict[str, Any]:
    records = json.loads((raw_dir / "SUB01" / "titres-et-tarifs.json").read_text(encoding="utf-8"))
    meta = json.loads((raw_dir / "SUB01" / "titres-et-tarifs_dataset.json").read_text(encoding="utf-8"))
    dm = meta["metas"]["default"]
    if dm.get("license") != "Licence Ouverte v2.0 (Etalab)":
        raise ValueError(f"SUB01 : licence inattendue {dm.get('license')!r}")
    return {
        "families": FAMILIES,
        "transit": {"options": transit_options(records), "extra_titles": EXTRA_TITLES,
                            "unit_tickets": UNIT_TICKETS,
                            "unpriced_agencies": UNPRICED_AGENCIES,
                    "not_proposed": not_proposed(ter_legs),
                    "dataset": {"source_id": "SUB01", "licence": dm["license"], "modified": dm.get("modified")}},
        "velib": {"offers": velib_offers()},
        "bike": BIKE, "car": CAR, "employer": EMPLOYER, "texts": TEXTS,
    }


# ----------------------------------------------------------------------------- contrôle du fichier publié (07)

def published_problems(published: Mapping[str, Any], raw_dir: Path, sha256_of: Callable[[Path], str],
                       pole_ids: list[str], velib_access: Mapping[str, Mapping[str, list]]) -> list[str]:
    """Écarts du subscriptions.json publié (liste vide = conforme) : contrat, citations retrouvées dans les fichiers
    gardés (celles du fichier PUBLIÉ), couverture et prix fondés, courses Vélib' alignées sur access/ publié
    (`velib_access[insee]` = {out, ret} de modes.velib.any)."""
    bad: list[str] = []
    if published.get("contract") != "subscriptions-1":
        bad.append(f"contrat {published.get('contract')!r}")

    def walk(x: Any) -> None:
        if isinstance(x, Mapping):
            if {"source_id", "file", "quote"} <= set(x):
                qt = Quote(str(x["source_id"]), str(x["file"]), str(x["quote"]), x.get("sha256"))
                ok, detail = quote_found(qt, raw_dir, sha256_of)
                if not ok:
                    bad.append(f"citation {detail} : « {qt.text[:60]} »")
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(published)
    for o in (published.get("transit") or {}).get("options") or []:
        cov = o.get("covers") or {}
        if set(cov) != set(FAMILIES) or any(v not in ("yes", "no", "unknown") for v in cov.values()):
            bad.append(f"{o.get('id')} : couverture {cov}")
        for fam, v in cov.items():
            if v == "unknown" and fam != "rail" and fam != "surface" and not (o.get("unknown_reasons") or {}).get(fam):
                bad.append(f"{o.get('id')} : {fam} inconnu sans raison")
            if v != "unknown" and not o.get("cover_quotes") and not o.get("cover_records"):
                bad.append(f"{o.get('id')} : couverture {fam}={v} sans citation")
                break
        price = o.get("price") or {}
        if price.get("eur") is None and not price.get("reason"):
            bad.append(f"{o.get('id')} : prix null sans raison")
        if price.get("eur") is not None and not (price.get("record") or price.get("quotes")):
            bad.append(f"{o.get('id')} : prix sans source")
    rides = (published.get("velib") or {}).get("rides") or {}
    if set(rides) != set(velib_access):
        bad.append(f"courses Vélib' : {len(rides)} communes contre {len(velib_access)} publiées en Vélib'")
    for insee, r in rides.items():
        acc = velib_access.get(insee)
        if acc is None:
            continue
        for leg in ("out", "ret"):
            if len(r[leg]) != len(pole_ids):
                bad.append(f"{insee} {leg} : {len(r[leg])} valeurs pour {len(pole_ids)} pôles")
                continue
            for i, (ride, total) in enumerate(zip(r[leg], acc[leg], strict=True)):
                if (ride is None) != (total is None) or (ride is not None and not 0 <= ride <= total):
                    bad.append(f"{insee} {pole_ids[i]} {leg} : course {ride} pour un trajet de {total}")
    text = json.dumps(published, ensure_ascii=False)
    if chr(0x2013) in text or chr(0x2014) in text:
        bad.append("tiret long dans le fichier")
    return bad
