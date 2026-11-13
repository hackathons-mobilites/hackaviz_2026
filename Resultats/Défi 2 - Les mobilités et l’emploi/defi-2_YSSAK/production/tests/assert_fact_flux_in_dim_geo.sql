-- Toute commune de résidence en région doit exister dans dim_geo.
SELECT f.commune_residence
FROM {{ ref('fact_flux') }} f
LEFT JOIN {{ ref('dim_geo') }} g ON g.maille = 'Commune' AND g.codegeo = f.commune_residence
WHERE f.reside_en_region AND g.codegeo IS NULL
GROUP BY f.commune_residence
