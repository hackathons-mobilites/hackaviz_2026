"""Recoupement des péages publiés (04k) : A5 (APRR) contre le CSV ouvert et le PDF officiel, A14 et Duplex A86
contre des relevés faits à la main par un humain.

Principe (consigne de Nicolas du 05/11/2026) : aucune API ouverte ni donnée officielle ne donne le prix d'un trajet,
et aucun service fermé n'est utilisé (ni calculateur d'itinéraire commercial, ni site dont les mentions interdisent la
réutilisation). Le recoupement se fait donc :
- pour l'A5 : montants du site (toll_tariffs.csv et tolls.json) contre la grille ouverte de data.gouv.fr (Licence
  Ouverte 2.0) ET contre le PDF officiel d'APRR, relu par pdftotext avec le numéro de page ;
- pour l'A14 et le Duplex A86 : contre des montants relevés à la main, chacun avec sa source, sa page et sa date
  (`data/peages_releves_manuels.csv`, vide au départ). Sans relevé, le contrôle dit « non vérifié », jamais une valeur.

Logique pure (aucune lecture de fichier hors des fonctions `read_*` et `pdf_pages`), testée dans
tests/test_toll_crosscheck.py.
"""

from __future__ import annotations

import csv
import re
import shutil
import subprocess
import unicodedata
from collections.abc import Iterable, Sequence
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd

from starway import congestion
from starway import toll_tariffs as tt
from starway.config import DAY_TYPES

CONTRACT = "toll-crosscheck-1"
NOT_VERIFIED = "non vérifié"
TOLERANCE_EUR = 0.005  # les grilles sont au dixième d'euro ou au centime : tout écart supérieur est un écart

MANUAL_COLUMNS = ("autoroute", "point_ou_troncon", "classe", "tarif", "jour", "heure", "montant_eur", "source", "page",
                  "date_releve")
MANUAL_SCOPES = ("A14", "A86")
# Vocabulaire de `type_jour` de toll_tariffs.csv : un relevé doit l'employer pour être comparable
DAYS_A14 = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche", "ferie")
DAYS_A86 = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche_ferie", "veille_ferie",
            "aout_ouvrable")
A14_POINTS = {"montesson": "SAPN_A14_MONTESSON", "chambourcy": "SAPN_A14_CHAMBOURCY"}
A86_POINTS = {"rueil": "DUPLEX_RUEIL", "vaucresson": "DUPLEX_VAUCRESSON", "velizy": "DUPLEX_VELIZY"}


def _fold(text: str) -> str:
    """Minuscules sans accents ni espaces superflus (comparaison de libellés saisis à la main)."""
    t = unicodedata.normalize("NFKD", text or "")
    return re.sub(r"\s+", " ", "".join(c for c in t if not unicodedata.combining(c))).strip().lower()


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


# ----------------------------------------------------------------------------------------------------- A5 (APRR)
def find_pdftotext() -> str:
    exe = shutil.which("pdftotext") or (r"C:\Program Files\Git\mingw64\bin\pdftotext.exe"
                                         if Path(r"C:\Program Files\Git\mingw64\bin\pdftotext.exe").exists() else "")
    if not exe:
        raise SystemExit("pdftotext introuvable (Git for Windows : mingw64/bin)")
    return exe


def pdf_pages(pdf: Path) -> list[str]:
    """Texte de chaque page du PDF (`pdftotext -table`, les pages sont séparées par un saut de page)."""
    out = subprocess.run([find_pdftotext(), "-table", "-enc", "UTF-8", str(pdf), "-"], capture_output=True,
                         check=True).stdout.decode("utf-8", errors="replace")
    pages = out.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    return pages


def parse_pdf_pairs_by_page(pages: Sequence[str], names: Iterable[str]) -> dict[tuple[str, str], dict[str, Any]]:
    """Couples (entrée, sortie) de la grille officielle limités aux gares `names` : valeurs (km, classes 1 à 5), numéro
    de page du PDF (à partir de 1) et ligne recopiée. Un couple lu sur deux pages garde la première et le dit."""
    found: dict[tuple[str, str], dict[str, Any]] = {}
    for n, text in enumerate(pages, start=1):
        for key, vals in tt.parse_aprr_pdf_table(text, names).items():
            if key in found:
                found[key].setdefault("doublons_pages", []).append(n)
                continue
            line = next((ln.strip() for ln in text.splitlines()
                         if ln.strip().startswith(f"{key[0]} ") and f" {key[1]} " in f" {ln.strip()} "), "")
            found[key] = {"page": n, "values": vals, "line": re.sub(r"\s+", " ", line)}
    return found


