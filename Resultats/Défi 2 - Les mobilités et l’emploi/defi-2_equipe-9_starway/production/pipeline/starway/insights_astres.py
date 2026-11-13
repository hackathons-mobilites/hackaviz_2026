"""Découvertes (insights.json) des 44 astres, calculées sur la table commune x commune (D-019, choix de D-030).

Les 15 pôles se classaient sur `access/` (une durée par pôle). Avec les 44 astres, un astre est un bassin de plusieurs
communes : il est atteint EN PARTIE (part des postes de ses communes atteinte aller ET retour). Les découvertes se
calculent donc sur la table publiée `od_walk3000/o/{insee}.bin` (une série aller et une série retour par destination),
agrégée par astre avec les règles du front (`sky_groups.od_states`, `dest_status`, port de `computeOd`) :

- aller : départ le plus tardif arrivant avant le début du poste ; retour : à partir de la fin du poste, attente
  comprise ; une commune destination est atteinte si les deux tiennent dans le budget (aucun seuil nouveau) ;
- la commune de départ n'est jamais comptée (trajet non mesuré, décision du 05/11, point 4.1) ;
- un astre est « atteint » dès qu'au moins une de ses communes l'est (même mot que le ciel : « éclairé au moins en
  partie ») : `poles_delta` compte des astres, `jobs_delta` des postes salariés (INSEE) ;
- une origine dont une destination n'a pas de verdict (`unknown` : non calculé, point non raccordé) est EXCLUE du
  scénario : une valeur manquante ne fabrique jamais d'écart (même principe que `starway.insights`).

Types : `eclipse` (journée-type face à 9h-17h), `late_return` (aller dans le budget, retour hors budget ou introuvable),
`territorial_gap` (deux communes contiguës, 9h-17h, MÊMES destinations pour les deux : les deux communes sont retirées
des deux totaux, sinon chacune verrait les postes de l'autre et pas les siens), classés comme `starway.insights.rank`.
`bike_gain` n'est pas calculable : le vélo + TC n'est pas dans la table commune x commune (il est publié commune par
commune vers l'arrêt d'affichage de chaque astre, dans `access/`), la comparaison avec les TC de la table serait celle de
deux bases différentes.

Aucun texte n'est écrit ici : le front compose les phrases à partir des champs (contrat insights.json, « Découvertes »).
"""

from __future__ import annotations

import gzip
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from starway import od_export as ox
from starway import sky_groups as sg
from starway.insights import KINDS, REFERENCE_DAY, _best, _item, fr_int, rank

SKY = "44"
BASIS = "od_astres"
# Statut de recoupement tant que le calculateur d'IDFM n'a pas été interrogé pour ces scénarios (PRIM : hors de ce script)
CROSSCHECK_PENDING = "not_checked"
CAUSE_NAVITIA = "navitia_contradicted"  # contredite par Navitia sur access/ (07d) puis sur la table commune x commune
BIKE_GAIN_REASON = ("Pas de découverte sur le gain du vélo jusqu'à la gare : les découvertes sont classées sur la table "
                    "commune x commune, qui ne contient pas le vélo + TC.")


def bike_gain_detail(bike_transit_origins: int | None, astres: int | None) -> str:
    """Ce qui manque réellement au type `bike_gain` (10/11) : le vélo + TC est publié dans `access/` (nombre d'origines lu
    dans meta.json par 08e), mais pas dans la table commune x commune où les découvertes sont classées."""
    where = ("vélo + TC non publié" if not bike_transit_origins else
             f"vélo + TC publié pour {fr_int(bike_transit_origins)} communes de départ, vers l'arrêt d'affichage de "
             + (f"chacun des {astres} astres" if astres else "chaque astre") + " (fichiers access/)")
    return (where + " ; la table commune x commune ne contient que TC, marche, vélo et voiture ; comparer ce vélo + TC "
            "aux TC de la table mélangerait deux bases")


def bike_transit_origins(meta: Mapping[str, Any]) -> int | None:
    """Origines publiées en vélo + TC selon le contrat de meta.json : mode absent de `mode_coverage` = toutes les
    origines de `access_communes` ; None si le mode n'est pas dans `modes`."""
    if not any(m.get("id") == "bike_transit" for m in meta.get("modes") or []):
        return None
    cov = meta.get("mode_coverage") or {}
    return len(cov["bike_transit"]) if "bike_transit" in cov else len(meta.get("access_communes") or [])


@dataclass(frozen=True)
class DaySpec:
    id: str
    start: int  # minutes depuis minuit
    end: int


