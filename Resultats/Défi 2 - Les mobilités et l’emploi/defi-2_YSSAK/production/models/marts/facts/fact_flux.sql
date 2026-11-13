-- Flux domicile-travail : 1 ligne = commune de résidence x commune de travail x mode.
-- Les deux communes sont en région, sauf :
--   - commune_travail hors région : conservée (flux sortants), avec travaille_en_region = FALSE ;
--   - commune_residence hors région : conservée (flux entrants), avec reside_en_region = FALSE.
-- Le dashboard agrège à l'EPCI / au département à la volée via dim_geo.

SELECT
    CAST(commune_residence AS varchar)          AS commune_residence,
    CAST(commune_travail AS varchar)            AS commune_travail,
    reside_en_region,
    COALESCE(travaille_en_region, FALSE)        AS travaille_en_region,
    CAST(code_trans AS varchar)                 AS code_trans,
    {{ arrondi('SUM(poids)', 1) }}              AS nb_actifs,
    CAST(COUNT(*) AS integer)                   AS nb_observations,   -- individus non pondérés : lecture de fiabilité
    {{ var('annee_mobpro') }}                   AS annee
FROM {{ ref('int_mobpro_territoires') }}
WHERE commune_travail IS NOT NULL
GROUP BY commune_residence, commune_travail, reside_en_region, travaille_en_region, code_trans