def _same(values: Sequence[float | None]) -> bool:
    known = [v for v in values if v is not None]
    return all(abs(v - known[0]) <= TOLERANCE_EUR for v in known)


def a5_crosscheck(tariffs: pd.DataFrame, tolls_json: dict[str, Any], csv_pairs: dict[tuple[str, str], tuple[float, ...]],
                  pdf_pairs: dict[tuple[str, str], dict[str, Any]], *, road_prefix: str = "APRR_A5") -> list[dict]:
    """Une ligne par couple (entrée, sortie) du système APRR dont une gare est de l'A5 (`road_prefix`) et par classe.

    Sources comparées : `site_csv_tarifs` (toll_tariffs.csv, qui alimente tolls.json), `site_tolls_json` (grille publiée
    pour le front, jour de service), `data_gouv_csv` (TOLL06) et `pdf_officiel` (TOLL06, avec la page). Verdict :
    `concordant` (toutes les valeurs connues sont égales, au moins deux sources), `ecart`, ou `absent_<source>` quand une
    source ne publie pas le couple (ce n'est pas un écart de montant)."""
    names = {p.nom_grille: p.point_id for p in tt.POINTS if p.systeme == "APRR" and p.nom_grille}
    idx = {p["id"]: i for i, p in enumerate(tolls_json["points"])}
    grids: dict[tuple[int, int, int], float | None] = {}
    for g in tolls_json["grids"]:
        if g.get("t") == "standard" and g.get("d") == 0 and g.get("slots"):
            slots = g["slots"]
            grids[(g["e"], g["s"], g["c"])] = slots[0][2] if len(slots) == 1 and slots[0][:2] == [0, 1440] else None
    site = {}
    ap = tariffs[(tariffs["systeme"] == "APRR") & (tariffs["statut"] == "ok")]
    for r in ap.itertuples(index=False):
        site[(r.entree_grille, r.sortie_grille, int(r.classe))] = float(r.prix_ttc_eur)
    rows = []
    pairs = sorted({(e, s) for (e, s, _c) in site} | {k for k in csv_pairs if k[0] in names and k[1] in names}
                   | {k for k in pdf_pairs if k[0] in names and k[1] in names})
    for e, s in pairs:
        if not (names[e].startswith(road_prefix) or names[s].startswith(road_prefix)):
            continue
        for c in tt.CLASSES:
            vals = {
                "site_csv_tarifs": site.get((e, s, c)),
                "site_tolls_json": grids.get((idx[names[e]], idx[names[s]], c)),
                "data_gouv_csv": csv_pairs[(e, s)][c] if (e, s) in csv_pairs else None,
                "pdf_officiel": pdf_pairs[(e, s)]["values"][c] if (e, s) in pdf_pairs else None}
            missing = [k for k, v in vals.items() if v is None]
            known = [v for v in vals.values() if v is not None]
            if len(known) >= 2 and not _same(known):
                verdict = "ecart"
            elif missing:
                verdict = "absent_" + "+".join(missing)
            else:
                verdict = "concordant"
            if verdict.startswith("absent_") and len(known) >= 2 and _same(known):
                verdict = "concordant_" + verdict  # les sources présentes s'accordent, une autre ne publie pas le couple
            pdf = pdf_pairs.get((e, s))
            rows.append({"entree_grille": e, "sortie_grille": s, "classe": c, **vals,
                         "page_pdf": pdf["page"] if pdf else None, "verdict": verdict})
    return rows


def a5_summary(rows: Sequence[dict]) -> dict[str, Any]:
    by: dict[str, int] = {}
    for r in rows:
        by[r["verdict"]] = by.get(r["verdict"], 0) + 1
    ecarts = [r for r in rows if r["verdict"] == "ecart"]
    return {"couples_classes": len(rows), "par_verdict": dict(sorted(by.items())), "ecarts": ecarts,
            "concordance_complete": not ecarts and all(r["verdict"] == "concordant" for r in rows)}


def pdf_csv_all_classes(csv_pairs: dict[tuple[str, str], tuple[float, ...]],
                        pdf_pairs: dict[tuple[str, str], dict[str, Any]]) -> dict[str, Any]:
    """Distance et classes 1 à 5 : PDF contre CSV, sur les couples que les deux publient."""
    both = sorted(set(csv_pairs) & set(pdf_pairs))
    diffs = [{"entree": e, "sortie": s, "csv": list(csv_pairs[(e, s)]), "pdf": list(pdf_pairs[(e, s)]["values"]),
              "page_pdf": pdf_pairs[(e, s)]["page"]}
             for e, s in both
             if any(abs(a - b) > 1e-9 for a, b in zip(csv_pairs[(e, s)], pdf_pairs[(e, s)]["values"], strict=True))]
    return {"couples_communs": len(both), "valeurs_comparees": len(both) * 6, "couples_avec_ecart": diffs,
            "seulement_pdf": [list(k) for k in sorted(set(pdf_pairs) - set(csv_pairs))],
            "seulement_csv": [list(k) for k in sorted(set(csv_pairs) - set(pdf_pairs))]}


