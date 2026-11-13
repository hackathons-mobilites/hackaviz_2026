"""D-031 options a1 et a2 : faire respecter par R5 les temps de correspondance officiels.

Constat (code lu le 04/11/2026, R5 v7.5.1-r5py et r5py 1.1.7) :
- R5 sait lire `transfers.txt` (`GtfsTransferLoader`) selon `TransportNetworkConfig.transfers` : `OSM_ONLY` (défaut,
  ignoré), `GTFS_ONLY`, `STOP_TO_PATTERN`, `STOP_PAIR` ; r5py construit le réseau avec `OSM_ONLY` codé en dur
  (`r5py/r5/transport_network.py`) et n'expose aucune option : les lignes ne sont jamais chargées ;
- une fois chargées dans `TransitLayer.gtfsTransfers` (quai -> [quai cible, secondes]), le `FastRaptorWorker` d'origine
  (matrices) les applique ; le `McRaptorSuboptimalPathProfileRouter` d'origine (itinéraires détaillés, 04h) ne lit que
  `streetTransfers` ;
- R5 refuse les lignes de plus de 3 600 s et n'accepte une montée que strictement plus de 60 s après l'arrivée au quai
  (`MINIMUM_BOARD_WAIT_SEC`, `BOARD_SLACK`), y compris après une correspondance et au même arrêt.

a1 (`inject`, sans reconstruire le réseau) : charge `transfers.txt` dans le réseau r5py déjà construit, comme le ferait
`STOP_PAIR` (les couples listés remplacent la marche OSM, les autres la gardent). Valeur chargée :
`min_transfer_time - 61 s` (`transfer_times.apply_gtfs_min_gap`), pour que l'écart exigé par R5 soit exactement le
minimum officiel. Le jar corrigé (`pipeline/r5/r5-d031-transfer-rules.patch`) fait lire ces lignes à McRAPTOR aussi.

a2 (`apply_same_stop`, jar corrigé obligatoire) : minimum au même arrêt après une arrivée en TC, par arrêt, lu dans
`data/processed/navitia_same_stop_min.csv` (durées du calculateur officiel IDFM, Navitia, API PRIM « connections »,
relevées par 07i). Un arrêt sans durée relevée garde la règle d'origine de R5 (aucune valeur inventée) ; leur nombre
est rendu par `apply_rules`.

Logique pure testée dans tests/test_r5_transfers.py ; les fonctions Java (`inject`, `apply_same_stop`, `apply_rules`)
tournent sur la VM (banc 04k).
"""

from __future__ import annotations

import csv
import io
import zipfile
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from starway.transfer_times import apply_gtfs_min_gap

R5_MAX_GTFS_TRANSFER_S = 3600  # GtfsTransferLoader : « Transfer time suspiciously high », ligne ignorée
RULES_CLASS = "com/conveyal/r5/profile/StarwayTransferRules.class"
RULES_CLASS_JAVA = "com.conveyal.r5.profile.StarwayTransferRules"
RULES_VERSION_FIELD = "STARWAY_TRANSFER_RULES_VERSION"
EXPECTED_RULES_VERSION = 1


@dataclass
class PackedTransfers:
    by_from: dict[int, list[int]] = field(default_factory=dict)  # index R5 du quai -> [cible, secondes, ...]
    loaded: int = 0
    missing_stop: int = 0
    over_limit: int = 0
    self_pairs: int = 0


def pack(rows: Iterable[tuple[str, str, int]], index_of: Mapping[str, int], feed_prefix: str,
         value: Callable[[int], int] = apply_gtfs_min_gap, max_s: int = R5_MAX_GTFS_TRANSFER_S) -> PackedTransfers:
    """Lignes (quai de départ, quai d'arrivée, min_transfer_time) -> listes empaquetées par index de quai R5.
    Mêmes refus que `GtfsTransferLoader` : quai inconnu du réseau, durée > 3 600 s ; un couple d'un quai vers lui-même
    est compté à part (sans effet dans R5)."""
    out = PackedTransfers()
    for a, b, m in rows:
        ia, ib = index_of.get(feed_prefix + a, -1), index_of.get(feed_prefix + b, -1)
        if ia < 0 or ib < 0:
            out.missing_stop += 1
            continue
        if int(m) > max_s:
            out.over_limit += 1
            continue
        if ia == ib:
            out.self_pairs += 1
            continue
        out.by_from.setdefault(ia, []).extend([ib, value(int(m))])
        out.loaded += 1
    return out


