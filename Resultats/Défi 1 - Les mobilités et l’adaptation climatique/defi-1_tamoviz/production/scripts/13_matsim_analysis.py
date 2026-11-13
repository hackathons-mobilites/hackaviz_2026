"""Analyse des deux simulations MATSim (ordinaire, canicule) et export pour la page.
Lit matsim/output_<scénario>/ : output_events.xml.gz, output_plans.xml.gz, output_trips.csv.gz, output_legs.csv.gz
Sortie : web/data/matsim.js"""
import gzip, json, math, os, re, time
import numpy as np, pandas as pd
from pyproj import Transformer

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
to84 = Transformer.from_crs(2154, 4326, always_xy=True)
M = "matsim/"
lig = {l["id_line"]: l for l in json.load(open("data/raw/lignes.json", encoding="utf-8"))}

def route_modes():
    """transitRoute → mode de route (rail, subway, tram, bus_ac, bus_noac, cable)"""
    rm = {}; cur_line = cur_route = None
    with gzip.open(M + "scenario/transitSchedule.xml.gz", "rt", encoding="utf-8") as f:
        for line in f:
            if "<transitLine " in line: cur_line = re.search(r'id="([^"]+)"', line).group(1)
            elif "<transitRoute " in line: cur_route = re.search(r'id="([^"]+)"', line).group(1)
            elif "<transportMode>" in line: rm[cur_route] = (cur_line, re.search(r">([^<]+)<", line).group(1))
    return rm
RM = route_modes()

def events(scen):
    veh_line, board = {}, {}
    rx_d = re.compile(r'type="TransitDriverStarts".*?vehicleId="([^"]+)".*?transitLineId="([^"]+)".*?transitRouteId="([^"]+)"')
    rx_e = re.compile(r'type="PersonEntersVehicle" person="([^"]+)" vehicle="([^"]+)"')
    with gzip.open(M + f"output_{scen}/output_events.xml.gz", "rt", encoding="utf-8") as f:
        for line in f:
            if "TransitDriverStarts" in line:
                m = rx_d.search(line)
                if m: veh_line[m.group(1)] = (m.group(2), m.group(3))
            elif "PersonEntersVehicle" in line:
                m = rx_e.search(line)
                if m and not m.group(1).startswith("pt_"):
                    lr = veh_line.get(m.group(2))
                    if lr: board[lr] = board.get(lr, 0) + 1
    by_line, by_mode = {}, {}
    for (l, r), n in board.items():
        md = RM.get(r, (l, "?"))[1]
        by_line[l] = by_line.get(l, 0) + n; by_mode[md] = by_mode.get(md, 0) + n
    return by_line, by_mode

def plans(scen):
    out = []; sub = cs = None; selected = False; first_end = None; kind = None
    with gzip.open(M + f"output_{scen}/output_plans.xml.gz", "rt", encoding="utf-8") as f:
        for line in f:
            if "<person " in line: sub = cs = None
            elif 'name="subpopulation"' in line: sub = re.search(r">([^<]*)<", line).group(1)
            elif 'name="cs"' in line: cs = re.search(r">([^<]*)<", line).group(1)
            elif "<plan " in line: selected = 'selected="yes"' in line; first_end = None; kind = None
            elif selected and "<activity " in line:
                t = re.search(r'type="([^"]+)"', line).group(1)
                if first_end is None:
                    m = re.search(r'end_time="([^"]+)"', line)
                    if m: h, mi, s = map(int, m.group(1).split(":")); first_end = h * 3600 + mi * 60 + s
                if t in ("work", "telework"): kind = t
            elif selected and "</plan>" in line:
                out.append(dict(sub=sub, cs=cs, kind=kind, dep=first_end)); selected = False
    return pd.DataFrame(out)

def legs(scen):
    f = M + f"output_{scen}/output_legs.csv.gz"
    return pd.read_csv(f, sep=";") if os.path.exists(f) else None

res = {}
LEVERS = {"clim": "Tous les bus climatisés", "freq": "Bus renforcés aux heures de pointe", "horaires": "Horaires décalés et télétravail encouragé"}
for scen in ("ordinaire", "canicule", *LEVERS):
    if not os.path.exists(M + f"output_{scen}/output_events.xml.gz"):
        log("pas de sortie pour", scen); continue
    bl, bm = events(scen); pl = plans(scen); lg = legs(scen)
    res[scen] = dict(by_line=bl, by_mode=bm, plans=pl, legs=lg)
    log(scen, "montées", sum(bm.values()), bm, "· télétravail", round((pl.kind == "telework").mean() * 100, 1), "%")
if "ordinaire" not in res or "canicule" not in res: raise SystemExit("il faut les deux simulations de base")

