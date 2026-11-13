"""Faits publiés par ligne pour les tronçons en TC des itinéraires (panneau de preuve, 04/11/2026).

- Climatisation : IDFM, référentiel des lignes (TRA03, ODbL), champ `air_conditioning` (« Dispositif de
  climatisation ») : `true`, `partial`, `false`, `unknown`, recopié tel quel. Jointure : `route_id` du GTFS sans le
  préfixe `IDFM:` = `id_line` du référentiel. Ligne absente du référentiel : `null` (affiché « non renseignée »).
  Déclaration de la ligne, pas du véhicule ; IDFM ne définit pas `partial`.
- Ponctualité : SNCF Voyageurs, « Régularité mensuelle Transilien » (QS01, ODbL), `taux_de_ponctualite` = part des
  voyageurs arrivés à leur gare de destination avec moins de 5 minutes de retard. 13 lignes (RER A à E, Transilien
  H, J, K, L, N, P, R, U). Mois publié le plus récent du fichier, le même pour toutes les lignes (pas de moyenne
  annuelle : le jeu ne donne pas les volumes de voyageurs). Autres lignes (métro, tram, bus, ligne V, TER) : valeur
  `null` avec la raison `no_open_data`. RER A et B : lignes exploitées par la RATP et la SNCF ; le jeu ne dit pas si
  le taux couvre toute la ligne (texte publié dans `meta.line_facts`).

Licence ODbL (TRA03, QS01) : attribution, et les fichiers d'itinéraires qui reprennent ces valeurs (base dérivée)
sont publiés sous la même licence. Logique pure, testée dans tests/test_line_facts.py.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

AC_VALUES = ("true", "partial", "false", "unknown")
PUNCTUALITY_KINDS = {"rer": "RER", "train": "Transilien"}  # famille du tronçon (itineraries) -> `service` de QS01
REASON_NO_OPEN_DATA = "no_open_data"
REASON_MONTH_MISSING = "month_not_published"
SHARED_LINES = ("A", "B")  # RER exploités par la RATP et la SNCF
SOURCE_AC = "TRA03"
SOURCE_PUNCTUALITY = "QS01"
GTFS_ROUTE_PREFIX = "IDFM:"

TEXTS = {
    "air_conditioning": {
        "label": "Climatisation (déclarée à IDFM)",
        "values": {"true": "oui", "partial": "partielle", "false": "non", "unknown": "non renseignée"},
        "definition": ("Champ « Dispositif de climatisation » du référentiel des lignes d'IDFM : déclaration pour la "
                       "ligne, pas pour le véhicule qui passe. IDFM ne définit pas la valeur « partielle »."),
    },
    "punctuality": {
        "label": "Ponctualité de la ligne (SNCF Voyageurs)",
        "definition": ("Part des voyageurs arrivés à leur gare de destination avec moins de 5 minutes de retard, "
                       "sur toute la ligne et tout le mois (pas la ponctualité de ce trajet)."),
        "no_open_data": "pas de donnée ouverte pour cette ligne",
        "month_not_published": "mois non publié pour cette ligne",
        "shared_lines": list(SHARED_LINES),
        "shared_text": ("ligne exploitée par la RATP et la SNCF : SNCF Voyageurs ne précise pas si le taux couvre "
                        "toute la ligne ou seulement sa partie SNCF"),
    },
    "licence": ("Climatisation : référentiel des lignes d'Île-de-France Mobilités ; ponctualité : SNCF Voyageurs ; "
                "deux bases sous licence ODbL. Les fichiers d'itinéraires qui reprennent ces valeurs sont publiés "
                "sous la même licence (ODbL)."),
}


def route_line_id(route_id: str | None) -> str | None:
    """`IDFM:C01742` -> `C01742` (identifiant du référentiel des lignes)."""
    if not route_id:
        return None
    return route_id.removeprefix(GTFS_ROUTE_PREFIX)


@dataclass(frozen=True)
class LineFacts:
    """Tables chargées : climatisation par `id_line`, ponctualité par (`service`, `ligne`) au mois retenu, et lignes
    présentes dans QS01 (couvertes, même sans valeur au mois retenu)."""

    ac: Mapping[str, str]
    punctuality: Mapping[tuple[str, str], float]
    covered: frozenset[tuple[str, str]]
    month: str | None
    tra03_snapshot: str | None = None
    qs01_updated: str | None = None
    seen: dict[str, int] = field(default_factory=dict)  # comptes par fait (rapport de 06h)

    def leg_fields(self, kind: str | None, route_id: str | None, line: str | None) -> dict[str, Any]:
        """Champs ajoutés à un tronçon en TC : `air_conditioning` (valeur du référentiel, ou None si la ligne n'y est
        pas) et `punctuality` (`{value_pct, month}`, sinon `{value_pct: None, month: None, reason}`)."""
        lid = route_line_id(route_id)
        out: dict[str, Any] = {"air_conditioning": self.ac.get(lid) if lid else None}
        key = (PUNCTUALITY_KINDS.get(kind or ""), line)
        val = self.punctuality.get(key) if key[0] and line and self.month else None  # type: ignore[arg-type]
        if val is not None:
            out["punctuality"] = {"value_pct": val, "month": self.month}
        else:
            reason = REASON_MONTH_MISSING if key in self.covered else REASON_NO_OPEN_DATA
            out["punctuality"] = {"value_pct": None, "month": None, "reason": reason}
        self._count(out)
        return out

    def _count(self, f: Mapping[str, Any]) -> None:
        ac = f["air_conditioning"]
        p = f["punctuality"]
        for k in ("legs", f"ac_{ac if ac is not None else 'absent'}",
                  "punctuality_value" if p["value_pct"] is not None else f"punctuality_{p['reason']}"):
            self.seen[k] = self.seen.get(k, 0) + 1

    def file_meta(self) -> dict[str, Any]:
        """Bloc `line_facts_meta` de chaque fichier (et base de `meta.line_facts`)."""
        return {"sources": [SOURCE_AC, SOURCE_PUNCTUALITY], "tra03_snapshot": self.tra03_snapshot,
                "punctuality_month": self.month, "qs01_updated": self.qs01_updated}


def load_ac(frame: pd.DataFrame) -> dict[str, str]:
    """`id_line` -> `air_conditioning` ; valeur vide ou hors des 4 valeurs documentées : `unknown`."""
    out: dict[str, str] = {}
    for lid, v in zip(frame["id_line"], frame["air_conditioning"], strict=True):
        if not isinstance(lid, str) or not lid:
            continue
        s = v.strip().lower() if isinstance(v, str) else ""
        out[lid] = s if s in AC_VALUES else "unknown"
    return out


def load_punctuality(frame: pd.DataFrame
                     ) -> tuple[dict[tuple[str, str], float], frozenset[tuple[str, str]], str | None]:
    """Taux du mois le plus récent du fichier (`date` AAAA-MM), par (`service`, `ligne`), lignes RER et Transilien
    présentes dans le fichier, et ce mois. Valeur absente ou non numérique au mois retenu : pas de taux (raison
    `month_not_published` au tronçon), jamais une valeur d'un autre mois."""
    f = frame[frame["service"].isin(PUNCTUALITY_KINDS.values())]
    dates = sorted(d for d in f["date"].dropna().unique() if isinstance(d, str))
    if not dates:
        return {}, frozenset(), None
    month = dates[-1]
    covered = frozenset(zip(f["service"].astype(str), f["ligne"].astype(str), strict=True))
    out: dict[tuple[str, str], float] = {}
    for s, ln, v in zip(f["service"], f["ligne"], pd.to_numeric(f["taux_de_ponctualite"], errors="coerce").where(
            f["date"] == month), strict=True):
        if pd.notna(v):  # NaN (absent ou non numérique) exclu
            out[(str(s), str(ln))] = float(v)
    return out, covered, month


