# Thermo Réseau : Guide de conduite du changement et de prise en main

*Hackathon Mobilités 2026 • Thermoviz • V 1.2.1*

## Introduction

Thermo Réseau est une application interactive de pilotage et d’aide à la décision conçue sous Power BI dans le cadre du Hackathon Mobilités 2026 – Spécial Dataviz’. Elle s’inscrit dans le Défi 1 « Les mobilités et l’adaptation climatique » et vise à faciliter la compréhension des enjeux liés aux fortes chaleurs sur le réseau de transport francilien.

L’application rassemble, dans une interface unique, les indicateurs de température, l’identification des gares exposées aux fortes chaleurs, l’analyse de la fréquentation selon les niveaux de température et l’accès à une bibliothèque documentaire. Elle a pour objectif de rendre ces informations plus lisibles et de soutenir les analyses et les décisions.

## Objectif de ce guide

Ce document accompagne les utilisateurs dans la découverte de l’interface et décrit le fonctionnement de chacune des quatre pages. Il explique les principaux filtres, les visualisations et les infobulles afin de favoriser une utilisation autonome et cohérente de Thermo Réseau.

---

## I / Guide de prise en main — Généralités

Les éléments permanents de l’interface vous permettent de vous repérer et de passer d’une analyse à l’autre.

### Les repères communs à toutes les pages

| Repère | Description |
|---|---|
| **01 Logo Île-de-France Mobilités** | Présent en haut à gauche pour identifier le contexte de l’application. |
| **02 Titre de la page** | Affiché au centre du bandeau supérieur, précédé de « Thermo Réseau / ». |
| **03 Numéro de version** | Visible en haut à droite : V 1.2.1 sur les captures de ce guide. |
| **04 Menu de navigation** | Situé à gauche : Indicateurs, Gares exposées, Analyse de la fréquentation et Bibliothèque des Documents. |
| **05 Zone de visualisation** | Espace principal contenant, selon la page, des indicateurs, filtres, graphiques, cartes ou tableaux. |
| **06 Infobulles d’aide** | Les icônes « i » donnent accès, au survol, à des explications sur la page ou sur un indicateur. |

> **À retenir :** Le bouton du menu correspondant à la page active est affiché sur fond blanc. Survolez les icônes d’information pour comprendre le contenu avant d’interpréter les résultats.

---

## II / Page « Indicateurs »

Une vue d’ensemble des indicateurs thermiques et de leur évolution dans le temps.

### Comment utiliser cette page ?

1. **Choisir la maille d’analyse** : Sélectionnez « Aujourd’hui », « Semaine » ou « Mois » pour adapter le niveau de lecture.
2. **Définir le périmètre** : Utilisez la période de référence, la période de comparaison et le filtre « Lignes ».
3. **Lire les indicateurs** : Consultez les températures maximale, minimale et moyenne, les jours de fortes chaleurs, les fontaines à 500 m et les lignes climatisées.
4. **Comparer les évolutions** : Observez la courbe des températures maximales : année A par rapport à A−1, mois par mois.

> **Conseil de lecture :** Commencez par choisir la maille et les périodes, puis lisez les écarts indiqués sur les cartes. Les chiffres de la capture correspondent à un état des données et évoluent selon la sélection.

---

## III / Page « Gares exposées aux fortes chaleurs »

Localiser les gares concernées par des températures supérieures à 40 °C et examiner leur situation.

### Comment utiliser cette page ?

1. **Sélectionner le mode** : Activez ou désactivez les filtres « Métro » et « RER » dans le panneau de gauche.
2. **Explorer la carte** : Repérez les gares exposées grâce aux points géographiques et à leurs libellés.
3. **Examiner le détail** : Le tableau présente la gare, le mode, la ligne, la température maximale, l’humidité, la date et la commune.
4. **Vérifier la proximité d’eau** : Consultez la colonne indiquant le nombre de fontaines situées à 500 mètres de la gare.

> **Point d’attention :** La carte se concentre sur les températures supérieures à 40 °C. Le tableau fournit le détail des observations ; plusieurs lignes peuvent concerner une même gare à des dates différentes.

---

## IV / Page « Analyse de la fréquentation »

Comprendre comment la fréquentation habituelle varie selon l’intensité de la chaleur et les catégories de titres.

### Comment lire les résultats ?

- **Impact moyen des jours chauds** : Un indicateur synthétise la variation moyenne de fréquentation associée aux jours chauds.
- **Perte estimée de fréquentation** : Une carte exprime en volume la perte estimée liée à la chaleur, selon le calcul retenu.
- **Analyse par tranche de température** : Le graphique du haut compare les variations de fréquentation pour différents niveaux de température.
- **Analyse par titre de transport** : Le graphique du bas distingue les variations par catégorie : Navigo, Améthyste, Imagine R, titres occasionnels, etc.

> **Précaution d’interprétation :** Les variations et pertes présentées sont des résultats d’analyse ou d’estimation : elles ne suffisent pas, à elles seules, à établir une causalité directe entre chaleur et fréquentation.

---

## V / Page « Bibliothèque des Documents »

Accéder aux dossiers documentaires et aux baromètres classés par année depuis une seule page.

### Comment accéder aux documents ?

1. **Ouvrir la bibliothèque** : Cliquez sur « Bibliothèque des Documents » dans le menu de gauche.
2. **Choisir une année** : Sélectionnez la carte correspondant à l’année recherchée : 2026, 2025, 2024, 2023 ou 2022.
3. **Ouvrir le dossier associé** : Dans Power BI Desktop, maintenez la touche `Ctrl` puis cliquez sur la carte de l’année.
4. **Consulter les contenus** : Accédez aux fichiers et baromètres disponibles dans le dossier de l’année sélectionnée.

> **Bon réflexe :** L’instruction « Ctrl + clic » concerne Power BI Desktop. L’accès effectif aux documents dépend des liens configurés et des autorisations du poste utilisateur.
