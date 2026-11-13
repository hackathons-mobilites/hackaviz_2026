"""Plus court chemin piéton sur le réseau OSM (data/osm/pieton.npz, produit par 20_reseau_pieton.py).

chemin(a, b) -> liste de [lon, lat] simplifiée (Douglas-Peucker, 6 m), ou None si le réseau est absent ou trop loin.
A* sur un graphe non orienté ; les extrémités sont rattachées au nœud le plus proche (moins de 250 m).
"""
import heapq
import math
import os

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
NPZ = os.path.normpath(os.path.join(ICI, "..", "data", "osm", "pieton.npz"))
_G = None


def _charger():
    global _G
    if _G is not None:
        return _G
    if not os.path.exists(NPZ):
        _G = False
        return _G
    from scipy.sparse import csr_matrix
    from scipy.spatial import cKDTree
    z = np.load(NPZ)
    lon, lat, a, b, d = z["lon"], z["lat"], z["a"], z["b"], z["d"]
    n = len(lon)
    M = csr_matrix((np.concatenate([d, d]), (np.concatenate([a, b]), np.concatenate([b, a]))), shape=(n, n))
    x, y = lon * 73300.0, lat * 111320.0
    _G = {"lon": lon, "lat": lat, "x": x, "y": y, "ip": M.indptr, "ix": M.indices, "w": M.data, "kd": cKDTree(np.c_[x, y])}
    return _G


def _rdp(P, tol):
    if len(P) < 3:
        return P
    A, B = np.array(P[0]), np.array(P[-1])
    Q = np.array(P)
    AB = B - A
    L = np.hypot(*AB) or 1e-9
    dist = np.abs(AB[0] * (Q[:, 1] - A[1]) - AB[1] * (Q[:, 0] - A[0])) / L
    i = int(np.argmax(dist))
    if dist[i] <= tol:
        return [P[0], P[-1]]
    return _rdp(P[:i + 1], tol)[:-1] + _rdp(P[i:], tol)


def chemin(a, b, tol=6.0):
    G = _charger()
    if not G:
        return None
    pa = (a[0] * 73300.0, a[1] * 111320.0)
    pb = (b[0] * 73300.0, b[1] * 111320.0)
    da, s = G["kd"].query(pa)
    db, t = G["kd"].query(pb)
    if da > 250 or db > 250:
        return None
    s, t = int(s), int(t)
    if s == t:
        return None
    x, y, ip, ix, w = G["x"], G["y"], G["ip"], G["ix"], G["w"]
    beeline = math.hypot(x[s] - x[t], y[s] - y[t])
    lim = beeline * 3 + 800
    xt, yt = x[t], y[t]
    g = {s: 0.0}
    prev = {}
    h = [(beeline, s)]
    done = set()
    while h:
        f, u = heapq.heappop(h)
        if u in done:
            continue
        if u == t:
            break
        done.add(u)
        gu = g[u]
        if gu > lim:
            return None
        for k in range(ip[u], ip[u + 1]):
            v = ix[k]
            nv = gu + w[k]
            if nv < g.get(v, 1e18):
                g[v] = nv
                prev[v] = u
                heapq.heappush(h, (nv + math.hypot(x[v] - xt, y[v] - yt), v))
    if t not in prev:
        return None
    path = [t]
    while path[-1] != s:
        path.append(prev[path[-1]])
    path.reverse()
    P = [(x[i], y[i]) for i in path]
    P = [(a[0] * 73300.0, a[1] * 111320.0)] + P + [(b[0] * 73300.0, b[1] * 111320.0)]
    P = _rdp(P, tol)
    return [[round(p[0] / 73300.0, 5), round(p[1] / 111320.0, 5)] for p in P]
