"""Repères de territoire (lot T1 du plan docs/plan-contexte-territoire.md) : chômage de la zone d'emploi, du département et
de la région, part des salariés qui travaillent le soir et la nuit, polarité SDRIF-E de la commune. Logique pure, testée
dans tests/test_territoire.py ; appliquée par scripts/06v_export_territoire.py, qui écrit
frontend/public/data/territoire.json (contrat `territoire-1`, docs de contrat dans le plan).

Aucun chiffre et aucun nom n'est écrit dans le code : tout est lu dans les fichiers bruts de data/raw (SOC02, GEO05,
GEO06, EMP05), dont l'empreinte est contrôlée contre leur PROVENANCE.txt. Les seules saisies humaines sont :
- `NAME_FIXES` : les 7 noms de communes mal écrits dans le fichier des polarités, avec le code INSEE de la bonne commune
  (relevé du 06/11/2026) ; chaque correction est contrôlée contre le nom de la commune dans communes_idf_2026.csv et une
  correction inutilisée fait échouer l'export ;
- les noms des fichiers et des feuilles de l'enquête Emploi (titres de colonnes lus, pas des valeurs).

Règles de vérité :
- le taux de chômage est mesuré au lieu de résidence, par zone d'emploi, département et région : descriptif, aucun lien de
  cause avec l'accessibilité, aucun taux sur un astre (les astres sont des bassins d'emploi, une autre maille) ;
- le dernier trimestre est provisoire quand l'en-tête de la source porte « (p) » ;
- les parts du soir et de la nuit sont nationales (enquête Emploi, France hors Mayotte, ensemble des salariés), jamais
  territorialisées ;
- une commune sans polarité vaut `null`, avec la raison écrite dans `null_reasons` ; une valeur absente ou non lisible fait
  échouer l'export (jamais 0, jamais une estimation).
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from html import unescape
from pathlib import Path
from typing import Any

import openpyxl

TERRITOIRE_CONTRACT = "territoire-1"
OUT_FILE = "territoire.json"
SOURCE_IDS = ("SOC02", "GEO05", "GEO06", "EMP05")

# Mentions de lieu qui ne sont pas des communes : la polarité « Paris » vaut pour les arrondissements
KIND_COMMUNE = "commune"
KIND_ARRONDISSEMENT = "arrondissement"

# Noms de communes mal écrits dans polarites.csv (relevé du 06/11/2026) : nom du fichier -> (code INSEE, commune visée).
# Les noms proches suffisent à les identifier, sauf « Saint-Ouen » : le point publié par la source écarte les trois
# autres Saint-Ouen d'Île-de-France, donc Saint-Ouen-sur-Seine.
NAME_FIXES: dict[str, tuple[str, str]] = {
    "Les Clay-sous-Bois": ("78165", "Les Clayes-sous-Bois"),
    "Monfort-l'Amaury": ("78420", "Montfort-l'Amaury"),
    "Flin-sur-Seine": ("78238", "Flins-sur-Seine"),
    "Mée-sur-Seine": ("77285", "Le Mée-sur-Seine"),
    "Saint-Ouen": ("93070", "Saint-Ouen-sur-Seine"),
    "Le Menil-Amelot": ("77291", "Le Mesnil-Amelot"),
    "Saint-Aubain": ("91538", "Saint-Aubin"),
}

POLARITY_NULL_KEY = "communes.polarity"


class TerritoireError(ValueError):
    """Une donnée manque, est ambiguë ou contredit une autre : l'export s'arrête, rien n'est écrit."""


def norm(text: str) -> str:
    """Nom comparé sans accent, sans casse, ponctuation réduite à une espace (« Saint-Ouen-l'Aumône » -> « saint ouen l aumone »)."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", ascii_text).strip()


def clean(text: object) -> str:
    """Texte d'une cellule : espaces insécables et multiples normalisés."""
    return " ".join(str(text).replace("\xa0", " ").split())


# --------------------------------------------------------------------------- fichiers bruts et provenance
@dataclass(frozen=True)
class RawFile:
    source_id: str
    path: Path
    sha256: str
    label: str
    downloaded: str  # AAAA-MM-JJ
    published: str | None  # AAAA-MM-JJ, « paru le JJ/MM/AAAA » dans la provenance (Insee) ; None sinon


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _fr_date(day: str, month: str, year: str) -> str:
    return date(int(year), int(month), int(day)).isoformat()


