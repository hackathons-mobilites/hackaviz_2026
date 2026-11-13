"""Analyse macro croisée : qui renonce au transport sous la chaleur, et qui reste exposé ?
Sources croisées
  - validations journalières IDFM du 1er avril au 30 juin 2026 : gares (id_zdc) et lignes de bus (groupe de lignes)
  - météo horaire Météo-France par département (Tmax, Tmin, pluie), vigilance canicule
  - calendrier : jours fériés, ponts, vacances scolaires de printemps (zone C)
  - Filosofi 2019 au carreau de 200 m : niveau de vie, pauvreté, âges, logement social, densité
  - MOBPRO 2021 : part des TC chez les actifs résidents, part des cadres (capacité de télétravail) au domicile et au lieu de travail
  - MOBSCO 2021 : élèves et étudiants scolarisés dans la commune (fin d'année scolaire)
  - offre IDFM, climatisation des lignes, accessibilité, îlots de chaleur (ICU), lieux frais
Étapes
  1. panel régional (91 jours) : modèle calendaire + chaleur, seuil de chaleur par classes, comparaison des indicateurs météo
  2. élasticité chaleur de chaque gare et de chaque ligne de bus (régression individuelle sur ~60 jours ouvrés)
  3. méta-régression : l'élasticité expliquée par les caractéristiques du territoire desservi (tout croisé, à autres facteurs égaux)
  4. justice environnementale : conditions d'exposition par décile de niveau de vie et par âge
Sortie : ajoute la clé « cross » à web/data/macro.js"""
import json, gzip, csv, re, time
import numpy as np, pandas as pd
from scipy.spatial import cKDTree
from pyproj import Transformer

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
rng = np.random.default_rng(3)
to93 = Transformer.from_crs(4326, 2154, always_xy=True)
V = json.load(open("data/processed/volet2.json", encoding="utf-8"))

# ---------- calendrier ----------
DAYS = pd.date_range("2026-04-01", "2026-06-30").strftime("%Y-%m-%d").tolist()
FERIES = {"2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25"}
PONTS = {"2026-05-15"}
VAC = set(pd.date_range("2026-04-18", "2026-05-03").strftime("%Y-%m-%d"))     # vacances de printemps, zone C
cal = pd.DataFrame(dict(d=DAYS)); dt = pd.to_datetime(cal.d)
cal["dow"] = dt.dt.dayofweek; cal["t"] = (dt - dt.min()).dt.days
cal["ferie"] = cal.d.isin(FERIES); cal["pont"] = cal.d.isin(PONTS); cal["vac"] = cal.d.isin(VAC)
cal["work"] = (cal.dow < 5) & ~cal.ferie

# ---------- météo journalière par département ----------
MST = {d: s["id"] for d, s in V["meteo_stations"].items()}
met = {}
for dep, sid in MST.items():
    T = {}; R = {}
    with gzip.open(f"data/raw/H_{dep}_latest-2025-2026.csv.gz", "rt", encoding="utf-8") as f:
        r = csv.reader(f, delimiter=";"); h = next(r); I = {k: h.index(k) for k in ["NUM_POSTE", "AAAAMMJJHH", "T", "RR1"]}
        for x in r:
            if x[I["NUM_POSTE"]] != sid: continue
            k = x[I["AAAAMMJJHH"]]
            if not ("20260325" <= k[:8] <= "20260630"): continue
            d = f"{k[:4]}-{k[4:6]}-{k[6:8]}"
            if x[I["T"]]: T.setdefault(d, []).append(float(x[I["T"]]))
            if x[I["RR1"]]: R[d] = R.get(d, 0) + float(x[I["RR1"]])
    met[dep] = pd.DataFrame([dict(d=d, tx=max(v), tn=min(v), tm=np.mean(v), rr=R.get(d, 0)) for d, v in T.items() if len(v) >= 18]).set_index("d").sort_index()
    met[dep]["tx3"] = met[dep].tx.rolling(3, min_periods=1).mean()          # chaleur accumulée sur 3 jours
log("météo", {d: len(m) for d, m in met.items()})
vig = {}
for s in V["serie"]: vig[s["d"]] = max(s["vig"].values())

