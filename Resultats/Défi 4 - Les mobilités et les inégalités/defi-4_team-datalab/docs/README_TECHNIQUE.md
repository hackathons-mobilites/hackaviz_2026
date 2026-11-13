# Observatoire des fractures et inégalités ferroviaires en Île-de-France

Application cartographique qui compare l'accessibilité ferroviaire et la fréquentation réelle du réseau dans les communes et arrondissements franciliens. Elle permet d'identifier les territoires enclavés, les réseaux très sollicités et les potentiels de fréquentation à explorer.

## Présentation du projet

Ce projet a été développé dans le cadre du **Hackaviz Mobilités 2026 spécial dataviz**, organisé par Île-de-France Mobilités du 2 au 26 novembre 2026. Pour en savoir plus, consulter le [guide des participants et participantes](https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/README.md).

### Le problème et la proposition de valeur

L'accès au réseau ferroviaire francilien est inégal selon les territoires. Les indicateurs d'offre seuls ne suffisent pas à comprendre l'usage réel du réseau : une desserte peut être disponible mais peu utilisée, tandis qu'un réseau moins accessible peut être très sollicité.

Le projet s'adresse aux collectivités, équipes d'Île-de-France Mobilités, associations, décideurs publics et citoyens souhaitant objectiver les inégalités territoriales de mobilité.

L'observatoire apporte une lecture simple et territorialisée de deux questions complémentaires :

- Où l'accès au réseau ferré est-il insuffisant ?
- Où la fréquentation observée est-elle faible, attendue ou particulièrement forte pour un niveau d'accessibilité comparable ?

### La solution

La solution est une application Streamlit composée d'une carte interactive et d'une fiche diagnostic territoriale toujours visible.

La carte peut basculer entre deux indicateurs :

- **Indice composite d'accessibilité ferroviaire**, sur une échelle de 0 à 100.
- **Validations ferroviaires quotidiennes moyennes en 2025 pour 1 000 habitants**, afin de comparer les territoires indépendamment de leur taille démographique.

Les traces du réseau de train, RER, métro, tramway et câble/funiculaire sont affichées sur les deux vues et peuvent être filtrées par mode. Une commune ou un arrondissement peut être sélectionné par clic ou au clavier. La fiche restitue alors la population, le nombre de gares, l'offre en pointe, la fiabilité, les lignes, les arrêts, l'indice et les validations.

Un insight compare le nombre de validations pour 1 000 habitants à la médiane des 15 territoires ayant l'indice d'accessibilité le plus proche :

- une fréquentation inférieure peut révéler un potentiel de captation à explorer ;
- une fréquentation proche indique un niveau d'usage cohérent ;
- une fréquentation supérieure signale un réseau particulièrement sollicité.

Les données mobilisées sont :

- les limites administratives des communes et arrondissements ;
- l'emplacement des gares et stations ;
- les traces des lignes de transport collectif ;
- l'offre théorique en heure de pointe et les données de réalisation ;
- les validations ferroviaires trimestrielles de 2025 ;
- les populations communales de l'INSEE.

L'indice d'accessibilité agrège quatre rangs percentiles calculés parmi les territoires disposant d'au moins une gare : nombre de gares, offre en pointe, robustesse de la desserte et fiabilité opérationnelle. Une commune sans gare reçoit un indice nul.

La fréquentation est obtenue en additionnant les validations par arrêt et par jour, tous titres de transport confondus. La moyenne quotidienne est ensuite rattachée spatialement à chaque commune ou arrondissement et normalisée par sa population :

$$\text{Validations pour 1 000 habitants} = \frac{\text{Validations quotidiennes moyennes}}{\text{Population}} \times 1\,000$$

### Les problèmes surmontés et les enjeux en matière de données

Les données de validations sont livrées en quatre fichiers trimestriels et avec des structures de dates différentes. L'application harmonise ces fichiers, agrège les titres de transport par arrêt et par jour, puis calcule une moyenne quotidienne annuelle.

Le rattachement des validations aux territoires constitue également un enjeu : les validations sont localisées au niveau des gares, alors que l'analyse est communale. Les coordonnées des gares sont donc jointes spatialement aux polygones des communes et des arrondissements. Une gare proche d'une limite administrative est rattachée au territoire contenant son point géographique.

