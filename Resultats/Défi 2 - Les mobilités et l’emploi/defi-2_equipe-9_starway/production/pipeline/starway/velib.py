"""Mode Vélib' V1 (D-027) : marche jusqu'à une station, vélo jusqu'à une autre station, marche jusqu'à l'arrivée.

Logique pure (numpy / pandas, sans Java), testée dans tests/test_velib.py ; script : scripts/04d_compute_velib.py ;
méthode : docs/proposition-velib.md § 3 (V1) et docs/methodologie.md § 5 nonies.

Combinaison EXACTE (min-plus), sans seuil ni forfait : pour une origine o et une arrivée p,
    t(o, p) = min sur S1 != S2 de marche(o, S1) + vélo(S1, S2) + marche(S2, p).
S1 = S2 est exclu : ce serait un trajet à pied qui passe par une station, pas un trajet en Vélib'.
Aucun temps de prise ou de dépose du vélo n'est ajouté (aucune source ne le donne, D-011) : temps minimal.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

INF = np.inf


def read_stations(path: Path) -> pd.DataFrame:
    """Stations du flux GBFS station_information (VEL01) : id = stationCode (texte), lon, lat, capacity."""
    d = json.loads(path.read_text(encoding="utf-8"))
    st = pd.DataFrame(d["data"]["stations"])
    out = pd.DataFrame({"id": st["stationCode"].astype(str), "name": st["name"], "lon": st["lon"].astype(float),
                        "lat": st["lat"].astype(float), "capacity": st["capacity"]})
    if out["id"].duplicated().any():
        raise ValueError("stationCode en double dans le flux")
    return out.sort_values("id").reset_index(drop=True)


def to_array(series: pd.Series, rows: list[str], cols: list[str]) -> np.ndarray:
    """Série indexée (from_id, to_id) -> matrice float rows x cols, inf si absent ou NaN (pas de trajet)."""
    m = series.astype(float).unstack()
    m = m.reindex(index=rows, columns=cols)
    return m.to_numpy(dtype=float, na_value=INF)


def minplus(left: np.ndarray, right: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """C[i, k] = min sur j de left[i, j] + right[j, k] ; renvoie aussi l'argmin j (-1 si aucun chemin)."""
    s = left[:, :, None] + right[None, :, :]
    arg = s.argmin(axis=1)
    best = np.take_along_axis(s, arg[:, None, :], axis=1)[:, 0, :]
    arg = np.where(np.isfinite(best), arg, -1)
    return best, arg


def velib_times(walk_in: np.ndarray, bike: np.ndarray, walk_out: np.ndarray) -> dict[str, np.ndarray]:
    """walk_in (O x S) : marche origine -> station de prise ; bike (S x S) : vélo station -> station ;
    walk_out (S x P) : marche station de dépose -> arrivée. Renvoie le temps total (O x P) et les stations S1, S2
    (indices, -1 si aucun trajet). La diagonale de `bike` (S1 = S2) est exclue."""
    b = bike.astype(float).copy()
    np.fill_diagonal(b, INF)
    n_o, n_s = walk_in.shape
    n_p = walk_out.shape[1]
    if n_s * n_p <= n_o * n_s:  # même résultat exact, ordre choisi pour la mémoire (S x S x min(O, P))
        via, s2 = minplus(b, walk_out)  # S1 x P : vélo puis marche, meilleure station de dépose S2
        total, s1 = minplus(walk_in, via)  # O x P
        s2_of = np.where(s1 >= 0, np.take_along_axis(s2, np.maximum(s1, 0), axis=0), -1)
        return {"time": total, "s1": s1, "s2": s2_of}
    first, s1 = minplus(walk_in, b)  # O x S2 : marche puis vélo, meilleure station de prise S1
    total, s2 = minplus(first, walk_out)  # O x P
    s1_of = np.where(s2 >= 0, np.take_along_axis(s1, np.maximum(s2, 0), axis=1), -1)
    return {"time": total, "s1": s1_of, "s2": s2}


def cap_minutes(t: np.ndarray, max_min: int) -> np.ndarray:
    """Durées entières (minutes) ; au-delà de max_min ou sans trajet -> NaN (null + no_trip_within_120)."""
    out = np.where(np.isfinite(t) & (t <= max_min), t, np.nan)
    return np.round(out)


# r5py (travel_time_matrix.py, _parse_results) met à 0 le temps de tout couple dont from_id == to_id : des
# stationCode Vélib' (ex. « 92007 ») étant aussi des codes INSEE, les stations sont routées sous un identifiant préfixé.
STATION_PREFIX = "vlb:"


def check_disjoint_ids(*groups: list[str]) -> None:
    """Refuse un identifiant présent dans deux ensembles (origines, stations, pôles) : r5py le mettrait à 0 min."""
    seen: dict[str, int] = {}
    for k, g in enumerate(groups):
        for x in g:
            if x in seen and seen[x] != k:
                raise ValueError(f"identifiant {x!r} commun à deux ensembles de points : r5py le mettrait à 0 min")
            seen[x] = k
