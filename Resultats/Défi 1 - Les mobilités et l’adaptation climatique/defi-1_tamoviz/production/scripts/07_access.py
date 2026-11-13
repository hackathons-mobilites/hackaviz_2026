"""Accessibilité sous canicule : temps ressenti, déserts de fraîcheur, flux domicile-travail et domicile-études,
emplois accessibles, dose de chaleur, fenêtres horaires, validation par les validations observées.

Modèle de temps ressenti (temps généralisé, en minutes « à bord » équivalentes) :
  normal    : à bord × 1 + attente × 2 + marche × 2 + 3 min par montée
  canicule  : à bord × (1 + h·G[clim]) + attente × 2 × (1 + 0,06·h·aléa) + marche × 2 × (1 + 0,05·h·aléa) + 3 min par montée
  h = intensité de la chaleur (0 = journée ordinaire, 1 = 39 °C l'après-midi du 25 juin 2026), G = 0 / 0,15 / 0,30
  dose de chaleur = Σ minutes dehors (attente + marche) × aléa / 10 × h
Sortie : web/data/access.js, data/processed/od.npz"""
import json, time, math
import numpy as np, pandas as pd, geopandas as gpd, duckdb, pyogrio
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

RAW, OUT, WEB, L93 = "data/raw/", "data/processed/", "web/", 2154
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
G = np.array([0.0, 0.15, 0.30])

g = np.load(OUT + "graph.npz", allow_pickle=True)
E = g["E"]; NZ = int(g["NZ"]); NN0 = int(g["NN"])
src, dst, typ = E[:, 0].astype(np.int64), E[:, 1].astype(np.int64), E[:, 2].astype(int)
ivt, wait, walk, aj, cl = E[:, 3], E[:, 4], E[:, 5], np.clip(E[:, 6], 0, 17), E[:, 7].astype(int)
board = (typ == 1).astype(float)
def edge_cost(h, ivt=ivt, wait=wait, walk=walk, aj=aj, cl=cl, board=board):
    return ivt * (1 + h * G[cl]) + 2 * wait * (1 + 0.06 * h * aj) + 2 * walk * (1 + 0.05 * h * aj) + 3 * board

stops = pd.read_parquet(OUT + "stops.parquet")
gz = gpd.GeoDataFrame(stops[["id_zone_arret", "aj", "co"]], geometry=gpd.points_from_xy(stops.lon, stops.lat), crs=4326).to_crs(L93)
ZX, ZY = gz.geometry.x.values, gz.geometry.y.values
AJZ = stops.aj.fillna(stops.aj.median()).clip(0, 17).values

def access_edges(px, py, maxd=800, k_min=3):
    """arcs de marche d'un point vers les zones à moins de maxd (au moins k_min zones)"""
    d = np.hypot(ZX - px, ZY - py); idx = np.where(d <= maxd)[0]
    if len(idx) < k_min: idx = np.argsort(d)[:k_min]
    return idx, d[idx] * 1.25 / 75.0

# ---------- Carreaux : population, âges, accès ----------
fi = gpd.read_parquet(OUT + "filo.parquet")
ages = pyogrio.read_dataframe(RAW + "filosofi.geojson", columns=["id_inspire", "ind_65_79", "ind_80p"], read_geometry=False)
fi = fi.merge(ages, on="id_inspire", how="left")
fi["a65"] = fi.ind_65_79.fillna(0) + fi.ind_80p.fillna(0)
fc = fi.to_crs(L93).geometry.centroid
FX, FY = fc.x.values, fc.y.values
log("carreaux", len(fi), "· habitants", int(fi.ind.sum()), "· 65 ans et plus", int(fi.a65.sum()))

