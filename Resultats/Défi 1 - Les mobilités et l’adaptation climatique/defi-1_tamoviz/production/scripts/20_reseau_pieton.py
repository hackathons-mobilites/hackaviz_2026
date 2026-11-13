"""Réseau piéton d'Île-de-France tiré d'OpenStreetMap, pour tracer les marches des personnes simulées le long des rues.

Entrée  : data/osm/ile-de-france-latest.osm.pbf (Geofabrik, ODbL), téléchargé une fois.
Sortie  : data/osm/pieton.npz (nœuds : lon, lat ; arêtes : départ, arrivée, longueur en mètres).
Utilisé par scripts/18_profils_matsim.py : chaque marche MATSim (téléportée en ligne droite, durée = distance × 1,3 / 1 m/s)
garde sa durée simulée, mais sa forme suit le plus court chemin piéton entre ses deux extrémités.
Aucune API : tout est calculé sur le poste.
"""
import os

import numpy as np
import osmium

ICI = os.path.dirname(os.path.abspath(__file__))
RAC = os.path.normpath(os.path.join(ICI, ".."))
PBF = os.path.join(RAC, "data", "osm", "ile-de-france-latest.osm.pbf")
OUT = os.path.join(RAC, "data", "osm", "pieton.npz")

PIETON = {"footway", "path", "pedestrian", "living_street", "residential", "service", "unclassified", "tertiary", "tertiary_link",
          "secondary", "secondary_link", "primary", "primary_link", "steps", "track", "cycleway", "corridor", "platform", "road"}


class Lecteur(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ids, self.lon, self.lat = {}, [], []
        self.a, self.b = [], []

    def nid(self, n):
        k = self.ids.get(n.ref)
        if k is None:
            k = self.ids[n.ref] = len(self.lon)
            self.lon.append(n.lon)
            self.lat.append(n.lat)
        return k

    def way(self, w):
        t = w.tags
        hw = t.get("highway")
        if hw not in PIETON:
            return
        if t.get("foot") in ("no", "private") or t.get("access") in ("no", "private") and t.get("foot") not in ("yes", "designated"):
            return
        prev = None
        for n in w.nodes:
            if not n.location.valid():
                prev = None
                continue
            k = self.nid(n)
            if prev is not None and prev != k:
                self.a.append(prev)
                self.b.append(k)
            prev = k


def main():
    L = Lecteur()
    L.apply_file(PBF, locations=True)
    lon, lat = np.array(L.lon), np.array(L.lat)
    a, b = np.array(L.a, dtype=np.int32), np.array(L.b, dtype=np.int32)
    d = np.hypot((lon[a] - lon[b]) * 73300, (lat[a] - lat[b]) * 111320).astype(np.float32)
    np.savez_compressed(OUT, lon=lon.astype(np.float64), lat=lat.astype(np.float64), a=a, b=b, d=d)
    print("réseau piéton :", len(lon), "nœuds,", len(a), "tronçons ->", OUT)


if __name__ == "__main__":
    main()
