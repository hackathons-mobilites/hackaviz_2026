# Quand le thermomètre déraille

**Équipe :** The notorious F.A.R.I.D

## Présentation du projet

Ce projet a été développé dans le cadre du Hackaviz Mobilités 2026 spécial dataviz, organisé par Île-de-France Mobilités du 2 au 26 novembre 2026. 

Ce projet est une démonstration de Dataviz sur le sujet de la mobiitée et l'adaptation climatique. Il a pour but de mettre en avant les vulnérabilitées du réseau férré face à la chaleur

Pour en savoir plus, voici le [Guide des participants et participantes](https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/README.md).


### Le problème et la proposition de valeur 

Notre solution répond à la problématique suivante : comment réagit le réseau face aux périodes caniculaires qui vont devenir de plus en plus courantes.
Cela peut servir pour sensibiliser les usagers, ou les décisionnaires afin de pousser pour mettre des moyens en oeuvre dans le but de rendre le réseau et les mobilitées urabines plus résilientes face au climat. 


### La solution

Le rendu est une datastory qui met en valeur plusieurs jeu de données :

- Les données incidents historisées par un utilisateur indepédendant. Il utilise les données open data mise à disposition sur https://prim.iledefrance-mobilites.fr/
   -> le github : https://github.com/wincelau/ratpstatus (Le code source est libre sous licence AGPL-3.0. )
- Les donnes de fréquentation du réseau férré en 2025
- Les données des ilots de chaleur
- Les données de température météofrance 2025
- Les données prédictive de climats de la DRIASxMeteoFrance, Scénario pessimiste RCP 8.5 modèle KNMI-RACMO22E / CNRM-CM5, méthode ADAMONT

Elle analyse l'incidence de la chaleur sur les perturbations et les coupures sur le réseau férré en Ile de France sous une forme ludique et entrainante.

Développé avec Claude.

### Les problèmes surmontés et les enjeux en matière de données

A la base on voulait voir les effet de la température sur les usagers, et proposer un outils de confort. Cependant, on a vite eut du mal à analyser les effet liés aux climats (difficile quand ya de tels variations liés aux vacances) et pour le confort les données les plus intéréssantes auraient été celle de climatisation qui n'existent pas vraiment.

On est donc plutôt partis sur la résilience des infrastructures face aux climat. 
On a aussi essayé de mettre en valeur certaines données liées aux espaces vert, aux fontaine et ilots de fraicherus, mais ca devenait vite un peu bancale et on a manqué de temps.


### Et la suite ? 


Une idée qu'on avait c'est un outil de simulation de trajets en 2100 sous temperatures +4°.
Un truc un peu ludique qui aurait mit en avant les retards liés au incidents sur de l'extrapolation de données. Mais le temps ayant ses limites, ce projet est resté sur de l'analyse un peu brute.



## Installation et utilisation

Un unique fichier html à télécharger et à ouvrir dans votre navigateur.


## La licence

Le code et la documentation de ce projet sont sous licence [MIT](https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/Docs/License.md).
