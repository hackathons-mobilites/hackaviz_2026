"""Découvertes (insights.json) : scénarios remarquables détectés dans la matrice calculée.

Contrat : skill starway-data-pipeline/references/contrats-donnees.md § insights.json.
Tout écart vient de la matrice réelle : aucun seuil ne fabrique d'écart, on classe seulement ceux qui existent.
Accessible(B) <=> out <= B ET ret <= B (règle de vérité n°3).

Modes partiels (D-014 : vélo + TC calculé pour quelques communes seulement) : une commune sans le mode, ou une
cellule dont un pôle porte une raison « pas de résultat » (`not_computed`, `origin_not_snapped`), est EXCLUE de la
comparaison. Seules `no_trip_within_120` et `no_service_at_hour` sont des résultats (aucun trajet trouvé) : elles
comptent comme « non accessible ». Ainsi, un écart ne peut jamais venir d'une valeur manquante.

Retours non mesurés (`no_stop_within_walk_limit`, posée par 06 d'après 07b) ou contestés (retour nul alors que
l'indice relais de 07b est <= 120 min, `suspect`) : le pôle compte comme non accessible dans le calcul, mais toute
découverte dont le verdict, AU BUDGET PUBLIÉ, repose sur un tel pôle (aller trouvé et dans le budget, retour nul) est
écartée AVANT le classement (`split_unmeasured`) : les suivantes remontent.

Écart supplémentaire (`extra_cause`, fourni par 06) : découvertes contredites par le recoupement Navitia
(`navitia_contradicted`, scripts/07d_navitia_crosscheck.py), écartées de la même façon avant le classement.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from typing import Any

from starway.gold import CommuneParts, gold_delta

# access[insee][mode][day] = {"out": [...], "ret": [...], "reason": [...]} (indexés comme poles.json) ;
# day = "any" possible ; "reason" facultatif (absent = aucune valeur nulle non justifiée)
Access = Mapping[str, Mapping[str, Mapping[str, Mapping[str, Sequence[Any]]]]]
NO_RESULT_REASONS = frozenset({"not_computed", "origin_not_snapped"})
UNMEASURED_REASON = "no_stop_within_walk_limit"  # starway.egress.REASON_WALK_LIMIT

REFERENCE_DAY = "d09"
# « Communes proches » pour territorial_gap = communes CONTIGUËS (contours GEO01 qui se touchent, calculés par
# 02_build_geo.py dans data/processed/adjacency_2026.csv). Aucune distance seuil.


def accessible_mask(out: Sequence[int | None], ret: Sequence[int | None], budget: int) -> list[bool]:
    return [o is not None and r is not None and o <= budget and r <= budget for o, r in zip(out, ret, strict=True)]


def jobs_of(mask: Sequence[bool], jobs: Sequence[int]) -> int:
    return int(sum(j for m, j in zip(mask, jobs, strict=True) if m))


def _cell(access: Access, insee: str, mode: str, day: str) -> Mapping[str, Sequence[Any]] | None:
    """Cellule (mode, journée) d'une commune, ou None si absente OU incomplète (un pôle sans résultat calculé)."""
    m = access.get(insee, {}).get(mode, {})
    c = m.get(day) or m.get("any")
    if c is None or any(r in NO_RESULT_REASONS for r in (c.get("reason") or [])):
        return None
    return c


def _best(deltas: Mapping[int, tuple[int, int]]) -> tuple[int, int, int, bool] | None:
    """deltas[budget] = (jobs_delta, poles_delta), jobs_delta > 0 = écart dans le sens étudié.
    Renvoie (budget retenu, jobs_delta, poles_delta, robust) ou None si aucun écart."""
    pos = {b: d for b, d in deltas.items() if d[0] > 0}
    if not pos:
        return None
    b = max(pos, key=lambda k: (pos[k][0], -k))  # écart max ; à égalité, le plus petit budget
    return b, pos[b][0], pos[b][1], len(pos) >= 2


