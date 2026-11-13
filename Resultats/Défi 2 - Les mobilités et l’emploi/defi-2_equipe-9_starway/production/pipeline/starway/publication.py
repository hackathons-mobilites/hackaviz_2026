"""Quels dossiers de calcul alimentent le site publié (ciel des 44 astres), et sont-ils prêts ?

Pourquoi : `06_export_front.py` lisait en dur les dossiers des 15 pôles (`matrix`, `matrix_story`, `matrix_walk{L}`,
`matrix_velib`, `car_dist_carspeed_v2`). Les calculs vers les 44 astres (D-030) sont écrits dans des dossiers `_b44`
(`docs/etat-calculs-vm.md`) : ce module dit, pour un ciel et des règles de correspondance, quels dossiers lire. Il décrit
aussi l'empreinte du moteur de chaque dossier (jar, règles, durées au même arrêt, pôles, points d'origine) pour vérifier,
avant de publier, que matrices, tables commune x commune et itinéraires viennent du même moteur et des mêmes pôles
(« publication groupée » : 07 compare ces empreintes, donc rien ne part seul).

Rien n'est écrit ici ; aucun calcul n'est lancé. Un dossier absent ou incomplet donne « en cours de calcul » (null avec
raison) côté site, jamais une valeur.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from starway import flux
from starway.config import INTERIM_DIR, PROCESSED_DIR, WALK_SETTINGS_M
from starway.night_network import night_dir

SKIES = ("44",)
RULES_R5 = "r5"
RULES_D031 = "gtfs_navitia"
# vélo + TC de toutes les communes, moteur D-031, en six parties sans recoupement (a, b1 à b5 : le dossier `_b` d'origine
# est remplacé par cinq dossiers, consigne de Nicolas du 05/11 à 18h20) : réunies à l'export ; une partie absente ou
# incomplète laisse le vélo + TC « en cours de calcul »
BIKE_TRANSIT_PARTS = ("a", "b1", "b2", "b3", "b4", "b5")


@dataclass(frozen=True)
class SkyInputs:
    """Dossiers lus par 06 pour un ciel."""

    sky: str
    rules: str
    poles_file: Path
    main_dir: Path  # marche, vélo, voiture (04) : pas de TC
    story_dirs: tuple[Path, ...]  # vélo + TC : récit d'abord, puis toutes communes (parties a, b1 à b5)
    walk_dirs: dict[int, Path]  # limite de marche (m) -> matrice TC (04e)
    velib_dir: Path
    car_dir: Path
    interim: Path = INTERIM_DIR

    @property
    def suffix(self) -> str:
        return "_d031" + ("_b44" if self.sky == "44" else "") if self.rules != RULES_R5 else ""


def sky_inputs(sky: str, rules: str, interim: Path = INTERIM_DIR, processed: Path = PROCESSED_DIR) -> SkyInputs:
    """44 astres : dossiers `_b44`, règles corrigées obligatoires (aucun calcul vers les 44 astres n'existe avec le
    moteur d'origine)."""
    if sky not in SKIES:
        raise ValueError(f"ciel inconnu : {sky}")
    if rules not in (RULES_R5, RULES_D031):
        raise ValueError(f"règles inconnues : {rules}")
    if rules != RULES_D031:
        raise SystemExit("44 astres : seuls les calculs `--transfer-rules gtfs_navitia` existent (dossiers `_b44`)")
    return SkyInputs(
        sky=sky, rules=rules, poles_file=processed / "poles_d030.json", main_dir=interim / "matrix_modes_b44",
        story_dirs=(interim / "matrix_story_d031_b44",
                    *(interim / f"matrix_bike_transit_all_d031_b44_{p}" for p in BIKE_TRANSIT_PARTS)),
        walk_dirs={lim: interim / f"matrix_walk{lim}_d031_b44" for lim in WALK_SETTINGS_M.values()},
        velib_dir=interim / "matrix_velib_b44", car_dir=interim / "car_dist_carspeed_v2_b44", interim=interim)


# --------------------------------------------------------------------------- état d'un dossier de calcul
@dataclass
class DirState:
    name: str
    role: str
    required: bool
    status: str  # absent | partiel | complet
    detail: str = ""
    params: dict[str, Any] = field(default_factory=dict)


def read_params(d: Path) -> dict[str, Any]:
    p = d / "run_params.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def count_batches(d: Path) -> dict[str, int]:
    """Lots (`batch_NNNN.csv`, `.csv.gz`, `.jsonl.gz`) par sous-dossier de `batches/` ; les `.part` sont ignorés."""
    b = d / "batches"
    if not b.exists():
        return {}
    out: dict[str, int] = {}
    subs = [s for s in sorted(b.iterdir()) if s.is_dir()]
    if subs:
        for s in subs:
            out[s.name] = sum(1 for f in s.iterdir() if f.name.startswith("batch_") and not f.name.endswith(".part"))
    else:
        out["."] = sum(1 for f in b.iterdir() if f.name.startswith("batch_") and not f.name.endswith(".part"))
    return out


def n_lots(n_origins: int, batch_size: int) -> int:
    return -(-n_origins // batch_size)


def matrix_state(d: Path, role: str, required: bool, n_origins: int, days: list[str]) -> DirState:
    """Dossier de matrice (04, 04e, 04b) : complet quand chaque (mode, journée) a tous ses lots."""
    params = read_params(d)
    if not params:
        return DirState(d.name, role, required, "absent", "dossier ou run_params.json absent : à rapatrier ou à calculer")
    per = count_batches(d)
    total = n_lots(int(params.get("n_origins", n_origins)), int(params.get("batch_size", 100)))
    short = {k: v for k, v in per.items() if v < total}
    done = sum(per.values())
    want = total * max(len(per), 1)
    if not per or short:
        return DirState(d.name, role, required, "partiel", f"{done} journées-lots sur {want}", params)
    return DirState(d.name, role, required, "complet", f"{total} lots x {len(per)} scénarios", params)


def itineraries_state(d: Path, role: str, required: bool, n_origins: int) -> DirState:
    params = read_params(d)
    if not params:
        return DirState(d.name, role, required, "absent", "dossier ou run_params.json absent : à rapatrier ou à calculer")
    per = count_batches(d)
    done = sum(per.values())
    total = n_lots(int(params.get("n_origins", n_origins)), int(params.get("batch_size", 25)))
    if done < total:
        return DirState(d.name, role, required, "partiel", f"{done} lots sur {total}", params)
    return DirState(d.name, role, required, "complet", f"{total} lots", params)


def car_state(d: Path, role: str, required: bool, n_origins: int) -> DirState:
    params = read_params(d)
    if not params:
        return DirState(d.name, role, required, "absent", "dossier ou run_params.json absent : à rapatrier ou à calculer")
    per = count_batches(d)
    done = sum(per.values())
    total = n_lots(int(params.get("n_origins", n_origins)), int(params.get("batch_size", 100)))
    st = "complet" if done >= total else "partiel"
    return DirState(d.name, role, required, st, f"{done} lots sur {total}", params)


def velib_state(d: Path, role: str, required: bool) -> DirState:
    params = read_params(d)
    if not params or not (d / "velib_any.csv").exists():
        return DirState(d.name, role, required, "absent", "velib_any.csv ou run_params.json absent", params)
    return DirState(d.name, role, required, "complet", f"{params.get('n_origins')} origines", params)


def od_state(d: Path, role: str, required: bool) -> DirState:
    """Table commune x commune (04c) : présente avec ses `run_params.json` et son index."""
    params = read_params(d)
    if not params:
        return DirState(d.name, role, required, "absent", "dossier ou run_params.json absent : à rapatrier", params)
    return DirState(d.name, role, required, "complet", "run_params.json présent", params)


def dir_states(inp: SkyInputs, n_origins: int = 1285) -> list[DirState]:
    """Tout ce qu'il faut (ou peut) lire pour publier ce ciel, avec son état. `required` = bloque la publication groupée."""
    out: list[DirState] = []
    out.append(matrix_state(inp.main_dir, "marche, vélo, voiture (04)", True, n_origins, ["any"]))
    for lim, d in inp.walk_dirs.items():
        out.append(matrix_state(d, f"TC, marche {lim} m (04e)", True, n_origins, ["d06", "d09", "d14"]))
    out.append(velib_state(inp.velib_dir, "Vélib' (04d)", True))
    out.append(matrix_state(inp.story_dirs[0], "vélo + TC des 12 communes du récit (04b)", True, 12, ["d06", "d09", "d14"]))
    for d in inp.story_dirs[1:]:
        out.append(matrix_state(d, "vélo + TC toutes communes (04b)", False, 643, ["d06", "d09", "d14"]))
    out.append(car_state(inp.car_dir, "distances voiture, péages corrigés (04g)", True, n_origins))
    if inp.sky == "44":
        out.append(itineraries_state(inp.interim / "itineraries_walk3000_d031_b44", "itinéraires TC normal (04h)", True,
                                     n_origins))
        out.append(itineraries_state(inp.interim / "itineraries_walk1000_d031_b44", "itinéraires TC confort (04h)", False,
                                     n_origins))
        out.append(od_state(inp.interim / "od_walk3000_d031", "table commune x commune normal (04c)", True))
        out.append(od_state(inp.interim / "od_walk1000_d031", "table commune x commune confort (04c)", True))
        # D-040 : recalcul sur le réseau de nuit (facultatif : absent = tables et 6h-14h d'origine, publiés sans la correction)
        for lim, d in inp.walk_dirs.items():
            out.append(matrix_state(night_dir(d), f"TC 6h-14h sur le réseau de nuit, marche {lim} m (04e)", False,
                                    n_origins, ["d06"]))
            out.append(itineraries_state(night_dir(inp.interim / f"itineraries_walk{lim}_d031_b44"),
                                         f"itinéraires TC 6h-14h sur le réseau de nuit, marche {lim} m (04h)", False,
                                         n_origins))
            out.append(od_state(inp.interim / f"od_walk{lim}_d031_nuit_matin",
                                f"table commune x commune matin sur le réseau de nuit, marche {lim} m (04c)", False))
            out.append(od_state(inp.interim / f"od_walk{lim}_d031_nuit_soir_v2",
                                f"table commune x commune soir sur le réseau du soir, marche {lim} m (04c)", False))
    return out


# --------------------------------------------------------------------------- empreinte du moteur
def jar_sha(params: dict[str, Any]) -> str | None:
    return params.get("r5_jar_sha256")


def poles_sha_of(params: dict[str, Any]) -> str | None:
    """Empreinte du fichier de pôles d'un calcul : `poles_sha256` (--poles) ou `poles_json_sha256` (première version)."""
    return params.get("poles_sha256") or params.get("poles_json_sha256")


NIGHT_MARK = "_d031_nuit"  # dossiers calculés sur le réseau de nuit (D-040) : ..._d031_nuit_b44, ..._d031_nuit_matin
EVENING_MARK = "_d031_nuit_soir"  # table du soir : calculée sur le réseau du soir (TRA01C), ..._d031_nuit_soir_v2


def is_night_dir(name: str) -> bool:
    return NIGHT_MARK in name


def is_evening_dir(name: str) -> bool:
    """Table du soir (22:05 à 23:55) : `od_walk3000_d031_nuit_soir_v2` (les anciens `..._nuit_soir`, jamais publiés, aussi)."""
    return EVENING_MARK in name


def gtfs_source_of(name: str, manifest_sha: dict[str, str] | None = None) -> str:
    """Source (manifeste) du GTFS attendu pour un dossier : TROIS empreintes, chacune seulement là où elle est utilisée.
    Table du soir -> TRA01C (réseau du soir) ; autre dossier de nuit (matin, 6h-14h recalculé) -> TRA01B (réseau de nuit) ;
    vélo + TC (récit et toutes communes) -> TRA01B depuis le flux du 06/11 (`flux.bike_transit_source`), TRA01 avant ;
    tout le reste -> TRA01 (GTFS d'origine). `manifest_sha` : empreintes du manifeste (par défaut celles du dépôt)."""
    if is_evening_dir(name):
        return "TRA01C"
    if is_night_dir(name):
        return "TRA01B"
    if flux.is_bike_transit_dir(name):
        return flux.bike_transit_source(manifest_sha if manifest_sha is not None else flux.manifest_sha())
    return "TRA01"


def day_counterpart(name: str) -> str:
    """Nom du dossier de jour d'un dossier de nuit : `matrix_walk3000_d031_nuit_b44` -> `matrix_walk3000_d031_b44`,
    `od_walk3000_d031_nuit_matin` -> `od_walk3000_d031`, `od_walk3000_d031_nuit_soir_v2` -> `od_walk3000_d031`."""
    for tail in ("_matin", "_soir_v2", "_soir"):
        if name.endswith(NIGHT_MARK + tail):
            return name[: -len(tail)].replace(NIGHT_MARK, "_d031")
    return name.replace(NIGHT_MARK, "_d031")


def engine_problems(states: list[DirState], poles_sha: str | None, points_sha: str | None,
                    manifest_sha: dict[str, str]) -> list[str]:
    """Écarts entre les dossiers D-031 (règles, durées au même arrêt), les pôles, les points d'origine et les sources du
    manifeste. Liste vide = même moteur partout. Ne regarde que les dossiers présents (les absents sont signalés ailleurs).

    Réseaux de nuit (D-040) : TROIS empreintes de GTFS, chacune seulement là où elle est utilisée (`gtfs_source_of`) : un
    dossier de nuit (matin, 6h-14h) doit être calculé sur TRA01B, une table du soir sur TRA01C, tout autre dossier sur
    TRA01 : jamais l'un pour l'autre. Un dossier de nuit doit en plus avoir le même moteur que son dossier de jour (jar,
    règles, OSM, points, réglage de marche) : `night_network.engine_diff`."""
    from starway.night_network import engine_diff

    errs: list[str] = []
    have = [s for s in states if s.params]
    d031 = [s for s in have if s.params.get("transfer_rules")]
    for key in ("transfer_rules", "transfer_rules_patch_version", "same_stop_csv_sha256"):
        vals = {s.params.get(key) for s in d031}
        if len(vals) > 1:
            errs.append(f"{key} différent entre dossiers D-031 : " + ", ".join(
                f"{s.name}={str(s.params.get(key))[:12]}" for s in d031))
    for s in have:
        p = s.params
        ps = poles_sha_of(p)
        if poles_sha is not None and ps is not None and ps != poles_sha:
            errs.append(f"{s.name} : fichier de pôles différent de celui du site (poles_sha256)")
        gtfs_sid = gtfs_source_of(s.name, manifest_sha)
        accepted = flux.accepted_gtfs_shas(gtfs_sid, manifest_sha, non_transit=flux.is_non_transit_dir(s.name))
        if p.get("gtfs_sha256") is not None and manifest_sha.get(gtfs_sid) and p.get("gtfs_sha256") not in accepted:
            errs.append(f"{s.name} : gtfs_sha256 différent du manifeste ({gtfs_sid})")
        if p.get("osm_sha256") is not None and manifest_sha.get("CYC01") and p.get("osm_sha256") != manifest_sha["CYC01"]:
            errs.append(f"{s.name} : osm_sha256 différent du manifeste (CYC01)")
    by_name = {s.name: s for s in have}
    for s in have:
        if is_night_dir(s.name) and day_counterpart(s.name) in by_name:
            base = by_name[day_counterpart(s.name)]
            errs += [f"{s.name} contre {base.name} : {e}" for e in engine_diff(base.params, s.params)]
    for s in have:
        sha = s.params.get("origin_points_sha256")
        # le récit et le vélo + TC ne figent que l'empreinte de leurs origines : contrôlé au lancement de 04b
        if points_sha is not None and sha is not None and s.params.get("n_origins") in (None, 1285) and sha != points_sha:
            errs.append(f"{s.name} : points d'origine différents de communes_idf_2026.csv (D-017)")
    return errs


def jar_pairs(inp: SkyInputs, od_dir_params: dict[str, dict[str, Any]], itin_params: dict[str, dict[str, Any]]) -> list[str]:
    """Pour chaque réglage de marche : jar de la matrice TC = jar de la table commune x commune = jar des itinéraires.
    `od_dir_params` et `itin_params` : run_params par réglage (« normal », « comfort »). Écarts seulement si les deux
    existent (un dossier absent est signalé par `dir_states`)."""
    errs: list[str] = []
    by_setting = {"normal": WALK_SETTINGS_M["normal"], "comfort": WALK_SETTINGS_M["comfort"]}
    for sid, lim in by_setting.items():
        mat = read_params(inp.walk_dirs[lim])
        ref = jar_sha(mat)
        for label, params in (("table commune x commune", od_dir_params.get(sid)),
                              ("itinéraires", itin_params.get(sid))):
            if not params or ref is None:
                continue
            other = jar_sha(params)
            if other is not None and other != ref:
                errs.append(f"réglage {sid} : jar de la matrice TC ({ref[:12]}) différent du jar des {label} ({other[:12]})")
    return errs