# ---------- 1. Déserts de fraîcheur ----------
frais = gpd.read_parquet(OUT + "frais.parquet")
# marche directe carreau → lieu frais le plus proche
nn = gpd.sjoin_nearest(gpd.GeoDataFrame(geometry=fc, crs=L93), frais[["geometry"]], how="left", max_distance=5000, distance_col="d")
nn = nn[~nn.index.duplicated()]
d_direct = nn["d"].reindex(range(len(fi))).fillna(5000).values
# graphe inversé + puits « lieu frais » relié aux zones à ≤ 800 m d'un lieu frais
dfz = stops.df.fillna(5000).values
near = np.where(dfz <= 800)[0]
SINK = NN0
def desert(h):
    c = edge_cost(h)
    ws = dfz[near] * 1.25 / 75.0; cs = 2 * ws * (1 + 0.05 * h * AJZ[near])
    rs = np.concatenate([dst, [SINK] * 0]);
    Mt = csr_matrix((np.concatenate([c, cs]) + 1e-6, (np.concatenate([dst, np.full(len(near), SINK)]), np.concatenate([src, near]))), shape=(NN0 + 1, NN0 + 1))
    to_ref = dijkstra(Mt, indices=SINK)[:NZ]            # coût ressenti zone → lieu frais
    # carreau : min(marche directe, marche vers une zone + réseau)
    best = 2 * (d_direct * 1.25 / 75.0) * (1 + 0.05 * h * 8)  # aléa moyen pour la marche directe
    for k in range(len(fi)):
        idx, wk = access_edges(FX[k], FY[k], 800, 1)
        v = (2 * wk * (1 + 0.05 * h * AJZ[idx]) + to_ref[idx]).min()
        if v < best[k]: best[k] = v
    return best
tN, tC = desert(0.0), desert(1.0)
fi["tN"], fi["tC"] = tN, tC
def share(mask, w): return float(w[mask].sum() / w.sum() * 100)
pop, a65 = fi.ind.fillna(0).values, fi.a65.values
fi["q"] = pd.qcut(fi.nv.rank(method="first"), 5, labels=False)
des = dict(
    pop15N=float(pop[tN > 15].sum()), pop15C=float(pop[tC > 15].sum()),
    a6515N=float(a65[tN > 15].sum()), a6515C=float(a65[tC > 15].sum()),
    share15N=share(tN > 15, pop), share15C=share(tC > 15, pop),
    by_q=[dict(q=int(q), popC=float(pop[(fi.q == q) & (tC > 15)].sum()), share=share((fi.q == q).values & (tC > 15), np.where(fi.q == q, pop, 0)) if pop[fi.q == q].sum() else 0,
               medN=float(np.median(tN[fi.q == q])), medC=float(np.median(tC[fi.q == q]))) for q in range(5)])
