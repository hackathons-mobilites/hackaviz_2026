"""Affectation des navetteurs TC (MOBPRO 2021) sur le réseau, micro-simulation calée sur les validations observées,
simulateur « et si… », refuges selon l'heure, échantillon d'agents pour l'animation.
Sortie : web/data/sim.js, web/data/agents.js"""
import json, time, math, gzip, csv
import numpy as np, pandas as pd, geopandas as gpd, duckdb
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.optimize import minimize

RAW, OUT, WEB, L93 = "data/raw/", "data/processed/", "web/", 2154
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
G = np.array([0.0, 0.15, 0.30])
rng = np.random.default_rng(7)

g = np.load(OUT + "graph.npz", allow_pickle=True)
E = g["E"]; NZ = int(g["NZ"]); NN0 = int(g["NN"])
src, dst, typ = E[:, 0].astype(np.int64), E[:, 1].astype(np.int64), E[:, 2].astype(int)
ivt, wait, walk, aj, cl, rte = E[:, 3], E[:, 4], E[:, 5], np.clip(E[:, 6], 0, 17), E[:, 7].astype(int), E[:, 8].astype(int)
rn_z = g["rn_z"]; route_ids = g["route_ids"]; route_names = g["route_names"]; route_types = g["route_types"]
board = (typ == 1).astype(float)
def edge_cost(h, ivt, wait, walk, aj, cl, board, wmul=1.0):
    return ivt * (1 + h * G[cl]) + 2 * wait * (1 + 0.06 * h * aj) + 2 * walk * wmul * (1 + 0.05 * h * aj) + 3 * board
node_zone = np.concatenate([np.arange(NZ), rn_z])          # zone de chaque nœud (pour dessiner les chemins)

stops = pd.read_parquet(OUT + "stops.parquet")
gz = gpd.GeoDataFrame(stops[["id_zone_arret"]], geometry=gpd.points_from_xy(stops.lon, stops.lat), crs=4326).to_crs(L93)
ZX, ZY = gz.geometry.x.values, gz.geometry.y.values
AJZ = stops.aj.fillna(stops.aj.median()).clip(0, 17).values
def access_edges(px, py, maxd=800, k_min=3):
    d = np.hypot(ZX - px, ZY - py); idx = np.where(d <= maxd)[0]
    if len(idx) < k_min: idx = np.argsort(d)[:k_min]
    return idx, d[idx] * 1.25 / 75.0

# ---------- Communes : points représentatifs (identiques à 07_access) ----------
fi = gpd.read_parquet(OUT + "filo.parquet"); fc = fi.to_crs(L93).geometry.centroid; FX, FY = fc.x.values, fc.y.values
pop = fi.ind.fillna(0).values
com = gpd.read_file(RAW + "communes.geojson").to_crs(L93)[["code", "nom", "geometry"]]
codes = com.code.tolist(); cix = {c: i for i, c in enumerate(codes)}; NC = len(codes)
fi["co"] = fi["co"].astype(str)
cw = fi.assign(x=FX, y=FY, w=pop).groupby("co").apply(lambda d: pd.Series({"x": np.average(d.x, weights=d.w + 1e-9), "y": np.average(d.y, weights=d.w + 1e-9)}), include_groups=False)
cen = com.geometry.centroid
PX = np.array([cw.x.get(c, cen.iloc[i].x) for i, c in enumerate(codes)]); PY = np.array([cw.y.get(c, cen.iloc[i].y) for i, c in enumerate(codes)])
O0, D0 = NN0, NN0 + NC
ea_s, ea_d, ea_w, ea_aj = [], [], [], []
for i in range(NC):
    idx, wk = access_edges(PX[i], PY[i], 800, 3)
    for z, w in zip(idx, wk):
        ea_s += [O0 + i, z]; ea_d += [z, D0 + i]; ea_w += [w, w]; ea_aj += [AJZ[z], AJZ[z]]
