"""Tests de starway.territoire : repères de territoire (chômage, temps de travail, polarités SDRIF-E), lot T1 du plan
docs/plan-contexte-territoire.md. Les cas d'école sont synthétiques ; les tests sur les vrais fichiers sont ignorés quand
data/raw n'est pas là (STARWAY_DATA_ROOT)."""

import io
import json
import re
import zipfile

import openpyxl
import pytest

from starway import registry as rg
from starway import territoire as tr
from starway.config import FRONT_DATA_DIR, IDF_DEPS, IDF_REGION, PROCESSED_DIR, RAW_DIR

EM = chr(0x2014)


# --------------------------------------------------------------------------- fabrication de petits fichiers
def save_book(path, sheets):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    wb.save(path)


def zone_book(path, rows):
    header = ["ZE2020", "LIBZE2020", "REG", "LIBREG", "2025-T4", "2026-T1", "2026-T2"]
    save_book(path, {"Documentation": [["doc"]],
                     "txcho_ze": [["titre"], [], ["Code", "Libellé", "Région"], header, *rows]})


def localised_zip(path, dep_rows, reg_rows, head_dep="2ᵉ trim. 2026 (p)", head_reg="2ᵉ trim. 2026 (p)"):
    """Zip contenant un classeur à deux feuilles DEP et REG (colonnes A code, B nom, C dernier trimestre, D précédent)."""
    buf = io.BytesIO()
    book = io.BytesIO()
    save_book(book, {"DEP": [["Taux au 2ᵉ trimestre 2026"], [], [None, None, "CVS"], [None, None, head_dep, "1ᵉʳ trim. 2026"], *dep_rows],
                     "REG": [["Taux au 2ᵉ trimestre 2026"], [], [None, None, "CVS"], [None, None, head_reg, "1ᵉʳ trim. 2026"], *reg_rows]})
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("TCRD_025.xlsx", book.getvalue())
    path.write_bytes(buf.getvalue())


def work_book(path, soir=27, nuit=11, soir2=27, nuit2=11):
    save_book(path, {
        "Figure 1": [["Figure 1 - Horaires"], [None, None, "en %"], ["Horaires de travail atypiques", 2014, 2024],
                     ["Soir (20h-00h)", 26, soir], ["Nuit (00h-5h)", 10, nuit], ["Samedi", 40, 36],
                     ["Champ : France hors Mayotte, ensemble des salariés, âgés de 15\xa0ans ou plus, vivant dans un logement ordinaire."]],
        "Figure 2": [["Figure 2"], ["Caractéristiques", "soir", "nuit"], ["Ensemble des salariés ", soir2, nuit2, 36]],
    })


def communes_fixture():
    def c(code, name, dep, kind="commune", origin=True):
        return tr.Commune(code, name, dep, kind, origin)
    return {x.code: x for x in [
        c("75056", "Paris", "75", origin=False), c("75101", "Paris 1er Arrondissement", "75", "arrondissement"),
        c("75102", "Paris 2e Arrondissement", "75", "arrondissement"),
        c("78165", "Les Clayes-sous-Bois", "78"), c("93070", "Saint-Ouen-sur-Seine", "93"),
        c("77428", "Saint-Ouen-en-Brie", "77"), c("95572", "Saint-Ouen-l'Aumône", "95"),
        c("78358", "Maisons-Laffitte", "78"), c("78418", "Montesson", "78"),
        c("77034", "Blandy", "77"), c("91067", "Blandy", "91"),
    ]}


# --------------------------------------------------------------------------- provenance et empreintes
def test_parse_provenance_reads_date_publication_and_sha():
    text = ("a.xlsx\nsource : Taux, Insee, paru le 18/09/2026\nurl : http://x\ntéléchargé le 2026-11-06, sans modification\n"
            "sha256 : abc\n\nb.csv\nsource : Polarités, Licence Ouverte v2.0\nurl : http://y\ntéléchargé le 2026-11-06, sans modification\nsha256 : def\n")
    got = tr.parse_provenance(text.replace("\n", "\r\n"))
    assert got["a.xlsx"]["published"] == "2026-09-18" and got["a.xlsx"]["sha256"] == "abc"
    assert got["b.csv"]["published"] is None and got["b.csv"]["downloaded"] == "2026-11-06"


def test_parse_provenance_refuses_incomplete_block():
    with pytest.raises(tr.TerritoireError, match="sha256"):
        tr.parse_provenance("a.xlsx\nsource : x\ntéléchargé le 2026-11-06\n")


