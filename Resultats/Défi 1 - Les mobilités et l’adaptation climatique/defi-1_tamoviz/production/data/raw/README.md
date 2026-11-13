# data/raw

Sources telles qu'elles ont été téléchargées. **Ce dossier n'est jamais modifié à la main** et n'est pas versionné (≈ 1,6 Go).

Pour le remplir :

```bash
python scripts/01_download.py
```

Trois sources se téléchargent à la main une fois (GTFS IDFM, MOBPRO et MOBSCO 2021 de l'Insee) : voir `docs/sources.md`. Un fichier déjà présent n'est pas retéléchargé ; le supprimer pour le rafraîchir.

La liste complète des fichiers attendus, avec leur producteur et leur licence, est dans `docs/sources.md`.
