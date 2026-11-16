#!/usr/bin/env python3
"""Génère les vignettes WebP et le manifeste de la mosaïque d'accueil.

Les sources sont déposées dans assets-src/home-mosaic/<slug>/ et décrites
dans assets-src/home-mosaic/manifest.json. Le résultat est écrit dans
Resultats/assets/home-mosaic/.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets-src" / "home-mosaic"
OUT = ROOT / "Resultats" / "assets" / "home-mosaic"
WIDTH = 600
HEIGHT = 390
QUALITY = 82

FOCUS_POINTS = {
    "center": (0.5, 0.5),
    "left": (0.3, 0.5),
    "right": (0.7, 0.5),
    "top": (0.5, 0.3),
    "bottom": (0.5, 0.7),
}


def focus_point(value: object) -> tuple[float, float]:
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return float(value[0]), float(value[1])
    return FOCUS_POINTS.get(str(value or "center").lower(), FOCUS_POINTS["center"])


def media_type(entry: dict[str, object], source_name: str) -> str:
    declared = str(entry.get("type") or "").lower()
    if declared in ("video", "gif"):
        return declared
    suffix = Path(source_name).suffix.lower()
    if suffix in (".mp4", ".webm", ".mov", ".m4v"):
        return "video"
    if suffix == ".gif":
        return "gif"
    return "image"


def fail(message: str) -> int:
    print(f"Erreur : {message}", file=sys.stderr)
    return 1


def main() -> int:
    manifest_path = SRC / "manifest.json"
    if not manifest_path.exists():
        return fail(
            "assets-src/home-mosaic/manifest.json est absent. "
            "Copie manifest.example.json et complète-le avec tes captures."
        )

    try:
        entries = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return fail(f"manifest.json invalide : {exc}")

    if not isinstance(entries, list):
        return fail("manifest.json doit contenir une liste d'entrées.")

    OUT.mkdir(parents=True, exist_ok=True)
    output_entries: list[dict[str, object]] = []

    for index, entry in enumerate(entries, start=1):
        if not isinstance(entry, dict):
            return fail(f"entrée {index} : objet attendu.")

        team_num = entry.get("teamNum")
        slug = entry.get("slug")
        source_name = entry.get("src")
        if not isinstance(team_num, int):
            return fail(f"entrée {index} : teamNum doit être un entier.")
        if not isinstance(slug, str) or not slug:
            return fail(f"entrée {index} : slug manquant.")
        if not isinstance(source_name, str) or not source_name:
            return fail(f"entrée {index} : src manquant.")

        source = SRC / slug / source_name
        if not source.exists():
            return fail(f"entrée {index} : fichier introuvable {source}")

        destination_dir = OUT / slug
        destination_dir.mkdir(parents=True, exist_ok=True)

        focus = entry.get("focus", "center")
        kind = media_type(entry, source_name)
        if kind in ("video", "gif"):
            destination = destination_dir / source.name
            shutil.copy2(source, destination)
            output_entry = {
                "teamNum": team_num,
                "file": f"{slug}/{destination.name}",
                "alt": entry.get("alt") or f"Capture du projet {team_num}",
                "focus": focus if isinstance(focus, str) else "center",
                "type": kind,
            }
            if entry.get("poster"):
                output_entry["poster"] = entry["poster"]
            output_entries.append(output_entry)
            continue

        destination = destination_dir / f"{Path(source_name).stem}.webp"

        image = Image.open(source)
        if image.mode in ("RGBA", "LA"):
            background = Image.new("RGB", image.size, "white")
            background.paste(image, mask=image.getchannel("A"))
            image = background
        else:
            image = image.convert("RGB")

        thumbnail = ImageOps.fit(
            image,
            (WIDTH, HEIGHT),
            method=Image.LANCZOS,
            centering=focus_point(entry.get("focus")),
        )
        thumbnail.save(destination, "WEBP", quality=QUALITY, method=6)

        output_entries.append(
            {
                "teamNum": team_num,
                "file": f"{slug}/{destination.name}",
                "alt": entry.get("alt") or f"Capture du projet {team_num}",
                "focus": focus if isinstance(focus, str) else "center",
            }
        )

    (OUT / "manifest.json").write_text(
        json.dumps(output_entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"{len(output_entries)} vignette(s) générée(s) dans {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
