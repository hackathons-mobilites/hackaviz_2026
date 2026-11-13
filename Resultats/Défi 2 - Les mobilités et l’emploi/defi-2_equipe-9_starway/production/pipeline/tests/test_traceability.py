"""Tests de la traçabilité des blocs affichés (starway.traceability, script 06u, docs/tracabilite.md)."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

from starway import traceability as tr
from starway.config import REPO_ROOT


def test_starway_data_root_redirige_raw_et_interim_sans_toucher_processed(tmp_path: Path) -> None:
    """Sans la variable : tout dans l'arbre. Avec elle : raw et interim (et `data_path`) viennent de l'autre dossier `data`."""
    code = ("import json; from starway import config as c; "
            "print(json.dumps({'raw': str(c.RAW_DIR), 'interim': str(c.INTERIM_DIR), 'processed': str(c.PROCESSED_DIR), "
            "'p': str(c.data_path('data/raw/EMP03/x.xlsx')), 'q': str(c.data_path('data/processed/y.csv')), "
            "'rel': c.manifest_rel(c.RAW_DIR / 'EMP03' / 'x.xlsx')}))")
    base = {k: v for k, v in os.environ.items() if k != "STARWAY_DATA_ROOT"}
    base["PYTHONPATH"] = str(REPO_ROOT / "pipeline")

    def run(extra: dict[str, str]) -> dict[str, str]:
        out = subprocess.run([sys.executable, "-c", code], env={**base, **extra}, capture_output=True, text=True, check=True)
        return json.loads(out.stdout)

    default = run({})
    assert default["raw"] == str(REPO_ROOT / "data" / "raw") and default["p"] == str(REPO_ROOT / "data" / "raw" / "EMP03" / "x.xlsx")
    other = tmp_path / "principal" / "data"
    other.mkdir(parents=True)
    moved = run({"STARWAY_DATA_ROOT": str(other)})
    assert moved["raw"] == str((other / "raw").resolve()) and moved["interim"] == str((other / "interim").resolve())
    assert moved["processed"] == str(REPO_ROOT / "data" / "processed")
    assert moved["p"] == str((other / "raw" / "EMP03" / "x.xlsx").resolve())
    assert moved["q"] == str(REPO_ROOT / "data" / "processed" / "y.csv")
    assert moved["rel"] == default["rel"] == "data/raw/EMP03/x.xlsx"


def real_roots(tmp_path: Path) -> tr.DataRoots:
    """Arbre réel sans données volumineuses : le rendu et les contrôles de structure n'en dépendent pas."""
    return tr.DataRoots(REPO_ROOT, tmp_path / "raw", tmp_path / "interim", REPO_ROOT / "data" / "processed")


# --------------------------------------------------------------------------- lecture TypeScript
def test_strip_ts_comments_respecte_les_chaines() -> None:
    src = "const a = \"l'état // pas un commentaire\"; // vrai commentaire d'un autre\nconst b = 'x'; /* bloc */ const c = 1;"
    out = tr.strip_ts_comments(src)
    assert "pas un commentaire" in out
    assert "vrai commentaire" not in out and "bloc" not in out
    assert "const c = 1;" in out


SAMPLE = """
const SKY = ['EMP01', 'TRA01'] as const;
export const PROVENANCE_COVERAGE: readonly CoverageEntry[] = [
  // commentaire ignoré
  { file: 'A.tsx', kind: 'notes', codes: SKY },
  { file: 'proof/B.tsx', kind: 'covered', coveredBy: 'A.tsx', codes: ['EMP01'] },
  {
    file: 'C.tsx',
    kind: 'exempt',
    codes: [],
    reason: "Calque décoratif (aria-hidden) : l'aucun chiffre ni donnée n'y est affiché.",
  },
  { file: 'D.tsx', kind: 'notes', codes: ['ENV01'], whenPublished: ['ZZZ99'] },
];
"""


def test_parse_coverage_constantes_exemptions_et_codes_futurs() -> None:
    entries = tr.parse_coverage(SAMPLE)
    assert [e.file for e in entries] == ["A.tsx", "proof/B.tsx", "C.tsx", "D.tsx"]
    assert entries[0].codes == ("EMP01", "TRA01") and entries[0].kind == "notes"
    assert entries[1].covered_by == "A.tsx" and entries[1].kind == "covered"
    assert entries[2].reason and "l'aucun chiffre" in entries[2].reason and entries[2].codes == ()
    assert entries[3].when_published == ("ZZZ99",)


