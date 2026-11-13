"""Contrôle agrégé : ce que l'on raconte est-il vrai à l'échelle de toute l'Île-de-France ?
Données : série journalière des indices de validation (100 = jour comparable habituel), météo et vigilance par département
(data/processed/volet2.json, 18 mai - 30 juin 2026), indices par ligne de bus avec leur climatisation.
Tests :
 1. relation jour par jour entre Tmax (Paris-Montsouris) et l'indice, par réseau, avec effet du jour de la semaine ;
 2. panel départements × jours (effets fixes département et jour de semaine) : pente en points par °C ;
 3. relation dose-réponse par classe de Tmax ;
 4. écart bus non climatisés - bus climatisés : grandit-il avec la chaleur ? (différence de différences) ;
 5. lignes de bus : indice de la semaine rouge selon la climatisation, intervalle par bootstrap ;
 6. test placebo : les jours frais de mai ne doivent montrer aucune pente.
Sortie : web/data/macro.js"""
import json
import numpy as np, pandas as pd

rng = np.random.default_rng(1)
V = json.load(open("data/processed/volet2.json", encoding="utf-8"))
RED = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"]
rows = []
for s in V["serie"]:
    rows.append(dict(d=s["d"], wd=s["wd"], ferie=s["ferie"], tx=s["met"]["75"]["tx"], tn=s["met"]["75"]["tn"],
                     vig=max(s["vig"].values()), fer=s["fer_i"], bc=s["bc_i"], bn=s["bn_i"]))
D = pd.DataFrame(rows)
W = D[(D.wd < 5) & (~D.ferie)].copy()          # jours ouvrés hors fériés
print("jours ouvrés retenus :", len(W), "sur", len(D))

def ols(y, X):
    X = np.column_stack(X); b, *_ = np.linalg.lstsq(X, y, rcond=None); e = y - X @ b
    n, k = X.shape; XtXi = np.linalg.pinv(X.T @ X)
    V_ = XtXi @ (X.T * e ** 2) @ X @ XtXi * n / (n - k)       # erreurs robustes (HC1)
    return b, np.sqrt(np.diag(V_)), 1 - e.var() / y.var()
def wd_dummies(df): return [(df.wd == k).astype(float).values for k in range(1, 5)]

# 1. pente jour par jour
slope = {}
for k, lab in [("fer", "ferré"), ("bc", "bus climatisés"), ("bn", "bus non climatisés")]:
    b, se, r2 = ols(W[k].values, [np.ones(len(W)), W.tx.values, *wd_dummies(W)])
    slope[lab] = dict(b=round(b[1], 2), lo=round(b[1] - 1.96 * se[1], 2), hi=round(b[1] + 1.96 * se[1], 2), r2=round(r2, 2))
    # robustesse : avec une tendance linéaire dans le temps (fin d'année scolaire, vacances qui approchent)
    tr = (pd.to_datetime(W.d) - pd.Timestamp("2026-05-18")).dt.days.values.astype(float)
    b2, se2, _ = ols(W[k].values, [np.ones(len(W)), W.tx.values, tr, *wd_dummies(W)])
    slope[lab].update(bt=round(b2[1], 2), lot=round(b2[1] - 1.96 * se2[1], 2), hit=round(b2[1] + 1.96 * se2[1], 2), trend=round(b2[2], 2))
    print("pente", lab, slope[lab])

# 2. panel départements
P = []
for s in V["serie"]:
    if s["wd"] >= 5 or s["ferie"]: continue
    for dep, v in s["dep_i"].items():
        if v is None or dep not in s["met"]: continue
        P.append(dict(dep=dep, wd=s["wd"], tx=s["met"][dep]["tx"], i=v))
P = pd.DataFrame(P)
X = [np.ones(len(P)), P.tx.values] + [(P.dep == d).astype(float).values for d in sorted(P.dep.unique())[1:]] + wd_dummies(P)
b, se, r2 = ols(P.i.values, X)
panel = dict(b=round(b[1], 2), lo=round(b[1] - 1.96 * se[1], 2), hi=round(b[1] + 1.96 * se[1], 2), n=len(P))
print("panel départements", panel)
by_dep = []
for dep, g in P.groupby("dep"):
    bb, ss, _ = ols(g.i.values, [np.ones(len(g)), g.tx.values])
    by_dep.append(dict(dep=dep, nom=V["dept_nom"][dep], b=round(bb[1], 2), lo=round(bb[1] - 1.96 * ss[1], 2), hi=round(bb[1] + 1.96 * ss[1], 2)))

# 3. dose-réponse
bins = [(0, 22, "< 22 °C"), (22, 26, "22-26 °C"), (26, 30, "26-30 °C"), (30, 34, "30-34 °C"), (34, 50, "≥ 34 °C")]
dose = []
for a, z, lab in bins:
    g = W[(W.tx >= a) & (W.tx < z)]
    if len(g): dose.append(dict(lab=lab, n=len(g), fer=round(g.fer.mean(), 1), bc=round(g.bc.mean(), 1), bn=round(g.bn.mean(), 1)))
