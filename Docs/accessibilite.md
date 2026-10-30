# Accessibilité des visualisations de données


## Un enjeu commun à l’ensemble des défis
L’accessibilité numérique consiste à concevoir des contenus et des services numériques que chacun peut percevoir, comprendre et utiliser, quelles que soient ses capacités, sa situation ou les technologies employées. Elle permet notamment aux personnes en situation de handicap d’accéder à l’information et d’agir en autonomie. Elle améliore aussi, pour tous, la clarté, la simplicité et la robustesse des services.

## Pourquoi est-ce essentiel dans les transports ?
Préparer un trajet, lire un plan, repérer un itinéraire adapté ou connaître la disponibilité d’un ascenseur : dans les transports, l’accès à l’information conditionne directement l’autonomie des voyageurs. Disposer de ces informations est indispensable pour de nombreux usagers. En disposer permet de préparer, planifier et réaliser leur déplacement. 

Une visualisation peut cependant devenir difficile, voire impossible à utiliser lorsqu’elle :
- repose uniquement sur la couleur pour transmettre une information
- ne propose pas d’alternative textuelle
- n’est pas utilisable au clavier
- n’est pas correctement restituée par un lecteur d’écran.

## Pour rendre accessible une datavisualisation, deux approches sont possibles : 
- la rendre nativement accessible, afin qu’elle puisse être consultée directement par le plus grand nombre,
- en faire une version accessible pouvant être utilisée sur un mode alternatif (même si sa forme diffère, la quantité d’information qui y est produite doit être identique à celle du document d’origine) 

Associer plusieurs moyens de compréhension, avec par exemple des libellés, des numéros, des pictogrammes, des motifs, des contrastes suffisants. Une version textuelle structurée des données ou du trajet peut apporter de premières réponses. C’est en associant ces différents leviers qu’une datavisualisation peut devenir à la fois plus accessible, plus compréhensible et réellement utile à tous les voyageurs.

## Quelques situations concrètes

!([Images/tableau_accessibilite.png](https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/Images/tableau_accessibilite.png))

## Ce que nous attendons des participants
L’accessibilité doit être prise en compte dès la conception de la solution, et non vérifiée uniquement à la fin. Les propositions seront appréciées selon deux dimensions complémentaires :

![accessibilite attentes](https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/Images/accessibilite_attentes.png)

Point d’attention : une visualisation attractive n’est pas nécessairement accessible. La solution doit rester compréhensible et utilisable sans dépendre d’un seul mode de perception et permettre un accès équivalent aux informations essentielles.

## Checklist rapide avant de présenter votre solution

- Les informations indispensables au voyage sont-elles faciles à repérer et à comprendre ?
- Les contrastes entre les données textuelles et l’arrière-plan de votre interface sont-ils suffisants ?
- Les contrastes entre les données non textuelles, mais informatives (pictogrammes) et l’arrière-plan de votre interface sont-ils suffisants ?
- L’information reste-t-elle compréhensible sans la couleur ?
- L’information reste-t-elle compréhensible si l’on ne voit pas certaines couleurs ?
- Chaque image dispose-t-elle d’une alternative pertinente ? 
- Chaque graphique, carte ou schéma dispose-t-il d’un titre ou d’une légende explicites ?
- Le service peut-il être utilisé uniquement au clavier (sans la souris par exemple) ?

## Ressources et outils utiles

### Référentiels et guides
- RGAA – Référentiel général d’amélioration de l’accessibilité : référentiel officiel français https://accessibilite.numerique.gouv.fr/
- Hardis Tech Services : présentation synthétique du RGAA et de l’accessibilité numérique https://www.hardis-tech-services.com/ressources/blog/rgaa-definition-accessibilite-2025/
- Guide data.gouv.fr – Visualiser des données : comprend un guide sur l'accessibilité des visualisations (daltonisme, intelligibilité, responsive, outils) https://guides.data.gouv.fr/guides/reutiliser-des-donnees/guide-traitement-et-analyse-de-donnees/visualiser-des-donnees
- Data Visualisation Guide – data.europa.eu : ressources sur l’accessibilité des visualisations de données https://data.europa.eu/apps/data-visualisation-guide/accessibility-in-highcharts
- Dataviz accessible – Tamara Sredojevic : texte court et lisible sur les principes de base https://www.iamtamara.design/fr/blog/dataviz
- Data Viz accessible – RGAA Checker : ne jamais s'appuyer sur la couleur seule, utiliser motifs, étiquettes directes et contrastes élevés, et fournir une alternative textuelle ou un tableau HTML. https://rgaa-checker.com/blog/data-viz-accessibiliteTransports faciles d’accès – Île-de-France Mobilités : itinéraires adaptés, état des équipements, disponibilité des ascenseurs. Elle aide à se mettre à la place des usagers.
- Transports faciles d’accès – Île-de-France Mobilités : itinéraires adaptés, état des équipements, disponibilité des ascenseurs. Elle aide à se mettre à la place des usagers https://www.iledefrance-mobilites.fr/le-reseau/transports-faciles-d-acces

### Contrastes et perception des couleurs (daltonisme)

- Contrast Finder : teste vos couleurs de fond et de premier plan et suggère d'autres couleurs si le contraste minimum n'est pas atteint https://contrast-finder.tanaguru.com/ 
- Colour Contrast Analyser – TPGi : outil gratuit à télécharger, qui mesure le contraste de deux couleurs avec une pipette https://www.tpgi.com/color-contrast-checker/ 
- Guide daltonisme – RGAA Checker : propose un simulateur de daltonisme pour voir son site comme le perçoivent les personnes daltoniennes https://rgaa-checker.com/blog/daltonisme-accessibilite-guide 
- Astuce possible sans outil : passer sa visualisation en niveaux de gris. Si elle reste lisible, c'est bon signe

### Bibliothèques de dataviz

- Module d’accessibilité Highcharts : inclus dans chaque licence Highcharts et suit le standard WCAG 2.2. Il gère notamment les motifs de remplissage et des formes de marqueurs différentes, pour ne pas dépendre de la couleur. Vérifiez la licence selon l'usage de vos participants https://highcharts.com/docs/accessibility/accessibility-module
- Accessibilité de Chart.js : attention, le contenu du canvas n'est pas accessible aux lecteurs d'écran par défaut ; il faut ajouter des attributs ARIA ou un contenu de repli https://www.chartjs.org/docs/latest/general/accessibility.html

### Cartographie accessible

- Handimap : calculateur d’itinéraires prenant en compte les contraintes d’accessibilité selon les profils de mobilité https://www.handimap.fr/
- Cartographier l’accessibilité avec OpenStreetMap – Jungle Bus : méthodes pour documenter les cheminements piétons et les équipements https://junglebus.io/cartographier-laccessibilite-avec-openstreetmap/
- Wheelmap : permet de trouver et de marquer l'accessibilité en fauteuil roulant des lieux. Centrée sur les fauteuils roulants https://wheelmap.org/ 
- Navigation au clavier dans Google Maps : exemple de navigation au clavier et de restitution sous forme de liste. Une zone de la carte est mise en surbrillance, avec dessous une liste numérotée des lieux. C'est un bon exemple d'alternative à la souris https://support.google.com/maps/answer/6396990?hl=fr