def test_locate_raw_refuses_modified_file(tmp_path):
    for code, name in (("SOC02", "a.xlsx"), ("SOC02", "b.zip"), ("GEO05", "z.json"), ("GEO06", "p.csv"), ("EMP05", "e.xlsx")):
        (tmp_path / code).mkdir(exist_ok=True)
        (tmp_path / code / name).write_bytes(b"contenu " + name.encode())
    for code in ("SOC02", "GEO05", "GEO06", "EMP05"):
        blocks = []
        for f in sorted((tmp_path / code).iterdir()):
            blocks.append(f"{f.name}\nsource : s\nurl : u\ntéléchargé le 2026-11-06, sans modification\nsha256 : {tr.sha256_file(f)}\n")
        (tmp_path / code / "PROVENANCE.txt").write_text("\n".join(blocks), encoding="utf-8")
    assert set(tr.locate_raw(tmp_path)) == {"SOC02", "GEO05", "GEO06", "EMP05"}
    (tmp_path / "GEO05" / "z.json").write_bytes(b"modifie")
    with pytest.raises(tr.TerritoireError, match="empreinte"):
        tr.locate_raw(tmp_path)


# --------------------------------------------------------------------------- chômage par zone d'emploi
def test_zone_rates_filter_on_region_code_not_on_text(tmp_path):
    zone_book(tmp_path / "z.xlsx", [
        ["1114", "Seine-Yvelinoise", "11", "ILE-DE-FRANCE", 8.9, 8.8, 8.9],
        ["1109", "Paris", "11", "ILE-DE-FRANCE", 8.0, 8.1, 8.1],
        ["1135", "Creusot-Montceau", "27", "BOURGOGNE", 7, 7.1, 7.2],  # code qui commence par 11, autre région
    ])
    r = tr.read_zone_rates(tmp_path / "z.xlsx", "11")
    assert r.quarters == ["2025-T4", "2026-T1", "2026-T2"]
    assert set(r.series) == {"1114", "1109"} and r.series["1114"] == [8.9, 8.8, 8.9]


def test_zone_rates_refuse_missing_value(tmp_path):
    zone_book(tmp_path / "z.xlsx", [["1114", "Seine-Yvelinoise", "11", "IDF", 8.9, None, 8.9]])
    with pytest.raises(tr.TerritoireError, match="2026-T1"):
        tr.read_zone_rates(tmp_path / "z.xlsx", "11")


# --------------------------------------------------------------------------- chômage par département et région (XML)
def test_localised_rates_each_code_in_its_own_sheet(tmp_path):
    localised_zip(tmp_path / "t.zip",
                  [["11", "Aude", 11.1, 10.9], ["78", "Yvelines", 7.7, 7.4], ["75", "Paris", 6.6, 6.4]],
                  [["11", "Île-de-France", 8.2, 7.9], ["75", "Nouvelle-Aquitaine", 7.5, 7.3]])
    r = tr.read_localised_rates(tmp_path / "t.zip", ["75", "78"], "11")
    assert r.quarter == "2026-T2" and r.provisional is True
    assert r.departments == {"75": ("Paris", 6.6), "78": ("Yvelines", 7.7)}
    assert r.region == ("11", "Île-de-France", 8.2)


def test_localised_rates_not_provisional_without_p(tmp_path):
    localised_zip(tmp_path / "t.zip", [["78", "Yvelines", 7.7, 7.4]], [["11", "Île-de-France", 8.2, 7.9]],
                  head_dep="1ᵉʳ trim. 2026", head_reg="1ᵉʳ trim. 2026")
    r = tr.read_localised_rates(tmp_path / "t.zip", ["78"], "11")
    assert r.quarter == "2026-T1" and r.provisional is False


def test_localised_rates_refuse_missing_department_or_rate(tmp_path):
    localised_zip(tmp_path / "t.zip", [["78", "Yvelines", None, 7.4]], [["11", "Île-de-France", 8.2, 7.9]])
    with pytest.raises(tr.TerritoireError, match="78"):
        tr.read_localised_rates(tmp_path / "t.zip", ["78"], "11")
    with pytest.raises(tr.TerritoireError, match="absent"):
        tr.read_localised_rates(tmp_path / "t.zip", ["95"], "11")


