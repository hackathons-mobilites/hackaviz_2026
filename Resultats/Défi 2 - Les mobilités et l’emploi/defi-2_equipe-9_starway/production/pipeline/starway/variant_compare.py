"""Comparaison de la matrice TC publiée et de la variante « marche jusqu'à 2 h » (D-022 proposée, 04e).

Logique pure (pandas), testée dans tests/test_variant_compare.py ; script : scripts/07c_compare_walk_variant.py.
Les deux matrices sont d'abord passées par la même règle d'export que 06 (`matrix_io.cap_to_max_trip` : durée
au-delà de MAX_TRIP_MIN -> null), pour comparer ce qui serait publié.
"""

from __future__ import annotations

from collections.abc import Iterable

import pandas as pd

KEY = ["from_id", "to_id"]


def accessible(out: pd.Series, ret: pd.Series, budget: int) -> pd.Series:
    """Règle du front : aller ET retour connus et chacun <= budget (null = non accessible)."""
    return (out.notna() & ret.notna() & (out <= budget) & (ret <= budget)).astype(bool)


def paired(pub: pd.DataFrame, var: pd.DataFrame) -> pd.DataFrame:
    """Jointure stricte sur (commune, pôle) : les deux matrices doivent couvrir exactement les mêmes couples."""
    a = pub[KEY + ["out", "ret", "dep"]].rename(columns={"out": "out_pub", "ret": "ret_pub", "dep": "dep_pub"})
    b = var[KEY + ["out", "ret", "dep"]].rename(columns={"out": "out_var", "ret": "ret_var", "dep": "dep_var"})
    m = a.merge(b, how="outer", on=KEY, indicator=True)
    if (m["_merge"] != "both").any():
        bad = m.loc[m["_merge"] != "both", KEY].head(5).to_dict("records")
        raise ValueError(f"couples absents d'une des deux matrices : {bad}")
    m = m.drop(columns="_merge")
    for c in ("out_pub", "ret_pub", "out_var", "ret_var"):
        m[c] = pd.to_numeric(m[c]).astype("Int64")
    return m


def leg_summary(m: pd.DataFrame, leg: str) -> dict[str, int]:
    """Pour un sens (`out` ou `ret`) : trouvés en plus, perdus, plus courts, plus longs, identiques."""
    p, v = m[f"{leg}_pub"], m[f"{leg}_var"]
    both = p.notna() & v.notna()
    return {
        f"{leg}_found_more": int((p.isna() & v.notna()).sum()),
        f"{leg}_lost": int((p.notna() & v.isna()).sum()),
        f"{leg}_shorter": int((both & (v < p)).sum()),
        f"{leg}_longer": int((both & (v > p)).sum()),
        f"{leg}_same": int((both & (v == p)).sum()),
    }


def lost_walk_only(m: pd.DataFrame, walk: pd.DataFrame, leg: str) -> int:
    """Couples perdus (publié non nul, variante nulle) dont la durée publiée est celle du trajet tout à pied
    (matrice `walk` publiée) : le trajet publié était à pied de bout en bout, plus long que le réglage."""
    w = walk[KEY + [leg]].rename(columns={leg: "walk"})
    x = m.merge(w, how="left", on=KEY)
    lost = x[f"{leg}_pub"].notna() & x[f"{leg}_var"].isna()
    same = pd.to_numeric(x["walk"]).astype("Int64") == x[f"{leg}_pub"]
    return int((lost & same.fillna(False)).sum())


def no_return_communes(m: pd.DataFrame, col: str) -> set[str]:
    """Communes sans aucun retour (toutes les valeurs de `col` nulles)."""
    g = m.groupby("from_id")[col].apply(lambda s: s.isna().all())
    return set(g[g].index)


def day_summary(m: pd.DataFrame) -> dict[str, int]:
    pub_none = no_return_communes(m, "ret_pub")
    var_none = no_return_communes(m, "ret_var")
    return {
        "pairs": len(m),
        **leg_summary(m, "out"), **leg_summary(m, "ret"),
        "communes_ret_found_more": int(m.loc[m["ret_pub"].isna() & m["ret_var"].notna(), "from_id"].nunique()),
        "communes_no_return_pub": len(pub_none),
        "communes_no_return_var": len(var_none),
        "communes_no_return_resolved": len(pub_none - var_none),
    }


def matrix_errors(df: pd.DataFrame, start: pd.Timestamp) -> list[str]:
    """Contrôles de 07 appliqués à une matrice de lots (avant export) : une valeur ou une raison pour chaque sens,
    jamais de 0 ni de négatif, et l'aller retenu arrive au plus tard au début du poste (dep + out <= start)."""
    errs = []
    null = df["out"].isna() | df["ret"].isna()
    if (null & df["reason"].isna()).any():
        errs.append(f"{int((null & df['reason'].isna()).sum())} couples nuls sans raison")
    for c in ("out", "ret"):
        v = pd.to_numeric(df[c])
        if (v <= 0).any():
            errs.append(f"{int((v <= 0).sum())} valeurs {c} <= 0")
    ok = df["out"].notna() & df["dep"].notna()
    arrive = pd.to_datetime(df.loc[ok, "dep"]) + pd.to_timedelta(pd.to_numeric(df.loc[ok, "out"]), unit="min")
    if (arrive > start).any():
        errs.append(f"{int((arrive > start).sum())} allers arrivent après le début du poste")
    if (df["out"].notna() & df["dep"].isna()).any():
        errs.append("aller sans départ retenu")
    return errs


def verdict_changes(m: pd.DataFrame, budgets: Iterable[int], jobs: pd.Series | None = None) -> pd.DataFrame:
    """Par budget : couples et communes qui deviennent accessibles (gagnés) ou cessent de l'être (perdus).
    `jobs` (index = pôle) : postes salariés (INSEE) des pôles, pour sommer les postes des couples gagnés."""
    rows = []
    for b in budgets:
        a_pub = accessible(m["out_pub"], m["ret_pub"], b)
        a_var = accessible(m["out_var"], m["ret_var"], b)
        gained, lost = ~a_pub & a_var, a_pub & ~a_var
        row = {"budget": b, "accessible_pub": int(a_pub.sum()), "accessible_var": int(a_var.sum()),
               "gained_pairs": int(gained.sum()), "lost_pairs": int(lost.sum()),
               "gained_communes": int(m.loc[gained, "from_id"].nunique()),
               "lost_communes": int(m.loc[lost, "from_id"].nunique())}
        if jobs is not None:
            row["gained_jobs"] = int(m.loc[gained, "to_id"].map(jobs).sum())
            row["lost_jobs"] = int(m.loc[lost, "to_id"].map(jobs).sum())
        rows.append(row)
    return pd.DataFrame(rows)
