"""Profils types de « La journée de Nadia », tirés de la simulation MATSim.

Chaque agent MATSim est une personne type du recensement (MOBPRO) : catégorie sociale, communes de domicile et de travail,
coordonnées, heure de départ. Pour chaque profil type, on retient l'agent dont le trajet est le plus proche de la médiane
de son groupe, avec une règle reproductible, et ses dix suivants (bouton « une autre personne du même groupe »).

Entrées : matsim/scenario/population.xml.gz ; matsim/output_ordinaire et output_canicule (output_persons, output_trips,
          output_legs, output_transitSchedule) ; GTFS routes.txt (noms des lignes) ; web/data/core.js (arrêts du site).
Sortie  : web/data/profils.js (window.PROFILS = {personas, groupes, source}).
Aucune API externe : tout est calculé à partir des fichiers locaux.
"""
import gzip
import json
import math
import os
import re
from collections import defaultdict

import numpy as np
import pandas as pd
from pyproj import Transformer

from marche_osm import chemin  # marches tracées le long des rues (réseau OSM, scripts/20_reseau_pieton.py)

ICI = os.path.dirname(os.path.abspath(__file__))
RAC = os.path.normpath(os.path.join(ICI, ".."))


def premier(*chemins):
    for c in chemins:
        if os.path.exists(c):
            return c
    raise FileNotFoundError(chemins[0])