# ---------- validations journalières ----------
vb = pd.DataFrame(json.load(open("data/raw/valid_bus_2eme.json", encoding="utf-8"))); vb["d"] = vb.jour.str[:10]
vf = pd.DataFrame(json.load(open("data/raw/valid_ferre_2eme.json", encoding="utf-8"))); vf["d"] = vf.jour.str[:10]
vf = vf.dropna(subset=["id_zdc"]); vf["id"] = vf.id_zdc.astype(int)
BUS = vb[vb.id_groupoflines != "A00000"].pivot_table(index="d", columns="id_groupoflines", values="nb_vald", aggfunc="sum").reindex(DAYS)
FER = vf.pivot_table(index="d", columns="id", values="nb_vald", aggfunc="sum").reindex(DAYS)
log("séries : lignes de bus", BUS.shape[1], "· gares", FER.shape[1])

# ---------- territoire : arrêts, carreaux Filosofi, MOBPRO, MOBSCO ----------
ST = pd.read_parquet("data/processed/stops.parquet")
ST["x"], ST["y"] = to93.transform(ST.lon.values, ST.lat.values)
g = json.load(open("data/raw/filosofi.geojson", encoding="utf-8"))["features"]
def centroid(geom):
    c = np.array(geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]); return c[:, 0].mean(), c[:, 1].mean()
F = pd.DataFrame([dict(**{k: p.get(k) for k in ["ind", "ind_snv", "men", "men_pauv", "log_soc", "ind_0_3", "ind_4_5", "ind_6_10", "ind_11_17", "ind_65_79", "ind_80p", "ind_25_39", "ind_40_54", "men_1ind"]},
                       cx=c[0], cy=c[1]) for p, c in ((f["properties"], centroid(f["geometry"])) for f in g)]).fillna(0)
if F.cx.abs().max() < 200: F["cx"], F["cy"] = to93.transform(F.cx.values, F.cy.values)
else:
    F["cx"], F["cy"] = Transformer.from_crs(3035, 2154, always_xy=True).transform(F.cx.values, F.cy.values)
tF = cKDTree(np.c_[F.cx, F.cy])
def catchment(x, y, r):
    """caractéristiques de la population à moins de r mètres"""
    out = []
    for idx in tF.query_ball_point(np.c_[x, y], r):
        s = F.iloc[idx]; ind = s.ind.sum(); men = s.men.sum()
        if ind < 50: out.append(dict(pop=ind)); continue
        out.append(dict(pop=ind, nv=s.ind_snv.sum() / ind, pauv=100 * s.men_pauv.sum() / max(men, 1), soc=100 * s.log_soc.sum() / max(men, 1),
                        p65=100 * (s.ind_65_79.sum() + s.ind_80p.sum()) / ind, p017=100 * (s.ind_0_3.sum() + s.ind_4_5.sum() + s.ind_6_10.sum() + s.ind_11_17.sum()) / ind,
                        solo=100 * s.men_1ind.sum() / max(men, 1)))
    return pd.DataFrame(out)
mp = pd.read_parquet("data/raw/RP2021_mobpro.parquet", columns=["COMMUNE", "ARM", "DCLT", "TRANS", "CS1", "IPONDI", "REGION"])
mp = mp[mp.REGION == "11"]; mp["o"] = np.where(mp.COMMUNE == "75056", mp.ARM, mp.COMMUNE)
res = mp.groupby("o").apply(lambda d: pd.Series(dict(tc_res=100 * d.IPONDI[d.TRANS == "6"].sum() / d.IPONDI.sum(), cad_res=100 * d.IPONDI[d.CS1 == "3"].sum() / d.IPONDI.sum())))
wk = mp.groupby("DCLT").apply(lambda d: pd.Series(dict(jobs=d.IPONDI.sum(), cad_job=100 * d.IPONDI[d.CS1 == "3"].sum() / d.IPONDI.sum(), tc_job=100 * d.IPONDI[d.TRANS == "6"].sum() / d.IPONDI.sum())))
ms = pd.read_parquet("data/raw/RP2021_mobsco.parquet", columns=["DCETUF", "AGEREV10", "IPONDI", "REGION"])
ms = ms[ms.REGION == "11"]
sco = ms.groupby("DCETUF").IPONDI.sum().rename("eleves")
COM = res.join(wk, how="outer").join(sco, how="outer")
COM["ratio_eleves"] = 100 * COM.eleves / (COM.eleves + COM.jobs)
log("communes MOBPRO / MOBSCO", len(COM))
CX, CY = to93.transform(2.3488, 48.8534)

