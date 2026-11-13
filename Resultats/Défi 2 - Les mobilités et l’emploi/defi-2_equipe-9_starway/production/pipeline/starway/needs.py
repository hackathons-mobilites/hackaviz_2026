"""Réglage « Mes besoins » (04/11/2026) : ce que disent les sources ouvertes sur l'accessibilité de chaque tronçon en
TC des itinéraires publiés (D-028). Logique pure, testée dans tests/test_needs.py ; appliquée par 06n.

Trois sources, recopiées sans interprétation, une valeur absente reste `None` (affichée « non renseigné ») :
- **GTFS IDFM** (TRA01, déjà publié par 06h : `wc_trip`, `wc_from`, `wc_to`) : véhicule de la course et quais ;
- **référentiel des lignes IDFM** (TRA03, ODbL), par ligne : `accessibility` (« Accessibilité générale de la ligne » ;
  bus : critères de déclaration dans la description du jeu), `audiblesigns_available` et `visualsigns_available`.
  Sens de ces deux champs : documentation PDF des référentiels liée depuis le jeu (« Présence de dispositifs
  d'informations sonore à bord » pour `audiblesigns_available`, « ... dynamique à bord » pour
  `visualsigns_available`), qui suit le nom des champs (NeTEx AudibleSignsAvailable / VisualSignsAvailable) ; les
  descriptions de la page du jeu sont inversées (écart publié dans `meta.needs`). Jointure : `route_id` du GTFS sans
  `IDFM:` = `id_line` ;
- **« Accessibilité en gare » IDFM** (TRA04, Licence Ouverte 2.0), par gare ferrée : niveau (`accessibility_level_id`,
  libellé exact `accessibility_level_name`) et `commentaire` (niveau différent selon la ligne). Jointure :
  `stop_point_id` sans `stop_point:` = `stop_id` du quai GTFS (les gares ferrées sont des `monomodalStopPlace`).

Règle de vérité : jamais « trajet accessible », seulement ce que chaque source déclare, ligne par ligne et gare par
gare. Aucune valeur n'est déduite d'une autre (un RER peut avoir une course déclarée adaptée et une gare qui ne l'est
pas).

Version finale (05/11/2026, D-034, décision de Nicolas) : on ne classe plus les personnes par handicap. Le réglage
« Ce qu'il me faut sur mon trajet » compte cinq cases (`BOXES`, mots validés avec Sara) ; les trois premières peuvent
marquer un astre sur le ciel, les deux dernières jamais. La règle du ciel est UNE fonction pure, `star_marked`, copie
conforme de `frontend/src/data/needs.ts` (mêmes cas de test : `frontend/src/data/needsRuleCases.json`, lus par pytest
et par vitest). Sara peut la changer jusqu'au 06/11 au soir : c'est ici, et là, qu'on la modifie.
"""

from __future__ import annotations

import gzip
import json
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

NEEDS_CONTRACT = "needs-1"  # sous-contrat des fichiers itineraries-* (champ `a11y` des tronçons, bloc `needs_meta`)
LINE_ACCESS_VALUES = ("true", "false", "unknown")
SIGN_VALUES = ("true", "false", "partial", "unknown")
RAIL_KINDS = frozenset({"rer", "train", "ter", "rail"})  # familles de itineraries.RAIL_AGENCY_KIND (+ rail sans exploitant)
GTFS_ROUTE_PREFIX = "IDFM:"
TRA04_PREFIX = "stop_point:"
SOURCES = ("TRA01", "TRA03", "TRA04")
# Les cinq cases du réglage « Ce qu'il me faut sur mon trajet », dans l'ordre d'affichage. Les libellés exacts (mots
# validés avec Sara) sont ceux du front (`frontend/src/data/needs.ts`) ; ici seulement les identifiants publiés dans
# `meta.needs.needs`.
BOXES = ("wc_trip", "wc_stops", "station", "audio", "visual")
NEEDS = BOXES
# Cases qui peuvent marquer un astre sur le ciel ; « audio » et « visual » ne le peuvent jamais (légende et panneau).
SKY_BOXES = ("wc_trip", "wc_stops", "station")
# TRA04, `accessibility_level_id` : 4 « train accessible sur demande auprès d'un agent en station » et 6 « véhicule
# accessible en toute autonomie » = gare sans réservation d'assistance (case « Gares sans réservation d'assistance »).
# 3 (réservation préalable AssistenGare) et 1 (non accessible) : case non remplie.
STATION_FILLED_LEVELS = (4, 6)
STATION_NOT_FILLED_LEVELS = (1, 3)


