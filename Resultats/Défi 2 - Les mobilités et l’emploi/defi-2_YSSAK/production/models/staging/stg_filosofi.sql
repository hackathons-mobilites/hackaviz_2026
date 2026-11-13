-- Filosofi au format long. Les valeurs sous secret statistique (CONF_STATUS = 'C')
-- ou manquantes arrivent avec OBS_VALUE vide : on les garde à NULL.
-- maille est alignée sur les libellés de dim_geo.

SELECT
    CASE CAST(GEO_OBJECT AS varchar)
        WHEN 'COM'    THEN 'Commune'
        WHEN 'ARM'    THEN 'Arrondissement'
        WHEN 'EPCI'   THEN 'EPCI'
        WHEN 'ZE2020' THEN 'Zone d''emploi'
        WHEN 'DEP'    THEN 'Département'
        WHEN 'REG'    THEN 'Région'
    END                                          AS maille,
    CAST(GEO AS varchar)                         AS codegeo,
    CAST(FILOSOFI_MEASURE AS varchar)            AS mesure,
    CAST(OBS_VALUE AS double precision)          AS valeur,
    CAST(CONF_STATUS AS varchar) = 'C'           AS est_secret,
    CAST(TIME_PERIOD AS integer)                 AS annee
FROM {{ source('open_data', 'filosofi_' ~ var('annee_filosofi')) }}