def test_registre_reel_lu_en_entier() -> None:
    text = (REPO_ROOT / tr.REGISTRY_TS).read_text(encoding="utf-8")
    entries = tr.parse_coverage(text)
    n_files = len(re.findall(r"^\s*(?:\{\s*)?file:\s*'", tr.strip_ts_comments(text), re.MULTILINE))
    assert len(entries) == n_files >= 30
    assert len({e.file for e in entries}) == len(entries)
    assert all(e.kind in ("notes", "covered", "exempt") for e in entries)
    by = {e.file: e for e in entries}
    assert all(e.covered_by in by and by[e.covered_by].kind == "notes" for e in entries if e.kind == "covered")
    assert all(len(e.reason or "") > 30 for e in entries if e.kind == "exempt")
    assert all(e.codes for e in entries if e.kind != "exempt")


def test_parse_methods_reel() -> None:
    methods = tr.parse_methods((REPO_ROOT / tr.PROVENANCE_TS).read_text(encoding="utf-8"))
    assert {"tickets", "carbon", "offpeak", "modes", "flows"} <= set(methods)
    assert all(len(v) > 40 for v in methods.values())


def test_scan_component_notes_et_methodes_hors_commentaires() -> None:
    tsx = """
      // <CodeSourceNote code="FAUX01" />
      <CodeSourceNote code="ENV01" method={METHODS.carbon} />
      <CodeSourceNote
        code="COST02"
        method={METHODS.tickets}
      />
      <FlowsSourceNote ctxs={[a, b]} />
      <NeedsMethodNote />
      <p className="pf-prov">pas une note</p>
    """
    uses = tr.scan_component(tsx)
    assert [(u.component, u.code, u.method) for u in uses] == [
        ("CodeSourceNote", "ENV01", "carbon"), ("CodeSourceNote", "COST02", "tickets"),
        ("FlowsSourceNote", None, None), ("NeedsMethodNote", None, None)]
    assert uses[0].label() == "CodeSourceNote(ENV01 ; méthode METHODS.carbon)"


def test_scanned_components_comme_le_test_du_front(tmp_path: Path) -> None:
    for rel in ("ProofPanel.tsx", "proof/ProofCost.tsx", "needs/NeedsMarks.tsx", "proof/Other.tsx",
                "provenance/ProofNotes.tsx", "proof/ProofCost.test.tsx", "SkyList.tsx"):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("x", encoding="utf-8")
    assert tr.scanned_components(tmp_path) == ["ProofPanel.tsx", "needs/NeedsMarks.tsx", "proof/ProofCost.tsx"]


# --------------------------------------------------------------------------- formules lues dans le code
def test_ts_doc_commentaire_de_la_fonction() -> None:
    ts = """/** En-tête du fichier. */
import x from 'y';

/**
 * Accessible pour un budget B.
 * - aller ET retour
 */
export function isAccessible(a: number) { return a; }

/** Autre. */
export const AUTRE = 1;
"""
    assert tr.ts_doc(ts, "isAccessible") == "Accessible pour un budget B. - aller ET retour"
    assert tr.ts_doc(ts, "AUTRE") == "Autre."
    assert tr.ts_doc(ts, "") == "En-tête du fichier."
    assert tr.ts_doc(ts, "absente") is None


def test_py_doc_premier_paragraphe() -> None:
    src = '"""Module.\n\nDétail du module."""\n\ndef f():\n    """Premier paragraphe\n    sur deux lignes.\n\n    Suite."""\n'
    assert tr.py_doc(src, "") == "Module."
    assert tr.py_doc(src, "f") == "Premier paragraphe sur deux lignes."
    assert tr.py_doc(src, "g") is None


# --------------------------------------------------------------------------- sha256 du manifeste
def test_file_hashes_formes_de_fins_de_ligne(tmp_path: Path) -> None:
    f = tmp_path / "a.csv"
    f.write_bytes(b"a,b\r\n1,2\r\n")
    h = tr.file_hashes(f)
    assert h["brut"] == h["CRLF"] != h["LF"]
    assert h["LF"] == hashlib.sha256(b"a,b\n1,2\n").hexdigest()
    z = tmp_path / "a.zip"
    z.write_bytes(b"PK\r\n")
    assert set(tr.file_hashes(z)) == {"brut"}