def route_line_id(route_id: str | None) -> str | None:
    """`IDFM:C01742` -> `C01742` (identifiant du référentiel des lignes)."""
    if not route_id:
        return None
    return route_id.removeprefix(GTFS_ROUTE_PREFIX)


def _norm(v: Any, allowed: Sequence[str]) -> str:
    s = v.strip().lower() if isinstance(v, str) else ""
    return s if s in allowed else "unknown"


@dataclass(frozen=True)
class Station:
    level: int
    comment: str | None


@dataclass
class NeedsFacts:
    """Tables chargées : par `id_line` (accessibilité, annonces sonores, informations visuelles), par `stop_id` GTFS
    (niveau et commentaire de la gare), libellés exacts des niveaux."""

    lines: Mapping[str, tuple[str, str, str]]
    stations: Mapping[str, Station]
    levels: Mapping[int, str]
    seen: Counter = field(default_factory=Counter)

    def leg_a11y(self, kind: str | None, route_id: str | None, from_stop: str | None, to_stop: str | None
                 ) -> dict[str, Any]:
        """Champ `a11y` d'un tronçon en TC. `line`, `audio`, `visual` : valeur du référentiel (`unknown` si vide),
        `None` si la ligne n'y est pas. `st_from`, `st_to` : présents pour un tronçon ferré ou un quai de TRA04 ;
        `{level[, comment]}` ou `None` (gare absente du jeu)."""
        lid = route_line_id(route_id)
        row = self.lines.get(lid) if lid else None
        out: dict[str, Any] = {"line": row[0] if row else None, "audio": row[1] if row else None,
                               "visual": row[2] if row else None}
        sf = self.stations.get(from_stop) if from_stop else None
        st = self.stations.get(to_stop) if to_stop else None
        if (kind in RAIL_KINDS) or sf is not None or st is not None:
            out["st_from"] = station_json(sf)
            out["st_to"] = station_json(st)
        self._count(kind, out)
        return out

    def _count(self, kind: str | None, a: Mapping[str, Any]) -> None:
        self.seen["legs"] += 1
        self.seen[f"legs_{kind}"] += 1
        for k in ("line", "audio", "visual"):
            self.seen[f"{k}_{a[k] if a[k] is not None else 'absent'}"] += 1
        for k in ("st_from", "st_to"):
            if k in a:
                self.seen["stations"] += 1
                self.seen[f"station_{a[k]['level'] if a[k] else 'absent'}"] += 1


def station_json(s: Station | None) -> dict[str, Any] | None:
    if s is None:
        return None
    return {"level": s.level, **({"comment": s.comment} if s.comment else {})}


def load_lines(frame: pd.DataFrame) -> dict[str, tuple[str, str, str]]:
    """`id_line` -> (accessibility, audiblesigns_available, visualsigns_available), valeurs hors liste = `unknown`."""
    out: dict[str, tuple[str, str, str]] = {}
    for lid, a, au, vi in zip(frame["id_line"], frame["accessibility"], frame["audiblesigns_available"],
                              frame["visualsigns_available"], strict=True):
        if isinstance(lid, str) and lid:
            out[lid] = (_norm(a, LINE_ACCESS_VALUES), _norm(au, SIGN_VALUES), _norm(vi, SIGN_VALUES))
    return out


def load_stations(frame: pd.DataFrame) -> tuple[dict[str, Station], dict[int, str]]:
    """`stop_id` GTFS -> niveau et commentaire ; niveau -> libellé exact. Un niveau sans libellé unique : erreur."""
    stations: dict[str, Station] = {}
    labels: dict[int, set[str]] = {}
    for sp, lvl, name, com in zip(frame["stop_point_id"], frame["accessibility_level_id"],
                                  frame["accessibility_level_name"], frame["commentaire"], strict=True):
        if not isinstance(sp, str) or not sp or not isinstance(lvl, str) or not lvl.strip():
            continue
        n = int(lvl)
        labels.setdefault(n, set()).add(str(name).strip())
        c = com.strip() if isinstance(com, str) and com.strip() else None
        stations[sp.removeprefix(TRA04_PREFIX)] = Station(n, typo(c))
    bad = {k: v for k, v in labels.items() if len(v) != 1}
    if bad:
        raise ValueError(f"niveaux avec plusieurs libellés : {bad}")
    return stations, {k: typo(next(iter(v))) or "" for k, v in sorted(labels.items())}


