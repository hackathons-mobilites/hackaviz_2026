"""Règle de l'or du vélo + TC (D-056), la même que celle du site (`goldDelta`, `frontend/src/data/gain.ts`).

Un astre est en gain (or) seulement si les trois conditions tiennent :
1. le vélo + TC le rejoint aller et retour dans le budget (`access/`) ;
2. les TC seuls ne le rejoignent pas dans `access/` (même mesure que le vélo + TC) ;
3. sa part TC commune par commune est nulle : aucun poste salarié recensé par l'INSEE atteint, toutes ses communes mesurées
   (table `od_walk{L}/`, le ciel TC que le site affiche).

Un astre « non calculé » d'un côté ou de l'autre n'est ni un gain ni une perte (`computeDelta`). Les pertes restent
l'écart sur `access/` : on ne mesure pas une perte entre deux calculs différents. Si la table commune par commune
n'est pas lisible pour le scénario, il n'y a aucun gain (`no_commune_transit`) : une absence de mesure ne prouve rien.
"""

from __future__ import annotations

import gzip
import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

# (commune, journée-type, budget) -> part TC commune par commune de chaque astre, dans l'ordre de `poles.json`
# (`sky_groups.group_shares`), ou None si la table n'est pas lisible pour ce scénario
CommuneParts = Callable[[str, str, int], Sequence[Mapping[str, Any]] | None]

NO_COMMUNE_TRANSIT = "no_commune_transit"
# Mêmes raisons que `UNKNOWN_REASONS` du front (accessibility.ts) : la mesure manque, ce n'est pas « aucun trajet »
UNKNOWN_REASONS = frozenset({"not_computed", "origin_not_snapped"})


def access_status(out: int | None, ret: int | None, budget: int, reason: str | None = None) -> str:
    """Portage de `poleStatus` (accessibility.ts) : accessible / out_only / none / unknown."""
    if (out is None or ret is None) and reason in UNKNOWN_REASONS:
        return "unknown"
    if out is not None and ret is not None and out <= budget and ret <= budget:
        return "accessible"
    return "out_only" if out is not None and out <= budget else "none"


def _statuses(series: Mapping[str, Sequence[Any]], budget: int) -> list[str]:
    out, ret = series["out"], series["ret"]
    reasons = series.get("reason") or [None] * len(out)
    return [access_status(o, r, budget, why) for o, r, why in zip(out, ret, reasons, strict=True)]


def commune_dark(part: Mapping[str, Any] | None) -> bool:
    """Portage de `transitCommuneDark` (gain.ts) : au moins une commune mesurée, aucun poste atteint, aucune sans verdict.

    `not_reached` compte aussi les postes « aller seulement » : un astre fait uniquement de la commune de départ, ou
    sans aucune mesure, n'est donc jamais éteint au sens de cette règle."""
    return part is not None and int(part["reached"]) == 0 and int(part["unknown"]) == 0 and int(part["not_reached"]) > 0


def gold_delta(transit: Mapping[str, Sequence[Any]], complement: Mapping[str, Sequence[Any]], budget: int,
               commune_parts: Sequence[Mapping[str, Any]] | None) -> tuple[list[int] | None, list[int]]:
    """(indices des astres en or, indices des astres perdus). Le premier vaut None sans table commune par commune."""
    gained: list[int] = []
    lost: list[int] = []
    for i, (a, b) in enumerate(zip(_statuses(transit, budget), _statuses(complement, budget), strict=True)):
        if "unknown" in (a, b) or (a == "accessible") == (b == "accessible"):
            continue
        (gained if b == "accessible" else lost).append(i)
    if commune_parts is None:
        return None, lost
    if len(commune_parts) != len(transit["out"]):
        raise ValueError(f"{len(commune_parts)} parts commune par commune pour {len(transit['out'])} astres")
    return [i for i in gained if commune_dark(commune_parts[i])], lost


class CommuneTransit:
    """Part TC commune par commune lue dans la table publiée du réglage de marche par défaut, comme le site."""

    def __init__(self, od_dir: Path, index: Mapping[str, Any], day_types: Sequence[Mapping[str, Any]]) -> None:
        self._dir = od_dir
        self._codes = set(index["communes"])
        self._n = len(index["communes"])
        self._jobs = index["jobs"]
        self._pole_of = index["pole_of"]
        self._group_jobs = [int(p["jobs"]) for p in index["poles"]]
        self._lookback = int(index["outbound_lookback_min"])
        self._mode_code = next(m["code"] for m in index["modes"] if m["id"] == "transit")
        self._days = {d["id"]: (_minutes(d["start"]), _minutes(d["end"])) for d in day_types}
        self._parsed: dict[str, Any] = {}

    @classmethod
    def from_front(cls, front: Path) -> CommuneTransit | None:
        """Table du dossier publié `front` ; None si elle manque, si elle n'est pas celle du réglage par défaut, si ses
        astres ne sont pas ceux de `poles.json` ou si la série TC n'est pas complète : jamais d'autre base."""
        paths = {name: front / f"{name}.json" for name in ("meta", "poles")}
        if not all(p.exists() for p in paths.values()):
            return None
        meta, poles = (json.loads(p.read_text(encoding="utf-8")) for p in paths.values())
        ws = meta.get("walk_settings") or {}
        setting = next((s for s in ws.get("settings", []) if s.get("id") == ws.get("default")), None)
        if setting is None or "day_types" not in meta:
            return None
        od_dir = front / f"od_walk{setting['leg_limit_m']}"
        if not (od_dir / "index.json").exists():
            return None
        index = json.loads((od_dir / "index.json").read_text(encoding="utf-8"))
        same_setting = (index.get("walk_setting") or {}).get("id") == ws["default"]
        same_poles = [p["id"] for p in index["poles"]] == [p["id"] for p in poles]
        transit = next((m for m in index["modes"] if m["id"] == "transit"), None)
        complete = (index.get("coverage", {}).get("transit") or {}).get("complete") is True
        if not (same_setting and same_poles and transit is not None and transit["kind"] == "series" and complete):
            return None
        return cls(od_dir, index, meta["day_types"])

    def _read(self, insee: str) -> Any | None:
        # Import ici : ces deux modules tirent pandas et pyproj, inutiles à la règle pure ci-dessus
        from starway import od_export as ox

        if insee not in self._parsed:
            path = self._dir / "o" / f"{insee}.bin"
            if insee not in self._codes or not path.exists():
                self._parsed[insee] = None
            else:
                raw = path.read_bytes()
                self._parsed[insee] = ox.parse_file(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)
        return self._parsed[insee]

    def parts(self, insee: str, day: str, budget: int) -> list[dict] | None:
        """Part TC de chaque astre (`sky_groups.group_shares`), ou None si la commune ou la journée-type n'a pas de table."""
        from starway import sky_groups as sg

        parsed = self._read(insee)
        if parsed is None or day not in self._days:
            return None
        start, end = self._days[day]
        states = sg.od_states(parsed, self._n, self._mode_code, start, end, budget, self._lookback)
        return sg.group_shares(states, self._jobs, self._pole_of, self._group_jobs)


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)
