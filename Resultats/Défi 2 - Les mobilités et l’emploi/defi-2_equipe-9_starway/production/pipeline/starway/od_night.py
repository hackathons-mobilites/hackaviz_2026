"""D-040 : table commune x commune assemblée de TROIS tables de départs, sans doublon.

  matin  (réseau de nuit, TRA01B) : départs de 00:00 à 06:55 ;
  jour   (GTFS d'origine, TRA01)  : départs de 07:00 à 22:00 (la table D-031 déjà publiée, 03:00 à 22:00, dont on ne garde
                                    que la partie qui n'est ni dans le matin ni dans le soir) ;
  soir   (réseau du soir, TRA01C) : départs de 22:05 à 23:55 (tables `_nuit_soir_v2`).

Pourquoi trois tables. R5 ne voit pas les courses de la veille codées 24:00 et plus (starway/night_gtfs.py) : avant 7h,
la table d'origine manque des derniers métros et des premiers bus ; après 22h, elle ne va pas plus loin que 22:00. Le matin
est calculé sur le réseau de nuit (TRA01B : TRA01 + les courses du lundi codées 24:00 et plus). Le soir est calculé sur le
réseau du soir (TRA01C, starway/evening_gtfs.py : TRA01B + les courses du MERCREDI 18/11 parties avant 3h, copiées au mardi
avec 24 h de plus) : sans elles, un départ de 23h le mardi ne voyait pas les courses du mercredi codées 00:xx à 02:xx. De 7h à
22h le réseau de nuit ne change presque rien (mesure de la VM du 05/11 : à 9h, 1 trajet sur 24 896 change d'1 min ; à 22h, 7
sur 13 781 changent de 2 à 10 min), les tables actuelles restent valables et ne sont pas recalculées.

Règles : chaque départ vient d'UNE seule table (jamais deux valeurs pour le même départ) ; la grille assemblée est contiguë
au pas de 5 min ; le réseau, les règles de correspondance, le jar R5, les points et le réglage de marche sont les mêmes
dans les trois tables : seuls le GTFS (TRA01 pour le jour, TRA01B pour le matin, TRA01C pour le soir) et la plage des départs
diffèrent. Le matin et le soir viennent du MÊME mardi type (17/11/2026) : le matin est celui de ce mardi, pas celui du
lendemain, et le soir porte les courses du mercredi après minuit ; un poste de nuit (22h-6h) lit son aller le soir de ce mardi
et son retour le matin de ce même mardi (docs/limites.md).

Logique pure (sans r5py ni Java), testée dans tests/test_od_night.py ; utilisée par 06d (`--night-morning-dir`,
`--night-evening-dir`) et par le contrôle 07.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from starway import od_table as od
from starway.config import OUTBOUND_STEP_MIN

MORNING, DAY, EVENING = "matin", "jour", "soir"
SEGMENTS = (MORNING, DAY, EVENING)  # ordre chronologique
# Source (manifeste) du GTFS attendu pour chaque table : TROIS empreintes, chacune seulement là où elle est utilisée.
NETWORKS = {DAY: "TRA01", MORNING: "TRA01B", EVENING: "TRA01C"}
NETWORK_SOURCES = tuple(NETWORKS.values())
# Clés de run_params qui DIFFÈRENT légitimement entre une table de jour et une table de nuit : le GTFS (réseau) et la
# plage des départs. Toutes les autres clés (jar, règles de correspondance, points, réglage de marche, OSM...) doivent
# être égales : sans quoi les trois tables ne décriraient pas le même calcul.
FREE_KEYS = ("gtfs_sha256", "departures")
SHARED_FROM_DAY_ONLY = ("direct_reference_departure",)  # sans objet pour le TC seul, jamais comparée


@dataclass(frozen=True)
class SegmentPlan:
    """Départs gardés d'une table source dans la grille assemblée."""

    name: str
    first: int  # premier départ gardé (minutes depuis minuit)
    last: int  # dernier départ gardé

    @property
    def n_slots(self) -> int:
        return (self.last - self.first) // OUTBOUND_STEP_MIN + 1