def without_targets(packed_street: Sequence[int], targets: set[int]) -> list[int]:
    """Liste empaquetée (cible, distance) de R5 sans les cibles qui ont une ligne GTFS (comportement STOP_PAIR)."""
    out: list[int] = []
    for i in range(0, len(packed_street), 2):
        if packed_street[i] not in targets:
            out.extend([packed_street[i], packed_street[i + 1]])
    return out


def detect_feed_prefix(scoped_ids: Iterable[str], gtfs_stop_ids: Iterable[str]) -> str:
    """Préfixe de flux de R5 (`feed_id:`) : les identifiants d'arrêt du réseau sont `feed_id:stop_id`. Déduit d'un
    identifiant du GTFS retrouvé dans le réseau ; un seul préfixe admis (un seul GTFS dans le réseau STARWAY)."""
    wanted = set(gtfs_stop_ids)
    prefixes: set[str] = set()
    for sid in scoped_ids:
        for k in range(len(sid)):
            if sid[k] == ":" and sid[k + 1:] in wanted:
                prefixes.add(sid[:k + 1])
                break
        if len(prefixes) > 1:
            break
    if len(prefixes) != 1:
        raise ValueError(f"préfixe de flux introuvable ou ambigu : {sorted(prefixes)[:3]}")
    return prefixes.pop()


def read_gtfs_transfers(gtfs_zip: Path) -> list[tuple[str, str, int]]:
    """Lignes `transfer_type` 2 de `transfers.txt` (quai de départ, quai d'arrivée, min_transfer_time en s)."""
    with zipfile.ZipFile(gtfs_zip) as z, z.open("transfers.txt") as f:
        r = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        return [(row["from_stop_id"], row["to_stop_id"], int(row["min_transfer_time"]))
                for row in r if row.get("transfer_type", "").strip() == "2" and row.get("min_transfer_time")]


def gtfs_stop_ids(gtfs_zip: Path) -> list[str]:
    with zipfile.ZipFile(gtfs_zip) as z, z.open("stops.txt") as f:
        return [row["stop_id"] for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))]


def read_same_stop_minimums(path: Path) -> dict[str, int]:
    """`navitia_same_stop_min.csv` (07i) -> {stop_id GTFS: durée en s}. Durée absente ou non positive : refus."""
    out: dict[str, int] = {}
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            v = int(row["same_stop_min_s"])
            if v <= 0:
                raise ValueError(f"durée non positive pour {row['stop_id']}")
            out[row["stop_id"]] = v
    return out


@dataclass
class SameStopValues:
    values: list[int]  # par index d'arrêt R5 ; 0 = aucune durée relevée (règle d'origine de R5)
    loaded: int = 0
    missing_stop: int = 0  # arrêt du fichier absent du réseau
    without_duration: int = 0  # arrêts du réseau sans durée relevée


def same_stop_values(durations: Mapping[str, int], index_of: Mapping[str, int], feed_prefix: str,
                     n_stops: int) -> SameStopValues:
    """Durées par arrêt GTFS -> tableau par index d'arrêt R5 (0 si aucune durée relevée)."""
    vals = [0] * n_stops
    out = SameStopValues(values=vals)
    for sid, d in durations.items():
        i = index_of.get(feed_prefix + sid, -1)
        if i < 0:
            out.missing_stop += 1
            continue
        vals[i] = int(d)
        out.loaded += 1
    out.without_duration = n_stops - out.loaded
    return out


