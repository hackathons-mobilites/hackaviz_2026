"""Render a silent, reproducible film from the route planner's hourly hexagons.

Requires Pillow and ffmpeg. Values between model hours are visual interpolation;
they are not additional solar or climate calculations.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PALETTE = [(244, 210, 122), (91, 163, 217), (0, 85, 164)]
BACKGROUND = (245, 245, 243)
INK = (29, 29, 31)
MUTED = (100, 100, 106)


def color(value: float | None) -> tuple[int, int, int]:
    if value is None:
        return (219, 223, 224)
    value = max(0.0, min(1.0, value))
    index = min(1, int(value * 2))
    amount = value * 2 - index
    return tuple(round(a + (b - a) * amount) for a, b in zip(PALETTE[index], PALETTE[index + 1]))


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("/System/Library/Fonts/Supplemental") / ("Arial Bold.ttf" if bold else "Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu") / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    raise RuntimeError("Install Arial or DejaVu Sans, or update the font paths in this script")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "public/data/story-hex.json")
    parser.add_argument("--output", type=Path, default=ROOT / "public/media/paris-ombre-journee.mp4")
    parser.add_argument("--poster", type=Path, default=ROOT / "public/media/paris-ombre-16h.jpg")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--duration", type=float, default=16)
    args = parser.parse_args()
    if args.duration <= 2 or args.width % 2 or args.height % 2:
        parser.error("Duration must exceed two seconds and dimensions must be even")
    if not shutil.which("ffmpeg"):
        parser.error("ffmpeg is required")

    data = json.loads(args.data.read_text())
    hours = data["hours"]
    cells = data["cells"]
    if hours != list(range(7, 22)):
        raise ValueError("This film expects the fifteen hourly samples from 7 to 21")
    if any(len(cell["shade"]) != len(hours) for cell in cells):
        raise ValueError("Every hexagon must have one value per model hour")

    width, height, supersample = args.width, args.height, 2
    sx, sy = width / 1280, height / 900
    scale_ui = min(sx, sy)
    def xy(x: float, y: float) -> tuple[int, int]:
        return round(x * sx * supersample), round(y * sy * supersample)

    title_font = font(round(34 * scale_ui * supersample), True)
    time_font = font(round(58 * scale_ui * supersample), True)
    label_font = font(round(18 * scale_ui * supersample))
    small_font = font(round(16 * scale_ui * supersample))

    # A fixed local metric projection for the entire film, with no camera motion.
    cos_latitude = math.cos(math.radians(48.86))
    all_coords = [point for cell in cells for point in cell["ring"]] + data["ring"]
    west = min(p[0] for p in all_coords)
    east = max(p[0] for p in all_coords)
    south = min(p[1] for p in all_coords)
    north = max(p[1] for p in all_coords)
    extent_x, extent_y = (east - west) * cos_latitude, north - south
    map_left, map_top = 40 * sx, 160 * sy
    map_width, map_height = 1080 * sx, 600 * sy
    geographic_scale = min(map_width / extent_x, map_height / extent_y)
    x_offset = map_left + (map_width - extent_x * geographic_scale) / 2
    y_offset = map_top + (map_height - extent_y * geographic_scale) / 2
    def project(point: list[float]) -> tuple[int, int]:
        return (
            round((x_offset + (point[0] - west) * cos_latitude * geographic_scale) * supersample),
            round((y_offset + (north - point[1]) * geographic_scale) * supersample),
        )
    polygons = [[project(point) for point in cell["ring"]] for cell in cells]
    boundary = [project(point) for point in data["ring"]]

    base = Image.new("RGB", (width * supersample, height * supersample), BACKGROUND)
    draw = ImageDraw.Draw(base)
    draw.text(xy(52, 38), "Paris au fil du soleil", fill=INK, font=title_font)
    draw.text(xy(54, 90), "25 juin 2026, ciel dégagé", fill=MUTED, font=label_font)
    draw.rounded_rectangle([xy(1110, 280), xy(1234, 602)], radius=16 * supersample, fill=(255,255,255))
    draw.text(xy(1172, 302), "Ombre", fill=INK, font=label_font, anchor="ma")
    draw.text(xy(1172, 328), "des rues", fill=INK, font=label_font, anchor="ma")
    draw.text(xy(1172, 369), "100 %", fill=MUTED, font=small_font, anchor="ma")
    for y in range(142):
        draw.rectangle([xy(1165, 400+y), xy(1179, 401+y)], fill=color(1-y/141))
    draw.text(xy(1172, 559), "0 %", fill=MUTED, font=small_font, anchor="ma")
    draw.text(xy(54, 824), "Ombre des rues modélisée par Canopée. IGN, Ville de Paris. Ciel dégagé.", fill=MUTED, font=small_font)
    draw.text(xy(54, 852), "Hexagones de rayon 260 m. Interpolation entre les calculs horaires.", fill=MUTED, font=small_font)
    draw.polygon(boundary, fill=(231, 234, 233))
    draw.line(boundary, fill=(195, 202, 203), width=2 * supersample, joint="curve")

    def render(hour: float) -> Image.Image:
        image = base.copy()
        painter = ImageDraw.Draw(image)
        before = min(len(hours) - 1, max(0, math.floor(hour - hours[0])))
        after = min(before + 1, len(hours) - 1)
        mix = max(0.0, min(1.0, hour - hours[before]))
        for cell, polygon in zip(cells, polygons):
            a, b = cell["shade"][before], cell["shade"][after]
            value = a if b is None else b if a is None else a + (b - a) * mix
            painter.polygon(polygon, fill=color(value))
            painter.line(polygon, fill=(248, 249, 248), width=supersample, joint="curve")
        # The clock makes the interpolation interval explicit, down to the minute.
        minutes = round(hour * 60)
        label = f"{minutes // 60:02d} h {minutes % 60:02d}"
        painter.text(xy(1226, 39), label, fill=(0, 85, 164), font=time_font, anchor="ra")
        return image.resize((width, height), Image.Resampling.LANCZOS)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.poster.parent.mkdir(parents=True, exist_ok=True)
    render(16).save(args.poster, quality=93, subsampling=0)
    frames = round(args.duration * args.fps)
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", f"{width}x{height}",
        "-framerate", str(args.fps), "-i", "pipe:0", "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-metadata", "title=Paris au fil du soleil",
        "-metadata", "comment=Canopée, modèle du 25 juin 2026. Interpolation visuelle entre les calculs horaires.",
        str(args.output),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for frame_index in range(frames):
            time = frame_index / args.fps
            progress = max(0.0, min(1.0, (time - 1) / (args.duration - 2)))
            hour = hours[0] + (hours[-1] - hours[0]) * progress
            process.stdin.write(render(hour).tobytes())
            if frame_index % (args.fps * 4) == 0:
                print(f"Rendering {frame_index}/{frames} frames", flush=True)
        process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError("ffmpeg did not complete successfully")
    except BaseException:
        process.kill()
        process.wait()
        raise
    print(f"Saved {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MiB), {args.duration:g}s at {args.fps}fps")
    print(f"Saved poster {args.poster}")


if __name__ == "__main__":
    main()
