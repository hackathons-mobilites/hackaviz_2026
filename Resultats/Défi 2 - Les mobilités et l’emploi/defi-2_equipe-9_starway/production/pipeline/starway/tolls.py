"""Points et tronçons de péage de l'OSM (CYC01) traversés par un chemin voiture R5 (04g, préparation du coût péage).

Demande de Nicolas (03/11, soir) : enregistrer, pendant le recalcul de 04g, les points de péage traversés par chaque
chemin voiture, pour chiffrer les péages plus tard sans relancer 04g. Aucun tarif ici.

Éléments retenus (étiquettes OSM, rien d'autre) :
- nœuds `barrier=toll_booth` (gare de péage) et `highway=toll_gantry` (portique de péage en flux libre) ;
- chemins routiers (`highway=*`) étiquetés `toll=yes`.

Règle de rattachement, sans seuil de distance : R5 garde dans la géométrie de chaque arête les coordonnées des nœuds
OSM du chemin, en entiers de 1e-7 degré (`VertexStore.FIXED_FACTOR`). La conversion de R5 TRONQUE :
`floatingDegreesToFixed(d) = (int)(d * 1e7)` (code de R5 v7.5, lu le 04/11/2026). Pour un nœud OSM de latitude
48,9142945 (valeur du PBF), `48.9142945 * 1e7` vaut 489142944,99999994 en double : R5 garde 489142944, soit 1e-7
degré de moins que le PBF. Le premier relevé du 03/11 comparait des coordonnées arrondies à 7 décimales : 28 des 152
nœuds de péage d'IDF n'étaient jamais reconnus (dont les deux portiques de Montesson sur l'A14). Règle corrigée :
- côté OSM, coordonnée entière = arrondi de la valeur du PBF x 1e7 (la valeur exacte du fichier) ;
- côté R5, coordonnée entière = arrondi de la valeur rendue x 1e7 (R5 rend un entier / 1e7), puis, si elle n'est pas
  un sommet OSM connu, on essaie +1 en longitude et / ou en latitude : c'est l'effet exact de la troncature de R5 (qui
  n'enlève jamais plus d'une unité, et jamais n'en ajoute), pas un seuil ;
- un nœud de péage est traversé s'il est un sommet de la géométrie du chemin ;
- un chemin `toll=yes` est emprunté si au moins un segment du chemin (deux sommets consécutifs) est un segment de ce
  chemin OSM (dans un sens ou dans l'autre).
Un nœud de péage posé à côté de la chaussée (pas sur le chemin OSM) n'est donc jamais rattaché : limite écrite.

Logique pure (sans Java), testée dans tests/test_tolls.py.
"""

from __future__ import annotations

import itertools
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

NDIGITS = 7  # précision des coordonnées OSM (PBF : 100 nanodegrés) et de R5 (FIXED_FACTOR 1e7)
FIXED_FACTOR = 10 ** NDIGITS
R5_TRUNCATION_STEPS = ((0, 0), (1, 0), (0, 1), (1, 1))  # (int) de R5 : au plus une unité de moins, par axe
KEY_RULE = ("OSM : round(valeur du PBF x 1e7) ; R5 : round(valeur rendue x 1e7), puis +1 en longitude et / ou en "
            "latitude si ce n'est pas un sommet OSM connu (troncature (int)(d x 1e7) de R5, jamais plus d'une unité)")
NODE_TAGS = (("barrier", "toll_booth"), ("highway", "toll_gantry"))
_HSTORE = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')

Coord = tuple[float, float]
Fixed = tuple[int, int]


def parse_other_tags(text: str | None) -> dict[str, str]:
    """Champ `other_tags` du pilote OSM de GDAL (format hstore : "k"=>"v","k2"=>"v2")."""
    if not isinstance(text, str) or not text:  # NaN de pandas : aucune étiquette
        return {}
    return {k.replace('\\"', '"'): v.replace('\\"', '"') for k, v in _HSTORE.findall(text)}


