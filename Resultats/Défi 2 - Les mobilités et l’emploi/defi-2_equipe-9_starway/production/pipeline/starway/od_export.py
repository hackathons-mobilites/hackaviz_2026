"""Export front de la table origine-destination D-019 (proposée) : format binaire SWOD (v2 ; v1 encore lu), un fichier
par commune.

Contrat : `docs/contrats-donnees.md`, section « D-019 ».

Principe : on publie les durées MESURÉES par 04c (aucune durée dérivée), compressées sans perte, et le front applique
les deux règles de toujours :
- aller pour un début de poste S : départ le plus tardif t de [S - 120, S - 5] (grille de 5 min) tel que
  t + TT(x vers y, t) <= S (`od_table.outbound_at`, `routing.latest_feasible`) ;
- retour pour une fin de poste E : TT(y vers x, E) (`od_table.inbound_at`).
Le fichier de la commune x contient donc, pour chaque destination y atteignable, la série TT(x vers y, t) et la série
TT(y vers x, t) sur toute la grille des départs (depuis D-040 : 288 départs de 00:00 à 23:55, assemblés par `od_night` ;
avant : 229 départs de 03:00 à 22:00) : le front calcule l'aller et le retour pour n'importe quel S et E de la grille,
sans pas de publication à fixer.

Compression sans perte d'une série : suite de « plages » (longueur L, valeur v).
- v <= max_trip_min : L départs consécutifs dont l'ARRIVÉE est identique (même trajet, on part plus tard et on attend
  moins) : durée au départ i de la plage = v - pas x i ;
- v = 253, 254, 255 : L départs portant cette sentinelle (non calculé, point non accroché, aucun trajet en 120 min) ;
  une plage de plus de 255 départs est coupée en plages consécutives de même valeur.
Les durées > max_trip_min (121, 122 rendues par r5py) sont publiées 255 (même règle que `matrix_io.cap_to_max_trip`) :
cela ne change aucun aller ni retour, puisque `outbound_at` et `inbound_at` les traitent déjà comme « pas de trajet ».

Version 2 (D-040) : seul le nombre de plages d'une série passe de 1 à 2 octets (uint16) ; à 229 départs, une série pouvait
avoir 229 plages, à 288 départs elle peut en avoir plus de 255. Tout le reste est identique à la version 1, que les
lecteurs lisent toujours.

Tout ce module est sans r5py ni Java (tests : tests/test_od_export.py).
"""

from __future__ import annotations

import struct
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from starway.config import MAX_TRIP_MIN, OUTBOUND_LOOKBACK_MIN, OUTBOUND_STEP_MIN
from starway.od_table import SENTINEL_NO_TRIP, SENTINEL_NOT_SNAPPED

MAGIC = b"SWOD"
FORMAT_VERSION = 2  # D-040 : nombre de plages d'une série sur 2 octets (la version 1, 1 octet, reste lue)
LEGACY_VERSION = 1
SUPPORTED_VERSIONS = (LEGACY_VERSION, FORMAT_VERSION)
MAX_RUN = 255  # longueur d'une plage : 1 octet
SENTINEL_NOT_COMPUTED = 253  # série retour d'une destination dont le lot n'est pas encore calculé (export partiel)
SENTINELS = {SENTINEL_NO_TRIP: "no_trip_within_120", SENTINEL_NOT_SNAPPED: "origin_not_snapped",
             SENTINEL_NOT_COMPUTED: "not_computed"}
KIND_SCALAR, KIND_SERIES = 0, 1
HEADER = struct.Struct("<4sBBHHHBBH")  # magic, version, pas, 1er départ, n départs, origine, n sections, max, réservé
SECTION = struct.Struct("<BBHI")  # code du mode, nature, n enregistrements, octets de la charge utile