def required_gap_s(arrived_by_transit_here: bool, same_stop_min_s: int, default_slack_s: int = 60) -> int:
    """Écart minimum (s) entre l'arrivée au quai et un départ accepté, tel que le calcule le jar corrigé
    (`StarwayTransferRules.boardSlack`, départ strictement postérieur à arrivée + attente) : défaut + 1 s, ou la durée
    de l'arrêt si elle est plus longue, après une arrivée en TC à cet arrêt. Sert aux tests et au banc."""
    slack = default_slack_s
    if arrived_by_transit_here and same_stop_min_s > 0:
        slack = max(default_slack_s, same_stop_min_s - 1)
    return slack + 1


def inject(network: Any, rows: Iterable[tuple[str, str, int]], feed_prefix: str) -> dict[str, int]:  # pragma: no cover
    """a1 : écrit les lignes dans `TransitLayer.gtfsTransfers` du réseau r5py et retire la marche OSM des couples
    listés. À appeler une fois le réseau chargé, jamais sur le réseau en cache disque (rien n'est réécrit)."""
    import jpype

    tlist = jpype.JClass("gnu.trove.list.array.TIntArrayList")
    jint_array = jpype.JArray(jpype.JInt)
    tl = network._transport_network.transitLayer
    index_of = {str(s): i for i, s in enumerate(tl.stopIdForIndex)}
    packed = pack(rows, index_of, feed_prefix)
    street = tl.streetTransfers
    removed = 0
    for frm, lst in packed.by_from.items():
        tl.gtfsTransfers.put(frm, tlist(jint_array(lst)))
        old = street.get(frm)
        if old is None or old.size() == 0:
            continue
        cur = [int(v) for v in old.toArray()]
        new = without_targets(cur, set(lst[0::2]))
        removed += (len(cur) - len(new)) // 2
        street.set(frm, tlist(jint_array(new)))  # nouvelle liste : R5 partage une liste vide entre quais sans marche
    return {"loaded": packed.loaded, "missing_stop": packed.missing_stop, "over_limit": packed.over_limit,
            "self_pairs": packed.self_pairs, "street_transfers_replaced": removed}


def rules_class():  # pragma: no cover
    """Classe Java du correctif STARWAY ; refuse un jar sans le correctif ou d'une autre version."""
    import jpype

    try:
        cls = jpype.JClass(RULES_CLASS_JAVA)
    except Exception as e:  # jar d'origine : classe absente
        raise SystemExit(f"jar R5 sans le correctif D-031 ({RULES_CLASS_JAVA} absente) : {e}") from e
    v = int(getattr(cls, RULES_VERSION_FIELD))
    if v != EXPECTED_RULES_VERSION:
        raise SystemExit(f"correctif D-031 version {v}, attendu {EXPECTED_RULES_VERSION}")
    return cls


def apply_same_stop(network: Any, durations: Mapping[str, int], feed_prefix: str) -> dict[str, int]:  # pragma: no cover
    """a2 : charge les minimums au même arrêt dans le jar corrigé (tableau statique, un par index d'arrêt R5)."""
    import jpype

    cls = rules_class()
    tl = network._transport_network.transitLayer
    index_of = {str(s): i for i, s in enumerate(tl.stopIdForIndex)}
    sv = same_stop_values(durations, index_of, feed_prefix, len(index_of))
    cls.setSameStopMinSeconds(jpype.JArray(jpype.JInt)(sv.values))
    jvm_loaded = int(cls.loadedStopCount())
    if jvm_loaded != sv.loaded:
        raise SystemExit(f"JVM : {jvm_loaded} arrêts chargés, attendu {sv.loaded}")
    return {"same_stop_loaded": sv.loaded, "same_stop_missing_stop": sv.missing_stop,
            "stops_without_same_stop_duration": sv.without_duration, "stops_in_network": len(index_of)}


# --------------------------------------------------------------------------- options des scripts 04e, 04c, 04h, 04k
# r5 : moteur d'origine ; gtfs : a1 (transfers.txt) ; gtfs_navitia : a1 + a2 (minimum au même arrêt, Navitia)
RULE_SETS = ("r5", "gtfs", "gtfs_navitia")
DIR_SUFFIX = {"r5": "", "gtfs": "_d031a1", "gtfs_navitia": "_d031"}


