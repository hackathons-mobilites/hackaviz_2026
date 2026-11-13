"""Aide au choix des communes du récit (actes 1 à 3) : classements reproductibles tirés de la matrice TC.

Aucun seuil : on CLASSE des écarts qui existent dans la matrice (aller ET retour dans le budget), avec la même règle
de robustesse que insights.json (écart présent à au moins deux budgets). La seule granularité choisie est celle des
classes de comparabilité des paires (quantiles de population et de distance au centre, nombre de classes affiché
dans le rapport et testé à deux niveaux pour montrer la sensibilité).

Retours non mesurés (limite de marche finale de R5, raison `no_stop_within_walk_limit` de l'export) : `Cell.unmeasured`
donne les pôles dont le retour nul n'est pas mesuré ; une ligne dont le verdict au budget retenu en dépend porte
`unmeasured = True` (même règle que starway.insights.unmeasured_at) et 08 la sort du classement.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

import pandas as pd

from starway.insights import accessible_mask, jobs_of

REFERENCE_DAY = "d09"
OTHER_DAYS = ("d06", "d14")


@dataclass(frozen=True)
class Cell:
    out: list[int | None]
    ret: list[int | None]
    unmeasured: frozenset[int] = field(default_factory=frozenset)  # pôles au retour nul non mesuré


def relies_on(cell: Cell, budget: int) -> bool:
    """Le verdict de la cellule au budget dépend d'un retour non mesuré : aller trouvé et dans le budget."""
    return any(cell.out[i] is not None and cell.out[i] <= budget for i in cell.unmeasured)


def _int(v: object) -> int | None:
    return None if pd.isna(v) else int(v)


def cells_from_matrix(m: pd.DataFrame, pole_ids: Sequence[str], marked: Iterable[str] = ()) -> dict[str, Cell]:
    """Matrice publiée (from_id, to_id, out, ret) -> {insee: Cell} indexée comme poles.json. `marked` : communes
    dont les retours nuls de cette journée ne sont pas mesurés (starway.egress.walk_limit_marks) ; seuls les pôles à
    aller trouvé sont retenus (même règle que starway.egress.mark_reason)."""
    marked = set(marked)
    out: dict[str, Cell] = {}
    for insee, g in m.groupby("from_id"):
        g = g.set_index("to_id").reindex(list(pole_ids))
        o, r = [_int(v) for v in g["out"]], [_int(v) for v in g["ret"]]
        um = frozenset(i for i, (a, b) in enumerate(zip(o, r, strict=True)) if a is not None and b is None) \
            if str(insee) in marked else frozenset()
        out[str(insee)] = Cell(o, r, um)
    return out


def eclipse_rows(cells: Mapping[str, Mapping[str, Cell]], jobs: Sequence[int], budgets: Sequence[int],
                 pole_names: Sequence[str]) -> pd.DataFrame:
    """Une ligne par (commune, journée 6h-14h ou 14h-22h) où des postes accessibles en 9h-17h sont perdus.
    `cells[insee][day]`. Budget retenu = écart maximal (à égalité, le plus petit) ; robust = écart à >= 2 budgets."""
    rows = []
    for insee, by_day in cells.items():
        ref = by_day.get(REFERENCE_DAY)
        if ref is None:
            continue
        for day in OTHER_DAYS:
            c = by_day.get(day)
            if c is None:
                continue
            per_b = {}
            for b in budgets:
                m_ref, m_day = accessible_mask(ref.out, ref.ret, b), accessible_mask(c.out, c.ret, b)
                per_b[b] = (jobs_of(m_ref, jobs) - jobs_of(m_day, jobs), m_ref, m_day)
            pos = {b: v for b, v in per_b.items() if v[0] > 0}
            if not pos:
                continue
            b = max(pos, key=lambda k: (pos[k][0], -k))
            lost, m_ref, m_day = pos[b]
            off = [i for i, (r, d) in enumerate(zip(m_ref, m_day, strict=True)) if r and not d]
            causes = []
            for i in off:
                o_bad = c.out[i] is None or c.out[i] > b
                r_bad = c.ret[i] is None or c.ret[i] > b
                causes.append(f"{pole_names[i]} ({'aller et retour' if o_bad and r_bad else 'aller' if o_bad else 'retour'})")
            rows.append({"insee": insee, "day": day, "budget": b, "jobs_lost": lost,
                         "jobs_ref": jobs_of(m_ref, jobs), "jobs_day": jobs_of(m_day, jobs),
                         "poles_off": "; ".join(causes), "robust": len(pos) >= 2,
                         "unmeasured": relies_on(c, b) or relies_on(ref, b)})
    df = pd.DataFrame(rows, columns=["insee", "day", "budget", "jobs_lost", "jobs_ref", "jobs_day", "poles_off",
                                     "robust", "unmeasured"])
    return df.sort_values(["robust", "jobs_lost", "insee"], ascending=[False, False, True]).reset_index(drop=True)


def quantile_class(values: pd.Series, n: int) -> pd.Series:
    """Classe de quantile 1..n (rangs, égalités au rang moyen) : population ou distance au centre."""
    r = values.rank(method="average", pct=True)  # rang centile dans ]0, 1]
    return (r * n).apply(math.ceil).clip(lower=1, upper=n).astype(int)


def pair_rows(cells_ref: Mapping[str, Cell], info: pd.DataFrame, jobs: Sequence[int], budgets: Sequence[int],
              n_classes: int) -> pd.DataFrame:
    """Paires de communes de même classe de population ET de même classe de distance au centre (quantiles calculés
    sur les communes de `info`), classées par écart de postes accessibles en 9h-17h. `info` : insee, population,
    dist_km. `o` = la moins bien reliée."""
    inf = info[info["insee"].isin(cells_ref)].copy()
    inf["c_pop"] = quantile_class(inf["population"], n_classes)
    inf["c_dist"] = quantile_class(inf["dist_km"], n_classes)
    acc = {i: {b: jobs_of(accessible_mask(c.out, c.ret, b), jobs) for b in budgets} for i, c in cells_ref.items()}
    rows = []
    for _, g in inf.groupby(["c_pop", "c_dist"]):
        ids = sorted(g["insee"])
        for x in range(len(ids)):
            for y in range(x + 1, len(ids)):
                a, b_ = ids[x], ids[y]
                d = {b: acc[b_][b] - acc[a][b] for b in budgets}
                sign = 1 if max(d.values(), key=abs) >= 0 else -1
                lo, hi = (a, b_) if sign > 0 else (b_, a)
                gaps = {b: acc[hi][b] - acc[lo][b] for b in budgets}
                pos = {b: v for b, v in gaps.items() if v > 0}
                if not pos:
                    continue
                bb = max(pos, key=lambda k: (pos[k], -k))
                rows.append({"o": lo, "vs": hi, "budget": bb, "jobs_gap": pos[bb], "jobs_o": acc[lo][bb],
                             "jobs_vs": acc[hi][bb], "robust": len(pos) >= 2,
                             "c_pop": int(g["c_pop"].iloc[0]), "c_dist": int(g["c_dist"].iloc[0]),
                             "unmeasured": relies_on(cells_ref[lo], bb) or relies_on(cells_ref[hi], bb)})
    df = pd.DataFrame(rows, columns=["o", "vs", "budget", "jobs_gap", "jobs_o", "jobs_vs", "robust", "c_pop",
                                     "c_dist", "unmeasured"])
    return df.sort_values(["robust", "jobs_gap", "o", "vs"], ascending=[False, False, True, True]).reset_index(drop=True)