O, C = res["ordinaire"], res["canicule"]
grp = lambda m: "ferré" if m in ("rail", "subway", "tram", "cable") else ("bus climatisés" if m == "bus_ac" else "bus non climatisés")
gi = {}
for m in set(O["by_mode"]) | set(C["by_mode"]):
    g = grp(m); a = gi.setdefault(g, [0, 0]); a[0] += O["by_mode"].get(m, 0); a[1] += C["by_mode"].get(m, 0)
group_idx = {g: round(100 * c / o, 1) for g, (o, c) in gi.items() if o}
obs = json.load(open("data/processed/volet2.json", encoding="utf-8")); days = obs["days"]
red = [k for k, d in enumerate(days) if "2026-06-22" <= d <= "2026-06-26"]
observed = {"ferré": round(np.mean([obs["serie"][k]["fer_i"] for k in red]), 1), "bus climatisés": round(np.mean([obs["serie"][k]["bc_i"] for k in red]), 1),
            "bus non climatisés": round(np.mean([obs["serie"][k]["bn_i"] for k in red]), 1)}
# par ligne de bus : indice simulé vs observé
obs_line = {b["gol"]: np.mean([b["i"][k] for k in red if b["i"][k] is not None]) for b in obs["buslines"] if any(b["i"][k] is not None for k in red)}
lines = []
for l, n0 in O["by_line"].items():
    if n0 < 30: continue
    meta = lig.get(l.replace("IDFM:", ""), {}); gol = meta.get("id_groupoflines")
    if meta.get("transportmode") != "bus" or gol not in obs_line: continue
    lines.append(dict(n=meta.get("shortname_line"), gol=gol, clim=meta.get("air_conditioning") or "unknown", o=n0, sim=100 * C["by_line"].get(l, 0) / n0, obs=float(obs_line[gol])))
def wcorr(x, y, w):
    x, y, w = map(np.asarray, (x, y, w)); mx, my = np.average(x, weights=w), np.average(y, weights=w)
    return float(np.sum(w * (x - mx) * (y - my)) / math.sqrt(np.sum(w * (x - mx) ** 2) * np.sum(w * (y - my) ** 2)))
r_line = wcorr([l["sim"] for l in lines], [l["obs"] for l in lines], [l["o"] for l in lines]) if len(lines) > 5 else None
tele = {s: dict(o=round(float((O["plans"][O["plans"]["sub"] == s].kind == "telework").mean() * 100), 1), c=round(float((C["plans"][C["plans"]["sub"] == s].kind == "telework").mean() * 100), 1))
        for s in ("cadre", "essentiel", "autre")}
def hist(pl):
    d = pl[pl.kind == "work"].dep.dropna() / 3600; h, e = np.histogram(d, bins=np.arange(5, 11.01, 0.25)); return h.tolist()
# échantillon de trajets pour l'animation (positions des montées et descentes)
def anim(lg, n=6000):
    if lg is None: return []
    lg = lg[lg["dep_time"].notna()].copy()
    def sec(v):
        if isinstance(v, str) and ":" in v: h, m, s = map(int, v.split(":")); return h * 3600 + m * 60 + s
        return float(v)
    lg["d"] = lg.dep_time.map(sec); lg["t"] = lg.trav_time.map(sec)
    lg = lg[(lg.d >= 5 * 3600) & (lg.d <= 11 * 3600)]
    persons = lg.person.drop_duplicates().sample(min(n, lg.person.nunique()), random_state=1)
    s = lg[lg.person.isin(persons)]
    lon0, lat0 = to84.transform(s.start_x.values, s.start_y.values); lon1, lat1 = to84.transform(s.end_x.values, s.end_y.values)
    return [[str(p), m, int(d), int(t), round(a, 5), round(b, 5), round(c, 5), round(e, 5)] for p, m, d, t, a, b, c, e in zip(s.person, s["mode"], s.d, s.t, lon0, lat0, lon1, lat1)]

# ---------- Dose thermique individuelle (minutes dehors × intensité de chaleur de l'heure × aléa du lieu) ----------
import csv as _csv
from scipy.spatial import cKDTree
temp = {}
with gzip.open("data/raw/H_75_latest-2025-2026.csv.gz", "rt", encoding="utf-8") as f:
    r = _csv.reader(f, delimiter=";"); h0 = next(r); I = {k: h0.index(k) for k in ["NUM_POSTE", "AAAAMMJJHH", "T"]}
    for x in r:
        if x[I["NUM_POSTE"]] == "75114001" and x[I["AAAAMMJJHH"]].startswith("20260625") and x[I["T"]]:
            temp[(int(x[I["AAAAMMJJHH"]][8:]) + 2) % 24] = float(x[I["T"]])
stops = pd.read_parquet("data/processed/stops.parquet")
sx, sy = Transformer.from_crs(4326, 2154, always_xy=True).transform(stops.lon.values, stops.lat.values)
tree = cKDTree(np.c_[sx, sy]); AJ = stops.aj.fillna(stops.aj.median()).clip(0, 17).values
def sec(v):
    if isinstance(v, str) and ":" in v: h, m, s = map(int, v.split(":")); return h * 3600 + m * 60 + s
    try: return float(v)
    except Exception: return 0.0
