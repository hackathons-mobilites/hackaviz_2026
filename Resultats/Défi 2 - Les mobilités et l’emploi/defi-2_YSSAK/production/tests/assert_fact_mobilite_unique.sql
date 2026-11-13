-- Un indicateur ne doit apparaître qu'une fois par territoire et par période.
SELECT maille, codegeo, code_indicateur, periode, COUNT(*) AS n
FROM {{ ref('fact_mobilite') }}
GROUP BY maille, codegeo, code_indicateur, periode
HAVING COUNT(*) > 1