# ---------------------------------------------------------------------------------------- relevés manuels (A14, A86)
def read_manual(path: Path) -> tuple[list[dict], list[str]]:
    """Relevés saisis à la main : (lignes valides, erreurs). Un fichier absent ou sans ligne donne ([], [])."""
    if not path.exists():
        return [], []
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if tuple(reader.fieldnames or ()) != MANUAL_COLUMNS:
            return [], [f"{path.name} : colonnes attendues {list(MANUAL_COLUMNS)}, lues {list(reader.fieldnames or [])}"]
        raw = [r for r in reader if any((v or "").strip() for v in r.values())]
    records, errors = [], []
    for n, r in enumerate(raw, start=2):
        rec, errs = validate_manual(r)
        errors += [f"ligne {n} : {e}" for e in errs]
        if not errs:
            records.append(rec)
    return records, errors


def validate_manual(r: dict[str, str]) -> tuple[dict, list[str]]:
    errs: list[str] = []
    row = {k: (r.get(k) or "").strip() for k in MANUAL_COLUMNS}
    if any(chr(0x2014) in v or chr(0x2013) in v for v in row.values()):
        errs.append("tiret cadratin ou demi-cadratin interdit")
    road = row["autoroute"].upper()
    if road not in MANUAL_SCOPES:
        errs.append(f"autoroute {row['autoroute']!r} : attendu {list(MANUAL_SCOPES)}")
    try:
        classe = int(row["classe"])
        if classe not in tt.CLASSES:
            errs.append(f"classe {classe} : attendu {list(tt.CLASSES)}")
    except ValueError:
        classe = 0
        errs.append(f"classe {row['classe']!r} illisible")
    tarif = row["tarif"] or "standard"
    if tarif not in ("standard", "telepeage"):
        errs.append(f"tarif {tarif!r} : attendu standard ou telepeage")
    days = DAYS_A14 if road == "A14" else DAYS_A86
    jour = _fold(row["jour"]).replace(" ", "_")
    if jour not in days:
        errs.append(f"jour {row['jour']!r} : attendu {list(days)}")
    if not re.fullmatch(r"\d{1,2}:\d{2}", row["heure"]) or not 0 <= _minutes(row["heure"]) < 1440:
        errs.append(f"heure {row['heure']!r} : attendu HH:MM (de 00:00 à 23:59)")
    try:
        montant = float(row["montant_eur"].replace(",", "."))
        if montant <= 0:
            errs.append("montant nul ou négatif")
    except ValueError:
        montant = float("nan")
        errs.append(f"montant {row['montant_eur']!r} illisible")
    for k in ("source", "page", "date_releve", "point_ou_troncon"):
        if not row[k]:
            errs.append(f"{k} obligatoire (un relevé sans source, page et date n'est pas retenu)")
    if row["date_releve"]:
        try:
            date.fromisoformat(row["date_releve"])
        except ValueError:
            errs.append(f"date_releve {row['date_releve']!r} : attendu AAAA-MM-JJ")
    if road == "A14" and _fold(row["point_ou_troncon"]) not in A14_POINTS:
        errs.append(f"point {row['point_ou_troncon']!r} : attendu {list(A14_POINTS)}")
    if road == "A86":
        parts = [_fold(x) for x in re.split(r"\s*(?:>|->|vers)\s*", row["point_ou_troncon"])]
        if len(parts) != 2 or any(p not in A86_POINTS for p in parts) or parts[0] == parts[1]:
            errs.append(f"tronçon {row['point_ou_troncon']!r} : attendu « Rueil > Vélizy » (entrée > sortie, parmi "
                        "Rueil, Vaucresson, Vélizy)")
    return {**row, "autoroute": road, "classe": classe, "tarif": tarif, "jour": jour, "montant": montant}, errs


