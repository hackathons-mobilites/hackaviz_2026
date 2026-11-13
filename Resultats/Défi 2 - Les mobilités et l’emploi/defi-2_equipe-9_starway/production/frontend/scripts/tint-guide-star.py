"""Étoile-guide sans orangé (L-19, critique v0.6 § 9) : plafonne la saturation du sprite à celle de `#FFE6C7`.

Le cœur du sprite IMG (sprite-guide-star.webp) tirait vers l'orangé (teinte 30°, saturation jusqu'à 0,6),
proche de l'or `#F5B86D` (teinte 33°, saturation 0,56) réservé au « gain démontré ». Ce script garde la
teinte et la luminosité de chaque pixel et ramène sa saturation à 0,22 au plus (celle de `#FFE6C7`,
couleur de l'étoile-guide dans theme/tokens.ts) : plus aucun pixel n'est dans la saturation de l'or.
Canal alpha inchangé. Contrôle à la fin : nombre de pixels visibles au-dessus du plafond (doit être 0).

Outil : Pillow (licence MIT-CMU), déjà utilisé par optimize-images.py. Usage depuis la racine :
    python frontend/scripts/tint-guide-star.py
Entrée et sortie : le webp publié (le script est idempotent : relancé, il ne change plus rien de visible).
"""
from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DST = ROOT / "frontend" / "public" / "assets" / "img" / "sprite-guide-star.webp"
GUIDE = "FFE6C7"  # theme/tokens.ts, color.guide
GOLD = "F5B86D"  # theme/tokens.ts, color.gain


def hsv(hex_: str) -> tuple[float, float, float]:
    return colorsys.rgb_to_hsv(*(int(hex_[i : i + 2], 16) / 255 for i in (0, 2, 4)))


def main() -> None:
    cap = hsv(GUIDE)[1]
    gold_s = hsv(GOLD)[1]
    src = DST
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, h = im.size
    before = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if a >= 8 and s > cap:
                before += 1
                r2, g2, b2 = colorsys.hsv_to_rgb(hh, cap, v)
                px[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
    after = sum(
        1
        for y in range(h)
        for x in range(w)
        if px[x, y][3] >= 8 and colorsys.rgb_to_hsv(*(c / 255 for c in px[x, y][:3]))[1] > cap + 0.01
    )
    im.save(DST, "WEBP", quality=90, alpha_quality=90, method=6)
    print(f"{src.name} -> {DST.name} : {before} pixels ramenés à la saturation {cap:.2f} (or : {gold_s:.2f}) ; restants au-dessus : {after}")


if __name__ == "__main__":
    main()
