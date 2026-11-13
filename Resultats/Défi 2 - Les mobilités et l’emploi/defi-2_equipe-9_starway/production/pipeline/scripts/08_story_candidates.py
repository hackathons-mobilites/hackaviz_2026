"""08 - Candidats pour les communes du récit (actes 1 à 3) : analyse seule, AUCUN export vers le front.

Lit la matrice TC publiée (lots terminés, starway.matrix_io, lecture seule) et écrit docs/candidats-recit.md :
  1. éclipses : postes accessibles (aller ET retour) en 9h-17h perdus en 6h-14h ou en 14h-22h ;
  2. deux horizons : paires de communes de même classe de population ET de même classe de distance au centre de
     Paris, aux ciels les plus différents en 9h-17h.
Méthode et limites écrites dans le rapport. Si la matrice TC est partielle, le rapport est marqué PROVISOIRE.
Les lignes dont le verdict repose sur un retour non mesuré (limite de marche finale de R5, d'après 07b, même règle
que l'export 06) sont sorties des classements et comptées à part.

Usage : python scripts/08_story_candidates.py [--top 15] [--classes 10 5]
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime

import pandas as pd
from pyproj import Transformer

from starway.config import BUDGETS_MIN, PROCESSED_DIR, REPO_ROOT
from starway.egress import walk_limit_marks
from starway.geo import SKY_CENTER_LONLAT
from starway.matrix_io import load_published
from starway.origin_points import origin_points_sha256
from starway.sources import read_manifest
from starway.story import cells_from_matrix, eclipse_rows, pair_rows

OUT = REPO_ROOT / "docs" / "candidats-recit.md"
DAY_LABEL = {"d06": "6h-14h", "d09": "9h-17h", "d14": "14h-22h"}


def fmt(n: float) -> str:
    return f"{int(n):,}".replace(",", " ")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--top", type=int, default=15, help="lignes affichées par tableau (affichage seulement)")
    p.add_argument("--classes", type=int, nargs="+", default=[10, 5],
                   help="nombres de classes de quantiles pour les paires ; le premier est le principal")
    args = p.parse_args()

    poles = json.loads((PROCESSED_DIR / "poles.json").read_text(encoding="utf-8"))
    pole_ids = [x["id"] for x in poles]
    names = [x["name"] for x in poles]
    jobs = [int(x["jobs"]) for x in poles]
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str, "dep": str})
    origins = communes[communes["is_origin"]].copy()
    tr = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    cx, cy = tr.transform(*SKY_CENTER_LONLAT)
    xs, ys = tr.transform(origins["lon"].to_numpy(), origins["lat"].to_numpy())
    origins["dist_km"] = [round(math.hypot(x - cx, y - cy) / 1000, 1) for x, y in zip(xs, ys, strict=True)]
    info = origins.set_index("insee")

    sha = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] in ("TRA01", "CYC01")}
    ld = load_published(pole_ids, origins["insee"].tolist(), sha, points_sha=origin_points_sha256(origins))
    tc = ld.coverage.get("transit", [])
    n_all = len(origins)
    partial = len(tc) < n_all
    eg_path, net_path = PROCESSED_DIR / "egress_limit_2026.csv", PROCESSED_DIR / "egress_limit_network_sample.csv"
    marks = walk_limit_marks(pd.read_csv(eg_path, dtype={"insee": str, "day": str}),
                             pd.read_csv(net_path, dtype={"insee": str, "day": str}) if net_path.exists() else None
                             ) if eg_path.exists() else {}
    cells = {d: cells_from_matrix(ld.matrices[("transit", d)], pole_ids, [i for i, dd in marks if dd == d])
             for d in ("d06", "d09", "d14") if ("transit", d) in ld.matrices}
    by_commune = {i: {d: cells[d][i] for d in cells if i in cells[d]} for i in tc}

    def label(i: str) -> str:
        r = info.loc[i]
        return f"{r['name']} ({i})"

    rp = json.loads((REPO_ROOT / "data" / "interim" / "matrix" / "run_params.json").read_text(encoding="utf-8"))
    rule = rp.get("origin_point_rule") or "centre API Géo (avant D-017)"
    lines = ["# Candidats pour les communes du récit (actes 1 à 3)", "",
             f"> Point de départ des communes dans ce calcul : **{rule}** (empreinte "
             f"`{(rp.get('origin_points_sha256') or 'absente')[:12]}`, date de service {rp['service_date']}).", ""]
    if partial:
        lines += [f"> **PROVISOIRE** : la matrice TC n'est publiée que pour **{len(tc)} origines sur {n_all}** "
                  "(lots terminés du calcul en cours, dans l'ordre croissant des codes INSEE). Les classements "
                  "ci-dessous ne valent que pour ces communes et **ne doivent pas servir au choix** avant la fin "
                  "du calcul. Relancer `python scripts/08_story_candidates.py` ensuite.", ""]
    lines += [f"Généré le {datetime.now():%d/%m/%Y à %H:%M} par `pipeline/scripts/08_story_candidates.py` "
              "(analyse seule, aucun export vers le front). Mode : transports en commun + marche. "
              f"Budgets : {', '.join(map(str, BUDGETS_MIN))} min par sens.", "",
              "## Méthode", "",
              "- **Accessible** = aller ET retour chacun dans le budget (règle de vérité n° 3), postes salariés "
              "recensés par l'INSEE dans les 15 pôles (Flores 2023).",
              "- **Éclipse** : pour chaque commune et chaque journée 6h-14h ou 14h-22h, postes accessibles en 9h-17h "
              "qui ne le sont plus. Budget retenu : celui où la perte est maximale (à égalité, le plus petit). "
              "**Robuste** : perte présente à au moins deux budgets (même règle que `insights.json`). Classement : "
              "robustes d'abord, puis postes perdus décroissants. La colonne « pôles éteints » dit si c'est l'aller "
              "(arrivée avant le début) ou le retour (départ après la fin) qui sort du budget.",
              "- **Deux horizons** : paires de communes de la **même classe de population** (population légale, "
              "API Géo) **et** de la **même classe de distance** au point zéro de Paris (parvis de Notre-Dame, "
              "distance à vol d'oiseau entre centres, Lambert-93). Les classes sont des **quantiles** calculés sur "
              f"les communes publiées : {args.classes[0]} classes (déciles) pour le tableau principal"
              + (f", {', '.join(map(str, args.classes[1:]))} classes pour vérifier la sensibilité" if args.classes[1:]
                 else "") + ". Ce nombre de classes est un choix de granularité de l'analyse, affiché comme tel ; "
              "il ne fabrique aucun écart. Écart = postes accessibles en 9h-17h, au budget où il est maximal ; "
              "robuste = écart à au moins deux budgets.",
              "- **Retours non mesurés** : une ligne dont le verdict, au budget retenu, repose sur un retour nul que "
              "le moteur ne pouvait pas trouver (aucun arrêt desservi à moins de 2 km de marche du point de la "
              "commune, limite de R5 ; `docs/analyse-limite-marche-r5.md`, même règle que l'export) est sortie du "
              "classement et comptée à part. "
              + ("Classement 07b introuvable : aucune ligne sortie." if not marks else
                 f"{len(marks)} couples commune × journée concernés d'après 07b."),
              "- Aucun seuil : on classe des écarts qui existent dans la matrice. Rien ici n'explique la cause d'un "
              "écart (desserte, horaires, géographie) : c'est à vérifier trajet par trajet (application IDFM, "
              "Navitia) avant tout usage dans le récit.", ""]

    ecl_all = eclipse_rows(by_commune, jobs, list(BUDGETS_MIN), names)
    ecl = ecl_all[~ecl_all["unmeasured"]].reset_index(drop=True)
    n_um = int(ecl_all["unmeasured"].sum())
    lines += ["## 1. Éclipses (acte 2)", "",
              f"{len(ecl)} couples commune × journée avec une perte, dont {int(ecl['robust'].sum())} robustes "
              f"({n_um} autres sortis du classement : verdict reposant sur un retour non mesuré).", ""]
    if len(ecl):
        lines += ["| Rang | Commune | Journée | Budget | Postes 9h-17h | Postes journée | Perdus | Robuste | Pôles éteints |",
                  "|---|---|---|---|---|---|---|---|---|"]
        for k, r in ecl.head(args.top).iterrows():
            lines.append(f"| {k + 1} | {label(r['insee'])} | {DAY_LABEL[r['day']]} | {r['budget']} min | "
                         f"{fmt(r['jobs_ref'])} | {fmt(r['jobs_day'])} | {fmt(r['jobs_lost'])} | "
                         f"{'oui' if r['robust'] else 'non'} | {r['poles_off']} |")
    lines.append("")

    pinfo = origins[["insee", "population", "dist_km"]].dropna()
    ref_cells = cells.get("d09", {})
    ref_cells = {i: c for i, c in ref_cells.items() if i in set(tc)}
    for n_cls in args.classes:
        pairs_all = pair_rows(ref_cells, pinfo, jobs, list(BUDGETS_MIN), n_cls)
        pairs = pairs_all[~pairs_all["unmeasured"]].reset_index(drop=True)
        main_tbl = n_cls == args.classes[0]
        lines += [f"## {'2' if main_tbl else '2 bis'}. Deux horizons (acte 3), {n_cls} classes de quantiles", "",
                  f"{len(pairs)} paires comparables avec un écart, dont {int(pairs['robust'].sum())} robustes "
                  f"({int(pairs_all['unmeasured'].sum())} autres sorties du classement : retour non mesuré).", ""]
        if len(pairs):
            lines += ["| Rang | Moins reliée | Plus reliée | Pop. | Distance (km) | Budget | Postes | Écart | Robuste |",
                      "|---|---|---|---|---|---|---|---|---|"]
            for k, r in pairs.head(args.top if main_tbl else max(5, args.top // 3)).iterrows():
                a, b = info.loc[r["o"]], info.loc[r["vs"]]
                lines.append(f"| {k + 1} | {label(r['o'])} | {label(r['vs'])} | {fmt(a['population'])} / "
                             f"{fmt(b['population'])} | {a['dist_km']} / {b['dist_km']} | {r['budget']} min | "
                             f"{fmt(r['jobs_o'])} / {fmt(r['jobs_vs'])} | {fmt(r['jobs_gap'])} | "
                             f"{'oui' if r['robust'] else 'non'} |")
        lines.append("")
    lines += ["## Limites", "",
              "- Matrice théorique (GTFS du mardi 17/11/2026), point d'origine = centre de la commune, un pôle = un "
              "point ; voir `docs/limites.md`.",
              "- Point de départ : celui du calcul qui a produit les lots lus (`meta.dataset_id`, `run_params.json`). "
              "Depuis D-017, c'est le centre de gravité de la population (INSEE Filosofi 2021) ; avant, le centre API "
              "Géo, souvent loin de l'habitat (637 centres sur 1 285 dans un carreau sans population, "
              "`docs/analyse-points-origine.md`). Vérifier le point de départ de chaque candidat sur la carte miroir.",
              "- Les classes de comparabilité ne tiennent compte ni du revenu, ni de la structure d'âge, ni de "
              "l'emploi local : « comparable » veut dire seulement « même classe de population et de distance ».",
              "- Choix final des communes : décision humaine (D-005), à consigner dans `docs/decisions.md`."]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{OUT} écrit : TC publié pour {len(tc)}/{n_all} origines ; {len(ecl)} éclipses"
          + (" (PROVISOIRE)" if partial else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
