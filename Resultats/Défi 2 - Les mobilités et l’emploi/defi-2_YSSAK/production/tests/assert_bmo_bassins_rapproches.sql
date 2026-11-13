-- Chaque bassin BMO de la région doit être rapproché d'un et un seul bassin du référentiel régional.
SELECT nom_bassin, COUNT(DISTINCT code_be) AS n
FROM {{ ref('stg_bmo') }}
GROUP BY nom_bassin
HAVING COUNT(DISTINCT code_be) <> 1 OR MAX(code_be) IS NULL