print("dose-réponse", dose)

# 4. écart non climatisés - climatisés
W["gap"] = W.bn - W.bc
b, se, _ = ols(W.gap.values, [np.ones(len(W)), W.tx.values, *wd_dummies(W)])
gap = dict(b=round(b[1], 2), lo=round(b[1] - 1.96 * se[1], 2), hi=round(b[1] + 1.96 * se[1], 2),
           red=round(W[W.d.isin(RED)].gap.mean(), 1), cool=round(W[W.tx < 24].gap.mean(), 1))
print("écart non clim - clim", gap)

# 5. lignes de bus
days = V["days"]; red_ix = [days.index(d) for d in RED]
L = []
for l in V["buslines"]:
    v = [l["i"][k] for k in red_ix if l["i"][k] is not None]
    if v and l.get("med") and l["clim"] in ("true", "false", "partial"): L.append(dict(clim=l["clim"], med=l["med"], i=float(np.mean(v))))
L = pd.DataFrame(L)
def wmean(g): return float(np.average(g.i, weights=g.med))
lines = {}
for c, g in L.groupby("clim"):
    bs = [wmean(g.sample(len(g), replace=True, random_state=int(rng.integers(1e9)))) for _ in range(500)]
    lines[c] = dict(n=len(g), m=round(wmean(g), 1), lo=round(np.percentile(bs, 2.5), 1), hi=round(np.percentile(bs, 97.5), 1))
print("lignes", lines)

# 6. placebo : jours frais (Tmax < 24 °C)
C = W[W.tx < 24]
placebo = {}
for k, lab in [("fer", "ferré"), ("bc", "bus climatisés"), ("bn", "bus non climatisés")]:
    bb, ss, _ = ols(C[k].values, [np.ones(len(C)), C.tx.values])
    placebo[lab] = dict(b=round(bb[1], 2), lo=round(bb[1] - 1.96 * ss[1], 2), hi=round(bb[1] + 1.96 * ss[1], 2), n=len(C))
print("placebo", placebo)

# ---------- 7. Contrôle point par point (volet 1) sur les validations observées ----------
# Effet chaleur d'une ligne ou d'une gare = indice moyen de la semaine rouge - indice moyen des jours ouvrés frais (Tmax < 24 °C).
# On se compare à soi-même : les biais propres à chaque ligne (référence, jour de semaine) s'annulent.
from scipy.spatial import cKDTree
ST = pd.read_parquet("data/processed/stops.parquet").set_index("id_zone_arret")
PL = pd.read_parquet("data/processed/per_line.parquet")
LIG = {l["id_line"]: l for l in json.load(open("data/raw/lignes.json", encoding="utf-8"))}
cool_ix = [days.index(d) for d in W[W.tx < 24].d]
def effect(series):
    r = [series[k] for k in red_ix if series[k] is not None]; c = [series[k] for k in cool_ix if series[k] is not None]
    return (np.mean(r) - np.mean(c)) if len(r) >= 3 and len(c) >= 4 else None
crit = lambda s: dict(freq=s.pp <= 20, clim=(s.nc == s.nc) and s.nc * 100 >= 50, chaleur=(s.aj == s.aj) and s.aj >= 10,
                      frais=(s.df != s.df) or s.df > 300, revenu=(s.nvp == s.nvp) and s.nvp <= 20, access=s.acc == "false")
ST["score"] = [sum(crit(s).values()) for s in ST.itertuples()]
for k in ["freq", "clim", "chaleur", "frais", "revenu", "access"]:
    ST[k] = [crit(s)[k] for s in ST.itertuples()]
# lignes de bus : caractéristiques moyennes des arrêts desservis
PL = PL[PL["mode"] == "bus"].copy(); PL["gol"] = PL.id_ligne_commerciale.map(lambda c: LIG.get(c, {}).get("id_groupoflines"))
PL = PL.join(ST[["aj", "df", "nvp", "acc", "score", "chaleur", "frais", "revenu"]], on="id_zone_arret")
agg = PL.groupby("gol").agg(freq=("p", "max"), aj=("aj", "mean"), chaleur=("chaleur", "mean"), frais=("frais", "mean"), revenu=("revenu", "mean"), score=("score", "mean"), nz=("p", "size"))
BL = []
for l in V["buslines"]:
    e = effect(l["i"])
    if e is None or not l.get("med") or l["gol"] not in agg.index: continue
    a = agg.loc[l["gol"]]
    BL.append(dict(gol=l["gol"], med=l["med"], e=e, clim=l["clim"], freq=a.freq, aj=a.aj, chaleur=a.chaleur, frais=a.frais, revenu=a.revenu, score=a.score))