def test_localised_rates_refuse_quarters_that_differ(tmp_path):
    localised_zip(tmp_path / "t.zip", [["78", "Yvelines", 7.7, 7.4]], [["11", "Île-de-France", 8.2, 7.9]],
                  head_reg="1ᵉʳ trim. 2026")
    with pytest.raises(tr.TerritoireError, match="trimestres différents"):
        tr.read_localised_rates(tmp_path / "t.zip", ["78"], "11")


# --------------------------------------------------------------------------- temps de travail
def test_working_time_reads_latest_year_and_scope(tmp_path):
    work_book(tmp_path / "e.xlsx")
    wt = tr.read_working_time(tmp_path / "e.xlsx")
    assert (wt.year, wt.evening_pct, wt.night_pct) == (2024, 27, 11)
    assert wt.scope == "France hors Mayotte, ensemble des salariés"


def test_working_time_refuses_figures_that_disagree(tmp_path):
    work_book(tmp_path / "e.xlsx", soir2=28)
    with pytest.raises(tr.TerritoireError, match="désaccord"):
        tr.read_working_time(tmp_path / "e.xlsx")


def test_working_time_refuses_missing_value(tmp_path):
    work_book(tmp_path / "e.xlsx", nuit="nd")
    with pytest.raises(tr.TerritoireError, match="illisible"):
        tr.read_working_time(tmp_path / "e.xlsx")


# --------------------------------------------------------------------------- polarités
def rows(*pairs):
    return [{"nom_polarite": n, "liste_com": c, "importance": "2"} for n, c in pairs]


def test_polarities_use_explicit_fixes_and_arrondissements_inherit():
    res = tr.resolve_polarities(
        rows(("Saint-Quentin-Nord", "Les Clay-sous-Bois"), ("Saint-Ouen", "Saint-Ouen"), ("Paris", "Paris"),
             ("Maisons", "Maisons-Laffitte, Montesson")),
        communes_fixture(),
        fixes={"Les Clay-sous-Bois": ("78165", "Les Clayes-sous-Bois"), "Saint-Ouen": ("93070", "Saint-Ouen-sur-Seine")})
    assert res.by_commune["78165"] == "Saint-Quentin-Nord" and res.by_commune["93070"] == "Saint-Ouen"
    assert res.by_commune["75056"] == res.by_commune["75101"] == res.by_commune["75102"] == "Paris"
    assert res.by_commune["78358"] == res.by_commune["78418"] == "Maisons"
    assert "77428" not in res.by_commune and "95572" not in res.by_commune  # les autres Saint-Ouen ne sont pas touchés
    assert (res.mentions, res.fixed) == (5, 2)


def test_polarities_fail_on_unknown_name():
    with pytest.raises(tr.TerritoireError, match="aucune commune de ce nom"):
        tr.resolve_polarities(rows(("X", "Les Clay-sous-Bois")), communes_fixture(), fixes={})


def test_polarities_fail_on_ambiguous_name():
    with pytest.raises(tr.TerritoireError, match="plusieurs communes"):
        tr.resolve_polarities(rows(("X", "Blandy")), communes_fixture(), fixes={})


def test_polarities_fail_on_commune_cited_twice():
    with pytest.raises(tr.TerritoireError, match="deux polarités"):
        tr.resolve_polarities(rows(("A", "Montesson"), ("B", "Montesson")), communes_fixture(), fixes={})


def test_polarities_fail_on_unused_fix_and_wrong_code():
    with pytest.raises(tr.TerritoireError, match="inutilisée"):
        tr.resolve_polarities(rows(("A", "Montesson")), communes_fixture(),
                              fixes={"Saint-Ouen": ("93070", "Saint-Ouen-sur-Seine")})
    with pytest.raises(tr.TerritoireError, match="n'est pas"):
        tr.resolve_polarities(rows(("A", "Saint-Ouen")), communes_fixture(),
                              fixes={"Saint-Ouen": ("77428", "Saint-Ouen-sur-Seine")})


def test_name_fixes_are_the_seven_of_the_plan():
    assert len(tr.NAME_FIXES) == 7
    assert {v[0] for v in tr.NAME_FIXES.values()} == {"78165", "78420", "78238", "77285", "93070", "77291", "91538"}


def test_norm_ignores_accents_case_and_punctuation():
    assert tr.norm("Saint-Ouen-l'Aumône") == tr.norm("SAINT OUEN L AUMONE") == "saint ouen l aumone"