ea_s, ea_d, ea_w, ea_aj = map(np.array, (ea_s, ea_d, ea_w, ea_aj))
S2, D2 = np.concatenate([src, ea_s]), np.concatenate([dst, ea_d])
IVT = np.concatenate([ivt, 0 * ea_w]); WAIT = np.concatenate([wait, 0 * ea_w]); WALK = np.concatenate([walk, ea_w])
AJ2 = np.concatenate([aj, ea_aj]); CL2 = np.concatenate([cl, 0 * ea_s]); BO2 = np.concatenate([board, 0 * ea_w])
TY2 = np.concatenate([typ, np.full(len(ea_s), 5)]); RT2 = np.concatenate([rte, np.full(len(ea_s), -1)])
NN2 = NN0 + 2 * NC
ekey = S2 * NN2 + D2; order = np.argsort(ekey); ekey_s = ekey[order]
def edge_of(p, n):
    k = np.asarray(p, np.int64) * NN2 + np.asarray(n); pos = np.searchsorted(ekey_s, k); return order[pos]
def M(h): return csr_matrix((edge_cost(h, IVT, WAIT, WALK, AJ2, CL2, BO2) + 1e-6, (S2, D2)), shape=(NN2, NN2))

# ---------- Navetteurs TC (MOBPRO) ----------
con = duckdb.connect(); IDF = "('75','77','78','91','92','93','94','95')"
mp = con.sql(f"""select case when COMMUNE='75056' then ARM else COMMUNE end o, DCLT d, CS1 cs, sum(IPONDI) w
                 from '{RAW}RP2021_mobpro.parquet' where TRANS='6' and substr(COMMUNE,1,2) in {IDF} and substr(DCLT,1,2) in {IDF} group by 1,2,3""").df()
mp["oi"] = mp.o.map(cix); mp["di"] = mp.d.map(cix); mp = mp.dropna(subset=["oi", "di"]); mp[["oi", "di"]] = mp[["oi", "di"]].astype(int)
mp = mp[mp.oi != mp.di]
od = mp.groupby(["oi", "di"]).w.sum().reset_index()
log("couples de communes avec navetteurs TC", len(od), "· navetteurs", int(od.w.sum()))

# ---------- Chemins canicule et ordinaire, décomposés ----------
MN, MC = M(0.0), M(1.0)
paths = {}       # (oi, di) -> dict(routes: [(r, ivt)], boards: [(z, wait, aj)], walk, walkaj, tn, tc, nodes)
need = od.groupby("oi").di.apply(list).to_dict()
for b in range(0, NC, 48):
    origs = [o for o in range(b, min(NC, b + 48)) if o in need]
    if not origs: continue
    dN = dijkstra(MN, indices=[O0 + o for o in origs])
    dC, pred = dijkstra(MC, indices=[O0 + o for o in origs], return_predecessors=True)
    for r, o in enumerate(origs):
        pr = pred[r]
        for d in need[o]:
            n = D0 + d
            if not np.isfinite(dC[r, n]): continue
            seq = [n]
            while pr[seq[-1]] >= 0: seq.append(pr[seq[-1]])
            seq = seq[::-1]
            e = edge_of(seq[:-1], seq[1:])
            ty = TY2[e]
            routes = {}
            for ee in e[ty == 3]: routes[int(RT2[ee])] = routes.get(int(RT2[ee]), 0.0) + float(IVT[ee])
            bo = [(int(S2[ee]), float(WAIT[ee]), float(AJ2[ee])) for ee in e[ty == 1]]
            wk = e[(ty == 4) | (ty == 5)]
            zs = [int(node_zone[x]) for x in seq[1:-1] if x < NN0]
            clock = np.concatenate([[0], np.cumsum(IVT[e] + WAIT[e] + WALK[e])])[1:-1]
            paths[(o, d)] = dict(routes=routes, boards=bo, walk=float(WALK[wk].sum()), walkaj=float((WALK[wk] * AJ2[wk]).sum()),
                                 tn=float(dN[r, n]), tc=float(dC[r, n]), zs=zs, clock=clock.round(1).tolist())
    log("chemins", min(NC, b + 48), "/", NC, "·", len(paths))

