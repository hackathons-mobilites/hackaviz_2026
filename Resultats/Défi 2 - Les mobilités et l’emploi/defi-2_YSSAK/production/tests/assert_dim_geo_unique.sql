SELECT maille, codegeo, COUNT(*) AS n
FROM {{ ref('dim_geo') }}
GROUP BY maille, codegeo
HAVING COUNT(*) > 1
