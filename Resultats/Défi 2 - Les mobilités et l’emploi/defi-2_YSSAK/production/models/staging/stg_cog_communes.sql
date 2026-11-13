-- Communes de France au 01/01/2025 et leurs appartenances supra-communales.
-- On garde toute la France : les lieux de travail peuvent être hors région.

SELECT
    CAST(CODGEO AS varchar)                                  AS codgeo,
    CAST(LIBGEO AS varchar)                                  AS libgeo,
    CAST(DEP AS varchar)                                     AS departement,
    CAST(REG AS varchar)                                     AS region,
    NULLIF(CAST(EPCI AS varchar), 'ZZZZZZZZZ')               AS epci,
    NULLIF(CAST(EPT AS varchar), 'ZZZZZZZZZ')                AS ept,
    CAST(ZE2020 AS varchar)                                  AS zone_emploi,
    CAST(UU2020 AS varchar)                                  AS unite_urbaine,
    CAST(AAV2020 AS varchar)                                 AS aire_attraction
FROM {{ source('open_data', 'cog_communes') }}
WHERE CODGEO IS NOT NULL