def _check_grid(name: str, grid: Sequence[int], step: int) -> None:
    g = np.asarray(grid, dtype=np.int64)
    if len(g) == 0 or (len(g) > 1 and not np.all(np.diff(g) == step)):
        raise ValueError(f"grille {name} vide ou non contiguë au pas de {step} min")


def plan_segments(morning: Sequence[int], day: Sequence[int], evening: Sequence[int],
                  step: int = OUTBOUND_STEP_MIN) -> list[SegmentPlan]:
    """Départs gardés de chaque table : le matin et le soir en entier, le jour seulement entre eux. Erreur si la grille
    assemblée aurait un trou ou un doublon (matin et soir pas contigus au jour, matin après le soir...)."""
    for name, g in ((MORNING, morning), (DAY, day), (EVENING, evening)):
        _check_grid(name, g, step)
    m_last, e_first = int(morning[-1]), int(evening[0])
    d_first, d_last = m_last + step, e_first - step
    if d_first > d_last:
        raise ValueError(f"le matin finit à {od.format_hhmm(m_last)} et le soir commence à {od.format_hhmm(e_first)} : "
                         "aucun départ du jour entre les deux")
    if not (int(day[0]) <= d_first and d_last <= int(day[-1])):
        raise ValueError(f"la table du jour ({od.format_hhmm(int(day[0]))} à {od.format_hhmm(int(day[-1]))}) ne couvre pas "
                         f"{od.format_hhmm(d_first)} à {od.format_hhmm(d_last)} : trou dans la grille assemblée")
    return [SegmentPlan(MORNING, int(morning[0]), m_last), SegmentPlan(DAY, d_first, d_last),
            SegmentPlan(EVENING, e_first, int(evening[-1]))]


def assembled_grid(plans: Sequence[SegmentPlan], step: int = OUTBOUND_STEP_MIN) -> np.ndarray:
    """Grille des départs assemblée (contiguë, sans doublon)."""
    grid = np.concatenate([np.arange(p.first, p.last + step, step, dtype=np.int32) for p in plans])
    _check_grid("assemblée", grid, step)
    return grid


def assemble_series(parts: Mapping[str, tuple[np.ndarray, np.ndarray]], plans: Sequence[SegmentPlan]) -> np.ndarray:
    """Tables (origines, destinations, départs) de chaque segment -> table assemblée. `parts[nom] = (départs, table)` ;
    seuls les départs gardés (`plans`) sont pris, chacun dans UNE seule table. Erreur si un départ gardé manque."""
    cols = []
    for p in plans:
        deps, tt = parts[p.name]
        deps = np.asarray(deps)
        want = np.arange(p.first, p.last + OUTBOUND_STEP_MIN, OUTBOUND_STEP_MIN)
        pos = np.searchsorted(deps, want)
        if (pos >= len(deps)).any() or not np.array_equal(deps[pos], want):
            raise ValueError(f"table {p.name} : départs {od.format_hhmm(p.first)} à {od.format_hhmm(p.last)} absents")
        cols.append(tt[..., pos])
    return np.concatenate(cols, axis=-1)