# Règle des trajets d'une commune vers elle-même (signalée dans le contrat et la méthodologie)
SELF_PAIR_RULE = {
    "status": "not_measured",
    "reason": "same_point",
    "rule": ("le couple x vers x n'est jamais publié : 04c route du point D-017 de la commune vers ce même point, et "
             "r5py rend 0 min (mesuré : 0 pour les 600 couples x vers x des lots 0 à 5, à tous les départs). Ce 0 "
             "n'est pas un temps de trajet, c'est l'absence de déplacement entre deux points identiques ; un seul "
             "point par commune ne permet pas de mesurer un trajet interne à la commune. Les postes de la commune "
             "de résidence ne sont donc comptés ni comme atteints ni comme non atteints : le front les affiche à "
             "part (« postes de votre commune : N, trajet non mesuré »)."),
}


# --------------------------------------------------------------------------- séries : plages sans perte
def cap_series(tt: np.ndarray, max_trip: int = MAX_TRIP_MIN) -> np.ndarray:
    """Durées > max_trip (hors sentinelles 253 à 255) -> 255, copie uint8."""
    a = np.asarray(tt, dtype=np.uint8)
    return np.where((a > max_trip) & (a < SENTINEL_NOT_COMPUTED), SENTINEL_NO_TRIP, a).astype(np.uint8)


def run_starts(series: np.ndarray, step: int = OUTBOUND_STEP_MIN, max_trip: int = MAX_TRIP_MIN) -> np.ndarray:
    """Masque des débuts de plage, même forme que `series` (dernier axe = départs). Série déjà plafonnée.

    Le départ k prolonge la plage du départ k-1 si (k-1 est une durée et TT[k] = TT[k-1] - pas : même arrivée) ou
    (k-1 est une sentinelle et TT[k] = TT[k-1]).
    """
    s = np.asarray(series).astype(np.int16)
    prev, cur = s[..., :-1], s[..., 1:]
    cont = np.where(prev <= max_trip, cur == prev - step, cur == prev)
    first = np.ones(s.shape[:-1] + (1,), dtype=bool)
    return np.concatenate([first, ~cont], axis=-1)


def encode_runs(series: np.ndarray, step: int = OUTBOUND_STEP_MIN,
                max_trip: int = MAX_TRIP_MIN) -> tuple[np.ndarray, np.ndarray]:
    """Série 1D plafonnée -> (longueurs uint8, valeurs uint8 au premier départ de chaque plage).

    Une plage de sentinelle de plus de `MAX_RUN` départs est coupée en plages consécutives de même valeur (le décodage
    `decode_runs` les remet bout à bout). Une plage de durées ne dépasse jamais 25 départs (120 min / 5 min + 1)."""
    s = np.asarray(series, dtype=np.uint8)
    if s.ndim != 1 or len(s) == 0 or len(s) > 0xFFFF:
        raise ValueError("série 1D de 1 à 65 535 départs attendue")
    if ((s > max_trip) & (s < SENTINEL_NOT_COMPUTED)).any():
        raise ValueError("série non plafonnée : appeler cap_series d'abord")
    pos = np.flatnonzero(run_starts(s, step, max_trip))
    lengths = np.diff(np.append(pos, len(s)))
    vals = s[pos]
    if (lengths > MAX_RUN).any():
        L2: list[int] = []
        V2: list[int] = []
        for ln, v in zip(lengths.tolist(), vals.tolist(), strict=True):
            if ln > MAX_RUN and v <= max_trip:  # pragma: no cover - impossible : une plage de durées est courte
                raise ValueError("plage de durées de plus de 255 départs")
            while ln > MAX_RUN:
                L2.append(MAX_RUN)
                V2.append(v)
                ln -= MAX_RUN
            L2.append(ln)
            V2.append(v)
        return np.array(L2, dtype=np.uint8), np.array(V2, dtype=np.uint8)
    return lengths.astype(np.uint8), vals.astype(np.uint8)