Les données ouvertes seraient encore plus faciles à exploiter avec :

- un fichier annuel consolidé des validations ferroviaires ;
- des identifiants d'arrêt stables et documentés entre les jeux de données ;
- une documentation commune entre validations, gares et zones de correspondance ;
- des indicateurs d'accessibilité multimodale incluant marche, vélo, bus, accessibilité PMR et correspondances.

### Et la suite ?

Avec plus de temps, le projet pourrait évoluer vers :

- une analyse des évolutions mensuelles et saisonnières de la fréquentation ;
- l'intégration des pôles d'emploi, établissements scolaires et lieux touristiques pour contextualiser les flux ;
- une mesure d'accessibilité porte-à-porte incluant la marche, le vélo, les bus et les correspondances ;
- des scénarios d'amélioration de desserte et une estimation de leur impact potentiel ;
- une comparaison avant et après mise en service de nouvelles lignes ou gares ;
- la publication d'une API ou d'un export géographique réutilisable par les collectivités.

## Installation et utilisation

Prérequis : Python 3.10 ou plus récent.

Les fichiers de données ne sont pas inclus dans le dépôt : le dossier `production/Données/` est ignoré par Git. Téléchargez-les puis placez-les dans ce dossier avant de lancer l'application ; les validations trimestrielles doivent être placées dans `production/Données/Validations/`.

| Jeu de données | Lien |
|---|---|
| Traces des lignes de transport en commun | [Jeu de données IDFM](https://data.iledefrance-mobilites.fr/explore/dataset/traces-des-lignes-de-transport-en-commun-idfm/) |
| Emplacement des gares en Île-de-France | [Jeu de données IDFM](https://data.iledefrance-mobilites.fr/explore/dataset/emplacement-des-gares-idf/) |
| Validations ferroviaires 2025 par arrêt | [Catalogue IDFM : validations ferroviaires](https://data.iledefrance-mobilites.fr/explore/?q=validations%20ferroviaires) |
| Offre théorique et indicateurs de réalisation ferroviaire | [Catalogue IDFM : offre ferroviaire](https://data.iledefrance-mobilites.fr/explore/?q=offre%20ferroviaire) |
| Populations et limites communales | [API Geo du gouvernement](https://geo.api.gouv.fr/departements/75/communes?fields=nom%2Ccode%2Cpopulation%2Ccontour&format=geojson&geometry=contour) |

```powershell
git clone <URL_DU_DEPOT_GITHUB>
cd observatoire-fractures-ferroviaires-idf
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run Codes/app.py
```

L'application est disponible à l'adresse indiquée par Streamlit, généralement `http://localhost:8501`.

Sous macOS ou Linux, activer l'environnement virtuel avec :

```bash
source .venv/bin/activate
```

### Utilisation

1. Choisir un périmètre dans la barre latérale : Île-de-France, Paris, petite ou grande couronne.
2. Choisir les modes ferrés affichés sur les deux cartes.
3. Basculer entre l'indice d'accessibilité et la fréquentation ferroviaire 2025.
4. Cliquer sur un territoire, ou le sélectionner au clavier dans la liste.
5. Lire la fiche diagnostic et l'insight sous les deux indicateurs principaux.
6. Consulter l'alternative textuelle pour lecteur d'écran ou exporter les données filtrées dans l'onglet dédié.

### Structure du projet

```text
Codes/
  app.py                         Application Streamlit
  indice.py                      Construction de l'indice d'accessibilité
  indicateur_validation_pop.R    Exploration initiale des validations
Données/
  indice_communes.csv            Indicateurs territoriaux
  communes_idf.geojson           Limites communales
  arrondissements.geojson        Limites des arrondissements parisiens
  emplacement-des-gares-idf.csv  Localisation des gares et stations
  traces-...geojson              Traces des lignes IDFM
  Validations/                   Validations ferroviaires 2025 par trimestre
requirements.txt                 Dépendances Python
```

## La licence

Le code et la documentation de ce projet sont sous licence [MIT](LICENSE).

Les données restent soumises à leurs licences et conditions de réutilisation respectives. Vérifier les licences des jeux de données d'Île-de-France Mobilités et de l'INSEE avant toute republication.
