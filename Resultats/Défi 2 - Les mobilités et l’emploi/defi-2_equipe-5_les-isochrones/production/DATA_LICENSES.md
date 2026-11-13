# Data licences and attribution

The code in this repository is under the MIT licence (`LICENSE`). The data it uses and the
derived data it publishes keep their own licences:

| Data | Producer | Licence | Used for |
| --- | --- | --- | --- |
| GTFS timetables "Horaires prévus sur les lignes de transport en commun d'Île-de-France" | Île-de-France Mobilités | ODbL 1.0 | all travel times |
| Home-work flows, RP 2022 (base flux, MOBPRO) | INSEE | Licence Ouverte 2.0 | jobs, residents, flows |
| Commuting mode by commune, RP 2023 (NAV2, Melodi API) | INSEE | Licence Ouverte 2.0 | car share |
| Income by commune (Filosofi 2021) | INSEE via data.gouv.fr | Licence Ouverte 2.0 | income quintiles |
| Commune boundaries and town halls | IGN via geo.api.gouv.fr | Licence Ouverte 2.0 | zones and points |
| Grand Paris Express station locations | Société des grands projets | Licence Ouverte 2.0 | GPE scenario |

**ODbL share-alike.** The travel-time matrices in `isochrones/data/processed/tt_pt_*.npz` (not committed, rebuilt with `make tt`) and the tables in
`isochrones/outputs/tables/` derived from them are a derived database of the IDFM GTFS. They are published under
ODbL 1.0, with attribution: *"Contient des données d'Île-de-France Mobilités, ODbL."*

## PRIM (Île-de-France Mobilités), added by Veasna RA

| Dataset | Use | Licence |
| --- | --- | --- |
| Offre de transport théorique par arrêt et par heure | Story chapter 3, service by hour (region, Roissy, Orly) | Licence Ouverte / Open Licence |
| Aménagements cyclables (OpenStreetMap, via PRIM) | Story chapter 5, cycling infrastructure per town | ODbL |