BL = pd.DataFrame(BL).dropna(subset=["freq"])
print("lignes de bus avec effet calculable :", len(BL))
def boot_diff(g1, g0, n=400):
    f = lambda g: float(np.average(g.e, weights=g.med))
    m = f(g1) - f(g0); bs = []
    for _ in range(n):
        bs.append(f(g1.sample(len(g1), replace=True, random_state=int(rng.integers(1e9)))) - f(g0.sample(len(g0), replace=True, random_state=int(rng.integers(1e9)))))
    return dict(vuln=round(f(g1), 1), autre=round(f(g0), 1), diff=round(m, 1), lo=round(np.percentile(bs, 2.5), 1), hi=round(np.percentile(bs, 97.5), 1), n1=len(g1), n0=len(g0))
points = []
def add(key, lab, unit, g1, g0, how):
    r = boot_diff(g1, g0); r.update(key=key, lab=lab, unit=unit, how=how)
    r["verdict"] = "confirmé" if r["hi"] < 0 else ("contredit" if r["lo"] > 0 else "non significatif")
    points.append(r); print(lab, unit, r)
add("freq", "Faible fréquence", "lignes de bus", BL[BL.freq <= BL.freq.quantile(1 / 3)], BL[BL.freq >= BL.freq.quantile(2 / 3)], "tiers des lignes les moins fréquentes vs tiers les plus fréquentes")
add("clim", "Bus non climatisés", "lignes de bus", BL[BL.clim == "false"], BL[BL.clim == "true"], "lignes non climatisées vs climatisées")
add("chaleur", "Îlot de chaleur", "lignes de bus", BL[BL.chaleur >= 0.5], BL[BL.chaleur < 0.5], "plus de la moitié des arrêts en îlot de chaleur vs moins")
add("frais", "Loin d'un lieu frais", "lignes de bus", BL[BL.frais >= 0.5], BL[BL.frais < 0.5], "plus de la moitié des arrêts à plus de 300 m d'un lieu frais vs moins")
add("revenu", "Revenus bas", "lignes de bus", BL[BL.revenu >= 0.5], BL[BL.revenu < 0.5], "plus de la moitié des arrêts dans les 20 % de revenus les plus bas vs moins")
add("score", "Score cumulé", "lignes de bus", BL[BL.score >= 3], BL[BL.score < 2], "score moyen des arrêts ≥ 3 vs < 2")
# régression pondérée : chaque facteur à autres facteurs égaux
Xn = ["low_freq", "noac", "chaleur", "frais", "revenu"]
BL["low_freq"] = (BL.freq <= BL.freq.quantile(1 / 3)).astype(float); BL["noac"] = (BL.clim == "false").astype(float)
sw = np.sqrt(BL.med.values / BL.med.mean())
b, se, r2 = ols(BL.e.values * sw, [sw] + [BL[k].values * sw for k in Xn])
multi = [dict(k=k, b=round(b[i + 1], 1), lo=round(b[i + 1] - 1.96 * se[i + 1], 1), hi=round(b[i + 1] + 1.96 * se[i + 1], 1)) for i, k in enumerate(Xn)]
print("régression lignes", multi, "R²", round(r2, 2))
# gares ferrées : rattachement à la zone d'arrêt ferrée la plus proche (< 300 m)
FR = ST[ST.m.fillna("").str.contains("rail|metro|train|rer|tram", case=False)]
tree = cKDTree(np.c_[FR.lon.values * 0.66, FR.lat.values]); GS = []
for s in V["stations"]:
    e = effect(s["i"])
    if e is None or not s.get("med"): continue
    d, k = tree.query([s["lon"] * 0.66, s["lat"]])
    if d * 111000 > 300: continue
    z = FR.iloc[k]; GS.append(dict(med=s["med"], e=e, chaleur=z.chaleur, frais=z.frais, revenu=z.revenu, access=z.access, score=z.score))
GS = pd.DataFrame(GS); print("gares rattachées :", len(GS))
if len(GS) > 30:
    add("chaleur_g", "Îlot de chaleur", "gares", GS[GS.chaleur], GS[~GS.chaleur], "gare en îlot de chaleur vs non")
    add("frais_g", "Loin d'un lieu frais", "gares", GS[GS.frais], GS[~GS.frais], "à plus de 300 m d'un lieu frais vs moins")
    add("revenu_g", "Revenus bas", "gares", GS[GS.revenu], GS[~GS.revenu], "20 % de revenus les plus bas vs autres")
    if GS.access.sum() > 10: add("access_g", "Non accessible", "gares", GS[GS.access], GS[~GS.access], "gare non accessible vs accessible")
    add("score_g", "Score cumulé", "gares", GS[GS.score >= 3], GS[GS.score < 2], "score ≥ 3 vs < 2")

pts = W[["d", "tx", "fer", "bc", "bn", "vig"]].round(1).to_dict("records")
out = dict(points=points, multi=multi, n_bus=len(BL), n_gares=len(GS), pts=pts, slope=slope, panel=panel, by_dep=by_dep, dose=dose, gap=gap, lines=lines, placebo=placebo, n_days=len(W), red=RED)
open("web/data/macro.js", "w", encoding="utf-8").write("window.MACRO=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";")
print("écrit web/data/macro.js")