od["tn"] = [paths.get((o, d), {}).get("tn", np.nan) for o, d in zip(od.oi, od.di)]
od["tc"] = [paths.get((o, d), {}).get("tc", np.nan) for o, d in zip(od.oi, od.di)]
od = od.dropna(); od = od[od.tn < 400]
mp = mp.merge(od[["oi", "di", "tn", "tc"]], on=["oi", "di"])
NR = len(route_ids)
# matrice d'usage OD × ligne (montées) et types de ligne
odx = {(o, d): k for k, (o, d) in enumerate(zip(od.oi, od.di))}
rows, cols, vals = [], [], []
for (o, d), k in odx.items():
    for r_ in paths[(o, d)]["routes"]: rows.append(k); cols.append(r_); vals.append(1.0)
U = csr_matrix((vals, (rows, cols)), shape=(len(od), NR))
lig = {l["id_line"]: l for l in json.load(open(RAW + "lignes.json", encoding="utf-8"))}
r_clim = np.array([(lig.get(str(r).replace("IDFM:", ""), {}).get("air_conditioning") or "unknown") for r in route_ids])
r_gol = np.array([lig.get(str(r).replace("IDFM:", ""), {}).get("id_groupoflines") for r in route_ids])
is_rail = np.isin(route_types, [0, 1, 2, 7])
is_bus = route_types == 3
grp = np.where(is_rail, "rail", np.where(is_bus & (r_clim == "true"), "bc", np.where(is_bus & np.isin(r_clim, ["false", "partial"]), "bn", "autre")))

# ---------- Micro-simulation : renoncer au trajet TC sous canicule ----------
# p(maintien) = 1 / (1 + exp(a_mode + A_CADRE·[cadre] + b·ΔT/T)), mode principal du chemin (ferré ou bus) ; calage sur 3 indices observés
v2 = json.load(open(OUT + "volet2.json", encoding="utf-8")); days = v2["days"]
red = [k for k, d in enumerate(days) if "2026-06-22" <= d <= "2026-06-26"]
target = dict(rail=np.mean([v2["serie"][k]["fer_i"] for k in red]) / 100, bc=np.mean([v2["serie"][k]["bc_i"] for k in red]) / 100, bn=np.mean([v2["serie"][k]["bn_i"] for k in red]) / 100)
A_CADRE = 0.8      # les cadres télétravaillent plus facilement (hypothèse fixée, non calée)
sh_bus, sh_nc = {}, {}
is_rail_r = np.isin(route_types, [0, 1, 2, 7])
nc_r = np.array([c_ in ("false", "partial", "unknown") for c_ in r_clim]) & (route_types == 3)
for (o, d), P in paths.items():
    tot = sum(P["routes"].values()) or 1.0
    sh_bus[(o, d)] = sum(v for r_, v in P["routes"].items() if route_types[r_] == 3) / tot
    sh_nc[(o, d)] = sum(v for r_, v in P["routes"].items() if nc_r[r_]) / tot
mp["rel"] = ((mp.tc - mp.tn) / mp.tn).clip(lower=0); mp["cad"] = (mp.cs == "3").astype(float)
mp["bus"] = [sh_bus.get((o, d), 0) for o, d in zip(mp.oi, mp.di)]; mp["nc"] = [sh_nc.get((o, d), 0) for o, d in zip(mp.oi, mp.di)]
mpk = np.array([odx[(o, d)] for o, d in zip(mp.oi, mp.di)])
def pmaint(th, d=mp):
    a, b, cb, cn = th      # constante, hausse relative du temps ressenti, part du trajet en bus, part en bus non climatisé
    return 1 / (1 + np.exp(a + A_CADRE * d.cad.values + b * d.rel.values + cb * d.bus.values + cn * d.nc.values))
base_load = U.T @ od.w.values
fl0 = od.w.values
def predicted(th):
    f = np.bincount(mpk, weights=mp.w.values * pmaint(th), minlength=len(od))
    return U.T @ f
def loss(th):
    pl = predicted(th); out = 0
    for k_, tv in target.items():
        m = grp == k_; out += (pl[m].sum() / base_load[m].sum() - tv) ** 2
    return out