def dose(scen, hot):
    lg = res[scen]["legs"]
    if lg is None: return None
    d = lg.dep_time.map(sec); tr = lg.trav_time.map(sec); wt = lg.wait_time.map(sec) if "wait_time" in lg else 0
    out_min = np.where(lg["mode"].isin(["walk", "transit_walk", "non_network_walk"]), tr, 0) / 60 + np.asarray(wt) / 60
    hh = (d // 3600).astype(int) % 24
    hf = np.array([min(1, max(0, (temp.get(h, 25) - 25) / 14)) for h in hh]) if hot else np.zeros(len(lg))
    _, k = tree.query(np.c_[lg.start_x.values, lg.start_y.values])
    lg = lg.assign(out=out_min, dose=out_min * hf * AJ[k] / 10)
    return lg.groupby("person").agg(out=("out", "sum"), dose=("dose", "sum"))
pers = pd.read_csv(M + "output_canicule/output_persons.csv.gz", sep=";") if os.path.exists(M + "output_canicule/output_persons.csv.gz") else None
dC = dose("canicule", True)
dose_out = None
if dC is not None and pers is not None:
    csc = "cs" if "cs" in pers.columns else None
    dd = dC.join(pers.set_index("person")[[csc]] if csc else None, how="left") if csc else dC
    v = np.sort(dd.dose.values); cum = np.cumsum(v) / max(v.sum(), 1e-9); pp = np.arange(1, len(v) + 1) / len(v)
    gini = float(1 - 2 * np.trapezoid(cum, pp))
    top10 = float(1 - cum[int(0.9 * len(v)) - 1])
    by = dd.groupby(csc).agg(dose=("dose", "mean"), out=("out", "mean"), n=("dose", "size")).reset_index().to_dict("records") if csc else []
    dose_out = dict(gini=gini, top10=top10, lorenz=[[round(float(pp[i]), 3), round(float(cum[i]), 3)] for i in range(0, len(v), max(1, len(v) // 100))] + [[1.0, 1.0]], by_cs=by)
    log("dose : Gini", round(gini, 2), "· 10 % les plus exposés reçoivent", round(top10 * 100, 1), "% de la dose")

# ---------- mesures : chaque scénario comparé à la canicule sans mesure ----------
def summary(scen):
    r = res[scen]; pl = r["plans"]; bm = r["by_mode"]
    d = dose(scen, True) if scen != "ordinaire" else None
    ps = pd.read_csv(M + f"output_{scen}/output_persons.csv.gz", sep=";") if os.path.exists(M + f"output_{scen}/output_persons.csv.gz") else None
    by = {}
    if d is not None and ps is not None and "cs" in ps.columns:
        dd = d.join(ps.set_index("person")[["cs"]], how="left")
        by = {k: round(float(v), 2) for k, v in dd.groupby("cs").dose.mean().items()}
    g = {}
    for m, n in bm.items(): g[grp(m)] = g.get(grp(m), 0) + n
    return dict(boardings=sum(bm.values()), groups=g, tele={s: round(float((pl[pl["sub"] == s].kind == "telework").mean() * 100), 1) for s in ("cadre", "essentiel", "autre")},
                commuters=int((pl.kind == "work").sum()), dose=round(float(d.dose.sum()), 1) if d is not None else None,
                dose_mean=round(float(d.dose.mean()), 3) if d is not None else None, out_mean=round(float(d.out.mean()), 1) if d is not None else None, dose_cs=by)
scen_sum = {s: summary(s) for s in res}
levers = []
base = scen_sum["canicule"]
for k, lab in LEVERS.items():
    if k not in scen_sum: continue
    s = scen_sum[k]
    levers.append(dict(key=k, label=lab, d_commuters=s["commuters"] - base["commuters"], d_boardings=s["boardings"] - base["boardings"],
                       d_dose_pct=round(100 * (s["dose"] / base["dose"] - 1), 1) if base["dose"] else None, **s))
    log("mesure", lab, ": navetteurs", s["commuters"] - base["commuters"], "· montées", s["boardings"] - base["boardings"], "· dose", levers[-1]["d_dose_pct"], "%")

out = dict(dose=dose_out, scen=scen_sum, levers=levers, group_idx=group_idx, observed=observed, lines=lines, r_line=r_line, tele=tele,
           boardings=dict(o=sum(O["by_mode"].values()), c=sum(C["by_mode"].values())),
           hist=dict(o=hist(O["plans"]), c=hist(C["plans"])), anim=dict(o=anim(O["legs"]), c=anim(C["legs"])),
           meta=json.load(open(M + "scenario/meta.json")))
open("web/data/matsim.js", "w", encoding="utf-8").write("window.MATSIM=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";")
log("écrit web/data/matsim.js · indices simulés", group_idx, "· observés", observed, "· r par ligne", r_line)
