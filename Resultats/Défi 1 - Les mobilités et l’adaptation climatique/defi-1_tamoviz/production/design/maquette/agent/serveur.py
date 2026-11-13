"""Serveur local de la maquette : sert les fichiers du projet et répond au guide avec un agent du Claude Agent SDK.

Usage (depuis la racine du projet) :
    python design/maquette/agent/serveur.py            # http://localhost:8781/design/maquette/

L'agent n'a accès qu'aux outils définis ici : lire les données du site et piloter l'interface.
Ni fichiers, ni shell, ni web ; les réglages personnels de Claude Code ne sont pas chargés.
Authentification : celle de Claude Code sur ce poste (claude login) ; plus tard, une clé API."""
import asyncio
import json
import os
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ResultMessage, TextBlock, create_sdk_mcp_server, query, tool)

sys.path.insert(0, os.path.dirname(__file__))
from donnees import RACINE, Donnees  # noqa: E402

PORT = int(os.environ.get("PORT", "8781"))
MODELE = os.environ.get("GUIDE_MODELE", "claude-opus-5-5")
D = Donnees()
print(f"données chargées en {D.duree} s ({len(D.zones)} zones)", flush=True)

SYSTEME = """Tu es le guide du site « Réseau sous canicule » (Hackaviz IDFM 2026, défi 1 : chaleur et transports en commun en Île-de-France).
Le site est un bureau de fenêtres. Trois écrans :
- « mesures » : carte de la dose de chaleur des navetteurs (cercles illustratifs dans la maquette), organigramme de méthode, graphique « Quelle mesure protège le mieux ? » comparant trois mesures simulées avec MATSim (bus climatisés, renfort de fréquence, horaires décalés) à la canicule sans mesure.
- « simulation » : animation de la simulation multi-agents MATSim entre 6 h 30 et 9 h 30 (véhicules par mode, voyageurs qui attendent dehors, marchent ou pédalent), journée ordinaire ou vigilance rouge, avec les heures de départ, le télétravail par groupe et les limites du calage.
- « cartogramme » : communes ou IRIS déformés selon un poids (validations d’un jour ordinaire ou du jour choisi, habitants, habitants exposés), colorés selon un indicateur (part d’habitants exposés, score moyen des arrêts, écart de voyageurs pendant la semaine rouge du 22 au 26 juin 2026).

Ta façon de répondre :
- En français correct, avec la typographie française (apostrophe ’, espace insécable avant : ; ? ! et %, guillemets « », virgule décimale). Pas d’émoji, pas de titres, pas de listes à puces.
- Juste ce qu’il faut : deux phrases, 35 à 50 mots, en langage courant. La première répond à la question ; la seconde donne le chiffre qui le prouve et, seulement s’il change la lecture, un élément de comparaison. Jamais de réponse vague ni de remplissage ; ne raconte pas comment tu as cherché ni ce que tu n’as pas vérifié.
- Rapide : appelle le moins d’outils possible ; pour les IRIS d’une commune ou les communes d’un département, utilise classer_zones avec le filtre commune ou departement.
- Toujours avec des chiffres tirés des outils de données, jamais inventés. Si une donnée n’existe pas, dis-le simplement.
- Toujours en montrant : utilise les outils d’interface pour régler l’écran, entourer ou zoomer sur la zone dont tu parles, mettre en avant la fenêtre concernée. Un exemple concret (une commune, un IRIS) vaut mieux qu’une définition.
- Termine en appelant « suggerer » avec deux ou trois questions de suite utiles, courtes.
- « Exposé » : un habitant qui dépend d’un arrêt cumulant au moins trois des six fragilités (faible fréquence, bus non climatisés, îlot de chaleur, loin d’un lieu frais, revenus bas, non accessible).
- La dose de chaleur : minutes passées dehors (marche, attente en surface) × chaleur de l’heure × aléa d’îlot de chaleur du lieu ; le métro souterrain ne compte pas.
- Sur l’écran « mesures », la carte est illustrative : ne commente pas ses cercles un par un.
- Les outils regler_cartogramme, entourer_zone et carte_reelle agissent sur l’écran « cartogramme » ; choisir_scenario, choisir_indicateur et souligner_mesure sur l’écran « mesures ». animation agit sur l’écran « simulation » ; lancer_trajet sur l’écran « trajet ». Si l’écran affiché n’est pas le bon, appelle d’abord changer_ecran, puis ces outils : ils s’exécuteront sur le nouvel écran."""