def unit_covars(xs, ys, cos, extra):
    c = catchment(xs, ys, 800).reset_index(drop=True)
    c["dist_paris"] = np.hypot(np.asarray(xs) - CX, np.asarray(ys) - CY) / 1000
    c = pd.concat([c, COM.reindex(list(cos)).reset_index(drop=True)[["tc_res", "cad_res", "cad_job", "ratio_eleves", "jobs"]]], axis=1)
    for k, v in extra.items(): c[k] = v
    return c

# gares : position, zone d'arrêt ferrée la plus proche pour ICU, lieux frais, accessibilité, fréquence
STn = {s["id"]: s for s in V["stations"]}
FR = ST[ST.m.isin(["train", "metro", "tram"])].reset_index(drop=True); tFR = cKDTree(np.c_[FR.x, FR.y])
g_ids = [i for i in FER.columns if i in STn]
gx, gy = to93.transform([STn[i]["lon"] for i in g_ids], [STn[i]["lat"] for i in g_ids])
dd, kk = tFR.query(np.c_[gx, gy]); z = FR.iloc[kk].reset_index(drop=True)
GC = unit_covars(gx, gy, z.co.values, dict(aj=z.aj.values, df=z.df.fillna(3000).values, acc=(z.acc == "false").astype(float).values,
                                          freq=z.pointe.values, metro=np.array(["METRO" in STn[i]["modes"] for i in g_ids], float),
                                          dep=[STn[i]["dep"] for i in g_ids]))
GC["id"] = g_ids; GC["near"] = dd

# lignes de bus : moyenne pondérée par la population des zones desservies
PL = pd.read_parquet("data/processed/per_line.parquet"); PL = PL[PL["mode"] == "bus"]
LIG = {l["id_line"]: l for l in json.load(open("data/raw/lignes.json", encoding="utf-8"))}
PL["gol"] = PL.id_ligne_commerciale.map(lambda c: LIG.get(c, {}).get("id_groupoflines"))
zc = unit_covars(ST.x.values, ST.y.values, ST.co.values, dict(aj=ST.aj.values, df=ST.df.fillna(3000).values, freq=ST.pointe.values))
zc["id_zone_arret"] = ST.id_zone_arret.values; zc["dep"] = ST.co.str[:2].values
PLz = PL.merge(zc, on="id_zone_arret")
num = ["pop", "nv", "pauv", "soc", "p65", "p017", "solo", "dist_paris", "tc_res", "cad_res", "cad_job", "ratio_eleves", "aj", "df"]
def wavg(d):
    w = d["pop"].fillna(0).values + 1
    o = {k: np.average(d[k].fillna(d[k].median()), weights=w) for k in num}
    o["freq"] = d.p.max(); o["nz"] = len(d); o["dep"] = d.dep.mode().iat[0]; return pd.Series(o)
BC = PLz.groupby("gol").apply(wavg)
BC["noac"] = [1.0 if (LIG.get(next((c for c in PL[PL.gol == gq].id_ligne_commerciale.unique()), ""), {}).get("air_conditioning") == "false") else 0.0 for gq in BC.index]
BC["clim_full"] = [1.0 if (LIG.get(next((c for c in PL[PL.gol == gq].id_ligne_commerciale.unique()), ""), {}).get("air_conditioning") == "true") else 0.0 for gq in BC.index]
log("covariables : gares", len(GC), "· lignes de bus", len(BC))