def add_cli(p: Any) -> None:
    """Options communes : `--transfer-rules` et `--same-stop-csv`."""
    from starway.config import PROCESSED_DIR

    p.add_argument("--transfer-rules", choices=RULE_SETS, default="r5",
                   help="D-031 : r5 = moteur d'origine ; gtfs = transfers.txt (a1) ; gtfs_navitia = a1 + minimum au "
                        "même arrêt du calculateur officiel (a2) ; jar corrigé obligatoire sauf r5")
    p.add_argument("--same-stop-csv", type=Path, default=PROCESSED_DIR / "navitia_same_stop_min.csv",
                   help="durées au même arrêt (07i), lues avec --transfer-rules gtfs_navitia")


def default_poles_file() -> Path:
    from starway.config import PROCESSED_DIR

    return PROCESSED_DIR / "poles.json"


def add_poles_cli(p: Any) -> None:
    """`--poles` : destinations des calculs vers les pôles (défaut poles.json publié ; D-030 : poles_d030.json)."""
    p.add_argument("--poles", type=Path, default=None,
                   help="fichier des pôles de destination (point lon/lat de chaque entrée) ; défaut "
                        "data/processed/poles.json ; un autre fichier demande --out-dir explicite")


def poles_params(poles_file: Path | None) -> dict[str, Any]:
    """Clés run_params d'un fichier de pôles autre que poles.json (aucune clé pour le défaut : reprises inchangées)."""
    if poles_file is None or poles_file.resolve() == default_poles_file().resolve():
        return {}
    return {"poles_file": poles_file.name, "poles_sha256": sha256_path(poles_file)}


# Première version des calculs à 44 astres (04/11, dossiers ~/b44 de la VM) : la variable STARWAY_POLES_JSON, retirée par
# la PR 29 au profit de `--poles`, écrivait `poles_json` et `poles_json_sha256` (04, 04e, 04d) ou aucune clé de pôles (04h).
LEGACY_POLES_KEYS = {"poles_json": "poles_file", "poles_json_sha256": "poles_sha256"}


