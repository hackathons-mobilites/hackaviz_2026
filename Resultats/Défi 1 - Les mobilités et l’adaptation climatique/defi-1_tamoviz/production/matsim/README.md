# matsim

Simulation multi-agents de la journée de navettes, un jour ordinaire et un jour de vigilance rouge, puis trois mesures testées le jour de canicule.

## Installer MATSim 15

1. Installer Java 17.
2. Télécharger la version 15.0 de MATSim (archive « release » sur github.com/matsim-org/matsim-libs) et la décompresser dans `matsim/lib/matsim-15.0/`, de sorte que `matsim/lib/matsim-15.0/matsim-15.0.jar` et `matsim/lib/matsim-15.0/libs/` existent.

`matsim/lib/` n'est pas versionné.

## Lancer

```bash
matsim\run_matsim.cmd
```

Le script lance les cinq scénarios (30 itérations, environ 30 minutes chacun avec 6 Go de mémoire), puis `scripts/13_matsim_analysis.py` (résultats dans `web/data/matsim.js`) et `scripts/14_matsim_anim.py` (animations `web/data/msanim_*.js`).

## Contenu de `scenario/` (versionné)

| Fichier | Contenu | Produit par |
|---|---|---|
| `network.xml.gz` | réseau de transport en commun (une boucle par arrêt, un lien par paire d'arrêts consécutifs) | `11_matsim_inputs.py` |
| `transitSchedule.xml.gz`, `transitVehicles.xml.gz` | horaires et véhicules du mardi 10 novembre 2026, 5 h-22 h | `11_matsim_inputs.py` |
| `population.xml.gz` | 1 % des navetteurs MOBPRO 2021 (24 147 agents) | `11_matsim_inputs.py` |
| `config_<scénario>.xml` | ordinaire, canicule, clim, freq, horaires | `12_matsim_config.py` |
| `transitSchedule_freq.xml.gz`, `transitVehicles_freq.xml.gz` | renfort de fréquence des bus aux heures de pointe | `12c_matsim_levers.py` |
| `population_horaires.xml.gz` | journées avancées d'une heure pour une partie des actifs | `12c_matsim_levers.py` |
| `meta.json` | métadonnées du scénario | `11_matsim_inputs.py` |

## Sorties (non versionnées)

`output_<scénario>/` : événements, plans, trajets, étapes (≈ 600 Mo par scénario).
