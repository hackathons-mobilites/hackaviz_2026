"""Exporte la maquette en dossier autonome, à ouvrir par double-clic (sans serveur), et en archive zip.

Usage (depuis la racine du projet) :
    python design/maquette/exporter.py [dossier_de_sortie]      # par défaut : ~/Downloads

Le guide fonctionne alors avec ses questions préparées (l'agent du SDK a besoin de agent/serveur.py).
Connexion internet nécessaire pour le fond OpenStreetMap, Leaflet et les polices."""
import json
import os
import shutil
import sys
import zipfile

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
DATA = os.path.join(RACINE, "web", "data")
SORTIE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser("~"), "Downloads")
NOM = "maquette-reseau-sous-canicule"
DEST = os.path.join(SORTIE, NOM)

FICHIERS_DATA = ["core.js", "flow.js", "carreaux.js", "volet2.js", "matsim.js", "msanim_canicule.js", "msanim_ordinaire.js",
                 "carto_com.js", "carto_com_fixe.js", "carto_iris.js", "carto_iris_fixe.js"]
PAGES = ["index.html", "cartogramme.html", "simulation.html"]
CODE = ["ui.js", "mesures.js", "cartogramme.js", "simulation.js", "maquette.css"]


def charger(nom):
    s = open(os.path.join(DATA, nom), encoding="utf-8").read()
    return json.loads(s[s.index("=") + 1:].strip().rstrip(";"))


def main():
    if os.path.exists(DEST):
        shutil.rmtree(DEST)
    os.makedirs(os.path.join(DEST, "data"))
    # pages et code : chemins réécrits pour un dossier plat
    for f in PAGES + CODE:
        s = open(os.path.join(ICI, f), encoding="utf-8").read()
        s = s.replace("../../web/data/", "data/").replace('href="../tokens.css"', 'href="tokens.css"')
        open(os.path.join(DEST, f), "w", encoding="utf-8").write(s)
    shutil.copy(os.path.join(RACINE, "design", "tokens.css"), os.path.join(DEST, "tokens.css"))
    # données
    for f in FICHIERS_DATA:
        shutil.copy(os.path.join(DATA, f), os.path.join(DEST, "data", f))
    # contours : seuls les noms et codes servent à la maquette (19 Mo → quelques centaines de Ko)
    L = charger("layers.js")
    garder = {"communes": ["code", "nom"], "iris": ["code_iris", "nom_iris", "nom_commune"]}
    leger = {k: {"type": "FeatureCollection", "features": [{"properties": {p: f["properties"].get(p) for p in garder[k]}} for f in L[k]["features"]]}
             for k in garder}
    open(os.path.join(DEST, "data", "layers.js"), "w", encoding="utf-8").write(
        "window.LAYERS=" + json.dumps(leger, ensure_ascii=False, separators=(",", ":")) + ";")
    open(os.path.join(DEST, "LISEZMOI.txt"), "w", encoding="utf-8").write(
        "Réseau sous canicule · maquette de l'interface (usage interne)\n\n"
        "Ouvrir index.html par double-clic, dans Chrome, Edge ou Firefox. Aucun serveur n'est nécessaire.\n"
        "Trois écrans, accessibles par le sélecteur en bas à gauche : Mesures, Cartogramme, Simulation.\n\n"
        "Il faut une connexion internet pour le fond de carte OpenStreetMap, la bibliothèque Leaflet et les polices.\n"
        "Le guide (« Demandez au guide… ») répond ici à quelques questions préparées ; la version avec agent IA\n"
        "demande le serveur du projet (design/maquette/agent/serveur.py).\n"
        "La carte de l'écran Mesures est illustrative ; le cartogramme et la simulation utilisent les vraies données.\n")
    # archive
    zp = DEST + ".zip"
    if os.path.exists(zp):
        os.remove(zp)
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, _, fs in os.walk(DEST):
            for f in fs:
                full = os.path.join(base, f)
                z.write(full, os.path.join(NOM, os.path.relpath(full, DEST)))
    taille = lambda p: sum(os.path.getsize(os.path.join(b, f)) for b, _, fs in os.walk(p) for f in fs)
    print(f"dossier : {DEST} ({taille(DEST) / 1e6:.0f} Mo)")
    print(f"archive : {zp} ({os.path.getsize(zp) / 1e6:.0f} Mo)")


if __name__ == "__main__":
    main()
