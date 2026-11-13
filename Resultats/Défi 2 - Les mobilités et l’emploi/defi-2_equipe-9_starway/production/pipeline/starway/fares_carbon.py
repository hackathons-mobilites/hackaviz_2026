"""Tickets et carbone d'un itinéraire TC détaillé (04h -> export proposé). Logique pure, sans Java.

Tickets (plein tarif, « titre à l'unité », pour qui n'a pas de forfait) : règles relevées le 03/11/2026 (COST02).
- Ticket Métro-Train-RER, 2,55 € (« Tarifs transport titre à l'unité », page IDFM publiée le 10/12/2025, tarifs au
  1er janvier 2026) ; page du ticket : valable sur le métro, le RER, le train, le funiculaire de Montmartre, les
  Intercités et TER en Île-de-France ; « Le ticket permet les correspondances pendant 2 heures à partir de la
  validation d'entrée, sans sortir du réseau : métro-métro, RER/train-RER/train et métro-RER/train. Il n'autorise pas
  les correspondances avec les bus et les tramways. Dans le funiculaire de Montmartre, il ne permet aucune
  correspondance » ; non valable en entrée ou en sortie aux stations Aéroport d'Orly, Aéroport Charles de Gaulle 1 et
  Aéroport Charles de Gaulle 2 TGV, ni sur OrlyVal.
- Ticket Paris Région <> Aéroports, 14,00 € (tarifs au 1er janvier 2026) : métro (ligne 14 jusqu'à l'aéroport d'Orly),
  OrlyVal, RER et train (RER B jusqu'à Charles de Gaulle) ; mêmes correspondances de 2 heures.
- Ticket Bus-Tram, 2,05 € : bus, tram, Tzen et câble, correspondances pendant 1h30 (page IDFM du ticket lue le
  03/11/2026, docs/proposition-cout.md ; même famille « Bus-Tram-Câble » sur la page Navigo Liberté +) ; aller-retour
  et interruption sur une même ligne non autorisés, OrlyBus, RoissyBus et OrlyVal exclus : CGVU du ticket Bus-Tram
  (juin 2026), **lues par un moteur de recherche** (page et PDF en 403 depuis le poste le 03/11 après 15h50 UTC) :
  à vérifier par un humain (`BUS_TRAM_RULE_STATUS`).

Ce qui n'est pas couvert par ces sources donne `None` avec une raison, jamais un prix deviné : CDG VAL, navettes
privées, lignes au tarif spécifique.

Corrections du 04/11/2026 (recoupement 07k avec le calculateur d'IDFM ; règles et citations : starway/ticket_rules.py,
source TKT01, CGVU des tickets et liste officielle des correspondances par la voie publique) :
- navettes Magical Shuttle : prix non calculé (le ticket Bus-Tram ne vaut que sur les bus de tarification
  francilienne, CGVU art. 2.1 ; aucune page ne le dit pour elles) ;
- bus de remplacement d'une ligne ferrée (GTFS : « Remplacement RER A ») : prix non calculé (aucune règle écrite) ;
- un trajet en métro, RER ou train interrompt le voyage Bus-Tram (« sans effectuer de sortie », correspondances entre
  modes autorisés seulement, CGVU art. 2.3) : le bus suivant demande un nouveau ticket ;
- correspondance par la rue entre deux gares : un seul ticket si le couple est dans la liste officielle IDFM, sinon
  un nouveau ticket (statut `ok` : la liste est celle des CGVU, plus rien n'est « à vérifier »).

Carbone : jeu IDFM « Émission de CO2e par voyageur kilomètre sur le réseau » (ENV01, Licence Ouverte 2.0, mis à
jour le 26/02/2024), retenu avec la proposition du panneau de preuve (docs/proposition-panneau-preuve.md § 4) : valeur
**par mode** du calculateur d'itinéraire IDFM (colonne `co2e_voy_km_par_mode_de_transport_medias_idfm`), g CO2e par
voyageur.km, lue pour la ligne du tronçon (`id_line` = `route_id` sans « IDFM: ») ; bus : valeur du mode bus (Base
Carbone ADEME, autobus gazole : ne reflète pas les bus électriques ou au biogaz) ; tram absent du jeu (T12, T14) :
valeur du mode tram, unique dans le jeu ; ligne ferrée absente (V), câble, funiculaire : `None` + raison (le mode « rail »
du jeu a plusieurs valeurs). La marche n'a pas de facteur dans le jeu : elle n'est pas comptée, et le statut le dit.
Alternative évaluée et non retenue : API Impact CO2 de l'ADEME (CO2-01, facteurs nationaux, fourchette bus électrique /
thermique possible).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from starway import ticket_rules as tr

# ----------------------------------------------------------------------------- tarifs (COST02)
TICKET_PRICES_EUR = {"metro_train_rer": 2.55, "bus_tram": 2.05, "airport": 14.00}
TICKET_LABELS = {"metro_train_rer": "Ticket Métro-Train-RER", "bus_tram": "Ticket Bus-Tram",
                 "airport": "Ticket Paris Région <> Aéroports"}
FARES_VALIDITY = "tarifs au 1er janvier 2026, plein tarif"
MTR_WINDOW_S = 2 * 3600  # « pendant 2 heures à partir de la validation d'entrée »
BUS_TRAM_WINDOW_S = 90 * 60  # « dans la limite de 1h30 à compter de la première validation d'entrée »
BUS_TRAM_RULE_STATUS = ("prix, 1h30 et câble : page IDFM du ticket (lue le 03/11) ; ligne reprise interdite : CGVU juin 2026 "
                        "lues via un moteur de recherche, à vérifier")
MTR_KINDS = frozenset({"metro", "rer", "train", "ter"})
BUS_TRAM_KINDS = frozenset({"bus", "tram", "cable"})
# arrêts parents GTFS (TRA01, stops.txt, location_type = 1) des trois stations citées par la page du ticket
# Métro-Train-RER ; vérifiés le 03/11/2026 (nom exact, quais rattachés)
AIRPORT_PARENT_STATIONS = {"IDFM:73596": "Aéroport CDG 1 (Terminal 3)",
                           "IDFM:73699": "Aéroport CDG (Terminal 2) - TGV",
                           "IDFM:63284": "Aéroport d’Orly (Terminaux 1-2-3)"}
ORLYVAL_LINE = "ORLYVAL"
# lignes dont aucune source relevée ne donne le titre : pas de ticket compté, raison publiée
UNKNOWN_FARE_LINES = {"CDG VAL": "CDG VAL : titre non documenté par les pages IDFM relevées"}
REASON_UNKNOWN_KIND = "mode sans règle tarifaire relevée"


def _parent(stop: str | None, parents: Mapping[str, str]) -> str | None:
    if stop is None:
        return None
    return parents.get(stop, stop)


STREET_PAIRS = tr.street_pairs()


def count_tickets(legs: Sequence[Mapping[str, Any]], parents: Mapping[str, str],
                  declared_transfers: frozenset[tuple[str, str]] = frozenset(),
                  street_pairs: frozenset[tuple[str, str]] = STREET_PAIRS) -> dict[str, Any]:
    """Tickets à l'unité nécessaires pour un sens (plein tarif). `legs` = tronçons enrichis (`enrich_leg`) dans
    l'ordre ; `parents` = stop_id -> parent_station (GTFS) ; `declared_transfers` = couples (from_stop, to_stop) de
    transfers.txt (correspondances déclarées par IDFM).

    Règles appliquées (voir le docstring du module) :
    - un ticket Métro-Train-RER couvre une suite de tronçons ferrés (métro, RER, train, TER) consécutifs, tant que la
      montée a lieu moins de 2 h après l'arrivée au premier arrêt (heure de validation la plus tôt possible) et que
      chaque correspondance reste dans le réseau : même station parente, ou correspondance déclarée dans
      transfers.txt, ou couple de stations de la liste officielle des correspondances par la voie publique
      (`street_pairs`, ticket_rules.STREET_GROUPS). Sinon (marche par la rue hors liste), nouveau ticket ;
      `street_transfers` compte ces correspondances par la rue payantes (information) ;
    - si cette suite part d'une station aéroport ou y arrive, ou emprunte OrlyVal : ticket Paris Région <> Aéroports ;
    - funiculaire : un ticket Métro-Train-RER à lui seul (aucune correspondance) ;
    - un ticket Bus-Tram couvre les bus, trams et le câble montés moins de 1h30 après la première validation, sans reprendre une
      ligne déjà prise (aller-retour ou interruption interdits) et sans trajet ferré entre deux (CGVU art. 2.3) ;
    - navette Magical Shuttle, bus de remplacement d'une ligne ferrée, tout autre mode ou ligne non documentée :
      `None` + raison."""
    out: dict[str, Any] = {"metro_train_rer": 0, "bus_tram": 0, "airport": 0, "street_transfers": 0,
                           "status": "ok", "reasons": []}
    transit = [lg for lg in legs if lg.get("route_type") is not None]
    rail_seg: dict[str, Any] | None = None  # suite ferrée en cours
    bt: dict[str, Any] | None = None  # ticket Bus-Tram en cours
    prev_transit: Mapping[str, Any] | None = None

    def close_rail() -> None:
        nonlocal rail_seg
        if rail_seg is not None:
            out["airport" if rail_seg["airport"] else "metro_train_rer"] += 1
        rail_seg = None

    for lg in transit:
        kind, line = lg.get("kind"), lg.get("line")
        ready = int(lg.get("dep_s") - (lg.get("wait_s") or 0))
        fp, tp = _parent(lg.get("from_stop"), parents), _parent(lg.get("to_stop"), parents)
        touches_airport = fp in AIRPORT_PARENT_STATIONS or tp in AIRPORT_PARENT_STATIONS
        if line in UNKNOWN_FARE_LINES or lg.get("agency") in tr.UNKNOWN_FARE_AGENCIES or tr.is_substitution_bus(lg):
            out["status"] = "unknown"
            why = (UNKNOWN_FARE_LINES.get(line) or tr.UNKNOWN_FARE_AGENCIES.get(str(lg.get("agency")))
                   or tr.SUBSTITUTION_REASON.format(line=line or "?"))
            if why not in out["reasons"]:
                out["reasons"].append(why)
            close_rail()
            bt = None
        elif kind in MTR_KINDS or line == ORLYVAL_LINE:
            joined = False
            if rail_seg is not None and prev_transit is not None and prev_transit is rail_seg["last"]:
                prev_parent = _parent(prev_transit.get("to_stop"), parents)
                same_place = (prev_parent == fp
                              or (prev_transit.get("to_stop"), lg.get("from_stop")) in declared_transfers
                              or (prev_parent, fp) in street_pairs)
                if not same_place:
                    out["street_transfers"] += 1
                if same_place and int(lg["dep_s"]) - rail_seg["start"] <= MTR_WINDOW_S:
                    joined = True
            if not joined:
                close_rail()
                rail_seg = {"start": ready, "airport": False, "last": None}
            assert rail_seg is not None
            rail_seg["airport"] = rail_seg["airport"] or touches_airport or line == ORLYVAL_LINE
            rail_seg["last"] = lg
            bt = None  # trajet ferré : le voyage Bus-Tram est interrompu (CGVU Bus-Tram art. 2.3)
        elif kind == "funicular":
            close_rail()
            bt = None
            out["metro_train_rer"] += 1
        elif kind in BUS_TRAM_KINDS:
            close_rail()
            if bt is None or int(lg["dep_s"]) - bt["start"] > BUS_TRAM_WINDOW_S or line in bt["lines"]:
                out["bus_tram"] += 1
                bt = {"start": ready, "lines": set()}
            bt["lines"].add(line)
        else:
            out["status"] = "unknown"
            out["reasons"].append(f"{REASON_UNKNOWN_KIND} : {kind or 'inconnu'} ({line or '?'})")
            close_rail()
            bt = None
        prev_transit = lg
    close_rail()
    if out["status"] != "ok":
        return {**{k: None for k in ("metro_train_rer", "bus_tram", "airport", "cost_eur")},
                "street_transfers": out["street_transfers"], "status": "unknown", "reasons": out["reasons"]}
    cost = sum(out[k] * TICKET_PRICES_EUR[k] for k in TICKET_PRICES_EUR)
    out["cost_eur"] = round(cost, 2)
    return out


# ----------------------------------------------------------------------------- carbone (ENV01)
ENV01_MODE_COLUMN = "co2e_voy_km_par_mode_de_transport_medias_idfm"
CO2_SOURCE = "ENV01"
CO2_WALK_NOTE = "marche non comptée (aucun facteur dans le jeu IDFM)"


@dataclass(frozen=True)
class Co2Factors:
    by_line: Mapping[str, float]  # id_line (ex. C01742) -> g CO2e / voyageur.km (valeur par mode du calculateur IDFM)
    by_mode: Mapping[str, float]  # mode du jeu dont la valeur est unique (bus, metro, tram) -> g / voyageur.km


def co2_factors(df: Any) -> Co2Factors:
    """Facteurs depuis le CSV ENV01 (séparateur « ; »). Un mode n'entre dans `by_mode` que si sa valeur est unique."""
    by_line = {str(r.id_line): float(getattr(r, ENV01_MODE_COLUMN)) for r in df.itertuples(index=False)
               if isinstance(r.id_line, str) and r.id_line not in ("", "NA")}
    by_mode: dict[str, float] = {}
    for mode, vals in df.groupby("transportmode")[ENV01_MODE_COLUMN]:
        u = {float(v) for v in vals if str(v) not in ("", "NA", "nan")}
        if len(u) == 1:
            by_mode[str(mode)] = u.pop()
    return Co2Factors(by_line, by_mode)