def parse_provenance(text: str) -> dict[str, dict[str, str | None]]:
    """PROVENANCE.txt : un bloc par fichier (nom, « source : », « url : », « téléchargé le AAAA-MM-JJ », « sha256 : »)."""
    out: dict[str, dict[str, str | None]] = {}
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").strip()):
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        fields: dict[str, str] = {}
        for ln in lines[1:]:
            m = re.match(r"(source|url|sha256)\s*:\s*(.+)$", ln)
            if m:
                fields[m.group(1)] = m.group(2).strip()
            m = re.match(r"téléchargé le (\d{4}-\d{2}-\d{2})", ln)
            if m:
                fields["downloaded"] = m.group(1)
        missing = [k for k in ("source", "sha256", "downloaded") if k not in fields]
        if missing:
            raise TerritoireError(f"PROVENANCE.txt : le bloc de {lines[0]} n'a pas {missing}")
        paru = re.search(r"paru le (\d{2})/(\d{2})/(\d{4})", fields["source"])
        out[lines[0]] = {"label": fields["source"], "sha256": fields["sha256"], "downloaded": fields["downloaded"],
                         "published": _fr_date(*paru.groups()) if paru else None}
    return out


def locate_raw(raw_dir: Path) -> dict[str, dict[str, RawFile]]:
    """Fichiers bruts des quatre sources : code -> {rôle -> fichier}. L'empreinte de chaque fichier doit être celle de sa
    PROVENANCE.txt (fichier non modifié). Rôles : chomage_ze, chomage_dep_reg, zones, polarites, temps_travail."""
    wanted = {
        "SOC02": {"chomage_ze": "*.xlsx", "chomage_dep_reg": "*.zip"},
        "GEO05": {"zones": "*.json"},
        "GEO06": {"polarites": "*.csv"},
        "EMP05": {"temps_travail": "*.xlsx"},
    }
    out: dict[str, dict[str, RawFile]] = {}
    for code, roles in wanted.items():
        folder = raw_dir / code
        prov_path = folder / "PROVENANCE.txt"
        if not prov_path.exists():
            raise TerritoireError(f"{prov_path} absent : les fichiers bruts de {code} ne sont pas là")
        prov = parse_provenance(prov_path.read_text(encoding="utf-8"))
        out[code] = {}
        for role, pattern in roles.items():
            found = sorted(folder.glob(pattern))
            if len(found) != 1:
                raise TerritoireError(f"{folder} : un seul fichier {pattern} attendu, trouvé {len(found)}")
            path = found[0]
            info = prov.get(path.name)
            if info is None:
                raise TerritoireError(f"{path.name} n'est pas décrit dans {prov_path}")
            actual = sha256_file(path)
            if actual != info["sha256"]:
                raise TerritoireError(f"{path.name} : empreinte {actual} différente de la provenance ({info['sha256']})")
            out[code][role] = RawFile(code, path, actual, str(info["label"]), str(info["downloaded"]),
                                      info["published"])
    return out


# --------------------------------------------------------------------------- chômage par zone d'emploi
@dataclass(frozen=True)
class ZoneRates:
    quarters: list[str]  # « 2003-T1 » ... « 2026-T2 »
    series: dict[str, list[float]]  # code de zone -> un taux par trimestre
    names: dict[str, str]  # code de zone -> libellé du fichier des taux


_QUARTER = re.compile(r"^\d{4}-T[1-4]$")


def read_zone_rates(xlsx: Path, region_code: str, sheet: str = "txcho_ze") -> ZoneRates:
    """Taux de chômage localisés des zones d'emploi de la région `region_code`. Le filtre est le CODE de région (colonne
    REG) : un filtre par texte attraperait aussi les zones d'autres régions dont le nom commence par les mêmes chiffres."""
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    try:
        rows = list(wb[sheet].iter_rows(values_only=True))
    finally:
        wb.close()
    head = next((i for i, r in enumerate(rows) if r and r[0] == "ZE2020"), None)
    if head is None:
        raise TerritoireError(f"{xlsx.name} : ligne d'en-tête « ZE2020 » introuvable")
    header = [clean(c) if c is not None else "" for c in rows[head]]
    try:
        c_code, c_name, c_reg = header.index("ZE2020"), header.index("LIBZE2020"), header.index("REG")
    except ValueError as e:
        raise TerritoireError(f"{xlsx.name} : colonnes ZE2020, LIBZE2020 et REG attendues ({e})") from e
    qcols = [i for i, h in enumerate(header) if _QUARTER.match(h)]
    if not qcols or qcols != list(range(qcols[0], qcols[0] + len(qcols))):
        raise TerritoireError(f"{xlsx.name} : trimestres de l'en-tête absents ou non contigus")
    quarters = [header[i] for i in qcols]
    series: dict[str, list[float]] = {}
    names: dict[str, str] = {}
    for r in rows[head + 1:]:
        if not r or r[c_code] is None or str(r[c_reg]).strip() != region_code:
            continue
        code = str(r[c_code]).strip()
        if code in series:
            raise TerritoireError(f"{xlsx.name} : zone {code} en double")
        values = [r[i] for i in qcols]
        bad = [quarters[k] for k, v in enumerate(values) if isinstance(v, bool) or not isinstance(v, (int, float))]
        if bad:
            raise TerritoireError(f"{xlsx.name} : zone {code}, taux absent ou illisible pour {bad[:3]}")
        series[code] = [float(v) for v in values]
        names[code] = clean(r[c_name])
    return ZoneRates(quarters, series, names)


