"""04k - Recoupement des péages publiés, sans service fermé (consigne de Nicolas du 05/11/2026).

Lit :
- data/processed/toll_tariffs.csv (04j) et frontend/public/data/tolls.json (06) : ce que le site publie ;
- data/raw/TOLL06/ : CSV ouvert d'APRR (data.gouv.fr, Licence Ouverte 2.0) et PDF officiel d'APRR (sha256 contrôlés
  contre data/sources_manifest.csv) ;
- data/peages_releves_manuels.csv : montants relevés à la main (A14, Duplex A86), vide au départ ;
- plus de trajet Achères vers Orly : il se lisait dans le ciel à 15 pôles, archivé (D-054) ; bloc non_calculable.

Écrit :
- data/processed/toll_crosscheck.json (résumé versionné : A5, A14, Duplex A86, Sanef et SAPN, trajet Achères-Orly) ;
- data/processed/toll_crosscheck_a5.csv (un couple et une classe par ligne : site, CSV, PDF avec la page).

Sans relevé manuel, A14 et Duplex A86 sont « non vérifiés » : le script n'écrit jamais une valeur à leur place.
Code de sortie 1 si un écart de montant est trouvé (A5 ou relevé manuel) ou si une ligne de relevé est refusée.
Logique : starway/toll_crosscheck.py (tests/test_toll_crosscheck.py). Usage : python scripts/04k_toll_crosscheck.py
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from starway import toll_crosscheck as cc
from starway import toll_tariffs as tt
from starway.config import (
    DATA_DIR,
    FRONT_DATA_DIR,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    RAW_DIR,
    SERVICE_DATE,
    manifest_rel,
)
from starway.sources import read_manifest, sha256_of

TARIFFS = PROCESSED_DIR / "toll_tariffs.csv"
TOLLS_JSON = FRONT_DATA_DIR / "tolls.json"
APRR_CSV = RAW_DIR / "TOLL06" / "aprr-tarifs-2026-02.csv"
APRR_PDF = RAW_DIR / "TOLL06" / "TARIFS_APRR-2026-02.pdf"
APRR_META = RAW_DIR / "TOLL06" / "dataset-metadata.json"
MANUAL = DATA_DIR / "peages_releves_manuels.csv"
OUT_JSON = PROCESSED_DIR / "toll_crosscheck.json"
OUT_A5 = PROCESSED_DIR / "toll_crosscheck_a5.csv"
TRIP = {"insee": "78551", "commune": "Achères", "pole_id": "P_ORLY", "pole": "Orly"}


def rel(p: Path) -> str:
    return manifest_rel(p)  # chemin du manifeste, dans l'arbre ou sous STARWAY_DATA_ROOT (identique sans la variable)


def check_manifest(files: list[Path]) -> dict[str, str]:
    known = {r["fichier_local"]: r["sha256"] for r in read_manifest()}
    out = {}
    for f in files:
        sha = sha256_of(f)
        if rel(f) not in known:
            raise SystemExit(f"{rel(f)} absent du manifeste (data/sources_manifest.csv)")
        if known[rel(f)] != sha:
            raise SystemExit(f"{rel(f)} : empreinte {sha[:12]} différente du manifeste {known[rel(f)][:12]}")
        out[rel(f)] = sha
    return out


def sanef_sapn_state(tariffs: pd.DataFrame) -> dict[str, dict]:
    """État de chaque point Sanef et SAPN non A14 : nombre de prix publiés et statut, tel qu'écrit par 04j."""
    state = {}
    for p in tt.POINTS:
        if p.systeme in ("SANEF_A4", "SANEF_A1", "SAPN_A13"):
            sub = tariffs[tariffs["systeme"] == p.systeme]
            ok = sub[sub["statut"] == tt.STATUT_OK]
            state[p.point_id] = {"systeme": p.systeme, "lignes_de_prix_publiees": int(len(ok)),
                                 "statuts": sorted(sub["statut"].unique().tolist()),
                                 "etat": "prix publiés" if len(ok) else "null (grille lue, aucune case applicable)",
                                 "raisons": sorted({r for r in sub["raison"].dropna().unique() if r})[:3]}
    return state


