"""Publie l'interface finale dans web/ : l'écran « Une journée sous canicule » devient web/index.html.

Source de vérité : design/maquette/ (trajet.html et ses fichiers) et design/tokens.css. Ce script les recopie dans web/
en réécrivant les chemins, pour que le site s'ouvre seul (serveur de fichiers ou double-clic), données dans web/data/.
Le guide passe par l'agent (design/maquette/agent/serveur.py) quand il tourne ; sinon il répond aux questions préparées.

Premier passage : l'ancien prototype (web/index.html, web/app.js) est déplacé dans web/prototype/, sans rien supprimer.
"""
import os
import re
import shutil
import time

ICI = os.path.dirname(os.path.abspath(__file__))
RAC = os.path.normpath(os.path.join(ICI, ".."))
MAQ = os.path.join(RAC, "design", "maquette")
WEB = os.path.join(RAC, "web")
APP = os.path.join(WEB, "app")
PROTO = os.path.join(WEB, "prototype")

FICHIERS = ["maquette.css", "trajet.css", "ui.js", "trajet_chapitres.js", "trajet_profils.js", "trajet.js"]


def lire(p):
    return open(p, encoding="utf-8").read()


def ecrire(p, s):
    """Écrit dans un fichier temporaire puis le substitue ; réessaie si le fichier est brièvement verrouillé (serveur, antivirus)."""
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as h:
        h.write(s)
    for essai in range(10):
        try:
            os.replace(tmp, p)
            return
        except OSError:
            time.sleep(0.3)
    raise OSError(f"impossible d'écrire {p}")


def archiver_prototype():
    """Déplace l'ancien prototype dans web/prototype/ (une seule fois) et corrige ses chemins."""
    ancien = os.path.join(WEB, "index.html")
    if os.path.exists(PROTO) or not os.path.exists(ancien) or not os.path.exists(os.path.join(WEB, "app.js")):
        return
    os.makedirs(PROTO)
    for f in ("index.html", "app.js"):
        s = lire(os.path.join(WEB, f))
        s = re.sub(r'(["\'(`])(data|tiles)/', r"\1../\2/", s)
        s = s.replace('src="raptor_engine.js"', 'src="../raptor_engine.js"').replace("'raptor_engine.js'", "'../raptor_engine.js'")
        ecrire(os.path.join(PROTO, f), s)
        os.remove(os.path.join(WEB, f))
    print("prototype déplacé dans web/prototype/")


def publier():
    global VERSION
    VERSION = time.strftime("%Y%m%d%H%M%S")
    os.makedirs(APP, exist_ok=True)
    shutil.copyfile(os.path.join(RAC, "design", "tokens.css"), os.path.join(APP, "tokens.css"))
    for f in FICHIERS:
        s = lire(os.path.join(MAQ, f)).replace("../../web/data/", "data/")
        s = re.sub(r"(data/[A-Za-z0-9_]+\.js)'", lambda m: m.group(1) + "?v=" + VERSION + "'", s)
        ecrire(os.path.join(APP, f), s)
    h = lire(os.path.join(MAQ, "trajet.html"))
    h = h.replace('href="../tokens.css"', 'href="app/tokens.css"')
    # numéro de version sur chaque fichier : le navigateur charge toujours la dernière publication
    v = VERSION
    h = h.replace('href="app/tokens.css"', f'href="app/tokens.css?v={v}"')
    for f in FICHIERS:
        h = h.replace(f'"{f}"', f'"app/{f}?v={v}"')
    h = re.sub(r'src="\.\./\.\./web/data/([^"?]+)"', lambda m: f'src="data/{m.group(1)}?v={v}"', h)
    h = h.replace("../../web/data/", "data/").replace("../../web/raptor_engine.js", "raptor_engine.js")
    h = h.replace("<title>Maquette · Une journée sous canicule</title>", "<title>Une journée sous canicule · Réseau sous canicule</title>")
    reste = re.findall(r'(?:src|href)="(\.\./[^"]+)"', h)
    assert not reste, reste
    ecrire(os.path.join(WEB, "index.html"), h)
    print("web/index.html et web/app/ publiés depuis design/maquette/")


if __name__ == "__main__":
    archiver_prototype()
    publier()
