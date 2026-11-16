# Captures de la mosaïque des projets

Ce dossier contient les **sources originales** des captures utilisées dans la vue mosaïque de découverte et de coups de cœur.

## Principe

- un dossier par projet : `equipe-XX-nom-du-projet/` ;
- les fichiers peuvent être des `.png`, `.jpg` ou `.webp` ;
- c’est le fichier `manifest.json` qui décide quelles captures sont affichées, dans quel ordre, pour quel projet et avec quel cadrage.

Le dossier `Resultats/assets/home-mosaic/` ne contient que les versions optimisées générées.

## Ajouter ou remplacer une capture

1. Déposer la capture dans le dossier du projet.
2. Ajouter une entrée dans `manifest.json` :

```json
{
  "teamNum": 17,
  "slug": "equipe-17-thermoviz",
  "src": "01-rapport.png",
  "alt": "Thermo Réseau — vue d’ensemble du rapport",
  "focus": "center"
}
```

3. Lancer la génération (nécessite Pillow) :

```bash
cd /home/onyxia/work/hackaviz_2026
python3 -m pip install --user pillow   # si nécessaire
python3 scripts/build_home_mosaic.py
```

Le script :

- recadre les images en 600 × 390 ;
- les convertit en WebP optimisé ;
- écrit les fichiers dans `Resultats/assets/home-mosaic/<slug>/` ;
- régénère `Resultats/assets/home-mosaic/manifest.json`, lu par la page.

## Cadrages acceptés

`focus` : `center`, `left`, `right`, `top`, `bottom`.

## GIF et vidéos

Une entrée peut pointer vers un GIF ou une vidéo :

```json
{
  "teamNum": 10,
  "slug": "equipe-10-tamoviz",
  "src": "demo.mp4",
  "type": "video",
  "poster": "equipe-10-tamoviz/poster.webp",
  "alt": "Tamoviz — démonstration animée",
  "focus": "center"
}
```

- `type` accepte `video` ou `gif` ; il est aussi déduit de l’extension.
- Les vidéos sont copiées telles quelles et lues en boucle, sans son.
- `poster` est optionnel et doit pointer vers une image déjà présente dans `Resultats/assets/home-mosaic/`.
- Un GIF est affiché comme une image animée.

## Répéter un projet

C’est autorisé et prévu : ajoute simplement plusieurs entrées avec le même `teamNum` et des `src` différents. Chaque tuile garde son propre texte alternatif et sa propre cible.

## État actuel

Les images actuellement présentes dans `Resultats/assets/home-mosaic/` sont des **placeholders** générés à partir de captures existantes. Elles sont destinées à être remplacées par les captures que tu sélectionneras.