def site_price(tariffs: pd.DataFrame, rec: dict) -> tuple[float | None, str]:
    """Montant publié pour un relevé : (prix, détail) ou (None, raison) si le site ne publie pas cette case."""
    if rec["autoroute"] == "A14":
        pid = A14_POINTS[_fold(rec["point_ou_troncon"])]
        sub = tariffs[(tariffs["point_id"] == pid) & (tariffs["classe"].astype(int) == rec["classe"])
                      & (tariffs["tarif"] == rec["tarif"])]
    else:
        e, s = (A86_POINTS[_fold(x)] for x in re.split(r"\s*(?:>|->|vers)\s*", rec["point_ou_troncon"]))
        sub = tariffs[(tariffs["systeme"] == "DUPLEX_A86") & (tariffs["entree_point_id"] == e)
                      & (tariffs["sortie_point_id"] == s) & (tariffs["classe"].astype(int) == rec["classe"])
                      & (tariffs["tarif"] == rec["tarif"])]
    if sub.empty:
        return None, "case absente du site"
    h = _minutes(rec["heure"])
    for tj in (rec["jour"], "tous"):
        hit = sub[(sub["type_jour"] == tj)
                  & sub.apply(lambda r: _minutes(r["heure_debut"]) <= h < _minutes(r["heure_fin"]), axis=1)]
        if not hit.empty:
            row = hit.iloc[0]
            if row["statut"] != tt.STATUT_OK or pd.isna(row["prix_ttc_eur"]):
                return None, f"statut du site : {row['statut']}"
            return float(row["prix_ttc_eur"]), f"type de jour {tj}, tranche {row['heure_debut']}-{row['heure_fin']}"
    return None, "aucune tranche du site ne couvre ce jour et cette heure"


def compare_manual(tariffs: pd.DataFrame, records: Sequence[dict]) -> list[dict]:
    out = []
    for rec in records:
        price, detail = site_price(tariffs, rec)
        if price is None:
            verdict = "non_comparable"
        else:
            verdict = "concordant" if abs(price - rec["montant"]) <= TOLERANCE_EUR else "ecart"
        out.append({k: rec[k] for k in MANUAL_COLUMNS if k != "montant_eur"} | {
            "montant_releve_eur": rec["montant"], "montant_site_eur": price, "detail_site": detail,
            "verdict": verdict})
    return out


def manual_status(compared: Sequence[dict], errors: Sequence[str]) -> dict[str, dict[str, Any]]:
    """État du contrôle par autoroute : « non vérifié » tant qu'aucun relevé valide n'a été comparé."""
    status: dict[str, dict[str, Any]] = {}
    for road in MANUAL_SCOPES:
        mine = [c for c in compared if c["autoroute"] == road]
        n_ok = sum(1 for c in mine if c["verdict"] == "concordant")
        n_gap = sum(1 for c in mine if c["verdict"] == "ecart")
        n_nc = sum(1 for c in mine if c["verdict"] == "non_comparable")
        if not mine:
            label = NOT_VERIFIED
        elif n_gap:
            label = f"écart sur {n_gap} relevé(s) sur {len(mine)}"
        elif n_ok:
            label = f"{n_ok} relevé(s) concordant(s)" + (f", {n_nc} non comparable(s)" if n_nc else "")
        else:
            label = NOT_VERIFIED
        status[road] = {"etat": label, "releves": len(mine), "concordants": n_ok, "ecarts": n_gap,
                        "non_comparables": n_nc}
    status["_erreurs_de_saisie"] = {"etat": "aucune" if not errors else f"{len(errors)} ligne(s) refusée(s)",
                                    "erreurs": list(errors)}
    return status


# ------------------------------------------------------------------------------------ trajet à recouper à la main
def merge_slots(slots: Sequence[Sequence[float]]) -> list[dict]:
    """Tranches [début, fin, prix] contiguës de même prix fusionnées (minutes depuis minuit)."""
    out: list[list[float]] = []
    for a, b, p in sorted(slots):
        if out and out[-1][1] == a and out[-1][2] == p:
            out[-1][1] = b
        else:
            out.append([a, b, p])
    return [{"debut": _hhmm(int(a)), "fin": _hhmm(int(b)), "prix_eur": p} for a, b, p in out]


def _hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def trip_windows(free_out_min: int) -> list[dict]:
    """Fenêtres de passage de l'aller (règle de toll_publish : [S - T, S)) pour chaque journée-type, avec T route
    vide et T avec le trafic moyen DiRIF quand la règle de congestion s'applique (sinon T route vide)."""
    out = []
    for d in DAY_TYPES:
        s = d.start.hour * 60 + d.start.minute
        _period, status, congested = congestion.attach("out", s, free_out_min)
        out.append({"journee_type": d.id, "debut_poste": _hhmm(s), "duree_route_vide_min": free_out_min,
                    "fenetre_route_vide": [_hhmm(s - free_out_min), _hhmm(s)],
                    "duree_trafic_min": congested if status == congestion.STATUS_OK else None,
                    "fenetre_trafic": [_hhmm(s - congested), _hhmm(s)] if status == congestion.STATUS_OK else None,
                    "statut_trafic": status})
    return out