def decode_runs(lengths: np.ndarray, values: np.ndarray, step: int = OUTBOUND_STEP_MIN,
                max_trip: int = MAX_TRIP_MIN) -> np.ndarray:
    """Inverse exact de `encode_runs`."""
    L = np.asarray(lengths, dtype=np.int64)
    v = np.asarray(values, dtype=np.int64)
    vals = np.repeat(v, L)
    offs = np.arange(int(L.sum())) - np.repeat(np.cumsum(L) - L, L)
    return np.where(vals <= max_trip, vals - step * offs, vals).astype(np.uint8)


# --------------------------------------------------------------------------- règles (miroir de ce que fait le front)
@dataclass(frozen=True)
class Leg:
    minutes: int | None
    reason: str | None
    departure: int | None = None  # minutes depuis minuit (aller seulement)


def outbound(series: np.ndarray, first: int, start: int, step: int = OUTBOUND_STEP_MIN,
             lookback: int = OUTBOUND_LOOKBACK_MIN, max_trip: int = MAX_TRIP_MIN) -> Leg:
    """Aller pour un début de poste `start` depuis une série TT(t) (départs first, first + step, ...).

    Même règle que `od_table.outbound_at` : départ le plus tardif de [start - lookback, start - step] qui arrive à
    `start` au plus tard. Erreur si la fenêtre n'est pas entièrement dans la série (jamais d'approximation).
    """
    lo, hi = (start - lookback - first) / step, (start - step - first) / step
    if lo != int(lo) or lo < 0 or hi >= len(series):
        raise ValueError(f"début de poste {start} hors de la plage calculable")
    window = np.asarray(series[int(lo):int(hi) + 1], dtype=np.int64)
    for k in range(len(window) - 1, -1, -1):
        v = int(window[k])
        dep = first + (int(lo) + k) * step
        if v <= max_trip and dep + v <= start:
            return Leg(v, None, dep)
    for sentinel in (SENTINEL_NOT_COMPUTED, SENTINEL_NOT_SNAPPED):
        if (window == sentinel).all():
            return Leg(None, SENTINELS[sentinel])
    return Leg(None, SENTINELS[SENTINEL_NO_TRIP])


def inbound(series: np.ndarray, first: int, end: int, step: int = OUTBOUND_STEP_MIN,
            max_trip: int = MAX_TRIP_MIN) -> Leg:
    """Retour pour une fin de poste `end` : la valeur de la série TT(y vers x, t) au départ t = end."""
    k = (end - first) / step
    if k != int(k) or not 0 <= k < len(series):
        raise ValueError(f"fin de poste {end} absente de la grille")
    v = int(series[int(k)])
    if v <= max_trip:
        return Leg(v, None)
    return Leg(None, SENTINELS.get(v, SENTINELS[SENTINEL_NO_TRIP]))


def scalar_leg(v: int, max_trip: int = MAX_TRIP_MIN) -> Leg:
    v = int(v)
    if v <= max_trip:
        return Leg(v, None)
    return Leg(None, SENTINELS.get(v, SENTINELS[SENTINEL_NO_TRIP]))


# --------------------------------------------------------------------------- écriture d'un fichier par origine
@dataclass
class Section:
    mode_code: int
    kind: int
    dest: list[int] = field(default_factory=list)
    payload: bytearray = field(default_factory=bytearray)


def has_trip(a: np.ndarray, max_trip: int = MAX_TRIP_MIN) -> np.ndarray:
    """Vrai par ligne si au moins une valeur est une durée publiée (<= max_trip)."""
    return (np.asarray(a) <= max_trip).reshape(len(a), -1).any(axis=1)


