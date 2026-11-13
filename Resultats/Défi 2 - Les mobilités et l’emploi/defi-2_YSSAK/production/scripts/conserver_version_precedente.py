"""Recopie dans le nouveau site les fichiers de la version actuellement en ligne.

Pourquoi : Observable Framework nomme les fichiers d'après leur contenu
(_file/data/fact_mobilite.0b189ca5.parquet). Quand les données changent, le nom
change et l'ancien fichier disparaît au déploiement suivant. Or GitHub Pages laisse
les navigateurs garder les pages HTML en cache 10 minutes (max-age=600) : un visiteur
qui a la page en cache demande alors l'ancien fichier, reçoit une 404, et le dashboard
affiche « Failed to open file » ou « TProtocolException ».

Ce script, lancé juste après `npm run build`, lit chaque page du site en ligne,
repère les fichiers qu'elle référence (_file/, _npm/, _observablehq/, _import/, _duckdb/),
y compris ceux importés par les modules JavaScript et les feuilles de style, et
télécharge dans dist/ ceux qui n'y sont pas. Les anciennes pages en cache continuent
ainsi de fonctionner. Seule la version précédente est conservée : le site ne grossit pas
d'un déploiement à l'autre.

Toute erreur réseau est ignorée (premier déploiement, site indisponible...) : ce script
ne doit jamais faire échouer le déploiement.

Usage :
    python scripts/conserver_version_precedente.py dashboard/dist https://<compte>.github.io/<depot>/
"""

from __future__ import annotations

import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PREFIXES = ("_file/", "_npm/", "_observablehq/", "_import/", "_duckdb/")
# Chaînes entre guillemets ou dans url(...) qui ressemblent à un chemin relatif ou absolu.
REF = re.compile(r"""(?:["'`(])((?:\.{1,2}/|/)[^"'`()\s<>]+)""")
SCANNABLE = (".js", ".css", ".html")
MAX_FICHIERS = 2000


def get(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "deploiement-dashboard", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def references(page_url: str, texte: str, base: str) -> set[str]:
    """Chemins (relatifs à la racine du site) des fichiers référencés par une page ou un module."""
    trouves = set()
    for ref in REF.findall(texte):
        url = urllib.parse.urljoin(page_url, ref.split("#")[0].split("?")[0])
        if not url.startswith(base):
            continue
        chemin = url[len(base):]
        if chemin.startswith(PREFIXES):
            trouves.add(chemin)
    return trouves


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    dist = Path(sys.argv[1])
    base = sys.argv[2].rstrip("/") + "/"

    # Pages du nouveau site -> même page sur le site en ligne.
    a_explorer: list[str] = []
    for html in sorted(dist.rglob("*.html")):
        rel = html.relative_to(dist).as_posix()
        if rel.startswith(PREFIXES):
            continue
        a_explorer.append(base + ("" if rel == "index.html" else rel.removesuffix(".html")))

    vus: set[str] = set()
    copies = 0
    while a_explorer and len(vus) < MAX_FICHIERS:
        url = a_explorer.pop()
        if url in vus:
            continue
        vus.add(url)
        chemin = url[len(base):]
        contenu = None

        if chemin.startswith(PREFIXES):
            cible = dist / chemin
            if cible.exists():
                continue  # déjà dans le nouveau site (contenu identique : même nom = même contenu)
            contenu = get(url)
            if contenu is None:
                continue
            if chemin.endswith(".parquet") and (contenu[:4] != b"PAR1" or contenu[-4:] != b"PAR1"):
                print(f"[version précédente] ignoré (Parquet invalide) : {chemin}")
                continue
            cible.parent.mkdir(parents=True, exist_ok=True)
            cible.write_bytes(contenu)
            copies += 1
            if not chemin.endswith(SCANNABLE):
                continue
        else:
            contenu = get(url)
            if contenu is None:
                continue

        texte = contenu.decode("utf-8", errors="ignore")
        for ref in references(url, texte, base):
            a_explorer.append(base + ref)

    print(f"[version précédente] {copies} fichier(s) de la version en ligne conservé(s) dans {dist}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
