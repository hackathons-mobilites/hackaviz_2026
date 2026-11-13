"""06w `--walk-setting {normal,comfort}` (phase G) : normal inchangé, confort dans son dossier, refus d'un réglage incohérent,
cases non calculées jamais présentées comme « sans autre trajet ».

Le script est lancé en entier (`main`) avec un GTFS et des trajets factices : seuls les lecteurs de GTFS et la mise en forme d'un
trajet sont remplacés, la sélection des cases, la couverture et l'écriture des fichiers sont celles du script.
"""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from starway import alternatives as alt
from starway import alternatives_export as ax
from starway import itin_sets as iss
from starway.config import PIPELINE_DIR

POLES = ["P1", "P2"]
CODES = ["11111", "22222", "33333"]
DAYS = ["d06", "d09", "d14"]


def load_06w() -> Any:
    spec = importlib.util.spec_from_file_location("export_06w", PIPELINE_DIR / "scripts" / "06w_export_alternatives.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def option(*lines: str) -> dict:
    return {"dep_s": 0, "arr_s": 1800, "legs": [{"kind": "transit", "route_id": x, "from_stop": "a", "to_stop": "b"} for x in lines]}


def record(insee: str, pole: str, day: str, d: str, a: tuple | None, b: tuple | None = None, palier: int = 1) -> dict:
    make = lambda k: None if k is None else {"option": option(*k), "lines": list(k)}
    return {"insee": insee, "pole": pole, "day": day, "dir": d, "palier": palier, "status": "ok" if a else "no_trip_in_matrix",
            "A": make(a), "B": make(b), "C": None}


def network_records(insee: str, days: tuple[str, ...]) -> list[dict]:
    """P1 : un autre trajet (B) à l'aller, rien de plus au retour ; P2 : pas de trajet du tout."""
    out = []
    for day in days:
        out += [record(insee, "P1", day, "out", ("L1",), ("L2",)), record(insee, "P1", day, "ret", ("L1",), ("L1",)),
                record(insee, "P2", day, "out", None), record(insee, "P2", day, "ret", None)]
    return out


def write_results(src: Path, net: str, insee: str, recs: list[dict], palier: int = 1) -> None:
    f = src / net / f"p{palier}" / f"{insee}.jsonl.gz"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes(gzip.compress("".join(json.dumps(r) + "\n" for r in recs).encode("utf-8")))


def write_params(src: Path, net: str, walk_setting: str) -> None:
    (src / net).mkdir(parents=True, exist_ok=True)
    (src / net / "run_params.json").write_text(json.dumps({"run": "04q_transit_alternatives", "network": net, "walk_setting": walk_setting}),
                                               encoding="utf-8")


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    """Arbre factice : astres, communes de départ, ENV01, et un module 06w dont seuls les lecteurs de GTFS sont remplacés."""
    mod = load_06w()
    sky = tmp_path / "sky"
    sky.mkdir()
    (sky / "poles.json").write_text(json.dumps([{"id": p} for p in POLES]), encoding="utf-8")
    proc = tmp_path / "processed"
    proc.mkdir()
    (proc / "communes_idf_2026.csv").write_text("insee,is_origin\n" + "".join(f"{c},True\n" for c in CODES) + "44444,False\n",
                                                encoding="utf-8")
    env01 = tmp_path / "env01.csv"
    env01.write_text("a;b\n1;2\n", encoding="utf-8")
    front = tmp_path / "front_data"
    site = tmp_path / "site"
    site.mkdir()
    monkeypatch.setattr(mod, "FRONT_SKY44_DIR", sky)
    monkeypatch.setattr(mod, "PROCESSED_DIR", proc)
    monkeypatch.setattr(mod, "FRONT_DATA_DIR", front)
    monkeypatch.setattr(mod, "load_06h", lambda: SimpleNamespace(ENV01=env01, GTFS=None, load_line_facts=dict,
                                                                 load_trip_stops=lambda used, gtfs: {}))
    monkeypatch.setattr(mod, "lookups", lambda path: (None, {}, frozenset()))
    monkeypatch.setattr(mod, "fc", SimpleNamespace(co2_factors=lambda df: {}))
    monkeypatch.setattr(mod, "nn", SimpleNamespace())
    trip = {"status": "ok", **dict.fromkeys(ax.TRIP_FIELDS, 1)}
    monkeypatch.setattr(mod, "ie", SimpleNamespace(trip_json=lambda rec, *a: dict(trip)))
    # le champ a11y (TRA03, TRA04 : données brutes hors dépôt) est testé dans test_needs.py ; ici on isole l'export du réglage de marche
    monkeypatch.setattr(mod, "nd", SimpleNamespace(from_files=lambda *a: {}, annotate_trip=lambda t, legs, facts, fmt: t))
    monkeypatch.setattr(mod.it, "enrich_leg", lambda lg, gtfs: lg)

    def run(src: Path, *extra: str) -> int:
        argv = ["06w", "--src", str(src), "--gtfs-jour", "jour.zip", "--gtfs-nuit", "nuit.zip", "--site", str(site), *extra]
        monkeypatch.setattr(sys, "argv", argv)
        return mod.main()

    return SimpleNamespace(mod=mod, front=front, run=run, src=tmp_path / "src")


def read_out(directory: Path) -> tuple[dict, dict[str, dict]]:
    cov = json.loads((directory / "coverage.json").read_text(encoding="utf-8"))
    return cov, {p.name.split(".")[0]: iss.read_doc(p) for p in sorted(directory.glob("*.json.gz"))}


# --- normal strictement inchangé


def test_en_tetes_normal_identiques_a_la_phase_f():
    assert ax.export_meta("normal") == {"walk_setting": "normal", "suboptimal_min": 15, "setting_note": ax.SETTING_NOTE,
                                        "comfort_note": ax.COMFORT_NOTE}


def phase_f_docs(results: dict, jsonifiers: dict) -> dict:
    """Boucle de la phase F (06w du commit e427c539), recopiée telle quelle : référence de l'export normal."""
    meta = {"walk_setting": "normal", "suboptimal_min": 15, "setting_note": ax.SETTING_NOTE, "comfort_note": ax.COMFORT_NOTE}
    network_days = {"jour": ("d09", "d14"), "nuit": ("d06",)}
    docs = {}
    for insee in sorted({c for data in results.values() for c in data}):
        cells: dict[str, Any] = {d: {s: [{"state": ax.alt.NOT_YET} for _ in POLES] for s in ax.DIRECTIONS} for d in DAYS}
        for net, days in network_days.items():
            if insee not in results[net]:
                continue
            part = ax.commune_doc(insee, results[net][insee], POLES, list(days), jsonifiers[net], meta)
            for d in days:
                cells[d] = part["days"][d]
        docs[insee] = {"insee": insee, "contract": ax.CONTRACT, **meta, "poles": POLES, "days": cells}
    return docs


def test_assemblage_normal_octet_pour_octet_comme_la_phase_f():
    results = {"jour": {"11111": network_records("11111", ("d09", "d14")), "22222": network_records("22222", ("d09", "d14"))},
               "nuit": {"11111": network_records("11111", ("d06",))}}
    jsonify = lambda o: dict.fromkeys(ax.TRIP_FIELDS, 1)
    jsonifiers = {"jour": jsonify, "nuit": jsonify}
    new = ax.assemble_docs(results, POLES, DAYS, {"jour": ("d09", "d14"), "nuit": ("d06",)}, jsonifiers, ax.export_meta("normal"))
    ref = phase_f_docs(results, jsonifiers)
    assert list(new) == list(ref)
    assert all(iss.encode_doc(new[c]) == iss.encode_doc(ref[c]) for c in ref)


def test_normal_par_defaut_dans_alternatives_sans_run_params(env):
    write_results(env.src, "jour", "11111", network_records("11111", ("d09", "d14")))
    write_results(env.src, "nuit", "11111", network_records("11111", ("d06",)))
    assert env.run(env.src) == 0
    cov, docs = read_out(env.front / "alternatives")
    assert not (env.front / "alternatives_comfort").exists()
    assert cov["walk_setting"] == "normal" and cov["comfort_note"] == ax.COMFORT_NOTE and list(docs) == ["11111"]
    # option explicite = défaut, octet pour octet
    before = {p.name: p.read_bytes() for p in (env.front / "alternatives").iterdir()}
    assert env.run(env.src, "--walk-setting", "normal", "--out", str(env.front / "explicite")) == 0
    after = {p.name: p.read_bytes() for p in (env.front / "explicite").iterdir()}
    assert after == before


# --- confort dans son dossier


def test_confort_ecrit_dans_alternatives_comfort_avec_son_reglage(env):
    for net, days in (("jour", ("d09", "d14")), ("nuit", ("d06",))):
        write_params(env.src, net, "comfort")
        write_results(env.src, net, "11111", network_records("11111", days))
    assert env.run(env.src, "--walk-setting", "comfort") == 0
    assert not (env.front / "alternatives").exists()
    cov, docs = read_out(env.front / "alternatives_comfort")
    assert cov["contract"] == ax.COVERAGE_CONTRACT and cov["walk_setting"] == "comfort" and cov["comfort_note"] is None
    doc = docs["11111"]
    assert doc["contract"] == ax.CONTRACT and doc["walk_setting"] == "comfort" and doc["comfort_note"] is None
    # mêmes clés qu'un fichier normal sur les mêmes trajets, plus `earlier_departures` (additif, 11/11) ; seuls `walk_setting` et
    # `comfort_note` changent de valeur
    results = {"jour": {"11111": network_records("11111", ("d09", "d14"))}, "nuit": {"11111": network_records("11111", ("d06",))}}
    jsonify = lambda o: dict.fromkeys(ax.TRIP_FIELDS, 1)
    normal = phase_f_docs(results, {"jour": jsonify, "nuit": jsonify})["11111"]
    assert set(doc) == set(normal) | {"earlier_departures"}
    assert doc["earlier_departures"] == {"d06": False, "d09": False, "d14": False}
    skip = ("walk_setting", "comfort_note", "earlier_departures")
    assert {k: v for k, v in doc.items() if k not in skip} == {k: v for k, v in normal.items() if k not in skip}
    assert cov["communes"]["11111"]["d09"] == {"out": "as", "ret": "ss"}
    assert ax.check_published(cov, docs, CODES) == []


# --- refus d'un réglage incohérent


def test_confort_refuse_une_source_au_reglage_normal(env):
    write_params(env.src, "jour", "normal")
    write_results(env.src, "jour", "11111", network_records("11111", ("d09", "d14")))
    assert env.run(env.src, "--walk-setting", "comfort") == 2
    assert not (env.front / "alternatives_comfort").exists()


def test_confort_refuse_une_source_sans_run_params(env):
    write_results(env.src, "jour", "11111", network_records("11111", ("d09", "d14")))
    assert env.run(env.src, "--walk-setting", "comfort") == 2
    assert not (env.front / "alternatives_comfort").exists()


def test_confort_refuse_si_un_seul_reseau_est_incoherent(env):
    write_params(env.src, "jour", "comfort")
    write_params(env.src, "nuit", "normal")
    errs = ax.source_setting_errors(env.src, ("jour", "nuit"), "comfort")
    assert errs == ["nuit : source au réglage normal, attendu comfort"]


def test_normal_refuse_une_source_au_reglage_confort(env):
    write_params(env.src, "jour", "comfort")
    write_results(env.src, "jour", "11111", network_records("11111", ("d09", "d14")))
    assert env.run(env.src) == 2
    assert not (env.front / "alternatives").exists()


def test_un_reglage_n_ecrit_jamais_dans_le_dossier_de_l_autre(env):
    write_params(env.src, "jour", "comfort")
    write_results(env.src, "jour", "11111", network_records("11111", ("d09", "d14")))
    assert env.run(env.src, "--walk-setting", "comfort", "--out", str(env.front / "alternatives")) == 2
    assert not (env.front / "alternatives").exists()
    assert ax.out_dir_errors(Path("x") / "alternatives_comfort", "normal") != []
    assert ax.out_dir_errors(Path("x") / "alternatives_comfort", "comfort") == []


# --- cases non calculées


def test_confort_cases_et_communes_non_calculees_restent_pas_encore_calcule(env):
    for net in ("jour", "nuit"):
        write_params(env.src, net, "comfort")
    # 11111 : jour et nuit finis ; 22222 : jour seulement (nuit encore en calcul) ; 33333 : rien
    write_results(env.src, "jour", "11111", network_records("11111", ("d09", "d14")))
    write_results(env.src, "nuit", "11111", network_records("11111", ("d06",)))
    write_results(env.src, "jour", "22222", network_records("22222", ("d09", "d14")))
    assert env.run(env.src, "--walk-setting", "comfort") == 0
    cov, docs = read_out(env.front / "alternatives_comfort")
    assert cov["n_communes"] == 3 and cov["n_communes_with_file"] == 2 and sorted(docs) == ["11111", "22222"]
    assert cov["communes"]["33333"] is None
    assert cov["communes"]["22222"]["d06"] == {"out": "nn", "ret": "nn"}
    assert all(x == {"state": alt.NOT_YET} for s in ax.DIRECTIONS for x in docs["22222"]["days"]["d06"][s])
    per_commune = len(POLES) * len(DAYS) * len(ax.DIRECTIONS)
    # non calculé = 33333 entière + la nuit de 22222 ; jamais compté « sans autre trajet »
    assert cov["counts"][alt.NOT_YET] == per_commune + len(POLES) * len(ax.DIRECTIONS)
    assert sum(cov["counts"].values()) == 3 * per_commune
    assert ax.check_published(cov, docs, CODES) == []


def test_le_gtfs_lu_doit_etre_celui_du_calcul(tmp_path: Path):
    gtfs = tmp_path / "gtfs.zip"
    gtfs.write_bytes(b"gtfs du calcul")
    good = hashlib.sha256(b"gtfs du calcul").hexdigest()
    (tmp_path / "jour").mkdir()
    (tmp_path / "jour" / "run_params.json").write_text(json.dumps({"walk_setting": "comfort", "gtfs_sha256": good}), encoding="utf-8")
    assert ax.gtfs_errors(tmp_path, {"jour": gtfs, "nuit": tmp_path / "absent.zip"}) == []
    gtfs.write_bytes(b"autre GTFS")
    assert len(ax.gtfs_errors(tmp_path, {"jour": gtfs})) == 1


# --- départs plus tôt (écart de palier 2 du confort, 11/11) : déduit des fichiers finis, jamais d'une liste écrite à la main


def write_both_paliers(src: Path, net: str, insee: str, days: tuple[str, ...], earlier: bool) -> None:
    """Palier 1 (aller et retour) ; palier 2 (allers, départs plus tôt) seulement si `earlier`."""
    write_results(src, net, insee, network_records(insee, days), palier=1)
    if earlier:
        recs = [dict(r, palier=2) for r in network_records(insee, days) if r["dir"] == "out"]
        write_results(src, net, insee, recs, palier=2)


def test_earlier_flags_deduits_des_paliers_finis(tmp_path: Path):
    write_both_paliers(tmp_path, "jour", "11111", ("d09", "d14"), earlier=True)
    write_both_paliers(tmp_path, "jour", "22222", ("d09", "d14"), earlier=False)
    write_results(tmp_path, "nuit", "33333", network_records("33333", ("d06",)), palier=3)
    write_results(tmp_path, "nuit", "33333", [], palier=4)
    (tmp_path / "jour" / "claims").mkdir()
    (tmp_path / "jour" / "claims" / "p2_22222").write_text("", encoding="utf-8")  # réservation sans résultat : ne compte pas
    flags = ax.earlier_flags(tmp_path, ("jour", "nuit"))
    assert flags == {"jour": {"11111": True, "22222": False}, "nuit": {"33333": True}}
    nd = {"jour": ("d09", "d14"), "nuit": ("d06",)}
    assert ax.earlier_by_day(flags, "11111", nd, DAYS) == {"d06": None, "d09": True, "d14": True}
    assert ax.earlier_by_day(flags, "33333", nd, DAYS) == {"d06": True, "d09": None, "d14": None}


def test_confort_ecrit_earlier_departures_et_l_ecart_avec_le_normal(env, tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    """Fixture : 11111 a son palier 2 dans les deux réglages ; 22222 l'a en normal seulement (cas des 13 communes du 11/11)."""
    normal = tmp_path / "normal"
    for net, days in (("jour", ("d09", "d14")), ("nuit", ("d06",))):
        write_params(env.src, net, "comfort")
        write_both_paliers(env.src, net, "11111", days, earlier=True)
        write_both_paliers(env.src, net, "22222", days, earlier=False)
        write_both_paliers(normal, net, "11111", days, earlier=True)
        write_both_paliers(normal, net, "22222", days, earlier=True)
    assert env.run(env.src, "--walk-setting", "comfort", "--normal-src", str(normal)) == 0
    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert summary["earlier_gap_communes"] == ["22222"]
    assert summary["earlier_departures_by_network"] == {"jour": 1, "nuit": 1}
    cov, docs = read_out(env.front / "alternatives_comfort")
    every_day = lambda v: dict.fromkeys(DAYS, v)
    assert docs["11111"]["earlier_departures"] == every_day(True) and docs["11111"]["earlier_departures_normal"] == every_day(True)
    assert docs["22222"]["earlier_departures"] == every_day(False) and docs["22222"]["earlier_departures_normal"] == every_day(True)
    assert "earlier_departures" not in cov and ax.check_published(cov, docs, CODES) == []


def test_confort_sans_normal_src_n_ecrit_pas_earlier_departures_normal(env):
    for net, days in (("jour", ("d09", "d14")), ("nuit", ("d06",))):
        write_params(env.src, net, "comfort")
        write_both_paliers(env.src, net, "11111", days, earlier=False)
    assert env.run(env.src, "--walk-setting", "comfort") == 0
    _, docs = read_out(env.front / "alternatives_comfort")
    assert docs["11111"]["earlier_departures"] == dict.fromkeys(DAYS, False) and "earlier_departures_normal" not in docs["11111"]


def test_normal_n_a_jamais_earlier_departures_et_refuse_normal_src(env, tmp_path: Path):
    write_both_paliers(env.src, "jour", "11111", ("d09", "d14"), earlier=True)
    assert env.run(env.src) == 0
    _, docs = read_out(env.front / "alternatives")
    assert "earlier_departures" not in docs["11111"] and "earlier_departures_normal" not in docs["11111"]
    assert env.run(env.src, "--normal-src", str(env.src), "--out", str(tmp_path / "autre")) == 2


def test_normal_src_vide_ou_au_reglage_confort_refusee(env, tmp_path: Path):
    write_params(env.src, "jour", "comfort")
    write_both_paliers(env.src, "jour", "11111", ("d09", "d14"), earlier=False)
    assert env.run(env.src, "--walk-setting", "comfort", "--normal-src", str(tmp_path / "vide")) == 2
    assert env.run(env.src, "--walk-setting", "comfort", "--normal-src", str(env.src)) == 2
    assert not (env.front / "alternatives_comfort").exists()


def test_controle_detecte_un_earlier_departures_mal_forme():
    docs = {"11111": {"insee": "11111", "contract": ax.CONTRACT, "poles": POLES, "earlier_departures": {"d09": 1},
                      "days": {d: {s: [{"state": alt.NOT_YET} for _ in POLES] for s in ax.DIRECTIONS} for d in DAYS}}}
    cov = ax.coverage_doc(CODES, docs, POLES, DAYS, ax.export_meta("comfort"))
    errs = ax.check_published(cov, docs, CODES)
    assert errs == ["11111 : earlier_departures attendu {journée: vrai, faux ou null} sur les journées de la couverture"]