# ---------- outils ----------
def ok(obj):
    return {"content": [{"type": "text", "text": json.dumps(obj, ensure_ascii=False)}]}


def outils(actions, ecran):
    def act(nom, args):
        actions.append({"outil": nom, "args": args})
        return ok({"fait": nom})

    @tool("chercher_zone", "Cherche une commune ou un IRIS par son nom (ou une partie du nom) et renvoie ses chiffres : habitants, habitants exposés et leur part, arrêts, validations d’un jour ordinaire, score moyen des arrêts sur 6, écart de voyageurs pendant la semaine rouge, centre (lat, lon) et code.",
          {"type": "object", "properties": {"nom": {"type": "string"}, "unite": {"type": "string", "enum": ["commune", "IRIS"]}}, "required": ["nom"]})
    async def chercher_zone(a):
        return ok(D.chercher(a["nom"], a.get("unite")) or {"resultat": "aucune zone de ce nom"})

    @tool("classer_zones", "Classe les communes ou les IRIS selon un indicateur et renvoie les premières avec leurs chiffres. Filtres : commune (nom, pour les IRIS d’une commune), departement (75, 77, 78, 91, 92, 93, 94, 95), habitants_min pour écarter les très petites zones.",
          {"type": "object", "properties": {
              "indicateur": {"type": "string", "enum": ["validations", "habitants", "habitants_exposes", "part_exposes", "score", "semaine_rouge"]},
              "unite": {"type": "string", "enum": ["commune", "IRIS"]}, "ordre": {"type": "string", "enum": ["decroissant", "croissant"]},
              "n": {"type": "integer"}, "habitants_min": {"type": "integer"}, "commune": {"type": "string"}, "departement": {"type": "string"}}, "required": ["indicateur", "unite"]})
    async def classer_zones(a):
        return ok(D.classer(a["indicateur"], a["unite"], a.get("ordre", "decroissant"), a.get("n", 10), a.get("habitants_min", 0), a.get("commune"), a.get("departement")))

    @tool("resultats_mesures", "Résultats de la simulation MATSim des trois mesures un jour de vigilance rouge : navetteurs revenus en transport en commun, montées, écart de dose de chaleur totale, dose moyenne par catégorie sociale.", {})
    async def resultats_mesures(a):
        return ok(D.mesures)

    @tool("resultats_simulation", "Résultats de la simulation MATSim, journée ordinaire contre vigilance rouge : navetteurs, montées, télétravail par groupe, départs par quart d’heure à partir de 5 h, indices simulés contre observés par réseau, inégalité de la dose de chaleur.", {})
    async def resultats_simulation(a):
        return ok(D.simulation)

    @tool("lire_methode", "Texte de la méthodologie du projet (sources, calculs, hypothèses, limites).", {})
    async def lire_methode(a):
        return ok({"methodologie": D.methode})

    @tool("zoomer_carte", "Centre la carte sur un point (lat, lon) avec un niveau de zoom (9 = région, 12 = commune, 14 = quartier).",
          {"type": "object", "properties": {"lat": {"type": "number"}, "lon": {"type": "number"}, "zoom": {"type": "number"}}, "required": ["lat", "lon"]})
    async def zoomer_carte(a):
        return act("zoomer_carte", a)

    @tool("mettre_en_avant", "Met en avant une partie de l’écran en assombrissant le reste. Cibles : carte, legende, methode, graphique, resultat, reglages, recit ; sur l’écran simulation aussi compteurs (voyageurs dehors à l’heure affichée), histogramme, parametres (utilités de MATSim), limites (calage).",
          {"type": "object", "properties": {"cible": {"type": "string", "enum": ["carte", "legende", "methode", "graphique", "resultat", "reglages", "recit", "compteurs", "histogramme", "parametres", "limites"]}}, "required": ["cible"]})
    async def mettre_en_avant(a):
        return act("mettre_en_avant", a)

    @tool("agrandir_fenetre", "Agrandit une fenêtre sur tout le bureau : carte, methode, resultat, reglages.",
          {"type": "object", "properties": {"fenetre": {"type": "string", "enum": ["carte", "methode", "resultat", "reglages"]}}, "required": ["fenetre"]})
    async def agrandir_fenetre(a):
        return act("agrandir_fenetre", a)

    @tool("changer_ecran", "Ouvre un autre écran du site : mesures, cartogramme, simulation ou trajet (la journée de Nadia). La réponse s’affiche après le changement.",
          {"type": "object", "properties": {"ecran": {"type": "string", "enum": ["mesures", "cartogramme", "simulation", "trajet"]}}, "required": ["ecran"]})
    async def changer_ecran(a):
        return act("changer_ecran", a)

    @tool("suggerer", "Propose deux ou trois courtes questions de suite, affichées comme boutons sous la réponse.",
          {"type": "object", "properties": {"questions": {"type": "array", "items": {"type": "string"}}}, "required": ["questions"]})
    async def suggerer(a):
        return act("suggerer", a)

    @tool("animation", "Règle l’animation de l’écran simulation : journee (ordinaire ou canicule), heure (« 07:45 », entre 06:30 et 09:30), lecture (true pour lancer, false pour arrêter), bus_non_climatises (true pour faire ressortir en rouge les bus non climatisés), vue : « agents » (chaque voyageur simulé : attente dehors, marche, vélo, à bord) ou « difference » (hexagones de 1 km : où il y a moins ou plus de voyageurs dehors en vigilance rouge qu’une journée ordinaire ; les plus fortes baisses et hausses sont nommées dans l’état de l’écran)",
          {"type": "object", "properties": {"journee": {"type": "string", "enum": ["ordinaire", "canicule"]}, "heure": {"type": "string"}, "lecture": {"type": "boolean"}, "bus_non_climatises": {"type": "boolean"}, "vue": {"type": "string", "enum": ["agents", "difference"]}}})
    async def animation(a):
        return act("animation", a)

    @tool("lancer_trajet", "Écran trajet (la journée de Nadia) : calcule et rejoue un trajet du 25 juin 2026 sur les horaires réels. depart et arrivee : nom de commune ou de gare (par défaut Cergy et Créteil, le trajet de Nadia) ; heure : « 07:30 », entre 06:30 et 09:30 ; profil : actif, senior ou poussette. L’état de l’écran donne ensuite les étapes, la dose de chaleur et les minutes dehors.",
          {"type": "object", "properties": {"depart": {"type": "string"}, "arrivee": {"type": "string"}, "heure": {"type": "string"}, "profil": {"type": "string", "enum": ["actif", "senior", "poussette"]}}})
    async def lancer_trajet(a):
        return act("lancer_trajet", a)

    commun = [lancer_trajet, chercher_zone, classer_zones, resultats_mesures, resultats_simulation, lire_methode, animation, zoomer_carte, mettre_en_avant, agrandir_fenetre, changer_ecran, suggerer]
    if True:  # tous les outils, quel que soit l'écran : ceux de l'autre écran s'exécutent après changer_ecran
        @tool("regler_cartogramme", "Change les réglages du cartogramme. unite : commune ou IRIS ; contour : libre ou fixe ; echelle : proportionnelle ou logarithmique ; poids (taille des zones) : vref (validations d’un jour ordinaire), vday (validations du jour choisi, communes et contour libre seulement), pop (habitants), expo (habitants exposés) ; couleur : expo (part d’exposés), score, red (semaine rouge) ; jour : 2026-06-16, 2026-06-19, 2026-06-22, 2026-06-25 ou 2026-06-28.",
              {"type": "object", "properties": {"unite": {"type": "string", "enum": ["commune", "IRIS"]}, "contour": {"type": "string", "enum": ["libre", "fixe"]},
                                                "echelle": {"type": "string", "enum": ["proportionnelle", "logarithmique"]}, "poids": {"type": "string", "enum": ["vref", "vday", "pop", "expo"]},
                                                "couleur": {"type": "string", "enum": ["expo", "score", "red"]}, "jour": {"type": "string"}}})
        async def regler_cartogramme(a):
            return act("regler_cartogramme", a)

        @tool("entourer_zone", "Entoure une commune ou un IRIS sur le cartogramme et zoome dessus. Le code vient de chercher_zone ou classer_zones ; l’unité affichée doit correspondre (régler unite avant si besoin).",
              {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]})
        async def entourer_zone(a):
            return act("entourer_zone", a)

        @tool("carte_reelle", "Passe du cartogramme à la carte réelle (deforme=false) ou l’inverse (deforme=true).",
              {"type": "object", "properties": {"deforme": {"type": "boolean"}}, "required": ["deforme"]})
        async def carte_reelle(a):
            return act("carte_reelle", a)
        carto = [regler_cartogramme, entourer_zone, carte_reelle]

    @tool("choisir_scenario", "Choisit le scénario affiché : Ordinaire, Canicule, Bus climatisés, Fréquence, Horaires décalés.",
          {"type": "object", "properties": {"nom": {"type": "string", "enum": ["Ordinaire", "Canicule", "Bus climatisés", "Fréquence", "Horaires décalés"]}}, "required": ["nom"]})
    async def choisir_scenario(a):
        return act("choisir_scenario", a)

    @tool("choisir_indicateur", "Choisit l’indicateur du graphique des mesures : dose (dose de chaleur totale) ou nav (navetteurs en transport en commun).",
          {"type": "object", "properties": {"indicateur": {"type": "string", "enum": ["dose", "nav"]}}, "required": ["indicateur"]})
    async def choisir_indicateur(a):
        return act("choisir_indicateur", a)

    @tool("souligner_mesure", "Souligne une mesure dans le graphique (les autres s’estompent) : Horaires décalés, Fréquence, Bus climatisés.",
          {"type": "object", "properties": {"mesure": {"type": "string", "enum": ["Horaires décalés", "Fréquence", "Bus climatisés"]}}, "required": ["mesure"]})
    async def souligner_mesure(a):
        return act("souligner_mesure", a)
    return commun + carto + [choisir_scenario, choisir_indicateur, souligner_mesure]


