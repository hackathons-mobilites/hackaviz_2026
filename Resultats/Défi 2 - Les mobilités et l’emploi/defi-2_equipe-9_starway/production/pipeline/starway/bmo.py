"""Projets de recrutement de l'enquête BMO 2026 de France Travail (EMP03), par bassin d'emploi (GEO04).

Une ligne du fichier open data = métier BMO (FAP) x bassin d'emploi x département x CLPE (comité local pour l'emploi).
Six bassins d'Île-de-France ont deux CLPE et plusieurs départements : on somme donc toutes les lignes d'un
(bassin, métier). Trois mesures par ligne : `met` (projets de recrutement), `xmet` (jugés difficiles), `smet`
(saisonniers).

Règle de vérité (docs/etude-bmo.md § 1) : une case « * » est NON DIFFUSÉE par France Travail ; l'équipe en déduit
« vraisemblablement moins de 5 projets » parce qu'aucune valeur publiée n'est inférieure à 5 sur les 53 786 lignes du
fichier (`met`, `xmet`, `smet` vérifiés par `mask_evidence`). C'est une DÉDUCTION : le sens de « * » n'est pas défini par
la source. Elle n'est jamais comptée, jamais remplacée par une estimation : chaque somme porte `masked`, le nombre de
cases « * » qui n'y sont pas, et vaut « au moins n » (20 + 10 + « * » : « au moins 30 »). Une somme sans aucune case
publiée vaut `null` (jamais 0) et s'affiche « non diffusé ».

Limite connue, non résolue : ni la page méthode de France Travail ni le rapport (Éclairages et synthèses n° 87) ne disent
si l'intérim (ni les particuliers employeurs) est compté. L'équipe n'a pas la réponse : rien n'est affirmé.

Ce que mesure BMO : des INTENTIONS de recrutement des employeurs pour l'année, pas des offres publiées, pas des
embauches, pas des postes salariés recensés par l'INSEE (Flores). Champ : privé, collectivités, établissements publics
administratifs ; hors administrations de l'État. Le vocabulaire « tendance » est celui de l'équipe (Cyril, 04/11).

Module sans r5py ni Java : lecture du classeur, agrégation, export (`scripts/06j_export_bmo.py`), contrôles
(`scripts/07_quality_checks.py`).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

import pandas as pd

from starway.config import PROCESSING_VERSION, RAW_DIR

CONTRACT = "bmo-1"
CONTRACT_METIERS = "bmo-metiers-1"
DECISION = "D-035"
YEAR = 2026

BMO_XLSX = RAW_DIR / "EMP03" / "Base-open-data-BMO-2026.xlsx"
BMO_SHEET = "BMO_2026_open_data"
# Annexe : total officiel de la région (Éclairages et synthèses n° 87, tableau 5, page 18)
OFFICIAL_PDF = RAW_DIR / "EMP03" / "Eclairages-et-syntheses-87-BMO-2026.pdf"
OFFICIAL = {
    "table": "Tableau 5 (projets et difficultés par région)",
    "page": 18,
    "idf_projects": 388_806,
    "france_projects": 2_274_951,
    "idf_difficult_share_percent": 35.6,
    "pdf_sha256": "e7b7cc1a61b265d759be07c9405be15acd3ac2c05fb513c4eae9873c9b4526b8",
}

IDF_REGION = "11"
MASK = "*"
METRICS = ("met", "xmet", "smet")
EXPECTED_COLUMNS = (
    "annee", "Code métier BMO", "Nom métier BMO", "Famille_met", "Lbl_fam_met", "REG", "NOM_REG", "Dept", "NomDept",
    "BE26", "NOMBE26", "clpe", "met", "xmet", "smet",
)
FORBIDDEN_DASHES = (chr(0x2013), chr(0x2014))  # règle du dépôt : jamais de tiret demi-cadratin ni cadratin

# Libellé affiché pour une case « * » (consigne de Nicolas, 05/11) : lu par le front dans bmo.json (`masked.label`),
# jamais recopié à la main côté front.
MASK_LABEL = "non diffusé par France Travail (vraisemblablement moins de 5 projets)"
MASK_STATUS = "déduction de l'équipe : le sens de « * » n'est pas défini par la source"
MASK_THRESHOLD = 5

SOURCES = (
    "EMP03 - France Travail, Enquête Besoins en Main-d'Oeuvre (BMO) 2026, base open data (Licence Ouverte) ; "
    "total officiel de la région : Éclairages et synthèses n° 87 (avril 2026), tableau 5, page 18",
    "GEO04 - France Travail, bassins d'emploi 2026",
)


# --------------------------------------------------------------------------- lecture
def read_bmo(path: Path = BMO_XLSX) -> pd.DataFrame:
    """Lignes d'Île-de-France du classeur. Colonnes : metier, metier_name, family, family_label, bassin, bassin_name,
    dept, clpe, met, xmet, smet (entiers ; `<NA>` pour une case « * »). Erreur si l'en-tête ou une valeur diffère de ce
    qui a été inspecté le 04/11/2026 : aucune valeur n'est devinée."""
    raw = pd.read_excel(path, sheet_name=BMO_SHEET, dtype=str)
    if tuple(raw.columns) != EXPECTED_COLUMNS:
        raise ValueError(f"colonnes inattendues dans {path.name} : {list(raw.columns)}")
    idf = raw[raw["REG"].str.strip() == IDF_REGION].copy()
    if idf.empty:
        raise ValueError("aucune ligne d'Île-de-France (REG = 11)")
    if set(idf["annee"]) != {str(YEAR)}:
        raise ValueError(f"millésime inattendu : {sorted(set(idf['annee']))}")
    out = pd.DataFrame({
        "metier": idf["Code métier BMO"].str.strip(), "metier_name": idf["Nom métier BMO"].str.strip(),
        "family": idf["Famille_met"].str.strip(), "family_label": idf["Lbl_fam_met"].str.strip(),
        "bassin": idf["BE26"].str.strip(), "bassin_name": idf["NOMBE26"].str.strip(),
        "dept": idf["Dept"].str.strip(), "clpe": idf["clpe"].str.strip(),
    })
    for m in METRICS:
        col = idf[m].str.strip()
        bad = col[(col != MASK) & ~col.str.fullmatch(r"\d+")]
        if len(bad):
            raise ValueError(f"valeur de {m} ni entière ni « * » : {sorted(set(bad))[:5]}")
        out[m] = pd.to_numeric(col.where(col != MASK), errors="raise").astype("Int64")
    out = out.reset_index(drop=True)
    if out.duplicated(["metier", "bassin", "dept", "clpe"]).any():
        raise ValueError("deux lignes pour un même (métier, bassin, département, CLPE)")
    for col in ("metier_name", "family_label", "bassin_name"):
        for s in out[col].unique():
            if any(d in s for d in FORBIDDEN_DASHES):
                raise ValueError(f"tiret cadratin ou demi-cadratin dans un libellé : {s!r}")
    for key, name in (("metier", "metier_name"), ("family", "family_label"), ("bassin", "bassin_name")):
        if (out.groupby(key)[name].nunique() > 1).any():
            raise ValueError(f"un même code {key} porte deux libellés")
    if (out.groupby("metier")["family"].nunique() > 1).any():
        raise ValueError("un métier est rattaché à deux familles")
    return out