def _item(kind: str, scenario: dict, jobs_delta: int, poles_delta: int, robust: bool,
          jobs: int, jobs_ref: int) -> dict[str, Any]:
    return {"id": None, "kind": kind, "scenario": scenario,
            "metric": {"jobs_delta": jobs_delta, "poles_delta": poles_delta, "jobs": jobs, "jobs_ref": jobs_ref},
            "rank": None, "robust": robust}


def eclipse(access: Access, jobs: Sequence[int], budgets: Sequence[int], days: Sequence[str],
            mode: str = "transit") -> list[dict]:
    """Postes accessibles perdus en passant de la journée de référence (9h-17h) à une autre journée-type."""
    out = []
    for insee in access:
        ref = _cell(access, insee, mode, REFERENCE_DAY)
        if ref is None:
            continue
        for day in days:
            if day == REFERENCE_DAY or (cell := _cell(access, insee, mode, day)) is None:
                continue
            deltas, detail = {}, {}
            for b in budgets:
                m_ref, m_day = accessible_mask(ref["out"], ref["ret"], b), accessible_mask(cell["out"], cell["ret"], b)
                j_ref, j_day = jobs_of(m_ref, jobs), jobs_of(m_day, jobs)
                deltas[b] = (j_ref - j_day, sum(m_ref) - sum(m_day))
                detail[b] = (j_day, j_ref)
            if (best := _best(deltas)) is None:
                continue
            b, dj, dp, robust = best
            sc = {"o": insee, "d": day, "b": b, "m": mode, "vs": None, "compare_day": REFERENCE_DAY}
            out.append(_item("eclipse", sc, -dj, -dp, robust, *detail[b]))
    return out


def late_return(access: Access, jobs: Sequence[int], budgets: Sequence[int], days: Sequence[str],
                mode: str = "transit") -> list[dict]:
    """Pôles joignables à l'aller dans le budget mais dont le retour dépasse le budget (ou est impossible)."""
    out = []
    for insee in access:
        for day in days:
            if (cell := _cell(access, insee, mode, day)) is None:
                continue
            deltas, detail = {}, {}
            for b in budgets:
                lost = [o is not None and o <= b and (r is None or r > b) for o, r in zip(cell["out"], cell["ret"], strict=True)]
                deltas[b] = (jobs_of(lost, jobs), sum(lost))
                detail[b] = (jobs_of(accessible_mask(cell["out"], cell["ret"], b), jobs),
                             jobs_of([o is not None and o <= b for o in cell["out"]], jobs))
            if (best := _best(deltas)) is None:
                continue
            b, dj, dp, robust = best
            sc = {"o": insee, "d": day, "b": b, "m": mode, "vs": None, "compare_day": None}
            out.append(_item("late_return", sc, -dj, -dp, robust, *detail[b]))
    return out


def bike_gain(access: Access, jobs: Sequence[int], budgets: Sequence[int], days: Sequence[str],
              commune_parts_of: CommuneParts | None = None) -> list[dict]:
    """Postes gagnés (aller ET retour) en vélo + TC par rapport aux TC + marche, même journée, même budget, comptés
    sur les seuls astres en or (`starway.gold`, D-056). `jobs_delta` et `poles_delta` sont ceux de l'or, `jobs` =
    `jobs_ref` + `jobs_delta`. Sans part TC commune par commune lisible : aucune découverte de ce type."""
    if commune_parts_of is None:
        return []
    out = []
    for insee in access:
        for day in days:
            tc, bk = _cell(access, insee, "transit", day), _cell(access, insee, "bike_transit", day)
            if tc is None or bk is None:
                continue
            deltas, detail = {}, {}
            for b in budgets:
                gold, _ = gold_delta(tc, bk, b, commune_parts_of(insee, day, b))
                if gold is None:
                    deltas = {}
                    break
                j_gold = sum(int(jobs[i]) for i in gold)
                j_tc = jobs_of(accessible_mask(tc["out"], tc["ret"], b), jobs)
                deltas[b] = (j_gold, len(gold))
                detail[b] = (j_tc + j_gold, j_tc)
            if (best := _best(deltas)) is None:
                continue
            b, dj, dp, robust = best
            sc = {"o": insee, "d": day, "b": b, "m": "bike_transit", "vs": None, "compare_day": None}
            out.append(_item("bike_gain", sc, dj, dp, robust, *detail[b]))
    return out


