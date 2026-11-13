# Observatoire des fractures et inégalités ferroviaires en Île-de-France

**Équipe :** Team Datalab - LE HUEROU KERISEL Robin, BIENVENU Samuel, RICOT Jean-Bastien, LAHAYE Emma, LEBRUN Justine, LEBRUN Justine, DELBREIL Elisa

**Mail(s) de contact :** robin.lehuerou-kerisel@sncf.fr, samuel.bienvenu@sncf.fr, jean-bastien.ricot@sncf.fr, emma.lahaye@sncf.fr, justine.lebrun@sncf.fr, elisa.delbreil@sncf.fr

**Défi :** Défi 4 - Les mobilités et les inégalités

## Notre question

Comment identifier les inégalités territoriales d'accès au réseau ferroviaire francilien et repérer les territoires où la fréquentation observée est faible, attendue ou particulièrement forte pour un niveau de desserte comparable ?

## Notre visualisation

La production est une application Streamlit interactive disponible dans le dossier [`production/`](production/). Elle affiche une carte à bascule entre :

- un indice composite d'accessibilité ferroviaire ;
- les validations ferroviaires quotidiennes moyennes de 2025 pour 1 000 habitants.

Une fiche diagnostic territoriale permet de mettre en regard population, gares, offre, fiabilité, accessibilité et fréquentation. Le code source est fourni afin de lancer l'application localement :

```powershell
cd production
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run Codes/app.py
```

Documentation technique complète : [`docs/README_TECHNIQUE.md`](docs/README_TECHNIQUE.md).

## Les données utilisées

Les fichiers de données ne sont pas inclus dans le dépôt et le dossier `production/Données/` est ignoré par Git. Téléchargez-les depuis les liens ci-dessous, puis placez-les dans ce dossier avant de lancer l'application. Les validations trimestrielles doivent être placées dans `production/Données/Validations/`.

| Source | Jeu de données | Lien |
|---|---|---|
| Île-de-France Mobilités | Traces des lignes de transport en commun | [Jeu de données IDFM](https://data.iledefrance-mobilites.fr/explore/dataset/traces-des-lignes-de-transport-en-commun-idfm/) |
| Île-de-France Mobilités | Emplacement des gares en Île-de-France | [Jeu de données IDFM](https://data.iledefrance-mobilites.fr/explore/dataset/emplacement-des-gares-idf/) |
| Île-de-France Mobilités | Validations ferroviaires 2025 par arrêt | [Catalogue IDFM : validations ferroviaires](https://data.iledefrance-mobilites.fr/explore/?q=validations%20ferroviaires) |
| Île-de-France Mobilités | Offre théorique et indicateurs de réalisation ferroviaire | [Catalogue IDFM : offre ferroviaire](https://data.iledefrance-mobilites.fr/explore/?q=offre%20ferroviaire) |
| INSEE | Populations communales et découpages administratifs | [API Geo du gouvernement](https://geo.api.gouv.fr/departements/75/communes?fields=nom%2Ccode%2Cpopulation%2Ccontour&format=geojson&geometry=contour) |

## Les outils employés

- Python 3
- Streamlit
- Pandas et NumPy
- GeoPandas
- Plotly
- OpenPyXL
- R, utilisé pour l'exploration initiale du rapprochement entre validations et territoires

## Licence

Le code source de la production est publié sous licence [MIT](production/LICENSE).

Les contenus textuels et visuels sont publiés sous licence [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). Les données restent soumises aux licences et conditions de réutilisation de leurs producteurs respectifs.