# --------------------------------------------------------------------------- contrôle du document
def good_doc():
    return {
        "contract": "territoire-1",
        "chomage": {"quarter": "2026-T2", "provisional": True, "published": "2026-09-18", "quarters": ["2026-T1", "2026-T2"],
                    "zones": {"1114": {"name": "Seine-Yvelinoise", "series": [8.8, 8.9]}},
                    "departments": {"78": {"name": "Yvelines", "rate": 7.7}}, "region": {"name": "Île-de-France", "rate": 8.2}},
        "temps_de_travail": {"year": 2024, "evening_pct": 27, "night_pct": 11, "scope": "France hors Mayotte"},
        "communes": {"78358": {"zone": "1114", "polarity": None}, "78418": {"zone": "1114", "polarity": "Maisons"}},
        "null_reasons": {"communes.polarity": "commune citée par aucune polarité"},
    }


def test_check_territoire_accepts_good_document():
    assert tr.check_territoire(good_doc(), ["78358", "78418"], ["78"]) == []


def test_check_territoire_refuses_null_without_reason():
    d = good_doc()
    d["null_reasons"] = {}
    assert any("sans raison" in e for e in tr.check_territoire(d, ["78358", "78418"], ["78"]))
    d = good_doc()
    d["chomage"]["region"]["rate"] = None
    errs = tr.check_territoire(d, ["78358", "78418"], ["78"])
    assert any("région" in e for e in errs) and any("sans raison" in e for e in errs)


def test_check_territoire_refuses_zero_gap_missing_commune_and_long_dash():
    d = good_doc()
    d["chomage"]["zones"]["1114"]["series"] = [8.8]
    d["communes"]["78358"]["zone"] = "9999"
    d["chomage"]["zones"]["1114"]["name"] = "Seine" + EM + "Yvelinoise"
    errs = tr.check_territoire(d, ["78358", "78418", "95000"], ["78"])
    assert any("série" in e for e in errs) and any("inconnue" in e for e in errs)
    assert any("manquantes" in e for e in errs) and any("tiret" in e for e in errs)


# --------------------------------------------------------------------------- vrais fichiers (ignorés sans data/raw)
needs_raw = pytest.mark.skipif(not (RAW_DIR / "SOC02" / "PROVENANCE.txt").exists(), reason="data/raw non disponible")


@pytest.fixture(scope="module")
def real():
    raw = tr.locate_raw(RAW_DIR)
    communes = tr.read_communes(PROCESSED_DIR / "communes_idf_2026.csv")
    return raw, communes, tr.build_territoire(raw, communes, IDF_REGION, IDF_DEPS)


@needs_raw
def test_real_every_departure_commune_has_a_zone_with_a_rate(real):
    _, communes, doc = real
    origins = {c.code for c in communes.values() if c.is_origin}
    assert set(doc["communes"]) == origins
    zones = doc["chomage"]["zones"]
    assert all(v["zone"] in zones for v in doc["communes"].values())
    assert all(len(z["series"]) == len(doc["chomage"]["quarters"]) for z in zones.values())
    assert tr.check_territoire(doc, origins, IDF_DEPS) == []


@needs_raw
def test_real_paris_arrondissements_take_the_zone_and_polarity_of_paris(real):
    _, communes, doc = real
    arrondissements = [c.code for c in communes.values() if c.kind == "arrondissement"]
    assert arrondissements
    paris = {(doc["communes"][a]["zone"], doc["communes"][a]["polarity"]) for a in arrondissements}
    assert len(paris) == 1 and next(iter(paris))[1] == "Paris"


@needs_raw
def test_real_seven_fixed_names_resolve_to_their_commune(real):
    raw, communes, doc = real
    res = tr.resolve_polarities(tr.read_polarities(raw["GEO06"]["polarites"].path), communes)
    assert res.fixed == 7 == len(tr.NAME_FIXES)
    for written, (code, _) in tr.NAME_FIXES.items():
        assert code in res.by_commune, written
    # « Saint-Ouen » : seule Saint-Ouen-sur-Seine reçoit la polarité de ce nom, pas les autres Saint-Ouen d'Île-de-France
    assert res.by_commune["93070"] == "Saint-Ouen"
    others = [c.code for c in communes.values() if c.name.startswith("Saint-Ouen-en-") or c.name.startswith("Saint-Ouen-sur-Morin")]
    assert others and not any(c in res.by_commune for c in others)