async def demander(question, ecran, etat, session):
    actions = []
    serveur = create_sdk_mcp_server("ihm", tools=outils(actions, ecran))
    noms = [f"mcp__ihm__{t.name}" for t in outils([], ecran)]
    options = ClaudeAgentOptions(
        system_prompt=SYSTEME, model=MODELE, effort="low",
        mcp_servers={"ihm": serveur}, tools=[], allowed_tools=noms, strict_mcp_config=True,
        setting_sources=[], permission_mode="dontAsk", max_turns=12, cwd=RACINE,
        resume=session or None)
    prompt = f"[Écran affiché : {ecran}. État : {json.dumps(etat, ensure_ascii=False)}]\n\n{question}"
    texte, sid, erreur = [], session, None
    async for m in query(prompt=prompt, options=options):
        if isinstance(m, AssistantMessage):
            texte += [b.text for b in m.content if isinstance(b, TextBlock)]
        elif isinstance(m, ResultMessage):
            sid = m.session_id
            if m.is_error:
                erreur = m.result or m.subtype
            elif m.result:
                texte = [m.result]
    sugg = next((a["args"].get("questions", []) for a in reversed(actions) if a["outil"] == "suggerer"), [])
    return {"texte": "\n".join(t for t in texte if t.strip()).strip(), "actions": [a for a in actions if a["outil"] != "suggerer"],
            "suggestions": sugg[:3], "session": sid, "erreur": erreur}


class Gestionnaire(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if args and "/api/" in str(args[0]):
            sys.stderr.write(time.strftime("%H:%M:%S ") + (fmt % args) + "\n")

    def envoyer(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith("/api/ping"):
            return self.envoyer(200, {"ok": True, "modele": MODELE})
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/guide"):
            return self.envoyer(404, {"erreur": "inconnu"})
        try:
            corps = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
            t0 = time.time()
            r = asyncio.run(demander(str(corps.get("question", ""))[:600], corps.get("ecran", "mesures"), corps.get("etat", {}), corps.get("session")))
            r["duree_s"] = round(time.time() - t0, 1)
            print(f"guide : {r['duree_s']} s, {len(r['actions'])} actions", flush=True)
            self.envoyer(200, r)
        except Exception as e:  # le navigateur retombe sur les questions préparées
            print("erreur guide :", repr(e), flush=True)
            self.envoyer(500, {"erreur": str(e)})


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Gestionnaire, directory=RACINE))
    print(f"maquette : http://localhost:{PORT}/design/maquette/  (modèle {MODELE})", flush=True)
    srv.serve_forever()
