# L'aide du site (« Aide »)

Page d'aide complète : le bouton **Aide** de la barre du haut ouvre, par catégories, une entrée pour chaque fonction du site : à quoi elle sert, comment faire, ce qu'il faut savoir, et une capture.

Le nom « Aide » a été préféré à « Guide » : sur ce site, « guide » désigne déjà l'étoile-guide et la visite guidée.

## Où sont les choses

| Fichier | Rôle |
|---|---|
| `frontend/src/components/guide/guide.manifest.ts` | **Source unique** : catégories, entrées, textes, scénarios et sélecteurs des captures, couverture des fonctions |
| `frontend/src/components/guide/GuideDialog.tsx`, `guide.css` | Affichage (dialogue plein écran, sommaire, recherche) |
| `frontend/src/components/guide/GuideButton.tsx` | Seul point d'entrée, posé dans la barre du haut |
| `frontend/scripts/capture-guide.mjs` | Produit les captures |
| `frontend/public/assets/guide/*.webp` | Les captures |
| `frontend/src/components/guide/guide.captures.ts` | Dimensions des captures (généré, ne pas modifier) |
| `frontend/src/components/guide/guide.manifest.test.ts` | Contrôle du manifeste, des captures et de la couverture |

## Règle de mise à jour

**Toute fonction ajoutée ou modifiée met à jour l'aide dans la même tâche** : entrée dans `guide.manifest.ts`, puis `node scripts/capture-guide.mjs` (sous le verrou de build), captures commitées avec le reste.

Rien ne dépend de la mémoire de chacun :

- `capture-guide.mjs` **échoue sans rien écrire** si un sélecteur du manifeste n'existe plus ;
- `guide.manifest.test.ts` **échoue** si une capture manque ou est orpheline, ou si le code contient une fonction que le manifeste ne couvre pas : composant de la barre du haut ou de l'application, pli du panneau de preuve, cellule de la barre du scénario, onglet de « Derrière notre étoile », moyen de transport, commande de la visite, paramètre d'un lien partagé, touche du clavier.

Pour une nouvelle fonction : ajouter son entrée, compléter `GUIDE_COVERAGE`, lancer la capture.

## Après la publication d'un nouveau calcul

Les captures contiennent des temps et des postes : **les relancer après chaque publication** (`cd frontend && node scripts/capture-guide.mjs`). Les textes ne contiennent aucun chiffre de transport : ils ne changent pas, et un test l'impose (`\d` interdit dans les textes du manifeste).

## Règles du texte (vérifiées par le test)

Jamais de tiret cadratin ni demi-cadratin ; aucun chiffre ; jamais d'« offres d'emploi » ; aucune source citée en dehors de l'entrée « Mode sources » (D-033). Vocabulaire : « postes salariés recensés par l'INSEE », court « postes salariés (INSEE) » (D-065 : seule mention de l'INSEE permise hors de l'entrée « Mode sources »).

Règle d'affichage D-064 (11/11) : sans le mode sources, l'écran ne garde que la valeur, l'unité, le verdict et les courtes réserves ; le reste est dans un « i », écrit en clair avec `&src=1`. Une entrée qui cite une précision dit donc dans quel « i » elle se trouve (par son nom accessible, par exemple « Portée de cette statistique ») ; l'entrée « Mode sources » explique les deux lectures.

## Lancer les captures

```bash
cd frontend
node scripts/capture-guide.mjs                  # démarre vite sur le port 4393, l'arrête par son PID
node scripts/capture-guide.mjs --url http://localhost:5173   # serveur déjà lancé
node scripts/capture-guide.mjs --only comparer,liste         # seulement ces captures
node scripts/capture-guide.mjs --partial                     # mise au point : écrit ce qui a réussi, code de sortie 1 s'il reste un échec
```

Le script utilise le Playwright de `tools/record-tour` (comme `smoke.mjs`), en mouvement réduit et avec une fenêtre neuve pour chaque capture. Le webp est encodé par le navigateur : aucune dépendance ajoutée. Une ligne du manifeste règle chaque capture : adresse du scénario, étapes (cliquer, remplir, ouvrir un pli), éléments montrés, éléments mis en valeur.

## Accessibilité

Dialogue modal avec nom accessible, focus initial sur la croix et rendu à la fermeture, Tab bouclé, Échap (vide d'abord la recherche), recherche annoncée par une zone `status`, images avec texte alternatif, cibles d'au moins 24 px, lisible de 390 à 1920 px. Le reste de la page est `inert` tant que l'aide est ouverte ; aucune touche ne part vers le site.
