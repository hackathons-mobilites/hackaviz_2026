SELECT
    CAST(codgeo AS varchar)   AS codgeo,
    CAST(code_be AS varchar)  AS code_be
FROM {{ source('open_data', 'communes_bassins') }}
