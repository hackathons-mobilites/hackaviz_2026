"""Export des trajets alternatifs (D-055, contrat `alternatives-1`) : fichiers par commune et couverture. Logique pure.

Trois états stricts par commune, astre, journée et sens (`alternatives.coverage_state`) ; une case non calculée n'est jamais
présentée comme « pas d'alternative ». A n'est pas répété : il se lit dans `itineraries/{insee}.json.gz`, et `a_lines` permet de
vérifier qu'il s'agit du même trajet.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from starway import alternatives as alt

CONTRACT = "alternatives-1"
COVERAGE_CONTRACT = "alternatives-coverage-1"
SETTING_NOTE = "largeur de recherche de 15 minutes : réglage de l'équipe, pas une donnée (D-055)"
COMFORT_NOTE = "réglage de marche « confort » non calculé"
DIRECTIONS = ("out", "ret")
# Réglage de marche (D-024) -> dossier publié sous frontend/public/data (phase G : `alternatives_comfort/`, même contrat)
OUT_DIRS: dict[str, str] = {"normal": "alternatives", "comfort": "alternatives_comfort"}


def export_meta(walk_setting: str) -> dict[str, Any]:
    """En-têtes communs de la couverture et des fichiers. « normal » : exactement ceux de la phase F. « comfort » : `comfort_note`
    vaut null (la note « confort non calculé » serait fausse), mêmes clés."""
    if walk_setting not in OUT_DIRS:
        raise ValueError(f"réglage de marche inconnu : {walk_setting}")
    meta: dict[str, Any] = {"walk_setting": walk_setting, "suboptimal_min": 15, "setting_note": SETTING_NOTE, "comfort_note": COMFORT_NOTE}
    if walk_setting == "comfort":
        meta["comfort_note"] = None
    return meta


def source_setting_errors(src: Path, networks: Iterable[str], walk_setting: str) -> list[str]:
    """Réglage de marche de la source (`<src>/<réseau>/run_params.json`, écrit par 04q). Liste d'erreurs, vide si la source convient.

    En confort, chaque dossier de réseau présent doit avoir son `run_params.json` au réglage « comfort » et au bon réseau (sans lui, le
    réglage est invérifiable : refus). En normal, un `run_params.json` absent est accepté comme en phase F (les archives de la phase F
    n'en contiennent pas) ; présent, il doit dire « normal »."""
    errs: list[str] = []
    for net in networks:
        d = src / net
        if not d.is_dir():
            continue
        pp = d / "run_params.json"
        if not pp.is_file():
            if walk_setting != "normal":
                errs.append(f"{net} : run_params.json absent, réglage de marche invérifiable (attendu {walk_setting})")
            continue
        params = json.loads(pp.read_text(encoding="utf-8"))
        if params.get("walk_setting") != walk_setting:
            errs.append(f"{net} : source au réglage {params.get('walk_setting')}, attendu {walk_setting}")
        if params.get("network", net) != net:
            errs.append(f"{net} : run_params.json du réseau {params.get('network')}")
    return errs


def gtfs_errors(src: Path, gtfs_paths: Mapping[str, Path]) -> list[str]:
    """Le GTFS lu pour mettre les trajets en forme est-il celui du calcul (`gtfs_sha256` de `<src>/<réseau>/run_params.json`) ?
    Sans `run_params.json` ou sans empreinte (archives de la phase F), rien n'est vérifié, comme avant."""
    errs: list[str] = []
    for net, gtfs in gtfs_paths.items():
        pp = src / net / "run_params.json"
        if not pp.is_file():
            continue
        want = json.loads(pp.read_text(encoding="utf-8")).get("gtfs_sha256")
        if not want:
            continue
        h = hashlib.sha256()
        with Path(gtfs).open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() != want:
            errs.append(f"{net} : GTFS {h.hexdigest()[:8]} lu, calcul fait sur {want[:8]}")
    return errs


def out_dir_errors(out: Path, walk_setting: str) -> list[str]:
    """Un réglage n'écrit jamais dans le dossier publié de l'autre."""
    other = {v for k, v in OUT_DIRS.items() if k != walk_setting}
    return [f"dossier {out.name} réservé à un autre réglage de marche que {walk_setting}"] if out.name in other else []


def earlier_flags(src: Path, networks: Iterable[str]) -> dict[str, dict[str, bool]]:
    """{réseau: {insee: recherche de départs plus tôt faite ?}}, déduit des seuls fichiers finis de 04q
    (`<src>/<réseau>/p<palier>/<insee>.jsonl.gz`, écriture atomique) : vrai si un palier avec départs plus tôt
    (`alternatives.PALIERS_EARLIER`) est fini pour la commune, faux si seuls des paliers sans le sont. Commune absente : réseau pas
    calculé pour elle. Jamais d'une liste de communes écrite à la main."""
    out: dict[str, dict[str, bool]] = {}
    for net in networks:
        flags: dict[str, bool] = {}
        for f in sorted((src / net).glob("p*/*.jsonl.gz")):
            level = f.parent.name[1:]
            if not level.isdigit():
                continue
            insee = f.name.split(".")[0]
            flags[insee] = flags.get(insee, False) or int(level) in alt.PALIERS_EARLIER
        out[net] = flags
    return out


def earlier_by_day(flags: Mapping[str, Mapping[str, bool]], insee: str, network_days: Mapping[str, Sequence[str]],
                   day_ids: Sequence[str]) -> dict[str, bool | None]:
    """{journée: vrai, faux, ou null si le réseau de cette journée n'est pas calculé pour la commune}."""
    out: dict[str, bool | None] = dict.fromkeys(day_ids)
    for net, days in network_days.items():
        for d in days:
            if d in out:
                out[d] = flags.get(net, {}).get(insee)
    return out


def assemble_docs(results: Mapping[str, Mapping[str, Sequence[Mapping[str, Any]]]], pole_ids: Sequence[str], day_ids: Sequence[str],
                  network_days: Mapping[str, Sequence[str]], jsonifiers: Mapping[str, Callable[[Mapping[str, Any]], Mapping[str, Any] | None]],
                  meta: Mapping[str, Any], earlier: Mapping[str, Mapping[str, bool]] | None = None,
                  earlier_normal: Mapping[str, Mapping[str, bool]] | None = None) -> dict[str, dict[str, Any]]:
    """{insee: fichier} pour chaque commune dont au moins un réseau a un résultat. Les journées d'un réseau non calculé pour la
    commune restent « pas encore calculé » (jamais « sans autre trajet »).

    `earlier` (réglage confort seulement, phase G) : ajoute `earlier_departures` ({journée: bool | null}, `earlier_by_day`) ;
    `earlier_normal` (sources de la phase F) : ajoute `earlier_departures_normal`, même forme. Sans eux (réglage normal), le fichier
    est exactement celui de la phase F."""
    docs: dict[str, dict[str, Any]] = {}
    for insee in sorted({c for data in results.values() for c in data}):
        cells: dict[str, Any] = {d: {s: [{"state": alt.NOT_YET} for _ in pole_ids] for s in DIRECTIONS} for d in day_ids}
        for net, days in network_days.items():
            if insee not in results.get(net, {}):
                continue
            part = commune_doc(insee, results[net][insee], pole_ids, list(days), jsonifiers[net], meta)
            for d in days:
                cells[d] = part["days"][d]
        doc: dict[str, Any] = {"insee": insee, "contract": CONTRACT, **meta}
        if earlier is not None:
            doc["earlier_departures"] = earlier_by_day(earlier, insee, network_days, day_ids)
        if earlier_normal is not None:
            doc["earlier_departures_normal"] = earlier_by_day(earlier_normal, insee, network_days, day_ids)
        docs[insee] = {**doc, "poles": list(pole_ids), "days": cells}
    return docs


def earlier_gaps(docs: Mapping[str, Mapping[str, Any]]) -> list[str]:
    """Communes dont une journée a les départs plus tôt dans le réglage normal et pas dans celui de l'export (pour le résumé de 06w)."""
    return sorted(c for c, doc in docs.items()
                  if any(v is False and (doc.get("earlier_departures_normal") or {}).get(d) is True
                         for d, v in (doc.get("earlier_departures") or {}).items()))
STATE_CODE = {alt.CALCULATED_WITH: "a", alt.CALCULATED_WITHOUT: "s", alt.NOT_YET: "n"}
CODE_STATE = {v: k for k, v in STATE_CODE.items()}
TRIP_FIELDS = ("dep", "arr", "min", "rides", "wait_min", "walk_m", "legs", "tickets", "co2_g")


def merge_paliers(records: Iterable[Mapping[str, Any]]) -> dict[tuple[str, str, str], Mapping[str, Any]]:
    """(astre, journée, sens) -> enregistrement ; un palier avec départs plus tôt remplace le palier sans, pour le même sens."""
    best: dict[tuple[str, str, str], Mapping[str, Any]] = {}
    for r in sorted(records, key=lambda x: x["palier"]):
        best[(r["pole"], r["day"], r["dir"])] = r
    return best


def trip_fields(trip: Mapping[str, Any]) -> dict[str, Any]:
    return {k: trip[k] for k in TRIP_FIELDS}


def a_wins(name: str, a: Mapping[str, Any], r: Mapping[str, Any]) -> bool:
    """A bat-il B (prix connu puis durée) ou C (montées puis durée), avec les clés de `alternatives.select_abc` ?

    B et C sont choisis parmi les options qui tiennent les horaires, A parmi toutes (règle de 04h) : A peut donc être moins cher que B,
    ou avoir moins de montées que C. Dans ce cas l'onglet « Le moins cher » (ou « Le moins de correspondances ») est A lui-même, et B (ou C)
    vaut null, comme un trajet aux mêmes lignes. Un prix de A inconnu ne bat jamais B. À égalité stricte, B ou C reste affiché."""
    first = "cost_eur" if name == "B" else "rides"
    ka, kr = (a.get(first), a.get("min")), (r.get(first), r.get("min"))
    if None in ka or None in kr:
        return False
    return ka < kr


def cell(record: Mapping[str, Any] | None, jsonify: Callable[[Mapping[str, Any]], Mapping[str, Any] | None]) -> dict[str, Any]:
    """Une case du contrat. `jsonify(option)` rend le trajet au format d'`itineraries/`, ou None s'il n'est pas publiable.
    B (ou C) vaut null s'il a les mêmes lignes que A, ou si A le bat sur son propre critère (`a_wins`)."""
    if record is None:
        return {"state": alt.NOT_YET}
    a = record.get("A")
    if a is None:
        return {"state": alt.CALCULATED_WITHOUT, "status": record.get("status")}
    out: dict[str, Any] = {"state": alt.CALCULATED_WITHOUT, "a_lines": a["lines"], "B": None, "C": None}
    key_a = alt.lines_key(a["option"])
    seen: dict[tuple[str, ...], str] = {}
    for name in ("B", "C"):
        r = record.get(name)
        if r is None or alt.lines_key(r["option"]) == key_a or a_wins(name, a, r):
            continue
        key = alt.lines_key(r["option"])
        if key in seen:
            out[name] = {"same_as": seen[key]}
            continue
        trip = jsonify(r["option"])
        if trip is None:
            continue
        out[name] = trip_fields(trip)
        seen[key] = name
    if out["B"] is not None or out["C"] is not None:
        out["state"] = alt.CALCULATED_WITH
    return out


def commune_doc(insee: str, records: Iterable[Mapping[str, Any]], pole_ids: Sequence[str], day_ids: Sequence[str],
                jsonify: Callable[[Mapping[str, Any]], Mapping[str, Any] | None], meta: Mapping[str, Any]) -> dict[str, Any]:
    by_key = merge_paliers(records)
    days = {d: {s: [cell(by_key.get((p, d, s)), jsonify) for p in pole_ids] for s in DIRECTIONS} for d in day_ids}
    return {"insee": insee, "contract": CONTRACT, **meta, "poles": list(pole_ids), "days": days}


def coverage_doc(codes: Sequence[str], docs: Mapping[str, Mapping[str, Any]], pole_ids: Sequence[str], day_ids: Sequence[str],
                 meta: Mapping[str, Any]) -> dict[str, Any]:
    """Toutes les communes : `null` = aucune case calculée ; sinon une lettre par astre, dans l'ordre de `poles`."""
    communes: dict[str, Any] = {}
    counts = dict.fromkeys(alt.COVERAGE_STATES, 0)
    total = len(pole_ids) * len(day_ids) * len(DIRECTIONS)
    done = 0
    for c in sorted(codes):
        doc = docs.get(c)
        if doc is None:
            communes[c] = None
            counts[alt.NOT_YET] += total
            continue
        done += 1
        entry: dict[str, dict[str, str]] = {}
        for d in day_ids:
            entry[d] = {}
            for s in DIRECTIONS:
                states = [x["state"] for x in doc["days"][d][s]]
                for st in states:
                    counts[st] += 1
                entry[d][s] = "".join(STATE_CODE[st] for st in states)
        communes[c] = entry
    return {"contract": COVERAGE_CONTRACT, **meta, "poles": list(pole_ids), "days": list(day_ids), "dirs": list(DIRECTIONS),
            "codes": {v: k for k, v in STATE_CODE.items()}, "n_communes": len(codes), "n_communes_with_file": done,
            "counts": counts, "communes": communes}


def check_published(coverage: Mapping[str, Any], docs: Mapping[str, Mapping[str, Any]], codes: Sequence[str]) -> list[str]:
    """Cohérence de la couverture et des fichiers. Liste d'erreurs, vide si tout va bien."""
    errs: list[str] = []
    if coverage.get("contract") != COVERAGE_CONTRACT:
        errs.append("couverture : contrat inattendu")
    com = coverage.get("communes", {})
    if set(com) != set(codes):
        errs.append(f"couverture : {len(set(codes) ^ set(com))} communes en écart avec les communes de départ")
    poles, days = coverage.get("poles", []), coverage.get("days", [])
    for c, entry in com.items():
        doc = docs.get(c)
        if entry is None:
            if doc is not None:
                errs.append(f"{c} : fichier présent mais couverture vide")
            continue
        if doc is None:
            errs.append(f"{c} : couverture remplie sans fichier")
            continue
        if doc.get("contract") != CONTRACT or doc.get("poles") != poles:
            errs.append(f"{c} : contrat ou astres différents")
            continue
        errs += _earlier_errors(c, doc, days)
        for d in days:
            for s in DIRECTIONS:
                code = entry[d][s]
                cells = doc["days"][d][s]
                if len(code) != len(poles) or len(cells) != len(poles):
                    errs.append(f"{c} {d} {s} : longueur différente du nombre d'astres")
                    continue
                for ch, x in zip(code, cells, strict=True):
                    errs += _cell_errors(c, d, s, ch, x)
    for c in docs:
        if c not in com:
            errs.append(f"{c} : fichier hors de la couverture")
    return errs


def _earlier_errors(c: str, doc: Mapping[str, Any], days: Sequence[str]) -> list[str]:
    """`earlier_departures` et `earlier_departures_normal`, s'ils sont présents : {journée: vrai, faux ou null} sur les journées."""
    errs: list[str] = []
    for key in ("earlier_departures", "earlier_departures_normal"):
        if key not in doc:
            continue
        v = doc[key]
        if not isinstance(v, dict) or set(v) != set(days) or any(not (x is None or isinstance(x, bool)) for x in v.values()):
            errs.append(f"{c} : {key} attendu {{journée: vrai, faux ou null}} sur les journées de la couverture")
    return errs


def _cell_errors(c: str, d: str, s: str, code: str, x: Mapping[str, Any]) -> list[str]:
    where = f"{c} {d} {s}"
    if CODE_STATE.get(code) != x.get("state"):
        return [f"{where} : état {x.get('state')} différent de la couverture ({code})"]
    has_alt = x.get("B") is not None or x.get("C") is not None
    if x["state"] == alt.CALCULATED_WITH and not has_alt:
        return [f"{where} : « avec alternatives » sans B ni C"]
    if x["state"] != alt.CALCULATED_WITH and has_alt:
        return [f"{where} : B ou C présent hors de l'état « avec alternatives »"]
    if x["state"] == alt.NOT_YET and set(x) != {"state"}:
        return [f"{where} : case non calculée avec un contenu"]
    return []