# --------------------------------------------------------------------------- chômage par département et région (TCRD)
@dataclass(frozen=True)
class LocalisedRates:
    quarter: str  # « 2026-T2 »
    provisional: bool  # l'en-tête de la source porte « (p) »
    departments: dict[str, tuple[str, float]]  # code -> (nom, taux)
    region: tuple[str, str, float]  # (code, nom, taux)


_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
       "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
       "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
_CELL_REF = re.compile(r"^([A-Z]+)(\d+)$")
_HEADER_QUARTER = re.compile(r"(\d)\D*?\btrim\b\.?\s*(\d{4})")


def _xlsx_sheets(book: zipfile.ZipFile) -> dict[str, list[dict[str, str]]]:
    """Feuilles d'un classeur lues dans le XML : nom -> lignes (colonne -> valeur texte). Pas d'openpyxl : il échoue sur
    TCRD_025.xlsx (dessin manquant dans le classeur). Les cellules sont repérées par leur référence (A5, C5), les cellules
    vides ne décalent donc rien."""
    shared: list[str] = []
    if "xl/sharedStrings.xml" in book.namelist():
        root = ET.fromstring(book.read("xl/sharedStrings.xml"))
        shared = ["".join(t.text or "" for t in si.iter(f"{{{_NS['m']}}}t")) for si in root.findall("m:si", _NS)]
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(book.read("xl/_rels/workbook.xml.rels")).findall("rel:Relationship", _NS)}
    out: dict[str, list[dict[str, str]]] = {}
    for sheet in ET.fromstring(book.read("xl/workbook.xml")).findall("m:sheets/m:sheet", _NS):
        target = rels[sheet.get(f"{{{_NS['r']}}}id")]
        rows: list[dict[str, str]] = []
        for row in ET.fromstring(book.read("xl/" + target.lstrip("/").removeprefix("xl/"))).iter(f"{{{_NS['m']}}}row"):
            cells: dict[str, str] = {}
            for c in row.findall("m:c", _NS):
                m = _CELL_REF.match(c.get("r", ""))
                if m is None:
                    continue
                if c.get("t") == "inlineStr":
                    inline = c.find("m:is", _NS)
                    if inline is not None:
                        cells[m.group(1)] = "".join(t.text or "" for t in inline.iter(f"{{{_NS['m']}}}t"))
                    continue
                v = c.find("m:v", _NS)
                if v is None or v.text is None:
                    continue
                cells[m.group(1)] = shared[int(v.text)] if c.get("t") == "s" else v.text
            rows.append(cells)
        out[str(sheet.get("name"))] = rows
    return out


