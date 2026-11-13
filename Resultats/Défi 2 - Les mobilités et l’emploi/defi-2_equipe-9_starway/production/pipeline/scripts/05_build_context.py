"""05 - Contexte communal (GEN04, GEN01, SOC01, COST01) et flux domicile-travail vers les pôles (EMP02).

Entrées : data/raw/{GEN04,GEN01,SOC01,EMP02,COST01}/, data/processed/{communes_idf_2026.csv,poles.json,poles_d030.json}
Sorties :
    data/processed/context_communes_2023.csv  (une ligne par origine : parts, totaux, statuts)
    data/processed/flux_poles_2023.csv        (origine × pôle des 15 pôles : actifs occupés résidents qui y travaillent, précision INSEE)
    data/processed/flux_poles_d030_2023.csv   (idem pour les 44 astres)
    data/processed/flux_poles_d030_coverage_2023.json  (où travaillent les actifs occupés : astres, IDF hors astres, hors IDF)
    data/interim/context/{insee}.json         (contrat context/{insee}.json ; copié dans le front par 06)
"""

from __future__ import annotations

import argparse
import json
import shutil
import zipfile

import pandas as pd

from starway.config import (
    AGE_BINS,
    CAR_COST_REASON,
    FILOSOFI_YEAR,
    FRONT_DATA_DIR,
    INTERIM_DIR,
    NAVIGO_MONTH_EUR,
    NAVIGO_PRICE_LABEL,
    NAVIGO_SOURCE_URL,
    NAVIGO_VALIDITY_LABEL,
    POLES_15_JSON,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    RAW_DIR,
    RP_YEAR,
    SKY_DEFAULT,
    sky_poles_json,
)
from starway.context import (
    MODES_ORDER,
    commute_blocks,
    flow_shares_of_destinations,
    flows_block,
    flows_to_poles,
    income_blocks,
    origin_totals,
    population_blocks,
    read_insee_zip_csv,
)
from starway.export import write_json

OUT_DIR = INTERIM_DIR / "context"


def html_text(path) -> str:
    """Texte d'un instantané HTML, balises retirées, espaces (dont insécables) normalisés."""
    import html as _html
    import re

    raw = path.read_text(encoding="utf-8", errors="replace")
    return " ".join(_html.unescape(re.sub(r"<[^>]+>", " ", raw)).split())