def territorial_gap(access: Access, jobs: Sequence[int], budgets: Sequence[int],
                    neighbours: Iterable[tuple[str, str]], day: str = REFERENCE_DAY,
                    mode: str = "transit") -> list[dict]:
    """Écart entre deux communes contiguës : `o` = la moins bien reliée, `vs` = l'autre."""
    out = []
    for a, b_ in sorted({tuple(sorted(p)) for p in neighbours}):
        ca, cb = _cell(access, a, mode, day), _cell(access, b_, mode, day)
        if ca is None or cb is None:
            continue
        ja = {b: jobs_of(accessible_mask(ca["out"], ca["ret"], b), jobs) for b in budgets}
        jb = {b: jobs_of(accessible_mask(cb["out"], cb["ret"], b), jobs) for b in budgets}
        pa = {b: sum(accessible_mask(ca["out"], ca["ret"], b)) for b in budgets}
        pb = {b: sum(accessible_mask(cb["out"], cb["ret"], b)) for b in budgets}
        for lo, hi, jl, jh, pl, ph in ((a, b_, ja, jb, pa, pb), (b_, a, jb, ja, pb, pa)):
            best = _best({b: (jh[b] - jl[b], ph[b] - pl[b]) for b in budgets})
            if best is None:
                continue
            b, dj, dp, robust = best
            sc = {"o": lo, "d": day, "b": b, "m": mode, "vs": hi, "compare_day": None}
            out.append(_item("territorial_gap", sc, -dj, -dp, robust, jl[b], jh[b]))
    return out


def _rank_key(x: Mapping[str, Any]) -> tuple:
    return (not x["robust"], -abs(x["metric"]["jobs_delta"]), x["scenario"]["o"], x["scenario"]["d"],
            x["scenario"]["vs"] or "")


def rank(items: list[dict], top_n: int) -> list[dict]:
    """Classe par kind : robustes d'abord, puis |jobs_delta| décroissant ; garde top_n par kind ; ids stables."""
    out: list[dict] = []
    for kind in ("eclipse", "territorial_gap", "bike_gain", "late_return"):
        ks = [x for x in items if x["kind"] == kind]
        ks.sort(key=_rank_key)
        for r, x in enumerate(ks[:top_n], start=1):
            out.append({**x, "id": f"{kind}_{r:02d}", "rank": r})
    return out


# Signalements « retour contesté » par pôle : suspect[(insee, journée)] = indices des pôles (mode TC) dont le retour
# est nul alors que l'indice relais de 07b (retour publié vers une autre commune + marche) est fini et <= 120 min :
# un trajet qui finit par plus de 2 000 m de marche existe probablement (docs/analyse-limite-marche-r5.md § 2.5).
Suspect = Mapping[tuple[str, str], Collection[int]]
CAUSE_UNMEASURED = UNMEASURED_REASON
CAUSE_RELAY = "relay_index"


def unmeasured_at(cell: Mapping[str, Sequence[Any]], budget: int, suspect: Collection[int] = ()) -> list[int]:
    """Indices des pôles dont le verdict au budget dépend d'un retour nul non établi : aller trouvé et <= budget,
    retour nul, et soit la raison `no_stop_within_walk_limit`, soit un signalement `suspect` (indice relais).
    (Aller au-delà du budget : non accessible quel que soit le retour, le verdict ne dépend pas du retour.)"""
    reasons = cell.get("reason") or [None] * len(cell["out"])
    return [i for i, (o, r, rs) in enumerate(zip(cell["out"], cell["ret"], reasons, strict=True))
            if o is not None and o <= budget and r is None and (rs == UNMEASURED_REASON or i in suspect)]


