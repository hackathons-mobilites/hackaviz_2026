"""Variante « marche jusqu'à 2 h » (D-022 proposée) : jar R5 recompilé et garde-fous du calcul 04e.

Logique pure (sans Java), testée dans tests/test_r5jar.py :
- `derived_walk_limit_m` : limite de marche dérivée des paramètres du calcul (MAX_TRIP_MIN x SPEED_WALKING_KMH) ;
- `class_static_int_constants` : lit les constantes `static final int` d'un fichier .class (format JVM, chap. 4
  de la spécification), pour vérifier dans le jar lui-même la valeur de `TransitLayer.WALK_DISTANCE_LIMIT_METERS` ;
- `jar_info` : empreinte, version et constantes de limite du jar ;
- `low_memory` : arrêt propre quand la machine descend sous un seuil de mémoire libre ;
- `check_not_inside` : refuse d'écrire dans les dossiers d'un autre calcul.
"""

from __future__ import annotations

import hashlib
import math
import struct
import zipfile
from pathlib import Path

TRANSIT_LAYER_CLASS = "com/conveyal/r5/transit/TransitLayer.class"
VERSION_PROPERTIES = "com/conveyal/r5/version.properties"
LIMIT_FIELDS = ("WALK_DISTANCE_LIMIT_METERS", "TRANSFER_DISTANCE_LIMIT_METERS", "PARKRIDE_DISTANCE_LIMIT_METERS")

# Tailles des entrées du constant pool (JVMS § 4.4), hors Utf8 (longueur variable) ; Long et Double occupent 2 index.
_CP_SIZES = {3: 4, 4: 4, 5: 8, 6: 8, 7: 2, 8: 2, 9: 4, 10: 4, 11: 4, 12: 4, 15: 3, 16: 2, 17: 4, 18: 4, 19: 2, 20: 2}
_ACC_STATIC, _ACC_FINAL = 0x0008, 0x0010


def derived_walk_limit_m(max_trip_min: int, speed_walking_kmh: float) -> int:
    """Distance parcourue à pied pendant l'horizon de recherche : max_trip_min / 60 h x vitesse (km/h), en mètres."""
    meters = max_trip_min / 60 * speed_walking_kmh * 1000
    if meters <= 0 or abs(meters - round(meters)) > 1e-6:
        raise ValueError(f"limite dérivée non entière ou nulle : {meters} m")
    return round(meters)


def class_static_int_constants(data: bytes) -> dict[str, int]:
    """{nom: valeur} des champs `static final int` qui ont un attribut ConstantValue."""
    if data[:4] != b"\xca\xfe\xba\xbe":
        raise ValueError("pas un fichier .class")
    pos = 8
    (count,) = struct.unpack_from(">H", data, pos)
    pos += 2
    utf8: dict[int, str] = {}
    ints: dict[int, int] = {}
    i = 1
    while i < count:
        tag = data[pos]
        pos += 1
        if tag == 1:
            (n,) = struct.unpack_from(">H", data, pos)
            utf8[i] = data[pos + 2:pos + 2 + n].decode("utf-8", errors="replace")
            pos += 2 + n
        elif tag in _CP_SIZES:
            if tag == 3:
                (ints[i],) = struct.unpack_from(">i", data, pos)
            pos += _CP_SIZES[tag]
            if tag in (5, 6):
                i += 1
        else:
            raise ValueError(f"tag de constant pool inconnu {tag}")
        i += 1
    pos += 6  # access_flags, this_class, super_class
    (n_if,) = struct.unpack_from(">H", data, pos)
    pos += 2 + 2 * n_if
    (n_fields,) = struct.unpack_from(">H", data, pos)
    pos += 2
    out: dict[str, int] = {}
    for _ in range(n_fields):
        flags, name_i, desc_i, n_attr = struct.unpack_from(">HHHH", data, pos)
        pos += 8
        for _ in range(n_attr):
            a_name, a_len = struct.unpack_from(">HI", data, pos)
            pos += 6
            is_const = utf8.get(a_name) == "ConstantValue" and utf8.get(desc_i) == "I"
            if is_const and flags & _ACC_STATIC and flags & _ACC_FINAL:
                (cv,) = struct.unpack_from(">H", data, pos)
                if cv in ints:
                    out[utf8[name_i]] = ints[cv]
            pos += a_len
    return out


def parse_properties(text: str) -> dict[str, str]:
    """Fichier .properties simple (clé=valeur, `#` = commentaire), suffisant pour version.properties de R5."""
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def jar_info(jar: Path) -> dict:
    """Empreinte sha256, version R5 (version.properties) et constantes de limite de TransitLayer."""
    h = hashlib.sha256()
    with jar.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    with zipfile.ZipFile(jar) as z:
        consts = class_static_int_constants(z.read(TRANSIT_LAYER_CLASS))
        props = parse_properties(z.read(VERSION_PROPERTIES).decode("utf-8")) if VERSION_PROPERTIES in z.namelist() else {}
    missing = [f for f in LIMIT_FIELDS if f not in consts]
    if missing:
        raise ValueError(f"{jar.name} : constantes absentes de TransitLayer {missing}")
    return {"r5_jar": jar.name, "r5_jar_sha256": h.hexdigest(), "r5_version": props.get("version"),
            "r5_commit": props.get("commit"), **{f.lower(): consts[f] for f in LIMIT_FIELDS}}


def low_memory(available_bytes: int, min_free_gb: float) -> bool:
    """Vrai si la mémoire disponible de la machine est sous le seuil (Go décimaux, comme MemoryWatch de 04)."""
    return available_bytes < min_free_gb * 1e9


def check_not_inside(targets: list[Path], protected: list[Path]) -> None:
    """Refuse toute cible égale à, contenue dans, ou contenant un dossier protégé (calculs en cours ou publiés)."""
    for d in targets:
        d = d.resolve()
        for p in protected:
            p = p.resolve()
            if d == p or d.is_relative_to(p) or p.is_relative_to(d):
                raise SystemExit(f"dossier {d} confondu avec un dossier protégé ({p})")


def estimate_total(sample: list[float], population: int) -> dict[str, float]:
    """Total estimé d'une grandeur sur `population` éléments à partir d'un échantillon aléatoire simple :
    population x moyenne, intervalle à 95 % par l'approximation normale (correction de population finie)."""
    n = len(sample)
    if n < 2 or population < n:
        raise ValueError("échantillon trop petit ou plus grand que la population")
    mean = sum(sample) / n
    var = sum((x - mean) ** 2 for x in sample) / (n - 1)
    se = population * (var / n * (1 - n / population)) ** 0.5
    total = population * mean
    return {"n": n, "population": population, "mean": mean, "total": total,
            "low95": total - 1.96 * se, "high95": total + 1.96 * se}


def walk_time_limit_min(limit_m: int, speed_walking_kmh: float) -> int:
    """Durée (min entières, arrondi supérieur) pour parcourir `limit_m` à pied : r5py ne transmet à R5 que des
    minutes entières (`maxWalkTime`), l'arrondi supérieur garde au moins la distance demandée."""
    if limit_m <= 0 or speed_walking_kmh <= 0:
        raise ValueError("distance et vitesse doivent être positives")
    minutes = limit_m * 60 / (speed_walking_kmh * 1000)
    return math.ceil(round(minutes, 9))