# courbe de concentration : part cumulée de la population (triée par niveau de vie) vs part cumulée des minutes ressenties perdues
o = np.argsort(fi.nv.fillna(fi.nv.median()).values); loss = np.maximum(tC - tN, 0) * pop
cumP = np.cumsum(pop[o]) / pop.sum(); cumL = np.cumsum(loss[o]) / max(loss.sum(), 1)
step = max(1, len(o) // 100)
des["lorenz"] = [[round(float(cumP[i]), 3), round(float(cumL[i]), 3)] for i in range(0, len(o), step)] + [[1.0, 1.0]]
des["conc"] = round(float(1 - 2 * np.trapezoid(cumL, cumP)), 3)   # > 0 : la perte pèse plus sur les ménages modestes
log("déserts de fraîcheur : >15 min ressenties", round(des["share15N"], 1), "% →", round(des["share15C"], 1), "% · 65+ :", int(des["a6515N"]), "→", int(des["a6515C"]))

# ---------- 2. Matrice commune × commune ----------
com = gpd.read_file(RAW + "communes.geojson").to_crs(L93)[["code", "nom", "geometry"]]
codes = com.code.tolist(); cix = {c: i for i, c in enumerate(codes)}; NC = len(codes)
# point représentatif : centre de gravité de la population (carreaux), sinon centroïde
fi["co"] = fi["co"].astype(str)
cw = fi.assign(x=FX, y=FY, w=pop).groupby("co").apply(lambda d: pd.Series({"x": np.average(d.x, weights=d.w + 1e-9), "y": np.average(d.y, weights=d.w + 1e-9)}), include_groups=False)
cen = com.geometry.centroid
PX = np.array([cw.x.get(c, cen.iloc[i].x) for i, c in enumerate(codes)]); PY = np.array([cw.y.get(c, cen.iloc[i].y) for i, c in enumerate(codes)])
O0, D0 = NN0, NN0 + NC                     # nœuds virtuels origine et destination
ea_s, ea_d, ea_w, ea_aj = [], [], [], []
for i in range(NC):
    idx, wk = access_edges(PX[i], PY[i], 800, 3)
    for z, w in zip(idx, wk):
        ea_s += [O0 + i, z]; ea_d += [z, D0 + i]; ea_w += [w, w]; ea_aj += [AJZ[z], AJZ[z]]
ea_s, ea_d, ea_w, ea_aj = map(np.array, (ea_s, ea_d, ea_w, ea_aj))
S2, D2 = np.concatenate([src, ea_s]), np.concatenate([dst, ea_d])
IVT = np.concatenate([ivt, 0 * ea_w]); WAIT = np.concatenate([wait, 0 * ea_w]); WALK = np.concatenate([walk, ea_w])
AJ2 = np.concatenate([aj, ea_aj]); CL2 = np.concatenate([cl, 0 * ea_s]); BO2 = np.concatenate([board, 0 * ea_w])
NN2 = NN0 + 2 * NC
def M(h): return csr_matrix((edge_cost(h, IVT, WAIT, WALK, AJ2, CL2, BO2) + 1e-6, (S2, D2)), shape=(NN2, NN2))
# composantes à accumuler le long des chemins (pour recalculer le coût à toute heure et la dose)
COMP = np.stack([IVT, IVT * G[CL2], WAIT, WAIT * AJ2, WALK, WALK * AJ2, BO2], axis=1)   # 7 composantes
ekey = S2 * NN2 + D2; order = np.argsort(ekey); ekey_s = ekey[order]
def edge_of(p, n):
    k = p.astype(np.int64) * NN2 + n; pos = np.searchsorted(ekey_s, k); return order[np.clip(pos, 0, len(order) - 1)]
MN, MC = M(0.0), M(1.0)
TN = np.zeros((NC, NC), np.float32); TC = np.zeros((NC, NC), np.float32); CP = np.zeros((NC, NC, 7), np.float32)
dest_nodes = D0 + np.arange(NC)
for b in range(0, NC, 48):
    orig = O0 + np.arange(b, min(NC, b + 48))
    TN[b:b + len(orig)] = dijkstra(MN, indices=orig, min_only=False)[:, dest_nodes]
    dC, pred = dijkstra(MC, indices=orig, return_predecessors=True)
    TC[b:b + len(orig)] = dC[:, dest_nodes]
    for r in range(len(orig)):
        dist, pr = dC[r], pred[r]
        acc = np.zeros((NN2, 7), np.float32)
        nodes = np.where((pr >= 0) & np.isfinite(dist))[0]
        nodes = nodes[np.argsort(dist[nodes])]
        e = edge_of(pr[nodes], nodes)
        for n, p, ee in zip(nodes, pr[nodes], e):   # ordre croissant des distances : le prédécesseur est déjà calculé
            acc[n] = acc[p] + COMP[ee]
        CP[b + r] = acc[dest_nodes]
    log("matrice", min(NC, b + 48), "/", NC)
TN[~np.isfinite(TN)] = 999; TC[~np.isfinite(TC)] = 999
np.savez_compressed(OUT + "od.npz", TN=TN, TC=TC, CP=CP, codes=np.array(codes))
def cost_h(cp, h): return cp[..., 0] + h * cp[..., 1] + 2 * (cp[..., 2] + cp[..., 4]) + 2 * h * (0.06 * cp[..., 3] + 0.05 * cp[..., 5]) + 3 * cp[..., 6]
def dose_h(cp, h): return h * (cp[..., 3] + cp[..., 5]) / 10.0
REAL = CP[..., 0] + CP[..., 2] + CP[..., 4]

# ---------- 3. Flux domicile-travail (MOBPRO 2021) ----------
con = duckdb.connect()
IDF = "('75','77','78','91','92','93','94','95')"
mp = con.sql(f"""select case when COMMUNE='75056' then ARM else COMMUNE end o, DCLT d, TRANS t, CS1 cs, sum(IPONDI) w
                 from '{RAW}RP2021_mobpro.parquet' where substr(COMMUNE,1,2) in {IDF} and substr(DCLT,1,2) in {IDF} group by 1,2,3,4""").df()
mp["oi"] = mp.o.map(cix); mp["di"] = mp.d.map(cix); mp = mp.dropna(subset=["oi", "di"]); mp[["oi", "di"]] = mp[["oi", "di"]].astype(int)
jobs = mp.groupby("di").w.sum().reindex(range(NC)).fillna(0).values
tc = mp[mp.t == "6"].copy()
tc["tn"] = TN[tc.oi, tc.di]; tc["tcn"] = TC[tc.oi, tc.di]; tc["real"] = REAL[tc.oi, tc.di]
tc["dose"] = dose_h(CP[tc.oi, tc.di], 1.0); tc["out"] = CP[tc.oi, tc.di][:, 2] + CP[tc.oi, tc.di][:, 4]
tc = tc[(tc.tn < 300) & (tc.oi != tc.di) | (tc.oi == tc.di)]
CSN = {"3": "cadres", "4": "professions intermédiaires", "5": "employés", "6": "ouvriers", "2": "artisans, commerçants", "1": "agriculteurs"}
def wavg(d, c): return float(np.average(d[c], weights=d.w)) if d.w.sum() else None
by_cs = [dict(cs=CSN.get(k, k), w=float(d.w.sum()), tn=wavg(d, "tn"), tc=wavg(d, "tcn"), dose=wavg(d, "dose"), out=wavg(d, "out")) for k, d in tc[tc.oi != tc.di].groupby("cs") if k in CSN]
res = tc[tc.oi != tc.di].groupby("oi").apply(lambda d: pd.Series({"w": d.w.sum(), "tn": np.average(d.tn, weights=d.w), "tc": np.average(d.tcn, weights=d.w),
                                                          "dose": np.average(d.dose, weights=d.w), "ess": d[d.cs.isin(["5", "6"])].w.sum()}), include_groups=False)
# fenêtre horaire : coût ressenti moyen des navetteurs TC selon l'heure (température du 25 juin, station 75)
import gzip, csv
temp = {}
with gzip.open(RAW + "H_75_latest-2025-2026.csv.gz", "rt", encoding="utf-8") as f:
    r = csv.reader(f, delimiter=";"); h0 = next(r); I = {k: h0.index(k) for k in ["NUM_POSTE", "AAAAMMJJHH", "T"]}
    for x in r:
        if x[I["NUM_POSTE"]] == "75114001" and x[I["AAAAMMJJHH"]].startswith("20260625") and x[I["T"]]:
            temp[int(x[I["AAAAMMJJHH"]][8:])] = float(x[I["T"]])
hours = list(range(5, 24))
HF = {hh: float(np.clip((temp.get(hh - 2, 25) - 25) / 14, 0, 1)) for hh in hours}   # heure locale ≈ UTC + 2
cpw = CP[tc.oi.values, tc.di.values]; ww = tc.w.values
win = [dict(h=hh, T=temp.get(hh - 2), hf=round(HF[hh], 2), cost=float(np.average(cost_h(cpw, HF[hh]), weights=ww)), dose=float(np.average(dose_h(cpw, HF[hh]), weights=ww))) for hh in hours]
win_ess = [float(np.average(cost_h(cpw[tc.cs.isin(['5', '6']).values], HF[hh]), weights=ww[tc.cs.isin(['5', '6']).values])) for hh in hours]
win_cad = [float(np.average(cost_h(cpw[(tc.cs == '3').values], HF[hh]), weights=ww[(tc.cs == '3').values])) for hh in hours]
for k, v in enumerate(win): v["ess"] = win_ess[k]; v["cad"] = win_cad[k]
# flux principaux (pour la carte de flux)
top = tc[tc.oi != tc.di].groupby(["oi", "di"]).agg(w=("w", "sum"), tn=("tn", "first"), tc=("tcn", "first"), dose=("dose", "first")).reset_index().sort_values("w", ascending=False).head(600)
log("navetteurs TC (hors même commune)", int(tc[tc.oi != tc.di].w.sum()))

# ---------- 4. Emplois accessibles en 45 minutes ressenties ----------
accN = (TN <= 45) @ jobs; accC = (TC <= 45) @ jobs
# ---------- 5. Flux domicile-études (MOBSCO 2021) ----------
ms = con.sql(f"""select case when COMMUNE='75056' then ARM else COMMUNE end o, DCETUF d, AGEREV10 a, sum(IPONDI) w
                 from '{RAW}RP2021_mobsco.parquet' where substr(COMMUNE,1,2) in {IDF} and substr(DCETUF,1,2) in {IDF} group by 1,2,3""").df()
ms["oi"] = ms.o.map(cix); ms["di"] = ms.d.map(cix); ms = ms.dropna(subset=["oi", "di"]); ms[["oi", "di"]] = ms[["oi", "di"]].astype(int)
ms = ms[ms.oi != ms.di]
ms["grp"] = np.where(ms.a.astype(int) <= 11, "élèves (moins de 15 ans)", np.where(ms.a.astype(int) <= 15, "lycéens (15-17 ans)", "étudiants (18 ans et plus)"))
ms["tcn"] = TC[ms.oi, ms.di]; ms["tn"] = TN[ms.oi, ms.di]; ms["dose"] = dose_h(CP[ms.oi, ms.di], 1.0)
ms = ms[ms.tn < 300]
by_sco = [dict(grp=k, w=float(d.w.sum()), tn=wavg(d, "tn"), tc=wavg(d, "tcn"), dose=wavg(d, "dose")) for k, d in ms.groupby("grp")]
sres = ms.groupby("oi").apply(lambda d: pd.Series({"w": d.w.sum(), "dose": np.average(d.dose, weights=d.w)}), include_groups=False)
log("élèves et étudiants hors commune", int(ms.w.sum()))

# ---------- 6. Validation : hausse du temps ressenti vs baisse observée des validations ----------
v2 = json.load(open(OUT + "volet2.json", encoding="utf-8")); days = v2["days"]
red = [k for k, d in enumerate(days) if "2026-06-22" <= d <= "2026-06-26"]
sg = gpd.GeoDataFrame(v2["stations"], geometry=gpd.points_from_xy([s["lon"] for s in v2["stations"]], [s["lat"] for s in v2["stations"]]), crs=4326).to_crs(L93)
jj = gpd.sjoin(sg[["geometry"]], com, how="left", predicate="within"); jj = jj[~jj.index.duplicated()]
obs = {}
for s, c in zip(v2["stations"], jj["code"]):
    vals = [s["i"][k] for k in red if s["i"][k] is not None]
    if not vals or not isinstance(c, str): continue
    o_ = obs.setdefault(c, [0.0, 0.0]); o_[0] += s["med"] * np.mean(vals); o_[1] += s["med"]
pts = []
for c, (num, den) in obs.items():
    i = cix.get(c)
    if i is None or i not in res.index or res.loc[i, "w"] < 300: continue
    pts.append(dict(c=c, n=com.nom.iloc[i], x=float(res.loc[i, "tc"] / res.loc[i, "tn"] * 100 - 100), y=float(num / den - 100), w=float(res.loc[i, "w"])))
X = np.array([p["x"] for p in pts]); Y = np.array([p["y"] for p in pts]); Wt = np.array([p["w"] for p in pts])
def wcorr(x, y, w):
    mx, my = np.average(x, weights=w), np.average(y, weights=w)
    return float(np.sum(w * (x - mx) * (y - my)) / math.sqrt(np.sum(w * (x - mx) ** 2) * np.sum(w * (y - my) ** 2)))
slope = float(np.polyfit(X, Y, 1, w=np.sqrt(Wt))[0]) if len(X) > 3 else None
val = dict(points=pts, r=wcorr(X, Y, Wt) if len(X) > 3 else None, slope=slope, n=len(pts))
log("validation : r =", round(val["r"], 2) if val["r"] is not None else None, "sur", len(pts), "communes")

# ---------- Export ----------
r1 = lambda v: None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(float(v), 1)
comm = []
for i, c in enumerate(codes):
    rr = res.loc[i] if i in res.index else None; ss = sres.loc[i] if i in sres.index else None
    comm.append(dict(c=c, n=com.nom.iloc[i].replace(" Arrondissement", ""), x=round(float(PX[i]), 0), y=round(float(PY[i]), 0), jobs=round(float(jobs[i])),
                     accN=round(float(accN[i])), accC=round(float(accC[i])),
                     w=r1(rr.w) if rr is not None else 0, tn=r1(rr.tn) if rr is not None else None, tc=r1(rr.tc) if rr is not None else None,
                     dose=r1(rr.dose) if rr is not None else None, ess=r1(rr.ess) if rr is not None else 0,
                     sw=r1(ss.w) if ss is not None else 0, sdose=r1(ss.dose) if ss is not None else None))
q16 = lambda A: [[int(min(999, round(float(v)))) for v in row] for row in A]
out = dict(model=dict(G=G.tolist(), walk=0.05, wait=0.06, board=3, wwalk=2, wwait=2),
           desert=des, communes=comm, by_cs=by_cs, by_sco=by_sco, window=win, validation=val,
           top=[dict(o=int(r.oi), d=int(r.di), w=round(float(r.w)), tn=r1(r.tn), tc=r1(r.tc), dose=r1(r.dose)) for r in top.itertuples()],
           TN=q16(TN), TC=q16(TC),
           totals=dict(tc_commuters=float(tc[tc.oi != tc.di].w.sum()), ess=float(tc[(tc.oi != tc.di) & tc.cs.isin(["5", "6"])].w.sum()),
                       jobsN=float(np.average(accN, weights=res.w.reindex(range(NC)).fillna(0) + 1e-9)), jobsC=float(np.average(accC, weights=res.w.reindex(range(NC)).fillna(0) + 1e-9)),
                       students=float(ms.w.sum())))
s = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
od = dict(TN=out.pop("TN"), TC=out.pop("TC"))     # matrice chargée à la demande (chronocarte)
s = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
open(WEB + "data/access.js", "w", encoding="utf-8").write("window.ACC=" + s + ";")
open(WEB + "data/od.js", "w", encoding="utf-8").write("window.OD=" + json.dumps(od, separators=(",", ":")) + ";")
# temps vers le frais par carreau (pour la carte, même ordre que carreaux.js)
open(WEB + "data/desert.js", "w", encoding="utf-8").write("window.DES=" + json.dumps(dict(tN=[round(float(x)) for x in tN], tC=[round(float(x)) for x in tC], a65=[int(x) for x in a65], nd=[int(x) for x in fi.nd.fillna(9999)]), separators=(",", ":")) + ";")
log("écrit access.js", round(len(s) / 1e6, 1), "Mo")
