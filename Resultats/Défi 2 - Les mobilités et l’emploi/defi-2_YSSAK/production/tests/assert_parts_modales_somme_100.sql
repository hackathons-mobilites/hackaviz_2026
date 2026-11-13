-- À chaque territoire, les 5 parts modales (hors "pas de transport") doivent sommer à 100 (± arrondis).
SELECT maille, codegeo, SUM(nombre) AS total
FROM {{ ref('fact_mobilite') }}
WHERE code_indicateur IN ('part_tc', 'part_voiture', 'part_velo', 'part_marche', 'part_2rm')
GROUP BY maille, codegeo
HAVING ABS(SUM(nombre) - 100) > 0.1