def typo(s: str | None) -> str | None:
    """Tirets longs des sources publiés en tiret simple (règle 8 du projet)."""
    if s is None:
        return None
    return s.replace(chr(0x2014), "-").replace(chr(0x2013), "-")


def from_files(tra03: Path, tra04: Path) -> NeedsFacts:
    lines = load_lines(pd.read_csv(tra03, sep=";", encoding="utf-8-sig", dtype=str,
                                   usecols=["id_line", "accessibility", "audiblesigns_available",
                                            "visualsigns_available"]))
    stations, levels = load_stations(pd.read_csv(tra04, sep=";", encoding="utf-8-sig", dtype=str))
    return NeedsFacts(lines, stations, levels)


# --- Cases cochées et règle du ciel (D-034, version finale du 05/11/2026) ---------------------------------------------
# Copie conforme de frontend/src/data/needs.ts ; mêmes cas de test (frontend/src/data/needsRuleCases.json).

FILLED = "filled"          # déclaré rempli sur tout le trajet
NOT_FILLED = "not_filled"  # au moins une source déclare le contraire (« non », « partiel », niveau 1 ou 3)
NOT_STATED = "not_stated"  # au moins une valeur absente d'une source (« non renseigné »), aucune déclaration contraire
NO_STATION = "no_station"  # case des gares seulement : aucune gare du jeu TRA04 sur le trajet (ne bloque pas)
NO_RIDE = "no_ride"        # aucun tronçon en TC : les sources ne déclarent rien, jamais une case remplie


def tc_legs(legs: Sequence[Mapping[str, Any]] | None) -> list[Mapping[str, Any]]:
    return [lg for lg in (legs or []) if lg.get("m") not in (None, "walk")]


def _combine(states: Iterable[str]) -> str:
    """Toutes remplies : remplie ; une déclaration contraire : non remplie ; sinon (absence) : non renseigné."""
    st = list(states)
    if any(s == NOT_FILLED for s in st):
        return NOT_FILLED
    if all(s == FILLED for s in st):
        return FILLED
    return NOT_STATED


def _flag(v: Any) -> str:
    """GTFS (`wc_*`) : vrai = déclaré adapté, faux = déclaré non adapté, absent (0 ou vide dans le GTFS) = non renseigné."""
    return FILLED if v is True else NOT_FILLED if v is False else NOT_STATED


def _sign(v: Any) -> str:
    """TRA03 : « true » = déclaré ; « false » et « partial » = non remplie ; « unknown », vide ou ligne absente = non renseigné."""
    return FILLED if v == "true" else NOT_FILLED if v in ("false", "partial") else NOT_STATED


def _station(s: Any) -> str:
    """TRA04 : niveaux 4 et 6 = rempli ; 3 et 1 = non rempli ; gare absente du jeu ou niveau inconnu = non renseigné."""
    level = s.get("level") if isinstance(s, Mapping) else None
    if level in STATION_FILLED_LEVELS:
        return FILLED
    if level in STATION_NOT_FILLED_LEVELS:
        return NOT_FILLED
    return NOT_STATED


def box_state(box: str, legs: Sequence[Mapping[str, Any]] | None) -> str:
    """État d'une case sur TOUS les tronçons en TC d'un trajet (un sens). `legs` : tronçons publiés (`wc_*`, `a11y`).

    Case des gares : seules comptent les gares présentes dans le tronçon (`st_from` / `st_to`, publiées par 06n pour un
    tronçon ferré ou un quai du jeu TRA04) ; sans aucune gare, `no_station` ne bloque pas. Un tronçon en TC sans `a11y`
    (06n non appliqué) ne permet pas d'affirmer l'absence de gare : `not_stated`."""
    rides = tc_legs(legs)
    if not rides:
        return NO_RIDE
    if box == "wc_trip":
        return _combine(_flag(lg.get("wc_trip")) for lg in rides)
    if box == "wc_stops":
        return _combine(_flag(lg.get(k)) for lg in rides for k in ("wc_from", "wc_to"))
    if box in ("audio", "visual"):
        return _combine(_sign((lg.get("a11y") or {}).get(box)) for lg in rides)
    if box == "station":
        if any(not isinstance(lg.get("a11y"), Mapping) for lg in rides):
            return NOT_STATED
        found = [_station(lg["a11y"][k]) for lg in rides for k in ("st_from", "st_to") if k in lg["a11y"]]
        return _combine(found) if found else NO_STATION
    raise ValueError(f"case inconnue : {box!r}")