def series_section(mode_code: int, origin: int, out_tt: np.ndarray, ret_tt: np.ndarray,
                   step: int = OUTBOUND_STEP_MIN, version: int = FORMAT_VERSION) -> Section:
    """Section d'un mode à horaire. out_tt : (destinations, départs) TT(x vers y) ; ret_tt : idem TT(y vers x).

    Enregistrement publié pour toute destination y != x ayant au moins une durée à l'aller OU au retour (format
    creux). Les deux séries sont plafonnées ; une série retour non calculée vaut 253 partout. `version` : largeur du
    nombre de plages (1 octet en version 1, 2 octets en version 2).
    """
    out_c, ret_c = cap_series(out_tt), cap_series(ret_tt)
    keep = has_trip(out_c) | has_trip(ret_c)
    keep[origin] = False  # règle SELF_PAIR_RULE
    sec = Section(mode_code, KIND_SERIES)
    for y in np.flatnonzero(keep):
        sec.dest.append(int(y))
        sec.payload += struct.pack("<H", int(y))
        for s in (out_c[y], ret_c[y]):
            L, v = encode_runs(s, step)
            if version == LEGACY_VERSION:
                if len(L) > 255:
                    raise ValueError("plus de 255 plages dans une série : version 2 du format nécessaire")
                sec.payload.append(len(L))
            elif version == FORMAT_VERSION:
                sec.payload += struct.pack("<H", len(L))
            else:
                raise ValueError(f"version SWOD inconnue : {version}")
            sec.payload += np.column_stack([L, v]).astype(np.uint8).tobytes()
    return sec


def scalar_section(mode_code: int, origin: int, out_tt: np.ndarray, ret_tt: np.ndarray) -> Section:
    """Section d'un mode sans horaire : par destination, (aller, retour) en minutes ou sentinelle."""
    out_c, ret_c = cap_series(np.asarray(out_tt).reshape(-1)), cap_series(np.asarray(ret_tt).reshape(-1))
    keep = has_trip(out_c) | has_trip(ret_c)
    keep[origin] = False
    sec = Section(mode_code, KIND_SCALAR)
    ys = np.flatnonzero(keep)
    sec.dest = [int(y) for y in ys]
    rec = np.zeros(len(ys), dtype=[("d", "<u2"), ("o", "u1"), ("r", "u1")])
    rec["d"], rec["o"], rec["r"] = ys, out_c[ys], ret_c[ys]
    sec.payload += rec.tobytes()
    return sec


def pack_file(origin: int, first: int, n_slots: int, sections: Sequence[Section], step: int = OUTBOUND_STEP_MIN,
              max_trip: int = MAX_TRIP_MIN, version: int = FORMAT_VERSION) -> bytes:
    if version not in SUPPORTED_VERSIONS:
        raise ValueError(f"version SWOD inconnue : {version}")
    if version == LEGACY_VERSION and n_slots > 255:
        raise ValueError("plus de 255 départs : le nombre de plages d'une série ne tient plus sur un octet (version 2)")
    out = bytearray(HEADER.pack(MAGIC, version, step, first, n_slots, origin, len(sections), max_trip, 0))
    for s in sections:
        if len(s.dest) > 0xFFFF:
            raise ValueError("trop d'enregistrements")
        out += SECTION.pack(s.mode_code, s.kind, len(s.dest), len(s.payload)) + s.payload
    return bytes(out)


# --------------------------------------------------------------------------- lecture (référence du lecteur TypeScript)
@dataclass
class ParsedFile:
    origin: int
    step: int
    first: int
    n_slots: int
    max_trip: int
    series: dict[int, dict[int, tuple[np.ndarray, np.ndarray]]]  # mode -> dest -> (TT aller, TT retour)
    scalars: dict[int, dict[int, tuple[int, int]]]  # mode -> dest -> (aller, retour)
    dests: dict[int, list[int]]  # mode -> toutes les destinations publiées (même celles non décodées)


