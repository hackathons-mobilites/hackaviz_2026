"""Contrôle de la livraison des calculs sur le flux du 06/11/2026 (avant tout rapatriement dans data/interim).

Claude Code livre les nouveaux dossiers de calcul dans une archive (avec son sha256), sous EXACTEMENT les mêmes noms que les
anciens (`EXPECTED_DIRS`). Ce module décide, sans rien écrire, si l'archive extraite est complète et conforme :

  - chaque dossier attendu est présent, sans fichier `.part` (lot en cours d'écriture) ;
  - il contient au moins tous les fichiers de l'ancien dossier de même nom (même structure) ; sans ancien dossier (vélo + TC
    toutes communes, jamais rapatrié), chaque journée a tous ses lots (`n_origins` et `batch_size` de run_params.json) ;
  - son `run_params.json` porte l'empreinte du GTFS de SON réseau (`publication.gtfs_source_of` : TRA01 pour le jour, TRA01B
    pour la nuit et, depuis le flux du 06/11, le vélo + TC, TRA01C pour le soir), calculée sur les fichiers livrés ;
  - la liste sha256 par fichier de l'archive, quand elle existe, est respectée (zéro écart).

Aucun écrasement : le rapatriement lui-même est fait par `tools/vm/rapatrier-flux-f06.ps1`.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

from starway import publication as pub

BIKE_PARTS = ("a", "b1", "b2", "b3", "b4", "b5")
# Mêmes noms que les dossiers publiés aujourd'hui (data/interim) : normal (3000 m) et confort (1000 m).
EXPECTED_DIRS: tuple[str, ...] = (
    *(f"matrix_walk{lim}_d031_b44" for lim in (3000, 1000)),
    *(f"matrix_walk{lim}_d031_nuit_b44" for lim in (3000, 1000)),
    *(f"od_walk{lim}_d031" for lim in (3000, 1000)),
    *(f"od_walk{lim}_d031_nuit_matin" for lim in (3000, 1000)),
    *(f"od_walk{lim}_d031_nuit_soir_v2" for lim in (3000, 1000)),
    *(f"itineraries_walk{lim}_d031_b44" for lim in (3000, 1000)),
    *(f"itineraries_walk{lim}_d031_nuit_b44" for lim in (3000, 1000)),
    "matrix_story_d031_b44",
    *(f"matrix_bike_transit_all_d031_b44_{p}" for p in BIKE_PARTS),
)
# Fichiers GTFS livrés : nom attendu dans l'archive -> (source, nom de rangement dans data/raw/<source>/). Les noms de
# rangement sont NOUVEAUX : l'ancien fichier de data/raw/TRA01 n'est ni modifié ni remplacé.
GTFS_DELIVERY: dict[str, tuple[str, str]] = {
    "IDFM-gtfs-0611.zip": ("TRA01", "IDFM-gtfs-0611.zip"),
    "gtfs_nuit.zip": ("TRA01B", "gtfs_nuit-0611.zip"),
    "gtfs_soir.zip": ("TRA01C", "gtfs_soir-0611.zip"),
}
SUMS_NAMES = ("sha256sums.txt", "SHA256SUMS", "SHA256SUMS.txt", "_sha256.txt", "sha256.txt")


@dataclass
class DirVerdict:
    name: str
    path: Path | None
    problems: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.path is not None and not self.problems


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_dir(stage: Path, name: str) -> Path | None:
    """Dossier `name` dans l'archive extraite : à la racine, sous `interim/` ou sous `data/interim/`."""
    for rel in (name, f"interim/{name}", f"data/interim/{name}"):
        if (stage / rel).is_dir():
            return stage / rel
    return None


def find_file(stage: Path, filename: str) -> list[Path]:
    return sorted(p for p in stage.rglob(filename) if p.is_file())


def relative_files(d: Path) -> set[str]:
    return {p.relative_to(d).as_posix() for p in d.rglob("*") if p.is_file()}


def parts_in(d: Path) -> list[str]:
    return sorted(p.relative_to(d).as_posix() for p in d.rglob("*.part"))


def expected_gtfs_sha(name: str, digests: Mapping[str, str]) -> tuple[str, str]:
    """(source, empreinte attendue) du GTFS d'un dossier livré, d'après les fichiers GTFS livrés."""
    sid = pub.gtfs_source_of(name, dict(digests))
    return sid, digests[sid]


def batch_problems(d: Path, params: Mapping[str, object]) -> list[str]:
    """Dossier sans ancien équivalent : chaque journée (sous-dossier de `batches/`) a tous ses lots."""
    bdir = d / "batches"
    n, size = params.get("n_origins"), params.get("batch_size")
    if not bdir.is_dir() or not isinstance(n, int) or not isinstance(size, int) or size <= 0:
        return ["lots non vérifiables : batches/, n_origins ou batch_size absents de run_params.json"]
    want = math.ceil(n / size)
    subs = sorted(p for p in bdir.iterdir() if p.is_dir())
    errs = [] if len(subs) >= 3 else [f"{len(subs)} journée(s) dans batches/, 3 attendues (d06, d09, d14)"]
    for s in subs:
        have = len(list(s.glob("batch_*.csv")))
        if have < want:
            errs.append(f"{s.name} : {have} lots sur {want}")
    return errs


def check_dir(name: str, new: Path | None, old: Path | None, digests: Mapping[str, str]) -> DirVerdict:
    v = DirVerdict(name, new)
    if new is None:
        v.problems.append("absent de l'archive")
        return v
    rp_path = new / "run_params.json"
    if not rp_path.exists():
        v.problems.append("run_params.json absent")
        return v
    params = json.loads(rp_path.read_text(encoding="utf-8"))
    for p in parts_in(new):
        v.problems.append(f"fichier en cours d'écriture : {p}")
    if old is not None and old.is_dir():
        missing = sorted(relative_files(old) - relative_files(new))
        if missing:
            v.problems.append(f"{len(missing)} fichier(s) de l'ancien dossier absents du nouveau, par exemple {missing[:3]}")
        v.notes.append("même structure que l'ancien dossier" if not missing else "structure incomplète")
    elif name.startswith(("matrix_bike_transit", "matrix_story")):
        v.problems += batch_problems(new, params)
    sid, want = expected_gtfs_sha(name, digests)
    if params.get("gtfs_sha256") != want:
        v.problems.append(f"gtfs_sha256 {str(params.get('gtfs_sha256'))[:8]} != {sid} livré {want[:8]}")
    else:
        v.notes.append(f"calculé sur {sid} {want[:8]}")
    return v


def parse_sums(text: str) -> list[tuple[str, str]]:
    """Lignes `sha256  chemin` (sortie de sha256sum, `*` du mode binaire toléré)."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        digest, _, rel = line.partition(" ")
        out.append((digest.lower(), rel.strip().lstrip("*").replace("\\", "/")))
    return out


def check_sums(stage: Path, sums: Iterable[tuple[str, str]]) -> list[str]:
    errs = []
    for digest, rel in sums:
        p = stage / rel
        if not p.exists():
            errs.append(f"absent : {rel}")
        elif sha256_file(p) != digest:
            errs.append(f"sha256 différent : {rel}")
    return errs


def find_sums(stage: Path) -> Path | None:
    for n in SUMS_NAMES:
        found = find_file(stage, n)
        if found:
            return found[0]
    return None