BND = [(-6, 6), (0, 8), (0, 4), (0, 4)]   # bornes plausibles : pas de seuil brutal, effets dans le bon sens
best = min((minimize(loss, x0, method="L-BFGS-B", bounds=BND) for x0 in ([-2, 1.0, 0.5, 0.5], [-3, 3.0, 1.0, 1.0], [-1.5, 0.5, 0.2, 1.5])), key=lambda r: r.fun)
th = best.x; pl = predicted(th)
cal = {k_: dict(obs=round(target[k_] * 100, 1), sim=round(float(pl[grp == k_].sum() / base_load[grp == k_].sum() * 100), 1)) for k_ in target}
log("calage", np.round(th, 3), cal)
# validation hors calage : indice par ligne de bus (simulé vs observé)
obs_line = {b_["gol"]: np.mean([b_["i"][k] for k in red if b_["i"][k] is not None]) for b_ in v2["buslines"] if any(b_["i"][k] is not None for k in red)}
vl = []
for r_ in range(NR):
    if not is_bus[r_] or base_load[r_] < 500 or r_gol[r_] not in obs_line: continue
    vl.append(dict(n=str(route_names[r_]), gol=str(r_gol[r_]), clim=str(r_clim[r_]), load=float(base_load[r_]), sim=float(pl[r_] / base_load[r_] * 100), obs=float(obs_line[r_gol[r_]])))
X = np.array([v["sim"] for v in vl]); Y = np.array([v["obs"] for v in vl]); Wt = np.array([v["load"] for v in vl])
def wcorr(x, y, w):
    mx, my = np.average(x, weights=w), np.average(y, weights=w)
    return float(np.sum(w * (x - mx) * (y - my)) / math.sqrt(np.sum(w * (x - mx) ** 2) * np.sum(w * (y - my) ** 2)))
r_lines = wcorr(X, Y, Wt); mae = float(np.average(np.abs(X - Y), weights=Wt))
# diagnostic : variables explicatives simples par ligne de bus
rel_r = np.zeros(NR); ajr = np.zeros(NR); wr = np.zeros(NR)
relk = (od.tc.values - od.tn.values) / od.tn.values
for (o, d), k in odx.items():
    P = paths[(o, d)]; bz = {z for z, _, _ in P["boards"]}
    for r_ in P["routes"]: rel_r[r_] += fl0[k] * relk[k]; wr[r_] += fl0[k]
rel_r = rel_r / np.maximum(wr, 1)
lines_aj = {}
for e_ in np.where(typ == 1)[0]:
    lines_aj.setdefault(int(rte[e_]), []).append(float(aj[e_]))
diag = {}
sel = [r_ for r_ in range(NR) if is_bus[r_] and base_load[r_] >= 500 and r_gol[r_] in obs_line]
yo = np.array([obs_line[r_gol[r_]] for r_ in sel]); ww = np.array([base_load[r_] for r_ in sel])
for nm, xv in [("hausse relative du temps ressenti", np.array([rel_r[r_] for r_ in sel])), ("non climatisée (0/1)", np.array([float(r_clim[r_] in ("false", "partial")) for r_ in sel])),
               ("aléa moyen aux arrêts", np.array([np.mean(lines_aj.get(r_, [0])) for r_ in sel]))]:
    diag[nm] = round(wcorr(xv, yo, ww), 3)
log("diagnostic par ligne (corrélation avec l'indice observé) :", diag)
log("validation par ligne de bus : r =", round(r_lines, 2), "· écart moyen", round(mae, 1), "points ·", len(vl), "lignes")
renonce = float((mp.w * (1 - pmaint(th))).sum())
by_cs_sim = [dict(cs=c_, w=float(d_.w.sum()), renonce=float((d_.w * (1 - pmaint(th, d_))).sum() / d_.w.sum() * 100)) for c_, d_ in mp.groupby("cs") if c_ in ("3", "4", "5", "6")]

# ---------- Simulateur A1 : climatiser une ligne ----------
fl = od.w.values
gain_r = np.zeros(NR)
for (o, d), k in odx.items():
    for r_, t_ in paths[(o, d)]["routes"].items():
        gain_r[r_] += fl[k] * t_ * G[{"true": 0, "partial": 1}.get(r_clim[r_], 2)]
clim_rank = [dict(r=int(r_), n=str(route_names[r_]), clim=str(r_clim[r_]), gain=float(gain_r[r_]), load=float(base_load[r_]), gol=str(r_gol[r_]))
             for r_ in np.argsort(-gain_r) if is_bus[r_] and r_clim[r_] != "true" and gain_r[r_] > 0][:80]