@needs_raw
def test_real_rates_match_an_independent_reading(real):
    """Relecture indépendante (pandas) de la série de chaque zone et des taux départementaux et régional."""
    import pandas as pd
    raw, _, doc = real
    df = pd.read_excel(raw["SOC02"]["chomage_ze"].path, sheet_name="txcho_ze", header=None, dtype=object)
    head = df.index[df[0] == "ZE2020"][0]
    table = df.iloc[head + 1:].copy()
    table.columns = list(df.iloc[head])
    idf = table[table["REG"].astype(str) == IDF_REGION]
    assert len(idf) == len(doc["chomage"]["zones"])
    for _, r in idf.iterrows():
        series = [float(r[q]) for q in doc["chomage"]["quarters"]]
        assert doc["chomage"]["zones"][str(r["ZE2020"]).strip()]["series"] == series
    with zipfile.ZipFile(raw["SOC02"]["chomage_dep_reg"].path) as z:
        inner = zipfile.ZipFile(io.BytesIO(z.read("TCRD_025.xlsx")))
    strings = re.findall(r"<si>(.*?)</si>", inner.read("xl/sharedStrings.xml").decode("utf-8"), re.S)
    strings = ["".join(re.findall(r"<t[^>]*>(.*?)</t>", s, re.S)) for s in strings]

    def sheet_rates(n, wanted):
        xml = inner.read(f"xl/worksheets/sheet{n}.xml").decode("utf-8")
        out = {}
        for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
            cells = dict(re.findall(r'<c r="([A-Z]+)\d+"[^>]*?(?:/>|>.*?<v>(.*?)</v>)', row, re.S))
            a = re.search(r'<c r="A\d+" [^>]*t="s"[^>]*><v>(\d+)</v>', row)
            c = re.search(r'<c r="C\d+"[^>]*><v>([\d.]+)</v>', row)
            if a and c and strings[int(a.group(1))] in wanted:
                out[strings[int(a.group(1))]] = float(c.group(1))
        return out

    deps = sheet_rates(1, set(IDF_DEPS))
    assert {d: v["rate"] for d, v in doc["chomage"]["departments"].items()} == deps
    assert doc["chomage"]["region"]["rate"] == sheet_rates(2, {IDF_REGION})[IDF_REGION]


@needs_raw
def test_real_working_time_matches_figure_one(real):
    raw, _, doc = real
    wb = openpyxl.load_workbook(raw["EMP05"]["temps_travail"].path, read_only=True, data_only=True)
    rows_ = list(wb["Figure 1"].iter_rows(values_only=True))
    soir = next(r for r in rows_ if r[0] and str(r[0]).startswith("Soir"))
    nuit = next(r for r in rows_ if r[0] and str(r[0]).startswith("Nuit"))
    wt = doc["temps_de_travail"]
    assert (wt["evening_pct"], wt["night_pct"]) == (soir[2], nuit[2]) and wt["year"] == 2024


@needs_raw
def test_real_published_file_is_the_current_build(real):
    published = FRONT_DATA_DIR / tr.OUT_FILE
    if not published.exists():
        pytest.skip("territoire.json non encore écrit")
    assert json.loads(published.read_text(encoding="utf-8")) == json.loads(json.dumps(real[2], ensure_ascii=False))


@needs_raw
def test_real_published_sources_are_seen_by_the_registry_scan(tmp_path, real):
    (tmp_path / tr.OUT_FILE).write_text(json.dumps(real[2], ensure_ascii=False), encoding="utf-8")
    assert set(rg.scan_published(tmp_path)) == set(tr.SOURCE_IDS)


def test_sources_codes_are_registered():
    assert set(tr.SOURCE_IDS) <= set(rg.SOURCE_INFO)


@needs_raw
def test_real_every_number_and_name_comes_from_the_raw_files(real):
    import copy
    raw, _, doc = real
    numbers, words = tr.raw_vocabulary(raw)
    assert tr.foreign_values(doc, numbers, words) == []
    forged = copy.deepcopy(doc)
    first_zone = next(iter(forged["chomage"]["zones"]))
    forged["chomage"]["zones"][first_zone]["series"][-1] = 0.123  # un taux qui ne vient d'aucun fichier
    forged["chomage"]["departments"]["78"]["name"] = "Yvelines-sur-Mer"
    forged["temps_de_travail"]["evening_pct"] = 99.4321  # une valeur qui n'est dans aucun fichier
    bad = tr.foreign_values(forged, numbers, words)
    assert len(bad) == 3 and any("0.123" in b for b in bad) and any("Yvelines-sur-Mer" in b for b in bad)
