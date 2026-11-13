"""Abonnements (D-032 proposée) : coût d'un trajet publié pour une personne qui a tel ou tel abonnement.

Logique pure, testée dans tests/test_subscriptions.py ; les MÊMES cas de test sont rejoués par le front
(`frontend/src/data/subscriptionCases.json`, lus par pytest et par vitest) pour que les deux calculs donnent le même
résultat. Script : scripts/06i_export_subscriptions.py (écrit `frontend/public/data/subscriptions.json`, contrat
`subscriptions-1`, et mesure l'effet sur les trajets publiés).

Règle (rien d'inventé, docs/proposition-abonnements.md) :
- coût d'un sens pour la personne = ce qu'elle doit payer EN PLUS de ses abonnements, calculé sur l'itinéraire publié
  (D-028 : tronçons et tickets à l'unité) ; sans abonnement, c'est le prix au ticket publié ;
- un forfait couvre une « famille » de tronçons (vocabulaire des itinéraires : `rail`, `surface`, `airport_rail`,
  `orlyval`, `ter`) seulement si une phrase recopiée d'une page ou des CGVU le dit (`yes`), l'exclut (`no`), sinon
  `unknown` : le coût vaut alors `null` avec la raison, jamais 0 ;
- ce qui n'est pas couvert se paie avec le seul titre relevé qui le couvre : ticket Orlyval (14 €, COST02) pour un
  trajet Orlyval avec un forfait qui l'exclut ; ticket Paris Région <> Aéroports (14 €) pour une suite ferrée qui touche
  un aéroport avec le Navigo Jour (« hors dessertes aéroportuaires ») ;
- le prix de l'abonnement est affiché à côté, JAMAIS divisé par un nombre de trajets (aucune source ne donne le nombre
  de jours travaillés de la personne) ;
- Vélib' : coût d'une course (vélo mécanique) d'après la durée de la partie vélo du trajet publié (04d, minutes
  entières de R5 = secondes divisées par 60, arrondi inférieur, vérifié dans le jar) et la règle des tranches des CGAU
  (« inférieure ou égale à 29 min 59 sec ») : une durée de T minutes entières est dans la tranche k = T // 30.
"""

from __future__ import annotations

import html
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CONTRACT = "subscriptions-1"
DECISION = "D-032 (proposée)"
LONG_DASHES = {0x2013: "-", 0x2014: "-"}  # règle du projet : aucun tiret long, même dans une citation

# ----------------------------------------------------------------------------- lecture des pages


def normalize(s: str) -> str:
    """Espaces fusionnés (insécables compris), tirets longs remplacés : forme commune des citations et des pages."""
    s = s.replace(" ", " ").replace(" ", " ").replace("﻿", " ").translate(LONG_DASHES)
    return re.sub(r"\s+", " ", s).strip()


def page_text(path: Path) -> str:
    """Texte visible d'une page HTML gardée (scripts et styles retirés), normalisé."""
    t = path.read_text(encoding="utf-8", errors="replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>|<noscript.*?</noscript>", " ", t, flags=re.DOTALL | re.IGNORECASE)
    return normalize(html.unescape(re.sub(r"<[^>]+>", " ", t)))


@dataclass(frozen=True)
class Quote:
    """Phrase recopiée mot pour mot d'un fichier gardé (`file` relatif à data/raw/). Pour un PDF (pas de lecteur PDF
    dans le pipeline), la phrase a été lue avec pdftotext le 04/11/2026 : on lie la citation à l'empreinte du fichier."""

    source_id: str
    file: str
    text: str
    pdf_sha256: str | None = None

    def as_json(self) -> dict[str, str]:
        out = {"source_id": self.source_id, "file": self.file, "quote": normalize(self.text)}
        if self.pdf_sha256:
            out["sha256"] = self.pdf_sha256
            out["read_with"] = "pdftotext (lecture humaine du 04/11/2026), citation liée à l'empreinte du fichier"
        return out


def quote_found(q: Quote, raw_dir: Path, sha256_of) -> tuple[bool, str]:
    """(trouvée, détail). HTML : la phrase normalisée figure dans le texte de la page. PDF : empreinte identique."""
    path = raw_dir / q.file
    if not path.exists():
        return False, f"{q.file} absent"
    if q.pdf_sha256 is not None:
        got = sha256_of(path)
        return got == q.pdf_sha256, f"sha256 {got[:12]} (attendu {q.pdf_sha256[:12]})"
    return normalize(q.text) in page_text(path), q.file


# ----------------------------------------------------------------------------- jeu IDFM titres-et-tarifs (SUB01)