def trip_boxes(legs: Sequence[Mapping[str, Any]] | None) -> dict[str, str]:
    return {b: box_state(b, legs) for b in BOXES}


def star_marked(out_legs: Sequence[Mapping[str, Any]] | None, ret_legs: Sequence[Mapping[str, Any]] | None,
                selected: Iterable[str]) -> bool:
    """L'astre est-il marqué ? Seulement si, parmi les cases cochées 1, 2 et 3 (`SKY_BOXES`), TOUTES sont déclarées
    remplies sur tout le trajet le plus rapide, ALLER ET RETOUR. Aucune case 1 à 3 cochée (seulement 4 et 5, ou rien) :
    jamais de marque. Un sens sans tronçon en TC (marche seule) ou absent : pas de marque. Sans gare ferrée, la case 3
    n'empêche pas la marque."""
    chosen = set(selected)
    sel = [b for b in SKY_BOXES if b in chosen]
    if not sel:
        return False
    for legs in (out_legs, ret_legs):
        for b in sel:
            if box_state(b, legs) not in (FILLED, NO_STATION):
                return False
    return True


# --- Alignement des tronçons publiés sur les lots de 04h -------------------------------------------------------

def leg_matches(pub: Mapping[str, Any], enriched: Mapping[str, Any], hhmm: Any) -> bool:
    """Le tronçon publié est-il celui des lots de 04h (même famille, mêmes heures, même ligne) ?"""
    if pub.get("m") != enriched.get("kind"):
        return False
    if pub.get("dep") != hhmm(enriched["dep_s"]) or pub.get("arr") != hhmm(enriched["arr_s"]):
        return False
    if pub.get("m") == "walk":
        return True
    line = enriched.get("line")
    return typo(line) == pub.get("line")


def annotate_trip(trip: Mapping[str, Any], enriched_legs: Sequence[Mapping[str, Any]], facts: NeedsFacts,
                  hhmm: Any) -> dict[str, Any]:
    """Trajet publié avec `a11y` sur chaque tronçon en TC (retiré puis recalculé : idempotent). Lève ValueError si
    les tronçons ne correspondent pas aux lots de 04h (rien n'est deviné)."""
    legs = trip["legs"]
    if len(legs) != len(enriched_legs):
        raise ValueError(f"{len(legs)} tronçons publiés, {len(enriched_legs)} dans les lots de 04h")
    new_legs = []
    for pub, e in zip(legs, enriched_legs, strict=True):
        if not leg_matches(pub, e, hhmm):
            raise ValueError(f"tronçon publié {pub.get('m')} {pub.get('line')} {pub.get('dep')} différent des lots "
                             f"({e.get('kind')} {e.get('line')})")
        lg = {k: v for k, v in pub.items() if k != "a11y"}
        if pub.get("m") != "walk":
            lg["a11y"] = facts.leg_a11y(e.get("kind"), e.get("route_id"), e.get("from_stop"), e.get("to_stop"))
        new_legs.append(lg)
    return {**trip, "legs": new_legs}


def file_meta(tra03_snapshot: str | None, tra04_snapshot: str | None) -> dict[str, Any]:
    return {"contract": NEEDS_CONTRACT, "sources": list(SOURCES), "tra03_snapshot": tra03_snapshot,
            "tra04_snapshot": tra04_snapshot}


def with_meta(doc: Mapping[str, Any], block: Mapping[str, Any]) -> dict[str, Any]:
    """Bloc `needs_meta` juste avant `days` (ordre de clés stable)."""
    out: dict[str, Any] = {}
    for k, v in doc.items():
        if k == "needs_meta":
            continue
        if k == "days":
            out["needs_meta"] = dict(block)
        out[k] = v
    return out


