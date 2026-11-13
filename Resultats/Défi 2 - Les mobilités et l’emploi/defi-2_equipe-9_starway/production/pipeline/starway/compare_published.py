"""Tableau ANCIEN et NOUVEAU des chiffres affichés par les découvertes (insights.json), pour la publication du flux du 06/11.

Pure : compare deux listes de découvertes (même format que `frontend/public/data/insights.json`) et écrit un tableau
Markdown. Aucune interprétation : seuls les chiffres des deux fichiers sont rapprochés, découverte par découverte (même
identifiant), avec le scénario (origine, journée, budget, mode) et le rang. Une découverte absente d'un côté est listée.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

METRIC_KEYS = ("jobs", "jobs_ref", "jobs_delta", "poles_delta")


def index_by_id(items: Sequence[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    out: dict[str, Mapping[str, Any]] = {}
    for it in items:
        if it["id"] in out:
            raise ValueError(f"identifiant en double : {it['id']}")
        out[it["id"]] = it
    return out


def scenario_text(it: Mapping[str, Any]) -> str:
    s = it.get("scenario") or {}
    parts = [f"origine {s.get('o')}", f"journée {s.get('d')}", f"budget {s.get('b')} min", f"mode {s.get('m')}"]
    if s.get("vs"):
        parts.append(f"contre {s['vs']}")
    if s.get("compare_day"):
        parts.append(f"journée de comparaison {s['compare_day']}")
    return ", ".join(parts)


def cell(it: Mapping[str, Any] | None, key: str) -> str:
    if it is None:
        return "absente"
    v = (it.get("metric") or {}).get(key)
    return "null" if v is None else f"{v:,}".replace(",", " ")


def compare(old: Sequence[Mapping[str, Any]], new: Sequence[Mapping[str, Any]]) -> list[dict[str, str]]:
    """Une ligne par (découverte, indicateur) : ancien, nouveau, `identique` ou `change`. Les valeurs sont recopiées, jamais
    arrondies ni commentées."""
    a, b = index_by_id(old), index_by_id(new)
    rows: list[dict[str, str]] = []
    for iid in sorted(set(a) | set(b)):
        ia, ib = a.get(iid), b.get(iid)
        ref = ib or ia
        assert ref is not None
        keys = [k for k in METRIC_KEYS if any(k in ((x or {}).get("metric") or {}) for x in (ia, ib))]
        for k in keys:
            o, n = cell(ia, k), cell(ib, k)
            rows.append({"id": iid, "type": str(ref.get("kind")), "scénario": scenario_text(ref), "indicateur": k,
                         "ancien": o, "nouveau": n, "état": "identique" if o == n else "change"})
        for k in ("rank", "robust"):
            o = "absente" if ia is None else str(ia.get(k))
            n = "absente" if ib is None else str(ib.get(k))
            rows.append({"id": iid, "type": str(ref.get("kind")), "scénario": scenario_text(ref), "indicateur": k,
                         "ancien": o, "nouveau": n, "état": "identique" if o == n else "change"})
    return rows


def markdown(rows: Sequence[Mapping[str, str]]) -> str:
    head = ["id", "type", "scénario", "indicateur", "ancien", "nouveau", "état"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    lines += ["| " + " | ".join(r[h] for h in head) + " |" for r in rows]
    n = sum(r["état"] == "change" for r in rows)
    lines.append("")
    lines.append(f"{len(rows)} lignes comparées, {n} qui changent (aucune interprétation : valeurs recopiées des deux fichiers).")
    return "\n".join(lines) + "\n"
