-- MOBPRO enrichi des territoires de résidence et de travail (toutes mailles).
-- Périmètre : actifs qui résident dans la région OU qui y travaillent (flux entrants inclus).
-- Un actif résidant hors région n'a pas de territoire de résidence régional : les colonnes *_residence
-- restent renseignées (c'est sa vraie commune) mais il ne compte dans les agrégats résidents que si
-- region_residence = var('region').

WITH m AS (
    SELECT * FROM {{ ref('stg_mobpro') }}
),

geo AS (
    SELECT c.codgeo, c.epci, c.zone_emploi, c.departement, c.region, b.code_be AS bassin_emploi
    FROM {{ ref('stg_cog_communes') }} c
    LEFT JOIN {{ ref('stg_communes_bassins') }} b ON b.codgeo = c.codgeo
)

SELECT
    m.*,
    r.epci                                              AS epci_residence,
    r.zone_emploi                                       AS ze_residence,
    r.bassin_emploi                                     AS be_residence,
    r.departement                                       AS dep_residence,
    t.epci                                              AS epci_travail,
    t.zone_emploi                                       AS ze_travail,
    t.bassin_emploi                                     AS be_travail,
    t.departement                                       AS dep_travail,
    t.region                                            AS reg_travail,
    m.code_trans <> '1'                                 AS se_deplace,
    m.indicateur_lieu_travail <> '1'                    AS travaille_hors_commune,
    m.indicateur_lieu_travail NOT IN ('1', '2')         AS travaille_hors_departement,
    m.indicateur_lieu_travail NOT IN ('1', '2', '3')    AS travaille_hors_region,
    m.nb_voitures_menage = '0'                          AS menage_sans_voiture,
    m.nb_voitures_menage <> 'Z'                         AS logement_ordinaire,
    m.region_residence = {{ lit(var('region')) }}       AS reside_en_region,
    t.region = {{ lit(var('region')) }}                 AS travaille_en_region
FROM m
LEFT JOIN geo r ON r.codgeo = m.commune_residence
LEFT JOIN geo t ON t.codgeo = m.commune_travail