def from_files(tra03: Path, qs01: Path, tra03_snapshot: str | None = None, qs01_updated: str | None = None
               ) -> LineFacts:
    ac = load_ac(pd.read_csv(tra03, sep=";", encoding="utf-8-sig", dtype=str, usecols=["id_line", "air_conditioning"]))
    punct, covered, month = load_punctuality(pd.read_csv(qs01, sep=";", encoding="utf-8-sig", dtype=str))
    return LineFacts(ac, punct, covered, month, tra03_snapshot, qs01_updated)


def punctuality_value(facts: LineFacts, kind: str | None, line: str | None) -> float | None:
    """Taux attendu pour un tronçon (contrôle de 07) : celui de QS01 au mois retenu, sinon None."""
    service = PUNCTUALITY_KINDS.get(kind or "")
    return facts.punctuality.get((service, line)) if service and line else None


def published_meta(blocks: Iterable[Mapping[str, Any] | None]) -> dict[str, Any] | None:
    """`meta.line_facts` : bloc commun à tous les fichiers publiés (`line_facts_meta`), plus les textes ; None si un
    fichier n'en a pas ou si les blocs diffèrent."""
    bl = list(blocks)
    if not bl or any(b is None or b != bl[0] for b in bl):
        return None
    return {**bl[0], "texts": TEXTS}