OUT = {s: premier(os.path.join(RAC, "matsim", f"output_{s}"), os.path.join(RAC, "..", "hackaviz_idf", "matsim", f"output_{s}")) for s in ("ordinaire", "canicule")}
ROUTES = premier(os.path.join(RAC, "data", "raw", "gtfs", "routes.txt"), os.path.join(RAC, "..", "hackaviz_idf", "data", "raw", "gtfs", "routes.txt"))
L93 = Transformer.from_crs(2154, 4326, always_xy=True)
TC = ("subway", "rail", "tram", "bus_ac", "bus_noac", "cable")
TYM = {"tram": 0, "subway": 1, "rail": 2, "bus_ac": 3, "bus_noac": 3, "cable": 6}
CSN = {"cadre": "Cadre", "inter": "Profession intermédiaire", "employe": "Employé", "ouvrier": "Ouvrier"}
DEP = {"75": "Paris", "77": "Seine-et-Marne", "78": "Yvelines", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d’Oise"}


def secs(h):
    a = h.split(":")
    return int(a[0]) * 3600 + int(a[1]) * 60 + int(a[2])


def lire_csv(scen, nom):
    return pd.read_csv(os.path.join(OUT[scen], nom), sep=";", dtype=str, keep_default_na=False)


def core():
    s = open(os.path.join(RAC, "web", "data", "core.js"), encoding="utf-8").read()
    c = json.loads(s[s.index("=") + 1:].strip().rstrip(";"))["cols"]
    return c


def lignes():
    r = pd.read_csv(ROUTES, dtype=str).fillna("")
    return {x.route_id: (int(x.route_type) if x.route_type.isdigit() else 3, x.route_short_name) for x in r.itertuples()}


def main():
    C = core()
    NC = {co: n for co, n in zip(C["co"], C["c"]) if co and n}
    SLON, SLAT = np.array(C["lon"], float), np.array(C["lat"], float)

    def arret_proche(lon, lat, rmax=120):
        d = np.hypot((SLON - lon) * 73300, (SLAT - lat) * 111320)
        k = int(np.argmin(d))
        return k if d[k] <= rmax else None

    LN = lignes()
    # gares souterraines : arrêts de métro, gares ferrées à moins de 200 m d'un arrêt de métro, et quelques gares RER souterraines sans métro
    MODE = np.array(C["m"])
    METRO = np.where(MODE == "metro")[0]
    SOUT = set(METRO.tolist())
    for k in np.where(MODE == "train")[0]:
        d = np.hypot((SLON[METRO] - SLON[k]) * 73300, (SLAT[METRO] - SLAT[k]) * 111320)
        if d.min() <= 200:
            SOUT.add(int(k))
    RER_SOUT = ("Luxembourg", "Musée d'Orsay", "Musée d’Orsay", "Pont de l'Alma", "Pont de l’Alma", "Nanterre-Préfecture", "Nanterre Préfecture",
                "Avenue Foch", "Avenue Henri Martin", "Haussmann Saint-Lazare", "Magenta", "Rosa Parks")
    for k in np.where(MODE == "train")[0]:
        if any(C["n"][k].startswith(x) for x in RER_SOUT):
            SOUT.add(int(k))
    stopname, SOUT_M = {}, set()
    with gzip.open(os.path.join(OUT["canicule"], "output_transitSchedule.xml.gz"), "rt", encoding="utf-8") as h:
        for l in h:
            m = re.search(r'<stopFacility id="([^"]+)" x="([^"]+)" y="([^"]+)"[^>]* name="([^"]*)"', l)
            if m:
                stopname[m.group(1)] = m.group(4)
                lo, la = L93.transform(float(m.group(2)), float(m.group(3)))
                k = arret_proche(lo, la)
                if k is not None and k in SOUT:
                    SOUT_M.add(m.group(1))
            if "</transitStops>" in l:
                break
    print("arrêts MATSim souterrains :", len(SOUT_M), "sur", len(stopname))

    persons = lire_csv("ordinaire", "output_persons.csv.gz").set_index("person")
    trips = {s: lire_csv(s, "output_trips.csv.gz") for s in OUT}
    legs = {}
    for s in OUT:
        L = lire_csv(s, "output_legs.csv.gz")
        L["trip_n"] = L.trip_id.str.rsplit("_", n=1).str[-1]
        legs[s] = {k: g for k, g in L[L.trip_n.isin(["1", "2"])].groupby(["person", "trip_n"])}

    def trajet(scen, pid, n):
        """Étapes d'un trajet, prêtes pour la scène : marche, attente, à bord (coordonnées WGS84, lignes, arrêts du site)."""
        g = legs[scen].get((pid, str(n)))
        if g is None or (g["mode"] == "stay").all():
            return None
        out = []
        rows = list(g.itertuples())
        for i, e in enumerate(rows):
            dep, tt, w = secs(e.dep_time), secs(e.trav_time), secs(e.wait_time)
            a = L93.transform(float(e.start_x), float(e.start_y))
            b = L93.transform(float(e.end_x), float(e.end_y))
            a, b = [round(a[0], 5), round(a[1], 5)], [round(b[0], 5), round(b[1], 5)]
            if tt + w <= 0:
                continue
            if e.mode == "walk":
                # correspondance dans les couloirs : entre deux étapes souterraines
                pr, nx = rows[i - 1] if i > 0 else None, rows[i + 1] if i + 1 < len(rows) else None
                couloir = bool(pr is not None and nx is not None and pr.egress_stop_id in SOUT_M and nx.access_stop_id in SOUT_M)
                leg = {"k": "walk", "t0": dep, "t1": dep + tt, "a": a, "b": b, **({"in": True} if couloir else {})}
                # forme de la marche : plus court chemin piéton OSM entre ses extrémités (la durée reste celle de MATSim)
                if not couloir and tt >= 30:
                    P = chemin(a, b)
                    if P and len(P) > 2:
                        leg["p"] = P[1:-1]
                out.append(leg)
            elif e.mode == "bike":
                out.append({"k": "bike", "t0": dep, "t1": dep + tt, "a": a, "b": b})
            elif e.mode in TC:
                ty, nm = LN.get(e.transit_line, (TYM.get(e.mode, 3), ""))
                sa, sb = arret_proche(*a), arret_proche(*b)
                if w > 0:
                    out.append({"k": "wait", "t0": dep, "t1": dep + w, "a": a, "s": sa, "sn": stopname.get(e.access_stop_id, ""), "quai": e.mode == "subway" or e.access_stop_id in SOUT_M})
                out.append({"k": "ride", "t0": dep + w, "t1": dep + tt, "a": a, "b": b, "ty": ty, "nm": nm, "noac": e.mode == "bus_noac",
                            "sa": sa, "sb": sb, "na": stopname.get(e.access_stop_id, ""), "nb": stopname.get(e.egress_stop_id, "")})
        return out

    def minutes(seg):
        m = defaultdict(float)
        for x in seg or []:
            d = (x["t1"] - x["t0"]) / 60
            m["couloir" if x.get("in") else "pied" if x["k"] == "walk" else "quai" if x.get("quai") else "attente" if x["k"] == "wait" else "noac" if x.get("noac") else "bord" if x["k"] == "ride" else "velo"] += d
        m["dehors"] = m["pied"] + m["attente"]
        m["tot"] = sum(v for k, v in m.items() if k in ("pied", "couloir", "attente", "quai", "noac", "bord", "velo"))
        return {k: round(v, 1) for k, v in m.items()}

    # ---------- tableau des agents : premier trajet, dans les deux scénarios ----------
    def table(s):
        T = trips[s][trips[s].trip_number == "1"].copy()
        T["stay"] = T.modes.str.contains("stay")
        T["tc"] = T.modes.str.contains("subway|rail|tram|bus|cable")
        T["dep"] = T.dep_time.map(secs) / 60
        T["tt"] = T.trav_time.map(secs) / 60
        return T.set_index("person")
    TO, TCn = table("ordinaire"), table("canicule")
    A = persons.join(TCn[["stay", "tc", "dep", "tt"]], how="inner").join(TO[["stay", "tc", "dep", "tt"]], rsuffix="_o", how="inner")
    # minutes à pied et d'attente du trajet 1 canicule et ordinaire
    def pied_attente(s):
        L = lire_csv(s, "output_legs.csv.gz")
        L = L[L.trip_id.str.endswith("_1")]
        L["tts"] = L.trav_time.map(secs) / 60
        L["ws"] = L.wait_time.map(secs) / 60
        sa, se = L.access_stop_id.isin(SOUT_M), L.egress_stop_id.isin(SOUT_M)
        L.loc[(L["mode"] == "subway") | sa, "ws"] = 0.0  # quai souterrain : à l'abri, pas dehors
        meme = L.person.eq(L.person.shift(1)), L.person.eq(L.person.shift(-1))
        couloir = (L["mode"] == "walk") & meme[0] & meme[1] & se.shift(1, fill_value=False) & sa.shift(-1, fill_value=False)
        g = L.groupby("person")
        return pd.DataFrame({"walk": L[(L["mode"] == "walk") & ~couloir].groupby("person").tts.sum(), "wait": g.ws.sum(),
                             "rail": L[L["mode"] == "rail"].groupby("person").size().reindex(g.size().index).fillna(0) > 0,
                             "noac": L[L["mode"] == "bus_noac"].groupby("person").size().reindex(g.size().index).fillna(0) > 0})
    PA, PAo = pied_attente("canicule"), pied_attente("ordinaire")
    A = A.join(PA, how="left").join(PAo, rsuffix="_o", how="left")
    for c in ("walk", "wait", "walk_o", "wait_o"):
        A[c] = A[c].fillna(0.0)
    A["dept"] = A.home_com.str[:2]
    fen = lambda d: (d >= 390) & (d <= 570)

    # ---------- chiffres de groupe ----------
    groupes = {}
    for cs, nom in CSN.items():
        g = A[A.cs == cs]
        G = g[g.tc & ~g.stay & fen(g.dep) & (g.home_com != g.work_com)]
        part_reste = float(g.stay.mean())
        dehors_pers = float(np.where(g.stay, 0, np.where(g.tc, g.walk + g.wait, 0)).mean())
        groupes[cs] = {"nom": nom, "n": int(len(g)), "reste_canicule": round(100 * part_reste, 1), "reste_ordinaire": round(100 * float(g.stay_o.mean()), 1),
                       "part_tc": round(100 * float((g.tc & ~g.stay).mean()), 1), "med_tt": round(float(G.tt.median()), 1),
                       "med_pied": round(float(G.walk.median()), 1), "med_attente": round(float(G.wait.median()), 1),
                       "med_dehors": round(float((G.walk + G.wait).median()), 1), "dehors_par_personne": round(dehors_pers, 1),
                       "noac_part": round(100 * float(G.noac.mean()), 1)}

    def score(df, med, ordinaire=False):
        tt, w, wa = (df.tt_o, df.walk_o, df.wait_o) if ordinaire else (df.tt, df.walk, df.wait)
        return (tt - med["tt"]).abs() / med["tt"] + (w - med["pied"]).abs() / max(med["pied"], 1) + (wa - med["attente"]).abs() / max(med["attente"], 1)

    def arrets_ok(pid, scen):
        seg = trajet(scen, pid, 1) or []
        return all((x.get("sa") is not None and x.get("sb") is not None) for x in seg if x["k"] == "ride")

    def choisir(key, cs, filtre, ordinaire=False, dept=None):
        g = A[A.cs == cs]
        base = g[(g.home_com != g.work_com)]
        c = base[filtre(base)]
        if dept:
            c2 = c[c.dept.isin(dept)]
            if len(c2) >= 30:
                c = c2
            else:
                print(key, ": moins de 30 candidats avec la contrainte de département, contrainte retirée")
        if ordinaire:
            Go = g[g.tc_o & ~g.stay_o & fen(g.dep_o) & (g.home_com != g.work_com)]
            med = {"tt": float(Go.tt_o.median()), "pied": float(Go.walk_o.median()), "attente": float(Go.wait_o.median())}
        else:
            gg = groupes[cs]
            med = {"tt": gg["med_tt"], "pied": gg["med_pied"], "attente": gg["med_attente"]}
        c = c.assign(score=score(c, med, ordinaire), num=c.index.str[1:].astype(int)).sort_values(["score", "num"])
        retenus = []
        for pid in c.index:
            if arrets_ok(pid, "ordinaire" if ordinaire else "canicule"):
                retenus.append(pid)
            if len(retenus) >= 11:
                break
        print(key, cs, "candidats", len(c), "retenu", retenus[0], "score", round(float(c.loc[retenus[0], "score"]), 3))
        return retenus, len(c), med

    def agent(pid, ordinaire_seul=False):
        p = A.loc[pid]
        t1 = trajet("canicule", pid, 1)
        t2 = trajet("canicule", pid, 2)
        o1 = trajet("ordinaire", pid, 1)
        hx, hy = L93.transform(float(p.first_act_x), float(p.first_act_y))
        dep = str(p.home_com)[:2]
        meme = A[(A.cs == p.cs) & (A.dept == dep) & A.tc & ~A.stay]
        return {"id": pid, "cs": p.cs, "hc": p.home_com, "wc": p.work_com, "hn": NC.get(p.home_com, p.home_com), "wn": NC.get(p.work_com, p.work_com),
                "hd": DEP.get(dep, dep), "wd": DEP.get(str(p.work_com)[:2], ""), "h": [round(hx, 5), round(hy, 5)],
                "reste": t1 is None, "matin": t1, "soir": t2, "habituel": o1, "m_matin": minutes(t1), "m_soir": minutes(t2), "m_habituel": minutes(o1),
                "comme": int(round(len(meme) * 100, -2)) if len(meme) >= 5 else None}

    both = lambda d: d.tc & ~d.stay & fen(d.dep) & d.tc_o & ~d.stay_o & fen(d.dep_o)
    regles = [
        ("nadia", "Nadia", "elle", "employe", lambda d: both(d) & (d.subpopulation == "essentiel") & d.rail, False, ["77", "78", "91", "95"],
         ["aide-soignante", "agente d’entretien", "caissière", "secrétaire médicale"]),
        ("thomas", "Thomas", "il", "ouvrier", lambda d: both(d) & (d.dept != "75") & d.noac, False, None,
         ["préparateur de commandes", "agent de quai", "électricien", "boulanger"]),
        ("sophie", "Sophie", "elle", "inter", lambda d: both(d), False, None,
         ["technicienne de laboratoire", "infirmière", "professeure des écoles", "comptable"]),
        ("karim", "Karim", "il", "cadre", lambda d: both(d), False, None,
         ["ingénieur de chantier", "médecin hospitalier", "chef de projet", "architecte"]),
        ("julie", "Julie", "elle", "cadre", lambda d: d.tc_o & ~d.stay_o & fen(d.dep_o) & d.stay, True, None,
         ["cheffe de projet", "juriste", "consultante", "chargée d’études"]),
    ]
    personas = []
    for key, prenom, genre, cs, f, ordi, dept, metiers in regles:
        ids, n, med = choisir(key, cs, f, ordi, dept)
        personas.append({"key": key, "prenom": prenom, "genre": genre, "cs": cs, "metiers": metiers, "candidats": int(n),
                         "mediane": {k: round(v, 1) for k, v in med.items()}, "agents": [agent(pid) for pid in ids]})
    out = {"source": "Simulation MATSim, 1 % des navetteurs en transport (Insee MOBPRO 2021), journée ordinaire et vigilance rouge",
           "personas": personas, "groupes": groupes}
    open(os.path.join(RAC, "web", "data", "profils.js"), "w", encoding="utf-8").write(
        "window.PROFILS=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";")
    # ---------- vivier : tous les trajets du matin en transport, pour retrouver dans la simulation la personne que l'on crée ----------
    # format compact (chargé à la demande) : agent = [commune domicile, commune travail, catégorie, étapes] ;
    # agent = [domicile, travail, catégorie, aller, retour] ; étape = [type 0 marche / 1 attente / 2 à bord, début (s), durée (s), lon a, lat a, lon b, lat b, ...]
    #   marche : + [couloir 0/1] ; attente : + [arrêt du site, nom, quai 0/1] ; à bord : + [mode GTFS, ligne, arrêt a, arrêt b, nom a, nom b, sans clim 0/1]
    NOMS, NI = [], {}
    def nom(x):
        if x not in NI:
            NI[x] = len(NOMS)
            NOMS.append(x)
        return NI[x]
    CSI = list(CSN)
    q = A[A.cs.isin(CSI) & A.tc & ~A.stay & fen(A.dep) & (A.home_com != A.work_com)]
    q = q.assign(num=q.index.str[1:].astype(int)).sort_values(["cs", "home_com", "work_com", "num"]).groupby(["cs", "home_com", "work_com"]).head(3)
    E = lambda v: int(round(v * 1e5))
    vivier = []
    for pid, r in q.iterrows():
        seg = trajet("canicule", pid, 1)
        if not seg:
            continue
        def code(seg):
            L = []
            for x in seg or []:
                base = [x["t0"], x["t1"] - x["t0"], E(x["a"][0]), E(x["a"][1])]
                if x["k"] in ("walk", "bike"):
                    pp = [c for q in x.get("p", []) for c in (E(q[0]), E(q[1]))]
                    L.append([0] + base + [E(x["b"][0]), E(x["b"][1]), 1 if x.get("in") else 0] + pp)
                elif x["k"] == "wait":
                    L.append([1] + base + [0, 0, -1 if x["s"] is None else x["s"], nom(x["sn"]), 1 if x.get("quai") else 0])
                else:
                    L.append([2] + base + [E(x["b"][0]), E(x["b"][1]), x["ty"], nom(x["nm"]), -1 if x["sa"] is None else x["sa"], -1 if x["sb"] is None else x["sb"],
                                           nom(x["na"]), nom(x["nb"]), 1 if x["noac"] else 0])
            return L
        # trajet du matin et retour du soir (pour la scène « arrivée » : aller et retour)
        vivier.append([r.home_com, r.work_com, CSI.index(r.cs), code(seg), code(trajet("canicule", pid, 2))])
    open(os.path.join(RAC, "web", "data", "profils_vivier.js"), "w", encoding="utf-8").write(
        "window.VIVIER=" + json.dumps({"cs": CSI, "noms": NOMS, "agents": vivier}, ensure_ascii=False, separators=(",", ":")) + ";")
    print("vivier :", len(vivier), "trajets du matin,", len({(v[0], v[1]) for v in vivier}), "couples de communes")
    for p in personas:
        a = p["agents"][0]
        print(p["key"], a["id"], a["hn"], "vers", a["wn"], "reste" if a["reste"] else a["m_matin"])
    print({k: (v["reste_canicule"], v["med_dehors"], v["dehors_par_personne"]) for k, v in groupes.items()})


if __name__ == "__main__":
    main()
