"""Cartogrammes continus régionaux (diffusion, Gastner et Newman 2004) pour les communes et les IRIS.
Entrée : web/data/core.js, flow.js, carreaux.js, layers.js · Sortie : web/data/carto_com.js, carto_iris.js"""
import json, math, sys, time
import numpy as np, shapely
from scipy.ndimage import map_coordinates

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
def jsload(f, var): return json.loads(open(f, encoding="utf-8").read()[len(f"window.{var}="):-1])
CORE = jsload("web/data/core.js", "IDF")["cols"]; FLOW = jsload("web/data/flow.js", "FLOW"); CARS = jsload("web/data/carreaux.js", "CARS")
LAY = jsload("web/data/layers.js", "LAYERS"); V2 = jsload("web/data/volet2.js", "V2")
DAYS = V2["days"]
LON0, LAT0, KX, KY = 2.35, 48.75, 73300.0, 111320.0
P = lambda lon, lat: ((lon - LON0) * KX, (lat - LAT0) * KY)
N = len(CORE["id"])

def score(k):
    c = CORE; aj, nc, pp, df, nvp, acc = c["aj"][k], c["nc"][k], c["pp"][k], c["df"][k], c["nvp"][k], c["acc"][k]
    return sum([aj is not None and aj >= 10, nc is not None and nc * 100 >= 50, pp is not None and pp <= 20,
                df is None or df > 300, nvp is not None and nvp <= 20, acc == "false"])
SC = [score(k) for k in range(N)]