def test_lf_sha256_meme_empreinte_en_crlf_et_en_lf(tmp_path: Path) -> None:
    lf = tmp_path / "lf" / "tour.resolved.json"
    crlf = tmp_path / "crlf" / "tour.resolved.json"
    lf.parent.mkdir()
    crlf.parent.mkdir()
    lf.write_bytes(b'{\n  "steps": []\n}\n')
    crlf.write_bytes(b'{\r\n  "steps": []\r\n}\r\n')
    assert tr.lf_sha256(lf) == tr.lf_sha256(crlf) == hashlib.sha256(b'{\n  "steps": []\n}\n').hexdigest()
    assert hashlib.sha256(crlf.read_bytes()).hexdigest() != tr.lf_sha256(crlf)  # l'empreinte brute dépendrait du poste
    z = tmp_path / "a.zip"
    z.write_bytes(b"PK\r\n")  # binaire : octets tels quels
    assert tr.lf_sha256(z) == hashlib.sha256(b"PK\r\n").hexdigest()


def test_visite_empreinte_du_texte_enregistre_independante_des_fins_de_ligne(tmp_path: Path) -> None:
    (tmp_path / "frontend/src/tour/tours").mkdir(parents=True)
    (tmp_path / "frontend/public/tour/lea").mkdir(parents=True)
    for rel in (tr.TOUR_TS, tr.TOUR_VARIABLES_TS):
        (tmp_path / rel).write_bytes((REPO_ROOT / rel).read_bytes())
    body = '{\n  "generated_at": "2026-11-01",\n  "dataset_id": "x",\n  "steps": []\n}\n'
    shas = []
    for eol in ("\n", "\r\n"):
        (tmp_path / tr.TOUR_RESOLVED).write_bytes(body.replace("\n", eol).encode())
        info = tr.collect_visit(tmp_path, tr.FAMILIES, [], [])
        shas.append(info["resolved"]["sha256"])
    assert shas[0] == shas[1] == hashlib.sha256(body.encode()).hexdigest()


def _row(sid: str, fichier: str, sha: str) -> dict[str, str]:
    return {"source_id": sid, "fichier_local": fichier, "sha256": sha}


def test_check_manifest_tous_les_cas(tmp_path: Path) -> None:
    roots = tr.DataRoots(tmp_path, tmp_path / "raw", tmp_path / "interim", tmp_path / "processed")
    (tmp_path / "raw" / "X1").mkdir(parents=True)
    (tmp_path / "processed").mkdir()
    good = b"contenu"
    (tmp_path / "raw" / "X1" / "ok.zip").write_bytes(good)
    (tmp_path / "raw" / "X1" / "ko.zip").write_bytes(b"autre")
    (tmp_path / "processed" / "t.csv").write_bytes(b"a\r\nb\r\n")
    sha = lambda b: hashlib.sha256(b).hexdigest()
    rows = [
        _row("X1", "data/raw/X1/ok.zip", sha(good)),
        _row("X1", "data/raw/X1/ko.zip", sha(good)),  # empreinte d'un autre contenu : écart
        _row("X1", "data/raw/X1/absent.zip", sha(good)),
        _row("X2", "data/processed/t.csv", sha(b"a\nb\n")),  # même contenu, fins de ligne LF dans le manifeste
        _row("X3", "data/interim/cache/", "ab" * 32),
        _row("X4", "<VM_DE_CALCUL>:~/r5build/r5.jar", "cd" * 32),
        _row("X5", "data/raw/X1/ok.zip", ""),
    ]
    checks, index = tr.check_manifest(rows, roots)
    assert [c.status for c in checks] == ["ok", "ecart", "absent", "ok_eol", "repertoire", "hors_depot", "sans_empreinte"]
    assert ("X4", "<VM_DE_CALCUL>:~/r5build/r5.jar") in index["cd" * 32]
    assert any(e[0] == "X2" for e in index[sha(b"a\r\nb\r\n")])  # l'empreinte CRLF du fichier présent est aussi indexée


def test_resolve_local_ignore_le_commentaire_apres_le_chemin(tmp_path: Path) -> None:
    roots = tr.DataRoots(tmp_path, tmp_path / "raw", tmp_path / "interim", tmp_path / "processed")
    p, nature = tr.resolve_local("data/processed/x.csv (réponses : data/interim/navitia_cache/connections_*.json)", roots)
    assert nature == "fichier" and p == tmp_path / "processed" / "x.csv"
    assert tr.resolve_local("%LOCALAPPDATA%\\r5py\\x.jar (poste) ; ~/.cache/x.jar (VM)", roots) == (None, "hors_depot")


