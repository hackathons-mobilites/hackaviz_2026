"""02b - Analyse des points d'origine (lecture et analyse seulement : le calcul r5py n'est pas modifié).

Compare, pour les 1 285 origines, le centre API Géo actuel (GEO01), la mairie (GEO01, champ `mairie`, position IGN
ADMIN EXPRESS) et le centre de gravité de la population des carreaux INSEE Filosofi 2021 de 200 m (GEO02).
Sorties : data/processed/origin_points_2026.csv et docs/analyse-points-origine.md.
Mémoire : lecture du csv national par morceaux de 4 colonnes, carreaux d'IDF seulement (< 2 Go).
"""

from __future__ import annotations

import json
from datetime import datetime

import numpy as np
import pandas as pd
from pyproj import Transformer

from starway.config import PROCESSED_DIR, RAW_DIR, REPO_ROOT
from starway.geo import load_communes_2026, origins_from
from starway.origin_points import (
    METHOD_GRAVITY,
    assign_cells,
    cell_of,
    quantiles,
    read_idf_cells,
    residential_points,
)

OUT_CSV = PROCESSED_DIR / "origin_points_2026.csv"
OUT_MD = REPO_ROOT / "docs" / "analyse-points-origine.md"


def mairies() -> dict[str, tuple[float, float]]:
    out = {}
    for f in ("communes_idf_mairie.json", "arrondissements_paris_mairie.json"):
        for c in json.loads((RAW_DIR / "GEO01" / f).read_text(encoding="utf-8")):
            if c.get("mairie"):
                out[c["code"]] = tuple(c["mairie"]["coordinates"])
    return out