def check_segments_params(rp: Mapping[str, Mapping[str, Any]], day_gtfs_sha: str | None,
                          night_gtfs_sha: str | None, evening_gtfs_sha: str | None) -> list[str]:
    """Écarts (liste vide = cohérent) entre les run_params des trois tables :
      - jour : GTFS = TRA01 du manifeste ; matin : GTFS = TRA01B (réseau de nuit) ; soir : GTFS = TRA01C (réseau du soir) ;
        chaque empreinte n'est acceptée QUE pour sa table, et les trois sont distinctes ;
      - toutes les autres clés égales à celles du jour, hors plage des départs."""
    errs: list[str] = []
    for name in SEGMENTS:
        if name not in rp:
            errs.append(f"run_params de la table {name} absents")
    if errs:
        return errs
    if day_gtfs_sha is None or night_gtfs_sha is None or evening_gtfs_sha is None:
        return ["empreinte TRA01, TRA01B ou TRA01C absente du manifeste"]
    if len({day_gtfs_sha, night_gtfs_sha, evening_gtfs_sha}) < 3:
        errs.append("TRA01, TRA01B et TRA01C n'ont pas trois empreintes distinctes : un réseau n'est pas distinct d'un autre")
    for name, want in ((DAY, day_gtfs_sha), (MORNING, night_gtfs_sha), (EVENING, evening_gtfs_sha)):
        if rp[name].get("gtfs_sha256") != want:
            errs.append(f"table {name} : gtfs_sha256 {rp[name].get('gtfs_sha256')!r} != {NETWORKS[name]} du manifeste")
    day = rp[DAY]
    for name in (MORNING, EVENING):
        keys = (set(day) | set(rp[name])) - set(FREE_KEYS) - set(SHARED_FROM_DAY_ONLY)
        errs += [f"table {name} : {k} {rp[name].get(k)!r} != jour {day.get(k)!r}" for k in sorted(keys)
                 if rp[name].get(k) != day.get(k)]
    return errs


def segments_block(plans: Sequence[SegmentPlan], dirs: Mapping[str, str], rp: Mapping[str, Mapping[str, Any]],
                   service_date: str) -> dict[str, Any]:
    """Bloc `time_segments` de od*/index.json : d'où vient chaque plage de départs, et sur quel réseau."""
    nets = NETWORKS
    return {
        "decision": "D-040",
        "rule": ("chaque départ de la grille vient d'une seule table ; le matin est calculé sur le GTFS IDFM complété des "
                 "courses de la veille codées 24:00 et plus (source TRA01B, starway/night_gtfs.py), le soir sur ce réseau "
                 "complété des courses du mercredi parties avant 3h (source TRA01C, starway/evening_gtfs.py), le jour sur "
                 "le GTFS d'origine (TRA01) ; règles de correspondance, jar R5, points et réglage de marche sont "
                 "ceux des trois tables"),
        "same_typical_day": (f"le matin et le soir viennent du même mardi type ({service_date}), le soir avec les courses du "
                             "mercredi après minuit : un poste de nuit lit son aller le soir de ce mardi et son retour le "
                             "matin de ce même mardi, pas celui du lendemain"),
        "segments": [{"name": p.name, "from": od.format_hhmm(p.first), "to": od.format_hhmm(p.last),
                      "n_slots": p.n_slots, "source_dir": dirs[p.name], "gtfs_source": nets[p.name],
                      "gtfs_sha256": rp[p.name].get("gtfs_sha256")} for p in plans],
    }


def segment_dirs(day_dir: Path, morning_dir: Path, evening_dir: Path) -> dict[str, Path]:
    return {MORNING: morning_dir, DAY: day_dir, EVENING: evening_dir}


def default_night_dirs(day_dir: Path) -> tuple[Path, Path]:
    """Dossiers du matin et du soir qui vont avec un dossier de jour : `od_walk3000_d031` -> (`..._d031_nuit_matin`,
    `..._d031_nuit_soir_v2`). Le soir est la VERSION 2 (réseau du soir TRA01C) ; les anciens `..._nuit_soir` ne sont plus lus."""
    return (day_dir.with_name(day_dir.name + "_nuit_matin"), day_dir.with_name(day_dir.name + "_nuit_soir_v2"))


def load_assembled_lot(dirs: Mapping[str, Path], k: int, plans: Sequence[SegmentPlan], from_ids: list[str],
                       to_ids: list[str], mode: str = "transit") -> np.ndarray | None:
    """Lot `k` assemblé (None si l'un des trois lots est absent : l'origine n'est alors pas « calculée »). Erreur si un lot
    présent ne correspond pas au découpage ou aux destinations."""
    parts: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for name, d in dirs.items():
        p = od.lot_path(d, mode, k)
        if not p.exists():
            return None
        lot = od.read_lot(p)
        if lot.from_ids != from_ids or lot.to_ids != to_ids:
            raise ValueError(f"{p} : identifiants différents du découpage de 04c")
        parts[name] = (lot.departures, lot.tt)
    return assemble_series(parts, plans)