def read_localised_rates(zip_path: Path, departments: Iterable[str], region_code: str) -> LocalisedRates:
    """Taux de chômage localisés du dernier trimestre (colonne C) pour les départements demandés (feuille DEP) et la région
    (feuille REG). Attention : dans la feuille DEP le code « 11 » est l'Aude et, dans la feuille REG, « 75 » est la
    Nouvelle-Aquitaine : chaque code est lu dans SA feuille."""
    with zipfile.ZipFile(zip_path) as z:
        members = [n for n in z.namelist() if n.lower().endswith(".xlsx")]
        if len(members) != 1:
            raise TerritoireError(f"{zip_path.name} : un seul classeur attendu, trouvé {members}")
        with zipfile.ZipFile(io.BytesIO(z.read(members[0]))) as book:
            sheets = _xlsx_sheets(book)
    for name in ("DEP", "REG"):
        if name not in sheets:
            raise TerritoireError(f"{zip_path.name} : feuille {name} absente ({sorted(sheets)})")
    quarters: dict[str, tuple[str, bool]] = {}
    for name in ("DEP", "REG"):
        head = next((r for r in sheets[name] if "C" in r and _HEADER_QUARTER.search(r["C"])), None)
        if head is None:
            raise TerritoireError(f"{zip_path.name} : en-tête du trimestre introuvable dans {name}")
        m = _HEADER_QUARTER.search(head["C"])
        assert m is not None
        quarters[name] = (f"{m.group(2)}-T{m.group(1)}", "(p)" in head["C"])
    if quarters["DEP"] != quarters["REG"]:
        raise TerritoireError(f"{zip_path.name} : trimestres différents entre DEP {quarters['DEP']} et REG {quarters['REG']}")

    def rate(row: Mapping[str, str], where: str) -> float:
        try:
            return float(row["C"])
        except (KeyError, ValueError) as e:
            raise TerritoireError(f"{zip_path.name} : taux absent ou illisible pour {where}") from e

    by_dep = {r["A"].strip(): r for r in sheets["DEP"] if "A" in r and "B" in r}
    deps: dict[str, tuple[str, float]] = {}
    for d in departments:
        if d not in by_dep:
            raise TerritoireError(f"{zip_path.name} : département {d} absent de la feuille DEP")
        deps[d] = (clean(by_dep[d]["B"]), rate(by_dep[d], f"le département {d}"))
    by_reg = {r["A"].strip(): r for r in sheets["REG"] if "A" in r and "B" in r}
    if region_code not in by_reg:
        raise TerritoireError(f"{zip_path.name} : région {region_code} absente de la feuille REG")
    reg = by_reg[region_code]
    return LocalisedRates(quarters["DEP"][0], quarters["DEP"][1], deps,
                          (region_code, clean(reg["B"]), rate(reg, f"la région {region_code}")))


# --------------------------------------------------------------------------- temps de travail (enquête Emploi)
@dataclass(frozen=True)
class WorkingTime:
    year: int
    evening_pct: int | float
    night_pct: int | float
    scope: str


def _number(value: object, where: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TerritoireError(f"temps de travail : valeur absente ou illisible pour {where} ({value!r})")
    return value


def read_working_time(xlsx: Path) -> WorkingTime:
    """Parts des salariés ayant travaillé au moins une fois le soir (20h-00h) et la nuit (00h-5h) sur quatre semaines :
    figure 1 (année la plus récente de l'en-tête), recoupée avec la ligne « Ensemble des salariés » de la figure 2.
    Le champ (« France hors Mayotte, ensemble des salariés ») est lu dans la note « Champ » de la figure."""
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    try:
        fig1 = list(wb["Figure 1"].iter_rows(values_only=True))
        fig2 = list(wb["Figure 2"].iter_rows(values_only=True))
    finally:
        wb.close()
    head = next((r for r in fig1 if r and isinstance(r[0], str) and clean(r[0]).startswith("Horaires de travail atypiques")), None)
    if head is None:
        raise TerritoireError(f"{xlsx.name} : en-tête de la figure 1 introuvable")
    years = {i: v for i, v in enumerate(head) if i > 0 and isinstance(v, int) and not isinstance(v, bool)}
    if not years:
        raise TerritoireError(f"{xlsx.name} : aucune année dans l'en-tête de la figure 1")
    col = max(years, key=lambda i: years[i])
    year = years[col]

    def line(rows: Sequence[Sequence[Any]], prefix: str, c: int) -> int | float:
        hit = [r for r in rows if r and isinstance(r[0], str) and clean(r[0]).startswith(prefix)]
        if len(hit) != 1:
            raise TerritoireError(f"{xlsx.name} : une seule ligne « {prefix} » attendue, trouvé {len(hit)}")
        return _number(hit[0][c], f"« {prefix} » {year}")

    evening, night = line(fig1, "Soir", col), line(fig1, "Nuit", col)
    # recoupement : la figure 2 (année 2024 pour tous les salariés) redonne le soir en colonne B et la nuit en colonne C
    total = [r for r in fig2 if r and isinstance(r[0], str) and clean(r[0]) == "Ensemble des salariés"]
    if len(total) != 1:
        raise TerritoireError(f"{xlsx.name} : ligne « Ensemble des salariés » de la figure 2 introuvable")
    if (total[0][1], total[0][2]) != (evening, night):
        raise TerritoireError(f"{xlsx.name} : figures 1 et 2 en désaccord (soir, nuit) : {(evening, night)} contre "
                              f"{(total[0][1], total[0][2])}")
    notes = [clean(r[0]) for r in fig1 if r and isinstance(r[0], str) and clean(r[0]).startswith("Champ")]
    if len(notes) != 1:
        raise TerritoireError(f"{xlsx.name} : note « Champ » de la figure 1 introuvable")
    scope = re.sub(r"^Champ\s*:\s*", "", notes[0]).split(", âgés")[0].strip().rstrip(".")
    return WorkingTime(year, evening, night, scope)


# --------------------------------------------------------------------------- géographie : communes, zones, polarités
@dataclass(frozen=True)
class Commune:
    code: str
    name: str
    dep: str
    kind: str
    is_origin: bool


def read_communes(path: Path) -> dict[str, Commune]:
    """data/processed/communes_idf_2026.csv (GEO02B) : toutes les communes d'Île-de-France, dont Paris et ses arrondissements ;
    `is_origin` vaut vrai pour les 1 285 communes et arrondissements de départ."""
    with path.open(encoding="utf-8", newline="") as f:
        return {r["insee"]: Commune(r["insee"], r["name"], r["dep"], r["kind"], r["is_origin"] == "True")
                for r in csv.DictReader(f)}


def arrondissement_parents(communes: Mapping[str, Commune]) -> dict[str, str]:
    """Arrondissement -> commune qui le contient (Paris). Une zone d'emploi et une polarité sont définies pour la commune."""
    out: dict[str, str] = {}
    for c in communes.values():
        if c.kind != KIND_ARRONDISSEMENT:
            continue
        parents = [p.code for p in communes.values() if p.kind == KIND_COMMUNE and p.dep == c.dep]
        if len(parents) != 1:
            raise TerritoireError(f"arrondissement {c.code} : commune mère ambiguë dans le département {c.dep} ({parents})")
        out[c.code] = parents[0]
    return out


def read_zone_composition(path: Path, region_code: str) -> dict[str, tuple[str, str]]:
    """GEO05 : code de commune -> (code de zone d'emploi, libellé), toutes en région `region_code`."""
    rows = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, tuple[str, str]] = {}
    for r in rows:
        if str(r["reg"]) != region_code:
            raise TerritoireError(f"{path.name} : commune {r.get('codgeo')} hors de la région {region_code}")
        code = str(r["codgeo"]).strip()
        if code in out:
            raise TerritoireError(f"{path.name} : commune {code} en double")
        out[code] = (str(r["ze2020"]).strip(), clean(r["libze2020"]))
    return out


