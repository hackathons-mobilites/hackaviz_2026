# data/processed

Tables intermédiaires produites par `scripts/` à partir de `data/raw/`. Non versionnées, entièrement reproductibles.

| Fichier | Produit par | Contenu |
|---|---|---|
| `stops.parquet` | `02_build.py` | une ligne par zone d'arrêt : position, commune, IRIS, aléa, lieu frais, fréquence, climatisation, revenus |
| `per_line.parquet` | `02_build.py` | courses par zone d'arrêt et par ligne |
| `filo.parquet`, `frais.parquet` | `02_build.py` | carreaux Filosofi et lieux frais préparés |
| `volet2.json` | `03_volet2.py` | vigilance, météo et indices de fréquentation par jour |
| `flow.parquet` | `03_volet2.py` | fréquentation estimée par zone d'arrêt |
| `graph.npz` | `06_graph.py` | graphe de transport à fréquences |
| `od.npz` | `07_access.py` | matrice origine-destination régionale |
