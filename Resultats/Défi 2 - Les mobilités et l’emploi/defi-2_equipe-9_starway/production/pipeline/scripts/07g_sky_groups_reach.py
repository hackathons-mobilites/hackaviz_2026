"""07g - D-030 (PROPOSÉE) : part des postes atteinte par astre, pôles actuels contre bassins d'emploi (aperçu).

Lit en LECTURE SEULE la table OD publiée (frontend/public/data/od_walk3000/ par défaut : index.json + o/{insee}.bin) et
data/processed/poles_d030.json (03b, 44 astres). Applique la règle du front (`frontend/src/data/od/compute.ts`, portée
dans `starway.sky_groups` : `dest_status`, `od_states`, `group_shares`) pour un scénario, avec deux découpages :
les 15 pôles publiés (`index.pole_of`) et les 44 astres D-030 (communes de poles_d030.json).

Sortie : data/processed/sky_groups_v2_reach_{insee}_{debut}-{fin}_{budget}_{mode}.csv (une ligne par astre et par
découpage) ; résumé à l'écran. Rien n'est écrit dans frontend/.

Usage : python scripts/07g_sky_groups_reach.py --origin 78358 --start 09:00 --end 17:00 --budget 60
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

import pandas as pd

from starway import od_export as ox
from starway import sky_groups as sg
from starway.config import FRONT_DATA_DIR, PROCESSED_DIR


def hhmm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--origin", default="78358", help="code INSEE de l'origine (défaut : Maisons-Laffitte)")
    p.add_argument("--start", default="09:00")
    p.add_argument("--end", default="17:00")
    p.add_argument("--budget", type=int, default=60, help="minutes par sens")
    p.add_argument("--mode", default="transit")
    p.add_argument("--od-dir", type=Path, default=FRONT_DATA_DIR / "od_walk3000", help="table publiée (lecture)")
    p.add_argument("--preview", type=Path, default=PROCESSED_DIR / "poles_d030.json")
    args = p.parse_args()

    index = json.loads((args.od_dir / "index.json").read_text(encoding="utf-8"))
    codes: list[str] = index["communes"]
    mode = next((m for m in index["modes"] if m["id"] == args.mode), None)
    if mode is None or mode["kind"] != "series":
        raise SystemExit(f"mode {args.mode} absent de {args.od_dir} ou sans horaire (ce script lit les séries TC)")
    if not index["coverage"][args.mode]["complete"]:
        raise SystemExit(f"mode {args.mode} incomplet dans {args.od_dir}")
    raw = (args.od_dir / "o" / f"{args.origin}.bin").read_bytes()
    pf = ox.parse_file(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)
    if codes[pf.origin] != args.origin:
        raise SystemExit("origine du fichier différente de l'origine demandée")
    start, end = hhmm(args.start), hhmm(args.end)
    states = sg.od_states(pf, len(codes), mode["code"], start, end, args.budget, index["outbound_lookback_min"])
    jobs = index["jobs"]

    preview = json.loads(args.preview.read_text(encoding="utf-8"))
    where = {c: i for i, g in enumerate(preview) for c in g["communes"]}
    v2_of = [where.get(c) for c in codes]
    if any(v is None for v in v2_of):
        raise SystemExit("aperçu : des communes n'ont pas de groupe")
    rows = []
    for split, group_of, groups in (("poles_actuels", index["pole_of"], index["poles"]),
                                    ("astres_d030", v2_of, preview)):
        shares = sg.group_shares(states, jobs, group_of, [g["jobs"] for g in groups])
        names = {pl["id"]: pl.get("name_short", pl.get("name")) for pl in preview}
        if split == "poles_actuels":
            cur = json.loads((args.od_dir.parent / "poles.json").read_text(encoding="utf-8"))
            names = {pl["id"]: pl["name"] for pl in cur}
        for g, s in zip(groups, shares):
            rows.append({"decoupage": split, "id": g["id"], "name": names.get(g["id"]), **s,
                         "share_pct": None if s["share"] is None else round(100 * s["share"], 1)})
    df = pd.DataFrame(rows).drop(columns="share")
    reached_all = sum(int(j) for j, s in zip(jobs, states) if s == "accessible")
    self_jobs = sum(int(j) for j, s in zip(jobs, states) if s == "self")
    unknown = sum(int(j) for j, s in zip(jobs, states) if s == "unknown")
    total = sum(int(j) for j in jobs)
    tag = f"{args.origin}_{args.start.replace(':', '')}-{args.end.replace(':', '')}_{args.budget}_{args.mode}"
    out = PROCESSED_DIR / f"sky_groups_v2_reach_{tag}.csv"
    df.to_csv(out, index=False)

    print(f"{args.origin} {args.start}-{args.end}, {args.budget} min par sens, {args.mode} ({args.od_dir.name}) :")
    print(f"  postes atteints aller et retour, toute l'IDF : {reached_all:,} sur {total:,} "
          f"({100 * reached_all / total:.1f} %) ; commune d'origine (non mesurée) : {self_jobs:,} ; sans verdict : {unknown:,}")
    for split in ("poles_actuels", "astres_d030"):
        d = df[df["decoupage"] == split]
        in_sky = int(d["jobs"].sum())
        print(f"  [{split}] {len(d)} astres, {in_sky:,} postes dans le ciel ; atteints dans le ciel : "
              f"{int(d['reached'].sum()):,} ; astres atteints en partie au moins : {int((d['reached'] > 0).sum())}")
        print(d[["id", "name", "jobs", "reached", "self", "out_only", "share_pct"]].to_string(index=False))
    print(f"écrit : {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