# ---------- 1. panel régional ----------
def ols(y, X, names):
    X = np.column_stack(X); b, *_ = np.linalg.lstsq(X, y, rcond=None); e = y - X @ b
    n, k = X.shape; XtXi = np.linalg.pinv(X.T @ X); Vc = XtXi @ (X.T * e ** 2) @ X @ XtXi * n / max(n - k, 1)
    se = np.sqrt(np.maximum(np.diag(Vc), 0)); r2 = 1 - e.var() / y.var()
    return {nm: (b[i], se[i]) for i, nm in enumerate(names)}, r2, e
def design(c, heat, extra_trend=False):
    X = [np.ones(len(c))] + [(c.dow == k).astype(float).values for k in range(1, 5)] + [c.vac.astype(float).values, c.pont.astype(float).values, c.t.values / 30]
    nm = ["const", "mar", "mer", "jeu", "ven", "vac", "pont", "trend"]
    if extra_trend: X.append((c.t.values / 30) ** 2); nm.append("trend2")
    for k, v in heat.items(): X.append(v); nm.append(k)
    return X, nm
cw = cal[cal.work].copy().reset_index(drop=True)
mP = met["75"].reindex(cw.d)
cw["tx"] = mP.tx.values; cw["tn"] = mP.tn.values; cw["tm"] = mP.tm.values; cw["tx3"] = mP.tx3.values; cw["rr"] = mP.rr.values
cw["vig"] = cw.d.map(vig).fillna(1)
groups = {"ferré": FER.sum(axis=1), "bus climatisés": None, "bus partiellement climatisés": None, "bus non climatisés": None}
clim_of = {}
for c in BUS.columns:
    ids = PL[PL.gol == c].id_ligne_commerciale.unique()
    clim_of[c] = LIG.get(ids[0], {}).get("air_conditioning") if len(ids) else None
groups["bus climatisés"] = BUS[[c for c in BUS.columns if clim_of.get(c) == "true"]].sum(axis=1)
groups["bus partiellement climatisés"] = BUS[[c for c in BUS.columns if clim_of.get(c) == "partial"]].sum(axis=1)
groups["bus non climatisés"] = BUS[[c for c in BUS.columns if clim_of.get(c) == "false"]].sum(axis=1)
panel = {}; bins_out = {}; metric_cmp = {}; daily = {}
BINS = [(-99, 24, "< 24 °C"), (24, 28, "24-28 °C"), (28, 32, "28-32 °C"), (32, 36, "32-36 °C"), (36, 99, "≥ 36 °C")]
for gname, s in groups.items():
    y = np.log(s.reindex(cw.d).values)
    ok = np.isfinite(y)
    c = cw[ok].reset_index(drop=True); y = y[ok]
    H = np.maximum(c.tx.values - 28, 0)
    X, nm = design(c, {"chaleur": H, "pluie": c.rr.values})
    co, r2, e = ols(y, X, nm)
    X2, nm2 = design(c, {"chaleur": H, "pluie": c.rr.values}, extra_trend=True); co2, _, _ = ols(y, X2, nm2)
    panel[gname] = dict(b=100 * co["chaleur"][0], se=100 * co["chaleur"][1], b2=100 * co2["chaleur"][0], se2=100 * co2["chaleur"][1],
                        rain=100 * co["pluie"][0], vac=100 * co["vac"][0], r2=r2, n=len(y))
    Xb, nmb = design(c, {lab: ((c.tx >= a) & (c.tx < z_)).astype(float).values for a, z_, lab in BINS[1:]} | {"pluie": c.rr.values})
    cb, _, _ = ols(y, Xb, nmb)
    bins_out[gname] = [dict(lab=BINS[0][2], b=0, lo=0, hi=0, n=int(((c.tx < 24)).sum()))] + [
        dict(lab=lab, b=100 * (np.exp(cb[lab][0]) - 1), lo=100 * (np.exp(cb[lab][0] - 1.96 * cb[lab][1]) - 1), hi=100 * (np.exp(cb[lab][0] + 1.96 * cb[lab][1]) - 1),
             n=int(((c.tx >= a) & (c.tx < z_)).sum())) for a, z_, lab in BINS[1:]]
    mc = {}
    for mname, v in [("Tmax", np.maximum(c.tx - 28, 0)), ("Tmin (nuit)", np.maximum(c.tn - 18, 0)), ("Tmoyenne", np.maximum(c.tm - 22, 0)),
                     ("Tmax sur 3 jours", np.maximum(c.tx3 - 28, 0)), ("Niveau de vigilance", np.c_[(c.vig == 2), (c.vig == 3), (c.vig == 4)].astype(float))]:
        vv = {f"h{j}": v[:, j] for j in range(v.shape[1])} if np.ndim(v) == 2 else {"h": np.asarray(v, float)}
        Xm, nmm = design(c, vv | {"pluie": c.rr.values}); _, r2m, em = ols(y, Xm, nmm)
        n_, k_ = len(y), len(nmm); mc[mname] = dict(r2=r2m, aic=n_ * np.log((em ** 2).mean()) + 2 * k_)
    X0, nm0 = design(c, {"pluie": c.rr.values}); _, r20, e0 = ols(y, X0, nm0)
    mc["Sans chaleur (calendrier seul)"] = dict(r2=r20, aic=len(y) * np.log((e0 ** 2).mean()) + 2 * len(nm0))
    metric_cmp[gname] = mc
    # effet d'annonce : la vigilance joue-t-elle en plus de la température ?
    Xv, nmv = design(c, {"chaleur": H, "tn": np.maximum(c.tn.values - 18, 0), "v3": (c.vig == 3).astype(float).values, "v4": (c.vig == 4).astype(float).values, "pluie": c.rr.values})
    cv, _, _ = ols(y, Xv, nmv)
    panel[gname]["vig"] = {k: dict(b=100 * (np.exp(cv[k][0]) - 1), lo=100 * (np.exp(cv[k][0] - 1.96 * cv[k][1]) - 1), hi=100 * (np.exp(cv[k][0] + 1.96 * cv[k][1]) - 1)) for k in ["v3", "v4"]}
    panel[gname]["tn"] = dict(b=100 * cv["tn"][0], se=100 * cv["tn"][1]); panel[gname]["b_ctrl"] = dict(b=100 * cv["chaleur"][0], se=100 * cv["chaleur"][1])
    # série « corrigée du calendrier » pour le graphique : résidu du modèle calendaire
    Xc, nmc = design(c, {"pluie": c.rr.values}); cc, _, ec = ols(y, Xc, nmc)
    daily[gname] = [[c.d[i], round(float(c.tx[i]), 1), round(float(100 * (np.exp(ec[i]) - 1)), 1)] for i in range(len(c))]
    log("panel", gname, {k: round(v, 2) if isinstance(v, float) else v for k, v in panel[gname].items()})
