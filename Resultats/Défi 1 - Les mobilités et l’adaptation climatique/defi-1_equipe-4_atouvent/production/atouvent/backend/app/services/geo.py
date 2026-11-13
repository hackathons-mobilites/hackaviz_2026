"""Distances en mètres (approximation équirectangulaire, précise à l'échelle de l'Île-de-France)."""
from __future__ import annotations

import math

R = 6_371_000


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance entre deux points (lat, lon)."""
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return R * math.hypot(x, math.radians(b[0] - a[0]))


def distances_m(lat, lon, lats, lons):
    """Distances d'un point à un tableau de points (numpy)."""
    import numpy as np
    x = np.radians(lons - lon) * np.cos(np.radians((lat + lats) / 2))
    return R * np.sqrt(x * x + np.radians(lats - lat) ** 2)