# ---------- A2 : ombrager un arrêt (la majoration chaleur de l'attente est divisée par deux) ----------
gain_z = np.zeros(NZ); dose_z = np.zeros(NZ); brd_z = np.zeros(NZ)
for (o, d), k in odx.items():
    for z, wt, a_ in paths[(o, d)]["boards"]:
        gain_z[z] += fl[k] * 2 * wt * 0.06 * a_ * 0.5; dose_z[z] += fl[k] * wt * a_ / 10 * 0.5; brd_z[z] += fl[k]
shade_rank = [dict(z=int(z), n=stops.n.iloc[z], c=stops.c.iloc[z], lon=float(stops.lon.iloc[z]), lat=float(stops.lat.iloc[z]), gain=float(gain_z[z]), dose=float(dose_z[z]), brd=float(brd_z[z]), aj=float(AJZ[z]))
              for z in np.argsort(-gain_z)[:300]]
tot_cost_C = float((od.w * od.tc).sum()); tot_cost_N = float((od.w * od.tn).sum())
tot_dose = float(sum(fl[k] * (sum(wt * a_ for _, wt, a_ in paths[(o, d)]["boards"]) + paths[(o, d)]["walkaj"]) / 10 for (o, d), k in odx.items()))
log("A1 et A2 prêts")

# ---------- Déserts de fraîcheur : refuges selon l'heure, marche lente, gares refuges ----------
frais = gpd.read_parquet(OUT + "frais.parquet")
ev = gpd.read_file(RAW + "ilots-de-fraicheur-espaces-verts-frais.geojson")[["nom", "ouvert_24h"]]
o24 = dict(zip(ev.nom, ev.ouvert_24h))
def is_open(row, hh):
    if row.src == "Paris":
        t = str(row.type)
        if t in ("Ombrière pérenne", "Ombrière temporaire", "Brumisateur", "Promenades ouvertes", "Fontaine"):
            return o24.get(row.nom, "Oui") == "Oui" or 8 <= hh < 22 if t == "Promenades ouvertes" else True
        if t in ("Bibliothèque", "Lieux de culte", "Mairie d'arrondissement", "Musée"): return 9 <= hh < 19
        if t in ("Piscine", "Baignade extérieure", "Bains-douches"): return 9 <= hh < 20
        return o24.get(row.nom, "Non") == "Oui" or 8 <= hh < 22       # espaces verts : 8 h-22 h en été, sauf ouverts 24 h
    return True if row.type in ("bois", "espace de loisirs", "parc") else 8 <= hh < 21    # OSM : jardins fermés la nuit
fcent = gpd.GeoDataFrame(geometry=fc, crs=L93)
a65 = None
import pyogrio
ages = pyogrio.read_dataframe(RAW + "filosofi.geojson", columns=["id_inspire", "ind_65_79", "ind_80p"], read_geometry=False)
fi = fi.merge(ages, on="id_inspire", how="left"); a65 = (fi.ind_65_79.fillna(0) + fi.ind_80p.fillna(0)).values
fzone = None
def desert_share(hh, wmul=1.0, extra_zones=None, h=1.0):
    fr = frais[[is_open(r, hh) for r in frais.itertuples()]]
    nn = gpd.sjoin_nearest(fcent, fr[["geometry"]], how="left", max_distance=5000, distance_col="d"); nn = nn[~nn.index.duplicated()]
    d_direct = nn["d"].reindex(range(len(fi))).fillna(5000).values
    zz = gpd.sjoin_nearest(gz[["geometry"]], fr[["geometry"]], how="left", max_distance=5000, distance_col="d"); zz = zz[~zz.index.duplicated()]
    dfz = zz["d"].reindex(range(NZ)).fillna(5000).values
    near = np.where(dfz <= 800)[0]
    c = edge_cost(h, ivt, wait, walk, aj, cl, board, wmul)
    sink_from = list(near); sink_cost = list(2 * dfz[near] * 1.25 / 75 * wmul * (1 + 0.05 * h * AJZ[near]))
    if extra_zones is not None:
        sink_from += list(extra_zones); sink_cost += [0.5] * len(extra_zones)
    SINK = NN0
    best_sink = {}
    for z_, c_ in zip(sink_from, sink_cost):
        if c_ < best_sink.get(z_, 1e18): best_sink[z_] = c_
    sink_from = list(best_sink); sink_cost = [best_sink[z_] for z_ in sink_from]
    Mt = csr_matrix((np.concatenate([c, sink_cost]) + 1e-6, (np.concatenate([dst, np.full(len(sink_from), SINK)]), np.concatenate([src, sink_from]))), shape=(NN0 + 1, NN0 + 1))
    to_ref = dijkstra(Mt, indices=SINK)[:NZ]
    best = 2 * (d_direct * 1.25 / 75.0) * wmul * (1 + 0.05 * h * 8)
    # accès carreau → zones (vectorisé par paquets)
    from scipy.spatial import cKDTree
    tree = cKDTree(np.c_[ZX, ZY]); lists = tree.query_ball_point(np.c_[FX, FY], 800)
    for k, idx in enumerate(lists):
        if not idx: continue
        idx = np.array(idx); wk = np.hypot(ZX[idx] - FX[k], ZY[idx] - FY[k]) * 1.25 / 75
        v = (2 * wk * wmul * (1 + 0.05 * h * AJZ[idx]) + to_ref[idx]).min()
        if v < best[k]: best[k] = v
    return best
