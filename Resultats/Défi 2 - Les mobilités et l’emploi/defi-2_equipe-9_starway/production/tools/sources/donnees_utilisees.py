#!/usr/bin/env python3
"""Liste des données utilisées par STARWAY, une ligne par source, avec leur lien : docs/liste-des-donnees.md et .csv.

Rien n'est écrit à la main : tout est lu dans docs/sources.md (lui-même généré par pipeline/scripts/06r_sources_registry.py
depuis data/sources_manifest.csv, le registre et le code). Relancer après chaque `06r` :

    python tools/sources/donnees_utilisees.py
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "sources.md"
OUT_MD = ROOT / "docs" / "liste-des-donnees.md"
OUT_CSV = ROOT / "docs" / "liste-des-donnees.csv"
MANIFEST = ROOT / "data" / "sources_manifest.csv"

# Ordre de lecture : d'abord ce que le site affiche, puis le reste
STATUS_ORDER = [
    "utilisée et publiée",
    "utilisée, résultat pas encore publié",
    "utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient)",
    "téléchargée, non utilisée",
    "écartée",
]
STATUS_TITLE = {
    "utilisée et publiée": "Affichées sur le site",
    "utilisée, résultat pas encore publié": "Utilisées, résultat pas encore publié",
    "utilisée pour un contrôle ou une analyse (rien d'affiché n'en vient)": "Utilisées pour un contrôle ou une analyse (rien n'est affiché)",
    "téléchargée, non utilisée": "Téléchargées, non utilisées",
    "écartée": "Écartées",
}


def kept_files() -> dict[str, list[dict[str, str]]]:
    """Fichiers bruts gardés par source, lus dans le manifeste : nom, contenu, date d'extraction et adresse de chacun."""
    out: dict[str, list[dict[str, str]]] = {}
    with MANIFEST.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            m = re.match(r"(\d{4})-(\d{2})-(\d{2})", row["date_extraction"] or "")
            url = (row["url_source"] or "").strip()
            out.setdefault(row["source_id"], []).append(
                {
                    "nom": Path(row["fichier_local"]).name,
                    "titre": row["titre"].strip(),
                    "date": f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else "",
                    "url": url if url.startswith("http") else "",
                }
            )
    return out


def file_text(f: dict[str, str]) -> str:
    """Une page web gardée en copie n'est pas un jeu de données à télécharger : on le dit, avec l'adresse de la page."""
    page = f["nom"].lower().endswith((".html", ".htm"))
    if page:
        when = f", enregistrée le {f['date']}" if f["date"] else ""
        where = f", adresse de la page : {f['url']}" if f["url"] else ""
        return f"{f['nom']} (copie d'une page web gardée comme preuve : {f['titre']}{when}{where})"
    when = f", extrait le {f['date']}" if f["date"] else ""
    where = f", téléchargé depuis {f['url']}" if f["url"] else ", sans adresse web"
    return f"{f['nom']} ({f['titre']}{when}{where})"


def cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse() -> list[dict[str, str]]:
    text = SRC.read_text(encoding="utf-8")
    recap: dict[str, list[str]] = {}
    for line in text.splitlines():
        m = re.match(r"^\| \[([A-Z0-9-]+)\]\(#", line)
        if m:
            recap[m.group(1)] = cells(line)
    rows: list[dict[str, str]] = []
    for block in text.split("\n### ")[1:]:
        code = block.splitlines()[0].strip()
        if code not in recap:
            continue
        r = recap[code]  # Code | Producteur | Source | Licence | Millésime | Statut | Fichiers
        statut_full = re.search(r"^- \*\*Statut\*\* : (.*)$", block, re.M)
        statut_full = statut_full.group(1).strip() if statut_full else r[5]
        short = r[5]
        detail = statut_full[len(short):].lstrip(" :") if statut_full.startswith(short) else statut_full
        links: list[str] = []
        for line in block.splitlines():
            if line.startswith("| `"):
                c = cells(line)
                if len(c) >= 3 and c[2].startswith("http") and c[2] not in links:
                    links.append(c[2])
        rows.append(
            {
                "code": code,
                "donnee": r[2],
                "producteur": r[1],
                "statut": short,
                "utilisee_pour": detail,
                "millesime": r[4],
                "licence": r[3],
                "liens": " ; ".join(links),
                "fichiers": r[6],
            }
        )
    return rows


def parse_catalog(known: set[str]) -> tuple[list[dict[str, str]], list[str]]:
    """Sources du catalogue du hackathon jamais téléchargées (absentes du manifeste), et les pistes écartées sans code."""
    text = SRC.read_text(encoding="utf-8")
    extra: list[dict[str, str]] = []
    for line in text.splitlines():
        m = re.match(r"^\| ([A-Z]{2,5}\d{2}[A-Z]?) \| ", line)
        if not m or m.group(1) in known:
            continue
        c = cells(line)
        if len(c) == 5:  # Code | Source | Producteur | Priorité | Décision
            extra.append({"code": c[0], "donnee": c[1], "producteur": c[2], "priorite": c[3], "decision": c[4]})
    ideas: list[str] = []
    after = text.split("Autres pistes écartées ou non retenues, sans code :", 1)
    if len(after) == 2:
        for line in after[1].splitlines():
            if line.startswith("- "):
                ideas.append(line[2:].strip())
            elif ideas and line.strip() == "":
                break
    return extra, ideas


