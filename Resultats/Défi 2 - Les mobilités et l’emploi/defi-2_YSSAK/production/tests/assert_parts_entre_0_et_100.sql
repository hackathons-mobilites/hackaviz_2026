-- Les parts et taux (hors rapport interdécile et indice de concentration) sont des pourcentages.
SELECT f.*
FROM {{ ref('fact_mobilite') }} f
INNER JOIN {{ ref('dim_indicateurs') }} i ON i.code_indicateur = f.code_indicateur
WHERE i.unite = '%'
  AND (f.nombre < 0 OR f.nombre > 100)
