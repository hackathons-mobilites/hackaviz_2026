-- Fait au format long : 1 ligne = 1 territoire x 1 indicateur x 1 période.
--   nombre         : la valeur
--   effectif_base  : effectif pondéré qui a servi au calcul (dénominateur des parts) ; NULL hors MOBPRO
--   fiable         : FALSE quand effectif_base < var('seuil_fiabilite') -> à griser dans le dashboard
--   periode        : texte libre précisant la période (année RP, trimestre...)
-- Les parts sont recalculées à chaque maille à partir des effectifs, jamais sommées.

{% set seuil = var('seuil_fiabilite') %}

WITH geo AS (
    SELECT maille, codegeo, epci, zone_emploi, bassin_emploi, departement, region FROM {{ ref('dim_geo') }}
),

m AS (
    SELECT * FROM {{ ref('int_mobpro_territoires') }}
),

-- ------------------------------------------------------------------
-- 1. MOBPRO au lieu de résidence, par maille
-- ------------------------------------------------------------------
residents AS (
{% for x in mailles() %}
    SELECT
        {{ lit(x.maille) }}                                                    AS maille,
        {{ x.residence }}                                                      AS codegeo,
        SUM(poids)                                                             AS nb_actifs,
        SUM(poids) FILTER (WHERE se_deplace)                                   AS nb_navetteurs,
        SUM(poids) FILTER (WHERE code_trans = '2')                             AS nb_marche,
        SUM(poids) FILTER (WHERE code_trans = '3')                             AS nb_velo,
        SUM(poids) FILTER (WHERE code_trans = '4')                             AS nb_2rm,
        SUM(poids) FILTER (WHERE code_trans = '5')                             AS nb_voiture,
        SUM(poids) FILTER (WHERE code_trans = '6')                             AS nb_tc,
        SUM(poids) FILTER (WHERE code_trans = '1')                             AS nb_sans_transport,
        SUM(poids) FILTER (WHERE travaille_hors_commune)                       AS nb_hors_commune,
        SUM(poids) FILTER (WHERE travaille_hors_departement)                   AS nb_hors_departement,
        SUM(poids) FILTER (WHERE logement_ordinaire)                           AS nb_logement_ordinaire,
        SUM(poids) FILTER (WHERE logement_ordinaire AND menage_sans_voiture)   AS nb_sans_voiture
    FROM m
    WHERE reside_en_region AND {{ x.residence }} IS NOT NULL
    GROUP BY {{ x.residence }}
    {% if not loop.last %}UNION ALL{% endif %}
{% endfor %}
),

-- ------------------------------------------------------------------
-- 2. MOBPRO au lieu de travail (emplois), par maille
-- ------------------------------------------------------------------
emplois AS (
{% for x in mailles() %}
    SELECT
        {{ lit(x.maille) }}        AS maille,
        {{ x.travail }}            AS codegeo,
        SUM(poids)                 AS nb_emplois
    FROM m
    WHERE travaille_en_region AND {{ x.travail }} IS NOT NULL
    GROUP BY {{ x.travail }}
    {% if not loop.last %}UNION ALL{% endif %}
{% endfor %}
),