def mask_evidence(path: Path = BMO_XLSX) -> dict[str, Any]:
    """Preuve de la DÉDUCTION sur « * » : sur TOUTES les lignes du classeur (France entière, pas seulement l'Île-de-France),
    plus petite valeur publiée de `met`, `xmet`, `smet` et nombre de valeurs publiées sous le seuil. Si une valeur publiée
    est inférieure au seuil, la déduction « moins de 5 » tombe : l'export échoue plutôt que d'afficher une affirmation fausse."""
    raw = pd.read_excel(path, sheet_name=BMO_SHEET, dtype=str)
    if tuple(raw.columns) != EXPECTED_COLUMNS:
        raise ValueError(f"colonnes inattendues dans {path.name} : {list(raw.columns)}")
    mins: dict[str, int] = {}
    below = 0
    for m in METRICS:
        col = raw[m].str.strip()
        published = pd.to_numeric(col.where(col != MASK).dropna(), errors="raise")
        mins[m] = int(published.min())
        below += int((published < MASK_THRESHOLD).sum())
    return {"rows": int(len(raw)), "scope": "toutes les régions du classeur", "measures": list(METRICS),
            "min_published": mins, "published_below_threshold": below, "threshold": MASK_THRESHOLD}


def masked_block(evidence: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Bloc `masked` de bmo.json : libellé de « * », statut de déduction, note affichée, preuve chiffrée (si calculée)."""
    block: dict[str, Any] = {"symbol": MASK, "label": MASK_LABEL, "status": MASK_STATUS}
    if evidence is None:
        block["note"] = ("Déduction de l'équipe : aucune valeur publiée n'est inférieure à 5 dans le fichier, "
                         "mais France Travail ne définit pas le sens de « * ».")
        return block
    rows = f"{evidence['rows']:,}".replace(",", "\u00a0")
    block["note"] = (f"Déduction de l'équipe : aucune valeur publiée n'est inférieure à {evidence['threshold']} sur les "
                     f"{rows} lignes du fichier (projets, jugés difficiles et saisonniers vérifiés), mais France Travail "
                     "ne définit pas le sens de « * ».")
    block["evidence"] = dict(evidence)
    return block


# --------------------------------------------------------------------------- agrégation
def cell(values: pd.Series) -> dict[str, int | None]:
    """Somme des cases publiées d'une mesure et nombre de cases « * » : `n` vaut `null` si aucune case n'est publiée
    (jamais 0). La somme est un minimum dès que `masked` > 0."""
    published = values.dropna()
    return {"n": int(published.sum()) if len(published) else None, "masked": int(values.isna().sum())}


def cells(df: pd.DataFrame) -> dict[str, dict[str, int | None]]:
    return {m: cell(df[m]) for m in METRICS}


def family_order(df: pd.DataFrame) -> list[str]:
    """Familles par nombre décroissant de projets publiés en Île-de-France (égalité : code)."""
    totals = df.groupby("family")["met"].sum(min_count=1).fillna(0)
    return sorted(totals.index, key=lambda f: (-int(totals[f]), f))


def build_bassins(df: pd.DataFrame, families: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for code, g in df.groupby("bassin"):
        out[str(code)] = {
            "name": str(g["bassin_name"].iloc[0]),
            "total": cells(g),
            "families": {f: cells(g[g["family"] == f]) for f in families if (g["family"] == f).any()},
        }
    return dict(sorted(out.items()))


def build_metiers(df: pd.DataFrame) -> tuple[list[dict[str, str]], dict[str, dict[str, list[int | None]]]]:
    """Détail par métier : `[met, met_masked, xmet, xmet_masked, smet, smet_masked]` par (bassin, métier)."""
    catalogue = (df[["metier", "metier_name", "family"]].drop_duplicates().sort_values("metier"))
    metiers = [{"code": r.metier, "name": r.metier_name, "family": r.family} for r in catalogue.itertuples(index=False)]
    by_bassin: dict[str, dict[str, list[int | None]]] = {}
    for (bassin, metier), g in df.groupby(["bassin", "metier"]):
        row: list[int | None] = []
        for m in METRICS:
            c = cell(g[m])
            row += [c["n"], c["masked"]]
        by_bassin.setdefault(str(bassin), {})[str(metier)] = row
    return metiers, {b: dict(sorted(v.items())) for b, v in sorted(by_bassin.items())}


def build_export(df: pd.DataFrame, generated_at: str,
                 evidence: Mapping[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Contrats `bmo-1` (familles et totaux par bassin, chargé par le panneau de preuve) et `bmo-metiers-1` (détail par
    métier, chargé à la demande : visite guidée, étape recrutement non activée). `evidence` : `mask_evidence()`."""
    order = family_order(df)
    labels = {r.family: r.family_label for r in df[["family", "family_label"]].drop_duplicates().itertuples(index=False)}
    region = cells(df)
    main = {
        "contract": CONTRACT, "processing_version": PROCESSING_VERSION, "decision": DECISION,
        "generated_at": generated_at, "year": YEAR,
        "what": "projets de recrutement déclarés par les employeurs pour 2026 (enquête d'octobre à décembre 2025)",
        "sources": list(SOURCES),
        "unit": "projets de recrutement (intentions annuelles : créations de postes ou remplacements, y compris temps "
                "partiel et saisonniers), jamais des offres publiées ni des embauches",
        "masked_rule": "case « * » de France Travail : non diffusée, non comptée ; une somme dont masked > 0 est un "
                       "minimum (« au moins n ») ; n = null si aucune case n'est publiée (affiché « non diffusé », "
                       "jamais 0)",
        "masked": masked_block(evidence),
        "geography": "bassins d'emploi France Travail 2026 (BE26 = code_bassin_2026 de GEO04) ; Paris : un seul "
                     "bassin (1107) pour les 20 arrondissements",
        "families": [{"code": f, "label": labels[f]} for f in order],
        "region": {
            "published": region,
            "official": {"source_id": "EMP03", "table": OFFICIAL["table"], "page": OFFICIAL["page"],
                         "projects": OFFICIAL["idf_projects"]},
        },
        "bassins": build_bassins(df, order),
    }
    metiers, by_bassin = build_metiers(df)
    detail = {
        "contract": CONTRACT_METIERS, "processing_version": PROCESSING_VERSION, "decision": DECISION,
        "generated_at": generated_at, "year": YEAR, "sources": list(SOURCES),
        "layout": "bassins[code_bassin][code_metier] = [met, met_masked, xmet, xmet_masked, smet, smet_masked] ; "
                  "n null = aucune case publiée ; masked = cases « * » non comptées",
        "metiers": metiers, "bassins": by_bassin,
    }
    return main, detail


# --------------------------------------------------------------------------- contrôles (07, tests)
def check_main(doc: Mapping[str, Any], df: pd.DataFrame, evidence: Mapping[str, Any] | None = None) -> list[str]:
    """Écarts entre bmo.json et le recalcul sur le classeur (liste vide : conforme). `evidence` (`mask_evidence()`) :
    si fourni, le bloc `masked` publié doit être identique au recalcul ; sinon seul son libellé est comparé."""
    errs: list[str] = []
    if doc.get("contract") != CONTRACT:
        errs.append(f"contract {doc.get('contract')!r}")
    expected, _ = build_export(df, str(doc.get("generated_at")), evidence)
    for key in ("year", "families", "region", "bassins", "sources"):
        if doc.get(key) != expected[key]:
            errs.append(f"{key} différent du recalcul sur {BMO_XLSX.name}")
    masked = doc.get("masked") or {}
    if masked.get("label") != MASK_LABEL:
        errs.append("masked.label absent ou différent du libellé validé")
    if evidence is not None and masked != expected["masked"]:
        errs.append(f"masked différent du recalcul sur {BMO_XLSX.name}")
    if evidence is not None and evidence["published_below_threshold"] != 0:
        errs.append(f"valeur publiée sous {evidence['threshold']} : la déduction sur « * » ne tient plus")
    for code, b in (doc.get("bassins") or {}).items():
        for m in METRICS:
            fam = [f[m] for f in b["families"].values()]
            n_fam = sum(x["n"] or 0 for x in fam)
            if (b["total"][m]["n"] or 0) != n_fam:
                errs.append(f"bassin {code} {m} : total != somme des familles")
            if b["total"][m]["masked"] != sum(x["masked"] for x in fam):
                errs.append(f"bassin {code} {m} : cases « * » du total != somme des familles")
        t = b["total"]
        if t["xmet"]["n"] is not None and t["met"]["n"] is not None and t["met"]["masked"] == 0 and t["xmet"]["n"] > t["met"]["n"]:
            errs.append(f"bassin {code} : plus de projets difficiles que de projets")
    off = (doc.get("region") or {}).get("official") or {}
    pub = (doc.get("region") or {}).get("published", {}).get("met", {})
    if off.get("projects") != OFFICIAL["idf_projects"]:
        errs.append("total officiel différent de la constante vérifiée sur le PDF")
    if pub.get("n") is None or pub["n"] > off.get("projects", 0):
        errs.append("somme publiée supérieure au total officiel de la région")
    return errs


def check_detail(detail: Mapping[str, Any], main: Mapping[str, Any]) -> list[str]:
    """Le détail par métier recoupe bmo.json : mêmes sommes par bassin, métiers rattachés à une famille connue."""
    errs: list[str] = []
    if detail.get("contract") != CONTRACT_METIERS:
        errs.append(f"contract {detail.get('contract')!r}")
    fam = {m["code"]: m["family"] for m in detail.get("metiers", [])}
    known = {f["code"] for f in main.get("families", [])}
    if not set(fam.values()) <= known:
        errs.append("métier rattaché à une famille absente de bmo.json")
    if set(detail.get("bassins", {})) != set(main.get("bassins", {})):
        errs.append("bassins de bmo-metiers != bassins de bmo.json")
    for code, per in (detail.get("bassins") or {}).items():
        for i, m in enumerate(METRICS):
            n_sum = sum(v[2 * i] or 0 for v in per.values())
            masked = sum(v[2 * i + 1] for v in per.values())
            tot = main["bassins"][code]["total"][m]
            if n_sum != (tot["n"] or 0) or masked != tot["masked"]:
                errs.append(f"bassin {code} {m} : détail par métier != total de bmo.json")
        for metier in per:
            if metier not in fam:
                errs.append(f"bassin {code} : métier {metier} inconnu")
    return errs


def check_poles(poles: Iterable[Mapping[str, Any]], main: Mapping[str, Any], label: str) -> list[str]:
    """Chaque astre qui porte un bassin (jeu des 44 astres) a ses données BMO ; l'ancien jeu de 15 pôles n'en porte
    pas (rattachement impossible : il n'y a aucune valeur à afficher)."""
    errs: list[str] = []
    for p in poles:
        b = p.get("bassin")
        if b is None:
            continue
        code = str(b.get("code"))
        if code not in main.get("bassins", {}):
            errs.append(f"{label} : astre {p.get('id')} : bassin {code} absent de bmo.json")
        elif main["bassins"][code]["name"] != b.get("name"):
            errs.append(f"{label} : astre {p.get('id')} : libellé du bassin {code} différent de GEO04")
    return errs


def verify_official(pdf: Path = OFFICIAL_PDF) -> list[str]:
    """Le PDF gardé a l'empreinte attendue ; si `pypdf` est installé, la page 18 porte la ligne « Île-de-France 388 806 »
    (le total n'est jamais recopié sans relecture)."""
    import hashlib
    errs: list[str] = []
    if not pdf.exists():
        return [f"{pdf.name} absent"]
    if hashlib.sha256(pdf.read_bytes()).hexdigest() != OFFICIAL["pdf_sha256"]:
        errs.append(f"{pdf.name} : empreinte différente de la constante vérifiée")
    try:
        import pypdf
    except ImportError:
        return errs
    text = pypdf.PdfReader(str(pdf)).pages[OFFICIAL["page"] - 1].extract_text() or ""
    line = next((ln for ln in text.splitlines() if ln.startswith("Île-de-France")), "")
    digits = re.sub(r"\s+", "", line)
    if f"{OFFICIAL['idf_projects']}" not in digits:
        errs.append(f"page {OFFICIAL['page']} : ligne Île-de-France sans {OFFICIAL['idf_projects']} ({line!r})")
    return errs


def norm(s: str) -> str:
    """Libellé de bassin comparable entre BMO et GEO04 (casse, accents, ponctuation)."""
    import unicodedata
    t = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]", "", t)