def read_polarities(path: Path) -> list[dict[str, str]]:
    """GEO06 : une ligne par polarité (nom_polarite, importance, liste_com). Le séparateur est « ; ». `importance` n'est pas
    publiée : la source ne définit pas ses niveaux."""
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    for col in ("nom_polarite", "liste_com"):
        if not rows or col not in rows[0]:
            raise TerritoireError(f"{path.name} : colonne {col} absente")
    return rows


@dataclass(frozen=True)
class PolarityResult:
    by_commune: dict[str, str]  # code -> nom de la polarité (arrondissements compris)
    mentions: int  # nombre de mentions de communes dans le fichier
    fixed: int  # mentions résolues par NAME_FIXES


def resolve_polarities(rows: Sequence[Mapping[str, str]], communes: Mapping[str, Commune],
                       fixes: Mapping[str, tuple[str, str]] = NAME_FIXES) -> PolarityResult:
    """Chaque mention de commune (par NOM : le fichier n'a pas de code) reçoit un code INSEE, ou l'export échoue : nom non
    reconnu, nom qui désigne plusieurs communes, commune citée par deux polarités, correction inutilisée ou contredite
    par le fichier des communes. Les arrondissements héritent de la polarité de leur commune (« Paris »)."""
    by_name: dict[str, list[str]] = {}
    for c in communes.values():
        if c.kind == KIND_COMMUNE:
            by_name.setdefault(norm(c.name), []).append(c.code)
    errors: list[str] = []
    for written, (code, expected) in fixes.items():
        if code not in communes or norm(communes[code].name) != norm(expected):
            errors.append(f"correction « {written} » : le code {code} n'est pas {expected} dans le fichier des communes")
    assigned: dict[str, str] = {}
    used: set[str] = set()
    mentions = 0
    for row in rows:
        polarity = row["nom_polarite"].strip()
        for written in re.split(r"\s*,\s*", row["liste_com"].strip()):
            if not written:
                continue
            mentions += 1
            if written in fixes:
                used.add(written)
                codes = [fixes[written][0]]
            else:
                codes = by_name.get(norm(written), [])
            if not codes:
                errors.append(f"« {written} » (polarité {polarity}) : aucune commune de ce nom")
            elif len(codes) > 1:
                errors.append(f"« {written} » (polarité {polarity}) : plusieurs communes {codes}, à trancher dans NAME_FIXES")
            elif assigned.get(codes[0], polarity) != polarity:
                errors.append(f"{codes[0]} citée par deux polarités : {assigned[codes[0]]} et {polarity}")
            else:
                assigned[codes[0]] = polarity
    errors += [f"correction « {w} » inutilisée : le fichier ne cite plus ce nom" for w in fixes if w not in used]
    if errors:
        raise TerritoireError("polarités : " + " ; ".join(errors))
    for arr, parent in arrondissement_parents(communes).items():
        if parent in assigned:
            assigned[arr] = assigned[parent]
    return PolarityResult(assigned, mentions, len(used))