def parse_file(buf: bytes, only: set[int] | None = None) -> ParsedFile:
    """Lit un fichier SWOD non compressé. `only` : ne décode que ces destinations (les autres séries sont sautées,
    les longueurs restent contrôlées)."""
    magic, version, step, first, n_slots, origin, n_sec, max_trip, _ = HEADER.unpack_from(buf, 0)
    if magic != MAGIC or version not in SUPPORTED_VERSIONS:
        raise ValueError(f"fichier SWOD invalide ({magic!r}, version {version})")
    pos = HEADER.size
    series: dict[int, dict[int, tuple[np.ndarray, np.ndarray]]] = {}
    scalars: dict[int, dict[int, tuple[int, int]]] = {}
    dests: dict[int, list[int]] = {}
    for _ in range(n_sec):
        code, kind, n, nbytes = SECTION.unpack_from(buf, pos)
        pos += SECTION.size
        end = pos + nbytes
        if kind == KIND_SCALAR:
            rec = np.frombuffer(buf, dtype=[("d", "<u2"), ("o", "u1"), ("r", "u1")], count=n, offset=pos)
            scalars[code] = {int(d): (int(o), int(r)) for d, o, r in rec}
            dests[code] = [int(d) for d in rec["d"]]
        else:
            recs: dict[int, tuple[np.ndarray, np.ndarray]] = {}
            dests[code] = []
            p = pos
            for _ in range(n):
                (d,) = struct.unpack_from("<H", buf, p)
                dests[code].append(int(d))
                p += 2
                pair = []
                for _leg in range(2):
                    if version == LEGACY_VERSION:
                        nr, p = buf[p], p + 1
                    else:
                        (nr,), p = struct.unpack_from("<H", buf, p), p + 2
                    runs = np.frombuffer(buf, dtype=np.uint8, count=2 * nr, offset=p).reshape(nr, 2)
                    p += 2 * nr
                    if int(runs[:, 0].astype(np.int64).sum()) != n_slots:
                        raise ValueError(f"série de {int(runs[:, 0].sum())} départs au lieu de {n_slots}")
                    if only is None or int(d) in only:
                        pair.append(decode_runs(runs[:, 0], runs[:, 1], step, max_trip))
                if pair:
                    recs[int(d)] = (pair[0], pair[1])
            if p != end:
                raise ValueError("longueur de section incohérente")
            series[code] = recs
        pos = end
    if pos != len(buf):
        raise ValueError("octets en trop en fin de fichier")
    return ParsedFile(origin, step, first, n_slots, max_trip, series, scalars, dests)


# --------------------------------------------------------------------------- postes et pôles (index.json)
def pole_of(codes: Sequence[str], poles: Sequence[Mapping]) -> list[int | None]:
    """Index du pôle (ordre de poles.json) de chaque commune, None hors pôle. Erreur si une commune est dans deux
    pôles ou si un membre de pôle n'est pas une commune de destination."""
    where: dict[str, int] = {}
    for i, p in enumerate(poles):
        for c in p["communes"]:
            if c in where:
                raise ValueError(f"commune {c} dans deux pôles")
            where[c] = i
    missing = sorted(set(where) - set(codes))
    if missing:
        raise ValueError(f"membres de pôles absents des destinations : {missing[:5]}")
    return [where.get(c) for c in codes]


def reached_by_pole(dest_ok: Mapping[int, bool], jobs: Sequence[int], pole_idx: Sequence[int | None],
                    n_poles: int, origin: int) -> dict[str, list[int]]:
    """Agrégation que fera le front (référence testée) : postes atteints, non atteints, non mesurés par pôle.

    dest_ok : destination -> verdict (aller ET retour dans le budget). Une destination absente du dictionnaire est
    non atteinte (aucun trajet), sauf la commune d'origine, non mesurée (SELF_PAIR_RULE).
    """
    reached, unmeasured = [0] * n_poles, [0] * n_poles
    for y, p in enumerate(pole_idx):
        if p is None:
            continue
        if y == origin:
            unmeasured[p] += int(jobs[y])
        elif dest_ok.get(y, False):
            reached[p] += int(jobs[y])
    total = [0] * n_poles
    for y, p in enumerate(pole_idx):
        if p is not None:
            total[p] += int(jobs[y])
    return {"reached": reached, "unmeasured": unmeasured, "total": total}


