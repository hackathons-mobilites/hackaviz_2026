"""08e - Découvertes (insights.json) des 44 astres, sur la table commune x commune agrégée par astre (D-030, D-041).

Lit en LECTURE SEULE la table publiée (`frontend/public/data/od_walk3000/` : index.json + o/{insee}.bin), `poles.json` des
44 astres (racine de `frontend/public/data/`), `meta.json` (journées-types, budgets) et le recoupement Navitia de l'ancien
ciel. Aucun appel réseau, jamais PRIM.

Par défaut (essai) : n'écrit RIEN dans `frontend/` ; sortie dans `data/interim/insights_astres44/` :
  insights.json         les découvertes (contrat insights.json, `crosscheck` = not_checked : aucun recoupement des 44 astres)
  meta_insights.json    le bloc `meta.insights` (types, portée, découvertes contredites sur l'ancien ciel, paramètres)
  reach_astres.csv      par origine, journée-type et budget : postes atteints, aller seul, astres atteints (table de travail)

À LANCER APRÈS LA PUBLICATION DU 6h-14h CORRIGÉ (PR 53 `data/horaires-nuit`, recalcul VM terminé, tables `od_walk*` de
`frontend/public/data/` republiées par `06d`), « Refais les découvertes et les chiffres de la visite après cette
publication » (Nicolas, 05/11) :
    cd pipeline
    python scripts/08e_insights_astres.py                         # essai, tables publiées, rien n'est écrit dans frontend/
    python scripts/08e_insights_astres.py --publish --apres-6h-14h-corrige
puis `python scripts/07_quality_checks.py` (aucun P0 en échec), tests (`pytest`) et front (voir docs/passation-copilot.md § 4.15).
`--publish` écrit `frontend/public/data/insights.json` et remplace le bloc `insights` de `frontend/public/data/meta.json`
(rien d'autre) ; il refuse sans l'option `--apres-6h-14h-corrige` (les découvertes d'un 6h-14h incomplet seraient fausses).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from starway import insights_astres as ia
from starway.config import FRONT_DATA_DIR, INTERIM_DIR, PROCESSED_DIR
from starway.export import write_json

DEFAULT_OUT = INTERIM_DIR / "insights_astres44"


def _worker(args: tuple) -> ia.OriginResult:
    path, n_dest, jobs, group_of, mode_code, days, budgets, lookback, insee = args
    return ia.origin_reach(ia.read_swod(path), n_dest, jobs, group_of, mode_code, days, budgets, lookback, insee)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--od-dir", type=Path, default=FRONT_DATA_DIR / "od_walk3000", help="table publiée (réglage normal)")
    p.add_argument("--front", type=Path, default=FRONT_DATA_DIR, help="dossier du ciel à 44 astres (poles.json, meta.json)")
    p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--origins", default=None, help="essai : codes INSEE séparés par des virgules (défaut : toutes)")
    p.add_argument("--top", type=int, default=10, help="découvertes gardées par type")
    p.add_argument("--publish", action="store_true", help="écrit insights.json et meta.insights dans --front")
    p.add_argument("--navitia-checks", type=Path, default=None,
                   help="résumé de 07d (insight_checks) : statut de recoupement de chaque découverte, par scénario")
    p.add_argument("--navitia-table", type=Path, default=None,
                   help="résumé de tools/prim/recoupement_decouvertes_table_10_11.py : une découverte contredite par 07d n'est "
                        "écartée que si elle reste contredite sur la table commune x commune")
    p.add_argument("--apres-6h-14h-corrige", action="store_true",
                   help="obligatoire avec --publish : le 6h-14h corrigé (courses de nuit, PR 53) est publié")
    args = p.parse_args()
    if args.publish and not args.apres_6h_14h_corrige:
        raise SystemExit("--publish refusé : à lancer après la publication du 6h-14h corrigé (--apres-6h-14h-corrige)")
    if args.publish and args.origins:
        raise SystemExit("--publish refusé avec --origins (essai partiel)")

    index = ia.load_json(args.od_dir / "index.json")
    astres = ia.load_json(args.front / "poles.json")
    meta = ia.load_json(args.front / "meta.json")
    codes: list[str] = index["communes"]
    jobs: list[int] = index["jobs"]
    mode = next((m for m in index["modes"] if m["id"] == "transit"), None)
    if mode is None or mode["kind"] != "series" or not index["coverage"]["transit"]["complete"]:
        raise SystemExit("table commune x commune sans série TC complète : découvertes impossibles")
    group_of = ia.group_of_communes(codes, astres)
    if group_of != index["pole_of"]:
        raise SystemExit("index.pole_of différent de poles.json : la table n'est pas celle des 44 astres affichés")
    if len(astres) != 44:
        raise SystemExit(f"{len(astres)} astres au lieu de 44 : ce script est celui du ciel à 44 astres")
    days = ia.day_specs(meta["day_types"])
    budgets = [int(b) for b in meta["budgets"]]
    lookback = int(index["outbound_lookback_min"])

    origins = [c for c in codes if not args.origins or c in args.origins.split(",")]
    jobs_args = [(args.od_dir / "o" / f"{c}.bin", len(codes), jobs, group_of, mode["code"], days, budgets, lookback, c)
                 for c in origins]
    res: dict[str, ia.OriginResult] = {}
    with ProcessPoolExecutor(max_workers=max(1, args.workers)) as ex:
        for k, r in enumerate(ex.map(_worker, jobs_args, chunksize=8), start=1):
            res[r.insee] = r
            if k % 200 == 0:
                print(f"  {k} origines sur {len(origins)}", flush=True)

    adj = [(r["insee_a"], r["insee_b"]) for r in _read_csv(PROCESSED_DIR / "adjacency_2026.csv")]
    adj = [(a, b) for a, b in adj if a in res and b in res]
    day_ids = [d.id for d in days]
    crosscheck_of, exclude = navitia_verdicts(args.navitia_checks, args.navitia_table)
    items, excluded = ia.compute_insights(res, budgets, day_ids, adj, jobs, group_of, codes, args.top, exclude=exclude)
    n_usable = sum(1 for c in res if all(ia._usable(res, c, d, budgets) for d in day_ids))
    kinds = ia.kinds_status(len(origins), n_usable, ia.bike_transit_origins(meta), len(astres))
    ok_kinds = {k for k, v in kinds.items() if v["status"] == "ok"}
    items = [x for x in items if x["kind"] in ok_kinds]  # jamais un classement partiel
    out_items = ia.published_items(items, crosscheck_of)
    params = {"od_dir": args.od_dir.name, "od_dataset_id": index.get("dataset_id"), "od_generated_at": index.get("generated_at"),
              "budgets": budgets, "days": day_ids, "top_per_kind": args.top, "origins": len(origins),
              "origins_with_verdict": n_usable, "astres": len(astres), "reference_day": ia.REFERENCE_DAY}
    block = ia.meta_insights_block(out_items, kinds, params, [x for x in excluded if x["kind"] in ok_kinds])
    for x in block["excluded"]:
        print(f"découverte écartée (contredite par Navitia, sur access/ puis sur la table) : {x['would_be_id']} {x['scenario']}")

    problems = ia.check_published(block, out_items, budgets, codes)
    old_ids = _old_pole_ids()
    text = json.dumps([out_items, block], ensure_ascii=False)
    cited = sorted(i for i in old_ids if f'"{i}"' in text)
    if cited:
        problems.append(f"identifiants de pôles de l'ancien ciel cités : {cited}")
    if problems:
        raise SystemExit("contrôles en échec : " + "; ".join(problems))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_json(args.out_dir / "insights.json", out_items)
    write_json(args.out_dir / "meta_insights.json", block)
    _write_reach(args.out_dir / "reach_astres.csv", res)
    report(out_items, kinds, len(origins), n_usable, codes, args.front)
    print(f"écrit : {args.out_dir}")
    if args.publish:
        write_json(args.front / "insights.json", out_items)
        meta["insights"] = block
        write_json(args.front / "meta.json", meta)
        print(f"PUBLIÉ : {args.front / 'insights.json'} et meta.insights de {args.front / 'meta.json'}")
    return 0


def navitia_verdicts(checks: Path | None, table: Path | None) -> tuple[dict[tuple[str, str], str], set[tuple[str, str]]]:
    """(statut publié par scénario, scénarios écartés). 07d : `confirmed` ou `within_one_minute` publiés tels quels ;
    `contradicted` : jugé sur la table commune x commune (base réelle des découvertes) ; confirmée là, elle est publiée
    `confirmed` ; contredite là aussi, elle est écartée et remplacée par la suivante, jamais ajustée (décision du 10/11)."""
    if checks is None:
        return {}, set()
    rows = json.loads(checks.read_text(encoding="utf-8"))["insight_checks"]
    table_doc = json.loads(table.read_text(encoding="utf-8")) if table is not None else {}
    table_v = table_doc.get("verdicts", {})
    status: dict[tuple[str, str], str] = {}
    exclude: set[tuple[str, str]] = {ia.scenario_key(j) for j in table_doc.get("judged", {}).values()
                                     if j.get("verdict") == "contredite_sur_la_table"}
    for r in rows:  # publiées et écartées revérifiées (libellé « excluded:<id> ») : jugées pareil, par scénario
        key = ia.scenario_key(r)
        v = r.get("verdict")
        if v in ("confirmed", "within_one_minute"):
            status[key] = v
        elif v == "contradicted":
            tv = table_v.get(r.get("label", r["id"]))
            if tv == "confirmee_sur_la_table":
                status[key] = "confirmed"
            elif tv == "contredite_sur_la_table":
                exclude.add(key)
    return status, exclude


def _read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def _old_pole_ids() -> set[str]:
    path = PROCESSED_DIR / "poles.json"
    return {p["id"] for p in ia.load_json(path)} if path.exists() else set()


def _write_reach(path: Path, res: dict[str, ia.OriginResult]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["insee", "day", "budget", "reached_jobs", "out_only_jobs", "astres_reached", "astres_out_only", "unknown_jobs"])
        for insee in sorted(res):
            for (day, b), r in sorted(res[insee].reach.items()):
                w.writerow([insee, day, b, r.reached, r.out_only, r.lit, r.out_only_astres, r.unknown])


def report(items: list[dict], kinds: dict, n_origins: int, n_usable: int, codes: list[str],
           front: Path) -> None:
    names = {}
    cpath = front / "communes.json"
    if cpath.exists():
        names = {c["insee"]: c["name"] for c in ia.load_json(cpath)}
    print(f"origines : {n_origins}, avec verdict complet : {n_usable}")
    for k, v in kinds.items():
        print(f"  {k:16} {v['status']:12} {v.get('scope') or v.get('reason')}")
    for kind in ia.KINDS:
        sel = [x for x in items if x["kind"] == kind]
        print(f"[{kind}] {len(sel)} découvertes")
        for x in sel[:3]:
            sc, m = x["scenario"], x["metric"]
            who = names.get(sc["o"], sc["o"]) + (f" / {names.get(sc['vs'], sc['vs'])}" if sc["vs"] else "")
            print(f"   {x['id']} {who} {sc['d']} {sc['b']} min : {m['poles_delta']:+d} astres, {m['jobs_delta']:+,} postes"
                  f" (robuste {x['robust']})")


if __name__ == "__main__":
    sys.exit(main())