log("comparaison des indicateurs (R²)", {g_: {k: round(v["r2"], 3) for k, v in m.items()} for g_, m in metric_cmp.items()})

# ---------- 2. élasticité chaleur de chaque unité ----------
def unit_beta(series, dep):
    y = np.log(series.reindex(cw.d).values.astype(float) + 1)
    m = met.get(dep, met["75"]).reindex(cw.d)
    ok = np.isfinite(y) & (series.reindex(cw.d).fillna(0).values > 0) & np.isfinite(m.tx.values)
    if ok.sum() < 40: return None
    c = cw[ok].reset_index(drop=True); yy = y[ok]
    H = np.maximum(m.tx.values[ok] - 28, 0)
    if (H > 0).sum() < 6: return None
    X, nm = design(c, {"chaleur": H, "pluie": m.rr.values[ok]})
    co, r2, _ = ols(yy, X, nm)
    return 100 * co["chaleur"][0], 100 * co["chaleur"][1], float(np.exp(np.median(yy)))
GB = []
for i, row in GC.iterrows():
    r = unit_beta(FER[row.id], row.dep)
    if r: GB.append(dict(idx=i, b=r[0], se=r[1], vol=r[2]))
GB = pd.DataFrame(GB).set_index("idx"); G = GC.join(GB, how="inner")
BB = []
for gq, row in BC.iterrows():
    if gq not in BUS.columns: continue
    r = unit_beta(BUS[gq], row.dep)
    if r: BB.append(dict(gol=gq, b=r[0], se=r[1], vol=r[2]))