_PRICE_RE = re.compile(r"^\s*(\d+)(?:,(\d{1,2}))?\s*€\s*$")


def parse_price(text: str | None) -> float | None:
    """« 90,80€ » -> 90.8 ; « 14€ » -> 14.0. Tout le reste (« dès 1,64€ », « -50% », « Gratuit ») -> None :
    ce n'est pas un prix unique, la page du titre le donne."""
    if text is None:
        return None
    m = _PRICE_RE.match(text.replace(" ", " "))
    if not m:
        return None
    cents = (m.group(2) or "0").ljust(2, "0")
    return round(int(m.group(1)) + int(cents) / 100, 2)


def record_of(records: Sequence[Mapping[str, Any]], name: str) -> Mapping[str, Any]:
    hits = [r for r in records if r.get("product_name") == name]
    if len(hits) != 1:
        raise ValueError(f"titre « {name} » : {len(hits)} lignes dans SUB01 (une seule attendue)")
    return hits[0]


# ----------------------------------------------------------------------------- familles de tronçons

FAMILIES = {
    "rail": "métro, RER, train (Transilien), funiculaire : tickets Métro-Train-RER",
    "surface": "bus, tram, câble : tickets Bus-Tram",
    "ter": "TER (en Île-de-France, dans le GTFS IDFM)",
    "airport_rail": "suite ferrée qui part d'une gare d'aéroport ou y arrive (RER B, métro 14) : ticket Paris "
                    "Région <> Aéroports au ticket",
    "orlyval": "ligne Orlyval",
}
COVER_VALUES = ("yes", "no", "unknown")
ORLYVAL_LINE = "ORLYVAL"  # route_short_name du GTFS (starway.fares_carbon.ORLYVAL_LINE)
TER_MODE = "ter"