def strip_needs(doc: Mapping[str, Any]) -> dict[str, Any]:
    """Fichier sans les champs de ce réglage (mesure du poids ajouté, retour arrière)."""
    days = {d: {direction: [t if t.get("status") != "ok" else
                            {**t, "legs": [{k: v for k, v in lg.items() if k != "a11y"} for lg in t["legs"]]}
                            for t in row] for direction, row in dirs.items()} for d, dirs in doc["days"].items()}
    return {k: (days if k == "days" else v) for k, v in doc.items() if k != "needs_meta"}


def published_meta(blocks: Iterable[Mapping[str, Any] | None], levels: Mapping[int, str]) -> dict[str, Any] | None:
    """`meta.needs` : bloc commun à tous les fichiers publiés + identifiants des cases + libellés exacts des niveaux de
    TRA04 ; None sinon. Les textes affichés sont ceux du front (depuis la version finale du 05/11 : plus de `texts`)."""
    bl = list(blocks)
    if not bl or any(b is None or b != bl[0] for b in bl):
        return None
    return {**bl[0], "needs": list(NEEDS), "station_levels": {str(k): v for k, v in levels.items()}}


def levels_from_file(tra04: Path) -> dict[int, str]:
    """Libellés exacts des niveaux de TRA04 (publiés dans `meta.needs.station_levels`)."""
    return load_stations(pd.read_csv(tra04, sep=";", encoding="utf-8-sig", dtype=str))[1]


def published_from_docs(docs: Iterable[Mapping[str, Any]], tra04: Path) -> dict[str, Any] | None:
    """`meta.needs` relu des fichiers publiés (06) : None si aucun fichier n'a `needs_meta` (réglage non appliqué) ou
    si les blocs diffèrent d'un fichier à l'autre ; TRA04 n'est lu que si le réglage est appliqué."""
    blocks = [d.get("needs_meta") for d in docs]
    if not blocks or all(b is None for b in blocks):
        return None
    return published_meta(blocks, levels_from_file(tra04))


# --- Contrôle (07) ---------------------------------------------------------------------------------------------

def a11y_errors(lg: Mapping[str, Any], expected: bool) -> list[str]:
    """Forme du champ `a11y` d'un tronçon publié."""
    if lg.get("m") == "walk":
        return ["a11y sur un tronçon à pied"] if "a11y" in lg else []
    if not expected:
        return ["a11y sans needs_meta"] if "a11y" in lg else []
    a = lg.get("a11y")
    if not isinstance(a, dict):
        return ["a11y absent d'un tronçon en TC"]
    errs: list[str] = []
    if a.get("line", "x") is not None and a.get("line") not in LINE_ACCESS_VALUES:
        errs.append(f"line {a.get('line')!r}")
    for k in ("audio", "visual"):
        if a.get(k, "x") is not None and a.get(k) not in SIGN_VALUES:
            errs.append(f"{k} {a.get(k)!r}")
    if lg.get("m") in RAIL_KINDS and ("st_from" not in a or "st_to" not in a):
        errs.append("gare absente d'un tronçon ferré")
    for k in ("st_from", "st_to"):
        s = a.get(k)
        if s is not None and (not isinstance(s, dict) or not isinstance(s.get("level"), int)):
            errs.append(f"{k} {s!r}")
    return errs


# --- Fichiers publiés : .json (main au 04/11) ou .json.gz (branche data/panneau-lignes) ------------------------

def doc_files(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    gz = sorted(directory.glob("*.json.gz"))
    return gz if gz else sorted(directory.glob("*.json"))


def insee_of(path: Path) -> str:
    return path.name.split(".", 1)[0]


def read_doc(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    if path.name.endswith(".gz"):
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def encode_doc(path: Path, doc: Mapping[str, Any]) -> bytes:
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return gzip.compress(text, compresslevel=9, mtime=0) if path.name.endswith(".gz") else text


def write_doc(path: Path, doc: Mapping[str, Any]) -> int:
    """Écrit si le contenu change (idempotent) ; rend le nombre d'octets publiés."""
    data = encode_doc(path, doc)
    if not path.exists() or path.read_bytes() != data:
        path.write_bytes(data)
    return len(data)