BB = pd.DataFrame(BB).set_index("gol"); B = BC.join(BB, how="inner")
G = G[(G.se > 0) & (G.se < 5) & (G.near < 400)]; B = B[(B.se > 0) & (B.se < 8)]
log("élasticités : gares", len(G), "médiane", round(G.b.median(), 2), "· lignes", len(B), "médiane", round(B.b.median(), 2))

# ---------- 3. méta-régression ----------
LAB = {"nv": "Niveau de vie médian", "pauv": "Taux de pauvreté", "soc": "Logement social", "p65": "Part des 65 ans et plus", "p017": "Part des moins de 18 ans",
       "solo": "Ménages d'une personne", "pop": "Population desservie (800 m)", "dist_paris": "Distance à Notre-Dame", "tc_res": "Part des TC chez les actifs résidents",
       "cad_res": "Cadres parmi les actifs résidents", "cad_job": "Cadres parmi les emplois de la commune", "ratio_eleves": "Élèves et étudiants / (élèves + emplois)",
       "aj": "Aléa îlot de chaleur", "df": "Distance au lieu frais", "acc": "Gare non accessible", "freq": "Fréquence à la pointe", "metro": "Gare de métro",
       "noac": "Ligne non climatisée", "clim_full": "Ligne entièrement climatisée"}
def meta(D, cols):
    D = D.dropna(subset=cols + ["b", "se"]).copy()
    tau2 = max(0.0, np.var(D.b) - np.mean(D.se ** 2)); w = 1 / (D.se ** 2 + tau2); sw = np.sqrt(w.values)
    Z = [(D[c] - D[c].mean()) / (D[c].std() or 1) if D[c].nunique() > 2 else D[c] for c in cols]
    co, r2, _ = ols(D.b.values * sw, [sw] + [z.values * sw for z in Z], ["const"] + cols)
    out = [dict(k=c, lab=LAB.get(c, c), b=co[c][0], lo=co[c][0] - 1.96 * co[c][1], hi=co[c][0] + 1.96 * co[c][1],
                binary=bool(D[c].nunique() <= 2)) for c in cols]
    return dict(coef=out, n=len(D), r2=r2, mean=float(np.average(D.b, weights=w)), tau=float(np.sqrt(tau2)))
gcols = ["nv", "pauv", "p65", "p017", "soc", "dist_paris", "tc_res", "cad_res", "cad_job", "ratio_eleves", "aj", "df", "acc", "freq", "metro"]
bcols = ["nv", "pauv", "p65", "p017", "soc", "dist_paris", "tc_res", "cad_res", "cad_job", "ratio_eleves", "aj", "df", "freq", "noac", "clim_full"]
for D in (G, B):
    for c in ["freq", "pop"]:
        if c in D: D[c] = np.log1p(D[c].astype(float))
MG = meta(G, gcols); MB = meta(B, bcols)
for nmx, M in [("gares", MG), ("bus", MB)]:
    log("méta-régression", nmx, "n", M["n"], "R²", round(M["r2"], 2), [(c["k"], round(c["b"], 2), round(c["lo"], 2), round(c["hi"], 2)) for c in M["coef"]])
# gradients univariés par quintile (pour la lecture)
def grad(D, col):
    q = pd.qcut(D[col].rank(method="first"), 5, labels=False)
    out = []
    for k in range(5):
        d = D[q == k]; w = 1 / d.se ** 2
        m = float(np.average(d.b, weights=w)); s = float(np.sqrt(1 / w.sum()))
        out.append(dict(q=k + 1, b=m, lo=m - 1.96 * s, hi=m + 1.96 * s, x=float(d[col].median())))
    return out
GRAD = {"gares": {c: grad(G, c) for c in ["nv", "cad_res", "cad_job", "p65", "tc_res", "dist_paris"]},
        "bus": {c: grad(B, c) for c in ["nv", "cad_res", "cad_job", "p65", "tc_res", "dist_paris"]}}