# --------------------------------------------------------------------------- assemblage
def _check_same(values: Mapping[str, str | None], what: str) -> str | None:
    distinct = {v for v in values.values() if v is not None}
    if len(distinct) > 1:
        raise TerritoireError(f"{what} : dates différentes selon les fichiers {dict(values)}")
    return next(iter(distinct), None)


def build_territoire(raw: Mapping[str, Mapping[str, RawFile]], communes: Mapping[str, Commune], region_code: str,
                     departments: Sequence[str]) -> dict[str, Any]:
    """Document `territoire-1` : lecture des quatre sources, jointures, contrôles. Lève TerritoireError au premier défaut :
    commune de départ sans zone, zone sans taux, nom de polarité sans code, taux ou département absent."""
    zr = read_zone_rates(raw["SOC02"]["chomage_ze"].path, region_code)
    lr = read_localised_rates(raw["SOC02"]["chomage_dep_reg"].path, departments, region_code)
    wt = read_working_time(raw["EMP05"]["temps_travail"].path)
    composition = read_zone_composition(raw["GEO05"]["zones"].path, region_code)
    polarities = read_polarities(raw["GEO06"]["polarites"].path)
    pol = resolve_polarities(polarities, communes)

    if lr.quarter != zr.quarters[-1]:
        raise TerritoireError(f"dernier trimestre : {zr.quarters[-1]} pour les zones, {lr.quarter} pour les départements et la région")
    published = _check_same({"SOC02 zones": raw["SOC02"]["chomage_ze"].published,
                             "SOC02 départements": raw["SOC02"]["chomage_dep_reg"].published}, "date de parution du chômage")
    if published is None:
        raise TerritoireError("date de parution du chômage absente de la provenance de SOC02")
    wt_published = raw["EMP05"]["temps_travail"].published
    if wt_published is None:
        raise TerritoireError("date de parution de l'enquête Emploi absente de la provenance de EMP05")

    # zones : les libellés viennent de GEO05 (composition au 01/01/2026) ; chaque zone du fichier GEO05 doit avoir ses taux
    zone_names: dict[str, str] = {}
    for _, (zone, label) in composition.items():
        if zone_names.setdefault(zone, label) != label:
            raise TerritoireError(f"zone {zone} : deux libellés dans GEO05 ({zone_names[zone]}, {label})")
    no_rate = sorted(z for z in zone_names if z not in zr.series)
    if no_rate:
        raise TerritoireError(f"zones d'emploi sans taux : {no_rate}")
    unknown = sorted(z for z in zr.series if z not in zone_names)
    if unknown:
        raise TerritoireError(f"zones du fichier des taux absentes de la composition communale : {unknown}")

    parents = arrondissement_parents(communes)
    origins = sorted(c.code for c in communes.values() if c.is_origin)
    out_communes: dict[str, dict[str, Any]] = {}
    for code in origins:
        key = parents.get(code, code)
        if key not in composition:
            raise TerritoireError(f"commune de départ {code} ({communes[code].name}) sans zone d'emploi dans GEO05")
        out_communes[code] = {"zone": composition[key][0], "polarity": pol.by_commune.get(code)}

    with_polarity = sum(1 for v in out_communes.values() if v["polarity"] is not None)
    sources = [{"source_id": rf.source_id, "file": rf.path.name, "sha256": rf.sha256, "label": rf.label,
                "downloaded": rf.downloaded}
               for files in raw.values() for rf in files.values()]
    return {
        "contract": TERRITOIRE_CONTRACT,
        "chomage": {
            "quarter": lr.quarter, "provisional": lr.provisional, "published": published,
            "quarters": zr.quarters,
            "zones": {z: {"name": zone_names[z], "series": zr.series[z]} for z in sorted(zr.series)},
            "departments": {d: {"name": lr.departments[d][0], "rate": lr.departments[d][1]} for d in departments},
            "region": {"name": lr.region[1], "rate": lr.region[2]},
        },
        "temps_de_travail": {"year": wt.year, "evening_pct": wt.evening_pct, "night_pct": wt.night_pct, "scope": wt.scope,
                             "published": wt_published},
        "communes": out_communes,
        "null_reasons": {POLARITY_NULL_KEY: f"commune citée par aucune des {len(polarities)} polarités du SDRIF-E "
                                            f"({with_polarity} communes de départ sur {len(out_communes)} en ont une)"},
        "sources": sources,
    }