def main() -> int:
    origins = origins_from(load_communes_2026())  # 1 285 origines, contours GEO01 2026
    cells = read_idf_cells(RAW_DIR / "GEO02" / "Filosofi2021_carreaux_200m_csv.zip")
    to3035 = Transformer.from_crs("EPSG:4326", "EPSG:3035", always_xy=True)
    to_l93 = Transformer.from_crs("EPSG:3035", "EPSG:2154", always_xy=True)
    to_wgs = Transformer.from_crs("EPSG:3035", "EPSG:4326", always_xy=True)

    # Rattachement spatial de chaque carreau à l'origine qui contient son centre (contours 2026)
    cells = assign_cells(cells, origins)
    rp = residential_points(cells)  # règle D-017 (même fonction que 02)
    bary = rp.rename(columns={"e": "h_e", "n": "h_n"}).rename(columns={"g_e": "e", "g_n": "n"})

    # Points actuels et mairies
    ce, cn = to3035.transform(origins["lon"].to_numpy(), origins["lat"].to_numpy())
    df = origins[["insee", "name", "dep", "population", "lon", "lat"]].copy()
    df["c_e"], df["c_n"] = ce, cn
    m = mairies()
    df["mairie_lon"] = [m.get(i, (np.nan, np.nan))[0] for i in df["insee"]]
    df["mairie_lat"] = [m.get(i, (np.nan, np.nan))[1] for i in df["insee"]]
    me, mn = to3035.transform(df["mairie_lon"].to_numpy(), df["mairie_lat"].to_numpy())
    df["m_e"], df["m_n"] = me, mn
    df = df.join(bary, on="insee")
    df["g_lon"], df["g_lat"] = to_wgs.transform(df["e"].to_numpy(), df["n"].to_numpy())

    def dist(e1: str, n1: str, e2: str, n2: str) -> np.ndarray:
        # distances calculées en Lambert-93 (EPSG:2154), en mètres
        x1, y1 = to_l93.transform(df[e1].to_numpy(), df[n1].to_numpy())
        x2, y2 = to_l93.transform(df[e2].to_numpy(), df[n2].to_numpy())
        return np.hypot(x1 - x2, y1 - y2)

    df["d_centre_gravite_m"] = dist("c_e", "c_n", "e", "n").round()
    df["d_mairie_gravite_m"] = dist("m_e", "m_n", "e", "n").round()
    df["d_centre_mairie_m"] = dist("c_e", "c_n", "m_e", "m_n").round()
    inhabited = set(cells.loc[cells["ind"] > 0, "idcar_200m"])
    df["centre_carreau_habite"] = [c in inhabited for c in cell_of(df["c_e"], df["c_n"])]
    df["mairie_carreau_habite"] = [c in inhabited if ok else None
                                   for c, ok in zip(cell_of(np.nan_to_num(df["m_e"]), np.nan_to_num(df["m_n"])),
                                                    df["mairie_lon"].notna(), strict=True)]
    df["gravite_carreau_habite"] = df["method"] == METHOD_GRAVITY  # carreau habité de la même origine
    near_e, near_n = df["h_e"].to_numpy(), df["h_n"].to_numpy()
    df["h_lon"], df["h_lat"] = to_wgs.transform(near_e, near_n)
    df["d_gravite_habite_m"] = dist("e", "n", "h_e", "h_n").round()
    df["d_centre_habite_m"] = dist("c_e", "c_n", "h_e", "h_n").round()
    df["pop_carreaux"] = df["pop_carreaux"].round()
    keep = ["insee", "name", "dep", "population", "pop_carreaux", "lon", "lat", "g_lon", "g_lat", "mairie_lon",
            "mairie_lat", "h_lon", "h_lat", "d_centre_gravite_m", "d_gravite_habite_m", "d_centre_habite_m", "d_mairie_gravite_m", "d_centre_mairie_m", "centre_carreau_habite",
            "mairie_carreau_habite", "gravite_carreau_habite"]
    out = df[keep].copy()
    for c in ("g_lon", "g_lat", "h_lon", "h_lat"):
        out[c] = out[c].round(5)
    out.to_csv(OUT_CSV, index=False)

    # --- Rapport
    q_cg, q_mg, q_cm = (quantiles(out[c]) for c in ("d_centre_gravite_m", "d_mairie_gravite_m", "d_centre_mairie_m"))
    no_g = int(out["g_lon"].isna().sum())
    far = out[out["d_centre_gravite_m"] > 1000].sort_values("d_centre_gravite_m", ascending=False)
    ratio = (out["pop_carreaux"] / out["population"]).dropna()
    n_imp = int((cells["i_est_200"] == 1).sum())

    def km(v: float) -> str:
        return f"{v / 1000:.2f} km".replace(".", ",")

    L = ["# Analyse des points d'origine des communes", "",
         f"Généré le {datetime.now():%d/%m/%Y à %H:%M} par `pipeline/scripts/02b_origin_points_analysis.py` "
         "(analyse seule ; le calcul r5py en cours utilise toujours le centre API Géo). Données par commune : "
         "`data/processed/origin_points_2026.csv`.", "",
         "## Sources", "",
         "- **Centre actuel** : champ `centre` de l'API Géo (GEO01, extrait le 02/11/2026), point d'origine du "
         "calcul en cours.",
         "- **Mairie** : champ `mairie` de l'API Géo (extrait le 02/11/2026). Jeu Etalab « Contours "
         "administratifs » (data.gouv.fr, ODbL) : « la position des mairies est issue du produit d'AdminExpress de "
         "l'IGN ». Les 1er à 4e arrondissements partagent la mairie de Paris Centre.",
         "- **Centre de gravité de la population** : INSEE, « Données au carreau de 200m (y compris données "
         "imputées) », Filosofi 2021, paru le 12/02/2026 (https://www.insee.fr/fr/statistiques/8735162), "
         "fichier csv national (87 Mo compressé), Licence Ouverte (conditions de réutilisation INSEE). Variables "
         "utilisées : `idcar_200m` (identifiant Inspire, coin sud-ouest en EPSG:3035), `ind` (nombre "
         "d'individus), `i_est_200` (carreau imputé), `lcog_geo` (filtre de lecture IDF seulement).", "",
         "## Méthode", "",
         "1. Lecture par morceaux des carreaux de France métropolitaine dont `lcog_geo` contient un code d'IDF "
         f"({len(cells)} carreaux habités retenus après rattachement, dont {n_imp} imputés, `i_est_200 = 1`).",
         "2. Chaque carreau est rattaché à l'origine (commune 2026 ou arrondissement) qui contient son **centre** "
         "(contours GEO01 2026 ; `lcog_geo`, en COG 2021, n'est pas utilisé pour le rattachement).",
         "3. Centre de gravité = moyenne des centres des carreaux pondérée par `ind`, en EPSG:3035.",
         "4. Distances à vol d'oiseau en Lambert-93. « Carreau sans population » = carreau de 200 m absent du "
         "fichier Filosofi (aucun ménage fiscal), ou présent avec `ind = 0`.",
         f"5. Contrôle : population des carreaux / population légale (API Géo) : médiane "
         f"{ratio.median():.3f}, 10e centile {ratio.quantile(0.1):.3f}, 90e centile {ratio.quantile(0.9):.3f} "
         "(Filosofi compte les personnes des ménages fiscaux, hors communautés ; millésime 2021).", "",
         "## Résultats", "",
         f"Origines : {len(out)} ; sans centre de gravité (aucun carreau habité rattaché) : {no_g}.", "",
         "| Distance | Médiane | 90e centile | Maximum |", "|---|---|---|---|",
         f"| centre API Géo - centre de gravité | {km(q_cg['median'])} | {km(q_cg['p90'])} | {km(q_cg['max'])} |",
         f"| mairie - centre de gravité | {km(q_mg['median'])} | {km(q_mg['p90'])} | {km(q_mg['max'])} |",
         f"| centre API Géo - mairie | {km(q_cm['median'])} | {km(q_cm['p90'])} | {km(q_cm['max'])} |", "",
         f"- Centres API Géo actuels dans un carreau **sans population** : "
         f"**{int((~out['centre_carreau_habite']).sum())}** sur {len(out)}.",
         f"- Mairies dans un carreau sans population : {int((out['mairie_carreau_habite'] == False).sum())}.",  # noqa: E712
         f"- Centres de gravité dans un carreau sans population : "
         f"{int((out['gravite_carreau_habite'] == False).sum())} (commune à plusieurs noyaux : le barycentre "  # noqa: E712
         "peut tomber entre deux bourgs, ou dans un carreau rattaché à une commune voisine si la commune est "
         "concave).",
         f"- **Point retenu (D-017)** : centre de gravité, ou à défaut centre du carreau habité de la même origine le "
         "plus proche ; déplacement des "
         f"{int((out['gravite_carreau_habite'] == False).sum())} points concernés : médiane "  # noqa: E712
         f"{km(out.loc[out['d_gravite_habite_m'] > 0, 'd_gravite_habite_m'].median())}, maximum "
         f"{km(out['d_gravite_habite_m'].max())} ; distance au centre API Géo actuel : médiane "
         f"{km(out['d_centre_habite_m'].median())}, 90e centile {km(out['d_centre_habite_m'].quantile(0.9))}, "
         f"maximum {km(out['d_centre_habite_m'].max())}.", "",
         f"### Origines dont le centre actuel est à plus de 1 km du centre de gravité ({len(far)})", "",
         "| Commune | Centre - gravité | Mairie - gravité | Centre habité ? | Population |", "|---|---|---|---|---|"]
    for r in far.itertuples():
        L.append(f"| {r.name} ({r.insee}) | {km(r.d_centre_gravite_m)} | "
                 f"{km(r.d_mairie_gravite_m) if not np.isnan(r.d_mairie_gravite_m) else 'n.d.'} | "
                 f"{'oui' if r.centre_carreau_habite else 'non'} | "
                 f"{f'{int(r.population):,}'.replace(',', ' ') if r.population == r.population else 'n.d.'} |")
    L += ["", "## Limites", "",
          "- Filosofi 2021 décrit la population des ménages fiscaux en 2021 ; la géographie communale est 2026.",
          "- Un carreau à cheval sur deux communes est rattaché en entier à celle qui contient son centre.",
          "- Le centre de gravité est un point moyen : il ne correspond pas forcément à une adresse habitée "
          "(voir la ligne « centres de gravité dans un carreau sans population »).",
          "- Aucun de ces points n'est un lieu de domicile individuel : ils résument la répartition de la population."]
    OUT_MD.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"{OUT_CSV.name} et {OUT_MD.name} écrits ; centre-gravité médiane {q_cg['median']:.0f} m, p90 "
          f"{q_cg['p90']:.0f} m, max {q_cg['max']:.0f} m ; > 1 km : {len(far)} ; centres non habités : "
          f"{int((~out['centre_carreau_habite']).sum())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
