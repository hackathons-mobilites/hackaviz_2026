"""Projets de recrutement BMO 2026 (starway/bmo.py) : agrégation sur le bassin, cases « * », contrôles."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from starway import bmo
from starway.config import FRONT_DATA_DIR

NA = pd.NA


def frame(rows: list[tuple]) -> pd.DataFrame:
    """(métier, famille, bassin, dept, clpe, met, xmet, smet) ; None = case « * »."""
    cols = ["metier", "family", "bassin", "dept", "clpe", "met", "xmet", "smet"]
    df = pd.DataFrame(rows, columns=cols)
    for m in bmo.METRICS:
        df[m] = pd.array(df[m], dtype="Int64")
    labels = {"V": "Vente", "S": "Social", "A": "Administratif"}
    df["metier_name"] = "Métier " + df["metier"]
    df["family_label"] = df["family"].map(labels)
    df["bassin_name"] = "Bassin " + df["bassin"]
    return df


ROWS = [
    # bassin 1 : deux CLPE et deux départements pour le même (bassin, métier) : on somme
    ("V1", "V", "1001", "75", "C1", 100, 30, 10),
    ("V1", "V", "1001", "77", "C2", 50, 20, None),
    ("V2", "V", "1001", "75", "C1", None, None, None),  # tout masqué : n = null, jamais 0
    ("S1", "S", "1001", "75", "C1", 70, 10, 5),
    ("A1", "A", "1002", "75", "C3", 9, 5, 5),
    ("S1", "S", "1002", "75", "C3", None, None, None),
]


def test_cell_sums_published_cells_and_counts_masked() -> None:
    s = pd.Series([100, 50, pd.NA], dtype="Int64")
    assert bmo.cell(s) == {"n": 150, "masked": 1}


def test_cell_all_masked_is_null_never_zero() -> None:
    assert bmo.cell(pd.Series([pd.NA, pd.NA], dtype="Int64")) == {"n": None, "masked": 2}


def test_bassin_total_and_families_sum_over_clpe_and_departments() -> None:
    df = frame(ROWS)
    doc, _ = bmo.build_export(df, "2026-11-04T00:00:00Z")
    b = doc["bassins"]["1001"]
    assert b["total"]["met"] == {"n": 220, "masked": 1}
    assert b["families"]["V"]["met"] == {"n": 150, "masked": 1}
    assert b["families"]["V"]["smet"] == {"n": 10, "masked": 2}  # une case publiée, deux « * »
    assert b["families"]["S"]["met"] == {"n": 70, "masked": 0}
    assert doc["bassins"]["1002"]["families"]["S"]["met"] == {"n": None, "masked": 1}
    assert doc["region"]["published"]["met"] == {"n": 229, "masked": 2}


def test_families_ordered_by_published_projects() -> None:
    doc, _ = bmo.build_export(frame(ROWS), "t")
    assert [f["code"] for f in doc["families"]] == ["V", "S", "A"]


def test_detail_by_metier_matches_main() -> None:
    df = frame(ROWS)
    main, detail = bmo.build_export(df, "t")
    assert detail["bassins"]["1001"]["V1"] == [150, 0, 50, 0, 10, 1]
    assert detail["bassins"]["1001"]["V2"] == [None, 1, None, 1, None, 1]
    assert bmo.check_detail(detail, main) == []


def test_sum_with_a_masked_cell_is_a_minimum_never_zero() -> None:
    """20 + 10 + « * » : au moins 30 (n = 30, masked = 1) ; aucune case publiée : null, jamais 0."""
    assert bmo.cell(pd.Series([20, 10, pd.NA], dtype="Int64")) == {"n": 30, "masked": 1}
    assert bmo.cell(pd.Series([pd.NA], dtype="Int64"))["n"] is None


def test_masked_block_carries_the_validated_label_and_says_it_is_a_deduction() -> None:
    doc, _ = bmo.build_export(frame(ROWS), "t")
    assert doc["masked"]["label"] == "non diffusé par France Travail (vraisemblablement moins de 5 projets)"
    assert "Déduction" in doc["masked"]["note"] and "ne définit pas" in doc["masked"]["note"]
    assert "evidence" not in doc["masked"]  # preuve chiffrée seulement si elle a été calculée sur le classeur
    ev = {"rows": 53786, "scope": "x", "measures": list(bmo.METRICS), "min_published": {"met": 5, "xmet": 5, "smet": 5},
          "published_below_threshold": 0, "threshold": 5}
    doc2, _ = bmo.build_export(frame(ROWS), "t", ev)
    assert "53\u00a0786 lignes" in doc2["masked"]["note"] and doc2["masked"]["evidence"] == ev
    assert not any(d in json.dumps(doc2, ensure_ascii=False) for d in bmo.FORBIDDEN_DASHES)


def test_check_main_flags_a_label_drift_and_a_value_under_the_threshold() -> None:
    df = frame(ROWS)
    ev = {"rows": 10, "scope": "x", "measures": list(bmo.METRICS), "min_published": {"met": 5, "xmet": 5, "smet": 5},
          "published_below_threshold": 0, "threshold": 5}
    doc, _ = bmo.build_export(df, "t", ev)
    # le recalcul des régions ne passe pas sur des données de test (total officiel) : on ne garde que les erreurs « masked »
    errs = [e for e in bmo.check_main(doc, df, ev) if "masked" in e or "sous" in e]
    assert errs == []
    doc["masked"] = {**doc["masked"], "label": "moins de 5"}
    assert any("masked.label" in e for e in bmo.check_main(doc, df, ev))
    bad = {**ev, "published_below_threshold": 2}
    doc2, _ = bmo.build_export(df, "t", bad)
    assert any("ne tient plus" in e for e in bmo.check_main(doc2, df, bad))


def test_mask_evidence_reads_every_row_and_counts_values_under_the_threshold(tmp_path: Path) -> None:
    cols = list(bmo.EXPECTED_COLUMNS)
    rows = [[2026, "A", "n", "Z", "l", "11", "IDF", "75", "Paris", "1107", "T1", "C", 12, "*", 5],
            [2026, "B", "n", "Z", "l", "84", "Autre", "01", "Ain", "9999", "X", "C", 7, 9, "*"]]
    path = tmp_path / "ev.xlsx"
    with pd.ExcelWriter(path) as w:
        pd.DataFrame(rows, columns=cols).to_excel(w, sheet_name=bmo.BMO_SHEET, index=False)
    ev = bmo.mask_evidence(path)
    assert ev["rows"] == 2 and ev["min_published"] == {"met": 7, "xmet": 9, "smet": 5} and ev["published_below_threshold"] == 0
    rows[1][12] = 3  # une valeur publiée à 3 : la déduction « moins de 5 » ne tient plus
    with pd.ExcelWriter(path) as w:
        pd.DataFrame(rows, columns=cols).to_excel(w, sheet_name=bmo.BMO_SHEET, index=False)
    assert bmo.mask_evidence(path)["published_below_threshold"] == 1


def test_check_detail_detects_a_changed_total() -> None:
    main, detail = bmo.build_export(frame(ROWS), "t")
    detail["bassins"]["1001"]["V1"][0] = 151
    assert any("détail par métier" in e for e in bmo.check_detail(detail, main))


def test_check_poles_old_sky_has_no_bassin_and_new_sky_must_resolve() -> None:
    main, _ = bmo.build_export(frame(ROWS), "t")
    old = [{"id": "P_DEFENSE"}]
    new_ok = [{"id": "BE_1001", "bassin": {"code": "1001", "name": "Bassin 1001"}}]
    new_bad = [{"id": "BE_9", "bassin": {"code": "9999", "name": "x"}},
               {"id": "BE_1", "bassin": {"code": "1001", "name": "Autre libellé"}}]
    assert bmo.check_poles(old, main, "poles.json") == []
    assert bmo.check_poles(new_ok, main, "preview") == []
    assert len(bmo.check_poles(new_bad, main, "preview")) == 2


def test_read_bmo_rejects_unexpected_values(tmp_path: Path) -> None:
    cols = list(bmo.EXPECTED_COLUMNS)
    row = [2026, "A0X40", "Agriculteurs", "Z", "Autres métiers", "11", "Île-de-France", "75", "Paris", "1107",
           "T1 Paris", "CLPE75001", "12", "*", "5"]
    ok = pd.DataFrame([row], columns=cols)
    path = tmp_path / "ok.xlsx"
    with pd.ExcelWriter(path) as w:
        ok.to_excel(w, sheet_name=bmo.BMO_SHEET, index=False)
    df = bmo.read_bmo(path)
    assert df.loc[0, "met"] == 12 and pd.isna(df.loc[0, "xmet"]) and df.loc[0, "smet"] == 5
    bad = ok.copy()
    bad.loc[0, "met"] = "1,5"
    path2 = tmp_path / "bad.xlsx"
    with pd.ExcelWriter(path2) as w:
        bad.to_excel(w, sheet_name=bmo.BMO_SHEET, index=False)
    with pytest.raises(ValueError, match="ni entière ni"):
        bmo.read_bmo(path2)


def test_read_bmo_rejects_long_dash_in_label(tmp_path: Path) -> None:
    cols = list(bmo.EXPECTED_COLUMNS)
    row = [2026, "A0X40", "Agri" + chr(0x2013) + "culteurs", "Z", "Autres", "11", "IDF", "75", "Paris", "1107", "T1", "C", 1, 1, 1]
    path = tmp_path / "dash.xlsx"
    with pd.ExcelWriter(path) as w:
        pd.DataFrame([row], columns=cols).to_excel(w, sheet_name=bmo.BMO_SHEET, index=False)
    with pytest.raises(ValueError, match="tiret"):
        bmo.read_bmo(path)


# ------------------------------------------------------------------ fichiers réels (ignorés sans data/raw)
needs_raw = pytest.mark.skipif(not bmo.BMO_XLSX.exists(), reason="data/raw/EMP03 absent")


@needs_raw
def test_real_file_figures_of_the_study() -> None:
    df = bmo.read_bmo()
    assert len(df) == 4536 and df["bassin"].nunique() == 25 and df["metier"].nunique() == 216
    doc, detail = bmo.build_export(df, "t")
    assert doc["region"]["published"]["met"] == {"n": 386835, "masked": 645}
    assert doc["region"]["official"]["projects"] == 388806 and 386835 < 388806
    assert bmo.check_main(doc, df) == [] and bmo.check_detail(detail, doc) == []
    # familles par ordre décroissant : V (142 113) en tête (docs/etude-bmo.md § 2)
    assert doc["families"][0]["code"] == "V"
    assert doc["bassins"]["1107"]["total"]["met"]["n"] == 118850
    assert doc["bassins"]["1153"]["total"] == {"met": {"n": 1679, "masked": 22}, "xmet": doc["bassins"]["1153"]["total"]["xmet"],
                                               "smet": doc["bassins"]["1153"]["total"]["smet"]}
    # cas de la visite (étape non activée) : S1X20 « aides de cuisine » à T1 Paris
    row = detail["bassins"]["1107"]["S1X20"]
    assert row[0] == 6973 and row[2] == 1815


@needs_raw
def test_real_file_has_no_zero_substituted_for_a_masked_cell() -> None:
    df = bmo.read_bmo()
    assert df["met"].min() >= 5  # aucune valeur publiée sous 5 : pas de 0 de substitution
    assert int(df["met"].isna().sum()) == 645


@needs_raw
def test_real_file_mask_deduction_holds_on_all_53786_rows() -> None:
    ev = bmo.mask_evidence()
    assert ev["rows"] == 53786
    assert ev["min_published"] == {"met": 5, "xmet": 5, "smet": 5} and ev["published_below_threshold"] == 0


@needs_raw
def test_official_pdf_is_the_verified_file() -> None:
    assert bmo.verify_official() == []


@needs_raw
def test_published_files_if_present_are_the_recomputation() -> None:
    path = FRONT_DATA_DIR / "bmo.json"
    if not path.exists():
        pytest.skip("bmo.json non publié")
    df = bmo.read_bmo()
    ev = bmo.mask_evidence()
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert bmo.check_main(doc, df, ev) == []
    detail = json.loads((FRONT_DATA_DIR / "bmo_metiers.json").read_text(encoding="utf-8"))
    assert bmo.check_detail(detail, doc) == []
    for name in ("poles.json",):
        p = FRONT_DATA_DIR / name
        if p.exists():
            assert bmo.check_poles(json.loads(p.read_text(encoding="utf-8")), doc, name) == []