def trip_report(tolls: dict, tariffs: pd.DataFrame) -> dict:
    """Le trajet Achères vers Orly passe-t-il par Montesson ? Quelles tranches du Duplex relever ?

    Le pôle P_ORLY appartient au ciel à 15 pôles, archivé (D-054) : access/ ne porte plus que les 44 astres, dont les
    indices ne sont pas ceux de poles.json. Le lire quand même donnerait le trajet vers un autre astre : valeur nulle
    avec une raison, plutôt qu'un résultat faux."""
    poles = json.loads((PROCESSED_DIR / "poles.json").read_text(encoding="utf-8"))  # les 15 pôles, plus publiés
    access = json.loads((FRONT_DATA_DIR / "access" / f"{TRIP['insee']}.json").read_text(encoding="utf-8"))
    where = "frontend/public/data"
    if len(access["car_trip"]["toll"]["out"]) != len(poles):
        return {"trajet": f"{TRIP['commune']} ({TRIP['insee']}) vers {TRIP['pole']} ({TRIP['pole_id']})",
                "status": "non_calculable",
                "reason": "pôle du ciel à 15 pôles, archivé (D-054) : access/ ne porte plus que les 44 astres",
                "passe_par_montesson": None}
    ids = [p["id"] for p in poles]
    i = ids.index(TRIP["pole_id"])
    pts = [p["id"] for p in tolls["points"]]
    report: dict = {"trajet": f"{TRIP['commune']} ({TRIP['insee']}) vers {TRIP['pole']} ({TRIP['pole_id']}, ciel à 15 pôles)",
                    "source": f"{where}/access/78551.json (car_trip.toll), data/processed/poles.json, "
                              "tolls.json ; ces fichiers access/ sont calculés vers les 15 pôles (le calcul vers les 44 "
                              "astres n'est pas lu ici)"}
    for leg, name in (("out", "aller"), ("ret", "retour")):
        cell = access["car_trip"]["toll"][leg][i]
        if isinstance(cell, dict):
            passages = {"statut": cell["s"], "points": [pts[x] for x in cell.get("p", [])]}
        else:
            passages = [[pts[e], pts[s]] for e, s in cell]
        flat = ([pt for c in passages for pt in c] if isinstance(passages, list) else passages["points"])
        report[name] = {"peages_traverses": passages, "passe_par_montesson": "SAPN_A14_MONTESSON" in flat,
                        "distance_m": access["car_trip"]["dist_m"][leg][i]}
    report["passe_par_montesson"] = any(report[n]["passe_par_montesson"] for n in ("aller", "retour"))
    out_cell = access["car_trip"]["toll"]["out"][i]
    if isinstance(out_cell, list) and len(out_cell) == 1 and pts[out_cell[0][0]].startswith("DUPLEX"):
        e, s = out_cell[0]
        free = access["modes"]["car"]["any"]["out"][i]
        report["duplex"] = {"entree": pts[e], "sortie": pts[s], "classe": 1, "jour_de_service": f"{SERVICE_DATE:%Y-%m-%d}",
                            "fenetres_aller": cc.trip_windows(int(free)), "tranches_mardi": {}}
        for tarif in ("standard", "telepeage"):
            grid = [g for g in tolls["grids"] if g["e"] == e and g["s"] == s and g["c"] == 1 and g["t"] == tarif
                    and g["d"] == 0]
            report["duplex"]["tranches_mardi"][tarif] = cc.merge_slots(grid[0]["slots"]) if grid else None
        report["duplex"]["jours_semaine_identiques_aux_fenetres"] = _weekday_check(tariffs, pts[e], pts[s],
                                                                               report["duplex"]["fenetres_aller"])
    return report


def _weekday_check(tariffs: pd.DataFrame, e: str, s: str, windows: list[dict]) -> dict:
    """Pour chaque jour de semaine, les prix du Duplex dans les fenêtres : lundi, mercredi, jeudi et vendredi sont-ils
    identiques au mardi (jour de service) ? Les prix sont lus dans la grille du site, jamais devinés."""
    sub = tariffs[(tariffs["systeme"] == "DUPLEX_A86") & (tariffs["entree_point_id"] == e)
                  & (tariffs["sortie_point_id"] == s) & (tariffs["classe"].astype(int) == 1)
                  & (tariffs["tarif"] == "standard")]
    spans = [tuple(w[k] for k in ("fenetre_route_vide", "fenetre_trafic") if w[k]) for w in windows]
    flat = [(cc._minutes(a), cc._minutes(b)) for sp in spans for a, b in sp]
    lo, hi = min(a for a, _ in flat), max(b for _, b in flat)
    prices: dict[str, list] = {}
    for tj in ("lundi", "mardi", "mercredi", "jeudi", "vendredi"):
        x = sub[sub["type_jour"] == tj]
        prices[tj] = [[r.heure_debut, r.heure_fin, float(r.prix_ttc_eur)] for r in x.itertuples()
                      if cc._minutes(r.heure_debut) < hi and lo < cc._minutes(r.heure_fin)]
    return {"identiques_au_mardi": all(prices[d] == prices["mardi"] for d in prices), "plage": [cc._hhmm(lo),
                                                                                              cc._hhmm(hi)]}


