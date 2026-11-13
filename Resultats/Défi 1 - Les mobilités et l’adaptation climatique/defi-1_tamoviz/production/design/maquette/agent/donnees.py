"""Données du guide : statistiques par commune et par IRIS, résultats des mesures MATSim, méthode.
Calculées à partir de web/data avec les mêmes formules que le site (web/app.js, design/maquette/cartogramme.js).
Chargé une fois au démarrage du serveur."""
import json
import os
import time
import unicodedata

RACINE = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DATA = os.path.join(RACINE, "web", "data")
RED = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"]


def charger(nom):
    s = open(os.path.join(DATA, nom), encoding="utf-8").read()
    return json.loads(s[s.index("=") + 1:].strip().rstrip(";"))


def norm(t):
    t = unicodedata.normalize("NFD", str(t).lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn").replace("’", " ").replace("'", " ").replace("-", " ")


def centre(geom):
    xs, ys = [], []

    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for x in c:
                walk(x)
    walk(geom["coordinates"])
    return round((min(ys) + max(ys)) / 2, 5), round((min(xs) + max(xs)) / 2, 5)


class Donnees:
    def __init__(self):
        t0 = time.time()
        IDF, FLOW, CARS, LAY, V2 = (charger(f) for f in ("core.js", "flow.js", "carreaux.js", "layers.js", "volet2.js"))
        c = IDF["cols"]
        n = len(c["id"])
        self.jours = [x["d"] for x in V2["serie"]]
        ired = [self.jours.index(d) for d in RED]

        def score(k):
            pp, nc, aj, df, nvp, acc = c["pp"][k], c["nc"][k], c["aj"][k], c["df"][k], c["nvp"][k], c["acc"][k]
            return sum([pp is not None and pp <= 20, nc is not None and nc * 100 >= 50, aj is not None and aj >= 10,
                        df is None or df > 300, nvp is not None and nvp <= 20, acc == "false"])
        self.score = [score(k) for k in range(n)]
        vref, fi = FLOW["vref"], FLOW["i"]

        def red(k):
            if not (vref[k] and vref[k] > 0 and fi[k]):
                return None
            v = [fi[k][i] for i in ired if fi[k][i] is not None]
            return sum(v) / len(v) if v else None

        zones = {}
        for f in LAY["communes"]["features"]:
            p = f["properties"]
            zones[("com", p["code"])] = dict(unite="commune", code=p["code"], nom=p["nom"].replace(" Arrondissement", ""), commune="",
                                             centre=centre(f["geometry"]), arrets=[], carreaux=[])
        for f in LAY["iris"]["features"]:
            p = f["properties"]
            zones[("iris", p["code_iris"])] = dict(unite="IRIS", code=p["code_iris"], nom=p["nom_iris"], commune=p["nom_commune"],
                                                   centre=centre(f["geometry"]), arrets=[], carreaux=[])
        for k in range(n):
            for u, key in (("com", "co"), ("iris", "ir")):
                z = zones.get((u, c[key][k]))
                if z:
                    z["arrets"].append(k)
        for k in range(len(CARS["ind"])):
            for u, key in (("com", "co"), ("iris", "ir")):
                z = zones.get((u, CARS[key][k]))
                if z:
                    z["carreaux"].append(k)
        ind, ns = CARS["ind"], CARS["ns"]
        for z in zones.values():
            hab = sum(ind[i] or 0 for i in z["carreaux"])
            exp = sum((ind[i] or 0) for i in z["carreaux"] if self.score[ns[i]] >= 3)
            st = z["arrets"]
            fl = [k for k in st if vref[k] and vref[k] > 0 and red(k) is not None]
            W = sum(vref[k] for k in fl)
            z["stats"] = dict(
                habitants=round(hab), habitants_exposes=round(exp),
                part_habitants_exposes_pct=round(100 * exp / hab, 1) if hab else None,
                arrets=len(st), validations_jour_ordinaire=round(sum(vref[k] or 0 for k in st)),
                score_moyen_arrets_sur_6=round(sum(self.score[k] for k in st) / len(st), 2) if st else None,
                semaine_rouge_ecart_voyageurs_pct=round(sum(vref[k] * red(k) for k in fl) / W - 100, 1) if W else None)
            del z["carreaux"]; del z["arrets"]
        self.zones = zones
        self.index = [(norm(z["nom"] + " " + z["commune"]), z) for z in zones.values()]
        M = charger("matsim.js")
        base = M["scen"]["canicule"]
        self.mesures = dict(
            note="Simulation MATSim d’un jour de vigilance rouge, échantillon de 1 % des navetteurs : multiplier les effectifs par 100. Écarts par rapport à la canicule sans mesure.",
            canicule_sans_mesure=dict(dose_moyenne_par_categorie=base.get("dose_cs"), navetteurs_echantillon=base.get("commuters")),
            mesures=[dict(nom=l["label"], navetteurs_tc_en_plus=l["d_commuters"] * 100, montees_en_plus=l["d_boardings"] * 100,
                          dose_totale_ecart_pct=l["d_dose_pct"], dose_moyenne_par_categorie=l.get("dose_cs")) for l in M.get("levers", [])])
        so, sc = M["scen"]["ordinaire"], M["scen"]["canicule"]
        self.simulation = dict(
            note="Simulation MATSim, 1 % des navetteurs (24 147 agents) : multiplier les effectifs par 100. Fenêtre animée : 6 h 30 - 9 h 30.",
            navetteurs_tc=dict(ordinaire=so["commuters"] * 100, vigilance_rouge=sc["commuters"] * 100),
            montees=dict(ordinaire=so["boardings"] * 100, vigilance_rouge=sc["boardings"] * 100),
            teletravail_pct={g: dict(ordinaire=v["o"], vigilance_rouge=v["c"]) for g, v in M["tele"].items()},
            departs_par_quart_heure_depuis_5h=dict(ordinaire=M["hist"]["o"], vigilance_rouge=M["hist"]["c"]),
            indice_frequentation_simule_vs_observe={g: dict(simule=M["group_idx"][g], observe=M["observed"][g]) for g in M["group_idx"]},
            correlation_par_ligne_de_bus=round(M["r_line"], 2) if M.get("r_line") is not None else None,
            dose_chaleur=dict(gini=round(M["dose"]["gini"], 2), part_des_10pct_plus_exposes=round(M["dose"]["top10"] * 100, 1)))
        self.methode = open(os.path.join(RACINE, "docs", "methodologie.md"), encoding="utf-8").read()
        self.duree = round(time.time() - t0, 1)

    # ---------- requêtes ----------
    def fiche(self, z):
        return dict(unite=z["unite"], code=z["code"], nom=z["nom"], commune=z["commune"] or None,
                    lat=z["centre"][0], lon=z["centre"][1], **z["stats"])

    def chercher(self, texte, unite=None, n=6):
        q = norm(texte).strip()
        res = []
        for nm, z in self.index:
            if unite and z["unite"].lower() != unite.lower():
                continue
            if q and q in nm:
                res.append((0 if nm.startswith(q) else 1, len(nm), z))
        res.sort(key=lambda r: (r[0], r[2]["unite"] != "commune", r[1]))
        return [self.fiche(r[2]) for r in res[:n]]

    def classer(self, indicateur, unite="commune", ordre="decroissant", n=10, habitants_min=0, commune=None, departement=None):
        cle = {"validations": "validations_jour_ordinaire", "habitants": "habitants", "habitants_exposes": "habitants_exposes",
               "part_exposes": "part_habitants_exposes_pct", "score": "score_moyen_arrets_sur_6",
               "semaine_rouge": "semaine_rouge_ecart_voyageurs_pct"}[indicateur]
        zs = [z for z in self.zones.values() if z["unite"].lower() == unite.lower() and z["stats"][cle] is not None
              and z["stats"]["habitants"] >= habitants_min
              and (not departement or z["code"].startswith(str(departement)))
              and (not commune or norm(commune) in norm(z["commune"] or z["nom"]))]
        zs.sort(key=lambda z: z["stats"][cle], reverse=(ordre != "croissant"))
        return [self.fiche(z) for z in zs[:max(1, min(n, 30))]]


if __name__ == "__main__":
    D = Donnees()
    print("chargé en", D.duree, "s :", len(D.zones), "zones")
    print(D.chercher("saint-denis")[:2])
    print(D.classer("part_exposes", "commune", n=3, habitants_min=2000))
    print(D.mesures["mesures"][0])
