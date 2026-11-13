"""Animation MATSim pour la page : véhicules TC (arrêts desservis, charge à bord) et agents (marche, attente, trajet),
fenêtre 6 h 30 - 9 h 30, à partir de output_events.xml.gz et output_legs.csv.gz.
Chaque véhicule garde la couleur officielle de sa ligne (route_color du GTFS IDFM).
Usage : python scripts/14_matsim_anim.py ordinaire|canicule  →  web/data/msanim_<scénario>.js"""
import gzip, json, re, sys, time
import numpy as np, pandas as pd
from pyproj import Transformer

scen = sys.argv[1]; M = f"matsim/output_{scen}/"
W0, W1 = 6.5 * 3600, 9.5 * 3600
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
stops = pd.read_parquet("data/processed/stops.parquet")
LON, LAT = stops.lon.values, stops.lat.values

# mode de chaque route (pour colorer les véhicules)
rmode = {}; cur = None
with gzip.open("matsim/scenario/transitSchedule.xml.gz", "rt", encoding="utf-8") as f:
    for line in f:
        if "<transitRoute " in line: cur = re.search(r'id="([^"]+)"', line).group(1)
        elif "<transportMode>" in line: rmode[cur] = re.search(r">([^<]+)<", line).group(1)
MODES = ["rail", "subway", "tram", "bus_ac", "bus_noac", "cable"]
# couleur officielle de chaque ligne (route_color du GTFS IDFM ; l'identifiant de ligne MATSim est le route_id)
routes = pd.read_csv("data/raw/gtfs/routes.txt", dtype=str, usecols=["route_id", "route_color"])
LCOL = {r: ("#" + c.upper()) if isinstance(c, str) and len(c) == 6 else None for r, c in zip(routes.route_id, routes.route_color)}
PAL = []; PIX = {}
def cix(line):
    c = LCOL.get(line)
    if c is None: return -1
    if c not in PIX: PIX[c] = len(PAL); PAL.append(c)
    return PIX[c]

ev_time = re.compile(r'time="([0-9.]+)"'); ev_type = re.compile(r'type="([^"]+)"')
def attr(line, k):
    m = re.search(k + r'="([^"]*)"', line); return m.group(1) if m else None
veh = {}           # vid -> dict(m, pts=[[t, z, load]])
load = {}
with gzip.open(M + "output_events.xml.gz", "rt", encoding="utf-8") as f:
    for line in f:
        if "<event " not in line: continue
        tm = ev_time.search(line)
        if not tm: continue
        t = float(tm.group(1))
        if t > W1 + 1800: break
        typ = ev_type.search(line).group(1)
        if typ == "TransitDriverStarts":
            v = attr(line, "vehicleId"); veh[v] = dict(m=MODES.index(rmode.get(attr(line, "transitRouteId"), "bus_noac")) if rmode.get(attr(line, "transitRouteId")) in MODES else 4, pts=[], c=cix(attr(line, "transitLineId")))
            load[v] = 0
        elif typ == "PersonEntersVehicle":
            p = attr(line, "person"); v = attr(line, "vehicle")
            if v in load and not p.startswith("pt_"): load[v] += 1
        elif typ == "PersonLeavesVehicle":
            p = attr(line, "person"); v = attr(line, "vehicle")
            if v in load and not p.startswith("pt_"): load[v] -= 1
        elif typ == "VehicleDepartsAtFacility":
            v = attr(line, "vehicle"); fac = attr(line, "facility")
            if v in veh and fac and fac.startswith("s") and t >= W0 - 1800:
                veh[v]["pts"].append([int(t), int(fac[1:]), load.get(v, 0)])
vlist = [[d["m"], [x for p in d["pts"] for x in p], d["c"]] for d in veh.values() if len(d["pts"]) >= 2 and d["pts"][-1][0] >= W0 and d["pts"][0][0] <= W1]
log(scen, "véhicules dans la fenêtre", len(vlist))

# agents : jambes du matin
lg = pd.read_csv(M + "output_legs.csv.gz", sep=";")
def sec(v):
    if isinstance(v, str) and ":" in v: h, m, s = map(int, v.split(":")); return h * 3600 + m * 60 + s
    try: return float(v)
    except Exception: return np.nan
lg["d"] = lg.dep_time.map(sec); lg["t"] = lg.trav_time.map(sec); lg["w"] = lg.wait_time.map(sec) if "wait_time" in lg else 0
lg = lg[(lg.d <= W1) & (lg.d + lg.t >= W0)]
to84 = Transformer.from_crs(2154, 4326, always_xy=True)
x0, y0 = to84.transform(lg.start_x.values, lg.start_y.values); x1, y1 = to84.transform(lg.end_x.values, lg.end_y.values)
MC = {"walk": 0, "transit_walk": 0, "non_network_walk": 0, "bike": 1, "rail": 2, "subway": 3, "tram": 4, "bus_ac": 5, "bus_noac": 6, "cable": 4, "stay": 9}
legs = []
for r, a, b, c, e in zip(lg.itertuples(), x0, y0, x1, y1):
    mc = MC.get(r.mode, 0)
    if mc == 9: continue
    w = 0 if pd.isna(r.w) else int(r.w)
    legs.append([mc, int(r.d), int(r.t), w, round(a, 5), round(b, 5), round(c, 5), round(e, 5)])
log(scen, "trajets d'agents dans la fenêtre", len(legs))
out = dict(scen=scen, w0=W0, w1=W1, veh=vlist, legs=legs, modes=MODES, cols=PAL)
s = json.dumps(out, separators=(",", ":"))
open(f"web/data/msanim_{scen}.js", "w", encoding="utf-8").write(f"window.MSANIM_{scen.upper()}=" + s + ";")
log("écrit", f"web/data/msanim_{scen}.js", round(len(s) / 1e6, 1), "Mo")
