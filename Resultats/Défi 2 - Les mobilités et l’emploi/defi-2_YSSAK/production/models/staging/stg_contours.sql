-- Contours simplifiés (GeoJSON) et point représentatif des communes et départements.

SELECT
    CAST(maille AS varchar)              AS maille,
    CAST(codegeo AS varchar)             AS codegeo,
    CAST(lon AS double precision)        AS lon,
    CAST(lat AS double precision)        AS lat,
    CAST(geojson AS varchar)             AS geojson
FROM {{ source('open_data', 'contours_idf') }}