# --------------------------------------------------------------------------- contrôle du document (sans les fichiers bruts)
def check_territoire(doc: Mapping[str, Any], origins: Iterable[str], departments: Sequence[str]) -> list[str]:
    """Défauts de structure du document publié (liste vide si bon) : contrat, 15 zones comparables, une zone connue par
    commune de départ, un taux par département, chaque `null` expliqué dans `null_reasons`, aucun tiret long."""
    errs: list[str] = []
    if doc.get("contract") != TERRITOIRE_CONTRACT:
        errs.append(f"contrat {doc.get('contract')!r} au lieu de {TERRITOIRE_CONTRACT!r}")
    ch = doc.get("chomage") or {}
    quarters = ch.get("quarters") or []
    if not quarters or ch.get("quarter") != quarters[-1]:
        errs.append("chomage.quarter n'est pas le dernier de chomage.quarters")
    if not isinstance(ch.get("provisional"), bool):
        errs.append("chomage.provisional absent")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(ch.get("published"))):
        errs.append("chomage.published absent ou mal formé")
    zones = ch.get("zones") or {}
    for z, v in zones.items():
        s = v.get("series")
        if not v.get("name") or not isinstance(s, list) or len(s) != len(quarters):
            errs.append(f"zone {z} : nom ou série incohérents avec les trimestres")
        elif any(isinstance(x, bool) or not isinstance(x, (int, float)) for x in s):
            errs.append(f"zone {z} : valeur nulle ou non numérique dans la série")
    deps = ch.get("departments") or {}
    for d in departments:
        v = deps.get(d)
        if not v or not v.get("name") or isinstance(v.get("rate"), bool) or not isinstance(v.get("rate"), (int, float)):
            errs.append(f"département {d} : nom ou taux absent")
    if extra := sorted(set(deps) - set(departments)):
        errs.append(f"départements hors périmètre : {extra}")
    reg = ch.get("region") or {}
    if not reg.get("name") or isinstance(reg.get("rate"), bool) or not isinstance(reg.get("rate"), (int, float)):
        errs.append("région : nom ou taux absent")
    wt = doc.get("temps_de_travail") or {}
    for k in ("evening_pct", "night_pct", "year"):
        if isinstance(wt.get(k), bool) or not isinstance(wt.get(k), (int, float)):
            errs.append(f"temps_de_travail.{k} absent")
    if not wt.get("scope"):
        errs.append("temps_de_travail.scope absent")
    communes = doc.get("communes") or {}
    expected = set(origins)
    if set(communes) != expected:
        errs.append(f"communes : {len(set(communes) - expected)} en trop, {len(expected - set(communes))} manquantes")
    for code, v in communes.items():
        if v.get("zone") not in zones:
            errs.append(f"commune {code} : zone {v.get('zone')!r} inconnue")
        if "polarity" not in v:
            errs.append(f"commune {code} : champ polarity absent")
    # une valeur absente a sa raison écrite
    reasons = doc.get("null_reasons") or {}
    if any(v.get("polarity") is None for v in communes.values()) and not reasons.get(POLARITY_NULL_KEY):
        errs.append(f"polarity nulle sans raison ({POLARITY_NULL_KEY} dans null_reasons)")
    nulls = _null_paths(doc)
    unexplained = sorted(p for p in nulls if p != POLARITY_NULL_KEY)
    if unexplained:
        errs.append(f"valeurs nulles sans raison écrite : {unexplained[:5]}")
    text = json.dumps(doc, ensure_ascii=False)
    if chr(0x2014) in text or chr(0x2013) in text:
        errs.append("tiret cadratin ou demi-cadratin dans le document")
    return errs