def key(lon: float, lat: float) -> Coord:
    """Coordonnées arrondies à 7 décimales (écriture de osm_toll_points.json par 04i)."""
    return (round(float(lon), NDIGITS), round(float(lat), NDIGITS))


def fixed(lon: float, lat: float) -> Fixed:
    """Coordonnée entière en 1e-7 degré (arrondi) : valeur exacte du PBF, ou entier rendu par R5."""
    return (round(float(lon) * FIXED_FACTOR), round(float(lat) * FIXED_FACTOR))


def r5_truncated(lon: float, lat: float) -> Fixed:
    """Entier que R5 garde pour une coordonnée OSM : `(int)(d * 1e7)` (VertexStore.floatingDegreesToFixed)."""
    return (int(float(lon) * FIXED_FACTOR), int(float(lat) * FIXED_FACTOR))


def seg_key(a: Fixed, b: Fixed) -> tuple[Fixed, Fixed]:
    return (a, b) if a <= b else (b, a)


@dataclass
class TollIndex:
    """Index des nœuds (coordonnée entière OSM -> identifiants) et des segments de chemins `toll=yes`."""

    nodes: dict[Fixed, list[int]] = field(default_factory=dict)
    segments: dict[tuple[Fixed, Fixed], list[int]] = field(default_factory=dict)
    vertices: set[Fixed] = field(default_factory=set)

    @classmethod
    def build(cls, nodes: Iterable[dict[str, Any]], ways: Iterable[dict[str, Any]]) -> TollIndex:
        idx = cls()
        for n in nodes:
            k = fixed(n["lon"], n["lat"])
            idx.nodes.setdefault(k, []).append(int(n["osm_id"]))
            idx.vertices.add(k)
        for w in ways:
            pts = [fixed(x, y) for x, y in w["coords"]]
            idx.vertices.update(pts)
            for a, b in itertools.pairwise(pts):
                if a != b:
                    idx.segments.setdefault(seg_key(a, b), []).append(int(w["osm_id"]))
        return idx

    def resolve(self, lon: float, lat: float) -> Fixed:
        """Sommet OSM d'un point de la géométrie R5 : l'entier rendu, ou celui que la troncature de R5 a diminué d'une
        unité (longitude, latitude ou les deux) ; sinon l'entier rendu (point sans péage)."""
        f = fixed(lon, lat)
        for dx, dy in R5_TRUNCATION_STEPS:
            c = (f[0] + dx, f[1] + dy)
            if c in self.vertices:
                return c
        return f

    def match(self, lines: Sequence[Sequence[Coord]]) -> tuple[list[int], list[int]]:
        """(nœuds de péage traversés, chemins `toll=yes` empruntés) pour un chemin donné par ses lignes (une
        `LineString` ou les parties d'une `MultiLineString`, coordonnées rendues par R5). Identifiants OSM triés."""
        nodes: set[int] = set()
        ways: set[int] = set()
        for line in lines:
            pts = [self.resolve(x, y) for x, y in line]
            for p in pts:
                hit = self.nodes.get(p)
                if hit:
                    nodes.update(hit)
            for a, b in itertools.pairwise(pts):
                hit = self.segments.get(seg_key(a, b))
                if hit:
                    ways.update(hit)
        return sorted(nodes), sorted(ways)


def geometry_lines(geom: Any) -> list[list[Coord]]:
    """Coordonnées d'une géométrie shapely (LineString ou MultiLineString) ; vide ou absente : []."""
    if geom is None or getattr(geom, "is_empty", True):
        return []
    parts = getattr(geom, "geoms", None)
    if parts is None:
        return [list(geom.coords)]
    return [list(g.coords) for g in parts]


def join_ids(ids: Sequence[int]) -> str | None:
    """Identifiants séparés par « ; » ; aucun : None (colonne vide, pas « 0 »)."""
    return ";".join(str(i) for i in ids) if ids else None
