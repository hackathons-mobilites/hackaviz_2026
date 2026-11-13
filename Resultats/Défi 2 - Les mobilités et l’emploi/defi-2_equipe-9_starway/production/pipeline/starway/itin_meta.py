"""Annonces de `meta.json` tirées des dossiers d'itinéraires publiés (06, 06h, 06t : une seule règle).

- `itineraries_communes` : communes du jeu par défaut (`itineraries/`) ;
- `transfer_check` : marquage D-031 (c) du jeu par défaut, s'il couvre tous ses fichiers ;
- `itineraries_variants.{réglage}` : `{dir, walk_setting, communes, transfer_check?}` pour chaque autre réglage
  publié (aujourd'hui « confort ») ; clé absente si aucun ;
- `itineraries_format` : `{suffix, encoding}` (fichiers `{insee}.json.gz`) ;
- `line_facts` : bloc commun des fichiers (`line_facts_meta`) et textes, si tous les fichiers de tous les jeux le
  portent ; absent sinon.
"""

from __future__ import annotations

from collections.abc import MutableMapping
from pathlib import Path
from typing import Any

from starway import itin_sets as iss
from starway import line_facts as lf
from starway.config import FRONT_DATA_DIR
from starway.transfer_marks import published_meta as transfer_check_meta

KEYS = ("itineraries_communes", "transfer_check", "itineraries_variants", "itineraries_format", "line_facts")


def build(front_dir: Path = FRONT_DATA_DIR) -> dict[str, Any]:
    out: dict[str, Any] = {}
    variants: dict[str, Any] = {}
    lf_blocks: list[Any] = []
    any_file = False
    for s in iss.all_sets(front_dir):
        docs = [d for _, d in iss.iter_docs(s.out_dir)]
        communes = iss.published_communes(s.out_dir)
        any_file = any_file or bool(communes)
        lf_blocks += [d.get("line_facts_meta") for d in docs]
        tc = transfer_check_meta(docs) if docs else None
        if s.is_default:
            out["itineraries_communes"] = communes
            if tc is not None:
                out["transfer_check"] = tc
        elif communes:
            variants[s.walk_setting] = iss.variant_entry(s, communes, tc)
    if variants:
        out["itineraries_variants"] = variants
    if any_file:
        out["itineraries_format"] = {"suffix": iss.SUFFIX, "encoding": iss.ENCODING}
        if (block := lf.published_meta(lf_blocks)) is not None:
            out["line_facts"] = block
    return out


def apply(meta: MutableMapping[str, Any], front_dir: Path = FRONT_DATA_DIR) -> MutableMapping[str, Any]:
    """Remplace les clés d'itinéraires de `meta` par celles des dossiers publiés (les autres clés ne bougent pas)."""
    for k in KEYS:
        meta.pop(k, None)
    meta.update(build(front_dir))
    return meta