# ---------- 4. justice environnementale ----------
FI = pd.read_parquet("data/processed/filo.parquet", columns=["id_inspire", "ind", "ns", "nd", "nv"])
P = {f["properties"]["id_inspire"]: f["properties"] for f in g}
FI["p65"] = [(P.get(i, {}).get("ind_65_79", 0) or 0) + (P.get(i, {}).get("ind_80p", 0) or 0) for i in FI.id_inspire]
FI["p017"] = [sum((P.get(i, {}).get(k, 0) or 0) for k in ["ind_0_3", "ind_4_5", "ind_6_10", "ind_11_17"]) for i in FI.id_inspire]
S = ST.reset_index(drop=True)
def crit(s):
    return dict(freq=s.pp <= 20, noac=(s.nc == s.nc) and s.nc * 100 >= 50, icu=(s.aj == s.aj) and s.aj >= 10,
                frais=(s.df != s.df) or s.df > 300, access=s.acc == "false")
CR = pd.DataFrame([crit(s) for s in S.itertuples()])
CR["score"] = CR.sum(axis=1)
FI = FI.dropna(subset=["ns"]); FI["ns"] = FI.ns.astype(int)
FI = FI.join(CR, on="ns")
FI["dec"] = pd.qcut(FI.nv.rank(method="first"), 10, labels=False) + 1
just = []
for d_, gq in FI.groupby("dec"):
    w = gq.ind.values
    row = dict(dec=int(d_), nv=float(np.average(gq.nv, weights=w)), pop=float(w.sum()))
    for k in ["freq", "noac", "icu", "frais", "access"]: row[k] = float(100 * np.average(gq[k].astype(float), weights=w))
    row["score3"] = float(100 * np.average((gq.score >= 3).astype(float), weights=w))
    row["walk"] = float(np.average(gq.nd.clip(0, 3000), weights=w))
    row["p65_exp"] = float(100 * (gq.p65 * (gq.score >= 3)).sum() / max(gq.p65.sum(), 1))
    row["p017_exp"] = float(100 * (gq.p017 * (gq.score >= 3)).sum() / max(gq.p017.sum(), 1))
    just.append(row)
def conc(var):
    """indice de concentration : < 0 si la variable se concentre chez les plus modestes"""
    d = FI.sort_values("nv"); w = d.ind.values; y = d[var].astype(float).values
    cw_ = np.cumsum(w) / w.sum(); cy = np.cumsum(w * y) / max((w * y).sum(), 1e-9)
    return float(1 - 2 * np.trapezoid(cy, cw_))
CI = {k: conc(k) for k in ["freq", "noac", "icu", "frais", "access"]}
FI["exp3"] = (FI.score >= 3).astype(float); CI["score3"] = conc("exp3")
log("justice : indices de concentration", {k: round(v, 3) for k, v in CI.items()})

# ---------- sortie ----------
def rnd(o):
    if isinstance(o, dict): return {k: rnd(v) for k, v in o.items()}
    if isinstance(o, list): return [rnd(v) for v in o]
    if isinstance(o, (float, np.floating)): return round(float(o), 3)
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, np.bool_): return bool(o)
    return o
cross = rnd(dict(period=[DAYS[0], DAYS[-1]], n_work=int(cal.work.sum()), panel=panel, bins=bins_out, metrics=metric_cmp, daily=daily,
                 meta=dict(gares=MG, bus=MB), grad=GRAD, just=just, conc=CI,
                 elast=dict(gares=dict(n=len(G), med=G.b.median(), q1=G.b.quantile(.25), q3=G.b.quantile(.75), neg=float((G.b + 1.96 * G.se < 0).mean() * 100)),
                            bus=dict(n=len(B), med=B.b.median(), q1=B.b.quantile(.25), q3=B.b.quantile(.75), neg=float((B.b + 1.96 * B.se < 0).mean() * 100))),
                 sources=dict(bus_lines=int(BUS.shape[1]), stations=int(FER.shape[1]), carreaux=len(F), communes=len(COM))))
txt = open("web/data/macro.js", encoding="utf-8").read()
M = json.loads(re.match(r"window\.MACRO=(.*);\s*$", txt, re.S).group(1)); M["cross"] = cross
open("web/data/macro.js", "w", encoding="utf-8").write("window.MACRO=" + json.dumps(M, ensure_ascii=False, separators=(",", ":")) + ";")
log("écrit web/data/macro.js (clé cross)")
