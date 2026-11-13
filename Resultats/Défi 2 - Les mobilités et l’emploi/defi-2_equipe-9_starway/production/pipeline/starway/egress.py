"""Analyse de la limite de marche finale de R5 (lecture seule : aucun calcul r5py, aucune donnée publiée modifiée).

Mécanisme (R5 v7.5.1-r5py, lu dans le code source et dans le jar, voir docs/analyse-limite-marche-r5.md) : en
transport en commun, la marche entre le dernier arrêt et le point d'arrivée vient d'une table de distances
construite depuis chaque arrêt avec une limite de `TransitLayer.WALK_DISTANCE_LIMIT_METERS` = 2 000 m (distance
sur le réseau piéton). La marche d'accès depuis le point de départ n'est limitée qu'en temps (`max_time_walking`,
égal à `max_time` = 120 min par défaut dans r5py).

Ce module ne contient que la logique pure (testée sans Java) :
- `gtfs_seconds` : heure GTFS (« 25:10:00 » possible) en secondes depuis minuit du jour de service ;
- `alighting_allowed` : descente possible selon la règle de R5 (`drop_off_type` différent de 1) ;
- `walk_reach_m` : distance qu'on parcourt à pied pendant une durée, à la vitesse du calcul ;
- `classify` : catégorie d'un verdict « aucun retour » selon la distance au plus proche arrêt desservi ;
- `walk_limit_basis`, `walk_limit_marks`, `mark_reason`, `check_marks_fresh` : marquage des retours nuls dus à la
  limite (raison `no_stop_within_walk_limit`, appliquée par 06 à l'export, décision de Nicolas du 03/11).
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

# Constante de R5 v7.5.1 (TransitLayer.WALK_DISTANCE_LIMIT_METERS), lue dans le jar de r5py : pas un choix STARWAY.
R5_WALK_EGRESS_LIMIT_M = 2000

CAT_NEAR = "served_stop_lt_2km"  # un arrêt desservi à moins de 2 km : la limite n'explique pas tout
CAT_SUSPECT = "served_stop_2km_to_walk_reach"  # plus proche arrêt desservi entre 2 km et la portée à pied : suspect
CAT_FAR = "no_served_stop_within_walk_reach"  # aucun arrêt desservi à portée de marche dans le temps maximal
CATEGORIES = (CAT_NEAR, CAT_SUSPECT, CAT_FAR)

# Marquage à l'export (06) : raison publiée à la place de `no_trip_within_120` quand le retour nul n'est pas mesuré.
REASON_WALK_LIMIT = "no_stop_within_walk_limit"
REASON_NO_TRIP = "no_trip_within_120"
BASIS_CROW = "crow"  # plus proche quai desservi à 2 000 m ou plus à vol d'oiseau (donc aussi par le réseau)
BASIS_NETWORK = "network"  # quai à moins de 2 000 m à vol d'oiseau, mais à 2 000 m ou plus sur le réseau approché
MARKED_MODE = "transit"  # seul mode analysé par 07b (vélo + TC : sortie à vélo, autre limite de R5, non analysée)


def gtfs_seconds(hms: pd.Series) -> pd.Series:
    """« HH:MM:SS » (HH peut dépasser 23) -> secondes depuis minuit du jour de service. Vide -> NaN."""
    parts = hms.fillna("").str.split(":", expand=True)
    if parts.shape[1] < 3:
        return pd.Series(np.nan, index=hms.index)
    h = pd.to_numeric(parts[0], errors="coerce")
    m = pd.to_numeric(parts[1], errors="coerce")
    s = pd.to_numeric(parts[2], errors="coerce")
    return h * 3600 + m * 60 + s


def alighting_allowed(drop_off_type: pd.Series) -> pd.Series:
    """Règle de R5 (TripPattern, PickDropType) : seule la valeur 1 (« pas de descente ») interdit de descendre.
    Vide = 0 (descente régulière) ; 2 et 3 (sur réservation) sont acceptés par R5."""
    return drop_off_type.fillna("0").str.strip().replace("", "0") != "1"


def walk_reach_m(minutes: int, speed_kmh: float) -> float:
    """Distance parcourue à pied en `minutes` à `speed_kmh` (120 min à 3,6 km/h = 7 200 m)."""
    return minutes / 60 * speed_kmh * 1000


def relay_returns(ret_min: np.ndarray, dist_m: np.ndarray, speed_kmh: float) -> tuple[np.ndarray, np.ndarray]:
    """Indice « retour par une commune relais » (aucun nouveau calcul de trajet).

    ret_min[p, c] : retour TC publié du pôle p vers le point de la commune c (minutes, NaN = aucun) ;
    dist_m[c', c] : distance à vol d'oiseau entre les points des communes c' et c (mètres).
    relay[p, c] = min sur c' différent de c de ret_min[p, c'] + dist_m[c', c] / vitesse de marche.
    Renvoie (relay, indice de la commune relais) ; NaN / -1 si aucune commune relais n'a de retour.

    Ce n'est ni un minorant ni un majorant du vrai temps : la marche à vol d'oiseau est optimiste, le détour par
    le point de c' est pessimiste. Si relay est fini alors que R5 n'a rien trouvé pour c, le trajet relais finit
    forcément par une marche de plus de 2 000 m (réseau) depuis son dernier arrêt, sinon R5 l'aurait trouvé."""
    walk = np.array(dist_m, dtype=float) / (speed_kmh * 1000 / 60)
    np.fill_diagonal(walk, np.inf)
    p, c = ret_min.shape
    relay = np.full((p, c), np.nan)
    via = np.full((p, c), -1, dtype=int)
    for i in range(p):
        tot = ret_min[i][:, None] + walk  # [c', c]
        tot = np.where(np.isnan(tot), np.inf, tot)
        k = np.argmin(tot, axis=0)
        best = tot[k, np.arange(c)]
        ok = np.isfinite(best)
        relay[i, ok] = best[ok]
        via[i, ok] = k[ok]
    return relay, via


def classify(distance_m: float | None, walk_reach: float, limit_m: int = R5_WALK_EGRESS_LIMIT_M) -> str:
    """Catégorie d'un verdict « aucun retour » selon la distance (m) au plus proche arrêt desservi.
    `None` ou NaN = aucun arrêt desservi du tout dans la fenêtre."""
    if distance_m is None or (isinstance(distance_m, float) and math.isnan(distance_m)):
        return CAT_FAR
    if distance_m < limit_m:
        return CAT_NEAR
    if distance_m <= walk_reach:
        return CAT_SUSPECT
    return CAT_FAR


def walk_limit_basis(category: str, network_lt_2km: bool | None, ret_found: int, ret_found_equal_walk: int
                     ) -> str | None:
    """Base sur laquelle on peut AFFIRMER qu'aucun quai desservi pendant la fenêtre de retour n'est à moins de
    2 000 m de marche du point de la commune (une commune, une fin de poste). None = on ne peut pas l'affirmer.

    Règle (docs/methodologie.md § 5 sexies) :
    1. si R5 a trouvé au moins un retour TC qui n'est pas le trajet tout à pied, un quai desservi est à moins de
       2 000 m sur le réseau de R5 : jamais de marquage (contradiction avec toute mesure approchée) ;
    2. catégorie « entre 2 km et la portée à pied » (vol d'oiseau) : marquage sûr, la marche sur le réseau est au
       moins égale à la distance à vol d'oiseau -> `crow` ;
    3. catégorie « aucun quai à portée de marche en 120 min » : PAS de marquage, le verdict « aucun trajet en
       120 min » tient avec ou sans la limite (marcher jusqu'au quai prend déjà 120 min ou plus) ;
    4. catégorie « quai à moins de 2 km » à vol d'oiseau : marquage seulement si la distance mesurée sur le réseau
       piéton approché (07b --network) est de 2 000 m ou plus -> `network` ; sans mesure, pas de marquage."""
    if ret_found != ret_found_equal_walk:
        return None
    if category == CAT_SUSPECT:
        return BASIS_CROW
    if category == CAT_NEAR and network_lt_2km is False:
        return BASIS_NETWORK
    return None


def walk_limit_marks(egress: pd.DataFrame, network: pd.DataFrame | None) -> dict[tuple[str, str], str]:
    """{(insee, journée): base} pour les couples marqués. `egress` = data/processed/egress_limit_2026.csv,
    `network` = data/processed/egress_limit_network_sample.csv (facultatif)."""
    net: dict[tuple[str, str], bool] = {}
    if network is not None:
        for r in network.itertuples():
            net[(str(r.insee), str(r.day))] = bool(r.network_lt_2km)
    marks: dict[tuple[str, str], str] = {}
    for r in egress.itertuples():
        key = (str(r.insee), str(r.day))
        basis = walk_limit_basis(str(r.category), net.get(key), int(r.ret_found), int(r.ret_found_equal_walk))
        if basis is not None:
            marks[key] = basis
    return marks


def mark_reason(out: int | None, ret: int | None, reason: str | None, marked: bool) -> str | None:
    """Raison publiée pour un pôle. Le contrat n'a qu'une raison par pôle, et elle décrit le PREMIER sens nul
    (l'aller s'il est nul : convention du front, `reasonLeg`). On ne remplace donc `no_trip_within_120` que si
    l'aller est trouvé et le retour nul ; si l'aller est nul aussi, le verdict « aucun trajet » de l'aller est
    mesuré (la limite ne joue pas à l'aller, l'arrêt d'arrivée est l'ancrage du pôle) et la raison reste ; le
    retour non mesuré est alors signalé par la clé `walk_limit` de la série (voir le contrat)."""
    if marked and out is not None and ret is None and reason == REASON_NO_TRIP:
        return REASON_WALK_LIMIT
    return reason


def relay_suspects(pairs: pd.DataFrame, pole_ids: list[str], max_trip_min: int) -> dict[tuple[str, str], set[int]]:
    """{(insee, journée): indices des pôles} dont le retour TC publié est nul alors que l'indice relais de 07b est fini
    et <= `max_trip_min` (data/interim/egress_limit_pairs.csv). Sert seulement à écarter des découvertes : aucun
    verdict publié n'est changé (la cause n'est pas établie, docs/analyse-limite-marche-r5.md § 2.5)."""
    idx = {p: i for i, p in enumerate(pole_ids)}
    sel = pairs[pairs["ret"].isna() & pairs["relay"].notna() & (pairs["relay"] <= max_trip_min)]
    out: dict[tuple[str, str], set[int]] = {}
    for r in sel.itertuples():
        out.setdefault((str(r.insee), str(r.day)), set()).add(idx[str(r.pole_id)])
    return out


def check_marks_fresh(egress: pd.DataFrame, matrices: dict[tuple[str, str], pd.DataFrame]) -> list[str]:
    """07b a été calculé sur les verdicts publiés à un moment donné. Si la matrice TC a changé depuis, le classement
    ne vaut plus : on compare, pour chaque (commune, journée) de 07b, le nombre de retours nuls et de retours nuls
    avec aller trouvé à la matrice TC lue par 06. Renvoie la liste des écarts (vide = à jour)."""
    errs: list[str] = []
    for day, g in egress.groupby("day"):
        m = matrices.get((MARKED_MODE, str(day)))
        if m is None:
            continue
        rn = m["ret"].isna()
        cur = pd.DataFrame({"insee": m["from_id"].astype(str), "ret_null": rn,
                            "ret_null_out_found": rn & m["out"].notna()}).groupby("insee").sum()
        e = g.assign(insee=g["insee"].astype(str)).set_index("insee")
        common = e.index.intersection(cur.index)
        bad = common[(e.loc[common, "ret_null"].astype(int) != cur.loc[common, "ret_null"].astype(int))
                     | (e.loc[common, "ret_null_out_found"].astype(int)
                        != cur.loc[common, "ret_null_out_found"].astype(int))]
        errs += [f"{i}/{day}" for i in bad]
    return errs