def raw_vocabulary(raw: Mapping[str, Mapping[str, RawFile]]) -> tuple[set[float], set[str]]:
    """Tous les nombres et tous les textes des fichiers bruts, lus par un chemin SANS rapport avec les lecteurs ci-dessus
    (toutes les cellules des classeurs, XML brut du classeur TCRD, JSON et CSV tels quels). Sert au contrôle de 07 : un taux,
    un effectif ou un nom du document qui n'est pas dans cet ensemble ne vient pas des fichiers bruts."""
    numbers: set[float] = set()
    words: set[str] = set()
    for source, role in (("SOC02", "chomage_ze"), ("EMP05", "temps_travail")):
        wb = openpyxl.load_workbook(raw[source][role].path, read_only=True, data_only=True)
        try:
            for ws in wb.worksheets:
                for row in ws.iter_rows(values_only=True):
                    for v in row:
                        if isinstance(v, bool) or v is None:
                            continue
                        if isinstance(v, (int, float)):
                            numbers.add(float(v))
                        else:
                            words.add(clean(v))
        finally:
            wb.close()
    with zipfile.ZipFile(raw["SOC02"]["chomage_dep_reg"].path) as z:
        book = zipfile.ZipFile(io.BytesIO(z.read(next(n for n in z.namelist() if n.lower().endswith(".xlsx")))))
    for name in book.namelist():
        if name == "xl/sharedStrings.xml":
            words |= {clean(unescape(t)) for t in re.findall(r"<t[^>]*>(.*?)</t>", book.read(name).decode("utf-8"), re.S)}
        elif name.startswith("xl/worksheets/sheet") and name.endswith(".xml"):
            for attrs, value in re.findall(r"<c ([^>]*)>(?:<f>.*?</f>)?<v>([^<]*)</v>", book.read(name).decode("utf-8"), re.S):
                if 't="s"' not in attrs:
                    try:
                        numbers.add(float(value))
                    except ValueError:
                        pass
    for row in json.loads(raw["GEO05"]["zones"].path.read_text(encoding="utf-8")):
        words |= {clean(row["libze2020"]), str(row["ze2020"]).strip()}
    with raw["GEO06"]["polarites"].path.open(encoding="utf-8-sig", newline="") as f:
        words |= {clean(r["nom_polarite"]) for r in csv.DictReader(f, delimiter=";")}
    return numbers, words


def numeric_leaves(doc: Mapping[str, Any]) -> list[tuple[str, float]]:
    """Toutes les valeurs numériques du document (chemin, valeur), sauf les booléens."""
    out: list[tuple[str, float]] = []

    def walk(node: Any, path: str) -> None:
        if isinstance(node, bool):
            return
        if isinstance(node, (int, float)):
            out.append((path, float(node)))
        elif isinstance(node, Mapping):
            for k, v in node.items():
                walk(v, f"{path}.{k}" if path else str(k))
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")

    walk(doc, "")
    return out


def name_leaves(doc: Mapping[str, Any]) -> list[tuple[str, str]]:
    """Noms publiés (zones, départements, région, polarités) : ce qu'un lecteur voit comme un nom de lieu."""
    ch = doc.get("chomage") or {}
    out = [(f"zone {z}", v["name"]) for z, v in (ch.get("zones") or {}).items()]
    out += [(f"département {d}", v["name"]) for d, v in (ch.get("departments") or {}).items()]
    if (ch.get("region") or {}).get("name"):
        out.append(("région", ch["region"]["name"]))
    out += [(f"polarité de {c}", v["polarity"]) for c, v in (doc.get("communes") or {}).items() if v.get("polarity")]
    return out


def foreign_values(doc: Mapping[str, Any], numbers: set[float], words: set[str]) -> list[str]:
    """Nombres et noms du document absents des fichiers bruts (liste vide si tout en vient)."""
    out = [f"{p} = {v}" for p, v in numeric_leaves(doc) if v not in numbers]
    out += [f"{p} : {n!r}" for p, n in name_leaves(doc) if clean(n) not in words]
    out += [f"{c} : zone {v['zone']!r}" for c, v in (doc.get("communes") or {}).items() if v["zone"] not in words]
    return out


def _null_paths(doc: Mapping[str, Any]) -> set[str]:
    """Chemins génériques des valeurs `null` du document : `communes.polarity` pour toute commune (le code de la commune
    n'est pas dans le chemin), le chemin exact ailleurs (jamais attendu : ces valeurs ne sont pas annulables)."""
    found: set[str] = set()

    def walk(node: Any, path: str) -> None:
        if node is None:
            found.add(path)
        elif isinstance(node, Mapping):
            for k, v in node.items():
                walk(v, f"{path}.{k}" if path else str(k))
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")

    walk({k: v for k, v in doc.items() if k != "communes"}, "")
    for v in (doc.get("communes") or {}).values():
        for field, value in v.items():
            if value is None:
                found.add(f"communes.{field}")
    return found