def run(kind, feats, code_key, stop_key, car_key, LX, LY, days_pick, floor=0.05, passes=3, fixed=False):
    codes = [f["properties"][code_key] for f in feats]
    vid, verts = {}, []
    def V(lon, lat):
        k = (round(lon, 5), round(lat, 5))
        if k not in vid: vid[k] = len(verts); verts.append(P(*k))
        return vid[k]
    rings = []
    for f in feats:
        g = f["geometry"]; parts = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        rings.append([[[V(*c) for c in r[:-1]] for r in p] for p in parts])
    st_pts = [P(CORE["lon"][k], CORE["lat"][k]) for k in range(N)]
    ALL = np.array(verts + st_pts, float); NV = len(verts)
    log(kind, len(feats), "unités,", NV, "sommets")
    xs, ys = ALL[:NV, 0], ALL[:NV, 1]
    pad = 0.25 * max(xs.max() - xs.min(), ys.max() - ys.min())
    X0, Y0 = xs.min() - pad, ys.min() - pad
    H = max((xs.max() - xs.min() + 2 * pad) / LX, (ys.max() - ys.min() + 2 * pad) / LY)
    gx = X0 + (np.arange(LX) + .5) * H; gy = Y0 + (np.arange(LY) + .5) * H
    GX, GY = np.meshgrid(gx, gy); GP = shapely.points(GX.ravel(), GY.ravel())
    FX, FY = np.meshgrid(np.fft.rfftfreq(LX), np.fft.fftfreq(LY)); K2 = 4 * math.pi ** 2 * (FX ** 2 + FY ** 2)   # FFT réelle
    def polys(pos):
        return [shapely.MultiPolygon([shapely.Polygon(pos[p[0]], [pos[h] for h in p[1:]]) for p in rr]).buffer(0) for rr in rings]
    def flow(pos, w):
        t0 = time.time()
        pg = polys(pos); A = np.array([g.area for g in pg])
        tree = shapely.STRtree(pg); pi, gi = tree.query(GP, predicate="within")
        owner = np.full(GX.size, -1); owner[pi] = gi; owner = owner.reshape(GX.shape)
        rho0 = np.full(GX.shape, w.sum() / A.sum()); m = owner >= 0; rho0[m] = (w / np.maximum(A, 1))[owner[m]]
        R0 = np.fft.rfft2(rho0); pts = (pos - [X0, Y0]) / H - .5; nstep = 0
        t, T, dt = 0.0, (max(LX, LY) ** 2) / 8.0, 0.05
        while t < T and nstep < 700:
            nstep += 1
            E = R0 * np.exp(-K2 * t); rho = np.fft.irfft2(E, s=(LY, LX))
            vx = -np.fft.irfft2(E * 2j * math.pi * FX, s=(LY, LX)) / rho; vy = -np.fft.irfft2(E * 2j * math.pi * FY, s=(LY, LX)) / rho
            c = [pts[:, 1], pts[:, 0]]
            ux = map_coordinates(vx, c, order=1, mode="nearest"); uy = map_coordinates(vy, c, order=1, mode="nearest")
            step = min(dt, 0.5 / max(np.abs(ux).max(), np.abs(uy).max(), 1e-9))
            pts[:, 0] += ux * step; pts[:, 1] += uy * step; t += step; dt *= 1.15
        log(kind, "passe", nstep, "pas", round(time.time() - t0), "s")
        return (pts + .5) * H + [X0, Y0]
    def areas(pos):
        def ra(idx):
            q = pos[idx]; return 0.5 * abs(np.dot(q[:, 0], np.roll(q[:, 1], -1)) - np.dot(q[:, 1], np.roll(q[:, 0], -1)))
        return np.array([sum(ra(p[0]) - sum(ra(h) for h in p[1:]) for p in rr) for rr in rings])
    # contour fixe : on calcule le cartogramme libre, puis on ramène la frontière régionale à sa place
    # par une correction qui s'estompe vers l'intérieur (pondération inverse de la distance aux sommets de la frontière,
    # atténuation exp(-d / 6 km)) ; on alterne correction et passe de diffusion, et on termine par une correction.
    if fixed:
        outer = shapely.unary_union(polys(ALL)).boundary
        dist0 = shapely.distance(shapely.points(ALL[:, 0], ALL[:, 1]), outer)
        BND = np.where(dist0 < 1.0)[0]
        from scipy.spatial import cKDTree as _KD
        _r, _k = _KD(ALL[BND]).query(ALL, k=12)
        _w = 1 / (_r + 150.0) ** 2; _w /= _w.sum(axis=1, keepdims=True)
        BLEND = np.exp(-dist0 / 6000.0)[:, None]
    def correct(pos):
        Db = pos[BND] - ALL[BND]
        pos = pos - BLEND * np.einsum("ij,ijk->ik", _w, Db[_k])
        pos[BND] = ALL[BND]; return pos
    def carto(w, passes, cyc=2):
        w = np.maximum(np.asarray(w, float), 0); w = np.maximum(w, floor * w.mean()); pos = ALL.copy()
        for _ in range(passes): pos = flow(pos, w)
        if fixed:
            for _ in range(cyc): pos = flow(correct(pos), w)
            pos = correct(pos)
        A = areas(pos); Tg = A.sum() * w / w.sum()
        return np.round(pos - ALL).astype(int).ravel().tolist(), round(float(np.abs(A - Tg).sum() / Tg.sum()) * 100, 1)
    ix = {c: i for i, c in enumerate(codes)}
    def by(stop_vals=None, car_vals=None):
        w = np.zeros(len(codes))
        if stop_vals is not None:
            for k in range(N):
                c = CORE[stop_key][k]
                if c in ix and stop_vals[k]: w[ix[c]] += stop_vals[k]
        if car_vals is not None:
            for k, c in enumerate(CARS[car_key]):
                if c in ix and car_vals[k]: w[ix[c]] += car_vals[k]
        return w
    modes = {}
    W = {"vref": by(stop_vals=FLOW["vref"]), "pop": by(car_vals=[x or 0 for x in CARS["ind"]]),
         "expo": by(car_vals=[(CARS["ind"][k] or 0) if SC[CARS["ns"][k]] >= 3 else 0 for k in range(len(CARS["ind"]))])}
    for k, w in W.items():
        modes[k] = carto(w, passes); log(kind, k, modes[k][1])
        # échelle logarithmique : surface proportionnelle à log(1 + poids), les fortes valeurs gonflent beaucoup moins
        modes[k + "_log"] = carto(np.log1p(w), passes, cyc=6); log(kind, k + "_log", modes[k + "_log"][1])
    days = {}
    for d in days_pick:
        i = DAYS.index(d)
        vals = [(FLOW["vref"][k] * (FLOW["i"][k][i] or 0) / 100) if FLOW["i"][k] else 0 for k in range(N)]
        days[d] = carto(by(stop_vals=vals), max(2, passes - 1)); log(kind, d, days[d][1])
    out = dict(codes=codes, nv=NV, nc=0, ns=N, base=np.round(ALL).astype(int).ravel().tolist(), lon0=LON0, lat0=LAT0,
               iris=rings, com=[], modes={k: dict(d=v[0], err=v[1]) for k, v in modes.items()}, days={d: dict(d=v[0], err=v[1]) for d, v in days.items()})
    out["floor"] = floor; out["fixed"] = fixed
    suf = "_fixe" if fixed else ""
    s = json.dumps(out, separators=(",", ":"))
    open(f"web/data/carto_{kind}{suf}.js", "w", encoding="utf-8").write(f"window.CARTO_{kind.upper()}{suf.upper()}=" + s + ";")
    log(kind, "écrit", round(len(s) / 1e6, 1), "Mo")

PICK = ["2026-06-16", "2026-06-19", "2026-06-22", "2026-06-25", "2026-06-28"]
FIX = "--fixe" in sys.argv
FIXCYC = 6
which = [a for a in sys.argv[1:] if not a.startswith("--")] or ["com", "iris"]
if "com" in which:
    run("com", LAY["communes"]["features"], "code", "co", "co", 640, 512, [] if FIX else PICK, fixed=FIX)
if "iris" in which:
    run("iris", LAY["iris"]["features"], "code_iris", "ir", "ir", 896, 768, [], floor=0.25, passes=5, fixed=FIX)