res_h = {}
for hh in (14, 21, 23):
    t_ = desert_share(hh, wmul=4.5 / 3.4)              # marche lente des personnes âgées (3,4 km/h)
    res_h[hh] = dict(a65=float(a65[t_ > 15].sum()), share=float(a65[t_ > 15].sum() / a65.sum() * 100), t=[int(min(99, round(x))) for x in t_])
    log("refuges à", hh, "h : 65+ en désert", int(res_h[hh]["a65"]), "(", round(res_h[hh]["share"], 1), "%)")
heavy = np.where(stops.m.isin(["metro", "train"]).values)[0]
t_ref = desert_share(14, wmul=4.5 / 3.4, extra_zones=heavy)
gares_refuges = dict(a65=float(a65[t_ref > 15].sum()), share=float(a65[t_ref > 15].sum() / a65.sum() * 100), n=int(len(heavy)))
log("gares refuges : 65+ en désert", int(gares_refuges["a65"]))

# ---------- Échantillon d'agents pour l'animation ----------
pm = pmaint(th)
pw = mp.w.values / mp.w.sum()
pick = rng.choice(len(mp), size=12000, replace=True, p=pw)
ZLON, ZLAT = stops.lon.values, stops.lat.values
ag = []
for k in pick:
    o, d = int(mp.oi.iloc[k]), int(mp.di.iloc[k]); P = paths.get((o, d))
    if not P or len(P["zs"]) < 2: continue
    dep = float(np.clip(rng.normal(8 * 60, 35), 6.5 * 60, 10 * 60))
    keep = bool(rng.random() < pm[k])
    zs = P["zs"]; ck = P["clock"][:len(zs)]
    ag.append([round(dep), int(keep), str(mp.cs.iloc[k]), zs, [round(x, 1) for x in ck]])
open(WEB + "data/agents.js", "w", encoding="utf-8").write("window.AGENTS=" + json.dumps(dict(a=ag, n=len(ag), scale=float(mp.w.sum() / len(ag))), separators=(",", ":")) + ";")
log("agents", len(ag))

out = dict(theta=[round(float(x), 4) for x in th], a_cadre=A_CADRE, calib=cal, valid=dict(r=r_lines, mae=mae, n=len(vl), lines=vl, diag=diag),
           renonce=renonce, by_cs=by_cs_sim, clim_rank=clim_rank, shade_rank=shade_rank,
           totals=dict(costC=tot_cost_C, costN=tot_cost_N, dose=tot_dose, commuters=float(od.w.sum())),
           refuges_h={str(k): dict(a65=v["a65"], share=v["share"]) for k, v in res_h.items()}, gares_refuges=gares_refuges,
           a65_total=float(a65.sum()))
open(WEB + "data/sim.js", "w", encoding="utf-8").write("window.SIM=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";")
open(WEB + "data/refuges_h.js", "w", encoding="utf-8").write("window.REFH=" + json.dumps({str(k): v["t"] for k, v in res_h.items()}, separators=(",", ":")) + ";")
log("écrit sim.js")