def compared_cells(item: Mapping[str, Any]) -> list[tuple[str, str, str]]:
    """(commune, mode, journée) des cellules comparées par une découverte."""
    sc = item["scenario"]
    cells = [(sc["o"], sc["m"], sc["d"])]
    if item["kind"] == "eclipse":
        cells.append((sc["o"], sc["m"], sc["compare_day"]))
    elif item["kind"] == "territorial_gap":
        cells.append((sc["vs"], sc["m"], sc["d"]))
    elif item["kind"] == "bike_gain":
        cells.append((sc["o"], "transit", sc["d"]))
    return cells


def unmeasured_cause(item: Mapping[str, Any], access: Access, suspect: Suspect | None = None) -> str | None:
    """Cause d'exclusion d'une découverte, ou None : `no_stop_within_walk_limit` si son verdict au budget publié
    repose sur un retour non mesuré, sinon `relay_index` s'il repose sur un retour nul contesté par l'indice relais."""
    b = item["scenario"]["b"]
    relay = False
    for insee, mode, day in compared_cells(item):
        c = _cell(access, insee, mode, day)
        if c is None:
            continue
        if unmeasured_at(c, b):
            return CAUSE_UNMEASURED
        if suspect and mode == "transit" and unmeasured_at(c, b, suspect.get((insee, day), ())):
            relay = True
    return CAUSE_RELAY if relay else None


def relies_on_unmeasured(item: Mapping[str, Any], access: Access, suspect: Suspect | None = None) -> bool:
    return unmeasured_cause(item, access, suspect) is not None


ExtraCause = Callable[[Mapping[str, Any]], str | None]
CAUSE_NAVITIA = "navitia_contradicted"


def split_unmeasured(items: list[dict], access: Access, suspect: Suspect | None = None,
                     extra_cause: ExtraCause | None = None) -> tuple[list[dict], list[dict]]:
    """(gardées, écartées avec leur cause dans `excluded_cause`)."""
    kept, dropped = [], []
    for x in items:
        cause = unmeasured_cause(x, access, suspect) or (extra_cause(x) if extra_cause else None)
        if cause is None:
            kept.append(x)
        else:
            dropped.append({**x, "excluded_cause": cause})
    return kept, dropped


def _key(x: Mapping[str, Any]) -> tuple:
    sc = x["scenario"]
    return (x["kind"], sc["o"], sc["d"], sc["b"], sc["m"], sc["vs"], sc["compare_day"])


def scenario_key(x: Mapping[str, Any]) -> tuple:
    """Identité d'une découverte d'un export à l'autre (l'`id` dépend du rang, pas le scénario)."""
    return _key(x)


def rank_excluded(items: list[dict], causes: Mapping[tuple, str], top_n: int) -> list[dict]:
    """Écartées qui auraient été publiées : par type, dans l'ordre du classement complet, toute écartée rencontrée
    avant que les `top_n` places publiées soient pourvues. `id` / `rank` = sa place dans le classement complet (sans
    aucun écart) : `eclipse_10` si elle était 10e, `eclipse_11` si elle ne remontait qu'à la suite d'un autre écart."""
    out: list[dict] = []
    for kind in KINDS:
        ks = sorted((x for x in items if x["kind"] == kind), key=_rank_key)
        n_kept = 0
        for pos, x in enumerate(ks, start=1):
            if n_kept >= top_n:
                break
            k = _key(x)
            if k in causes:
                out.append({**x, "id": f"{kind}_{pos:02d}", "rank": pos, "excluded_cause": causes[k]})
            else:
                n_kept += 1
    return out