@dataclass(frozen=True)
class Reach:
    """Ce qu'une origine atteint un jour-type, à un budget (postes salariés (INSEE), hors commune de départ)."""

    reached: int  # postes des communes atteintes aller ET retour
    out_only: int  # postes des communes atteintes à l'aller seulement (retour hors budget ou introuvable)
    lit: int  # astres atteints au moins en partie
    out_only_astres: int  # astres qui ont au moins une commune « aller seulement »
    unknown: int  # postes des communes sans verdict : l'origine est écartée du scénario si > 0


@dataclass
class OriginResult:
    insee: str
    reach: dict[tuple[str, int], Reach]
    # d09 seulement, pour comparer deux voisines sur les mêmes destinations : masque « atteinte » par budget
    ref_masks: dict[int, np.ndarray]


def hhmm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def day_specs(day_types: Iterable[Mapping[str, Any]]) -> list[DaySpec]:
    """Journées-types de `meta.day_types` (06) : {id, label, start 'HH:MM', end 'HH:MM'}."""
    return [DaySpec(d["id"], hhmm(d["start"]), hhmm(d["end"])) for d in day_types]


def group_of_communes(codes: Sequence[str], astres: Sequence[Mapping]) -> list[int | None]:
    """Index d'astre de chaque commune (ordre de `poles.json`), même règle que `od_export.pole_of`."""
    return ox.pole_of(codes, astres)


def read_swod(path: Path) -> ox.ParsedFile:
    raw = path.read_bytes()
    return ox.parse_file(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)


def origin_reach(pf: ox.ParsedFile, n_dest: int, jobs: Sequence[int], group_of: Sequence[int | None],
                 mode_code: int, days: Sequence[DaySpec], budgets: Sequence[int], lookback: int,
                 insee: str = "") -> OriginResult:
    """Atteintes d'une origine par journée-type et budget. Les durées aller et retour de chaque destination sont
    lues une fois par journée, puis jugées à chaque budget (`sg.dest_status`, port exact du front)."""
    recs = pf.series.get(mode_code, {})
    jobs_a = np.asarray(jobs, dtype=np.int64)
    grp = np.array([-1 if g is None else g for g in group_of], dtype=np.int64)
    reach: dict[tuple[str, int], Reach] = {}
    ref_masks: dict[int, np.ndarray] = {}
    for day in days:
        status: dict[int, list[str]] = {b: [] for b in budgets}
        for y in range(n_dest):
            if y in recs:
                o, r = recs[y]
                out = ox.outbound(o, pf.first, day.start, pf.step, lookback, pf.max_trip)
                ret = ox.inbound(r, pf.first, day.end, pf.step, pf.max_trip)
                for b in budgets:
                    status[b].append(sg.dest_status(out, ret, b))
            elif y == pf.origin:
                for b in budgets:
                    status[b].append("self")
            else:  # aucun enregistrement : aucun trajet en 120 min dans les deux sens (table complète, contrôlée par l'appelant)
                for b in budgets:
                    status[b].append("none")
        for b in budgets:
            st = np.array(status[b])
            acc, oo, unk = st == "accessible", st == "out_only", st == "unknown"
            has_group = grp >= 0
            reach[(day.id, b)] = Reach(
                reached=int(jobs_a[acc & has_group].sum()), out_only=int(jobs_a[oo & has_group].sum()),
                lit=len(set(grp[acc & has_group].tolist())), out_only_astres=len(set(grp[oo & has_group].tolist())),
                unknown=int(jobs_a[unk & has_group].sum()))
            if day.id == REFERENCE_DAY:
                ref_masks[b] = acc & has_group
    return OriginResult(insee, reach, ref_masks)


# --------------------------------------------------------------------------- détecteurs
def _usable(res: Mapping[str, OriginResult], insee: str, day: str, budgets: Sequence[int]) -> bool:
    r = res.get(insee)
    return r is not None and all((day, b) in r.reach and r.reach[(day, b)].unknown == 0 for b in budgets)


def eclipse(res: Mapping[str, OriginResult], budgets: Sequence[int], days: Sequence[str]) -> list[dict]:
    """Postes (et astres) perdus en passant de la journée de référence (9h-17h) à une autre journée-type."""
    out = []
    for insee in sorted(res):
        if not _usable(res, insee, REFERENCE_DAY, budgets):
            continue
        for day in days:
            if day == REFERENCE_DAY or not _usable(res, insee, day, budgets):
                continue
            deltas, detail = {}, {}
            for b in budgets:
                ref, cur = res[insee].reach[(REFERENCE_DAY, b)], res[insee].reach[(day, b)]
                deltas[b] = (ref.reached - cur.reached, ref.lit - cur.lit)
                detail[b] = (cur.reached, ref.reached)
            if (best := _best(deltas)) is None:
                continue
            b, dj, dp, robust = best
            sc = {"o": insee, "d": day, "b": b, "m": "transit", "vs": None, "compare_day": REFERENCE_DAY}
            out.append(_item("eclipse", sc, -dj, -dp, robust, *detail[b]))
    return out