def reconcile_poles_params(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """`run_params` d'un calcul en cours, ramenés au vocabulaire de `--poles` avant comparaison avec ceux d'une reprise.

    Seul le NOM des clés change : un fichier de pôles différent reste refusé (même nom, empreinte comparée). Sans clé de
    pôles dans l'ancien (04h de la première version), la reprise n'est tolérée que si `pole_points_sha256` (les points
    eux-mêmes, calculés par 04h) est identique : l'identité des pôles est alors prouvée autrement."""
    out = {LEGACY_POLES_KEYS.get(k, k): v for k, v in old.items()}
    wants = {k: new[k] for k in ("poles_file", "poles_sha256") if k in new}
    if wants and not any(k in out for k in wants):
        pts = out.get("pole_points_sha256")
        if pts is not None and pts == new.get("pole_points_sha256"):
            out.update(wants)
    return out


def require_explicit_dir(poles_file: Path | None, given: Path | None, what: str) -> None:
    """Un calcul vers d'autres pôles n'écrit jamais dans le dossier par défaut (celui des 15 pôles publiés)."""
    if poles_params(poles_file) and given is None:
        raise SystemExit(f"--poles {poles_file} : donner {what} (dossier neuf, jamais celui des pôles publiés)")


def jar_rules_version(jar: Path) -> int | None:
    """Version du correctif D-031 lue dans le jar (constante de StarwayTransferRules), None si absent."""
    from starway.r5jar import class_static_int_constants

    with zipfile.ZipFile(jar) as z:
        if RULES_CLASS not in z.namelist():
            return None
        return class_static_int_constants(z.read(RULES_CLASS)).get(RULES_VERSION_FIELD)


def sha256_path(path: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run_params(rules: str, jar: Path | None, same_stop_csv: Path | None) -> dict[str, Any]:
    """Paramètres à figer dans run_params.json (une reprise avec d'autres règles est refusée par les scripts).
    Moteur d'origine : dictionnaire vide (les run_params des calculs déjà publiés restent inchangés)."""
    if rules == "r5":
        return {}
    if rules not in RULE_SETS:
        raise SystemExit(f"règles de correspondance inconnues : {rules}")
    v = None if jar is None else jar_rules_version(jar)
    if v != EXPECTED_RULES_VERSION:
        raise SystemExit(f"--transfer-rules {rules} : jar {jar} sans le correctif D-031 version "
                         f"{EXPECTED_RULES_VERSION} (lu : {v}) ; voir pipeline/r5/build_r5_d031.sh")
    out: dict[str, Any] = {"transfer_rules": rules, "transfer_rules_patch_version": v,
                           "transfer_rules_rule": "transfers.txt chargé comme STOP_PAIR, valeur min_transfer_time - 61 s"
                                                  " (écart exigé = minimum officiel)"}
    if rules == "gtfs_navitia":
        if same_stop_csv is None or not same_stop_csv.is_file():
            raise SystemExit(f"--same-stop-csv introuvable : {same_stop_csv}")
        out.update({"same_stop_csv": same_stop_csv.name, "same_stop_csv_sha256": sha256_path(same_stop_csv),
                    "same_stop_rule": "après une arrivée en TC à un arrêt : départ >= arrivée + durée Navitia de "
                                      "l'arrêt ; arrêt sans durée relevée : règle d'origine de R5 (> 60 s)"})
    return out


def configure(rules: str, gtfs_zip: Path, same_stop_csv: Path | None, log_path: Path | None) -> None:
    """Fixe `routing.TRANSFER_RULES` (lu par `routing.load_network`). À appeler avant le chargement du réseau."""
    from starway import routing

    routing.TRANSFER_RULES = None if rules == "r5" else {
        "rules": rules, "gtfs_zip": gtfs_zip, "same_stop_csv": same_stop_csv if rules == "gtfs_navitia" else None,
        "log_path": log_path}


def apply_configured(network: Any, cfg: Mapping[str, Any]) -> dict[str, Any]:  # pragma: no cover
    """Appelé par `routing.load_network` : applique les règles et ajoute les comptes au journal `log_path` (jsonl)."""
    import json
    import os
    from datetime import UTC, datetime

    stats = apply_rules(network, Path(cfg["gtfs_zip"]), cfg.get("same_stop_csv"))
    entry = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "pid": os.getpid(), "rules": cfg["rules"], **stats}
    print(f"D-031 règles de correspondance appliquées : {json.dumps(entry, ensure_ascii=False)}", flush=True)
    if cfg.get("log_path") is not None:
        lp = Path(cfg["log_path"])
        lp.parent.mkdir(parents=True, exist_ok=True)
        with lp.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def apply_rules(network: Any, gtfs_zip: Path, same_stop_csv: Path | None) -> dict[str, Any]:  # pragma: no cover
    """a1 (+ a2 si `same_stop_csv`) sur un réseau r5py chargé avec le jar corrigé. Rend les comptes à consigner dans
    `run_params.json`. Refuse un réseau à lignes à fréquence (le correctif n'a été vérifié que sur les horaires)."""
    rules_class()
    tl = network._transport_network.transitLayer
    if bool(tl.hasFrequencies):
        raise SystemExit("réseau avec des lignes à fréquence : correctif D-031 non vérifié dans ce cas")
    if tl.gtfsTransfers.size() != 0:
        raise SystemExit("gtfsTransfers déjà rempli : réseau déjà corrigé ou chargé autrement, refus")
    prefix = detect_feed_prefix((str(s) for s in tl.stopIdForIndex), gtfs_stop_ids(gtfs_zip))
    stats: dict[str, Any] = {"feed_prefix": prefix, "transfers_txt": inject(network, read_gtfs_transfers(gtfs_zip), prefix)}
    if same_stop_csv is not None:
        stats["same_stop"] = apply_same_stop(network, read_same_stop_minimums(same_stop_csv), prefix)
    return stats