def compute_insights(access: Access, jobs: Sequence[int], budgets: Sequence[int], days: Sequence[str],
                     neighbours: Iterable[tuple[str, str]], top_n: int = 10,
                     excluded: list[dict] | None = None, suspect: Suspect | None = None,
                     extra_cause: ExtraCause | None = None, commune_parts_of: CommuneParts | None = None) -> list[dict]:
    """Découvertes classées. Si `excluded` est une liste, on y ajoute les découvertes écartées (retour non mesuré
    ou contesté, ou cause `extra_cause`, par exemple `navitia_contradicted`) qui auraient figuré dans le classement
    sans cet écart (`rank_excluded`), avec l'`id` et le `rank` qu'elles auraient eus et leur `excluded_cause`."""
    items = (eclipse(access, jobs, budgets, days) + late_return(access, jobs, budgets, days)
             + bike_gain(access, jobs, budgets, days, commune_parts_of) + territorial_gap(access, jobs, budgets, neighbours))
    kept, dropped = split_unmeasured(items, access, suspect, extra_cause)
    if excluded is not None and dropped:
        excluded += rank_excluded(items, {_key(x): x["excluded_cause"] for x in dropped}, top_n)
    return rank(kept, top_n)


KINDS = ("eclipse", "territorial_gap", "bike_gain", "late_return")


def fr_int(n: int) -> str:
    """1285 -> « 1 285 » (séparateur de milliers : espace simple)."""
    return f"{n:,}".replace(",", " ")


def kinds_status(coverage: Mapping[str, Sequence[str]], all_origins: Iterable[str]) -> dict[str, dict[str, str]]:
    """Pour chaque type de découverte : `ok` si la couverture permet un classement honnête, sinon `not_computed`
    avec la raison (écrite dans meta.json). Aucun seuil : la règle est « toute la population concernée est calculée ».

    - eclipse, late_return, territorial_gap : classement sur TOUTES les origines ; tant que la matrice TC est
      partielle, un classement ne porterait que sur les premiers codes INSEE (ordre du calcul), donc biaisé ;
    - bike_gain : le vélo + TC n'est calculé que pour les communes du récit et leurs limitrophes (D-014) ; le
      classement porte sur elles seules (portée écrite dans `scope`), à condition que leurs TC soient calculés."""
    all_o = set(all_origins)
    tc = set(coverage.get("transit", []))
    bt = set(coverage.get("bike_transit", []))
    out: dict[str, dict[str, str]] = {}
    for kind in ("eclipse", "territorial_gap", "late_return"):
        if tc == all_o and all_o:
            out[kind] = {"status": "ok", "scope": f"toutes les origines ({len(all_o)})"}
        else:
            n_tc = len(tc & all_o)
            out[kind] = {"status": "not_computed",
                         "reason": f"Les découvertes seront publiées quand toutes les communes seront calculées "
                                   f"({fr_int(n_tc)} sur {fr_int(len(all_o))} aujourd'hui).",
                         "detail": f"matrice TC publiée pour {n_tc} origines sur {len(all_o)} ; un classement limité "
                                   "aux communes déjà calculées dépendrait de l'ordre du calcul (codes INSEE "
                                   "croissants : Paris, puis la Seine-et-Marne)"}
    if bt and bt <= tc:
        out["bike_gain"] = {"status": "ok", "scope": f"{len(bt)} origines calculées en vélo + TC (communes du "
                                                     "récit et communes limitrophes, D-014)"}
    else:
        out["bike_gain"] = {"status": "not_computed",
                            "reason": "Le vélo jusqu'à la gare n'est pas encore calculé." if not bt else
                                      "Les gains du vélo jusqu'à la gare seront publiés quand les transports en "
                                      "commun de ces communes seront calculés.",
                            "detail": "aucune origine calculée en vélo + TC (04b)" if not bt else
                                      f"{len(bt - tc)} origines calculées en vélo + TC sans matrice TC publiée"}
    return {k: out[k] for k in KINDS}