# --------------------------------------------------------------------------- empreintes de run_params.json
def test_resolve_fingerprints_jar_gtfs_et_sous_ensemble() -> None:
    jar, gtfs_soir, gtfs_jour = "a" * 64, "b" * 64, "c" * 64
    index = {jar: [("ENG01", "vm:~/r5build/walk3000.jar")], gtfs_soir: [("TRA01C", "data/raw/TRA01C/gtfs_soir.zip")],
             gtfs_jour: [("TRA01", "data/raw/TRA01/IDFM-gtfs.zip")]}
    cd = tr.CalcDir("od_walk3000_d031_nuit_soir_v2", "t", "complet", "d" * 64,
                    {"r5_jar_sha256": jar, "gtfs_sha256": gtfs_soir, "n_origins": 12, "origin_points_sha256": "e" * 64})
    tr.resolve_fingerprints(cd, index, "f" * 64)
    res = {r.key: r for r in cd.resolutions}
    assert res["r5_jar_sha256"].status == "ok" and res["r5_jar_sha256"].target.startswith("ENG01 (walk3000.jar)")
    assert res["gtfs_sha256"].status == "ok" and res["gtfs_sha256"].target.startswith("TRA01C")
    assert res["osm_sha256"].status == "absent"
    assert res["origin_points_sha256"].status == "sous_ensemble"
    # une table du soir calculée sur le GTFS de jour : mauvais réseau, jamais accepté
    bad = tr.CalcDir("od_walk3000_d031_nuit_soir_v2", "t", "complet", None, {"gtfs_sha256": gtfs_jour})
    tr.resolve_fingerprints(bad, index, None)
    assert {r.key: r.status for r in bad.resolutions}["gtfs_sha256"] == "autre_source"
    unknown = tr.CalcDir("matrix_walk3000_d031_b44", "t", "complet", None, {"r5_jar_sha256": "9" * 64})
    tr.resolve_fingerprints(unknown, index, None)
    assert {r.key: r.status for r in unknown.resolutions}["r5_jar_sha256"] == "inconnu"


# --------------------------------------------------------------------------- blocs et document
def test_familles_coherentes_avec_le_registre_reel(tmp_path: Path) -> None:
    trace = tr.collect(real_roots(tmp_path), verify=False)
    blocking = [p for p in trace.problems if p.level == "P0"]
    assert blocking == []
    ids = [f.id for f in tr.FAMILIES]
    assert len(ids) == len(set(ids)) and tr.VISIT_ID not in ids
    files = [x for f in tr.FAMILIES for x in f.files]
    assert len(files) == len(set(files)) == len(trace.entries)


def test_chaque_formule_porte_une_documentation() -> None:
    for f in tr.FAMILIES:
        assert f.formulas, f.id
        for ref in f.formulas:
            doc = tr.doc_of(ref, REPO_ROOT)
            assert doc and len(doc) > 20, f"{f.id} : {ref}"


def test_variables_de_la_visite_toutes_rattachees_a_un_bloc() -> None:
    vs = tr.tour_variables((REPO_ROOT / tr.TOUR_TS).read_text(encoding="utf-8"),
                           (REPO_ROOT / tr.TOUR_VARIABLES_TS).read_text(encoding="utf-8"))
    assert "pole.oralName" in vs and "flow.peopleOral" in vs and len(vs) > 15
    mapped = set(tr.VISIT_PREFIX_FAMILY) | set(tr.VISIT_PREFIX_CODES)
    assert {v.split(".")[0] for v in vs} <= mapped
    assert set(tr.VISIT_PREFIX_FAMILY.values()) <= {f.id for f in tr.FAMILIES}


def test_rendu_deterministe_complet_et_sans_tiret_long(tmp_path: Path) -> None:
    trace = tr.collect(real_roots(tmp_path), verify=False)
    doc = tr.render(trace)
    assert doc == tr.render(trace)
    assert "\u2014" not in doc and "\u2013" not in doc
    assert tr.missing_in_doc(doc, tr.expected_components(trace)) == []
    for f in tr.FAMILIES:
        assert f"### {f.id} : " in doc
    assert f"### {tr.VISIT_ID} : " in doc
    # chaque source citée par le registre a ses fichiers et leurs sha256 complets dans le document
    for e in trace.entries:
        for code in e.codes:
            for row in (r for r in trace.manifest if r["source_id"] == code):
                assert row["sha256"] in doc, (code, row["fichier_local"])