def check_codes(name: str, codes: set[str], valid: set[str]) -> None:
    missing, extra = sorted(valid - codes), sorted(codes - valid)
    if missing or extra:
        raise SystemExit(f"{name} : géographie différente de GEO01 2026 (absents {missing[:5]}, en trop {extra[:5]})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--astres", choices=["44", "15"], default=SKY_DEFAULT,
                    help="ciel du `origin_pole` de flows_to_poles (défaut = SKY_DEFAULT : 44 astres) ; les flux des deux "
                         "jeux de pôles sont toujours écrits (context/ est commun aux deux ciels)")
    ap.add_argument("--publish", action="store_true",
                    help="copie les fichiers context/ qui diffèrent dans frontend/public/data/context (écrase, ne supprime "
                         "rien) ; sans cette option 06 les copie en bloc à son prochain export")
    args = ap.parse_args()
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str, "dep": str})
    origins = communes[communes["is_origin"]]["insee"].tolist()
    valid = set(communes["insee"])  # 1 266 communes (dont 75056) + 20 arrondissements

    pop = read_insee_zip_csv(RAW_DIR / "GEN04" / "DS_RP_TD_POPULATION_AGESEX_PRINC_2023_CSV_FR.zip", "_data.csv",
                             {"RP_MEASURE": ["POP"]})
    check_codes("GEN04", set(pop["GEO"]), valid)
    nav = read_insee_zip_csv(RAW_DIR / "GEN01" / "DS_RP_TD_NAVETTES_SEXTRANSPORT_COMP_2023_CSV_FR.zip", "_data.csv",
                             {"AGE": ["Y_GE15"], "EMPSTA_ENQ": ["1"], "WORK_AREA": ["_T"], "WORK_URBAN_AREA": ["_T"],
                              "RP_MEASURE": ["POP"]})
    check_codes("GEN01", set(nav["GEO"]), valid)
    filo = read_insee_zip_csv(RAW_DIR / "SOC01" / "FILOSOFI_CC_csv.zip", "_data.csv",
                              {"FILOSOFI_MEASURE": ["MED_SL", "PR_MD60"]})
    check_codes("SOC01", set(filo["GEO"]), valid)

    html = (RAW_DIR / "COST01" / "forfait-navigo-mois.html").read_text(encoding="utf-8", errors="replace")
    if NAVIGO_PRICE_LABEL.replace(" ", "") not in html.replace(" ", "").replace(" ", ""):
        raise SystemExit(f"Le tarif {NAVIGO_PRICE_LABEL} n'apparaît plus dans l'instantané COST01 : vérifier la page IDFM")
    if NAVIGO_VALIDITY_LABEL not in html:
        raise SystemExit(f"« {NAVIGO_VALIDITY_LABEL} » absent de l'instantané COST01 : vérifier la date du tarif")

    pop_b = population_blocks(pop)
    pop_total = {k: float(v['sex']['total'] or 0) for k, v in pop_b.items()}
    nav_b = commute_blocks(nav, pop_total)
    inc_b = income_blocks(filo)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for insee in origins:
        p, n, i = pop_b.get(insee), nav_b.get(insee), inc_b.get(insee)
        ctx = {
            "insee": insee,
            "processing_version": PROCESSING_VERSION,
            "population_sex": {
                "source": "GEN04", "year": RP_YEAR, "denominator": "population totale (RP, exploitation principale)",
                "total": p["sex"]["total"] if p else None,
                "shares": p["sex"]["shares"] if p else {"F": None, "H": None},
                "unit": "%", "status": p["sex"]["status"] if p else "not_available",
            },
            "population_age": {
                "source": "GEN04", "year": RP_YEAR, "denominator": "population totale (RP, exploitation principale)",
                "bins": [b[0] for b in AGE_BINS], "total": p["age"]["total"] if p else None,
                "shares": p["age"]["shares"] if p else [], "unit": "%",
                "status": p["age"]["status"] if p else "not_available",
            },
            "commute_mode_by_sex": {
                "source": "GEN01", "year": RP_YEAR,
                "denominator": "actifs occupés de 15 ans ou plus résidant dans la commune, de chaque sexe "
                               "(RP, exploitation complémentaire)",
                "F": n["F"] if n else {m: None for m in MODES_ORDER},
                "H": n["H"] if n else {m: None for m in MODES_ORDER},
                "totals": n["totals"] if n else {"F": None, "H": None},
                "other_includes": ["pas de déplacement (travail à domicile)", "deux-roues motorisé"],
                "margin95": n["margin95"] if n else {"F": {m: None for m in MODES_ORDER},
                                                     "H": {m: None for m in MODES_ORDER}},
                "margin95_unit": "points de %",
                "precision_source": "INSEE, fiche « La précision des résultats du recensement » (sept. 2023) : "
                                    "CV = 1/sqrt(0,2 x effectif) sous 10 000 habitants, tableau § 4.2 au-delà ; "
                                    "null si CV non calculable (effectif < 250 en commune de 10 000 hab. ou plus)",
                "unit": "%",
                "status": n["status"] if n else "not_available",
            },
            "income": {
                "source": "SOC01", "year": FILOSOFI_YEAR,
                "median_living_standard_eur": i["median_living_standard_eur"] if i else None,
                "poverty_rate": i["poverty_rate"] if i else None,
                "median_status": i["median_status"] if i else "not_available",
                "poverty_rate_status": i["poverty_rate_status"] if i else "not_available",
                "status": i["status"] if i else "not_available",
            },
            "cost": {
                "transit_month_eur": NAVIGO_MONTH_EUR,
                "transit_label": "forfait Navigo Mois toutes zones (1 à 5), tarif plein",
                "transit_source": "COST01 - IDFM, page « Forfait Navigo Mois » : « Tarifs du forfait applicables au "
                                  "1er janvier 2026 » (instantané du 2026-11-02)",
                "transit_source_url": NAVIGO_SOURCE_URL,
                # vrai depuis les abonnements (D-032, « Mes réglages ») : audit d'affichage du 10/11, lot 7
                "transit_scope": "identique pour toutes les communes ; c'est le forfait toutes zones au plein tarif : "
                                 "d'autres forfaits, des tarifs réduits et la prise en charge par l'employeur sont "
                                 "proposés dans « Mes réglages » ; les forfaits deux zones et quelques autres titres "
                                 "ne le sont pas",
                "car_per_trip_eur": None,
                "car_status": "not_computed",
                "car_reason": CAR_COST_REASON,
                "method": "forfait mensuel publié par IDFM, identique pour toutes les communes (constat, pas un "
                          "calcul par trajet) ; aucun coût voiture",
                "status": "ok",
            },
        }
        write_json(OUT_DIR / f"{insee}.json", ctx)
        rows.append({
            "insee": insee,
            "pop_total": ctx["population_sex"]["total"], "pop_F_pct": ctx["population_sex"]["shares"]["F"],
            "pop_H_pct": ctx["population_sex"]["shares"]["H"], "pop_status": ctx["population_sex"]["status"],
            **{f"age_{b}_pct": (ctx["population_age"]["shares"] or [None] * len(AGE_BINS))[k]
               for k, (b, _, _) in enumerate(AGE_BINS)},
            "actifs_F": ctx["commute_mode_by_sex"]["totals"]["F"], "actifs_H": ctx["commute_mode_by_sex"]["totals"]["H"],
            **{f"mode_{s}_{m}_pct": ctx["commute_mode_by_sex"][s][m] for s in ("F", "H") for m in MODES_ORDER},
            "mode_status": ctx["commute_mode_by_sex"]["status"],
            "median_living_standard_eur": ctx["income"]["median_living_standard_eur"],
            "poverty_rate_pct": ctx["income"]["poverty_rate"],
            "median_status": ctx["income"]["median_status"], "poverty_rate_status": ctx["income"]["poverty_rate_status"],
        })
    df = pd.DataFrame(rows)
    df.to_csv(PROCESSED_DIR / "context_communes_2023.csv", index=False)

    # EMP02 : flux vers les pôles ; la règle de précision citée doit figurer dans l'instantané de la page INSEE
    page = html_text(RAW_DIR / "EMP02" / "page-8998300.html")
    if "les flux faibles (moins de 200) devront être considérés comme des ordres de grandeur" not in page:
        raise SystemExit("règle de précision EMP02 absente de l'instantané page-8998300.html : relire la page INSEE")
    # D-030 : context/ est commun aux deux ciels ; le bloc flows_to_poles porte les identifiants des DEUX jeux de pôles
    # (ids distincts : `P_...` pour les 15 pôles, `BE_...` pour les 44 astres), le front lit par identifiant.
    # `origin_pole` = pôle de la commune dans le ciel `--astres` (défaut SKY_DEFAULT) ; `origin_poles` = dans les deux.
    with zipfile.ZipFile(RAW_DIR / "EMP02" / "base-flux-mobilite-domicile-lieu-travail-2023_csv.zip") as z:
        name = next(n for n in z.namelist() if n.endswith(".csv"))
        flows = pd.read_csv(z.open(name), sep=";", dtype={"CODGEO": str, "DCLT": str})
    flows = flows[flows["CODGEO"].isin(origins)]
    check_codes("EMP02 (origines)", set(flows["CODGEO"]), set(origins))
    actifs = origin_totals(flows)
    skies: dict[str, dict] = {}
    for sky in (args.astres, *(s for s in ("44", "15") if s != args.astres)):
        # D-054 : le ciel à 15 pôles n'est plus un ciel du site (sky_poles_json le refuse), mais context/ et 07 gardent
        # ses flux (data/processed/poles.json, toujours produit par 03 pour les contrôles)
        poles = json.loads((POLES_15_JSON if sky == "15" else sky_poles_json(sky)).read_text(encoding="utf-8"))
        members = {p["id"]: p["communes"] for p in poles}
        fp = flows_to_poles(flows, members)
        fp.to_csv(PROCESSED_DIR / ("flux_poles_2023.csv" if sky == "15" else "flux_poles_d030_2023.csv"), index=False)
        skies[sky] = {"ids": [p["id"] for p in poles], "members": members, "fp": fp}
    # Couverture des 44 astres (D-030) : où travaillent les actifs occupés des communes d'IDF. Ce qui ne se rattache à
    # aucun astre (lieu de travail hors Île-de-France) reste dans le dénominateur et n'est réparti nulle part.
    cov = flow_shares_of_destinations(flows, skies["44"]["members"], valid)
    cov_out = {"source": "EMP02", "year": 2023, "unit": "actifs occupés estimés (somme des flux, non arrondis)",
               "origins": len(set(flows["CODGEO"])), "destination_level": "commune ; arrondissement pour Paris",
               "paris_75056_as_destination": int((flows["DCLT"] == "75056").sum()),
               **{k: round(v, 2) for k, v in cov.items()},
               **{f"{k}_pct": round(100 * v / cov["total"], 2) for k, v in cov.items() if k != "total"}}
    write_json(PROCESSED_DIR / "flux_poles_d030_coverage_2023.json", cov_out)
    for insee in origins:  # ajoute le bloc flows_to_poles aux fichiers context/ écrits ci-dessus
        path = OUT_DIR / f"{insee}.json"
        ctx = json.loads(path.read_text(encoding="utf-8"))
        blocks = {sky: flows_block(insee, s["fp"], s["ids"], s["members"], actifs.get(insee))
                  for sky, s in skies.items()}
        block = blocks[args.astres]
        block["poles"] = {pid: v for b in blocks.values() for pid, v in b["poles"].items()}
        block["origin_poles"] = [p for b in blocks.values() for p in [b["origin_pole"]] if p]
        ctx["flows_to_poles"] = block
        write_json(path, ctx)

    print(f"{len(df)} fichiers context/ écrits dans {OUT_DIR}")
    if args.publish:
        dst = FRONT_DATA_DIR / "context"
        dst.mkdir(parents=True, exist_ok=True)
        changed = 0
        for f in sorted(OUT_DIR.glob("*.json")):
            target = dst / f.name
            if not target.exists() or target.read_bytes() != f.read_bytes():
                shutil.copyfile(f, target)
                changed += 1
        print(f"publié : {changed} fichiers context/ modifiés dans {dst} (aucun fichier supprimé)")
    for col in ("pop_status", "mode_status", "median_status", "poverty_rate_status"):
        print(f"  {col:20} {df[col].value_counts().to_dict()}")
    for sky, s in skies.items():
        print(f"flux origine × pôle ({sky} : {len(s['ids'])} pôles) : {len(s['fp'])} lignes "
              f"({s['fp']['insee'].nunique()} origines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