def late_return(res: Mapping[str, OriginResult], budgets: Sequence[int], days: Sequence[str]) -> list[dict]:
    """Communes atteintes à l'aller dans le budget dont le retour dépasse le budget ou n'est pas trouvé."""
    out = []
    for insee in sorted(res):
        for day in days:
            if not _usable(res, insee, day, budgets):
                continue
            deltas, detail = {}, {}
            for b in budgets:
                r = res[insee].reach[(day, b)]
                deltas[b] = (r.out_only, r.out_only_astres)
                detail[b] = (r.reached, r.reached + r.out_only)
            if (best := _best(deltas)) is None:
                continue
            b, dj, dp, robust = best
            sc = {"o": insee, "d": day, "b": b, "m": "transit", "vs": None, "compare_day": None}
            out.append(_item("late_return", sc, -dj, -dp, robust, *detail[b]))
    return out


def common_reach(res: Mapping[str, OriginResult], a: str, b: str, budget: int, jobs: np.ndarray, grp: np.ndarray,
                 idx: Mapping[str, int]) -> tuple[tuple[int, int], tuple[int, int]]:
    """((postes, astres) de a, (postes, astres) de b) sur les MÊMES destinations : les communes a et b sont retirées des
    deux côtés (la commune de départ n'est pas mesurée : sans cela chacune verrait les postes de l'autre, pas les siens)."""
    keep = np.ones(len(jobs), dtype=bool)
    keep[idx[a]] = keep[idx[b]] = False
    out = []
    for c in (a, b):
        m = res[c].ref_masks[budget] & keep
        out.append((int(jobs[m].sum()), len(set(grp[m].tolist()))))
    return out[0], out[1]


def territorial_gap(res: Mapping[str, OriginResult], budgets: Sequence[int], neighbours: Iterable[tuple[str, str]],
                    jobs: Sequence[int], group_of: Sequence[int | None], codes: Sequence[str],
                    day: str = REFERENCE_DAY) -> list[dict]:
    """Écart entre deux communes contiguës : `o` = la moins bien reliée, `vs` = l'autre."""
    jobs_a = np.asarray(jobs, dtype=np.int64)
    grp = np.array([-1 if g is None else g for g in group_of], dtype=np.int64)
    idx = {c: i for i, c in enumerate(codes)}
    out = []
    for a, b_ in sorted({tuple(sorted(p)) for p in neighbours}):
        if not (_usable(res, a, day, budgets) and _usable(res, b_, day, budgets)) or a not in idx or b_ not in idx:
            continue
        pairs = {b: common_reach(res, a, b_, b, jobs_a, grp, idx) for b in budgets}
        for lo, hi, k_lo, k_hi in ((a, b_, 0, 1), (b_, a, 1, 0)):
            deltas = {b: (pairs[b][k_hi][0] - pairs[b][k_lo][0], pairs[b][k_hi][1] - pairs[b][k_lo][1]) for b in budgets}
            if (best := _best(deltas)) is None:
                continue
            bb, dj, dp, robust = best
            sc = {"o": lo, "d": day, "b": bb, "m": "transit", "vs": hi, "compare_day": None}
            out.append(_item("territorial_gap", sc, -dj, -dp, robust, pairs[bb][k_lo][0], pairs[bb][k_hi][0]))
    return out


def scenario_key(x: Mapping[str, Any]) -> tuple[str, str]:
    """Identité d'une découverte indépendante de son rang (les identifiants sont réattribués à chaque classement)."""
    return x["kind"], json.dumps(x["scenario"], sort_keys=True)


def compute_insights(res: Mapping[str, OriginResult], budgets: Sequence[int], days: Sequence[str],
                     neighbours: Iterable[tuple[str, str]], jobs: Sequence[int], group_of: Sequence[int | None],
                     codes: Sequence[str], top_n: int = 10, exclude: set[tuple[str, str]] | None = None
                     ) -> list[dict] | tuple[list[dict], list[dict]]:
    """Découvertes classées. Avec `exclude` (découvertes contredites par Navitia, sur access/ puis sur la table) : rend aussi
    les découvertes écartées, avec l'identifiant qu'elles auraient eu ; les suivantes remontent, rien n'est ajusté."""
    items = (eclipse(res, budgets, days) + late_return(res, budgets, days)
             + territorial_gap(res, budgets, neighbours, jobs, group_of, codes))
    if exclude is None:
        return rank(items, top_n)
    would_be = rank([dict(x) for x in items], top_n + len(exclude))  # une écartée peut venir d'une remontée
    excluded = [x for x in would_be if scenario_key(x) in exclude]
    return rank([x for x in items if scenario_key(x) not in exclude], top_n), excluded


