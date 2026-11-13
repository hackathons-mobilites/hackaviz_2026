"""Réseau de nuit (D-040) : choix des trajets du 6h-14h à recouper avec Navitia et lecture du recoupement.

CONTRÔLE seulement : rien d'affiché n'en vient. On compare, pour quelques trajets, la durée STARWAY du recalcul de nuit (avec
les courses de la veille codées 24:00 et plus) à celle du calculateur officiel d'IDFM (Navitia, API PRIM, horaires théoriques),
dont des trajets « gagnés » grâce à ces courses (absents ou beaucoup plus longs dans le calcul d'origine).

Logique pure (sans réseau), testée dans tests/test_night_check.py ; la partie qui interroge PRIM est le script 07q.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class NightTrip:
    """Un trajet du 6h-14h : commune d'origine vers un astre, avec les deux durées STARWAY (origine, recalcul de nuit)."""

    insee: str
    pole_id: str
    kind: str  # "gained" (grâce aux courses de nuit) ou "kept" (déjà là)
    old_out: int | None
    new_out: int | None
    old_ret: int | None
    new_ret: int | None
    new_dep: str | None  # départ de l'aller du recalcul ("HH:MM"), pour dire s'il part avant 7h


def _minutes(v) -> int | None:
    return None if v is None or pd.isna(v) else int(v)


def join_matrices(old: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame:
    """Une ligne par (origine, astre) avec les durées aller (out) et retour (ret) des deux calculs."""
    cols = ["from_id", "to_id", "out", "ret", "dep"]
    a = old[cols].rename(columns={"out": "old_out", "ret": "old_ret", "dep": "old_dep"})
    b = new[cols].rename(columns={"out": "new_out", "ret": "new_ret", "dep": "new_dep"})
    return a.merge(b, on=["from_id", "to_id"], how="inner")


def gained(df: pd.DataFrame, budget: int | None = None) -> pd.DataFrame:
    """Trajets possibles (aller ET retour) dans le recalcul de nuit et absents du calcul d'origine (aller ou retour
    manquant). `budget` : garder ceux dont les deux durées sont dans ce budget."""
    new_ok = df["new_out"].notna() & df["new_ret"].notna()
    old_missing = df["old_out"].isna() | df["old_ret"].isna()
    m = new_ok & old_missing
    if budget is not None:
        m &= (df["new_out"] <= budget) & (df["new_ret"] <= budget)
    return df[m]


def kept(df: pd.DataFrame, budget: int | None = None) -> pd.DataFrame:
    """Trajets possibles dans les deux calculs, avec la même durée aller et retour (le recalcul n'y change rien)."""
    ok = df[["old_out", "old_ret", "new_out", "new_ret"]].notna().all(axis=1)
    same = (df["old_out"] == df["new_out"]) & (df["old_ret"] == df["new_ret"])
    m = ok & same
    if budget is not None:
        m &= (df["new_out"] <= budget) & (df["new_ret"] <= budget)
    return df[m]


def pick_trips(df: pd.DataFrame, n_gained: int = 5, n_kept: int = 5, seed: int = 1105, budget: int = 60,
               sorted_by: Sequence[str] = ("from_id", "to_id")) -> list[NightTrip]:
    """Tirage déterministe (graine fixée) de `n_gained` trajets gagnés et `n_kept` trajets inchangés, au plus un par commune
    d'origine et par astre pour étaler l'échantillon. Erreur si le recalcul ne donne pas assez de trajets gagnés (le dire
    plutôt que de compléter avec autre chose)."""
    rng = np.random.default_rng(seed)
    out: list[NightTrip] = []
    for kind, pool, n in (("gained", gained(df, budget), n_gained), ("kept", kept(df, budget), n_kept)):
        pool = pool.sort_values(list(sorted_by)).reset_index(drop=True)
        if len(pool) < n:
            raise ValueError(f"{len(pool)} trajets « {kind} » seulement (budget {budget} min), {n} demandés")
        order = rng.permutation(len(pool))
        seen_from: set[str] = set()
        seen_to: set[str] = set()
        chosen = []
        for i in order:
            r = pool.iloc[int(i)]
            if r["from_id"] in seen_from or r["to_id"] in seen_to:
                continue
            seen_from.add(r["from_id"])
            seen_to.add(r["to_id"])
            chosen.append(r)
            if len(chosen) == n:
                break
        if len(chosen) < n:  # pas assez de communes ou d'astres distincts : on relâche l'unicité, jamais le nombre
            for i in order:
                r = pool.iloc[int(i)]
                if not any(r["from_id"] == c["from_id"] and r["to_id"] == c["to_id"] for c in chosen):
                    chosen.append(r)
                if len(chosen) == n:
                    break
        for r in chosen:
            out.append(NightTrip(str(r["from_id"]), str(r["to_id"]), kind, _minutes(r["old_out"]), _minutes(r["new_out"]),
                                 _minutes(r["old_ret"]), _minutes(r["new_ret"]),
                                 None if pd.isna(r["new_dep"]) else str(r["new_dep"])))
    return out


def summarize(rows: pd.DataFrame) -> dict:
    """Résumé d'un recoupement : par sorte de trajet, nombre de trajets, trajets trouvés par Navitia, écarts (STARWAY moins
    Navitia, en minutes) à l'aller et au retour. `rows` : colonnes kind, leg ('out'/'ret'), starway_min, navitia_min."""
    res: dict = {}
    for kind, sub in rows.groupby("kind"):
        legs = {}
        for leg, s in sub.groupby("leg"):
            both = s[s["starway_min"].notna() & s["navitia_min"].notna()]
            d = (both["starway_min"] - both["navitia_min"]).astype(float)
            legs[str(leg)] = {
                "n": len(s), "navitia_found": int(s["navitia_min"].notna().sum()),
                "starway_found": int(s["starway_min"].notna().sum()),
                "median_diff_min": None if d.empty else float(d.median()),
                "max_abs_diff_min": None if d.empty else float(d.abs().max()),
                "within_5_min": int((d.abs() <= 5).sum()),
            }
        res[str(kind)] = legs
    return res