def leg_counts(legs: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    """Comptes tirés des tronçons publiés (champ `m` et `line` d'itineraries/{insee}.json)."""
    rides = [lg for lg in legs if lg.get("m") != "walk"]
    return {"orlyval": sum(1 for lg in rides if lg.get("line") == ORLYVAL_LINE),
            "ter": sum(1 for lg in rides if lg.get("m") == TER_MODE)}


def _r2(x: float) -> float:
    """Arrondi au centime, même règle que le front (`Math.floor(x * 100 + 0.5 + 1e-7) / 100`)."""
    return math.floor(x * 100 + 0.5 + 1e-7) / 100


def unpriced_reasons(legs: Sequence[Mapping[str, Any]], unpriced: Mapping[str, str]) -> list[str]:
    """Raisons des tronçons d'un exploitant sans titre relevé (`transit.unpriced_agencies`, champ `agency`)."""
    seen: list[str] = []
    for lg in legs:
        why = unpriced.get(str(lg.get("agency") or ""))
        if why and why not in seen:
            seen.append(why)
    return seen


def transit_leg_cost(trip: Mapping[str, Any] | None, option: Mapping[str, Any] | None,
                     extra_titles: Mapping[str, Mapping[str, Any]],
                     unpriced: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Coût d'un sens TC publié pour une personne qui a `option` (None = aucun abonnement, tickets à l'unité).

    Rend {status, extra_eur, items, reasons} :
    - `status` : `no_trip` (pas d'itinéraire publié), `unknown` (au moins un tronçon dont la couverture ou le prix
      n'est pas sourcé : `extra_eur` = None), `tickets` (sans abonnement : prix au ticket), `included` (rien à payer
      en plus), `extra` (titres à acheter en plus, `items`) ;
    - `street_transfer_unverified` : True quand le prix dépend d'une correspondance par la rue (règle IDFM non relevée,
      voir fares_carbon.count_tickets) ;
    - `unpriced` : exploitants dont aucune source relevée ne donne le titre (ex. navettes Magical Shuttle, comptées
      au ticket Bus-Tram par D-028 alors que le calculateur d'IDFM leur donne un autre prix, 07k) : `unknown` pour tous,
      sans abonnement compris."""
    if not trip or trip.get("status") != "ok":
        return {"status": "no_trip", "extra_eur": None, "items": [], "reasons": []}
    tk = trip.get("tickets") or {}
    street = tk.get("status") == "street_transfer_unverified"
    blocked = unpriced_reasons(trip.get("legs") or [], unpriced or {})
    if blocked:
        return {"status": "unknown", "extra_eur": None, "items": [], "reasons": blocked,
                "street_transfer_unverified": street}
    if tk.get("status") == "unknown" or tk.get("cost_eur") is None:
        return {"status": "unknown", "extra_eur": None, "items": [], "reasons": list(tk.get("reasons") or []),
                "street_transfer_unverified": street}
    if option is None:
        return {"status": "tickets", "extra_eur": _r2(float(tk["cost_eur"])), "items": [], "reasons": [],
                "street_transfer_unverified": street}
    cov = option["covers"]
    counts = leg_counts(trip.get("legs") or [])
    reasons: list[str] = []
    items: list[dict[str, Any]] = []
    if counts["ter"] and cov["ter"] != "yes":
        reasons.append(option["unknown_reasons"].get("ter", "TER : couverture non écrite dans les sources lues"))
    airport = int(tk.get("airport") or 0)
    if airport:
        if cov["airport_rail"] == "unknown":
            reasons.append(option["unknown_reasons"].get("airport_rail", "aéroports : couverture non écrite"))
        elif cov["airport_rail"] == "no":
            items.append({"title": "airport_ticket", "count": airport})
    if counts["orlyval"] and cov["airport_rail"] != "no":  # avec airport_rail = no, le ticket aéroport couvre Orlyval
        if cov["orlyval"] == "unknown":
            reasons.append(option["unknown_reasons"].get("orlyval", "Orlyval : couverture non écrite"))
        elif cov["orlyval"] == "no":
            items.append({"title": "orlyval_ticket", "count": counts["orlyval"]})
    if reasons:
        return {"status": "unknown", "extra_eur": None, "items": [], "reasons": reasons,
                "street_transfer_unverified": False}
    extra = _r2(sum(extra_titles[i["title"]]["eur"] * i["count"] for i in items))
    return {"status": "extra" if items else "included", "extra_eur": extra, "items": items, "reasons": [],
            "street_transfer_unverified": street and bool(items) and any(i["title"] == "airport_ticket" for i in items)}


def transit_round_trip(out: Mapping[str, Any] | None, ret: Mapping[str, Any] | None,
                       option: Mapping[str, Any] | None,
                       extra_titles: Mapping[str, Mapping[str, Any]],
                       unpriced: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Aller et retour d'une même journée-type. `total_eur` = ce que la personne paie pour cet aller-retour EN PLUS de
    son abonnement ; pour un titre d'un jour (`kind` = `day`), le prix du titre est ajouté une fois (il couvre la
    journée) ; pour un abonnement, son prix n'est jamais ajouté ni divisé (il est affiché à côté). `None` si un sens
    manque ou n'est pas sourcé."""
    o = transit_leg_cost(out, option, extra_titles, unpriced)
    r = transit_leg_cost(ret, option, extra_titles, unpriced)
    total = None
    if o["extra_eur"] is not None and r["extra_eur"] is not None:
        total = o["extra_eur"] + r["extra_eur"]
        if option is not None and option.get("kind") == "day":
            total += float(option["price"]["eur"])
        total = _r2(total)
    return {"out": o, "ret": r, "total_eur": total}


# ----------------------------------------------------------------------------- Vélib' (course en vélo mécanique)

def slices_beyond(ride_min: int, included_min: int, step_min: int = 30) -> int:
    """Tranches de `step_min` minutes facturées au-delà des `included_min` premières (CGAU : une course de
    29 min 59 s est dans les 30 premières minutes ; même raisonnement pour chaque tranche). `ride_min` = minutes
    entières, arrondi inférieur des secondes (R5) : la course dure au plus ride_min + 59 s."""
    if ride_min < 0:
        raise ValueError("durée négative")
    if ride_min < included_min:
        return 0
    return (ride_min - included_min) // step_min + 1


def velib_ride_cost(ride_min: int | None, offer: Mapping[str, Any]) -> dict[str, Any]:
    """Coût d'une course Vélib' mécanique pour `offer` (bloc `velib.offers[]` de subscriptions.json). Rend
    {status, eur, reason} : `included` (0 €), `paid`, `unknown` (règle au-delà non sourcée : eur = None), `no_trip`."""
    if ride_min is None:
        return {"status": "no_trip", "eur": None, "reason": None}
    rule = offer["ride"]
    n = slices_beyond(int(ride_min), int(rule["included_min"]), int(rule["step_min"]))
    if n and rule.get("beyond_eur") is None:
        return {"status": "unknown", "eur": None, "reason": rule.get("beyond_reason")}
    eur = float(rule.get("per_ride_eur") or 0.0) + n * float(rule.get("beyond_eur") or 0.0)
    eur = min(eur, float(rule["cap_eur"])) if rule.get("cap_eur") is not None else eur
    eur = _r2(eur)
    return {"status": "included" if eur == 0 else "paid", "eur": eur, "reason": None}


def velib_round_trip(out_min: int | None, ret_min: int | None, offer: Mapping[str, Any]) -> dict[str, Any]:
    """Aller et retour d'une journée : somme des deux courses, plus le prix du titre si c'est un titre d'un jour
    (Pass 24h). Le prix d'un abonnement mensuel n'est jamais ajouté ni divisé."""
    o, r = velib_ride_cost(out_min, offer), velib_ride_cost(ret_min, offer)
    total = None
    if o["eur"] is not None and r["eur"] is not None:
        total = o["eur"] + r["eur"] + (float(offer["price"]["eur"]) if offer.get("kind") == "day" else 0.0)
        total = _r2(total)
    return {"out": o, "ret": r, "total_eur": total}


# ----------------------------------------------------------------------------- effet sur les trajets publiés

def transit_effects(trips: Sequence[tuple[Mapping[str, Any] | None, Mapping[str, Any] | None]],
                    options: Sequence[Mapping[str, Any]], extra_titles: Mapping[str, Mapping[str, Any]],
                    day_pass: Mapping[str, Any] | None, unpriced: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Comptes sur des couples (aller, retour) publiés d'une même journée-type. Un sens est compté s'il a un itinéraire
    (status ok). Pour chaque abonnement : sens inclus, sens avec un titre en plus, sens non sourcés ; puis les
    aller-retour dont le prix au ticket dépasse le prix d'un titre d'un jour (constat, pas une recommandation)."""
    legs = [t for pair in trips for t in pair if t and t.get("status") == "ok"]
    n = len(legs)
    tk_status: dict[str, int] = {}
    airport = orlyval = ter = blocked = 0
    for t in legs:
        blocked += bool(unpriced_reasons(t.get("legs") or [], unpriced or {}))
        s = (t.get("tickets") or {}).get("status") or "?"
        tk_status[s] = tk_status.get(s, 0) + 1
        if int((t.get("tickets") or {}).get("airport") or 0):
            airport += 1
        c = leg_counts(t.get("legs") or [])
        orlyval += bool(c["orlyval"])
        ter += bool(c["ter"])
    by_option: dict[str, dict[str, int]] = {}
    for opt in options:
        cnt = {"included": 0, "extra": 0, "unknown": 0}
        for t in legs:
            cnt[transit_leg_cost(t, opt, extra_titles, unpriced)["status"]] += 1
        by_option[opt["id"]] = cnt
    pairs = [(o, r) for o, r in trips if o and r and o.get("status") == "ok" and r.get("status") == "ok"]
    totals = [transit_round_trip(o, r, None, extra_titles, unpriced)["total_eur"] for o, r in pairs]
    known = [x for x in totals if x is not None]
    over = None
    if day_pass is not None:
        price = float(day_pass["price"]["eur"])
        over = {"title": day_pass["id"], "price_eur": price, "round_trips_known": len(known),
                "round_trips_above": sum(1 for x in known if x > price)}
    known.sort()
    return {"legs_with_itinerary": n, "tickets_status": tk_status, "legs_airport_ticket": airport,
            "legs_orlyval": orlyval, "legs_ter": ter, "legs_unpriced_agency": blocked, "by_option": by_option,
            "round_trips": len(pairs), "round_trip_ticket_eur": {
                "known": len(known), "min": known[0] if known else None, "max": known[-1] if known else None,
                "median": known[len(known) // 2] if known else None},
            "round_trips_above_day_pass": over}


def velib_effects(rides: Mapping[str, Mapping[str, Sequence[int | None]]],
                  offers: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Courses Vélib' publiées (aller et retour) : combien sont incluses dans chaque offre, combien coûtent un
    supplément, aller-retour dont les deux courses sont incluses."""
    pairs = [(o, r) for v in rides.values() for o, r in zip(v["out"], v["ret"], strict=True)
             if o is not None and r is not None]
    rides_all = [x for o, r in pairs for x in (o, r)]
    out: dict[str, Any] = {"round_trips": len(pairs), "rides": len(rides_all), "by_offer": {}}
    for off in offers:
        st = [velib_ride_cost(x, off)["status"] for x in rides_all]
        both = sum(1 for o, r in pairs if velib_ride_cost(o, off)["status"] == "included"
                   and velib_ride_cost(r, off)["status"] == "included")
        out["by_offer"][off["id"]] = {"included": st.count("included"), "paid": st.count("paid"),
                                      "unknown": st.count("unknown"), "round_trips_both_included": both}
    if rides_all:
        s = sorted(rides_all)
        out["ride_min"] = {"min": s[0], "median": s[len(s) // 2], "max": s[-1]}
    return out
