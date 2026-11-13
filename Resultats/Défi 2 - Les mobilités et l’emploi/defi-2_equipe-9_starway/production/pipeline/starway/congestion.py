"""Voiture avec le trafic moyen mesuré par la DiRIF (D-029, demande de l'équipe du 03/11/2026).

Source (ROAD01) : DRIEAT Île-de-France, DiRIF, « Baromètre trafic mensuel de la circulation », n° 41, novembre 2025,
page 2 « Temps de parcours les jours ouvrés ». Indice = temps de parcours rapporté au temps en circulation fluide, jours
ouvrés, voies structurantes du réseau routier national non concédé (hors boulevard périphérique). Valeurs lues sur le
graphique mensuel (la DiRIF ne publie pas les nombres), ± 0,02 : docs/proposition-congestion.md § 3, relues le 03/11 au
soir (manifeste ROAD01, colonne « controles »).

Règle (proposition-congestion.md § 4) : un sens reçoit l'indice d'une période seulement si TOUT le trajet avec
congestion tient dans cette période :
- aller (arrivée à l'heure de début S) : période p telle que p.début < S <= p.fin, et S - T x k >= p.début ;
- retour (départ à l'heure de fin E) : période p telle que p.début <= E < p.fin, et E + T x k <= p.fin.
Sinon : aucune période autour de l'heure (`no_period`, « pas de mesure de la DiRIF à cette heure ») ou trajet qui
déborde de sa période (`outside_period`) ; le temps route vide est alors gardé, et le dit (jamais « x 1 »).
Temps avec trafic = T x k arrondi à la minute la plus proche, en entiers (indice en centièmes) : même calcul, au bit
près, dans le front (frontend/src/data/congestion.ts), testé sur les mêmes cas.

Appliquer à tout le trajet un indice mesuré sur les voies rapides est un CHOIX DE L'ÉQUIPE (demande de Nicolas),
pas une mesure : docs/limites.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from starway.config import DAY_TYPES

SOURCE_ID = "ROAD01"
MONTH = "2025-11"
UNCERTAINTY = 0.02
STATUS_OK = "ok"
NO_PERIOD = "no_period"
OUTSIDE_PERIOD = "outside_period"
BASE_MODE = "car"
MODE_ID = "car_traffic"
MODE_LABEL = "Voiture (trafic moyen DiRIF)"
BASE_MODE_LABEL = "Voiture (route vide)"


@dataclass(frozen=True)
class Period:
    id: str
    start_min: int
    end_min: int
    index_x100: int  # indice en centièmes (1,75 -> 175) : calcul entier, identique dans le front

    @property
    def index(self) -> float:
        return self.index_x100 / 100


# Graphique mensuel de la page 2 du n° 41, dernier point (novembre 2025), arrondi à 0,01.
PERIODS: tuple[Period, ...] = (
    Period("p06_10", 6 * 60, 10 * 60, 175),
    Period("p10_16", 10 * 60, 16 * 60, 139),
    Period("p16_20", 16 * 60, 20 * 60, 195),
)


def congested_minutes(free_min: int, index_x100: int) -> int:
    """T x k arrondi à la minute la plus proche (demi-minute vers le haut), en entiers."""
    return (int(free_min) * int(index_x100) + 50) // 100


def attach(leg: str, clock_min: int, free_min: int | None,
           periods: tuple[Period, ...] = PERIODS) -> tuple[str | None, str | None, int | None]:
    """(identifiant de période ou None, statut, minutes avec trafic ou None) pour un sens.
    `leg` = "out" (arrivée à `clock_min`) ou "ret" (départ à `clock_min`). Temps route vide inconnu : (None, None,
    None). Statut `ok` : minutes avec trafic ; sinon minutes = None (le front garde le temps route vide)."""
    if free_min is None:
        return None, None, None
    if leg == "out":
        p = next((x for x in periods if x.start_min < clock_min <= x.end_min), None)
    elif leg == "ret":
        p = next((x for x in periods if x.start_min <= clock_min < x.end_min), None)
    else:
        raise ValueError(f"sens inconnu {leg!r}")
    if p is None:
        return None, NO_PERIOD, None
    span100 = int(free_min) * p.index_x100  # durée avec trafic, en centièmes de minute
    fits = ((clock_min - p.start_min) * 100 >= span100) if leg == "out" else ((p.end_min - clock_min) * 100 >= span100)
    if not fits:
        return p.id, OUTSIDE_PERIOD, None
    return p.id, STATUS_OK, congested_minutes(free_min, p.index_x100)


def _hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def day_type_periods(periods: tuple[Period, ...] = PERIODS) -> dict[str, dict[str, Any]]:
    """Période candidate de chaque sens de chaque journée-type (avant le test de débordement, qui dépend de T)."""
    out: dict[str, dict[str, Any]] = {}
    for d in DAY_TYPES:
        s, e = d.start.hour * 60 + d.start.minute, d.end.hour * 60 + d.end.minute
        po = next((x.id for x in periods if x.start_min < s <= x.end_min), None)
        pr = next((x.id for x in periods if x.start_min <= e < x.end_min), None)
        out[d.id] = {"out": po, "ret": pr,
                     **({"out_reason": NO_PERIOD} if po is None else {}),
                     **({"ret_reason": NO_PERIOD} if pr is None else {})}
    return out


def meta_block(manifest_row: dict[str, str] | None) -> dict[str, Any]:
    """Bloc meta.car_congestion (écrit par 06, jamais à la main)."""
    row = manifest_row or {}
    return {
        "mode": MODE_ID, "base_mode": BASE_MODE,
        "source_id": SOURCE_ID,
        "publisher": "DRIEAT Île-de-France, Direction des routes d'Île-de-France (DiRIF)",
        "title": "Baromètre trafic mensuel de la circulation, n° 41, novembre 2025, page 2 « Temps de parcours les "
                 "jours ouvrés »",
        "url": (row.get("url_source") or "").split(" (résolue")[0] or None,
        "downloaded_at": row.get("date_extraction") or None,
        "sha256": row.get("sha256") or None,
        "month": MONTH,
        "scope": "voies rapides d'Île-de-France",
        "network": "voies structurantes du réseau routier national non concédé (ex. A86, A1, N118, N104), hors "
                   "boulevard périphérique et axes bidirectionnels",
        "days": "jours ouvrés (hors week-ends et jours fériés)",
        "definition": "temps de parcours rapporté au temps en circulation fluide (1 = « Temps de parcours fluide », "
                      "2 = « Temps de parcours multiplié par 2 »)",
        "quote": "Ce graphique renseigne sur les indices mensuels des temps de parcours en jours ouvrés (hors WE & "
                 "jours fériés), pour 3 périodes horaires, sur le réseau des voies structurantes (ex : A86, A1, "
                 "N118, N104, etc.) hors boulevard périphérique (BP)",
        "read_from": "graphique mensuel de la page 2, numérisé par pixels (la DiRIF ne publie pas les nombres)",
        "uncertainty": UNCERTAINTY,
        "periods": [{"id": p.id, "start": _hhmm(p.start_min), "end": _hhmm(p.end_min), "index": p.index}
                    for p in PERIODS],
        "day_types": day_type_periods(),
        "rule": {
            "out": "arrivée à l'heure de début S : période p avec p.start < S <= p.end, et S - T x indice >= p.start",
            "ret": "départ à l'heure de fin E : période p avec p.start <= E < p.end, et E + T x indice <= p.end",
            "rounding": "T x indice arrondi à la minute la plus proche (demi-minute vers le haut)",
            "otherwise": "aucune période (no_period) ou trajet qui déborde de sa période (outside_period) : temps "
                         "route vide gardé, et dit",
            "verdict": "le mode car_traffic calcule le verdict aller et retour avec ces temps ; le mode car (route "
                       "vide) est inchangé ; le ciel (positions et tailles) ne change pas",
        },
        "texts": {
            NO_PERIOD: "pas de mesure de la DiRIF à cette heure",
            OUTSIDE_PERIOD: "trajet qui dépasse la tranche horaire mesurée par la DiRIF : temps route vide gardé",
            "choice": "Appliquer à tout le trajet un indice mesuré sur les voies rapides est un choix de l'équipe "
                      "(D-029), pas une mesure.",
            "label": "indice DiRIF, jours ouvrés de novembre 2025, voies rapides d'Île-de-France (± 0,02, lu sur un "
                     "graphique)",
        },
        "decision": "D-029",
    }


def modes_with_traffic(modes: list[dict[str, str]]) -> list[dict[str, str]]:
    """meta.modes : « Voiture (route vide) » puis « Voiture (trafic moyen DiRIF) » juste après."""
    out: list[dict[str, str]] = []
    for m in modes:
        if m["id"] == BASE_MODE:
            out.append({"id": BASE_MODE, "label": BASE_MODE_LABEL})
            out.append({"id": MODE_ID, "label": MODE_LABEL})
        elif m["id"] != MODE_ID:
            out.append(m)
    return out


def check_block(block: dict[str, Any]) -> list[str]:
    """Contrôles de 07 sur meta.car_congestion. Liste vide = conforme."""
    pb: list[str] = []
    per = block.get("periods") or []
    if not per:
        return ["aucune période"]

    def mins(t: str) -> int:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    prev_end = -1
    for p in per:
        if not (1.0 <= float(p["index"]) <= 3.0):
            pb.append(f"indice {p['id']} = {p['index']} hors de [1 ; 3]")
        s, e = mins(p["start"]), mins(p["end"])
        if e <= s or s < prev_end:
            pb.append(f"période {p['id']} vide ou chevauchante")
        prev_end = e
    if [(p["id"], round(float(p["index"]) * 100)) for p in per] != [(p.id, p.index_x100) for p in PERIODS]:
        pb.append("périodes publiées différentes de starway/congestion.py")
    if block.get("day_types") != day_type_periods():
        pb.append("rattachement des journées-types différent de la règle")
    for d, v in (block.get("day_types") or {}).items():
        for leg in ("out", "ret"):
            if v.get(leg) is None and v.get(f"{leg}_reason") != NO_PERIOD:
                pb.append(f"{d} {leg} : ni période ni raison")
    for k in ("source_id", "month", "scope", "url", "sha256"):
        if not block.get(k):
            pb.append(f"champ {k} vide")
    return pb
