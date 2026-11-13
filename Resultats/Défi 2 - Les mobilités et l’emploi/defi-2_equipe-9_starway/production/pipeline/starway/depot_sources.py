"""Tableau « Les données utilisées » du README du dépôt officiel, généré depuis le registre des sources.

Le tableau écrit à la main du brouillon (`docs/depot-officiel/README.md`) ne listait que les sources principales du
03/11. Ce rendu reprend **toutes les sources au statut « utilisée et publiée »** de `starway.registry`
(`SOURCE_INFO`) avec leur licence et leur lien tirés du manifeste : rien n'est saisi à la main, il suit les fusions
qui ajoutent une source (relancer `06r` puis `06s`).
"""

from __future__ import annotations

import re
from collections.abc import Mapping

from starway import registry as reg

_URL = re.compile(r"https?://[^\s;,)\"']+")


def first_url(text: str) -> str:
    """Première adresse http(s) d'un champ `url_source` (certains champs en contiennent deux et du texte)."""
    m = _URL.search(text or "")
    return m.group(0).rstrip(".") if m else ""


def main_row(rows: list[dict[str, str]]) -> dict[str, str]:
    """Ligne principale d'un code : la première qui n'est pas une documentation (comme `mainEntry` du front), sinon la
    première (l'ordre du registre est celui du nom de fichier : « documentation.pdf » passerait avant le jeu lui-même)."""
    return next((r for r in rows if "documentation" not in r.get("titre", "").lower()), rows[0])


def readme_rows(groups: Mapping[str, list[dict[str, str]]], status: str = "publiee") -> list[tuple[str, str, str, str, str]]:
    """Lignes (code, producteur, source avec millésime, licence, lien) des sources de ce statut."""
    out: list[tuple[str, str, str, str, str]] = []
    for code, rows in groups.items():
        info = reg.SOURCE_INFO.get(code)
        if info is None or info.status != status:
            continue
        lic = " + ".join(reg.LICENCE_SHORT[k] for k in reg.licence_kinds(" ; ".join(r.get("licence", "") for r in rows)))
        if reg.licence_to_confirm(" ; ".join(r.get("licence", "") for r in rows)):
            lic = (lic + " " if lic else "") + "(à confirmer)"
        main = main_row(rows)
        label = f"{info.name} ; millésime : {reg.clean_text(main.get('millesime', ''))}"
        url = next((u for u in (first_url(r.get("url_source", "")) for r in [main, *rows]) if u), "")
        out.append((code, info.producer, label, lic or "non reconnue", url))
    return out


def render_table(groups: Mapping[str, list[dict[str, str]]]) -> str:
    lines = ["| Code | Producteur | Jeu de données et millésime | Licence | Lien |", "|---|---|---|---|---|"]
    for code, producer, label, lic, url in readme_rows(groups):
        lines.append(f"| {code} | {reg._cell(producer)} | {reg._cell(label)} | {reg._cell(lic)} | {url or '-'} |")
    return "\n".join(lines) + "\n"