# --------------------------------------------------------------------------- couverture par mode (index.json)
# Mode absent de l'export (06d --transit-only, ou mode absent des lots) : annoncé, jamais rempli (aucune valeur publiée)
NOT_COMPUTED_COVERAGE: dict[str, Any] = {
    "origins": 0, "complete": False, "computed": [], "status": "not_computed",
    "reason": "mode non encore exporté dans ce dossier (table de base od/ en cours de calcul)"}


def coverage_block(computed: Mapping[str, set[int]], codes: Sequence[str], modes: Sequence[str]) -> dict[str, Any]:
    """index.coverage : pour chaque mode du format, origines calculées (liste `computed` seulement si partiel) ; un
    mode non exporté est annoncé « non calculé » (origins 0, computed [], status not_computed), jamais omis."""
    out: dict[str, Any] = {}
    for m in modes:
        if m not in computed:
            out[m] = dict(NOT_COMPUTED_COVERAGE, computed=[])
            continue
        v = computed[m]
        out[m] = {"origins": len(v), "complete": len(v) == len(codes),
                  **({} if len(v) == len(codes) else {"computed": [codes[i] for i in sorted(v)]})}
    return out


# --------------------------------------------------------------------------- comparaison avec access/ (07)
def anchor_comparison(pf: ParsedFile, access_transit: Mapping[str, Mapping[str, list]],
                      day_types: Sequence[tuple[str, int, int]], anchors: Sequence[int], budgets: Sequence[int],
                      ret_computed: set[int], lookback: int = OUTBOUND_LOOKBACK_MIN) -> dict[str, Any]:
    """Compare, pour une origine, le verdict publié vers chaque pôle (access/, arrêt d'ancrage comme destination) au
    verdict D-019 vers la COMMUNE de cet arrêt (point D-017). Les deux destinations ne sont pas le même point : des
    écarts sont attendus et sont comptés, pas corrigés.

    Renvoie, par budget, les comptes « accessible aux deux », « publié seulement », « D-019 seulement », « aucun »,
    la liste des couples « publié seulement », et `out_gap` : pour chaque pôle (index de `anchors`), les écarts
    aller D-019 moins aller publié (minutes) des couples où les deux allers existent (diagnostic du point d'arrivée). Couples écartés : pôle dont la commune d'ancrage est l'origine
    (SELF_PAIR_RULE) et retour non calculé (export partiel).
    """
    series = pf.series.get(0, {})
    res: dict[str, Any] = {"pairs": 0, "skipped_self": 0, "skipped_not_computed": 0,
                           "by_budget": {b: {"both": 0, "published_only": 0, "od_only": 0, "neither": 0}
                                         for b in budgets}, "published_only": [],
                           "out_gap": {j: [] for j in range(len(anchors))}}
    for day, start, end in day_types:
        a = access_transit[day]
        for j, y in enumerate(anchors):
            if y == pf.origin:
                res["skipped_self"] += 1
                continue
            if y not in ret_computed:
                res["skipped_not_computed"] += 1
                continue
            if y in series:
                o = outbound(series[y][0], pf.first, start, pf.step, lookback, pf.max_trip).minutes
                r = inbound(series[y][1], pf.first, end, pf.step, pf.max_trip).minutes
            else:
                o = r = None
            res["pairs"] += 1
            if o is not None and a["out"][j] is not None:
                res["out_gap"][j].append(o - a["out"][j])
            for b in budgets:
                old = a["out"][j] is not None and a["ret"][j] is not None and a["out"][j] <= b and a["ret"][j] <= b
                new = o is not None and r is not None and o <= b and r <= b
                key = "both" if old and new else "published_only" if old else "od_only" if new else "neither"
                res["by_budget"][b][key] += 1
                if key == "published_only":
                    res["published_only"].append((day, j, b, a["out"][j], a["ret"][j], o, r))
    return res
