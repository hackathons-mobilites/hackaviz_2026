# Règles du projet

Ces règles valent pour toute personne et tout agent IA qui modifie le dépôt. Elles passent avant les habitudes de chacun et avant les réglages par défaut des outils.

## 1. Git et commits

1. **Jamais de coautorité attribuée à une IA.** Aucun commit, aucune pull request ne contient de ligne `Co-Authored-By` désignant Claude, Anthropic, ChatGPT, Copilot ou un autre assistant, ni de mention « Generated with … ». L'auteur d'un commit est la personne qui le signe. Le crochet `.githooks/commit-msg` refuse ces commits ; il s'active une fois par clone :

   ```bash
   git config core.hooksPath .githooks
   ```

2. **Un commit = un changement compréhensible.** Message en français, à l'impératif, première ligne de 72 caractères au plus, préfixée par la zone touchée :

   | Préfixe | Zone |
   |---|---|
   | `donnees:` | scripts 01 à 04, sources |
   | `analyse:` | scripts 05 à 10, 15, 16 |
   | `matsim:` | scripts 11 à 14, `matsim/` |
   | `site:` | `web/` |
   | `design:` | `DESIGN.md`, `design/` |
   | `docs:` | `README.md`, `REGLES.md`, `docs/` |

   Exemple : `site: retirer la consigne de rechargement de l'étape Mesures`.

3. **Branche principale `main`, toujours fonctionnelle.** Le travail en cours se fait sur une branche (`site/trajet-iris`, `matsim/recalage-bus`) puis se fusionne quand le site s'ouvre sans erreur.
4. **On ne réécrit pas l'historique partagé** (`push --force` interdit sur `main`).
5. **On ne versionne ni données brutes, ni sorties MATSim, ni secrets** (voir `.gitignore`). Aucun fichier de plus de 50 Mo.

## 2. Langue et écriture

1. **Site, documentation, commentaires et messages de commit : en français**, avec une orthographe soignée (accents, cédilles, majuscules accentuées : « À », « É »).
2. Typographie française dans le site : espace insécable avant `: ; ? !` et `%`, guillemets « », apostrophe ’, virgule décimale.
3. Les textes destinés à l'utilisateur disent ce que montre la donnée, en langage courant. Le vocabulaire technique (élasticité, intervalle de confiance, logit) va dans les onglets « Méthode » ou « Limites ».
4. **Aucun texte ne déborde de son conteneur**, dans le site comme dans une présentation : on raccourcit ou on change la mise en page, on ne réduit pas la police sous les tailles du design system.

## 3. Données

1. **`data/raw/` n'est jamais modifié à la main.** Tout ce qui y entre vient de `scripts/01_download.py` ou d'un téléchargement manuel documenté dans `docs/sources.md` (URL, date, licence).
2. Toute transformation passe par un script numéroté de `scripts/`. Pas de fichier intermédiaire produit à la main ou dans un notebook non versionné.
3. Chaque script dit dans sa docstring ce qu'il lit et ce qu'il écrit.
4. Chaque chiffre affiché dans le site a une source, une unité et une période.
5. Pas de donnée personnelle : le récit « Votre trajet » travaille à l'échelle de la commune ou de l'IRIS, jamais d'une adresse.
6. Une hypothèse de modélisation (paramètre MATSim, seuil, coefficient) est écrite dans `docs/methodologie.md` avec sa justification.

## 4. Code

1. **Aucune icône ni émoji** dans le code, les `print` et les journaux des scripts.
2. Les scripts se lancent depuis la racine du projet avec des chemins relatifs (`data/raw/`, `web/data/`).
3. Un script peut être relancé sans effet de bord : il recrée ses sorties, il ne les complète pas.
4. Le site reste statique : HTML, CSS et JavaScript sans étape de build, bibliothèques chargées depuis cdnjs avec une version exacte.
5. Interface : toutes les valeurs visuelles viennent de `design/tokens.css` et suivent [`DESIGN.md`](DESIGN.md).
6. **Le site ne demande jamais à l'utilisateur de lancer, recharger ou attendre quoi que ce soit.** Une étape affiche ce qui existe ; si un résultat manque, il n'apparaît pas.
7. **Chaque écran tient sur un seul écran, sans défilement vertical.** Sur un petit écran, le bureau est réduit à l'échelle ; on ne le fait jamais défiler.

## 5. Avant chaque commit sur `main`

- [ ] `python -m http.server 8765 -d web` : le site s'ouvre, aucune erreur dans la console.
- [ ] Les étapes modifiées ont été parcourues à 1 280 px et à 375 px de large.
- [ ] Les scripts modifiés ont été relancés et leurs sorties dans `web/data/` sont à jour.
- [ ] Orthographe relue.
- [ ] Le message de commit respecte la règle 1.2 et ne contient aucune coautorité d'IA.