def test_controle_detecte_un_bloc_sans_ligne(tmp_path: Path) -> None:
    trace = tr.collect(real_roots(tmp_path), verify=False)
    doc = tr.render(trace)
    victim = "proof/TripBlock.tsx"
    cut = "\n".join(ln for ln in doc.splitlines() if not ln.startswith(f"| `{victim}` |"))
    assert tr.missing_in_doc(cut, tr.expected_components(trace)) == [victim]
    no_visit = "\n".join(ln for ln in doc.splitlines() if tr.VISIT_ROW not in ln)
    assert tr.missing_in_doc(no_visit, tr.expected_components(trace)) == [tr.VISIT_ROW]


def test_controle_detecte_un_code_absent_du_manifeste(tmp_path: Path) -> None:
    manifest = [r for r in tr._read_manifest(REPO_ROOT / "data" / "sources_manifest.csv") if r["source_id"] != "ENV01"]
    trace = tr.collect(real_roots(tmp_path), manifest=manifest, verify=False)
    bad = tr.problems_of(trace, ["source"], "P0")
    assert bad and all("ENV01" in p.message for p in bad)


def test_controle_detecte_un_composant_non_inscrit_au_registre(tmp_path: Path) -> None:
    fams = tuple(f for f in tr.FAMILIES if f.id != "B06")  # TripBlock.tsx n'a plus de bloc
    trace = tr.collect(real_roots(tmp_path), families=fams, verify=False)
    assert any("TripBlock.tsx" in p.message and p.kind == "bloc" for p in trace.problems)


def test_document_versionne_contient_tous_les_composants(tmp_path: Path) -> None:
    """Le document committé indexe chaque composant du registre (le contrôle P0 de 07 le vérifie sur le fichier)."""
    trace = tr.collect(real_roots(tmp_path), verify=False)
    doc = (REPO_ROOT / tr.DOC_PATH).read_text(encoding="utf-8")
    assert tr.missing_in_doc(doc, tr.expected_components(trace)) == []


def test_manifeste_reel_ses_codes_et_les_nouvelles_sources() -> None:
    rows = tr._read_manifest(REPO_ROOT / "data" / "sources_manifest.csv")
    codes = {r["source_id"] for r in rows}
    assert {"TRA01", "TRA01B", "TRA01C", "TRA02B", "TRA02C", "ENG01", "GEO04B", "GEO02B"} <= codes
    assert all(re.fullmatch(r"[0-9a-f]{64}", r["sha256"]) for r in rows)
    jars = {r["sha256"]: r["fichier_local"] for r in rows if r["source_id"] == "ENG01"}
    assert len(jars) == 7 and all(p.endswith(".jar") or ".jar " in p for p in jars.values())
    # les trois GTFS (jour, nuit, soir) du flux du 06/11 (D-046) : un fichier chacun, sous les noms nouveaux du rapatriement
    gtfs = {r["source_id"]: r["fichier_local"] for r in rows if r["source_id"] in ("TRA01", "TRA01B", "TRA01C")}
    assert gtfs == {"TRA01": "data/raw/TRA01/IDFM-gtfs-0611.zip", "TRA01B": "data/raw/TRA01B/gtfs_nuit-0611.zip",
                    "TRA01C": "data/raw/TRA01C/gtfs_soir-0611.zip"}


def test_sha256_du_fichier_des_astres_est_celui_du_manifeste_ou_sa_forme_lf() -> None:
    rows = [r for r in tr._read_manifest(REPO_ROOT / "data" / "sources_manifest.csv") if r["source_id"] == "GEO04B"]
    assert len(rows) == 1
    forms = tr.file_hashes(REPO_ROOT / rows[0]["fichier_local"])
    assert rows[0]["sha256"] in forms.values()
    poles = json.loads((REPO_ROOT / rows[0]["fichier_local"]).read_text(encoding="utf-8"))
    assert len(poles) == 44


@pytest.mark.parametrize("sid", ["GEO02B", "TRA02B", "TRA02C"])
def test_fichiers_derives_versionnes_conformes_au_manifeste(sid: str) -> None:
    rows = [r for r in tr._read_manifest(REPO_ROOT / "data" / "sources_manifest.csv") if r["source_id"] == sid]
    for r in rows:
        path, nature = tr.resolve_local(r["fichier_local"], tr.DataRoots(REPO_ROOT, REPO_ROOT / "data" / "raw",
                                                                         REPO_ROOT / "data" / "interim",
                                                                         REPO_ROOT / "data" / "processed"))
        assert nature == "fichier" and path is not None
        assert r["sha256"] in tr.file_hashes(path).values(), r["fichier_local"]