def main() -> int:
    manifest_shas = check_manifest([APRR_CSV, APRR_PDF, APRR_META])
    tariffs = pd.read_csv(TARIFFS, dtype={"heure_debut": str, "heure_fin": str}, encoding="utf-8")
    tolls = json.loads(TOLLS_JSON.read_text(encoding="utf-8"))

    # --- A5 : site contre CSV ouvert et PDF officiel
    names = [p.nom_grille for p in tt.POINTS if p.systeme == "APRR" and p.nom_grille]
    csv_pairs = {k: v for k, v in tt.aprr_csv_pairs(APRR_CSV).items() if k[0] in names and k[1] in names}
    pages = cc.pdf_pages(APRR_PDF)
    pdf_pairs = cc.parse_pdf_pairs_by_page(pages, names)
    a5_rows = cc.a5_crosscheck(tariffs, tolls, csv_pairs, pdf_pairs)
    a5 = cc.a5_summary(a5_rows)
    pdf_csv = cc.pdf_csv_all_classes(csv_pairs, pdf_pairs)
    meta = json.loads(APRR_META.read_text(encoding="utf-8"))
    res = next((r for r in meta["resources"] if r["url"].endswith("/20260802-131933/2026-02.csv")), None)
    sha1_ok = None
    if res:
        import hashlib
        sha1_ok = hashlib.sha1(APRR_CSV.read_bytes()).hexdigest() == res["checksum"]["value"]
    pd.DataFrame(a5_rows).to_csv(OUT_A5, index=False, encoding="utf-8")
    sample = [{"entree": e, "sortie": s, "page_pdf": v["page"], "classe_1": v["values"][1], "classe_5": v["values"][5],
               "csv_classe_1": csv_pairs[(e, s)][1] if (e, s) in csv_pairs else None,
               "csv_classe_5": csv_pairs[(e, s)][5] if (e, s) in csv_pairs else None, "ligne_pdf": v["line"]}
              for (e, s), v in sorted(pdf_pairs.items(), key=lambda kv: (kv[1]["page"], kv[0]))
              if names and any(n in ("LES EPRUNES", "ST-GERMAIN-LAXIS", "CHATILLON-LABORDE", "FORGES",
                                     "MAROLLES-SUR-SEINE") for n in (e, s))][:8]

    # --- A14 et Duplex A86 : relevés manuels
    records, errors = cc.read_manual(MANUAL)
    compared = cc.compare_manual(tariffs, records)
    manual = cc.manual_status(compared, errors)

    report = {
        "contract": cc.CONTRACT, "processing_version": PROCESSING_VERSION,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "regle": ("aucun service fermé : pas de calculateur d'itinéraire commercial, pas de scraping d'un site dont les "
                  "mentions interdisent la réutilisation ; les montants sont recoupés avec des sources ouvertes ou "
                  "officielles (A5) et avec des relevés manuels datés (A14, Duplex A86)"),
        "entrees_sha256": manifest_shas | {rel(TARIFFS): sha256_of(TARIFFS), rel(TOLLS_JSON): sha256_of(TOLLS_JSON)},
        "a5_aprr": {**a5, "ecarts": a5["ecarts"],
                    "sha1_csv_conforme_a_data_gouv": sha1_ok,
                    "pdf_pages_lues": len(pages), "couples_pdf_registre_aprr": len(pdf_pairs),
                    "pdf_contre_csv_toutes_classes": pdf_csv, "extraits_pdf": sample,
                    "csv": rel(OUT_A5)},
        "a14_et_duplex_a86": {"fichier_releves": rel(MANUAL), **manual,
                              "releves_compares": compared},
        "sanef_sapn": sanef_sapn_state(tariffs),
        "trajet_acheres_orly": trip_report(tolls, tariffs),
    }
    OUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"A5 (APRR) : {a5['couples_classes']} couples x classes, verdicts {a5['par_verdict']}")
    print(f"  PDF contre CSV (classes 1 à 5 et distance) : {pdf_csv['couples_communs']} couples communs, "
          f"{len(pdf_csv['couples_avec_ecart'])} avec écart ; seulement dans le PDF : {len(pdf_csv['seulement_pdf'])}")
    print(f"  sha1 du CSV = sha1 publié par data.gouv.fr : {sha1_ok}")
    for road in cc.MANUAL_SCOPES:
        print(f"{road} : {manual[road]['etat']}")
    if errors:
        print("lignes de relevé refusées :", *errors, sep="\n  ")
    for pid, st in report["sanef_sapn"].items():
        print(f"{pid} : {st['etat']} ({st['lignes_de_prix_publiees']} lignes de prix)")
    t = report["trajet_acheres_orly"]
    print(f"{t['trajet']} : passe par Montesson = {t['passe_par_montesson']}")
    bad = bool(a5["ecarts"]) or bool(pdf_csv["couples_avec_ecart"]) or manual["A14"]["ecarts"] or manual["A86"]["ecarts"] \
        or bool(errors) or sha1_ok is False
    print(f"-> {rel(OUT_JSON)}, {rel(OUT_A5)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
