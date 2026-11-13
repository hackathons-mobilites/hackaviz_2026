"""07p - « Prêt à publier ? » : liste ce qui manque avant la publication GROUPÉE des calculs vers les 44 astres.

Pourquoi groupée : 07 compare l'empreinte du moteur (jar R5, règles de correspondance, durées au même arrêt, fichier de pôles)
des matrices de `access/`, des tables commune x commune (`od_walk{L}`) et des itinéraires. Publier les tables D-031 seules,
ou les matrices sans les itinéraires, mélangerait deux moteurs : le script le refuse. Lecture seule, aucun calcul, aucun
appel réseau (PRIM compris).

Usage :
    python scripts/07p_ready_to_publish.py                      # 44 astres, dossiers de data/interim
    python scripts/07p_ready_to_publish.py --interim ../data/interim --sha256-file ../data/interim/_sha256_rapatriement.txt
Code de sortie : 0 = rien ne bloque ; 1 = au moins un élément BLOQUANT. Les éléments « à faire à la main » sont listés mais
ne dépendent pas du dépôt (relecture de textes, quota PRIM) : ils ne changent pas le code de sortie.
Procédure complète : docs/methodologie.md § 5 quindecies, « Publication groupée des calculs vers les 44 astres ».
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from starway import flux
from starway import publication as pub
from starway.config import FRONT_SKY44_DIR, INTERIM_DIR, PIPELINE_DIR, PROCESSED_DIR
from starway.sources import read_manifest

# Scripts de la publication et marqueur qui montre qu'ils savent lire les 44 astres (heuristique : texte du fichier).
# Un script qui lit `poles.json` en dur calculerait ses sorties sur les 15 pôles : bloquant tant qu'il n'est pas adapté.
POLES_AWARE = {
    "04e_compute_walk_variant.py": "add_poles_cli", "04h_transit_itineraries.py": "add_poles_cli", "04d_compute_velib.py": "add_poles_cli",
    "04g_car_distances.py": "add_poles_cli", "04b_compute_story_matrix.py": "add_poles_cli", "04_compute_matrix_b44.py": "add_poles_cli",
    "06_export_front.py": "--astres", "06d_export_od.py": "--poles",
    "05_build_context.py": "sky_poles_json", "06h_export_itineraries.py": "sky_poles_json",
    "06i_export_subscriptions.py": "sky_front_dir", "07h_transfer_times_check.py": "sky_front_dir",
    "07d_navitia_crosscheck.py": "sky_front_dir",
}
OPTIONAL_SCRIPTS = {"06t_export_transfer_check.py", "06n_export_needs.py"}  # alignés sur les lots, pas sur poles.json

MANUAL = [
    "07h puis 07j (--offline) sur les lots rapatriés : aucune correspondance plus courte qu'un minimum connu (aucun appel PRIM)",
    "07d --groups tour,insight --no-diagnose : recoupement Navitia des découvertes publiées ; le cache d'abord, quota PRIM "
    "1 000 requêtes par jour partagé (D-031 450, handicap 100, tickets 60), jamais depuis deux chantiers en même temps",
    "relire les textes de la visite et des découvertes (comptes d'astres et de postes, « en cours de calcul » retiré)",
    "décider : fichier de 359 ou de 638 arrêts pour les durées au même arrêt (D-031 : 359 gardé pour comparer les 44 astres aux 15 pôles)",
    "front (hors pipeline) : lire meta.access_sky pour savoir si access/ est aligné sur le ciel affiché (fait le 05/11 : `calcAligned`, `Dataset.base`)",
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check_sha256_list(listing: Path, base: Path) -> list[str]:
    """Écarts entre un fichier `sha256  chemin` (relevé sur la VM) et les fichiers rapatriés dans `base`."""
    errs = []
    for line in listing.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        digest, _, rel = line.partition(" ")
        rel = rel.strip().lstrip("*")
        p = base / rel
        if not p.exists():
            errs.append(f"absent : {rel}")
        elif sha256_file(p) != digest:
            errs.append(f"sha256 différent : {rel}")
    return errs


def run(interim: Path, sha_list: Path | None, scripts_dir: Path) -> tuple[list[str], list[str], list[str]]:
    """(bloquants, optionnels, infos)."""
    blocking: list[str] = []
    optional: list[str] = []
    info: list[str] = []
    inp = pub.sky_inputs("44", "gtfs_navitia", interim)
    states = pub.dir_states(inp)
    for s in states:
        line = f"{s.name:42} {s.status:8} {s.detail} ({s.role})"
        info.append(line)
        if s.status != "complet":
            (blocking if s.required else optional).append(f"calcul {s.status} : {s.name} : {s.detail} ({s.role})")
    poles_ok = inp.poles_file.exists()
    poles_sha = sha256_file(inp.poles_file) if poles_ok else None
    if not poles_ok:
        blocking.append(f"{inp.poles_file} absent (03b)")
    published_poles = FRONT_SKY44_DIR / "poles.json"
    if poles_ok and published_poles.exists() and json.loads(published_poles.read_text(encoding="utf-8")) != \
            json.loads(inp.poles_file.read_text(encoding="utf-8")):
        blocking.append(f"{published_poles} différent de poles_d030.json : relancer 03b --publish")
    msha = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] in ("TRA01", "TRA01B", "TRA01C", "CYC01")}
    for e in flux.incomplete_problems(msha) + flux.f06_problems(msha):
        blocking.append(f"flux GTFS : {e}")
    if not flux.f06_active(msha):
        info.append("flux GTFS : le manifeste décrit encore le flux du premier calcul (02/11) : la relance F06 n'est pas appliquée")
    for e in pub.engine_problems(states, poles_sha, None, msha):
        blocking.append(f"moteur : {e}")
    od = {"normal": pub.read_params(interim / "od_walk3000_d031"), "comfort": pub.read_params(interim / "od_walk1000_d031")}
    it = {"normal": pub.read_params(interim / "itineraries_walk3000_d031_b44"),
          "comfort": pub.read_params(interim / "itineraries_walk1000_d031_b44")}
    for e in pub.jar_pairs(inp, od, it):
        blocking.append(f"moteur : {e}")
    all_params = [s.params for s in states if s.params] + [p for p in (*od.values(), *it.values()) if p]
    csv_sha = {p.get("same_stop_csv_sha256") for p in all_params if p.get("same_stop_csv_sha256")}
    ref = PROCESSED_DIR / "navitia_same_stop_min_recalc_d031.csv"
    if ref.exists() and csv_sha and csv_sha != {sha256_file(ref)}:
        # le fichier du dépôt est en fins de ligne LF ; la comparaison porte sur l'empreinte lue dans les run_params
        info.append(f"durées au même arrêt : empreintes des calculs {sorted(x[:8] for x in csv_sha)} "
                    f"(copie du dépôt {sha256_file(ref)[:8]}, fins de ligne possibles : à confirmer à la main)")
    # le contexte communal (flux EMP02, 05) doit viser les 44 astres
    ctx = sorted((interim / "context").glob("*.json"))[:1]
    if ctx and poles_ok:
        flows = (json.loads(ctx[0].read_text(encoding="utf-8")).get("flows_to_poles") or {}).get("poles", {})
        want = {p["id"] for p in json.loads(inp.poles_file.read_text(encoding="utf-8"))}
        if not want <= set(flows):  # context/ est commun aux deux ciels : les 44 astres, puis les 15 pôles
            blocking.append(f"context/ : flows_to_poles sur {len(flows)} pôles, {len(want)} astres attendus (05 à relancer sur les 44)")
    elif not ctx:
        blocking.append("context/ absent (05)")
    for name, marker in POLES_AWARE.items():
        path = scripts_dir / name
        if not path.exists():
            blocking.append(f"script absent : {name}")
        elif marker not in path.read_text(encoding="utf-8"):
            (optional if name in OPTIONAL_SCRIPTS else blocking).append(
                f"script pas adapté aux 44 astres : {name} (aucun « {marker} » : il lit poles.json, les 15 pôles)")
    # perdu dans l'incident du 05/11 (docs/restauration-donnees-05-11.md) : ne concerne que l'export des 15 pôles
    if not (interim / "matrix" / "run_params.json").exists():
        optional.append("15 pôles : matrix/run_params.json absent (perdu le 05/11) : `06` SANS --astres 44 ne publie plus "
                        "(meta.dataset_id) ; ne bloque pas les 44 astres, dont l'identité vient de matrix_modes_b44")
    for lost in ("navitia_cache", "car_dist_carspeed"):
        if not (interim / lost).exists():
            optional.append(f"{lost} absent (perdu le 05/11) : seul un recoupement 07d, 07i ou 07j (PRIM) ou le contrôle "
                            "check_car_dist_rerun le demandent ; ne bloque pas la publication")
    if sha_list is not None:
        errs = check_sha256_list(sha_list, interim)
        blocking.extend(f"rapatriement : {e}" for e in errs[:20])
        info.append(f"sha256 : {sha_list.name} contrôlé ({len(errs)} écart(s))")
    else:
        optional.append("sha256 non contrôlé : donner --sha256-file (relevé `sha256sum` fait sur la VM avant le rapatriement)")
    return blocking, optional, info


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--interim", type=Path, default=INTERIM_DIR)
    p.add_argument("--sha256-file", type=Path, default=None)
    p.add_argument("--scripts-dir", type=Path, default=PIPELINE_DIR / "scripts")
    args = p.parse_args()
    blocking, optional, info = run(args.interim.resolve(), args.sha256_file, args.scripts_dir)
    print("== Calculs et empreintes")
    for line in info:
        print("  " + line)
    print(f"\n== BLOQUANT ({len(blocking)})")
    for b in blocking or ["rien"]:
        print("  - " + b)
    print(f"\n== Optionnel, publiable sans ({len(optional)})")
    for o in optional or ["rien"]:
        print("  - " + o)
    print(f"\n== À faire à la main ({len(MANUAL)}), hors code de sortie")
    for m in MANUAL:
        print("  - " + m)
    print("\nPRÊT À PUBLIER" if not blocking else "\nPAS PRÊT : publication groupée impossible (rien ne part seul)")
    return 0 if not blocking else 1


if __name__ == "__main__":
    sys.exit(main())