-- FULL JOIN : un territoire qui a des emplois mais aucun actif résident (zone d'activité, aéroport...)
-- garde son nb_emplois ; ses indicateurs "résidents" sont NULL et filtrés plus bas.
fact_mobpro AS (
    SELECT COALESCE(r.maille, e.maille) AS maille, COALESCE(r.codegeo, e.codegeo) AS codegeo,
           v.code_indicateur, v.nombre, v.effectif_base,
           {{ var('annee_mobpro') }} AS annee, 'RP {{ var('annee_mobpro') }}' AS periode
    FROM residents r
    FULL OUTER JOIN emplois e ON e.maille = r.maille AND e.codegeo = r.codegeo
    CROSS JOIN LATERAL (VALUES
        ('nb_actifs_occupes',           r.nb_actifs,                                                   r.nb_actifs),
        ('nb_navetteurs',               r.nb_navetteurs,                                               r.nb_navetteurs),
        ('nb_emplois',                  e.nb_emplois,                                                  e.nb_emplois),
        ('indice_concentration_emploi', 100.0 * e.nb_emplois          / NULLIF(r.nb_actifs, 0),        r.nb_actifs),
        ('part_tc',                     100.0 * r.nb_tc               / NULLIF(r.nb_navetteurs, 0),    r.nb_navetteurs),
        ('part_voiture',                100.0 * r.nb_voiture          / NULLIF(r.nb_navetteurs, 0),    r.nb_navetteurs),
        ('part_velo',                   100.0 * r.nb_velo             / NULLIF(r.nb_navetteurs, 0),    r.nb_navetteurs),
        ('part_marche',                 100.0 * r.nb_marche           / NULLIF(r.nb_navetteurs, 0),    r.nb_navetteurs),
        ('part_2rm',                    100.0 * r.nb_2rm              / NULLIF(r.nb_navetteurs, 0),    r.nb_navetteurs),
        ('part_sans_transport',         100.0 * r.nb_sans_transport   / NULLIF(r.nb_actifs, 0),        r.nb_actifs),
        ('part_hors_commune',           100.0 * r.nb_hors_commune     / NULLIF(r.nb_actifs, 0),        r.nb_actifs),
        ('part_hors_departement',       100.0 * r.nb_hors_departement / NULLIF(r.nb_actifs, 0),        r.nb_actifs),
        ('part_menages_sans_voiture',   100.0 * r.nb_sans_voiture     / NULLIF(r.nb_logement_ordinaire, 0), r.nb_logement_ordinaire)
    ) AS v(code_indicateur, nombre, effectif_base)
),

-- ------------------------------------------------------------------
-- 3. FILOSOFI : valeurs publiées par l'INSEE à chaque maille (non recalculables)
-- ------------------------------------------------------------------
fact_filosofi AS (
    SELECT
        f.maille,
        f.codegeo,
        CASE f.mesure
            WHEN 'MED_SL'      THEN 'mediane_niveau_vie'
            WHEN 'PR_MD60'     THEN 'taux_pauvrete'
            WHEN 'IR_D9_D1_SL' THEN 'rapport_interdecile'
        END                                    AS code_indicateur,
        f.valeur                               AS nombre,
        NULL                                   AS effectif_base,
        f.annee,
        'Filosofi ' || CAST(f.annee AS varchar) AS periode
    FROM {{ ref('stg_filosofi') }} f
    INNER JOIN geo g ON g.maille = f.maille AND g.codegeo = f.codegeo
    WHERE f.mesure IN ('MED_SL', 'PR_MD60', 'IR_D9_D1_SL')
),

-- ------------------------------------------------------------------
-- 4. CHÔMAGE : dernier trimestre publié, zones d'emploi de la région
-- ------------------------------------------------------------------
dernier_trim AS (
    SELECT MAX(periode) AS periode FROM {{ ref('stg_chomage_ze') }}
),

fact_chomage AS (
    SELECT
        'Zone d''emploi'       AS maille,
        c.zone_emploi          AS codegeo,
        'taux_chomage'         AS code_indicateur,
        c.taux_chomage         AS nombre,
        NULL                   AS effectif_base,
        c.annee,
        c.periode
    FROM {{ ref('stg_chomage_ze') }} c
    INNER JOIN dernier_trim d ON d.periode = c.periode
    INNER JOIN geo g ON g.maille = 'Zone d''emploi' AND g.codegeo = c.zone_emploi

    UNION ALL

    -- même indicateur à la maille départementale (série INSEE "comparaisons départementales")
    SELECT
        'Département', c.departement, 'taux_chomage', c.taux_chomage, NULL, c.annee, c.periode
    FROM {{ ref('stg_chomage_dep') }} c
    INNER JOIN (SELECT MAX(periode) AS periode FROM {{ ref('stg_chomage_dep') }}) d ON d.periode = c.periode
    INNER JOIN geo g ON g.maille = 'Département' AND g.codegeo = c.departement
),

-- ------------------------------------------------------------------
-- 4 bis. DEMANDEURS D'EMPLOI (DARES) : dernier mois publié, zones d'emploi
-- ------------------------------------------------------------------
dernier_mois AS (
    SELECT MAX(mois) AS mois FROM {{ ref('stg_defm_ze') }}
),

fact_defm AS (
    SELECT
        'Zone d''emploi'                                         AS maille,
        d.zone_emploi                                            AS codegeo,
        CASE d.categorie WHEN 'A' THEN 'nb_demandeurs_emploi_a' ELSE 'nb_demandeurs_emploi_abc' END AS code_indicateur,
        d.nb_demandeurs                                          AS nombre,
        NULL                                                     AS effectif_base,
        d.annee,
        d.mois                                                   AS periode
    FROM {{ ref('stg_defm_ze') }} d
    INNER JOIN dernier_mois m ON m.mois = d.mois
    INNER JOIN geo g ON g.maille = 'Zone d''emploi' AND g.codegeo = d.zone_emploi
    WHERE d.categorie IN ('A', 'ABC')
),

-- ------------------------------------------------------------------
-- 4 ter. BMO (France Travail) : projets de recrutement, par bassin / département / région
-- ------------------------------------------------------------------
bmo_agg AS (
    SELECT 'Bassin d''emploi' AS maille, code_be AS codegeo, annee,
           SUM(nb_projets) AS nb_projets, SUM(nb_projets_difficiles) AS nb_difficiles, SUM(nb_projets_saisonniers) AS nb_saisonniers
    FROM {{ ref('stg_bmo') }} WHERE code_be IS NOT NULL GROUP BY code_be, annee
    UNION ALL
    SELECT 'Département', departement, annee, SUM(nb_projets), SUM(nb_projets_difficiles), SUM(nb_projets_saisonniers)
    FROM {{ ref('stg_bmo') }} GROUP BY departement, annee
    UNION ALL
    SELECT 'Région', region, annee, SUM(nb_projets), SUM(nb_projets_difficiles), SUM(nb_projets_saisonniers)
    FROM {{ ref('stg_bmo') }} GROUP BY region, annee
),

fact_bmo AS (
    SELECT b.maille, b.codegeo, v.code_indicateur, v.nombre, NULL AS effectif_base, b.annee,
           'BMO ' || CAST(b.annee AS varchar) AS periode
    FROM bmo_agg b
    CROSS JOIN LATERAL (VALUES
        ('nb_projets_recrutement',        b.nb_projets),
        ('part_recrutements_difficiles',  100.0 * b.nb_difficiles  / NULLIF(b.nb_projets, 0)),
        ('part_recrutements_saisonniers', 100.0 * b.nb_saisonniers / NULLIF(b.nb_projets, 0))
    ) AS v(code_indicateur, nombre)
),

-- ------------------------------------------------------------------
-- 4 quater. RÉFÉRENTIEL DES LIGNES IDFM : offre régionale (pas de géographie dans la source)
-- ------------------------------------------------------------------
fact_lignes AS (
    SELECT
        'Région'                                             AS maille,
        {{ lit(var('region')) }}                             AS codegeo,
        CASE mode WHEN 'bus' THEN 'nb_lignes_bus' WHEN 'rail' THEN 'nb_lignes_train'
                  WHEN 'metro' THEN 'nb_lignes_metro' WHEN 'tram' THEN 'nb_lignes_tram' END AS code_indicateur,
        CAST(COUNT(*) AS double precision)                   AS nombre,
        NULL                                                 AS effectif_base,
        CAST(substr(MAX(valide_depuis), 1, 4) AS integer)    AS annee,
        'référentiel IDFM'                                   AS periode
    FROM {{ ref('stg_idfm_lignes') }}
    WHERE statut = 'active' AND mode IN ('bus', 'rail', 'metro', 'tram')
    GROUP BY mode
),

-- ------------------------------------------------------------------
-- 5. OFFRE FERRÉE : gares et validations rattachées aux communes, remontées à chaque maille
-- ------------------------------------------------------------------
gares AS (
    SELECT d.id_zdc, d.nb_validations_12m, d.premier_trimestre, d.dernier_trimestre,
           g.codegeo AS commune, g.epci, g.zone_emploi, g.bassin_emploi, g.departement, g.region
    FROM {{ ref('dim_gares') }} d
    INNER JOIN geo g ON g.maille = 'Commune' AND g.codegeo = d.codegeo_commune
),

offre AS (
{% for x in mailles() %}
    SELECT
        {{ lit(x.maille) }}                    AS maille,
        {% if x.maille == 'Commune' %}commune{% else %}{{ x.geo }}{% endif %} AS codegeo,
        COUNT(DISTINCT id_zdc)                 AS nb_gares,
        SUM(nb_validations_12m)                AS nb_validations_12m,
        MIN(premier_trimestre) || ' → ' || MAX(dernier_trimestre) AS periode,
        CAST(substr(MAX(dernier_trimestre), 1, 4) AS integer)     AS annee
    FROM gares
    WHERE {% if x.maille == 'Commune' %}commune{% else %}{{ x.geo }}{% endif %} IS NOT NULL
    GROUP BY {% if x.maille == 'Commune' %}commune{% else %}{{ x.geo }}{% endif %}
    {% if not loop.last %}UNION ALL{% endif %}
{% endfor %}
),

fact_offre AS (
    SELECT maille, codegeo, 'nb_gares' AS code_indicateur, CAST(nb_gares AS double precision) AS nombre,
           NULL AS effectif_base, annee, periode
    FROM offre
    UNION ALL
    SELECT maille, codegeo, 'nb_validations_12m', CAST(nb_validations_12m AS double precision), NULL, annee, periode
    FROM offre
),

-- ------------------------------------------------------------------
-- UNION FINALE
-- ------------------------------------------------------------------
u AS (
    SELECT * FROM fact_mobpro
    UNION ALL SELECT * FROM fact_filosofi
    UNION ALL SELECT * FROM fact_chomage
    UNION ALL SELECT * FROM fact_defm
    UNION ALL SELECT * FROM fact_bmo
    UNION ALL SELECT * FROM fact_lignes
    UNION ALL SELECT * FROM fact_offre
)

SELECT
    CAST(u.maille AS varchar)                                   AS maille,
    CAST(u.codegeo AS varchar)                                  AS codegeo,
    CAST(u.code_indicateur AS varchar)                          AS code_indicateur,
    {{ arrondi('u.nombre', 2) }}                                AS nombre,
    {{ arrondi('u.effectif_base', 0) }}                         AS effectif_base,
    CASE WHEN u.effectif_base IS NULL THEN TRUE
         ELSE u.effectif_base >= {{ seuil }} END                AS fiable,
    CAST(u.annee AS integer)                                    AS annee,
    CAST(u.periode AS varchar)                                  AS periode
FROM u
INNER JOIN geo g ON g.maille = u.maille AND g.codegeo = u.codegeo
WHERE u.nombre IS NOT NULL