# --------------------------------------------------------------------------- statut, recoupement, sortie
def kinds_status(n_origins: int, n_usable: int, bike_transit_origins: int | None = None,
                 astres: int | None = None) -> dict[str, dict[str, str]]:
    """`ok` si toutes les origines ont un verdict (sinon la raison, jamais un classement partiel) ; bike_gain : non calculé
    (`detail` dit où le vélo + TC est publié, d'après `bike_transit_origins`)."""
    out: dict[str, dict[str, str]] = {}
    for kind in ("eclipse", "territorial_gap", "late_return"):
        if n_origins and n_usable == n_origins:
            out[kind] = {"status": "ok", "scope": f"toutes les origines ({n_origins})"}
        else:
            out[kind] = {"status": "not_computed",
                         "reason": f"Les découvertes seront publiées quand toutes les communes auront un verdict "
                                   f"({fr_int(n_usable)} sur {fr_int(n_origins)} aujourd'hui).",
                         "detail": f"{n_origins - n_usable} origines sans verdict sur au moins une destination (non "
                                   "calculé ou point non raccordé) : un classement partiel serait biaisé"}
    out["bike_gain"] = {"status": "not_computed", "reason": BIKE_GAIN_REASON,
                        "detail": bike_gain_detail(bike_transit_origins, astres)}
    return {k: out[k] for k in KINDS}


def published_items(items: Sequence[Mapping[str, Any]], crosscheck_of: Mapping[tuple[str, str], str] | None = None) -> list[dict]:
    """Découvertes écrites : `crosscheck` lu dans le recoupement Navitia (`crosscheck_of`, par scénario), sinon « not_checked »
    (jamais un statut inventé)."""
    cc = crosscheck_of or {}
    return [{**x, "crosscheck": cc.get(scenario_key(x), CROSSCHECK_PENDING)} for x in items]


def meta_insights_block(items: Sequence[Mapping[str, Any]], kinds: Mapping[str, Any], params: Mapping[str, Any],
                        excluded: Sequence[Mapping[str, Any]] = ()) -> dict[str, Any]:
    """Bloc `meta.insights` des 44 astres. `sky` et `basis` disent sur quoi les découvertes sont calculées ; `excluded`
    reste une liste (vide : aucun recoupement n'écarte quoi que ce soit)."""
    return {"written": bool(items), "sky": SKY, "basis": BASIS, "kinds": dict(kinds),
            "excluded": [{"would_be_id": x["id"], "kind": x["kind"], "scenario": x["scenario"], "cause": CAUSE_NAVITIA}
                         for x in excluded],
            "params": dict(params)}


def check_published(meta_insights: Mapping[str, Any] | None, items: Sequence[Mapping[str, Any]], budgets: Iterable[int],
                    origins: Iterable[str]) -> list[str]:
    """Contrôle (appelé par 07) d'un `insights.json` des 44 astres : écart de cohérence, liste vide = conforme."""
    bad: list[str] = []
    info = meta_insights or {}
    if info.get("basis") != BASIS or info.get("sky") != SKY:
        return [f"meta.insights.basis/sky : {info.get('basis')}/{info.get('sky')} au lieu de {BASIS}/{SKY}"]
    ok_kinds = {k for k, v in info.get("kinds", {}).items() if v.get("status") == "ok"}
    if "bike_gain" in ok_kinds:
        bad.append("bike_gain ne peut pas être « ok » : vélo + TC absent de la table commune x commune")
    if info.get("written") is not bool(items):
        bad.append("meta.insights.written incohérent")
    known, bset = set(origins), set(budgets)
    for x in items:
        sc = x["scenario"]
        if x["kind"] not in ok_kinds:
            bad.append(f"{x['id']} : type non autorisé")
        if sc["o"] not in known or sc["b"] not in bset or x["metric"]["jobs_delta"] == 0 or not isinstance(x["robust"], bool):
            bad.append(f"{x['id']} : scénario ou écart invalide")
        if x.get("crosscheck") not in ("not_checked", "confirmed", "within_one_minute"):
            bad.append(f"{x['id']} : statut de recoupement {x.get('crosscheck')} (contredite : jamais publiée)")
    if not isinstance(info.get("excluded", []), list):
        bad.append("meta.insights.excluded n'est pas une liste")
    return bad


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