def short_text(text: str, limit: int = 150) -> str:
    """Pour le tableau à lire d'un coup d'oeil : coupé au mot, le texte complet reste dans le CSV et dans sources.md."""
    text = text.replace("|", "/").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(" ,;:(") + " (suite dans le CSV)"


def link_cell(r: dict) -> str:
    """Un lien par fichier gardé, nommé par ce fichier : on voit à quoi mène chaque lien."""
    urls = [u for u in r["liens"].split(" ; ") if u]
    if not urls:
        return "aucun lien web (fichier fourni)"
    if len(urls) == 1:
        return f"[lien]({urls[0]})"
    seen: list[str] = []
    parts: list[str] = []
    for f in r.get("files", []):
        if f["url"] and f["url"] not in seen:
            seen.append(f["url"])
            parts.append(f"[{f['nom']}]({f['url']})")
    parts += [f"[lien]({u})" for u in urls if u not in seen]
    return " · ".join(parts)


def main() -> int:
    rows = parse()
    files = kept_files()
    for r in rows:
        r["detail_fichiers"] = " ; ".join(file_text(f) for f in files.get(r["code"], []))
        r["files"] = files.get(r["code"], [])  # type: ignore[assignment]
        r["lien_principal"] = r["liens"].split(" ; ")[0] if r["liens"] else ""
        if len(files.get(r["code"], [])) != int(r["fichiers"]):
            print(f"{r['code']} : {r['fichiers']} fichiers dans sources.md, {len(files.get(r['code'], []))} dans le manifeste", file=sys.stderr)
            return 1
    if len(rows) < 40:
        print(f"Seulement {len(rows)} sources lues dans {SRC} : format changé ?", file=sys.stderr)
        return 1
    rank = {s: i for i, s in enumerate(STATUS_ORDER)}
    rows.sort(key=lambda r: (rank.get(r["statut"], 99), r["code"]))

    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Code", "Donnee", "Producteur", "Statut", "Utilisee pour", "Millesime", "Licence", "Lien principal"])
        for r in rows:
            w.writerow([r["code"], r["donnee"], r["producteur"], r["statut"], r["utilisee_pour"], r["millesime"], r["licence"], r["lien_principal"]])

    out = [
        "<!-- Fichier généré par tools/sources/donnees_utilisees.py depuis docs/sources.md : NE PAS MODIFIER À LA MAIN. -->",
        "",
        "# Liste des données utilisées par STARWAY, en un coup d'oeil",
        "",
        f"**{len(rows)} sources**, une ligne chacune, avec leur producteur, leur lien, leur millésime et leur licence. "
        "Le détail (empreintes, traitements, limites) est dans [sources.md](sources.md) ; la version tableur de cette liste est "
        "[liste-des-donnees.csv](liste-des-donnees.csv) (séparateur « ; », s'ouvre dans Excel). Le texte qui explique pourquoi chaque donnée est utilisée, "
        "ce qu'elle dit et ne dit pas, est dans [donnees-utilisees.md](donnees-utilisees.md).",
        "",
        "Dans le tableur, la colonne « Lien principal » donne un lien par source. Dans les tableaux ci-dessous, quand une source vient de plusieurs pages "
        "ou de plusieurs jeux du même producteur, chaque lien porte le nom du fichier auquel il mène.",
        "",
        "| Statut | Nombre |",
        "|---|---|",
    ]
    for s in STATUS_ORDER:
        n = sum(1 for r in rows if r["statut"] == s)
        if n:
            out.append(f"| {STATUS_TITLE[s]} | {n} |")
    for s in STATUS_ORDER:
        part = [r for r in rows if r["statut"] == s]
        if not part:
            continue
        out += ["", f"## {STATUS_TITLE[s]} ({len(part)})", "", "| Code | Donnée | Producteur | Utilisée pour | Millésime | Licence | Lien |", "|---|---|---|---|---|---|---|"]
        for r in part:
            use = short_text(r["utilisee_pour"]) or "-"
            out.append(f"| [{r['code']}](sources.md#{r['code'].lower()}) | {r['donnee']} | {r['producteur']} | {use} | {r['millesime']} | {r['licence']} | {link_cell(r)} |")
    extra, ideas = parse_catalog({r["code"] for r in rows})
    if extra:
        out += [
            "",
            f"## Au catalogue du hackathon, jamais téléchargées ({len(extra)})",
            "",
            "Aucune de ces données n'est utilisée par le site : le code, le producteur et la raison sont donnés pour que la liste soit complète.",
            "",
            "| Code | Donnée | Producteur | Décision |",
            "|---|---|---|---|",
        ]
        for e in extra:
            out.append(f"| [{e['code']}](sources.md#{e['code'].lower()}) | {e['donnee']} | {e['producteur']} | {short_text(e['decision'], 220)} |")
    if ideas:
        out += ["", f"## Autres pistes écartées, sans code ({len(ideas)})", ""] + [f"- {i}" for i in ideas]
    with OUT_CSV.open("a", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";")
        for e in extra:
            w.writerow([e["code"], e["donnee"], e["producteur"], "au catalogue, jamais téléchargée", e["decision"], "", "", ""])
        for i in ideas:
            w.writerow(["(sans code)", i, "", "écartée, sans code", "", "", "", ""])
    OUT_MD.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"{len(rows)} sources + {len(extra)} au catalogue + {len(ideas)} pistes : {OUT_MD.relative_to(ROOT)} et {OUT_CSV.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
