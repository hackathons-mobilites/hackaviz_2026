-- Libellés des zonages supra-communaux (EPCI, EPT, ZE2020, DEP, REG...).

SELECT
    CAST(NIVGEO AS varchar)  AS nivgeo,
    CAST(CODGEO AS varchar)  AS codgeo,
    CAST(LIBGEO AS varchar)  AS libgeo,
    CAST(NB_COM AS integer)  AS nb_communes
FROM {{ source('open_data', 'cog_libelles_supra') }}
WHERE NIVGEO IS NOT NULL