KIND_TO_ENV01_MODE = {"bus": "bus", "metro": "metro", "tram": "tram"}  # rail : plusieurs valeurs, ligne obligatoire


def leg_co2_g(leg: Mapping[str, Any], f: Co2Factors) -> tuple[float | None, str | None]:
    """(g CO2e, raison) pour un tronçon en TC ; None + raison si aucun facteur publié ou distance inconnue."""
    dist = leg.get("dist_m")
    if dist is None:
        return None, "distance inconnue"
    rid = str(leg.get("route_id") or "")
    line_key = rid.split(":", 1)[1] if ":" in rid else rid
    g_km = f.by_line.get(line_key)
    if g_km is None:
        mode = KIND_TO_ENV01_MODE.get(str(leg.get("kind")))
        g_km = f.by_mode.get(mode) if mode else None
    if g_km is None:
        return None, f"facteur non publié pour la ligne {leg.get('line') or '?'} ({leg.get('kind')})"
    return float(dist) / 1000.0 * g_km, None


def trip_co2(legs: Sequence[Mapping[str, Any]], f: Co2Factors) -> dict[str, Any]:
    """Carbone d'un sens : somme des tronçons en TC ; None si un tronçon n'a pas de facteur (jamais un total partiel)."""
    total = 0.0
    for lg in legs:
        if lg.get("kind") == "walk" or lg.get("route_type") is None:
            continue
        g, why = leg_co2_g(lg, f)
        if why is not None:
            return {"g": None, "status": "unknown", "reason": why}
        total += g or 0.0
    return {"g": round(total), "status": "ok", "reason": None, "note": CO2_WALK_NOTE}
